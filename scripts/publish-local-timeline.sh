#!/bin/bash
# Commit the staged timeline 0.4 snapshot and push a branch.
# Run on the Mac:
#   bash publish-local-timeline.sh
#
# Touches only:
#   ~/Downloads/Appliance-Latent-Timeline-20260926-210714
# Does not reset, clean, delete, or force-push. Other Downloads copies stay as they are.
# Compatible with macOS Bash 3.2.
set -euo pipefail

DIR="${1:-${HOME}/Downloads/Appliance-Latent-Timeline-20260926-210714}"
BRANCH='cursor/timeline-04-50e2'
EXPECTED='28a99bf002c600649618e3dce270997c090d3121'
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }

[ -d "$DIR" ] || fail "Folder not found: $DIR"
cd "$DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail 'That folder is not a git repository. Nothing was changed.'
remote="$(git config --get remote.origin.url || true)"
printf '%s\n' "$remote" | grep -q 'suzyeaston/appliance-latent-space-live' || fail "Unexpected origin. Nothing was changed."
grep -q 'timeline 0.4' index.html || fail 'index.html is not the timeline 0.4 instrument. Nothing was changed.'

current="$(git branch --show-current)"
head="$(git rev-parse HEAD)"

if [ "$current" = main ]; then
  [ "$head" = "$EXPECTED" ] || fail "This folder is not the known prototype commit. Nothing was changed."
  git diff --cached --name-only | grep -qx 'src/core/performance/timeline.ts' || fail 'Staged timeline work was not found. Nothing was committed.'
  if ! git diff --quiet; then
    fail 'There are unstaged edits. Nothing was committed, so they stay as they are.'
  fi
  git checkout -b "$BRANCH"
  git commit -m "Add the timeline 0.4 instrument that was running locally"
elif [ "$current" = "$BRANCH" ]; then
  if ! git diff --quiet; then
    fail 'There are unstaged edits on the timeline branch. Nothing was pushed.'
  fi
  if ! git diff --cached --quiet; then
    git commit -m "Add the timeline 0.4 instrument that was running locally"
  fi
else
  fail "Expected main or $BRANCH, found ${current:-detached}. Nothing was changed."
fi

git push -u origin "$BRANCH"
printf '\nPushed %s from %s\nOther Downloads copies were not touched.\n' "$BRANCH" "$DIR"
