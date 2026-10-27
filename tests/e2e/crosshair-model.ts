// The CS 1.6 dynamic crosshair at its default fps_max 100 (cs16-hud-spec.md 3.12.4, Appendix A.2): one step per frame,
// so the reference for a crosshair that the plugin can only send 10 times a second.
import { assertAlmostEquals, assertEquals } from "@std/assert";

const STEPS_PER_SECOND = 100;
const MAX_DISTANCE = 15;
const DECAY_RATE = 0.013;
const DECAY_OFFSET = 0.1;

export type Burst = { gap: number; shotDelta: number; fireInterval: number; fireSeconds: number };
export type Step = { time: number; distance: number };

// Every frame of a burst that starts with a shot in the first frame, then of the recovery until the crosshair rests.
export function simulateBurst({ gap, shotDelta, fireInterval, fireSeconds }: Burst): Step[] {
  const shots = Math.ceil(fireSeconds / fireInterval);
  const shotFrames = new Set(
    Array.from({ length: shots }, (_, shot) => Math.round(shot * fireInterval * STEPS_PER_SECOND)),
  );
  const steps: Step[] = [];
  let distance = gap;
  for (let frame = 0; frame < STEPS_PER_SECOND * fireSeconds || distance > gap; frame++) {
    distance = shotFrames.has(frame)
      ? Math.min(distance + shotDelta, MAX_DISTANCE)
      : Math.max(distance - (distance * DECAY_RATE + DECAY_OFFSET), gap);
    steps.push({ time: frame / STEPS_PER_SECOND, distance });
  }
  return steps;
}

// What a screen of width / base scale shows of a burst: the gap band once the spread has built up (from `settled`
// seconds into the burst to its end), and the time from the last shot until the drawn gap is the rest gap.
export function burstEnvelope(burst: Burst, scale: number, settled: number) {
  const steps = simulateBurst(burst);
  const firing = steps.filter(({ time }) => time >= settled && time < burst.fireSeconds);
  const gaps = firing.map(({ distance }) => Math.floor(distance * scale));
  const lastShot = (Math.ceil(burst.fireSeconds / burst.fireInterval) - 1) * burst.fireInterval;
  const restGap = Math.floor(burst.gap * scale);
  const rest = steps.find(({ time, distance }) => time > lastShot && Math.floor(distance * scale) === restGap)!;
  return { minGap: Math.min(...gaps), maxGap: Math.max(...gaps), recovery: rest.time - lastShot };
}

Deno.test("the model gives the AK-47 frames of cs16-hud-spec.md A.2", () => {
  // A.2: one shot every 10 frames for 10 shots (frames 10-100); this burst starts at frame 0, so frame f is A.2 f + 10.
  const steps = simulateBurst({ gap: 4, shotDelta: 4, fireInterval: 0.1, fireSeconds: 0.95 });
  const at = (specFrame: number) => steps[specFrame - 10].distance;
  assertEquals(at(10), 8);
  assertAlmostEquals(at(11), 7.796, 0.001);
  assertAlmostEquals(at(19), 6.257, 0.001);
  assertAlmostEquals(at(20), 10.257, 0.001);
  assertEquals(at(100), 15);
  assertAlmostEquals(at(101), 14.705, 0.001);
  assertAlmostEquals(at(110), 12.217, 0.001);
  assertAlmostEquals(at(140), 5.753, 0.001);
  assertEquals(steps.length - 1 + 10, 151); // the distance is back at the gap in frame 151
});

Deno.test("the AK-47 keeps a gap of 31 to 37 px at 1600x900 during held fire and rests 0.49 s after it", () => {
  const ak47 = { gap: 4, shotDelta: 4, fireInterval: 0.0955, fireSeconds: 1.5 };
  const envelope = burstEnvelope(ak47, 2.5, 0.5);
  assertEquals([envelope.minGap, envelope.maxGap], [31, 37]);
  assertAlmostEquals(envelope.recovery, 0.49, 0.011);
});
