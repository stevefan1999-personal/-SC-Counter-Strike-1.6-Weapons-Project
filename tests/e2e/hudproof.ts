// HUD foundation proof (docs/hud-architecture.md): raw sprites on both channel groups and raw texts at computed pixels,
// native HUD hiding with working weapon slots, everything back after cs16_hud 0/1, a changelevel, a respawn and a
// reconnect, and .hudres stored across the reconnect.
// Usage: SVEN_SERVER_DIR=<sandbox> deno run -A tests/e2e/hudproof.ts [port] [evidence dir]
// It installs the plugins plus tests/e2e/hudproof.as into SVEN_SERVER_DIR, so point it at a sandbox (just sandbox).
import { parseSpr } from "../../tools/spr.ts";
import { Client, E2eError, just, Server, sleep } from "./driver.ts";

type Box = { x: number; y: number; width: number; height: number };

const MOTD_DELAY_MS = 5_000;
const MOTD_RETRY_MS = 1_000;
const SETTLE_MS = 3_000;
const MENU_OPEN_MS = 800;
const MENU_CLOSE_MS = 2_500; // hud_selection_timeout 1.5 s plus the 0.5 s fade-out
const CLICK_HOLD_MS = 400;
const RESPAWN_RETRY_MS = 1_000;
const RESPAWN_TRIES = 30;
// The proof texts hold 200 s; shots after 140 s show that holds above 127.99 s survive the unsigned 1/256 s field.
const TEXT_HOLD_CHECK_MS = 140_000;
const LETHAL_DAMAGE = 1_000;
const HUDRES_OWN = "1280x720";
const HUDRES_CHAT = "1600x900";
const HUDRES_BAD = "100x100";
const SERVER_RES = "1366x768";
const DEFAULT_RES = "1920x1080";
// The CS16 Weapons plugin has no concommandns in default_plugins.txt, so its cvars are reached as ".<name>".
const HUD_CVAR = ".cs16_hud";
const RES_CVAR = ".cs16_hud_res";
const LAN_STORE_FILE = "svencoop/scripts/plugins/store/cs16_hudres_STEAM_ID_LAN.txt";
const SHEET_FILE = "svencoop_addon/sprites/cs16/640hud7.spr";
const PNG_STABLE = ["-define", "png:exclude-chunks=date,time"];
// HIDEHUD_FLASHLIGHT | HIDEHUD_HEALTH | HIDEHUD_SUITPOWER | HIDEHUD_CROSSHAIR | HIDEHUD_AMMO (sven-client-hud.md 2.3)
const NATIVE_HIDE_BITS = 2 | 8 | 32 | 256 | 512;
const MAX_TICKS_PER_SECOND = 20; // CS16HUD::TICK_PERIOD 0.05 s
// Evidence scales in percent: tiny sprites enlarged, wide strips halved.
const ZOOM = 400;
const DOUBLE = 200;
const HALF = 50;
// The newest chat line, top left.
const CHAT_LINE = { x: 0, y: 0, width: 760, height: 40 };
const MIN_TICKS_PER_SECOND = 10; // half the nominal rate: a busy server is slower
const SWITCH_TRIES = 3;
const SWITCH_WAIT_MS = 10_000;

const [portArg = "27017", evidenceDir = ".e2e/shots"] = Deno.args;
const port = Number(portArg);
const serverDir = Deno.env.get("SVEN_SERVER_DIR");
const [screenWidth, screenHeight] = (Deno.env.get("CL_RESOLUTION") ?? "1600x900").split("x").map(Number);
const repoRoot = new URL("../../", import.meta.url).pathname;
const server = new Server(port);
const client = new Client();
const failures: string[] = [];
const report: Record<string, unknown> = {};

// Must match tests/e2e/hudproof.as: hud.txt rects of the CS 640hud7 sheet and their ABSOLUTE + NO_BORDER positions.
// x, y >= 0 is the left (top) edge in pixels; a negative value puts the edge at screen + value - size
// (sven-client-hud.md 1.5).
const SPRITES = {
  cross: { rect: { x: 48, y: 25, width: 24, height: 24 }, at: { x: 100, y: 200 } },
  dollar: { rect: { x: 192, y: 25, width: 18, height: 25 }, at: { x: -50, y: -60 } },
};
type SpriteName = keyof typeof SPRITES;
const edge = (value: number, screen: number, size: number) => value >= 0 ? value : screen + value - size;

// Text is a fraction inside hud_bordersize (16, the client default): x = -1/8192 puts the right end of each line at
// (1 - 1/8192) * (W - 2b) + b, and y puts the top of the line at y * (H - 2b) + b (sven-client-hudtext.md 2).
const BORDER = 16;
const RIGHT_EDGE = -1 / 8192;
const TEXT_LINES = { plain: 0.5, scan: 0.55 }; // y of the slot 5 and slot 6 texts in hudproof.as
type TextName = keyof typeof TEXT_LINES;
const TEXT_RIGHT_LIMIT = Math.floor((1 + RIGHT_EDGE) * (screenWidth - 2 * BORDER) + BORDER);
const FONT_TALL = Math.floor(12 * screenHeight / 480); // CreditsFont tall 12 at 480 lines (sven-client-hudtext.md 3)
const TRAILING_BEARING = 4; // the last glyph's ink may end a few pixels before its advance
const textTop = (name: TextName) => Math.floor(TEXT_LINES[name] * (screenHeight - 2 * BORDER) + BORDER);
const TEXT_SEARCH_WIDTH = 300; // the longest proof text is 263 px at 1600x900
const TEXT_MARGIN = 8;
const textRegion = (name: TextName): Box => ({
  x: screenWidth - TEXT_SEARCH_WIDTH,
  y: textTop(name) - TEXT_MARGIN,
  width: TEXT_SEARCH_WIDTH,
  height: FONT_TALL + 2 * TEXT_MARGIN,
});
const bothTexts: Box = {
  ...textRegion("plain"),
  height: textRegion("scan").y + textRegion("scan").height - textRegion("plain").y,
};

// Small enough that the native HUD rows (y >= H - 36) never fall inside a sprite region.
const SPRITE_MARGIN = 8;
// The client draws a sprite a little soft: up to about 10 % of a texel's light reaches the next pixel (at most 23 of
// 255 next to a texel of 247), bright texels clip at 255, and the sky behind a sprite moves by up to 10. Thus a sprite
// is found as the box of pixels whose light grew by at least this much, and compared with the box of its texels that
// are at least this bright. All proof glyphs have their outermost texels at 106 or more.
const LIGHT_THRESHOLD = 64;
const ANY_CHANGE = 1;
const RGB = 3;
const around = (box: Box, margin: number): Box => ({
  x: box.x - margin,
  y: box.y - margin,
  width: box.width + 2 * margin,
  height: box.height + 2 * margin,
});
const geometry = ({ x, y, width, height }: Box) => `${width}x${height}+${x}+${y}`;
// Native HUD parts at hud_bordersize 16: health and armour row, ammo row, flashlight, crosshair.
const NATIVE_REGIONS = {
  healthArmour: { x: 0, y: screenHeight - 44, width: 420, height: 44 },
  ammo: { x: screenWidth - 260, y: screenHeight - 44, width: 260, height: 44 },
  flashlight: { x: screenWidth - 100, y: 0, width: 100, height: 60 },
  crosshair: { x: screenWidth / 2 - 30, y: screenHeight / 2 - 30, width: 60, height: 60 },
};

async function magick(...args: string[]): Promise<string> {
  const output = await new Deno.Command("magick", { args, stdout: "piped", stderr: "null" }).output();
  if (!output.success) throw new E2eError(`magick ${args.join(" ")} failed`);
  return new TextDecoder().decode(output.stdout);
}

// Bounding box of points, or undefined for none.
function bounds(points: { x: number; y: number }[]): Box | undefined {
  if (points.length === 0) return undefined;
  const [left, top, right, bottom] = points.reduce(
    (
      [minX, minY, maxX, maxY],
      { x, y },
    ) => [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

// Bounding box (screen pixels) of the pixels inside a region whose largest red, green or blue change between two
// shots is at least `minimum` (of 255), or undefined.
async function changedBox(before: string, after: string, region: Box, minimum = ANY_CHANGE): Promise<Box | undefined> {
  const { success, stdout } = await new Deno.Command("magick", {
    args: [before, after, "-compose", "difference", "-composite", "-crop", geometry(region), "+repage", "-depth", "8"]
      .concat("rgb:-"),
    stdout: "piped",
    stderr: "null",
  }).output();
  if (!success) throw new E2eError(`magick could not compare ${before} and ${after}`);
  const changed = Array.from({ length: region.width * region.height }, (_, pixel) => pixel)
    .filter((pixel) => Math.max(...stdout.subarray(pixel * RGB, pixel * RGB + RGB)) >= minimum)
    .map((pixel) => ({ x: region.x + pixel % region.width, y: region.y + Math.floor(pixel / region.width) }));
  return bounds(changed);
}

// One evidence image: the same region of several shots, stacked top to bottom and scaled.
async function evidence(name: string, region: Box, shots: string[], scalePercent = 100): Promise<string> {
  const target = `${evidenceDir}/${name}.png`;
  const parts = shots.flatMap((shot) => ["(", shot, "-crop", geometry(region), "+repage", ")"]);
  await magick(
    ...parts,
    "-background",
    "white",
    "-splice",
    "0x2",
    "-append",
    "-scale",
    `${scalePercent}%`,
    ...PNG_STABLE,
    target,
  );
  return target;
}

function check(name: string, passed: boolean, detail: unknown) {
  report[name] = { passed, detail };
  if (!passed) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

const sameBox = (actual: Box | undefined, expected: Box) => JSON.stringify(actual) === JSON.stringify(expected);

async function installWithProof() {
  if (!serverDir) throw new E2eError("set SVEN_SERVER_DIR to a sandbox (just sandbox); this test patches its addon");
  await just("install");
  await just("install-e2e");
  const plugins = `${serverDir}/svencoop_addon/scripts/plugins/cs16`;
  await Deno.copyFile(`${repoRoot}tests/e2e/hudproof.as`, `${plugins}/hud/proof.as`);
  const entry = await Deno.readTextFile(`${plugins}/cs16_register.as`);
  const patched = entry
    .replace('#include "hud/hud"\n', '#include "hud/hud"\n#include "hud/proof"\n')
    .replace("    CS16HUD::PluginInit();\n", "    CS16HUD::PluginInit();\n    HudProof::Register();\n");
  if (!patched.includes("HudProof::Register();") || !patched.includes('#include "hud/proof"')) {
    throw new E2eError("cs16_register.as has no CS16HUD include or PluginInit call to attach the proof element to");
  }
  await Deno.writeTextFile(`${plugins}/cs16_register.as`, patched);
  await Deno.remove(`${serverDir}/${LAN_STORE_FILE}`).catch(() => {});
}

// Where each proof sprite must light up: the box of its texels of LIGHT_THRESHOLD or more, moved to its screen rect.
async function expectedSpriteBoxes(): Promise<Record<SpriteName, Box>> {
  const sheet = parseSpr(await Deno.readFile(`${serverDir}/${SHEET_FILE}`));
  const [frame] = sheet.frames;
  const bright = (sheetX: number, sheetY: number) => {
    const index = frame.pixels[sheetY * frame.width + sheetX];
    return Math.max(...sheet.palette.subarray(index * RGB, index * RGB + RGB)) >= LIGHT_THRESHOLD;
  };
  const entries = Object.entries(SPRITES).map(([name, { rect, at }]) => {
    const [left, top] = [edge(at.x, screenWidth, rect.width), edge(at.y, screenHeight, rect.height)];
    const texels = Array.from({ length: rect.width * rect.height }, (_, cell) => ({
      x: cell % rect.width,
      y: Math.floor(cell / rect.width),
    })).filter(({ x, y }) => bright(rect.x + x, rect.y + y));
    return [name, bounds(texels.map(({ x, y }) => ({ x: left + x, y: top + y })))!];
  });
  return Object.fromEntries(entries) as Record<SpriteName, Box>;
}

// After each connection: the MOTD window takes the mouse and keys until it closes, and it may open late, so press
// Return twice. The client also runs its config again, which can turn on net_graph over the bottom-right HUD.
async function settleAfterConnect() {
  await sleep(MOTD_DELAY_MS);
  await client.keys("Return");
  await sleep(MOTD_RETRY_MS);
  await client.keys("Return");
  await client.console("net_graph 0; cl_showfps 0");
}

async function waitResend(since: number, screen: string) {
  return await server.waitFor(new RegExp(`\\[hudproof\\] resend \\S+ screen ${screen} hide \\d+`), since, 90_000);
}

async function clickPrimary() {
  // Hold the button for a few client frames: an instant click can fall between two frames and do nothing.
  await client.mouseDown();
  await sleep(CLICK_HOLD_MS);
  await client.mouseUp();
}

function checkTexts(state: string, shown: string, hidden: string) {
  return Promise.all((Object.keys(TEXT_LINES) as TextName[]).map(async (name) => {
    const box = await changedBox(shown, hidden, textRegion(name));
    const right = box ? box.x + box.width : 0;
    const top = textTop(name);
    check(
      `${state} ${name} text`,
      box !== undefined && right <= TEXT_RIGHT_LIMIT && right > TEXT_RIGHT_LIMIT - TRAILING_BEARING &&
        box.y >= top && box.y + box.height <= top + FONT_TALL,
      { box, rightLimit: TEXT_RIGHT_LIMIT, top, fontTall: FONT_TALL },
    );
  }));
}

// Shot with the CS HUD on, then cs16_hud 0 (native HUD back, proof gone), then cs16_hud 1 (proof back). Each proof
// sprite must light exactly its expected box, and each text must end at the right text edge on its line.
async function proveToggle(state: string, expected: Record<SpriteName, Box>) {
  const on = await client.shot(`hudproof-${state}-on`);
  await server.commandAndWait(`as_command ${HUD_CVAR} 0`, /\[CS16HUD\] cs16_hud 0/);
  await sleep(SETTLE_MS);
  const off = await client.shot(`hudproof-${state}-off`);
  const since = (await server.log()).length;
  await server.command(`as_command ${HUD_CVAR} 1`);
  await waitResend(since, "\\S+");
  await sleep(SETTLE_MS);
  const back = await client.shot(`hudproof-${state}-back`);

  for (const sprite of Object.keys(SPRITES) as SpriteName[]) {
    const region = around(expected[sprite], SPRITE_MARGIN);
    const shown = await changedBox(on, off, region, LIGHT_THRESHOLD);
    check(`${state} ${sprite}`, sameBox(shown, expected[sprite]), { expected: expected[sprite], actual: shown });
    const returned = await changedBox(back, off, region, LIGHT_THRESHOLD);
    check(`${state} ${sprite} after cs16_hud 1`, sameBox(returned, expected[sprite]), {
      expected: expected[sprite],
      actual: returned,
    });
  }
  await checkTexts(state, on, off);
  await checkTexts(`${state} after cs16_hud 1`, back, off);
  for (const [part, region] of Object.entries(NATIVE_REGIONS)) {
    const shown = await changedBox(on, off, region);
    check(`${state} native ${part} only with cs16_hud 0`, shown !== undefined, { changed: shown });
  }
  return { on, off, back };
}

try {
  await installWithProof();
  const expected = await expectedSpriteBoxes();
  report.expected = expected;
  await server.start("testcenter");
  let since = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, since, 120_000);
  await waitResend(since, DEFAULT_RES);
  const firstResendAt = Date.now();
  await server.waitFor(/\[hudproof\] weapon \S+/, since);
  const connectSpawn = /\[hudproof\] spawn/.test((await server.log()).slice(since));
  report["spawn hook before the first resend"] = connectSpawn;
  await settleAfterConnect();

  // (c) The slot keys still open the native weapon menu and switch weapons while the native HUD parts are hidden.
  // The held weapon can change by itself after the spawn (equipment), so read it just before the key press.
  const heldWeapon = async () => [...(await server.log()).matchAll(/\[hudproof\] weapon (\S+)/g)].pop()![1];
  const before = await heldWeapon();
  since = (await server.log()).length;
  for (let tries = 0; tries < SWITCH_TRIES && !/\[hudproof\] weapon/.test((await server.log()).slice(since)); ++tries) {
    await client.keys("2");
    await sleep(MENU_OPEN_MS);
    await clickPrimary();
    await server.waitFor(/\[hudproof\] weapon \S+/, since, SWITCH_WAIT_MS).catch(() => undefined);
  }
  const after = await heldWeapon();
  check("slot key switches weapon", after !== before, { from: before, to: after });
  // Open the menu again for the picture (a shot takes longer than the menu stays open), then let it close.
  await client.keys("2");
  await sleep(MENU_OPEN_MS);
  const menu = await client.shot("hudproof-weapon-menu");
  await sleep(MENU_CLOSE_MS);
  // Texts drawn by the first resend must have survived the ResetHUD of the first spawn.
  const early = await client.shot("hudproof-early");
  // A rate window that starts after the connection, so loading does not lower it.
  const rate = await server.waitFor(/\[hudproof\] rate ticks\/s [\d.]+ frames\/s [\d.]+ hide \d+/, since, 15_000);
  const [ticks, frames, hide] = rate.match(/[\d.]+/g)!.map(Number);
  check(
    "tick and frame rates",
    ticks >= MIN_TICKS_PER_SECOND && ticks <= MAX_TICKS_PER_SECOND && frames > 0 && hide === NATIVE_HIDE_BITS,
    { ticks, frames, hide },
  );

  await sleep(Math.max(0, firstResendAt + TEXT_HOLD_CHECK_MS - Date.now()));
  const initial = await proveToggle("initial", expected);
  await checkTexts("early", early, initial.off);

  // (d) A changelevel deletes every client element; the foundation sends them again.
  since = (await server.log()).length;
  await server.command("changelevel testcenter");
  await server.waitFor(/entered the game/, since, 120_000);
  await waitResend(since, DEFAULT_RES);
  await settleAfterConnect();
  const changelevel = await proveToggle("changelevel", expected);

  // A respawn makes the client clear its HUD texts (ResetHUD); the foundation draws them again after that.
  since = (await server.log()).length;
  await server.command(`as_command e2e.hurt ${LETHAL_DAMAGE}`);
  await server.waitFor(/\[hudproof\] death/, since, 10_000);
  for (let tries = 0; tries < RESPAWN_TRIES && !/\[hudproof\] spawn/.test((await server.log()).slice(since)); ++tries) {
    await sleep(RESPAWN_RETRY_MS);
    await clickPrimary();
  }
  await server.waitFor(/\[hudproof\] spawn/, since, RESPAWN_RETRY_MS);
  await waitResend(since, DEFAULT_RES);
  await sleep(SETTLE_MS);
  const respawn = await proveToggle("respawn", expected);

  // (e) The server default follows cs16_hud_res and refuses a bad value; then the player's own .hudres from the
  // console and from chat wins, a bad value is refused, a bare !hudres reports and redraws, and the stored value
  // comes back after a reconnect.
  since = (await server.log()).length;
  await server.command(`as_command ${RES_CVAR} ${SERVER_RES}`);
  await waitResend(since, SERVER_RES);
  const refused = await server.commandAndWait(`as_command ${RES_CVAR} bogus`, /\[CS16HUD\] refused cs16_hud_res[^\n]*/);
  check("bad cs16_hud_res refused", refused.includes(`kept ${SERVER_RES}`), { refused });
  since = (await server.log()).length;
  await server.command(`as_command ${RES_CVAR} ${DEFAULT_RES}`);
  await waitResend(since, DEFAULT_RES);
  since = (await server.log()).length;
  await client.console(`.hudres ${HUDRES_OWN}`);
  await waitResend(since, HUDRES_OWN);
  since = (await server.log()).length;
  await client.console(`say /hudres ${HUDRES_CHAT}`);
  await waitResend(since, HUDRES_CHAT);
  since = (await server.log()).length;
  await client.console(`.hudres ${HUDRES_BAD}`);
  await client.console("say !hudres");
  await waitResend(since, HUDRES_CHAT);
  const badResends = (await server.log()).slice(since).match(/\[hudproof\] resend/g)?.length ?? 0;
  check("bad .hudres refused without a resend, bare !hudres resends", badResends === 1, { resends: badResends });
  await sleep(SETTLE_MS);
  const chat = await client.shot("hudproof-hudres-chat");
  const stored = (await Deno.readTextFile(`${serverDir}/${LAN_STORE_FILE}`)).trim();
  check("stored .hudres", stored === HUDRES_CHAT, { stored });
  since = (await server.log()).length;
  await client.console("retry");
  await server.waitFor(/entered the game/, since, 120_000);
  await waitResend(since, HUDRES_CHAT);
  await settleAfterConnect();
  await sleep(SETTLE_MS);
  const reconnect = await proveToggle("reconnect", expected);

  await Deno.mkdir(evidenceDir, { recursive: true });
  const spriteRegion = (name: SpriteName) => around(expected[name], SPRITE_MARGIN);
  report.evidence = await Promise.all([
    evidence("a-map-group-cross", spriteRegion("cross"), [initial.on, initial.off], ZOOM),
    evidence("a-plugin-group-dollar", spriteRegion("dollar"), [initial.on, initial.off], ZOOM),
    evidence("b-text-slots", bothTexts, [initial.on, initial.off]),
    evidence("c-native-bottom", { x: 0, y: screenHeight - 60, width: screenWidth, height: 60 }, [
      initial.on,
      initial.off,
    ], HALF),
    evidence("c-native-flashlight", NATIVE_REGIONS.flashlight, [initial.on, initial.off], DOUBLE),
    evidence("c-native-crosshair", NATIVE_REGIONS.crosshair, [initial.on, initial.off], DOUBLE),
    evidence("c-weapon-menu", { x: 0, y: 0, width: 420, height: 360 }, [menu], HALF),
    evidence("d-changelevel-texts", bothTexts, [changelevel.on, changelevel.off, changelevel.back]),
    evidence("d-respawn-texts", bothTexts, [respawn.on, respawn.off, respawn.back]),
    evidence("e-hudres-chat", CHAT_LINE, [chat]),
    evidence("e-hudres-reconnect", bothTexts, [reconnect.on]),
  ]);
} finally {
  await client.stop();
  await server.stop();
  if (serverDir) await Deno.remove(`${serverDir}/${LAN_STORE_FILE}`).catch(() => {});
}

const summary = { port, screen: `${screenWidth}x${screenHeight}`, report, failures };
await Deno.writeTextFile(`${evidenceDir}/report.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) Deno.exit(1);
