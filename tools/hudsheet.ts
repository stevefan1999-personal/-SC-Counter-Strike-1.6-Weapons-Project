// Renders the HUD sprite contact sheet: hudgen frames tinted in the CS HUD colour, next to the same values cut from a
// CS 1.6 screenshot at the CS screen positions, with the pixel offset at which each pair matches best.
// Usage: deno run -R -W --allow-run=magick tools/hudsheet.ts <cstrike dir> <cs16 screenshot.png> <out.png>
import { hudSprites, renderFrames, Sheet } from "./hudgen.ts";
import { writePng } from "./spr.ts";

type Part = [file: string, frame: number, x: number];
type Element = { caption: string; parts: Part[]; width: number; height: number };

const RGB_SIZE = 3;
const RGBA_SIZE = 4;
const OPAQUE = 255;
const HUD_ORANGE = [255, 160, 0];
const FADED_ORANGE = [100, 62, 0]; // HUD orange at alpha 100, where health, armour, ammo and money settle after 5 s
const SCALE = ["-filter", "point", "-resize", "300%"];
const SEARCH = 1; // px searched around each CS position
const FONT_HEIGHT = 25; // fh of the 640 set

const magick = async (args: string[]) => {
  const { success, stdout, stderr } = await new Deno.Command("magick", { args, stdout: "piped", stderr: "piped" })
    .output();
  if (!success) throw new Error(`magick ${args[0]} failed: ${new TextDecoder().decode(stderr)}`);
  return stdout;
};

const [cstrikeDir, screenshot, outPath] = Deno.args;
if (!cstrikeDir || !screenshot || !outPath) {
  throw new Error("usage: tools/hudsheet.ts <cstrike dir> <cs16 screenshot.png> <out.png>");
}
const [screenWidth, screenHeight] = new TextDecoder().decode(await magick(["identify", "-format", "%w %h", screenshot]))
  .split(" ").map(Number);
const sheet = await Sheet.load(cstrikeDir);
const sprites = new Map(hudSprites(sheet).map((hudSprite) => [hudSprite.file, hudSprite]));
const rendered = new Map<string, ReturnType<typeof renderFrames>>();
const spriteOf = (file: string) => {
  const hudSprite = sprites.get(file);
  if (!hudSprite) throw new Error(`hudgen makes no ${file}`);
  return hudSprite;
};
const frameOf = (file: string, frame: number) => {
  if (!rendered.has(file)) rendered.set(file, renderFrames(spriteOf(file)));
  return rendered.get(file)?.[frame] ?? (() => {
    throw new RangeError(`${file} has no frame ${frame}`);
  })();
};

// Brightness map of an element: its parts' content areas added at their offsets, as CS adds the draws.
const texels = ({ parts, width, height }: Element) => {
  const map = new Float64Array(width * height);
  parts.forEach(([file, index, x]) => {
    const { content } = spriteOf(file);
    const frame = frameOf(file, index);
    for (let row = 0; row < content.height; row++) {
      for (let column = 0; column < content.width; column++) {
        map[row * width + x + column] += frame.pixels[row * frame.width + column];
      }
    }
  });
  return map;
};

const tinted = (map: Float64Array, tint: number[]) =>
  Uint8Array.from({ length: map.length * RGBA_SIZE }, (_, at) => {
    const channel = at % RGBA_SIZE;
    return channel === RGB_SIZE
      ? OPAQUE
      : Math.min(OPAQUE, Math.round(map[Math.floor(at / RGBA_SIZE)] * tint[channel] / OPAQUE));
  });

const screenRgb = (x: number, y: number, width: number, height: number) =>
  magick([screenshot, "-crop", `${width}x${height}+${x}+${y}`, "+repage", "-depth", "8", "rgb:-"]);

const rgbaOf = (rgb: Uint8Array) =>
  Uint8Array.from({ length: rgb.length / RGB_SIZE * RGBA_SIZE }, (_, at) => {
    const channel = at % RGBA_SIZE;
    return channel === RGB_SIZE ? OPAQUE : rgb[Math.floor(at / RGBA_SIZE) * RGB_SIZE + channel];
  });

// The HUD tint adds no blue, so blue predicts the background red (a linear fit on pixels the element leaves black), and
// the red that is left must be FADED_ORANGE red * texel / 255. Returns the RMS of that rest for each shift of up to
// SEARCH px, so the right placement and pixels give the smallest value.
const residuals = (map: Float64Array, element: Element, rgb: Uint8Array) => {
  const stride = element.width + 2 * SEARCH;
  const side = 2 * SEARCH + 1;
  return Array.from({ length: side ** 2 }, (_, at) => {
    const [dx, dy] = [at % side - SEARCH, Math.floor(at / side) - SEARCH];
    const pixels = Array.from(map, (texel, pixel) => {
      const offset =
        ((Math.floor(pixel / element.width) + SEARCH + dy) * stride + pixel % element.width + SEARCH + dx) *
        RGB_SIZE;
      return { texel, red: rgb[offset], blue: rgb[offset + 2] };
    });
    const background = pixels.filter(({ texel }) => texel === 0);
    const mean = (pick: (pixel: typeof pixels[number]) => number) =>
      background.reduce((sum, pixel) => sum + pick(pixel), 0) / background.length;
    const [meanBlue, meanRed] = [mean(({ blue }) => blue), mean(({ red }) => red)];
    const slope = mean(({ blue, red }) => (blue - meanBlue) * (red - meanRed)) /
      mean(({ blue }) => (blue - meanBlue) ** 2);
    const hud = pixels.filter(({ texel }) => texel > 0);
    const rest = hud.map(({ texel, red, blue }) =>
      red - meanRed - slope * (blue - meanBlue) - FADED_ORANGE[0] * texel / OPAQUE
    );
    return { dx, dy, rms: Math.sqrt(rest.reduce((sum, value) => sum + value ** 2, 0) / rest.length) };
  });
};

const element = (caption: string, parts: Part[]): Element => ({
  caption,
  parts,
  width: Math.max(...parts.map(([file, , x]) => x + spriteOf(file).content.width)),
  height: Math.max(...parts.map(([file]) => spriteOf(file).content.height)),
});
const single = (caption: string, file: string, frame: number) => element(caption, [[file, frame, 0]]);
// Ammo row as CS lays it out from W - 184: clip and bar, then the reserve from W - 102 (docs/hud-sprites.md).
const ammo = (clip: number, reserve: number) =>
  element(`ammo ${clip} | ${reserve}`, [
    ["clip.spr", clip, 0],
    [
      "reserve_hi.spr",
      reserve >= 100 ? Math.floor(reserve / 10) : reserve >= 10 ? 100 + Math.floor(reserve / 10) : 110,
      82,
    ],
    ["reserve_lo.spr", reserve % 10, 122],
  ]);
// The full icon is its own element over the armour icon and digits, as the plugin draws it.
const armor = (caption: string, file: string, value: number) =>
  element(caption, [[`${file}.spr`, value, 0], [`${file}_full.spr`, Math.min(value, 100), 0]]);
const moneyFiles = {
  "$": ["money_hi.spr", 18],
  "+": ["money_delta_plus_hi.spr", 17],
  "-": ["money_delta_minus_hi.spr", 13],
};
const money = (amount: number, sign: keyof typeof moneyFiles = "$") => {
  const [file, signWidth] = moneyFiles[sign];
  return element(`money ${sign}${amount}`, [
    [String(file), Math.floor(amount / 100), 0],
    ["money_lo.spr", amount >= 10 ? amount % 100 : 100 + amount, Number(signWidth) + 60],
  ]);
};

// CS 1.6 screen boxes (left and top edges of each element, docs/hud-sprites.md).
const row = screenHeight - FONT_HEIGHT - Math.floor(FONT_HEIGHT / 2);
const references: [Element, number, number][] = [
  [single("health 100", "health.spr", 100), 12, row],
  [armor("armour 0", "armor", 0), Math.floor(screenWidth / 5), row],
  [ammo(12, 24), screenWidth - 184, row],
  [money(800), screenWidth - 134, screenHeight - 3 * FONT_HEIGHT],
];
const showcase: Element[] = [
  ...[0, 7, 25, 100, 255].map((value) => single(`health ${value}`, "health.spr", value)),
  ...[0, 50, 100].map((value) => armor(`armour ${value}`, "armor", value)),
  ...[13, 87].map((value) => armor(`helmet ${value}`, "armor_helmet", value)),
  ammo(0, 0),
  ammo(7, 90),
  ammo(30, 255),
  ...[0, 50, 800, 16000].map((amount) => money(amount)),
  money(300, "+"),
  money(2500, "-"),
  ...[{ battery: 0, on: false }, { battery: 50, on: false }, { battery: 100, on: true }, { battery: 15, on: true }]
    .map(({ battery, on }) =>
      element(`flashlight ${battery}% ${on ? "on" : "off"}`, [
        ["flashlight.spr", Number(on), 0],
        ["flashlight_energy.spr", battery, 0],
      ])
    ),
];

const tiles = await Deno.makeTempDir({ prefix: "hudsheet-" });
try {
  const labelled: string[] = [];
  const tile = async (label: string, width: number, height: number, rgba: Uint8Array) => {
    const path = `${tiles}/${labelled.length}.png`;
    await writePng(width, height, rgba, path, SCALE);
    labelled.push("-label", label, path);
  };
  for (const [reference, x, y] of references) {
    const map = texels(reference);
    const around = await screenRgb(x - SEARCH, y - SEARCH, reference.width + 2 * SEARCH, reference.height + 2 * SEARCH);
    const fits = residuals(map, reference, around);
    const best = fits.reduce((low, fit) => fit.rms < low.rms ? fit : low);
    const exact = fits.find(({ dx, dy }) => dx === 0 && dy === 0)?.rms ?? NaN;
    console.log(
      `${reference.caption} at (${x}, ${y}): red rest RMS ${exact.toFixed(1)} in place; ` +
        fits.map(({ dx, dy, rms }) => `(${dx},${dy}) ${rms.toFixed(1)}`).join(" "),
    );
    const crop = rgbaOf(await screenRgb(x, y, reference.width, reference.height));
    await tile(`CS 1.6 ${reference.caption}`, reference.width, reference.height, crop);
    await tile(
      `hudgen (RMS ${exact.toFixed(1)}, best at ${best.dx},${best.dy})`,
      reference.width,
      reference.height,
      tinted(map, FADED_ORANGE),
    );
  }
  for (const shown of showcase) await tile(shown.caption, shown.width, shown.height, tinted(texels(shown), HUD_ORANGE));
  await magick([
    "montage",
    ...["-font", "DejaVu-Sans", "-pointsize", "13", "-fill", "white", "-background", "#202020"],
    ...labelled,
    ...["-tile", "4x", "-geometry", "+10+8", "-define", "png:exclude-chunks=date,time", outPath],
  ]);
} finally {
  await Deno.remove(tiles, { recursive: true });
}
