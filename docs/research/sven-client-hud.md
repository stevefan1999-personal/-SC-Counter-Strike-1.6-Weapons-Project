# How the Sven Co-op client draws its HUD

Research notes for Counter-Life. They tell what a server can and cannot do
to make the Sven Co-op HUD look like the Counter-Strike 1.6 HUD.

Scope: Sven Co-op 5.26, engine build 10269, Linux, 32-bit.

## Method and evidence format

| File | SHA-256 | Copy that was analysed |
|---|---|---|
| `Sven Co-op/svencoop/cl_dlls/client.so` | `50580344e1c59b3c77e8e4e52ed9f185fcec7da2da936873ec122f12c735a022` | `.re/client/client.so` |
| `Sven Co-op/hw.so` | `8cead76a51204a4ba1036c85cc2099b7c3542950d924846a9aa2ccf619df7dfd` | `.re/engine/hw.so` |
| `Sven Co-op Dedicated Server/svencoop/dlls/server.so` | `7a980bbd4b03f7380092e45d0a7515085ffb5142e62589d87e2596e90d89d2ca` | `.re/server/server.so` |

- Tool: IDA Pro (idalib and Hex-Rays) through the IDA MCP tools. The `.i64`
  databases are next to the copies in `/home/steve/projects/counter-life/.re/`.
  They keep the names that this document uses.
- All three files are ELF32 i386 with image base 0. They have RTTI type names
  (`_ZTS…`) but most internal functions have no symbol. A name such as
  `CHudCustom::Draw (0xD82F2)` is a name that I gave to `sub_D82F2`.
  An address without a file name is in `client.so`.
- PIC base: `client.so` reaches globals through 0x61E000, `server.so` through
  0xB14000.
- Main globals in `client.so`: `gEngfuncs` at 0xA57FA0 (copied in `Initialize`,
  0xA4166–0xA4179, 0x86 dwords), `gHUD` at 0xA55980.
- The vtable slots come from `.re/vtdump.ts`. Slot order of `CHudBase`:
  destructor ×2, Init, VidInit, Draw, Think, Reset, InitHUDData.
- Helper scripts (Deno, not in this repository): `.re/tools/spr-check.ts`
  compares weapon txt rects with SPR frame sizes, `.re/tools/spr-stats.ts`
  prints SPR headers and frames, `.re/tools/elf-strtab.ts` prints `char *`
  tables from an ELF file.
- API dump: `sven-coop.github.io/outputdocs.txt` (cited as `outputdocs.txt:LINE`).

## Summary

1. The custom elements (`HudCustomSprite`, `HudNumDisplay`, `HudTimeDisplay`)
   use 6 user messages. The client has 32 slots: map scripts get client
   channels 0–15 and plugins get 16–31.
2. Nothing on the HUD scales with the resolution. Sprites and digits are drawn
   1:1 in screen pixels. Only the fractional x/y positions scale.
3. `x = -1` does not centre an element. It puts the element at the left (or
   top) border. To centre, use `HUD_ELEM_SCR_CENTER_X/Y` with 0.
4. The digits of `HudNumDisplay` are the Sven `number_0`…`number_9` sprites
   (20×20) from the client's own `sprites/hud.txt`. A server cannot change them.
5. The native HUD colour is a constant (100,130,200) in the client code. No
   message and no cvar changes it. Each native sprite is multiplied by that
   colour, so CS orange is not possible on native elements.
6. `HIDEHUD_WEAPONS` and `HIDEHUD_WEAPON_SELECT` also stop weapon switching
   with the slot keys. Thus you cannot hide only the weapon menu.
7. By default (`cl_filterstuffcmd 0`) a server can set `cl_bob*`, `hud_*` and
   `crosshair` with stufftext. With the filter on, the `cl_` and `hud_`
   prefixes are blocked, but `crosshair` is not. AngelScript `NetworkMessage`
   does not refuse `SVC_STUFFTEXT`.
8. Causes of glitched icons: a missing `.spr` becomes `sprites/error.spr`; an
   empty or out-of-frame rect draws the whole sheet; a sprite handle of 0 draws
   the previous sprite again. The killfeed in this repository sends rects that
   the client enlarges to the bottom-right corner of the sheet (see 4.5).

## 1. Custom HUD elements

### 1.1 Messages and handlers

`CHudCustom::Init (0xD7F28)` hooks the messages. `CHudCustom` is
`gHUD+0x1F64` = 0xA578E4.

| Message | ID | Server size | Client hook → parser | Server writer (`server.so`) |
|---|---|---|---|---|
| `ToggleElem` | 139 | 2 | 0xD84D4 → 0xD845A | 0x54751E (from `HudToggleElement` 0x2BDC84) |
| `CustSpr` | 140 | variable | 0xD8B82 → 0xD8A20 | 0x5475BE (from `HudCustomSprite` 0x2BDA3E) |
| `NumDisplay` | 141 | variable | 0xD8D48 → 0xD8BBE | 0x547962 (from `HudNumDisplay` 0x2BDACC) |
| `UpdateNum` | 142 | 5 | 0xD85E0 → 0xD8510 | from `HudUpdateNum` 0x2BDD26 (writer not decompiled) |
| `TimeDisplay` | 143 | variable | 0xD8EEE → 0xD8D84 | 0x547DAC (from `HudTimeDisplay` 0x2BDB5A) |
| `UpdateTime` | 144 | 9 | 0xD86DE → 0xD861C | from `HudUpdateTime` 0x2BDBE8 (writer not decompiled) |

- IDs: `NetworkMessageType` enum, `outputdocs.txt:32069–32104`.
- Sizes: `LinkUserMessages` in `server.so` (`sub_498240`). It registers the
  user messages in ID order from 64.
- The AngelScript methods are bound in `server.so` `sub_2BDF8C`. Example:
  `lea ebx, sub_2BDACC` (0x2C071D) next to the declaration string
  `void HudNumDisplay(...)` (0x8CAE10).
- Reader primitives in `client.so`: `READ_BYTE` 0xEC892, `READ_CHAR` 0xEC85E,
  `READ_SHORT` 0xEC8C6 (`READ_WORD` 0xEC90A is a `jmp` to it), `READ_LONG`
  0xEC90C, `READ_FLOAT` 0xEC96A, `READ_STRING` 0xEC9C2. Colour reader 0xD841C
  reads 4 bytes (r, g, b, a). Rect reader 0xD83D2 reads byte left, byte top,
  short width, short height and stores right = left + width, bottom = top + height.
- The server writes each float as 4 raw bytes of the IEEE value, for example
  0x547B70–0x547B9B.

### 1.2 Byte layouts

`CustSpr` (client 0xD8A20, server 0x5475BE):

| # | Type | Field | Server limit |
|---|---|---|---|
| 1 | byte | client channel | see 1.3 |
| 2 | long | flags | |
| 3 | string | spritename | |
| 4 | byte | left | 0–255 (the type is one byte) |
| 5 | byte | top | 0–255 |
| 6 | short | width | clamped to 0–512 (0x547676) |
| 7 | short | height | clamped to 0–512 |
| 8 | float | x | none |
| 9 | float | y | none |
| 10 | 4 bytes | color1 r,g,b,a | |
| 11 | 4 bytes | color2 r,g,b,a | |
| 12 | byte | frame | |
| 13 | byte | numframes | |
| 14 | float | framerate | ≥ 0 |
| 15–18 | float | fadeinTime, fadeoutTime, holdTime, fxTime | ≥ 0, ≥ 0, ≥ −1, ≥ 0 |
| 19 | byte | effect | |

`NumDisplay` (client 0xD8BBE, server 0x547962): byte channel, long flags,
float value, byte defdigits, byte maxdigits, float x, float y, color1, color2,
string spritename, byte left, byte top, short width, short height, float
fadein, float fadeout, float hold, float fxTime, byte effect. Width, height and
the times have the same limits as `CustSpr`.

`TimeDisplay` (client 0xD8D84, server 0x547DAC): byte channel, long flags,
float reference time (the server writes `gpGlobals->time`), float value, float
x, float y, color1, color2, string spritename, byte left, byte top, short
width, short height, 4 floats (fades, hold, fxTime), byte effect.

`UpdateNum` (0xD8510): byte channel, float value. The client ignores it if
the channel does not hold a number display (type 2).
`UpdateTime` (0xD861C): byte channel, float reference time, float value. The
client ignores it if the channel does not hold a time display (type 3).
`ToggleElem` (0xD845A): byte channel, byte visible (non-zero = visible).

Element fields after parsing (`CHudBaseElement`): +4 visible, +8 start time,
+12 flags, +20 x, +24 y, +28 flash, +32 color1, +36 color2, +40 fade-in,
+44 fade-out, +48 hold, +52 fxTime, +56 effect, +60 sprite handle, +64 rect.

### 1.3 Channels

Server (`sub_5474B8`):
- A channel above 15 is refused: "HUD: Invalid channel #%d".
- A group above 1 is refused: "HUD: Invalid channel group #%d".
- The client channel is `channel + 16 * group`.
- The group is 1 when the calling script module has type 1, else 0.
  `CASModuleInfo` stores the type at +12 (`sub_120AD8`): type 1 for
  `scripts/plugins` (`sub_1A1E98`) and type 0 for `scripts/maps`
  (`sub_1A3918`). If no script module runs, the group is −1 and nothing is sent.
- A null player sends `MSG_ALL`, otherwise `MSG_ONE` (`sub_5472F0`).

Client:
- `CHudCustom` has 32 element pointers at `this+0x14`
  (`CHudCustom::Init` clears 128 bytes).
- Draw order: `CHudCustom::Draw (0xD82F2)` calls `sub_D8030(group 0)` and then
  `sub_D8030(group 1)`. Each call draws channels `16*group+0` to `+15` in
  ascending order (0xD8030). Higher channels and all plugin elements are drawn
  on top.
- Each channel holds one element type: 1 = sprite, 2 = number, 3 = time
  (`CHudCustom::CreateElement (0xD8786)`). A message of another type deletes the
  old element (0xD88BC) and makes a new one (0xD893A). A message of the same
  type reuses the element and restarts its clock.
- Client defect: for a channel above 31 the client logs "HUD: Invalid channel
  number" but continues to create the element. It stores it at
  `this+0x14+4*channel`, past the 32-entry array (0xD89FC–0xD8A1B). The
  AngelScript API cannot send such a channel, but a raw `NetworkMessage` of
  type 140, 141 or 143 can. Do not send channels above 31.

### 1.4 How the spritename is resolved

`CHud::LoadElementSprite (0xDBB60)`:

1. Empty name: no icon (handle −1).
2. A name that contains `.spr`: `SPR_Load("sprites/" + name)`, and the rect
   stays as it was sent. Thus `cs16/640hud7.spr` loads
   `sprites/cs16/640hud7.spr`.
3. Any other name is a `hud.txt` sprite name (`CHud::GetSpriteIndex (0xD4544)`).
   If the name is found, the client uses that sprite. If the rect that was sent
   is all zero, the client copies the `hud.txt` rect. If the name is not found,
   the handle is 0 and an all-zero rect is read from index −1 (garbage).

Automatic size (`CHud::FixupSpriteRect (0xD5002)`, called from the `Start`
functions 0xB48EE, 0xEBDE4 and 0xEBE60):
- If `right − left ≤ 0`, then `right = SPR_Width(frame)`.
- If `bottom − top ≤ 0`, then `bottom = SPR_Height(frame)`.
- Thus "width 0" means "to the right edge of the frame", not "the width of one
  icon". With `left > 0` and `width = 0` the element covers from `left` to the
  right edge of the sheet. Height works the same way.
- Number and time displays use frame 0 for this. Sprites use the frame that
  was sent.

### 1.5 How x and y become pixels

`GetX (0xD7C24)` and `GetY (0xD7C88)` call `CHud::CalcHudPos (0xDB324)`.
GetX uses `HUD_ELEM_ABSOLUTE_X` (1), `HUD_ELEM_SCR_CENTER_X` (4), `HUD_ELEM_NO_BORDER`
(16) and the screen width at `gHUD+0x1FFC`. GetY uses `ABSOLUTE_Y` (2),
`SCR_CENTER_Y` (8), `NO_BORDER` and the screen height at `gHUD+0x2000`.

Terms: `v` = x or y, `S` = screen size in pixels, `s` = element size on that
axis, `b` = border, `A = S − 2b`. The border `b` is 0 with `NO_BORDER`. Else it
is `clamp(int(hud_bordersize), 0, 100)` (0xDB34F–0xDB36C).

| Mode | Flags | Pixel of the left or top edge | Clamp |
|---|---|---|---|
| Fraction from start | none, `v ≥ 0` | `int(v*A + b)` | yes |
| Fraction from end | none, `v < 0` | `int((v+1)*A + b − s)` | yes |
| Fraction from centre | `SCR_CENTER` | `int(v*A + (S−s)/2)` | yes |
| Pixels from start | `ABSOLUTE`, `v ≥ 0` | `int(v + b)` | no |
| Pixels from end | `ABSOLUTE`, `v < 0` | `int(v + S − b − s)` | no |
| Pixels from centre | `ABSOLUTE` + `SCR_CENTER` | `int(v + (S−s)/2)` (no border) | no |

Clamp (fraction modes only, 0xDB3E8–0xDB3FA and 0xDB43B): if
`p + s > S − b`, then `p = S − b − s`. After that, if `p < b`, then `p = b`.

Results:
- `v = −1` gives `p = b − s`, which the clamp moves to `b`. The element is at
  the left (or top) border. It is not centred. The API text
  "-1.0 = centered" (`outputdocs.txt:2101`, `2106`, `2214`) is wrong for this
  client. Both parameter constructors set x = y = −1 (`server.so` 0x2BCFD0 and
  0x2BCED4). Thus an element that does not set x and y appears in the top-left
  corner.
- The size `s` of a sprite is its rect width or height (0xB4A80, 0xB4A8C).
  The width of a number is icon width + 4 + digits (+ separator) (0xEBB96). The
  width of a time display is computed in 0xEBA18. The height of a number or a
  time display is `m_iFontHeight` (0xEBA00): 20 px in Sven. It is not the icon
  height.
- The clamp keeps fractional elements inside the border. Absolute elements can
  go off screen.

Examples at 2560×1440 with `hud_bordersize 16` (A = 2528 × 1408):

| Input | Pixel |
|---|---|
| `x = 0.5`, no flags, `s = 100` | 1280 (the left edge is at the centre, so the element is not centred) |
| `x = 0`, `SCR_CENTER_X`, `s = 100` | 1230 (centred) |
| `x = −1`, no flags | 16 |
| `x = −0.1`, no flags, `s = 100` | 2191 (the right edge is 10 % of A from the right border) |
| `x = −10`, `ABSOLUTE_X`, `s = 100` | 2434 (the right edge is 10 px inside the border) |
| `y = −12`, `ABSOLUTE_Y` + `NO_BORDER`, `s = 25` | 1403 (the CS health row, see 6) |

### 1.6 Scaling

There is no scaling.
- The custom elements draw with `CHud::DrawHudSprite (0xDA9CE)`, which calls
  `SPR_Set` and then `SPR_Draw`, `SPR_DrawHoles` or `SPR_DrawAdditive` with the
  rect.
- In `hw.so`, `SPR_Draw (0x102E90)` calls `Draw_SpriteFrame (0x127B70)`. That
  function draws a quad with the frame or rect size in pixels. The 2D
  projection `GL_Set2D (0x12A300)` is
  `glOrtho(0, viewport width, viewport height, 0)`, so one HUD unit is one
  screen pixel.
- `client.so` has no HUD scale cvar. The only `hud_*` cvars are listed in 2.4.
- `CHud::VidInit (0xD6EC2)` loads only the `hud.txt` rows whose resolution is
  640 (it compares `iRes` with the constant 640). Weapon txts are read the
  same way (0x9EA50). There is no other resolution tier.
- Result: at 2560×1440 a 20×20 digit is 20×20 px, and a 170×45 weapon icon is
  170×45 px. Fractional positions scale with the screen, but the sprites do
  not. Layouts that use fractions of 640 for widths and gaps (for example
  `scripts/cs16/killfeed.as:279–311`) spread apart at high resolutions.

### 1.7 Digits

- Source: `hud.txt` rows `number_0` … `number_9`, which are Sven
  `sprites/640hud7.spr`, 20×20 each (`svencoop/sprites/hud.txt:24–33`). The
  code uses `m_rghSprites[number_0 + digit]` (0xDBC48), so the ten rows must be
  in order.
- Font height = height of the `number_0` rect (`CHud::VidInit` 0xD6FCC–0xD6FF3,
  stored at `gHUD+0xC4`).
- These files are in the client's base `svencoop/` directory. A server cannot
  replace them. The CS 1.6 digits are 20×25 (`cstrike/sprites/hud.txt:110`)
  and have a different shape.
- `CHud::DrawHudNumber (0xDBC48)(x, y, value, r, g, b, defdigits, maxdigits, flags)`:
  - The value is `(int)` of the float value (0xEBEE0).
  - A negative value becomes 0 unless `HUD_NUM_NEGATIVE_NUMBERS` is set.
  - The value is clamped to `10^maxdigits − 1`. If the value was larger, a
    `plus` sprite is drawn 4 px after the digits. The default `maxdigits` is 0
    (`server.so` 0x2BCFD0), so a value that is not zero then shows as "0+".
  - If the value has fewer digits than `defdigits`, blank space is added on the
    left (the number is right-aligned in the field). With
    `HUD_NUM_LEADING_ZEROS` zeros are added instead.
  - Sign: `minus` (negative value with `NEGATIVE_NUMBERS`) or `plus` (positive
    value with `HUD_NUM_PLUS_SIGN`). It is drawn first, 4 px right of the field
    start (after any blank padding), and the digits follow it. It is moved
    down by `(fontH − signH)/2`, which is 2 px in Sven because `plus` and
    `minus` are 16 px high (`hud.txt:37–38`).
  - Each digit moves x by its rect width (20 px). There is no extra spacing.
  - Flag mapping in `CHudNumDisplay::Start (0xEBDE4)`: `LEADING_ZEROS` → 2,
    `NEGATIVE_NUMBERS` → 4, `PLUS_SIGN` → 8.
- `HUD_NUM_SEPARATOR` draws a `FillRGBA` bar that is `digitW/10` = 2 px wide
  and `fontH` = 20 px high (0xDB192).
- Time display (`CHudTimeDisplay::Draw (0xEC22A)`): each field is drawn with
  `DrawHudNumber` (2 digits, 3 for milliseconds). The separators are `colon`
  and `dot` from `hud.txt:35–36` (looked up in 0xEBD6A). `Start (0xEBE60)` adds
  `MINUTES` when `HOURS` and `SECONDS` are set, and adds `SECONDS` when
  `MINUTES` and `MILLISECONDS` are set. The shown time (0xEBC42) is `value`
  with `HUD_TIME_FREEZE`, else `value ± (now − reference time)` (minus with
  `HUD_TIME_COUNT_DOWN`).

### 1.8 Position of the icon

`CHudNumDisplay::Draw (0xEBEE0)` and `CHudTimeDisplay::Draw (0xEC22A)`:
- Vertical: icon y = element y − (iconH − fontH)/2. The icon is centred on the
  digit row.
- Default: the icon is at the element x, and the digits start at the icon
  right edge + 4 px.
- `HUD_NUM_RIGHT_ALIGN` (0x10000): the digits come first, and the icon is at
  the end of the digits + 4 px. This flag does not change how x is computed.
  Use a negative x to anchor the right edge.
- `HUD_NUM_SEPARATOR`: the bar is `digitW/2` after the digits (default) or in
  front of the digits (`RIGHT_ALIGN`).
- The icon has the same colour as the digits and is drawn additive.

### 1.9 Colour, effects, fades and alpha

`CHudBaseElement::GetColor (0xD7D5E)`:
1. `t = now − start time`. The start time is set at the first draw after
   `Start` (0xD7CEE). With `HUD_ELEM_EFFECT_ONCE` (64), when `t ≥ fxTime` the
   client uses `t = 0.999 * fxTime`.
2. Effect colour `CHud::GetEffectColor (0xDB6F8)(effect, color1, color2, fxTime, t)`
   (arguments pushed at 0xD7DA2–0xD7DC5): 0 and unknown values give color1;
   1 and 2 are linear ramps; 3 and 6 are triangle and cosine (the function
   calls itself); 4 and 5 are cosine ramps; 7 toggles color1 and color2 at half
   of the period; 8 is a sine pulse. The period is `fmod(t, fxTime)`. Effect
   names: `outputdocs.txt:33387–33440`.
3. Fade: while `t ≤ fadein`, alpha × `t/fadein`. When `hold ≥ 0` and
   `t > fadein + hold`, alpha × `1 − (t − fadein − hold)/fadeout`. When the
   fade-out ends, or when `fadeout ≤ 0`, alpha becomes 0 and the element is
   hidden. With `hold < 0` the element never expires. The server default is
   −1 (0x2BCFD0, 0x2BCED4). With `hold = 0` and `fadein = 0` an element shows
   for one frame only.
4. `HUD_ELEM_DYNAMIC_ALPHA` (256): alpha × `lerp(default, max, flash/100)/255`
   (`CHud::GetDynamicAlpha (0xDBA5A)`). The flash becomes 100 when
   `NumDisplay` or `UpdateNum` changes the value (0xD8C5C, 0xD85C8), and on
   every `TimeDisplay` or `UpdateTime` with this flag (0xD8E14, 0xD86D2). It
   goes down by 20 per second (`CHud::DecayFlash (0xDB9EC)`), so one flash
   lasts 5 s. `CustSpr` never sets the flash, so a sprite with this flag uses
   the default alpha.
   Else `HUD_ELEM_DEFAULT_ALPHA` (128): alpha × `clamp(hud_alpha_default, 0, 255)/255`
   (`CHud::GetDefaultAlpha (0xDB2B8)`).
   Else: the alpha comes from the colour only. It can be 255, which is brighter
   than the native HUD.
   `max` is `clamp(hud_alpha_max, default, 255)` (`sub_DB2E0`).
5. r, g and b are multiplied by `alpha/255` (`ScaleColors (0xDA964)`). An element
   with alpha 0 is not drawn.

Draw mode (sprites only, `CHudCustomSprite::Start (0xB48EE)`):
`HUD_SPR_OPAQUE` (0x10000) uses `SPR_Draw`; else `HUD_SPR_MASKED` (0x20000)
uses `SPR_DrawHoles`; else `SPR_DrawAdditive`. Numbers and time displays are
always additive. The engine `SPR_Set (hw.so 0x102E00)` calls
`glColor4f(r/255, g/255, b/255, 1.0)`. Thus alpha only changes the brightness:
opaque and masked sprites become darker, not translucent.

Defaults: `hud_alpha_default` 160 and `hud_alpha_max` 255 (`CHud::Init (0xD6086)`
at 0xD6A27 and 0xD6A4B, both archived client cvars). The API calls the first one
"hud_defaultalpha" (`outputdocs.txt:33337`), which is not the real name.

### 1.10 Border

- `hud_bordersize` (default 16, archived, 0xD6A03) is an inset in pixels on all
  four sides, clamped to 0–100. It moves custom elements (see 1.5) and native
  elements (see 2.2). `HUD_ELEM_NO_BORDER` sets the border to 0 for one element.
- `hud_debug 2` draws the border rectangle in green
  (`CHud::DrawHudElements (0xDA518)` → 0xDA256) and an outline around each
  sprite that `DrawHudSprite` draws (0xDAA87). `hud_debug 1` adds markers and
  console logs for the channels. This is a client cvar.

### 1.11 Visibility and lifetime

- `CHudCustom::VidInit (0xD8F2A)` deletes all 32 elements. `VidInit` runs at
  each level load, so a server must send its elements again after each map
  change or reconnect. `ResetHUD` does not clear them (`CHudCustom` Reset is a
  bare `ret` at 0xD7F26).
- `HUD_ELEM_HIDDEN` (32) creates the element hidden (0xD7C04). `ToggleElem` sets
  only the visible byte (0xD845A). It does not restart the clock, so it cannot
  bring back an element whose hold time has ended. Send that element again.
- Group hiding (`CHudCustom::Draw (0xD82F2)`):
  group 0 (maps, client channels 0–15) is hidden by `HIDEHUD_CUSTOM_MAPS` (64),
  by `hud_hidecustom 1` and by `hud_hidecustom` above 2.
  Group 1 (plugins, 16–31) is hidden by `HIDEHUD_CUSTOM_PLUGINS` (128) and by
  `hud_hidecustom` 2 or more.
  `HIDEHUD_ALL` and `hud_draw 0` hide everything (2.1).
- Custom elements do not need the HEV suit.

### 1.12 Limits and flags that do nothing

- 16 channels for each group, 32 on the client.
- `left` and `top` are one byte (0–255). A region that starts after x 255 or
  y 255 in a sheet cannot be selected, for example the `cs1024.spr` icons at
  x 340 and 510. Width and height are clamped to 0–512 by the server.
- `HUD_SPR_PLAY_ONCE` (0x40000) and `HUD_SPR_HIDE_WHEN_STOPPED` (0x80000) are
  never read. `CHudCustomSprite::Draw (0xB495A)` uses
  `frame + int(framerate * t) mod numframes` and has no other flag test (95
  instructions). `Start (0xB48EE)` reads only 0x10000 and 0x20000. Animations
  always loop.
- Engine limit: 256 different HUD sprite paths. `SPR_Load (hw.so 0x102880)`
  calls the fatal error routine `0xAF0A0` with "Cannot allocate more than %d
  HUD sprites" (256). The `hud.txt` sheets, each weapon txt sprite, `pain.spr`
  and each custom element sprite take a slot. The same path (compared without
  case) uses the same slot.
- Constructor defaults (`server.so` 0x2BCFD0 for `HUDNumDisplayParams`,
  0x2BCED4 for `HUDSpriteParams`): colours (0,0,0,0) so alpha 0 (invisible),
  x = y = −1 (top-left), `maxdigits` 0 ("0+"), `holdTime` −1 (forever),
  sprite `numframes` 1 and `framerate` 10.

## 2. Native HUD

### 2.1 Frame gate

`HUD_Redraw (0xA4536)` → `CHud::Redraw (0xDA606)` →
`CHud::DrawHudElements (0xDA518)`. Nothing is drawn when the screen is less
than 640 px wide, when `hud_draw` is 0, or when `HIDEHUD_ALL` (4) is set.
During intermission only the elements with the intermission flag are drawn.

### 2.2 Native elements

`b` = border (1.10), `fontH` = 20, row 1 y = `H − fontH − b`, row 2
y = `H − 2*fontH − b − fontH/2` (`sub_DB24E`). "No suit" means that bit 31 of
`m_iWeaponBits` is clear (2.3).

| Element | Class (Init / Draw) | Position | Colour | Hidden by |
|---|---|---|---|---|
| Health | `CHudHealth` (0xC9B0E / 0xCAD22) | cross at x = b, number at b + crossW + 4, row 1 | (100,130,200); (250,0,0) when health ≤ 25 | `HIDEHUD_HEALTH`; no suit hides the cross and number |
| Bar after health | `CHudHealth` (0xCAF7A) | after the number | as health | `HIDEHUD_SUITPOWER` too |
| Armour | `CHudBattery` (0xA3B7E / 0xA3C68) | x = b + d, row 1. `d = healthW + digitW/2`; if `d ≤ (W−2b)/6`, then `d = min((W−2b)/6, 240)` (0xA3E0B–0xA3E43) | (100,130,200) | `HIDEHUD_SUITPOWER`; no suit |
| Ammo | `CHudAmmo` (0x9E6C0 / 0xA1E40) | icon at W − b − iconW, numbers to its left; row 1 primary, row 2 secondary | (100,130,200), dynamic alpha | `HIDEHUD_AMMO`, `HIDEHUD_WEAPONS`; no suit |
| Weapon menu | `CHudAmmo` DrawWList (0xA1396) | from (b, b), see 4.3 | (100,130,200); empty weapons (255,16,16) at half alpha | `HIDEHUD_WEAPONS`; no suit |
| Pickup history | `HistoryResource` (0xA3600), from `CHudAmmo::Draw` | right side, up to 12 rows above the ammo | (100,130,200); red for empty weapons; fades from max alpha | `HIDEHUD_WEAPONS` (not `HIDEHUD_AMMO`) |
| Flashlight | `CHudFlashlight` (0xC8EB4 / 0xC9052) | x = W − b − width, y = b | (100,130,200); (255,16,16) below 20 % | `HIDEHUD_FLASHLIGHT`; no suit |
| Damage icons | `CHudHealth` `sub_C9CC0` | from the `Damage` message | (100,130,200), pulse \|sin 2t\| × max alpha | `HIDEHUD_HEALTH` |
| Pain arrows | `CHudHealth` `sub_CA656`, `sprites/pain.spr` (0xC9BFC) | around the screen centre | (100,130,200); (250,0,0) when health ≤ 25 | `HIDEHUD_HEALTH` |
| Train | `CHudTrain` (0x106EE0 / 0x106F3C) | x = b + W/3 + w/4, y = H − b − h | (100,130,200), max alpha | `HIDEHUD_ALL` only |
| Inventory icons | `CHudInventoryIcon` (0xD90F6 / 0xD9248) | right side, middle | (100,130,200) | no suit |
| Crosshair | `CHudCrosshair` (0xB46AA / 0xB46EE) | screen centre | white | see 3 |

- `HudText`, `ShowMenu`, `SayText` and `NotifyText` are drawn by `CHudMessage`,
  `CHudMenu`, `CHudSayText` and `CHudNotifyText`. I did not analyse their hide
  checks.
- Scoreboard, MOTD and vote menus are VGUI (the hooks are in `CHud::Init`).
  They are not part of the sprite HUD.
- ID / name display: neither binary has `StatusText` or `StatusValue`. Thus
  there is no HL status bar. I did not find where Sven draws player names.

### 2.3 `m_iHideHUD` bits

The server sends `HideHUD` (ID 91, size 2) with one short. The client stores it
at `gHUD+0x88` (`CHudAmmo::MsgFunc_HideWeapon (0xA0026)`). Bit values:
`outputdocs.txt:33125–33179`.

| Bit | Name | Client effect (evidence) |
|---|---|---|
| 1 | `HIDEHUD_WEAPONS` | `CHudAmmo::Draw` returns at once (0xA1E77): no ammo, no weapon menu, no pickup history. The `HideHUD` handler clears the selection and the crosshair (0xA005F). `SelectSlot` (0x9F87E), `invnext` and `invprev` (0xA08D6, 0xA0C58) refuse. `CurWeapon` sets no crosshair (0xA021C). |
| 2 | `HIDEHUD_FLASHLIGHT` | flashlight is not drawn (0xC9071) |
| 4 | `HIDEHUD_ALL` | nothing is drawn, custom elements too (0xDA56A) |
| 8 | `HIDEHUD_HEALTH` | `CHudHealth::Draw` returns at once (0xCAD4E): no number, cross, pain arrows or damage icons |
| 16 | `HIDEHUD_WEAPON_SELECT` | slot keys, `invnext` and `invprev` print "You must drop this weapon before selecting another weapon." and refuse (0x9F87A, 0xA08CE → 0xA0BBA). `Think` closes an open menu with `sub_9EFDE` (`wpn_hudoff.wav`, 0x9F2F2). The menu draw code does not test this bit. |
| 32 | `HIDEHUD_SUITPOWER` | armour is not drawn (0xA3C87); the bar after health is not drawn (0xCAF81) |
| 64 | `HIDEHUD_CUSTOM_MAPS` | custom group 0 (0xD8310) |
| 128 | `HIDEHUD_CUSTOM_PLUGINS` | custom group 1 (0xD836E) |
| 256 | `HIDEHUD_CROSSHAIR` | crosshair is reset by `HideHUD` (0xA005F) and not set by `CurWeapon` (0xA021C) |
| 512 | `HIDEHUD_AMMO` | ammo numbers and icons only (0xA1EB7); the menu and the history stay |

The HEV suit is a second switch. `CHud::UpdateClientData (0xD4EBC)` copies
`iWeaponBits` to `gHUD+0x221C`. Without bit 31 the client does not draw the
health number and cross, armour, ammo, the weapon menu, flashlight and
inventory (the pain arrows and damage icons still show). `SelectSlot` also
refuses (0x9F8C8). `CBasePlayer.SetHasSuit` exists (`outputdocs.txt:12730`),
but it breaks weapon switching, so it is not a way to hide the HUD.

### 2.4 Server control of colour and style

There is none.
- All native colours are immediate constants: (100,130,200) (for example
  0xA1F1F, 0xA3D26, 0xC9216, 0xA1574, 0xCAE04), (250,0,0) for low health
  (0xCAD94), (255,16,16) for low flashlight and empty weapons (0xC90D4, 0xA1C41).
  The crosshair is always (255,255,255) (`CurWeapon` 0xA02D2–0xA0467).
- `client.so` has no colour cvar. The `hud_*` cvars that it registers or reads
  are `hud_draw`, `hud_debug`, `hud_hidecustom`, `hud_bordersize`,
  `hud_alpha_default`, `hud_alpha_max`, `hud_capturemouse`,
  `hud_weaponautoswitch`, `hud_drawhistory_time`, `hud_fastswitch`,
  `hud_selection_timeout`, `hud_selection_fadeout`, `hud_saytext*` and
  `hud_takesshots` (strings 0x4A55D3–0x4AC942). The colour strings in
  `.rodata` are VGUI scheme keys and GL names.
- `ClassicMode` (0xD9C3C) writes a byte at `gHUD+0x94`. Only weapon prediction
  and event code read it, through `IsClassicMode (0x15F15C)`. No HUD draw
  function calls it (callees of 0xA1E40, 0xA1396, 0xA3C68, 0xCAD22, 0xC9052,
  0xB46EE, 0xD82F2, 0xA3600, 0xDBC48, 0xDA9CE). `GameMode` (0xD9616) writes
  `gHUD+0x90`, and no draw function reads it. `ViewMode` (0xD96EC) runs
  `thirdperson` or `firstperson`. The `ResetHUD` handler (0xD9C76) only sends
  `con_color "180 220 255"`.
- A server can change only these client cvars, with stufftext (section 5):
  `hud_alpha_default` and `hud_alpha_max` (brightness), `hud_bordersize`
  (inset), `hud_draw` (all or nothing), `hud_hidecustom`, `crosshair`,
  `hud_fastswitch`. None of them changes a colour or a native sprite.
- Native sprites come from the client's own `sprites/hud.txt` and from the
  weapon txts. A server can choose the weapon txts (`CustWeapon`,
  `WeaponSpr`, 4.1). Each native sprite is drawn after
  `SPR_Set(100,130,200)` scaled by alpha (0xDA9CE → `hw.so` 0x102E00). Thus each
  texel is multiplied by at most (0.39, 0.51, 0.78), and red is never above
  100. CS orange (255,160,0) is not possible on native elements.

### 2.5 User messages hooked by `client.so`

HUD-related messages are in bold.

| Registered in | Messages and handlers |
|---|---|
| `CHudAmmo::Init (0x9E6C0)` | **`CurWeapon`** 0xA04B0, **`WeaponList`** 0xA318C, **`CustWeapon`** 0xA324E, **`AmmoPickup`** 0x9FECA, **`WeapPickup`** 0x9FF5A, **`ItemPickup`** 0x9FFEA, **`HideHUD`** 0xA00F0, **`AmmoX`** 0x9FE30, **`WeaponSpr`** 0xA3310 |
| `CHudBattery::Init (0xA3B7E)` | **`Battery`** 0xA3FAA |
| `CHudFlashlight::Init (0xC8EB4)` | **`Flashlight`** 0xC934A, **`FlashBat`** 0xC9000 |
| `CHudGeiger::Init (0xC9516)` | `Geiger` 0xC9586 (sound only) |
| `CHudHealth::Init (0xC9B0E)` | **`Health`** 0xCA1D0, **`Damage`** 0xCB270 |
| `CHudCustom::Init (0xD7F28)` | **`ToggleElem`**, **`CustSpr`**, **`NumDisplay`**, **`UpdateNum`**, **`TimeDisplay`**, **`UpdateTime`** (1.1) |
| `CHudMenu::Init (0xE9108)` | **`ShowMenu`** 0xE97B2 |
| `CHudMessage::Init (0xE98EC)` | **`HudText`** 0xEB1D0, **`GameTitle`** 0xE9890 |
| `CHudNotifyText::Init (0xFEB96)` | **`NotifyText`** 0x1002AE |
| `CHudSayText::Init (0xFEBEC)` | **`SayText`** 0x1001B4 |
| `CHudTextMessage::Init (0x106706)` | **`TextMsg`** 0x106DA6, **`PrintKB`** 0x106E4C |
| `CHudTrain::Init (0x106EE0)` | **`Train`** 0x1070C8 |
| voice manager (`sub_16604C`) | `VoiceMask` 0x165758, `ReqState` 0x165EBE |
| `CHud::Init (0xD6086)` | **`ResetHUD`** 0xD3108, `GameMode` 0xD31FC, `ViewMode` 0xD3236, **`InitHUD`** 0xD3142, `CdAudio` 0xD3182, **`SetFOV`** 0xD4AB4, `Concuss` 0xD31C2, `VModelPos` 0xD4B52, `PrtlUpdt` 0xD3270, `Fog` 0xD32B0, `ClassicMode` 0xD32F0, `ValClass` 0xD3B46, `TeamNames` 0xD3B8E, `MOTD` 0xD3C1E, `ServerName` 0xD4332, `ServerVer` 0xD5174, `ServerBuild` 0xD3C66, `NextMap` 0xD3CB6, `ScoreInfo` 0xD3CFE, `TeamScore` 0xD3D46, `TeamInfo` 0xD3D8E, `Spectator` 0xD3DD6, `AllowSpec` 0xD3E1E, `VGUIMenu` 0xD3BD6, `Gib` 0xD30D8, `TE_CUSTOM` 0xD3330, `MapList` 0xD3080, `VoteMenu` 0xD33D8, `EndVote` 0xD341E, **`InvAdd`** 0xD3464, **`InvRemove`** 0xD34B4, `OnTank` 0xE2B8C, `Playlist` 0xD3A92, `Speaksent` 0xD510E, `TimeEnd` 0xD3366, `CbElec` 0xD1562, `ShkFlash` 0xCF88C, `TracerDecal` 0xCF108, `SporeTrail` 0xCEEF0, `CreateBlood` 0xD07A6, `GargSplash` 0xD085C, `StartSound` 0xD0DAC, `ToxicCloud` 0xD0928, `SRDetonate` 0xCFD22, `SRPrimed` 0xD15AC, `SRPrimedOff` 0xD15F6, `RampSprite` 0xD0256, `ShieldRic` 0xD0744, `WeatherFX` 0xD3F42, `CameraMouse` 0xD3E66, `Flamethwr` 0xBCA06, `ChangeSky` 0xD41F6, `ClServerInfo` 0xD57D2, `ClExtrasInfo` 0xD58C6 |

The search for other hooks: `pfnHookUserMsg` is `call [reg+48h]` with `reg` =
`gEngfuncs`. There are 166 `call [reg+48h]` sites in `.text`. The table above
has all the sites in functions that load `gEngfuncs`. 0x103D46 is model code.
The other 80 sites are at 0x1A9F15 or later, but all 415 instructions that
reference `gEngfuncs` (PIC offset 0x439FA0, objdump) are below 0x166992. Thus
those 80 calls cannot be `pfnHookUserMsg` (0x1A9ED4, for example, is
AngelScript compiler code).

`server.so` registers `SelAmmo` (64), `DeathMsg` (82), `ScreenShake` (94),
`ScreenFade` (95), `SoundList` (108) and `ASScriptName` (130), which
`client.so` does not hook (`sub_498240` against the list above). The strings
`ScreenShake` and `ScreenFade` are in `hw.so` (file offsets 0x26E8D0 and
0x26E8DC) and not in `client.so`, which agrees with GoldSrc, where the engine
hooks these two messages. `DeathMsg` has no client handler, so the kill feed
must be drawn by script.

## 3. Crosshair

- The crosshair is a client element, `CHudCrosshair` (vtable 0x5E1C40; Init
  0xB46AA, Draw 0xB46EE, SetCrosshair 0xB4844, Reset 0xB466C), at `gHUD+0x264`.
- Source: the weapon txt. `CurWeapon (0xA012C)` reads byte state, short weapon
  id, long clip, long clip2. State value 1 means "current weapon" and value 2
  means "on target". While `m_iFOV` (`gHUD+0x8C`, written by `SetFOV` 0xD49D4)
  is 50 or more, it chooses `crosshair`, or `autoaim` when value 2 is set and
  that sprite exists. When `m_iFOV` is 49 or less it chooses `zoom` or
  `zoom_autoaim` (0xA024E). `zoom` defaults to `crosshair`, and
  `zoom_autoaim` defaults to `zoom` (0xA2BC4, 0xA2B82). The colour is always
  (255,255,255).
- Draw (0xB46EE): only when the sprite handle is not 0 and `(int)crosshair > 0`.
  `crosshair` is an engine cvar: archived, default "1" (`hw.so` cvar_t at
  0x2F1A88). The client reads it with `pfnGetCvarPointer` at 0xA41C4. The
  centre is (W/2, H/2), or a projected aim point in third person
  (`cam_thirdperson` 0xA9885C). The top-left corner is centre − rect/2. The
  client calls `SPR_Set(sprite, 255, 255, 255)` and `SPR_DrawHoles(0, x, y, rect)`.
  The crosshair is masked (palette index 255 is transparent), not scaled, and
  white.
- There is no dynamic or spread crosshair code and no `cl_crosshair_*` cvar
  (string search). CS 1.6 draws a dynamic crosshair with `FillRGBA`
  (`cs16-client/cl_dll/ammo.cpp:1467–1600`, cvars at `ammo.cpp:283–286`).
- The engine has its own crosshair (`hw.so` 0x102700, armed by `SetCrosshair`
  0x1026A0). The client never calls `pfnSetCrosshair`: the `+0x34` calls near a
  `gEngfuncs` load go through the sub-table at `gEngfuncs+0x150`
  (0xBBAAD–0xBBAC6, 0xCE968–0xCE976).
- Hide: `HIDEHUD_WEAPONS` or `HIDEHUD_CROSSHAIR` (0xA005F), `crosshair 0`,
  `HIDEHUD_ALL`, `hud_draw 0`.
- This repository: 23 weapon txts set `crosshair 640 cs16/crosshairs 256 0 256 256`.
  `sprites/cs16/crosshairs.spr` is one 256×256 frame and every pixel is index
  255 (`spr-stats.ts`). The rect is fully outside the frame, so the engine draws
  the whole frame (4.5, item 3), which is transparent. The native crosshair is
  therefore invisible. This works only because of the engine clamp. The sniper
  txts use `0 0 1 1`, which is cleaner.

## 4. Weapon selection and weapon txt files

### 4.1 Messages

- `WeaponList` (ID 76, parser 0xA301C): string name, char ammo 1 type, long
  max 1 (255 → −1), char ammo 2 type, long max 2, char slot, char position,
  **short** id, byte flags. The record (860 bytes) is at
  `0x61F6C0 + 860 * id`; there are 256 records (cleared in `CHudAmmo::Init`,
  0x9E986). The id is not checked, so an id of 256 or more writes past the
  array. The txt name is the weapon name and the sub-directory is empty.
- `CustWeapon` (ID 77, 0xA31C8): short id, string directory. It sets the
  sprite sub-directory and loads the sprites again. The server sends it for
  `g_ItemRegistry.RegisterWeapon(name, spriteDir)` (`outputdocs.txt:4631`; this
  repository: `scripts/cs16/base.as:77`, `89`).
- `WeaponSpr` (ID 138, 0xA328A): short id, string name. It sets the txt name
  and loads the sprites again.

### 4.2 Loading

`WeaponsResource::LoadWeaponSprites (0xA2522)`:
- Path: `sprites/<dir>/<name>.txt` when a directory is set, else
  `sprites/<name>.txt`.
- `SPR_GetList (hw.so 0x1031A0)`: the first token is the row count. It then
  reads that many rows of name, resolution, sprite, x, y, w, h, with
  right = x + w and bottom = y + h. It does not validate the count or the values.
- `GetSpriteList (0x9EA50)` returns the first row that has the key and the
  resolution 640. The key compare is `strcmp` (`sub_9AA40` is the PLT stub of
  GOT `strcmp_ptr` 0x61C1A0), so the keys are case-sensitive.
- Keys: `crosshair`, `autoaim`, `zoom` (default `crosshair`), `zoom_autoaim`
  (default `zoom`), `weapon` (not selected), `weapon_s` (selected), `ammo`,
  `ammo2`. Each sprite is loaded with `SPR_Load("sprites/<sprite>.spr")`. A
  missing key gives handle 0 and an all-zero rect.
- `CHudAmmo::VidInit (0xA2DD2)` loads all registered weapons again. It takes
  the bucket size from `hud.txt` `bucket1` (20×20 in Sven, `hud.txt:13`) and
  the `selection` frame index.

### 4.3 Layout

`CHudAmmo::DrawWList (0xA1396)`:
- It draws only while a selection is open (`gpActiveSel` 0x61F6A0). After
  `hud_selection_timeout` (1.5 s, 0x9E949) it fades out over
  `hud_selection_fadeout` (0.5 s) and closes (0xA13CC–0xA1642).
- Headers: `hud.txt` `bucketN` sprites in a row at y = b, from x = b. A header
  is 20 px wide, except that the open slot uses the `weapon_s` width of the
  first weapon in that slot (0xA15EA–0xA1603). The step is width + 5. The
  colour is (100,130,200) × default alpha; the open header uses
  (default + max)/2 (0xA134C).
- Open column: y starts at b + bucket height + 1. The selected weapon draws
  `weapon_s` at max alpha plus the `hud.txt` `selection` frame (Sven
  `640hud3 0 180 170 45`, `hud.txt:11`) at the same place. The other weapons
  draw `weapon` at default alpha, or in (255,16,16) at half alpha when they have
  no ammo. Ammo bars are 20×4 px at (x+10, y+1) (0xA1252). The row step is the
  `weapon_s` height + 5, also for rows drawn with the `weapon` rect.
- Closed columns: one 20×20 box for each weapon (`FillRGBA`), with a step of 25.
- No scaling (1.6). Only rows with resolution 640 are read.

### 4.4 Comparison with Counter-Strike 1.6

| Item | Sven (`svencoop/sprites/hud.txt`) | CS 1.6 (`cstrike/sprites/hud.txt`) |
|---|---|---|
| `number_0` | `640hud7 0 0 20 20` (line 24) | `640hud7 0 0 20 25` (line 110) |
| `bucket1` | `640hud7 0 108 20 20` (line 13) | `640hud7 168 72 20 20` (line 95) |
| `selection` | `640hud3 0 180 170 45` (line 11) | `640hud3 0 180 170 45` (line 94) |
| HUD colour | (100,130,200), constant | (255,160,0) `RGB_YELLOWISH` (`cs16-client/cl_dll/hud.h:24`) |

### 4.5 Causes of glitched icons

1. Missing `.spr`: `Mod_LoadModel (hw.so 0x12B990)` replaces the path with
   `sprites/error.spr` and prints "Error: '%s' not found, swapping it for '%s'.".
   Sven's `error.spr` is 64×32 (`spr-stats.ts`). The txt rect is then used on
   `error.spr`, so a wrong image appears.
2. Rect partly outside the frame: `AdjustSubRect (hw.so 0x127AA0)` clamps the
   rect, so the image is cut. The client still uses the size that was asked
   for (selection frame, row step, icon centring), so the icon is not aligned.
3. Rect fully outside the frame, or empty (left ≥ right or top ≥ bottom, for
   example all zero): `AdjustSubRect` changes nothing, so the **whole frame**
   (the whole sheet) is drawn.
4. Handle 0 (key missing, row not 640, `SPR_Load` failed): the engine
   `SPR_Set (0x102E00)` ignores a handle of 0 or less, or a handle that is too
   large. The previous sprite and colour stay active. The next draw shows
   part of the sprite that was drawn just before, or all of it when the rect
   is zero (item 3). Example: a txt without a `weapon` row.
5. A count line that is larger than the number of rows makes `SPR_GetList` read
   past the end (empty names and zeros). A smaller count ignores the extra rows.
6. Rows with a resolution other than 640 are ignored (0x9EA50), which gives
   item 4.

Check of this repository with `.re/tools/spr-check.ts`: 27 weapon txts. All
rows are 640, the counts are correct and the sprites exist. The only finding is
the `crosshair` rect outside `crosshairs.spr` in 23 files (see 3).

A related defect is in the killfeed (custom elements, 1.4).
`scripts/cs16/killfeed.as:322–326` sends the `left`/`top` of a `d_*` sprite
with `width = 0` and `height = 0`. The client then draws from (left, top) to
the bottom-right corner of the 256×256 `640hud1` sheet. Example: `d_ak47` is
`640hud1 192 80 48 16` (`cstrike/sprites/hud.txt:151`). The client draws the
64×176 region (192,80)–(256,256) instead of 48×16. Fix: send `wf.width` and
`wf.height`.

## 5. Stufftext

Client engine (`hw.so`):
- svc table entry at 0x2E20AC: `{9, "svc_stufftext", 0x1039B0}`.
- `CL_ParseStuffText (0x1039B0)`: it reads the string. When
  `cl_filterstuffcmd > 0`, it drops the whole message if a byte is 31 or less
  and is not `\n` ("Blocked stufftext message containing invalid
  character(s)"). The compare uses signed `char`, so bytes 128–255 are
  blocked too. Then it adds the text to a separate buffer
  (`Cbuf_AddStuffText (0x57170)`, buffer 0x2F4A68).
- `Cbuf_Execute (0x58830)` runs the normal buffer first. Then it runs the
  stufftext buffer with the "from server" flag 0x2F4A90 set to 1.
- `Cmd_ExecuteString (0x58530)`: when the flag is set and `sub_7B7A0` returns
  false, the command must pass `Cmd_IsAllowedFromServer (0x56E90)`. Else the
  engine prints "Blocked "%s" command from server". `sub_7B7A0` compares a
  max-clients value with 1, so it is probably the single-player test.
- `Cmd_IsAllowedFromServer` (lists printed with `elf-strtab.ts`; all compares
  are `strncasecmp`, 0x5A900 and 0x5A960, so case does not help):
  - Always blocked: names that start with `_` (0x2EE654); `cl_filterstuffcmd`,
    `alias`, `bind`, `unbind`, `unbindall`, `exit`, `quit`, `writecfg`, `say`,
    `say_team` (0x2EE660).
  - With `cl_filterstuffcmd ≤ 0`: everything else is allowed.
  - With `cl_filterstuffcmd > 0`: `r_drawviewmodel`, `cl_forwardspeed`,
    `cl_backspeed` and `cl_sidespeed` are allowed. The prefixes `cl_`, `gl_`,
    `m_`, `r_`, `s_`, `fs_`, `fps_`, `hud_`, `net_`, `voice_` and `joy` are
    blocked (0x2EE5A0). These names are blocked (0x2EE5E0): `connect`, `retry`,
    `ex_interp`, `developer`, `timerefresh`, `rate`, `cd`, `speak_enabled`,
    `sensitivity`, `sys_ticrate`, `removedemo`, `volume`, `MP3Volume`,
    `motd_write`, `hideconsole`, `toggleconsole`, `gamma`, `brightness`,
    `screenshot`, `snapshot`, `+voicerecord`, `+mlook`, `+klook`, `+jlook`,
    `-voicerecord`, `-mlook`, `-klook`, `-jlook`. `exec` is also blocked,
    unless an internal check (`sub_B2860(2)`) passes.
- `cl_filterstuffcmd`: cvar_t at 0x2F11EC, default "0", flags 1 (archived).
  The filter is off by default; a player can turn it on and it stays on.
- `Cvar_Command (0x64920)` refuses only flag 0x40 ("Can't set %s in
  multiplayer") and flag 0x400 ("Can't set %s with cheats disabled"). It does
  not check where the command came from.

Target cvars:
- `cl_bob` "0.01", `cl_bobcycle` "0.8", `cl_bobup` "0.5": flags 0, so they are
  not archived (client 0x12E018). `V_CalcBob (0x12B362)` reads them. The
  formula and the defaults are the same as in CS 1.6
  (`cs16-client/cl_dll/view.cpp:157–199`, `1885–1887`), so no change is needed.
- `hud_*`: flags 16 or 17 (`CHud::Init`). The ones with flag 17 are archived,
  so a value that a server stuffs is saved in the player's `config.cfg`.
- `crosshair`: engine cvar, archived.

Result: with the filter off (the default) a server can set `cl_bob`,
`cl_bobcycle`, `cl_bobup`, every `hud_*` cvar and `crosshair`. With the filter
on, `cl_*` and `hud_*` are blocked, but `crosshair` is still allowed.

Server (`server.so`):
- The `NetworkMessage(dest, type, …)` factories (0x1C24DA, 0x1C2090) call the
  engine `MessageBegin` directly. They do not check the type.
- `NetworkMessages::SVC_STUFFTEXT` = 9 is registered at 0x1C40F6 (name at
  0x8A2E73; `outputdocs.txt:32555`). This repository already uses it
  (`tests/e2e/e2e.as:76`).
- I did not analyse the dedicated server engine binary.

## 6. Implications for Counter-Life

Possible from a server script (AngelScript plugin):
1. Hide native parts for each player with `m_iHideHUD`: `HIDEHUD_HEALTH`,
   `HIDEHUD_SUITPOWER`, `HIDEHUD_AMMO` and `HIDEHUD_FLASHLIGHT`. Do not set
   `HIDEHUD_WEAPONS` or `HIDEHUD_WEAPON_SELECT`, because they stop the slot
   keys. `HIDEHUD_CROSSHAIR` affects only the crosshair.
2. Draw the CS HUD again with custom elements. Use CS sheets copied to
   `sprites/cs16/`, `color1 = (255,160,0,a)` and additive drawing. A plugin
   gets client channels 16–31, so it has 16 elements.
3. For pixel-exact CS positions use `HUD_ELEM_ABSOLUTE_X/Y` with
   `HUD_ELEM_NO_BORDER` and negative values for the right and bottom edges. CS
   anchors: health and ammo row y = H − fontH − fontH/2
   (`cs16-client/cl_dll/health.cpp:276`, `ammo.cpp:1106`), armour x = W/5
   (`battery.cpp:114`), money x = W − 7 × dollar width (`hud/money.cpp:87`).
   To centre, use `SCR_CENTER` with 0, not −1.
4. Digits: `HudNumDisplay` always uses the Sven 20×20 digits. For CS digits,
   use one `HudCustomSprite` for each digit and select the digit with
   `left`/`top` in a copy of the CS `640hud7` (CS digits are 20×25 at y 0 and
   x 0 to 216, `cstrike/sprites/hud.txt:110–119`, so they are inside the 0–255
   limit). A sprite with 10 frames and the `frame` field also works. Both need
   one channel for each digit:
   health 3 + armour 3 + ammo 3 + 3 + money 5 = 17, which is more than 16. You
   must combine, or use the map group from a map script.
5. Each change needs the full element message again (about 60–80 bytes).
   `UpdateNum` (5 bytes) works only for `HudNumDisplay`. Send all elements again
   after each map change or reconnect (1.11).
6. Weapon menu: it must stay native. Its icons can be CS icons through the
   weapon txts, but they are always tinted (100,130,200) × alpha and use the
   Sven bucket numbers and selection frame. Keep every rect inside its frame and
   every sprite present (4.5).
7. Crosshair: the native crosshair is a static, white, masked sprite. For a CS
   dynamic crosshair, hide the native one and draw 4 bars with
   `HudCustomSprite` using `ABSOLUTE` + `SCR_CENTER_X/Y` offsets (4 channels);
   each gap change needs 4 messages. The simple option is a static CS crosshair
   sprite in each weapon txt.
8. Stufftext works only for players with `cl_filterstuffcmd 0`, and archived
   cvars stay changed in the player's config. Do not rely on it for the look.
   The view bob is already the same as in CS.

Not possible from the server:
- Native colours, native digits, bucket numbers, the selection frame, the
  pain sprite, and any scaling (1.6, 2.4).
- Hiding only the weapon menu without breaking weapon switching (2.3).
- Overriding files in the client's `svencoop/` directory, for example
  `sprites/hud.txt`.

What a metamod plugin (`metamod-p-rs`) can add:
- It can send `CustSpr`, `NumDisplay` and `TimeDisplay` directly to any client
  channel from 0 to 31. Thus it can use both groups (32 elements) without the
  module-type rule. It must never use a channel above 31 (1.3).
- It can watch or change outgoing engine messages, for example `HideHUD`,
  `WeaponList` and `CustWeapon`, and it can send `svc_stufftext` itself (the
  same client filter applies).
- It can send updates faster and only when values change.
- It cannot change how `client.so` draws (colour, digits, scaling), because the
  client is closed source.

## Open points

- I did not analyse the hide checks of `CHudMessage`, `CHudMenu`,
  `CHudSayText` and `CHudNotifyText`.
- I did not find where Sven draws player names (ID display).
- I did not decompile the server writers of `UpdateNum` and `UpdateTime`. The
  layout above comes from the client parsers and the registered sizes.
- I did not analyse the dedicated server engine. It may filter
  `svc_stufftext` before it sends it.
- I did not test any of this in a running game, because no game client may be
  started. A test with `hud_debug 2` would confirm 1.5 and 4.5.
