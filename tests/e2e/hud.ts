// HUD scenario: walks through the CS HUD states on testcenter and saves full shots plus HUD-region crops.
// Usage: deno run -A tests/e2e/hud.ts [port] [label]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, crop, Server, sleep } from "./driver.ts";

const MOTD_DELAY_MS = 3_000;
const SETTLE_MS = 1_200;
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
const server = new Server(port);
const client = new Client();
const manifest: Array<{ step: string; full: string; crops: string[] }> = [];

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

try {
  await server.start("testcenter");
  const joined = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, joined, 120_000);
  await sleep(MOTD_DELAY_MS);
  await client.keys("Return");
  await client.console("cl_showfps 0; net_graph 0");
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

  console.log(JSON.stringify({ label, port, manifest }, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
