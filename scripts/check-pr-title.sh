#!/bin/sh
# Checks a pull request title against the Conventional Commits rule in spec 0002.
# The title becomes the squash commit on main. Usage: check-pr-title.sh "<title>"
set -eu

title=${1:-}
pattern='^(feat|fix|test|docs|refactor|perf|chore|ci|build|revert)(\([a-z0-9-]+\))?!?: [a-z].{0,70}[^.]$'

case "$title" in
  'Revert "'*) exit 0 ;; # GitHub's own revert titles pass unchanged
esac

if [ "${#title}" -gt 72 ]; then
  echo "PR title is ${#title} characters; the limit is 72: $title" >&2
  exit 1
fi

if ! printf '%s\n' "$title" | grep -Eq "$pattern"; then
  echo "PR title is not a Conventional Commit header: $title" >&2
  echo "Expected <type>(<scope>)!: <subject>, for example: feat(ledger): derive balances from entries" >&2
  echo "Types: feat fix test docs refactor perf chore ci build revert. Subject starts lowercase, no trailing period." >&2
  exit 1
fi
