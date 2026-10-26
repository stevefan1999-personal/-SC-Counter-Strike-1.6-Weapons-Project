// Kill-feed scenario: hold a CS weapon and shoot a pinned scientist at the head or the body until it dies, or let the
// world kill the player (world). Captures the feed, then the same view once the notice is gone, which is the "before"
// frame that just fixture-metrics measures the feed against.
// Usage: deno run -A tests/e2e/killfeed.ts [port] [weapon] [head|body|world] [victim classname]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, crop, Server, sleep } from "./driver.ts";

const MAX_SHOTS = 12;
const DRAW_DELAY_MS = 1_500;
const SHOT_INTERVAL_MS = 450;
const NOTICE_GONE_MS = 7_000; // a notice lasts 6 s
const FEED_DRAW_MS = 500; // the server draws a new notice at its next HUD tick, the client a frame later
const WORLD_DAMAGE = 500; // kills a player without armour
// A missing file: the server then sends no MOTD, whose window would keep the mouse, so clicks would not fire.
const NO_MOTD_FILE = "e2e-no-motd.txt";
// The name of the player in the CS 1.6 reference captures (cs16-killfeed-reference.md), so both feeds name the same killer.
const PLAYER_NAME = "Player";

const [portArg = "27017", weapon = "weapon_csdeagle", aim = "head", victim = "monster_scientist"] = Deno.args;
const port = Number(portArg);
const server = new Server(port);
const client = new Client();

try {
  await server.start("testcenter");
  await server.command(`motdfile ${NO_MOTD_FILE}`);
  await client.join(server);
  await client.console(`cl_showfps 0; net_graph 0; name ${PLAYER_NAME}`);
  await client.console(weapon);
  await sleep(DRAW_DELAY_MS);

  let shotsFired = 0;
  if (aim === "world") {
    await server.commandAndWait("as_command e2e.armor 0", /\[e2e\] armor/);
    await server.commandAndWait(`as_command e2e.hurt ${WORLD_DAMAGE}`, /\[e2e\] hurt/);
  } else {
    await server.commandAndWait(`as_command e2e.spawn ${victim} 220`, /\[e2e\] pinned/);
    // Re-aim before every shot; "no live monster" means the victim died.
    for (; shotsFired < MAX_SHOTS; shotsFired++) {
      const aimed = await server.commandAndWait(`as_command e2e.aim ${aim} ${victim}`, /\[e2e\] aim[^\n]*/);
      if (aimed.includes("no live monster")) break;
      await client.click();
      await sleep(SHOT_INTERVAL_MS);
    }
    if (shotsFired === MAX_SHOTS) throw new Error(`${victim} survived ${MAX_SHOTS} shots`);
  }

  const killedAt = Date.now();
  await sleep(FEED_DRAW_MS);
  const full = await client.shot(`killfeed-${weapon}-${aim}`);
  const feed = await crop(full, `killfeed-${weapon}-${aim}-feed`, "640x140+0+0", "NorthEast");
  await sleep(killedAt + NOTICE_GONE_MS - Date.now());
  const clear = await client.shot(`killfeed-${weapon}-${aim}-clear`);
  console.log(JSON.stringify({ weapon, aim, victim, shotsFired, full, feed, clear }));
} finally {
  await client.stop();
  await server.stop();
}
