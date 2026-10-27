// Side-by-side comparison sheets of the CS 1.6 HUD (docs/hud.md, "Compared with CS 1.6"): Counter-Life on the left,
// CS 1.6 on the right, the same crop of both screenshots at 2x without smoothing, with a caption over each side.
// Usage: deno run -A tests/e2e/comparesheet.ts <WxH> <shots dir> <hud label> <elements label> <reference dir> <out dir>
// The shots come from just e2e-hud <port> <hud label>, just e2e-elements <port> <elements label>,
// just e2e-killfeed <port> weapon_m4a1 head and just e2e-hudproof; the references from .e2e/reference (the CS fixture).

export type Region = { x: number; y: number; width: number; height: number };
export type Sheet = { name: string; ours: string; cs: string; region: Region };

const ZOOM_PERCENT = 200;
const SCALE_BASE_HEIGHT = 480; // CS lays out the kill feed and the crosshair in units of a 480-line screen
const GAP_PX = 8;
const SHEET_COLOURS = 256;
const CAPTION_POINTS = 14;
const BACKGROUND = "#202020";
const CAPTION_COLOUR = "#e0e0e0";
const FONT = "DejaVu-Sans";
// The CS 1.6 screenshots of the reference state (health 100, armour 0, $800, USP 12 | 24), by screen size.
const HUD_REFERENCES: Record<string, string> = { "1600x900": "cs16-ref-hud.png", "2560x1440": "cs16-1440-hud.png" };
// The CS 1.6 weapon menu, against the native Sven menu that just e2e-hudproof opens with the slot key 2.
const MENU_REFERENCES: Record<string, string> = { "1600x900": "cs16-ref-weaponmenu.png" };
const MENU_REGION: Region = { x: 0, y: 0, width: 420, height: 180 };

// Every sheet of one screen size. Regions cover the CS parts with a margin: health and armour (W/5 plus the armour
// digits), money and ammo, the crosshair at its widest spread, the first kill-feed row and all four rows, and the
// weapon menu where a CS reference of it exists.
export function sheets(width: number, height: number, hudLabel: string, elementsLabel: string): Sheet[] {
  const size = `${width}x${height}`;
  const scaled = (units: number) => Math.floor(units * height / SCALE_BASE_HEIGHT);
  const half = scaled(45);
  const centre = { x: width / 2 - half, y: height / 2 - half, width: 2 * half, height: 2 * half };
  const feed = (rows: number) => ({
    x: width - scaled(200),
    y: scaled(24),
    width: scaled(200),
    height: scaled(16) * (rows + 1),
  });
  const reference = HUD_REFERENCES[size];
  const menu = MENU_REFERENCES[size];
  const elements = `${elementsLabel}-reference.png`;
  return [
    {
      name: "bottom-left",
      ours: elements,
      cs: reference,
      region: { x: 0, y: height - 60, width: width / 5 + 100, height: 60 },
    },
    {
      name: "bottom-right",
      ours: elements,
      cs: reference,
      region: { x: width - 200, y: height - 100, width: 200, height: 100 },
    },
    // The CS reference state has mp_flashlight 0 and no flashlight; the crosshair fixture runs with mp_flashlight 1.
    {
      name: "top-right-flashlight",
      ours: elements,
      cs: `cs16-crosshair-${size}-ak47-rest.png`,
      region: { x: width - 100, y: 0, width: 100, height: 70 },
    },
    { name: "crosshair-usp-rest", ours: elements, cs: reference, region: centre },
    {
      name: "crosshair-ak47-rest",
      ours: `${hudLabel}-crosshair-rest.png`,
      cs: `cs16-crosshair-${size}-ak47-rest.png`,
      region: centre,
    },
    {
      name: "crosshair-ak47-firing",
      ours: `${hudLabel}-crosshair-firing.png`,
      cs: `cs16-crosshair-${size}-ak47-firing.png`,
      region: centre,
    },
    {
      name: "killfeed-headshot",
      ours: "killfeed-weapon_m4a1-head.png",
      cs: `cs16-killfeed-${size}-headshot.png`,
      region: feed(1),
    },
    {
      name: "killfeed-stack4",
      ours: `${hudLabel}-killfeed-4-cs.png`, // cs16_killfeed_names 2: killer and victim names, as the CS rows
      cs: `cs16-killfeed-${size}-stack4.png`,
      region: feed(4),
    },
    ...(menu ? [{ name: "weapon-menu", ours: "hudproof-weapon-menu.png", cs: menu, region: MENU_REGION }] : []),
  ];
}

// ImageMagick arguments for one sheet: two captioned 2x crops side by side.
export function sheetArgs(oursPath: string, csPath: string, region: Region, out: string): string[] {
  const geometry = `${region.width}x${region.height}+${region.x}+${region.y}`;
  const side = (path: string, caption: string) => [
    "(",
    path,
    "+gravity", // settings outlive parentheses: the caption gravity of the first side would move the second crop
    "-crop",
    geometry,
    "+repage",
    "-scale",
    `${ZOOM_PERCENT}%`,
    "-gravity",
    "north",
    "-background",
    BACKGROUND,
    "-splice",
    `0x${2 * CAPTION_POINTS}`,
    "-font",
    FONT,
    "-pointsize",
    String(CAPTION_POINTS),
    "-fill",
    CAPTION_COLOUR,
    "-annotate",
    `+0+${CAPTION_POINTS / 2}`,
    caption,
    ")",
  ];
  return [
    ...side(oursPath, "Counter-Life"),
    ...side(csPath, "CS 1.6"),
    "-background",
    BACKGROUND,
    "+smush",
    String(GAP_PX),
    // 256 colours keep the sheets small for the docs; measure on the screenshots, not on the sheets.
    "+dither",
    "-colors",
    String(SHEET_COLOURS),
    "-strip",
    out,
  ];
}

if (import.meta.main) {
  const [size, shotsDir, hudLabel, elementsLabel, referenceDir, outDir] = Deno.args;
  if (!outDir) {
    console.error("usage: comparesheet.ts <WxH> <shots dir> <hud label> <elements label> <reference dir> <out dir>");
    Deno.exit(2);
  }
  const [width, height] = size.split("x").map(Number);
  await Deno.mkdir(outDir, { recursive: true });
  for (const sheet of sheets(width, height, hudLabel, elementsLabel)) {
    const out = `${outDir}/${size}-${sheet.name}.png`;
    const args = sheetArgs(`${shotsDir}/${sheet.ours}`, `${referenceDir}/${sheet.cs}`, sheet.region, out);
    const { success, stderr } = await new Deno.Command("magick", { args, stderr: "piped" }).output();
    if (!success) throw new Error(`${sheet.name}: ${new TextDecoder().decode(stderr)}`);
    console.log(JSON.stringify({ out, ...sheet }));
  }
}
