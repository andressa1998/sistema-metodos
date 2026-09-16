#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Bridge Python V5 - proxy mTLS para uma requisição REAL interceptada do Chromium.

O Node/Playwright deixa o gov.br executar o clique real em
"Seu certificado digital", intercepta a requisição destinada a
certificado.sso.acesso.gov.br e envia ao Python:
- URL exata
- método HTTP
- headers reais do navegador (incluindo Cookie/Referer/User-Agent)
- body, quando existir

O Python executa essa MESMA requisição usando o PFX A1 e devolve:
- status HTTP
- Location
- cookies recebidos

O BrowserContext recebe esses cookies e o Playwright cumpre a resposta
interceptada. Assim o restante do fluxo continua no próprio navegador.
"""

import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization.pkcs12 import (
    load_key_and_certificates,
)

CERT_HOST = "certificado.sso.acesso.gov.br"
METODOS_PERMITIDOS = {"GET", "POST"}

HEADERS_BLOQUEADOS = {
    "host",
    "content-length",
    "connection",
    "proxy-connection",
    "transfer-encoding",
    "upgrade",
}


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


def validar_url(url):
    try:
        p = urlparse(url)
    except Exception:
        falhar("URL_INVALIDA", "URL mTLS inválida.")

    if p.scheme.lower() != "https" or p.hostname != CERT_HOST:
        falhar(
            "URL_NAO_PERMITIDA",
            "A requisição interceptada não pertence ao domínio de certificado do gov.br.",
        )


def exportar_cookies(response):
    saida = []

    for cookie in response.cookies:
        item = {
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain or ".sso.acesso.gov.br",
            "path": cookie.path or "/",
            "secure": bool(cookie.secure),
            "httpOnly": False,
        }

        if cookie.expires and cookie.expires > 0:
            item["expires"] = int(cookie.expires)

        saida.append(item)

    return saida


def limpar_headers(headers):
    resultado = {}

    for chave, valor in (headers or {}).items():
        nome = str(chave or "").strip().lower()

        if (
            not nome
            or nome in HEADERS_BLOQUEADOS
            or nome.startswith(":")
        ):
            continue

        # Cookie é propositalmente preservado: é justamente o que correlaciona
        # a autorização atual do gov.br com a requisição de certificado.
        resultado[nome] = str(valor or "")

    return resultado


def main():
    try:
        entrada = json.loads(sys.stdin.read() or "{}")
    except Exception:
        falhar(
            "ENTRADA_JSON_INVALIDA",
            "Entrada JSON do bridge é inválida.",
        )

    url = str(entrada.get("url") or "").strip()
    metodo = str(entrada.get("method") or "GET").upper().strip()
    headers = limpar_headers(entrada.get("headers") or {})
    post_data = entrada.get("postData")

    validar_url(url)

    if metodo not in METODOS_PERMITIDOS:
        falhar(
            "METODO_NAO_PERMITIDO",
            f"Método HTTP não permitido no bridge: {metodo}.",
        )

    try:
        timeout = int(entrada.get("timeoutSeconds") or 20)
    except Exception:
        timeout = 20

    timeout = max(5, min(timeout, 35))

    chave, certificado, cadeia = carregar_pfx()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems(
            chave,
            certificado,
            cadeia,
            pasta,
        )

        try:
            resposta = requests.request(
                method=metodo,
                url=url,
                headers=headers,
                data=post_data if metodo == "POST" else None,
                cert=(cert_path, key_path),
                timeout=timeout,
                allow_redirects=False,
            )

        except requests.exceptions.SSLError:
            falhar(
                "ERRO_SSL_MTLS",
                "Falha SSL/TLS durante a autenticação pelo certificado digital.",
                resumo_url(url),
            )

        except requests.exceptions.Timeout:
            falhar(
                "TIMEOUT_MTLS",
                "Tempo excedido durante a autenticação pelo certificado digital.",
                resumo_url(url),
            )

        except requests.exceptions.RequestException as exc:
            falhar(
                "ERRO_HTTP_MTLS",
                "Falha HTTP durante a autenticação pelo certificado digital.",
                {
                    **resumo_url(url),
                    "tipo": exc.__class__.__name__,
                },
            )

        location = resposta.headers.get("Location")

        content_type = resposta.headers.get("Content-Type", "")

        # Para o fluxo esperado, normalmente temos 302.
        # Se vier 200, devolvemos diagnóstico; o Node não tratará isso como login.
        resposta_json({
            "ok": True,
            "strategy": "intercepted-browser-request-mtls",
            "status": resposta.status_code,
            "location": location,
            "locationSummary": resumo_url(location) if location else None,
            "contentType": content_type[:120],
            "cookies": exportar_cookies(resposta),
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
