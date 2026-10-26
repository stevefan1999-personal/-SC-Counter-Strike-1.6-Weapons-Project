// Checks the sprite writer and every frame of the generated HUD sprites against the CS 1.6 sheet.
// Run: deno test -R -E tools/   (CSTRIKE_DIR and STEAM_COMMON as in the Justfile)
import { assertEquals } from "@std/assert";
import { encodeSpr, parseSpr } from "./spr.ts";
import {
  BLANK,
  encodeHudSprite,
  HUD_TXT_FILE,
  hudSprites,
  moneyHighCells,
  parseHudTxt,
  type Rect,
  Sheet,
  SHEET_FILE,
  threeCells,
  twoCells,
} from "./hudgen.ts";

const steamCommon = Deno.env.get("STEAM_COMMON") ?? `${Deno.env.get("HOME")}/.local/share/Steam/steamapps/common`;
const cstrikeDir = Deno.env.get("CSTRIKE_DIR") ?? `${steamCommon}/Half-Life/cstrike`;
const sheet = await Sheet.load(cstrikeDir);

Deno.test("640hud7.spr decodes, encodes back to the same bytes and decodes the same", async () => {
  const bytes = await Deno.readFile(`${cstrikeDir}/${SHEET_FILE}`);
  const sprite = parseSpr(bytes);
  const encoded = encodeSpr(sprite);
  assertEquals(encoded, bytes);
  assertEquals(parseSpr(encoded), sprite);
});

// The rects of docs/hud-sprites.md, which the AngelScript HUD also uses.
const CONTRACT_RECTS: Record<string, [number, number, number, number]> = {
  number_0: [0, 0, 20, 25],
  number_1: [23, 0, 20, 25],
  number_2: [47, 0, 20, 25],
  number_3: [70, 0, 20, 25],
  number_4: [95, 0, 20, 25],
  number_5: [119, 0, 20, 25],
  number_6: [144, 0, 20, 25],
  number_7: [169, 0, 20, 25],
  number_8: [192, 0, 20, 25],
  number_9: [216, 0, 20, 25],
  cross: [48, 25, 24, 24],
  suit_full: [0, 25, 24, 24],
  suit_empty: [24, 25, 24, 24],
  suithelmet_full: [0, 124, 24, 24],
  suithelmet_empty: [24, 124, 24, 24],
  dollar: [192, 25, 18, 25],
  plus: [223, 25, 17, 23],
  minus: [210, 25, 13, 23],
  flash_full: [160, 25, 32, 32],
  flash_empty: [112, 25, 32, 32],
  flash_beam: [144, 25, 16, 32],
  stopwatch: [144, 72, 24, 24],
};

Deno.test("cstrike hud.txt has the contract rects on 640hud7", async () => {
  const rects = parseHudTxt(await Deno.readTextFile(`${cstrikeDir}/${HUD_TXT_FILE}`));
  Object.entries(CONTRACT_RECTS).forEach(([name, [x, y, width, height]]) =>
    assertEquals(rects.get(name), { sheet: "640hud7", x, y, width, height }, name)
  );
});

// An independent statement of the contract: each frame is the sum of these layers as Valve's engine draws them
// (half-texel inset, bilinear: pixel k of a w-wide rect shows texel k * (w - 1) / w), black elsewhere. The sum is not
// clamped: CS multiplies each layer by the HUD colour before the framebuffer adds them, so a frame whose layers add
// up above white could not look like CS and fails here.
type Layer = { name: string; x: number; y: number; crop?: Partial<Rect> } | { fill: Rect };
const digitLayers = (text: string, x: number): Layer[] =>
  [...text].flatMap((char, cell) => char === BLANK ? [] : [{ name: `number_${char}`, x: x + cell * 20, y: 0 }]);
const groupText = (frame: number) =>
  frame < 100 ? `${Math.floor(frame / 10)}${frame % 10}` : frame < 110 ? ` ${frame - 100}` : "  ";
const armorLayers = (prefix: string) => (value: number): Layer[] => [
  { name: `${prefix}_empty`, x: 0, y: 0 },
  ...digitLayers(String(value).padStart(3), 24),
];
// CS: rc.top = (int)(top + (100 - armour) * 0.01 * 24) for armour <= 99 (client.so 0xa4a93-0xa4ac2).
const armorFullLayers = (prefix: string) => (value: number): Layer[] => {
  const offset = Math.trunc((100 - value) * 0.01 * 24);
  return offset < 24
    ? [{
      name: `${prefix}_full`,
      x: 0,
      y: offset,
      crop: { y: CONTRACT_RECTS[`${prefix}_full`][1] + offset, height: 24 - offset },
    }]
    : [];
};
const moneyLayers = (sign: string, signWidth: number) => (hundreds: number): Layer[] => [
  { name: sign, x: 0, y: 0 },
  ...digitLayers(String(hundreds * 100).padStart(5).slice(0, 3), signWidth),
];
// CS keeps the battery as a float fraction: off = (int)((1 - bat) * 32).
const energyLayers = (battery: number): Layer[] => {
  const offset = Math.trunc((1 - Math.fround(battery / 100)) * 32);
  return offset < 32 ? [{ name: "flash_full", x: offset, y: 0, crop: { x: 160 + offset, width: 32 - offset } }] : [];
};

const CONTRACT: Record<
  string,
  { frames: number; size: [number, number]; content: [number, number]; layers: (frame: number) => Layer[] }
> = {
  "health.spr": {
    frames: 256,
    size: [128, 32],
    content: [82, 25],
    layers: (value) => [{ name: "cross", x: 0, y: 0 }, ...digitLayers(String(value).padStart(3), 22)],
  },
  "armor.spr": { frames: 256, size: [128, 32], content: [84, 25], layers: armorLayers("suit") },
  "armor_full.spr": { frames: 101, size: [32, 32], content: [24, 25], layers: armorFullLayers("suit") },
  "armor_helmet.spr": { frames: 256, size: [128, 32], content: [84, 25], layers: armorLayers("suithelmet") },
  "armor_helmet_full.spr": { frames: 101, size: [32, 32], content: [24, 25], layers: armorFullLayers("suithelmet") },
  "clip.spr": {
    frames: 256,
    size: [128, 32],
    content: [72, 25],
    layers: (value) => [...digitLayers(String(value).padStart(3), 0), { fill: { x: 70, y: 0, width: 2, height: 25 } }],
  },
  "two_cells.spr": {
    frames: 111,
    size: [64, 32],
    content: [40, 25],
    layers: (frame) => digitLayers(groupText(frame), 0),
  },
  "reserve_lo.spr": {
    frames: 11,
    size: [32, 32],
    content: [20, 25],
    layers: (digit) => digit < 10 ? digitLayers(String(digit), 0) : [],
  },
  "money_hi.spr": { frames: 256, size: [128, 32], content: [78, 25], layers: moneyLayers("dollar", 18) },
  "money_delta_plus_hi.spr": { frames: 256, size: [128, 32], content: [77, 25], layers: moneyLayers("plus", 17) },
  "money_delta_minus_hi.spr": { frames: 256, size: [128, 32], content: [73, 25], layers: moneyLayers("minus", 13) },
  "flashlight.spr": {
    frames: 2,
    size: [64, 32],
    content: [48, 32],
    layers: (on) => [{ name: "flash_empty", x: 0, y: 0 }, ...(on ? [{ name: "flash_beam", x: 32, y: 0 }] : [])],
  },
  "flashlight_energy.spr": { frames: 101, size: [64, 32], content: [48, 32], layers: energyLayers },
  "fill.spr": {
    frames: 1,
    size: [64, 64],
    content: [64, 64],
    layers: () => [{ fill: { x: 0, y: 0, width: 64, height: 64 } }],
  },
};

const expectedPixel = (layers: Layer[], x: number, y: number) =>
  layers.reduce((sum, layer) => {
    if ("fill" in layer) {
      const { fill } = layer;
      return sum + (x >= fill.x && x < fill.x + fill.width && y >= fill.y && y < fill.y + fill.height ? 255 : 0);
    }
    const [rectX, rectY, rectWidth, rectHeight] = CONTRACT_RECTS[layer.name];
    const crop = { x: rectX, y: rectY, width: rectWidth, height: rectHeight, ...layer.crop };
    const [column, row] = [x - layer.x, y - layer.y];
    if (column < 0 || row < 0 || column >= crop.width || row >= crop.height) return sum;
    const [sourceX, sourceY] = [column * (crop.width - 1) / crop.width, row * (crop.height - 1) / crop.height];
    const [left, top] = [Math.floor(sourceX), Math.floor(sourceY)];
    const [right, bottom] = [Math.min(left + 1, crop.width - 1), Math.min(top + 1, crop.height - 1)];
    const at = (texelX: number, texelY: number) =>
      sheet.frame.pixels[(crop.y + texelY) * sheet.frame.width + crop.x + texelX];
    const [fractionX, fractionY] = [sourceX - left, sourceY - top];
    const across = (texelY: number) => at(left, texelY) * (1 - fractionX) + at(right, texelY) * fractionX;
    return sum + Math.round(across(top) * (1 - fractionY) + across(bottom) * fractionY);
  }, 0);

Deno.test("hudgen writes the contract files", () => {
  assertEquals(hudSprites(sheet).map(({ file }) => file), Object.keys(CONTRACT));
  hudSprites(sheet).forEach(({ file, frames, content }) =>
    assertEquals({ frames, content: [content.width, content.height] }, {
      frames: CONTRACT[file].frames,
      content: CONTRACT[file].content,
    }, file)
  );
});

for (const hudSprite of hudSprites(sheet)) {
  Deno.test(`every frame of ${hudSprite.file} equals its CS layers`, () => {
    const { header, palette, frames } = parseSpr(encodeHudSprite(sheet, hudSprite));
    const contract = CONTRACT[hudSprite.file];
    assertEquals([header.textureFormat, header.width, header.height], ["additive", ...contract.size]);
    assertEquals(palette, sheet.sprite.palette);
    assertEquals(frames.length, contract.frames);
    frames.forEach((frame, index) => {
      assertEquals([frame.width, frame.height, frame.origin, frame.interval], [...contract.size, [0, 0], 0]);
      const layers = contract.layers(index);
      const mismatch = frame.pixels.findIndex((value, at) =>
        value !== expectedPixel(layers, at % frame.width, Math.floor(at / frame.width))
      );
      assertEquals(mismatch, -1, `${hudSprite.file} frame ${index} differs at pixel ${mismatch}`);
    });
  });
}

// A client never downloads a path again once it has a file there (docs/hud-sprites.md, Changes). These are the bytes
// shipped under sprites/cs16/hud/: when one changes, move the output to a new directory, then update the hash.
const SHIPPED_SHA1: Record<string, string> = {
  "health.spr": "9d21cf5cd0c89f79c66ab0c6f467f281849cb8b6",
  "armor.spr": "30dffcf00f35ed8a844d3c6b51ad077a014fbe01",
  "armor_full.spr": "c6418d08c3e6261174831363872da3f68a3e49cf",
  "armor_helmet.spr": "5d22f1799c2af004df0bcf8df38015dc9f5d1473",
  "armor_helmet_full.spr": "c2beeb60a4b82afa69b66b263b8f832684de320d",
  "clip.spr": "4a0167c60dddfb975ea59b9248c07e80abc1d611",
  "two_cells.spr": "f333071ddc4be38112d7fb52241dbbe8d48ad71c",
  "reserve_lo.spr": "94fc76058e886844bb297e7a88491487eb1e7867",
  "money_hi.spr": "410af1e2f29e276dd2b3c31e6a0b01ec5b8fde76",
  "money_delta_plus_hi.spr": "bf9321b00b0fab5e04134bec91a23228636308aa",
  "money_delta_minus_hi.spr": "33c4610ee37eee4c21b685543e69506a62e2b203",
  "flashlight.spr": "74633fbfcde66094924c52f939003aed97181205",
  "flashlight_energy.spr": "3f8c0e65ffee19984d130aef1cceec11fbe51bf9",
  "fill.spr": "8d1ee209ece09252ff30f5282cf213292b1be9b3",
};

Deno.test("hudgen writes the bytes that clients already cached under sprites/cs16/hud", async () => {
  const sha1 = async (bytes: Uint8Array) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-1", bytes.slice())),
      (byte) => byte.toString(16).padStart(2, "0"),
    )
      .join("");
  const generated = await Promise.all(
    hudSprites(sheet).map(async (hudSprite) => [hudSprite.file, await sha1(encodeHudSprite(sheet, hudSprite))]),
  );
  assertEquals(Object.fromEntries(generated), SHIPPED_SHA1);
});

// The frame numbers that the AngelScript HUD sends (docs/hud-sprites.md) select the cells that CS would draw.
Deno.test("money frames rebuild the %5i field for 0..25599", () => {
  for (let money = 0; money <= 25599; money++) {
    const [high, low] = [Math.floor(money / 100), money >= 10 ? money % 100 : 100 + money];
    assertEquals(moneyHighCells(high) + twoCells(low), String(money).padStart(5), `money ${money}`);
  }
});

Deno.test("reserve frames rebuild the three-cell number for 0..255", () => {
  for (let reserve = 0; reserve <= 255; reserve++) {
    const high = reserve >= 100 ? Math.floor(reserve / 10) : reserve >= 10 ? 100 + Math.floor(reserve / 10) : 110;
    assertEquals(twoCells(high) + String(reserve % 10), threeCells(reserve), `reserve ${reserve}`);
  }
});
