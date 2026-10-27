// Compares HUD glyphs of two screenshots: glyph boxes (from hudboxes.ts) and the colour that the HUD adds to them.
// The HUD draws additively, so a glyph pixel is the background plus the HUD colour scaled by the texel. The added
// colour of a glyph is estimated as the brightest pixel minus the median of a ring of background pixels around it.
import type { HudBox } from "./hudboxes.ts";
import type { SpriteFrame } from "../../tools/spr.ts";

export type Rgb = [number, number, number];
export type Region = { x: number; y: number; width: number; height: number };

const CHANNELS = 3;
const RING_GAP_PX = 2; // the ring lies this far outside the glyph box, past the soft glyph edge
const RING_WIDTH_PX = 2;

export class Pixels {
  constructor(readonly region: Region, readonly data: Uint8Array) {}

  static async read(image: string, region: Region): Promise<Pixels> {
    const { x, y, width, height } = region;
    const args = [image, "-crop", `${width}x${height}+${x}+${y}`, "+repage", "-depth", "8", "rgb:-"];
    const output = await new Deno.Command("magick", { args, stdout: "piped", stderr: "piped" }).output();
    if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
    return new Pixels(region, output.stdout);
  }

  // The pixel at screen coordinates, or undefined outside the region.
  at(x: number, y: number): Rgb | undefined {
    const column = x - this.region.x;
    const row = y - this.region.y;
    if (column < 0 || row < 0 || column >= this.region.width || row >= this.region.height) return undefined;
    const offset = (row * this.region.width + column) * CHANNELS;
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2]];
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// The colour that the HUD adds to a glyph: per channel, the brightest pixel in the box minus the background median.
export function addedColour(pixels: Pixels, box: HudBox): Rgb {
  const inside = (x: number, y: number) =>
    x >= box.x - RING_GAP_PX && x < box.x + box.width + RING_GAP_PX && y >= box.y - RING_GAP_PX &&
    y < box.y + box.height + RING_GAP_PX;
  const outer = RING_GAP_PX + RING_WIDTH_PX;
  const ring: Rgb[] = [];
  for (let y = box.y - outer; y < box.y + box.height + outer; y++) {
    for (let x = box.x - outer; x < box.x + box.width + outer; x++) {
      const pixel = inside(x, y) ? undefined : pixels.at(x, y);
      if (pixel) ring.push(pixel);
    }
  }
  const glyph: Rgb[] = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const pixel = pixels.at(x, y);
      if (pixel) glyph.push(pixel);
    }
  }
  return [0, 1, 2].map((channel) =>
    Math.max(0, Math.max(...glyph.map((pixel) => pixel[channel])) - median(ring.map((pixel) => pixel[channel])))
  ) as Rgb;
}

export type BoxMatch = { cs: HudBox; ours: HudBox | undefined; offset: number };

// Pairs each reference box with the nearest box of ours; offset is the largest distance between matching edges.
export function matchBoxes(reference: HudBox[], ours: HudBox[]): BoxMatch[] {
  const distance = (a: HudBox, b: HudBox) =>
    Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.x + a.width - b.x - b.width),
      Math.abs(a.y + a.height - b.y - b.height),
    );
  return reference.map((cs) => {
    const nearest = ours.reduce<HudBox | undefined>(
      (best, box) => !best || distance(cs, box) < distance(cs, best) ? box : best,
      undefined,
    );
    return { cs, ours: nearest, offset: nearest ? distance(cs, nearest) : Infinity };
  });
}

// The largest channel error between a screenshot and a sheet rect drawn 1:1 at `origin` in `colour` on black, as Sven
// draws a HUD sprite (sven-client-hud.md 1.6). The CS sheets have a grey-ramp palette, so an index is its brightness.
export function rectError(
  pixels: Pixels,
  origin: { x: number; y: number },
  frame: SpriteFrame,
  rect: Region,
  colour: Rgb,
) {
  let error = 0;
  for (let row = 0; row < rect.height; row++) {
    for (let column = 0; column < rect.width; column++) {
      const texel = frame.pixels[(rect.y + row) * frame.width + rect.x + column];
      const pixel = pixels.at(origin.x + column, origin.y + row) ?? [0, 0, 0];
      for (const channel of [0, 1, 2]) {
        error = Math.max(error, Math.abs(pixel[channel] - Math.round(texel * colour[channel] / 255)));
      }
    }
  }
  return error;
}

Deno.test("matchBoxes pairs each reference box with the nearest box", () => {
  const box = (x: number, y: number, width = 16, height = 24) => ({ x, y, width, height, area: width * height });
  const matches = matchBoxes([box(10, 10), box(40, 10)], [box(41, 10), box(10, 11, 17), box(200, 10)]);
  if (matches[0].ours?.x !== 10 || matches[0].offset !== 1) throw new Error(JSON.stringify(matches[0]));
  if (matches[1].ours?.x !== 41 || matches[1].offset !== 1) throw new Error(JSON.stringify(matches[1]));
  // One more pixel on both sides moves each edge by 1, although the width grows by 2.
  if (matchBoxes([box(9, 10, 18)], [box(10, 10)])[0].offset !== 1) throw new Error("edges, not sizes");
  if (matchBoxes([box(0, 0)], [])[0].offset !== Infinity) throw new Error("no box must not match");
});

Deno.test("addedColour removes the background around a glyph", () => {
  const region = { x: 100, y: 200, width: 12, height: 12 };
  const data = new Uint8Array(region.width * region.height * CHANNELS);
  // Background (30, 20, 10) everywhere, a 2x2 glyph at (105, 205) that adds (100, 62, 0) at its brightest pixel.
  for (let offset = 0; offset < data.length; offset += CHANNELS) data.set([30, 20, 10], offset);
  const set = (x: number, y: number, rgb: Rgb) => data.set(rgb, ((y - 200) * 12 + x - 100) * CHANNELS);
  set(105, 205, [130, 82, 10]);
  set(106, 205, [80, 51, 10]);
  set(105, 206, [60, 38, 10]);
  const added = addedColour(new Pixels(region, data), { x: 105, y: 205, width: 2, height: 2, area: 4 });
  if (added.join() !== "100,62,0") throw new Error(`added ${added}`);
});

Deno.test("rectError is 0 where a rect is drawn and large one pixel off", () => {
  const frame = { origin: [0, 0] as [number, number], width: 4, height: 4, interval: 0, pixels: new Uint8Array(16) };
  frame.pixels.set([255, 128], 5); // texels (1, 1) and (2, 1)
  const region = { x: 10, y: 20, width: 6, height: 6 };
  const data = new Uint8Array(region.width * region.height * CHANNELS);
  // The rect (1, 1, 2, 2) in green (0, 160, 0) with its top-left at (12, 21).
  data.set([0, 160, 0, 0, 80, 0], ((21 - 20) * 6 + 12 - 10) * CHANNELS);
  const pixels = new Pixels(region, data);
  const rect = { x: 1, y: 1, width: 2, height: 2 };
  if (rectError(pixels, { x: 12, y: 21 }, frame, rect, [0, 160, 0]) !== 0) throw new Error("exact draw must match");
  if (rectError(pixels, { x: 13, y: 21 }, frame, rect, [0, 160, 0]) < 80) throw new Error("a shift must not match");
});
