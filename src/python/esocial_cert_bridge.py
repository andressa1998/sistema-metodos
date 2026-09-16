#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Bridge Python V3 - autenticação mTLS gov.br/eSocial.

Fluxo:
1) Recebe do Node:
   - url: endpoint certificado.sso.acesso.gov.br/login?...authorization_id=...
   - authorizeUrl: URL OAuth original https://sso.acesso.gov.br/authorize?...state=...
   - cookies: cookies da sessão Playwright/eSocial
2) Preserva a sessão original do eSocial.
3) Faz o handshake mTLS em uma sessão limpa com o A1.
4) Mescla os cookies novos do certificado na sessão principal.
5) REENTRA na authorizeUrl original. Esse passo é essencial para o provedor
   OAuth perceber que a sessão gov.br já foi autenticada e então emitir o
   retorno para redirect_uri do eSocial.
6) Segue redirects até a página final e devolve cookies + URL ao Node.

Segredos:
- O PFX é lido apenas de ESOCIAL_CERT_BASE64 / ESOCIAL_CERT_PASSWORD
  (ou ESOCIAL_CERT_PFX_PATH apenas para testes locais).
- Cookies e conteúdo completo não são escritos em stdout.
"""

import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization.pkcs12 import (
    load_key_and_certificates,
)

CERT_HOST = "certificado.sso.acesso.gov.br"
SSO_HOST = "sso.acesso.gov.br"
ESOCIAL_HOST = "login.esocial.gov.br"
REDIRECT_CODES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 15

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/153.0.0.0 Safari/537.36"
)


def resposta_json(payload):
    sys.stdout.write(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )
    sys.stdout.flush()


def falhar(code, message, details=None):
    resposta_json({
        "ok": False,
        "code": code,
        "error": message,
        "details": details or None,
    })
    raise SystemExit(0)


def resumo_url(url):
    try:
        p = urlparse(url)
        return {
            "host": p.hostname or "",
            "path": p.path or "/",
            "queryKeys": sorted(
                {
                    item.split("=", 1)[0]
                    for item in (p.query or "").split("&")
                    if item
                }
            ),
        }
    except Exception:
        return {"host": "", "path": "", "queryKeys": []}


def titulo_html(texto):
    if not texto:
        return ""
    m = re.search(r"<title[^>]*>(.*?)</title>", texto, flags=re.I | re.S)
    if not m:
        return ""
    return re.sub(r"\s+", " ", m.group(1)).strip()[:160]


def carregar_pfx():
    b64 = os.getenv("ESOCIAL_CERT_BASE64", "").strip()
    pfx_path = os.getenv("ESOCIAL_CERT_PFX_PATH", "").strip()
    senha = os.getenv("ESOCIAL_CERT_PASSWORD", "")

    if b64:
        b64 = re.sub(r"^data:.*?;base64,", "", b64, flags=re.I)
        b64 = re.sub(r"\s+", "", b64)
        try:
            dados = base64.b64decode(b64, validate=True)
        except Exception:
            falhar(
                "CERT_BASE64_INVALIDO",
                "ESOCIAL_CERT_BASE64 não pôde ser decodificado.",
            )
    elif pfx_path:
        caminho = Path(pfx_path)
        if not caminho.exists():
            falhar(
                "CERT_ARQUIVO_NAO_ENCONTRADO",
                "Arquivo PFX não encontrado.",
            )
        dados = caminho.read_bytes()
    else:
        falhar(
            "CERT_NAO_CONFIGURADO",
            "Defina ESOCIAL_CERT_BASE64 ou ESOCIAL_CERT_PFX_PATH.",
        )

    if not senha:
        falhar(
            "CERT_SENHA_NAO_CONFIGURADA",
            "ESOCIAL_CERT_PASSWORD não está configurado.",
        )

    try:
        chave, certificado, cadeia = load_key_and_certificates(
            dados,
            senha.encode("utf-8"),
        )
    except Exception:
        falhar(
            "CERT_PFX_INVALIDO",
            "Não foi possível abrir o PFX. Verifique o certificado e a senha.",
        )

    if chave is None or certificado is None:
        falhar(
            "CERT_SEM_CHAVE",
            "O PFX não contém chave privada e certificado utilizáveis.",
        )

    return chave, certificado, cadeia or []


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


def validar_url_certificado(url):
    try:
        p = urlparse(url)
    except Exception:
        falhar("URL_CERT_INVALIDA", "URL do certificado inválida.")

    if p.scheme.lower() != "https" or p.hostname != CERT_HOST:
        falhar(
            "URL_CERT_NAO_PERMITIDA",
            "A URL mTLS não pertence ao endpoint esperado do gov.br.",
        )

    qs = parse_qs(p.query)
    if not qs.get("authorization_id") or not qs.get("client_id"):
        falhar(
            "URL_CERT_SEM_PARAMETROS",
            "URL do certificado sem client_id/authorization_id.",
        )


def validar_authorize_url(url):
    try:
        p = urlparse(url)
    except Exception:
        falhar("AUTHORIZE_URL_INVALIDA", "URL OAuth original inválida.")

    if (
        p.scheme.lower() != "https"
        or p.hostname != SSO_HOST
        or not p.path.startswith("/authorize")
    ):
        falhar(
            "AUTHORIZE_URL_NAO_PERMITIDA",
            "A URL OAuth original não pertence ao /authorize do gov.br.",
        )

    qs = parse_qs(p.query)

    if (qs.get("client_id") or [""])[0] != "login.esocial.gov.br":
        falhar(
            "AUTHORIZE_CLIENT_INVALIDO",
            "A URL OAuth não pertence ao cliente do eSocial.",
        )

    if not qs.get("state") or not qs.get("redirect_uri"):
        falhar(
            "AUTHORIZE_SEM_ESTADO",
            "A URL OAuth original está sem state/redirect_uri.",
        )


def headers_padrao(user_agent):
    return {
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": user_agent,
    }


def criar_cookie(item):
    nome = str(item.get("name") or "")
    valor = str(item.get("value") or "")
    dominio = str(item.get("domain") or "")
    caminho = str(item.get("path") or "/")

    if not nome or not dominio:
        return None

    expires = item.get("expires")
    try:
        exp = float(expires)
        expires = int(exp) if exp > 0 else None
    except Exception:
        expires = None

    return requests.cookies.create_cookie(
        name=nome,
        value=valor,
        domain=dominio,
        path=caminho,
        secure=bool(item.get("secure", False)),
        expires=expires,
    )


def adicionar_cookies(sessao, cookies):
    for item in cookies or []:
        try:
            c = criar_cookie(item)
            if c is not None:
                sessao.cookies.set_cookie(c)
        except Exception:
            continue


def copiar_cookies(origem, destino):
    for c in origem.cookies:
        try:
            destino.cookies.set_cookie(c)
        except Exception:
            continue


def exportar_cookies(sessao):
    saida = []
    for c in sessao.cookies:
        item = {
            "name": c.name,
            "value": c.value,
            "domain": c.domain,
            "path": c.path or "/",
            "secure": bool(c.secure),
            "httpOnly": False,
        }
        if c.expires and c.expires > 0:
            item["expires"] = int(c.expires)
        saida.append(item)
    return saida


def remover_cookies_sso(sessao):
    remover = []

    for c in sessao.cookies:
        d = str(c.domain or "").lstrip(".").lower()
        if (
            d == SSO_HOST
            or d.endswith("." + SSO_HOST)
            or d == CERT_HOST
            or d.endswith("." + CERT_HOST)
        ):
            remover.append((c.domain, c.path, c.name))

    for domain, path, name in remover:
        try:
            sessao.cookies.clear(domain=domain, path=path, name=name)
        except Exception:
            pass


def request_get(sessao, url, timeout, cert=None, referer=None):
    headers = {}
    if referer and str(referer).startswith("https://"):
        headers["Referer"] = referer

    try:
        return sessao.get(
            url,
            timeout=timeout,
            allow_redirects=False,
            cert=cert,
            headers=headers,
        )
    except requests.exceptions.SSLError:
        falhar(
            "ERRO_SSL_MTLS",
            "Falha SSL/TLS durante a autenticação pelo certificado digital.",
            resumo_url(url),
        )
    except requests.exceptions.Timeout:
        falhar(
            "TIMEOUT_HTTP",
            "Tempo excedido durante a autenticação no gov.br.",
            resumo_url(url),
        )
    except requests.exceptions.RequestException as exc:
        falhar(
            "ERRO_HTTP_GOVBR",
            "Falha HTTP durante a autenticação no gov.br.",
            {
                **resumo_url(url),
                "tipo": exc.__class__.__name__,
            },
        )


def seguir_redirects(sessao, resposta, timeout, cert_tuple, redirects):
    atual = resposta

    for _ in range(MAX_REDIRECTS):
        location = atual.headers.get("Location")

        if atual.status_code not in REDIRECT_CODES or not location:
            return atual

        destino = urljoin(atual.url, location)
        host = (urlparse(destino).hostname or "").lower()
        usar_cert = host == CERT_HOST

        redirects.append({
            "status": atual.status_code,
            "from": resumo_url(atual.url),
            "to": resumo_url(destino),
        })

        atual = request_get(
            sessao,
            destino,
            timeout,
            cert=cert_tuple if usar_cert else None,
            referer=atual.url,
        )

    falhar(
        "REDIRECT_LIMITE",
        "Quantidade máxima de redirecionamentos excedida.",
    )


def main():
    try:
        entrada = json.loads(sys.stdin.read() or "{}")
    except Exception:
        falhar(
            "ENTRADA_JSON_INVALIDA",
            "Entrada JSON do bridge é inválida.",
        )

    url_cert = str(entrada.get("url") or "").strip()
    authorize_url = str(entrada.get("authorizeUrl") or "").strip()

    validar_url_certificado(url_cert)
    validar_authorize_url(authorize_url)

    try:
        timeout = int(entrada.get("timeoutSeconds") or 15)
    except Exception:
        timeout = 15

    timeout = max(5, min(timeout, 30))

    user_agent = (
        os.getenv("ESOCIAL_CERT_BRIDGE_USER_AGENT", "").strip()
        or DEFAULT_USER_AGENT
    )

    chave, certificado, cadeia = carregar_pfx()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems(
            chave, certificado, cadeia, pasta
        )
        cert_tuple = (cert_path, key_path)

        # ------------------------------------------------------
        # Sessão principal: preserva cookies do eSocial.
        # ------------------------------------------------------
        principal = requests.Session()
        principal.headers.update(headers_padrao(user_agent))
        adicionar_cookies(principal, entrada.get("cookies") or [])

        # Cookies SSO antigos podem representar uma sessão ainda não autenticada.
        # Mantemos eSocial, limpamos SSO/certificado antes de mesclar a nova sessão.
        remover_cookies_sso(principal)

        # ------------------------------------------------------
        # Sessão limpa apenas para handshake mTLS.
        # ------------------------------------------------------
        cert_session = requests.Session()
        cert_session.headers.update(headers_padrao(user_agent))

        resposta_cert = request_get(
            cert_session,
            url_cert,
            timeout,
            cert=cert_tuple,
            referer=None,
        )

        initial_status = resposta_cert.status_code
        initial_location = resposta_cert.headers.get("Location")

        if (
            resposta_cert.status_code not in REDIRECT_CODES
            or not initial_location
        ):
            try:
                corpo = resposta_cert.text
            except Exception:
                corpo = ""

            falhar(
                "CERTIFICADO_SEM_REDIRECT",
                (
                    "O endpoint de certificado respondeu, mas não concluiu "
                    "o redirecionamento esperado após o mTLS."
                ),
                {
                    "status": resposta_cert.status_code,
                    "final": resumo_url(resposta_cert.url),
                    "title": titulo_html(corpo),
                },
            )

        # Os cookies produzidos pelo certificado representam a nova sessão gov.br.
        copiar_cookies(cert_session, principal)

        # ------------------------------------------------------
        # Passo essencial V3:
        # reentrar no /authorize ORIGINAL com a sessão gov.br já autenticada.
        # O provedor deve então emitir o retorno OAuth para LoginGovBR.aspx.
        # ------------------------------------------------------
        authorize_resposta = request_get(
            principal,
            authorize_url,
            timeout,
            cert=None,
            referer=url_cert,
        )

        authorize_status = authorize_resposta.status_code
        authorize_location = authorize_resposta.headers.get("Location")

        if (
            authorize_resposta.status_code == 200
            and not authorize_location
        ):
            try:
                corpo = authorize_resposta.text
            except Exception:
                corpo = ""

            falhar(
                "SSO_NAO_RECONHECEU_CERTIFICADO",
                (
                    "O certificado foi aceito por mTLS, mas ao retomar o "
                    "/authorize o gov.br ainda apresentou uma página em vez "
                    "de concluir o OAuth."
                ),
                {
                    "status": authorize_resposta.status_code,
                    "final": resumo_url(authorize_resposta.url),
                    "title": titulo_html(corpo),
                },
            )

        redirects = []
        final = seguir_redirects(
            principal,
            authorize_resposta,
            timeout,
            cert_tuple,
            redirects,
        )

        try:
            corpo_final = final.text
        except Exception:
            corpo_final = ""

        final_resumo = resumo_url(final.url)

        resposta_json({
            "ok": True,
            "strategy": "mtls-then-replay-original-authorize",
            "initialStatus": initial_status,
            "initialLocation": resumo_url(
                urljoin(resposta_cert.url, initial_location)
            ),
            "authorizeStatus": authorize_status,
            "authorizeLocation": resumo_url(
                urljoin(authorize_resposta.url, authorize_location)
            ) if authorize_location else None,
            "finalStatus": final.status_code,
            "finalUrl": final.url,
            "final": final_resumo,
            "title": titulo_html(corpo_final),
            "redirects": redirects,
            "cookies": exportar_cookies(principal),
        })


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        falhar(
            "ERRO_INTERNO_BRIDGE",
            "Erro interno no bridge Python.",
            {"tipo": exc.__class__.__name__},
        )
