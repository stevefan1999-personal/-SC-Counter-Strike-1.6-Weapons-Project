// Kill-feed scenario: hold a CS weapon, shoot a pinned scientist until it dies, capture the feed.
// Usage: deno run -A tests/e2e/killfeed.ts [port] [weapon] [head|body] [victim classname]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, crop, Server, sleep } from "./driver.ts";

const MAX_SHOTS = 12;
const MOTD_DELAY_MS = 3_000;
const DRAW_DELAY_MS = 1_500;
const SHOT_INTERVAL_MS = 450;

const [portArg = "27017", weapon = "weapon_csdeagle", aim = "head", victim = "monster_scientist"] = Deno.args;
const port = Number(portArg);
const server = new Server(port);
const client = new Client();

try {
  await server.start("testcenter");
  const joined = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, joined, 120_000);
  await sleep(MOTD_DELAY_MS);
  await client.keys("Return");
  await client.console(weapon);
  await sleep(DRAW_DELAY_MS);
  await server.commandAndWait(`as_command e2e.spawn ${victim} 220`, /\[e2e\] pinned/);

  // Re-aim before every shot; "no live monster" means the victim died.
  let shotsFired = 0;
  for (; shotsFired < MAX_SHOTS; shotsFired++) {
    const aimed = await server.commandAndWait(`as_command e2e.aim ${aim} ${victim}`, /\[e2e\] aim[^\n]*/);
    if (aimed.includes("no live monster")) break;
    await client.click();
    await sleep(SHOT_INTERVAL_MS);
  }
  if (shotsFired === MAX_SHOTS) throw new Error(`${victim} survived ${MAX_SHOTS} shots`);

  const full = await client.shot(`killfeed-${weapon}-${aim}`);
  const feed = await crop(full, `killfeed-${weapon}-${aim}-feed`, "640x140+0+0", "NorthEast");
  console.log(JSON.stringify({ weapon, aim, victim, shotsFired, full, feed }));
} finally {
  await client.stop();
  await server.stop();
}
