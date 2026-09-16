#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Bridge Python V4 - somente a etapa mTLS do certificado gov.br.

IMPORTANTE:
- O OAuth (/authorize) volta a ser executado no Chromium/Playwright.
- O Python faz APENAS o handshake mTLS em uma sessão limpa.
- Isso reproduz o teste local que retornou HTTP 302.
- Os cookies criados pelo certificado são devolvidos ao Node para serem
  injetados no BrowserContext antes de o Chromium reabrir o /authorize original.

Segredos:
- ESOCIAL_CERT_BASE64 + ESOCIAL_CERT_PASSWORD no servidor.
- ESOCIAL_CERT_PFX_PATH é aceito somente para testes locais.
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
REDIRECT_CODES = {301, 302, 303, 307, 308}

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
                    parte.split("=", 1)[0]
                    for parte in (p.query or "").split("&")
                    if parte
                }
            ),
        }
    except Exception:
        return {
            "host": "",
            "path": "",
            "queryKeys": [],
        }


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
        falhar(
            "URL_CERT_INVALIDA",
            "URL do certificado inválida.",
        )

    if (
        p.scheme.lower() != "https"
        or p.hostname != CERT_HOST
        or not p.path.startswith("/login")
    ):
        falhar(
            "URL_CERT_NAO_PERMITIDA",
            "A URL mTLS não pertence ao endpoint esperado do gov.br.",
        )

    qs = parse_qs(p.query)

    if not qs.get("client_id") or not qs.get("authorization_id"):
        falhar(
            "URL_CERT_SEM_PARAMETROS",
            "URL do certificado sem client_id/authorization_id.",
        )


def exportar_cookies(sessao):
    saida = []

    for cookie in sessao.cookies:
        item = {
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path or "/",
            "secure": bool(cookie.secure),
            "httpOnly": False,
        }

        if cookie.expires and cookie.expires > 0:
            item["expires"] = int(cookie.expires)

        saida.append(item)

    return saida


def main():
    try:
        entrada = json.loads(sys.stdin.read() or "{}")
    except Exception:
        falhar(
            "ENTRADA_JSON_INVALIDA",
            "Entrada JSON do bridge é inválida.",
        )

    url_certificado = str(
        entrada.get("url") or ""
    ).strip()

    validar_url_certificado(url_certificado)

    try:
        timeout = int(
            entrada.get("timeoutSeconds") or 15
        )
    except Exception:
        timeout = 15

    timeout = max(5, min(timeout, 30))

    # Usa UA estável igual ao teste local que funcionou.
    user_agent = (
        os.getenv("ESOCIAL_CERT_BRIDGE_USER_AGENT", "").strip()
        or DEFAULT_USER_AGENT
    )

    chave, certificado, cadeia = carregar_pfx()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems(
            chave,
            certificado,
            cadeia,
            pasta,
        )

        sessao = requests.Session()

        sessao.headers.update({
            "User-Agent": user_agent,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        })

        try:
            resposta = sessao.get(
                url_certificado,
                cert=(cert_path, key_path),
                timeout=timeout,
                allow_redirects=False,
            )
        except requests.exceptions.SSLError:
            falhar(
                "ERRO_SSL_MTLS",
                "Falha SSL/TLS durante a autenticação pelo certificado digital.",
                resumo_url(url_certificado),
            )
        except requests.exceptions.Timeout:
            falhar(
                "TIMEOUT_MTLS",
                "Tempo excedido durante a autenticação por certificado.",
                resumo_url(url_certificado),
            )
        except requests.exceptions.RequestException as exc:
            falhar(
                "ERRO_HTTP_MTLS",
                "Falha HTTP durante a autenticação por certificado.",
                {
                    **resumo_url(url_certificado),
                    "tipo": exc.__class__.__name__,
                },
            )

        location = resposta.headers.get("Location")

        if (
            resposta.status_code not in REDIRECT_CODES
            or not location
        ):
            falhar(
                "CERTIFICADO_SEM_REDIRECT",
                (
                    "O certificado foi apresentado, mas o endpoint não devolveu "
                    "o redirecionamento esperado."
                ),
                {
                    "status": resposta.status_code,
                    "final": resumo_url(resposta.url),
                },
            )

        resposta_json({
            "ok": True,
            "strategy": "clean-mtls-browser-finishes-oauth",
            "initialStatus": resposta.status_code,
            "initialLocation": resumo_url(
                urljoin(resposta.url, location)
            ),
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
