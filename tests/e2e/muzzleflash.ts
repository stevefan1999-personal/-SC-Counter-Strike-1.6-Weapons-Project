// Muzzle flash capture: records a screen region while a weapon fires, finds the game frames that show a flash, and
// measures how many frames the flash stays and how large it is. Works with any GoldSrc game that is in game on the
// display and opens its console with ` (the Sven Co-op e2e client or stock CS 1.6).
// Usage: deno run -A tests/e2e/muzzleflash.ts <display> <outdir> <WxH+X+Y> <label>=<console command>...
//   e.g. deno run -A tests/e2e/muzzleflash.ts :102 .e2e/muzzle/sven 1000x660+500+240 deagle=weapon_csdeagle
//        deno run -A tests/e2e/muzzleflash.ts measure .e2e/muzzle/sven/deagle-1.png...   (measure saved shots again)
// Prints one JSON line per shot; <outdir>/<label>-<shot>.png shows the game frames before, with and after the flash.
// Self-check: deno test tests/e2e/muzzleflash.ts
import { just, sleep } from "./driver.ts";

// Both engines remove a muzzle flash 0.01 s after it spawns (docs/research/muzzle-flash.md), so at 20 fps (Sven's
// lowest fps_max; CS needs fps_override 1 to go that low) one flash can only be in one game frame. A 60 fps recording
// holds each 50 ms game frame 3 times.
const GAME_FPS = 20;
const RECORD_FPS = 60;
const SHOTS = 3;
const DRAW_MS = 2_500;
// Longer than the slowest CS cycle time (AWP 1.45 s), so every click fires.
const SHOT_INTERVAL_MS = 1_600;
const LEAD_MS = 700;
// Rise of the mean grey level (0-1) from one game frame to the next that can start a flash; the smallest flashes add
// about 0.007 in a 1000x660 region.
const FLASH_RISE = 0.004;
// A flash core gains 243-255 grey levels; recoil, pump and bolt motion or a lit gun alone gain at most about 175.
const CORE_MIN_GAIN = 200;
// A later frame shows a flash again when this share of the first flash's upper-left quadrant box is still lit; a full
// quarter disc fills pi / 4 of it.
const FLASH_COVER = 0.3;
// Grey levels (0-255) a pixel must gain over the frame before the shot to count as flash light.
const PIXEL_RISE = 32;
// Pixels that gain at least this share of the largest gain form the white-hot core at the flash centre.
const CORE_SHARE = 0.9;
// Reach follows rays this many degrees apart; a ray ends after this many unlit pixels in a row, so a star beyond the
// flash edge does not count.
const RAY_STEP_DEGREES = 2;
const RAY_GAP = 12;
const HALF_TURN_DEGREES = 180;
const MAX_GREY = 255;
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Pixel indices of the largest 8-connected patch in a 0/1 mask.
function largestPatch(mask: Uint8Array, width: number): number[] {
  const height = mask.length / width;
  let largest: number[] = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed]) continue;
    mask[seed] = 0;
    const [patch, stack] = [[seed], [seed]];
    while (stack.length) {
      const pixel = stack.pop()!;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [pixel % width + dx, Math.floor(pixel / width) + dy];
        const neighbour = y * width + x;
        if (x >= 0 && x < width && y >= 0 && y < height && mask[neighbour]) {
          mask[neighbour] = 0;
          stack.push(neighbour);
          patch.push(neighbour);
        }
      }
    }
    if (patch.length > largest.length) largest = patch;
  }
  return largest;
}

// Additive sprites only add light, so the flash is the largest patch that got brighter than the frame before the shot.
// That patch can also hold the recoiling gun and the light CS 1.6 casts on it, which lie below and right of the
// muzzle in every right-handed view model. Thus the sizes come from the parts above the flash's white-hot core, where
// only sky is behind the flash:
// - radius: from the lit area of the upper-left quadrant; a disc of radius r has a quadrant of area pi r^2 / 4 (for
//   the round CS pistol flash);
// - reach: the farthest lit pixel along rays across the upper half. The CS rifle flash is an X that CS turns to a
//   random angle; the upper half always holds a whole arm of it, so reach is the arm length at any angle.
export function measureFlash(before: Uint8Array, flash: Uint8Array, width: number, rise: number) {
  const gain = flash.map((level, index) => Math.max(0, level - before[index]));
  const patch = largestPatch(gain.map((level) => level > rise ? 1 : 0), width);
  const points = patch.map((pixel) => [pixel % width, Math.floor(pixel / width)]);
  // Large patches overflow Math.min(...spread), so the extremes are folds.
  const extreme = (values: number[], pick: (a: number, b: number) => number) =>
    values.reduce((best, value) => pick(best, value), values[0] ?? 0);
  const peak = extreme(patch.map((pixel) => gain[pixel]), Math.max);
  const core = points.filter((_, index) => gain[patch[index]] >= CORE_SHARE * peak);
  const [centerX, centerY] = [0, 1].map((axis) =>
    Math.round(core.reduce((sum, point) => sum + point[axis], 0) / Math.max(1, core.length))
  );
  const [xs, ys] = [points.map(([x]) => x), points.map(([, y]) => y)];
  const quadrant = points.filter(([x, y]) => x <= centerX && y <= centerY);
  const height = gain.length / width;
  const lit = (x: number, y: number) => {
    const [column, row] = [Math.round(x), Math.round(y)];
    return column >= 0 && column < width && row >= 0 && row < height && gain[row * width + column] > rise;
  };
  // 0 degrees points left, 90 up and 180 right.
  const tip = (degrees: number) => {
    const [dx, dy] = [
      -Math.cos(degrees * Math.PI / HALF_TURN_DEGREES),
      -Math.sin(degrees * Math.PI / HALF_TURN_DEGREES),
    ];
    let [last, gap] = [0, 0];
    for (let step = 0; gap < RAY_GAP && step < width + height; step++) {
      if (lit(centerX + dx * step, centerY + dy * step)) [last, gap] = [step, 0];
      else gap++;
    }
    return last;
  };
  const rays = Array.from(
    { length: HALF_TURN_DEGREES / RAY_STEP_DEGREES + 1 },
    (_, ray) => tip(ray * RAY_STEP_DEGREES),
  );
  return {
    x: extreme(xs, Math.min),
    y: extreme(ys, Math.min),
    width: extreme(xs, Math.max) - extreme(xs, Math.min) + 1,
    height: extreme(ys, Math.max) - extreme(ys, Math.min) + 1,
    area: patch.length,
    centerX,
    centerY,
    radius: Math.round(Math.sqrt(4 * quadrant.length / Math.PI)),
    reach: extreme(rays, Math.max),
    peak,
  };
}

// Share of the box between a flash's centre and its radius up and left that is brighter than the frame before the shot.
export function quadrantCover(
  before: Uint8Array,
  frame: Uint8Array,
  width: number,
  { centerX, centerY, radius }: { centerX: number; centerY: number; radius: number },
  rise: number,
) {
  const rows = Array.from({ length: radius + 1 }, (_, step) => centerY - step).filter((row) => row >= 0);
  const columns = Array.from({ length: radius + 1 }, (_, step) => centerX - step).filter((column) => column >= 0);
  const lit = rows.reduce(
    (sum, row) =>
      sum + columns.filter((column) => frame[row * width + column] - before[row * width + column] > rise).length,
    0,
  );
  return lit / Math.max(1, rows.length * columns.length);
}

async function magick(...args: string[]): Promise<Uint8Array> {
  const output = await new Deno.Command("magick", { args, stdout: "piped", stderr: "piped" }).output();
  if (!output.success) throw new Error(`magick ${args.join(" ")}: ${new TextDecoder().decode(output.stderr)}`);
  return output.stdout;
}

const grey = (image: string, crop = "100%x100%+0+0") =>
  magick(image, "-crop", crop, "+repage", "-colorspace", "Gray", "-depth", "8", "gray:-");

async function digest(path: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", await Deno.readFile(path))).join();
}

async function record(dir: string, region: string, display: string, fire: () => Promise<void>) {
  const [size, x, y] = region.split("+");
  await Deno.remove(dir, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(dir, { recursive: true });
  const seconds = (LEAD_MS + SHOTS * SHOT_INTERVAL_MS) / 1000;
  const ffmpeg = new Deno.Command("ffmpeg", {
    args: ["-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", `${RECORD_FPS}`]
      .concat(["-video_size", size, "-i", `${display}+${x},${y}`, "-t", `${seconds}`, `${dir}/%04d.png`]),
    stdout: "null",
    stderr: "inherit",
  }).spawn();
  await fire();
  if (!(await ffmpeg.status).success) throw new Error(`ffmpeg failed while recording ${dir}`);
}

// Copies of one game frame in a row are byte-identical PNGs; each run of copies becomes one game frame.
async function gameFrames(dir: string) {
  const paths = [...Deno.readDirSync(dir)].map((entry) => `${dir}/${entry.name}`).sort();
  const hashes = await Promise.all(paths.map(digest));
  return paths.reduce<{ path: string; copies: number }[]>((frames, path, index) => {
    if (index > 0 && hashes[index] === hashes[index - 1]) frames[frames.length - 1].copies++;
    else frames.push({ path, copies: 1 });
    return frames;
  }, []);
}

async function capture(display: string, outDir: string, region: string, weapons: string[]) {
  Deno.env.set("CL_DISPLAY", display);
  const width = Number(region.split("x")[0]);
  await just("con", `fps_max ${GAME_FPS}`);
  for (const weapon of weapons) {
    const [label, command] = weapon.split("=");
    await just("con", command);
    await sleep(DRAW_MS);
    const dir = `${outDir}/${label}-frames`;
    await record(dir, region, display, async () => {
      for (let shot = 0; shot < SHOTS; shot++) {
        await sleep(shot === 0 ? LEAD_MS : SHOT_INTERVAL_MS);
        await new Deno.Command("xdotool", { args: ["click", "1"], env: { DISPLAY: display } }).output();
      }
    });
    const frames = await gameFrames(dir);
    const means = new TextDecoder().decode(
      await magick(...frames.map(({ path }) => path), "-colorspace", "Gray", "-format", "%[fx:mean]\n", "info:"),
    ).trim().split("\n").map(Number);
    let shot = 0;
    for (let flash = 1; flash < frames.length; flash++) {
      if (means[flash] - means[flash - 1] <= FLASH_RISE) continue;
      const before = await grey(frames[flash - 1].path);
      const size = measureFlash(before, await grey(frames[flash].path), width, PIXEL_RISE);
      if (size.peak < CORE_MIN_GAIN) continue;
      // Count the game frames that show a flash: the first one plus any later frame lit again at the same place.
      let flashFrames = 1;
      while (
        flash + flashFrames < frames.length &&
        quadrantCover(before, await grey(frames[flash + flashFrames].path), width, size, PIXEL_RISE) > FLASH_COVER
      ) flashFrames++;
      const after = frames[Math.min(flash + flashFrames, frames.length - 1)].path;
      const evidence = `${outDir}/${label}-${++shot}.png`;
      await magick(
        frames[flash - 1].path,
        frames[flash].path,
        after,
        "+append",
        "-define",
        "png:exclude-chunks=date,time",
        evidence,
      );
      console.log(JSON.stringify({
        label,
        shot,
        flashGameFrames: flashFrames,
        firstFrameMs: Math.round(frames[flash].copies * 1000 / RECORD_FPS),
        ...size,
        brightness: Math.round((means[flash] - means[flash - 1]) * MAX_GREY * 100) / 100,
        evidence,
      }));
      flash += flashFrames - 1;
    }
    if (!Deno.env.get("KEEP_FRAMES")) await Deno.remove(dir, { recursive: true });
  }
}

// Evidence strips hold the frame before the shot, the flash frame and the frame after it side by side.
async function measureStrips(strips: string[]) {
  for (const evidence of strips) {
    const [stripWidth, height] = new TextDecoder().decode(await magick(evidence, "-format", "%w %h", "info:"))
      .split(" ").map(Number);
    const width = stripWidth / 3;
    const size = measureFlash(
      await grey(evidence, `${width}x${height}+0+0`),
      await grey(evidence, `${width}x${height}+${width}+0`),
      width,
      PIXEL_RISE,
    );
    console.log(JSON.stringify({ evidence, ...size }));
  }
}

if (import.meta.main) {
  const [first, ...rest] = Deno.args;
  if (first === "measure" && rest.length) await measureStrips(rest);
  else {
    const [outDir, region, ...weapons] = rest;
    if (!first || !outDir || !/^\d+x\d+\+\d+\+\d+$/.test(region ?? "") || weapons.length === 0) {
      throw new Error("usage: muzzleflash.ts <display> <outdir> <WxH+X+Y> <label>=<command>... | measure <strip>...");
    }
    await capture(first, outDir, region, weapons);
  }
}

Deno.test("measureFlash finds the flash centre, radius and reach beside a lit gun", async () => {
  const { assertEquals } = await import("@std/assert");
  const [width, height, radius, center] = [100, 100, 20, 40];
  const before = new Uint8Array(width * height).fill(20);
  const flash = before.map((level, pixel) => {
    const [x, y] = [pixel % width, Math.floor(pixel / width)];
    const distance = Math.hypot(x - center, y - center);
    const gun = x > center && x < 90 && y > center && y < 80 ? 100 : 0; // lit gun below and right of the muzzle
    return level + Math.max(gun, distance <= radius ? 230 - 9 * distance : 0);
  });
  flash[95 * width + 5] = 250; // a lone bright pixel elsewhere
  const size = measureFlash(before, flash, width, 32);
  assertEquals([size.centerX, size.centerY, size.x, size.y], [center, center, center - radius, center - radius]);
  assertEquals([Math.abs(size.radius - radius) <= 1, Math.abs(size.reach - radius) <= 1], [true, true]);
});

Deno.test("measureFlash reach gives an X the same size at any angle", async () => {
  const { assertEquals } = await import("@std/assert");
  const [width, arm, center] = [120, 40, 60];
  const reachAt = (degrees: number) => {
    const before = new Uint8Array(width * width);
    const flash = before.map((_, pixel) => {
      const [x, y] = [pixel % width - center, Math.floor(pixel / width) - center];
      const angle = Math.atan2(y, x) - degrees * Math.PI / 180;
      const offAxis = Math.min(...[0, 1, 2, 3].map((quarter) => Math.abs(Math.sin(angle - quarter * Math.PI / 2))));
      return Math.hypot(x, y) <= arm && offAxis * Math.hypot(x, y) <= 3 ? 250 - Math.hypot(x, y) : 0;
    });
    return measureFlash(before, flash, width, 32).reach;
  };
  [0, 20, 45, 70].forEach((degrees) => assertEquals(Math.abs(reachAt(degrees) - arm) <= 2, true, `${degrees} deg`));
});

Deno.test("quadrantCover tells a lit quadrant from a dark one", async () => {
  const { assertEquals } = await import("@std/assert");
  const width = 10;
  const before = new Uint8Array(width * width);
  const frame = before.map((_, pixel) => pixel % width <= 4 && Math.floor(pixel / width) <= 4 ? 100 : 0);
  const flash = { centerX: 4, centerY: 4, radius: 4 };
  assertEquals(quadrantCover(before, frame, width, flash, 32), 1);
  assertEquals(quadrantCover(before, before, width, flash, 32), 0);
});
