#!/bin/bash
# Kryptoniq launcher (TD-LAUNCH): runs the local server in the background, without a Terminal window.
#
#   scripts/kryptoniq.sh [start] [--no-open]   start in the background (if needed) and open the browser
#   scripts/kryptoniq.sh stop | restart | status | open | logs | app | help
#
# Written for the bash 3.2 that ships with macOS and for the minimal environment of an AppleScript
# `do shell script` (PATH=/usr/bin:/bin:/usr/sbin:/sbin, no shell profile): no arrays, no bash 4 syntax,
# absolute paths for system tools, Node.js looked up explicitly.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 1
cd "$ROOT" || exit 1

# Same rule as loadConfig(): an integer 1-65535, otherwise 4317. The value is passed on to the server.
PORT="${KRYPTONIQ_PORT:-4317}"
case "$PORT" in
  '' | *[!0-9]*) PORT=4317 ;;
esac
if [ "${#PORT}" -gt 5 ]; then PORT=4317; fi
PORT=$((10#$PORT))
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then PORT=4317; fi

DATA_DIR="${KRYPTONIQ_DATA_DIR:-$ROOT/data}"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$ROOT/$DATA_DIR" ;;
esac
LOG_DIR="$DATA_DIR/logs"
LAUNCH_LOG="$LOG_DIR/launcher.log"
LOCK_DIR="$DATA_DIR/.launcher.lock"
URL="http://127.0.0.1:$PORT"
APP_PATH="$ROOT/Kryptoniq.app"
APP_ID="com.dustyinvestments.kryptoniq.launcher"

OPEN_BROWSER=1
NODE_BIN=""
LOCK_OWNED=0

say() { printf '%s\n' "$*"; }
fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

release_lock() {
  if [ "$LOCK_OWNED" = 1 ]; then
    rmdir "$LOCK_DIR" 2>/dev/null
    LOCK_OWNED=0
  fi
}
trap release_lock EXIT
trap 'exit 130' INT TERM HUP

# ---------------------------------------------------------------- server detection

# Kryptoniq answers GET /api/ping with {"ok":true}. -q (must come first): ignore ~/.curlrc;
# --noproxy: a proxy from the environment must not receive requests for 127.0.0.1.
is_up() {
  [ "$(/usr/bin/curl -q --noproxy '*' -fsS -m 2 "$URL/api/ping" 2>/dev/null)" = '{"ok":true}' ]
}

listener_pid() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1
}

proc_cmd() {
  /bin/ps -p "$1" -o command= 2>/dev/null
}

is_kryptoniq_pid() {
  case "$(proc_cmd "$1")" in
    *src/server/main.ts*) return 0 ;;
  esac
  return 1
}

# wait_until_up <seconds> [pid]: 0 = answering, 1 = timeout, 2 = the process exited.
wait_until_up() {
  local i=0 max=$(($1 * 2))
  while [ "$i" -lt "$max" ]; do
    is_up && return 0
    if [ -n "${2:-}" ] && ! kill -0 "$2" 2>/dev/null; then
      is_up && return 0
      return 2
    fi
    /bin/sleep 0.5
    i=$((i + 1))
  done
  is_up && return 0
  return 1
}

# The server's daily log (same UTC date as its logger).
today_log() {
  printf '%s/kryptoniq-%s.log' "$LOG_DIR" "$(/bin/date -u +%Y-%m-%d)"
}

file_size() {
  /usr/bin/stat -f %z "$1" 2>/dev/null || echo 0
}

# Shows what this start wrote: launcher.log (truncated at start) and the daily log after $1 bytes of $2.
show_log_tails() {
  local mark="$1" f="$2"
  if [ -s "$LAUNCH_LOG" ]; then
    printf '\n--- %s ---\n' "$LAUNCH_LOG" >&2
    /usr/bin/tail -n 12 "$LAUNCH_LOG" >&2
  fi
  if [ "$(file_size "$f")" -gt "$mark" ]; then
    printf '\n--- %s ---\n' "$f" >&2
    /usr/bin/tail -c +"$((mark + 1))" "$f" | /usr/bin/tail -n 8 >&2
  fi
}

open_browser() {
  [ "$OPEN_BROWSER" = 1 ] || return 0
  /usr/bin/open "$URL" 2>/dev/null || say "Deschide în browser: $URL"
}

# ---------------------------------------------------------------- start helpers

node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

pick_node() {
  local c m
  if [ -n "${KRYPTONIQ_NODE:-}" ]; then
    [ -x "$KRYPTONIQ_NODE" ] || fail "KRYPTONIQ_NODE=$KRYPTONIQ_NODE nu este un program executabil."
    m="$(node_major "$KRYPTONIQ_NODE")"
    case "$m" in
      '' | *[!0-9]*) fail "KRYPTONIQ_NODE=$KRYPTONIQ_NODE nu pare să fie Node.js." ;;
    esac
    [ "$m" -ge 24 ] || fail "KRYPTONIQ_NODE indică Node $m; Kryptoniq are nevoie de Node 24 sau mai nou."
    NODE_BIN="$KRYPTONIQ_NODE"
    return 0
  fi
  for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node \
    "${HOME:-/nonexistent}/.volta/bin/node" "${HOME:-/nonexistent}"/.nvm/versions/node/*/bin/node \
    "${HOME:-/nonexistent}/.local/share/fnm/aliases/default/bin/node"; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    m="$(node_major "$c")"
    case "$m" in
      '' | *[!0-9]*) continue ;;
    esac
    if [ "$m" -ge 24 ]; then
      NODE_BIN="$c"
      return 0
    fi
  done
  fail "Nu găsesc Node.js 24 sau mai nou. Instalează-l cu: brew install node (sau de pe https://nodejs.org)."
}

# Finder's .DS_Store files, tests and fixtures do not end up in the UI bundle.
needs_build() {
  [ -f dist/web/index.html ] || return 0
  [ -n "$(/usr/bin/find src/web src/shared vite.config.ts tsconfig.json package.json package-lock.json \
    -type f -newer dist/web/index.html ! -name .DS_Store ! -name '*.test.ts' ! -path '*/__fixtures__/*' \
    -print 2>/dev/null | /usr/bin/head -n 1)" ]
}

build_ui() {
  say "Construiesc interfața…"
  if ! "$NODE_BIN" node_modules/vite/bin/vite.js build >>"$LAUNCH_LOG" 2>&1; then
    /usr/bin/tail -n 20 "$LAUNCH_LOG" >&2
    fail "Construirea interfeței a eșuat (detalii în $LAUNCH_LOG)."
  fi
}

lock_is_stale() {
  [ -n "$(/usr/bin/find "$LOCK_DIR" -maxdepth 0 -mmin +3 2>/dev/null)" ]
}

# 0 = this process owns the start lock; 1 = Kryptoniq came up while another start held the lock.
acquire_start_lock() {
  local i=0
  /bin/mkdir -p "$DATA_DIR" 2>/dev/null || fail "Nu pot crea folderul de date $DATA_DIR."
  while :; do
    if /bin/mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_OWNED=1
      return 0
    fi
    is_up && return 1
    if lock_is_stale; then
      rmdir "$LOCK_DIR" 2>/dev/null
      continue
    fi
    [ "$i" -eq 0 ] && say "O altă pornire Kryptoniq e în curs; aștept…"
    [ "$i" -ge 400 ] && fail "O altă pornire Kryptoniq durează prea mult. Dacă nu rulează nimic, șterge $LOCK_DIR și încearcă din nou."
    /bin/sleep 0.5
    i=$((i + 1))
  done
}

# Returns when no start is in progress (used by stop, so it does not race a starting server).
wait_for_pending_start() {
  local i=0
  while [ -d "$LOCK_DIR" ] && ! lock_is_stale && [ "$i" -lt 400 ]; do
    [ "$i" -eq 0 ] && say "O pornire Kryptoniq e în curs; aștept să se termine…"
    /bin/sleep 0.5
    i=$((i + 1))
  done
}

# Fails unless the port is free. Returns 1 when Kryptoniq itself already listens and answers.
check_port() {
  local pid
  pid="$(listener_pid)"
  [ -n "$pid" ] || return 0
  if is_kryptoniq_pid "$pid"; then
    wait_until_up 90 "$pid" && return 1
    fail "Kryptoniq (PID $pid) ascultă pe portul $PORT, dar nu răspunde. Încearcă: scripts/kryptoniq.sh restart"
  fi
  fail "Portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid")). Închide-l sau alege alt port cu KRYPTONIQ_PORT."
}

# ---------------------------------------------------------------- commands

cmd_start() {
  local pid rc log_file log_mark
  if is_up; then
    say "Kryptoniq rulează deja: $URL"
    open_browser
    return 0
  fi
  if ! acquire_start_lock; then
    say "Kryptoniq rulează: $URL"
    open_browser
    return 0
  fi
  if is_up || ! check_port; then
    say "Kryptoniq rulează deja: $URL"
    open_browser
    return 0
  fi

  [ -d node_modules ] || fail "Lipsesc dependențele. Rulează o dată, în Terminal, în folderul $ROOT: npm install"
  pick_node
  /bin/mkdir -p "$LOG_DIR" 2>/dev/null || fail "Nu pot crea folderul de log-uri $LOG_DIR."
  : 2>/dev/null >"$LAUNCH_LOG" || fail "Nu pot scrie în $LAUNCH_LOG."
  if needs_build; then build_ui; fi

  say "Pornesc Kryptoniq…"
  log_file="$(today_log)"
  log_mark="$(file_size "$log_file")"
  # From a terminal, job control puts the server in its own process group, so Ctrl+C while waiting
  # below stops only this script. nohup keeps it alive when the Terminal window closes.
  [ -t 0 ] && set -m
  KRYPTONIQ_PORT="$PORT" NODE_ENV=production NODE_USE_ENV_PROXY=1 KRYPTONIQ_QUIET=1 \
    /usr/bin/nohup "$NODE_BIN" src/server/main.ts >/dev/null 2>>"$LAUNCH_LOG" </dev/null &
  pid=$!
  set +m

  wait_until_up 90 "$pid"
  rc=$?
  case "$rc" in
    0)
      say "Kryptoniq rulează: $URL"
      open_browser
      ;;
    2)
      show_log_tails "$log_mark" "$log_file"
      fail "Kryptoniq nu a pornit (detalii mai sus și în $LOG_DIR)."
      ;;
    *)
      fail "Kryptoniq (PID $pid) nu a răspuns în 90 s; poate încă pornește. Verifică: scripts/kryptoniq.sh status; log-uri în $LOG_DIR"
      ;;
  esac
}

cmd_stop() {
  local pid i=0
  wait_for_pending_start
  pid="$(listener_pid)"
  if [ -z "$pid" ]; then
    is_up && fail "Kryptoniq răspunde pe $URL, dar nu găsesc procesul (pornit de alt utilizator?)."
    say "Kryptoniq nu rulează."
    return 0
  fi
  is_kryptoniq_pid "$pid" || fail "Portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid")); nu îl opresc."
  say "Opresc Kryptoniq (PID $pid)…"
  kill -TERM "$pid" 2>/dev/null
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge 40 ]; then
      say "Kryptoniq nu s-a oprit în 20 s; îl opresc forțat." >&2
      kill -KILL "$pid" 2>/dev/null
      /bin/sleep 0.5
      break
    fi
    /bin/sleep 0.5
    i=$((i + 1))
  done
  say "Kryptoniq s-a oprit."
}

cmd_status() {
  local pid
  pid="$(listener_pid)"
  if is_up; then
    if [ -n "$pid" ]; then
      say "Kryptoniq rulează: $URL (PID $pid, pornit de $(/bin/ps -p "$pid" -o etime= | /usr/bin/tr -d ' '))"
      say "Proces: $(proc_cmd "$pid")"
    else
      say "Kryptoniq rulează: $URL"
    fi
    return 0
  fi
  if [ -n "$pid" ]; then
    if is_kryptoniq_pid "$pid"; then
      say "Kryptoniq (PID $pid) ascultă pe portul $PORT, dar nu răspunde."
      return 1
    fi
    say "Kryptoniq nu rulează; portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid"))."
    return 3
  fi
  say "Kryptoniq nu rulează."
  return 3
}

cmd_logs() {
  local f
  f="$(today_log)"
  [ -f "$f" ] || f="$(/bin/ls -1t "$LOG_DIR"/kryptoniq-*.log 2>/dev/null | /usr/bin/head -n 1)"
  [ -n "$f" ] && [ -f "$f" ] || fail "Nu există încă log-uri în $LOG_DIR."
  say "Urmăresc $f (Ctrl+C pentru ieșire)"
  exec /usr/bin/tail -n 50 -F "$f"
}

# AppleScript string literal for $1.
as_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

cmd_app() {
  local tmp src
  [ -x /usr/bin/osacompile ] || fail "osacompile lipsește (e nevoie de macOS)."
  tmp="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/kryptoniq-app.XXXXXX")" || fail "Nu pot crea un folder temporar."
  src="$tmp/main.applescript"
  {
    say '-- Kryptoniq launcher (TD-LAUNCH). Generated by scripts/kryptoniq.sh app: change that script, not this one.'
    say "property projectRoot : $(as_string "$ROOT")"
    /bin/cat <<'APPLESCRIPT'

on run
	set launcher to my findLauncher()
	if launcher is missing value then
		display alert "Kryptoniq" message "Nu găsesc scripts/kryptoniq.sh. Pune Kryptoniq.app înapoi în folderul proiectului sau creează-l din nou din Terminal: scripts/kryptoniq.sh app" as critical
		return
	end if
	try
		do shell script "/bin/bash " & quoted form of launcher & " start"
	on error errMsg
		if errMsg contains "Operation not permitted" then
			set errMsg to "macOS nu permite accesul la folderul Documents, unde e proiectul. Deschide System Settings → Privacy & Security → Files and Folders, activează Documents pentru Kryptoniq, apoi deschide din nou aplicația." & return & return & errMsg
		end if
		display alert "Kryptoniq nu a pornit" message errMsg as critical
	end try
end run

-- The launcher next to the app wins (project moved together with the app), then the path saved
-- when the app was generated (app moved, e.g. to Applications).
on findLauncher()
	set candidates to {}
	try
		set end of candidates to (do shell script "/usr/bin/dirname " & quoted form of POSIX path of (path to me)) & "/scripts/kryptoniq.sh"
	end try
	set end of candidates to projectRoot & "/scripts/kryptoniq.sh"
	repeat with c in candidates
		set p to c as text
		try
			do shell script "/bin/ls " & quoted form of p
			return p
		on error errMsg
			-- Blocked by macOS privacy (TCC), not missing: running it shows the permission hint.
			if errMsg contains "Operation not permitted" then return p
		end try
	end repeat
	return missing value
end findLauncher
APPLESCRIPT
  } >"$src" || fail "Nu pot scrie $src."

  /usr/bin/osacompile -o "$tmp/Kryptoniq.app" "$src" >/dev/null 2>"$tmp/osacompile.err" || {
    /bin/cat "$tmp/osacompile.err" >&2
    /bin/rm -rf "$tmp"
    fail "osacompile a eșuat."
  }
  # A stable identity lets macOS remember the Documents permission; editing Info.plist invalidates the
  # signature written by osacompile, so the app is signed again (ad hoc).
  if ! /usr/bin/plutil -replace CFBundleIdentifier -string "$APP_ID" "$tmp/Kryptoniq.app/Contents/Info.plist" ||
    ! /usr/bin/plutil -replace CFBundleName -string Kryptoniq "$tmp/Kryptoniq.app/Contents/Info.plist" ||
    ! /usr/bin/codesign --force --sign - "$tmp/Kryptoniq.app" >/dev/null 2>&1; then
    /bin/rm -rf "$tmp"
    fail "Nu pot finaliza Kryptoniq.app (plutil/codesign)."
  fi
  if ! /bin/rm -rf "$APP_PATH" || ! /bin/mv "$tmp/Kryptoniq.app" "$APP_PATH"; then
    /bin/rm -rf "$tmp"
    fail "Nu pot scrie $APP_PATH."
  fi
  /bin/rm -rf "$tmp"
  say "Am creat $APP_PATH"
  say "Dublu-click pe el pornește Kryptoniq și deschide browserul. Îl poți trage în Dock sau adăuga la"
  say "System Settings → General → Login Items → Open at Login, ca să pornească la login."
}

usage() {
  /bin/cat <<EOF
Kryptoniq — pornire fără Terminal

  scripts/kryptoniq.sh [start] [--no-open]  pornește în fundal (dacă nu rulează) și deschide browserul
  scripts/kryptoniq.sh stop                 oprește serverul
  scripts/kryptoniq.sh restart [--no-open]  oprește și pornește (reconstruiește interfața dacă s-a schimbat)
  scripts/kryptoniq.sh status               rulează? (exit 0 = da, 3 = nu, 1 = pornit dar nu răspunde)
  scripts/kryptoniq.sh open                 deschide browserul (pornește serverul dacă e nevoie)
  scripts/kryptoniq.sh logs                 urmărește log-ul zilei
  scripts/kryptoniq.sh app                  creează Kryptoniq.app (dublu-click, Dock, Login Items)

Adresa: $URL
EOF
}

# ---------------------------------------------------------------- main

CMD=""
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    -h | --help | help) CMD=help ;;
    *)
      [ -z "$CMD" ] || fail "Prea multe comenzi: $*. Vezi: scripts/kryptoniq.sh help"
      CMD="$arg"
      ;;
  esac
done

case "${CMD:-start}" in
  start | open) cmd_start ;;
  stop) cmd_stop ;;
  restart)
    cmd_stop
    cmd_start
    ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  app) cmd_app ;;
  help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
