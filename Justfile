set shell := ['bash', '-euo', 'pipefail', '-c']

steam_common := env('STEAM_COMMON', home_directory() / '.local/share/Steam/steamapps/common')
server_dir := env('SVEN_SERVER_DIR', steam_common / 'Sven Co-op Dedicated Server')
client_dir := env('SVEN_CLIENT_DIR', steam_common / 'Sven Co-op')
cstrike_dir := env('CSTRIKE_DIR', steam_common / 'Half-Life/cstrike')
state_root := env('CL_STATE_DIR', justfile_directory() / '.e2e')

default:
  @just --list

# Copy plugin scripts, assets and CS 1.6 imports into an install's svencoop_addon: just install
[group('deploy')]
install target=server_dir:
  #!/usr/bin/env bash
  set -euo pipefail
  addon='{{target}}/svencoop_addon'
  mkdir -p "$addon/scripts/plugins" "$addon/sprites/cs16"
  rsync -a '{{justfile_directory()}}/scripts/' "$addon/scripts/plugins/"
  rsync -a '{{justfile_directory()}}'/{models,sprites,sound,events,maps} "$addon/"
  cp '{{justfile_directory()}}/default_plugins.txt' "$addon/default_plugins.txt"
  # CS 1.6 assets come from the local Counter-Strike install, not from git.
  rg -v '^\s*(#|$)' '{{justfile_directory()}}/cstrike-assets.txt' | while read -r asset; do
    test -f '{{cstrike_dir}}/'"$asset" || { echo "missing CS 1.6 asset: {{cstrike_dir}}/$asset" >&2; exit 1; }
    install -D -m 644 '{{cstrike_dir}}/'"$asset" "$addon/$(dirname "$asset")/cs16/$(basename "$asset")"
  done
  echo "installed into $addon"

# Start a dedicated server in the background with a command pipe: just server 27015 hl_c01_a1
[group('server')]
server port='27015' map='hl_c01_a1' *args: (install server_dir) (stop port)
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/server-{{port}}'
  mkdir -p "$state" && rm -f "$state/in" && mkfifo "$state/in"
  cd '{{server_dir}}'
  export LD_LIBRARY_PATH="$PWD:$PWD/redist:${LD_LIBRARY_PATH:-}"
  # The holder keeps the pipe open so the server never reads EOF between commands.
  sleep infinity > "$state/in" &
  echo $! > "$state/holder.pid"
  ./svends_i686 -console -port {{port}} +maxplayers 8 +sv_lan 1 +sv_cheats 1 +map {{map}} {{args}} < "$state/in" > "$state/server.log" 2>&1 &
  echo $! > "$state/server.pid"
  for _ in $(seq 1 60); do
    rg -q 'Started map' "$state/server.log" && { echo "server {{port}} up on {{map}}"; exit 0; }
    kill -0 "$(cat "$state/server.pid")" 2>/dev/null || { tail -40 "$state/server.log"; exit 1; }
    sleep 1
  done
  echo "server {{port}} did not start a map within 60 s" >&2; exit 1

# Send a console command to a running server: just cmd 27015 'as_listplugins'
[group('server')]
cmd port +command:
  @printf '%s\n' '{{command}}' > '{{state_root}}/server-{{port}}/in'

# Print the last lines of a server's console log: just log 27015 80
[group('server')]
log port='27015' lines='60':
  @tail -n {{lines}} '{{state_root}}/server-{{port}}/server.log'

# Stop a background server and its command pipe: just stop 27015
[group('server')]
stop port='27015':
  #!/usr/bin/env bash
  state='{{state_root}}/server-{{port}}'
  for pidfile in "$state/server.pid" "$state/holder.pid"; do
    test -f "$pidfile" && kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  done
  rm -f "$state/in"

# Show errors and warnings from the newest AngelScript log of an install: just aslog
[group('server')]
aslog target=server_dir:
  #!/usr/bin/env bash
  set -euo pipefail
  newest=$(ls -t '{{target}}/svencoop/logs/Angelscript/'* | head -1)
  echo "$newest"
  rg -n 'ERROR|WARNING|failed' "$newest" || echo 'no AngelScript errors'

# Compile-check all plugins on a throwaway server and fail on AngelScript errors: just check 27015
[group('server')]
check port='27015' map='hl_c01_a1':
  #!/usr/bin/env bash
  set -euo pipefail
  logdir='{{server_dir}}/svencoop/logs/Angelscript'
  # The AngelScript log is one file per day, so only read what this run appends.
  before=$(cat "$logdir"/* 2>/dev/null | wc -l)
  just server {{port}} {{map}}
  sleep 3
  just stop {{port}}
  fresh=$(cat "$logdir"/* | tail -n +$((before + 1)))
  echo "$fresh"
  if rg -q 'ERROR|failed' <<< "$fresh"; then exit 1; fi
  echo 'plugins compiled cleanly'
