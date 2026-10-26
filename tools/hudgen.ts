// Builds the server-side CS 1.6 HUD sprites from the local Counter-Strike install, so no Valve pixels go into git.
// Usage: deno run -R -W tools/hudgen.ts <cstrike dir> <out dir>      (just install writes <addon>/sprites/cs16/hud)
// Self-check: deno test -R -E tools/
// The frame formulas, canvas layouts and placement are the contract in docs/hud-sprites.md.
import { encodeSpr, parseSpr, type Sprite, type SpriteFrame } from "./spr.ts";

export type Rect = { x: number; y: number; width: number; height: number };
type Size = Pick<Rect, "width" | "height">;

export const SHEET_FILE = "sprites/640hud7.spr";
export const HUD_TXT_FILE = "sprites/hud.txt";
const SHEET_NAME = "640hud7";
const HUD_RESOLUTION = "640";
const HUD_TXT_FIELDS = 7; // name, resolution, sheet, x, y, width, height
const RGB_SIZE = 3;
const WHITE = 255; // brightest index of the grey-ramp palette
export const BLANK = " ";
const FRAME_LIMIT = 256; // HudCustomSprite sends the frame number as a byte
const PERCENT = 100;
const DIGITS = 10;
const NUMBER_CELLS = 3; // DrawHudNumber with DHN_3DIGITS
const MONEY_FIELD_CELLS = 5; // "%5i"
const MONEY_HIGH_CELLS = 3;
const TWO_DIGIT_FRAMES = 100; // two-cell group frames 0..99 draw both digits
const TWO_CELL_BLANK = TWO_DIGIT_FRAMES + DIGITS; // frames 100..109 blank the tens cell, 110 blanks both
const AMMO_BAR_WIDTH_DIVISOR = 10; // CS draws the clip/reserve separator dw/10 wide
const FILL_SIZE = 64;

// hud.txt rows are: name, resolution, sheet, x, y, width, height. The first line is the row count.
export function parseHudTxt(text: string): Map<string, Rect & { sheet: string }> {
  return new Map(
    text.split("\n").map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length === HUD_TXT_FIELDS && fields[1] === HUD_RESOLUTION)
      .map(([name, , sheet, ...numbers]) => {
        const [x, y, width, height] = numbers.map(Number);
        return [name, { sheet, x, y, width, height }];
      }),
  );
}

// The 640hud7.spr sheet and the hud.txt rects on it.
export class Sheet {
  readonly frame: SpriteFrame;

  constructor(readonly sprite: Sprite, private readonly rects: ReturnType<typeof parseHudTxt>) {
    const { header, palette, frames: [frame] } = sprite;
    // Composites add palette indices, which is the additive blend only while index = brightness on every channel.
    if (header.textureFormat !== "additive" || !palette.every((channel, at) => channel === Math.floor(at / RGB_SIZE))) {
      throw new Error(`${SHEET_FILE} is not an additive sprite with the grey-ramp palette`);
    }
    this.frame = frame;
  }

  static async load(cstrikeDir: string): Promise<Sheet> {
    const [bytes, hudTxt] = await Promise.all([
      Deno.readFile(`${cstrikeDir}/${SHEET_FILE}`),
      Deno.readTextFile(`${cstrikeDir}/${HUD_TXT_FILE}`),
    ]);
    return new Sheet(parseSpr(bytes), parseHudTxt(hudTxt));
  }

  rect(name: string): Rect {
    const found = this.rects.get(name);
    if (found?.sheet !== SHEET_NAME) throw new Error(`hud.txt has no ${HUD_RESOLUTION} ${name} on ${SHEET_NAME}`);
    const { sheet: _sheet, ...rect } = found;
    if (rect.x + rect.width > this.frame.width || rect.y + rect.height > this.frame.height) {
      throw new RangeError(`hud.txt ${name} lies outside ${SHEET_FILE}`);
    }
    return rect;
  }
}

// Sven resamples a texture to powers of two unless the player sets gl_npot 1 (default 0, Sven hw.so 0x128210), which
// blurs 1:1 HUD pixels. So every frame is a power-of-two canvas with the element at its top-left and black (adds
// nothing) around it.
const powerOfTwo = (size: number) => 2 ** Math.ceil(Math.log2(size));

export class Canvas {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8Array(width * height);
  }

  // Draws a rect of the sheet the way CS 1.6 shows it. Valve's engine insets the texture coordinates of a sprite rect
  // by half a texel (AdjustSubRect, Half-Life hw.so 0x14a820) and filters bilinearly, so pixel k of a w-wide rect shows
  // texel k * (w - 1) / w. Sven draws a rect 1:1 (Sven hw.so 0x127AA0), so the frames carry CS's resampled pixels.
  // Every CS HUD layer is additive (SPR_DrawAdditive, FillRGBA); with index = brightness, adding indices is that blend.
  // CS multiplies each draw by the HUD colour before the framebuffer adds them, so a sum above white cannot be one
  // frame: Sven would clip it before the colour multiply. Parts that overlap like that must be separate sprites.
  add(source: SpriteFrame, rect: Rect, x: number, y: number): this {
    const texel = (column: number, row: number) => source.pixels[(rect.y + row) * source.width + rect.x + column];
    const sample = (step: number, size: number) => {
      const position = step * (size - 1) / size;
      const near = Math.floor(position);
      return { near, far: Math.min(near + 1, size - 1), weight: position - near };
    };
    for (let row = 0; row < rect.height; row++) {
      const vertical = sample(row, rect.height);
      for (let column = 0; column < rect.width; column++) {
        const { near, far, weight } = sample(column, rect.width);
        const blend = (sourceRow: number) => texel(near, sourceRow) * (1 - weight) + texel(far, sourceRow) * weight;
        const value = blend(vertical.near) * (1 - vertical.weight) + blend(vertical.far) * vertical.weight;
        const at = (y + row) * this.width + x + column;
        const sum = this.pixels[at] + Math.round(value);
        if (sum > WHITE) throw new RangeError(`parts overlap above white at ${x + column}, ${y + row}`);
        this.pixels[at] = sum;
      }
    }
    return this;
  }

  fill({ x, y, width, height }: Rect): this {
    for (let row = y; row < y + height; row++) {
      this.pixels.fill(WHITE, row * this.width + x, row * this.width + x + width);
    }
    return this;
  }
}

// DrawHudNumber with flags 5 (DHN_DRAWZERO | DHN_3DIGITS): three cells, leading blanks, "0" drawn for zero.
export const threeCells = (value: number) => String(value).padStart(NUMBER_CELLS, BLANK);

// Two-cell group frame f: 0..99 draws both digits of f (tens forced), 100..109 a blank then f - 100, 110 nothing.
export const twoCells = (frame: number) =>
  frame < TWO_DIGIT_FRAMES
    ? String(frame).padStart(2, "0")
    : frame < TWO_CELL_BLANK
    ? BLANK + (frame - TWO_DIGIT_FRAMES)
    : BLANK.repeat(2);

// The first three cells of the "%5i" money field are the same for every amount with the same hundreds count.
export const moneyHighCells = (hundreds: number) =>
  String(hundreds * PERCENT).padStart(MONEY_FIELD_CELLS, BLANK).slice(0, MONEY_HIGH_CELLS);

export type HudSprite = { file: string; frames: number; content: Size; draw: (canvas: Canvas, frame: number) => void };

// Every file of sprites/cs16/hud. Positions inside a frame are the CS 1.6 offsets between the parts of one element.
export function hudSprites(sheet: Sheet): HudSprite[] {
  const cell = sheet.rect("number_0");
  const digits = (canvas: Canvas, text: string, x: number) =>
    [...text].forEach((char, index) =>
      char !== BLANK && canvas.add(sheet.frame, sheet.rect(`number_${char}`), x + index * cell.width, 0)
    );
  // Draws a hud.txt glyph with its left edge at x; a crop keeps the remaining part where it was in the glyph.
  const glyph = (canvas: Canvas, name: string, x = 0, crop: Partial<Rect> = {}) => {
    const whole = sheet.rect(name);
    const part = { ...whole, ...crop };
    canvas.add(sheet.frame, part, x + part.x - whole.x, part.y - whole.y);
  };
  const height = (...rects: Rect[]) => Math.max(...rects.map((rect) => rect.height));

  // CS: cross box at crossW/2, digits from crossW + dw/2 (health.cpp): the digits start crossW/2 + dw/2 after the cross.
  const cross = sheet.rect("cross");
  const healthDigitsX = cross.width / 2 + cell.width / 2;

  // CS: the empty icon, then the digits right of it (battery.cpp).
  const armor = (file: string, prefix: string): HudSprite => {
    const empty = sheet.rect(`${prefix}_empty`);
    return {
      file,
      frames: FRAME_LIMIT,
      content: { width: empty.width + NUMBER_CELLS * cell.width, height: height(empty, cell) },
      draw: (canvas, value) => {
        glyph(canvas, `${prefix}_empty`);
        digits(canvas, threeCells(value), empty.width);
      },
    };
  };
  // CS: the full icon is drawn over the empty one from the bottom up, (int)(24 * (100 - armour) / 100) rows stay
  // empty. It overlaps the empty icon above white, so it is its own sprite in the same box (Canvas.add).
  const armorFull = (file: string, prefix: string): HudSprite => {
    const full = sheet.rect(`${prefix}_full`);
    return {
      file,
      frames: PERCENT + 1,
      content: { width: full.width, height: height(full, cell) },
      draw: (canvas, value) => {
        const offset = Math.trunc(full.height * (PERCENT - value) / PERCENT);
        glyph(canvas, `${prefix}_full`, 0, { y: full.y + offset, height: full.height - offset });
      },
    };
  };

  // CS: clip digits, then a dw/10 x fh bar dw/2 after them (ammo.cpp).
  const bar = {
    x: NUMBER_CELLS * cell.width + cell.width / 2,
    y: 0,
    width: cell.width / AMMO_BAR_WIDTH_DIVISOR,
    height: cell.height,
  };

  // CS money: the sign sits right before the "%5i" field (money.cpp); "$", "+" and "-" have their own widths.
  const moneyHigh = (file: string, sign: string): HudSprite => {
    const signRect = sheet.rect(sign);
    return {
      file,
      frames: FRAME_LIMIT,
      content: { width: signRect.width + MONEY_HIGH_CELLS * cell.width, height: height(signRect, cell) },
      draw: (canvas, hundreds) => {
        glyph(canvas, sign);
        digits(canvas, moneyHighCells(hundreds), signRect.width);
      },
    };
  };
  // CS flashlight: casing, the beam right of it while on, the energy bar cut (int)((1 - bat) * 32) px from the left.
  // The energy overlaps the casing above white, so it is its own sprite in the same box (Canvas.add).
  const [casing, energy, beam] = ["flash_empty", "flash_full", "flash_beam"].map((name) => sheet.rect(name));
  const flashlightBox = { width: energy.width + beam.width, height: height(casing, energy, beam) };

  return [
    {
      file: "health.spr",
      frames: FRAME_LIMIT,
      content: { width: healthDigitsX + NUMBER_CELLS * cell.width, height: height(cross, cell) },
      draw: (canvas, value) => {
        glyph(canvas, "cross");
        digits(canvas, threeCells(value), healthDigitsX);
      },
    },
    armor("armor.spr", "suit"),
    armorFull("armor_full.spr", "suit"),
    armor("armor_helmet.spr", "suithelmet"),
    armorFull("armor_helmet_full.spr", "suithelmet"),
    {
      file: "clip.spr",
      frames: FRAME_LIMIT,
      content: { width: bar.x + bar.width, height: cell.height },
      draw: (canvas, value) => {
        digits(canvas, threeCells(value), 0);
        canvas.fill(bar);
      },
    },
    // The first two reserve cells and the last two money and delta cells are the same frames, so one file serves all.
    {
      file: "two_cells.spr",
      frames: TWO_CELL_BLANK + 1,
      content: { width: 2 * cell.width, height: cell.height },
      draw: (canvas, frame) => digits(canvas, twoCells(frame), 0),
    },
    {
      file: "reserve_lo.spr",
      frames: DIGITS + 1,
      content: { width: cell.width, height: cell.height },
      draw: (canvas, digit) => digits(canvas, digit < DIGITS ? String(digit) : BLANK, 0),
    },
    moneyHigh("money_hi.spr", "dollar"),
    moneyHigh("money_delta_plus_hi.spr", "plus"),
    moneyHigh("money_delta_minus_hi.spr", "minus"),
    {
      file: "flashlight.spr",
      frames: 2,
      content: flashlightBox,
      draw: (canvas, on) => {
        glyph(canvas, "flash_empty");
        if (on) glyph(canvas, "flash_beam", energy.width);
      },
    },
    {
      file: "flashlight_energy.spr",
      frames: PERCENT + 1,
      content: flashlightBox,
      draw: (canvas, battery) => {
        const offset = Math.trunc(energy.width * (PERCENT - battery) / PERCENT);
        glyph(canvas, "flash_full", 0, { x: energy.x + offset, width: energy.width - offset });
      },
    },
    {
      file: "fill.spr",
      frames: 1,
      content: { width: FILL_SIZE, height: FILL_SIZE },
      draw: (canvas) => canvas.fill({ x: 0, y: 0, width: FILL_SIZE, height: FILL_SIZE }),
    },
  ];
}

export function renderFrames({ frames, content, draw }: HudSprite): SpriteFrame[] {
  return Array.from({ length: frames }, (_, frame) => {
    const canvas = new Canvas(powerOfTwo(content.width), powerOfTwo(content.height));
    draw(canvas, frame);
    // Only world sprites read the origin; HUD draws put the frame's top-left at the element (Sven hw.so 0x127B70).
    return { origin: [0, 0], width: canvas.width, height: canvas.height, interval: 0, pixels: canvas.pixels };
  });
}

export function encodeHudSprite(sheet: Sheet, hudSprite: HudSprite): Uint8Array {
  const frames = renderFrames(hudSprite);
  const [{ width, height }] = frames;
  const { type, textureFormat, syncType } = sheet.sprite.header;
  const boundingRadius = Math.hypot(width / 2, height / 2);
  return encodeSpr({
    header: { type, textureFormat, syncType, boundingRadius, width, height, beamLength: 0 },
    palette: sheet.sprite.palette,
    frames,
  });
}

if (import.meta.main) {
  const [cstrikeDir, outDir] = Deno.args;
  if (!cstrikeDir || !outDir) throw new Error("usage: tools/hudgen.ts <cstrike dir> <out dir>");
  const sheet = await Sheet.load(cstrikeDir);
  await Deno.mkdir(outDir, { recursive: true });
  for (const hudSprite of hudSprites(sheet)) {
    const bytes = encodeHudSprite(sheet, hudSprite);
    await Deno.writeFile(`${outDir}/${hudSprite.file}`, bytes);
    console.log(`${hudSprite.file}: ${hudSprite.frames} frames, ${bytes.length} bytes`);
  }
}
