// Static asset audit: compares the port's models and HUD sprites with Counter-Strike 1.6 and checks that every
// asset the scripts and models reference exists. Prints Markdown and writes HUD evidence images.
// Usage: deno run -R -E --allow-run=magick -W=docs/research/asset-audit tools/audit.ts > docs/research/asset-audit/report.md
// Install roots use the Justfile variables: STEAM_COMMON, CSTRIKE_DIR, SVEN_CLIENT_DIR.
// Self-check: deno test -R -E tools/audit.ts
import { walk } from "@std/fs/walk";
import { basename, dirname, join, relative } from "@std/path";
import { PALETTE_SIZE, parseMdl, type StudioModel } from "./mdl.ts";
import { frameRgba, parseSpr, type Sprite, writePng } from "./spr.ts";

const OPAQUE = 255;
const RGB_SIZE = 3;
const RGBA_SIZE = 4;
const HUD_RESOLUTION = 640; // Sven's GetSpriteList only accepts 640 entries (client.so 0x9ea50)
const HUD_ENTRY_TOKENS = 7; // name res sprite x y w h
const ICON_GAP = 4;
const LABEL_WIDTH = 150;
const MODEL_ALIASES: Record<string, string> = { "57": "fiveseven", eagle: "deagle", he: "hegrenade", bp: "backpack" };
const WEAPON_ALIASES: Record<string, string> = {
  csglock18: "glock18",
  csdeagle: "deagle",
  dualelites: "elite",
  csknife: "knife",
  csm249: "m249",
};
const HAND_TEXTURE = /glove|finger|knuckle|sleeve|_arm|arm_|view_skin|hand(?!le)/i;
// Sven's client sends 5001/5011/5021/5031 to the engine's R_MuzzleFlash (client.so 0xb62a4), which draws
// sprites/muzzleflash{type % 10 % 3 + 1}.spr from the game directory (hw.so 0x11c520, loaded at 0x1184e0).
const ENGINE_MUZZLE_EVENTS = [5001, 5011, 5021, 5031];
const ENGINE_MUZZLE_SPRITES = 3;
const DECIMAL = 10;
// 5005/5006 read a muzzle flash description from events/<options> instead (client.so 0xb62a4).
const SCRIPTED_MUZZLE_EVENTS = [5005, 5006];
const SOUND_EVENT = 5004;
// The CS client mirrors view models left-right (cs16-client cl_dll/StudioModelRenderer.cpp:713) except the knife
// and shield (:903), so CS's own files are compared the way CS players see them.
const MIRROR_EXEMPT = /knife|shield/;
const ANIMATION_TOLERANCE = 0.05; // units; recompiled float data rounds slightly
type Bounds = { min: number[]; max: number[] };
const MISSING = "MISSING";

const repo = new URL("..", import.meta.url).pathname;
const steamCommon = Deno.env.get("STEAM_COMMON") ??
  join(Deno.env.get("HOME") ?? "", ".local/share/Steam/steamapps/common");
const cstrikeDir = Deno.env.get("CSTRIKE_DIR") ?? join(steamCommon, "Half-Life/cstrike");
const valveDir = join(dirname(cstrikeDir), "valve"); // CS falls back to HL content, e.g. sprites/crosshairs.spr
const svenDir = join(Deno.env.get("SVEN_CLIENT_DIR") ?? join(steamCommon, "Sven Co-op"), "svencoop");
const evidenceDir = join(repo, "docs/research/asset-audit");
const steamRelative = (path: string) => relative(dirname(dirname(cstrikeDir)), path);
const homeRelative = (path: string) => path.replace(Deno.env.get("HOME") ?? "", "~");

const exists = async (path: string) => {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
};
const existingPaths = async (paths: string[]) => {
  const found = await Promise.all(paths.map(exists));
  return paths.filter((_, index) => found[index]);
};
const listFiles = async (root: string, exts: string[]) =>
  (await Array.fromAsync(walk(root, { exts, includeDirs: false }))).map((entry) => entry.path).sort();
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())).subarray(0, 6),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const same = (ours: Uint8Array, theirs: Uint8Array) =>
  ours.length === theirs.length && ours.every((byte, index) => byte === theirs[index]);
const listDiff = (ours: string[], theirs: string[]) => {
  const onlyOurs = ours.filter((item) => !theirs.includes(item));
  const onlyTheirs = theirs.filter((item) => !ours.includes(item));
  return onlyOurs.length + onlyTheirs.length === 0
    ? `same ${ours.length}`
    : `CS only: ${onlyTheirs.join(", ") || "-"}; ours only: ${onlyOurs.join(", ") || "-"}`;
};
const round = (value: number) => Math.round(value * 100) / 100;

// CS 1.6 assets that `just install` copies into <dir>/cs16/ (cstrike-assets.txt).
const csImports = (await Deno.readTextFile(join(repo, "cstrike-assets.txt"))).split("\n")
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  .map((asset) => ({ installed: join(dirname(asset), "cs16", basename(asset)), source: join(cstrikeDir, asset) }));

// Where a game-relative path resolves for a client: the addon repo, CS imports, then Sven's base content.
const resolveAsset = async (gamePath: string) => {
  const locations = [
    { label: `repo:${gamePath}`, path: join(repo, gamePath) },
    ...csImports.filter((asset) => asset.installed === gamePath)
      .map((asset) => ({ label: `cstrike-import:${relative(dirname(cstrikeDir), asset.source)}`, path: asset.source })),
    { label: `sven:${gamePath}`, path: join(svenDir, gamePath) },
  ];
  const found = await Promise.all(locations.map(({ path }) => exists(path)));
  return locations.find((_, index) => found[index]);
};

// ---- (a) models -------------------------------------------------------------------------------------------------

const describeModel = async (bytes: Uint8Array, model: StudioModel) => ({
  textures: await Promise.all((model.textures ?? []).map(async (texture) => {
    const flags = texture.flags ? ` [${texture.flagNames}]` : "";
    const pixels = await digest(bytes.subarray(texture.dataOffset, texture.paletteOffset + PALETTE_SIZE));
    return `${texture.name} ${texture.width}x${texture.height}${flags} #${pixels}`;
  })),
  bones: (model.bones ?? []).map((bone) => bone.name),
  sequences: (model.sequences ?? []).map((sequence) => `${sequence.label}:${sequence.numFrames}f@${sequence.fps}`),
  attachments: (model.attachments ?? []).map((attachment) =>
    `${model.bones?.[attachment.bone]?.name ?? attachment.bone}@${attachment.origin.map(round)}`
  ),
});

const eventChanges = (ours: StudioModel, theirs: StudioModel) => {
  const tally = (theirs.sequences ?? []).flatMap((sequence, index) => {
    const port = ours.sequences?.[index]?.events ?? [];
    const changed = sequence.events.map((event) => {
      const match = port.find((candidate) => candidate.frame === event.frame);
      return !match
        ? `dropped ${event.event} (${event.options})`
        : match.event !== event.event
        ? `${event.event}→${match.event}`
        : match.options !== event.options
        ? `${event.event} options`
        : "";
    });
    const added = port.filter((event) => !sequence.events.some((candidate) => candidate.frame === event.frame))
      .map((event) => `added ${event.event} (${event.options})`);
    return [...changed, ...added].filter(Boolean);
  }).reduce((counts, change) => counts.set(change, (counts.get(change) ?? 0) + 1), new Map<string, number>());
  return tally.size === 0 ? "same" : [...tally].map(([change, count]) => `${change} ×${count}`).join("; ");
};

// Model space is X forward, Y left, Z up: a view model's weapon on -Y sits on the right of the screen.
const weaponSide = (model: StudioModel) => {
  const submodels = (model.bodyParts ?? []).flatMap((part) => part.models);
  if (submodels.length === 0) return "no submodels";
  const largest = submodels.reduce((best, submodel) => submodel.numVerts > best.numVerts ? submodel : best);
  const bounds = largest.idleBounds;
  if (!bounds) return "no vertices";
  const side = (bounds.min[1] + bounds.max[1]) / 2 < 0 ? "right" : "left";
  return `${side} (${largest.name} y ${bounds.min[1]}..${bounds.max[1]})`;
};

// Largest per-frame difference of submodel bounds over every frame of every sequence.
const animationDrift = (ours: StudioModel, theirs: StudioModel, mirrored: boolean) => {
  const mirror = ({ min, max }: Bounds): Bounds =>
    mirrored ? { min: [min[0], -max[1], min[2]], max: [max[0], -min[1], max[2]] } : { min, max };
  const drift = (port: (Bounds | undefined)[], cs: (Bounds | undefined)[]) =>
    Math.max(
      0,
      ...port.flatMap((bounds, submodel) => {
        const other = cs[submodel];
        if (!bounds || !other) return [Infinity];
        const seen = mirror(other);
        return [0, 1, 2].flatMap((axis) =>
          [bounds.min[axis] - seen.min[axis], bounds.max[axis] - seen.max[axis]].map(Math.abs)
        );
      }),
    );
  const drifts = (ours.sequences ?? []).flatMap((sequence, index) => {
    const csFrames = theirs.sequences?.[index]?.numFrames;
    if (csFrames !== sequence.numFrames) return [`${sequence.label} frames ${csFrames} → ${sequence.numFrames}`];
    const worst = Math.max(
      0,
      ...Array.from(
        { length: sequence.numFrames },
        (_, frame) => drift(ours.submodelBounds!(index, frame), theirs.submodelBounds!(index, frame)),
      ),
    );
    return worst > ANIMATION_TOLERANCE ? [`${sequence.label} ${round(worst)}`] : [];
  });
  return drifts.length
    ? `drift over ${ANIMATION_TOLERANCE}: ${drifts.join(", ")}`
    : `every frame within ${ANIMATION_TOLERANCE}`;
};

async function auditModels(): Promise<string[]> {
  const models = await listFiles(join(repo, "models"), [".mdl"]);
  return (await Promise.all(models.map(async (path) => {
    const name = relative(repo, path);
    const csName = basename(path).replace(
      /^([vpw])_(\w+)\.mdl$/,
      (_, kind, weapon) => `${kind}_${MODEL_ALIASES[weapon] ?? weapon}.mdl`,
    );
    const ours = await Deno.readFile(path);
    const ourModel = parseMdl(ours);
    const flagged = (ourModel.textures ?? []).filter((texture) => texture.flags)
      .map((texture) => `${texture.name} [${texture.flagNames}]`);
    const largestTexture = Math.max(
      0,
      ...(ourModel.textures ?? []).flatMap((texture) => [texture.width, texture.height]),
    );
    const facts = [`- texture flags: ${flagged.join(", ") || "none"}; largest texture side ${largestTexture}px`];
    const [csPath] = await existingPaths([join(cstrikeDir, "models", csName)]);
    if (!csPath) return [`### ${name}`, "- no CS 1.6 counterpart (port-only asset)", ...facts];
    const theirs = await Deno.readFile(csPath);
    if (same(ours, theirs)) return [`### ${name} = cstrike/models/${csName}`, "- identical bytes", ...facts];
    const theirModel = parseMdl(theirs);
    const [port, cs] = await Promise.all([describeModel(ours, ourModel), describeModel(theirs, theirModel)]);
    const attachments = port.attachments.join(" | ") === cs.attachments.join(" | ")
      ? "same"
      : `CS [${cs.attachments.join(" | ")}] → ours [${port.attachments.join(" | ")}]`;
    const mirrored = !MIRROR_EXEMPT.test(csName);
    const side = basename(path).startsWith("v_")
      ? [
        `- idle weapon side: ours ${weaponSide(ourModel)}, CS ${weaponSide(theirModel)}`,
        `- animation vs CS as drawn in CS${mirrored ? " (mirrored)" : ""}: ${
          animationDrift(ourModel, theirModel, mirrored)
        }`,
      ]
      : [];
    return [
      `### ${name} ≠ cstrike/models/${csName}`,
      `- bytes: ${ours.length} vs CS ${theirs.length}`,
      `- textures (name size flags #pixels+palette): ${listDiff(port.textures, cs.textures)}`,
      `- bones: ${listDiff(port.bones, cs.bones)}`,
      `- sequences: ${listDiff(port.sequences, cs.sequences)}`,
      `- events: ${eventChanges(ourModel, theirModel)}`,
      `- attachments: ${attachments}`,
      ...side,
      ...facts,
    ];
  }))).flatMap((lines) => [...lines, ""]);
}

// ---- (b) sprites and HUD lists ----------------------------------------------------------------------------------

type HudEntry = { name: string; res: number; sprite: string; x: number; y: number; width: number; height: number };

// Mirrors the engine's SPR_GetList tokenizer: whitespace-separated tokens, "//" comments, a leading entry count.
export const parseHudList = (text: string) => {
  const [count = "0", ...tokens] = text.replace(/\/\/.*$/gm, "").split(/\s+/).filter(Boolean);
  const entries: HudEntry[] = Array.from({ length: Math.floor(tokens.length / HUD_ENTRY_TOKENS) }, (_, row) => {
    const [name, res, sprite, x, y, width, height] = tokens.slice(row * HUD_ENTRY_TOKENS, (row + 1) * HUD_ENTRY_TOKENS);
    return { name, res: Number(res), sprite, x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
  });
  return { declared: Number(count), entries, strayTokens: tokens.length % HUD_ENTRY_TOKENS };
};

const sprites = new Map<string, Promise<Sprite>>();
const loadSprite = (path: string) =>
  sprites.get(path) ?? sprites.set(path, Deno.readFile(path).then(parseSpr)).get(path)!;

type Icon = { width: number; height: number; rgb: Uint8Array };
// HUD icons are drawn over the scene, so compare them as they look composited on black.
const cropOnBlack = (sprite: Sprite, entry: HudEntry): Icon => {
  const frame = sprite.frames[0];
  const rgba = frameRgba(sprite, frame);
  const rgb = new Uint8Array(entry.width * entry.height * RGB_SIZE);
  for (let row = 0; row < entry.height; row++) {
    for (let column = 0; column < entry.width; column++) {
      const source = ((entry.y + row) * frame.width + entry.x + column) * RGBA_SIZE;
      const target = (row * entry.width + column) * RGB_SIZE;
      [0, 1, 2].forEach((channel) =>
        rgb[target + channel] = Math.round(rgba[source + channel] * rgba[source + 3] / OPAQUE)
      );
    }
  }
  return { width: entry.width, height: entry.height, rgb };
};
const meanDifference = (ours: Icon, theirs: Icon) =>
  ours.width !== theirs.width || ours.height !== theirs.height
    ? Infinity
    : ours.rgb.reduce((sum, value, index) => sum + Math.abs(value - theirs.rgb[index]), 0) / ours.rgb.length;
const inside = (sprite: Sprite, entry: HudEntry) =>
  entry.x >= 0 && entry.y >= 0 && entry.x + entry.width <= sprite.frames[0].width &&
  entry.y + entry.height <= sprite.frames[0].height;

const csSpritePath = async (sprite: string) =>
  (await existingPaths([join(cstrikeDir, "sprites", `${sprite}.spr`), join(valveDir, "sprites", `${sprite}.spr`)]))[0];

// Byte-identical CS 1.6 sprite for any file, whatever its name (cstrike wins over its valve fallback).
let csSpriteDigests: Promise<Map<string, string>> | undefined;
const csSpriteTwin = async (path: string) => {
  csSpriteDigests ??= Promise.all([valveDir, cstrikeDir].map((root) => listFiles(join(root, "sprites"), [".spr"])))
    .then((roots) =>
      Promise.all(roots.flat().map(async (file) => [await digest(await Deno.readFile(file)), file] as const))
    )
    .then((pairs) => new Map(pairs));
  const twin = (await csSpriteDigests).get(await digest(await Deno.readFile(path)));
  return twin ? steamRelative(twin) : undefined;
};

async function csHudEntries(weapon: string): Promise<HudEntry[]> {
  const [path] = await existingPaths([join(cstrikeDir, "sprites", `${weapon}.txt`)]);
  return path
    ? parseHudList(await Deno.readTextFile(path)).entries.filter((entry) => entry.res === HUD_RESOLUTION)
    : [];
}

async function auditSprites(): Promise<string[]> {
  const rows = await Promise.all((await listFiles(join(repo, "sprites"), [".spr"])).map(async (path) => {
    const { type, textureFormat, width, height, numFrames } = (await loadSprite(path)).header;
    const csPath = await csSpritePath(basename(path, ".spr"));
    const twin = await csSpriteTwin(path);
    const csHeader = csPath ? (await loadSprite(csPath)).header : undefined;
    const verdict = twin
      ? `identical to ${twin}`
      : csPath && csHeader
      ? `differs from ${steamRelative(csPath)} (${csHeader.width}x${csHeader.height})`
      : "no byte-identical CS 1.6 sprite";
    return `| ${relative(repo, path)} | ${type} | ${textureFormat} | ${width}x${height} | ${numFrames} | ${verdict} |`;
  }));
  const crosshair = await loadSprite(join(repo, "sprites/cs16/crosshairs.spr"));
  return [
    "| sprite | type | format | size | frames | vs CS 1.6 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `crosshairs.spr pixel (0,0): palette index ${crosshair.frames[0].pixels[0]} (alpha-test drops index 255).`,
  ];
}

async function auditHudLists(): Promise<string[]> {
  const lists = await listFiles(join(repo, "sprites"), [".txt"]);
  const csWeapons = (await Array.fromAsync(Deno.readDir(join(cstrikeDir, "sprites"))))
    .map((entry) => entry.name).filter((file) => /^weapon_.*\.txt$/.test(file)).map((file) => basename(file, ".txt"))
    .sort();
  // Every CS 640 weapon/weapon_s icon, for "which icon does this rect really show" matching.
  const csIcons = (await Promise.all(
    csWeapons.map(async (weapon) =>
      Promise.all(
        (await csHudEntries(weapon)).filter((entry) => entry.name.startsWith("weapon")).map(async (entry) => {
          const path = await csSpritePath(entry.sprite);
          return path ? [{ label: `${weapon}.${entry.name}`, icon: cropOnBlack(await loadSprite(path), entry) }] : [];
        }),
      )
    ),
  )).flat(2);

  const lines: string[] = [];
  const montageRows: { label: string; icons: Icon[] }[] = [];
  for (const path of lists) {
    const weapon = basename(path, ".txt");
    const csWeapon = `weapon_${WEAPON_ALIASES[weapon.replace(/^weapon_/, "")] ?? weapon.replace(/^weapon_/, "")}`;
    const list = parseHudList(await Deno.readTextFile(path));
    const csEntries = await csHudEntries(csWeapon);
    const consistent = list.declared === list.entries.length && list.strayTokens === 0;
    lines.push(
      `### ${relative(repo, path)} (CS: sprites/${csWeapon}.txt)`,
      `- declared ${list.declared}, parsed ${list.entries.length}, stray tokens ${list.strayTokens}${
        consistent ? "" : " ← MISMATCH"
      }`,
    );
    const icons: Icon[] = [];
    for (const entry of list.entries) {
      const resolved = await resolveAsset(`sprites/${entry.sprite}.spr`);
      const rect = `${entry.x} ${entry.y} ${entry.width} ${entry.height}`;
      const csEntry = csEntries.find((candidate) => candidate.name === entry.name);
      const csRect = csEntry
        ? `${csEntry.sprite} ${csEntry.x} ${csEntry.y} ${csEntry.width} ${csEntry.height}`
        : "absent";
      if (!resolved || entry.res !== HUD_RESOLUTION) {
        lines.push(
          `- ${entry.name} ${entry.res} ${entry.sprite} [${rect}]: sprite ${resolved?.label ?? MISSING}; CS ${csRect}`,
        );
        continue;
      }
      const sprite = await loadSprite(resolved.path);
      const { width, height } = sprite.frames[0];
      const bounds = inside(sprite, entry) ? "inside" : `OUTSIDE ${width}x${height}`;
      const comparison = await (async () => {
        if (!csEntry || !inside(sprite, entry) || !["weapon", "weapon_s", "ammo"].includes(entry.name)) return "";
        const csPath = await csSpritePath(csEntry.sprite);
        if (!csPath) return "";
        const ourIcon = cropOnBlack(sprite, entry);
        const csIcon = cropOnBlack(await loadSprite(csPath), csEntry);
        icons.push(ourIcon, csIcon);
        const difference = `; mean |Δ| vs CS ${round(meanDifference(ourIcon, csIcon))}`;
        if (entry.name === "ammo") return difference;
        const [best] = csIcons.map((candidate) => ({ ...candidate, score: meanDifference(ourIcon, candidate.icon) }))
          .sort((left, right) => left.score - right.score);
        return `${difference}, closest CS icon ${best.label} (${round(best.score)})`;
      })();
      lines.push(`- ${entry.name} ${entry.sprite} [${rect}] ${bounds} ${resolved.label}; CS ${csRect}${comparison}`);
    }
    montageRows.push({ label: weapon, icons });
    lines.push("");
  }
  await writeMontage(montageRows, join(evidenceDir, "hud-icons.png"));
  return lines;
}

// One row per weapon: label, then ours/CS pairs for weapon, weapon_s and ammo, all composited on black.
async function writeMontage(rows: { label: string; icons: Icon[] }[], outPath: string) {
  const rowHeight = Math.max(...rows.flatMap((row) => row.icons.map((icon) => icon.height))) + ICON_GAP;
  const rowWidth = (row: { icons: Icon[] }) =>
    row.icons.reduce((sum, icon) => sum + icon.width + ICON_GAP, LABEL_WIDTH);
  const width = Math.max(...rows.map(rowWidth));
  const height = rowHeight * rows.length;
  const canvas = new Uint8Array(width * height * RGBA_SIZE).map((_, index) => index % RGBA_SIZE === 3 ? OPAQUE : 0);
  rows.forEach((row, rowIndex) =>
    row.icons.reduce((left, icon) => {
      for (let y = 0; y < icon.height; y++) {
        for (let x = 0; x < icon.width; x++) {
          const source = (y * icon.width + x) * RGB_SIZE;
          const target = ((rowIndex * rowHeight + y) * width + left + x) * RGBA_SIZE;
          canvas.set(icon.rgb.subarray(source, source + RGB_SIZE), target);
        }
      }
      return left + icon.width + ICON_GAP;
    }, LABEL_WIDTH)
  );
  const labels = rows.flatMap((row, index) => ["-annotate", `+4+${Math.round((index + 0.5) * rowHeight)}`, row.label]);
  // HUD icons are grey, so a 256-colour palette keeps the evidence image small without visible loss.
  const compact = ["-alpha", "off", "-dither", "None", "-colors", "256"];
  await writePng(width, height, canvas, outPath, ["-fill", "white", "-pointsize", "13", ...labels, ...compact]);
}

// ---- (c) references ---------------------------------------------------------------------------------------------

const ASSET_LITERAL = /"([^"\n]+\.(?:mdl|spr|wav|ogg|mp3|txt))"/g;
const gamePathOf = (literal: string) =>
  /^(models|sprites|events|sound|maps)\//.test(literal)
    ? literal
    : /\.(wav|ogg|mp3)$/.test(literal)
    ? `sound/${literal}`
    : "";
const labelOf = async (gamePath: string) => (await resolveAsset(gamePath))?.label ?? MISSING;

async function auditReferences(): Promise<string[]> {
  const scripts = await listFiles(join(repo, "scripts"), [".as"]);
  const texts = new Map(await Promise.all(scripts.map(async (path) => [path, await Deno.readTextFile(path)] as const)));
  const base = texts.get(join(repo, "scripts/cs16/base.as")) ?? "";
  const codeLines = [...texts].flatMap(([path, text]) =>
    text.split("\n").map((line, index) => ({
      where: `${relative(repo, path)}:${index + 1}`,
      line,
      code: line.replace(/\/\/.*$/, ""),
    }))
  );
  const scriptRows = await Promise.all(
    codeLines.flatMap(({ where, code }) =>
      [...code.matchAll(ASSET_LITERAL)].map((match) => match[1]).filter(gamePathOf).map((literal) => ({
        where,
        literal,
      }))
    ).map(async ({ where, literal }) => ({ where, literal, found: await labelOf(gamePathOf(literal)) })),
  );
  // Weapon HUD lists are precached as MAIN_SPRITE_DIR + MAIN_CSTRIKE_DIR + SPR_CAT + classname + ".txt".
  const hudLists = await Promise.all(
    [...texts].flatMap(([path, text]) => {
      const category = text.match(/SPR_CAT\s*=\s*"([^"]+)"/)?.[1];
      const weapon = text.match(/string GetName\(\)\s*\{\s*return "([^"]+)"/)?.[1];
      return category && weapon
        ? [{ where: relative(repo, path), literal: `sprites/cs16/${category}${weapon}.txt` }]
        : [];
    }).map(async ({ where, literal }) => ({ where, literal, found: await labelOf(literal) })),
  );

  const viewModels = [...texts].flatMap(([path, text]) => {
    const viewModel = text.match(/V_MODEL\s*=\s*"([^"]+)"/)?.[1];
    return viewModel ? [{ where: `${viewModel} (${relative(repo, path)})`, text, viewModel }] : [];
  });
  const distinctEvents = async (
    viewModel: string,
    codes: number[],
    describe: (event: number, options: string) => string,
  ) => [
    ...new Set(
      (parseMdl(await Deno.readFile(join(repo, viewModel))).sequences ?? []).flatMap((sequence) => sequence.events)
        .filter((event) => codes.includes(event.event)).map((event) => describe(event.event, event.options)),
    ),
  ];
  // View model events play sounds (5004) and Sven muzzle flash scripts (5005/5006) on the client.
  const eventRows = (await Promise.all(viewModels.map(async ({ where, text, viewModel }) => {
    const references = await distinctEvents(
      viewModel,
      [SOUND_EVENT, ...SCRIPTED_MUZZLE_EVENTS],
      (event, options) => event === SOUND_EVENT ? `sound/${options}` : `events/${options}`,
    );
    return Promise.all(references.map(async (gamePath) => {
      const literal = gamePath.replace(/^(sound|events)\//, "");
      const precached = text.includes(`"${literal}"`) || base.includes(`"${literal}"`);
      return `| ${where} | ${gamePath} | ${await labelOf(gamePath)} | ${precached ? "yes" : "NO"} |`;
    }));
  }))).flat();
  // Which sprite each muzzle flash event finally draws, and whether it is the file CS 1.6 draws.
  const muzzleRows = (await Promise.all(viewModels.map(async ({ where, viewModel }) => {
    const flashes = await distinctEvents(
      viewModel,
      [...ENGINE_MUZZLE_EVENTS, ...SCRIPTED_MUZZLE_EVENTS],
      (event, options) => `${event} ${options}`,
    );
    return Promise.all(flashes.map(async (flash) => {
      const [event, options] = flash.split(" ");
      const scripted = await resolveAsset(`events/${options}`);
      const sprite = ENGINE_MUZZLE_EVENTS.includes(Number(event))
        ? `sprites/muzzleflash${Number(options) % DECIMAL % ENGINE_MUZZLE_SPRITES + 1}.spr`
        : (scripted ? (await Deno.readTextFile(scripted.path)).match(/spritename\s+(\S+)/)?.[1] : undefined) ?? MISSING;
      const resolved = await resolveAsset(sprite);
      const twin = resolved ? await csSpriteTwin(resolved.path) : undefined;
      // CS loads the same game path from cstrike/ first, so that file is what the event shows in CS 1.6.
      const csSame = await csSpritePath(sprite.replace(/^sprites\//, "").replace(/\.spr$/, ""));
      const verdict = !resolved
        ? MISSING
        : !csSame
        ? (twin ? `copy of ${twin}` : "no CS 1.6 equivalent")
        : same(await Deno.readFile(resolved.path), await Deno.readFile(csSame))
        ? "same file CS 1.6 draws"
        : `CS 1.6 draws ${steamRelative(csSame)} instead; this file is ${twin ?? "not CS art"}`;
      return `| ${where} | ${flash} | ${sprite} | ${resolved?.label ?? MISSING} | ${verdict} |`;
    }));
  }))).flat();
  // Sven's client widens a zero width/height HUD sprite rect to the sprite's right/bottom edge
  // (CHud::FixupSpriteRect, client.so 0xd5002), so such a rect draws the rest of the sheet, not one icon.
  const zeroRects = codeLines.filter(({ code }) => /\.(width|height)\s*=\s*0\s*;/.test(code))
    .map(({ where, line }) => `- ${where}: \`${line.trim()}\``);
  return [
    "#### Script literals",
    "| where | literal | resolves to |",
    "| --- | --- | --- |",
    ...[...scriptRows, ...hudLists].map(({ where, literal, found }) => `| ${where} | ${literal} | ${found} |`),
    "",
    "#### View model events",
    "| model (script) | event asset | resolves to | precached by script |",
    "| --- | --- | --- | --- |",
    ...eventRows,
    "",
    "#### Muzzle flash sprites drawn by view model events",
    "| model (script) | event options | sprite | resolves to | vs CS 1.6 |",
    "| --- | --- | --- | --- | --- |",
    ...muzzleRows,
    "",
    "#### HUD sprite rects with a zero width or height",
    ...(zeroRects.length ? zeroRects : ["- none"]),
  ];
}

// ---- (d) Sven expectations --------------------------------------------------------------------------------------

async function auditSvenExpectations(): Promise<string[]> {
  const handTextures = (paths: string[], root: string) =>
    Promise.all(paths.map(async (path) => ({
      path: relative(root, path),
      names: (parseMdl(await Deno.readFile(path)).textures ?? []).filter((texture) => HAND_TEXTURE.test(texture.name))
        .map((texture) => `${texture.name} ${texture.width}x${texture.height}`).sort().join(", ") || "none",
    })));
  const group = (entries: { path: string; names: string }[]) =>
    [...entries.reduce(
      (sets, { path, names }) => sets.set(names, [...(sets.get(names) ?? []), path]),
      new Map<string, string[]>(),
    )].map(([names, models]) => `- ${names}: ${models.join(", ")}`);
  const ourModels = await listFiles(join(repo, "models"), [".mdl"]);
  const svenViewModels = (await Array.fromAsync(Deno.readDir(join(svenDir, "models"))))
    .filter((entry) => /^v_.*\.mdl$/.test(entry.name)).map((entry) => join(svenDir, "models", entry.name)).sort();
  const skeleton = (parseMdl(await Deno.readFile(join(svenDir, "models/player.mdl"))).bones ?? []).map((bone) =>
    bone.name
  );
  const strayBones = await Promise.all(
    ourModels.filter((path) => basename(path).startsWith("p_")).map(async (path) => {
      const stray = (parseMdl(await Deno.readFile(path)).bones ?? []).map((bone) => bone.name)
        .filter((bone) => !skeleton.includes(bone));
      return `- ${relative(repo, path)}: ${
        stray.length ? `${stray.join(", ")} not in` : "all bones in"
      } svencoop/models/player.mdl`;
    }),
  );
  return [
    "#### Hand textures in the port's view models",
    ...group(await handTextures(ourModels.filter((path) => basename(path).startsWith("v_")), repo)),
    "",
    "#### Hand textures in Sven Co-op's own view models",
    ...group(await handTextures(svenViewModels, svenDir)),
    "",
    "#### Player-model (p_) bones outside Sven's player skeleton (StudioMergeBones copies bones by name)",
    ...strayBones,
  ];
}

if (import.meta.main) {
  console.log([
    "# Asset audit report (generated by tools/audit.ts)",
    "",
    `Inputs: cstrike ${homeRelative(cstrikeDir)}, Sven ${
      homeRelative(svenDir)
    }. repo: paths resolve in this repository.`,
    "",
    "## (a) Models against cstrike/models",
    "",
    ...await auditModels(),
    "## (b) Sprites",
    "",
    ...await auditSprites(),
    "",
    "## (b) HUD lists (sprites/cs16/**/weapon_*.txt) against cstrike/sprites/weapon_*.txt",
    "",
    "Montage: docs/research/asset-audit/hud-icons.png (per row: ours/CS weapon, ours/CS weapon_s, ours/CS ammo).",
    "",
    ...await auditHudLists(),
    "## (c) Referenced assets",
    "",
    ...await auditReferences(),
    "",
    "## (d) Sven Co-op expectations",
    "",
    ...await auditSvenExpectations(),
  ].join("\n"));
}

Deno.test("parses HUD lists like SPR_GetList", async () => {
  const { assertEquals } = await import("@std/assert");
  const list = parseHudList(
    "2 // two entries\nweapon\t640 cs16/cs1024\t850 270\t170\t45\r\nammo 640 cs16/640hud7 0 96 24",
  );
  assertEquals(list.declared, 2);
  assertEquals(list.entries, [{
    name: "weapon",
    res: 640,
    sprite: "cs16/cs1024",
    x: 850,
    y: 270,
    width: 170,
    height: 45,
  }]);
  assertEquals(list.strayTokens, 6);
});
