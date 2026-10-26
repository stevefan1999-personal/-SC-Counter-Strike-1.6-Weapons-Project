# CS 1.6 HUD specification for Counter-Life

- Status: research specification. It is the reference for the server-side CS 1.6 HUD.
- Date: 2026-10-27.
- Branch: `docs/cs16-hud-spec`.
- Scope: every Counter-Strike 1.6 HUD element (position, sprite, colour, alpha, number format, update trigger) and a proposed mapping to the Sven Co-op 5.26 AngelScript HUD API.

## 1. Sources and conventions

### 1.1 Evidence tags

| Tag | Source | Citation format |
|---|---|---|
| `BIN` | Valve CS 1.6 client `Half-Life/cstrike/cl_dlls/client.so`, SHA-1 `f2bd6f7a394d9bea491d00c11d32949ef4459f1d`, i386, not stripped, with DWARF. Analysed in IDA from the copy `.re/cs16-valve-client/client.so`. | `BIN 0xa1eb0` (function or instruction address) |
| `FWGS` | FWGS cs16-client, commit `a238ef1`, directory `cl_dll/` | `health.cpp:276` |
| `hud.txt` | `Half-Life/cstrike/sprites/hud.txt` (CR removed) | `hud.txt:110` |
| `wtxt` | `Half-Life/cstrike/sprites/weapon_*.txt` | `weapon_ak47.txt:9` |
| `RGD` | ReGameDLL_CS, directory `regamedll/` | `dlls/player.cpp:7906` |
| `HW`, `VGUI2` | `Half-Life/hw.so` and `Half-Life/vgui2.so` | address |
| `API` | `sven-coop.github.io/outputdocs.txt` (AngelScript API dump) | `API:2131` (line) |
| `SVEN` | Sven Co-op client install (read-only) | `svencoop/sprites/hud.txt:24` |
| `TOOL` | Deno scripts written for this research. They copy the `BIN` formulas. | output in Appendix A |

`BIN` is the authority. `FWGS` is cited where it agrees with `BIN`. Section 9 lists every FWGS deviation that this research found. Do not copy FWGS values that Section 9 lists.

### 1.2 Notation

- `W`, `H`: HUD screen width and height in pixels (`gHUD.m_scrinfo`, FWGS `cl_util.h:68-70`).
- `dw`: digit cell width. It is the width of `number_0`: 20 in the 640 set, 12 in the 320 set (hud.txt:110, hud.txt:18).
- `fh`: `m_iFontHeight`, the height of `number_0`: 25 in the 640 set, 16 in the 320 set. BIN writes it at 0xb2cc7–0xb2ccf (field `gHUD+0x168`, the same field that `CHudHealth::Draw` reads at 0xb11a0).
- Integer division truncates toward zero, as in C. `(int)x` truncates.
- A box is `(x, y, w, h)`: top-left corner and size in screen pixels. The y axis points down.
- Examples use the 640 sprite set at 640×480, unless a row gives another size.
- "A VGUI panel is open" is an interpretation. BIN calls a `gViewPortInterface` virtual function there, and the symbols do not give its name.

### 1.3 Colour and blend model

- `ScaleColors(r, g, b, a)` sets each channel to `(int)(float)(c * (a / 255.0))` (BIN 0xb5ad0). Elements call it before a draw.
- `SPR_DrawAdditive` adds the sprite pixel multiplied by the set colour.
- `FillRGBA` is additive: `glBlendFunc(GL_SRC_ALPHA, GL_ONE)` (HW 0x14b160–0x14b170). The visible colour is `c * a / 255`.
- `FillRGBABlend` is an alpha blend: `glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)` (HW 0x14b300–0x14b310).
- Thus "sprite with pre-scaled colour" and "FillRGBA with raw colour and alpha" give the same result.

Named colours. All values are `BIN` literals unless the row says otherwise.

| Name in this spec | RGB | Use | Evidence |
|---|---|---|---|
| HUD orange | 255,160,0 | all HUD sprites and digits | BIN 0xb10aa, FWGS `RGB_YELLOWISH` hud.h:24 |
| Low red | 250,0,0 | health ≤ 25, pain arrows when health ≤ 25 | BIN 0xb1117, 0xafce9 |
| Alert red | 255,16,16 | weapon without ammo, timer panic, flashlight battery < 20 % | BIN 0xa2ae0, 0xae080, 0xa7f9a, FWGS `RGB_REDISH` hud.h:25 |
| Bar green | 0,160,0 | filled part of a weapon-menu ammo bar | BIN 0xa1c5f, FWGS `RGB_GREENISH` hud.h:26 |
| Status green | 0,160,0 | `buyzone`, `c4`, `defuser` icons (the server sends the colour) | RGD dlls/observer.cpp:372-375, dlls/player.cpp:1935-1938 |
| Kill icon | 255,80,0 | death-notice weapon and headshot icons | BIN 0xa5c5b–0xa5cc2 |
| Team-kill icon | 10,240,10 | death-notice icon for a team kill | BIN 0xa5c5b–0xa5cc2 |
| Crosshair default | 50,250,50 | `cl_crosshair_color` default | BIN 0x9d290 |
| NVG crosshair | 250,50,50 | crosshair while night vision is on | BIN 0xa2088–0xa2540 |
| Centre print | float 1.0, 0.706, 0.118 (255,180,30) | `HUD_PRINTCENTER` text | BIN 0xce3e0 (TextMsg destination 4) |
| Menu default and `\w` | 255,255,255 | text menu | BIN 0xc3e3a, 0xc402e |
| Menu `\y` | 255,210,64 | text menu | BIN 0xc40a1 |
| Menu `\r` | 210,24,0 | text menu | BIN 0xc4007 |
| Menu `\d` | 100,100,100 | text menu | BIN 0xc4058 |
| Team 1 (T) name | float 1.0, 0.25, 0.25 (255,64,64) | death notices | `g_ColorRed` 0x1d55e4, selected by `CSWTCH.37` 0x186574 |
| Team 2 (CT) name | float 0.6, 0.8, 1.0 (153,204,255) | death notices | `g_ColorBlue` 0x1d55f0 |
| Team 3 (spectator) name | float 1.0, 0.7, 0.0 (255,178,0) | death notices, player id | `g_ColorYellow` 0x1d55cc |
| Team 4 name | float 0.6, 1.0, 0.6 (153,255,153) | death notices | `g_ColorGreen` 0x1d55d8 |
| Other or unassigned name | float 0.8, 0.8, 0.8 (204,204,204) | death notices | `g_ColorGrey` 0x1d55c0 |
| Location text | float 0.0, 0.8, 0.0 (0,204,0) | text under the radar | `g_LocationColor` 0x1d5650 |

Text colours are floats (`pfnDrawSetTextColor`). The 8-bit values in brackets are `round(f * 255)`.

Pre-scaled colours (TOOL, Appendix A.1):

| Base | a=255 | a=228 | a=225 | a=200 | a=192 | a=128 | a=100 |
|---|---|---|---|---|---|---|---|
| HUD orange | 255,160,0 | 228,143,0 | 225,141,0 | 200,125,0 | 192,120,0 | 128,80,0 | 100,62,0 |
| Low red | 250,0,0 | 223,0,0 | 220,0,0 | 196,0,0 | 188,0,0 | 125,0,0 | 98,0,0 |
| Alert red | 255,16,16 | 228,14,14 | 225,14,14 | 200,12,12 | 192,12,12 | 128,8,8 | 100,6,6 |

### 1.4 Alpha and fade constants

| Constant | Value | Evidence |
|---|---|---|
| `MIN_ALPHA` | 100 | FWGS hud.h:41, BIN literal at 0xb1047 |
| `FADE_TIME` | 100 | FWGS hud.h:294, BIN 0xaef0a |
| Fade speed | `fade -= 20 * dt` each frame (dt in seconds) | BIN 0xb105c, 0xa4b1c, 0xa30c0 |

Fade curves:

1. Health and armour. A changed value sets `fade = 100`. Alpha is `(int)(100 + 128 * fade / 100)`. Alpha starts at 228 and falls linearly to 100 in 5 s (BIN 0xb1083, 0xa4b43).
2. Ammo. `CurWeapon` for the active weapon sets `fade = 200`. Alpha is `fade > 100 ? (int)fade : 100`. Alpha starts at 200 and falls linearly to 100 in 5 s (BIN 0xa0007, 0xa3099–0xa30c0).
3. Money. A changed value sets `fade = 5` and `fade -= dt` each frame. Alpha is `(int)(100 + 128 * fade / 5)`. This is the same curve as health (BIN 0xa3be0, 0x9c97e–0x9c9b1).

TOOL sample (Appendix A.1): health curve 228, 202, 176, 151, 125, 100 at t = 0…5 s. Ammo curve 200, 180, 160, 140, 120, 100.

## 2. Global rules

### 2.1 Sprite set and scaling

1. BIN selects the sprite set with `res = (W > 639) ? 640 : 320` (BIN 0xb2a75–0xb2a95). Weapon sprite files use the same rule (BIN 0x9ebc0).
2. `cstrike/sprites/hud.txt` has two sets only: 320 (hud.txt:2-89) and 640 (hud.txt:94-195). It has no 1280 or 2560 entries. The HL25 1280 and 2560 sets exist only in `valve/sprites/hud.txt` (for example its lines 4 and 81). CS does not read them, because `cstrike/sprites/hud.txt` replaces that file.
3. Result: at every width of 640 or more, CS draws the 640 sprites at 1:1 pixel size. The HUD does not scale with the resolution.
4. These parts change with the resolution: the crosshair (`W / base`, §3.12), the death-notice layout (VGUI2 proportional scale, §3.9), the progress bar (`W/2`, §3.7) and the armour x position (`W/5`, §3.2).
5. FWGS always loads the 640 set (FWGS hud.cpp:474) and has a Xash HUD scale (`m_flScale`, hud.cpp:472). Do not copy these.
6. The 320 set uses files from `valve/sprites` (`320hud1.spr`…`320hud4.spr`), some 640 files (hud.txt:33-41, hud.txt:58-85) and `cstrike/sprites/radar320.spr` (hud.txt:89).

### 2.2 Font metrics

- 640 set: `fh = 25`, `dw = 20` (hud.txt:110). 320 set: `fh = 16`, `dw = 12` (hud.txt:18).
- Text uses the engine character font (`DrawHudString` and `pfnDrawCharacter`, FWGS draw_util.cpp:94-150) or the engine console font (`pfnDrawConsoleString`, BIN 0xa5ec6). The engine sets their size, not hud.txt.

### 2.3 Number drawing

CS draws HUD numbers with the sprites `number_0`…`number_9`. Every digit uses the cell width `dw`, but the glyph rectangles start at irregular x offsets.

| Digit | 640 rect on `640hud7` (x,y,w,h) | 320 rect on `320hud2` | Evidence |
|---|---|---|---|
| 0 | 0,0,20,25 | 0,0,12,16 | hud.txt:110, hud.txt:18 |
| 1 | 23,0,20,25 | 12,0,12,16 | hud.txt:111, hud.txt:19 |
| 2 | 47,0,20,25 | 24,0,12,16 | hud.txt:112, hud.txt:20 |
| 3 | 70,0,20,25 | 36,0,12,16 | hud.txt:113, hud.txt:21 |
| 4 | 95,0,20,25 | 48,0,12,16 | hud.txt:114, hud.txt:22 |
| 5 | 119,0,20,25 | 60,0,12,16 | hud.txt:115, hud.txt:23 |
| 6 | 144,0,20,25 | 72,0,12,16 | hud.txt:116, hud.txt:24 |
| 7 | 169,0,20,25 | 84,0,12,16 | hud.txt:117, hud.txt:25 |
| 8 | 192,0,20,25 | 96,0,12,16 | hud.txt:118, hud.txt:26 |
| 9 | 216,0,20,25 | 108,0,12,16 | hud.txt:119, hud.txt:27 |

`DrawHudNumber(x, y, flags, n, r, g, b)` (BIN 0xb5d50) uses these flags:

| Flag | Value | Meaning | Evidence |
|---|---|---|---|
| `DHN_DRAWZERO` | 1 | draw "0" when n ≤ 0 | BIN 0xb5fa5, FWGS draw_util.h:33 |
| `DHN_2DIGITS` | 2 | reserve a tens cell | BIN 0xb5f85, FWGS draw_util.h:34 |
| `DHN_3DIGITS` | 4 | reserve a hundreds cell | BIN 0xb5f67, FWGS draw_util.h:35 |
| leading zeros | 8 | draw the "0" glyph in reserved cells | BIN 0xb5d85, 0xb5f6b, 0xb5f8d |

Algorithm for n > 0:

1. If n ≥ 100, draw digit `n / 100`. Else, if flag 4 is set, keep one empty cell (with flag 8, draw "0" in it).
2. If n ≥ 10, draw digit `(n % 100) / 10`. Else, if flag 2 or flag 4 is set, keep one empty cell (with flag 8, draw "0").
3. Draw digit `n % 10`.
4. Each step moves x by `dw`. The function returns the new x.

For n ≤ 0 the function draws nothing, unless flag 1 is set. With flag 1 it keeps the reserved cells and draws "0". A value of 1000 or more gives a digit index out of range. CS keeps the values small through the protocol: health and reserve ammo are bytes (BIN 0xaeefc, 0x9fae0), and the clip is a signed char (BIN 0x9ff13).

| Element | Flags | Result |
|---|---|---|
| Health, armour, ammo | 5 | 3 cells, no leading zero, "0" visible |
| Timer minutes | 3 | 2 cells, no leading zero |
| Timer seconds | 11 | 2 cells with a leading zero |

Money uses the other overload `DrawHudNumber(x, y, n, r, g, b)` (BIN 0xb5c40). It formats the value with `"%5i"` (string at BIN 0x186f58). It moves x by `dw` for each character and draws only the characters `0`…`9`. Thus money is right-aligned in a field of 5 cells. A value with 6 digits extends one cell to the right.

CS draws no thousands separator and no sign inside a number. The money sign and the delta sign are separate sprites (§3.5).

### 2.4 Draw order

The draw order is the order of the `CHud::Init` calls (BIN 0xb3975–0xb3aa9):

1. NightVision
2. SniperScope
3. Ammo: weapon menu, pickup history, crosshair, ammo counter (BIN 0xa2fe4–0xa3319)
4. Health: radar, health counter, damage-type icons, pain arrows (BIN 0xb1141–0xb10fc)
5. SayText (chat)
6. Spectator
7. Geiger (sound only)
8. Train
9. Battery (armour)
10. Flashlight
11. Message (`HudText`, titles.txt messages)
12. StatusBar (player id)
13. DeathNotice
14. AmmoSecondary (not used by CS weapons)
15. TextMessage (no drawing)
16. StatusIcons
17. AccountBalance (money)
18. RoundTimer
19. ProgressBar
20. CareerTaskTimer (Condition Zero)
21. ScenarioStatus
22. Menu
23. VGUI2Print (centre print)

`CHud::Redraw` draws an element only if `hud_draw` is not 0, the element is active, and `HIDEHUD_ALL` is clear (BIN 0xb6274–0xb66f7). With `hud_draw 0` it draws only NightVision and SniperScope (BIN 0xb662a–0xb6654). All HUD draws are additive. Thus the order is important only for the opaque radar (`cl_radartype 1`) and the blended crosshair (`cl_crosshair_translucent 0`).

### 2.5 CS hide bits and gates

The `HideWeapon` message sets `m_iHideHUDDisplay` (FWGS ammo.cpp:559-575). Bit values (RGD dlls/cdll_dll.h:38-45, FWGS dlls/cdll_dll.h:25-31):

| Bit | Name | What it hides (BIN check) |
|---|---|---|
| 1 | `HIDEHUD_WEAPONS` | weapon menu, pickup history, crosshair, ammo counter (BIN 0xa2fcf tests `& 5`). It also stops the movement part of the crosshair gap (BIN 0xa1f17). |
| 2 | `HIDEHUD_FLASHLIGHT` | flashlight (BIN 0xa7d97 tests `& 6`) |
| 4 | `HIDEHUD_ALL` | all elements (BIN 0xb66ec) |
| 8 | `HIDEHUD_HEALTH` | health, armour, radar, damage icons, pain arrows (BIN 0xb100b, 0xa4a10) |
| 16 | `HIDEHUD_TIMER` | round timer (BIN 0xadfc6) |
| 32 | `HIDEHUD_MONEY` | money (BIN 0x9cb19) |
| 64 | `HIDEHUD_CROSSHAIR` | dynamic crosshair (BIN 0xa303a). RGD sets it while a shield is up (dlls/player.cpp:8786-8793). |
| 128 | `HIDEHUD_OBSERVER_CROSSHAIR` | spectator crosshair (RGD dlls/cdll_dll.h:45) |

Sven uses other values for its `HIDEHUD_*` names (§5.3).

Other gates:

- Suit. Health, armour, ammo, weapon menu, crosshair and flashlight draw only if bit 31 (`WEAPON_SUIT`) of `m_iWeaponBits` is set. BIN tests `m_iWeaponBits < 0` (for example at 0xb10dd). Money changes its y position without the suit (§3.5).
- Spectator. Most elements do not draw when `g_iUser1` is not 0 (for example BIN 0xb1019, 0xa4a43, 0x9cb1f).

### 2.6 Sprite reference (640 set)

All rows are from `cstrike/sprites/hud.txt`. The file `640hud7.spr` is 256×256, additive (TOOL, Appendix A.3).

| Name | File | Rect (x,y,w,h) | Line |
|---|---|---|---|
| `selection` | 640hud3 | 0,180,170,45 | 94 |
| `bucket1`…`bucket5` | 640hud7 | (168,72) (188,72) (208,72) (168,92) (188,92), all 20×20 | 95-99 |
| `bucket0` | 640hud7 | 208,92,20,20 | 100 |
| `dmg_*` (9 icons) | 640hud8, 640hud9 | 64×64 each | 101-109 |
| `number_0`…`number_9` | 640hud7 | see §2.3 | 110-119 |
| `divider` | 640hud7 | 240,0,2,40 | 120 |
| `cross` | 640hud7 | 48,25,24,24 | 121 |
| `dollar` | 640hud7 | 192,25,18,25 | 122 |
| `minus` | 640hud7 | 210,25,13,23 | 123 |
| `plus` | 640hud7 | 223,25,17,23 | 124 |
| `c4` | 640hud7 | 0,148,32,32 | 125 |
| `defuser` | 640hud7 | 32,148,32,32 | 126 |
| `stopwatch` | 640hud7 | 144,72,24,24 | 127 |
| `smallskull`, `smallc4`, `smallvip` | 640hud7 | (72,25) (84,25) (96,25), all 12×12 | 128-130 |
| `buyzone` | 640hud7 | 96,148,32,32 | 131 |
| `rescue` | 640hud7 | 64,148,32,32 | 132 |
| `escape` | 640hud7 | 128,148,32,32 | 133 |
| `vipsafety` | 640hud7 | 160,148,32,32 | 134 |
| `suit_full` | 640hud7 | 0,25,24,24 | 135 |
| `suit_empty` | 640hud7 | 24,25,24,24 | 136 |
| `suithelmet_full` | 640hud7 | 0,124,24,24 | 137 |
| `suithelmet_empty` | 640hud7 | 24,124,24,24 | 138 |
| `flash_full` | 640hud7 | 160,25,32,32 | 139 |
| `flash_empty` | 640hud7 | 112,25,32,32 | 140 |
| `flash_beam` | 640hud7 | 144,25,16,32 | 141 |
| `train_*` | 640hud5, 640hud6 | 72×72 | 142-146 |
| `d_*` death icons | 640hud1, 640hud2, 640hud16 | see §3.9 | 150-179 |
| `item_battery`, `item_healthkit`, `item_longjump` | 640hud2 | (176,0) (176,48) (176,96), all 44×44 | 180-182 |
| `radar` | radar640 | 0,0,128,128 | 183 |
| `hostage`, `bombticking*`, `hostage*` | 640hud7 | 32×32 and 48×25 | 184-194 |
| `radaropaque` | radaropaque640 | 0,0,128,128 | 195 |

The `divider` rect is a solid column (TOOL, Appendix A.4). CS does not draw it. CS draws the ammo separator with `FillRGBA` (§3.3).

## 3. Element specifications

### 3.1 Health

| Item | Value | Evidence |
|---|---|---|
| Sprites | `cross` (§2.6) and digits (§2.3) | hud.txt:121, hud.txt:110-119 |
| Row y | `y = H - fh - fh/2`: H − 37 (640 set), H − 24 (320 set) | BIN 0xb11be |
| Cross box | `(crossW/2, y, 24, 24)` = (12, H − 37, 24, 24) | BIN 0xb1234 |
| Digit field | 3 cells from `x = crossW + dw/2` = 34. Cells at x 34, 54, 74. | BIN 0xb1280 (flags 5) |
| Colour | health > 25: HUD orange. Health ≤ 25: low red. | BIN 0xb109c–0xb111f, 0xaef20 |
| Alpha | health fade curve (§1.4). Health ≤ 15: alpha 255 always. | BIN 0xb1047–0xb1109 |
| Trigger | `Health` message (byte). A new value sets `fade = 100`. | BIN 0xaeee0 (0xaef0a) |
| Hidden when | `HIDEHUD_HEALTH`, no suit, spectator | BIN 0xb100b–0xb1019, 0xb10dd |

640×480: cross box (12,443,24,24). Digit cells x 34, 54, 74 at y 443.

BIN decreases the fade timer before the ≤ 15 test (BIN 0xb104c–0xb1087). Thus the timer continues while the value is 15 or less.

### 3.2 Armour (battery)

| Item | Value | Evidence |
|---|---|---|
| Sprites | `ArmorType` 1: `suithelmet_empty`, `suithelmet_full`. Else: `suit_empty`, `suit_full`. | BIN 0xa4a55, hud.txt:135-138 |
| Base y | `y0 = H - fh - fh/2 + (W > 639 ? 3 : 0) + 1`: H − 33 (640), H − 23 (320) | BIN 0xa4bd1 |
| Offset | `iOffset = emptyH / 6`: 4 (640), 2 (320) | BIN 0xa4ba0 |
| x | `W / 5` | BIN 0xa4bf3 |
| Empty icon | box `(W/5, y0 - iOffset, 24, 24)`: (W/5, H − 37) | BIN 0xa4c53 |
| Full icon | Source rect = full rect with `top += (int)(24 * (100 - bat) / 100)` for bat ≤ 99 (no change for bat ≥ 100). Destination y = `y0 - iOffset + (top change)`. Drawn only if the rect height is above 0. The bright part fills from the bottom. | BIN 0xa4a70–0xa4ac8, 0xa4c61–0xa4cca |
| Digit field | 3 cells, flags 5, from `x = W/5 + emptyW`. y = `y0 - 4` (640) or `y0 - 1` (320): H − 37 (640), H − 24 (320). | BIN 0xa4ce5–0xa4d36 |
| Colour | HUD orange always. No red state. | BIN 0xa4ab6–0xa4ad7 |
| Alpha | health fade curve. `fade` is clamped to 100 first. | BIN 0xa4af1–0xa4b47 |
| Trigger | `Battery` message (short). A new value sets `fade = 100`. A value ≤ 0 resets the type to vest. `ArmorType` message (byte): 0 vest, 1 vest and helmet. | BIN 0xa4e20 (0xa4e4c, 0xa4e56), FWGS battery.cpp:132-139 |
| Hidden when | `HIDEHUD_HEALTH`, no suit, spectator | BIN 0xa4a10–0xa4ae2 |

640×480: empty icon (128,443,24,24). With bat = 50 the full icon draws rows 12…23 of its rect at y 455…466. Digit cells x 152, 172, 192 at y 443.

### 3.3 Ammo counter

| Item | Value | Evidence |
|---|---|---|
| Row y | `y = H - fh - fh/2` = H − 37 | BIN 0xa3121 |
| Weapon with a clip (`iClip ≥ 0`) | 1. Clip: 3 cells, flags 5, from `x1 = W - 8*dw - iconW` (W − 184 with a 24 px icon). 2. Bar: `FillRGBA(x2, y, dw/10, fh, 255,160,0, a)` with `x2 = end(clip) + dw/2` (W − 114, size 2×25). 3. Reserve: 3 cells, flags 5, from `x3 = x2 + dw/10 + dw/2` (W − 102). 4. Icon: box `(end(reserve), y - iconH/8, iconW, iconH)` = (W − 42, H − 40, 24, 24). | BIN 0xa314d–0xa3319 |
| Weapon without a clip (`iClip < 0`: grenades, C4) | Reserve: 3 cells from `W - 4*dw - iconW` (W − 104). Icon at (W − 44, H − 40). | BIN 0xa3b03, 0xa3261–0xa3319 |
| Secondary ammo | Only if `iAmmo2Type > 0` and the count > 0. Row `y2 = y - (fh/4 + fh)` = H − 68. Digits from `W - 4*dw - icon2W`. Icon at `y2 - icon2H/8`. CS weapons have no `ammo2` entry (wtxt). | BIN 0xa331f–0xa3414 |
| Draw condition | Primary part only if `iAmmoType > 0`. Nothing if both ammo types are < 0 (knife). | BIN 0xa312d, 0xa3b48 |
| Colour | HUD orange. The bar uses the raw colour with alpha `a`, which is equal to the pre-scaled digits. | BIN 0xa30de–0xa3101, 0xa3227 |
| Alpha | ammo fade curve (§1.4) | BIN 0xa3099–0xa30c0 |
| Trigger | `CurWeapon` for the active weapon sets `fade = 200` (BIN 0xa0007). The server sends it when the clip, the weapon state or the FOV changes (RGD dlls/weapons.cpp:1375-1387). `AmmoX` sets the reserve count without a fade (BIN 0x9fae0). | |
| Hidden when | no suit, `HIDEHUD_WEAPONS` or `HIDEHUD_ALL` | BIN 0xa2fcf |

640×480 (clip weapon): clip cells x 456, 476, 496. Bar box (526,443,2,25). Reserve cells x 538, 558, 578. Icon box (598,440,24,24).

Ammo icons. All are on `640hud7.spr`, 24×24 (wtxt `ammo` lines):

| Ammo type | Rect (x,y) | Weapons (file:line) |
|---|---|---|
| buckshot | 0,72 | m3 (weapon_m3.txt:9), xm1014 (weapon_xm1014.txt:11) |
| .50 AE | 24,72 | deagle (weapon_deagle.txt:9) |
| 9 mm | 48,72 | glock18 (:9), mp5navy (:9), tmp (:9), elite (:9) |
| 7.62 mm | 72,72 | ak47 (:9), scout (:11), g3sg1 (:11) |
| .45 ACP | 96,72 | usp (:9), mac10 (:9), ump45 (:9) |
| .357 SIG | 120,72 | p228 (:9) |
| 5.56 mm | 0,96 | aug (:7), famas (:15), galil (:9), m4a1 (:9), sg550 (:11), sg552 (:7), m249 (:9) |
| .338 Magnum | 24,96 | awp (:11) |
| flashbang | 48,96 | flashbang (:9) |
| HE grenade | 72,96 | hegrenade (:9) |
| C4 | 96,96 | c4 (:7) |
| 5.7 mm | 120,96 | fiveseven (:9), p90 (:9) |
| smoke grenade | 144,96 | smokegrenade (:9) |

### 3.4 Pickup history

| Item | Value | Evidence |
|---|---|---|
| Rows | 12 at most. Each row lives `hud_drawhistory_time` = 5 s. | FWGS ammohistory.h:112, BIN 0x9d290 |
| Row gap | `gap = max(bucketH, weapon_s height)` = 45 (640) | BIN 0x9f605–0x9f612, 0x9ebc0 (LoadWeaponSprites) |
| Row y | `H - 72 - 2*gap - i*(gap + 5)` = H − 162 − 50·i | BIN 0xa45da, 0xa4706, 0xa482b |
| Ammo row | icon at x = W − 24. Count as `"%d"` in the engine font (`pfnDrawStringReverse`), right-aligned to end at W − 24. BIN passes a min x of W − 124 but does not use it. | BIN 0xa4833–0xa4879, 0xb5b60 |
| Weapon row | `weapon` sprite (170×45) at x = W − width. Alert red if the weapon has no ammo. | BIN 0xa451a–0xa4646 |
| Item row | hud.txt sprite (for example `item_battery`) at x = W − width − 10 | BIN 0xa4658–0xa477e |
| Colour | HUD orange scaled by `min(255, (int)(80 * timeLeft))`. Full brightness until 3.19 s remain, then a linear fade to 0. | BIN 0xa47b7–0xa4809 |
| Trigger | `AmmoPickup`, `WeapPickup`, `ItemPickup` messages | FWGS ammo.cpp:519-556 |

### 3.5 Money (account)

| Item | Value | Evidence |
|---|---|---|
| Sprites | `dollar`, `plus`, `minus`, digits | BIN 0x9c4c0, hud.txt:122-124 |
| Field x | `x = W - (W > 639 ? 16 : 12) - 5*dw`: W − 116 (640), W − 72 (320) | BIN 0x9cb67 |
| Row y | suit: `H - 3*fh` = H − 75. No suit: `H - 5*fh`. | BIN 0x9cb67 |
| Dollar box | `(x - 18, y, 18, 25)` = (W − 134, H − 75) | BIN 0x9cbfa |
| Digits | `"%5i"` field, 5 cells: x … x + 100 (W − 116 … W − 16) | BIN 0x9cc2e, 0xb5c40 |
| Delta row | Only if the `Money` message flag byte is not 0 and the value changed. Row `yd = y - (fh/2 + fh)` = H − 112. Sign `plus` (delta > 0) or `minus` (delta < 0) at `(x - signW, yd)`. Value `abs(delta)` with `"%5i"` at x. | BIN 0x9cc38–0x9cd0b, 0xa3b80 |
| Colour | `t = fade / 5` (1 at the change, 0 after 5 s). Gain: RGB = `((int)(255*(1-t)), (int)(160*(1-t) + 255*t), 0)`, green to orange. Loss: RGB = `(255, (int)(160*(1-t)), 0)`, red to orange. No change: HUD orange. Then `ScaleColors` with the money alpha (§1.4). | BIN 0x9c972–0x9ca4b |
| Delta colour | The money colour, then `ScaleColors((int)(256 * fadeFast / 2.5))`. `fadeFast = 2.5` s at the change. The delta row disappears after 2.5 s. | BIN 0x9ca68–0x9cace, 0xa3be7 |
| Blink | `BlinkAcct(n)` sets `count = 2n`. Every 0.1 s the count decreases by 1. An odd count draws HUD orange at alpha 255. Thus n bright flashes in `0.2*n` s. | BIN 0xa3bf0, 0x9cada–0x9cd68 |
| Trigger | `Money` message: long account, byte "track change" (RGD dlls/player.cpp:3568-3571). RGD blinks 2 times and prints `#Not_Enough_Money` when a purchase fails (dlls/client.cpp:1570-1571, dlls/client.h:128). | |
| Hidden when | `HIDEHUD_MONEY`, spectator, HLTV | BIN 0x9cb19–0x9cb1f |

640×480 (suit): dollar box (506,405,18,25). Digit cells x 524, 544, 564, 584, 604 at y 405. Delta row y 368, `plus` at x 507, `minus` at x 511.

### 3.6 Round timer

Section 8 marks this element as not applicable. It is here for reference.

| Item | Value | Evidence |
|---|---|---|
| Trigger | `RoundTime` message (short seconds). The next draw sets `end = now + seconds`. Panic state resets. | BIN 0xb0090, 0xadfb0–0xadfb8 |
| Hidden when | `HIDEHUD_TIMER`, a VGUI panel is open, or the bomb is planted | BIN 0xadfc6–0xadfe8 |
| x | `(W - dw * (W <= 639 ? 5 : 4)) / 2` = W/2 − 40 (640) | BIN 0xae0fc |
| y | suit: `H - fh - fh/2` = H − 37. No suit: 42. | BIN 0xae0b6, 0xae406 |
| Stopwatch | `stopwatch` box `(x - 24, y, 24, 24)`, only if W > 399 | BIN 0xae10e–0xae171, hud.txt:127 |
| Format | minutes flags 3, colon `:` in the engine font at `y - (engineFontH - fh)/2 - 1`, seconds flags 11 (leading zero) | BIN 0xae1ca–0xae29f |
| Colour | normal: HUD orange at alpha 100 (100,62,0). Panic: alert red at full value. | BIN 0xae07a–0xae3e5 |
| Panic toggle | remaining ≤ 0: red. ≤ 2 s: toggle every 0.05 s. 3–5 s: 0.1 s. 6–10 s: 0.2 s. 11–20 s: 0.4 s. 21–30 s: 0.8 s. More than 30 s: no toggle. | BIN 0xae009–0xae34f |

### 3.7 Progress bar

Section 8 marks this element as not applicable. `BarTime` (short seconds, 0 means hide) starts the bar (BIN 0xb00e0). The box is `x0 = W/4`, width `W/2`, `y0 = H/2 + 64`, height 10 (BIN 0xaee68–0xaeeb7). The frame is 1 px `FillRGBA(255,160,0, 80)`. The fill is `FillRGBA(255,160,0, 160)` at `(x0 + 2, y0 + 2, (width - 4) * progress, 6)` (BIN 0xadd80).

### 3.8 Radar

| Item | Value | Evidence |
|---|---|---|
| Owner | drawn by the health element. Needs the player alive, radar on (`drawradar`/`hideradar` commands), no `HIDEHUD_HEALTH`, no spectator. | BIN 0xb1011–0xb1141 |
| Background | `cl_radartype 0`: `radar` (radar640.spr, additive) with colour (25,75,25) at (0,0). `cl_radartype 1`: `radaropaque` (alphatest, `SPR_DrawHoles`) with colour (200,200,200). BIN forces both rects to (0,0,128,128). | BIN 0xb05c8–0xb0615, 0xad92a–0xad992, hud.txt:183, 195 |
| 320 set | radar320.spr, 64×64 | hud.txt:89 |
| Teammate position | `dx, dy` = teammate − self (2-D). `dist = sqrt(dx² + dy²)`. `angle` = `atan(dy/dx)` in degrees, then +180 if dx < 0, else +360 if dy < 0. `rot = viewYaw - angle`. `X = dist*sin(rot)`, `Y = -dist*cos(rot)`. | BIN 0xb065b–0xb0764 |
| Range and scale | If `dist > 2048` (640) or 1024 (320), scale X and Y by `range/dist`. Pixel = `centre + (int)(X/32)`, `centre + (int)(Y/32)`. Centre 64 (640) or 32 (320). Skip a dot outside 0…128 (or 0…64). | BIN 0xb076c–0xb0810 |
| Dot | `FillRGBA(x, y, s, s)` with s = 2 (640) or 1 (320) | BIN 0xb01a0 (normal path), 0xb0d20, 0xb0792 |
| Height cue | `dz` = teammate z − self z. dz > 128: bar 5×1 at (x − 2, y) and a line 1×(len + 2s − 1) below it ("T"). dz < −128: line 1×(2s + len) from (x, y), then bar 5×1 at the bottom. `len = min(7, (int)(abs(dz)/400))`. | BIN 0xb01a0 |
| Colours (alpha 235) | teammate (150,75,250). Bomb carrier (seen by T) or VIP (seen by CT) (250,0,0). Player marked with `trackplayer` (`m_bTrackArray`, CHudHealth+0x34) (185,20,20) with size 4 (640). | BIN 0xb0810–0xb0879, IDA type CHudHealth |
| Flash | A flashing dot (radio) draws a second square `(x-3, y-3, s+3, s+3)` in (230,110,25), alpha 245, toggled every 0.15 s | BIN 0xb08e5–0xb0928, 0xb0e5d–0xb0ebe |
| Location text | localized location name, VGUI2 font, centred at x = 64, y = 128 + textH/2 (640), colour (0,204,0) | BIN 0xb0bcc–0xb0c97 |
| Update rate | The view position and yaw are local and change every frame. The server sends a teammate position (`Radar` message) every 1 s, and only after 64 units of movement. | RGD dlls/player.cpp:7906, 7913-7914 |

### 3.9 Death notices (kill feed)

| Item | Value | Evidence |
|---|---|---|
| Lines | 4 at most. A new line pushes the oldest out. | BIN 0xa603f–0xa608a |
| Lifetime | `hud_deathnotice_time`, default 6 s | BIN 0xa5a47, 0xa61e6–0xa621e |
| Scale | `s(n) = (int)(n * H / min(H, 480))`. This is `GetProportionalScaledValue` (VGUI2 0x129f0–0x12a47) with base 640×480 (HW 0x1c5c02, 0x1c5c09) clamped to the screen (HW 0x1c2b20). | |
| Metrics | top `s(32)`, line step `s(16)`, right margin `s(12)`, gap `s(5)` | BIN 0xa5a4d–0xa5aae |
| Line y | `s(32) + i * s(16)` (i = 0 is the oldest). A spectator uses the spectator-bar height instead of `s(32)`. | BIN 0xa5b9f, 0xa5b35 |
| Layout | Left to right: killer name, gap `s(5)`, weapon icon, gap, then headshot icon and gap (if any), then victim name. The victim name ends at `W - s(12)`. A suicide has no killer name and no first gap. All parts share the line y. | BIN 0xa5bdd–0xa5dd3 |
| Name font | engine console font, colour by team: `CSWTCH.37[team - 1]` for teams 1…4, else grey (§1.3) | BIN 0xa60c6–0xa60df, 0xa6133–0xa614c |
| Icon | `d_<weapon>` from the `DeathMsg` string. An unknown name (for example `world`, `c4`) uses `d_skull`. Colour: kill icon, or team-kill icon when the string is `teammate`. | BIN 0xa61c0–0xa61c8, 0xa5bae, 0xa5c5b |
| Headshot | `d_headshot` after the weapon icon, same colour | BIN 0xa61ce–0xa6345, 0xa5d13–0xa5d5c |
| Non-player victim | victim byte 255: the name is the weapon string without `d_` | BIN 0xa6107–0xa638b |
| Message | `DeathMsg`: byte killer, byte victim, byte headshot, string weapon | BIN 0xa5fc5–0xa5fe3 |

Values: H = 480 gives top 32, step 16, margin 12, gap 5. H = 768 gives 51, 25, 19, 8. H = 1080 gives 72, 36, 27, 11.

Death icons (all 16 px high):

| Icon | File | x,y,w | Line |
|---|---|---|---|
| `d_knife` | 640hud1 | 192,0,48 | 150 |
| `d_ak47` | 640hud1 | 192,80,48 | 151 |
| `d_awp` | 640hud1 | 192,128,48 | 152 |
| `d_deagle` | 640hud1 | 224,16,32 | 153 |
| `d_famas` | 640hud2 | 192,144,48 | 154 |
| `d_fiveseven` | 640hud16 | 192,0,32 | 155 |
| `d_flashbang` | 640hud1 | 192,192,48 | 156 |
| `d_g3sg1` | 640hud1 | 192,144,48 | 157 |
| `d_galil` | 640hud2 | 192,160,48 | 158 |
| `d_glock18` | 640hud1 | 192,16,32 | 159 |
| `d_grenade` | 640hud1 | 224,192,32 | 160 |
| `d_m249` | 640hud1 | 192,160,48 | 161 |
| `d_m3` | 640hud1 | 192,48,48 | 162 |
| `d_m4a1` | 640hud1 | 192,96,48 | 163 |
| `d_mp5navy` | 640hud1 | 192,64,32 | 164 |
| `d_p228` | 640hud1 | 224,32,32 | 165 |
| `d_p90` | 640hud1 | 192,176,48 | 166 |
| `d_scout` | 640hud1 | 192,208,48 | 167 |
| `d_sg550` | 640hud16 | 192,48,48 | 168 |
| `d_sg552` | 640hud1 | 192,112,48 | 169 |
| `d_ump45` | 640hud16 | 192,80,48 | 170 |
| `d_usp` | 640hud1 | 192,32,32 | 171 |
| `d_tmp` | 640hud1 | 224,64,32 | 172 |
| `d_xm1014` | 640hud1 | 192,224,48 | 173 |
| `d_skull` | 640hud1 | 224,240,32 | 174 |
| `d_tracktrain` | 640hud1 | 192,240,32 | 175 |
| `d_aug` | 640hud1 | 148,240,44 | 176 |
| `d_mac10` | 640hud1 | 109,240,34 | 177 |
| `d_elite` | 640hud1 | 52,240,57 | 178 |
| `d_headshot` | 640hud1 | 0,240,36 | 179 |

`scripts/cs16/killfeed.as:47-83` already has this table.

### 3.10 Status icons

| Item | Value | Evidence |
|---|---|---|
| Slots | 4. A new icon goes to the first free slot, else slot 0. | BIN 0xc7d00 |
| x | `crossW / 2` = 12 (aligned with the health cross) | BIN 0xc7a10, 0xc7b2e |
| y | starts at `H/2`. Before each icon: `y -= iconH + 5`. Icons stack upward. | BIN 0xc7b3e, 0xc7b87 |
| Colour | the colour from the message | BIN 0xc7baf |
| Flash | status 2 = flash. Every 0.1 s the phase toggles. In the off phase the icon draws (250,0,0). | BIN 0xc7b4d–0xc7c08, 0xc802f |
| Message | `StatusIcon`: byte status (0 off, 1 on, 2 flash), string sprite name, then bytes r, g, b if on | BIN 0xc7f40 |
| Sound | a name that contains `grenade` plays `weapons/timer.wav` | BIN 0xc7d00 |

640×480: the first 32×32 icon is at (12,203).

### 3.11 Weapon selection menu

| Item | Value | Evidence |
|---|---|---|
| Origin | x0 = 138 (W ≥ 640) or 70 (W < 640): 10 px right of the radar | BIN 0xa2608–0xa260d, 0xa274a–0xa2759 |
| Bucket row | 5 buckets (`bucket1`…`bucket5`) at y = 10, HUD orange at alpha 255. Step: width + 5. The active bucket is as wide as the first weapon picture (170). Others: 20. | BIN 0xa266c–0xa2731 |
| Active slot | Pictures from y = bucketH + 10 = 30, step 45 + 5. Selected weapon: `weapon_s` and the `selection` frame on top. Others: `weapon`. Colour: HUD orange at 192 with ammo, alert red at 128 without ammo. | BIN 0xa2946–0xa2b90 |
| Ammo bar | on each active-slot picture at (x + 10, y + 3), 20×4 (W ≥ 640) or 10×2. Filled part `FillRGBA(0,160,0, 255)` of width `max(1, (int)(20 * min(1, reserve/max)))`. Rest `FillRGBA(255,160,0, 128)`. A second bar for `ammo2` follows after 5 px. No bar when the reserve count is 0 or the weapon has no ammo type. | BIN 0xa2a2d, 0x9f656–0x9f686, 0xa1ba0 |
| Other slots | one box `FillRGBA(x, y, 20, 20)` for each weapon: (255,160,0, 128) with ammo, (255,16,16, 96) without. Step 25. | BIN 0xa2788–0xa28bd |
| Input | `slot1`…`slot10`, `invnext`, `invprev`, `cancelselect`, `hud_fastswitch` (client commands) | BIN 0x9d290, FWGS ammo.cpp:437-498 |
| Sounds | `common/wpn_hudon.wav`, `wpn_moveselect.wav`, `wpn_select.wav`, `wpn_hudoff.wav` | FWGS ammo.cpp:462, 480, 406, 896 |

### 3.12 Crosshair

#### 3.12.1 When CS draws it

1. The dynamic crosshair draws when all these conditions are true (BIN 0xa2fcf–0xa304f):
   - the ammo element is visible: suit present, `HIDEHUD_WEAPONS` and `HIDEHUD_ALL` clear (a spectator in first-person view skips this test),
   - `m_iFOV > 54`,
   - the weapon is not Scout (3), SG550 (13), AWP (18) or G3SG1 (24). BIN uses the bit mask `0x1042008`.
   - `HIDEHUD_CROSSHAIR` is clear.
2. When `m_iFOV < 90`, `CurWeapon` also sets the engine sprite crosshair. That sprite is the weapon's `zoom` entry, else its `crosshair` entry (BIN 0x9ff87–0xa00d6, 0x9ebc0). For CS weapons it is `crosshairs.spr` (24,0,24,24) (for example weapon_ak47.txt:10). This region is the Half-Life 9 mm cross: four short ticks (TOOL, Appendix A.4). The engine draws this sprite only when the engine cvar `crosshair` is 1 (default 1, cstrike/config.cfg:115).
3. When `m_iFOV ≥ 90`, `CurWeapon` clears the engine crosshair (BIN 0x9ff87).

#### 3.12.2 Inputs

| Input | Source | Evidence |
|---|---|---|
| Weapon id | `CurWeapon` | RGD dlls/weapontype.h:30-64 |
| Weapon state `g_iWeaponFlags` | predicted weapon state: 1 USP silenced, 2 Glock burst, 4 M4A1 silenced, 8 Elite left, 16 FAMAS burst, 32 shield drawn | FWGS cs_wpn/cs_weapons.cpp:1199, RGD dlls/weapontype.h:145-150 |
| Player flags | `FL_ONGROUND` 512, `FL_DUCKING` 16384 | FWGS cs_wpn/cs_weapons.cpp:1232, FWGS ../common/const.h:32, 37 |
| Speed | 3-D velocity length `sqrt(vx² + vy² + vz²)` | BIN 0x68345–0x68369, FWGS cs_wpn/cs_weapons.cpp:1234 |
| Shots fired | `g_iShotsFired`, +1 in every local `EV_Fire*` event | BIN xrefs to 0x1e6b84 (EV_FireAK47 0x70687 and others) |

#### 3.12.3 Minimum gap g

Base gap and shot delta by weapon id (`CSWTCH.196` at BIN 0x185ec0 and `CSWTCH.197` at BIN 0x185e40, indexed by id − 1). Unknown ids use base 4 and delta 3 (BIN 0xa1ec5–0xa2276).

Accuracy flags (`GetWeaponAccuracyFlags`, BIN 0xa1df0): 1 jump, 2 run, 4 duck, 8 inaccurate, 16 very inaccurate.

| Id | Weapon | Base | Delta | Flags | Run limit |
|---|---|---|---|---|---|
| 1 | P228 | 8 | 3 | 7 | 0 |
| 3 | Scout | 5 | 3 | 0 | – |
| 4 | HE grenade | 8 | 3 | 0 | – |
| 5 | XM1014 | 9 | 4 | 0 | – |
| 6 | C4 | 6 | 3 | 0 | – |
| 7 | MAC-10 | 9 | 3 | 1 | – |
| 8 | AUG | 3 | 3 | 3 | 140 |
| 9 | Smoke grenade | 8 | 3 | 0 | – |
| 10 | Elites | 4 | 3 | 0 | – |
| 11 | Five-SeveN | 8 | 3 | 7 | 0 |
| 12 | UMP45 | 6 | 3 | 1 | – |
| 13 | SG550 | 5 | 3 | 0 | – |
| 14 | Galil | 4 | 3 | 3 | 140 |
| 15 | FAMAS | 4 | 3 | 3, burst: 19 | 140 |
| 16 | USP | 8 | 3 | 7, silenced: 15 | 0 |
| 17 | Glock18 | 8 | 3 | 7, burst: 23 | 0 |
| 18 | AWP | 8 | 3 | 0 | – |
| 19 | MP5-Navy | 6 | 2 | 1 | – |
| 20 | M249 | 6 | 3 | 3 | 140 |
| 21 | M3 | 8 | 6 | 0 | – |
| 22 | M4A1 | 4 | 3 | 3, silenced: 11 | 140 |
| 23 | TMP | 7 | 3 | 1 | – |
| 24 | G3SG1 | 6 | 4 | 0 | – |
| 25 | Flashbang | 8 | 3 | 0 | – |
| 26 | Desert Eagle | 8 | 3 | 7 | 0 |
| 27 | SG552 | 5 | 3 | 3 | 140 |
| 28 | AK-47 | 4 | 4 | 3 | 140 |
| 29 | Knife | 7 | 3 | 0 | – |
| 30 | P90 | 7 | 3 | 3 | 170 |

The run limit comes from `CSWTCH.178` (BIN 0x185f40, indexed by id − 8). Ids below 8 use 0.

Computation of g for one frame (BIN 0xa1ee4–0xa1f7b, 0xa2552–0xa25ac). It applies only if the flags are not 0, `cl_dynamiccrosshair` is not 0, and `HIDEHUD_WEAPONS` is clear:

1. Start with `g = base`.
2. If the player is not on the ground and flag 1 is set: `g = (int)(g + g)`.
3. Else, if the player is ducking and flag 4 is set: `g = (int)(g * 0.5)`.
4. Else, if `(int)speed > runLimit` and flag 2 is set: `g = (int)(g * 1.5)`.
5. If flag 8 is set: `g = (int)(g * 1.4)`.
6. If flag 16 is set: `g = (int)(g * 1.4)`.

The comparison in step 4 is strict and uses the truncated speed. With run limit 0, any speed of 1 unit/s or more counts as running. Appendix A.2 gives g for each weapon and pose.

#### 3.12.4 Distance, length and alpha per frame

State: `distance` (float, starts at 0), `alpha` (int, starts at 200), `lastCheck` (int, starts at 0) (BIN 0x9d290). Each HUD frame (BIN 0xa1f80–0xa2024):

1. If `lastCheck >= shotsFired`: `distance -= 0.013 * distance + 0.1` and `alpha += 2`.
2. Else (a new shot): `distance = min(distance + delta, 15)` and `alpha = max(alpha - 40, 120)`.
3. If `shotsFired > 600`, set `shotsFired = 1`.
4. Set `lastCheck = shotsFired`.
5. Set `distance = max(distance, g)`.
6. Set `alpha = min(alpha, 255)`.
7. Set `length = (int)((distance - g) * 0.5) + 5`.

The decay runs once for each client frame. It depends on the frame rate. The CS default is `fps_max 100` (cstrike/config.cfg:119). Appendix A.2 has a frame-by-frame AK-47 vector at 100 fps.

#### 3.12.5 Resolution scale

`cl_crosshair_size` selects a base width (BIN 0xa1870). The BIN default is `"0"` (BIN 0x9d290), which is the same as `auto`. The CS config default is `auto` (cstrike/config.cfg:85).

| Value | Base |
|---|---|
| `auto` or `0` | W ≤ 640: 1024. 641 ≤ W ≤ 1023: 800. W ≥ 1024: 640 (BIN 0xa18e0–0xa18fa, 0xa19a4, 0xa19ca) |
| `small` or `1` | 1024 |
| `medium` or `2` | 800 |
| `large` or `3` | 640 |
| other | prints the usage text, no change |

If `W != base`: `d = (int)(distance * W / base)` and `len = (int)(W * length / base)` (integer multiply, then divide). Else `d = (int)distance`, `len = length` (BIN 0xa205d–0xa207b). TOOL (Appendix A.2): distance 8 and length 7 give gap/length 5/4 at 640, 8/7 at 800, 12/11 at 1024, 16/14 at 1280, 24/21 at 1920.

#### 3.12.6 Geometry and colour

Four lines, 1 px thick, around the centre column `cx = W/2` and row `cy = H/2` (BIN 0xa20ff–0xa23a3):

| Line | Box (x, y, w, h) |
|---|---|
| West | `(cx - d - len + 1, cy, len, 1)` |
| East | `(cx + d, cy, len, 1)` |
| North | `(cx, cy - d - len + 1, 1, len)` |
| South | `(cx, cy + d, 1, len)` |

The inner end of each line is d pixels from the centre pixel. The four lines are symmetric.

| Item | Value | Evidence |
|---|---|---|
| Colour | `cl_crosshair_color` "r g b", each value clamped to 0…255. A change of the string is read again. | BIN 0xa1680 |
| Translucent | `cl_crosshair_translucent 1` (default): `FillRGBA` (additive). `0`: `FillRGBABlend`. Other values print the usage text. | BIN 0xa2027–0xa222c, 0x9d290 |
| Alpha | the `alpha` state (120…255) | BIN 0xa2083 |
| Night vision | colour (250,50,50) with `FillRGBABlend` | BIN 0xa2088–0xa2540 |
| `adjust_crosshair` | cycles 5 colours: (50,250,50), (250,50,50), (50,50,250), (250,250,50), (50,250,250). An argument 5…9 selects the same colours with translucent 0. The command writes `cl_crosshair_color` and `cl_crosshair_translucent`. | BIN 0xa1350, FWGS ammo.cpp:822-887 |

640×480 with `auto` (base 1024), AK-47 at rest: d = 2, len = 3. West box (316,240,3,1). East box (322,240,3,1). North box (320,236,1,3). South box (320,242,1,3).

### 3.13 Flashlight

| Item | Value | Evidence |
|---|---|---|
| Sprites | `flash_empty` (casing), `flash_full` (energy), `flash_beam` | BIN 0xa7c80, hud.txt:139-141 |
| y | `(emptyBottom - fullTop) / 2` = 16 (640) | BIN 0xa7e81 |
| Casing | box `(W - w - w/2, 16, 32, 32)` with w = full width 32: (W − 48, 16) | BIN 0xa7e8e–0xa7ece |
| Beam | only when on: box `(W - w/2, 16, 16, 32)` = (W − 16, 16) | BIN 0xa7fc2–0xa8006 |
| Energy | `bat` = battery % / 100. `off = (int)((1 - bat) * 32)`. If off < 32: full rect with `left += off`, drawn at x = W − 48 + off. The bright part shrinks from the left. | BIN 0xa7ee5–0xa7f7d |
| Colour | HUD orange. Battery < 20 %: alert red. | BIN 0xa7e07–0xa7e37 |
| Alpha | on: 225. Off: 100. | BIN 0xa7e07 |
| Trigger | `Flashlight` (byte on, byte battery %) and `FlashBat` (byte battery %) | BIN 0xa80b0, 0xa8070, FWGS flashlight.cpp:64-83 |
| Hidden when | `HIDEHUD_FLASHLIGHT` or `HIDEHUD_ALL`, the VGUI viewport check fails (a panel is open), no suit, spectator | BIN 0xa7d97 and the viewport call that follows |

### 3.14 Pain arrows and damage-type icons

Pain arrows (BIN 0xaf6f0):

| Arrow | Frame of `sprites/640_pain.spr` | Position |
|---|---|---|
| Front | 0 (128×48) | `(W/2 - frameW/2, H/2 - 3*frameH)` |
| Right | 1 (48×128) | `(W/2 + 2*frameW, H/2 - frameH/2)` |
| Rear | 2 (128×48) | `(W/2 - frameW/2, H/2 + 2*frameH)` |
| Left | 3 (48×128) | `(W/2 - 3*frameW, H/2 - frameH/2)` |

- Frame sizes: TOOL (Appendix A.3). The file exists only in `valve/sprites`.
- An arrow draws while its strength is above 0.4. The strength decreases by `2 * dt` each frame (BIN 0xaf768).
- Colour: HUD orange (health > 25) or low red. Alpha: 127 if the strength is below 0.5, else `(int)(strength * 255)` (BIN 0xafb44–0xafba5).
- The `Damage` message sets the strengths from the damage origin. Within 50 units, all four arrows get strength 1 (FWGS health.cpp:293-329).

Damage-type icons (BIN 0xafd50, 0xada80):

- A new type gets a 64×64 tile at `(64/8, H - 2*64)` = (8, H − 128). Older tiles move up by 64 (BIN 0xafd8c–0xafdef).
- Colour: HUD orange scaled by `(int)(abs(sin(2t)) * 256)` (a pulse). The life is 2 s. A tile disappears only when it expired and the pulse alpha is 39 or less (BIN 0xadab1–0xadbf9).
- Sprites: `dmg_*` in `640hud8`/`640hud9`, which exist only in `valve/sprites` (hud.txt:101-109).

### 3.15 Text elements

| Element | CS behaviour | Evidence |
|---|---|---|
| `TextMsg` destination 4 (centre) | localized, centred (x = −1) at `y = (int)(0.35 * H)`, VGUI2 HUD font, colour (1.0, 0.706, 0.118), visible 4 s, no fade | BIN 0xce3e0 (case 4), 0xbd790 (0xbd81b) |
| `TextMsg` destination 3 (talk) and 5 | chat area | BIN 0xce3e0 (cases 3, 5) |
| `TextMsg` destinations 1, 2 | console only | BIN 0xce3e0 (cases 1, 2) |
| Chat (`SayText`) | `CHudSayText::GetTextPrintY` returns `H - (int)(2.75 * fh) - (5 * lineH + (int)(0.5 * lineH))`. A spectator uses the spectator-bar height instead of `2.75 * fh`. | BIN 0xc5700 |
| Player id (`StatusText`, `StatusValue`) | `hud_centerid 0` (default): x = 10, y = `H - (int)(2.75 * fh)`. Else centred at `y = H/2 + hud_centerid * textH`. Console font. Names in team colours, default yellow. | BIN 0xc8bb0, cstrike/config.cfg:147 |
| `HudText` and `game_text` | Half-Life titles.txt message engine (x and y fractions, effects 0/1/2, fade times) | BIN 0x92ab0, 0x921f0, FWGS message.cpp |
| Text menu (`ShowMenu`) | x = 20. First line y = `H/2 - charH * (newlines/2) - (3*charH + charH/3)` with `charH = max(12, engine char height)`. Line step `charH + 2`. Default white. Codes `\w` `\y` `\r` `\d` (§1.3). `\R` right-aligns the rest of the line at x = W/2. Hidden while a VGUI panel is open. | BIN 0xc3d90–0xc40c0 |

### 3.16 Other CS screen parts

| Part | CS behaviour | Evidence |
|---|---|---|
| Scoreboard | VGUI2 dialog, not a HUD element | BIN `CCSClientScoreBoardDialog` 0x8bf50 |
| MOTD | VGUI2 HTML window | BIN `CClientMOTD` 0x176590 |
| Sniper scope | overlay drawn by `CHudSniperScope` | BIN 0xc7210 |
| Night vision | green screen overlay | BIN 0xc4810 |
| Scenario status | hostage and bomb icons | BIN 0xc6df0, hud.txt:184-194 |
| Train | Half-Life train speed icons | BIN 0xcecb0, hud.txt:142-146 |

## 4. Server-side data sources

| Element | CS input | Sven AngelScript source |
|---|---|---|
| Health | `Health` byte | `pPlayer.pev.health` |
| Armour | `Battery` short, `ArmorType` byte | `pPlayer.pev.armorvalue`. Co-op has no helmet flag: use the vest set, or a plugin flag when the buy menu sells a helmet. |
| Ammo | `CurWeapon`, `AmmoX` | `pPlayer.m_hActiveItem` → `CBasePlayerWeapon.m_iClip` (API:24419), `PrimaryAmmoIndex()` (API:23581), `pPlayer.m_rgAmmo(index)` (API:13000) |
| Money | `Money` | BuyMenu points (`scripts/cs16/BuyMenu.as:111-127`) |
| Flashlight | `Flashlight`, `FlashBat` | `pPlayer.FlashlightIsOn()` (API:12925), `pPlayer.m_iFlashBattery` (API:14468) |
| Crosshair | weapon id, weapon state, flags, speed, shots | weapon classname mapped to a CS id (the names in `killfeed.as:86-115`), `pev.flags`, `pev.velocity.Length()`, a shot counter that the weapon fire code increments, `pPlayer.m_iFOV` (API:14393) |
| Death notices | `DeathMsg` | existing hooks in `killfeed.as:384-466` |
| Radar | teammate origins, own yaw | `pev.origin` of each player, `pev.v_angle.y` of the viewer |

## 5. Mapping to the Sven AngelScript HUD API

### 5.1 API facts (from the dump)

| Fact | Evidence |
|---|---|
| `HudNumDisplay`, `HudUpdateNum`, `HudTimeDisplay`, `HudUpdateTime`, `HudCustomSprite`, `HudToggleElement`, `HudMessage` exist | API:1924-1969 |
| `channel` range 0-15, "each module type has its own channel group" (numeric, time and sprite displays) | API:2130-2131, API:2253-2254 |
| `HUDTextParams.channel` is 1-4 | API:2286-2287 |
| `left` and `top` are `uint8` (0-255). `width` and `height` are `int16` (0-512, 0 = whole sprite). | API:2228-2238, API:2045-2055 |
| Sprite displays have `frame`, `numframes`, `framerate` | API:2188-2198 |
| `x`, `y`: 0…1 from the top-left, −1…0 from the right or bottom, −1 centred | API:2213-2219 (HUDSpriteParams) |
| `HUD_ELEM_ABSOLUTE_X` 1, `HUD_ELEM_ABSOLUTE_Y` 2, `SCR_CENTER_X` 4, `SCR_CENTER_Y` 8, `NO_BORDER` 16, `HIDDEN` 32, `EFFECT_ONCE` 64, `DEFAULT_ALPHA` 128, `DYNAMIC_ALPHA` 256 | API:33329-33377 |
| `HUD_SPR_OPAQUE` 65536, `HUD_SPR_MASKED` 131072, `HUD_SPR_PLAY_ONCE` 262144, `HUD_SPR_HIDE_WHEN_STOPPED` 524288 | API:33296-33314 |
| `HUD_NUM_RIGHT_ALIGN` 65536, `SEPARATOR` 131072, `DONT_DRAW_ZERO` 262144, `LEADING_ZEROS` 524288, `NEGATIVE_NUMBERS` 1048576, `PLUS_SIGN` 2097152 | API:33251-33281 |
| Effects: 0 none, 1 ramp up (color1→color2), 2 ramp down (color2→color1), 3 triangle, 4 cosine up, 5 cosine down, 6 cosine, 7 toggle, 8 sine pulse | API:33392-33440 |
| Sven `m_iHideHUD` bits: 1 weapons (menu and crosshair), 2 flashlight, 4 all, 8 health, 16 weapon select, 32 suit power (armour), 64 custom map elements, 128 custom plugin elements, 256 crosshair, 512 ammo | API:33119-33179 |

The existing code uses these conventions: sprite name `cs16/<file>.spr` relative to `sprites/` (`killfeed.as:36`, `BuyMenu.as:66`, `base.as:134-135`), precache of `sprites/cs16/<file>.spr` (`killfeed.as:201-203`, `BuyMenu.as:586`).

### 5.2 Assumptions (all UNVERIFIED)

Another agent reverse-engineers the Sven client. Every row below needs that work before an implementation depends on it.

| Id | Assumption |
|---|---|
| U1 | With `ABSOLUTE_X` and x ≥ 0, the element's left edge is x pixels from the left screen edge. The same rule applies to y. |
| U2 | With `ABSOLUTE_X` and x < 0, the anchor is the right screen edge. It is not known if x sets the element's left edge (`W + x`) or its right edge (`W + x` minus the width, as Half-Life `HudMessage` does). This spec gives every box with both edges so that either rule works. |
| U3 | With `SCR_CENTER_X`/`SCR_CENTER_Y`, x and y are offsets from `W/2`, `H/2`. It is not known if the offset places the element's top-left corner or its centre. |
| U4 | Sven draws custom sprites at 1:1 pixel size at every resolution (like CS). |
| U5 | Sven draws custom sprites additively. `color1` RGB multiplies the sprite. It is not known if the alpha also multiplies. |
| U6 | `HUD_ELEM_NO_BORDER` removes the `hud_bordersize` offset (default 16). |
| U7 | `left`, `top`, `width`, `height` select a sub-rectangle. A width or height smaller than the sprite crops it. |
| U8 | With `framerate` 0, `frame` selects one static frame of a multi-frame sprite. |
| U9 | Effect 2 interpolates linearly from `color2` to `color1` in `fxTime` seconds, and `EFFECT_ONCE` keeps `color1` after the end. It is not known if Sven interpolates before or after the alpha multiply. |
| U10 | A `holdTime` long enough (or 0) keeps an element visible until the plugin replaces or hides it. |
| U11 | Numeric, time and sprite displays have separate groups of 16 channels. |
| U12 | `HudNumDisplay` draws its digits with Sven's own `number_0`…`number_9` (svencoop/sprites/hud.txt:24-33: 640hud7, 20×20 cells, step 20), not with CS digits (20×25 glyphs, hud.txt:110-119). |
| U13 | `HudMessage` channels 1-4 are shared with map `game_text` entities. A negative x right-aligns each line (Half-Life `CHudMessage::XPosition`). |
| U14 | `m_iHideHUD` bits stay set until code clears them. Sven can reset them on spawn or in map scripts. |
| U15 | `HIDEHUD_HEALTH` (8) also hides Sven's pain arrows and damage-type icons, as in Half-Life. |
| U16 | A fraction x of 0.2 gives the same pixel as `W / 5`. |

### 5.3 Native Sven elements to hide

Set these bits in `CBasePlayer.m_iHideHUD` (API:14398):

| Bit | Sven name | Reason |
|---|---|---|
| 8 | `HIDEHUD_HEALTH` | replaced by §3.1 |
| 32 | `HIDEHUD_SUITPOWER` | replaced by §3.2 |
| 512 | `HIDEHUD_AMMO` | replaced by §3.3 |
| 2 | `HIDEHUD_FLASHLIGHT` | replaced by §3.13 |
| 256 | `HIDEHUD_CROSSHAIR` | replaced by §3.12 |

The sum is 810. Rules:

1. Use a bitwise OR. Do not clear bits that a map or Sven set.
2. Set the bits again after each spawn (U14).
3. Do not set 4 (`HIDEHUD_ALL`), 1 (`HIDEHUD_WEAPONS`), 16 (`HIDEHUD_WEAPON_SELECT`) or 128 (`HIDEHUD_CUSTOM_PLUGINS`). Bit 128 hides the plugin HUD itself. Bits 1 and 16 remove the native weapon menu, which the plugin cannot replace (§5.6).

### 5.4 Primitive mapping

| CS primitive | Sven equivalent | Notes |
|---|---|---|
| `SPR_Set(spr, r,g,b)` + `SPR_DrawAdditive(0, x, y, rect)` | `HudCustomSprite` with `spritename`, `left`/`top`/`width`/`height` = rect, `x`/`y` with `ABSOLUTE_X`, `ABSOLUTE_Y`, `NO_BORDER` | U1, U2, U4-U7. Give `color1` as the pre-scaled colour with alpha 255. This is correct if Sven multiplies by alpha and also if it does not (U5). |
| `FillRGBA(x, y, w, h, r,g,b,a)` | `HudCustomSprite` on a solid white sprite `cs16/hudfill.spr`, rect `(0, 0, w, h)`, colour `(r*a/255, g*a/255, b*a/255, 255)` | `hudfill.spr` is a new generated file (§6.3). |
| `FillRGBABlend` | no exact match. Use `HUD_SPR_OPAQUE` or additive. | Only `cl_crosshair_translucent 0` and night vision use it. |
| `DrawHudNumber` | option A: `HudNumDisplay` (Sven digits, U12). Option B: a generated multi-frame sprite, frame = value (U8). | §5.5 |
| Fade (alpha 228 → 100 in 5 s) | `color2` = bright, `color1` = dim, effect 2, `fxTime` 5, `EFFECT_ONCE`. Send again at each change to restart it. | U9. Exact for health, armour and ammo (constant RGB). For money the RGB and the alpha both change. Send raw RGB with the alpha in the A channel if Sven interpolates before the multiply, else accept the error. |
| Engine console text (names) | `HudMessage` | U13. The server cannot measure text width. |

### 5.5 Channel plan

Budget: 16 sprite channels. The CS HUD needs more than 16 boxes. The existing kill feed uses 8 sprite channels (`killfeed.as:318`, `killfeed.as:334`). This plan uses 15 and keeps one free.

Sprite group:

| Channel | Element | Content |
|---|---|---|
| 0-3 | crosshair W, E, N, S | `cs16/hudfill.spr` lines |
| 4-7 | kill feed icons, line 1-4 | generated `cs16/killicons.spr`: one frame for each `d_*` icon, and one with the headshot icon added after a 5 px gap. CS uses `s(5)`, which is 5 px only at H ≤ 480. This replaces channels 1-8 of `killfeed.as`. |
| 8 | health cross | `cs16/640hud7.spr` (48,25,24,24) |
| 9 | armour full part | `cs16/640hud7.spr`, cropped rect |
| 10 | ammo bar | `cs16/hudfill.spr` (0,0,2,25), or `cs16/640hud7.spr` `divider` cropped to (240,0,2,25) |
| 11 | ammo icon | `cs16/640hud7.spr`, rect from §3.3 |
| 12 | flashlight casing | `cs16/640hud7.spr` (112,25,32,32) |
| 13 | flashlight energy | `cs16/640hud7.spr` (160+off,25,32−off,32) |
| 14 | flashlight beam | `cs16/640hud7.spr` (144,25,16,32) |
| 15 | free: radar background (`cs16/radar640.spr`) or one status icon | |

Numeric group:

| Channel | Element |
|---|---|
| 0 | money (existing `BuyMenu.as:100`) |
| 1 | money delta |
| 2 | health digits (option A) |
| 3 | armour digits with the `suit_empty` icon (option A) |
| 4 | ammo clip (option A) |
| 5 | ammo reserve (option A) |

Text channels (1-4, U13): 1 kill feed killers, 2 kill feed victims, 3 centre print. Keep 4 free for maps.

Option B (CS digits) replaces numeric channels 2-5 with sprite channels. That needs composite frame sprites to stay within 16 channels: health cross plus 3 digits in one 256-frame sprite (channel 8), armour icon plus fill plus digits in one sprite for each armour type (channel 9), clip digits plus bar (channel 10), reserve digits (channel 15, the radar is then dropped). Frames are `uint8`, so values 0-255 fit. That covers the CS protocol ranges of health, clip and reserve (§2.3). Clamp armour and co-op health to 255 in this option.

### 5.6 Per-element parameters

Common flags: `ABS` = `HUD_ELEM_ABSOLUTE_X + HUD_ELEM_ABSOLUTE_Y` (3). `NB` = `HUD_ELEM_NO_BORDER` (16). `ONCE` = `HUD_ELEM_EFFECT_ONCE` (64). `CXY` = `HUD_ELEM_SCR_CENTER_X + HUD_ELEM_SCR_CENTER_Y` (12). Boxes are for the 640 set. "L/R" gives the distance of the element's left edge from the left screen edge, or of its right edge from the right screen edge. "T/B" does the same for top and bottom.

| Element | Call, channel | Flags | Box (CS, 640) | x, y to send | Sprite and rect | Colours and effect |
|---|---|---|---|---|---|---|
| Health cross | `HudCustomSprite`, sprite 8 | ABS+NB+ONCE | L 12, T = H − 37, 24×24 (B 13) | x 12. y −37 (left/top anchor, U2) or −13 (bottom anchor) | `cs16/640hud7.spr` 48,25,24,24 | health > 25: color2 (228,143,0,255), color1 (100,62,0,255), effect 2, fxTime 5. ≤ 25: color2 (223,0,0,255), color1 (98,0,0,255). ≤ 15: (250,0,0,255), effect 0. |
| Health digits | `HudNumDisplay`, num 2 (option A) | ABS+NB+ONCE | field L 34 … 94, T = H − 37, 25 high | x 34, y −37 or −12 | none (or the cross as icon at x 12, U12) | as the cross. `maxdigits` 3. Value `clamp(health, 0, 999)`. CS sends a byte, so CS shows 0-255 only. |
| Armour empty icon and digits | `HudNumDisplay`, num 3 | ABSOLUTE_Y+NB+ONCE (x is a fraction) | icon at W/5, T = H − 37. Digits from W/5 + 24. | x 0.2 (U16), y −37 or −13 | `cs16/640hud7.spr` 24,25,24,24 (helmet: 24,124,24,24) | HUD orange fade as health (no red) |
| Armour full part | `HudCustomSprite`, sprite 9 | ABSOLUTE_Y+NB+ONCE | x W/5, y = H − 37 + off, 24 × (24 − off), `off = (int)(24 * (100 - min(bat,100)) / 100)` | x 0.2, y −(37 − off) or −13 | `cs16/640hud7.spr` 0,25+off,24,24−off (helmet: 0,124+off) | same colours and timing as the empty icon. Hide when off = 24. |
| Ammo clip | `HudNumDisplay`, num 4 | ABS+NB+ONCE | field L = W − 184 … W − 124 (R 124), T = H − 37 | x −184 (left anchor) or −124 (right anchor), y −37 or −12 | none | color2 (200,125,0,255), color1 (100,62,0,255), effect 2, fxTime 5. Restart when the clip or the weapon changes. |
| Ammo bar | `HudCustomSprite`, sprite 10 | ABS+NB+ONCE | L = W − 114, T = H − 37, 2×25 (R 112, B 12) | x −114 or −112, y −37 or −12 | §5.5 | as the clip |
| Ammo reserve | `HudNumDisplay`, num 5 | ABS+NB+ONCE | field W − 102 … W − 42 (no clip: W − 104 … W − 44) | x −102 or −42, y −37 or −12 | none | as the clip. A reserve-only change uses `HudUpdateNum` (no restart, as `AmmoX`). |
| Ammo icon | `HudCustomSprite`, sprite 11 | ABS+NB+ONCE | L = W − 42, T = H − 40, 24×24 (R 18, B 16). No clip: L = W − 44. | x −42 or −18, y −40 or −16 | `cs16/640hud7.spr`, rect from §3.3 | as the clip |
| Money | `HudNumDisplay`, num 0 | ABS+NB+ONCE | dollar L = W − 134, T = H − 75 (B 50). Digits W − 116 … W − 16 (R 16). | x −134 or −16, y −75 or −50 | `cs16/640hud7.spr` 192,25,18,25 (as now in `BuyMenu.as:104-110`) | gain: color2 (0,228,0,255) → color1 (100,62,0,255), effect 2, fxTime 5. Loss: color2 (228,0,0,255). Blink: effect 7 between (255,160,0,255) and the normal colour for 0.2·n s (toggle period 0.1 s, U9). |
| Money delta | `HudNumDisplay`, num 1 | ABS+NB+ONCE | sign L = W − 116 − signW, T = H − 112. Digits as money (bottom H − 87). | x −133 (plus) or −129 (minus), or −16 (right anchor). y −112 or −87. | `plus` 223,25,17,23 or `minus` 210,25,13,23 | color2 = money start colour, color1 (0,0,0,255), effect 2, fxTime 2.5. Then hide. |
| Flashlight casing | `HudCustomSprite`, sprite 12 | ABS+NB | L = W − 48, T 16, 32×32 (R 16) | x −48 or −16, y 16 | 112,25,32,32 | on: (225,141,0,255). Off: (100,62,0,255). Battery < 20 %: (225,14,14,255) or (100,6,6,255). |
| Flashlight energy | sprite 13 | ABS+NB | L = W − 48 + off, T 16, (32 − off)×32 | x −(48 − off) or −16, y 16 | 160+off,25,32−off,32 | as the casing |
| Flashlight beam | sprite 14 (only when on) | ABS+NB | L = W − 16, T 16, 16×32 (R 0) | x −16 (left-anchor rule). The right-anchor rule cannot express 0 px from the right edge (U2, open question 1). y 16. | 144,25,16,32 | as the casing |
| Crosshair line | `HudCustomSprite`, sprites 0-3 | CXY+ABS+NB | §3.12.6 | W: (−(d+len−1), 0). E: (d, 0). N: (0, −(d+len−1)). S: (0, d). Assumes top-left anchor (U3). | `cs16/hudfill.spr` (0,0,len,1) or (0,0,1,len) | color1 = crosshair colour scaled by `alpha`, alpha 255. Effect 0. |
| Kill feed icon | `HudCustomSprite`, sprites 4-7 | ABSOLUTE_X+NB (y is a fraction) | icon box from §3.9 | x from the name widths (note below). y = the fraction `(32 + 16*i) / 480`, which equals `s(32) + i*s(16)` for H ≥ 480 except for truncation. | `cs16/killicons.spr`, frame = icon index | (255,80,0,255). Team kill: (10,240,10,255). |
| Kill feed names | `HudMessage`, text 1 (killers) and 2 (victims) | – | §3.9 | victims: x = `−s(12)/W` (−0.019 at 4:3, −0.014 at 16:9), right-aligned lines (U13). y as the icons. Killers: right-aligned to the left of the icon column. | – | names: players (153,204,255) as CT, monsters (255,64,64) as T. Effect 0, fade 0. One message with 4 lines for each column. The server does not know the aspect ratio. |
| Centre print | `HudMessage`, text 3 | – | centred at `0.35 * H` | x −1, y 0.35 | – | (255,180,30), effect 0, fadein 0, holdTime 4, fadeout 0 |
| Radar background (optional) | `HudCustomSprite`, sprite 15 | ABS+NB | (0,0,128,128) | x 0, y 0 | `cs16/radar640.spr` 0,0,128,128. `cl_radartype 1` look: `cs16/radaropaque640.spr` with `HUD_SPR_MASKED` (UNVERIFIED match for `SPR_DrawHoles`). | (25,75,25,255). Opaque look: (200,200,200,255). |
| Radar dot (only with a free channel) | `HudCustomSprite` | ABS+NB | `FillRGBA(x, y, 2, 2)` from §3.8 | x, y = radar pixel | `cs16/hudfill.spr` 0,0,2,2 | (150,75,250) at alpha 235, pre-scaled (138,69,230,255) |
| Status icon (alternative use of sprite 15) | `HudCustomSprite` | SCR_CENTER_Y+ABS+NB | first icon: x 12, top = H/2 − (h + 5) | x 12, y −(h + 5) from the centre (U3) | `cs16/640hud7.spr`, rect from §2.6 | colour from the CS message, for example (0,160,0,255). Flash: effect 7 between it and (250,0,0,255), period 0.1 s (U9). |
| Map countdown (optional, replaces the round timer) | `HudTimeDisplay`, time group 0 | SCR_CENTER_X+ABS+NB + `HUD_TIME_MINUTES` + `HUD_TIME_SECONDS` + `HUD_TIME_COUNT_DOWN` | stopwatch L = W/2 − 64, digits from W/2 − 40, T = H − 37 | x −64 from the centre (U3), y −37 or −13 | `cs16/640hud7.spr` 144,72,24,24 (`stopwatch`) | (100,62,0,255). Below 31 s: effect 7 with (255,16,16,255). |

Kill feed note: CS packs each line against the right edge with the real text width (§3.9). The server does not know the width of the client font. Two choices:

1. Fixed columns: victim names right-aligned at the margin, icons in a fixed column, killer names right-aligned against the icon column. This is not exact for short victim names.
2. Exact layout: the Sven reverse-engineering work extracts the glyph widths of the `HudMessage` font. Then the server computes the widths and places each icon.

Crosshair note: the server does not know W. Thus it cannot apply the `W / base` scale of §3.12.5. Read a player setting from the userinfo (`GetInfoKeyBuffer`, API:5145), for example a `setinfo` key with the width or the scale. Default to scale 1 (the `auto` result at 800 px).

Crosshair update rule: simulate §3.12.4 at 100 steps per second. On each server think of `dt` seconds, run `round(dt * 100)` steps. A shot replaces one decay step. Send the 4 lines only when `d`, `len` or `alpha` changes.

Elements to keep native:

- Weapon selection menu. The slot keys are client commands, so the server cannot draw the menu. The repo weapon files already give the native menu CS pictures (`sprites/cs16/rifl/weapon_ak47.txt:2-4`).
- Pickup history, chat, player id, text menus (`ShowMenu`), scoreboard, MOTD.

## 6. Assets

### 6.1 Lines for `cstrike-assets.txt`

The install recipe copies each line from `cstrike/` to `<dir>/cs16/<file>` (`Justfile:22-26`, `cstrike-assets.txt:1-2`). The HUD needs:

```
sprites/640hud1.spr
sprites/640hud2.spr
sprites/640hud16.spr
sprites/640hud7.spr
sprites/radar640.spr
sprites/radaropaque640.spr
```

- The first three lines exist now (`cstrike-assets.txt:3-5`). They hold the death icons.
- `sprites/640hud7.spr` holds the digits, cross, suit, dollar, plus, minus, stopwatch, flashlight, buckets, status icons and ammo icons. The repo also has a copy in git (`sprites/cs16/640hud7.spr`, the same SHA-1 `09939bf8…` as the CS file). The asset line makes the git copy unnecessary.
- `radar640.spr` (128×128, additive) and `radaropaque640.spr` (128×128, alphatest) are only for the radar (TOOL, Appendix A.3).
- Optional, only for a plugin weapon menu (not proposed): `sprites/640hud3.spr` (`selection`, hud.txt:94).

### 6.2 Files that the recipe cannot import

These files exist only in `Half-Life/valve/sprites`, and the recipe reads only `cstrike/` (`Justfile:23-26`):

| File | CS use | Proposal |
|---|---|---|
| `640_pain.spr` | pain arrows (§3.14) | keep Sven's native arrows if U15 is false. Else add a second asset list for `valve/`. |
| `640hud8.spr`, `640hud9.spr` | damage-type icons | same as above |
| `crosshairs.spr` | zoomed static crosshair (§3.12.1) | use the repo file `sprites/cs16/crosshairs.spr` |
| `320hud1.spr`…`320hud4.spr` | 320 set | not needed (U4) |

### 6.3 Generated files (not CS files)

| File | Content | Needed for |
|---|---|---|
| `sprites/cs16/hudfill.spr` | 64×64, 1 frame, additive, all pixels white | `FillRGBA` boxes: crosshair, ammo bar |
| `sprites/cs16/killicons.spr` | one frame for each `d_*` icon and each icon + headshot, built from 640hud1/2/16 at install time | kill feed in 4 channels |
| optional digit sprites | 256 frames, each frame one value drawn with the §2.3 rules | option B |

A Deno tool can build these files from the local CS install during `just install`. Then no Valve pixels go into git.

## 7. Update triggers (server side)

| Element | Send when | Effect restart |
|---|---|---|
| Health | the integer health changes | yes |
| Armour | the integer armour or the armour type changes | yes |
| Ammo | the weapon or the clip changes | yes |
| Ammo reserve only | the reserve changes and the clip does not | no |
| Money | the value changes. Show the delta only for tracked changes. | yes |
| Flashlight | on/off or the battery % changes | no |
| Crosshair | `d`, `len` or `alpha` changes (§5.6) | no |
| Kill feed | a kill, or the oldest line expires | no |
| Hide bits | each spawn, and periodically | – |

## 8. Not applicable in co-op

| CS element | Reason | Recommendation |
|---|---|---|
| Round timer and stopwatch (§3.6) | no rounds | Hide. Optional: show a map countdown with `HudTimeDisplay` at the CS timer box. |
| Timer hidden when the bomb is planted | no bomb | ignore |
| `buyzone` status icon | the buy menu has no zones | Omit. Use the icon if buy zones appear later. |
| `c4`, `defuser`, `rescue`, `escape`, `vipsafety` icons | no objectives | omit |
| Progress bar (§3.7) | bomb plant, defuse, hostage | Omit. Optional: reuse for long player actions. |
| Scenario status (hostage, bomb ticking) | no scenarios | omit |
| Radar bomb, hostage, VIP, tracked and radio dots | no objectives, no radio | Omit. Keep teammate dots only if channels are free. |
| Location text under the radar | Sven maps have no location names | omit |
| Team colours T and CT | one team | Players use CT blue. Monsters use T red in the kill feed. |
| Team-kill green icon | friendly fire only | keep the rule if the kill hook reports team kills |
| Night vision and its red crosshair | no night vision item | omit |
| Shield crosshair rule | no shield | omit |
| Career task timer | Condition Zero only | omit |
| VGUI2 scoreboard and MOTD | VGUI2, not HUD | keep Sven native |
| Spectator HUD and overview | Sven has its own observer | keep Sven native |

## 9. FWGS deviations from BIN

| Item | FWGS | BIN |
|---|---|---|
| Sprite set | always 640 (hud.cpp:474) | 320 below 640 px (0xb2a75) |
| HUD colour | cvar `hud_color` (hud.cpp:356, hud_redraw.cpp:159-176) | fixed (255,160,0) |
| Leading-zero flag 8 | missing (draw_util.h:33-35, draw_util.cpp:275, 289) | present (0xb5d85) |
| Health fade at ≤ 15 | timer stops (health.cpp:207-233) | timer continues (0xb104c) |
| Armour | full icon then empty icon on top, y without the +4/−4 offsets (battery.cpp:113-127) | empty icon then the full part from the bottom (0xa4c53–0xa4cca) |
| Armour type reset | battery < 0 (battery.cpp:65) | battery ≤ 0 (0xa4e56) |
| Pain arrows | white (health.cpp:351) | orange or red, alpha 127 or strength·255 (0xafb44) |
| Weapon menu origin | radar width + 10 (ammo.cpp:1933) | 138 or 70 (0xa2608) |
| Weapon menu ammo bar | y + 0 (ammo.cpp:2035) | y + 3 (0xa2a2d) |
| Bar sizes | 20×4 always (ammo.cpp:351-352) | 10×2 below 640 px (0x9f656) |
| Pickup history y | `fh*3 + 2*gap` (ammohistory.cpp:33) | 72 + 2·gap (0xa482b) |
| Pickup history count | x − 10, min W − 100 (ammohistory.cpp:143) | x, min x not used (0xa4879, 0xb5b60) |
| Money layout | x = W − 7·dollarW, no 5-cell field (money.cpp:87-162) | W − 116 field (0x9cb67) |
| Money colours and blink | other formulas (money.cpp:90-146) | §3.5 |
| Round timer | panic below 21 s, dot colon (timer.cpp:73-114) | §3.6 |
| Crosshair MP5 delta | 3 (ammo.cpp:1219) | 2 (`CSWTCH.197` @0x185e40) |
| Crosshair run test | `speed >= limit`, float (ammo.cpp:1660) | `(int)speed > limit` (0xa2592) |
| Crosshair `auto` at W ≤ 640 | no change, the base keeps its old value, initially −1 (ammo.cpp:299, ammo.cpp:1769-1777) | base 1024 (0xa18e5) |
| Crosshair size default | `"auto"` (ammo.cpp:285) | `"0"` (0x9d290), same meaning |
| Crosshair extras | `xhair_*` cvars (ammo.cpp:305-317) | none |
| Death notice step | `YRES(32) + 2 + 20*i` (death.cpp:107) | `s(32) + i*s(16)` (0xa5b9f) |
| Status icon x | 5 (status_icons.cpp:57) | crossW/2 = 12 (0xc7b2e) |
| Menu colours | `\y` (255,160,0), `\r` (255,16,16), `\d` (128,128,128) (draw_util.cpp:110-121) | §1.3 |
| Menu position | `y = H/2 - (lines/2)*12 - 40`, step 24 (menu.cpp:112-119) | §3.15 |
| Centre print | engine centre print | VGUI2 at 0.35·H, 4 s (0xbd790) |

## 10. Open questions

1. The Sven agent must confirm U1-U16. U2, U4, U5, U8 and U11 decide the design.
2. Can Sven HUD effects interpolate RGB and alpha separately (exact money colours)?
3. Which font and glyph widths does Sven use for `HudMessage`? This decides the kill feed layout.
4. Is a client resolution or a userinfo key available for the crosshair scale?
5. `sprites/cs16/rifl/weapon_ak47.txt:5` asks for `crosshairs` (256,0,256,256), but `sprites/cs16/crosshairs.spr` is 256×256 (TOOL, Appendix A.3). Check how Sven treats this rect.
6. Does Sven reset `m_iHideHUD` on death, spawn or level change?

## Appendix A. Tool output

The scripts ran with Deno on 2026-10-27. They implement the formulas cited in the sections above.

### A.1 ScaleColors and fade (BIN 0xb5ad0, §1.4)

```
orange  255:(255,160,0) 228:(228,143,0) 225:(225,141,0) 200:(200,125,0) 192:(192,120,0) 128:(128,80,0) 127:(127,79,0) 100:(100,62,0)
lowRed  255:(250,0,0) 228:(223,0,0) 225:(220,0,0) 200:(196,0,0) 192:(188,0,0) 128:(125,0,0) 127:(124,0,0) 100:(98,0,0)
redish  255:(255,16,16) 228:(228,14,14) 225:(225,14,14) 200:(200,12,12) 192:(192,12,12) 128:(128,8,8) 127:(127,7,7) 100:(100,6,6)
green   255:(0,160,0) 228:(0,143,0) 225:(0,141,0) 200:(0,125,0) 192:(0,120,0) 128:(0,80,0) 127:(0,79,0) 100:(0,62,0)
fade t=0..5: 228,202,176,151,125,100 | ammo: 200,180,160,140,120,100
```

### A.2 Crosshair simulation (BIN 0xa1eb0)

Minimum gap g by pose. Poses: stand (on ground, speed 0), duck, walk100 (speed 100), run250 (speed 250), air (not on ground).

```
id name        flags    stand    duck walk100  run250     air  shotDelta
 1 p228            7        8       4      12      12      16  3
 3 scout           0        5       5       5       5       5  3
 4 hegrenade       0        8       8       8       8       8  3
 5 xm1014          0        9       9       9       9       9  4
 6 c4              0        6       6       6       6       6  3
 7 mac10           1        9       9       9       9      18  3
 8 aug             3        3       3       3       4       6  3
 9 smoke           0        8       8       8       8       8  3
10 elite           0        4       4       4       4       4  3
11 fiveseven       7        8       4      12      12      16  3
12 ump45           1        6       6       6       6      12  3
13 sg550           0        5       5       5       5       5  3
14 galil           3        4       4       4       6       8  3
15 famas           3        4       4       4       6       8  3
16 usp             7        8       4      12      12      16  3
17 glock18         7        8       4      12      12      16  3
18 awp             0        8       8       8       8       8  3
19 mp5navy         1        6       6       6       6      12  2
20 m249            3        6       6       6       9      12  3
21 m3              0        8       8       8       8       8  6
22 m4a1            3        4       4       4       6       8  3
23 tmp             1        7       7       7       7      14  3
24 g3sg1           0        6       6       6       6       6  4
25 flashbang       0        8       8       8       8       8  3
26 deagle          7        8       4      12      12      16  3
27 sg552           3        5       5       5       7      10  3
28 ak47            3        4       4       4       6       8  4
29 knife           0        7       7       7       7       7  3
30 p90             3        7       7       7      10      14  3
usp silenced: stand=11 duck=5 walk100=16 run250=16 air=22
glock18 burst: stand=11 duck=5 walk100=16 run250=16 air=22
m4a1 silenced: stand=5 duck=5 walk100=5 run250=8 air=11
famas burst: stand=5 duck=5 walk100=5 run250=8 air=11
```

AK-47, standing, 100 fps, `W == base`. One shot every 10 frames for 10 shots (frames 10…100), then recovery. `d` is the distance, `len` the length, `a` the alpha.

```
f9:d=4,len=5,a=220 f10:d=8,len=7,a=180 f11:d=7.796,len=6,a=182 f19:d=6.257,len=6,a=198
f20:d=10.257,len=8,a=158 f50:d=15,len=10,a=120 f100:d=15,len=10,a=120 f101:d=14.705,len=10,a=122
f109:d=12.479,len=9,a=138 f110:d=12.217,len=9,a=140 f120:d=9.775,len=7,a=160 f130:d=7.632,len=6,a=180
f140:d=5.753,len=5,a=200 f159:d=4,len=5,a=238
```

Scale with `auto` for distance 8 and length 7:

```
640->base1024:gap5,len4 800->base800:gap8,len7 1024->base640:gap12,len11 1280->base640:gap16,len14 1920->base640:gap24,len21 2560->base640:gap32,len28
```

### A.3 Sprite headers

```
cstrike/sprites/640hud1.spr: tex=additive max=256x256 frames=1
cstrike/sprites/640hud2.spr: tex=additive max=256x256 frames=1
cstrike/sprites/640hud7.spr: tex=additive max=256x256 frames=1
cstrike/sprites/640hud16.spr: tex=additive max=256x256 frames=1
cstrike/sprites/radar640.spr: tex=additive max=128x128 frames=1
cstrike/sprites/radar320.spr: tex=additive max=64x64 frames=1
cstrike/sprites/radaropaque640.spr: tex=alphatest max=128x128 frames=1
valve/sprites/640_pain.spr: tex=additive max=128x128 frames=4 [128x48,48x128,128x48,48x128]
valve/sprites/640hud8.spr: tex=additive max=256x64 frames=1
valve/sprites/640hud9.spr: tex=additive max=256x64 frames=1
valve/sprites/crosshairs.spr: tex=alphatest max=128x128 frames=1
repo sprites/cs16/crosshairs.spr: tex=alphatest max=256x256 frames=1
repo sprites/cs16/cs1024.spr: tex=additive max=1024x512 frames=1
repo sprites/cs16/640hud7.spr: tex=additive max=256x256 frames=1 (same SHA-1 as cstrike/sprites/640hud7.spr)
```

### A.4 Sprite regions as ASCII (`#` = visible pixel)

`valve/sprites/crosshairs.spr` region (24,0,24,24), rows 6-16 (the other rows are empty):

```
...........#............
...........#............
........................
........................
........................
......##.......##.......
........................
........................
........................
...........#............
...........#............
```

`cstrike/sprites/640hud7.spr` `divider` (240,0,2,40): columns 240-241 are visible in all 40 rows.
