// Captures CS 1.6 crosshair references from Valve's client, started by "just fixture-start": the AK-47 at rest and
// during a held burst, timed like the e2e-hud steps crosshair-rest and crosshair-firing of Counter-Life.
// Usage: deno run -A crosshair.ts <display> <WxH> <out dir> <tag>
// Writes <out dir>/cs16-crosshair-<tag>-ak47-rest.png and cs16-crosshair-<tag>-ak47-firing.png.
import { grab, save } from "./frame.ts";

// The same waits as tests/e2e/hud.ts: a weapon settles for 1.2 s, and the shot comes 600 ms into the burst.
const SETTLE_MS = 1_200;
const FIRING_MS = 600;
// The console drops keys typed while it opens or closes (tests/fixture/killfeed.ts).
const CONSOLE_OPEN_MS = 600;
const CONSOLE_RUN_MS = 400;
const CONSOLE_CLOSE_MS = 500;
const TYPE_DELAY_MS = 25;

const [display, resolution, outDir, tag] = Deno.args;
if (!tag) throw new Error("usage: crosshair.ts <display> <WxH> <out dir> <tag>");
const [width, height] = resolution.split("x").map(Number);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function xdotool(...args: string[]) {
  const { code, stderr } = await new Deno.Command("xdotool", { args, env: { DISPLAY: display }, stderr: "piped" })
    .output();
  if (code !== 0) throw new Error(`xdotool ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`);
}

async function consoleCommand(command: string) {
  await xdotool("key", "grave");
  await sleep(CONSOLE_OPEN_MS);
  await xdotool("type", "--delay", String(TYPE_DELAY_MS), "--", command);
  await xdotool("key", "Return");
  await sleep(CONSOLE_RUN_MS);
  await xdotool("key", "grave");
  await sleep(CONSOLE_CLOSE_MS);
}

const shot = async (name: string) => {
  const path = `${outDir}/cs16-crosshair-${tag}-${name}.png`;
  await save(await grab(display, width, height), path);
  return path;
};

await Deno.mkdir(outDir, { recursive: true });
await consoleCommand("give weapon_ak47");
await consoleCommand("weapon_ak47");
await sleep(SETTLE_MS);
const rest = await shot("ak47-rest");
await xdotool("mousedown", "1");
await sleep(FIRING_MS);
const firing = await shot("ak47-firing").finally(() => xdotool("mouseup", "1"));
console.log(JSON.stringify({ rest, firing }));
