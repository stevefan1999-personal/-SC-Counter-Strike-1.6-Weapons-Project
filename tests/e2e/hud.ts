// HUD scenario: walks through the CS HUD states on testcenter and saves full shots plus HUD-region crops. The last steps
// change the level and check that the health shows the settled CS colour on the new map, then let the player die with
// the C4 and check that the ammo counter and the c4 icon go. Exits 1 when a check fails.
// Usage: deno run -A tests/e2e/hud.ts [port] [label]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, crop, PLAYER_NAME, record, Server, sleep } from "./driver.ts";
import { measure } from "./hudboxes.ts";
import { addedColour, Pixels, type Region, type Rgb } from "./hudcompare.ts";
import { measureCrosshair } from "./crosshair-lines.ts";
import { burstEnvelope } from "./crosshair-model.ts";
import { load } from "../fixture/frame.ts";

const MOTD_DELAY_MS = 3_000;
const SETTLE_MS = 1_200;
const LEVEL_LOAD_MS = 120_000;
// A missing file: the server then sends no MOTD after the changelevel, whose window would cover the HUD.
const NO_MOTD_FILE = "e2e-no-motd.txt";
const KILLFEED_REDRAW_MS = 500; // the rows go out at the next HUD tick; the first notice still has 3 s of its 6
const FADE_SETTLE_MS = 6_000; // CS fades end after 5 s; the connection on the new map restarts the ammo fade
// The CS floor colour under the HUD, and HUD orange at the settled alpha 100 (cs16-hud-spec.md A.1) on top of it.
const BACKDROP: Rgb = [39, 32, 22];
const SETTLED_ORANGE: Rgb = [100, 62, 0];
// The dimmest settled glyph is the armour shield (87, 54); a fade from the old map shows 147-180 or 33-54 red.
const SETTLED_TOLERANCE = 15;
const HEALTH_GLYPHS = 4; // the cross and "100"
const LETHAL_DAMAGE = 500; // kills a player without armour
// A HUD part shows where its channel rises this much over the backdrop, on at least this many pixels: the settled ammo
// digits add 100 red and the c4 icon 160 green, and any point of their fades adds more.
const LIT_LEVELS = 40;
const MIN_LIT_PIXELS = 20;
const [RED, GREEN] = [0, 1];
const CHANNELS = 3;
// Kill-feed names: victims are monsters in T red (254,63,63 on screen) and killers the player in CT blue (153,204,254).
// The icons add HUD-orange light with no blue, so a red pixel of a name has green and blue alike, an icon pixel not.
const NAME_PIXELS = 50;
// The white pixels that the map text adds over the same view without it.
const GAME_TEXT_PIXELS = 100;
const isWhite = (pixel: Rgb) => pixel.every((value) => value > 235);
const NAME_CHANNEL_SPREAD = 25;
const isVictimRed = ([red, green, blue]: Rgb) =>
  red > 200 && green < 110 && Math.abs(green - blue) < NAME_CHANNEL_SPREAD;
const isKillerBlue = ([red, green, blue]: Rgb) => red > 130 && red < 180 && green > 185 && green < 225 && blue > 235;
// The AK-47 held for 1.5 s, recorded: its gap band once the spread has built up (from 0.5 s), and the time back to rest
// (cs16-hud-spec.md A.2; weapon_ak47.as fires every 0.0955 s). The plugin sends the lines at most every 0.1 s, one step
// of the server tick after the shot, so its samples may sit 1 px below the band, and its recovery can lag the 100 fps
// model by a send interval plus a tick and a recording frame.
const AK47_BURST = { gap: 4, shotDelta: 4, fireInterval: 0.0955, fireSeconds: 1.5 };
const AK47_CLIP = 30;
const SERIES_SETTLED_SECONDS = 0.5;
const SERIES_SECONDS = 5; // the first shot shows about 1 s into the recording, then 1.5 s of fire and the recovery
const SERIES_FRAMES_PER_SECOND = 20;
const SERIES_BAND_SLACK_PX = 1;
const RECOVERY_EARLY_S = 0.15;
const RECOVERY_LATE_S = 0.35;
const CROSSHAIR_SCALE_BASE = 640; // cl_crosshair_size auto above 1024 px (cs16-hud-spec.md 3.12.5)
const SERIES_HALF = 100; // the recorded square around the centre, inside which the widest AK-47 gap fits
const VICTIM = "monster_scientist";
const VICTIM_DISTANCES = [160, 220, 280, 340];
const WEAPONS = ["weapon_csknife", "weapon_usp", "weapon_ak47", "weapon_m3", "weapon_awp", "weapon_hegrenade"];

// Regions where CS 1.6 draws its HUD, as crop geometry plus ImageMagick gravity.
const REGIONS: Array<[string, string, string]> = [
  ["bottom-left", "480x90+0+0", "SouthWest"],
  ["bottom-right", "320x130+0+0", "SouthEast"],
  ["top-right", "640x200+0+0", "NorthEast"],
  ["top-left", "360x200+0+0", "NorthWest"],
  ["centre", "200x200+0+0", "Center"],
];

const [portArg = "27017", label = "hud"] = Deno.args;
const port = Number(portArg);
const [width, height] = (Deno.env.get("CL_RESOLUTION") ?? "1600x900").split("x").map(Number);
// The ammo row at the bottom right (below the money), and the first CS status icon slot at the left (crossW / 2,
// H / 2 - 37).
const AMMO_ROW: Region = { x: width - 200, y: height - 40, width: 200, height: 40 };
const STATUS_ICON: Region = { x: 0, y: Math.floor(height / 2) - 60, width: 60, height: 60 };
// The four kill-feed rows: from s(24) down to below the fourth row, s(200) wide at the right edge (s(n) = n * H / 480).
const SCALE_BASE_HEIGHT = 480;
const scaled = (units: number) => Math.floor(units * height / SCALE_BASE_HEIGHT);
const FEED: Region = { x: width - scaled(200), y: scaled(24), width: scaled(200), height: scaled(16) * 5 };
// The map text of e2e.gametext: white, centred, top at y 0.3 inside the 16 px HUD border, two lines of the text font.
const GAME_TEXT_TOP = Math.floor(0.3 * (height - 32) + 16);
const GAME_TEXT: Region = { x: width / 2 - 250, y: GAME_TEXT_TOP - 10, width: 500, height: scaled(24) + 20 };
const server = new Server(port);
const client = new Client();
const manifest: Array<{ step: string; full: string; crops: string[] }> = [];
const failures: string[] = [];
const report: Record<string, unknown> = {};

async function capture(step: string) {
  const full = await client.shot(`${label}-${step}`);
  const crops = await Promise.all(
    REGIONS.map(([region, geometry, gravity]) => crop(full, `${label}-${step}-${region}`, geometry, gravity)),
  );
  manifest.push({ step, full, crops });
}

const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);

async function select(weapon: string) {
  await client.console(weapon);
  await sleep(SETTLE_MS);
}

// Kills the nearest scientist with the held weapon as the inflictor (no recoil drift, so the order is fixed).
async function killNearest(aim: "head" | "body") {
  await e2e(`kill ${aim} 1 ${VICTIM}`, /\[e2e\] killed[^\n]*/);
  await sleep(250);
}

async function hold(action: () => Promise<void>, release: () => Promise<void>, step: string, holdMs: number) {
  await action();
  await sleep(holdMs);
  await capture(step);
  await release();
}

// g_Engine.time starts again with each map, so a fade that started late on the old map lies in the future of the new
// one. A health change right before the changelevel puts the start there; on the new map the unchanged health must
// still show the settled colour.
async function changeLevel() {
  await e2e("health 99", /\[e2e\] health/);
  await sleep(SETTLE_MS);
  await e2e("health 100", /\[e2e\] health/);
  await sleep(FADE_SETTLE_MS);
  await server.command(`motdfile ${NO_MOTD_FILE}`);
  const since = (await server.log()).length;
  await server.command("changelevel testcenter");
  await server.waitFor(/entered the game/, since, LEVEL_LOAD_MS);
  await sleep(SETTLE_MS);
  await e2e(`backdrop ${BACKDROP.join(" ")}`, /\[e2e\] backdrop/);
  await sleep(FADE_SETTLE_MS);
  await capture("changelevel");
  const image = manifest.at(-1)!.full;
  const region: Region = { x: 0, y: height - 60, width: 120, height: 60 };
  const [boxes, pixels] = await Promise.all([measure(image, region), Pixels.read(image, region)]);
  const glyphs = boxes.map((box) => ({ ...box, added: addedColour(pixels, box) }));
  report.changelevelHealth = glyphs;
  const settled = (added: Rgb) =>
    [0, 1].every((channel) => Math.abs(added[channel] - SETTLED_ORANGE[channel]) <= SETTLED_TOLERANCE);
  if (glyphs.length !== HEALTH_GLYPHS || !glyphs.every((glyph) => settled(glyph.added))) {
    failures.push(`after changelevel the health glyphs are not settled: ${JSON.stringify(glyphs)}`);
  }
  await e2e("backdrop", /\[e2e\] backdrop/);
}

// The west line's gap in each frame of a recording of the AK-47 at rest, during held fire and after it, against the CS
// rules at 100 frames a second.
async function crosshairSeries() {
  const centre = {
    x: Math.floor(width / 2) - SERIES_HALF,
    y: Math.floor(height / 2) - SERIES_HALF,
    width: 2 * SERIES_HALF,
    height: 2 * SERIES_HALF,
  };
  // A full clip: the firing step before held the trigger while it took its screenshot, which at 2560x1440 emptied
  // the clip, so the burst stopped after three shots.
  await e2e(`ammo ${AK47_CLIP} ${AK47_CLIP}`, /\[e2e\] ammo[^\n]*/);
  await sleep(SETTLE_MS);
  const frames = await record(
    `${label}-crosshair-series`,
    centre,
    SERIES_SECONDS,
    SERIES_FRAMES_PER_SECOND,
    async () => {
      await client.mouseDown();
      await sleep(AK47_BURST.fireSeconds * 1000);
      await client.mouseUp();
    },
  );
  const gaps = await Promise.all(frames.map(async (frame) => measureCrosshair(await load(frame)).west?.gap ?? -1));
  const restGap = gaps[0];
  const fireStart = gaps.findIndex((gap) => gap > restGap);
  const release = fireStart + Math.round(AK47_BURST.fireSeconds * SERIES_FRAMES_PER_SECOND);
  const firing = gaps.slice(fireStart + Math.round(SERIES_SETTLED_SECONDS * SERIES_FRAMES_PER_SECOND), release);
  const backAtRest = gaps.findIndex((gap, index) => index >= release && gap === restGap);
  const ours = {
    minGap: Math.min(...firing),
    maxGap: Math.max(...firing),
    recovery: backAtRest < 0 ? undefined : (backAtRest - release) / SERIES_FRAMES_PER_SECOND,
  };
  const model = burstEnvelope(AK47_BURST, width / CROSSHAIR_SCALE_BASE, SERIES_SETTLED_SECONDS);
  report.crosshairSeries = { gaps: gaps.join(" "), ours, model };
  if (fireStart < 0 || ours.minGap < model.minGap - SERIES_BAND_SLACK_PX || ours.maxGap > model.maxGap) {
    failures.push(`the held AK-47 leaves the CS band: ${JSON.stringify(report.crosshairSeries)}`);
  }
  if (
    ours.recovery === undefined || ours.recovery < model.recovery - RECOVERY_EARLY_S ||
    ours.recovery > model.recovery + RECOVERY_LATE_S
  ) {
    failures.push(`the AK-47 crosshair does not come back to rest in time: ${JSON.stringify(report.crosshairSeries)}`);
  }
}

// How many pixels of a region the HUD lit in one channel, on the backdrop.
async function litPixels(image: string, region: Region, channel: number) {
  const { data } = await Pixels.read(image, region);
  return Array.from({ length: data.length / CHANNELS }, (_, pixel) => data[pixel * CHANNELS + channel])
    .filter((value) => value - BACKDROP[channel] > LIT_LEVELS).length;
}

// The lit pixels of the ammo row (red) and of the c4 icon (green) in a step.
async function statusParts(step: string) {
  await capture(step);
  const image = manifest.at(-1)!.full;
  return { ammo: await litPixels(image, AMMO_ROW, RED), c4: await litPixels(image, STATUS_ICON, GREEN) };
}

async function regionPixels(image: string, region: Region): Promise<Rgb[]> {
  const { data } = await Pixels.read(image, region);
  return Array.from(
    { length: data.length / CHANNELS },
    (_, pixel) => [...data.subarray(pixel * CHANNELS, pixel * CHANNELS + CHANNELS)] as Rgb,
  );
}

// The victim (red) and killer (blue) name pixels of the kill feed in a shot.
async function namePixels(image: string) {
  const pixels = await regionPixels(image, FEED);
  return { victims: pixels.filter(isVictimRed).length, killers: pixels.filter(isKillerBlue).length };
}

const gameTextPixels = async (image: string) => (await regionPixels(image, GAME_TEXT)).filter(isWhite).length;

// CS sends CurWeapon without a weapon at death and drops the C4 (ReGameDLL CBasePlayer::Killed), so a dead player has
// no ammo counter and no c4 icon. Both must show first, or the check would pass without them.
async function die() {
  await e2e("give weapon_c4", /\[e2e\] gave/);
  await e2e("give weapon_ak47", /\[e2e\] gave/);
  await select("weapon_ak47");
  await e2e("armor 0", /\[e2e\] armor/);
  await e2e(`backdrop ${BACKDROP.join(" ")}`, /\[e2e\] backdrop/);
  await sleep(SETTLE_MS);
  const alive = await statusParts("alive-with-c4");
  await e2e(`hurt ${LETHAL_DAMAGE}`, /\[e2e\] hurt/);
  await sleep(SETTLE_MS);
  const dead = await statusParts("dead");
  report.death = { alive, dead };
  if (alive.ammo < MIN_LIT_PIXELS || alive.c4 < MIN_LIT_PIXELS) {
    failures.push(`alive with the C4, the check sees too little: ${JSON.stringify(alive)}`);
  }
  if (dead.ammo >= MIN_LIT_PIXELS || dead.c4 >= MIN_LIT_PIXELS) failures.push(`dead: ${JSON.stringify(dead)}`);
}

try {
  await server.start("testcenter");
  await client.join(server);
  await sleep(MOTD_DELAY_MS);
  await client.keys("Return");
  await client.console(`cl_showfps 0; net_graph 0; name ${PLAYER_NAME}`);
  await sleep(SETTLE_MS);
  await capture("spawn");

  for (const weapon of WEAPONS) {
    await select(weapon);
    await capture(`weapon-${weapon}`);
  }

  await select("weapon_ak47");
  await e2e("health 80", /\[e2e\] health/);
  await e2e("armor 50", /\[e2e\] armor/);
  await sleep(SETTLE_MS);
  await capture("health80-armor50");
  await e2e("health 20", /\[e2e\] health/);
  await sleep(SETTLE_MS);
  await capture("health20");
  await e2e("hurt 5", /\[e2e\] hurt/);
  await sleep(300);
  await capture("hurt");
  await e2e("health 100", /\[e2e\] health/);
  await e2e("armor 100", /\[e2e\] armor/);

  // Four kills in quick succession fill the CS kill feed (4 notices, 6 s each).
  for (const distance of VICTIM_DISTANCES) {
    await e2e(`spawn ${VICTIM} ${distance}`, /\[e2e\] spawn/);
  }
  await server.waitFor(/\[e2e\] pinned[\s\S]*\[e2e\] pinned[\s\S]*\[e2e\] pinned[\s\S]*\[e2e\] pinned/, 0, 10_000);
  // A map text on game_text channel 1, the Hammer default (engine text slot 4): the default kill feed leaves it alone.
  await capture("before-game-text");
  await e2e("gametext 1 Find the keycard in the office", /\[e2e\] gametext/);
  await sleep(SETTLE_MS);
  await capture("game-text");
  for (const [index] of VICTIM_DISTANCES.entries()) {
    await killNearest(index % 2 === 0 ? "head" : "body");
  }
  await capture("killfeed-4");
  // cs16_killfeed_names: 1 draws the victims only; 2 draws the killers too, as CS 1.6, on the same rows.
  await server.command("as_command .cs16_killfeed_names 2");
  await sleep(KILLFEED_REDRAW_MS);
  await capture("killfeed-4-cs");
  await server.command("as_command .cs16_killfeed_names 1");
  const [victimsOnly, allNames] = await Promise.all(manifest.slice(-2).map(({ full }) => namePixels(full)));
  report.killfeedNames = { victimsOnly, allNames };
  const shotOf = (step: string) => manifest.find((entry) => entry.step === step)!.full;
  const [noText, text, textAfterKills, textWithKillers] = await Promise.all(
    ["before-game-text", "game-text", "killfeed-4", "killfeed-4-cs"].map((step) => gameTextPixels(shotOf(step))),
  );
  report.gameText = { noText, text, textAfterKills, textWithKillers };
  if (text - noText < GAME_TEXT_PIXELS || textAfterKills - noText < GAME_TEXT_PIXELS) {
    failures.push(`the default kill feed must keep a game_text on channel 1: ${JSON.stringify(report.gameText)}`);
  }
  if (victimsOnly.victims < NAME_PIXELS || victimsOnly.killers >= NAME_PIXELS) {
    failures.push(`cs16_killfeed_names 1 must draw victims only: ${JSON.stringify(victimsOnly)}`);
  }
  if (allNames.victims < NAME_PIXELS || allNames.killers < NAME_PIXELS) {
    failures.push(`cs16_killfeed_names 2 must draw killers and victims: ${JSON.stringify(allNames)}`);
  }

  await hold(() => client.mouseDown(), () => client.mouseUp(), "crosshair-firing", 600);
  await sleep(1_500);
  await capture("crosshair-rest");
  await crosshairSeries();
  await hold(() => client.keyDown("w"), () => client.keyUp("w"), "crosshair-running", 700);
  await client.console("impulse 100");
  await sleep(SETTLE_MS);
  await capture("flashlight-on");
  await client.console("impulse 100");
  await changeLevel();
  await die();

  console.log(JSON.stringify({ label, port, manifest, report, failures }, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
if (failures.length > 0) Deno.exit(1);
