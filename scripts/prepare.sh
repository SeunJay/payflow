#!/bin/sh
# Runs on `pnpm install`: installs the Lefthook git hooks (spec 0002).
# Skipped only in CI or outside a git checkout; anywhere else a failure stops the install.
set -eu

if [ -n "${CI:-}" ] || [ ! -e .git ]; then
  exit 0
fi

lefthook install
