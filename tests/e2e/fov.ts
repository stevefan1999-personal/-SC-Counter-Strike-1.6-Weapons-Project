// Field-of-view scenario: the same states as the CS 1.6 capture (tests/fixture/fov.ts), in Counter-Life.
// Usage: deno run -A tests/e2e/fov.ts <port> <out dir> [map]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin. Writes
// <out dir>/<state>-*.png and manifest.json for tests/fixture/fov-metrics.ts.
import { Client, Server, sleep } from "./driver.ts";
import { grab, load, save } from "../fixture/frame.ts";
import { FOV_TURNS, type FovManifest, type FovState, scopeGeometry, ZOOM_STATES } from "../fixture/fov-metrics.ts";

const MOTD_DELAY_MS = 3_000;
// Long enough for every draw animation, also at the few frames per second of software GL at 1440p.
const DRAW_MS = 3_000;
// A client command sent by the server runs on the client's next frames.
const COMMAND_MS = 1_000;
// The CS weapons accept a zoom click every 0.3 s.
const ZOOM_MS = 1_500;
const TURN_MS = 600;
// The engine sends view angles in 1/65536 turns, so every turn is a whole number of those steps.
const DEGREES_PER_TURN = 360;
const YAW_STEPS_PER_TURN = 65536;
// Clicks that bring a scoped rifle back to the same zoom level: normal, first and second zoom.
const ZOOM_CYCLE = 3;

const [portArg = "27017", outDir, map = "testcenter"] = Deno.args;
if (!outDir) throw new Error("usage: fov.ts <port> <out dir> [map]");
const port = Number(portArg);
const display = Deno.env.get("CL_DISPLAY") ?? ":99";
const resolution = Deno.env.get("CL_RESOLUTION") ?? "1600x900";
const [width, height] = resolution.split("x").map(Number);
const server = new Server(port);
const client = new Client();
const states: Record<string, FovState> = {};

const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);

// Typing into the console loses keys on a busy machine and sends them to game binds (r reloads and unzooms), so the
// server sends client commands; Sven's cl_filterstuffcmd lets these through (sven-client-hud.md).
const run = async (command: string) => {
  await e2e(`stuff "${command}"`, /\[e2e\] stuffed/);
  await sleep(COMMAND_MS);
};

const shot = async (name: string) => {
  await save(await grab(display, width, height), `${outDir}/${name}.png`);
  return `${name}.png`;
};

const zoom = async (steps = 1) => {
  for (let step = 0; step < steps; step++) {
    await client.click(3);
    await sleep(ZOOM_MS);
  }
};

const select = async (weapon: string) => {
  await e2e(`give ${weapon}`, /\[e2e\] gave/);
  // The MOTD can open late on a busy machine and would catch the zoom clicks, so every step closes it.
  await run(`vgui_closeall; ${weapon}`);
  await sleep(DRAW_MS);
};

const viewModel = async (name: string) => {
  const on = await shot(`${name}-vm`);
  await run("r_drawviewmodel 0");
  const off = await shot(`${name}-novm`);
  return { on, off };
};

// A frame of the same view turned left by `degrees`, rounded to whole angle steps; the view turns back afterwards.
const turned = async (name: string, from: string, degrees: number) => {
  const yaw = (Math.round((degrees * YAW_STEPS_PER_TURN) / DEGREES_PER_TURN) * DEGREES_PER_TURN) / YAW_STEPS_PER_TURN;
  await e2e(`turn ${yaw}`, /\[e2e\] turned/);
  await sleep(TURN_MS);
  const to = await shot(`${name}-turned`);
  await e2e(`turn ${-yaw}`, /\[e2e\] turned/);
  await sleep(TURN_MS);
  return { degrees: yaw, from, to };
};

try {
  await Deno.mkdir(outDir, { recursive: true });
  await server.start(map);
  const joined = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, joined, 120_000);
  await sleep(MOTD_DELAY_MS);
  // The crosshair sits on the turn frames and the view model frames alike; the CS look draws its own.
  await run("crosshair 0");
  // net_graph and cl_showfps cannot be sent by a server (cl_filterstuffcmd); they cover the corners of the frames.
  await client.console("net_graph 0; cl_showfps 0");

  await select("weapon_usp");
  const usp = await viewModel("usp");
  states.usp = { viewModel: usp, turn: await turned("usp", usp.off, FOV_TURNS.normal) };
  await run("r_drawviewmodel 1");

  await select("weapon_ak47");
  states.ak47 = { viewModel: await viewModel("ak47") };
  await run("r_drawviewmodel 1");

  await select("weapon_aug");
  await zoom();
  const aug = await viewModel("aug");
  states.aug = { viewModel: aug, turn: await turned("aug", aug.off, FOV_TURNS.aug) };
  await run("r_drawviewmodel 1");
  await zoom();

  // The scope is a view model here, so the world frames hide it.
  for (const { weapon, states: [first, second] } of ZOOM_STATES) {
    await select(weapon);
    for (const [steps, state] of [[1, first], [2, second]] as const) {
      await zoom(steps);
      const scope = await shot(state.name);
      // A lost click shifts every later zoom level, so stop at once.
      scopeGeometry(await load(`${outDir}/${scope}`));
      await run("r_drawviewmodel 0");
      const world = await shot(`${state.name}-world`);
      states[state.name] = { scope, turn: await turned(state.name, world, state.turn) };
      await run("r_drawviewmodel 1");
      await zoom(ZOOM_CYCLE - steps);
    }
  }

  const manifest: FovManifest = { game: "counter-life", resolution, states };
  await Deno.writeTextFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
