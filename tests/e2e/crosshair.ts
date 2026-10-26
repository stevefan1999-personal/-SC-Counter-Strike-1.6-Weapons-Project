// Crosshair scenario (docs/hud.md): walks through the CS 1.6 crosshair states on stadium4, saves full shots and
// centre crops, measures the four lines and the bytes that the server sent for them, and prints JSON.
// Usage: deno run -A tests/e2e/crosshair.ts [port] [label]
// The server install needs the e2e plugin (just install-e2e). CL_DISPLAY, CL_RESOLUTION and CL_LISTEN_PORT work as
// for "just client"; the plugin gets the same screen size through cs16_hud_res.
import { load } from "../fixture/frame.ts";
import { type Crosshair, measureCrosshair } from "./crosshair-lines.ts";
import { Client, crop, just, Server, sleep } from "./driver.ts";

const SETTLE_MS = 1_500; // longer than the 0.8 s that any crosshair needs to come back to rest
// A tap fires one AK-47 shot (its next shot comes 95.5 ms later). Longer bursts end when the server log reports the
// wanted shot: a fixed hold misses, because the shots come at whole client frames, slower on a busy machine.
const TAP_MS = 50;
const SHOT_POLL_MS = 10;
const BURST_TIMEOUT_MS = 5_000;
const SHOT_COUNT = /shots (\d+),/g;
const RUN_MS = 400; // past the run limit of 140 units/s after 0.1 s, and only 90 units from the spawn point
// HL sets FL_DUCKING only at the end of the 0.4 s duck, and the gap then needs 0.3 s to shrink
const DUCK_MS = 1_200;
// A missing file: the server then sends no MOTD, whose window would take the mouse and hide the crosshair.
const NO_MOTD_FILE = "e2e-no-motd.txt";
// stadium4 has no monsters, and no other scenario uses it: the parallel servers of other worktrees write their own
// soundcache for testcenter into the shared installs, which makes this client reconnect or hang while it loads.
const MAP = "stadium4";
// Mouse motion that pitches the view up to the dark night sky, where the additive lines stand out.
const SKY_LOOK_UP = -750;
const LOOK_DELAY_MS = 1_000; // the game takes the mouse back a moment after the console closes
// The client reconnects after it downloads a soundcache that differs from its copy (parallel servers of other
// worktrees write different ones), so a join counts only once no disconnect follows it for this long.
const JOIN_SETTLE_MS = 10_000;
const JOIN_ATTEMPTS = 5;
// A busy machine can starve the software-rendered client for minutes while it loads the map.
const LOAD_TIMEOUT_S = 300;
const JUMP_CAPTURE_MS = 120; // the jump lasts about 0.6 s
// Transient states are frozen with the client pause key (the server runs with pausable 1) before the screenshot,
// which takes longer than the states last on a busy machine. showpause 0 keeps the PAUSED text off the centre.
const PAUSE_KEY = "p";
const SUSTAINED_FIRE_MS = 3_000;
const REFERENCE_WIDTH = 1600;
const CROP_WIDTH = 160; // at 1600 px: the widest AK-47 crosshair reaches 37 + 25 px from the centre
const CROP_HEIGHT = 140;
const CROP_SCALE_PERCENT = 300;
// cs16-hud-spec.md 3.12.5: lines scale by W / base with cl_crosshair_size auto; the rest length is 5.
const REST_LENGTH = 5;
const autoBase = (width: number) => width <= 640 ? 1024 : width < 1024 ? 800 : 640;
const SEND_LINE = /\[CS16HUD\] crosshair \d+: (?:gap (\d+) length (\d+) alpha (\d+) shots (\d+)|hidden), (\d+) bytes/g;

const [portArg = "27017", label = "crosshair"] = Deno.args;
const resolution = Deno.env.get("CL_RESOLUTION") ?? "1600x900";
const [width] = resolution.split("x").map(Number);
const server = new Server(Number(portArg));
const client = new Client();

type Send = { gap: number; length: number; alpha: number; shots: number; bytes: number } | { hidden: true };
type Step = {
  step: string;
  gap: number | null; // CS minimum gap g of the weapon and pose, null: CS draws no crosshair
  measured: Crosshair;
  sends: Send[];
  full: string;
  crop: string;
};
const steps: Step[] = [];

// Sends that the server logged (developer 2) after a log offset.
async function sendsSince(offset: number): Promise<Send[]> {
  return [...(await server.log()).slice(offset).matchAll(SEND_LINE)].map(([, gap, length, alpha, shots, bytes]) =>
    gap === undefined
      ? { hidden: true }
      : { gap: Number(gap), length: Number(length), alpha: Number(alpha), shots: Number(shots), bytes: Number(bytes) }
  );
}

const sentBytes = (sends: Send[]) => sends.reduce((sum, send) => sum + ("bytes" in send ? send.bytes : 0), 0);

async function capture(step: string, gap: number | null, since: number) {
  const full = await client.shot(`${label}-${step}`);
  const scale = width / REFERENCE_WIDTH;
  const geometry = `${Math.round(CROP_WIDTH * scale)}x${Math.round(CROP_HEIGHT * scale)}+0+0`;
  const cropped = await crop(full, `${label}-${step}-centre`, geometry, "Center", CROP_SCALE_PERCENT);
  steps.push({
    step,
    gap,
    measured: measureCrosshair(await load(full)),
    sends: await sendsSince(since),
    full,
    crop: cropped,
  });
}

const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);
const offset = async () => (await server.log()).length;

async function rest(weapon: string, gap: number | null, step = `${weapon.replace("weapon_", "")}-rest`) {
  await client.console(weapon);
  await sleep(SETTLE_MS);
  await capture(step, gap, await offset());
}

async function togglePause() {
  await client.keyDown(PAUSE_KEY);
  await client.keyUp(PAUSE_KEY);
}

// Pauses the game, captures the crosshair that the client shows now, then resumes.
async function captureFrozen(step: string, gap: number | null, since: number) {
  const pausedFrom = await offset();
  await togglePause();
  await server.waitFor(/paused the game/, pausedFrom);
  await capture(step, gap, since);
  const resumedFrom = await offset();
  await togglePause();
  await server.waitFor(/unpaused the game/, resumedFrom);
}

// The player's shot counter as of the last crosshair send in the log (each send reports it).
const loggedShots = async () =>
  Math.max(0, ...[...(await server.log()).matchAll(SHOT_COUNT)].map(([, n]) => Number(n)));

// Fires `shots` AK-47 shots with the trigger held, then captures the crosshair right after the release.
async function fire(shots: number, step: string) {
  await sleep(SETTLE_MS);
  const since = await offset();
  const target = await loggedShots() + shots;
  await client.mouseDown();
  if (shots === 1) await sleep(TAP_MS);
  const deadline = Date.now() + BURST_TIMEOUT_MS;
  while (shots > 1 && await loggedShots() < target) {
    if (Date.now() > deadline) throw new Error(`no shot ${target} within ${BURST_TIMEOUT_MS} ms`);
    await sleep(SHOT_POLL_MS);
  }
  await client.mouseUp();
  await captureFrozen(step, null, since);
}

// Holds a key for `ms`, then captures: frozen for states that end before a screenshot does (a jump, a run into a
// wall), unpaused for the duck, which a pause lets go of (the server unducks the player as soon as it pauses).
async function hold(key: string, step: string, gap: number, ms: number, frozen: boolean) {
  const since = await offset();
  await client.keyDown(key);
  await sleep(ms);
  await (frozen ? captureFrozen(step, gap, since) : capture(step, gap, since));
  await client.keyUp(key);
  await sleep(SETTLE_MS);
}

async function joinAndStay() {
  let since = await offset();
  await just("client", "+cl_timeout", String(LOAD_TIMEOUT_S), "+connect", `127.0.0.1:${server.port}`);
  for (let attempt = 0; attempt < JOIN_ATTEMPTS; ++attempt) {
    await server.waitFor(/entered the game/, since, 180_000);
    since = await offset();
    await sleep(JOIN_SETTLE_MS);
    if (!(await server.log()).slice(since).includes("disconnected")) return;
  }
  throw new Error(`the client left the game ${JOIN_ATTEMPTS} times`);
}

try {
  await server.start(MAP);
  await server.command("developer 2");
  await server.command(`motdfile ${NO_MOTD_FILE}`);
  await server.command("pausable 1");
  await server.command(`sv_timeout ${LOAD_TIMEOUT_S}`);
  await server.command(`as_command .cs16_hud_res ${resolution}`);
  await joinAndStay();
  // No view model: its muzzle flash would stay over the lines in a paused frame.
  await client.console(`bind ${PAUSE_KEY} pause; showpause 0; r_drawviewmodel 0`);
  await sleep(LOOK_DELAY_MS);
  await client.look(0, SKY_LOOK_UP);
  for (const weapon of ["weapon_ak47", "weapon_csdeagle", "weapon_usp", "weapon_m3", "weapon_awp", "weapon_p90"]) {
    await e2e(`give ${weapon}`, /\[e2e\] gave/);
  }

  await rest("weapon_ak47", 4);
  await fire(1, "ak47-shot1");
  await fire(3, "ak47-shot3");
  await fire(10, "ak47-shot10");
  await sleep(SETTLE_MS);
  await hold("Control_L", "ak47-ducking", 4, DUCK_MS, false);
  await hold("space", "ak47-air", 8, JUMP_CAPTURE_MS, true);
  await rest("weapon_csdeagle", 8);
  await hold("Control_L", "deagle-ducking", 4, DUCK_MS, false);
  await rest("weapon_usp", 8);
  await rest("weapon_m3", 8);
  await rest("weapon_awp", null);

  // Bandwidth: a quiet stretch at rest, then the P90 (the fastest CS weapon) firing without a break.
  await rest("weapon_p90", 7);
  const quietFrom = await offset();
  await sleep(SUSTAINED_FIRE_MS);
  const quiet = await sendsSince(quietFrom);
  const fireFrom = await offset();
  await client.mouseDown();
  await sleep(SUSTAINED_FIRE_MS);
  const firing = await sendsSince(fireFrom);
  await client.mouseUp();
  await sleep(SETTLE_MS);
  const recovery = (await sendsSince(fireFrom)).slice(firing.length);
  const perSecond = (sends: Send[]) => Math.round(sentBytes(sends) * 1_000 / SUSTAINED_FIRE_MS);

  // The run comes last: it can carry the player off a ledge of the spawn area.
  await client.console("weapon_ak47");
  await sleep(SETTLE_MS);
  await hold("w", "ak47-running", 6, RUN_MS, true);

  const scale = { base: autoBase(width), width };
  const restLength = Math.trunc(width * REST_LENGTH / scale.base);
  const expected = (gap: number | null) =>
    gap === null ? null : { gap: Math.trunc(gap * width / scale.base), length: restLength };
  console.log(JSON.stringify(
    {
      label,
      resolution,
      scale,
      steps: steps.map((step) => ({ ...step, expected: expected(step.gap) })),
      bandwidth: {
        restBytesPerSecond: perSecond(quiet),
        p90FiringBytesPerSecond: perSecond(firing),
        p90FiringSends: firing.length,
        recoveryBytes: sentBytes(recovery),
      },
    },
    null,
    2,
  ));
} finally {
  await client.stop();
  await server.stop();
}
