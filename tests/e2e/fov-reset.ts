// FOV reset paths (docs/fov.md): CS weapons show CS's field of view, Sven's weapons keep the player's default_fov,
// and switching weapons, death, respawn and dropping a weapon never leave a zoom behind.
// Usage: deno run -A tests/e2e/fov-reset.ts [port] [map]
// The server install (SVEN_SERVER_DIR) must contain the game content and the e2e plugin. Exits with an error when a
// check fails.
import { Client, E2eError, Server, sleep } from "./driver.ts";

const MOTD_DELAY_MS = 3_000;
const DRAW_MS = 3_000;
const COMMAND_MS = 1_000;
// The CS weapons accept a zoom click every 0.3 s.
const ZOOM_MS = 1_500;
const LETHAL_DAMAGE = 10_000;
// m_iFOV in Sven's vertical degrees (base.as SvenFov). 0 is the player's own default_fov.
const PLAYER_DEFAULT = 0;
const CS_NORMAL = 74;
const CS_ZOOM_40 = 31;
const AWP_SECOND_ZOOM = 10;
// counterlife.as replaces most Half-Life weapons with CS ones; Sven's medkit stays a native weapon.
const SVEN_WEAPON = "weapon_medkit";

const [portArg = "27017", map = "testcenter"] = Deno.args;
const port = Number(portArg);
const server = new Server(port);
const client = new Client();
const failures: string[] = [];

const e2e = (command: string, reply: RegExp) => server.commandAndWait(`as_command e2e.${command}`, reply);

const run = async (command: string) => {
  await e2e(`stuff "${command}"`, /\[e2e\] stuffed/);
  await sleep(COMMAND_MS);
};

const select = async (weapon: string) => {
  await e2e(`give ${weapon}`, /\[e2e\] gave/);
  await run(`vgui_closeall; ${weapon}`);
  await sleep(DRAW_MS);
};

const zoom = async () => {
  await client.click(3);
  await sleep(ZOOM_MS);
};

// "[e2e] fov <m_iFOV> weapon <classname> <script|native> <alive|dead>"
const check = async (step: string, wanted: (weapon: { script: boolean }) => number) => {
  const line = await e2e("fov", /\[e2e\] fov [^\n]*/);
  const [, , fov, , , kind] = line.split(" ");
  const expected = wanted({ script: kind === "script" });
  if (Number(fov) !== expected) failures.push(step);
  console.log(
    `${Number(fov) === expected ? "ok  " : "FAIL"} ${step}: wanted ${expected}, ${line.replace("[e2e] ", "")}`,
  );
};
const exactly = (fov: number) => () => fov;
// After a reset the view belongs to whatever weapon is now held: CS's normal view or the player's own.
const unzoomed = ({ script }: { script: boolean }) => script ? CS_NORMAL : PLAYER_DEFAULT;

try {
  await server.start(map);
  const joined = (await server.log()).length;
  await client.connect(port);
  await server.waitFor(/entered the game/, joined, 120_000);
  await sleep(MOTD_DELAY_MS);

  await select("weapon_usp");
  await check("a CS weapon shows CS's normal view", exactly(CS_NORMAL));
  await select(SVEN_WEAPON);
  await check("Sven's weapon gets the player's own view back", exactly(PLAYER_DEFAULT));

  await select("weapon_awp");
  await zoom();
  await check("first AWP zoom", exactly(CS_ZOOM_40));
  await zoom();
  await check("second AWP zoom stops at Sven's minimum", exactly(AWP_SECOND_ZOOM));
  await run(SVEN_WEAPON);
  await sleep(DRAW_MS);
  await check("switching to Sven's weapon while zoomed", exactly(PLAYER_DEFAULT));
  await run("weapon_awp");
  await sleep(DRAW_MS);
  await check("the AWP comes back unzoomed", exactly(CS_NORMAL));

  await zoom();
  await e2e(`hurt ${LETHAL_DAMAGE}`, /\[e2e\] hurt/);
  await sleep(DRAW_MS);
  await check("death while zoomed", unzoomed);
  await e2e("respawn", /\[e2e\] respawned/);
  await sleep(DRAW_MS);
  await check("respawn", unzoomed);

  await select("weapon_usp");
  await run("drop");
  await sleep(DRAW_MS);
  await check("dropping the held CS weapon", unzoomed);

  if (failures.length > 0) throw new E2eError(`FOV checks failed: ${failures.join("; ")}`);
} finally {
  await client.stop();
  await server.stop();
}
