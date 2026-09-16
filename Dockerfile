FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb \
        x11vnc \
        fluxbox \
        novnc \
        libnss3-tools \
        python3 \
        python3-pip \
        ca-certificates \
        dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY requirements.txt ./

# O browser já existe na imagem do Playwright.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm install --omit=dev \
    && mkdir -p /app/.python-packages \
    && python3 -m pip install \
        --break-system-packages \
        --no-cache-dir \
        --target /app/.python-packages \
        -r requirements.txt

COPY . .

RUN chmod +x /app/start-docker.sh

CMD ["/app/start-docker.sh"]
