import { assert, assertEquals } from "@std/assert";
import { sheetArgs, sheets } from "./comparesheet.ts";
import { load, pixel } from "../fixture/frame.ts";

const magick = async (...args: string[]) => {
  const { success, stderr } = await new Deno.Command("magick", { args, stderr: "piped" }).output();
  if (!success) throw new Error(new TextDecoder().decode(stderr));
};

Deno.test("every comparison region lies inside the screen it crops", () => {
  for (const [width, height] of [[1600, 900], [2560, 1440]]) {
    for (const { name, region } of sheets(width, height, "hud", "elements")) {
      const inside = region.x >= 0 && region.y >= 0 && region.x + region.width <= width &&
        region.y + region.height <= height;
      assert(inside, `${name} at ${width}x${height}: ${JSON.stringify(region)}`);
    }
  }
});

Deno.test("a sheet puts the 2x Counter-Life crop left of the 2x CS crop under a caption row", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const [ours, cs, out] = ["ours.png", "cs.png", "sheet.png"].map((name) => `${dir}/${name}`);
    await magick("-size", "40x30", "xc:rgb(200,0,0)", ours);
    await magick("-size", "40x30", "xc:rgb(0,0,200)", cs);
    await magick(...sheetArgs(ours, cs, { x: 10, y: 5, width: 20, height: 10 }, out));
    const sheet = await load(out);
    const [captionRows, side, gap] = [28, 40, 8];
    assertEquals([sheet.width, sheet.height], [2 * side + gap, captionRows + 20]);
    assertEquals(pixel(sheet, side / 2, captionRows + 10), [200, 0, 0]);
    assertEquals(pixel(sheet, side + gap + side / 2, captionRows + 10), [0, 0, 200]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
