// Drives the offscreen Sven Co-op client and a dedicated server through the Justfile recipes.
// Waits are tied to server log markers ("[e2e] ...", "entered the game") instead of fixed sleeps where possible.

const repoRoot = new URL("../../", import.meta.url).pathname;
const stateRoot = Deno.env.get("CL_STATE_DIR") ?? `${repoRoot}.e2e`;
const display = Deno.env.get("CL_DISPLAY") ?? ":99";

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

  async start(map: string) {
    await just("server", String(this.port), map);
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
      await sleep(250);
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
  async connect(port: number) {
    await just("client", `+connect 127.0.0.1:${port}`);
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
