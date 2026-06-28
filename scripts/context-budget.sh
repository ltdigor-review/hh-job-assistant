#!/usr/bin/env bash
set -euo pipefail

echo "Context budget summary"
echo

if [[ -f AGENTS.md ]]; then
  printf "AGENTS.md: "
  wc -l -w -c AGENTS.md | awk '{print $1 " lines, " $2 " words, " $3 " bytes"}'
fi

echo
echo "Dirty worktree:"
git status --short

dirty_count="$(git status --short | wc -l | tr -d ' ')"
echo
echo "dirty_files=${dirty_count}"

echo
echo "Diff summary:"
git diff --stat
untracked_files="$(git ls-files --others --exclude-standard)"
if [[ -n "${untracked_files}" ]]; then
  echo
  echo "Untracked files:"
  printf '%s\n' "${untracked_files}"
fi

echo
echo "Changed files:"
git status --short | sed 's/^...//'

if [[ -f package.json ]]; then
  echo
  echo "npm scripts:"
  node -e 'const p=require("./package.json"); for (const [k,v] of Object.entries(p.scripts||{})) console.log(`${k}: ${v}`)'
fi

vault="${HHJA_OBSIDIAN_VAULT:-../ObsidianVault}"
if [[ -f "${vault}/KnowledgeBase/Articles/Codex Token Budget Workflow.md" ]]; then
  echo
  printf "KB token workflow: "
  wc -l -w -c "${vault}/KnowledgeBase/Articles/Codex Token Budget Workflow.md" | awk '{print $1 " lines, " $2 " words, " $3 " bytes"}'
fi
