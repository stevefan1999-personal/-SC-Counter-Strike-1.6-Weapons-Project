// Drives the offscreen Sven Co-op client and a dedicated server through the Justfile recipes.
// Waits are tied to server log markers ("[e2e] ...", "entered the game") instead of fixed sleeps where possible.

const repoRoot = new URL("../../", import.meta.url).pathname;
const stateRoot = Deno.env.get("CL_STATE_DIR") ?? `${repoRoot}.e2e`;
const display = Deno.env.get("CL_DISPLAY") ?? ":99";
const resolution = Deno.env.get("CL_RESOLUTION") ?? "1600x900";
// The screen size that the server assumes for players without .hudres: the client size, or with E2E_HUD_RES=default
// the plugin default of cs16_hud_res (a player who never typed .hudres).
const hudRes = Deno.env.get("E2E_HUD_RES") ?? resolution;
const DEFAULT_HUD_RES = "default";
const LOG_POLL_MS = 250;
const JOIN_TIMEOUT_MS = 120_000;
// The client still loads for a moment after the server logs the join; console keys typed then get lost.
const JOIN_SETTLE_MS = 3_000;

// The name of the player in the CS 1.6 reference captures (cs16-killfeed-reference.md), so both kill feeds name the
// same killer.
export const PLAYER_NAME = "Player";

export class E2eError extends Error {}

async function run(command: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const output = await new Deno.Command(command, { args, cwd: repoRoot, env, stdout: "piped", stderr: "piped" })
    .output();
  const text = new TextDecoder().decode(output.stdout);
  if (!output.success) {
    throw new E2eError(`${command} ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr)}`);
  }
  return text;
}

export const just = (...args: string[]) => run("just", args);

export const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class Server {
  constructor(readonly port: number) {}

  private get logPath() {
    return `${stateRoot}/server-${this.port}/server.log`;
  }

  // The CS HUD cannot read the client's size, so it gets the size of the e2e client (see hudRes). `recipe` is a Justfile
  // recipe with the parameters of `server`, such as `server-metamod`; `args` go to the server command line, for
  // example "+motdfile" and a file.
  async start(map: string, recipe = "server", ...args: string[]) {
    await just(recipe, String(this.port), map, ...args);
    if (hudRes !== DEFAULT_HUD_RES) await this.command(`as_command .cs16_hud_res ${hudRes}`);
  }

  async command(command: string) {
    await just("cmd", String(this.port), command);
  }

  async log(): Promise<string> {
    return await Deno.readTextFile(this.logPath).catch(() => "");
  }

  // Resolves once `pattern` appears in log text written after `since` characters.
  async waitFor(pattern: RegExp, since: number, timeoutMs = 60_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const fresh = (await this.log()).slice(since);
      const match = fresh.match(pattern);
      if (match) return match[0];
      await sleep(LOG_POLL_MS);
    }
    throw new E2eError(`timed out after ${timeoutMs} ms waiting for ${pattern} on port ${this.port}`);
  }

  // Runs a console command and waits for the log line it is expected to produce.
  async commandAndWait(command: string, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
    const since = (await this.log()).length;
    await this.command(command);
    return await this.waitFor(pattern, since, timeoutMs);
  }

  async stop() {
    await just("stop", String(this.port));
  }
}

export class Client {
  // `args` go to the game after `+connect`, such as `+developer 0`.
  async connect(port: number, ...args: string[]) {
    await just("client", `+connect 127.0.0.1:${port}`, ...args);
  }

  // The game's console output, which also holds the console copy of every printed message.
  async log(): Promise<string> {
    return await Deno.readTextFile(`${stateRoot}/client/client.log`).catch(() => "");
  }

  // Connects and returns once the player stays in the game. The client reconnects at once when it downloads a
  // soundcache that differs from its copy, which happens when the servers of other worktrees wrote other ones. `port`
  // is where the client connects, for example a proxy in front of the server.
  async join(server: Server, port = server.port) {
    const since = (await server.log()).length;
    const inGame = async () => {
      const fresh = (await server.log()).slice(since);
      return fresh.lastIndexOf("entered the game") > fresh.lastIndexOf("disconnected");
    };
    await this.connect(port);
    const deadline = Date.now() + JOIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await inGame()) {
        await sleep(JOIN_SETTLE_MS);
        if (await inGame()) return;
      }
      await sleep(LOG_POLL_MS);
    }
    throw new E2eError(`the client did not stay in the game on port ${server.port}`);
  }

  async keys(...keys: string[]) {
    await just("ui", ...keys);
  }

  async console(command: string) {
    await just("con", command);
  }

  async click(button: 1 | 3 = 1) {
    await run("xdotool", ["click", String(button)], { DISPLAY: display });
  }

  async mouseDown(button: 1 | 3 = 1) {
    await run("xdotool", ["mousedown", String(button)], { DISPLAY: display });
  }

  async mouseUp(button: 1 | 3 = 1) {
    await run("xdotool", ["mouseup", String(button)], { DISPLAY: display });
  }

  // Turns the view by relative mouse motion (negative dy looks up).
  async look(dx: number, dy: number) {
    await run("xdotool", ["mousemove_relative", "--", String(dx), String(dy)], { DISPLAY: display });
  }

  async keyDown(key: string) {
    await run("xdotool", ["keydown", key], { DISPLAY: display });
  }

  async keyUp(key: string) {
    await run("xdotool", ["keyup", key], { DISPLAY: display });
  }

  async shot(name: string): Promise<string> {
    return (await just("shot", name)).trim();
  }

  async stop() {
    await just("client-stop");
  }
}

// Crops and enlarges part of a screenshot so a reviewer (human or model) can read small HUD details.
export async function crop(
  source: string,
  name: string,
  geometry: string,
  gravity = "NorthWest",
  scalePercent = 200,
): Promise<string> {
  const target = `${stateRoot}/shots/${name}.png`;
  await run("magick", [
    source,
    "-gravity",
    gravity,
    "-crop",
    geometry,
    "+repage",
    "-scale",
    `${scalePercent}%`,
    target,
  ]);
  return target;
}

const RECORDER_TIMEOUT_MS = 10_000;
const RECORDER_POLL_MS = 50;

// Records a region of the screen for `seconds` at `framesPerSecond` around an action, for HUD changes that a single
// screenshot cannot catch (a 0.1 s blink, a 0.3 s pain arrow, the crosshair during fire). Returns the frames, images of
// the region alone, in order. The action starts after the first frame: x11grab can take longer to start than such a
// change lasts.
export async function record(
  name: string,
  region: { x: number; y: number; width: number; height: number },
  seconds: number,
  framesPerSecond: number,
  action: () => Promise<unknown>,
): Promise<string[]> {
  const directory = `${stateRoot}/shots/${name}`;
  await Deno.remove(directory, { recursive: true }).catch(() => {});
  await Deno.mkdir(directory, { recursive: true });
  const args = ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-framerate", String(framesPerSecond)];
  args.push("-video_size", `${region.width}x${region.height}`, "-i", `${display}+${region.x},${region.y}`);
  args.push("-t", String(seconds), "-start_number", "0", `${directory}/%03d.png`);
  const recorder = new Deno.Command("ffmpeg", { args, stdout: "null", stderr: "piped" }).spawn();
  const deadline = Date.now() + RECORDER_TIMEOUT_MS;
  while (!(await Deno.stat(`${directory}/000.png`).then(() => true, () => false))) {
    if (Date.now() > deadline) throw new E2eError("ffmpeg recorded no frame");
    await sleep(RECORDER_POLL_MS);
  }
  await action();
  const { success, stderr } = await recorder.output();
  if (!success) throw new E2eError(`ffmpeg: ${new TextDecoder().decode(stderr)}`);
  return [...Deno.readDirSync(directory)].map((entry) => `${directory}/${entry.name}`).sort();
}
