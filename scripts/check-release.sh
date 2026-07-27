#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.1.0}"
URL="https://github.com/Yuikij/browsewright-runner/releases/download/v${VERSION}/browsewright-runner-${VERSION}.tar.gz"

echo "Checking $URL"
curl -fsSI "$URL"
