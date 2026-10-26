// Obituary scenario for the Counter-Life metamod plugin: Sven's death lines stay out of the top-left notify area, the CS
// kill feed still draws, other notify text still shows, and cl_obituary_filter 0 brings Sven's line back.
// Usage: deno run -A tests/e2e/obituary.ts [port]
// The server install (SVEN_SERVER_DIR) must hold the game content, the e2e plugin and metamod (just metamod-install).
import { Client, crop, E2eError, Server, sleep } from "./driver.ts";
import { measure } from "./hudboxes.ts";

const SETTLE_MS = 1_000;
const POLL_MS = 1_000;
const POLLS_PER_CHECK = 5;
const CHECK_ATTEMPTS = 12;
const CLEAR_POLLS = 30;
const RESPAWN_DELAY_MS = 2_000;
const LETHAL_DAMAGE = 500;
const NOTICE = "Server will change level soon";
// The ending of the line that Sven's DeathNotice builds when the world kills a player.
const WORLD_DEATH = " fell or something.";
// Sven draws notify lines in the console colour; the player's autoexec.cfg sets con_color "180 220 255".
const NOTIFY_COLOUR = "rgb(180,220,255)";
const NOTIFY_FUZZ_PERCENT = 8;
const [screenWidth] = (Deno.env.get("CL_RESOLUTION") ?? "1600x900").split("x").map(Number);
const NOTIFY_AREA = { x: 0, y: 0, width: 800, height: 140 };
const KILL_FEED = { x: screenWidth - 640, y: 60, width: 640, height: 140 };
// Errors of metamod, of a plugin hook or of the engine.
const PROBLEMS = /\[CLIFE\] (ERROR|WARNING)|panicked|didn't set meta_result|Failure calling|Sys_Error|FATAL/i;

const [portArg = "27017"] = Deno.args;
const port = Number(portArg);
const server = new Server(port);
const client = new Client();
const shots: Record<string, string> = {};

// Screenshots the game and counts the glyphs of notify lines and the icons of the kill feed (CS HUD orange).
async function look(name: string) {
  const image = await client.shot(name);
  const notify = await measure(image, NOTIFY_AREA, NOTIFY_COLOUR, NOTIFY_FUZZ_PERCENT);
  const feed = await measure(image, KILL_FEED);
  return { image, notify: notify.length, feed: feed.length };
}

// Saves the screen with enlarged crops of the notify area and the kill feed, and checks whether each shows something.
async function capture(name: string, expected: { notify: boolean; feed?: boolean }) {
  const { image, notify, feed } = await look(`obituary-${name}`);
  shots[name] = image;
  shots[`${name}-notify`] = await crop(image, `obituary-${name}-notify`, "800x140+0+0");
  shots[`${name}-feed`] = await crop(image, `obituary-${name}-feed`, "640x140+0+0", "NorthEast");
  if ((notify > 0) !== expected.notify || (expected.feed !== undefined && (feed > 0) !== expected.feed)) {
    throw new E2eError(
      `${name}: ${notify} notify glyphs and ${feed} kill-feed icons, expected ${JSON.stringify(expected)}`,
    );
  }
}

// A notify line shows only after the client has loaded the map and while no window covers the area. Only then does
// an empty area prove that no line arrived.
async function waitUntilTheNotifyAreaShowsLines() {
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt++) {
    await server.commandAndWait("as_command e2e.notify notify area check", /\[e2e\] notify/);
    for (let poll = 0; poll < POLLS_PER_CHECK; poll++) {
      await sleep(POLL_MS);
      if ((await look("obituary-check")).notify > 0) return;
    }
  }
  throw new E2eError("the notify area never showed a line");
}

async function waitUntilTheNotifyAreaIsEmpty() {
  for (let poll = 0; poll < CLEAR_POLLS; poll++) {
    if ((await look("obituary-check")).notify === 0) return;
    await sleep(POLL_MS);
  }
  throw new E2eError("the notify area kept its lines");
}

// The console copy of a printed line in the client log after `since`, once it arrives.
async function clientLineEnding(ending: string, since: number) {
  for (let poll = 0; poll < POLLS_PER_CHECK; poll++) {
    const line = (await client.log()).slice(since).split("\n").find((text) => text.endsWith(ending));
    if (line) return line;
    await sleep(POLL_MS);
  }
  throw new E2eError(`the client log got no line ending in "${ending}"`);
}

// The world kills player 1, which makes Sven's DeathNotice send "<name> fell or something.". Armour would absorb most
// of the damage, so it goes first. Returns where the server and client logs were before the death.
async function dieFromTheWorld() {
  await server.commandAndWait("as_command e2e.armor 0", /\[e2e\] armor/);
  const since = { server: (await server.log()).length, client: (await client.log()).length };
  const hurt = await server.commandAndWait(`as_command e2e.hurt ${LETHAL_DAMAGE}`, /\[e2e\] hurt to [^\n]*/);
  if (Number(hurt.split(" ").pop()) > 0) throw new E2eError(`player 1 survived the world: ${hurt}`);
  await sleep(SETTLE_MS);
  return since;
}

try {
  // With a missing MOTD file no MOTD window opens, which would hide the notify area.
  await server.start("testcenter", "server-metamod", "+motdfile", "e2e-no-motd.txt");
  // On the server, developer 1 logs each dropped line ("[CLIFE] dev: dropped obituary ...").
  await server.command("developer 1");
  const joined = (await server.log()).length;
  // developer 1 (the player's autoexec.cfg) also prints console lines at the top left; CS 1.6 players run without it.
  // The game runs the commands of its command line after autoexec.cfg.
  await client.connect(port, "+developer", "0");
  await server.waitFor(/entered the game/, joined, 120_000);
  await waitUntilTheNotifyAreaShowsLines();
  await waitUntilTheNotifyAreaIsEmpty();

  // 1. The held CS weapon kills a pinned scientist with a head shot: the kill feed draws, the notify area stays empty.
  await server.commandAndWait("as_command e2e.spawn monster_scientist 180", /\[e2e\] pinned/);
  const killed = await server.commandAndWait(
    "as_command e2e.kill head 1 monster_scientist",
    /\[e2e\] killed 1 monster\(s\) with weapon_[^\n]*/,
  );
  await sleep(SETTLE_MS);
  await capture("scientist", { notify: false, feed: true });

  // 2. The world kills the player: the plugin drops Sven's line, the kill feed shows the death.
  const filtered = await dieFromTheWorld();
  const dropped = await server.waitFor(/dropped obituary[^\n]*/, filtered.server);
  await capture("world-filtered", { notify: false, feed: true });

  // 3. Other text in the notify area still shows.
  await server.commandAndWait("as_command e2e.respawn", /\[e2e\] respawned/);
  await sleep(RESPAWN_DELAY_MS);
  await server.commandAndWait(`as_command e2e.notify ${NOTICE}`, /\[e2e\] notify/);
  await sleep(SETTLE_MS);
  await capture("notice", { notify: true });

  // 4. With the filter off, the same death shows Sven's line again.
  await waitUntilTheNotifyAreaIsEmpty();
  await server.command("cl_obituary_filter 0");
  const native = await dieFromTheWorld();
  await capture("world-native", { notify: true, feed: true });
  await server.command("cl_obituary_filter 1");
  if ((await server.log()).slice(native.server).includes("dropped obituary")) {
    throw new E2eError("the plugin dropped a line while cl_obituary_filter was 0");
  }
  const nativeLine = await clientLineEnding(WORLD_DEATH, native.client);
  // The game writes its console in order, so the log now also holds any line of the filtered death.
  if ((await client.log()).slice(filtered.client, native.client).includes(WORLD_DEATH)) {
    throw new E2eError("the client got Sven's line while cl_obituary_filter was 1");
  }

  const metamodLog = `${Deno.env.get("SVEN_SERVER_DIR") ?? ""}/metamod.log`;
  const problems = [await server.log(), await Deno.readTextFile(metamodLog).catch(() => "")]
    .flatMap((text) => text.split("\n"))
    .filter((line) => PROBLEMS.test(line));
  if (problems.length > 0) throw new E2eError(`errors in the logs:\n${problems.join("\n")}`);
  console.log(JSON.stringify({ killed, dropped, nativeLine, shots }, null, 2));
} finally {
  await client.stop();
  await server.stop();
}
