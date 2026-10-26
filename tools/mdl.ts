// GoldSrc studio model (MDL v10) inspector.
// Usage: deno run -R tools/mdl.ts <file.mdl>   (prints JSON)
// Self-check: deno test tools/mdl.ts
// Struct layouts: ReGameDLL_CS/regamedll/engine/studio.h (studiohdr_t and friends).

const STUDIO_VERSION = 10;
const IDENT_MODEL = "IDST";
const IDENT_SEQUENCE_GROUP = "IDSQ";
const HEADER_SIZE = 244;
const HEADER_COUNTS_OFFSET = 140; // numbones: the first of 20 count/index ints
const HEADER_COUNT_FIELDS = 20;
const INT_SIZE = 4;
const SHORT_SIZE = 2;
export const PALETTE_SIZE = 256 * 3;
const VEC3_SIZE = 3 * INT_SIZE;
const BONE_CHANNELS = 6; // x, y, z, roll, pitch, yaw
const BONE_VALUE_OFFSET = 64;
const BONE_SCALE_OFFSET = 88;
const SEQUENCE_ANIM_OFFSET = 124;
const SEQUENCE_GROUP_FIELD_OFFSET = 156;
const SEQUENCE_GROUP_DATA_OFFSET = 100;
const BOUNDS_DECIMALS = 100;
const SIZE = {
  bone: 112,
  controller: 24,
  hitbox: 32,
  sequence: 176,
  event: 76,
  sequenceGroup: 104,
  texture: 80,
  bodyPart: 76,
  model: 112,
  mesh: 20,
  attachment: 88,
} as const;

export const TEXTURE_FLAGS = {
  flatshade: 0x0001,
  chrome: 0x0002,
  fullbright: 0x0004,
  nomips: 0x0008,
  alpha: 0x0010,
  additive: 0x0020,
  masked: 0x0040,
} as const;
const KNOWN_TEXTURE_FLAGS = Object.values(TEXTURE_FLAGS).reduce((all, bit) => all | bit, 0);

export const textureFlagNames = (flags: number): string[] => [
  ...Object.entries(TEXTURE_FLAGS).filter(([, bit]) => flags & bit).map(([name]) => name),
  ...(flags & ~KNOWN_TEXTURE_FLAGS ? [`unknown:0x${(flags & ~KNOWN_TEXTURE_FLAGS).toString(16)}`] : []),
];

// 3x4 row-major affine transform.
type Affine = number[];

// Studio bones store Euler angles as (roll, pitch, yaw); AngleQuaternion builds Rz(yaw) * Ry(pitch) * Rx(roll).
const boneMatrix = ([x, y, z, roll, pitch, yaw]: number[]): Affine => {
  const [sr, sp, sy] = [roll, pitch, yaw].map(Math.sin);
  const [cr, cp, cy] = [roll, pitch, yaw].map(Math.cos);
  // deno-fmt-ignore
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
    -sp, cp * sr, cp * cr, z,
  ];
};

const transformPoint = (matrix: Affine, [x, y, z]: number[]) =>
  [0, 1, 2].map((row) => matrix[row * 4] * x + matrix[row * 4 + 1] * y + matrix[row * 4 + 2] * z + matrix[row * 4 + 3]);

const concat = (parent: Affine, child: Affine): Affine =>
  [0, 1, 2].flatMap((row) => {
    const rotated = [0, 1, 2, 3].map((column) =>
      [0, 1, 2].reduce((sum, inner) => sum + parent[row * 4 + inner] * child[inner * 4 + column], 0)
    );
    rotated[3] += parent[row * 4 + 3];
    return rotated;
  });

const roundBounds = (value: number) => Math.round(value * BOUNDS_DECIMALS) / BOUNDS_DECIMALS;

class StructReader {
  readonly #view: DataView;
  readonly #latin1 = new TextDecoder("latin1");

  constructor(readonly bytes: Uint8Array) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  int = (offset: number) => this.#view.getInt32(offset, true);
  short = (offset: number) => this.#view.getInt16(offset, true);
  ushort = (offset: number) => this.#view.getUint16(offset, true);
  float = (offset: number) => this.#view.getFloat32(offset, true);
  vec3 = (offset: number) => [0, 1, 2].map((axis) => this.float(offset + axis * INT_SIZE));

  text(offset: number, length: number): string {
    const raw = this.bytes.subarray(offset, offset + length);
    const end = raw.indexOf(0);
    return this.#latin1.decode(end < 0 ? raw : raw.subarray(0, end));
  }

  // Reads `count` fixed-size records and fails loudly on offsets outside the file.
  table<T>(count: number, offset: number, stride: number, read: (at: number) => T): T[] {
    if (count < 0 || (count > 0 && (offset < 0 || offset + count * stride > this.bytes.length))) {
      throw new RangeError(`${count} records of ${stride} bytes at ${offset} overrun ${this.bytes.length} bytes`);
    }
    return Array.from({ length: count }, (_, row) => read(offset + row * stride));
  }
}

export function parseMdl(bytes: Uint8Array) {
  const read = new StructReader(bytes);
  const ident = read.text(0, INT_SIZE);
  const version = read.int(INT_SIZE);
  if (![IDENT_MODEL, IDENT_SEQUENCE_GROUP].includes(ident) || version !== STUDIO_VERSION) {
    throw new Error(`not a studio v${STUDIO_VERSION} model (ident "${ident}", version ${version})`);
  }
  const header = { ident, version, name: read.text(8, 64), length: read.int(72), fileSize: bytes.length };
  if (ident === IDENT_SEQUENCE_GROUP) return { header };
  if (bytes.length < HEADER_SIZE) throw new RangeError(`header needs ${HEADER_SIZE} bytes, file has ${bytes.length}`);

  // deno-fmt-ignore
  const [
    numBones, boneIndex, numControllers, controllerIndex, numHitboxes, hitboxIndex,
    numSequences, sequenceIndex, numSequenceGroups, sequenceGroupIndex,
    numTextures, textureIndex, textureDataIndex, numSkinRefs, numSkinFamilies, skinIndex,
    numBodyParts, bodyPartIndex, numAttachments, attachmentIndex,
  ] = Array.from({ length: HEADER_COUNT_FIELDS }, (_, field) => read.int(HEADER_COUNTS_OFFSET + field * INT_SIZE));

  const textures = read.table(numTextures, textureIndex, SIZE.texture, (at) => {
    const [flags, width, height, dataOffset] = [64, 68, 72, 76].map((field) => read.int(at + field));
    const paletteOffset = dataOffset + width * height;
    if (paletteOffset + PALETTE_SIZE > bytes.length) throw new RangeError(`texture at ${at} overruns the file`);
    return {
      name: read.text(at, 64),
      flags,
      flagNames: textureFlagNames(flags),
      width,
      height,
      dataOffset,
      paletteOffset,
    };
  });

  // Poses follow StudioCalcBonePosition/StudioCalcBoneQuaternion. Only sequence group 0 lives in this file, so
  // sequences stored in other groups fall back to the bind pose.
  const animOf = (sequence: number): number | undefined => {
    const at = sequenceIndex + sequence * SIZE.sequence;
    if (sequence >= numSequences || read.int(at + SEQUENCE_GROUP_FIELD_OFFSET) !== 0) return undefined;
    return read.int(sequenceGroupIndex + SEQUENCE_GROUP_DATA_OFFSET) + read.int(at + SEQUENCE_ANIM_OFFSET);
  };
  const channelValue = (anim: number | undefined, bone: number, boneAt: number, channel: number, frame: number) => {
    const value = read.float(boneAt + BONE_VALUE_OFFSET + channel * INT_SIZE);
    const boneAnimAt = (anim ?? 0) + bone * BONE_CHANNELS * SHORT_SIZE; // mstudioanim_t: one offset per channel
    const valuesOffset = anim === undefined ? 0 : read.ushort(boneAnimAt + channel * SHORT_SIZE);
    if (valuesOffset === 0) return value;
    // mstudioanimvalue_t runs: a {valid, total} header, then `valid` values; later frames of a run repeat the last one.
    let run = boneAnimAt + valuesOffset;
    let remaining = frame;
    while (bytes[run + 1] <= remaining) {
      remaining -= bytes[run + 1];
      run += (bytes[run] + 1) * SHORT_SIZE;
    }
    const index = bytes[run] > remaining ? remaining + 1 : bytes[run];
    return value + read.short(run + index * SHORT_SIZE) * read.float(boneAt + BONE_SCALE_OFFSET + channel * INT_SIZE);
  };
  const boneAts = read.table(numBones, boneIndex, SIZE.bone, (at) => at);
  const framePose = (sequence: number, frame: number) => {
    const anim = animOf(sequence);
    return boneAts.reduce<Affine[]>((transforms, boneAt, bone) => {
      const values = Array.from(
        { length: BONE_CHANNELS },
        (_, channel) => channelValue(anim, bone, boneAt, channel, frame),
      );
      const parent = read.int(boneAt + 32);
      transforms.push(
        parent >= 0 && transforms[parent] ? concat(transforms[parent], boneMatrix(values)) : boneMatrix(values),
      );
      return transforms;
    }, []);
  };
  const submodels = read.table(
    numBodyParts,
    bodyPartIndex,
    SIZE.bodyPart,
    (at) => read.table(read.int(at + 64), read.int(at + 72), SIZE.model, (model) => model),
  ).flat();
  const boundsIn = (pose: Affine[], model: number) => {
    const [numVerts, vertInfoIndex, vertIndex] = [80, 84, 88].map((field) => read.int(model + field));
    const points = read.table(numVerts, vertIndex, VEC3_SIZE, (at) => {
      const bone = bytes[vertInfoIndex + (at - vertIndex) / VEC3_SIZE];
      if (!pose[bone]) throw new RangeError(`vertex at ${at} uses missing bone ${bone}`);
      return transformPoint(pose[bone], read.vec3(at));
    });
    const extreme = (pick: (...values: number[]) => number) =>
      [0, 1, 2].map((axis) => roundBounds(pick(...points.map((point) => point[axis]))));
    return points.length > 0 ? { min: extreme(Math.min), max: extreme(Math.max) } : undefined;
  };
  // Frame 0 of sequence 0 is the pose a view model idles in; its bounds show where geometry sits on screen.
  const pose = framePose(0, 0);
  const idleBounds = (model: number) => {
    const bounds = boundsIn(pose, model);
    return bounds ? { idleBounds: bounds } : {};
  };

  return {
    header: {
      ...header,
      eyePosition: read.vec3(76),
      hullMin: read.vec3(88),
      hullMax: read.vec3(100),
      boundsMin: read.vec3(112),
      boundsMax: read.vec3(124),
      flags: read.int(136),
      textureDataIndex,
    },
    bones: read.table(numBones, boneIndex, SIZE.bone, (at) => ({ name: read.text(at, 32), parent: read.int(at + 32) })),
    controllers: read.table(numControllers, controllerIndex, SIZE.controller, (at) => ({
      bone: read.int(at),
      type: read.int(at + 4),
      start: read.float(at + 8),
      end: read.float(at + 12),
      index: read.int(at + 20),
    })),
    hitboxes: read.table(numHitboxes, hitboxIndex, SIZE.hitbox, (at) => ({
      bone: read.int(at),
      group: read.int(at + 4),
      min: read.vec3(at + 8),
      max: read.vec3(at + 20),
    })),
    sequences: read.table(numSequences, sequenceIndex, SIZE.sequence, (at) => ({
      label: read.text(at, 32),
      fps: read.float(at + 32),
      flags: read.int(at + 36),
      activity: read.int(at + 40),
      numFrames: read.int(at + 56),
      numBlends: read.int(at + 120),
      sequenceGroup: read.int(at + 156),
      events: read.table(read.int(at + 48), read.int(at + 52), SIZE.event, (event) => ({
        frame: read.int(event),
        event: read.int(event + 4),
        options: read.text(event + 12, 64),
      })),
    })),
    sequenceGroups: read.table(numSequenceGroups, sequenceGroupIndex, SIZE.sequenceGroup, (at) => ({
      label: read.text(at, 32),
      name: read.text(at + 32, 64),
    })),
    textures,
    skinFamilies: read.table(
      numSkinFamilies,
      skinIndex,
      numSkinRefs * SHORT_SIZE,
      (family) => read.table(numSkinRefs, family, SHORT_SIZE, read.short),
    ),
    bodyParts: read.table(numBodyParts, bodyPartIndex, SIZE.bodyPart, (at) => ({
      name: read.text(at, 64),
      base: read.int(at + 68),
      models: read.table(read.int(at + 64), read.int(at + 72), SIZE.model, (model) => ({
        name: read.text(model, 64),
        numVerts: read.int(model + 80),
        numNorms: read.int(model + 92),
        ...idleBounds(model),
        meshes: read.table(read.int(model + 72), read.int(model + 76), SIZE.mesh, (mesh) => ({
          numTris: read.int(mesh),
          skinRef: read.int(mesh + 8),
        })),
      })),
    })),
    attachments: read.table(numAttachments, attachmentIndex, SIZE.attachment, (at) => {
      const [bone, origin] = [read.int(at + 36), read.vec3(at + 40)];
      // Where muzzle flashes and shells spawn while the model idles (model space).
      const idleOrigin = pose[bone] ? transformPoint(pose[bone], origin).map(roundBounds) : origin;
      return { name: read.text(at, 32), bone, origin, idleOrigin };
    }),
    // Bounds of every submodel (body part order) at one frame of one sequence; JSON output leaves it out.
    submodelBounds: (sequence: number, frame: number) => {
      const posed = framePose(sequence, frame);
      return submodels.map((model) => boundsIn(posed, model));
    },
  };
}

export type StudioModel = ReturnType<typeof parseMdl>;

// The engine loads textures from "<name>T.mdl" next to the model when the model itself has none.
export async function inspectMdl(path: string) {
  const model = parseMdl(await Deno.readFile(path));
  if (model.textures === undefined || model.textures.length > 0) {
    return { ...model, textureSource: { kind: "embedded" } };
  }
  const texturePath = path.replace(/\.mdl$/i, "T.mdl");
  try {
    const textureModel = parseMdl(await Deno.readFile(texturePath));
    return { ...model, textureSource: { kind: "external", path: texturePath, ...textureModel } };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { ...model, textureSource: { kind: "missing", path: texturePath } };
    }
    throw error;
  }
}

if (import.meta.main) {
  if (Deno.args.length !== 1) throw new Error("usage: deno run -R tools/mdl.ts <file.mdl>");
  console.log(JSON.stringify(await inspectMdl(Deno.args[0]), null, 2));
}

Deno.test("parses a synthetic studio model", async () => {
  const { assertEquals, assertThrows } = await import("@std/assert");
  const textureAt = HEADER_SIZE;
  const pixelsAt = textureAt + SIZE.texture;
  const skinAt = pixelsAt + 4 + PALETTE_SIZE;
  const boneAt = skinAt + SHORT_SIZE;
  const bodyPartAt = boneAt + SIZE.bone;
  const submodelAt = bodyPartAt + SIZE.bodyPart;
  const vertInfoAt = submodelAt + SIZE.model;
  const vertAt = vertInfoAt + INT_SIZE;
  const sequenceGroupAt = vertAt + VEC3_SIZE;
  const sequenceAt = sequenceGroupAt + SIZE.sequenceGroup;
  const animAt = sequenceAt + SIZE.sequence;
  const valuesAt = animAt + BONE_CHANNELS * SHORT_SIZE;
  const bytes = new Uint8Array(valuesAt + 3 * SHORT_SIZE);
  const view = new DataView(bytes.buffer);
  const putText = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  const putInts = (pairs: number[][]) => pairs.forEach(([offset, value]) => view.setInt32(offset, value, true));
  putText(0, IDENT_MODEL);
  putText(8, "synthetic.mdl");
  putInts([[4, STUDIO_VERSION], [72, bytes.length]]);
  // numbones/boneindex, numtextures/textureindex, numskinref/numskinfamilies/skinindex, numbodyparts/bodypartindex
  putInts([[140, 1], [144, boneAt], [180, 1], [184, textureAt], [192, 1], [196, 1], [200, skinAt], [204, 1]]);
  putInts([[208, bodyPartAt], [164, 1], [168, sequenceAt], [172, 1], [176, sequenceGroupAt]]);
  // One submodel vertex at (1, 0, 0) on a bone translated by (1, 2, 3) and turned 90 degrees in yaw.
  putInts([[bodyPartAt + 64, 1], [bodyPartAt + 68, 1], [bodyPartAt + 72, submodelAt], [submodelAt + 80, 1]]);
  putInts([[submodelAt + 84, vertInfoAt], [submodelAt + 88, vertAt], [boneAt + 32, -1]]);
  view.setFloat32(vertAt, 1, true);
  [1, 2, 3, 0, 0, Math.PI / 2].forEach((value, channel) =>
    view.setFloat32(boneAt + BONE_VALUE_OFFSET + channel * INT_SIZE, value, true)
  );
  // A 3-frame sequence whose x channel is one run {valid 2, total 3} of 10, 20: frame 2 repeats 20.
  putInts([[sequenceAt + 56, 3], [sequenceAt + 124, animAt]]);
  view.setUint16(animAt, valuesAt - animAt, true);
  bytes.set([2, 3], valuesAt);
  [10, 20].forEach((value, index) => view.setInt16(valuesAt + (1 + index) * SHORT_SIZE, value, true));
  view.setFloat32(boneAt + BONE_SCALE_OFFSET, 1, true);
  putText(boneAt, "Bip01 R Hand");
  putText(textureAt, "chrome_lens.bmp");
  const flags = TEXTURE_FLAGS.chrome | TEXTURE_FLAGS.masked | 0x100;
  putInts([[textureAt + 64, flags], [textureAt + 68, 2], [textureAt + 72, 2], [textureAt + 76, pixelsAt]]);

  const model = parseMdl(bytes);
  if (model.textures === undefined) throw new Error("expected a full studio header");
  assertEquals(model.textures, [{
    name: "chrome_lens.bmp",
    flags,
    flagNames: ["chrome", "masked", "unknown:0x100"],
    width: 2,
    height: 2,
    dataOffset: pixelsAt,
    paletteOffset: pixelsAt + 4,
  }]);
  assertEquals(model.skinFamilies, [[0]]);
  assertEquals(model.bones, [{ name: "Bip01 R Hand", parent: -1 }]);
  assertEquals(model.bodyParts[0].models[0].idleBounds, { min: [11, 3, 3], max: [11, 3, 3] });
  assertEquals(model.submodelBounds(0, 2), [{ min: [21, 3, 3], max: [21, 3, 3] }]);
  putInts([[textureAt + 76, bytes.length]]);
  assertThrows(() => parseMdl(bytes), RangeError);
});
