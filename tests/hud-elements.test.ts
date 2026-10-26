// The CS HUD elements (scripts/cs16/hud/*.as) must show each CS weapon's CS 1.6 ammo icon and send every generated
// sprite with its content size (docs/hud-sprites.md): a wrong size moves right-anchored parts and draws black padding.
// Run: deno test -R -E tests/hud-elements.test.ts   (reads the CS 1.6 install at CSTRIKE_DIR, as "just install" does)
import { assert, assertEquals } from "@std/assert";
import { hudSprites, Sheet } from "../tools/hudgen.ts";

const repo = new URL("../", import.meta.url).pathname;
const steamCommon = Deno.env.get("STEAM_COMMON") ?? `${Deno.env.get("HOME")}/.local/share/Steam/steamapps/common`;
const cstrikeDir = Deno.env.get("CSTRIKE_DIR") ?? `${steamCommon}/Half-Life/cstrike`;
const HUD_DIR = `${repo}scripts/cs16/hud`;
const LIST_DIR = `${repo}sprites/cs16/icons`;
const ROW_FIELDS = 2; // "<left>,<top>," before the ammo types of an AMMO_ICONS row

const hudSource = (await Promise.all(
  [...Deno.readDirSync(HUD_DIR)].filter((entry) => entry.name.endsWith(".as"))
    .map((entry) => Deno.readTextFile(`${HUD_DIR}/${entry.name}`)),
)).join("\n");
const quoted = (block: string) => [...block.matchAll(/"([^"]*)"/g)].map(([, text]) => text);
const listBlock = (name: string) => hudSource.match(new RegExp(`${name} = \\{([^}]*)\\}`))?.[1] ?? "";

// AMMO_ICONS: "<left>,<top>,<ammo type>,..." rows.
const ammoIcons = new Map(
  quoted(listBlock("AMMO_ICONS")).flatMap((row) => {
    const fields = row.split(",");
    const rect = fields.slice(0, ROW_FIELDS).map(Number);
    return fields.slice(ROW_FIELDS).map((ammoType) => [ammoType, rect] as const);
  }),
);

const weaponScripts = [...Deno.readDirSync(`${repo}scripts/cs16`)].filter((entry) => entry.isDirectory)
  .flatMap((category) =>
    [...Deno.readDirSync(`${repo}scripts/cs16/${category.name}`)].filter((file) => /^weapon_.*\.as$/.test(file.name))
      .map((file) => `${repo}scripts/cs16/${category.name}/${file.name}`)
  );

Deno.test("every CS weapon with ammo shows the ammo icon of its CS 1.6 weapon list", async () => {
  assert(weaponScripts.length > 0);
  for (const path of weaponScripts) {
    const source = await Deno.readTextFile(path);
    // AMMO_TYPE is a literal, or GetName() for the grenade and the C4, whose ammo is the weapon itself.
    const declared = source.match(/string AMMO_TYPE\s*=\s*(?:"([^"]*)"|GetName\(\))/);
    assert(declared, `${path}: no AMMO_TYPE`);
    const ammoType = declared[1] ?? source.match(/string GetName\(\)\s*\{\s*return\s*"([^"]+)"/)?.[1];
    if (ammoType === "") continue; // no ammo (the knife): CS draws no counter
    const category = source.match(/string SPR_CAT\s*=\s*"([^"]+)"/)?.[1];
    const list = `${LIST_DIR}/${category}${path.match(/(weapon_\w+)\.as$/)?.[1]}.txt`;
    const ammoRow = (await Deno.readTextFile(list)).split(/\r?\n/).map((line) => line.trim().split(/\s+/))
      .find(([key]) => key === "ammo");
    assert(ammoRow, `${list}: no ammo row`);
    const [, , sheet, left, top] = ammoRow;
    assertEquals(sheet, "cs16/icons/640hud7", list);
    assertEquals(ammoIcons.get(ammoType!), [Number(left), Number(top)], `${path}: ${ammoType}`);
  }
});

Deno.test("each part of a generated sprite has its content size, and every such sprite is precached", async () => {
  const content = new Map(hudSprites(await Sheet.load(cstrikeDir)).map((sprite) => [sprite.file, sprite.content]));
  const parts = [...hudSource.matchAll(/Part\(\s*GENERATED_SPRITE_DIR \+ "([\w.]+)",\s*(\d+),\s*(\d+)/g)]
    .map(([, file, width, height]) => ({ file, width: Number(width), height: Number(height) }));
  assert(parts.length > 0);
  for (const { file, width, height } of parts) assertEquals({ width, height }, content.get(file), file);
  assertEquals(quoted(listBlock("STATUS_SPRITES")).sort(), [...new Set(parts.map(({ file }) => file))].sort());
});
