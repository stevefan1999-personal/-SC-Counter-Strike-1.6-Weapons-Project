// Rewrites animation events of a GoldSrc studio model (MDL v10) in place and proves that nothing else changed.
// Usage: deno run -R -W tools/mdlpatch.ts <in.mdl> <out.mdl> <event>:<options>=<event>:<options>...
//   e.g. deno run -R -W tools/mdlpatch.ts v_eagle.mdl v_eagle_r2.mdl 5001:21=5005:cs16_muzzleflash2_s6_a0.txt
// Every rule must match at least one event. Only the event id and the options text of matching mstudioevent_t records
// change; the file keeps its size and every other byte.
// Self-check: deno test tools/mdlpatch.ts
// Layout: ReGameDLL_CS/regamedll/engine/studio.h (studiohdr_t, mstudioseqdesc_t, mstudioevent_t).

const STUDIO_VERSION = 10;
const IDENT_MODEL = "IDST";
const HEADER_SEQUENCE_COUNT = 164;
const HEADER_SEQUENCE_INDEX = 168;
const SEQUENCE_SIZE = 176;
const SEQUENCE_LABEL_SIZE = 32;
const SEQUENCE_EVENT_COUNT = 48;
const SEQUENCE_EVENT_INDEX = 52;
// mstudioevent_t: int frame; int event; int type; char options[64].
const EVENT_SIZE = 76;
const EVENT_ID = 4;
const EVENT_OPTIONS = 12;
const OPTIONS_SIZE = 64;
const INT_SIZE = 4;

export interface StudioEvent {
  event: number;
  options: string;
}

export interface PatchRule {
  from: StudioEvent;
  to: StudioEvent;
}

interface EventRecord extends StudioEvent {
  sequence: string;
  frame: number;
  offset: number;
}

const latin1 = new TextDecoder("latin1");

const text = (bytes: Uint8Array, offset: number, length: number) => {
  const raw = bytes.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return latin1.decode(end < 0 ? raw : raw.subarray(0, end));
};

// Lists every event record with its file offset; fails on anything that is not a well-formed v10 model.
export function eventRecords(bytes: Uint8Array): EventRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const int = (offset: number) => view.getInt32(offset, true);
  const inside = (offset: number, length: number) => offset >= 0 && length >= 0 && offset + length <= bytes.length;
  if (!inside(0, HEADER_SEQUENCE_INDEX + INT_SIZE) || text(bytes, 0, INT_SIZE) !== IDENT_MODEL) {
    throw new Error("not a studio model");
  }
  if (int(INT_SIZE) !== STUDIO_VERSION) throw new Error(`studio version ${int(INT_SIZE)}, expected ${STUDIO_VERSION}`);
  const [sequenceCount, sequenceIndex] = [int(HEADER_SEQUENCE_COUNT), int(HEADER_SEQUENCE_INDEX)];
  if (!inside(sequenceIndex, sequenceCount * SEQUENCE_SIZE)) throw new RangeError("sequence table overruns the file");
  return Array.from({ length: sequenceCount }, (_, index) => sequenceIndex + index * SEQUENCE_SIZE).flatMap((at) => {
    const [eventCount, eventIndex] = [int(at + SEQUENCE_EVENT_COUNT), int(at + SEQUENCE_EVENT_INDEX)];
    if (!inside(eventIndex, eventCount * EVENT_SIZE)) {
      throw new RangeError(`events of sequence at ${at} overrun the file`);
    }
    return Array.from({ length: eventCount }, (_, index) => eventIndex + index * EVENT_SIZE).map((offset) => ({
      sequence: text(bytes, at, SEQUENCE_LABEL_SIZE),
      frame: int(offset),
      event: int(offset + EVENT_ID),
      options: text(bytes, offset + EVENT_OPTIONS, OPTIONS_SIZE),
      offset,
    }));
  });
}

export function parseRule(rule: string): PatchRule {
  const match = rule.match(/^(\d+):([^=]*)=(\d+):(.*)$/);
  if (!match) throw new Error(`rule "${rule}" is not <event>:<options>=<event>:<options>`);
  return { from: { event: Number(match[1]), options: match[2] }, to: { event: Number(match[3]), options: match[4] } };
}

const encodeOptions = (options: string) => {
  // The engine reads options as a NUL-terminated string, so one byte stays for the terminator.
  if (!/^[\x20-\x7e]*$/.test(options) || options.length >= OPTIONS_SIZE) {
    throw new Error(`options "${options}" must be printable ASCII shorter than ${OPTIONS_SIZE} bytes`);
  }
  const field = new Uint8Array(OPTIONS_SIZE);
  field.set(new TextEncoder().encode(options));
  return field;
};

// Returns a patched copy; the zero-filled options field leaves no stale text behind the new terminator.
export function patchEvents(bytes: Uint8Array, rules: PatchRule[]) {
  const records = eventRecords(bytes);
  const patched = bytes.slice();
  const view = new DataView(patched.buffer);
  const changes = rules.flatMap((rule) => {
    const matches = records.filter(({ event, options }) => event === rule.from.event && options === rule.from.options);
    if (matches.length === 0) throw new Error(`no event ${rule.from.event} "${rule.from.options}" in the model`);
    const field = encodeOptions(rule.to.options);
    return matches.map((record) => {
      view.setInt32(record.offset + EVENT_ID, rule.to.event, true);
      patched.set(field, record.offset + EVENT_OPTIONS);
      return { sequence: record.sequence, frame: record.frame, offset: record.offset, from: rule.from, to: rule.to };
    });
  });
  verifyPatch(bytes, patched, changes);
  return { bytes: patched, changes };
}

// Any byte outside the event id and options of a changed record must be untouched, and each change must read back.
export function verifyPatch(original: Uint8Array, patched: Uint8Array, changes: { offset: number; to: StudioEvent }[]) {
  if (original.length !== patched.length) throw new Error(`size changed: ${original.length} -> ${patched.length}`);
  const editable = (index: number) =>
    changes.some(({ offset }) =>
      (index >= offset + EVENT_ID && index < offset + EVENT_ID + INT_SIZE) ||
      (index >= offset + EVENT_OPTIONS && index < offset + EVENT_SIZE)
    );
  const stray = original.findIndex((byte, index) => byte !== patched[index] && !editable(index));
  if (stray >= 0) throw new Error(`byte ${stray} changed outside the patched event fields`);
  const after = new Map(eventRecords(patched).map((record) => [record.offset, record]));
  for (const { offset, to } of changes) {
    const record = after.get(offset);
    if (record?.event !== to.event || record.options !== to.options) {
      throw new Error(`event at ${offset} reads back as ${record?.event} "${record?.options}"`);
    }
  }
}

if (import.meta.main) {
  const [input, output, ...rules] = Deno.args;
  if (!input || !output || rules.length === 0) {
    throw new Error(
      "usage: deno run -R -W tools/mdlpatch.ts <in.mdl> <out.mdl> <event>:<options>=<event>:<options>...",
    );
  }
  const { bytes, changes } = patchEvents(await Deno.readFile(input), rules.map(parseRule));
  await Deno.writeFile(output, bytes);
  console.log(JSON.stringify({ input, output, changes }, null, 2));
}

// A model with two sequences: "shoot" fires 5001 "21" twice and 5004 once, "idle" fires 5011 "11".
function syntheticModel() {
  const sequenceAt = 256;
  const eventsAt = sequenceAt + 2 * SEQUENCE_SIZE;
  const bytes = new Uint8Array(eventsAt + 4 * EVENT_SIZE + 16).map((_, index) => index % 251);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, value: number) => view.setInt32(offset, value, true);
  const putText = (offset: number, value: string, size: number) => {
    bytes.fill(0, offset, offset + size);
    bytes.set(new TextEncoder().encode(value), offset);
  };
  putText(0, IDENT_MODEL, INT_SIZE);
  put(INT_SIZE, STUDIO_VERSION);
  put(HEADER_SEQUENCE_COUNT, 2);
  put(HEADER_SEQUENCE_INDEX, sequenceAt);
  [["shoot", 3, eventsAt], ["idle", 1, eventsAt + 3 * EVENT_SIZE]].forEach(([label, count, index], sequence) => {
    const at = sequenceAt + sequence * SEQUENCE_SIZE;
    putText(at, String(label), SEQUENCE_LABEL_SIZE);
    put(at + SEQUENCE_EVENT_COUNT, Number(count));
    put(at + SEQUENCE_EVENT_INDEX, Number(index));
  });
  [[5001, "21"], [5004, "cs16/eagle/magin.wav"], [5001, "21"], [5011, "11"]].forEach(([event, options], index) => {
    const at = eventsAt + index * EVENT_SIZE;
    put(at, index);
    put(at + EVENT_ID, Number(event));
    put(at + 8, 0);
    putText(at + EVENT_OPTIONS, String(options), OPTIONS_SIZE);
  });
  return bytes;
}

Deno.test("patches only the event id and options of matching events", async () => {
  const { assertEquals } = await import("@std/assert");
  const original = syntheticModel();
  const { bytes, changes } = patchEvents(original, [parseRule("5001:21=5005:cs16_muzzleflash2_s6_a0.txt")]);
  assertEquals(changes.map(({ sequence, frame }) => [sequence, frame]), [["shoot", 0], ["shoot", 2]]);
  assertEquals(eventRecords(bytes).map(({ sequence, event, options }) => [sequence, event, options]), [
    ["shoot", 5005, "cs16_muzzleflash2_s6_a0.txt"],
    ["shoot", 5004, "cs16/eagle/magin.wav"],
    ["shoot", 5005, "cs16_muzzleflash2_s6_a0.txt"],
    ["idle", 5011, "11"],
  ]);
  const changed = original.reduce((count, byte, index) => count + (byte !== bytes[index] ? 1 : 0), 0);
  assertEquals(changed > 0 && changed <= 2 * (INT_SIZE + OPTIONS_SIZE), true);
});

Deno.test("rejects rules that match nothing and options that do not fit", async () => {
  const { assertThrows } = await import("@std/assert");
  assertThrows(() => patchEvents(syntheticModel(), [parseRule("5021:11=5005:x.txt")]), Error, "no event 5021");
  assertThrows(() => patchEvents(syntheticModel(), [parseRule(`5011:11=5005:${"x".repeat(OPTIONS_SIZE)}`)]), Error);
  assertThrows(() => parseRule("5001=5005:x.txt"), Error, "is not");
});

Deno.test("verification catches a byte changed outside the event fields", async () => {
  const { assertThrows } = await import("@std/assert");
  const original = syntheticModel();
  const { bytes, changes } = patchEvents(original, [parseRule("5011:11=5005:x.txt")]);
  const tampered = bytes.slice();
  tampered[changes[0].offset] ^= 1; // the frame number is not an editable field
  assertThrows(() => verifyPatch(original, tampered, changes), Error, "outside the patched event fields");
  assertThrows(() => eventRecords(original.subarray(0, 300)), RangeError);
});
