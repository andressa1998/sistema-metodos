#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bridge Python de autenticação mTLS do gov.br/eSocial.

Estratégia V2:
1. Recebe do Node os cookies da sessão Playwright.
2. Mantém esses cookies em uma sessão principal (para preservar ASP.NET_SessionId
   e ESOCIAL_NONCE_GOVBR do eSocial).
3. Faz a requisição mTLS ao certificado.sso.acesso.gov.br em uma sessão LIMPA,
   sem reaproveitar cookies antigos do SSO/gov.br.
4. Mescla os novos cookies gerados pelo certificado na sessão principal.
5. Segue o redirect usando a sessão principal, preservando a sessão original
   do eSocial.
6. Devolve ao Node a URL final e todos os cookies atualizados.

O PFX nunca vem pela entrada JSON. Em produção ele é lido de:
- ESOCIAL_CERT_BASE64
- ESOCIAL_CERT_PASSWORD

Para teste local também é aceito:
- ESOCIAL_CERT_PFX_PATH
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
LOGIN_ESOCIAL_HOST = "login.esocial.gov.br"
SSO_HOST = "sso.acesso.gov.br"
REDIRECT_CODES = {301, 302, 303, 307, 308}
MAX_REDIRECTS = 12

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/153.0.0.0 Safari/537.36"
)


def resposta_json(payload):
    sys.stdout.write(
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )
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


def carregar_pfx():
    b64 = os.getenv("ESOCIAL_CERT_BASE64", "").strip()
    pfx_path = os.getenv("ESOCIAL_CERT_PFX_PATH", "").strip()
    senha = os.getenv("ESOCIAL_CERT_PASSWORD", "")

    if b64:
        b64 = re.sub(
            r"^data:.*?;base64,",
            "",
            b64,
            flags=re.I,
        )
        b64 = re.sub(r"\s+", "", b64)

        try:
            dados = base64.b64decode(
                b64,
                validate=True,
            )
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
        chave, certificado, cadeia = (
            load_key_and_certificates(
                dados,
                senha.encode("utf-8"),
            )
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

    return (
        chave,
        certificado,
        cadeia or [],
    )


def escrever_pems_temporarios(
    chave,
    certificado,
    cadeia,
    pasta,
):
    key_path = (
        Path(pasta) /
        "client-key.pem"
    )

    cert_path = (
        Path(pasta) /
        "client-cert.pem"
    )

    key_path.write_bytes(
        chave.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

    conteudo_cert = (
        certificado.public_bytes(
            serialization.Encoding.PEM
        )
    )

    for cert_cadeia in cadeia:
        conteudo_cert += (
            cert_cadeia.public_bytes(
                serialization.Encoding.PEM
            )
        )

    cert_path.write_bytes(
        conteudo_cert
    )

    try:
        os.chmod(
            key_path,
            0o600,
        )
        os.chmod(
            cert_path,
            0o600,
        )
    except Exception:
        pass

    return (
        str(cert_path),
        str(key_path),
    )


def validar_url_certificado(url):
    try:
        parsed = urlparse(url)
    except Exception:
        falhar(
            "URL_CERT_INVALIDA",
            "URL do certificado inválida.",
        )

    if (
        parsed.scheme.lower() != "https" or
        parsed.hostname != CERT_HOST
    ):
        falhar(
            "URL_CERT_NAO_PERMITIDA",
            "A URL mTLS não pertence ao endpoint esperado do gov.br.",
        )

    if not parsed.path.startswith(
        "/login"
    ):
        falhar(
            "URL_CERT_CAMINHO_INVALIDO",
            "O caminho da URL mTLS não corresponde ao login por certificado.",
        )


def criar_cookie_requests(item):
    nome = str(
        item.get("name") or ""
    )

    valor = str(
        item.get("value") or ""
    )

    dominio = str(
        item.get("domain") or ""
    )

    caminho = str(
        item.get("path") or "/"
    )

    if not nome or not dominio:
        return None

    expires = item.get("expires")

    try:
        expires_num = float(expires)
        expires = (
            int(expires_num)
            if expires_num > 0
            else None
        )
    except Exception:
        expires = None

    return (
        requests.cookies.create_cookie(
            name=nome,
            value=valor,
            domain=dominio,
            path=caminho,
            secure=bool(
                item.get(
                    "secure",
                    False,
                )
            ),
            expires=expires,
        )
    )


def adicionar_cookies(
    sessao,
    cookies,
):
    for item in cookies or []:
        try:
            cookie = (
                criar_cookie_requests(
                    item
                )
            )

            if cookie is not None:
                sessao.cookies.set_cookie(
                    cookie
                )

        except Exception:
            continue


def copiar_cookiejar(
    origem,
    destino,
):
    for cookie in origem.cookies:
        try:
            destino.cookies.set_cookie(
                cookie
            )
        except Exception:
            continue


def remover_cookies_sso_antigos(
    sessao,
):
    """
    Remove da sessão principal somente cookies relacionados ao SSO/certificado.
    Os cookies do login.esocial.gov.br são preservados.
    """
    remover = []

    for cookie in sessao.cookies:
        dominio = (
            str(
                cookie.domain or ""
            )
            .lstrip(".")
            .lower()
        )

        if (
            dominio == SSO_HOST or
            dominio.endswith(
                "." + SSO_HOST
            ) or
            dominio == CERT_HOST or
            dominio.endswith(
                "." + CERT_HOST
            )
        ):
            remover.append(
                (
                    cookie.domain,
                    cookie.path,
                    cookie.name,
                )
            )

    for (
        domain,
        path,
        name,
    ) in remover:
        try:
            sessao.cookies.clear(
                domain=domain,
                path=path,
                name=name,
            )
        except Exception:
            pass


def http_only_cookie(cookie):
    rest = (
        getattr(
            cookie,
            "_rest",
            {},
        )
        or {}
    )

    chaves = {
        str(k).lower()
        for k in rest.keys()
    }

    return (
        "httponly"
        in chaves
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
            "httpOnly": http_only_cookie(
                cookie
            ),
        }

        if (
            cookie.expires and
            cookie.expires > 0
        ):
            item["expires"] = int(
                cookie.expires
            )

        saida.append(
            item
        )

    return saida


def resumo_url(url):
    try:
        parsed = urlparse(url)

        return {
            "host": parsed.hostname or "",
            "path": parsed.path or "/",
            "queryKeys": sorted(
                {
                    parte.split(
                        "=",
                        1,
                    )[0]
                    for parte in (
                        parsed.query or ""
                    ).split("&")
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


def titulo_html(texto):
    if not texto:
        return ""

    match = re.search(
        r"<title[^>]*>(.*?)</title>",
        texto,
        flags=re.I | re.S,
    )

    if not match:
        return ""

    return (
        re.sub(
            r"\s+",
            " ",
            match.group(1),
        )
        .strip()[:200]
    )


def headers_padrao(
    user_agent,
):
    return {
        "Accept": (
            "text/html,"
            "application/xhtml+xml,"
            "application/xml;q=0.9,"
            "image/avif,"
            "image/webp,"
            "*/*;q=0.8"
        ),
        "Accept-Language":
            "pt-BR,pt;q=0.9,en;q=0.8",
        "Cache-Control":
            "no-cache",
        "Pragma":
            "no-cache",
        "User-Agent":
            user_agent,
    }


def requisicao_sem_redirect(
    sessao,
    url,
    timeout,
    cert=None,
    referer=None,
):
    headers = {}

    if (
        referer and
        referer.startswith(
            "https://"
        )
    ):
        headers["Referer"] = (
            referer
        )

    try:
        return sessao.get(
            url,
            cert=cert,
            timeout=timeout,
            allow_redirects=False,
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
                "tipo":
                    exc.__class__.__name__,
            },
        )


def main():
    try:
        bruto = sys.stdin.read()

        entrada = json.loads(
            bruto or "{}"
        )

    except Exception:
        falhar(
            "ENTRADA_JSON_INVALIDA",
            "Entrada JSON do bridge é inválida.",
        )

    url_certificado = str(
        entrada.get("url") or ""
    ).strip()

    validar_url_certificado(
        url_certificado
    )

    try:
        timeout = int(
            entrada.get(
                "timeoutSeconds"
            )
            or 15
        )
    except Exception:
        timeout = 15

    timeout = max(
        5,
        min(
            timeout,
            30,
        ),
    )

    # Não usamos automaticamente o UA HeadlessChrome do Playwright
    # na etapa mTLS. Isso replica o teste local que funcionou.
    user_agent = (
        os.getenv(
            "ESOCIAL_CERT_BRIDGE_USER_AGENT",
            ""
        ).strip()
        or DEFAULT_USER_AGENT
    )

    referer_inicial = str(
        entrada.get(
            "currentUrl"
        )
        or ""
    ).strip()

    chave, certificado, cadeia = (
        carregar_pfx()
    )

    with tempfile.TemporaryDirectory(
        prefix="esocial-cert-"
    ) as pasta:
        cert_path, key_path = (
            escrever_pems_temporarios(
                chave,
                certificado,
                cadeia,
                pasta,
            )
        )

        cert_tuple = (
            cert_path,
            key_path,
        )

        # ======================================================
        # SESSÃO PRINCIPAL
        # Preserva a sessão original do eSocial enviada pelo browser.
        # ======================================================

        sessao_principal = (
            requests.Session()
        )

        sessao_principal.headers.update(
            headers_padrao(
                user_agent
            )
        )

        adicionar_cookies(
            sessao_principal,
            entrada.get(
                "cookies"
            )
            or [],
        )

        # Removemos cookies SSO/cert antigos.
        # Os cookies ASP.NET_SessionId e ESOCIAL_NONCE_GOVBR
        # do login.esocial.gov.br continuam intactos.
        remover_cookies_sso_antigos(
            sessao_principal
        )

        # ======================================================
        # SESSÃO LIMPA DO CERTIFICADO
        # Replica o teste local que retornou 302 com o A1.
        # ======================================================

        sessao_cert = (
            requests.Session()
        )

        sessao_cert.headers.update(
            headers_padrao(
                user_agent
            )
        )

        resposta_cert = (
            requisicao_sem_redirect(
                sessao_cert,
                url_certificado,
                timeout,
                cert=cert_tuple,
                referer=None,
            )
        )

        initial_status = (
            resposta_cert.status_code
        )

        initial_location = (
            resposta_cert.headers.get(
                "Location"
            )
        )

        try:
            corpo_inicial = (
                resposta_cert.text
            )
        except Exception:
            corpo_inicial = ""

        # Se o endpoint do certificado não redirecionar,
        # não declaramos sucesso só porque retornou HTTP 200.
        if (
            resposta_cert.status_code
            not in REDIRECT_CODES
            or not initial_location
        ):
            falhar(
                "CERTIFICADO_SEM_REDIRECT",
                (
                    "O endpoint de certificado respondeu, "
                    "mas não concluiu o redirecionamento esperado."
                ),
                {
                    "status":
                        resposta_cert.status_code,
                    "final":
                        resumo_url(
                            resposta_cert.url
                        ),
                    "title":
                        titulo_html(
                            corpo_inicial
                        ),
                },
            )

        # Os cookies novos obtidos no handshake mTLS
        # substituem quaisquer cookies SSO removidos anteriormente.
        copiar_cookiejar(
            sessao_cert,
            sessao_principal,
        )

        redirects = []

        destino = urljoin(
            resposta_cert.url,
            initial_location,
        )

        redirects.append({
            "status":
                resposta_cert.status_code,
            "from":
                resumo_url(
                    resposta_cert.url
                ),
            "to":
                resumo_url(
                    destino
                ),
        })

        referer = (
            resposta_cert.url
        )

        resposta = (
            resposta_cert
        )

        url_atual = (
            destino
        )

        # ======================================================
        # SEGUIR O RETORNO NA SESSÃO PRINCIPAL
        # Aqui entram em ação os cookies originais do eSocial.
        # ======================================================

        for _ in range(
            MAX_REDIRECTS
        ):
            parsed = urlparse(
                url_atual
            )

            if (
                parsed.scheme.lower()
                != "https"
            ):
                falhar(
                    "REDIRECT_NAO_HTTPS",
                    "O gov.br retornou um redirecionamento não HTTPS.",
                    resumo_url(
                        url_atual
                    ),
                )

            usar_certificado = (
                parsed.hostname
                == CERT_HOST
            )

            resposta = (
                requisicao_sem_redirect(
                    sessao_principal,
                    url_atual,
                    timeout,
                    cert=(
                        cert_tuple
                        if usar_certificado
                        else None
                    ),
                    referer=referer,
                )
            )

            location = (
                resposta.headers.get(
                    "Location"
                )
            )

            if (
                resposta.status_code
                not in REDIRECT_CODES
                or not location
            ):
                break

            proximo = urljoin(
                resposta.url,
                location,
            )

            redirects.append({
                "status":
                    resposta.status_code,
                "from":
                    resumo_url(
                        resposta.url
                    ),
                "to":
                    resumo_url(
                        proximo
                    ),
            })

            referer = (
                resposta.url
            )

            url_atual = (
                proximo
            )

        else:
            falhar(
                "REDIRECT_LIMITE",
                "Quantidade máxima de redirecionamentos excedida.",
            )

        if resposta is None:
            falhar(
                "SEM_RESPOSTA",
                "O gov.br não retornou resposta.",
            )

        try:
            corpo_final = (
                resposta.text
            )
        except Exception:
            corpo_final = ""

        final_url = (
            resposta.url
        )

        final_resumo = resumo_url(
            final_url
        )

        resposta_json({
            "ok": True,
            "strategy":
                "isolated-mtls-preserve-esocial-session",
            "initialStatus":
                initial_status,
            "initialLocation":
                resumo_url(
                    urljoin(
                        url_certificado,
                        initial_location,
                    )
                ),
            "finalStatus":
                resposta.status_code,
            "finalUrl":
                final_url,
            "final":
                final_resumo,
            "title":
                titulo_html(
                    corpo_final
                ),
            "redirects":
                redirects,
            "cookies":
                exportar_cookies(
                    sessao_principal
                ),
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
            {
                "tipo":
                    exc.__class__.__name__
            },
        )
