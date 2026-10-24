#!/bin/sh
# pre-commit: scan staged changes for secrets. A missing gitleaks fails the
# commit with an install hint; it never skips silently (spec 0002).
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed, so the secret scan cannot run." >&2
  echo "Install it (macOS: brew install gitleaks), then commit again." >&2
  exit 1
fi

gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml
