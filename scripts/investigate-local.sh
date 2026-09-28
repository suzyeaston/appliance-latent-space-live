#!/bin/bash
# Read-only search for local copies of The Appliance Latent Space.
# Run from Terminal in ~/Downloads:
#   bash investigate-appliance.sh
#
# Writes ~/Downloads/appliance-latent-space-investigation.txt
# Reads git status, remotes, and recent files. Does not commit, checkout,
# reset, clean, delete, push, or print env files.
# Compatible with macOS Bash 3.2.

# Do not use set -e: a missing folder or a non-repo should not stop the report.
set -u

PUBLIC_COMMIT='28a99bf002c600649618e3dce270997c090d3121'
ARCHIVE_COMMIT='c865a7185fb80a8a92b13886589067456a854315'
REPORT="${HOME}/Downloads/appliance-latent-space-investigation.txt"
SEEN="$(mktemp "${TMPDIR:-/tmp}/als-seen.XXXXXX")"
CANDIDATES="$(mktemp "${TMPDIR:-/tmp}/als-candidates.XXXXXX")"
trap 'rm -f "$SEEN" "$CANDIDATES"' EXIT

mkdir -p "${HOME}/Downloads"
: > "$REPORT"

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

section() {
  log ""
  log "======== $* ========"
}

redact_url() {
  # Drop embedded tokens or userinfo from git URLs before they reach the report.
  sed -E 's#://[^/@[:space:]]+@#://#'
}

resolve_dir() {
  (CDPATH= cd -- "$1" 2>/dev/null && pwd -P)
}

is_instrument() {
  dir="$1"
  if [ -f "$dir/package.json" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"appliance-latent-space"' "$dir/package.json"; then
    return 0
  fi
  if [ -f "$dir/index.html" ] && grep -q 'The Appliance Latent Space' "$dir/index.html"; then
    return 0
  fi
  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git -C "$dir" remote -v 2>/dev/null | redact_url | grep -q 'appliance-latent-space'; then
      return 0
    fi
  fi
  return 1
}

add_candidate() {
  raw="$1"
  [ -d "$raw" ] || return 0
  resolved="$(resolve_dir "$raw")" || return 0
  if ! is_instrument "$resolved"; then
    return 0
  fi
  if git -C "$resolved" rev-parse --show-toplevel >/dev/null 2>&1; then
    top="$(git -C "$resolved" rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -n "$top" ] && is_instrument "$top"; then
      resolved="$(resolve_dir "$top")" || resolved="$top"
    fi
  fi
  if grep -Fxq "$resolved" "$SEEN" 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$resolved" >> "$SEEN"
  printf '%s\n' "$resolved" >> "$CANDIDATES"
}

consider_tree() {
  root="$1"
  found=""
  [ -d "$root" ] || return 0
  found="$(mktemp "${TMPDIR:-/tmp}/als-found.XXXXXX")"
  # Prune dependency and VCS folders. The walk stays shallow so this does not roam a home directory.
  find "$root" -maxdepth 7 \
    \( -name node_modules -o -name .git -o -name dist -o -name coverage -o -name .Trash -o -name Library -o -name private \) -prune \
    -o -type f -name package.json -print \
    -o -type f -name index.html -print > "$found" 2>/dev/null || true
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    add_candidate "$(dirname "$file")"
  done < "$found"
  rm -f "$found"
}

newest_files() {
  dir="$1"
  if stat -f '%m' "$dir" >/dev/null 2>&1; then
    find "$dir" -maxdepth 4 \
      \( -name node_modules -o -name .git -o -name dist -o -name coverage -o -name private \) -prune \
      -o -type f -print 2>/dev/null | while IFS= read -r file; do
        printf '%s %s\n' "$(stat -f '%m' "$file")" "$file"
      done | sort -nr | head -n 15 | while IFS= read -r line; do
        stamp="${line%% *}"
        path="${line#* }"
        shown="$(date -r "$stamp" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || printf '%s' "$stamp")"
        printf '%s  %s\n' "$shown" "${path#"$dir"/}"
      done
  else
    find "$dir" -maxdepth 4 \
      \( -name node_modules -o -name .git -o -name dist -o -name coverage -o -name private \) -prune \
      -o -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 15 | while IFS= read -r line; do
        stamp="${line%% *}"
        path="${line#* }"
        shown="$(date -d "@${stamp%.*}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || printf '%s' "$stamp")"
        printf '%s  %s\n' "$shown" "${path#"$dir"/}"
      done
  fi
}

inspect_candidate() {
  dir="$1"
  section "$dir"
  if [ -f "$dir/package.json" ]; then
    if command -v node >/dev/null 2>&1; then
      node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log("package: "+(p.name||"")+" @ "+(p.version||"")); if (p.description) console.log("description: "+p.description);' "$dir/package.json" | while IFS= read -r line; do log "$line"; done
    else
      log "package.json is present (node is not available to read the version)."
    fi
  else
    log "No package.json in this folder."
  fi
  if [ -f "$dir/index.html" ]; then
    sub="$(grep -m 1 'masthead__sub' -A 2 "$dir/index.html" 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]\{1,\}/ /g' || true)"
    log "index subtitle: ${sub:-"(no masthead subtitle found)"}"
  fi

  if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    head_sha="$(git -C "$dir" rev-parse HEAD 2>/dev/null || printf '%s' 'unknown')"
    branch="$(git -C "$dir" branch --show-current 2>/dev/null || true)"
    log "git branch: ${branch:-"(detached)"}"
    log "git HEAD: $head_sha"
    log "git subject: $(git -C "$dir" log -1 --format='%s' 2>/dev/null || printf '%s' 'unknown')"
    log "remotes:"
    git -C "$dir" remote -v 2>/dev/null | redact_url | while IFS= read -r line; do
      log "  $line"
    done
    log "recent commits:"
    git -C "$dir" log --oneline --decorate -12 2>/dev/null | while IFS= read -r line; do
      log "  $line"
    done
    if git -C "$dir" cat-file -e "${PUBLIC_COMMIT}^{commit}" >/dev/null 2>&1; then
      if [ "$head_sha" = "$PUBLIC_COMMIT" ]; then
        log "Compared with the live public prototype: same commit."
      else
        ahead="$(git -C "$dir" rev-list --count "${PUBLIC_COMMIT}..HEAD" 2>/dev/null || printf '%s' '?')"
        behind="$(git -C "$dir" rev-list --count "HEAD..${PUBLIC_COMMIT}" 2>/dev/null || printf '%s' '?')"
        log "Compared with the live public prototype: $ahead commit(s) ahead, $behind behind."
        log "Commits not in the published prototype:"
        git -C "$dir" log --oneline "${PUBLIC_COMMIT}..HEAD" 2>/dev/null | head -n 20 | while IFS= read -r line; do
          log "  $line"
        done
      fi
    else
      log "The live public prototype commit is not in this repository."
    fi
    if git -C "$dir" cat-file -e "${ARCHIVE_COMMIT}^{commit}" >/dev/null 2>&1; then
      log "Archive snapshot c865a718 is present. HEAD $(git -C "$dir" merge-base --is-ancestor "$ARCHIVE_COMMIT" HEAD >/dev/null 2>&1 && printf 'contains' || printf 'does not contain') it as an ancestor."
    fi
    log "status (names only):"
    status_text="$(git -C "$dir" status --short 2>/dev/null || true)"
    if [ -z "$status_text" ]; then
      log "  clean"
    else
      printf '%s\n' "$status_text" | head -n 200 | while IFS= read -r line; do
        log "  $line"
      done
      extra="$(printf '%s\n' "$status_text" | wc -l | tr -d ' ')"
      if [ "$extra" -gt 200 ]; then
        log "  ... status truncated at 200 lines ..."
      fi
    fi
    log "diff stat:"
    diff_text="$(git -C "$dir" diff --stat 2>/dev/null || true)"
    if [ -z "$diff_text" ]; then
      log "  (no unstaged diff)"
    else
      printf '%s\n' "$diff_text" | head -n 80 | while IFS= read -r line; do
        log "  $line"
      done
    fi
    cached_text="$(git -C "$dir" diff --cached --stat 2>/dev/null || true)"
    if [ -n "$cached_text" ]; then
      log "staged diff stat:"
      printf '%s\n' "$cached_text" | head -n 40 | while IFS= read -r line; do
        log "  $line"
      done
    fi
    stashes="$(git -C "$dir" stash list 2>/dev/null || true)"
    if [ -n "$stashes" ]; then
      log "stashes:"
      printf '%s\n' "$stashes" | head -n 20 | while IFS= read -r line; do
        log "  $line"
      done
    fi
  else
    log "Not a git repository."
  fi

  log "newest files:"
  newest="$(newest_files "$dir" || true)"
  if [ -z "$newest" ]; then
    log "  (none found)"
  else
    printf '%s\n' "$newest" | while IFS= read -r line; do
      log "  $line"
    done
  fi
}

note_server() {
  port="$1"
  section "Process listening on port $port"
  if ! command -v lsof >/dev/null 2>&1; then
    log "lsof is not available, so the dev-server folder could not be read."
    return 0
  fi
  listeners="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$listeners" ]; then
    log "Nothing is listening."
    return 0
  fi
  printf '%s\n' "$listeners" | while IFS= read -r line; do
    log "$line"
  done
  pid_file="$(mktemp "${TMPDIR:-/tmp}/als-pids.XXXXXX")"
  printf '%s\n' "$listeners" | awk 'NR>1 {print $2}' | sort -u > "$pid_file"
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    cwd="$(lsof -a -p "$pid" -d cwd 2>/dev/null | awk 'NR>1 {print $NF; exit}')"
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    log "pid $pid"
    log "  cwd: ${cwd:-unknown}"
    log "  command: ${cmd:-unknown}"
    if [ -n "${cwd:-}" ]; then
      add_candidate "$cwd"
      parent="$cwd"
      hops=0
      while [ "$parent" != "/" ] && [ "$hops" -lt 6 ]; do
        parent="$(dirname "$parent")"
        add_candidate "$parent"
        hops=$((hops + 1))
      done
    fi
  done < "$pid_file"
  rm -f "$pid_file"
}

section "Machine"
log "date: $(date)"
log "pwd: $(pwd)"
log "home: $HOME"
log "shell: ${BASH_VERSION:-unknown}"
log "uname: $(uname -a)"
if command -v node >/dev/null 2>&1; then
  log "node: $(node -v)"
else
  log "node: not on PATH"
fi
log "This script only reads. It does not change project files."

note_server 5173
note_server 4173

section "Search"
roots="
${HOME}/Downloads
${HOME}/Desktop
${HOME}/Developer
${HOME}/Projects
${HOME}/projects
${HOME}/code
${HOME}/dev
${HOME}/src
${HOME}/repos
${HOME}/work
${HOME}/github
${HOME}/Documents/GitHub
${HOME}/Documents/code
${HOME}/Documents/projects
${HOME}/Documents/Git
"
log "Looking for the instrument under:"
printf '%s\n' "$roots" | while IFS= read -r root; do
  [ -n "$root" ] || continue
  if [ -d "$root" ]; then
    log "  $root"
    consider_tree "$root"
  else
    log "  $root (not present)"
  fi
done

# The public launch notes mention this exact folder.
add_candidate "${HOME}/Downloads/Appliance-Latent-Space-Public/project"
add_candidate "${HOME}/Downloads/Appliance-Latent-Space-Public"

count="$(grep -c . "$CANDIDATES" 2>/dev/null || true)"
count="${count:-0}"
section "Copies found: $count"
if [ "$count" -eq 0 ]; then
  log "No instrument folder was found in the searched locations."
  log "If the dev server is stopped, start it again and rerun this script."
  log "The folder that serves http://127.0.0.1:5173/ is the one we need."
else
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    inspect_candidate "$dir"
  done < "$CANDIDATES"
fi

section "Done"
log "Report file: $REPORT"
log "Send that file back. It lists folders, branches, and file names, not source code or secrets."
