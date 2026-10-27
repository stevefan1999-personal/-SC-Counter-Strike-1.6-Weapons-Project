// Builds the sniper-scope view model that shows CS 1.6's scope at every zoom level (docs/fov.md).
// Usage: deno run -R -W tools/scopegen.ts <cstrike dir> <out.mdl>
// Self-check: deno test tools/scopegen.ts
//
// CS 1.6 draws its scope in the client: CHudSniperScope::Draw (Valve client.so 0xc7210) blacks out everything outside
// a circle of H - 2 * floor(H / 16) pixels and draws two 1-pixel cross lines, and the engine adds sniper_scope.spr
// (the weapon list's "zoom" crosshair) at the centre. A Sven server cannot draw that, so the port shows the scope as
// a view model. Sven draws view models with the world FOV, which liblist.gam's vertical_fov makes a vertical angle, so
// a flat model covers the same share of the screen height at every resolution. Each sequence puts the plane at the
// distance that gives CS's sizes at one zoom level's Sven FOV.
import { parseMdl } from "./mdl.ts";
import { parseSpr } from "./spr.ts";

// Geometry unit: one line of a 900-line screen. Sven's FOV is vertical, so every size scales with the screen height.
const REFERENCE_LINES = 900;
// Keeps the plane between 37 and 322 units from the eye, beyond the 4-unit near plane.
const MODEL_UNITS_PER_LINE = 1 / 16;
// CS 1.6 at 900 lines: on every ray the first black pixel is 393 lines from the centre.
const CIRCLE_RADIUS = 393;
// 0.2 lines from a true circle at 1440 lines.
const CIRCLE_SEGMENTS = 128;
// The black ring reaches screens up to 13:1.
const OUTER_RADIUS = 6000;
// The cross lines start at the screen centre and are 0.75 lines wide, so they cover one pixel from 600 to 1800 lines.
const LINE_WIDTH = 0.75;
// CHudSniperScope leaves a gap of 10 VGUI units of a 480-line screen around the centre of its lines.
const LINE_START = (10 * REFERENCE_LINES) / 480;
const LINE_END = CIRCLE_RADIUS + 10;
// CS draws sniper_scope.spr pixel for pixel at every resolution; a model scales with the screen height, so the sprite
// is texel for texel at REFERENCE_LINES only (docs/fov.md). The crossing of its lines (texel 127, 129) sits on the
// cross lines. CS draws it half a pixel off, which blends its own 1-pixel lines to grey; the model keeps only its dots
// and red centre.
const RETICLE_CROSSING = [127, 129];
const TRANSPARENT_INDEX = 255;
// Sequences in CS16_Scope_Animations order (base.as): CS's normal view, then zooms 40, 15 and 10.
const SEQUENCE_CS_FOVS = [90, 40, 15, 10];
// CS 1.6 reads a FOV as the horizontal angle of a 4:3 view; Sven reads it as the vertical angle (base.as SvenFov).
const CS_VIEW_HEIGHT_PER_WIDTH = 0.75;
// Sven's engine clamps the view to 10-150 degrees (hw.so 0x136580).
const SVEN_MIN_FOV = 10;

const STUDIO_VERSION = 10;
const HEADER_SIZE = 244;
const SIZE = { bone: 112, sequence: 176, sequenceGroup: 104, texture: 80, bodyPart: 76, model: 112, mesh: 20 } as const;
const BONE_CHANNELS = 6;
const PALETTE_SIZE = 256 * 3;
const POSITION_SCALE = 1 / 64; // animation shorts of the plane distance: up to 511 units
const SEQUENCE_FPS = 30;
const STUDIO_LOOPING = 1;
const TEXTURE_FLATSHADE = 0x1;
const TEXTURE_FULLBRIGHT = 0x4;
const TEXTURE_MASKED = 0x40;
const SOLID_TEXTURE_SIZE = 8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (angle: number) => (angle * 180) / Math.PI;

// Same rounding and clamp as base.as: the SetFOV message carries whole degrees.
export const svenFov = (csFov: number) =>
  Math.max(
    SVEN_MIN_FOV,
    Math.floor(degrees(2 * Math.atan(CS_VIEW_HEIGHT_PER_WIDTH * Math.tan(radians(csFov) / 2))) + 0.5),
  );

// Distance at which one model line unit spans one line of the screen at a vertical FOV.
export const planeDistance = (fov: number) => (REFERENCE_LINES / 2) * MODEL_UNITS_PER_LINE / Math.tan(radians(fov) / 2);

// The reticle sprite without its own lines: a line texel stays only where a dot or the red centre covers it.
export function reticleDots({ width, height, pixels }: { width: number; height: number; pixels: Uint8Array }) {
  const [column, row] = RETICLE_CROSSING;
  const opaque = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x] !== TRANSPARENT_INDEX;
  return pixels.map((index, at) => {
    const [x, y] = [at % width, Math.floor(at / width)];
    const bare = (x === column && !opaque(x - 1, y) && !opaque(x + 1, y)) ||
      (y === row && !opaque(x, y - 1) && !opaque(x, y + 1));
    return bare ? TRANSPARENT_INDEX : index;
  });
}

type Point = { right: number; up: number; s?: number; t?: number };
type Command = { fan: boolean; points: Point[] };

// Polygons are listed clockwise as seen from the eye: the winding Sven draws (the stock scope model uses it too).
const quad = (left: number, bottom: number, right: number, top: number, uv?: { size: number }): Command => ({
  fan: true,
  points: [
    { right: left, up: bottom, s: 0, t: uv?.size },
    { right: left, up: top, s: 0, t: 0 },
    { right, up: top, s: uv?.size, t: 0 },
    { right, up: bottom, s: uv?.size, t: uv?.size },
  ],
});

// Black ring from the circle to far outside the screen, as one strip that zigzags between the two edges.
const ring = (): Command => ({
  fan: false,
  points: Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, step) => (2 * Math.PI * step) / CIRCLE_SEGMENTS)
    .flatMap((angle) =>
      [OUTER_RADIUS, CIRCLE_RADIUS].map((radius) => ({
        right: radius * Math.cos(angle),
        up: radius * Math.sin(angle),
      }))
    ),
});

const crossLines = (): Command[] => [
  quad(0, LINE_START, LINE_WIDTH, LINE_END),
  quad(0, -LINE_END, LINE_WIDTH, -LINE_START),
  quad(LINE_START, -LINE_WIDTH, LINE_END, 0),
  quad(-LINE_END, -LINE_WIDTH, -LINE_START, 0),
];

const reticle = (size: number): Command => {
  const [column, row] = RETICLE_CROSSING;
  return quad(-column, row - size, size - column, row, { size });
};

class ByteWriter {
  #bytes = new Uint8Array(1 << 21);
  #view = new DataView(this.#bytes.buffer);
  at = 0;

  align() {
    this.at = (this.at + 3) & ~3;
    return this.at;
  }
  int = (value: number) => this.#view.setInt32(this.#advance(4), value, true);
  float = (value: number) => this.#view.setFloat32(this.#advance(4), value, true);
  short = (value: number) => this.#view.setInt16(this.#advance(2), value, true);
  ushort = (value: number) => this.#view.setUint16(this.#advance(2), value, true);
  bytes = (data: ArrayLike<number>) => this.#bytes.set(data, this.#advance(data.length));
  text = (value: string, length: number) => {
    const at = this.#advance(length);
    this.#bytes.set(new TextEncoder().encode(value).subarray(0, length - 1), at);
  };
  reserve = (length: number) => this.#advance(length);
  result = () => this.#bytes.slice(0, this.at);

  #advance(length: number) {
    const at = this.at;
    this.at += length;
    return at;
  }
}

export type Reticle = { width: number; height: number; pixels: Uint8Array; palette: Uint8Array };

export function buildScope(reticleTexture: Reticle): Uint8Array {
  if (reticleTexture.width !== reticleTexture.height) throw new Error("the reticle sprite must be square");
  const meshes = [[ring(), ...crossLines()], [reticle(reticleTexture.width)]];
  const points = meshes.flat().flatMap(({ points }) => points);
  const fovs = SEQUENCE_CS_FOVS.map(svenFov);
  const reach = OUTER_RADIUS * MODEL_UNITS_PER_LINE;
  const out = new ByteWriter();

  const header = out.reserve(HEADER_SIZE);
  const bone = out.reserve(SIZE.bone);
  // One animation block per sequence: the bone's x offset (the plane distance) is the only animated channel.
  const anims = fovs.map((fov) => {
    const at = out.align();
    [BONE_CHANNELS * 2, 0, 0, 0, 0, 0].forEach(out.ushort);
    out.bytes([1, 1]); // one run: one valid value for one frame
    out.short(Math.round(planeDistance(fov) / POSITION_SCALE));
    return at;
  });
  const sequences = out.align();
  out.reserve(SIZE.sequence * fovs.length);
  const sequenceGroup = out.reserve(SIZE.sequenceGroup);
  const bodyPart = out.reserve(SIZE.bodyPart);
  const model = out.reserve(SIZE.model);
  const vertexBones = out.align();
  out.bytes(new Uint8Array(points.length));
  const normalBones = out.align();
  out.bytes(new Uint8Array(meshes.length));
  const vertices = out.align();
  points.forEach(({ right, up }) =>
    [0, -right * MODEL_UNITS_PER_LINE, up * MODEL_UNITS_PER_LINE].forEach((v) => out.float(v))
  );
  // Every mesh faces the eye; fullbright textures ignore lighting anyway.
  const normals = out.at;
  meshes.forEach(() => [-1, 0, 0].forEach((v) => out.float(v)));
  const meshTable = out.reserve(SIZE.mesh * meshes.length);
  let vertex = 0;
  const commands = meshes.map((mesh, normal) => {
    const at = out.at;
    for (const { fan, points } of mesh) {
      out.short(fan ? -points.length : points.length);
      for (const { s = 0, t = 0 } of points) [vertex++, normal, s, t].forEach(out.short);
    }
    out.short(0);
    return at;
  });
  const textures = out.align();
  out.reserve(SIZE.texture * 2);
  const skins = out.at;
  [0, 1].forEach(out.short);
  const solid = { width: SOLID_TEXTURE_SIZE, height: SOLID_TEXTURE_SIZE };
  const textureData = [solid, reticleTexture].map(({ width, height }, index) => {
    const at = out.align();
    out.bytes(index === 0 ? new Uint8Array(width * height) : reticleTexture.pixels);
    out.bytes(index === 0 ? new Uint8Array(PALETTE_SIZE) : reticleTexture.palette);
    return at;
  });

  const end = out.at;
  const fill = (at: number, write: () => void) => {
    const resume = out.at;
    out.at = at;
    write();
    out.at = resume;
  };
  fill(header, () => {
    out.bytes(new TextEncoder().encode("IDST")); // no terminator
    out.int(STUDIO_VERSION);
    out.text("cs_scope.mdl", 64);
    out.int(end);
    out.reserve(4 * 15); // eye position, hull and clipping boxes stay zero, as in the stock scope model
    out.int(0); // flags
    // deno-fmt-ignore
    [1, bone, 0, bone, 0, bone, fovs.length, sequences, 1, sequenceGroup, 2, textures, textureData[0], 2, 1, skins,
      1, bodyPart, 0, bone, 0, 0, 0, 0, 0, 0].forEach((value) => out.int(value));
  });
  fill(bone, () => {
    out.text("scope", 32);
    out.int(-1); // parent
    out.int(0); // flags
    Array.from({ length: BONE_CHANNELS }, () => out.int(-1)); // no bone controllers
    Array.from({ length: BONE_CHANNELS }, () => out.float(0));
    [POSITION_SCALE, 0, 0, 0, 0, 0].forEach((value) => out.float(value));
  });
  fovs.forEach((fov, index) => {
    fill(sequences + index * SIZE.sequence, () => {
      out.text(`idle_fov${SEQUENCE_CS_FOVS[index]}`, 32);
      out.float(SEQUENCE_FPS);
      out.int(STUDIO_LOOPING);
      out.reserve(4 * 4); // activity, weight, no events
      out.int(1); // frames
      out.reserve(4 * 4 + 4 * 3 + 4 * 2); // pivots, motion, linear movement, automove
      // The clipping box of the plane, so the renderer never culls it.
      const distance = planeDistance(fov);
      [distance, -reach, -reach, distance, reach, reach].forEach((value) => out.float(value));
      out.int(1); // blends
      out.int(anims[index]);
      out.reserve(4 * 2 + 4 * 2); // blend types and starts
      [1, 1].forEach((value) => out.float(value)); // blend ends
      out.reserve(4 * 6); // blend parent, sequence group 0, nodes, next sequence
    });
  });
  fill(sequenceGroup, () => out.text("default", 32));
  fill(bodyPart, () => {
    out.text("scope", 64);
    [1, 1, model].forEach((value) => out.int(value));
  });
  fill(model, () => {
    out.text("scope", 64);
    out.reserve(4 * 2); // type, bounding radius
    [meshes.length, meshTable, points.length, vertexBones, vertices, meshes.length, normalBones, normals, 0, 0]
      .forEach((value) => out.int(value));
  });
  meshes.forEach((mesh, index) =>
    fill(meshTable + index * SIZE.mesh, () => {
      const triangles = mesh.reduce((sum, { points }) => sum + points.length - 2, 0);
      [triangles, commands[index], index, 1, index].forEach((value) => out.int(value));
    })
  );
  const textureTable = [
    { name: "black.bmp", flags: TEXTURE_FLATSHADE | TEXTURE_FULLBRIGHT, ...solid },
    { name: "sniper_scope.bmp", flags: TEXTURE_FLATSHADE | TEXTURE_FULLBRIGHT | TEXTURE_MASKED, ...reticleTexture },
  ];
  textureTable.forEach(({ name, flags, width, height }, index) =>
    fill(textures + index * SIZE.texture, () => {
      out.text(name, 64);
      [flags, width, height, textureData[index]].forEach((value) => out.int(value));
    })
  );
  return out.result();
}

if (import.meta.main) {
  const [cstrikeDir, outPath] = Deno.args;
  if (!outPath) throw new Error("usage: deno run -R -W tools/scopegen.ts <cstrike dir> <out.mdl>");
  const sprite = parseSpr(await Deno.readFile(`${cstrikeDir}/sprites/sniper_scope.spr`));
  const [frame] = sprite.frames;
  await Deno.writeFile(outPath, buildScope({ ...frame, pixels: reticleDots(frame), palette: sprite.palette }));
}

Deno.test("each sequence shows CS's scope circle at its zoom level's Sven FOV", async () => {
  const { assertAlmostEquals, assertEquals } = await import("@std/assert");
  const size = 256;
  const model = parseMdl(
    buildScope({
      width: size,
      height: size,
      pixels: new Uint8Array(size * size),
      palette: new Uint8Array(PALETTE_SIZE),
    }),
  );
  if (model.textures === undefined) throw new Error("expected a full studio header");
  assertEquals(SEQUENCE_CS_FOVS.map(svenFov), [74, 31, 11, 10]);
  assertEquals(model.sequences.map(({ label }) => label), ["idle_fov90", "idle_fov40", "idle_fov15", "idle_fov10"]);
  assertEquals(model.textures.map(({ name, flagNames }) => [name, flagNames]), [
    ["black.bmp", ["flatshade", "fullbright"]],
    ["sniper_scope.bmp", ["flatshade", "fullbright", "masked"]],
  ]);
  SEQUENCE_CS_FOVS.map(svenFov).forEach((fov, sequence) => {
    const [bounds] = model.submodelBounds(sequence, 0);
    if (!bounds) throw new Error("no geometry");
    // The plane sits at the sequence's distance and the circle spans CS's share of the screen height.
    assertAlmostEquals(bounds.min[0], planeDistance(fov), POSITION_SCALE);
    assertAlmostEquals(bounds.max[0], planeDistance(fov), POSITION_SCALE);
    const circle = (CIRCLE_RADIUS * MODEL_UNITS_PER_LINE) / bounds.min[0] / Math.tan(radians(fov) / 2);
    assertAlmostEquals(circle * REFERENCE_LINES, 2 * CIRCLE_RADIUS, 0.2);
  });
});

Deno.test("the reticle keeps its dots and loses its bare lines", async () => {
  const { assertEquals } = await import("@std/assert");
  const size = 256;
  const [column, row] = RETICLE_CROSSING;
  const pixels = new Uint8Array(size * size).fill(TRANSPARENT_INDEX);
  const black = (x: number, y: number) => (pixels[y * size + x] = 0);
  for (let y = 0; y < row - 4; y++) black(column, y);
  for (let x = 0; x < column - 4; x++) black(x, row);
  // A plus-shaped dot on the vertical line at row 16.
  [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]].forEach(([dx, dy]) => black(column + dx, 16 + dy));
  const kept = reticleDots({ width: size, height: size, pixels });
  const at = (x: number, y: number) => kept[y * size + x];
  assertEquals([at(column, 5), at(column, 15), at(column, 16), at(column - 1, 16), at(10, row)], [
    TRANSPARENT_INDEX,
    TRANSPARENT_INDEX,
    0,
    0,
    TRANSPARENT_INDEX,
  ]);
});
