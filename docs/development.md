# Development and end-to-end tests

This page tells you how to install Counter-Life on a test server, how to drive the game without a monitor, and how to
compare the result with Counter-Strike 1.6. All commands are `just` recipes in the `Justfile`. Run `just --list` to see
them.

## Requirements

- Sven Co-op and the Sven Co-op Dedicated Server (Steam).
- Half-Life with Counter-Strike 1.6 (Steam). The install recipe copies some CS 1.6 files from it. These files are not in
  git.
- `just`, `deno`, `rsync`, `rg`, `fd`, `Xvfb`, `xdotool`, `xdpyinfo` and ImageMagick (`magick`, `import`).
- Steam must run, because the game clients ask Steam for the login.

## Paths

The recipes find the installs with these environment variables. The defaults are the Steam library paths.

| Variable           | Default                                     | Use                                         |
| ------------------ | ------------------------------------------- | ------------------------------------------- |
| `STEAM_COMMON`     | `~/.local/share/Steam/steamapps/common`     | root of the other defaults                  |
| `SVEN_SERVER_BASE` | `$STEAM_COMMON/Sven Co-op Dedicated Server` | source of server sandboxes                  |
| `SVEN_SERVER_DIR`  | `$SVEN_SERVER_BASE`                         | server that `install` and `server` use      |
| `SVEN_CLIENT_DIR`  | `$STEAM_COMMON/Sven Co-op`                  | game client for the offscreen tests         |
| `CSTRIKE_DIR`      | `$STEAM_COMMON/Half-Life/cstrike`           | CS 1.6 files listed in `cstrike-assets.txt` |
| `CL_DISPLAY`       | `:99`                                       | offscreen X display                         |
| `CL_RESOLUTION`    | `1600x900`                                  | offscreen screen size                       |
| `CL_STATE_DIR`     | `.e2e` in the repository                    | logs, pipes and screenshots                 |
| `CL_LISTEN_PORT`   | `27045`                                     | port of a client-hosted game                |

## Install on a server

1. Make an isolated server root. It contains symbolic links to the real server and its own `svencoop_addon`, logs and
   plugin store, so parallel runs do not change the shared install:

   ```sh
   just sandbox "$PWD/../.svends-dev"
   export SVEN_SERVER_DIR="$PWD/../.svends-dev"
   ```

2. Copy the plugins, the assets and the CS 1.6 imports into the server:

   ```sh
   just install
   ```

   Each line of `cstrike-assets.txt` is a path in `cstrike/` and an optional destination in `svencoop_addon/`. Without a
   destination, the file goes to `<dir>/cs16/<file>`. A client does not download a file again when it has a file with
   that path, so a changed file must get a new path. Use a path that other packs do not use: player caches can hold
   other files at `sprites/cs16/640hud*.spr`, so the weapon list sheets go to `sprites/cs16/icons/`.

3. Do a compile check. The recipe starts a server, reads the AngelScript log of this run only, and fails on an error:

   ```sh
   just check 27015
   ```

## Run a server

```sh
just server 27015 testcenter      # start in the background
just cmd 27015 'as_plugins'       # send a console command
just log 27015 40                 # read the console
just stop 27015
```

## Drive the game client without a monitor

The client runs on an Xvfb display, so it does not take over the desktop. Input goes through `xdotool`, and screenshots
come from the display. The engine writes its video mode and cvars when it exits. Thus the recipes keep one copy of the
player's real files (in `~/.local/state/counter-life`) and the last test client to stop puts them back.

```sh
just client +connect 127.0.0.1:27015   # start the offscreen client
just ui Return                          # press keys
just con 'weapon_ak47'                  # type a console command
just shot ak47                          # screenshot to .e2e/shots/ak47.png
just client-stop
```

Known client problems:

- Do not use `-nosound`. The Sven client then crashes in `HUD_DrawTransparentTriangles`. The recipe mutes with
  `volume 0` instead.
- Sven refuses cheat commands such as `give` for a player who is not an administrator. Use the test plugin below.

## Test plugin

`just install-e2e` adds `tests/e2e/e2e.as` to the server. Use it from the server console with `as_command`:

| Command                             | Effect                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `e2e.spawn <class> [distance]`      | spawn in front of player 1; a monster stops moving after 1 s             |
| `e2e.aim [head\|body] [class]`      | turn player 1 to the nearest live monster; prints the number still alive |
| `e2e.kill [head\|body] [n] [class]` | kill the nearest monsters with the held weapon as the inflictor          |
| `e2e.give <class>`                  | give player 1 an item                                                    |
| `e2e.health <n>`, `e2e.armor <n>`   | set health or armour                                                     |
| `e2e.hurt <n>`                      | damage player 1 from the world                                           |
| `e2e.stuff <command>`               | run a console command on the client (the client can refuse some of them) |

## Scenarios

```sh
just e2e-killfeed 27017 weapon_m4a1 head   # shoot a scientist, save the kill feed
just e2e-hud 27017 run1                    # 15 HUD states with crops of each HUD region
just e2e-hudproof 27017                    # prove the CS HUD foundation (needs a sandbox, see below)
```

The scenarios start the server and the client themselves and print a JSON list of the screenshots.

`e2e-hudproof` adds a proof element to the sandbox copy of the plugin, so set `SVEN_SERVER_DIR` to a sandbox. It fails
on any failed check and writes `report.json` and evidence crops to `.e2e/proof`. See `docs/hud-architecture.md`.

## Compare with Counter-Strike 1.6

Take a reference screenshot of CS 1.6 at the same resolution, then measure the HUD glyphs in both images:

```sh
just hudboxes .e2e/reference/cs16-ref-hud.png 0 820 460 80
just hudboxes .e2e/shots/run1-spawn.png 0 820 460 80
```

Each line is the box of one HUD-coloured glyph in screen pixels. CS 1.6 draws its HUD sprites 1:1 at every resolution
and anchors them to the screen edges, so the boxes must match.

### Kill-feed reference

`just fixture-killfeed` runs Valve's CS 1.6 client offscreen against a ReGameDLL_CS listen server, kills bots with an
M4A1 and saves the kill feed to `.e2e/reference/cs16-killfeed-<W>x<H>-*.png`. Measure a Counter-Life screenshot the same
way, against a frame of the same view without notices:

```sh
just fixture-killfeed :96 2560x1440
just fixture-metrics .e2e/shots/run1-killfeed.png .e2e/shots/run1-killfeed-before.png
```

[CS 1.6 kill-feed reference](research/cs16-killfeed-reference.md) describes the fixture and the measured layout.
