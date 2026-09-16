#!/usr/bin/env python3
import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.serialization.pkcs12 import load_key_and_certificates


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
            "Defina ESOCIAL_CERT_BASE64 ou ESOCIAL_CERT_PFX_PATH no ambiente."
        )

    if not senha:
        raise RuntimeError("Defina ESOCIAL_CERT_PASSWORD no ambiente.")

    try:
        chave, certificado, cadeia = load_key_and_certificates(
            dados,
            senha.encode("utf-8"),
        )
    except Exception as e:
        raise RuntimeError(
            "Não foi possível abrir o PFX. Verifique o arquivo/base64 e a senha."
        ) from e

    if chave is None or certificado is None:
        raise RuntimeError("O PFX não contém chave privada e certificado utilizáveis.")

    return chave, certificado, cadeia or [], origem


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


def sanitizar_location(location):
    if not location:
        return None

    parsed = urlparse(location)
    if not parsed.scheme:
        return location[:300]

    # Não remove os parâmetros porque eles são úteis para o diagnóstico,
    # mas limita o tamanho para evitar logs gigantes.
    return location[:500]


def testar_mtls(url, timeout, seguir_redirects):
    chave, certificado, cadeia, origem = carregar_pfx()

    print("Python mTLS eSocial/gov.br")
    print(f"Fonte do certificado: {origem}")
    print(f"URL de teste: {url}")
    print(f"Seguir redirects: {seguir_redirects}")
    print()

    with tempfile.TemporaryDirectory(prefix="esocial-cert-") as pasta:
        cert_path, key_path = escrever_pems_temporarios(
            chave, certificado, cadeia, pasta
        )

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

        try:
            resposta = sessao.get(
                url,
                cert=(cert_path, key_path),
                timeout=timeout,
                allow_redirects=seguir_redirects,
            )
        except requests.exceptions.SSLError as e:
            print("RESULTADO: ERRO_SSL")
            print("A conexão TLS falhou ao apresentar o certificado.")
            print(str(e))
            return 2
        except requests.exceptions.RequestException as e:
            print("RESULTADO: ERRO_HTTP")
            print(str(e))
            return 3

        print("RESULTADO: CONEXAO_TLS_OK")
        print(f"HTTP status: {resposta.status_code}")
        print(f"URL final: {resposta.url}")

        location = resposta.headers.get("Location")
        if location:
            print(f"Location: {sanitizar_location(location)}")

        print(f"Cookies recebidos: {len(sessao.cookies)}")
        for cookie in sessao.cookies:
            print(f"  - {cookie.name}@{cookie.domain}")

        content_type = resposta.headers.get("Content-Type")
        if content_type:
            print(f"Content-Type: {content_type}")

        print()
        print(
            "Observação: receber uma resposta HTTP significa que o handshake TLS "
            "chegou ao servidor. Isso, sozinho, não confirma login completo no eSocial."
        )

        return 0


def main():
    parser = argparse.ArgumentParser(
        description="Diagnóstico mTLS do certificado A1 para gov.br/eSocial."
    )
    parser.add_argument(
        "--url",
        default="https://certificado.sso.acesso.gov.br/",
        help=(
            "URL a testar. Para o fluxo completo, use uma URL fresca de "
            "certificado.sso.acesso.gov.br com client_id e authorization_id."
        ),
    )
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument(
        "--follow",
        action="store_true",
        help="Segue redirects HTTP automaticamente.",
    )

    args = parser.parse_args()

    try:
        return testar_mtls(args.url, args.timeout, args.follow)
    except Exception as e:
        print("RESULTADO: ERRO_CONFIGURACAO")
        print(str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
