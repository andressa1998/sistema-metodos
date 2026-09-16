#!/usr/bin/env bash
set -euo pipefail

# A imagem mcr.microsoft.com/playwright já contém os browsers aqui.
# Sobrescreve qualquer PLAYWRIGHT_BROWSERS_PATH antigo do painel Render.
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

echo "🖥️ V10 navegador remoto eSocial"
echo "Node: $(node --version)"
echo "Python: $(python3 --version)"
echo "Playwright browsers: ${PLAYWRIGHT_BROWSERS_PATH}"

exec node server.js
