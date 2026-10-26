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
  # The CS HUD number sprites are composed from the same install (docs/hud-sprites.md).
  deno run -R='{{cstrike_dir}}' -W="$addon/sprites/cs16/hud" '{{justfile_directory()}}/tools/hudgen.ts' \
    '{{cstrike_dir}}' "$addon/sprites/cs16/hud" > /dev/null
  echo "installed into $addon"

# Rebuild the *_r2 view models, whose muzzle events draw the CS 1.6 flash, from the originals in a git ref: just muzzle-models
[group('deploy')]
muzzle-models ref='435d391':
  #!/usr/bin/env bash
  set -euo pipefail
  cd '{{justfile_directory()}}'
  original=$(mktemp) && trap 'rm -f "$original"' EXIT
  # model (under models/cs16/wpn) and its event rules; sizes and attachments: docs/research/muzzle-flash.md
  while read -r model rules; do
    git show '{{ref}}':"models/cs16/wpn/$model.mdl" > "$original"
    deno run -R -W tools/mdlpatch.ts "$original" "models/cs16/wpn/${model}_r2.mdl" $rules > /dev/null
    echo "models/cs16/wpn/${model}_r2.mdl"
  done <<'EOF'
  57/v_57 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  awp/v_awp 5001:31=5005:cs16_muzzleflash2_s9_a0.txt
  eagle/v_eagle 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
  elite/v_elite 5001:11=5005:cs16_muzzleflash2_s3_a0.txt 5011:11=5005:cs16_muzzleflash2_s3_a1.txt
  g18/v_glock18 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
  m3/v_m3 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
  m4a1/v_m4a1 5021:11=5005:cs16_muzzleflash2_s3_a2.txt 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  mac10/v_mac10 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  mp5/v_mp5 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  p228/v_p228 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  scout/v_scout 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
  tmp/v_tmp 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  ump45/v_ump45 5001:11=5005:cs16_muzzleflash2_s3_a0.txt
  usp/v_usp 5001:11=5005:cs16_muzzleflash2_s3_a0.txt 5021:11=5005:cs16_muzzleflash2_s3_a2.txt
  xm1014/v_xm1014 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
  ak47/v_ak47 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  aug/v_aug 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  famas/v_famas 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  galil/v_galil 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  g3sg1/v_g3sg1 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  m249/v_m249 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  sg550/v_sg550 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  sg552/v_sg552 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s7_a0.txt
  p90/v_p90 5005:cs16_flashx.txt=5005:cs16_muzzleflash3_s4_a0.txt
  EOF

# Start a dedicated server (no install; run just install first) with a command pipe: just server 27015 hl_c01_a1
[group('server')]
server port='27015' map='hl_c01_a1' *args: (stop port)
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/server-{{port}}'
  mkdir -p "$state" && rm -f "$state/in" && mkfifo "$state/in"
  printf '%s\n%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" '{{server_dir}}' > "$state/run"
  cd '{{server_dir}}'
  export LD_LIBRARY_PATH="$PWD:$PWD/redist:${LD_LIBRARY_PATH:-}"
  # The holder keeps the pipe open so the server never reads EOF between commands.
  sleep infinity > "$state/in" 2>/dev/null < /dev/null &
  echo $! > "$state/holder.pid"
  ./svends_i686 -console -nobreakpad -port {{port}} +maxplayers 8 +sv_lan 1 +sv_cheats 1 +map {{map}} {{args}} < "$state/in" > "$state/server.log" 2>&1 &
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
  server=$(cat "$state/server.pid" 2>/dev/null || true)
  for pidfile in "$state/server.pid" "$state/holder.pid"; do
    test -f "$pidfile" && kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  done
  rm -f "$state/in"
  test -f "$state/run" || exit 0
  # After the exit, a farm symlink whose target changed during the run means the server wrote into the shared
  # install: that path needs a copy in the sandbox recipe.
  for _ in $(seq 1 50); do test -n "$server" && kill -0 "$server" 2>/dev/null || break; sleep 0.1; done
  { read -r started; read -r dir; } < "$state/run"
  rm -f "$state/run"
  escaped=$(fd -L -HI -t f --changed-within "$started" . "$dir" | while read -r path; do test -L "$path" && echo "$path"; done)
  test -z "$escaped" || printf 'WARNING: the server wrote through sandbox symlinks into the shared install:\n%s\n' "$escaped" >&2

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
  if ! test -d '{{dir}}/svencoop'; then
    cp -as '{{server_base}}' '{{dir}}'
    # Paths our install or the server writes must be real directories so a run never touches the shared install.
    for writable in svencoop_addon svencoop/logs svencoop/scripts/plugins/store; do
      rm -rf '{{dir}}'/"$writable" && mkdir -p '{{dir}}'/"$writable"
    done
  fi
  # The server rewrites some files in place (node graphs, sound caches, spray decals and their log, the Steam app id),
  # and it writes through a farm symlink into the shared install. Replace those links with copies; this also repairs
  # old sandboxes.
  cd '{{dir}}'
  rewritten='svencoop/maps/graphs svencoop/maps/soundcache svencoop/custom.hpk svencoop/custom.hpk.log steam_appid.txt'
  { find $rewritten -type l 2>/dev/null || true; } | while read -r link; do
    cp --remove-destination "$(readlink -f "$link")" "$link"
  done
  echo 'sandbox ready; use it with: export SVEN_SERVER_DIR={{dir}}'

# Shoot a pinned scientist with a CS weapon and capture the kill feed: just e2e-killfeed 27017 weapon_csdeagle head
[group('e2e')]
e2e-killfeed port='27017' weapon='weapon_csdeagle' aim='head':
  deno run -A '{{justfile_directory()}}/tests/e2e/killfeed.ts' {{port}} {{weapon}} {{aim}}

# Show that Sven's obituaries stay out of the notify area with the metamod plugin: just e2e-obituary 27017
[group('e2e')]
e2e-obituary port='27017':
  deno run -A '{{justfile_directory()}}/tests/e2e/obituary.ts' {{port}}

# Walk through every CS HUD state on testcenter and save shots plus HUD crops: just e2e-hud 27017 hud
[group('e2e')]
e2e-hud port='27017' label='hud':
  deno run -A '{{justfile_directory()}}/tests/e2e/hud.ts' {{port}} {{label}}

# Measure HUD-coloured glyph boxes in a screen region (JSON): just hudboxes .e2e/reference/cs16-ref-hud.png 0 820 460 80
[group('e2e')]
hudboxes image x y w h:
  deno run -A '{{justfile_directory()}}/tests/e2e/hudboxes.ts' '{{image}}' {{x}} {{y}} {{w}} {{h}}

# Fire weapons in a game that runs on a display and measure each muzzle flash (JSON): just e2e-muzzleflash :102 .e2e/muzzle/sven 1000x660+500+240 deagle=weapon_csdeagle
[group('e2e')]
[no-cd]
[positional-arguments]
e2e-muzzleflash +args:
  deno run -A '{{justfile_directory()}}/tests/e2e/muzzleflash.ts' "$@"

# Render the HUD sprite contact sheet and check it against a CS 1.6 screenshot: just hud-sheet /abs/cs16-ref-hud.png
[group('tools')]
hud-sheet screenshot out=(justfile_directory() / 'docs/hud-sprites/contact-sheet.png'):
  deno run -R -W --allow-run=magick '{{justfile_directory()}}/tools/hudsheet.ts' '{{cstrike_dir}}' '{{screenshot}}' '{{out}}'

# CS 1.6 kill-feed reference fixture: Valve's CS 1.6 client against a ReGameDLL_CS listen server (bots and "give").
hl_dir := env('HL_DIR', steam_common / 'Half-Life')
# Worktrees share the main checkout's .git, so its parent is the project root that holds ReGameDLL_CS.
project_root := env('CL_PROJECT_ROOT', parent_directory(parent_directory(`git rev-parse --path-format=absolute --git-common-dir`)))
regamedll_dir := env('REGAMEDLL_DIR', project_root / 'ReGameDLL_CS')
fixture_root := env('CS_FIXTURE_ROOT', project_root / '.hl-fixture')
fixture_display := env('CS_FIXTURE_DISPLAY', ':97')

# Build ReGameDLL_CS (cstrike/dlls/cs.so, Linux i386) in an untracked build tree: just fixture-build
[group('fixture')]
fixture-build source=regamedll_dir:
  #!/usr/bin/env bash
  set -euo pipefail
  # Upstream asks for CMake 3.1; CMake 4 refuses that without a policy floor.
  cmake -S '{{source}}' -B '{{source}}/build-linux-i386' -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -Wno-deprecated > /dev/null
  cmake --build '{{source}}/build-linux-i386' -j "$(nproc)"
  file '{{source}}/build-linux-i386/regamedll/cs.so'

# Create or refresh the isolated Half-Life root (symlink farm, real ReGameDLL and writable files): just fixture-root
[group('fixture')]
fixture-root root=fixture_root source=regamedll_dir map='de_dust2': (fixture-build source)
  #!/usr/bin/env bash
  set -euo pipefail
  test -d '{{root}}/cstrike' || cp -as '{{hl_dir}}' '{{root}}'
  # The engine and VGUI rewrite config files; written through a farm symlink they would change the shared install.
  for file in '{{root}}'/hl.conf '{{root}}'/cstrike/*.{cfg,dt,vdf} '{{root}}'/platform/config/*; do
    if test -L "$file"; then cp --remove-destination "$(readlink "$file")" "$file"; fi
  done
  cp --remove-destination '{{source}}/build-linux-i386/regamedll/cs.so' '{{root}}/cstrike/dlls/cs.so'
  # ZBot reads Condition Zero's bot profiles and navigation mesh; CS 1.6 ships neither.
  cp --remove-destination '{{hl_dir}}'/czero/{BotProfile.db,BotChatter.db} '{{root}}/cstrike/'
  cp --remove-destination '{{hl_dir}}/czero/maps/{{map}}.nav' '{{root}}/cstrike/maps/'
  cp --remove-destination '{{justfile_directory()}}/tests/fixture/fixture.cfg' '{{root}}/cstrike/'
  echo 'fixture root ready: {{root}}'

# Launch CS 1.6 offscreen on its own Xvfb display; one game per fixture root at a time: just fixture-start :96 2560x1440
[group('fixture')]
fixture-start display=fixture_display resolution='1600x900' port='27049' clientport='27007' map='de_dust2' root=fixture_root: (fixture-stop display root)
  #!/usr/bin/env bash
  set -euo pipefail
  state='{{state_root}}/fixture-{{trim_start_match(display, ":")}}'
  mkdir -p "$state"
  export DISPLAY='{{display}}'
  Xvfb '{{display}}' -screen 0 '{{resolution}}x24' -nolisten tcp +extension GLX > "$state/xvfb.log" 2>&1 &
  echo $! > "$state/xvfb.pid"
  for _ in $(seq 1 40); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.25; done
  date '+%Y-%m-%d %H:%M:%S' > "$state/started-at"
  rm -f '{{root}}/qconsole.log'
  res='{{resolution}}'
  cd '{{root}}'
  SDL_VIDEODRIVER=x11 SteamAppId=10 SteamGameId=10 setsid '{{steam_runtime}}' ./hl.sh -steam -game cstrike \
    -novid -nobreakpad -windowed -condebug -w "${res%x*}" -h "${res#*x}" -port {{port}} +clientport {{clientport}} \
    +lservercfgfile fixture.cfg +sv_lan 1 +maxplayers 12 +map {{map}} > "$state/game.log" 2>&1 &
  echo $! > "$state/game.pgid"
  for _ in $(seq 1 240); do
    # The runtime lacks en_US.UTF-8, so the engine first shows a blocking SDL message box; press its OK button.
    if dialog=$(xdotool search --name '^Warning$' 2>/dev/null | head -1) && test -n "$dialog"; then
      eval "$(xdotool getwindowgeometry --shell "$dialog")"
      ok_button_from_bottom=27
      xdotool mousemove --window "$dialog" $((WIDTH / 2)) $((HEIGHT - ok_button_from_bottom)) click 1
    fi
    if rg -q 'is joining the Counter-Terrorist force' '{{root}}/qconsole.log' 2>/dev/null; then
      sleep 3
      echo 'CS 1.6 in game on {{display}} ({{resolution}}); console log: {{root}}/qconsole.log'
      exit 0
    fi
    kill -0 "$(cat "$state/game.pgid")" 2>/dev/null || { tail -20 "$state/game.log"; exit 1; }
    sleep 0.5
  done
  echo 'CS 1.6 did not reach the game within 120 s' >&2
  exit 1

# Stop the offscreen CS 1.6 and its Xvfb, then list writes that escaped the fixture root: just fixture-stop :97
[group('fixture')]
fixture-stop display=fixture_display root=fixture_root:
  #!/usr/bin/env bash
  state='{{state_root}}/fixture-{{trim_start_match(display, ":")}}'
  if test -f "$state/game.pgid"; then
    pgid=$(cat "$state/game.pgid")
    kill -- "-$pgid" 2>/dev/null
    # The engine writes its config files while it exits: wait for the exit before the leak check, then force it.
    for _ in $(seq 1 50); do kill -0 -- "-$pgid" 2>/dev/null || break; sleep 0.2; done
    kill -9 -- "-$pgid" 2>/dev/null || true
  fi
  test -f "$state/xvfb.pid" && kill "$(cat "$state/xvfb.pid")" 2>/dev/null
  rm -f "$state/game.pgid" "$state/xvfb.pid"
  test -f "$state/started-at" || exit 0
  # A farm symlink whose target changed during the run means a write went into the shared install.
  escaped=$(fd -L -HI -t f --changed-within "$(cat "$state/started-at")" . '{{root}}' | while read -r path; do
    if test -L "$path"; then echo "$path -> $(readlink "$path")"; fi
  done)
  test -z "$escaped" || printf 'WARNING: the run wrote through fixture symlinks into the shared install:\n%s\n' "$escaped" >&2
  rm -f "$state/started-at"

# Capture the kill-feed reference screenshots into .e2e/reference (de_dust2 only): just fixture-killfeed :96 2560x1440
[group('fixture')]
fixture-killfeed display=fixture_display resolution='1600x900' port='27049' clientport='27007' root=fixture_root: (fixture-root root regamedll_dir 'de_dust2') (fixture-start display resolution port clientport 'de_dust2' root)
  #!/usr/bin/env bash
  set -euo pipefail
  trap "just fixture-stop '{{display}}' '{{root}}'" EXIT
  mkdir -p '{{state_root}}/reference'
  deno run -A '{{justfile_directory()}}/tests/fixture/killfeed.ts' '{{display}}' '{{resolution}}' \
    '{{root}}/qconsole.log' '{{state_root}}/reference' '{{resolution}}'

# Measure the kill feed of a screenshot against a frame of the same view without notices: just fixture-metrics a.png a-before.png
[group('fixture')]
[no-cd]
fixture-metrics shot before:
  @deno run -A '{{justfile_directory()}}/tests/fixture/feed-metrics.ts' '{{shot}}' '{{before}}'

# Counter-Life metamod plugin (metamod/counterlife, docs/metamod.md). The metamod-svencoop release is the one that
# metamod-p-rs pins: plugins built with its headers (interface 5:16) need this release or a newer one.
metamod_release := 'v20261009a'
metamod_archive := 'metamod-fallguys-ubuntu-i386.zip'
metamod_sha256 := '552ae6d1faf184498f29d0c686515f56618eb55229970d7a687d8d5c74ed2d78'
metamod_url := 'https://github.com/metamod-svencoop/metamod-svencoop/releases/download/' + metamod_release + '/' + metamod_archive
# The library that "-dll" loads instead of the game DLL, and the plugin; both relative to the game directory (svencoop).
metamod_dll := 'addons/metamod/dlls/metamod.so'
metamod_plugin := 'addons/counterlife/counterlife.so'

# Build the Counter-Life metamod plugin for i686 Linux: just metamod-build release
[group('metamod')]
[working-directory('metamod/counterlife')]
metamod-build profile='release':
  cargo build --profile {{profile}}

# Run the plugin's unit and fake-host tests (cargo nextest): just metamod-test
[group('metamod')]
[working-directory('metamod/counterlife')]
metamod-test *args:
  cargo nextest run {{args}}

# Check the plugin's formatting and run clippy with warnings as errors: just metamod-lint
[group('metamod')]
[working-directory('metamod/counterlife')]
metamod-lint:
  cargo fmt --check
  cargo clippy --all-targets -- -D warnings

# Install metamod-svencoop (pinned, SHA-256 checked) and the plugin into an install's svencoop/addons: just metamod-install
[group('metamod')]
metamod-install target=server_dir profile='release': (metamod-build profile)
  #!/usr/bin/env bash
  set -euo pipefail
  # plugins.ini and -dll take paths relative to the game directory.
  game='{{target}}/svencoop'
  download='{{state_root}}/metamod/{{metamod_release}}'
  archive="$download/{{metamod_archive}}"
  mkdir -p "$download" "$game/{{parent_directory(metamod_dll)}}" "$game/{{parent_directory(metamod_plugin)}}"
  if ! echo '{{metamod_sha256}}  '"$archive" | sha256sum --check --status 2>/dev/null; then
    curl -fsSL -o "$archive" '{{metamod_url}}'
    echo '{{metamod_sha256}}  '"$archive" | sha256sum --check
  fi
  rm -rf "$download/unpacked" && unzip -q "$archive" -d "$download/unpacked"
  # --remove-destination replaces a sandbox symlink instead of writing through it into the shared install.
  cp --remove-destination "$download"/unpacked/build/addons/metamod/dlls/* "$game/{{parent_directory(metamod_dll)}}/"
  cp --remove-destination \
    '{{justfile_directory()}}/metamod/counterlife/target/i686-unknown-linux-gnu/{{ if profile == "dev" { "debug" } else { profile } }}/libcounterlife.so' \
    "$game/{{metamod_plugin}}"
  # Keep the plugins that plugins.ini already loads; the plugins of the release stay off.
  ini="$game/addons/metamod/plugins.ini"
  if test -L "$ini"; then cp --remove-destination "$(readlink -f "$ini")" "$ini"; fi
  touch "$ini" && sed -i -e '$a\' "$ini"
  rg -qxF 'linux {{metamod_plugin}}' "$ini" || echo 'linux {{metamod_plugin}}' >> "$ini"
  echo "metamod {{metamod_release}} and the Counter-Life plugin are in $game/addons"

# Start a dedicated server with metamod (install it first with metamod-install): just server-metamod 27015 testcenter
[group('metamod')]
server-metamod port='27015' map='hl_c01_a1' *args: (server port map '-dll' metamod_dll args)

# Capture CS 1.6's view models, scopes and turned views on de_dust2 into <out>-<WxH> (docs/fov.md): just fixture-fov :96 2560x1440
[group('fixture')]
fixture-fov display=fixture_display resolution='1600x900' port='27049' clientport='27007' root=fixture_root out=(state_root / 'fov' / 'cs16'): (fixture-root root regamedll_dir 'de_dust2') (fixture-start display resolution port clientport 'de_dust2' root)
  #!/usr/bin/env bash
  set -euo pipefail
  trap "just fixture-stop '{{display}}' '{{root}}'" EXIT
  deno run -A '{{justfile_directory()}}/tests/fixture/fov.ts' '{{display}}' '{{resolution}}' '{{out}}-{{resolution}}'

# Measure FOV captures as JSON (view-model boxes, scope geometry, focal length): just fov-metrics .e2e/fov/cs16-1600x900
[group('fixture')]
[no-cd]
fov-metrics +dirs:
  @deno run -A '{{justfile_directory()}}/tests/fixture/fov-metrics.ts' {{dirs}}
