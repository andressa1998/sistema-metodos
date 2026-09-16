#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bridge de autenticação mTLS do gov.br/eSocial.

Entrada: JSON via stdin, enviado pelo backend Node.
Saída: um único JSON via stdout.

O PFX nunca é recebido pela entrada. Ele é lido somente das variáveis de
ambiente ESOCIAL_CERT_BASE64 / ESOCIAL_CERT_PASSWORD (produção) ou,
opcionalmente para teste local, ESOCIAL_CERT_PFX_PATH.
"""

import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates


CERT_HOST = "certificado.sso.acesso.gov.br"
REDIRECT_CODES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 12


def resposta_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def falhar(code, message, details=None):
    resposta_json({
        "ok": False,
        "code": code,
        "error": message,
        "details": details or None,
    })
    raise SystemExit(0)


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
            falhar("CERT_ARQUIVO_NAO_ENCONTRADO", "Arquivo PFX não encontrado.")
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


def escrever_pems_temporarios(chave, certificado, cadeia, pasta):
    key_path = Path(pasta) / "client-key.pem"
    cert_path = Path(pasta) / "client-cert.pem"

    key_path.write_bytes(
        chave.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

    conteudo_cert = certificado.public_bytes(serialization.Encoding.PEM)
    for cert_cadeia in cadeia:
        conteudo_cert += cert_cadeia.public_bytes(serialization.Encoding.PEM)

    cert_path.write_bytes(conteudo_cert)

    try:
        os.chmod(key_path, 0o600)
        os.chmod(cert_path, 0o600)
    except Exception:
        pass

    return str(cert_path), str(key_path)


def validar_url_certificado(url):
    try:
        parsed = urlparse(url)
    except Exception:
        falhar("URL_CERT_INVALIDA", "URL do certificado inválida.")

    if parsed.scheme.lower() != "https" or parsed.hostname != CERT_HOST:
        falhar(
            "URL_CERT_NAO_PERMITIDA",
            "A URL mTLS não pertence ao endpoint esperado do gov.br.",
        )

    if not parsed.path.startswith("/login"):
        falhar(
            "URL_CERT_CAMINHO_INVALIDO",
            "O caminho da URL mTLS não corresponde ao login por certificado.",
        )


def adicionar_cookies(sessao, cookies):
    for item in cookies or []:
        try:
            nome = str(item.get("name") or "")
            valor = str(item.get("value") or "")
            dominio = str(item.get("domain") or "")
            caminho = str(item.get("path") or "/")

            if not nome or not dominio:
                continue

            expires = item.get("expires")
            try:
                expires = int(float(expires)) if float(expires) > 0 else None
            except Exception:
                expires = None

            cookie = requests.cookies.create_cookie(
                name=nome,
                value=valor,
                domain=dominio,
                path=caminho,
                secure=bool(item.get("secure", False)),
                expires=expires,
            )
            sessao.cookies.set_cookie(cookie)
        except Exception:
            # Cookie individual inválido não deve derrubar todo o fluxo.
            continue


def http_only_cookie(cookie):
    rest = getattr(cookie, "_rest", {}) or {}
    chaves = {str(k).lower() for k in rest.keys()}
    return "httponly" in chaves


def exportar_cookies(sessao):
    saida = []
    for cookie in sessao.cookies:
        item = {
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path or "/",
            "secure": bool(cookie.secure),
            "httpOnly": http_only_cookie(cookie),
        }
        if cookie.expires and cookie.expires > 0:
            item["expires"] = int(cookie.expires)
        saida.append(item)
    return saida


def resumo_url(url):
    try:
        parsed = urlparse(url)
        return {
            "host": parsed.hostname or "",
            "path": parsed.path or "/",
            "queryKeys": sorted(
                {
                    parte.split("=", 1)[0]
                    for parte in (parsed.query or "").split("&")
                    if parte
                }
            ),
        }
    except Exception:
        return {"host": "", "path": "", "queryKeys": []}


def titulo_html(texto):
    if not texto:
        return ""
    match = re.search(r"<title[^>]*>(.*?)</title>", texto, flags=re.I | re.S)
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()[:200]


def main():
    try:
        bruto = sys.stdin.read()
        entrada = json.loads(bruto or "{}")
    except Exception:
        falhar("ENTRADA_JSON_INVALIDA", "Entrada JSON do bridge é inválida.")

    url_certificado = str(entrada.get("url") or "").strip()
    validar_url_certificado(url_certificado)

    try:
        timeout = int(entrada.get("timeoutSeconds") or 15)
    except Exception:
        timeout = 15
    timeout = max(5, min(timeout, 30))

    user_agent = str(entrada.get("userAgent") or "").strip()
    referer_inicial = str(entrada.get("currentUrl") or "").strip()

    chave, certificado, cadeia = carregar_pfx()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems_temporarios(
            chave,
            certificado,
            cadeia,
            pasta,
        )
        cert_tuple = (cert_path, key_path)

        sessao = requests.Session()
        sessao.headers.update({
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        })
        if user_agent:
            sessao.headers["User-Agent"] = user_agent

        adicionar_cookies(sessao, entrada.get("cookies") or [])

        redirects = []
        url_atual = url_certificado
        referer = referer_inicial or None
        resposta = None
        status_inicial = None

        for salto in range(MAX_REDIRECTS + 1):
            parsed = urlparse(url_atual)
            if parsed.scheme.lower() != "https":
                falhar(
                    "REDIRECT_NAO_HTTPS",
                    "O gov.br retornou um redirecionamento não HTTPS.",
                    resumo_url(url_atual),
                )

            headers = {}
            if referer and referer.startswith("https://"):
                headers["Referer"] = referer

            usar_certificado = parsed.hostname == CERT_HOST

            try:
                resposta = sessao.get(
                    url_atual,
                    cert=cert_tuple if usar_certificado else None,
                    timeout=timeout,
                    allow_redirects=False,
                    headers=headers,
                )
            except requests.exceptions.SSLError:
                falhar(
                    "ERRO_SSL_MTLS",
                    "Falha SSL/TLS durante a autenticação pelo certificado digital.",
                    resumo_url(url_atual),
                )
            except requests.exceptions.Timeout:
                falhar(
                    "TIMEOUT_HTTP",
                    "Tempo excedido durante a autenticação no gov.br.",
                    resumo_url(url_atual),
                )
            except requests.exceptions.RequestException as exc:
                falhar(
                    "ERRO_HTTP_GOVBR",
                    "Falha HTTP durante a autenticação no gov.br.",
                    {
                        **resumo_url(url_atual),
                        "tipo": exc.__class__.__name__,
                    },
                )

            if status_inicial is None:
                status_inicial = resposta.status_code

            location = resposta.headers.get("Location")
            if resposta.status_code not in REDIRECT_CODES or not location:
                break

            destino = urljoin(resposta.url, location)
            redirects.append({
                "status": resposta.status_code,
                "from": resumo_url(resposta.url),
                "to": resumo_url(destino),
            })

            referer = resposta.url
            url_atual = destino
        else:
            falhar(
                "REDIRECT_LIMITE",
                "Quantidade máxima de redirecionamentos excedida.",
            )

        if resposta is None:
            falhar("SEM_RESPOSTA", "O gov.br não retornou resposta.")

        try:
            corpo = resposta.text
        except Exception:
            corpo = ""

        final_url = resposta.url
        final_resumo = resumo_url(final_url)

        resposta_json({
            "ok": True,
            "initialStatus": status_inicial,
            "finalStatus": resposta.status_code,
            "finalUrl": final_url,
            "final": final_resumo,
            "title": titulo_html(corpo),
            "redirects": redirects,
            "cookies": exportar_cookies(sessao),
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
