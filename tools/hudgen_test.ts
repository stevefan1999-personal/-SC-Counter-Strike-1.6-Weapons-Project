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

// An independent statement of the contract: each frame is the clamped sum of these layers as Valve's engine draws
// them (half-texel inset, bilinear: pixel k of a w-wide rect shows texel k * (w - 1) / w), black elsewhere.
type Layer = { name: string; x: number; y: number; crop?: Partial<Rect> } | { fill: Rect };
const digitLayers = (text: string, x: number): Layer[] =>
  [...text].flatMap((char, cell) => char === BLANK ? [] : [{ name: `number_${char}`, x: x + cell * 20, y: 0 }]);
const groupText = (frame: number) =>
  frame < 100 ? `${Math.floor(frame / 10)}${frame % 10}` : frame < 110 ? ` ${frame - 100}` : "  ";
const armorLayers = (prefix: string) => (value: number): Layer[] => {
  const offset = Math.trunc(24 * (100 - Math.min(value, 100)) / 100);
  return [
    { name: `${prefix}_empty`, x: 0, y: 0 },
    {
      name: `${prefix}_full`,
      x: 0,
      y: offset,
      crop: { y: CONTRACT_RECTS[`${prefix}_full`][1] + offset, height: 24 - offset },
    },
    ...digitLayers(String(value).padStart(3), 24),
  ];
};
const moneyLayers = (sign: string, signWidth: number) => (hundreds: number): Layer[] => [
  { name: sign, x: 0, y: 0 },
  ...digitLayers(String(hundreds * 100).padStart(5).slice(0, 3), signWidth),
];
// CS keeps the battery as a float fraction: off = (int)((1 - bat) * 32).
const flashlightLayers = (frame: number): Layer[] => {
  const battery = frame % 101;
  const offset = Math.trunc((1 - Math.fround(battery / 100)) * 32);
  return [
    { name: "flash_empty", x: 0, y: 0 },
    { name: "flash_full", x: offset, y: 0, crop: { x: 160 + offset, width: 32 - offset } },
    ...(frame > 100 ? [{ name: "flash_beam", x: 32, y: 0 }] : []),
  ];
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
  "armor_helmet.spr": { frames: 256, size: [128, 32], content: [84, 25], layers: armorLayers("suithelmet") },
  "clip.spr": {
    frames: 256,
    size: [128, 32],
    content: [72, 25],
    layers: (value) => [...digitLayers(String(value).padStart(3), 0), { fill: { x: 70, y: 0, width: 2, height: 25 } }],
  },
  "reserve_hi.spr": {
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
  "money_lo.spr": {
    frames: 111,
    size: [64, 32],
    content: [40, 25],
    layers: (frame) => digitLayers(groupText(frame), 0),
  },
  "money_delta_plus_hi.spr": { frames: 256, size: [128, 32], content: [77, 25], layers: moneyLayers("plus", 17) },
  "money_delta_minus_hi.spr": { frames: 256, size: [128, 32], content: [73, 25], layers: moneyLayers("minus", 13) },
  "flashlight.spr": { frames: 202, size: [64, 32], content: [48, 32], layers: flashlightLayers },
  "fill.spr": {
    frames: 1,
    size: [64, 64],
    content: [64, 64],
    layers: () => [{ fill: { x: 0, y: 0, width: 64, height: 64 } }],
  },
};

const expectedPixel = (layers: Layer[], x: number, y: number) =>
  Math.min(
    255,
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
    }, 0),
  );

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
