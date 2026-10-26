// Measures the four lines of a CS 1.6 dynamic crosshair in a screenshot (cs16-hud-spec.md 3.12.6).
// Usage: deno run -A tests/e2e/crosshair-lines.ts <screenshot.png>...
// For each line: gap = pixels from the centre pixel (W/2, H/2) to the inner end, length = lit pixels in the run.
// CS and the plugin draw the lines additively in a green colour, so a lit pixel has much more green than red or blue.
import { assertEquals } from "@std/assert";
import { type Frame, load, pixel } from "../fixture/frame.ts";

// The line colour (50,250,50) adds at least 200 * 120 / 255 = 94 more green than red or blue at the lowest CS alpha.
const LIT_GREEN_MARGIN = 40;
const SEARCH_RADIUS = 200; // the widest CS crosshair at 2560 px reaches 32 + 88 px from the centre
// Green clips at 255 over most backgrounds, so the alpha comes from the red and blue that the line adds: 50 each at 255.
const LINE_RED_BLUE = 50;
const FULL_ALPHA = 255;
const BACKGROUND_OFFSET = 2; // rows or columns away from a line, where only the background shows

export type Line = { gap: number; length: number; thickness: number };
export type Crosshair = {
  centre: [number, number];
  west: Line | null;
  east: Line | null;
  north: Line | null;
  south: Line | null;
  alpha: number | null; // estimated from the green the lines add to the background
};

const isLit = (frame: Frame, x: number, y: number): boolean => {
  const [red, green, blue] = pixel(frame, x, y);
  return green - Math.max(red, blue) >= LIT_GREEN_MARGIN;
};

const median = (values: number[]): number | null =>
  values.length === 0 ? null : values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

// One line: walk outward from the centre along (stepX, stepY); the first lit run is the line.
const measureLine = (frame: Frame, cx: number, cy: number, stepX: number, stepY: number) => {
  const offsets = Array.from({ length: SEARCH_RADIUS }, (_, index) => index + 1);
  const at = (offset: number): [number, number] => [cx + stepX * offset, cy + stepY * offset];
  const inner = offsets.find((offset) => isLit(frame, ...at(offset)));
  if (inner === undefined) return null;
  const outer = offsets.find((offset) => offset > inner && !isLit(frame, ...at(offset))) ?? SEARCH_RADIUS + 1;
  const run = offsets.filter((offset) => offset >= inner && offset < outer).map(at);
  // Lit pixels beside the run (the rows above and below a horizontal line), to prove it is 1 px thick.
  const [sideX, sideY] = [stepY, stepX];
  const beside = run.filter(([x, y]) => isLit(frame, x + sideX, y + sideY) || isLit(frame, x - sideX, y - sideY));
  const alphas = run.map(([x, y]) => {
    const [red, , blue] = pixel(frame, x, y);
    const [backRed, , backBlue] = pixel(frame, x + sideX * BACKGROUND_OFFSET, y + sideY * BACKGROUND_OFFSET);
    return Math.round((red - backRed + blue - backBlue) * FULL_ALPHA / (2 * LINE_RED_BLUE));
  });
  return { line: { gap: inner, length: outer - inner, thickness: beside.length === 0 ? 1 : 2 }, alphas };
};

export const measureCrosshair = (frame: Frame): Crosshair => {
  const [cx, cy] = [Math.floor(frame.width / 2), Math.floor(frame.height / 2)];
  const [west, east, north, south] = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([stepX, stepY]) =>
    measureLine(frame, cx, cy, stepX, stepY)
  );
  return {
    centre: [cx, cy],
    west: west?.line ?? null,
    east: east?.line ?? null,
    north: north?.line ?? null,
    south: south?.line ?? null,
    alpha: median([west, east, north, south].flatMap((line) => line?.alphas ?? [])),
  };
};

if (import.meta.main) {
  if (Deno.args.length === 0) {
    console.error("usage: crosshair-lines.ts <screenshot.png>...");
    Deno.exit(2);
  }
  for (const path of Deno.args) console.log(JSON.stringify({ path, ...measureCrosshair(await load(path)) }));
}

const reference = (name: string) => new URL(`../../.e2e/reference/${name}`, import.meta.url).pathname;
const exists = (path: string) => Deno.stat(path).then(() => true, () => false);

// The CS 1.6 references hold a USP at rest: gap 8 and length 5 at 640 px, scaled by W / 640 (cs16-hud-spec.md A.2).
for (const [name, gap, length] of [["cs16-ref-hud.png", 20, 12], ["cs16-1440-hud.png", 32, 20]] as const) {
  Deno.test(`measures the CS 1.6 USP crosshair in ${name}`, async () => {
    if (!await exists(reference(name))) return; // local capture (gitignored): skip where it does not exist
    const crosshair = measureCrosshair(await load(reference(name)));
    const line = { gap, length, thickness: 1 };
    assertEquals([crosshair.west, crosshair.east, crosshair.north, crosshair.south], [line, line, line, line]);
  });
}
