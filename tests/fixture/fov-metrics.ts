// Field-of-view metrics of CS 1.6 and Counter-Life screenshots (docs/fov.md).
// Usage: deno run -A tests/fixture/fov-metrics.ts <capture dir>...   (each dir holds the manifest.json of a capture)
// Prints JSON per capture: view-model boxes, sniper-scope geometry and the focal length of the world view.
import { type Box, type Frame, load } from "./frame.ts";

// Both games draw the scope with pure black, which a lit world never reaches.
const BLACK_MAX = 3;
// Dark guns on a dark floor differ from it by only a few levels.
const VIEW_MODEL_CHANGE = 4;
// The bottom strip holds the ammo and health numbers, which fade in Sven between the two frames.
const VIEW_MODEL_BOTTOM_PER_HEIGHT = 0.94;
const GRID = 4;
// The scope edge is the first pixel of a black run this long, so dots and lines inside the circle do not count.
const EDGE_RUN = 8;
const RAY_STEP_DEGREES = 2;
// Rays near the axes would follow the cross lines.
const AXIS_CLEARANCE_DEGREES = 6;
const RAY_START = 40;
const OUTLIER_PIXELS = 3;
// Line and dot searches stay this far from the circle edge and, for lines, outside the reticle.
const EDGE_MARGIN = 10;
// The reticle (mil-dots, centre gap) stays within 0.3 of the radius in CS 1.6.
const RETICLE_CLEARANCE_PER_RADIUS = 0.4;
const LINE_SEARCH = 6;
const LINE_COVERAGE = 0.95;
const RED_MIN = 120;
const RED_GREEN_MAX = 90;
const RED_SEARCH = 24;
// Matching band of the turn frames, in screen heights: wide enough for texture, inside the smallest scope circle.
const BAND_WIDTH_PER_HEIGHT = 0.2;
const BAND_HEIGHT_PER_HEIGHT = 0.12;
const OVERLAY_CLEARANCE = 8;
const MIN_OVERLAP = 0.5;
// Focal lengths searched, in screen heights: vertical fields of view from about 140 down to 4 degrees.
const FOCAL_MIN_PER_HEIGHT = 0.25;
const FOCAL_MAX_PER_HEIGHT = 12;
const COARSE_RATIO = 1.01;
const COARSE_STRIDE = 7;
const FINE_RATIO = 1.0005;

type Point = { x: number; y: number };

const luma = (frame: Frame, x: number, y: number) => {
  const at = (y * frame.width + x) * 3;
  return 0.299 * frame.rgb[at] + 0.587 * frame.rgb[at + 1] + 0.114 * frame.rgb[at + 2];
};
const black = (frame: Frame, x: number, y: number) => {
  const at = (y * frame.width + x) * 3;
  return Math.max(frame.rgb[at], frame.rgb[at + 1], frame.rgb[at + 2]) <= BLACK_MAX;
};
const inside = (frame: Frame, x: number, y: number) => x >= 0 && y >= 0 && x < frame.width && y < frame.height;
const round2 = (value: number) => Math.round(value * 100) / 100;
const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (angle: number) => (angle * Math.PI) / 180;

// Bounding box of the largest connected patch of changed pixels: the view model, without specks of world animation.
export function viewModelBox(on: Frame, off: Frame): Box & { width: number; height: number } {
  const cells = new Map<string, Point[]>();
  for (let y = 0; y < Math.round(VIEW_MODEL_BOTTOM_PER_HEIGHT * on.height); y++) {
    for (let x = 0; x < on.width; x++) {
      const at = (y * on.width + x) * 3;
      const change = Math.max(...[0, 1, 2].map((channel) => Math.abs(on.rgb[at + channel] - off.rgb[at + channel])));
      if (change <= VIEW_MODEL_CHANGE) continue;
      const key = `${Math.floor(x / GRID)},${Math.floor(y / GRID)}`;
      cells.set(key, [...(cells.get(key) ?? []), { x, y }]);
    }
  }
  const seen = new Set<string>();
  const components = [...cells.keys()].filter((key) => !seen.has(key)).map((start) => {
    const queue = [start];
    seen.add(start);
    for (let index = 0; index < queue.length; index++) {
      const [cellX, cellY] = queue[index].split(",").map(Number);
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const next = `${cellX + dx},${cellY + dy}`;
        if (cells.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return queue.flatMap((key) => cells.get(key)!);
  });
  const largest = components.toSorted((a, b) => b.length - a.length)[0];
  if (!largest) throw new Error("no view model: the two frames are equal");
  // A reduce, because a spread of every pixel overflows the call stack at 1440 lines.
  const box = largest.reduce(
    (found, { x, y }) => ({
      left: Math.min(found.left, x),
      top: Math.min(found.top, y),
      right: Math.max(found.right, x),
      bottom: Math.max(found.bottom, y),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
  return { ...box, width: box.right - box.left + 1, height: box.bottom - box.top + 1 };
}

// Least-squares circle through the points (Kasa fit: x² + y² + Dx + Ey + F = 0).
const fitCircle = (points: Point[]) => {
  const sums = { x: 0, y: 0, xx: 0, yy: 0, xy: 0, xz: 0, yz: 0, z: 0 };
  for (const { x, y } of points) {
    const z = x * x + y * y;
    sums.x += x, sums.y += y, sums.xx += x * x, sums.yy += y * y, sums.xy += x * y;
    sums.xz += x * z, sums.yz += y * z, sums.z += z;
  }
  const n = points.length;
  // Normal equations for D, E, F, solved by Cramer's rule.
  const a = [[sums.xx, sums.xy, sums.x], [sums.xy, sums.yy, sums.y], [sums.x, sums.y, n]];
  const b = [-sums.xz, -sums.yz, -sums.z];
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const whole = det(a);
  const [d, e, f] = [0, 1, 2].map((column) =>
    det(a.map((row, index) => row.map((value, c) => c === column ? b[index] : value))) / whole
  );
  const centre = { x: -d / 2, y: -e / 2 };
  const radius = Math.sqrt(centre.x ** 2 + centre.y ** 2 - f);
  return { centre, radius };
};

// First pixel of a long black run along a ray from the screen centre: the inner edge of the scope's black.
const edgeAlong = (frame: Frame, angle: number): Point | undefined => {
  const [dx, dy] = [Math.cos(radians(angle)), Math.sin(radians(angle))];
  const at = (r: number) => ({ x: Math.round(frame.width / 2 + dx * r), y: Math.round(frame.height / 2 + dy * r) });
  for (let r = RAY_START; inside(frame, at(r).x, at(r).y); r++) {
    const run = Array.from({ length: EDGE_RUN }, (_, step) => at(r + step));
    if (run.every(({ x, y }) => inside(frame, x, y) && black(frame, x, y))) return at(r);
  }
  return undefined;
};

// Columns (or rows) near the centre that are black almost everywhere along the cross line, outside the reticle.
const lineAt = (frame: Frame, centre: Point, radius: number, vertical: boolean) => {
  const fixed = vertical ? centre.x : centre.y, along = vertical ? centre.y : centre.x;
  const clearance = RETICLE_CLEARANCE_PER_RADIUS * radius;
  const span = [...Array(Math.round(radius - EDGE_MARGIN - clearance)).keys()]
    .flatMap((step) => [along - clearance - step, along + clearance + step]).map(Math.round);
  return [...Array(2 * LINE_SEARCH + 1).keys()].map((step) => Math.round(fixed) - LINE_SEARCH + step).filter((line) =>
    span.filter((position) => vertical ? black(frame, line, position) : black(frame, position, line)).length >=
      LINE_COVERAGE * span.length
  );
};

// The first black pixel of the line on each side of the centre, walking out from beyond the red centre dot.
const gapAround = (frame: Frame, centre: Point, line: number, vertical: boolean) => {
  const along = Math.round(vertical ? centre.y : centre.x);
  const limit = vertical ? frame.height : frame.width;
  const isBlack = (position: number) => vertical ? black(frame, line, position) : black(frame, position, line);
  const walk = (direction: number) => {
    let position = along + direction * (RED_SEARCH / 2);
    while (position > 0 && position < limit - 1 && !isBlack(position)) position += direction;
    return position;
  };
  return { before: walk(-1), after: walk(1) };
};

// Black blobs that stick out of a cross line: the mil-dots, as centre offsets from the scope centre.
const dotsAlong = (frame: Frame, centre: Point, radius: number, line: number, crossing: number, vertical: boolean) => {
  const along = Math.round(vertical ? centre.y : centre.x);
  const reach = Math.round(radius - EDGE_MARGIN);
  const marked = [...Array(2 * reach + 1).keys()].map((step) => along - reach + step).filter((position) =>
    vertical
      ? black(frame, line - 1, position) || black(frame, line + 1, position)
      : black(frame, position, line - 1) || black(frame, position, line + 1)
  );
  const runs = marked.reduce<number[][]>((found, position) => {
    const last = found.at(-1);
    if (last && position - last.at(-1)! === 1) last.push(position);
    else found.push([position]);
    return found;
  }, []);
  return runs.map((run) => ({ offset: round2((run[0] + run.at(-1)!) / 2 - crossing), size: run.length }));
};

export function scopeGeometry(frame: Frame) {
  const angles = [...Array(360 / RAY_STEP_DEGREES).keys()].map((step) => step * RAY_STEP_DEGREES).filter((angle) =>
    Math.min(...[0, 90, 180, 270, 360].map((axis) => Math.abs(angle - axis))) > AXIS_CLEARANCE_DEGREES
  );
  const edge = angles.map((angle) => edgeAlong(frame, angle)).filter((point): point is Point => point !== undefined);
  if (edge.length < angles.length / 2) throw new Error("no scope circle in the frame");
  // A dark spot in the world can end a ray early; drop such points once and fit again.
  const first = fitCircle(edge);
  const kept = edge.filter(({ x, y }) =>
    Math.abs(Math.hypot(x - first.centre.x, y - first.centre.y) - first.radius) <= OUTLIER_PIXELS
  );
  const { centre, radius } = fitCircle(kept);
  const residuals = kept.map(({ x, y }) => Math.hypot(x - centre.x, y - centre.y) - radius);
  const columns = lineAt(frame, centre, radius, true), rows = lineAt(frame, centre, radius, false);
  const red = [...Array(2 * RED_SEARCH + 1).keys()].flatMap((dy) =>
    [...Array(2 * RED_SEARCH + 1).keys()].map((dx) => ({
      x: Math.round(centre.x) - RED_SEARCH + dx,
      y: Math.round(centre.y) - RED_SEARCH + dy,
    }))
  ).filter(({ x, y }) => {
    const at = (y * frame.width + x) * 3;
    return frame.rgb[at] >= RED_MIN && frame.rgb[at + 1] <= RED_GREEN_MAX && frame.rgb[at + 2] <= RED_GREEN_MAX;
  });
  const span = (values: number[]) => values.length ? [Math.min(...values), Math.max(...values)] : [];
  return {
    centre: { x: round2(centre.x), y: round2(centre.y) },
    diameter: round2(2 * radius),
    roundness: round2(Math.max(...residuals.map(Math.abs))),
    lineColumns: columns,
    lineRows: rows,
    verticalGap: columns.length ? gapAround(frame, centre, columns[0], true) : undefined,
    horizontalGap: rows.length ? gapAround(frame, centre, rows[0], false) : undefined,
    // Mil-dot centres as offsets from the crossing of the two lines.
    horizontalDots: rows.length && columns.length ? dotsAlong(frame, centre, radius, rows[0], columns[0], false) : [],
    verticalDots: rows.length && columns.length ? dotsAlong(frame, centre, radius, columns[0], rows[0], true) : [],
    red: red.length ? { columns: span(red.map(({ x }) => x)), rows: span(red.map(({ y }) => y)) } : undefined,
  };
}

// Focal length (pixels) that best maps one frame onto the same view turned by a known yaw (left positive). A pure
// rotation about the eye moves every pixel by a homography that depends only on the focal length, so no map geometry
// is needed. Pixels on the centre lines (scope lines, crosshairs) and outside the scope circle never count.
export function focalFromTurn(from: Frame, to: Frame, turnDegrees: number, visibleRadius = Infinity): number {
  const [width, height] = [from.width, from.height];
  const [halfWidth, halfHeight] = [BAND_WIDTH_PER_HEIGHT * height, BAND_HEIGHT_PER_HEIGHT * height];
  const reach = (visibleRadius - EDGE_MARGIN) ** 2;
  const clear = (x: number, y: number) =>
    Math.abs(x) > OVERLAY_CLEARANCE && Math.abs(y) > OVERLAY_CLEARANCE && x * x + y * y < reach &&
    Math.abs(x) < width / 2 - 1 && Math.abs(y) < height / 2 - 1;
  const target = Float32Array.from({ length: width * height }, (_, at) => luma(to, at % width, Math.floor(at / width)));
  // Band pixels as offsets of their centres from the screen centre, with their brightness in the first frame.
  const band = { x: [] as number[], y: [] as number[], value: [] as number[] };
  for (let row = Math.round(height / 2 - halfHeight); row < height / 2 + halfHeight; row++) {
    for (let column = Math.round(width / 2 - halfWidth); column < width / 2 + halfWidth; column++) {
      const [x, y] = [column + 0.5 - width / 2, row + 0.5 - height / 2];
      if (!clear(x, y)) continue;
      band.x.push(x), band.y.push(y), band.value.push(luma(from, column, row));
    }
  }
  const [sine, cosine] = [Math.sin(radians(turnDegrees)), Math.cos(radians(turnDegrees))];
  const cost = (focal: number, stride: number) => {
    let sum = 0, count = 0, total = 0;
    for (let index = 0; index < band.x.length; index += stride) {
      total++;
      const [x, y] = [band.x[index], band.y[index]];
      // Ray (x, y, focal) turned left by the yaw step, projected again.
      const depth = -x * sine + focal * cosine;
      const [movedX, movedY] = [(focal * (x * cosine + focal * sine)) / depth, (focal * y) / depth];
      if (!clear(movedX, movedY)) continue;
      const [column, row] = [movedX + width / 2 - 0.5, movedY + height / 2 - 0.5];
      const [left, top] = [Math.floor(column), Math.floor(row)];
      const [fx, fy] = [column - left, row - top];
      const at = top * width + left;
      const moved = (target[at] * (1 - fx) + target[at + 1] * fx) * (1 - fy) +
        (target[at + width] * (1 - fx) + target[at + width + 1] * fx) * fy;
      sum += (band.value[index] - moved) ** 2;
      count++;
    }
    // A small overlap can match by chance, so it never wins.
    return count >= MIN_OVERLAP * total ? sum / count : Infinity;
  };
  // Constant ratio steps over every plausible field of view on a sparse band, then a fine scan and a parabola.
  const scan = (first: number, last: number, ratio: number, stride: number) =>
    Array.from({ length: Math.ceil(Math.log(last / first) / Math.log(ratio)) + 1 }, (_, step) => first * ratio ** step)
      .map((focal) => ({ focal, cost: cost(focal, stride) }))
      .reduce((a, b) => (b.cost < a.cost ? b : a));
  const coarse = scan(FOCAL_MIN_PER_HEIGHT * height, FOCAL_MAX_PER_HEIGHT * height, COARSE_RATIO, COARSE_STRIDE);
  const fine = scan(coarse.focal / COARSE_RATIO, coarse.focal * COARSE_RATIO, FINE_RATIO, 1);
  const [below, above] = [cost(fine.focal / FINE_RATIO, 1), cost(fine.focal * FINE_RATIO, 1)];
  const curvature = below - 2 * fine.cost + above;
  const step = curvature > 0 ? (below - above) / (2 * curvature) : 0;
  return fine.focal * FINE_RATIO ** step;
}

// Capture plan shared by the CS 1.6 fixture (fixture/fov.ts) and the Counter-Life scenario (e2e/fov.ts). Each yaw
// step (degrees, left positive) moves the world about 100 px at 900 lines, so the match stays inside the scope.
export const FOV_TURNS = { normal: 10, aug: 5 };
export const ZOOM_STATES = [
  { weapon: "weapon_scout", states: [{ name: "scout1", turn: 3.5 }, { name: "scout2", turn: 1.25 }] },
  { weapon: "weapon_awp", states: [{ name: "awp1", turn: 3.5 }, { name: "awp2", turn: 0.84 }] },
] as const;

export type FovState = {
  viewModel?: { on: string; off: string };
  scope?: string;
  turn?: { degrees: number; from: string; to: string }; // yaw change, left positive
};
export type FovManifest = { game: string; resolution: string; states: Record<string, FovState> };

if (import.meta.main) {
  const results: Record<string, unknown> = {};
  for (const dir of Deno.args) {
    const manifest: FovManifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.json`));
    const states: Record<string, unknown> = {};
    for (const [name, state] of Object.entries(manifest.states)) {
      const result: Record<string, unknown> = {};
      if (state.viewModel) {
        result.viewModel = viewModelBox(
          await load(`${dir}/${state.viewModel.on}`),
          await load(`${dir}/${state.viewModel.off}`),
        );
      }
      const scope = state.scope ? scopeGeometry(await load(`${dir}/${state.scope}`)) : undefined;
      if (scope) result.scope = scope;
      if (state.turn) {
        const from = await load(`${dir}/${state.turn.from}`);
        const to = await load(`${dir}/${state.turn.to}`);
        const focal = focalFromTurn(from, to, state.turn.degrees, scope ? scope.diameter / 2 : Infinity);
        result.world = {
          turnDegrees: state.turn.degrees,
          focalPixels: round2(focal),
          verticalDegrees: round2(degrees(2 * Math.atan(from.height / 2 / focal))),
        };
      }
      states[name] = result;
    }
    results[dir] = { game: manifest.game, resolution: manifest.resolution, states };
  }
  console.log(JSON.stringify(results, null, 2));
}
