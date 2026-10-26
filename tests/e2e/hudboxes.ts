// Measures HUD glyphs: bounding boxes of HUD-coloured pixels inside a screen region, via ImageMagick.
// Usage: deno run -A tests/e2e/hudboxes.ts <screenshot.png> <x> <y> <w> <h> [colour] [fuzz%]
// Prints JSON boxes in screen coordinates, sorted left to right then top to bottom, so two screenshots
// (for example CS 1.6 and Counter-Life) can be compared element by element.

// CS draws its HUD in (255,160,0) scaled by alpha 100-228; this mid tone matches the whole fade range.
const DEFAULT_COLOUR = "rgb(150,95,10)";
const DEFAULT_FUZZ_PERCENT = 18;
const MIN_AREA_PX = 6;

export interface HudBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

export async function measure(
  image: string,
  region: { x: number; y: number; width: number; height: number },
  colour = DEFAULT_COLOUR,
  fuzzPercent = DEFAULT_FUZZ_PERCENT,
): Promise<HudBox[]> {
  const args = [
    image,
    "-crop",
    `${region.width}x${region.height}+${region.x}+${region.y}`,
    "+repage",
    "-fuzz",
    `${fuzzPercent}%`,
    "-fill",
    "white",
    "-opaque",
    colour,
    "-fill",
    "black",
    "+opaque",
    "white",
    "-define",
    "connected-components:verbose=true",
    "-define",
    `connected-components:area-threshold=${MIN_AREA_PX}`,
    "-connected-components",
    "8",
    "null:",
  ];
  const output = await new Deno.Command("magick", { args, stdout: "piped", stderr: "piped" }).output();
  if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
  // Lines look like: "  2: 16x24+1527+6 1534.5,17.2 338 srgb(255,255,255)"; keep the white (HUD) components.
  const line = /^\s*\d+: (\d+)x(\d+)\+(\d+)\+(\d+) \S+ (\d+) (?:srgb\(255,255,255\)|gray\(255\)|white)/;
  return new TextDecoder().decode(output.stdout).split("\n")
    .map((text) => text.match(line))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(([, width, height, x, y, area]) => ({
      x: Number(x) + region.x,
      y: Number(y) + region.y,
      width: Number(width),
      height: Number(height),
      area: Number(area),
    }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

if (import.meta.main) {
  const [image, x, y, width, height, colour, fuzz] = Deno.args;
  if (!image || !height) {
    console.error("usage: hudboxes.ts <screenshot.png> <x> <y> <w> <h> [colour] [fuzz%]");
    Deno.exit(2);
  }
  const boxes = await measure(
    image,
    { x: Number(x), y: Number(y), width: Number(width), height: Number(height) },
    colour,
    fuzz ? Number(fuzz) : undefined,
  );
  console.log(JSON.stringify(boxes, null, 2));
}

Deno.test("measures the CS 1.6 reference health row", async () => {
  const reference = new URL("../../.e2e/reference/cs16-ref-hud.png", import.meta.url).pathname;
  const exists = await Deno.stat(reference).then(() => true, () => false);
  if (!exists) return; // The reference is a local capture (gitignored); skip where it does not exist.
  const boxes = await measure(reference, { x: 0, y: 820, width: 460, height: 80 });
  const digitTops = boxes.filter((box) => box.height === 24).map((box) => box.y);
  if (!digitTops.every((top) => top === 864)) throw new Error(`unexpected digit rows ${digitTops}`);
  const cross = boxes.find((box) => box.width === 21 && box.height === 21);
  if (!cross || cross.x !== 14 || cross.y !== 865) throw new Error(`cross not at (14,865): ${JSON.stringify(cross)}`);
});
