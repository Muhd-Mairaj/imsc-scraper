FROM oven/bun:1.3.14

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV WHATSAPP_HEADLESS=true
ENV WHATSAPP_DOCKER=true

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src

ENTRYPOINT ["bun", "run", "src/index.ts"]
