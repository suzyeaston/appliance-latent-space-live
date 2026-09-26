#!/bin/bash
# Publish committed source and a separately built static site. Compatible with macOS Bash 3.2.
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TARGET='suzyeaston/appliance-latent-space-live'
URL="https://github.com/$TARGET.git"
fail() { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
for tool in git gh node npm; do command -v "$tool" >/dev/null || fail "Missing $tool."; done
[ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'Use Node 22 (nvm use, or the delivered setup script).'
[ "$(git rev-parse --show-toplevel)" = "$PWD" ] || fail 'Run from the public project checkout.'
[ "$(git branch --show-current)" = main ] || fail 'Switch to main before deploying.'
[ -z "$(git status --porcelain)" ] || fail 'Review and commit your changes before deployment. No files were auto-committed.'
[ "$(git config --get remote.origin.url)" = "$URL" ] || fail "Expected origin $URL."
[ "$(gh api user --jq .login)" = suzyeaston ] || fail 'GitHub CLI must be logged into suzyeaston.'
[ "$(gh repo view "$TARGET" --json visibility --jq .visibility)" = PUBLIC ] || fail 'Target is not public. No visibility was changed.'
# Empty helper resets inherited helpers; the next helper uses gh without changing global git config.
ggit() { git -c credential.https://github.com.helper= -c 'credential.https://github.com.helper=!gh auth git-credential' "$@"; }
npm test
npm run build
[ -s dist/index.html ] || fail 'Build did not produce dist/index.html.'
# A normal push refuses divergent remote work. Never force-push.
ggit push -u origin main
TEMP_DEPLOY="$(mktemp -d "${TMPDIR:-/tmp}/als-deploy.XXXXXX")"
trap 'rm -rf "$TEMP_DEPLOY"' EXIT
# Snapshot build output outside the source tree; never publish .git, tests, or private files as website assets.
cp -R dist/. "$TEMP_DEPLOY/"
cd "$TEMP_DEPLOY"
git init -q -b gh-pages
git config user.name 'Suzy Easton'
git config user.email '90874169+suzyeaston@users.noreply.github.com'
git remote add origin "$URL"
REMOTE_PAGES="$(ggit ls-remote --heads origin gh-pages)"
if [ -n "$REMOTE_PAGES" ]; then
  ggit fetch --depth=1 origin gh-pages
  # Move HEAD to the deployed commit but retain exactly the newly built worktree.
  git reset --mixed FETCH_HEAD >/dev/null
fi
: > .nojekyll
git add -A
if ! git diff --cached --quiet; then git commit -q -m 'Publish instrument build'; fi
ggit push origin HEAD:gh-pages
PAGES_INFO="$TEMP_DEPLOY/pages.json"
if gh api "repos/$TARGET/pages" > "$PAGES_INFO" 2>/dev/null; then
  MODE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).build_type' "$PAGES_INFO")"
  BRANCH="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source?.branch || ""' "$PAGES_INFO")"
  PAGE_PATH="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source?.path || ""' "$PAGES_INFO")"
  [ "$MODE" = legacy ] && [ "$BRANCH" = gh-pages ] && [ "$PAGE_PATH" = / ] || fail "Existing Pages settings differ. Set Deploy from a branch: gh-pages / (root) at https://github.com/$TARGET/settings/pages, then rerun."
else
  if ! gh api --method POST "repos/$TARGET/pages" -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/' > "$PAGES_INFO"; then
    fail "Code is pushed. Finish Pages setup at https://github.com/$TARGET/settings/pages: Deploy from a branch, gh-pages, / (root). Then rerun npm run deploy."
  fi
fi
SITE_URL="$(gh api "repos/$TARGET/pages" --jq .html_url)"
printf '\nPublic source: https://github.com/%s\nPages configured: %s\nThe Pages build may still be pending. Check GitHub Actions and open the URL before sharing it as live.\n' "$TARGET" "$SITE_URL"
