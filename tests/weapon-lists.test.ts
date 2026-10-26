// The weapon lists (sprites/cs16/icons/<category>/weapon_*.txt) must show the CS 1.6 icons: the same sheets and rects
// as cstrike/sprites/weapon_*.txt, every sheet shipped and precached, and a native crosshair only where CS 1.6 draws one.
// Run: deno test -R -E tests/weapon-lists.test.ts   (reads the CS 1.6 install at CSTRIKE_DIR, as "just install" does)
import { assert, assertEquals } from "@std/assert";
import { parseSpr } from "../tools/spr.ts";

const repo = new URL("../", import.meta.url).pathname;
const cstrike = Deno.env.get("CSTRIKE_DIR") ??
  `${Deno.env.get("HOME")}/.local/share/Steam/steamapps/common/Half-Life/cstrike`;
const LIST_DIR = "sprites/cs16/icons";
const HUD_RESOLUTION = "640";
const ICON_KEYS = ["weapon", "weapon_s", "ammo"];
const HIDDEN_KEYS = ["crosshair", "zoom"];
// CS 1.6 draws no crosshair for these (cs16-client/cl_dll/ammo.cpp:1611-1615); every other weapon has one.
const NO_CROSSHAIR = ["weapon_awp", "weapon_scout", "weapon_sg550", "weapon_g3sg1"];
// Our class names that differ from the CS 1.6 list names.
const CS_LIST_NAME: Record<string, string> = {
  weapon_csm249: "weapon_m249",
  weapon_csknife: "weapon_knife",
  weapon_csdeagle: "weapon_deagle",
  weapon_csglock18: "weapon_glock18",
  weapon_dualelites: "weapon_elite",
};
const WEAPON_COUNT = 27;
const TRANSPARENT_INDEX = 255; // alpha-test sprites drop this palette index

type Row = { key: string; sprite: string; rect: number[] };

const parseList = (text: string): { count: number; rows: Row[] } => {
  const [countLine, ...lines] = text.split(/\r?\n/).map((line) => line.trim()).filter((line) =>
    line && !line.startsWith("//")
  );
  const rows = lines.map((line) => line.split(/\s+/)).filter((fields) => fields[1] === HUD_RESOLUTION)
    .map(([key, , sprite, ...rect]) => ({ key, sprite, rect: rect.map(Number) }));
  return { count: Number(countLine), rows };
};

// cstrike-assets.txt: "<path in cstrike/> [destination in svencoop_addon/]", default <dir>/cs16/<file>.
const imported = new Map(
  (await Deno.readTextFile(`${repo}cstrike-assets.txt`)).split("\n").map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")).map((line) => line.split(/\s+/))
    .map(([source, destination]) => [destination ?? source.replace(/([^/]+)$/, "cs16/$1"), `${cstrike}/${source}`]),
);
const spriteFile = (name: string) => imported.get(`sprites/${name}.spr`) ?? `${repo}sprites/${name}.spr`;
const loadSprite = async (name: string) => parseSpr(await Deno.readFile(spriteFile(name)));

const lists = (await Array.fromAsync(Deno.readDir(`${repo}${LIST_DIR}`)))
  .filter((entry) => entry.isDirectory)
  .flatMap((category) =>
    [...Deno.readDirSync(`${repo}${LIST_DIR}/${category.name}`)].map((file) => `${category.name}/${file.name}`)
  ).sort();
const readList = async (list: string) => parseList(await Deno.readTextFile(`${repo}${LIST_DIR}/${list}`));

Deno.test("every CS weapon script registers a list in the icons folder", async () => {
  const scripts = (await Array.fromAsync(Deno.readDir(`${repo}scripts/cs16`))).filter((entry) => entry.isDirectory)
    .flatMap((category) =>
      [...Deno.readDirSync(`${repo}scripts/cs16/${category.name}`)].filter((file) => /^weapon_.*\.as$/.test(file.name))
        .map((file) => `${repo}scripts/cs16/${category.name}/${file.name}`)
    );
  const expected = scripts.map((path) => {
    const source = Deno.readTextFileSync(path);
    assert(source.includes("CS16BASE::WEAPON_LIST_DIR + SPR_CAT"), `${path} does not use WEAPON_LIST_DIR`);
    return `${source.match(/string SPR_CAT\s*=\s*"([^"]+)"/)?.[1]}${path.match(/(weapon_\w+)\.as$/)?.[1]}.txt`;
  }).sort();
  assertEquals(lists, expected);
  assertEquals(lists.length, WEAPON_COUNT);
});

Deno.test("icon rows equal the CS 1.6 lists and stay inside their sheets", async () => {
  for (const list of lists) {
    const ours = await readList(list);
    assertEquals(ours.count, ours.rows.length, `${list}: count line`);
    const weapon = list.replace(/^.*\/|\.txt$/g, "");
    const cs = parseList(await Deno.readTextFile(`${cstrike}/sprites/${CS_LIST_NAME[weapon] ?? weapon}.txt`));
    for (const key of ICON_KEYS) {
      const [our, theirs] = [ours, cs].map((parsed) => parsed.rows.find((row) => row.key === key));
      assert(our && theirs, `${list}: ${key} row missing`);
      assertEquals({ sprite: our.sprite, rect: our.rect }, {
        sprite: `cs16/icons/${theirs.sprite}`,
        rect: theirs.rect,
      });
      const { header } = await loadSprite(our.sprite);
      const [x, y, width, height] = our.rect;
      assert(x + width <= header.width && y + height <= header.height, `${list}: ${key} rect leaves ${our.sprite}`);
    }
  }
});

Deno.test("the native crosshair shows the whole cross only where CS 1.6 draws a crosshair", async () => {
  const visible = (pixels: Iterable<number>) => [...pixels].filter((index) => index !== TRANSPARENT_INDEX).length;
  for (const list of lists) {
    const weapon = list.replace(/^.*\/|\.txt$/g, "");
    const rows = (await readList(list)).rows.filter((row) => HIDDEN_KEYS.includes(row.key));
    assert(rows.some((row) => row.key === "crosshair"), `${list}: no crosshair row`);
    for (const { key, sprite, rect: [x, y, width, height] } of rows) {
      const { header, frames: [frame] } = await loadSprite(sprite);
      assertEquals(header.textureFormat, "alpha-test", `${list}: ${key} sprite must be alpha-test`);
      assert(width > 0 && height > 0 && x + width <= frame.width && y + height <= frame.height, `${list}: ${key} rect`);
      const shown = visible(
        Array.from(
          { length: width * height },
          (_, pixel) => frame.pixels[(y + Math.floor(pixel / width)) * frame.width + x + pixel % width],
        ),
      );
      if (NO_CROSSHAIR.includes(weapon) || key === "zoom") {
        assertEquals(shown, 0, `${list}: ${key} must draw nothing`);
      } else {
        assert(shown > 0 && shown === visible(frame.pixels), `${list}: ${key} must draw the whole cross`);
      }
    }
  }
});

Deno.test("every sprite the lists use is shipped and precached", async () => {
  const used = new Set((await Promise.all(lists.map(readList))).flatMap(({ rows }) => rows.map((row) => row.sprite)));
  for (const sprite of used) {
    const stat = await Deno.stat(spriteFile(sprite)).catch(() => null);
    assert(stat?.isFile, `${sprite} is neither in the repository nor in cstrike-assets.txt`);
  }
  const base = await Deno.readTextFile(`${repo}scripts/cs16/base.as`);
  assert(base.includes(`WEAPON_LIST_DIR      = MAIN_CSTRIKE_DIR + "icons/"`), "WEAPON_LIST_DIR is not cs16/icons/");
  const precached = base.match(/WEAPON_LIST_SPRITES = \{([^}]*)\}/)?.[1].match(/"[^"]+"/g)
    ?.map((name) => `cs16/icons/${name.slice(1, -1)}`);
  assertEquals(new Set(precached), used);
});

Deno.test("the kill feed draws its death icons from the shipped CS sheets in the icons folder", async () => {
  const killfeed = await Deno.readTextFile(`${repo}scripts/cs16/killfeed.as`);
  const shipped = (await Deno.readTextFile(`${repo}scripts/cs16/base.as`)).match(/WEAPON_LIST_SPRITES = \{([^}]*)\}/)
    ?.[1] ?? "";
  // Player caches can hold other packs' files at sprites/cs16/640hud*.spr, so no path may point there.
  assert(!/"(sprites\/)?cs16\/640hud/.test(killfeed), "killfeed.as names a sheet outside the icons folder");
  const sheets = [...killfeed.matchAll(/MakeFrame\("(640hud\d+)"/g)].map(([, sheet]) => sheet);
  assert(sheets.length > 0, "no MakeFrame sheets found");
  for (const sheet of sheets) assert(shipped.includes(`"${sheet}"`), `${sheet} is not a shipped list sheet`);
});
