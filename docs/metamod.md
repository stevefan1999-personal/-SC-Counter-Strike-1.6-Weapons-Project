# Metamod plugin: no Sven Co-op obituaries (`metamod/counterlife`)

Sven Co-op prints each player death as one English line in the top-left notify area, for example
`Stefan fell or something.`. Counter-Strike 1.6 shows deaths only in its kill feed at the top right, which the
AngelScript plugin draws. No AngelScript API and no client cvar can stop the Sven line
([Sven HUD text research](research/sven-client-hudtext.md), section 6). A metamod plugin can, because metamod lets it
see each network message that the game sends.

The plugin is a Rust crate on the safe API of [metamod-p-rs](https://github.com/stevefan1999-personal/metamod-p-rs). It
loads in metamod-svencoop, its log tag is `CLIFE`, and the plugin code has no `unsafe` block.

## What the plugin does

1. It hooks `MESSAGE_BEGIN`, the eight typed writes (`WRITE_BYTE` to `WRITE_ENTITY`) and `MESSAGE_END` before the engine
   runs them.
2. It finds the id of the `TextMsg` user message with metamod's `GetUserMsgID`. The game registers its messages after
   metamod loads the plugin, so the plugin repeats the lookup until it gets the id. The id is not in the code.
3. It holds back each `TextMsg` to all players (`MSG_ALL` without an origin or a receiver, as `UTIL_ClientPrintAll`
   sends the obituary): it supersedes the `MESSAGE_BEGIN` and each write, and keeps each typed write with its value. The
   engine does not see the message.
4. At `MESSAGE_END` it drops the message if the message is exactly the destination byte `HUD_PRINTNOTIFY` (1) and one
   string that is an obituary line (see [Obituary lines](#obituary-lines)). It sends every other held message again to
   all players, with the same sequence of typed writes. It sends through the engine functions, which skip the hooks of
   all plugins.
5. Other messages go to the engine as usual. This includes each `TextMsg` to one player or to an area: Sven never sends
   an obituary that way, so these messages never meet the copy of this plugin.

Rules for open messages:

- The plugin keeps a stack of open messages. A message that starts inside a held `TextMsg` goes to the engine at once,
  and its writes do not go into the held message.
- A `TextMsg` that starts while the engine writes another message is not held. The plugin never starts a message while
  the engine has one open. (The engine stops the server for such a nested message also without the plugin.)
- The plugin does not hold a `TextMsg` to `MSG_ALL` with an origin or a receiver, which the engine ignores. It holds
  only a message that the safe API can start again exactly.
- A held message always ends without the engine. If the plugin cannot send the copy, it logs `lost a held TextMsg`.
- A write value outside the range of its type (for example `WRITE_BYTE(300)`) goes out with the same low bits, which is
  all that the engine sends. A `WRITE_ENTITY` of an index without a live entity goes out as `WRITE_SHORT`, which is how
  the engine sends an entity index.

The server cvar `cl_obituary_filter` (default `1`) turns the filter on. Set it to `0` to see the Sven lines again. With
`developer 1` on the server, the plugin logs each line that it drops, in the console and in `metamod.log`:

```text
[CLIFE] dev: dropped obituary "Stefan fell or something.\n"
```

## Obituary lines

`DeathNotice` of the multiplayer game rules (`server.so` 5.26, build 10269, 0x4261C4 to 0x426D97) builds the line.
`UTIL_ClientPrintAll` (0x546DEC) sends it as `TextMsg` to `MSG_ALL`: `WRITE_BYTE(1)`, `WRITE_STRING(line)`. Every line
ends with a line feed. The game rules call `DeathNotice` when a player dies; the scenario below shows no line when a
monster dies.

| Killer                                             | Line                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| a monster (`FL_MONSTER`)                           | `<victim> was killed by a <monster>.`, `an` if the name is empty or starts with a vowel |
| the victim                                         | `<victim> committed suicide.`                                                           |
| a player (`FL_CLIENT`)                             | `<killer> : <weapon> : <victim>`                                                        |
| `worldspawn`                                       | `<victim> drowned.` with `DMG_DROWN`, else `<victim> fell or something.`                |
| `func_tank`, `func_tanklaser` or `func_tankrocket` | `<victim> was killed by a mounted gun.`                                                 |
| another BSP entity (`SOLID_BSP`)                   | `<victim> was smashed.`                                                                 |
| `monster_mortar`                                   | `<victim> was blown to shreds by a mortar.`                                             |
| another entity: the first damage bit with a line   | `<victim> <ending>.`, endings below                                                     |
| another entity: no damage bit with a line          | `<victim> died mysteriously.`                                                           |

The weapon is the class name without `weapon_`, `monster_` or `func_`; `egon` becomes `gluon gun` and `gauss` becomes
`tau_cannon`. The endings of the damage bits, in the order of the tests: `was crushed`, `was shot`, `has been chopped`,
`burned down`, `froze to death`, `fell`, `blew up`, `was crowbared`, `was electrocuted`, `was killed by sound`,
`was cut by a laser`, `was gibbed`, `played catapult`, `drank too much`, `was paralyzed`, `has been poisoned`,
`has been dissolved`, `went nuclear`, `was baked like a cake`, `was blown to shreds by a mortar`,
`was executed by a Sniper`. `has been dissolved` (bit 0x100000) never shows, because the poison test (0x130000) comes
first.

The matcher (`src/obituary.rs`) is strict, because a line that it misses only shows the Sven text, but a line that it
drops in error hides a notice:

- The message must be the notify byte and one string, nothing more.
- The line must end with the line feed.
- The weapon must be one word of letters, digits and `_`, or `gluon gun`.
- The article must agree with the monster name.

A name can hold any character, so the matcher finds each format from its fixed parts. A notice of another plugin that
has exactly one of these forms, for example `The generator blew up.` with a line feed, is dropped too. A player name can
also make a notice match: with the name `a : b : c`, each notify line that holds this name and ends with a line feed
looks like `<killer> : <weapon> : <victim>`.

## Build and test

```sh
just metamod-build     # metamod/counterlife/target/i686-unknown-linux-gnu/release/libcounterlife.so
just metamod-test      # unit tests of the matcher and fake-host tests (cargo nextest)
just metamod-lint      # rustfmt and clippy, warnings are errors
just metamod-e2e       # dedicated server, this plugin, and a fake client
```

Requirements:

- Cargo downloads `metamod-p` from
  [metamod-p-rs](https://github.com/stevefan1999-personal/metamod-p-rs) at the `rev` in
  `metamod/counterlife/Cargo.toml`. The crate fetches the header trees when the checkout does not contain them.
- Rust nightly with the `i686-unknown-linux-gnu` target (`rust-toolchain.toml`), libclang, the 32-bit glibc and
  `cargo-nextest`, as for metamod-p-rs. On Windows, `just` builds `i686-pc-windows-msvc`.

`just metamod-e2e` boots the Sven Co-op dedicated server (`SVEN_SERVER_DIR`, or the Steam install), loads this plugin,
and joins with a fake client. GitHub Actions runs `just metamod-test` and `just metamod-e2e` on Linux and Windows.

The fake-host tests load the plugin through its C entry points, as metamod does. They send the game's message calls
through the plugin's hooks; the fake engine runs a call unless the hook superseded it, and records the engine's fatal
error for a nested `MESSAGE_BEGIN` or for a write or `MESSAGE_END` without a message. The tests compare the calls, or
the bytes, that reach the engine with the calls of the game.

## Install on a dedicated server

```sh
just metamod-install /path/to/server      # default: SVEN_SERVER_DIR
just server-metamod 27015 testcenter      # just server with -dll addons/metamod/dlls/metamod.so
```

`metamod-install` needs `curl`, `sha256sum` and `unzip`. It:

1. Downloads metamod-svencoop `v20261009a` (`metamod-fallguys-ubuntu-i386.zip`) to `.e2e/metamod/` and checks its
   SHA-256.
2. Copies `addons/metamod/dlls/` of the release (`metamod.so` and the plugins of the release) and the plugin
   (`addons/counterlife/counterlife.so`) into `svencoop/` of the install.
3. Adds `linux addons/counterlife/counterlife.so` to `svencoop/addons/metamod/plugins.ini` once. It keeps the lines that
   are in the file. The plugins of the release stay off.

The recipe replaces a symbolic link of a sandbox (`just sandbox`) with a file. It does not write through the link into
the shared install.

Start the server with `-dll addons/metamod/dlls/metamod.so`, or set `gamedll_linux "addons/metamod/dlls/metamod.so"` in
`svencoop/liblist.gam`. In the server console, `meta list` must show `Counter-Life ... RUN` and `meta cvars` must show
`cl_obituary_filter`.

## Listen server (a player hosts the game)

A listen server runs the game in the client. Thus metamod and the plugin must be in the client install:

1. Install them into the game directory of the client:
   `just metamod-install "$HOME/.local/share/Steam/steamapps/common/Sven Co-op"`. The files go to
   `Sven Co-op/svencoop/addons/` (not to `svencoop_addon`).
2. In Steam, open the properties of Sven Co-op and set the launch options to `-dll addons/metamod/dlls/metamod.so`.
3. Start a game from the menu. The game console accepts `cl_obituary_filter 0` and `cl_obituary_filter 1`.

The recipes build the plugin only for Linux. On Windows, metamod is `addons/metamod/dlls/metamod.dll` and the plugin
needs a build for `i686-pc-windows-msvc`.

## Interface version

From
[ADR 0001 of metamod-p-rs](https://github.com/stevefan1999-personal/metamod-p-rs/blob/master/docs/adr/0001-metamod-flavour.md):

- The plugin uses the headers of metamod-svencoop `v20261009a`, interface `5:16`.
- Metamod refuses a plugin with a newer minor interface:
  `requires a newer version of Metamod (Metamod needs at least interface 5:17 not the current 5:16)`.
- The plugin refuses a metamod with another major interface or an older minor interface, before it copies the utility
  table of metamod.
- Use metamod-svencoop `v20261009a` or a newer release with interface 5. Do not use Metamod-P or Metamod-R builds: their
  headers differ in the engine function table.
- To change the interface, update the `metamod-fallguys` submodule of metamod-p-rs and `metamod_release` and
  `metamod_sha256` in the `Justfile` together.

## In-game check

`just e2e-obituary 27017` needs `just install`, `just install-e2e` and `just metamod-install` in `SVEN_SERVER_DIR`. It
saves these screens to `.e2e/shots/`, each with a crop of the notify area (`-notify`) and of the kill feed (`-feed`):

| Shot                      | Event                                                     | Notify area (top left)       |
| ------------------------- | --------------------------------------------------------- | ---------------------------- |
| `obituary-scientist`      | `e2e.kill`: the held CS weapon kills a pinned scientist   | empty                        |
| `obituary-world-filtered` | the world kills the player; the kill feed shows the skull | empty                        |
| `obituary-notice`         | `as_command e2e.notify Server will change level soon`     | `Server will change level …` |
| `obituary-world-native`   | `cl_obituary_filter 0`, then the world kills the player   | `Stefan fell or something.`  |

The scenario checks more than the server log:

- It starts the server without a MOTD window (`+motdfile` names a missing file) and the client with `+developer 0`. It
  types nothing into the game console.
- Before the first capture, it waits until a test line shows in the notify area and goes away again. An empty notify
  area then means that no line arrived, not that the client still loads or that a window covers the area.
- Each capture must show notify glyphs in the console colour, or none, and the CS icons of the kill feed.
- The client's console log must hold `Stefan fell or something.` only after the death with `cl_obituary_filter 0`.

With `developer 1` (the player's `autoexec.cfg` on the test machine sets it), the engine also prints console lines at
the top left, for example `Stefan died`. The CS kill feed prints this line to the console (`HUD_PRINTCONSOLE`), as CS
1.6 does. The plugin does not change console lines.

## Limits

- metamod-p-rs cannot give a hook a null string. A `WRITE_STRING(NULL)` in a `TextMsg` therefore goes to the engine,
  which stops the server (`WriteString called with no active message`). Without the plugin, the engine sends an empty
  string. `UTIL_ClientPrintAll` of `server.so` skips null parameters, and AngelScript strings are never null.
- Two plugins that both hold a `TextMsg` to all players (for example `asusermsg` with a script hook on `TextMsg`) each
  send their own copy. A message then arrives two times, and an obituary that this plugin drops still arrives from the
  other plugin. A message that the other plugin blocks still arrives from this plugin.
- Do not use a plugin that changes a `TextMsg` with calls to the engine's message functions from its own hooks, for
  example `WRITE_STRING` with a different text. While this plugin holds the `TextMsg`, the engine has no open message,
  so such a call stops the server.
- The plugin needs glibc 2.34 or newer at run time, because it links the glibc of the build host.
