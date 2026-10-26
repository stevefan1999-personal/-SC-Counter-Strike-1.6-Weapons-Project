// Raw 8-bit RGB frames moved through ImageMagick, so the fixture scripts need no image library.
export type Frame = { width: number; height: number; rgb: Uint8Array };
export type Box = { left: number; top: number; right: number; bottom: number };

const CHANNELS = 3;

const run = async (command: string, args: string[], stdin?: Uint8Array): Promise<Uint8Array> => {
  const child = new Deno.Command(command, { args, stdin: stdin ? "piped" : "null", stdout: "piped", stderr: "piped" })
    .spawn();
  if (stdin) {
    const writer = child.stdin.getWriter();
    await writer.write(stdin);
    await writer.close();
  }
  const { code, stdout, stderr } = await child.output();
  if (code !== 0) throw new Error(`${command} ${args.join(" ")}: ${new TextDecoder().decode(stderr).trim()}`);
  return stdout;
};

export const grab = async (display: string, width: number, height: number): Promise<Frame> => ({
  width,
  height,
  rgb: await run("import", ["-display", display, "-window", "root", "-depth", "8", "rgb:-"]),
});

export const load = async (path: string): Promise<Frame> => {
  const [width, height] = new TextDecoder().decode(await run("magick", ["identify", "-format", "%w %h", path])).split(
    " ",
  ).map(Number);
  return { width, height, rgb: await run("magick", [path, "-depth", "8", "rgb:-"]) };
};

export const save = (frame: Frame, path: string): Promise<Uint8Array> =>
  run("magick", ["-size", `${frame.width}x${frame.height}`, "-depth", "8", "rgb:-", path], frame.rgb);

export const pixel = (frame: Frame, x: number, y: number): [number, number, number] => {
  const offset = (y * frame.width + x) * CHANNELS;
  return [frame.rgb[offset], frame.rgb[offset + 1], frame.rgb[offset + 2]];
};

// Largest per-channel change between two frames of the same view.
export const change = (before: Frame, after: Frame, x: number, y: number): number => {
  const offset = (y * before.width + x) * CHANNELS;
  return Math.max(
    Math.abs(before.rgb[offset] - after.rgb[offset]),
    Math.abs(before.rgb[offset + 1] - after.rgb[offset + 1]),
    Math.abs(before.rgb[offset + 2] - after.rgb[offset + 2]),
  );
};

// Every (x, y) of a box whose change between the frames exceeds the threshold.
export const changedPixels = (before: Frame, after: Frame, box: Box, threshold: number): { x: number; y: number }[] =>
  Array.from({ length: box.bottom - box.top }, (_, row) => box.top + row).flatMap((y) =>
    Array.from({ length: box.right - box.left }, (_, column) => box.left + column)
      .filter((x) => change(before, after, x, y) > threshold)
      .map((x) => ({ x, y }))
  );

// Split coordinates into [first, last] runs wherever consecutive values are more than `gap` apart.
export const runs = (values: number[], gap: number): [number, number][] =>
  [...new Set(values)].toSorted((a, b) => a - b).reduce<[number, number][]>((found, value) => {
    const last = found.at(-1);
    if (last && value - last[1] <= gap) last[1] = value;
    else found.push([value, value]);
    return found;
  }, []);
