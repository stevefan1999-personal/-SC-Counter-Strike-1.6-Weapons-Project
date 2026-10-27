// Measures the kill feed in a screenshot against a frame of the same view without notices.
// Usage: deno run -A feed-metrics.ts <with-feed.png> <without-feed.png>
// Prints one JSON object per notice line: its rows and its parts left to right, with the gaps between parts.
// Names are drawn with a dark drop shadow, while icons are added onto the background and can never darken
// it, so a part with darkened pixels is "text". Boxes cover lit pixels only (no shadow). For text, "peak" is
// the brightest pixel, i.e. the flat team colour; for icons, "added" is the most red the icon added and the
// green and blue it added at that pixel, i.e. the sprite tint scaled by the brightest texel.
import { changedPixels, load, pixel, runs } from "./frame.ts";

const CHANGE_THRESHOLD = 24;
// Rows without a changed pixel that split two lines.
const LINE_GAP = 3;
// A shadow darkens every channel; static frames of the same view differ by 0 elsewhere.
const SHADOW_DARKENING = 6;
const SHADOW_PIXELS = 3;
const FEED_HEIGHT_SHARE = 0.4;

const [shotPath, beforePath] = Deno.args;
if (!beforePath) throw new Error("usage: feed-metrics.ts <with-feed.png> <without-feed.png>");
const [shot, before] = await Promise.all([load(shotPath), load(beforePath)]);
const changed = changedPixels(before, shot, {
  left: shot.width / 2,
  top: 0,
  right: shot.width,
  bottom: Math.round(shot.height * FEED_HEIGHT_SHARE),
}, CHANGE_THRESHOLD);
// Parts sit s(5) = (int)(5 * H / 480) apart, letters closer; half that gap splits parts but not names.
const PART_GAP = Math.floor(Math.floor((5 * shot.height) / 480) / 2);

type Point = { x: number; y: number };
const added = ({ x, y }: Point) => pixel(shot, x, y).map((value, channel) => value - pixel(before, x, y)[channel]);
const brightness = (point: Point) => pixel(shot, point.x, point.y).reduce((sum, value) => sum + value, 0);
const lit = (point: Point) => added(point).reduce((sum, value) => sum + value, 0) > 0;
const shadowed = (point: Point) => added(point).every((value) => value <= -SHADOW_DARKENING);

const describe = (points: Point[]) => {
  const ink = points.filter(lit);
  // Only darker pixels: the world changed there (a blood decal, a gib), which is no part of the feed.
  if (ink.length === 0) return undefined;
  const box = {
    left: Math.min(...ink.map(({ x }) => x)),
    right: Math.max(...ink.map(({ x }) => x)),
    top: Math.min(...ink.map(({ y }) => y)),
    bottom: Math.max(...ink.map(({ y }) => y)),
  };
  const size = { width: box.right - box.left + 1, height: box.bottom - box.top + 1 };
  const around = Array.from({ length: box.bottom - box.top + 3 }, (_, row) => box.top - 1 + row).flatMap((y) =>
    Array.from({ length: box.right - box.left + 3 }, (_, column) => ({ x: box.left - 1 + column, y }))
  );
  if (around.filter(shadowed).length >= SHADOW_PIXELS) {
    const peak = ink.toSorted((a, b) => brightness(b) - brightness(a))[0];
    return { kind: "text", ...box, ...size, peak: pixel(shot, peak.x, peak.y).join(",") };
  }
  const reddest = ink.toSorted((a, b) => added(b)[0] - added(a)[0])[0];
  return { kind: "icon", ...box, ...size, added: added(reddest).join(",") };
};

const lines = runs(changed.map(({ y }) => y), LINE_GAP).map(([top, bottom]) => {
  const inLine = changed.filter(({ y }) => y >= top && y <= bottom);
  const parts = runs(inLine.map(({ x }) => x), PART_GAP).flatMap(([left, right]) =>
    describe(inLine.filter(({ x }) => x >= left && x <= right)) ?? []
  );
  const gaps = parts.slice(1).map((part, index) => part.left - parts[index].right - 1);
  return { rightMargin: shot.width - 1 - (parts.at(-1)?.right ?? shot.width - 1), gaps, parts };
});
lines.filter((line) => line.parts.length > 0).forEach((line) => console.log(JSON.stringify(line)));
