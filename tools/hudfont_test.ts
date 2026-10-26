// Checks the HudMessage width model against line widths measured in the Sven Co-op client, and the committed table.
// Run: deno test -R -E tools/   (HUD_FONT: the face that just hud-font picks; default the Bitstream Vera Sans Bold file)
import { assertEquals, assertThrows } from "@std/assert";
import { lineWidth, NoAppleRomanCmap, parseFont, renderAngelScript } from "./hudfont.ts";

const fontPath = Deno.env.get("HUD_FONT") ?? "/usr/share/fonts/TTF/VeraBd.ttf";
const font = parseFont(await Deno.readFile(fontPath));
const TABLE_FILE = new URL("../scripts/cs16/hud/textfont.as", import.meta.url);

// The probe sent each line as HudMessage text to a Sven 5.26 client on Linux and measured the hud_debug 2 outline,
// which is the sum of the client's glyph widths: printable ASCII except '"' in groups of 12, then bytes 128-254 in
// groups of 16 (byte 255 ends a network string), then four names (docs/hud.md, "Kill feed").
const ASCII = Array.from({ length: 95 }, (_, index) => 32 + index).filter((code) => code !== 0x22);
const HIGH = Array.from({ length: 127 }, (_, index) => 128 + index);
const groups = (codes: number[], size: number) =>
  Array.from({ length: Math.ceil(codes.length / size) }, (_, index) => codes.slice(index * size, (index + 1) * size));
const encode = (text: string) => [...new TextEncoder().encode(text)];
const NAMES = ["Player", "Scientist", "WWWWWiiiii", "Headcrab Zombie"].map(encode);
const PROBE_LINES = [...groups(ASCII, 12), ...groups(HIGH, 16), ...NAMES];
const MEASURED: Record<number, number[]> = {
  900: [129, 138, 156, 154, 158, 136, 129, 124, 205, 173, 211, 211, 225, 168, 183, 158, 64, 90, 130, 178],
  1440: [215, 223, 260, 259, 263, 224, 212, 203, 342, 290, 351, 351, 372, 281, 305, 261, 107, 147, 215, 295],
};

Deno.test("the width model gives the line widths measured in the client at 1600x900 and 2560x1440", () => {
  Object.entries(MEASURED).forEach(([height, widths]) =>
    assertEquals(PROBE_LINES.map((line) => lineWidth(font, new Uint8Array(line), Number(height))), widths, height)
  );
});

Deno.test("the committed advance table is the one that the font gives", async () => {
  assertEquals(await Deno.readTextFile(TABLE_FILE), renderAngelScript(font, fontPath.split("/").at(-1)!));
});

Deno.test("a face without an Apple Roman cmap is refused, as the client refuses it", () => {
  // A table directory with one cmap table that holds only a Windows Unicode subtable (platform 3, encoding 1).
  const CMAP_OFFSET = 28;
  const bytes = new Uint8Array(CMAP_OFFSET + 12);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 1);
  bytes.set(new TextEncoder().encode("cmap"), 12);
  view.setUint32(20, CMAP_OFFSET);
  view.setUint16(CMAP_OFFSET + 2, 1);
  view.setUint16(CMAP_OFFSET + 4, 3);
  view.setUint16(CMAP_OFFSET + 6, 1);
  assertThrows(() => parseFont(bytes), NoAppleRomanCmap);
});
