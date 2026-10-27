// Lagged-connection scenario. The client plays behind tests/e2e/lagproxy.ts, which holds each datagram for a fixed time
// in each direction (default 165 ms, a 330 ms round trip). The player fires a P90 for 4 s while scientists die in front
// of him; right after that the server sets his health to a marker value. The marker reaches the client in the reliable
// stream behind everything that the burst queued there, so the time until the HUD shows it is how far that stream is
// behind. The scenario does this with the CS HUD (cs16_hud 1) and again with the native Sven HUD (cs16_hud 0), and
// prints the times and the server's traffic for each second as JSON.
// Usage: deno run -A tests/e2e/lag.ts [port] [one-way delay ms]
// The server install (SVEN_SERVER_DIR) must already contain the game content and the e2e plugin.
import { Client, PLAYER_NAME, Server, sleep } from "./driver.ts";
import { measure } from "./hudboxes.ts";
import { LagProxy, type Traffic } from "./lagproxy.ts";
import type { Region } from "./hudcompare.ts";

const NO_MOTD_FILE = "e2e-no-motd.txt"; // a missing file: no MOTD window over the HUD
const SETTLE_MS = 1_500;
const BURST_MS = 4_000;
const KILL_INTERVAL_MS = 100;
const KILLS_PER_COMMAND = 3; // with the command round trip about ten kills a second, a busy fight
const VICTIM = "monster_scientist";
const VICTIMS = 40;
const VICTIM_FIRST_DISTANCE = 120;
const VICTIM_SPACING = 4; // the scientists stand in a line, so each kill hits the next one
const PIN_WAIT_MS = 2_500;
const FULL_HEALTH = 100;
// Health 5 is low red at full alpha in both HUDs (CS: 15 or less, Sven: 25 or less), so it shows at once, without a fade
// to wait for: the cross and one red digit.
const MARKER_HEALTH = 5;
const MARKER_GLYPHS = 2;
const LOW_RED_ON_BACKDROP = "rgb(255,32,22)"; // (250, 0, 0) added to the backdrop
const MARKER_FUZZ_PERCENT = 20;
const BACKDROP = "39 32 22";
const CATCH_UP_TIMEOUT_MS = 90_000;
const POLL_MS = 200;
const TRAFFIC_SAMPLE_MS = 1_000;

const [portArg = "27017", delayArg = "165"] = Deno.args;
const port = Number(portArg);
const delayMs = Number(delayArg);
const height = Number((Deno.env.get("CL_RESOLUTION") ?? "1600x900").split("x")[1]);
const HEALTH: Region = { x: 0, y: height - 60, width: 160, height: 60 };
const server = new Server(port);
const client = new Client();
const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);

// The burst, the marker and the time until the screen shows it, for one HUD.
async function burstAndMarker(hud: string, proxy: LagProxy) {
  await e2e(`health ${FULL_HEALTH}`, /\[e2e\] health/);
  for (let index = 0; index < VICTIMS; index++) {
    await e2e(`spawn ${VICTIM} ${VICTIM_FIRST_DISTANCE + index * VICTIM_SPACING}`, /\[e2e\] spawn/);
  }
  await sleep(PIN_WAIT_MS);
  const traffic: Array<Traffic & { second: number }> = [];
  const logStart = (await server.log()).length;
  proxy.take();
  const started = Date.now();
  const sampler = setInterval(
    () => traffic.push({ second: Math.round((Date.now() - started) / TRAFFIC_SAMPLE_MS), ...proxy.take() }),
    TRAFFIC_SAMPLE_MS,
  );
  try {
    await client.mouseDown();
    while (Date.now() - started < BURST_MS) {
      await e2e(`kill body ${KILLS_PER_COMMAND} ${VICTIM}`, /\[e2e\] killed[^\n]*/);
      await sleep(KILL_INTERVAL_MS);
    }
    await client.mouseUp();
    await e2e(`health ${MARKER_HEALTH}`, /\[e2e\] health/);
    const markerSet = Date.now();
    let shown = false;
    while (!shown && Date.now() - markerSet < CATCH_UP_TIMEOUT_MS) {
      const image = await client.shot(`lag-${hud}`);
      shown = (await measure(image, HEALTH, LOW_RED_ON_BACKDROP, MARKER_FUZZ_PERCENT)).length >= MARKER_GLYPHS;
      if (!shown) await sleep(POLL_MS);
    }
    const kills = [...(await server.log()).slice(logStart).matchAll(/\[e2e\] killed (\d+)/g)]
      .reduce((sum, [, count]) => sum + Number(count), 0);
    return { hud, catchUpMs: shown ? Date.now() - markerSet : undefined, kills, traffic };
  } finally {
    clearInterval(sampler);
  }
}

const proxy = await LagProxy.open(port, delayMs);
let caughtUp = false;
try {
  await server.start("testcenter", "server", "+motdfile", NO_MOTD_FILE);
  await client.join(server, proxy.port);
  await client.console(`cl_showfps 0; net_graph 0; name ${PLAYER_NAME}`);
  await e2e("give weapon_p90", /\[e2e\] gave/);
  await client.console("weapon_p90");
  await e2e(`backdrop ${BACKDROP}`, /\[e2e\] backdrop/);
  await sleep(SETTLE_MS);
  const cs = await burstAndMarker("cs16", proxy);
  await server.command("as_command .cs16_hud 0");
  await sleep(SETTLE_MS);
  const native = await burstAndMarker("native", proxy);
  await server.command("as_command .cs16_hud 1");
  console.log(JSON.stringify({ port, delayMs, roundTripMs: 2 * delayMs, cs, native }, null, 2));
  caughtUp = cs.catchUpMs !== undefined;
} finally {
  await client.stop();
  await server.stop();
  proxy.close();
}
if (!caughtUp) Deno.exit(1);
