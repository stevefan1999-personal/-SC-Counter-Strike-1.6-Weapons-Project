// Captures CS 1.6 kill-feed reference screenshots from Valve's client, started by "just fixture-start".
// Usage: deno run -A killfeed.ts <display> <WxH> <qconsole.log> <out dir> <tag>
// Writes <out dir>/cs16-killfeed-<tag>-<name>.png and cs16-killfeed-<tag>-timeline.json.
//
// Look at the floor ahead and mark that nav area. For each victim add a passive T bot (bot_zombie 1), send
// it to the mark (bot_goto_mark) and find it as the difference against a frame taken before it came. Aim
// with relative mouse counts and fire single M4A1 taps until the console log reports the kill.
//   m4a1, headshot  one kill each, watched until the notice expires
//   stack4          a kill, then 2 s later bot_kill on three passive bots: four lines, aging one by one
//   max4            bot_kill on five passive bots: five deaths, four lines
//   fight           bots fight each other and the player: four lines in both team colours
// Every capture except "fight" has a <name>-before.png of the same view without notices for feed-metrics.ts.
// bot_kill comes from a key bind: notices that arrive while the console is open expire with older ones.
import { type Box, changedPixels, type Frame, grab, runs, save } from "./frame.ts";

const [display, resolution, consoleLogPath, outDir, tag] = Deno.args;
if (!tag) throw new Error("usage: killfeed.ts <display> <WxH> <qconsole.log> <out dir> <tag>");
const [width, height] = resolution.split("x").map(Number);

// fixture.cfg sets sensitivity 1 and m_yaw = m_pitch = 0.022, so one mouse count turns the view 0.022 degrees.
const DEGREES_PER_COUNT = 0.022;
// gl_widescreen_yfov 1 keeps the 4:3 vertical field of fov 90 (tan of half = 3/4) at every aspect ratio.
const FOCAL_PIXELS = height / 2 / 0.75;
const MOUSE_STEP_COUNTS = 100;
// Puts the crosshair on the floor of the nav area the bots walk to.
// shortcut: tuned for the first CT spawn of de_dust2 only; another map needs its own pitch and nav file.
const MARK_PITCH_DEGREES = 12;
// Condition Zero bot profile names, so every run has the same victims.
const VICTIMS = ["Neil", "Niles", "Oliver", "Opie", "Toby", "Ulric"];
const STACK_EXTRAS = ["Yanni", "Yogi", "Yuri"];
const CAP_BOTS = ["Waldo", "Wally", "Walt", "Wesley", "Uri"];
const CHANGE_THRESHOLD = 28;
const GRID = 4;
const LINE_GAP = 3;
const MIN_BOT_HEIGHT = height * 0.06;
const STILL_PIXELS = Math.ceil(width / 400);
const NOTICE_WATCH_MS = 7500;
const HERO_DELAY_MS = 400;
const KILL_ALL_KEY = "F9";
const STACK_DELAY_MS = 2000;
// Longer than hud_deathnotice_time (6 s), so earlier notices are gone.
const FEED_CLEAR_MS = 6500;
const MAX_TAPS = 8;
const TAP_WAIT_MS = 450;
const STACK_LINES = 4;
const FIGHT_WINDOW_MS = 5000;
const FIGHT_TIMEOUT_MS = 240_000;
// mp_forcerespawn 1 brings a dead player back after 1 s; capture only once he is in his own view again.
const PLAYER_BACK_MS = 3000;
const ARRIVAL_TIMEOUT_MS = 120_000;
// A bot that had not spawned yet ignores bot_goto_mark, so the order repeats while nothing is in view.
const GOTO_RETRY_MS = 8000;
// The bot is searched only here: no radar, chat, bottom HUD or the first two feed lines.
const WORLD: Box = {
  left: Math.round(width * 0.2),
  top: Math.round(height * 0.12),
  right: Math.round(width * 0.98),
  bottom: Math.round(height * 0.86),
};
const FEED: Box = { left: width / 2, top: 0, right: width, bottom: Math.round(height * 0.35) };
const DEATH = / killed |\bdied\n/g;
const PLAYER_DEATH = /killed (his teammate )?Player\b|Player (killed self|died)/;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (angle: number) => (angle * 180) / Math.PI;
const fileFor = (name: string) => `${outDir}/cs16-killfeed-${tag}-${name}.png`;

// The game's console log; every read returns only what the engine appended since the last read.
class ConsoleLog {
  #offset: number;
  constructor(private readonly path: string) {
    this.#offset = Deno.statSync(path).size;
  }
  async read(): Promise<string> {
    const bytes = await Deno.readFile(this.path);
    const text = new TextDecoder().decode(bytes.subarray(this.#offset));
    this.#offset = bytes.length;
    return text;
  }
  async waitFor(pattern: RegExp, timeoutMs: number): Promise<{ match: RegExpMatchArray; at: number } | undefined> {
    const deadline = Date.now() + timeoutMs;
    let text = "";
    while (Date.now() < deadline) {
      text += await this.read();
      const match = text.match(pattern);
      if (match) return { match, at: Date.now() };
      await sleep(40);
    }
    return undefined;
  }
}

// The offscreen game on one X display, driven like a player: console, mouse and screenshots.
class Game {
  // Degrees below the horizon; the spawn view is level and only this script turns the view.
  #pitch = 0;
  constructor(private readonly display: string) {}

  async xdotool(...args: string[]) {
    const { code, stderr } = await new Deno.Command("xdotool", {
      args,
      env: { DISPLAY: this.display },
      stderr: "piped",
    }).output();
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
    await sleep(500);
  }

  async turn(rightCounts: number, downCounts: number) {
    const steps = (total: number) =>
      Array.from(
        { length: Math.ceil(Math.abs(total) / MOUSE_STEP_COUNTS) },
        (_, index) => Math.sign(total) * Math.min(MOUSE_STEP_COUNTS, Math.abs(total) - index * MOUSE_STEP_COUNTS),
      );
    for (const step of steps(rightCounts)) await this.xdotool("mousemove_relative", "--", String(step), "0");
    for (const step of steps(downCounts)) await this.xdotool("mousemove_relative", "--", "0", String(step));
    this.#pitch += downCounts * DEGREES_PER_COUNT;
  }

  // Turn so that screen point (x, y) lands under the crosshair, using GoldSrc's AngleVectors at yaw 0.
  async aimAt(x: number, y: number) {
    const pitch = radians(this.#pitch);
    const [right, up] = [x - width / 2, height / 2 - y];
    const forward = [Math.cos(pitch), 0, -Math.sin(pitch)];
    const upAxis = [Math.sin(pitch), 0, Math.cos(pitch)];
    const ray = [0, 1, 2].map((axis) => forward[axis] * FOCAL_PIXELS + upAxis[axis] * up + [0, -1, 0][axis] * right);
    const yaw = degrees(Math.atan2(ray[1], ray[0]));
    const newPitch = degrees(Math.atan2(-ray[2], Math.hypot(ray[0], ray[1])));
    await this.turn(Math.round(-yaw / DEGREES_PER_COUNT), Math.round((newPitch - this.#pitch) / DEGREES_PER_COUNT));
  }

  async fire() {
    await this.xdotool("mousedown", "1");
    await sleep(40);
    await this.xdotool("mouseup", "1");
  }

  grab(): Promise<Frame> {
    return grab(this.display, width, height);
  }
}

type Blob = { box: Box; pixels: { x: number; y: number }[] };

// The largest 8-connected patch of changed pixels inside WORLD, on a coarse grid so specks and text drop out.
const findBlob = (empty: Frame, frame: Frame): Blob | undefined => {
  const changed = changedPixels(empty, frame, WORLD, CHANGE_THRESHOLD);
  const cells = Map.groupBy(changed, ({ x, y }) => `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`);
  const dense = new Set([...cells].filter(([, members]) => members.length >= 3).map(([key]) => key));
  const seen = new Set<string>();
  const components = [...dense].filter((key) => !seen.has(key)).map((start) => {
    const queue = [start];
    seen.add(start);
    for (let index = 0; index < queue.length; index++) {
      const [cellX, cellY] = queue[index].split(",").map(Number);
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const next = `${cellX + dx},${cellY + dy}`;
        if (dense.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return queue;
  });
  const largest = components.toSorted((a, b) => b.length - a.length)[0];
  if (!largest) return undefined;
  const pixels = largest.flatMap((key) => cells.get(key) ?? []);
  const xs = pixels.map(({ x }) => x), ys = pixels.map(({ y }) => y);
  const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  return box.bottom - box.top >= MIN_BOT_HEIGHT ? { box, pixels } : undefined;
};

// A standing CS player model: the head centre sits about 8% of the height below the top, the chest at 40%.
const targetPoint = ({ box, pixels }: Blob, part: "head" | "chest") => {
  const tall = box.bottom - box.top;
  const [from, to, at] = part === "head" ? [0, 0.1, 0.08] : [0.32, 0.46, 0.4];
  const band = pixels.filter(({ y }) => y >= box.top + from * tall && y <= box.top + to * tall);
  return { x: median(band.map(({ x }) => x)), y: Math.round(box.top + at * tall) };
};

const sameBox = (a: Box, b: Box) =>
  [a.left - b.left, a.top - b.top, a.right - b.right, a.bottom - b.bottom].every((delta) =>
    Math.abs(delta) <= STILL_PIXELS
  );

// Row ranges of the notice lines: feed rows that changed against a frame of the same view without notices.
const feedLines = (before: Frame, frame: Frame) =>
  runs(changedPixels(before, frame, FEED, CHANGE_THRESHOLD).map(({ y }) => y), LINE_GAP).map(([top, bottom]) =>
    `${top}-${bottom}`
  );

const game = new Game(display);
const log = new ConsoleLog(consoleLogPath);

const waitForStillBot = async (empty: Frame): Promise<void> => {
  const deadline = Date.now() + ARRIVAL_TIMEOUT_MS;
  let previous: Blob | undefined;
  let frame = empty;
  let orderedAt = 0;
  while (Date.now() < deadline) {
    if (!previous && Date.now() - orderedAt > GOTO_RETRY_MS) {
      await game.console("bot_goto_mark");
      orderedAt = Date.now();
    }
    await sleep(700);
    frame = await game.grab();
    const blob = findBlob(empty, frame);
    if (blob && previous && sameBox(blob.box, previous.box)) return;
    previous = blob;
  }
  await save(empty, fileFor("debug-empty"));
  await save(frame, fileFor("debug-last"));
  throw new Error(`the bot never stood still in view; see ${fileFor("debug-last")}`);
};

// Frames until every notice is long gone, each with the notice lines it shows. An optional key press at
// `pressAtMs` adds notices mid-watch; the hero is the first frame HERO_DELAY_MS after the last news.
const watch = async (before: Frame, killedAt: number, untilMs: number, pressAtMs?: number) => {
  const samples: { ms: number; lines: string[] }[] = [];
  const heroMs = (pressAtMs ?? 0) + HERO_DELAY_MS;
  let pressed = pressAtMs === undefined;
  let hero: Frame | undefined;
  while (Date.now() - killedAt < untilMs) {
    if (!pressed && Date.now() - killedAt >= pressAtMs!) {
      await game.xdotool("key", KILL_ALL_KEY);
      pressed = true;
    }
    const start = Date.now();
    const frame = await game.grab();
    const ms = Math.round((start + Date.now()) / 2 - killedAt);
    samples.push({ ms, lines: feedLines(before, frame) });
    if (!hero && ms >= heroMs) hero = frame;
  }
  const lastVisibleMs = samples.findLast(({ lines }) => lines.length > 0)?.ms;
  const firstGoneMs = samples.find(({ ms, lines }) => lines.length === 0 && ms > (lastVisibleMs ?? Infinity))?.ms;
  return { hero, samples, lastVisibleMs, firstGoneMs };
};

// Bring one passive T bot (plus passive extras that stay at the T spawn) and shoot it. With extras, bot_kill
// STACK_DELAY_MS after the kill adds their notices to the same view.
const killBot = async (victim: string, part: "head" | "chest", extras: string[] = []) => {
  await game.console([victim, ...extras].map((name) => `bot_add_t ${name}`).join("; "));
  await sleep(1500);
  const empty = await game.grab();
  await waitForStillBot(empty);
  // bot_stop freezes even the idle look-around, so the frame used for aiming matches the shot.
  await game.console("bot_stop 1");
  const blob = findBlob(empty, await game.grab());
  if (!blob) throw new Error(`lost ${victim} after bot_stop`);
  const aim = targetPoint(blob, part);
  await game.aimAt(aim.x, aim.y);
  await sleep(600);
  const before = await game.grab();
  await log.read();
  const killed = new RegExp(`Player killed ${victim} with (a headshot from )?(\\w+)`);
  let kill: Awaited<ReturnType<ConsoleLog["waitFor"]>>;
  for (let tap = 0; tap < MAX_TAPS && !kill; tap++) {
    await game.fire();
    kill = await log.waitFor(killed, TAP_WAIT_MS);
  }
  const stacked = extras.length > 0 ? STACK_DELAY_MS : undefined;
  const watched = kill ? await watch(before, kill.at, NOTICE_WATCH_MS + (stacked ?? 0), stacked) : undefined;
  await game.console("bot_stop 0");
  await game.console(extras.length > 0 ? "bot_kick" : `bot_kick ${victim}`);
  await sleep(1000);
  if (!kill || !watched?.hero) return undefined;
  const { hero, ...seen } = watched;
  return {
    hero,
    before,
    facts: { victim, part, aim, bot: blob.box, headshot: Boolean(kill.match[1]), weapon: kill.match[2], ...seen },
  };
};

await game.console("name Player");
await game.console("give weapon_m4a1");
await game.console("weapon_m4a1");
await sleep(1000);
await game.turn(0, Math.round(MARK_PITCH_DEGREES / DEGREES_PER_COUNT));
await game.console("bot_nav_edit 1");
await game.console("bot_nav_mark");
await game.console("bot_nav_edit 0");
await game.console(`bind ${KILL_ALL_KEY} bot_kill`);
// Nav-edit beams and the "Marked Area" chat line must fade before the first empty frame.
await sleep(4000);

// One plain M4A1 kill (chest taps) and one headshot kill; a surprise headshot counts for the second.
const timeline: Record<string, unknown> = { resolution, focalPixels: FOCAL_PIXELS };
const victims = [...VICTIMS];
const captured = new Set<string>();
while (!(captured.has("m4a1") && captured.has("headshot")) && victims.length > 0) {
  const shot = await killBot(victims.shift()!, captured.has("m4a1") ? "head" : "chest");
  const name = shot?.facts.headshot ? "headshot" : "m4a1";
  if (!shot || captured.has(name)) continue;
  captured.add(name);
  timeline[name] = shot.facts;
  await save(shot.hero, fileFor(name));
  await save(shot.before, fileFor(`${name}-before`));
}
if (captured.size < 2) throw new Error(`missing kills, got: ${[...captured].join(", ") || "none"}`);

const stack = victims.length > 0 ? await killBot(victims.shift()!, "head", STACK_EXTRAS) : undefined;
if (!stack) throw new Error("no kill for the four-line stack");
timeline.stack4 = stack.facts;
await save(stack.hero, fileFor("stack4"));
await save(stack.before, fileFor("stack4-before"));

// Five deaths in one frame against a cap of four lines.
await game.console(CAP_BOTS.map((name) => `bot_add_t ${name}`).join("; "));
await sleep(FEED_CLEAR_MS);
const capBefore = await game.grab();
await log.read();
await game.xdotool("key", KILL_ALL_KEY);
await sleep(HERO_DELAY_MS);
const capped = await game.grab();
timeline.max4 = { deathsAtOnce: ((await log.read()).match(DEATH) ?? []).length, lines: feedLines(capBefore, capped) };
await save(capped, fileFor("max4"));
await save(capBefore, fileFor("max4-before"));
await game.console("bot_kick");

// Bots fight; capture when four deaths fall inside one notice lifetime and the player is alive in his view.
await game.console("bot_zombie 0; bot_difficulty 3; mp_forcerespawn 1");
await game.console("bot_add_ct; bot_add_ct; bot_add_ct; bot_add_t; bot_add_t; bot_add_t; bot_add_t");
await log.read();
const deaths: number[] = [];
let playerDiedAt = -Infinity;
let fight: Frame | undefined;
const fightDeadline = Date.now() + FIGHT_TIMEOUT_MS;
while (!fight && Date.now() < fightDeadline) {
  const text = await log.read();
  const now = Date.now();
  deaths.push(...(text.match(DEATH) ?? []).map(() => now));
  if (PLAYER_DEATH.test(text)) playerDiedAt = now;
  const recent = deaths.filter((at) => now - at < FIGHT_WINDOW_MS).length;
  if (recent >= STACK_LINES && now - playerDiedAt > PLAYER_BACK_MS) fight = await game.grab();
  else await sleep(40);
}
await game.console("bot_kick");
if (!fight) throw new Error("bots never had four deaths inside one notice lifetime");
await save(fight, fileFor("fight"));
timeline.fight = { deathsInWindow: deaths.filter((at) => deaths.at(-1)! - at < FIGHT_WINDOW_MS).length };

await Deno.writeTextFile(`${outDir}/cs16-killfeed-${tag}-timeline.json`, JSON.stringify(timeline, null, 2));
console.log(JSON.stringify(timeline, (key, value) => (key === "samples" ? undefined : value), 2));
