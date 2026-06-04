# AutoVis Runner

AutoVis Runner is the local execution node for AutoVis. It runs browser
automation tasks on a user's own machine or server, stores local login state,
and exposes the local web UI and API.

## Install

Node.js 25 or newer is required for local installs and release artifacts.

Linux:

```shell
curl -fsSL https://raw.githubusercontent.com/Yuikij/autovis-runner/main/install.sh | sudo bash
```

Start the runner:

```shell
autovis-runner start
```

systemd:

```shell
sudo systemctl status autovis-runner
sudo journalctl -u autovis-runner -f
```

## Docker

```shell
docker run -d \
  --name autovis-runner \
  --restart unless-stopped \
  --shm-size=2g \
  -p 8787:8787 \
  -v autovis-data:/var/lib/autovis \
  -e AUTOVIS_CONFIG_DIR=/var/lib/autovis/config \
  -e AUTOVIS_CLOUD_URL=https://your-autovis-cloud.example.com \
  -e AUTOVIS_DEVICE_TOKEN=<device-token> \
  yuimax/autovis-runner:latest
```

For Docker, passing `AUTOVIS_CLOUD_URL` and `AUTOVIS_DEVICE_TOKEN` as
environment variables is the recommended registration flow. If you prefer the
CLI helper, call it by absolute path inside the container:

```shell
docker exec -it autovis-runner /opt/autovis-runner/bin/autovis-runner register \
  --token <device-token> \
  --cloud-url https://your-autovis-cloud.example.com
docker restart autovis-runner
```

## Authentication

Authentication is disabled by default. To protect a self-hosted runner, set:

```shell
AUTOVIS_AUTH_ENABLED=true
AUTOVIS_ADMIN_USER=admin
AUTOVIS_ADMIN_PASSWORD=<strong-password>
```

In production, the runner now refuses to start without authentication when
`APP_ORIGIN` is not localhost unless you explicitly set:

```shell
AUTOVIS_ALLOW_INSECURE_NO_AUTH=true
```

LLM account storage can be shared by every login or separated per user:

```shell
AUTOVIS_LLM_SCOPE=shared    # default
AUTOVIS_LLM_SCOPE=per_user  # each login has its own LLM configs and secrets
```

To encrypt stored API keys, Git credentials, and browser login state at rest,
set a stable server-side key before first write:

```shell
AUTOVIS_SECRET_KEY=<strong-random-secret>
```

Keep the same key across restarts. Existing plaintext rows stay readable, but
encrypted rows require the same key to decrypt.

This key is optional. If you do not configure it, the runner still starts and
new sensitive values continue to be stored in plaintext for backward
compatibility. If encrypted rows already exist but the key is missing or wrong,
the runner keeps running and those sensitive values are treated as temporarily
unavailable until the correct key is restored.

Multiple users can be seeded with:

```shell
AUTOVIS_USERS=alice:password:admin,bob:password:user
```

## Release

This repository contains the public AutoVis Runner source. Release artifacts are
packaged as `autovis-runner-<version>.tar.gz`.
