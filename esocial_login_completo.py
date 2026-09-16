#!/usr/bin/env python3
import argparse
import base64
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates


LOGIN_ESOCIAL = "https://login.esocial.gov.br/login.aspx"
CERT_BASE = "https://certificado.sso.acesso.gov.br/login"


def normalizar(texto):
    texto = str(texto or "")
    texto = unicodedata.normalize("NFD", texto)
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", texto).strip().lower()


def carregar_pfx():
    b64 = os.getenv("ESOCIAL_CERT_BASE64", "").strip()
    pfx_path = os.getenv("ESOCIAL_CERT_PFX_PATH", "").strip()
    senha = os.getenv("ESOCIAL_CERT_PASSWORD", "")

    if b64:
        try:
            dados = base64.b64decode(b64)
            origem = "ESOCIAL_CERT_BASE64"
        except Exception as e:
            raise RuntimeError(f"ESOCIAL_CERT_BASE64 inválido: {e}") from e
    elif pfx_path:
        caminho = Path(pfx_path)
        if not caminho.exists():
            raise RuntimeError(f"Arquivo PFX não encontrado: {caminho}")
        dados = caminho.read_bytes()
        origem = "ESOCIAL_CERT_PFX_PATH"
    else:
        raise RuntimeError(
            "Defina ESOCIAL_CERT_BASE64 ou ESOCIAL_CERT_PFX_PATH."
        )

    if not senha:
        raise RuntimeError("Defina ESOCIAL_CERT_PASSWORD.")

    try:
        chave, certificado, cadeia = load_key_and_certificates(
            dados,
            senha.encode("utf-8"),
        )
    except Exception as e:
        raise RuntimeError(
            "Não foi possível abrir o PFX. Verifique o certificado e a senha."
        ) from e

    if chave is None or certificado is None:
        raise RuntimeError("O PFX não contém certificado/chave privada utilizáveis.")

    return chave, certificado, cadeia or [], origem


def escrever_pems(chave, certificado, cadeia, pasta):
    key_path = Path(pasta) / "client-key.pem"
    cert_path = Path(pasta) / "client-cert.pem"

    key_path.write_bytes(
        chave.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

    cert_bytes = certificado.public_bytes(serialization.Encoding.PEM)
    for ca in cadeia:
        cert_bytes += ca.public_bytes(serialization.Encoding.PEM)
    cert_path.write_bytes(cert_bytes)

    try:
        os.chmod(key_path, 0o600)
        os.chmod(cert_path, 0o600)
    except Exception:
        pass

    return str(cert_path), str(key_path)


def cookies_resumo(sessao):
    return [f"{c.name}@{c.domain}" for c in sessao.cookies]


def titulo_html(html):
    try:
        soup = BeautifulSoup(html or "", "html.parser")
        return soup.title.get_text(" ", strip=True) if soup.title else ""
    except Exception:
        return ""


def extrair_url_onclick(onclick, base_url):
    if not onclick:
        return None

    # URL absoluta
    m = re.search(r"""https?://[^"' )]+""", onclick, re.I)
    if m:
        return m.group(0)

    # window.location / location.href = '...'
    m = re.search(
        r"""(?:window\.)?location(?:\.href)?\s*=\s*['"]([^'"]+)['"]""",
        onclick,
        re.I,
    )
    if m:
        return urljoin(base_url, m.group(1))

    return None


def achar_acao_govbr(html, base_url):
    soup = BeautifulSoup(html, "html.parser")

    # 1) Link normal
    for a in soup.find_all("a"):
        texto = normalizar(a.get_text(" ", strip=True))
        if "entrar com gov.br" in texto or "entrar com govbr" in texto:
            href = (a.get("href") or "").strip()
            if href and href != "#":
                return {
                    "tipo": "get",
                    "url": urljoin(base_url, href),
                    "descricao": "link",
                }

            destino = extrair_url_onclick(a.get("onclick"), base_url)
            if destino:
                return {
                    "tipo": "get",
                    "url": destino,
                    "descricao": "link-onclick",
                }

    # 2) Botão/input submit dentro de formulário
    candidatos = []
    for el in soup.find_all(["button", "input"]):
        texto = ""
        if el.name == "button":
            texto = el.get_text(" ", strip=True)
        else:
            texto = el.get("value") or ""
        texto_n = normalizar(texto)

        if "gov.br" in texto_n or "govbr" in texto_n:
            candidatos.append(el)

    for el in candidatos:
        destino = extrair_url_onclick(el.get("onclick"), base_url)
        if destino:
            return {
                "tipo": "get",
                "url": destino,
                "descricao": "botao-onclick",
            }

        form = el.find_parent("form")
        if not form:
            continue

        method = (form.get("method") or "get").lower()
        action = urljoin(base_url, form.get("action") or base_url)

        dados = {}
        for inp in form.find_all(["input", "button"]):
            name = inp.get("name")
            if not name:
                continue

            tipo = normalizar(inp.get("type") or "")
            if tipo in {"checkbox", "radio"} and not inp.has_attr("checked"):
                continue

            value = inp.get("value") or ""

            # Para submits, envia apenas o botão escolhido.
            if tipo in {"submit", "button"} and inp is not el:
                continue

            dados[name] = value

        if el.get("name"):
            dados[el.get("name")] = el.get("value") or el.get_text(" ", strip=True)

        return {
            "tipo": method if method in {"get", "post"} else "post",
            "url": action,
            "dados": dados,
            "descricao": "formulario",
        }

    # 3) Qualquer elemento com onclick contendo gov.br
    for el in soup.find_all(onclick=True):
        texto = normalizar(el.get_text(" ", strip=True))
        onclick = el.get("onclick") or ""
        if "gov" in texto or "gov" in normalizar(onclick):
            destino = extrair_url_onclick(onclick, base_url)
            if destino:
                return {
                    "tipo": "get",
                    "url": destino,
                    "descricao": "onclick-generico",
                }

    return None


def imprimir_diagnostico_pagina(html, url):
    soup = BeautifulSoup(html, "html.parser")
    print("Diagnóstico da página:")
    print(f"  Título: {titulo_html(html)}")
    print(f"  URL: {url}")
    print(f"  Forms: {len(soup.find_all('form'))}")
    print(f"  Links: {len(soup.find_all('a'))}")
    print(f"  Botões: {len(soup.find_all(['button', 'input']))}")

    print("  Candidatos contendo gov.br:")
    achou = False
    for el in soup.find_all(["a", "button", "input"]):
        texto = el.get_text(" ", strip=True) if el.name != "input" else (el.get("value") or "")
        if "gov" in normalizar(texto):
            achou = True
            print(
                "   -",
                el.name,
                repr(texto[:120]),
                "href=" + repr((el.get("href") or "")[:200]),
                "name=" + repr(el.get("name")),
                "id=" + repr(el.get("id")),
                "type=" + repr(el.get("type")),
            )
    if not achou:
        print("   - nenhum")


def obter_authorization_url(resposta):
    candidatos = [resposta.url]

    for hist in resposta.history:
        candidatos.append(hist.url)
        loc = hist.headers.get("Location")
        if loc:
            candidatos.append(urljoin(hist.url, loc))

    for url in reversed(candidatos):
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        if qs.get("authorization_id") and qs.get("client_id"):
            return url

    return None


def executar_acao(sessao, acao, timeout):
    print(
        f"Ação GOV.BR encontrada: {acao['descricao']} "
        f"({acao['tipo'].upper()}) {acao['url']}"
    )

    if acao["tipo"] == "post":
        return sessao.post(
            acao["url"],
            data=acao.get("dados") or {},
            timeout=timeout,
            allow_redirects=True,
        )

    if acao["tipo"] == "get":
        return sessao.get(
            acao["url"],
            params=acao.get("dados") or None,
            timeout=timeout,
            allow_redirects=True,
        )

    raise RuntimeError(f"Tipo de ação não suportado: {acao['tipo']}")


def seguir_redirects_manualmente(sessao, resposta, cert_tuple, timeout, max_saltos=12):
    atual = resposta

    for salto in range(1, max_saltos + 1):
        location = atual.headers.get("Location")
        if atual.status_code not in {301, 302, 303, 307, 308} or not location:
            return atual

        destino = urljoin(atual.url, location)
        host = (urlparse(destino).hostname or "").lower()
        usar_cert = host == "certificado.sso.acesso.gov.br"

        print(
            f"Redirect {salto}: {atual.status_code} -> {destino} "
            f"{'(com certificado)' if usar_cert else ''}"
        )

        atual = sessao.get(
            destino,
            cert=cert_tuple if usar_cert else None,
            timeout=timeout,
            allow_redirects=False,
        )

    raise RuntimeError("Quantidade máxima de redirects excedida.")


def main():
    parser = argparse.ArgumentParser(
        description="Teste do fluxo completo eSocial -> gov.br -> certificado A1."
    )
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    chave, certificado, cadeia, origem = carregar_pfx()

    print("=== TESTE COMPLETO PYTHON eSocial / GOV.BR / A1 ===")
    print(f"Fonte do certificado: {origem}")
    print()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems(chave, certificado, cadeia, pasta)
        cert_tuple = (cert_path, key_path)

        sessao = requests.Session()
        sessao.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/153.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            }
        )

        # ---------------------------------------------------------
        # 1. Iniciar sessão diretamente no eSocial
        # ---------------------------------------------------------
        print("1) Abrindo eSocial...")
        r1 = sessao.get(
            LOGIN_ESOCIAL,
            timeout=args.timeout,
            allow_redirects=True,
        )
        print(f"   Status: {r1.status_code}")
        print(f"   URL: {r1.url}")
        print(f"   Título: {titulo_html(r1.text)}")
        print(f"   Cookies: {cookies_resumo(sessao)}")
        print()

        # ---------------------------------------------------------
        # 2. Acionar Entrar com gov.br na MESMA sessão Python
        # ---------------------------------------------------------
        print("2) Procurando ação 'Entrar com gov.br'...")
        acao = achar_acao_govbr(r1.text, r1.url)

        if not acao:
            print("RESULTADO: ACAO_GOVBR_NAO_ENCONTRADA")
            imprimir_diagnostico_pagina(r1.text, r1.url)
            return 4

        r2 = executar_acao(sessao, acao, args.timeout)
        print(f"   Status final: {r2.status_code}")
        print(f"   URL final: {r2.url}")
        print(f"   Título: {titulo_html(r2.text)}")
        print(f"   Cookies: {cookies_resumo(sessao)}")
        print()

        authorization_url = obter_authorization_url(r2)
        if not authorization_url:
            print("RESULTADO: AUTHORIZATION_ID_NAO_ENCONTRADO")
            imprimir_diagnostico_pagina(r2.text, r2.url)
            return 5

        parsed = urlparse(authorization_url)
        qs = parse_qs(parsed.query)
        client_id = qs["client_id"][0]
        authorization_id = qs["authorization_id"][0]

        print("3) Authorization criado na MESMA sessão Python.")
        print(f"   client_id: {client_id}")
        print(f"   authorization_id: {authorization_id}")
        print()

        cert_url = CERT_BASE + "?" + urlencode(
            {
                "client_id": client_id,
                "authorization_id": authorization_id,
            }
        )

        # ---------------------------------------------------------
        # 3. Apresentar A1 por mTLS
        # ---------------------------------------------------------
        print("4) Apresentando certificado A1 via mTLS...")
        r3 = sessao.get(
            cert_url,
            cert=cert_tuple,
            timeout=args.timeout,
            allow_redirects=False,
        )

        print(f"   Status mTLS: {r3.status_code}")
        print(f"   URL: {r3.url}")
        print(f"   Location: {r3.headers.get('Location')}")
        print(f"   Cookies: {cookies_resumo(sessao)}")
        print()

        # ---------------------------------------------------------
        # 4. Seguir retorno do GOV.BR sem perder a sessão original
        # ---------------------------------------------------------
        print("5) Seguindo retorno para o eSocial...")
        final = seguir_redirects_manualmente(
            sessao,
            r3,
            cert_tuple,
            args.timeout,
        )

        print()
        print("=== RESULTADO FINAL ===")
        print(f"HTTP status: {final.status_code}")
        print(f"URL final: {final.url}")
        print(f"Título: {titulo_html(final.text)}")
        print(f"Cookies finais: {cookies_resumo(sessao)}")

        texto = normalizar(BeautifulSoup(final.text or "", "html.parser").get_text(" ", strip=True))

        sinais_autenticado = [
            "trocar perfil",
            "trocar perfil/modulo",
            "titular do certificado",
            "relatorios gerenciais",
        ]

        if any(sinal in texto for sinal in sinais_autenticado):
            print()
            print("RESULTADO: LOGIN_ESOCIAL_CONFIRMADO")
            print(
                "O fluxo completo foi concluído mantendo a mesma sessão Python."
            )
            return 0

        if "entrar com gov.br" in texto and "login.esocial.gov.br" in final.url.lower():
            print()
            print("RESULTADO: RETORNOU_AO_LOGIN_ESOCIAL")
            print(
                "O certificado foi aceito, mas o eSocial devolveu a sessão para "
                "a tela de login. Os logs acima mostram em qual salto isso ocorreu."
            )
            return 6

        print()
        print("RESULTADO: ESTADO_FINAL_NAO_CONFIRMADO")
        print(
            "O fluxo chegou a uma página final, mas o script ainda não reconheceu "
            "um dos sinais de login do eSocial."
        )
        return 7


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.exceptions.SSLError as e:
        print()
        print("RESULTADO: ERRO_SSL")
        print(str(e))
        sys.exit(2)
    except requests.exceptions.RequestException as e:
        print()
        print("RESULTADO: ERRO_HTTP")
        print(str(e))
        sys.exit(3)
    except Exception as e:
        print()
        print("RESULTADO: ERRO")
        print(str(e))
        sys.exit(1)
