// HUD scenario: walks through the CS HUD states on testcenter and saves full shots plus HUD-region crops. The last step
// changes the level and checks that the health shows the settled CS colour on the new map. Exits 1 when it does not.
// Usage: deno run -A tests/e2e/hud.ts [port] [label]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, crop, PLAYER_NAME, Server, sleep } from "./driver.ts";
import { measure } from "./hudboxes.ts";
import { addedColour, Pixels, type Region, type Rgb } from "./hudcompare.ts";

const MOTD_DELAY_MS = 3_000;
const SETTLE_MS = 1_200;
const LEVEL_LOAD_MS = 120_000;
const FADE_SETTLE_MS = 6_000; // CS fades end after 5 s; the connection on the new map restarts the ammo fade
// The CS floor colour under the HUD, and HUD orange at the settled alpha 100 (cs16-hud-spec.md A.1) on top of it.
const BACKDROP: Rgb = [39, 32, 22];
const SETTLED_ORANGE: Rgb = [100, 62, 0];
// The dimmest settled glyph is the armour shield (87, 54); a fade from the old map shows 147-180 or 33-54 red.
const SETTLED_TOLERANCE = 15;
const HEALTH_GLYPHS = 4; // the cross and "100"
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
const height = Number((Deno.env.get("CL_RESOLUTION") ?? "1600x900").split("x")[1]);
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
  for (const [index] of VICTIM_DISTANCES.entries()) {
    await killNearest(index % 2 === 0 ? "head" : "body");
  }
  await capture("killfeed-4");

  await hold(() => client.mouseDown(), () => client.mouseUp(), "crosshair-firing", 600);
  await sleep(1_500);
  await capture("crosshair-rest");
  await hold(() => client.keyDown("w"), () => client.keyUp("w"), "crosshair-running", 700);
  await client.console("impulse 100");
  await sleep(SETTLE_MS);
  await capture("flashlight-on");
  await client.console("impulse 100");
  await changeLevel();

  console.log(JSON.stringify({ label, port, manifest, report, failures }, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
if (failures.length > 0) Deno.exit(1);
