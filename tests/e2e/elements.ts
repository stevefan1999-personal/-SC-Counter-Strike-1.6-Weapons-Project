// Status elements scenario. Puts player 1 into the state of the CS 1.6 reference screenshot (health 100, armour 0,
// $800, USP with 12 | 24), compares every HUD glyph box and its colour with that screenshot, then captures the other
// states: low health, half armour, money gain, loss and blink, flashlight on, off and low, the c4 icon, no suit.
// Usage: deno run -A tests/e2e/elements.ts [port] [label] [crop dir]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin. CL_RESOLUTION selects
// the reference (REFERENCES); CS_REFERENCE_DIR overrides where the references are (default: the main checkout's
// .e2e/reference, which git ignores); CSTRIKE_DIR is the CS 1.6 install. Prints a JSON report and exits 1 when a check
// fails.
import { Client, crop, Server, sleep } from "./driver.ts";
import { measure } from "./hudboxes.ts";
import { addedColour, matchBoxes, Pixels, rectError, type Region, type Rgb } from "./hudcompare.ts";
import { parseSpr } from "../../tools/spr.ts";
import { encodeIconSheet, loadIconSheets } from "../../tools/hudgen.ts";

const LOAD_TIMEOUT_MS = 600_000; // a first connection downloads about 8 MB of HUD sprites
const SETTLE_MS = 1_200;
const FADE_SETTLE_MS = 5_600; // CS fades end after 5 s
const CHANGE_SHOT_MS = 300; // inside the 2.5 s change row of the money
const CLIP_SECONDS = 2; // a recording around a command: the blink takes 0.3 s, a flash period 0.2 s
const CLIP_FRAMES_PER_SECOND = 30; // three frames in each 0.1 s phase
const RECORDER_TIMEOUT_MS = 10_000;
const POLL_MS = 50;
const JOIN_HOLD_MS = 3_000;
const WEAPON_SWITCH_TRIES = 20;
const BOX_TOLERANCE_PX = 1; // for every edge of a glyph box
// Software rendering (Xvfb, llvmpipe) of the test client draws too few frames at large sizes for the 0.1 s phases of
// the blink and the flash, so their phases are checked at this size only. Other sizes still record and report them.
const PHASE_CHECK_RESOLUTION = "1600x900";
const COLOUR_TOLERANCE = 12; // levels of red and green; the CS floor puts noise into each estimate
const RED_GREEN = [0, 1]; // HUD orange has no blue, so blue in an estimate is the floor of the screenshot
const HUD_COLOUR_RANGE = 40; // a box counts as a HUD glyph when its added colour is this close to SETTLED_ORANGE
const MIN_GLYPH_AREA = 40; // smaller boxes are bits of the small print on the ammo icons
// Sven draws a HUD sprite a little soft: up to about 10 % of a texel's light reaches the next pixel (foundation proof,
// docs/hud-architecture.md). One pixel off, the c4 rect differs by more than 100 levels.
const ICON_ERROR_LEVELS = 24;
const REFERENCES: Record<string, string> = { "1600x900": "cs16-ref-hud.png", "2560x1440": "cs16-1440-hud.png" };
// The CS reference state runs with mp_flashlight 0 (the CS default), which hides the flashlight; the crosshair fixture
// (tests/fixture/fixture.cfg: mp_flashlight 1) shows it off, as Sven's default mp_flashlight 1 does.
const FLASHLIGHT_REFERENCES: Record<string, string> = {
  "1600x900": "cs16-crosshair-1600x900-ak47-rest.png",
  "2560x1440": "cs16-crosshair-2560x1440-ak47-rest.png",
};
const SETTLED_ORANGE: Rgb = [100, 62, 0]; // HUD orange at alpha 100, as ScaleColors gives it
const STATUS_GREEN: Rgb = [0, 160, 0];
// A flat screen of the CS reference's floor colour under the HUD: our glyphs then read like CS's on its floor.
const BACKDROP: Rgb = [39, 32, 22];
const BLACK: Rgb = [0, 0, 0];
// The c4 status icon: its rect on 640hud7.spr, drawn at x crossW / 2 and y H / 2 - (32 + 5) (cs16-hud-spec.md 3.10).
const C4_RECT: Region = { x: 0, y: 148, width: 32, height: 32 };
const STATUS_ICON_X = 12;
const STATUS_ICON_RISE = 37;
const NO_SUIT_MONEY_TOP = 124; // H - 5 fh, plus the 1 px from the cell top to the glyphs

const [portArg = "27017", label = "elements", cropDir] = Deno.args;
const port = Number(portArg);
const resolution = Deno.env.get("CL_RESOLUTION") ?? "1600x900";
const [width, height] = resolution.split("x").map(Number);
const display = Deno.env.get("CL_DISPLAY") ?? ":99";
const repoRoot = new URL("../../", import.meta.url).pathname;
const stateRoot = Deno.env.get("CL_STATE_DIR") ?? `${repoRoot}.e2e`;
const steamCommon = Deno.env.get("STEAM_COMMON") ?? `${Deno.env.get("HOME")}/.local/share/Steam/steamapps/common`;
const cstrikeDir = Deno.env.get("CSTRIKE_DIR") ?? `${steamCommon}/Half-Life/cstrike`;
const gitDir = await new Deno.Command("git", { args: ["rev-parse", "--path-format=absolute", "--git-common-dir"] })
  .output();
const referenceDir = Deno.env.get("CS_REFERENCE_DIR") ??
  `${new TextDecoder().decode(gitDir.stdout).trim().replace(/\/\.git$/, "")}/.e2e/reference`;
const server = new Server(port);
const client = new Client();
const report: Record<string, unknown> = { label, resolution };
const failures: string[] = [];

// Where CS 1.6 draws its HUD: health and armour at the bottom left, money and ammo at the bottom right.
const BOTTOM_LEFT: Region = { x: 0, y: height - 80, width: Math.floor(width / 5) + 120, height: 80 };
const BOTTOM_RIGHT: Region = { x: width - 200, y: height - 100, width: 200, height: 100 };
const MONEY_ROWS: Region = { x: width - 200, y: height - 125, width: 200, height: 80 }; // change row and money row
const TOP_RIGHT: Region = { x: width - 80, y: 0, width: 80, height: 64 };
const STATUS_ICON: Region = { x: 0, y: Math.floor(height / 2) - 60, width: 60, height: 60 };
// The pain arrows around the centre (cs16-hud-spec.md 3.14): a 500 px square, as the CS 1.6 pain captures, and the CS
// box of each arrow in it: front (W/2 - 64, H/2 - 144), right (W/2 + 96, H/2 - 64), rear (W/2 - 64, H/2 + 96) and left
// (W/2 - 144, H/2 - 64), 128 x 48 or 48 x 128.
const PAIN_SIDE = 500;
const PAIN: Region = {
  x: Math.floor(width / 2) - PAIN_SIDE / 2,
  y: Math.floor(height / 2) - PAIN_SIDE / 2,
  width: PAIN_SIDE,
  height: PAIN_SIDE,
};
const PAIN_ARROWS = ["front", "right", "rear", "left"];
const PAIN_BOXES: Region[] = [[-64, -144, 128, 48], [96, -64, 48, 128], [-64, 96, 128, 48], [-144, -64, 48, 128]]
  .map(([dx, dy, boxWidth, boxHeight]) => ({
    x: PAIN_SIDE / 2 + dx,
    y: PAIN_SIDE / 2 + dy,
    width: boxWidth,
    height: boxHeight,
  }));
const PAIN_LIT_LEVELS = 40; // red over the backdrop; the arrows add red only (640_pain.spr has a red palette)
const PAIN_MIN_PIXELS = 200; // an arrow at full strength lights about 2000 pixels
const PAIN_STRAY_PIXELS = 20; // lit pixels outside the four boxes
const PAIN_MAX_FRAMES = 18; // CS shows an arrow 0.3 s; allow 0.6 s at 30 frames a second

const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);
// Client commands go through stufftext: keys typed while the console is not open yet would play the game instead.
const run = (command: string) => e2e(`stuff ${command}`, /\[e2e\] stuffed[^\n]*/);
const backdrop = (colour: Rgb) => e2e(`backdrop ${colour.join(" ")}`, /\[e2e\] backdrop/);
const geometry = ({ x, y, width, height }: Region) => `${width}x${height}+${x}+${y}`;
const rgb = (colour: Rgb) => `rgb(${colour.join(",")})`;
// A HUD colour as it shows on the backdrop: the HUD adds its colour to the screen.
const onBackdrop = (colour: Rgb) =>
  rgb(colour.map((value, channel) => Math.min(255, value + BACKDROP[channel])) as Rgb);
const shot = (step: string) => client.shot(`${label}-${step}`);
const keep = async (image: string, name: string, region: Region) => {
  const path = await crop(image, `${label}-${name}`, geometry(region), "NorthWest", 100);
  if (cropDir) await Deno.copyFile(path, `${cropDir}/${name}.png`);
  return path;
};
const glyphs = async (image: string, region: Region, colour?: string) => {
  const [boxes, pixels] = await Promise.all([measure(image, region, colour), Pixels.read(image, region)]);
  return boxes.map((box) => ({ ...box, added: addedColour(pixels, box) }));
};
type Glyph = Awaited<ReturnType<typeof glyphs>>[number];
const check = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};
const near = (a: Rgb, b: Rgb, tolerance = COLOUR_TOLERANCE, channels = [0, 1, 2]) =>
  channels.every((channel) => Math.abs(a[channel] - b[channel]) <= tolerance);
const hudGlyphs = (found: Glyph[]) =>
  found.filter((glyph) => glyph.area >= MIN_GLYPH_AREA && near(glyph.added, SETTLED_ORANGE, HUD_COLOUR_RANGE));
const box = (glyph: Glyph | undefined) => glyph && `${glyph.x},${glyph.y} ${glyph.width}x${glyph.height}`;

// Compares the glyphs of a region with the CS reference both ways: same boxes within 1 px, colours within a few levels.
async function compareWithCs(ours: string, region: Region, name: string, csShot = REFERENCES[resolution]) {
  const reference = `${referenceDir}/${csShot}`;
  const [csGlyphs, ourGlyphs] = (await Promise.all([glyphs(reference, region), glyphs(ours, region)])).map(hudGlyphs);
  const rows = matchBoxes(csGlyphs, ourGlyphs).map(({ cs, ours: match, offset }) => {
    const [csGlyph, ourGlyph] = [cs as Glyph, match as Glyph | undefined];
    check(offset <= BOX_TOLERANCE_PX, `${name}: CS glyph ${box(csGlyph)} is ${offset} px from ${box(ourGlyph)}`);
    check(
      ourGlyph !== undefined && near(csGlyph.added, ourGlyph.added, COLOUR_TOLERANCE, RED_GREEN),
      `${name}: CS glyph ${box(csGlyph)} colour ${csGlyph.added} vs ${ourGlyph?.added}`,
    );
    return { cs: box(csGlyph), ours: box(ourGlyph), offset, csColour: csGlyph.added, ourColour: ourGlyph?.added };
  });
  for (const extra of matchBoxes(ourGlyphs, csGlyphs).filter(({ offset }) => offset > BOX_TOLERANCE_PX)) {
    check(false, `${name}: our glyph ${box(extra.cs as Glyph)} is not in CS`);
  }
  const side = `${label}-${name}-vs-cs`;
  const [csCrop, ourCrop] = await Promise.all([
    crop(reference, `${side}-cs`, geometry(region), "NorthWest", 100),
    crop(ours, `${side}-ours`, geometry(region), "NorthWest", 100),
  ]);
  if (cropDir) {
    await new Deno.Command("magick", { args: [csCrop, ourCrop, "-append", `${cropDir}/${name}-cs-above-ours.png`] })
      .output();
  }
  report[name] = rows;
}

// The c4 icon on black must be the sheet rect drawn 1:1 in CS green at the first CS status slot, and match worse one
// pixel off in any direction.
async function checkC4Icon(image: string) {
  // The plugin draws the icon from the hudgen copy of 640hud7, in which the rect is drawn as Valve's engine shows it.
  const icons = (await loadIconSheets(cstrikeDir)).find(({ name }) => name === "640hud7")!;
  const sheet = parseSpr(encodeIconSheet(icons)).frames[0];
  const pixels = await Pixels.read(image, STATUS_ICON);
  const slot = { x: STATUS_ICON_X, y: Math.floor(height / 2) - STATUS_ICON_RISE };
  const error = (dx: number, dy: number) =>
    rectError(pixels, { x: slot.x + dx, y: slot.y + dy }, sheet, C4_RECT, STATUS_GREEN);
  const shifted = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => error(dx, dy));
  report.c4Icon = { slot, error: error(0, 0), shifted };
  check(
    error(0, 0) <= ICON_ERROR_LEVELS,
    `c4 icon differs from the sheet by ${error(0, 0)} levels at ${slot.x},${slot.y}`,
  );
  check(shifted.every((value) => value > error(0, 0)), `c4 icon matches as well one pixel off: ${shifted}`);
}

// Records a region of the screen around an action, for the 0.1 s phases of the money blink and the status icon flash.
// The frames are images of the region alone.
async function record(name: string, region: Region, action: () => Promise<unknown>): Promise<string[]> {
  const directory = `${stateRoot}/shots/${label}-${name}`;
  await Deno.remove(directory, { recursive: true }).catch(() => {});
  await Deno.mkdir(directory, { recursive: true });
  const args = ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-framerate", String(CLIP_FRAMES_PER_SECOND)];
  args.push("-video_size", `${region.width}x${region.height}`, "-i", `${display}+${region.x},${region.y}`);
  args.push("-t", String(CLIP_SECONDS), "-start_number", "0", `${directory}/%03d.png`);
  const recorder = new Deno.Command("ffmpeg", { args, stdout: "null", stderr: "piped" }).spawn();
  // The action must come after the first frame: a blink lasts 0.3 s and x11grab can take longer than that to start.
  const deadline = Date.now() + RECORDER_TIMEOUT_MS;
  while (!(await Deno.stat(`${directory}/000.png`).then(() => true, () => false))) {
    if (Date.now() > deadline) throw new Error("ffmpeg recorded no frame");
    await sleep(POLL_MS);
  }
  await action();
  const { success, stderr } = await recorder.output();
  if (!success) throw new Error(`ffmpeg: ${new TextDecoder().decode(stderr)}`);
  return [...Deno.readDirSync(directory)].map((entry) => `${directory}/${entry.name}`).sort();
}

// The lit pixels of a recorded pain frame (an image of PAIN alone) in each CS arrow box, then those outside all boxes.
// The arrows add red only: 640_pain.spr has a red palette.
async function painPixels(frame: string): Promise<number[]> {
  const pixels = await Pixels.read(frame, { x: 0, y: 0, width: PAIN_SIDE, height: PAIN_SIDE });
  const isLit = ([red, green, blue]: Rgb) =>
    red - BACKDROP[0] > PAIN_LIT_LEVELS && Math.abs(green - BACKDROP[1]) < PAIN_LIT_LEVELS / 2 &&
    Math.abs(blue - BACKDROP[2]) < PAIN_LIT_LEVELS / 2;
  const inside = (x: number, y: number, box: Region) =>
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
  const counts = new Array<number>(PAIN_BOXES.length + 1).fill(0);
  for (let y = 0; y < PAIN_SIDE; y++) {
    for (let x = 0; x < PAIN_SIDE; x++) {
      if (!isLit(pixels.at(x, y)!)) continue;
      const box = PAIN_BOXES.findIndex((region) => inside(x, y, region));
      counts[box >= 0 ? box : PAIN_BOXES.length]++;
    }
  }
  return counts;
}

// The runs of consecutive frames in which a test is true, for example the bright phases of a blink.
const runs = (frames: boolean[]) => frames.filter((on, index) => on && !frames[index - 1]).length;

// The server logs "entered the game" while the client still loads; the client prints "has joined the game" once it is
// in. Sometimes the client retries its connection right after joining, so the join must hold for a while.
async function waitForClientInGame() {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  const log = `${stateRoot}/client/client.log`;
  const count = (text: string, line: string) => text.split(line).length - 1;
  let joinedSince = 0;
  while (Date.now() < deadline) {
    const text = await Deno.readTextFile(log).catch(() => "");
    const inGame = count(text, "has joined the game") > count(text, "connection retry");
    joinedSince = inGame ? joinedSince || Date.now() : 0;
    if (joinedSince && Date.now() - joinedSince >= JOIN_HOLD_MS) return;
    await sleep(POLL_MS);
  }
  throw new Error(`the client did not join within ${LOAD_TIMEOUT_MS} ms`);
}

try {
  // No MOTD: its window would take the keys, and Enter, which closes it, fires the weapon in game.
  await server.start("testcenter", "+motdfile", "e2e_no_motd.txt");
  await client.connect(port);
  await waitForClientInGame();
  await sleep(SETTLE_MS);
  await run("r_drawviewmodel 0");
  // The client runs the player's config again when it connects, which can turn on net_graph over the bottom right. It
  // blocks both cvars in stufftext, so they are typed.
  await client.console("net_graph 0; cl_showfps 0");
  await run("weapon_usp");
  await sleep(SETTLE_MS);

  // The CS 1.6 reference state. Money comes from the buy menu's pay for score (10 per point): 80 points are $800.
  await backdrop(BACKDROP);
  await e2e("health 100", /\[e2e\] health/);
  await e2e("armor 0", /\[e2e\] armor/);
  // The stuffed weapon command takes a round trip and a weapon switch: set the ammo once the USP is in hand.
  for (let tries = 0; tries < WEAPON_SWITCH_TRIES && !String(report.ammo).includes("weapon_usp"); tries++) {
    report.ammo = await e2e("ammo 12 24", /\[e2e\] ammo[^\n]*/);
    await sleep(SETTLE_MS / 4);
  }
  check(String(report.ammo).includes("weapon_usp"), `the USP is not in hand: ${report.ammo}`);
  await e2e("frags 80", /\[e2e\] frags/);
  await sleep(FADE_SETTLE_MS);
  const reference = await shot("reference");
  await compareWithCs(reference, BOTTOM_LEFT, "health-armour");
  await compareWithCs(reference, BOTTOM_RIGHT, "money-ammo");
  await compareWithCs(reference, TOP_RIGHT, "flashlight", FLASHLIGHT_REFERENCES[resolution]);
  // CS hides the flashlight while the server forbids flashlights, as with its default mp_flashlight 0.
  await server.command("mp_flashlight 0");
  await sleep(SETTLE_MS);
  const forbidden = await glyphs(await shot("flashlight-forbidden"), TOP_RIGHT);
  report.flashlightForbidden = forbidden;
  check(forbidden.length === 0, `mp_flashlight 0 must hide the flashlight: ${forbidden.map(box)}`);
  await server.command("mp_flashlight 1");
  await keep(reference, "c4", STATUS_ICON);
  await keep(reference, "flashlight-off", TOP_RIGHT);
  await backdrop(BLACK);
  await sleep(SETTLE_MS);
  await checkC4Icon(await shot("c4-on-black"));
  await backdrop(BACKDROP);

  // Pain arrows: a hit from the front lights the front arrow only, a hit from the player itself all four, for 0.3 s.
  const frontFrames = await record("pain-front", PAIN, () => e2e("hurt 10 front", /\[e2e\] hurt/));
  const nearFrames = await record("pain-near", PAIN, () => e2e("hurt 10 near", /\[e2e\] hurt/));
  const [fromFront, fromNear] = await Promise.all(
    [frontFrames, nearFrames].map((frames) => Promise.all(frames.map(painPixels))),
  );
  const lit = (counts: number[], arrow: number) => counts[arrow] >= PAIN_MIN_PIXELS;
  const arrowPixels = (counts: number[]) => counts.slice(0, PAIN_ARROWS.length).reduce((sum, count) => sum + count, 0);
  const litFrames = (frames: number[][]) =>
    frames.filter((counts) => PAIN_ARROWS.some((_, arrow) => lit(counts, arrow))).length;
  const framesLit = { front: litFrames(fromFront), near: litFrames(fromNear) };
  report.pain = {
    columns: [...PAIN_ARROWS, "outside"].join(" "),
    front: fromFront.map((counts) => counts.join(" ")),
    near: fromNear.map((counts) => counts.join(" ")),
    framesLit,
  };
  check(
    fromFront.some((counts) => lit(counts, 0) && [1, 2, 3].every((arrow) => counts[arrow] < PAIN_STRAY_PIXELS)),
    "a hit from the front must light the front arrow only",
  );
  check(
    fromNear.some((counts) => PAIN_ARROWS.every((_, arrow) => lit(counts, arrow))),
    "a hit from the player itself must light all four arrows",
  );
  check(
    [...fromFront, ...fromNear].every((counts) => counts[PAIN_BOXES.length] < PAIN_STRAY_PIXELS),
    "pain arrow pixels lie outside the CS arrow boxes",
  );
  check(
    Object.values(framesLit).every((frames) => frames > 0 && frames <= PAIN_MAX_FRAMES),
    `pain arrows must show for about 0.3 s: ${JSON.stringify(framesLit)}`,
  );
  const brightest = fromNear.reduce(
    (best, counts, index) => arrowPixels(counts) > arrowPixels(fromNear[best]) ? index : best,
    0,
  );
  if (cropDir) await Deno.copyFile(nearFrames[brightest], `${cropDir}/pain-near.png`);

  await e2e("health 20", /\[e2e\] health/);
  await e2e("armor 50", /\[e2e\] armor/);
  await sleep(FADE_SETTLE_MS);
  const lowHealth = await shot("health20-armour50");
  const lowRed = await glyphs(lowHealth, BOTTOM_LEFT, onBackdrop([98, 0, 0]));
  report.health20 = lowRed;
  check(lowRed.some((glyph) => near(glyph.added, [98, 0, 0], 4)), "health 20 is not low red at alpha 100");
  await keep(lowHealth, "health20-armour50", BOTTOM_LEFT);

  await e2e("frags 90", /\[e2e\] frags/);
  await sleep(CHANGE_SHOT_MS);
  const gain = await shot("money-gain");
  report.moneyGain = await glyphs(gain, MONEY_ROWS, onBackdrop([30, 220, 0]));
  await keep(gain, "money-gain", MONEY_ROWS);
  await sleep(FADE_SETTLE_MS);
  await run(".buy kevlar");
  await sleep(CHANGE_SHOT_MS);
  const loss = await shot("money-loss");
  report.moneyLoss = await glyphs(loss, MONEY_ROWS, onBackdrop([220, 30, 0]));
  await keep(loss, "money-loss", MONEY_ROWS);
  await sleep(FADE_SETTLE_MS);
  // Not enough money now: the money blinks HUD orange at full alpha twice, then shows its normal colour again.
  const blink = await record("money-blink", MONEY_ROWS, () => run(".buy kevlar"));
  const clipRegion = { x: 0, y: 0, width: MONEY_ROWS.width, height: MONEY_ROWS.height };
  const bright = await Promise.all(
    blink.map(async (frame) => (await glyphs(frame, clipRegion, onBackdrop([255, 160, 0]))).length > 0),
  );
  report.moneyBlink = bright.map(Number).join("");
  if (resolution === PHASE_CHECK_RESOLUTION) {
    check(runs(bright) === 2 && !bright.at(-1), `the money must blink twice and stop: ${report.moneyBlink}`);
  }
  const firstBright = bright.indexOf(true);
  if (firstBright >= 0 && cropDir) await Deno.copyFile(blink[firstBright], `${cropDir}/money-blink.png`);

  await run("impulse 100");
  await sleep(SETTLE_MS);
  const on = await shot("flashlight-on");
  report.flashlightOn = await glyphs(on, TOP_RIGHT, onBackdrop([225, 141, 0]));
  await keep(on, "flashlight-on", TOP_RIGHT);
  await e2e("battery 10", /\[e2e\] battery/);
  await sleep(SETTLE_MS);
  const low = await shot("flashlight-low");
  report.flashlightLow = await glyphs(low, TOP_RIGHT, onBackdrop([225, 14, 14]));
  await keep(low, "flashlight-low", TOP_RIGHT);
  await run("impulse 100");

  await e2e("spawn info_bomb_target 10", /\[e2e\] spawn/);
  await sleep(SETTLE_MS);
  const zone = await record("c4-zone", STATUS_ICON, () => sleep(SETTLE_MS));
  const iconRegion = { x: 0, y: 0, width: STATUS_ICON.width, height: STATUS_ICON.height };
  const red = await Promise.all(
    zone.map(async (frame) => (await glyphs(frame, iconRegion, onBackdrop([250, 0, 0]))).length > 0),
  );
  report.c4Zone = red.map(Number).join("");
  // CS switches every 0.1 s: a 2 s clip has about ten red phases.
  if (resolution === PHASE_CHECK_RESOLUTION) {
    check(runs(red) >= CLIP_SECONDS * 4, `the c4 icon does not flash in the bomb target: ${report.c4Zone}`);
  }
  const redFrame = red.indexOf(true);
  if (redFrame >= 0 && cropDir) await Deno.copyFile(zone[redFrame], `${cropDir}/c4-zone.png`);

  await e2e("suit 0", /\[e2e\] suit/);
  await sleep(SETTLE_MS);
  const noSuit = await shot("no-suit");
  const noSuitGlyphs = { bottomLeft: await glyphs(noSuit, BOTTOM_LEFT), money: await glyphs(noSuit, MONEY_ROWS) };
  report.noSuit = noSuitGlyphs;
  // CS hides health, armour and ammo without the suit and moves the money up to H - 5 fh: its glyphs start 1 px lower.
  const noSuitTop = height - NO_SUIT_MONEY_TOP;
  check(
    noSuitGlyphs.bottomLeft.length === 0 && noSuitGlyphs.money.length > 0 &&
      noSuitGlyphs.money.every((glyph) => glyph.y === noSuitTop),
    `without the suit: ${noSuitGlyphs.bottomLeft.length} bottom-left glyphs, money at ${noSuitGlyphs.money.map(box)}`,
  );
  await keep(noSuit, "no-suit", { x: width - 200, y: height - 175, width: 200, height: 175 });
  await e2e("suit 1", /\[e2e\] suit/);

  await e2e("backdrop", /\[e2e\] backdrop/);
  await sleep(SETTLE_MS);
  await keep(await shot("world"), "world-bottom-right", BOTTOM_RIGHT);

  report.failures = failures;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
if (failures.length > 0) Deno.exit(1);
