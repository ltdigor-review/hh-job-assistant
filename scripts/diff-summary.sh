#!/usr/bin/env bash
set -euo pipefail

echo "Status:"
git status --short

echo
echo "Changed files:"
git status --short | sed 's/^...//'

echo
echo "Diff stat:"
git diff --stat
untracked_files="$(git ls-files --others --exclude-standard)"
if [[ -n "${untracked_files}" ]]; then
  echo
  echo "Untracked files:"
  printf '%s\n' "${untracked_files}"
fi

echo
echo "Whitespace check:"
git diff --check
