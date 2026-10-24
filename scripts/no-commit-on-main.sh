#!/bin/sh
# pre-commit: refuse commits on main once main has history. Only the bootstrap
# root commit may land on main directly (spec 0002); everything else goes
# through a feature branch and a pull request.
set -eu

branch=$(git symbolic-ref --quiet --short HEAD || true)

if [ "$branch" = "main" ] && git rev-parse --verify --quiet HEAD >/dev/null; then
  echo "Commits on main are blocked. Create the feature branch first, for example:" >&2
  echo "  git switch -c feat/<NN>-<slug>" >&2
  exit 1
fi
