// Self-check of the FOV metrics on synthetic frames: deno test tests/fixture/fov-metrics_test.ts
import { assert, assertAlmostEquals } from "@std/assert";
import { focalFromTurn, scopeGeometry, viewModelBox } from "./fov-metrics.ts";
import type { Frame } from "./frame.ts";

const WIDTH = 640;
const HEIGHT = 360;

// A sky of smooth stripes fixed in world directions, seen through a camera turned left by `yawDegrees`.
const sky = (focal: number, yawDegrees: number): Frame => {
  const yaw = (yawDegrees * Math.PI) / 180;
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let row = 0; row < HEIGHT; row++) {
    for (let column = 0; column < WIDTH; column++) {
      const [x, y] = [column + 0.5 - WIDTH / 2, row + 0.5 - HEIGHT / 2];
      const azimuth = Math.atan2(x, focal) - yaw;
      const elevation = Math.atan2(y, Math.hypot(x, focal));
      const value = 128 + 40 * Math.sin(azimuth * 211) + 30 * Math.sin(elevation * 173 + azimuth * 57) +
        20 * Math.sin(azimuth * 389 - elevation * 97);
      rgb.fill(Math.round(value), (row * WIDTH + column) * 3, (row * WIDTH + column) * 3 + 3);
    }
  }
  return { width: WIDTH, height: HEIGHT, rgb };
};

Deno.test("a known yaw turn gives back the focal length", () => {
  for (const focal of [400, 1500]) {
    const turn = 2000 / focal;
    assertAlmostEquals(focalFromTurn(sky(focal, 0), sky(focal, turn), turn), focal, focal * 0.002);
  }
});

Deno.test("the scope circle, its lines and the view-model box are found", () => {
  const radius = 140;
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let row = 0; row < HEIGHT; row++) {
    for (let column = 0; column < WIDTH; column++) {
      const outside = Math.hypot(column + 0.5 - WIDTH / 2, row + 0.5 - HEIGHT / 2) > radius;
      const line = column === WIDTH / 2 || row === HEIGHT / 2;
      rgb.fill(outside || line ? 0 : 150, (row * WIDTH + column) * 3, (row * WIDTH + column) * 3 + 3);
    }
  }
  const scope = scopeGeometry({ width: WIDTH, height: HEIGHT, rgb });
  assertAlmostEquals(scope.diameter, 2 * radius, 2);
  assertAlmostEquals(scope.centre.x, WIDTH / 2, 1);
  assert(scope.lineColumns.includes(WIDTH / 2) && scope.lineRows.includes(HEIGHT / 2));

  const off = sky(500, 0);
  const on = { ...off, rgb: off.rgb.slice() };
  for (let row = 300; row < HEIGHT; row++) on.rgb.fill(255, (row * WIDTH + 400) * 3, (row * WIDTH + 520) * 3);
  const box = viewModelBox(on, off);
  // The bottom strip (HUD numbers) never counts.
  assert(box.left === 400 && box.right === 519 && box.top === 300 && box.bottom < HEIGHT - 1);
});
