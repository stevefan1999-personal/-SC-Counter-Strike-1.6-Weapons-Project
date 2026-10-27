// Captures the field-of-view reference of Valve's CS 1.6 client, started by "just fixture-start".
// Usage: deno run -A fov.ts <display> <WxH> <out dir>
// Writes <out dir>/<state>-*.png and manifest.json for fov-metrics.ts: view models at rest (USP, AK-47, zoomed
// AUG) with and without entities drawn, the Scout and AWP scopes at both zoom levels, and frame pairs turned
// by a known yaw for the focal length of every field of view.
import { grab, load, save } from "./frame.ts";
import { FOV_TURNS, type FovManifest, type FovState, scopeGeometry, ZOOM_STATES } from "./fov-metrics.ts";

const [display, resolution, outDir] = Deno.args;
if (!outDir) throw new Error("usage: fov.ts <display> <WxH> <out dir>");
const [width, height] = resolution.split("x").map(Number);

// fixture.cfg sets sensitivity 1 and m_yaw 0.022. The zoomed sensitivity differs, so every turn is made unzoomed.
const DEGREES_PER_COUNT = 0.022;
// Dropped weapons fly forward; turning about 88 degrees first keeps them out of every later frame.
const DROP_TURN_COUNTS = 4000;
const MOUSE_STEP_COUNTS = 100;
// The client keeps the yaw in 1/65536 turns: CL_AdjustAngles runs anglemod every frame, which truncates. A mouse
// event of n counts therefore turns right by ceil(n * m_yaw * 65536 / 360) steps and left by floor(...) steps, as
// long as the yaw stays above 0. Events need their own frames, so they are spaced.
const YAW_STEPS_PER_TURN = 65536;
const DEGREES_PER_TURN = 360;
const MOUSE_EVENT_MS = 400;
// Long enough for every draw animation and the console, also at the few frames per second of software GL at 1440p.
const DRAW_MS = 3000;
const ZOOM_MS = 1500;
const CLICK_MS = 120;
// Clicks that bring a scoped rifle back to the same zoom level: normal, first and second zoom.
const ZOOM_CYCLE = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Game {
  constructor(private readonly display: string) {}

  async xdotool(...args: string[]) {
    const { code, stderr } = await new Deno.Command("xdotool", {
      args,
      env: { DISPLAY: this.display },
      stderr: "piped",
    })
      .output();
    if (code !== 0) throw new Error(`xdotool ${args.join(" ")}: ${new TextDecoder().decode(stderr)}`);
  }

  // The console drops keys typed while it opens or closes, so each step waits.
  async console(command: string) {
    await this.xdotool("key", "grave");
    await sleep(600);
    await this.xdotool("type", "--delay", "25", "--", command);
    await this.xdotool("key", "Return");
    await sleep(400);
    await this.xdotool("key", "grave");
    await sleep(600);
  }

  // Turns right by positive counts and returns the exact yaw change in degrees, left positive.
  async turn(counts: number) {
    let steps = 0;
    for (let left = Math.abs(counts); left > 0; left -= MOUSE_STEP_COUNTS) {
      const event = Math.min(MOUSE_STEP_COUNTS, left);
      await this.xdotool("mousemove_relative", "--", String(Math.sign(counts) * event), "0");
      const exact = (event * DEGREES_PER_COUNT * YAW_STEPS_PER_TURN) / DEGREES_PER_TURN;
      steps += counts > 0 ? -Math.ceil(exact) : Math.floor(exact);
      await sleep(MOUSE_EVENT_MS);
    }
    await sleep(ZOOM_MS);
    return (steps * DEGREES_PER_TURN) / YAW_STEPS_PER_TURN;
  }

  // Secondary attack: one zoom step of the held weapon.
  async zoom(steps = 1) {
    for (let step = 0; step < steps; step++) {
      await this.xdotool("mousedown", "3");
      await sleep(CLICK_MS);
      await this.xdotool("mouseup", "3");
      await sleep(ZOOM_MS);
    }
  }

  async shot(name: string) {
    await save(await grab(this.display, width, height), `${outDir}/${name}.png`);
    return `${name}.png`;
  }
}

const game = new Game(display);
const states: Record<string, FovState> = {};
await Deno.mkdir(outDir, { recursive: true });

const drop = async () => {
  await game.turn(DROP_TURN_COUNTS);
  await game.console("drop");
  await game.turn(-DROP_TURN_COUNTS);
};

// Valve's client resets r_drawviewmodel to 1 every 0.5 s (CHud::Redraw cheat check), so the view model is hidden
// with r_drawentities 0, which R_DrawViewModel also honours. The view holds no other entity.
const viewModel = async (name: string) => {
  const on = await game.shot(`${name}-vm`);
  await game.console("r_drawentities 0");
  const off = await game.shot(`${name}-novm`);
  return { on, off };
};

// Turn frames of the current view: `zoomSteps` re-enters the zoom level after an unzoomed turn.
const turned = async (name: string, from: string, degrees: number, zoomSteps: number, cycle: number) => {
  const counts = Math.round(degrees / DEGREES_PER_COUNT);
  const unzoom = (cycle - zoomSteps) % cycle;
  await game.zoom(unzoom);
  const yaw = await game.turn(counts);
  await game.zoom(zoomSteps);
  const to = await game.shot(`${name}-turned`);
  await game.zoom(unzoom);
  await game.turn(-counts);
  await game.zoom(zoomSteps);
  return { degrees: yaw, from, to };
};

await game.console("weapon_usp");
await sleep(DRAW_MS);
const usp = await viewModel("usp");
states.usp = { viewModel: usp, turn: await turned("usp", usp.off, FOV_TURNS.normal, 0, 1) };
await game.console("r_drawentities 1");

await game.console("give weapon_ak47; weapon_ak47");
await sleep(DRAW_MS);
states.ak47 = { viewModel: await viewModel("ak47") };
await game.console("r_drawentities 1");
await drop();

// The AUG toggles between 55 and 90.
await game.console("give weapon_aug; weapon_aug");
await sleep(DRAW_MS);
await game.zoom();
const aug = await viewModel("aug");
states.aug = { viewModel: aug, turn: await turned("aug", aug.off, FOV_TURNS.aug, 1, 2) };
await game.console("r_drawentities 1");
await game.zoom();
await drop();

// Scout and AWP cycle 90, 40, then 15 (Scout) or 10 (AWP).
for (const { weapon, states: [first, second] } of ZOOM_STATES) {
  await game.console(`give ${weapon}; ${weapon}`);
  await sleep(DRAW_MS);
  for (const [steps, state] of [[1, first], [2, second]] as const) {
    await game.zoom(steps);
    const scope = await game.shot(state.name);
    // A lost click shifts every later zoom level, so stop at once.
    scopeGeometry(await load(`${outDir}/${scope}`));
    states[state.name] = { scope, turn: await turned(state.name, scope, state.turn, steps, ZOOM_CYCLE) };
    await game.zoom(ZOOM_CYCLE - steps);
  }
  await drop();
}

const manifest: FovManifest = { game: "cs16", resolution, states };
await Deno.writeTextFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
