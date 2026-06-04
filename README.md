# AutoVis Runner

AutoVis Runner is the local execution node for AutoVis. It runs browser
automation tasks on a user's own machine or server, stores local login state,
and exposes the local web UI and API.

## Install

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
  yuikij/autovis-runner:latest
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

LLM account storage can be shared by every login or separated per user:

```shell
AUTOVIS_LLM_SCOPE=shared    # default
AUTOVIS_LLM_SCOPE=per_user  # each login has its own LLM configs and secrets
```

Multiple users can be seeded with:

```shell
AUTOVIS_USERS=alice:password:admin,bob:password:user
```

## Release

This repository contains the public AutoVis Runner source. Release artifacts are
packaged as `autovis-runner-<version>.tar.gz`.
