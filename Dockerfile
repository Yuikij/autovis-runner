FROM node:25-bookworm-slim AS builder

WORKDIR /src
COPY . .
ENV CI=true
RUN npm install -g pnpm@10.20.0 && pnpm install --frozen-lockfile && pnpm build && bash scripts/package-runner.sh

FROM node:25-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/var/lib/browsewright \
    APP_ORIGIN=http://localhost:8787 \
    HEADLESS=false \
    BROWSER_BACKEND=patchright

WORKDIR /opt/browsewright-runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl tar xvfb xauth fonts-noto-cjk fonts-liberation \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/dist-packages/browsewright-runner-*/ /opt/browsewright-runner/

RUN npm install -g pnpm@10.20.0 \
  && cd /opt/browsewright-runner/app \
  && pnpm install --prod --frozen-lockfile \
  && pnpm --filter @browsewright/server exec playwright install chromium chrome \
  && pnpm --filter @browsewright/server exec patchright install chromium

VOLUME ["/var/lib/browsewright"]
EXPOSE 8787

CMD ["/opt/browsewright-runner/bin/browsewright-runner", "start"]
