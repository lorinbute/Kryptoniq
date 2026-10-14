#!/bin/bash
# Sentiq launcher (TD-LAUNCH): runs the local server in the background, without a Terminal window.
#
#   scripts/sentiq.sh [start] [--no-open]   start in the background (if needed) and open the browser
#   scripts/sentiq.sh stop | restart | status | open | logs | app | help
#   scripts/sentiq.sh admin-email <address> | admin-reset
#
# Written for the bash 3.2 that ships with macOS and for the minimal environment of an AppleScript
# `do shell script` (PATH=/usr/bin:/bin:/usr/sbin:/sbin, no shell profile): no arrays, no bash 4 syntax,
# absolute paths for system tools, Node.js looked up explicitly.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)" || exit 1
cd "$ROOT" || exit 1

# Same rule as loadConfig(): an integer 1-65535, otherwise 4317. The value is passed on to the server.
PORT="${SENTIQ_PORT:-${KRYPTONIQ_PORT:-4317}}"
case "$PORT" in
  '' | *[!0-9]*) PORT=4317 ;;
esac
if [ "${#PORT}" -gt 5 ]; then PORT=4317; fi
PORT=$((10#$PORT))
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then PORT=4317; fi

DATA_DIR="${SENTIQ_DATA_DIR:-${KRYPTONIQ_DATA_DIR:-$ROOT/data}}"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$ROOT/$DATA_DIR" ;;
esac
LOG_DIR="$DATA_DIR/logs"
LAUNCH_LOG="$LOG_DIR/launcher.log"
LOCK_DIR="$DATA_DIR/.launcher.lock"
# The browser opens localhost (passkeys work only there, FD-USERS §9); the launcher itself talks to 127.0.0.1.
URL="http://localhost:$PORT"
PING_URL="http://127.0.0.1:$PORT"
APP_PATH="$ROOT/Sentiq.app"
APP_ID="com.dustyinvestments.sentiq.launcher"

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

# Sentiq answers GET /api/ping with {"ok":true}. -q (must come first): ignore ~/.curlrc;
# --noproxy: a proxy from the environment must not receive requests for 127.0.0.1.
is_up() {
  [ "$(/usr/bin/curl -q --noproxy '*' -fsS -m 2 "$PING_URL/api/ping" 2>/dev/null)" = '{"ok":true}' ]
}

listener_pid() {
  /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1
}

proc_cmd() {
  /bin/ps -p "$1" -o command= 2>/dev/null
}

is_sentiq_pid() {
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
  printf '%s/sentiq-%s.log' "$LOG_DIR" "$(/bin/date -u +%Y-%m-%d)"
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
  # KRYPTONIQ_NODE: its name before the rename (FD-SENTIQ §1).
  SENTIQ_NODE="${SENTIQ_NODE:-${KRYPTONIQ_NODE:-}}"
  if [ -n "${SENTIQ_NODE:-}" ]; then
    [ -x "$SENTIQ_NODE" ] || fail "SENTIQ_NODE=$SENTIQ_NODE nu este un program executabil."
    m="$(node_major "$SENTIQ_NODE")"
    case "$m" in
      '' | *[!0-9]*) fail "SENTIQ_NODE=$SENTIQ_NODE nu pare să fie Node.js." ;;
    esac
    [ "$m" -ge 24 ] || fail "SENTIQ_NODE indică Node $m; Sentiq are nevoie de Node 24 sau mai nou."
    NODE_BIN="$SENTIQ_NODE"
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

# 0 = this process owns the start lock; 1 = Sentiq came up while another start held the lock.
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
    [ "$i" -eq 0 ] && say "O altă pornire Sentiq e în curs; aștept…"
    [ "$i" -ge 400 ] && fail "O altă pornire Sentiq durează prea mult. Dacă nu rulează nimic, șterge $LOCK_DIR și încearcă din nou."
    /bin/sleep 0.5
    i=$((i + 1))
  done
}

# Returns when no start is in progress (used by stop, so it does not race a starting server).
wait_for_pending_start() {
  local i=0
  while [ -d "$LOCK_DIR" ] && ! lock_is_stale && [ "$i" -lt 400 ]; do
    [ "$i" -eq 0 ] && say "O pornire Sentiq e în curs; aștept să se termine…"
    /bin/sleep 0.5
    i=$((i + 1))
  done
}

# Fails unless the port is free. Returns 1 when Sentiq itself already listens and answers.
check_port() {
  local pid
  pid="$(listener_pid)"
  [ -n "$pid" ] || return 0
  if is_sentiq_pid "$pid"; then
    wait_until_up 90 "$pid" && return 1
    fail "Sentiq (PID $pid) ascultă pe portul $PORT, dar nu răspunde. Încearcă: scripts/sentiq.sh restart"
  fi
  fail "Portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid")). Închide-l sau alege alt port cu SENTIQ_PORT."
}

# ---------------------------------------------------------------- commands

# FD-AZURE §2: the database lives in Azure SQL; without its connection the server cannot start.
check_db_config() {
  local file="$DATA_DIR/database.env"
  [ -n "${SENTIQ_DB_CONNECTION:-}" ] && return 0
  [ -n "${SENTIQ_DB_SERVER:-}" ] && [ -n "${SENTIQ_DB_PASSWORD:-}" ] && return 0
  if [ -f "$file" ] && /usr/bin/grep -Eq '^SENTIQ_DB_(CONNECTION|SERVER)=.+' "$file"; then return 0; fi
  fail "Baza de date nu e configurată: completează $file (server, bază, utilizator, parolă sau connection string)."
}

cmd_start() {
  local pid rc log_file log_mark
  if is_up; then
    say "Sentiq rulează deja: $URL"
    open_browser
    return 0
  fi
  if ! acquire_start_lock; then
    say "Sentiq rulează: $URL"
    open_browser
    return 0
  fi
  if is_up || ! check_port; then
    say "Sentiq rulează deja: $URL"
    open_browser
    return 0
  fi

  [ -d node_modules ] || fail "Lipsesc dependențele. Rulează o dată, în Terminal, în folderul $ROOT: npm install"
  check_db_config
  pick_node
  /bin/mkdir -p "$LOG_DIR" 2>/dev/null || fail "Nu pot crea folderul de log-uri $LOG_DIR."
  : 2>/dev/null >"$LAUNCH_LOG" || fail "Nu pot scrie în $LAUNCH_LOG."
  if needs_build; then build_ui; fi

  say "Pornesc Sentiq…"
  log_file="$(today_log)"
  log_mark="$(file_size "$log_file")"
  # From a terminal, job control puts the server in its own process group, so Ctrl+C while waiting
  # below stops only this script. nohup keeps it alive when the Terminal window closes.
  [ -t 0 ] && set -m
  SENTIQ_PORT="$PORT" NODE_ENV=production NODE_USE_ENV_PROXY=1 SENTIQ_QUIET=1 \
    /usr/bin/nohup "$NODE_BIN" src/server/main.ts >/dev/null 2>>"$LAUNCH_LOG" </dev/null &
  pid=$!
  set +m

  wait_until_up 90 "$pid"
  rc=$?
  case "$rc" in
    0)
      say "Sentiq rulează: $URL"
      open_browser
      ;;
    2)
      show_log_tails "$log_mark" "$log_file"
      fail "Sentiq nu a pornit (detalii mai sus și în $LOG_DIR)."
      ;;
    *)
      fail "Sentiq (PID $pid) nu a răspuns în 90 s; poate încă pornește. Verifică: scripts/sentiq.sh status; log-uri în $LOG_DIR"
      ;;
  esac
}

cmd_stop() {
  local pid i=0
  wait_for_pending_start
  pid="$(listener_pid)"
  if [ -z "$pid" ]; then
    is_up && fail "Sentiq răspunde pe $URL, dar nu găsesc procesul (pornit de alt utilizator?)."
    say "Sentiq nu rulează."
    return 0
  fi
  is_sentiq_pid "$pid" || fail "Portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid")); nu îl opresc."
  say "Opresc Sentiq (PID $pid)…"
  kill -TERM "$pid" 2>/dev/null
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge 40 ]; then
      say "Sentiq nu s-a oprit în 20 s; îl opresc forțat." >&2
      kill -KILL "$pid" 2>/dev/null
      /bin/sleep 0.5
      break
    fi
    /bin/sleep 0.5
    i=$((i + 1))
  done
  say "Sentiq s-a oprit."
}

# This Mac's addresses on the local network (Wi-Fi / Ethernet), as URLs; empty when it listens on 127.0.0.1 only.
lan_urls() {
  local i a out=""
  case "${SENTIQ_BIND:-${KRYPTONIQ_BIND:-}}" in
    127.* | ::1 | localhost) return 0 ;;
  esac
  for i in en0 en1 en2 en3 en4 en5; do
    a="$(/usr/sbin/ipconfig getifaddr "$i" 2>/dev/null)"
    [ -n "$a" ] && out="$out http://$a:$PORT"
  done
  printf '%s' "${out# }"
}

cmd_status() {
  local pid lan
  pid="$(listener_pid)"
  if is_up; then
    if [ -n "$pid" ]; then
      say "Sentiq rulează: $URL (PID $pid, pornit de $(/bin/ps -p "$pid" -o etime= | /usr/bin/tr -d ' '))"
      say "Proces: $(proc_cmd "$pid")"
    else
      say "Sentiq rulează: $URL"
    fi
    lan="$(lan_urls)"
    [ -z "$lan" ] || say "În rețeaua locală: $lan (acolo fără passkey-uri)"
    return 0
  fi
  if [ -n "$pid" ]; then
    if is_sentiq_pid "$pid"; then
      say "Sentiq (PID $pid) ascultă pe portul $PORT, dar nu răspunde."
      return 1
    fi
    say "Sentiq nu rulează; portul $PORT e folosit de alt program (PID $pid: $(proc_cmd "$pid"))."
    return 3
  fi
  say "Sentiq nu rulează."
  return 3
}

cmd_logs() {
  local f
  f="$(today_log)"
  [ -f "$f" ] || f="$(/bin/ls -1t "$LOG_DIR"/sentiq-*.log "$LOG_DIR"/kryptoniq-*.log 2>/dev/null | /usr/bin/head -n 1)"
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
  tmp="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/sentiq-app.XXXXXX")" || fail "Nu pot crea un folder temporar."
  src="$tmp/main.applescript"
  {
    say '-- Sentiq launcher (TD-LAUNCH). Generated by scripts/sentiq.sh app: change that script, not this one.'
    say "property projectRoot : $(as_string "$ROOT")"
    /bin/cat <<'APPLESCRIPT'

on run
	set launcher to my findLauncher()
	if launcher is missing value then
		display alert "Sentiq" message "Nu găsesc scripts/sentiq.sh. Pune Sentiq.app înapoi în folderul proiectului sau creează-l din nou din Terminal: scripts/sentiq.sh app" as critical
		return
	end if
	try
		do shell script "/bin/bash " & quoted form of launcher & " start"
	on error errMsg
		if errMsg contains "Operation not permitted" then
			set errMsg to "macOS nu permite accesul la folderul Documents, unde e proiectul. Deschide System Settings → Privacy & Security → Files and Folders, activează Documents pentru Sentiq, apoi deschide din nou aplicația." & return & return & errMsg
		end if
		display alert "Sentiq nu a pornit" message errMsg as critical
	end try
end run

-- The launcher next to the app wins (project moved together with the app), then the path saved
-- when the app was generated (app moved, e.g. to Applications).
on findLauncher()
	set candidates to {}
	try
		set end of candidates to (do shell script "/usr/bin/dirname " & quoted form of POSIX path of (path to me)) & "/scripts/sentiq.sh"
	end try
	set end of candidates to projectRoot & "/scripts/sentiq.sh"
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

  /usr/bin/osacompile -o "$tmp/Sentiq.app" "$src" >/dev/null 2>"$tmp/osacompile.err" || {
    /bin/cat "$tmp/osacompile.err" >&2
    /bin/rm -rf "$tmp"
    fail "osacompile a eșuat."
  }
  # The Sentiq icon (compiled from src/web/public/Sentiq.icon by scripts/app-icon/build.sh): the asset catalog for
  # macOS 26+ (Liquid Glass) and an .icns for older systems. Without them the app keeps the generic script icon.
  local res="$tmp/Sentiq.app/Contents/Resources" icon_dir="$ROOT/scripts/app-icon" icon_ok=0
  if [ -f "$icon_dir/Assets.car" ] && [ -f "$icon_dir/Sentiq.icns" ] &&
    /bin/cp "$icon_dir/Assets.car" "$res/Assets.car" &&
    /bin/cp "$icon_dir/Sentiq.icns" "$res/Sentiq.icns" &&
    /bin/rm -f "$res/applet.icns" &&
    /usr/bin/plutil -replace CFBundleIconFile -string Sentiq "$tmp/Sentiq.app/Contents/Info.plist" &&
    /usr/bin/plutil -replace CFBundleIconName -string Sentiq "$tmp/Sentiq.app/Contents/Info.plist"; then
    icon_ok=1
  fi
  # A stable identity lets macOS remember the Documents permission; editing Info.plist invalidates the
  # signature written by osacompile, so the app is signed again (ad hoc).
  if ! /usr/bin/plutil -replace CFBundleIdentifier -string "$APP_ID" "$tmp/Sentiq.app/Contents/Info.plist" ||
    ! /usr/bin/plutil -replace CFBundleName -string Sentiq "$tmp/Sentiq.app/Contents/Info.plist" ||
    ! /usr/bin/codesign --force --sign - "$tmp/Sentiq.app" >/dev/null 2>&1; then
    /bin/rm -rf "$tmp"
    fail "Nu pot finaliza Sentiq.app (plutil/codesign)."
  fi
  if ! /bin/rm -rf "$APP_PATH" || ! /bin/mv "$tmp/Sentiq.app" "$APP_PATH"; then
    /bin/rm -rf "$tmp"
    fail "Nu pot scrie $APP_PATH."
  fi
  /bin/rm -rf "$tmp"
  # Finder and the Dock read the icon again.
  /usr/bin/touch "$APP_PATH"
  say "Am creat $APP_PATH"
  [ "$icon_ok" = 1 ] || say "Atenție: iconița Sentiq lipsește din scripts/app-icon/; aplicația are iconița generică."
  say "Dublu-click pe el pornește Sentiq și deschide browserul. Îl poți trage în Dock sau adăuga la"
  say "System Settings → General → Login Items → Open at Login, ca să pornească la login."
}

# FD-USERS §3: the admin's address before the first sign-in, or a fresh start when the admin is locked out.
cmd_admin() {
  pick_node
  case "$1" in
    email)
      [ -n "${CMD_ARG:-}" ] || fail "Folosire: scripts/sentiq.sh admin-email adresa@exemplu.ro"
      SENTIQ_DATA_DIR="$DATA_DIR" "$NODE_BIN" scripts/admin.ts email "$CMD_ARG"
      ;;
    reset)
      [ -t 0 ] || fail "admin-reset se rulează din Terminal (cere confirmare)."
      printf 'Șterg parola, autentificarea în doi pași și passkey-urile contului de admin. Continui? Scrie da: '
      local answer=""
      read -r answer
      [ "$answer" = "da" ] || fail "Nu am schimbat nimic."
      SENTIQ_DATA_DIR="$DATA_DIR" "$NODE_BIN" scripts/admin.ts reset
      ;;
  esac
}

# FD-AZURE §3 / TD-AZURE §11: the connection check and the one-time move of the SQLite file.
cmd_db() {
  pick_node
  case "$1" in
    check) SENTIQ_DATA_DIR="$DATA_DIR" SENTIQ_PORT="$PORT" "$NODE_BIN" scripts/db-check.ts ;;
    import) SENTIQ_DATA_DIR="$DATA_DIR" SENTIQ_PORT="$PORT" "$NODE_BIN" scripts/import-sqlite.ts $CMD_FLAGS ;;
  esac
}

usage() {
  /bin/cat <<EOF
Sentiq — pornire fără Terminal

  scripts/sentiq.sh [start] [--no-open]  pornește în fundal (dacă nu rulează) și deschide browserul
  scripts/sentiq.sh stop                 oprește serverul
  scripts/sentiq.sh restart [--no-open]  oprește și pornește (reconstruiește interfața dacă s-a schimbat)
  scripts/sentiq.sh status               rulează? (exit 0 = da, 3 = nu, 1 = pornit dar nu răspunde)
  scripts/sentiq.sh open                 deschide browserul (pornește serverul dacă e nevoie)
  scripts/sentiq.sh logs                 urmărește log-ul zilei
  scripts/sentiq.sh app                  creează Sentiq.app (dublu-click, Dock, Login Items)
  scripts/sentiq.sh admin-email ADRESA   adresa contului de admin, înainte de prima intrare
  scripts/sentiq.sh admin-reset          șterge parola, 2FA și passkey-urile adminului (dacă nu mai poți intra)
  scripts/sentiq.sh db-check             verifică legătura cu baza de date (data/database.env), fără să arate parola
  scripts/sentiq.sh import-sqlite [--replace] [--force]
                                         mută, o singură dată, data/kryptoniq.db în baza Azure SQL (Sentiq oprit)

Adresa: $URL
EOF
}

# ---------------------------------------------------------------- main

CMD=""
CMD_ARG=""
CMD_FLAGS=""
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    --replace | --force)
      [ "$CMD" = "import-sqlite" ] || fail "$arg merge doar cu import-sqlite. Vezi: scripts/sentiq.sh help"
      CMD_FLAGS="$CMD_FLAGS $arg"
      ;;
    -h | --help | help) CMD=help ;;
    *)
      if [ "$CMD" = "admin-email" ] && [ -z "$CMD_ARG" ]; then
        CMD_ARG="$arg"
        continue
      fi
      [ -z "$CMD" ] || fail "Prea multe comenzi: $*. Vezi: scripts/sentiq.sh help"
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
  admin-email) cmd_admin email ;;
  admin-reset) cmd_admin reset ;;
  db-check) cmd_db check ;;
  import-sqlite) cmd_db import ;;
  help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
