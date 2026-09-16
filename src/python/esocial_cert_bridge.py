#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Bridge Python V8 — reproduz o SUBMIT real do formulário gov.br com A1/mTLS.

O navegador não chega a emitir uma requisição HTTP quando o servidor pede o
certificado: o Chromium abre primeiro o seletor nativo de certificado. Em modo
headless no Render, esse seletor não pode ser operado.

Por isso o Node extrai do DOM:
- formAction real do botão "Seu certificado digital"
- método do formulário
- body application/x-www-form-urlencoded, incluindo operation=login-certificate
- cookies atuais do BrowserContext
- Referer/User-Agent

O Python executa exatamente esse submit com o PFX A1 e NÃO segue redirects.
A resposta (normalmente 302) e os cookies retornam ao Node, que devolve o fluxo
ao Chromium pela URL Location.

Segredos:
- produção: ESOCIAL_CERT_BASE64 + ESOCIAL_CERT_PASSWORD
- teste local opcional: ESOCIAL_CERT_PFX_PATH
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
from cryptography.hazmat.primitives.serialization.pkcs12 import (
    load_key_and_certificates,
)

CERT_HOST = "certificado.sso.acesso.gov.br"
METODOS = {"GET", "POST"}
REDIRECTS = {301, 302, 303, 307, 308}

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/153.0.0.0 Safari/537.36"
)


def enviar_json(payload):
    sys.stdout.write(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )
    sys.stdout.flush()


def falhar(code, message, details=None):
    enviar_json({
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
        falhar("URL_INVALIDA", "URL do certificado inválida.")

    if (
        p.scheme.lower() != "https"
        or p.hostname != CERT_HOST
        or not p.path.startswith("/login")
    ):
        falhar(
            "URL_NAO_PERMITIDA",
            "A URL não pertence ao endpoint esperado de certificado do gov.br.",
        )


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


def carregar_cookies(sessao, cookies):
    for item in cookies or []:
        try:
            cookie = criar_cookie(item)
            if cookie is not None:
                sessao.cookies.set_cookie(cookie)
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


def main():
    try:
        entrada = json.loads(sys.stdin.read() or "{}")
    except Exception:
        falhar(
            "ENTRADA_JSON_INVALIDA",
            "Entrada JSON do bridge é inválida.",
        )

    url = str(entrada.get("url") or "").strip()
    metodo = str(entrada.get("method") or "POST").upper().strip()
    body = entrada.get("body")
    referer = str(entrada.get("referer") or "").strip()
    user_agent = str(entrada.get("userAgent") or "").strip() or DEFAULT_USER_AGENT
    cookies = entrada.get("cookies") or []

    validar_url(url)

    if metodo not in METODOS:
        falhar(
            "METODO_NAO_PERMITIDO",
            f"Método HTTP não permitido: {metodo}.",
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

        sessao = requests.Session()
        carregar_cookies(sessao, cookies)

        headers = {
            "User-Agent": user_agent,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Upgrade-Insecure-Requests": "1",
        }

        if referer.startswith("https://"):
            headers["Referer"] = referer
            try:
                rp = urlparse(referer)
                headers["Origin"] = f"{rp.scheme}://{rp.netloc}"
            except Exception:
                pass

        data = None

        if metodo == "POST":
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = str(body or "")

        try:
            resposta = sessao.request(
                method=metodo,
                url=url,
                headers=headers,
                data=data,
                cert=(cert_path, key_path),
                timeout=timeout,
                allow_redirects=False,
            )

        except requests.exceptions.SSLError:
            falhar(
                "ERRO_SSL_MTLS",
                "Falha SSL/TLS durante o submit do certificado digital.",
                resumo_url(url),
            )

        except requests.exceptions.Timeout:
            falhar(
                "TIMEOUT_MTLS",
                "Tempo excedido durante o submit do certificado digital.",
                resumo_url(url),
            )

        except requests.exceptions.RequestException as exc:
            falhar(
                "ERRO_HTTP_MTLS",
                "Falha HTTP durante o submit do certificado digital.",
                {
                    **resumo_url(url),
                    "tipo": exc.__class__.__name__,
                },
            )

        location = resposta.headers.get("Location")

        enviar_json({
            "ok": True,
            "strategy": "exact-form-submit-with-mtls",
            "status": resposta.status_code,
            "location": (
                urljoin(resposta.url, location)
                if location
                else None
            ),
            "locationSummary": (
                resumo_url(urljoin(resposta.url, location))
                if location
                else None
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
