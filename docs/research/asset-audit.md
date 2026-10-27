# Asset audit: why the CS 1.6 weapons look wrong in Sven Co-op

Status: static audit of branch `feat/asset-audit` (base `ed52216`). No game was started.

Review: a second agent re-derived the claims from the binaries, the sources and the installs (see "Review record"). Text
that the review changed starts with **Corrected:** or **Added:**. Claims that the review could not check carry
**UNVERIFIED**.

Targets: Sven Co-op 5.26 Linux client (`svencoop/cl_dlls/client.so` SHA-1 `aa7c4362…`, `hw.so` SHA-1 `41958792…`) and
the Counter-Strike 1.6 install (`Half-Life/cstrike`). IDA addresses refer to those two files, except where the text
names Valve's `Half-Life/hw.so` (SHA-1 `7f129253…`, the CS 1.6 engine; it keeps its local symbols).

## Result

The weapon models are not broken. Their textures are pixel-identical to CS 1.6, their animations match CS frame by
frame, and they are mirrored so that Sven draws them right-handed, as CS does. The visible defects come from sprites,
from how the Sven client draws them and (**Added:**) from how Sven reads FOV values:

| Rank | Defect                                                                                                                                                                                  | Where it shows                                                                               | Status                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1    | The kill feed drew a 64×176 slice of `640hud1.spr` (a column of 13 icons) instead of one kill icon                                                                                      | Top right, on every player or monster kill (`cs16_register.as:52-53`)                        | Fixed, `95ae240`                           |
| 2    | 15 view models fire Sven's Half-Life muzzle flash sprite, not the CS 1.6 one                                                                                                            | Every shot of all pistols, M3, XM1014, MAC-10, MP5, TMP, UMP45, AWP, Scout and silenced M4A1 | Fixed, [muzzle-flash.md](muzzle-flash.md)  |
| 3    | The crosshair is a static red cross, not the dynamic green CS crosshair; its rect lay outside the sprite                                                                                | Screen centre, always                                                                        | Rect fixed, `584b15d`; look needs HUD work |
| 4    | The selection icons of seven weapons are restyled and do not match CS 1.6                                                                                                               | Weapon selection                                                                             | Not fixed: design choice                   |
| 5    | Dropped weapons are drawn 1.0–1.6× larger than in CS 1.6                                                                                                                                | World models                                                                                 | Not fixed: design choice                   |
| 6    | **Corrected:** Sven reads every FOV as a vertical angle. Its default 70° is below CS's 73.7° vertical, so view models look about 7% larger; every scope zoom shows 4/3 as much as in CS | View models, scoped views                                                                    | Fixed, [fov.md](../fov.md)                 |
| 7    | **Added:** `HudNumDisplay` draws Sven's own 20×20 digits; CS uses 20×25 digits from its own `640hud7.spr`                                                                               | Money display (`BuyMenu.as:100-128`) and any numeric or time display                         | Not fixed: needs HUD work                  |
| 8    | **Added:** the kill feed still shows at most one name per row, uses a 640×480 layout, and shares sprite channel 4 with the C4 icon                                                      | Top right; C4 icon                                                                           | Not fixed                                  |

Evidence for each claim is below. `report.md` means [`docs/research/asset-audit/report.md`](asset-audit/report.md), the
output of `tools/audit.ts`.

## 1. Kill feed draws part of the sprite sheet (fixed)

- Before the fix, `scripts/cs16/killfeed.as:325-326` sent the kill icon with `wp.width = 0` and `wp.height = 0`
  (`git show ed52216:scripts/cs16/killfeed.as`). The left and top offsets came from the `hud.txt` table, for example
  `d_ak47` = 640hud1 192 80 48 16 (`killfeed.as:50`).
- The Sven client reads the rect as right = left + width and bottom = top + height (`READ_SPRRECT`, client.so 0xd83d2,
  called from the `CustSpr` handler 0xd8a20).
- `CHudCustomSprite::Start` (client.so 0xb48ee) then calls `CHud::FixupSpriteRect` (client.so 0xd5002). When right −
  left ≤ 0 it sets right to the sprite width; when bottom − top ≤ 0 it sets bottom to the sprite height. It does not add
  the offset. `CHud::DrawHudSprite` (client.so 0xda9ce) passes this rect unchanged to `SPR_DrawAdditive`.
- Result for an AK-47 kill: the rect (192, 80)–(256, 256) of `640hud1.spr`. The left half of
  [`killfeed-ak47-before-after.png`](asset-audit/killfeed-ak47-before-after.png) shows that slice; the right half shows
  the intended 48×16 icon.
- The API documentation says "0: auto; use total width of the sprite" (`sven-coop.github.io/outputdocs.txt:2223-2229`).
  That is true only for a zero offset.
- The fix sends `wf.width` and `wf.height`, as the headshot sprite already does with 36×16 (`killfeed.as:342-343`).
  `report.md` section "HUD sprite rects with a zero width or height" now lists none.
- The icon table itself is correct: all 30 `d_*` rects in `killfeed.as:49-80` equal the 640 entries of
  `cstrike/sprites/hud.txt` (for example `hud.txt:151` d_ak47, `hud.txt:179` d_headshot; command in "Reproduce").
- **Added:** the draw mode comes from the flags. `CHudCustomSprite::Start` selects `SPR_Draw` for `HUD_SPR_OPAQUE`
  (0x10000), `SPR_DrawHoles` for `HUD_SPR_MASKED` (0x20000) and `SPR_DrawAdditive` otherwise (client.so 0xb4918). The
  kill feed sends flags 0, so it draws additive, as CS does. The icon colour 255 80 0 equals CS
  (`cs16-client/cl_dll/death.cpp:129`).

**Added:** the kill feed is still wrong after `95ae240`:

- At most one name shows on each row. The victim name goes to text channel `ch` (1–4) and the killer name to `ch + 8`
  (`killfeed.as:351`, `:368`). Sven's engine keeps 8 text slots, takes the channel modulo 8 and keeps one 512-byte text
  buffer for each slot (hw.so 0x11c860, 0x11c94c). So channel `ch + 8` lands in the slot of channel `ch`, and the killer
  text replaces the victim text. If the server drops channels above 4 (the API documents 1–4,
  `outputdocs.txt:2286-2287`), the killer name never shows. Which of the two happens is UNVERIFIED (server.so was not
  checked). Both are wrong: CS draws both names.
- The layout only fits a 640×480 screen. The script reserves `width / 640` of the screen for an icon and 0.013 of the
  screen for each character, and steps rows by `20 / 480` (`killfeed.as:284-314`). The client multiplies a fractional x
  by the screen width minus 2 × `hud_bordersize`, and a negative x anchors the right edge of the element (client.so
  0xdb324). Sprites draw at their pixel size. At 1920×1080 a 48-pixel icon gets a 142-pixel slot, and rows are about 44
  pixels apart. CS places the feed in pixels: x from the right screen edge by the measured name widths, y =
  `YRES(32) + 2 + 20 × row` (`cs16-client/cl_dll/death.cpp:107-121`). `HUD_ELEM_ABSOLUTE_X` (1) gives pixel positions
  from the right edge when x is negative (client.so 0xdb324). The server cannot measure the client's text width.
- The C4 icon uses custom-sprite channel 4 (`weapon_c4.as:131`), which is also the fourth kill-feed icon channel
  (`killfeed.as:225`, channels 1–4; headshots use 5–8). The client keeps one element for each channel and replaces it
  when a new message arrives on that channel (client.so 0xd893a). With four kill notices on screen, the two icons
  replace each other.

## 2. Muzzle flashes use Sven's Half-Life sprite (fixed)

Fixed on `feat/cs-muzzle-flash`: all 24 firearms now fire event 5005 with the CS 1.6 sprite and size. Method, sizes and
the in-game comparison: [muzzle-flash.md](muzzle-flash.md). The audit text below is the state before the fix.

- Sven's `HUD_StudioEvent` (client.so 0xb62a4) sends events 5001/5011/5021/5031 to the engine's `R_MuzzleFlash` (efx API
  slot 19, `cs16-client/common/r_efx.h:143`) with attachment 0/1/2/3. Events 5005/5006 instead read a muzzle flash
  description from `events/<options>`.
- `R_MuzzleFlash` (hw.so 0x11c520) draws `sprites/muzzleflash{type % 10 % 3 + 1}.spr` at scale `(type / 10) × 0.1`
  (**Corrected:** 0.5 when `type < 10`), additive, with a random frame and a random roll. The engine loads these three
  files once, by relative path through the `GAME` search path (hw.so 0x1184e0).
- CS 1.6 uses the same engine call (`cs16-client/cl_dll/entity.cpp:345-360`), so CS draws
  `cstrike/sprites/muzzleflash2.spr`. In Sven the same path resolves to `svencoop/sprites/muzzleflash2.spr`, which is
  byte-identical to Half-Life's `valve/sprites/muzzleflash2.spr` (`report.md:1380-1409`, column "vs CS 1.6").
- The two sprites look different: CS uses a soft 3-frame fireball, Sven/HL a 2-frame star burst
  ([`muzzleflash2-cs-top-sven-bottom.png`](asset-audit/muzzleflash2-cs-top-sven-bottom.png)).
- Affected view models and events (`report.md` muzzle table): Desert Eagle 5001 21, Glock 18 5001 21, Dual Elites
  5001/5011 11, Five-SeveN 5001 11, P228 5001 11, USP 5001/5021 11, M4A1 silenced 5021 11, M3 5001 21, XM1014 5001 21,
  MAC-10 5001 11, MP5 5001 11, TMP 5001 11, UMP45 5001 11, AWP 5001 31, Scout 5001 21.
- The port already solved this for 10 weapons (AK-47, AUG, FAMAS, Galil, unsilenced M4A1, SG552, G3SG1, SG550, P90,
  M249): their events are 5005 `cs16_flashx.txt` (`events/cs16_flashx.txt:3` → `sprites/cs16/csflashx.spr`), and
  `csflashx.spr` is a byte copy of `cstrike/sprites/muzzleflash3.spr` (`report.md:778`).
- **Added:** in CS these 10 weapons fire type 22 (muzzleflash3, scale 0.2), except the P90, which fires type 12 (scale
  0.1) (`deno run -R tools/mdl.ts cstrike/models/v_p90.mdl`). The port gives all 10 the same `cs16_flashx.txt`, so the
  P90 flash is twice as large, relative to the rifles, as in CS. Sven's `muzzleflash1.spr` and `muzzleflash3.spr` are
  also HL's files, not CS's (SHA-1 compare), so no `5001` type is safe.
- A server cannot replace a file in the client's `svencoop/` directory: the engine adds `svencoop` to the `GAME` search
  path before `svencoop_downloads` (hw.so 0x71567, then 0x715bd). A downloaded CS `sprites/muzzleflash2.spr` would never
  be read.

Recommended fix (needs a binary edit of 15 view models, so this audit did not apply it):

1. Add `sprites/muzzleflash2.spr` to `cstrike-assets.txt`, so that `just install` copies it to
   `sprites/cs16/muzzleflash2.spr`, and precache it in `CommonSpritePrecache` (`base.as:248`).
2. Add event files such as `events/cs16_flash2_a0.txt` with `attachment 0` and
   `spritename sprites/cs16/muzzleflash2.spr`. **Corrected:** one file for each attachment and size that the models use,
   not one for each attachment: attachment 0 with types 11, 21 and 31 (scales 0.1, 0.2, 0.3), attachment 1 with type 11
   (Elites `5011`), attachment 2 with type 11 (USP and silenced M4A1 `5021`). **Added:** precache each new file with
   `g_Game.PrecacheGeneric` and list it in `cs16_resources.res`, as `base.as:252` and `cs16_resources.res:1` do for
   `cs16_flashx.txt`; otherwise clients do not download it. Give the P90 its own file at half the rifle size.
3. Patch each 76-byte event record in place: event 5001/5011/5021 → 5005, options → the event file name. The record
   layout is `mstudioevent_t` (frame, event at +4, options[64] at +12; `tools/mdl.ts` SIZE.event). No geometry changes.
4. Calibrate `scale` in game: `R_MuzzleFlash` scales by 0.1–0.3, while `cs16_flashx.txt` uses `scale 6`. **Added:** Sven
   reads `scale` with `strtol` into one byte (client.so 0xedab2; key table at client.so 0x61ebc0), so only whole numbers
   0–255 work. Sven's own effect code draws the 5005 sprite (client.so 0xef8ce, cases 7 and 8), not `R_MuzzleFlash`, so
   the size, frame choice and rotation can differ from CS even with the CS sprite (UNVERIFIED in game).
5. Ship the patched models under new file names. Clients keep files that they downloaded before and do not download them
   again (see "Client download cache").

## 3. Crosshair (rect fixed, look not fixed)

- `sprites/cs16/crosshairs.spr` is a custom 256×256 alpha-test sprite. Only 24 pixels are visible, palette index 224 =
  #ff0000; all other pixels are index 255, which alpha-test drops
  (`deno run -R tools/spr.ts sprites/cs16/crosshairs.spr`; [`crosshairs.png`](asset-audit/crosshairs.png)). It is not
  the HL `crosshairs.spr` (128×128, `report.md:776`).
- CS 1.6 does not use a crosshair sprite for its weapons. It draws a dynamic crosshair, green by default
  (`cs16-client/cl_dll/ammo.cpp:283` `cl_crosshair_color "50 250 50"`, `ammo.cpp:1524` `DrawCrosshair(weaponId)`). To
  look like CS, the HUD work must draw that crosshair. **Corrected:** more exactly, at FOV 90 CS hides the list's
  crosshair sprite (`ammo.cpp:632-639`); it draws the list's `zoom` sprite only at FOV 40 or less
  (`ammo.cpp:1053-1068`).
- 22 weapon lists asked for rect `256 0 256 256`, which lies wholly outside the 256-pixel-wide sprite. The engine
  ignores an empty sub-rect and draws the whole frame (`AdjustSubRect`, hw.so 0x127aa0), and `CHudCrosshair::Draw`
  (client.so 0xb46ee) centres the drawing by the rect size (512 − 256)/2 = 128. So the crosshair appeared only by
  accident. Commit `584b15d` changes the rect to `0 0 256 256`, which gives the same picture with a valid rect.
- The sniper lists use `0 0 1 1` for `crosshair` and `zoom`. Pixel (0,0) is index 255 (`report.md:780`), so no crosshair
  shows, as in CS. **Corrected:** this matches CS only without zoom: CS draws no crosshair for the AWP, Scout, SG550 and
  G3SG1 (`ammo.cpp:1611-1615`). With zoom, CS draws its scope from the list's `zoom` entry (`sniper_scope 0 0 256 256`
  in `cstrike/sprites/weapon_awp.txt`); the port draws `wpn/scope.mdl` as a view model instead.

## 4. Weapon-selection icons

- Every `weapon_*.txt` names a sprite that exists, has as many entries as it declares, and (after `584b15d`) keeps every
  rect inside its sprite (`report.md:782-977`; no `OUTSIDE`, `MISSING` or `MISMATCH`).
- Sven reads only the 640 entries (`GetSpriteList`, client.so 0x9ea50, compares `iRes` with 640; the loader is client.so
  0xa2522, path `sprites/%s/%s.txt`). The port's lists contain only 640 entries.
- All 27 `weapon` and `weapon_s` rects show the intended weapon: [`hud-icons.png`](asset-audit/hud-icons.png) puts each
  crop next to the CS 1.6 icon (columns: ours/CS `weapon`, ours/CS `weapon_s`, ours/CS `ammo`). The pixel match picks
  the same weapon for 53 of 54 crops; the exception is the restyled Five-SeveN `weapon` icon, which is closest to the
  Glock icon (`report.md:836`).
- `ammo` rects equal the CS rects in the byte-identical `640hud7.spr` (mean |Δ| 0; `report.md:775`).
- Restyled icons (mean |Δ| per channel against CS, 0-255): Dual Elites 50.9/55.4, Galil 28.0/38.9, Famas 22.2/33.8,
  Five-SeveN 24.6/23.9, UMP45 14.5/21.6, M249 `weapon_s` 28.9, TMP `weapon_s` 15.7 (`report.md` per-list sections). The
  other icons differ by 0.7–9.7; the history of `cs1024.spr` records label re-alignment and glow edits (`5e18999`,
  `5f97489`, `a662e40`).
- To match CS exactly, import CS's own `640hud10`–`640hud18.spr` through `cstrike-assets.txt` and copy the CS rects from
  `cstrike/sprites/weapon_*.txt`. That is a design choice for the HUD work, so this audit did not do it.
- Note for HUD work: `HUDSpriteParams.left` and `top` are `uint8` (`outputdocs.txt:2233-2239`). `HudCustomSprite` cannot
  address the `cs1024.spr` icons beyond x/y 255; the 256×256 CS sheets fit. **Added:** the client also reads left and
  top as bytes and width and height as 16-bit words (`READ_SPRRECT`, client.so 0xd83d2).
- **Added:** `HudNumDisplay` and `HudTimeDisplay` draw only their icon from `spritename`. They draw the digits from the
  client's own `number_0`…`number_9` rects (client.so 0xdbcae reads gHUD's rect table). Sven's `hud.txt` puts 20×20
  digits on a 20-pixel grid of Sven's own `640hud7.spr`. CS puts 20×25 digits at x = 0, 23, 47, 70, 95, 119, 144, 169,
  192 and 216 of a different `640hud7.spr` (`cstrike/sprites/hud.txt`; the two sheets have different SHA-1s). So the
  money display (`BuyMenu.as:100-128`) shows Sven digits next to the CS dollar icon. To get CS digits, draw each digit
  with `HudCustomSprite` from `sprites/cs16/640hud7.spr` with the CS `number_N` rects.
- **Added:** channel budget. The client keeps one custom element for each channel 0–31, whatever its type. A message for
  a channel replaces the element on it, and an element of another type is deleted first (client.so 0xd893a). The API
  allows channels 0–15 for each module type; how the server maps them to the 32 client channels is UNVERIFIED. A CS HUD
  drawn digit by digit needs more than 16 sprites (health, armour, money, ammo and timer).
- **Added:** colour. The money display and the C4 icon use `RGBA_SVENCOOP` (`BuyMenu.as:111`, `weapon_c4.as:141`). CS
  draws its HUD in 255 160 0 (`cs16-client/cl_dll/hud.h:24`, `hud_redraw.cpp:174`).
- **Added:** a `spritename` without `.spr` names an entry of Sven's own `hud.txt`; with a zero rect the client then
  takes the rect from that entry (client.so 0xdbb60). Use full `cs16/….spr` paths for CS art.

## 5. Dropped weapons are scaled up

- `WeaponBase::CommonSpawn` sets `pev.scale = 1.4` (`scripts/cs16/base.as:243`); weapons override it, for example
  `weapon_ak47.as:89` 1.2 and `weapon_csdeagle.as:91` 1.6. Ammo boxes start at 1.5 (`base.as:1089`), but most of them
  override it (**Corrected**, next bullet).
- **Corrected:** the overrides run after `CommonSpawn`, so they apply. Weapons: 1.0 (FAMAS, Galil, MAC-10, C4, HE
  grenade), 1.1 (MP5), 1.15 (XM1014, Scout), 1.2 (AK-47, P90), 1.3 (AUG, M4A1, SG552, G3SG1), 1.6 (Desert Eagle); the
  other 12 keep 1.4. Ammo: 21 of the 24 magazine classes set their own scale after `CommonSpawn`: 0.7 (M3, XM1014), 1.0
  (13 classes), 1.1 (FAMAS, Galil, AWP, Scout), 1.2 (MP5, TMP). Only the Glock 18, USP and M249 magazines keep 1.5.
  `mags.mdl` has no CS twin, so the ammo scale is a look choice, not a parity defect. (Command in "Reproduce".)
- CS 1.6 does not scale weapon world models: `ReGameDLL_CS/regamedll/dlls/wpn_shared/wpn_ak47.cpp:5-13` only sets the
  model, and no file in `wpn_shared/` sets a scale.
- For CS parity set the scales to 1. The upstream project chose larger pickups on purpose, so this audit did not change
  them.

## 6. Field of view: view models and zoom

**Added:** Status: fixed on branch `feat/cs-fov`; [Field of view](../fov.md) has the method and the measurements. The
measurements confirm this section: before the fix Sven's normal view had a 7.1 % larger focal length than CS and every
zoom 25 % less (AWP second zoom 50 % less). The fix sends the vertical equivalents (74, 43, 31, 11). Two findings change
the proposal below: the AWP's 8 is not possible, because Sven's engine clamps the view to 10°–150° (`hw.so` 0x136580),
and the scope view model needed new sequences, because its size depends on the FOV.

- Sven's `liblist.gam:17` sets `vertical_fov "1"` (**Corrected:** the renderer's flag is stored by hw.so 0x8d350 at
  0x8db71; 0x8ccb0, named before, also reads the key but nothing calls it) and its client registers `default_fov "70"`
  (client.so 0xd6a7b in `CHud::Init`). CS 1.6 uses `default_fov 90` (`cs16-client/cl_dll/hud.cpp:339`), which is 73.7°
  vertical at 4:3.
- **Added:** with the flag set, Sven's projection (hw.so 0x139ec0, called from `R_SetupGL` 0x13a880) and frustum
  (0x139040) use the FOV as the vertical angle. So 70 is vertical; this is no longer an inference. The local configs
  agree: `svencoop/config.cfg:121` `default_fov "70"`, `cstrike/config.cfg:118` `default_fov "90"`.
- The engine draws view models with the world FOV unless `viewmodel_fov` > 0 (hw.so 0x13a2e0; the cvar at hw.so 0x2f1b54
  defaults to "0").
- **Added:** CS keeps 73.7° vertical on wide screens too. Valve's `R_SetupGL` (`Half-Life/hw.so` 0x16ead0) widens the
  horizontal FOV by aspect × 0.75 when `gl_widescreen_yfov` is not 0 and the aspect is above 1.5 (0x16f050), then
  `CalcFov` (0x16ea00) gives the vertical angle of the 4:3 view. `cstrike/config.cfg:145` has `gl_widescreen_yfov "1"`.
  Valve's `R_DrawViewModel` (0x16da90) changes only the depth range, so CS also draws view models with the world FOV.
  Valve's engine has no `vertical_fov` or `viewmodel_fov`.
- So, at 4:3 and at any aspect above 1.5, everything in Sven, the view model included, looks tan(36.87°)/tan(35°) = 1.07
  times larger than in CS. It is not measured in game.
- **Added:** the same applies to zoom. The port sends CS's zoom values unchanged (`base.as:138-140`: 55, 40 and 15;
  `SetFOV` at `base.as:307-309`), and Sven reads them as vertical angles. CS reads them as horizontal at 4:3, which is
  42.7°, 30.5° and 11.3° vertical. So every scoped view in the port shows 4/3 as much as in CS. The AWP's second zoom is
  10 in CS (`ReGameDLL_CS/regamedll/dlls/wpn_shared/wpn_awp.cpp:80`) but 15 in the port (`weapon_awp.as:256`).
- **Corrected:** this is not only a client setting. The server already sets `pev.fov` for zoom, so it can send the
  vertical equivalents of CS: 74 instead of 0 for the normal view (this overrides the player's `default_fov`), and 43,
  31, 11 and 8 (AWP) for the zoom levels. The formula is `2 × atan(0.75 × tan(cs_fov / 2))`.

## (a) Models against CS 1.6

`report.md:5-770` compares all 87 files under `models/cs16/`:

- 30 are byte-identical to CS 1.6: the three shells, `w_bp.mdl` (= `w_backpack.mdl`) and every `w_` model except
  `w_knife.mdl`.
- 2 have no CS counterpart: `ammo/mags.mdl` (23 magazine submodels; the `MAG_BDYGRP` values in the weapon scripts select
  the matching one) and `wpn/scope.mdl` (the scope overlay view model).
- 55 differ. 53 of them keep the CS texture set exactly (same names, sizes, flags, pixels and palettes). The two
  exceptions are `p_c4.mdl`, which adds `Backpack1.BMP` (`report.md:137`), and `w_knife.mdl`, which reuses the `p_knife`
  mesh and texture (`report.md:380`).
- View models (`v_`): same bones, except that the FAMAS and Galil rename the CS arm bones (names do not matter in a view
  model), and the same sequences, except labels: the Elites call `idle_leftempty` `idle_rightempty`, and the Scout and
  TMP number their `shoot` sequences. Sound events now point at `sound/cs16/…`, those 10 weapons use event 5005 for the
  CS muzzle flash, and attachments are mirrored. CS 1.6 stores its view models left-handed and mirrors them when
  `cl_righthand` is 1, the default (`cs16-client/cl_dll/StudioModelRenderer.cpp:713-719`, `hud.cpp:334`), but not the
  knife or shield (`StudioModelRenderer.cpp:903-911`). Sven has no such mirror (no `righthand` string in client.so).
  **Added:** Sven's engine does look up a client cvar `cl_righthand` after HUD init (hw.so 0x12f76e) and flips the cull
  face for the view model when it is above 0 (hw.so 0xaac3b), as Valve's engine does for CS. Sven's client never
  registers that cvar, so nothing mirrors or flips. The port's view models are pre-mirrored: the idle weapon sits at −Y
  (right) where CS's file has +Y (`report.md:64-75`, "idle weapon side"). In every frame of every sequence, the bounding
  box of each submodel matches CS as CS draws it within 0.05 units, except the knife `idle` (0.39; the credited "broken
  wrist" fix), P90 `draw` (0.19) and SG550 `draw` (0.31) (`report.md:374, 568, 627`). In the idle pose, every attachment
  sits at the mirrored CS position within 0.01 units, except the FAMAS attachment 1 (1.6 units off; no FAMAS event uses
  it) and the M4A1, whose attachments 0 and 2 are swapped together with its muzzle events
  (`deno run -R tools/mdl.ts <model> | jq .attachments[].idleOrigin`).
- **Added:** triangle winding. A mirror that keeps the winding turns a model inside out under back-face culling. For
  every triangle whose vertices share one bone, the review compared the winding normal `(p1 − p0) × (p2 − p0)` with the
  sum of the vertex normals, in bone space. All 27 port view models have the same majority sign as their CS sources (for
  example AK-47 4 positive / 741 negative against CS 3 / 742; CS's own FAMAS is mixed, 599 / 239, and the port's FAMAS
  has 600 / 238). So the mirror also reversed the winding, and Sven draws the outside of the guns. The review script was
  not committed; the method is in this paragraph.
- Player models (`p_`): textures unchanged; the CS arm bones `Bip01 R Clavicle/UpperArm/Forearm` are renamed to the
  Half-Life names `Bip01 R Arm/Arm1/Arm2`, and a new `muzzle` bone carries three attachments where CS had one
  (`report.md:54-63`). Sven's own `p_9mmAR.mdl` and `p_m16.mdl` also have three attachments
  (`deno run -R tools/mdl.ts <model> | jq '.attachments | length'`).
- Texture flags: no CS weapon model uses a flag. Only `scope.mdl` does (flatshade + fullbright, and masked;
  `report.md:579`). Sven's `R_StudioDrawPoints` (hw.so 0xaa900) supports these flags: masked → alpha test at 0.5
  (0xab496–0xab4aa), additive → GL_ONE/GL_ONE blending (0xab62d), fullbright → white vertex colour (0xab02e–0xab056),
  chrome UVs (0xaadac); flatshade and chrome are dropped only when `r_fullbright` ≥ 2 (0xaab3e, cvar at hw.so 0x2f3934).
  So flags do not explain a difference between CS and Sven.
- Texture sizes: the largest side is 512 (`v_knife.mdl` `knifeskin.bmp`). Sven's `gl_max_size` defaults to "1024" (cvar
  hw.so 0x2f1718, string 0x26dd08), and Sven ships its own models with 512-pixel and non-power-of-two textures
  (`player.mdl` `HEV_helmet.bmp` 128×127). Nothing is rejected or scaled down.
- No model needs an external `<name>T.mdl` or extra sequence-group files: all 87 have embedded textures and one sequence
  group (`report.md`, last line of each model).
- Every script animation enum names the matching view model sequence, for all 27 weapons, and each of the 24
  `MAG_BDYGRP` values selects the `mags.mdl` submodel of its own weapon (`report.md:1411-1440`). So no script plays a
  wrong animation or shows a wrong magazine.

## (b) Sprites

`report.md:771-780`:

| Sprite                        | Size, format              | Against CS 1.6                                                 |
| ----------------------------- | ------------------------- | -------------------------------------------------------------- |
| `sprites/cs16/640hud7.spr`    | 256×256, additive         | Byte-identical to `cstrike/sprites/640hud7.spr`                |
| `sprites/cs16/cs1024.spr`     | 1024×512, additive        | R4to0's merged icon sheet, no CS twin; fits `gl_max_size` 1024 |
| `sprites/cs16/csflashx.spr`   | 72×72, 3 frames, additive | Byte-identical to `cstrike/sprites/muzzleflash3.spr`           |
| `sprites/cs16/crosshairs.spr` | 256×256, alpha-test       | Custom; HL's `crosshairs.spr` is 128×128                       |

## (c) References from scripts and models

`report.md:978-1444`: every model, sprite, sound, event file and HUD list that the scripts name resolves, either in this
repository, in the CS imports of `cstrike-assets.txt`, or in Sven's base content (for example
`models/hlclassic/shotgunshell.mdl`, which is byte-identical to HL's `valve/models/shotgunshell.mdl` that CS 1.6 uses
through `cs16-client/cl_dll/hud_msg.cpp:85`). Every view model sound event resolves and is precached by its weapon
script. No asset is missing or misnamed. All 127 WAV files are PCM, mono, 22050 Hz, 8 or 16 bit.

## (d) Sven Co-op expectations

- Hands: Sven's own view models use `V_Arm_Texture.bmp` or `Sven_HEV_Arm/Glove.bmp` (`report.md:1450-1455`). The port's
  view models keep CS's `view_glove.bmp`, `view_skin.BMP` and `view_finger.bmp`, pixel-identical to CS
  (`report.md:1447-1448`). That is correct for a CS look and is not a defect.
- Player skeleton: a GoldSrc client attaches a `p_` model by copying the transforms of player bones with the same names
  (`StudioMergeBones`, `cs16-client/cl_dll/StudioModelRenderer.cpp:758-794`). Every `p_` bone except the extra
  `muzzle`/`muzzle_left` leaf bones exists in `svencoop/models/player.mdl` (`report.md:1457-1484`), and all 101 player
  models in `svencoop/models/player/` have the full set of arm bones (command in "Reproduce").
- HD models: the engine supports a `<game>_hd` directory (hw.so strings "%s/%s_hd" at 0x25f0b7, "_sethdmodels" at
  0x2606ed), but the client has no `svencoop_hd` directory, and `svencoop/models/valve_hd/` holds only NPC models. They
  do not affect weapon models.

## Client download cache

The client's `svencoop_downloads/` already holds every asset of this pack. The 219 models, sprites, sounds and the event
file are byte-identical to this repository; the 27 HUD lists differed from base `ed52216` only by CRLF line endings
(commands in "Reproduce"). So the client did not use stale or foreign copies. After `584b15d`, 22 of the cached lists
keep the old crosshair rect, which draws the same picture. The client downloads only files that it does not have
(`CL_CheckFile`, hw.so 0x121830, asks for `dlfile` only when the file is missing at 0x121942), so a changed binary asset
must ship under a new path to reach players who downloaded the old one. The kill feed fix needs no download: it is
server script code.

## Tools

| Tool             | Purpose                                                                                                                                                                                                                                                                                   | Self-check                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `tools/mdl.ts`   | Studio model v10 inspector: header, bones, controllers, hitboxes, sequences and events, sequence groups, textures with flags and palette offsets, skin families, body parts with idle bounds, attachments with idle positions, `<name>T.mdl` lookup; any frame's submodel bounds for code | `deno test tools/mdl.ts`         |
| `tools/spr.ts`   | Sprite v2 decoder: header, type, texture format, palette, frames and groups; PNG export of a frame or crop through ImageMagick for normal, additive, index-alpha and alpha-test                                                                                                           | `deno test tools/spr.ts`         |
| `tools/audit.ts` | Writes `report.md` and `hud-icons.png` from the CS 1.6 and Sven installs                                                                                                                                                                                                                  | `deno test -R -E tools/audit.ts` |

## Reproduce

Install roots come from `STEAM_COMMON`, `CSTRIKE_DIR` and `SVEN_CLIENT_DIR`, with the same defaults as the `Justfile`.
Run the commands from the repository root.

```sh
deno test -R -E tools/audit.ts   # also runs the mdl.ts and spr.ts self-checks
deno run -R -E --allow-run=magick -W=docs/research/asset-audit tools/audit.ts > docs/research/asset-audit/report.md

CS="${CSTRIKE_DIR:-$HOME/.local/share/Steam/steamapps/common/Half-Life/cstrike}"
SVEN="${SVEN_CLIENT_DIR:-$HOME/.local/share/Steam/steamapps/common/Sven Co-op}"
out=docs/research/asset-audit
tmp=$(mktemp -d)
spr() { deno run -R --allow-run=magick tools/spr.ts "$@"; }
png=(-define png:exclude-chunks=date,time)

# Kill feed: the rect Sven drew before 95ae240, then the intended icon.
spr "$CS/sprites/640hud1.spr" 0 "$tmp/drawn.png" 192 80 64 176
spr "$CS/sprites/640hud1.spr" 0 "$tmp/intended.png" 192 80 48 16
magick "$tmp/drawn.png" "$tmp/intended.png" -background black -alpha remove -gravity north +append +repage \
  -scale 300% "${png[@]}" "$out/killfeed-ak47-before-after.png"

# Muzzle flash: CS 1.6 frames on top, Sven frames below.
for f in 0 1 2; do spr "$CS/sprites/muzzleflash2.spr" "$f" "$tmp/cs-$f.png"; done
for f in 0 1; do spr "$SVEN/svencoop/sprites/muzzleflash2.spr" "$f" "$tmp/sven-$f.png"; done
magick \( "$tmp"/cs-?.png +append \) \( "$tmp"/sven-?.png +append \) -background black -alpha remove -gravity west \
  -append +repage -scale 200% "${png[@]}" "$out/muzzleflash2-cs-top-sven-bottom.png"

# Crosshair sprite on grey.
spr sprites/cs16/crosshairs.spr 0 "$tmp/crosshairs.png"
magick "$tmp/crosshairs.png" -background '#404040' -alpha remove "${png[@]}" "$out/crosshairs.png"
rm -rf "$tmp"

# Kill feed table against cstrike/sprites/hud.txt (no output = equal).
diff <(tr -d '\r' < "$CS/sprites/hud.txt" | awk '$2 == 640 && $1 ~ /^d_/ {print $1, $3, $4, $5, $6, $7}' | sort) \
  <(rg -o 'name == "(d_\w+)"\)\s+return MakeFrame\("(\w+)",\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)' \
    -r '$1 $2 $3 $4 $5 $6' scripts/cs16/killfeed.as | sort)

# Arm bones in every Sven player model (no output = all present). Corrected: three file names differ in case from
# their folder (OP4_scientist_*.mdl), so list the 101 files instead of building each name from its folder.
fd -e mdl . "$SVEN/svencoop/models/player" | while read -r m; do
  deno run -R tools/mdl.ts "$m" | jq -r --arg m "$m" '[.bones[].name] as $b
    | ["Bip01 R Arm","Bip01 R Arm1","Bip01 R Arm2","Bip01 R Hand","Bip01 L Arm","Bip01 L Arm1","Bip01 L Arm2","Bip01 L Hand"] - $b
    | select(length > 0) | "\($m): \(.)"'
done

# Client download cache: assets other than the HUD lists, then the HUD lists at the base commit (no output = equal).
for f in $(fd -t f -E 'weapon_*.txt' . models sprites sound events); do
  cmp -s "$f" "$SVEN/svencoop_downloads/$f" || echo "differs: $f"
done
for f in $(git ls-tree -r --name-only ed52216 sprites | rg '[.]txt'); do
  diff -q <(tr -d '\r' < "$SVEN/svencoop_downloads/$f") <(git show "ed52216:$f") > /dev/null || echo "content differs: $f"
done

# Sound formats.
fd -e wav . sound -x file {} | sed 's/^[^:]*: //' | sort | uniq -c

# Review: muzzle-flash events of the CS 1.6 view models (5001 type 22 for the rifles, 12 for the P90).
for f in "$CS"/models/v_*.mdl; do
  deno run -R tools/mdl.ts "$f" | jq -r --arg f "${f##*/}" \
    '[.sequences[].events[]? | select(.event != 5004) | "\(.event):\(.options)"] | unique | select(length > 0)
    | "\($f) \(join(" "))"'
done

# Review: FOV settings in the local configs, and the digit rects of both games.
rg -n '^(default_fov|gl_widescreen_yfov) ' "$SVEN/svencoop/config.cfg" "$CS/config.cfg"
for f in "$SVEN/svencoop/sprites/hud.txt" "$CS/sprites/hud.txt"; do
  tr -d '\r' < "$f" | awk '$2 == 640 && $1 ~ /^number_/ {print $1, $3, $4, $5, $6, $7}'
done

# Review: world-model scales; each value after CommonSpawn in a Spawn() overrides base.as.
rg -n 'self\.pev\.scale\s*=' scripts/cs16
```

## Limits

- The audit is static. The kill feed fix and the crosshair rect need an in-game check.
- The p_ weapon position inside the hand was only spot-checked against CS and Sven's own `p_` models; `audit.ts` checks
  bone names, not placement.
- The FOV comparison (finding 6) is inferred from code and config, not measured. **Corrected:** the review read the code
  of both engines (finding 6), so only the in-game measurement is missing.
- **Added:** the review did not open `server.so`. How the server sends `HudMessage` channels above 4, and how it maps
  the per-module channels 0–15 to the client's 32 channels, are UNVERIFIED.
- **Added:** the look of the 5005 muzzle-flash effect, the kill-feed layout at other resolutions and the zoom levels
  need an in-game check against CS 1.6.

## Review record

The review re-derived these claims from primary evidence. "Confirmed" means the evidence agrees with the text above.

| Claim                                                                              | Re-derived from                                                                                                  | Verdict                                                 |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `killfeed.as:325-326` sent width and height 0 at `ed52216`                         | `git show ed52216:scripts/cs16/killfeed.as`                                                                      | Confirmed                                               |
| Rect = offset + size; a zero size ends at the sheet edge, without the offset       | client.so 0xd8a20, 0xd83d2, 0xb48ee, 0xd5002, 0xda9ce                                                            | Confirmed                                               |
| AK-47 kill drew (192, 80)–(256, 256), 13 icons                                     | `640hud1.spr` header (256×256), `hud.txt` rects in that column                                                   | Confirmed                                               |
| The 30 `d_*` rects equal `hud.txt`                                                 | the diff command in "Reproduce"                                                                                  | Confirmed                                               |
| 5001/5011/5021/5031 call `R_MuzzleFlash` on attachments 0–3; 5005/5006 read a file | client.so 0xb62a4 (efx slot 19; `r_efx.h:143`), 0xed154                                                          | Confirmed                                               |
| `R_MuzzleFlash` sprite index and scale                                             | hw.so 0x11c520, 0x1184e0                                                                                         | Confirmed; 0.5 fallback added                           |
| Sven's `muzzleflash2.spr` is HL's, not CS's; `csflashx.spr` is CS's `muzzleflash3` | SHA-1 of the three installs                                                                                      | Confirmed; also true for `muzzleflash1` and `3`         |
| 15 view models fire 5001/5011/5021, 10 fire 5005                                   | `tools/mdl.ts` events of all 87 port models and all CS `v_*.mdl`                                                 | Confirmed; P90 size added                               |
| `svencoop/` comes before `svencoop_downloads/`                                     | hw.so 0x713c0 (0x71567, 0x715bd); `_lv`, `_addon`, language and `_hd` folders come first, all client-controlled  | Confirmed                                               |
| The client downloads only missing files                                            | hw.so 0x121830 (`dlfile` only after the exists check at 0x121942)                                                | Confirmed                                               |
| `crosshairs.spr`: 256×256 alpha-test, 24 pixels of index 224 (#ff0000)             | an independent decoder; the cross spans x and y 117–137; pixel (0,0) is index 255                                | Confirmed                                               |
| An empty sub-rect draws the whole frame; the crosshair is centred by the rect size | hw.so 0x127aa0; client.so 0xb46ee (drawn with `SPR_DrawHoles`)                                                   | Confirmed                                               |
| CS draws a dynamic green crosshair                                                 | cs16-client `ammo.cpp:283`, `:632-639`, `:1053-1068`, `:1524`; Valve `cstrike/cl_dlls/client.so` has `50 250 50` | Confirmed                                               |
| Sven reads only 640 entries of a weapon list                                       | client.so 0x9ea50 (`iRes == 640`), 0xa2522 (`sprites/%s/%s.txt`)                                                 | Confirmed                                               |
| `left` and `top` are bytes                                                         | `outputdocs.txt:2233-2239`; client.so 0xd83d2                                                                    | Confirmed                                               |
| Ammo rects equal CS; all 27 lists name only 640 entries                            | rect compare of the 27 port lists with `cstrike/sprites/weapon_*.txt`                                            | Confirmed                                               |
| Every icon shows its weapon                                                        | `hud-icons.png`; Five-SeveN crop next to the Glock crop                                                          | Confirmed: the Five-SeveN icon is a restyled Five-SeveN |
| Weapon scales 1.0–1.6; ammo boxes 1.5                                              | the `Spawn()` methods of all 51 spawned classes                                                                  | Weapons confirmed; ammo corrected                       |
| ReGameDLL sets no world-model scale                                                | `rg 'pev->scale' ReGameDLL_CS/regamedll/dlls`                                                                    | Confirmed                                               |
| Sven's FOV 70 is vertical; view models use the world FOV                           | client.so 0xd6a7b; hw.so 0x8d350, 0x139ec0, 0x139040, 0x13a5a0, 0x13a2e0                                         | Confirmed; parser address corrected                     |
| CS's FOV 90 is 73.7° vertical                                                      | Valve `hw.so` 0x16ead0, 0x16f050, 0x16ea00, 0x16da90; the local `cstrike/config.cfg`                             | Confirmed at 4:3 and above aspect 1.5                   |
| View models are pre-mirrored, attachments mirrored                                 | `tools/mdl.ts` attachments of the AK-47 and Desert Eagle against CS                                              | Confirmed; winding check added                          |
| Every `p_` arm bone exists in all 101 Sven player models                           | `tools/mdl.ts` on all 101 files                                                                                  | Confirmed; the old command checked only 98              |
| 30 models are byte-identical to CS                                                 | SHA-1 join of `models/cs16` and `cstrike/models`                                                                 | Confirmed (3 shells, 27 `w_` models)                    |
| Texture-flag handling in `R_StudioDrawPoints`                                      | hw.so 0xab496–0xab4aa, 0xab62d, 0xab02e–0xab056, 0xaab3e (threshold 2.0 at 0x2617c0)                             | Confirmed                                               |
| `gl_max_size` "1024"; `viewmodel_fov` "0"                                          | hw.so cvar records 0x2f1718, 0x2f1b54                                                                            | Confirmed                                               |
| The download cache matched `ed52216`                                               | the cmp and diff commands (219 assets, 27 lists)                                                                 | Confirmed                                               |
| 127 WAV files, PCM mono 22050 Hz                                                   | `file`                                                                                                           | Confirmed                                               |
| No `svencoop_hd`; `valve_hd` holds only NPC models                                 | `ls`                                                                                                             | Confirmed                                               |
| `shotgunshell.mdl` equals HL's; `p_9mmAR.mdl` and `p_m16.mdl` have 3 attachments   | SHA-1; `tools/mdl.ts`                                                                                            | Confirmed                                               |
| The 24 `MAG_BDYGRP` values select their own weapon's magazine                      | `tools/mdl.ts` submodel names of `mags.mdl` (23) against `rg 'MAG_BDYGRP\s*='`                                   | Confirmed; the M3 and XM1014 share `shotshell_box`      |

Not re-derived (taken from `report.md`): the animation drift values (`report.md:374, 568, 627`), the animation enums
(`report.md:1411-1440`), the mean |Δ| values of the icons, the texture sizes, the sequence-group and `T.mdl` checks, the
sound-event precache check and the hand textures.
