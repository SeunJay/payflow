#!/bin/sh
# pre-push: git writes one "<local ref> <local sha> <remote ref> <remote sha>"
# line per pushed ref on stdin. Refuse any push to main (this also catches
# HEAD:main and multi ref pushes), then typecheck and run the unit tests unless
# every pushed ref is a tag or a deletion.
set -eu

needs_checks=no

while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = "refs/heads/main" ]; then
    echo "Pushing to main is blocked. Push your feature branch and open a pull request." >&2
    exit 1
  fi
  case "$remote_ref" in
    refs/tags/*) ;;
    *)
      # A deletion pushes the all zero sha (SHA-256 repos use a longer one)
      case "$local_sha" in
        *[!0]*) needs_checks=yes ;;
      esac
      ;;
  esac
done

if [ "$needs_checks" = "no" ]; then
  exit 0
fi

pnpm typecheck
pnpm test:unit
