// GoldSrc sprite (SPR v2) decoder.
// Usage: deno run -R tools/spr.ts <file.spr>                                  (prints JSON)
//        deno run -R --allow-run=magick tools/spr.ts <file.spr> <frame> <out.png> [x y w h]
// Self-check: deno test tools/spr.ts
// Layout: ReGameDLL_CS/regamedll/extra/cssdk/engine/spritegn.h (dsprite_t, dspriteframe_t);
// type and texFormat enums follow the HLSDK sprgen tool (SPR_NORMAL = 0 ... SPR_ALPHTEST = 3).

const SPRITE_VERSION = 2;
const IDENT_SPRITE = "IDSP";
const HEADER_SIZE = 40;
const INT_SIZE = 4;
const SHORT_SIZE = 2;
const RGB_SIZE = 3;
const RGBA_SIZE = 4;
const OPAQUE = 255;
const TRANSPARENT_INDEX = 255; // alpha-test sprites drop this palette index; index-alpha sprites take their colour from it
const FRAME_HEADER_SIZE = 16;
const FRAME_SINGLE = 0;
const FRAME_GROUP = 1;
const SPRITE_TYPES = ["parallel-upright", "facing-upright", "parallel", "oriented", "parallel-oriented"];
const TEXTURE_FORMATS = ["normal", "additive", "index-alpha", "alpha-test"];

export interface SpriteFrame {
  origin: [number, number];
  width: number;
  height: number;
  interval: number; // 0 for single frames, seconds for frames inside a group
  pixels: Uint8Array;
}

export function parseSpr(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const int = (offset: number) => view.getInt32(offset, true);
  const ident = new TextDecoder("latin1").decode(bytes.subarray(0, INT_SIZE));
  if (ident !== IDENT_SPRITE || int(INT_SIZE) !== SPRITE_VERSION) {
    throw new Error(`not a v${SPRITE_VERSION} sprite (ident "${ident}", version ${int(INT_SIZE)})`);
  }
  const [type, textureFormat] = [int(8), int(12)];
  const paletteColors = view.getInt16(HEADER_SIZE, true);
  const paletteOffset = HEADER_SIZE + SHORT_SIZE;
  const palette = bytes.subarray(paletteOffset, paletteOffset + paletteColors * RGB_SIZE);
  let cursor = paletteOffset + paletteColors * RGB_SIZE;

  const readFrame = (interval: number): SpriteFrame => {
    const [originX, originY, width, height] = [0, 1, 2, 3].map((field) => int(cursor + field * INT_SIZE));
    const start = cursor + FRAME_HEADER_SIZE;
    cursor = start + width * height;
    if (width < 0 || height < 0 || cursor > bytes.length) throw new RangeError(`frame at ${start} overruns the file`);
    return { origin: [originX, originY], width, height, interval, pixels: bytes.subarray(start, cursor) };
  };

  // Single frames sit inline; a group stores its frame count and intervals before its frames.
  const frames = Array.from({ length: int(28) }).flatMap((): SpriteFrame[] => {
    const frameType = int(cursor);
    cursor += INT_SIZE;
    if (frameType === FRAME_SINGLE) return [readFrame(0)];
    if (frameType !== FRAME_GROUP) throw new Error(`unknown frame type ${frameType}`);
    const count = int(cursor);
    const intervals = Array.from(
      { length: count },
      (_, member) => view.getFloat32(cursor + (1 + member) * INT_SIZE, true),
    );
    cursor += (1 + count) * INT_SIZE;
    return intervals.map(readFrame);
  });

  return {
    header: {
      type: SPRITE_TYPES[type] ?? `unknown:${type}`,
      textureFormat: TEXTURE_FORMATS[textureFormat] ?? `unknown:${textureFormat}`,
      boundingRadius: view.getFloat32(16, true),
      width: int(20),
      height: int(24),
      numFrames: int(28),
      beamLength: view.getFloat32(32, true),
      syncType: int(36),
      paletteColors,
      fileSize: bytes.length,
      trailingBytes: bytes.length - cursor,
    },
    palette,
    frames,
  };
}

export type Sprite = ReturnType<typeof parseSpr>;

// Additive texels become straight alpha (alpha = brightest channel), so the PNG over black matches the additive blend.
export function frameRgba(sprite: Sprite, frame: SpriteFrame): Uint8Array {
  const format = sprite.header.textureFormat;
  const color = (index: number) => sprite.palette.subarray(index * RGB_SIZE, index * RGB_SIZE + RGB_SIZE);
  const rgba = new Uint8Array(frame.pixels.length * RGBA_SIZE);
  frame.pixels.forEach((index, pixel) => {
    const [red, green, blue] = format === "index-alpha" ? color(TRANSPARENT_INDEX) : color(index);
    const brightest = Math.max(red, green, blue);
    const alpha = format === "index-alpha"
      ? index
      : format === "alpha-test" && index === TRANSPARENT_INDEX
      ? 0
      : format === "additive"
      ? brightest
      : OPAQUE;
    const straight = (channel: number) =>
      format === "additive" && brightest > 0 ? Math.round(channel * OPAQUE / brightest) : channel;
    rgba.set([straight(red), straight(green), straight(blue), alpha], pixel * RGBA_SIZE);
  });
  return rgba;
}

const toPam = (width: number, height: number, rgba: Uint8Array): Uint8Array => {
  const header = `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${RGBA_SIZE}\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`;
  const encoded = new TextEncoder().encode(header);
  const pam = new Uint8Array(encoded.length + rgba.length);
  pam.set(encoded);
  pam.set(rgba, encoded.length);
  return pam;
};

// Pipes RGBA pixels through ImageMagick; `args` run between input and PNG output (crop, flatten, annotate).
export async function writePng(width: number, height: number, rgba: Uint8Array, outPath: string, args: string[] = []) {
  const magick = new Deno.Command("magick", {
    args: ["pam:-", ...args, `png:${outPath}`],
    stdin: "piped",
    stderr: "piped",
  })
    .spawn();
  const writer = magick.stdin.getWriter();
  await writer.write(toPam(width, height, rgba));
  await writer.close();
  const { success, stderr } = await magick.output();
  if (!success) throw new Error(`magick failed: ${new TextDecoder().decode(stderr)}`);
}

export type Rect = { x: number; y: number; width: number; height: number };

export async function exportPng(sprite: Sprite, frameIndex: number, outPath: string, rect?: Rect) {
  const frame = sprite.frames[frameIndex];
  if (!frame) throw new RangeError(`frame ${frameIndex} not in 0..${sprite.frames.length - 1}`);
  const crop = rect ? ["-crop", `${rect.width}x${rect.height}+${rect.x}+${rect.y}`, "+repage"] : [];
  await writePng(frame.width, frame.height, frameRgba(sprite, frame), outPath, crop);
}

if (import.meta.main) {
  const [path, frame, outPath, ...rect] = Deno.args;
  if (!path || (frame !== undefined && !outPath) || ![0, 4].includes(rect.length)) {
    throw new Error("usage: tools/spr.ts <file.spr> [<frame> <out.png> [x y w h]]");
  }
  const sprite = parseSpr(await Deno.readFile(path));
  if (outPath) {
    const [x, y, width, height] = rect.map(Number);
    await exportPng(sprite, Number(frame), outPath, rect.length ? { x, y, width, height } : undefined);
  } else {
    const hex = (channel: number) => channel.toString(16).padStart(2, "0");
    const palette = Array.from(
      { length: sprite.header.paletteColors },
      (_, index) => `#${[...sprite.palette.subarray(index * RGB_SIZE, index * RGB_SIZE + RGB_SIZE)].map(hex).join("")}`,
    );
    const frames = sprite.frames.map(({ pixels: _pixels, ...frame }) => frame);
    console.log(JSON.stringify({ header: sprite.header, palette, frames }, null, 2));
  }
}

Deno.test("decodes a synthetic sprite in every texture format", async () => {
  const { assertEquals } = await import("@std/assert");
  const paletteAt = HEADER_SIZE + SHORT_SIZE;
  const frameAt = paletteAt + 256 * RGB_SIZE;
  const bytes = new Uint8Array(frameAt + INT_SIZE + FRAME_HEADER_SIZE + 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(IDENT_SPRITE));
  [[4, SPRITE_VERSION], [20, 2], [24, 1], [28, 1]].forEach(([offset, value]) => view.setInt32(offset, value, true));
  view.setInt16(HEADER_SIZE, 256, true);
  bytes.set([100, 50, 0], paletteAt + 1 * RGB_SIZE);
  bytes.set([0, 0, 200], paletteAt + TRANSPARENT_INDEX * RGB_SIZE);
  [FRAME_SINGLE, -1, 1, 2, 1].forEach((value, field) => view.setInt32(frameAt + field * INT_SIZE, value, true));
  bytes.set([1, TRANSPARENT_INDEX], frameAt + INT_SIZE + FRAME_HEADER_SIZE);

  const rgbaAs = (format: number) => {
    view.setInt32(12, format, true);
    const sprite = parseSpr(bytes);
    return [...frameRgba(sprite, sprite.frames[0])];
  };
  const sprite = parseSpr(bytes);
  assertEquals(sprite.header.trailingBytes, 0);
  assertEquals(sprite.frames.map(({ origin, width, height }) => ({ origin, width, height })), [
    { origin: [-1, 1], width: 2, height: 1 },
  ]);
  assertEquals(rgbaAs(0), [100, 50, 0, 255, 0, 0, 200, 255]);
  assertEquals(rgbaAs(1), [255, 128, 0, 100, 0, 0, 255, 200]);
  assertEquals(rgbaAs(2), [0, 0, 200, 1, 0, 0, 200, 255]);
  assertEquals(rgbaAs(3), [100, 50, 0, 255, 0, 0, 200, 0]);
});
