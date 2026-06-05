FROM node:25-bookworm-slim AS builder

WORKDIR /src
COPY . .
ENV CI=true
RUN npm install -g pnpm@10.20.0 && pnpm install --frozen-lockfile && pnpm build && bash scripts/package-runner.sh

FROM node:25-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/var/lib/autovis \
    APP_ORIGIN=http://localhost:8787 \
    HEADLESS=false \
    BROWSER_BACKEND=playwright

WORKDIR /opt/autovis-runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl tar xvfb xauth fonts-noto-cjk fonts-liberation \
    libnss3 libatk-bridge2.0-0 libgtk-3-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/dist-packages/autovis-runner-*/ /opt/autovis-runner/

RUN npm install -g pnpm@10.20.0 \
  && cd /opt/autovis-runner/app \
  && pnpm install --prod --frozen-lockfile \
  && pnpm --filter @autovis/server exec playwright install chromium chrome

VOLUME ["/var/lib/autovis"]
EXPOSE 8787

CMD ["/opt/autovis-runner/bin/autovis-runner", "start"]
