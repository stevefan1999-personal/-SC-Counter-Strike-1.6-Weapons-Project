# Counter-Life

Counter-Life makes KernCore's CS 1.6 weapons pack for Sven Co-op 5.26 (Linux, 32-bit GoldSrc) look like Counter-Strike
1.6, HUD included. `README.md` has the overview; `docs/` has the details.

## Layout

- `scripts/cs16/`: the "CS16 Weapons" AngelScript plugin (`cs16_register.as`); `scripts/cs16/hud/` is the server-side
  CS 1.6 HUD (`docs/hud.md`, `docs/hud-architecture.md`).
- `metamod/counterlife/`: the Rust metamod plugin (obituary filter, `docs/metamod.md`). `metamod-p` is a git
  dependency of `metamod-p-rs`; Cargo downloads that revision and the crate fetches its headers.
- `tools/`: Deno tools (`hudgen`, `hudfont`, `scopegen`, `mdlpatch`, `audit`), each with tests.
- `tests/e2e/`: offscreen in-game scenarios; `tests/fixture/`: the CS 1.6 reference fixture (ReGameDLL_CS).
- `docs/research/`: verified facts about the Sven and CS 1.6 binaries. Check a claim there before you reverse engineer
  it again.

## Rules

- A changed asset gets a new path. A client never downloads a path again, so new bytes under an old path never reach
  players (`tools/hudgen_test.ts` pins the hashes of the generated HUD sprites).
- The HUD draws only through the `CS16HUD` raw senders, on the channels and text slots of
  `scripts/cs16/hud/channels.as`.
- Start game processes only through the `Justfile` recipes. They use `game_env` (`env -i`), `-noassert` and a closed
  proxy, because Steam's assert handler writes the whole environment into minidumps and uploads them.
- Test servers run in sandboxes (`just sandbox`), never in the shared Steam install. CS 1.6 runs from a fixture root
  (`just fixture-root`), never from the real Half-Life install, because the engine rewrites its config files on exit.
- Games run on Xvfb displays, never on the desktop. Stop clients with `just client-stop`: the last one puts the
  player's real Sven config back.
- Checks: `deno fmt --check`, `deno lint`, `deno test -A`, `just check <port>` (AngelScript compile in a sandbox),
  `just metamod-test` and `just metamod-lint` (Rust). The scenarios are in `docs/development.md`.
