set shell := ['bash', '-euo', 'pipefail', '-c']

steam_common := env('STEAM_COMMON', home_directory() / '.local/share/Steam/steamapps/common')
server_base := env('SVEN_SERVER_BASE', steam_common / 'Sven Co-op Dedicated Server')
server_dir := env('SVEN_SERVER_DIR', server_base)
client_dir := env('SVEN_CLIENT_DIR', steam_common / 'Sven Co-op')
cstrike_dir := env('CSTRIKE_DIR', steam_common / 'Half-Life/cstrike')
state_root := env('CL_STATE_DIR', justfile_directory() / '.e2e')
steam_runtime := env('STEAM_RUNTIME_RUN', home_directory() / '.local/share/Steam/ubuntu12_32/steam-runtime/run.sh')
display := env('CL_DISPLAY', ':99')
resolution := env('CL_RESOLUTION', '1600x900')
listen_port := env('CL_LISTEN_PORT', '27045')
# Machine-wide e2e client bookkeeping, shared by every worktree.
client_state := env('CL_CLIENT_STATE', home_directory() / '.local/state/counter-life')
client_registry := client_state / 'clients'
client_original := client_state / 'client-original'

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
  rg -v '^\s*(#|$)' '{{justfile_directory()}}/cstrike-assets.txt' | while read -r asset destination; do
    test -f '{{cstrike_dir}}/'"$asset" || { echo "missing CS 1.6 asset: {{cstrike_dir}}/$asset" >&2; exit 1; }
    install -D -m 644 '{{cstrike_dir}}/'"$asset" "$addon/${destination:-$(dirname "$asset")/cs16/$(basename "$asset")}"
  done
  echo "installed into $addon"

# Start a dedicated server (no install; run just install first) with a command pipe: just server 27015 hl_c01_a1
[group('server')]
server port='27015' map='hl_c01_a1' *args: (stop port)
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/server-{{port}}'
  mkdir -p "$state" && rm -f "$state/in" && mkfifo "$state/in"
  cd '{{server_dir}}'
  export LD_LIBRARY_PATH="$PWD:$PWD/redist:${LD_LIBRARY_PATH:-}"
  # The holder keeps the pipe open so the server never reads EOF between commands.
  sleep infinity > "$state/in" 2>/dev/null < /dev/null &
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
  # The AngelScript log is one file per day, so only read what this run appends. A new sandbox has no log until a
  # script prints something, so an empty glob must read as no lines (/dev/null keeps cat off stdin).
  shopt -s nullglob
  before=$(cat "$logdir"/* /dev/null | wc -l)
  just install && just server {{port}} {{map}}
  sleep 3
  just stop {{port}}
  fresh=$(cat "$logdir"/* /dev/null | tail -n +$((before + 1)))
  echo "$fresh"
  if rg -q 'ERROR|failed' <<< "$fresh"; then exit 1; fi
  echo 'plugins compiled cleanly'

# Start the offscreen X display that e2e runs render into: just display
[group('e2e')]
display:
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/display'
  mkdir -p "$state"
  test -f "$state/xvfb.pid" && kill -0 "$(cat "$state/xvfb.pid")" 2>/dev/null && exit 0
  Xvfb '{{display}}' -screen 0 '{{resolution}}x24' -nolisten tcp +extension GLX > "$state/xvfb.log" 2>&1 < /dev/null &
  echo $! > "$state/xvfb.pid"
  for _ in $(seq 1 40); do DISPLAY='{{display}}' xdpyinfo >/dev/null 2>&1 && exit 0; sleep 0.25; done
  echo 'Xvfb did not come up' >&2; exit 1

# Launch the Sven Co-op client offscreen; extra args go to the game: just client +connect 127.0.0.1:27017
[group('e2e')]
client +args: display client-stop
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/client'
  mkdir -p "$state" '{{client_registry}}' '{{client_original}}'
  # The engine rewrites the video mode and cvars on exit. Keep one machine-wide copy of the player's
  # real files, refreshed only while no e2e client runs, so parallel runs never back up a test config.
  live=$(fd -t f . '{{client_registry}}' -x sh -c 'kill -0 -"$(cat {})" 2>/dev/null && echo {}' | wc -l)
  if [ "$live" -eq 0 ]; then
    cp '{{client_dir}}/svencoop.conf' '{{client_dir}}/svencoop/config.cfg' '{{client_original}}/'
  fi
  res='{{resolution}}'
  cd '{{client_dir}}'
  # -nosound crashes Sven's client in HUD_DrawTransparentTriangles, so mute with volume cvars instead.
  DISPLAY='{{display}}' SDL_VIDEODRIVER=x11 SteamAppId=225840 SteamGameId=225840 \
    setsid '{{steam_runtime}}' ./svencoop.sh -nosteamoverlay -nobreakpad -novid -windowed \
    -w "${res%x*}" -h "${res#*x}" -port {{listen_port}} +volume 0 +MP3Volume 0 +net_graph 0 +cl_showfps 0 {{args}} \
    > "$state/client.log" 2>&1 < /dev/null &
  echo $! > "$state/client.pgid"
  echo $! > '{{client_registry}}'/"$!"
  echo "client starting (log: $state/client.log)"

# Stop the offscreen client; the last running e2e client restores the player's video settings and cvars: just client-stop
[group('e2e')]
client-stop:
  #!/usr/bin/env bash
  state='{{state_root}}/client'
  if test -f "$state/client.pgid"; then
    pgid=$(cat "$state/client.pgid")
    kill -- "-$pgid" 2>/dev/null
    # Restore only after the game is gone, or a late exit could write its test config over the restore.
    for _ in $(seq 1 50); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$pgid" 2>/dev/null || true
    rm -f "$state/client.pgid" '{{client_registry}}'/"$pgid"
  fi
  live=$(fd -t f . '{{client_registry}}' -x sh -c 'kill -0 -"$(cat {})" 2>/dev/null && echo {}' 2>/dev/null | wc -l)
  if [ "$live" -eq 0 ] && test -f '{{client_original}}/svencoop.conf'; then
    cp '{{client_original}}/svencoop.conf' '{{client_dir}}/svencoop.conf'
    cp '{{client_original}}/config.cfg' '{{client_dir}}/svencoop/config.cfg'
  fi

# Press keys in the offscreen game (xdotool key names): just ui Return
[group('e2e')]
ui +keys:
  @DISPLAY='{{display}}' xdotool key --delay 80 {{keys}}

# Run a console command in the offscreen game: just con 'give weapon_ak47'
[group('e2e')]
con +command:
  #!/usr/bin/env bash
  set -euo pipefail
  export DISPLAY='{{display}}'
  xdotool key grave && sleep 0.6
  xdotool type --delay 30 '{{command}}' && xdotool key Return && sleep 0.4
  xdotool key grave && sleep 0.5

# Save a screenshot of the offscreen display: just shot ak47-idle
[group('e2e')]
shot name:
  @mkdir -p '{{state_root}}/shots'
  @import -display '{{display}}' -window root '{{state_root}}/shots/{{name}}.png'
  @echo '{{state_root}}/shots/{{name}}.png'

# Add the e2e helper plugin (tests/e2e) to an install that already has the game content: just install-e2e
[group('e2e')]
install-e2e target=server_dir:
  #!/usr/bin/env bash
  set -euo pipefail
  addon='{{target}}/svencoop_addon'
  install -D -m 644 '{{justfile_directory()}}/tests/e2e/e2e.as' "$addon/scripts/plugins/e2e/e2e.as"
  rg -q '"e2e/e2e"' "$addon/default_plugins.txt" && exit 0
  # Insert the e2e plugin block before the closing brace of the plugin list.
  sed -i '$ d' "$addon/default_plugins.txt"
  printf '\t"plugin"\n\t{\n\t\t"name" "Counter-Life E2E"\n\t\t"script" "e2e/e2e"\n\t\t"concommandns" "e2e"\n\t}\n}\n' >> "$addon/default_plugins.txt"
  echo "e2e plugin added to $addon"

# Create an isolated server root (symlinks plus its own addon, logs and plugin store): just sandbox /abs/path/.svends-hud
[group('server')]
sandbox dir:
  #!/usr/bin/env bash
  set -euo pipefail
  test -d '{{dir}}/svencoop' && { echo 'sandbox already exists: {{dir}}'; exit 0; }
  cp -as '{{server_base}}' '{{dir}}'
  # Paths our install or the server writes must be real directories so a run never touches the shared install.
  for writable in svencoop_addon svencoop/logs svencoop/scripts/plugins/store; do
    rm -rf '{{dir}}'/"$writable" && mkdir -p '{{dir}}'/"$writable"
  done
  echo 'sandbox ready; use it with: export SVEN_SERVER_DIR={{dir}}'

# Shoot a pinned scientist with a CS weapon and capture the kill feed: just e2e-killfeed 27017 weapon_csdeagle head
[group('e2e')]
e2e-killfeed port='27017' weapon='weapon_csdeagle' aim='head':
  deno run -A '{{justfile_directory()}}/tests/e2e/killfeed.ts' {{port}} {{weapon}} {{aim}}

# Walk through every CS HUD state on testcenter and save shots plus HUD crops: just e2e-hud 27017 hud
[group('e2e')]
e2e-hud port='27017' label='hud':
  deno run -A '{{justfile_directory()}}/tests/e2e/hud.ts' {{port}} {{label}}

# Measure HUD-coloured glyph boxes in a screen region (JSON): just hudboxes .e2e/reference/cs16-ref-hud.png 0 820 460 80
[group('e2e')]
hudboxes image x y w h:
  deno run -A '{{justfile_directory()}}/tests/e2e/hudboxes.ts' '{{image}}' {{x}} {{y}} {{w}} {{h}}
