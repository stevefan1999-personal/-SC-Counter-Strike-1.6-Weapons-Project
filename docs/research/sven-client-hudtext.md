# Sven Co-op HUD text and death notices

Research notes for the Counter-Life kill feed. They tell how the Sven Co-op
client draws `g_PlayerFuncs.HudMessage` text, and how Sven shows its own death
notices. Companion document: `sven-client-hud.md` (custom sprites, numbers,
native HUD, weapon menu, stufftext).

Scope: Sven Co-op 5.26, engine build 10269, Linux, 32-bit.

## Evidence

| File | SHA-256 | Copy that was analysed |
|---|---|---|
| `Sven Co-op/svencoop/cl_dlls/client.so` | `50580344e1c59b3c77e8e4e52ed9f185fcec7da2da936873ec122f12c735a022` | `.re/client/client.so` |
| `Sven Co-op/hw.so` | `8cead76a51204a4ba1036c85cc2099b7c3542950d924846a9aa2ccf619df7dfd` | `.re/engine/hw.so` |
| `Sven Co-op/vgui2.so` | `2aa3fbcda3339c5eade316d9011d0258bee20adcc3db0708564526dbcf9df8d3` | `.re/vgui2/vgui2.so` |
| `Sven Co-op Dedicated Server/svencoop/dlls/server.so` | `7a980bbd4b03f7380092e45d0a7515085ffb5142e62589d87e2596e90d89d2ca` | `.re/server/server.so` |

- IDA Pro (idalib, Hex-Rays) through the IDA MCP tools. A name such as
  `MessageAdd (0xEABEA)` is a name that I gave to `sub_EABEA`. An address
  without a file name is in `client.so`.
- `outputdocs.txt:LINE` is `sven-coop.github.io/outputdocs.txt`.
- `cs16-client/...` is the FWGS Counter-Strike client source in this
  workspace.

## Summary

1. `HudMessage` is not a user message. The server sends `SVC_TEMPENTITY` /
   `TE_TEXTMESSAGE` (29). The engine stores it in one of 8 slots and tells the
   client with a fake `HudText` message `__NETMESSAGE__<slot+1>`.
2. A plugin has 4 text slots and a map script has 4 other slots. Channel 0 and
   1 share a slot, 5–8 repeat 1–4, and every channel above 8 goes to the slot
   of channel 4. Text slots and sprite channels never collide.
3. x and y are fractions inside the HUD border (`hud_bordersize`, default
   16 px). `−1` centres. A negative value anchors the **right edge of each
   line** (or the bottom of the block). There is no pixel mode and no
   `NO_BORDER` mode for text.
4. The font is the VGUI2 scheme font `CreditsFont` ("Ariel", weight 600,
   anti-aliased). It scales with the screen height: tall = ⌊12 × H / 480⌋
   (27 px at 1080, 36 px at 1440). "Ariel" is not a real font, so the
   operating system picks the face. A server can only estimate a name width.
5. `a1 > 0` draws normal (opaque) glyphs; `a1 = 0` draws additive glyphs. No
   other use of alpha. Fades move the colour to black.
6. Sven has no client kill feed. The client does not hook `DeathMsg`. The
   server prints each death as a `TextMsg` (`HUD_PRINTNOTIFY`) line, which the
   client shows in the top-left notify block. No cvar and no AngelScript API
   stops it. A metamod plugin can block the message.

## 1. Path of one HudMessage

### 1.1 Server encoder (`server.so`)

- `HudMessage` is bound to `0x2BDE74` (`lea` at 0x2C0123, declaration string
  0x8CAAA4 used at 0x2C0200). It copies the 40-byte `HUDTextParams`, maps the
  channel (1.2) and calls `UTIL_HudMessage (0x544214)` when the player is
  connected (0x546D4C).
- `HudMessageAll` (`0x2BDECA`, `lea` at 0x2C0222) loops over all player slots
  and sends one `MSG_ONE` message to each connected player (0x546D8A).
- `HUDTextParams` layout (property offsets registered at 0x2BE460–0x2BE6EC):
  x 0, y 4, effect 8, r1 g1 b1 a1 12–15, r2 g2 b2 a2 16–19, fadeinTime 20,
  fadeoutTime 24, holdTime 28, fxTime 32, channel 36. This is the HL
  `hudtextparms_t`.

`UTIL_HudMessage (0x544214)` writes:

| # | Type | Value | Limits (server) |
|---|---|---|---|
| — | header | `MESSAGE_BEGIN(MSG_ONE, SVC_TEMPENTITY = 23, player)` | 0x54425B–0x544281 |
| 1 | byte | `TE_TEXTMESSAGE` = 29 | 0x54428E |
| 2 | byte | channel after mapping (1.2) | 0x54429B |
| 3 | short | `int(x × 8192)` | clamped −32768…32767 (0x5442AF–0x5442DC) |
| 4 | short | `int(y × 8192)` | same (0x5442E9–0x54430C) |
| 5 | byte | effect | 0x544318 |
| 6–13 | 8 bytes | r1 g1 b1 a1 r2 g2 b2 a2 | 0x544325–0x544380 |
| 14 | short | `int(fadeinTime × 256)` | clamped 0…65535 (0x544395–0x5443BA) |
| 15 | short | `int(fadeoutTime × 256)` | same |
| 16 | short | `int(holdTime × 256)` | same |
| 17 | short | `int(fxTime × 256)`, **only when effect = 2** | 0x54441C–0x54449B |
| 18 | string | text, cut to 511 characters | 0x54442F–0x54446B |

(Hex-Rays shows the constant 0xFFFF as the string `"trigger_entity_iterator"`,
because a string starts at address 0xFFFF. The value is the clamp 65535.)

Results: positions have a step of 1/8192. Times have a step of 1/256 s and a
maximum of 255.99 s. A text cannot stay forever (custom sprites can, with
hold −1).

### 1.2 Channels

Server mapping (`0x2BDDC2`, applied before 1.1):
- Base: 0 when the calling module is a plugin or when there is no module,
  4 when it is a map script (module type 0; the same module-type test as for
  custom sprites, `sub_120AD8` stores the type).
- Channel `c ≤ 0` → base. `c` 1…8 → `base + ((c − 1) & 3)`. `c > 8` → `base + 3`.

| Script channel | Engine slot (plugin) | Engine slot (map script) |
|---|---|---|
| 0, 1, 5 | 0 | 4 |
| 2, 6 | 1 | 5 |
| 3, 7 | 2 | 6 |
| 4, 8, 9, 10, … | 3 | 7 |

Engine (`hw.so`):
- `CL_ParseTEnt (0x11C9A0)` sends case 29 to `CL_ParseTextMessage (0x11C840)`
  (jump table 0x11C9E6, call at 0x11DD88).
- Slot = channel byte % 8 (0x11C860). There are 8 slots of 44-byte
  `client_textmessage_t` at 0x2F0580, with the names `__NETMESSAGE__1` …
  `__NETMESSAGE__8` (table 0x2F06E0, strings 0x266D8F–0x266DFF). Stock GoldSrc
  has 4.
- All plugins share engine slots 0–3. All map scripts share 4–7. Other server
  code that writes `TE_TEXTMESSAGE` with a raw channel (for example map
  entities) uses the same 8 slots.

Text and sprites do not collide. Custom sprites, numbers and time displays
use user messages 139–144 and the 32 element pointers of `CHudCustom`
(`sven-client-hud.md` 1.3). Text uses `TE_TEXTMESSAGE`, the 8 engine slots and
the 16 display slots of `CHudMessage` (1.4).

### 1.3 Engine parser (`hw.so 0x11C840`)

- x and y: signed short ÷ 8192 (0x11C88A, 0x11C8A0; `MSG_ReadShort 0x5E0F0`
  sign-extends with `cwde`).
- effect: byte, stored as int. Colours: 8 bytes.
- fadein, fadeout, hold: **unsigned** short ÷ 256 (0x11C903–0x11C92F;
  `0x5E150` has no sign extension).
- fxTime: read only when effect = 2 (0x11C935–0x11C99B). Else the slot keeps
  the old fxTime.
- Text: copied into `0x1488C20 + 512 × slot`, at most 511 bytes (0x11C966).
- Then `0x117160` dispatches the user message `HudText` with the slot name
  (0x11C980). `TextMessageGet (0xDA310)` returns the slot structure for that
  name.

### 1.4 Client display slots (`CHudMessage`)

`CHudMessage` is at 0xA55C20 (vtable `_ZTV11CHudMessage` 0x5E2434).
`CHudMessage::Init (0xE98EC)` hooks `HudText` → 0xEB1D0 → `MsgFunc_HudText
(0xEB160)`, which reads the name and calls `MessageAdd (0xEABEA)`.

`MessageAdd (0xEABEA)`:
1. It gets the message with `pfnTextMessageGet(name)` and skips a leading `#`
   (0xEAC1B). An unknown name (not a slot, not `titles.txt`) becomes a custom
   message: effect 2, colours (100,100,100,100) and (240,110,0,0), x −1, y 0.7,
   fade-in 0.01, fade-out 1.5, hold 5, fxTime 0.25 (0xEAD8A–0xEAE34).
2. If a display slot already shows the same structure (the same engine slot),
   that display slot is cleared (0xEAC28–0xEAD7C). Thus a new text on a slot
   **replaces** the old text on that slot.
3. It takes the first free of 16 display slots (`this+0x14`). If all 16 are in
   use, the message is **dropped** (0xEACC2–0xEB00C).
4. It clears every other displayed message that has the same x **and** the same
   y (difference < 0.0001) and a **different** text (`strcmp` stub 0x9AA40,
   0xEAE48–0xEAFCB). Two slots with the same position and the same text both
   stay.
5. It stores the start time `gHUD.m_flTime` (0xEAFEC–0xEAFF7). Each resend
   restarts the fade and hold clock.

`CHudMessage::Draw (0xEAB9E)` → `0xEA5A0`:
- After a level change it moves the start times (+0.2 s, 0xEA5C0–0xEA70A).
- End time: start + fadein + fadeout + hold; for effect 2, start +
  strlen × fadein + fadeout + hold (0xEA871–0xEA982). After the end the slot
  is cleared.
- `MessageDrawScan (0xE9F7E)` draws each live message (2, 3).
- No `m_iHideHUD` bit is tested. Text is hidden only by the global gate:
  `HIDEHUD_ALL`, `hud_draw 0`, or a screen less than 640 px wide
  (`CHud::DrawHudElements 0xDA518`). `HIDEHUD_CUSTOM_PLUGINS` and
  `hud_hidecustom` do not hide text.

## 2. Position

`MessageDrawScan (0xE9F7E)`:
- Lines are split at `\n`. Block height `h = lines × iCharHeight` (0xEA037).
- The y of the block comes from `YPosition (0xDB5CE)(y, h)` (0xEA070). Each
  next line is `iCharHeight` lower (0xEA251).
- For **each line**, the width `w` is the sum of `charWidths[byte]`
  (0xEA0E8–0xEA0F5), and the x comes from `XPosition (0xDB55C)(x, w)` (0xEA141).
  Thus every line is aligned alone. (HL uses the widest line for all lines.)

`XPosition` and `YPosition` call `CHud::CalcHudPos (0xDB324)` with
"absolute" = 0 and "no border" = 0. `v = −1` is replaced by 0 with the centre
flag set. Terms: `S` = screen width or height, `b` = `clamp(int(hud_bordersize), 0, 100)`,
`A = S − 2b`, `s` = line width `w` (x) or block height `h` (y).

| Input | Left edge (x) or top edge (y) |
|---|---|
| `v = −1` | `(S − s) / 2`: centred |
| `0 ≤ v` | `int(v × A + b)` |
| `−1 < v < 0` | `int((v + 1) × A + b − s)`: the right edge (or bottom) is at `(1 + v) × A + b` |

Clamp after that (0xDB3E8–0xDB43B): if `p + s > S − b`, then `p = S − b − s`;
if `p < b`, then `p = b`.

Notes:
- `x = 0` is the left border, not the right one. For the right border use the
  smallest negative step, `x = −1/8192`.
- The border is always active for text. A line can never touch the screen edge
  unless the player has `hud_bordersize 0`. Counter-Strike 1.6 draws the victim
  name to the exact right edge (`cs16-client/cl_dll/death.cpp:115`).
- A glyph is drawn only when its x and y are ≥ 0 and its right edge ≤ screen
  width (0xEA1D7–0xEA1E9).
- `hud_debug 2` draws a green outline around each text line (0xEA16D). Use it
  in a client to measure real widths.

Examples at 2560×1440 with `b = 16` (`A` = 2528 × 1408):

| Input | Result |
|---|---|
| `x = −1/8192`, line width 200 | left 2343, right edge 2543 (1 px inside the border) |
| `x = −0.1`, line width 200 | right edge 2291 |
| `y = 34/480` (current killfeed row 0) | top 115 (CS 1.6 row 0 is at 98, `death.cpp:107` with `YRES`, `cl_util.h:77`) |

## 3. Font and glyph widths

Chain of evidence:
1. Glyphs: `MessageDrawScan` calls slot 3 of the Svengine interface
   `SCEngineClient002` (pointer 0xA59304, set in 0xB0B6A) with
   (x, y, byte, r, g, b, flag) (0xEA238).
2. `hw.so` `CEngineClient` (vtable 0x2E1D94) slot 3 is 0xE49F0 → 0xDA4B0. It
   draws nothing when r, g and b are all 0. Else it draws the glyph with the
   VGUI2 surface in the font from 0x1BCA90, which returns `dword_7AE5DB0`.
3. `0x1BC7E0` sets `dword_7AE5DB0` to `CreditsFont` with proportional = 1 when
   `dword_462A50` is set, else to `Legacy_CreditsFont`.
4. `dword_462A50` is the `liblist.gam` key `scale_credits_font` (parser
   0x8D350, store at 0x8DB42). Sven sets it: `svencoop/liblist.gam:18`
   `scale_credits_font "1"`. The file is in the client's base directory, so a
   server cannot change it.
5. Widths: `GetScreenInfo (hw.so 0x15E190)` fills `iCharHeight` and
   `charWidths[256]` from the same font (0x1BD5F0): width = ABC a + b + c
   (`ISurface` +256) for bytes 0–255, height = font tall (`ISurface` +252).
   `CHud::Redraw (0xDA606)` reads the screen info each frame (0xDA676).
6. Definition: `svencoop/resource/TrackerScheme.res:320–328`:
   `CreditsFont` = "Ariel", tall 12, weight 600, antialias 1, no `yres`.
   `Legacy_CreditsFont` (lines 331–341) is "Ariel" 20/700 with `yres "1 10000"`
   and does not scale.
7. Scaling (`vgui2.so` `CScheme::LoadFonts 0xDAC0`): for the proportional
   variant, a glyph set **without** `yres` gets
   `tall = int(tall × screenTall / baseTall)` (0xDF6B–0xE0D7), capped at 128
   (0xE0E6). The base is 640×480 (`BaseUISurface::GetProportionalBase`,
   `hw.so 0x1C34C0`). `screenTall` comes from `GetScreenSize (hw.so 0x1BF530)`.
   English needs no change. Korean, Chinese and Thai raise tall ≤ 12 to 13;
   Russian uses 0.9 × tall, minimum 12 (`vgui2.so 0xD950`).

Font tall by screen height (`⌊12 × H / 480⌋`):

| H | 480 | 600 | 720 | 768 | 900 | 1024 | 1080 | 1200 | 1440 | 1600 | 2160 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tall (px) | 12 | 15 | 18 | 19 | 22 | 25 | 27 | 30 | 36 | 40 | 54 |

The face:
- "Ariel" is a typing error for "Arial" and is not a real family. The
  operating system chooses a substitute. On Linux, `hw.so` uses fontconfig and
  FreeType (it imports `FcFontMatch`, `FcConfigSubstitute`, `FT_New_Face`). On
  this machine `fc-match Ariel` gives Noto Sans. On Windows the GDI font mapper
  chooses. Thus glyph widths differ between players.
- Each **byte** is one glyph (`wint_t` = byte value, 0xDA4B0). UTF-8 names show
  as Latin-1 characters, one for each byte. A byte that `iswprint` refuses is
  not drawn but still moves x by its width (`hw.so 0x1BCC8E`, 0x1BCD9E).
- The width of a name in pixels is the sum of the advances of its bytes in the
  substitute face at the tall above. The server knows neither the screen
  height nor the face, so it can only estimate. The server can read a value
  that a player sets with `setinfo` (`GetInfoKeyBuffer`, `outputdocs.txt:5145`;
  `KeyValueBuffer.GetValue`, `outputdocs.txt:5398`). For example, a player
  could declare the screen height. Nothing in the client reports it
  automatically.

## 4. Colour, blending, effects, fade and hold

Blending (`MessageScanNextChar (0xE9AEE)` → flag at `this+0xC8` → `hw.so 0xDA4B0`):
- The flag is true when `a1 > 0`, or for the effect-2 highlight when `a2 ≠ 0`.
  The effect-1 overlay uses `a2` (0xE9D5E).
- Flag true: `DrawUnicodeChar` (`ISurface` +80, `hw.so 0x1BCD00`), normal blend.
  Flag false: `DrawUnicodeCharAdd` (`ISurface` +84, `hw.so 0x1BCBF0`), additive.
- Both set the text colour with alpha 255 (0x1BCC1E, 0x1BCD2E). Alpha has no
  other effect.
- A fade moves r, g and b toward 0. With additive glyphs this looks like a
  normal fade. With normal glyphs the text becomes **dark**, because it stays
  opaque. A glyph is skipped only when r, g and b are all 0.

Fade blend (`MessageScanStart (0xE9DE8)`), `t` = time since the start:

| Effect | Behaviour |
|---|---|
| 0 | fade-in from black over `fadein`, full colour for `hold`, fade-out to black over `fadeout` (`fadeout ≤ 0`: black at once) |
| 1 | as 0, and in about 10 % of the frames (`rand() % 100 ≤ 9`, 0xE9EF2–0xE9F21) each glyph is drawn again in colour 2 |
| 2 | glyph `i` appears at `i × fadein`; it shows colour 2 and goes to colour 1 over `fxTime`; fade-out starts at `length × fadein + hold` |
| other values | colour 1, no fade (0xE9B2D, 0xE9B3F) |

Times (1.1, 1.4): steps of 1/256 s, maximum 255.99 s, no "forever".

## 5. Limits

| Item | Limit | Evidence |
|---|---|---|
| Text slots for all plugins | 4 (engine slots 0–3) | `server.so 0x2BDDC2` |
| Text slots for all map scripts | 4 (engine slots 4–7) | same |
| Engine slots | 8 | `hw.so 0x11C860` |
| Client display slots | 16, extra messages are dropped | 0xEACC2 |
| Text length | 511 bytes | `server.so 0x54442F`, `hw.so 0x11C966` |
| One line | keep it short: the line is copied into a stack buffer of at most 284 bytes (IDA frame of 0xE9F7E) with no length check (0xEA0E8) | 0xE9F7E |
| Custom sprite channels (not shared with text) | 16 for each group | `sven-client-hud.md` 1.3 |

## 6. Native death notice

Client:
- `client.so` has no `DeathMsg`, `d_skull` or `d_headshot` string, and it hooks
  no `DeathMsg` (full hook list in `sven-client-hud.md` 2.5). A `DeathMsg` that
  reaches a Sven client draws nothing.

Server (`server.so`):
- `0x4261C4` is the multiplayer `DeathNotice` (gamerules vtable reference
  0xADAA68). It builds one English line and sends it with
  `UTIL_ClientPrintAll(HUD_PRINTNOTIFY = 1, line)` (call at 0x42648C;
  `0x546DEC` sends `MSG_ALL` `TextMsg`, `gmsgTextMsg` 0xB2B56C, 0x546E22–0x546E73).
  It sends no `DeathMsg`.
- Line formats (0x4263BE–0x426D30):
  - player killer: `<killer> : <weapon> : <victim>`. The weapon is the
    class name without `weapon_`, `monster_` or `func_`; `egon` becomes
    "gluon gun" and `gauss` becomes "tau_cannon" (0x42630A–0x426347).
  - monster killer: `<victim> was killed by a <monster>.` ("an" before a vowel).
  - suicide: `<victim> committed suicide.`
  - world and damage types: "drowned", "fell or something", "was smashed",
    "was killed by a mounted gun", "was shot", "blew up", "was electrocuted",
    and others; else "died mysteriously".
- The cvars `sv_log_player_deaths` (cvar_t 0xB18FC0) and
  `sv_log_monster_monster_kills` (0xB18FE8) control only the log lines
  (0x4262ED, 0x42654C). No cvar stops the notify line.
- `0x50E8A8` is the team-play `DeathNotice`. It returns at once when
  `this+28` (`m_DisableDeathMessages` in HL) is set. For a teammate kill it
  sends `DeathMsg(killer, victim, "teammate")` to all players (`gmsgDeathMsg`
  0xB2B59C), which the client ignores. Else it calls 0x4261C4.

Client display:
- `TextMsg` (0x106DA6 → 0x106978) sends destination 1 to `CHudNotifyText`
  (0xA56AB4, through 0xFFBB4), 2 to the console, 3 to `CHudSayText`
  (0xA55D0C) and 4 to the centre print.
- `CHudNotifyText` (constructor 0x1001F0, vtable `_ZTV14CHudNotifyText`):
  5 lines; the oldest line goes away every 5 s (0xFF4B9–0xFF6D3). Position
  (0xFEE5E): x = border, y = max(border, line step): the **top-left** corner.
  `CHudSayText` is the same text block class at 0xA55D0C (constructor 0x1000D6). Draw (0xFF45C) uses `CHud::DrawConsoleString (0xDAAE2)` →
  `pfnDrawConsoleString` (engine console font). It tests no `m_iHideHUD` bit.
  It hides while the VGUI viewport refuses text (0x1213BE), for example with
  the scoreboard open.

Suppression from the server:
- AngelScript: not possible. `PlayerKilled` and `MonsterKilled` are
  notifications (`outputdocs.txt:41220`, `41160`). There is no message filter.
  `HIDEHUD_ALL` would also hide every custom element and the CS HUD.
- A client cvar: none. `CHudNotifyText::Init (0xFEB96)` registers no cvar.
- metamod: possible. Hook the engine `MessageBegin`/`WriteByte`/`WriteString`/
  `MessageEnd` calls of the game DLL. When the type is `TextMsg`, the first
  byte is 1 and the string is an obituary line, supersede the message. The line
  is plain English with no `#` token, so a text match works. Other
  `HUD_PRINTNOTIFY` messages must pass.

## 7. Implications for the Counter-Life kill feed

Counter-Strike 1.6 reference (`cs16-client/cl_dll/death.cpp`): 4 notices
(line 42), 6 s each (line 43, cvar `hud_deathnotice_time`), row
`y = YRES(32) + 2 + 20 × i` (line 107), the victim name ends at the screen
edge (line 115), killer name + 5 px (lines 121–126), weapon icon and headshot
icon additive in (255,80,0), teamkill (10,240,10) (lines 129–145), victim name
(line 153). Team colours: T (1.0, 0.25, 0.25), CT (0.6, 0.8, 1.0), grey 0.8
(`cl_dll/util.cpp:69–73`). The names use the console font.

What Sven allows:
- Text x is a fraction of `W − 2b`, the font tall depends on H, and the face
  depends on the player's system. Sprites are 1:1 pixels (`sven-client-hud.md`
  1.6). Thus a server cannot put an icon exactly next to a name of unknown
  width. Exact CS spacing is not possible.
- A plugin has 4 text slots. Four rows with a killer and a victim need 8 texts.
  A multi-line message aligns each line alone, so one message can hold the four
  right-aligned victim names (one slot) and one message the four killer names
  (one slot). The line step is then `iCharHeight` (font tall), not 20 px.
- Right edge: `x = −1/8192`. The border stays (default 16 px) unless the player
  has `hud_bordersize 0`; a server can stuff it while `cl_filterstuffcmd` is 0
  (`sven-client-hud.md` 5).
- Use `a1 = 255` for solid names, and fade times 0, because fades darken
  normal glyphs (4).
- Sven's own notify line (`<killer> : <weapon> : <victim>`) also appears in the
  top-left corner. Only a metamod plugin can remove it (6).

Defects in `scripts/cs16/killfeed.as` (main, commit ed52216):
1. Killer names use channels `ch + 8` = 9…12 (line 367). The server maps all
   of them to the slot of channel 4 (1.2). Each one replaces the one before
   (1.4, step 2), and the victim of row 4 (channel 4, line 350) too. At most one
   of these texts is visible.
2. Lines 311–314 compute x as the **left** edge from the right. A negative x
   anchors the **right** edge (2). Every element is one own-width too far left.
3. Line 284 assumes a fixed width of 0.013 × W for each character. The real
   width scales with H and depends on the face (3).
4. Lines 357 and 374 use a hold of 0.15 s, and `scripts/cs16/cs16_register.as:56`
   runs `DrawNotices` every 0.1 s. Each send restarts the clock (1.4, step 5).
   One send with the full notice time, and a new send only when the stack
   changes, gives the same display with less traffic.

## Open points

- I did not test anything in a running game. A test with `hud_debug 2` would
  confirm 2 and 3.
- I did not analyse the dedicated server engine (it could change the message
  before it is sent).
- I did not measure the substitute face on Windows.
