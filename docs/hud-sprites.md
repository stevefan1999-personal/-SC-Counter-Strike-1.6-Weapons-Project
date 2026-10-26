# CS 1.6 HUD sprites (`sprites/cs16/hud/`)

`just install` runs `tools/hudgen.ts`. The tool reads `sprites/640hud7.spr` and `sprites/hud.txt` from `CSTRIKE_DIR` and
writes 14 sprites to `<addon>/sprites/cs16/hud/`. Git does not contain these sprites. The same input always gives the
same bytes.

Each sprite holds one HUD element (or one part of it) for every value, so a plugin shows a CS number with one
`HudCustomSprite` and one frame number. Armour and the flashlight are two elements each: their bright part overlaps the
base icon, and CS adds the two draws after the colour multiply (see
[How the frames are built](#how-the-frames-are-built)). This document is the contract for the AngelScript HUD.

## Index

`W` and `H` are the screen width and height. "Content" is the part of each frame that has the element. Send it as
`width` and `height` (see [Element parameters](#element-parameters)). The frames are larger (power of two, black outside
the content).

| File                       | Frames | Frame number                                                  | Content | Frame  | CS box (left, top)                                                                    | x, y to send                                           | Raw bytes | bzip2  |
| -------------------------- | ------ | ------------------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------- | ------ |
| `health.spr`               | 256    | health                                                        | 82×25   | 128×32 | (12, H−37)                                                                            | 12, −12                                                | 1,054,506 | 20,275 |
| `armor.spr`                | 256    | armour (vest)                                                 | 84×25   | 128×32 | (W/5, H−37)                                                                           | 0.2 (fraction), −12                                    | 1,054,506 | 20,682 |
| `armor_full.spr`           | 101    | min(armour, 100), vest                                        | 24×25   | 32×32  | (W/5, H−37)                                                                           | 0.2 (fraction), −12                                    | 106,254   | 5,887  |
| `armor_helmet.spr`         | 256    | armour (vest and helmet)                                      | 84×25   | 128×32 | (W/5, H−37)                                                                           | 0.2 (fraction), −12                                    | 1,054,506 | 20,717 |
| `armor_helmet_full.spr`    | 101    | min(armour, 100), helmet                                      | 24×25   | 32×32  | (W/5, H−37)                                                                           | 0.2 (fraction), −12                                    | 106,254   | 7,064  |
| `clip.spr`                 | 256    | clip                                                          | 72×25   | 128×32 | (W−184, H−37)                                                                         | −112, −12                                              | 1,054,506 | 20,268 |
| `reserve_lo.spr`           | 11     | reserve % 10; 10 = blank                                      | 20×25   | 32×32  | (W−62, H−37); no clip: (W−64, H−37)                                                   | −42 (−44), −12                                         | 12,294    | 3,406  |
| `money_hi.spr`             | 256    | money / 100                                                   | 78×25   | 128×32 | (W−134, H−75)                                                                         | −56, −50                                               | 1,054,506 | 20,506 |
| `two_cells.spr`            | 111    | two-cell group: reserve high cells, money and delta low cells | 40×25   | 64×32  | reserve (W−102, H−37), no clip (W−104, H−37); money (W−56, H−75); delta (W−56, H−112) | reserve −62 (−64), −12; money −16, −50; delta −16, −87 | 230,358   | 12,034 |
| `money_delta_plus_hi.spr`  | 256    | delta / 100, delta > 0                                        | 77×25   | 128×32 | (W−133, H−112)                                                                        | −56, −87                                               | 1,054,506 | 20,370 |
| `money_delta_minus_hi.spr` | 256    | −delta / 100, delta < 0                                       | 73×25   | 128×32 | (W−129, H−112)                                                                        | −56, −87                                               | 1,054,506 | 20,656 |
| `flashlight.spr`           | 2      | on ? 1 : 0                                                    | 48×32   | 64×32  | (W−48, 16)                                                                            | 1.0 (fraction), 16                                     | 4,946     | 1,397  |
| `flashlight_energy.spr`    | 101    | battery %                                                     | 48×32   | 64×32  | (W−48, 16)                                                                            | 1.0 (fraction), 16                                     | 209,678   | 5,555  |
| `fill.spr`                 | 1      | 0                                                             | 64×64   | 64×64  | any rect up to 64×64 (crosshair lines, radar dots); longer bars need more elements    | –                                                      | 4,926     | 596    |

`two_cells.spr` serves three elements: the first two cells of the reserve and the last two cells of money and of the
delta row. They show the same frames, so separate files would be byte-identical downloads and textures.

Totals: 8,056,252 bytes raw, 179,413 bytes with `bzip2 -9`. The server can compress in-game downloads with bzip2
(`sv_filetransfercompression`, `engine_i686.so` "Creating compressed version of file %s"). An HTTP download
(`sv_downloadurl`) sends the raw files.

## Frame numbers

All divisions are integer divisions. Values outside the range are clamped, as CS sends health, armour and ammo in bytes.

```text
health       frame  = clamp(health, 0, 255)                               health.spr
armour       frame  = clamp(armour, 0, 255)                               armor.spr, or armor_helmet.spr with a helmet
             full   = clamp(armour, 0, 100)                               armor_full.spr or armor_helmet_full.spr
clip         frame  = clamp(clip, 0, 255)                                 clip.spr, only for weapons with a clip
reserve      R      = clamp(reserve, 0, 255)
             hi     = R >= 100 ? R / 10 : (R >= 10 ? 100 + R / 10 : 110)  two_cells.spr
             lo     = R % 10                                              reserve_lo.spr
money        M      = clamp(money, 0, 25599)
             hi     = M / 100                                             money_hi.spr
             lo     = M >= 10 ? M % 100 : 100 + M                         two_cells.spr
money delta  D      = clamp(abs(delta), 0, 25599)
             hi     = D / 100                                             money_delta_plus_hi.spr if delta > 0,
                                                                          money_delta_minus_hi.spr if delta < 0
             lo     = D >= 10 ? D % 100 : 100 + D                         two_cells.spr
flashlight   frame  = on ? 1 : 0                                          flashlight.spr
             energy = clamp(battery, 0, 100)                              flashlight_energy.spr
```

`tools/hudgen_test.ts` checks that these formulas give the cells that CS draws, for every money value from 0 to 25599
and every reserve value from 0 to 255.

## Element parameters

Set these `HUDSpriteParams` fields for every element:

| Field             | Value                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spritename`      | `cs16/hud/<file>`. Precache `sprites/cs16/hud/<file>` with `g_Game.PrecacheGeneric`, as `scripts/cs16/killfeed.as` does for its sheets.                                                                                 |
| `left`, `top`     | 0                                                                                                                                                                                                                       |
| `width`, `height` | The content size from the index. Do not send 0: 0 means "to the edge of the frame" (`CHud::FixupSpriteRect`, client.so 0xD5002), which adds the black padding and moves right-anchored elements.                        |
| `frame`           | The frame number. Keep `numframes` at 1 or `framerate` at 0. The client adds `int(framerate * t) % numframes` only when `numframes > 1` and `framerate > 0` (client.so 0xB495A).                                        |
| `flags`           | `HUD_ELEM_ABSOLUTE_X`, `HUD_ELEM_ABSOLUTE_Y`, `HUD_ELEM_NO_BORDER`. Armour and flashlight: no `HUD_ELEM_ABSOLUTE_X` (x is a fraction). Do not set `HUD_SPR_OPAQUE` or `HUD_SPR_MASKED`.                                 |
| `color1`          | The CS colour scaled by the CS alpha, with A = 255. Example: HUD orange (255,160,0) at alpha 100 is (100,62,0,255). The frames are grey, so the screen gets texel × colour / 255, as in CS.                             |
| two-part elements | Armour (`armor*.spr` + `armor*_full.spr`) and flashlight (`flashlight.spr` + `flashlight_energy.spr`) use two channels with the same x, y, flags, colours and effect, sent together so that their fades start together. |

How x and y become pixels (`CHud::CalcHudPos`, client.so 0xDB324, `docs/research/sven-client-hud.md` 1.5), with
`NO_BORDER`, `S` = screen size and `s` = `width` or `height`:

- absolute, v ≥ 0: the left (top) edge is at v.
- absolute, v < 0: the left (top) edge is at S + v − s. So "x, y to send" is `s − distance from the right (bottom)`.
- fraction: the left edge is at `int(v * S)`, then moved so that the element ends at S or before. Armour uses 0.2
  (`W/5`). The flashlight ends at the right edge, which the absolute mode cannot express (v would be 0, which is the
  left edge), so it uses 1.0: the clamp puts its left edge at `W − 48`.

## What each frame contains

Each frame is the sum of these CS 1.6 parts, at the offsets that CS uses between the parts of one element. The rects are
the `hud.txt` rects of `640hud7.spr`. Cells are 20×25, as `number_0`.

| File                                      | Parts (x, y in the frame)                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.spr`                              | `cross` (48,25,24,24) at (0,0). Three cells at x 22, 42, 62. CS: cross at x 12, digits from x 34 (crossW + dw/2).                                                           |
| `armor.spr`, `armor_helmet.spr`           | `suit_empty` (24,25) or `suithelmet_empty` (24,124) at (0,0). Three cells at x 24, 44, 64.                                                                                  |
| `armor_full.spr`, `armor_helmet_full.spr` | Frame v: rows `off`…23 of `suit_full` (0,25) or `suithelmet_full` (0,124) at y = `off`, `off = (int)(24 * (100 − v) / 100)`. Frame 0 is empty.                              |
| `clip.spr`                                | Three cells at x 0, 20, 40. A white 2×25 bar at x 70 (CS `FillRGBA`, dw/10 wide, dw/2 after the digits).                                                                    |
| `two_cells.spr`                           | Two-cell group: frame f = 0…99 draws both digits of f (also a tens 0), f = 100…109 draws a blank cell and the digit f − 100, f = 110 draws nothing.                         |
| `reserve_lo.spr`                          | Frame d = 0…9: the digit d. Frame 10: nothing.                                                                                                                              |
| `money_hi.spr`                            | `dollar` (192,25,18,25) at (0,0). Cells at x 18, 38, 58: the first three cells of the `"%5i"` field of `100 × frame` (blank before the first digit, all blank for frame 0). |
| `money_delta_plus_hi.spr`                 | `plus` (223,25,17,23) at (0,0), cells at x 17, 37, 57, as `money_hi.spr`.                                                                                                   |
| `money_delta_minus_hi.spr`                | `minus` (210,25,13,23) at (0,0), cells at x 13, 33, 53, as `money_hi.spr`.                                                                                                  |
| `flashlight.spr`                          | `flash_empty` (112,25,32,32) at (0,0). `flash_beam` (144,25,16,32) at x 32 in frame 1.                                                                                      |
| `flashlight_energy.spr`                   | Frame b: `flash_full` (160,25,32,32) without its left `off = (int)((1 − b/100) * 32)` columns, at x = `off`. Frame 0 is empty.                                              |
| `fill.spr`                                | 64×64 white. Send a sub-rect (`left`, `top`, `width`, `height`) inside it: Sven cuts a larger rect at the frame edge.                                                       |

Digit rects (x, 0, 20, 25): x = 0, 23, 47, 70, 95, 119, 144, 169, 192, 216 for 0…9. The tool reads every rect from
`cstrike/sprites/hud.txt` by name; `tools/hudgen_test.ts` checks them against this table.

## How the frames are built

1. **Valve's sprite drawing.** Valve's engine draws a sprite rect with texture coordinates moved half a texel inwards
   (`AdjustSubRect`, Half-Life `hw.so` 0x14a820, constant 0.5 at 0x248810), puts the quad at `x + 0.5`, `y + 0.5`
   (`Draw_Frame`, 0x14a900) and filters bilinearly. Thus pixel k of a w-wide rect shows texel `k * (w − 1) / w`, and
   every CS glyph looks a little wider and softer than its texels. Sven's engine draws a rect 1:1 (`AdjustSubRect`, Sven
   `hw.so` 0x127AA0, no 0.5; `Draw_SpriteFrame` 0x127B70). So `hudgen` draws each part the way Valve's engine does, and
   Sven then shows the frame 1:1. Each part is drawn with its own rect, as CS does (a cropped armour or flashlight part
   has its own, smaller rect).
2. **Additive sum, never above white.** CS draws every part with `SPR_DrawAdditive` (the bar with an additive
   `FillRGBA`). The palette of `640hud7.spr` is the grey ramp (index i = (i,i,i)), so the tool adds palette indices. The
   tool stops if the palette is not the grey ramp. All files use that palette. CS multiplies each part by the HUD colour
   before the framebuffer adds the parts (`battery.cpp`, client.so 0xa4c24–0xa4cca; `flashlight.cpp`, 0xa7eae–0xa7f7d).
   One frame is multiplied after its parts were added, so a sum above 255 would be clipped before the colour multiply.
   The full armour icon overlaps the empty icon above white (75 pixels for the vest, 113 for the helmet), and the
   flashlight energy overlaps the casing (176 pixels), `docs/research/cs16-hud-spec.md` A.5. Merged, these pixels showed
   up to 85 levels darker than CS at the settled alpha 100 (red 100 instead of 185). Thus they are separate sprites in
   the same box, and the tool stops if any frame sums above 255.
3. **Power-of-two frames.** Sven resamples a texture to powers of two unless the player sets `gl_npot 1` (`gl_npot`
   default "0", Sven `hw.so` 0x128210, 0x1290F0), which blurs the digits. So each frame is a power of two, with the
   content at the top-left and black (which adds nothing) around it.
4. **Header.** Additive texture format, type and sync type of `640hud7.spr`, single frames only (a HUD draw shows no
   frame of a frame group: Sven `hw.so` 0x120390), origin (0, 0). The HUD draw does not use the origin (Sven `hw.so`
   0x127B70 reads only the width, height and texture), so the frame's top-left is the element's top-left.

## Evidence

`just hud-sheet <CS screenshot>` writes [`hud-sprites/contact-sheet.png`](hud-sprites/contact-sheet.png). Its first two
rows put crops of a CS 1.6 screenshot (1600×900, `.e2e/reference/cs16-ref-hud.png`) next to the same values from
`hudgen`, tinted (100,62,0) (HUD orange at alpha 100). The other rows show sample frames in full HUD orange.

The recipe also compares each crop with the frames. The HUD tint adds no blue, so the blue channel predicts the
background red. The red that is left must be `100 × texel / 255`. RMS of the difference, in levels of 255:

| Element (CS box)          | In place | Smallest value at a 1 px shift |
| ------------------------- | -------- | ------------------------------ |
| health 100 (12, 863)      | 4.5      | 24.5                           |
| armour 0 (320, 863)       | 7.3      | 22.7                           |
| ammo 12 \| 24 (1416, 863) | 5.4      | 24.4                           |
| money $800 (1466, 825)    | 6.1      | 23.5                           |

With plain copies of the texels (no step 1), the RMS in place is 25–31 for the same crops.

A review fitted the drawing model on 20 element crops from 7 CS screenshots in `.e2e/reference` (1600×900 and 2560×1440;
alpha 100 to about 235; orange and green money; the `+300` delta row), with a free colour scale and the blue channel as
the background predictor. RMS in place: 2.9–8.6 with step 1, 15–46 for plain copies, and 11–34 if the quad is not moved
by 0.5. Every 1 px shift of step 1 gives 14.6 or more.

`deno test -R -E tools/` checks:

- `640hud7.spr` decodes, encodes to the same bytes and decodes to the same sprite.
- The `hud.txt` rects are the rects of this document.
- Every frame of every file, pixel by pixel, against an independent statement of the tables above. The statement does
  not clamp, so a frame whose parts add up above white fails (step 2).
- The frame-number formulas, as described in [Frame numbers](#frame-numbers).
- The SHA-1 of every generated file (see [Changes](#changes)).

## Limits and costs

- HUD sprite paths: 14 of the 256 that the engine allows (`SPR_Load`).
- Textures: each frame is one GL texture, 2,220 in total. Sven keeps its textures in a growing list (`hw.so` 0x12B8C0)
  and has no fixed count. When all files are loaded, they use 30.5 MiB of texture memory (RGBA8).
- `left` and `top` are bytes and `frame` is a byte. All values in this document fit.

## Changes

A client does not download a file again when it already has a file with that path. If the output of `hudgen` changes,
write the files to a new directory (for example `sprites/cs16/hud2/`) and change the plugin to that directory.
`tools/hudgen_test.ts` pins the SHA-1 of every file that clients get from `sprites/cs16/hud/`, so a changed byte fails
the test until the directory moves and the hashes are updated.

## Reproduce

```sh
deno test -R -E tools/                                     # writer, rects, every frame, frame numbers
SVEN_SERVER_DIR=/abs/sandbox just install                  # writes <addon>/sprites/cs16/hud/*.spr
just hud-sheet /abs/path/cs16-ref-hud.png                  # contact sheet and the screenshot check
deno run -R tools/spr.ts <addon>/sprites/cs16/hud/health.spr | jq .header
```
