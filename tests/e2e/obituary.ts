// Obituary scenario for the Counter-Life metamod plugin: Sven's death lines stay out of the top-left notify area, the CS
// kill feed still draws, other notify text still shows, and cl_obituary_filter 0 brings Sven's line back.
// Usage: deno run -A tests/e2e/obituary.ts [port] [weapon]
// The server install (SVEN_SERVER_DIR) must hold the game content, the e2e plugin and metamod (just metamod-install).
import { Client, crop, E2eError, Server, sleep } from "./driver.ts";

const MAX_SHOTS = 12;
const MOTD_DELAY_MS = 3_000;
const DRAW_DELAY_MS = 1_500;
const SHOT_INTERVAL_MS = 450;
const RESPAWN_DELAY_MS = 2_000;
// Notify lines go away after 5 s and kill-feed notices after 6 s: capture while both show, wait for the rest.
const SETTLE_MS = 1_000;
const NOTIFY_LIFETIME_MS = 6_000;
const LETHAL_DAMAGE = 500;
const NOTICE = "Server will change level soon";
// Errors of metamod, of a plugin hook or of the engine.
const PROBLEMS = /\[CLIFE\] (ERROR|WARNING)|panicked|didn't set meta_result|Failure calling|Sys_Error|FATAL/i;

const [portArg = "27017", weapon = "weapon_csdeagle"] = Deno.args;
const port = Number(portArg);
const server = new Server(port);
const client = new Client();
const shots: Record<string, string> = {};

// Saves the screen and enlarged crops of the notify area (top left) and the kill feed (top right).
async function capture(name: string) {
  const full = await client.shot(`obituary-${name}`);
  shots[name] = full;
  shots[`${name}-notify`] = await crop(full, `obituary-${name}-notify`, "800x140+0+0");
  shots[`${name}-feed`] = await crop(full, `obituary-${name}-feed`, "640x140+0+0", "NorthEast");
}

// The world kills player 1, which makes Sven's DeathNotice send "<name> fell or something.". Armour would absorb most
// of the damage, so it goes first.
async function dieFromTheWorld(): Promise<number> {
  await server.commandAndWait("as_command e2e.armor 0", /\[e2e\] armor/);
  const since = (await server.log()).length;
  const hurt = await server.commandAndWait(`as_command e2e.hurt ${LETHAL_DAMAGE}`, /\[e2e\] hurt to [^\n]*/);
  if (Number(hurt.split(" ").pop()) > 0) throw new E2eError(`player 1 survived the world: ${hurt}`);
  return since;
}

try {
  await server.start("testcenter", "server-metamod");
  const joined = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, joined, 120_000);
  await sleep(MOTD_DELAY_MS);
  await client.keys("Return");
  // The player's autoexec turns developer on, which also prints console lines at the top left; CS 1.6 runs without.
  await client.console("developer 0; cl_showfps 0; net_graph 0");
  // On the server, developer 1 logs each dropped line ("[CLIFE] dev: dropped obituary ...").
  await server.command("developer 1");
  await client.console(weapon);
  await sleep(DRAW_DELAY_MS);

  // 1. A CS weapon kills a pinned scientist: the kill feed draws, the notify area stays empty.
  await server.commandAndWait("as_command e2e.spawn monster_scientist 180", /\[e2e\] pinned/);
  for (let shotsFired = 0;; shotsFired++) {
    if (shotsFired === MAX_SHOTS) throw new E2eError(`the scientist survived ${MAX_SHOTS} shots`);
    const aimed = await server.commandAndWait("as_command e2e.aim head monster_scientist", /\[e2e\] aim[^\n]*/);
    if (aimed.includes("no live monster")) break;
    await client.click();
    await sleep(SHOT_INTERVAL_MS);
  }
  await sleep(SETTLE_MS);
  await capture("scientist");

  // 2. The world kills the player: the plugin drops Sven's line, the kill feed shows the death.
  const filtered = await dieFromTheWorld();
  const dropped = await server.waitFor(/dropped obituary[^\n]*/, filtered);
  await sleep(SETTLE_MS);
  await capture("world-filtered");

  // 3. Other text in the notify area still shows.
  await server.commandAndWait("as_command e2e.respawn", /\[e2e\] respawned/);
  await sleep(RESPAWN_DELAY_MS);
  await server.commandAndWait(`as_command e2e.notify ${NOTICE}`, /\[e2e\] notify/);
  await sleep(SETTLE_MS);
  await capture("notice");

  // 4. With the filter off, the same death shows Sven's line again.
  await sleep(NOTIFY_LIFETIME_MS);
  await server.command("cl_obituary_filter 0");
  const native = await dieFromTheWorld();
  await sleep(SETTLE_MS);
  await capture("world-native");
  await server.command("cl_obituary_filter 1");
  if ((await server.log()).slice(native).includes("dropped obituary")) {
    throw new E2eError("the plugin dropped a line while cl_obituary_filter was 0");
  }

  const metamodLog = `${Deno.env.get("SVEN_SERVER_DIR") ?? ""}/metamod.log`;
  const problems = [await server.log(), await Deno.readTextFile(metamodLog).catch(() => "")]
    .flatMap((text) => text.split("\n"))
    .filter((line) => PROBLEMS.test(line));
  if (problems.length > 0) throw new E2eError(`errors in the logs:\n${problems.join("\n")}`);
  console.log(JSON.stringify({ weapon, dropped, shots }, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
