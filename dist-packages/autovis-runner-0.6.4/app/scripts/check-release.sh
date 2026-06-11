#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.1.0}"
URL="https://github.com/Yuikij/autovis-runner/releases/download/v${VERSION}/autovis-runner-${VERSION}.tar.gz"

echo "Checking $URL"
curl -fsSI "$URL"
