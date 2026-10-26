# CS 1.6 HUD

The CS16 Weapons plugin draws the Counter-Strike 1.6 HUD with Sven Co-op custom HUD elements. The shared foundation
(element registry, channel map, raw senders, screen size, native HUD hiding) is in `scripts/cs16/hud/hud.as` and the
files that it includes. The sprites are the generated sprites of [`hud-sprites.md`](hud-sprites.md).

## Status elements

The status elements are the CS 1.6 HUD parts that are always on the screen: health, armour, ammo, money, flashlight and
the c4 status icon. `CS16HUD::RegisterStatus()` (`scripts/cs16/hud/status.as`) precaches their sprites and registers
them. `cs16_register.as` calls it in `PluginInit`, after `CS16HUD::PluginInit()`.

| Element    | File            | Client channels                                                                                    | Sprites                                                                                | CS 1.6 reference       |
| ---------- | --------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------- |
| Health     | `health.as`     | 20 `HEALTH`                                                                                        | `health.spr`                                                                           | `cs16-hud-spec.md` 3.1 |
| Armour     | `armour.as`     | 21 `ARMOUR`, 22 `ARMOUR_FULL`                                                                      | `armor.spr` + `armor_full.spr`, or `armor_helmet.spr` + `armor_helmet_full.spr`        | 3.2                    |
| Ammo       | `ammo.as`       | 23 `CLIP`, 24 `RESERVE_HIGH`, 25 `RESERVE_LOW`, 26 `AMMO_ICON`                                     | `clip.spr`, `two_cells.spr`, `reserve_lo.spr`, a rect of `cs16/icons/640hud7.spr`      | 3.3                    |
| Money      | `money.as`      | 27 `MONEY_HIGH`, 28 `MONEY_LOW`; change row: 5 `MONEY_DELTA_HIGH`, 6 `MONEY_DELTA_LOW` (map group) | `money_hi.spr`, `two_cells.spr`, `money_delta_plus_hi.spr`, `money_delta_minus_hi.spr` | 3.5                    |
| Flashlight | `flashlight.as` | 7 `FLASHLIGHT`, 8 `FLASHLIGHT_ENERGY` (map group)                                                  | `flashlight.spr` + `flashlight_energy.spr`                                             | 3.13                   |
| c4 icon    | `statusicon.as` | 9 `STATUS_ICON` (map group)                                                                        | the rect (0, 148, 32, 32) of `cs16/icons/640hud7.spr`                                  | 3.10                   |

`draw.as` has the shared parts: the CS colours, the fades, the part of a sprite at its CS position, and the gate
`ShowsStatus`.

### Positions

Each part has the content size of its sprite as `width` and `height`, and the x and y of the contract in
[`hud-sprites.md`](hud-sprites.md). `tests/hud-elements.test.ts` compares each size with the generated sprite.

| Part                          | x, y                                | Flags                                                   | CS box at 1600×900   |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------- | -------------------- |
| Health                        | 12, −12                             | `ABSOLUTE_X`, `ABSOLUTE_Y`, `NO_BORDER`                 | (12, 863)            |
| Armour, both parts            | 0.2 (fraction), −12                 | `ABSOLUTE_Y`, `NO_BORDER`                               | (320, 863) = W/5     |
| Clip and bar                  | −112, −12                           | `ABSOLUTE_X`, `ABSOLUTE_Y`, `NO_BORDER`                 | (1416, 863)          |
| Reserve, first two cells      | −62, −12 (no clip: −64)             | as the clip                                             | (1498, 863)          |
| Reserve, last cell            | −42, −12 (no clip: −44)             | as the clip                                             | (1538, 863)          |
| Ammo icon                     | −18, −16 (no clip: −20)             | as the clip                                             | (1558, 860)          |
| Money, dollar and three cells | −56, −50 (no suit: −100)            | as the clip                                             | (1466, 825)          |
| Money, last two cells         | −16, −50 (no suit: −100)            | as the clip                                             | (1544, 825)          |
| Change row                    | as the money, y −87 (no suit: −137) | as the clip                                             | `+` at (1467, 788)   |
| Flashlight, both parts        | 1.0 (fraction), 16                  | `ABSOLUTE_Y`, `NO_BORDER`                               | (1552, 16)           |
| c4 icon                       | 12, −21                             | `ABSOLUTE_X`, `ABSOLUTE_Y`, `SCR_CENTER_Y`, `NO_BORDER` | (12, 413) = H/2 − 37 |

The fraction 0.2 gives W/5 at every screen width. The fraction 1.0 puts the flashlight flush with the right edge, which
pixels cannot do (`sven-client-hud.md` 1.5). The c4 icon y is relative to the screen centre, so it follows H.

### Colours and fades

Each element sends the raw CS colour with the CS alpha in A. Sven multiplies RGB by A with the truncation of CS
`ScaleColors` (`sven-client-hud.md` 1.9), so the pixels are the CS pixels. No element sets `HUD_ELEM_DYNAMIC_ALPHA` or
`HUD_ELEM_DEFAULT_ALPHA`, and every element has `holdTime` −1.

A CS fade is Sven effect 2 (`HUD_EFFECT_RAMP_DOWN`) from the start colour (`color2`) to the end colour (`color1`) with
`HUD_ELEM_EFFECT_ONCE`. Sven ramps all four bytes and then multiplies, as CS does, so the fade is exact. An element that
is sent again during its fade (a resend after `.hudres`, a reserve change, a new armour type) starts its ramp at the
colour that the fade reached and keeps the time that is left. Thus the fade continues and does not start again.

| Element    | Colour                                                                                 | Fade                                                       |
| ---------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Health     | HUD orange (255, 160, 0); 25 or less: low red (250, 0, 0)                              | alpha 228 to 100 in 5 s after each new value               |
| Health     | 15 or less: low red at alpha 255                                                       | none                                                       |
| Armour     | HUD orange                                                                             | 228 to 100 in 5 s after each new value                     |
| Ammo       | HUD orange                                                                             | 200 to 100 in 5 s after a new weapon, clip, FOV or a spawn |
| Money      | gain: green (0, 255, 0) to HUD orange; loss: red (255, 0, 0) to HUD orange             | 228 to 100 in 5 s after each change                        |
| Change row | the money colour, faded out in 2.5 s                                                   | see [Money](#money)                                        |
| Flashlight | HUD orange; battery below 20 %: alert red (255, 16, 16)                                | none: alpha 225 when on, 100 when off                      |
| c4 icon    | status green (0, 160, 0) at alpha 255; in a bomb target it flashes low red every 0.1 s | none                                                       |

### Values and frames

| Element    | Source                                                                           | Frame                                                                                    |
| ---------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Health     | `pev.health`: an int, 1 for a living player below 1                              | 0–255                                                                                    |
| Armour     | `pev.armorvalue`                                                                 | 0–255; the full part 0–100                                                               |
| Ammo       | the active weapon: `m_iClip`, `m_rgAmmo(PrimaryAmmoIndex())`                     | clip 0–255; reserve 0–999                                                                |
| Money      | the CS16 buy menu wallet (`BuyMenu::BuyPoints`)                                  | 0–25599: `money_hi.spr` frame = money / 100, `two_cells.spr` frame of the last two cells |
| Flashlight | `FlashlightIsOn()`, `m_iFlashBattery`                                            | on 1 / off 0; energy 0–100                                                               |
| c4 icon    | `weapon_c4` in the inventory with ammo; the bomb target keyvalue `$i_inBombZone` | –                                                                                        |

CS sends the reserve ammo as a byte, but the weapons of this port carry up to 1000 rounds. The two cell groups of the
reserve can show 0–999, so the reserve shows its real value up to 999.

The elements read their values at each tick (20 Hz) and send only what changed. The money is the exception: the buy menu
and the damage money report each change (see [Money](#money)).

### Gates

- Health, armour, ammo and the flashlight need the HEV suit and are hidden for a spectator, as in CS (`cs16-hud-spec.md`
  2.5). The native Sven parts that they replace need the suit too.
- Without the suit, the money moves up to H − 125 (CS `H - 5 fh`). A spectator sees no money.
- The c4 icon shows while the player carries the C4.

### Ammo

CS draws the ammo counter only for a weapon with a primary ammo type. Thus the knife shows nothing, as in CS.

A weapon with a clip shows clip, bar, reserve and icon. A weapon without a clip (HE grenade, C4) shows the reserve and
the icon 2 px further left, as CS does.

The icon comes from the ammo type of the weapon (`AMMO_ICONS` in `ammo.as`):

| Ammo type                                  | Icon (rect on `640hud7.spr`) |
| ------------------------------------------ | ---------------------------- |
| `cs16_12gauge`, Sven `buckshot`            | buckshot (0, 72)             |
| `cs16_.50ae`                               | .50 AE (24, 72)              |
| `cs16_9mm`, Sven `9mm`                     | 9 mm (48, 72)                |
| `cs16_7.62nato`, Sven `m40a1`              | 7.62 mm (72, 72)             |
| `cs16_45acp`                               | .45 ACP (96, 72)             |
| `cs16_.357sig`, Sven `357`                 | .357 (120, 72)               |
| `cs16_5.56nato`, `cs16_5.56ap`, Sven `556` | 5.56 mm (0, 96)              |
| `cs16_.338lapua`                           | .338 (24, 96)                |
| `weapon_hegrenade`, Sven `Hand Grenade`    | HE grenade (72, 96)          |
| `weapon_c4`                                | C4 (96, 96)                  |
| `cs16_5.7mm`                               | 5.7 mm (120, 96)             |
| Sven `health` (the medkit)                 | the CS health cross (48, 25) |

Decisions for weapons that CS does not have:

- A Half-Life or Sven weapon that a map gives out shows its ammo with the CS digits at the CS place. Its icon is the CS
  icon of the same calibre. An ammo type without a CS calibre (rockets, uranium, bolts, hornets, snarks, satchels, trip
  mines, spores, shock charges) shows the digits without an icon.
- The medkit shows its charge as the reserve of a weapon without a clip, with the CS health cross as its icon.
- CS has a second ammo row for a second ammo type, but no CS weapon uses it. The channel map has no channel for it, so
  the second ammo of a Half-Life weapon (the grenades of the 9mmAR) does not show.

`tests/hud-elements.test.ts` checks that the icon of each CS weapon is the `ammo` row of its weapon list, which is the
row of `cstrike/sprites/weapon_*.txt`.

### Money

The buy menu calls `BuyMenuCVARS::ShowPointsSprite( player, tracked )` after each change of `BuyPoints`. This calls
`CS16HUD::ShowMoney( player, amount, tracked )`. The damage money (`scripts/DamageMoneyScore.as`) uses the same call.
Each "Not enough money" answer of the buy menu calls `CS16HUD::BlinkMoney( player )`.

| Call                                 | When                                                             | What the element shows                                       |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `ShowMoney( player, amount, true )`  | a change in play: a purchase, the pay for score, a damage reward | the colour fade and the change row, as the CS tracked change |
| `ShowMoney( player, amount, false )` | the wallet was loaded: connect, map change, spawn                | the colour fade from 0 (green), no change row                |
| `BlinkMoney( player )`               | a purchase failed                                                | two bright blinks                                            |

CS resets its money display to 0 at each spawn and then receives the amount without tracking (CS client.so
`CHudAccountBalance::Reset` 0x9c490; ReGameDLL `dlls/player.cpp:7653`). So the money fades in from green at each spawn.
The element does the same in `OnSpawn`.

- **Change row.** It shows `+` or `−` and the change for 2.5 s above the money. CS gives it the money colour and then
  scales it once more by the time that is left (`ScaleColors(…, 256 · t / 2.5)`, CS client.so 0x9ca68). The element
  sends the money ramp with `fadeoutTime` 2.5 and `holdTime` 0. Sven multiplies the alpha by the share of the fade-out
  that is left (`sven-client-hud.md` 1.9), so the row gets the product of the two CS fades, and Sven hides the row at
  the end. This follows from the verified Sven fade rules; the scenario does not measure the row during its fade.
  (`cs16-hud-spec.md` 5.6 proposed one ramp to alpha 0, which is not exact.)
- **Blink.** CS blinks twice: HUD orange at alpha 255 for 0.1 s, the money colour for 0.1 s, HUD orange for 0.1 s, then
  the money colour (CS client.so `MsgFunc_BlinkAcct` 0xa3bf0, `Draw` 0x9cada). The element sends effect 7
  (`HUD_EFFECT_TOGGLE`) with a period of 0.2 s. The client starts the toggle when the element arrives, so the element
  sends the money again 0.325 s after that send: in the middle of the normal phase after the second bright phase,
  because the tick that sends it can come up to 0.05 s late.

The old money display (`HudNumDisplay` on API channel 0 = client channel 16, the crosshair) and its model precache of
`sprites/cs16/640hud7.spr` are removed.

### c4 icon

The icon replaces the old C4 sprite of `weapon_c4.as` (API channel 4 = client channel 20, the health). The element
checks the inventory at each tick, so a drop, a plant, a death or a strip removes the icon without code in the weapon.
Inside an `info_bomb_target` the icon flashes, as CS flashes the icon of the bomb carrier in a bomb zone.

### Evidence

`just e2e-elements <port> <label> [crop dir]` (`tests/e2e/elements.ts`) runs the elements in game and compares them with
the CS 1.6 screenshots `.e2e/reference/cs16-ref-hud.png` (1600×900) and `cs16-1440-hud.png` (2560×1440). These show
health 100, armour 0, $800 and the USP with 12 | 24. The scenario:

1. Starts testcenter without a MOTD and waits until the client joins.
2. Puts a flat screen of the CS floor colour (39, 32, 22) under the HUD with `e2e.backdrop`. The engine draws a screen
   fade before the HUD, so only the HUD is on it, and the glyphs read as CS's glyphs on its floor.
3. Sets the CS state with `e2e.health`, `e2e.armor`, `e2e.ammo 12 24` (the USP) and `e2e.frags 80` (the buy menu pays
   $10 for each point), and waits 5.6 s until the fades end.
4. Measures every HUD glyph with `tests/e2e/hudboxes.ts` in both images and checks each edge of each box within 1 px and
   the added red and green within 12 levels (`tests/e2e/hudcompare.ts`). The CS floor adds noise to its estimate, and
   HUD orange has no blue.
5. Checks the c4 icon on a black backdrop against the sheet rect, pixel by pixel.
6. Captures the other states. For the blink and the flash it records the screen at 30 frames per second (ffmpeg).

Result at 1600×900 (all checks passed). Each row is one glyph: its box and its added red and green.

| CS 1.6         | Counter-Life   | Largest edge error | CS colour | Our colour |
| -------------- | -------------- | ------------------ | --------- | ---------- |
| 14,865 21×21   | 14,865 21×21   | 0                  | 93, 58    | 91, 56     |
| 47,864 6×24    | 47,864 6×24    | 0                  | 95, 60    | 96, 60     |
| 56,864 16×24   | 56,864 16×24   | 0                  | 94, 59    | 98, 61     |
| 76,864 16×24   | 76,864 16×24   | 0                  | 100, 64   | 98, 61     |
| 323,866 19×21  | 323,866 19×21  | 0                  | 91, 55    | 87, 54     |
| 386,864 16×24  | 386,864 16×24  | 0                  | 102, 64   | 98, 61     |
| 1449,864 6×24  | 1449,864 6×24  | 0                  | 97, 60    | 96, 60     |
| 1459,864 16×24 | 1459,864 16×24 | 0                  | 99, 64    | 98, 61     |
| 1469,826 14×25 | 1469,826 14×24 | 1                  | 94, 56    | 96, 60     |
| 1486,863 2×25  | 1486,863 2×25  | 0                  | 102, 71   | 100, 62    |
| 1521,864 16×24 | 1521,864 16×24 | 0                  | 96, 61    | 98, 61     |
| 1527,826 16×24 | 1527,826 16×24 | 0                  | 97, 61    | 97, 61     |
| 1541,864 16×24 | 1541,864 16×24 | 0                  | 97, 64    | 93, 58     |
| 1545,826 17×24 | 1546,826 16×24 | 1                  | 96, 61    | 94, 59     |
| 1559,861 23×23 | 1559,861 23×23 | 0                  | 102, 67   | 100, 62    |
| 1565,826 17×24 | 1566,826 16×24 | 1                  | 97, 61    | 94, 59     |

The settled HUD orange at alpha 100 is (100, 62, 0) (`cs16-hud-spec.md` A.1).

Result at 2560×1440 (all checks passed):

| CS 1.6          | Counter-Life    | Largest edge error | CS colour | Our colour |
| --------------- | --------------- | ------------------ | --------- | ---------- |
| 14,1405 21×21   | 14,1405 21×21   | 0                  | 94, 58    | 91, 56     |
| 47,1404 6×24    | 47,1404 6×24    | 0                  | 96, 60    | 96, 60     |
| 55,1404 18×24   | 56,1404 16×24   | 1                  | 95, 57    | 98, 61     |
| 75,1404 17×24   | 76,1404 16×24   | 1                  | 96, 60    | 98, 61     |
| 515,1405 19×22  | 515,1406 19×21  | 1                  | 96, 61    | 87, 54     |
| 577,1404 18×24  | 578,1404 16×24  | 1                  | 102, 68   | 98, 61     |
| 2409,1404 6×24  | 2409,1404 6×24  | 0                  | 97, 60    | 96, 60     |
| 2419,1404 16×24 | 2419,1404 16×24 | 0                  | 95, 60    | 98, 61     |
| 2429,1366 14×25 | 2429,1366 14×24 | 1                  | 100, 63   | 96, 60     |
| 2446,1403 2×25  | 2446,1403 2×25  | 0                  | 105, 68   | 100, 62    |
| 2481,1404 16×24 | 2481,1404 16×24 | 0                  | 100, 64   | 98, 61     |
| 2487,1366 16×24 | 2487,1366 16×24 | 0                  | 101, 62   | 97, 61     |
| 2501,1404 16×24 | 2501,1404 16×24 | 0                  | 93, 59    | 93, 58     |
| 2506,1366 17×24 | 2506,1366 16×24 | 1                  | 96, 63    | 97, 61     |
| 2520,1401 22×23 | 2519,1401 23×23 | 1                  | 93, 57    | 100, 62    |
| 2525,1366 17×24 | 2526,1366 16×24 | 1                  | 101, 70   | 97, 61     |

At 2560×1440 the CS floor behind the two health digits and the armour digit is brighter, so the colour threshold takes
one more column on both sides of these CS glyphs. Each edge is still within 1 px. The health and money positions are the
same as at 1600×900 relative to their screen edges, and the armour is at W/5 (512).

Other checks at 1600×900:

- c4 icon: the sheet rect drawn in (0, 160, 0) at (12, 413) differs by at most 20 levels from the screen. Sven draws
  sprites a little soft. One pixel off in any direction, the difference is 103 to 138 levels.
- Health 20: low red at alpha 100, (96, 0, 0) on the digits (CS: 98).
- Without the suit: no health, armour or ammo glyph, and the money glyphs at y 776 = H − 124.
- Blink, at 30 frames per second from the purchase: `…000 111 00 11 000…`: two bright phases, then the money colour.
- Flash in a bomb target: red and green phases of about 0.1 s.

Crops (1:1, on the backdrop unless the name says otherwise), in [`hud/elements/`](hud/elements/):

| Crop                                                                                      | State                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ![health and armour, CS above](hud/elements/health-armour-cs-above-ours.png)              | CS 1.6 (top) and Counter-Life (bottom): health 100, armour 0        |
| ![money and ammo, CS above](hud/elements/money-ammo-cs-above-ours.png)                    | CS 1.6 (top) and Counter-Life (bottom): $800, USP 12 \| 24          |
| ![health 20, armour 50](hud/elements/health20-armour50.png)                               | health 20 (low red), armour 50 (the full part fills the lower half) |
| ![money gain](hud/elements/money-gain.png)                                                | 0.3 s after +$100: green, change row `+ 100`                        |
| ![money loss](hud/elements/money-loss.png)                                                | 0.3 s after a $650 purchase: red, change row `- 650`                |
| ![money blink](hud/elements/money-blink.png)                                              | a bright phase of the blink after a failed purchase                 |
| ![flashlight off](hud/elements/flashlight-off.png)                                        | flashlight off (alpha 100)                                          |
| ![flashlight on](hud/elements/flashlight-on.png)                                          | flashlight on (alpha 225, beam)                                     |
| ![flashlight low](hud/elements/flashlight-low.png)                                        | battery 10 %: alert red                                             |
| ![c4 icon](hud/elements/c4.png)                                                           | c4 icon                                                             |
| ![c4 icon in a bomb target](hud/elements/c4-zone.png)                                     | c4 icon in a bomb target, red phase                                 |
| ![no suit](hud/elements/no-suit.png)                                                      | no suit: the money moved up, no ammo                                |
| ![over the world](hud/elements/world-bottom-right.png)                                    | money and ammo over the testcenter world                            |
| ![health and armour at 2560×1440](hud/elements/health-armour-cs-above-ours-2560x1440.png) | 2560×1440, CS 1.6 (top) and Counter-Life (bottom)                   |
| ![money and ammo at 2560×1440](hud/elements/money-ammo-cs-above-ours-2560x1440.png)       | 2560×1440, CS 1.6 (top) and Counter-Life (bottom)                   |

The broad scenario `just e2e-hud <port> <label>` (`tests/e2e/hud.ts`) also captures the elements, for each CS weapon and
after kills. Runs at 1600×900 and 2560×1440 showed: nothing for the knife; 12 | 536 with the .45 icon for the USP; 30 |
480 with 7.62 for the AK-47; 8 | 120 with 12G for the M3; 10 | 80 with .338 for the AWP; 1 with the HE icon, 2 px
further left, for the HE grenade; health 80 and armour 50, then health 20 in red; a hit that the armour took (armour 49
flashes, health 20 stays dim). Its bottom-left crop is 480 px wide, so at 2560×1440 it does not show the armour at 512.

The software-rendered test client (Xvfb, llvmpipe) can stall at 2560×1440 when the machine is busy. One run of
`e2e-elements` at a load average of 60 got no HUD on the screen and failed; the next run passed.

### Limits

- Until the kill-feed branch lands, `scripts/cs16/killfeed.as` draws its icons with the stock API on API channels 5–12,
  which are client channels 21–28: armour, ammo and money. While it shows notices, it draws over these elements every
  0.1 s. After the notices, an element comes back at the next change of its value or the next resend. `e2e-hud` shows
  this in its `killfeed-4` step.
- Each message is reliable and costs about 70 bytes. A shot changes the clip and restarts the fade of all four ammo
  parts, so a P90 (15 shots per second) sends about 4 KB/s to its player.
- `HUD_ELEM_EFFECT_ONCE` holds a fade at 99.9 % of its time, so a settled colour can be 1 level from the CS colour.
- The armour shows the Sven armour (`pev.armorvalue`), which protects against all damage. The CS16 buy menu's Kevlar
  sets the plugin's own CS armour (`CS16BASE::g_PlayerArmor`), which only bullets of CS weapons use. The HUD does not
  show that value.
- With more than one `info_bomb_target`, each target writes the player's in-zone keyvalue every 0.1 s and the last one
  wins, so the c4 icon can flash only part of the time (`CInfoBombTarget.as`).
- A first connection downloads the 13 sprites of the elements, 7.9 MB without compression. The test client took about 10
  minutes for them from a local server (about 13 KB/s). A server should offer them on an HTTP download server
  (`sv_downloadurl`). A key press during the download can hit Cancel on the download dialog and drop the connection.

## Crosshair

The CS 1.6 dynamic crosshair: four green lines around the screen centre. The gap between the lines grows with each shot
and with the movement of the player, then it shrinks back. Source: `scripts/cs16/hud/crosshair.as`. Specification:
[`research/cs16-hud-spec.md`](research/cs16-hud-spec.md) section 3.12 (Valve `client.so`, "BIN").

### What it draws

- Four boxes of `cs16/hud/fill.spr` (64×64 white, [`hud-sprites.md`](hud-sprites.md)), each 1 px thick, on the client
  channels `CROSSHAIR_WEST`, `CROSSHAIR_EAST`, `CROSSHAIR_NORTH` and `CROSSHAIR_SOUTH` (16–19).
- Colour (50,250,50), the CS default of `cl_crosshair_color`, with the CS alpha (120–255). The lines are additive. Sven
  multiplies RGB by the alpha as CS `FillRGBA` does (`sven-client-hud.md` 1.9).
- The element registers with `everyFrame`, so `OnTick` runs in each `PlayerPostThink` of the player.

### When it draws

The lines show when all of these are true (spec 3.12.1). Else the element hides them.

| Condition      | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Player         | alive                                                                    |
| Weapon         | a weapon in hand that is not the Scout, SG550, AWP or G3SG1              |
| FOV (`m_iFOV`) | 0 (the default FOV) or more than 54. The AUG and SG552 zoom to 55.       |
| `m_iHideHUD`   | `HIDEHUD_WEAPONS` and `HIDEHUD_ALL` clear                                |
| `cs16_hud`     | 1. With 0 the foundation hides the lines and shows the native crosshair. |

CS does not update a crosshair that it does not draw. Thus the state stays as it is while the lines are hidden.

`cs16_hud` 1, then 0, then 1 again (AK-47, 1600×900): the CS lines, then the native Sven crosshair of the weapon list,
then the CS lines again.

![cs16_hud 1, 0 and 1](hud/crosshair/1600x900-cs16-hud-1-0-1.png)

### Weapons

The classname gives the CS weapon id. The id gives the base gap, the shot delta, the accuracy flags and the run limit
(spec 3.12.3). Accuracy flags: 1 jump, 2 run, 4 duck, 8 inaccurate, 16 very inaccurate.

| Classname           | CS id | Base gap | Shot delta | Flags              | Run limit |
| ------------------- | ----- | -------- | ---------- | ------------------ | --------- |
| `weapon_p228`       | 1     | 8        | 3          | 7                  | 0         |
| `weapon_scout`      | 3     | 5        | 3          | 0 (no crosshair)   | –         |
| `weapon_hegrenade`  | 4     | 8        | 3          | 0                  | –         |
| `weapon_xm1014`     | 5     | 9        | 4          | 0                  | –         |
| `weapon_c4`         | 6     | 6        | 3          | 0                  | –         |
| `weapon_mac10`      | 7     | 9        | 3          | 1                  | –         |
| `weapon_aug`        | 8     | 3        | 3          | 3                  | 140       |
| `weapon_dualelites` | 10    | 4        | 3          | 0                  | –         |
| `weapon_fiveseven`  | 11    | 8        | 3          | 7                  | 0         |
| `weapon_ump45`      | 12    | 6        | 3          | 1                  | –         |
| `weapon_sg550`      | 13    | 5        | 3          | 0 (no crosshair)   | –         |
| `weapon_galil`      | 14    | 4        | 3          | 3                  | 140       |
| `weapon_famas`      | 15    | 4        | 3          | 3, burst fire: 19  | 140       |
| `weapon_usp`        | 16    | 8        | 3          | 7, silencer on: 15 | 0         |
| `weapon_csglock18`  | 17    | 8        | 3          | 7, burst fire: 23  | 0         |
| `weapon_awp`        | 18    | 8        | 3          | 0 (no crosshair)   | –         |
| `weapon_mp5navy`    | 19    | 6        | 2          | 1                  | –         |
| `weapon_csm249`     | 20    | 6        | 3          | 3                  | 140       |
| `weapon_m3`         | 21    | 8        | 6          | 0                  | –         |
| `weapon_m4a1`       | 22    | 4        | 3          | 3, silencer on: 11 | 140       |
| `weapon_tmp`        | 23    | 7        | 3          | 1                  | –         |
| `weapon_g3sg1`      | 24    | 6        | 4          | 0 (no crosshair)   | –         |
| `weapon_csdeagle`   | 26    | 8        | 3          | 7                  | 0         |
| `weapon_sg552`      | 27    | 5        | 3          | 3                  | 140       |
| `weapon_ak47`       | 28    | 4        | 4          | 3                  | 140       |
| `weapon_csknife`    | 29    | 7        | 3          | 0                  | –         |
| `weapon_p90`        | 30    | 7        | 3          | 3                  | 170       |

- Other weapons (Sven weapons, other plugins) are an unknown id: base gap 4, shot delta 3, no flags, as in CS.
- The silencer and the burst mode come from the weapon script through `CS16BASE::IWeaponState` (`scripts/cs16/base.as`),
  which the `WeaponBase` mixin gives to every CS weapon.
- Shots: `ShootWeapon` in `scripts/cs16/base.as` adds 1 to `CS16BASE::g_PlayerShotsFired` for each call. One call is one
  shot, also for the shotgun pellets and for each bullet of a burst, as one CS fire event. The knife, the HE grenade and
  the C4 do not count, because CS has no fire event for them.

### Per-frame rules

CS updates the crosshair once per client frame at its default `fps_max 100` (spec 3.12.4). The server cannot see client
frames. Thus it replays the CS frames at 100 steps per second of the player's own command time (`g_Engine.time` in
`PlayerPostThink`).

1. Each player frame computes the minimum gap g from the weapon, the pose and the speed (spec 3.12.3). The run test uses
   the truncated 3-D speed and is strict.
2. Each step: if no new shot, `distance -= 0.013 * distance + 0.1` and `alpha += 2`. After a new shot,
   `distance = min(distance + delta, 15)` and `alpha = max(alpha - 40, 120)`. Then `distance = max(distance, g)` and
   `alpha = min(alpha, 255)`.
3. `length = (int)((distance - g) * 0.5) + 5`.
4. After a pause of more than 1 s the element replays 100 steps only. Every state is at rest after 80 steps.

### Scale and position

- `cl_crosshair_size auto`, the CS default (spec 3.12.5): base 1024 for W ≤ 640, 800 for W < 1024, else 640. Then
  `d = (int)(distance * W / base)` and `len = W * length / base`.
- W and H come from `CS16HUD::GetScreenSize( player )`: the `.hudres` of the player, else `cs16_hud_res`.
- The boxes are those of spec 3.12.6: west `(W/2 - d - len + 1, H/2, len, 1)`, east `(W/2 + d, H/2, len, 1)`, north
  `(W/2, H/2 - d - len + 1, 1, len)`, south `(W/2, H/2 + d, 1, len)`.
- The lines use `HUD_ELEM_SCR_CENTER_X | SCR_CENTER_Y | ABSOLUTE_X | ABSOLUTE_Y | NO_BORDER`. The client puts the left
  edge of such an element at `x + ((W - width) >> 1)` (`client.so` 0xDB45D). Thus the plugin sends
  `x = left - ((W - width) >> 1)`, and y in the same way. With a wrong screen size the crosshair stays at the centre;
  only its scale is wrong.

### Updates and network cost

- The element sends the four lines when the drawn gap or length changes, after a shot (the alpha falls), and when the
  alpha is back at 255.
- The client ramps the alpha itself: effect 2 (`HUD_EFFECT_RAMP_DOWN`) from `color2` (the alpha now) to `color1`
  (alpha 255) in `(255 - alpha) / 200` s, with `HUD_ELEM_EFFECT_ONCE`. That is the CS rate of 2 per frame at 100 frames
  per second. The client holds the ramp at 0.999 of its time and truncates the result (`client.so` 0xDB640), so the ramp
  stops at alpha 254. The send at alpha 255 corrects this.
- A shown crosshair moves at most once per 0.1 s. A crosshair that appears goes out at once.
- One update is four `CustSpr` messages of 70 bytes: the message id, the size byte and 68 bytes of fields with the name
  `cs16/hud/fill.spr`. So one update is 280 bytes, and the limit is 2.8 KB/s for each player. A hide is four
  `ToggleElem` messages of 3 bytes.
- With `developer 2` the server prints each update:
  `[CS16HUD] crosshair <slot>: gap <d> length <len> alpha <a> shots
  <n>, <bytes> bytes at <time>`.

Measured bytes for each player (scenario below, `developer 2` log):

| State                                      | 1600×900                | 2560×1440               |
| ------------------------------------------ | ----------------------- | ----------------------- |
| At rest, 3 s                               | 0 B/s                   | 0 B/s                   |
| P90 (the fastest CS weapon) firing for 3 s | 2,707 B/s (29 updates)  | 2,520 B/s (27 updates)  |
| Recovery after the P90 burst               | 1,400 bytes (5 updates) | 1,400 bytes (5 updates) |

At 1600×900 the ten AK-47 shots of the evidence below took 10 updates in 0.94 s, and with the recovery 16 updates (4,480
bytes).

### Evidence

The scenario `tests/e2e/crosshair.ts` ran on stadium4 with the view on the night sky. It freezes short states with the
client pause key before each screenshot. `tests/e2e/crosshair-lines.ts` measures each line in the screenshot. A line is
lit where its green is 40 or more above its red and blue. Gap = pixels from the centre pixel (W/2, H/2) to the inner
end. Length = lit pixels in the line. All four lines had the same gap and length, 1 px thick, in every state.

"g" is the minimum gap of spec Appendix A.2. "Expected" is the rest state of that g: `d = g * W / 640`,
`len = 5 * W / 640`. "Sent last" is the last update in the log before the screenshot.

1600×900 (base 640, scale 2.5):

| State                | g | Expected | Measured | Sent last          | Shots |
| -------------------- | - | -------- | -------- | ------------------ | ----- |
| AK-47 at rest        | 4 | 10 / 12  | 10 / 12  | –                  | 0     |
| AK-47 after 1 shot   | – | –        | 19 / 15  | 19 / 15, alpha 217 | 1     |
| AK-47 after 3 shots  | – | –        | 30 / 22  | 30 / 22, alpha 173 | 3     |
| AK-47 after 10 shots | – | –        | 36 / 25  | 36 / 25, alpha 124 | 10    |
| AK-47 running        | 6 | 15 / 12  | 15 / 12  | 15 / 12, alpha 255 | 0     |
| AK-47 ducking        | 4 | 10 / 12  | 10 / 12  | –                  | 0     |
| AK-47 in the air     | 8 | 20 / 12  | 20 / 12  | 20 / 12, alpha 255 | 0     |
| Desert Eagle at rest | 8 | 20 / 12  | 20 / 12  | –                  | 0     |
| Desert Eagle ducking | 4 | 10 / 12  | 10 / 12  | 10 / 12, alpha 255 | 0     |
| USP at rest          | 8 | 20 / 12  | 20 / 12  | –                  | 0     |
| M3 at rest           | 8 | 20 / 12  | 20 / 12  | –                  | 0     |
| AWP                  | – | none     | none     | –                  | 0     |

2560×1440 (base 640, scale 4):

| State                | g | Expected | Measured | Sent last          | Shots |
| -------------------- | - | -------- | -------- | ------------------ | ----- |
| AK-47 at rest        | 4 | 16 / 20  | 16 / 20  | –                  | 0     |
| AK-47 after 1 shot   | – | –        | 32 / 28  | 32 / 28, alpha 215 | 1     |
| AK-47 after 3 shots  | – | –        | 46 / 32  | 46 / 32, alpha 177 | 3     |
| AK-47 after 10 shots | – | –        | 57 / 40  | 57 / 40, alpha 124 | 10    |
| AK-47 running        | 6 | 24 / 20  | 24 / 20  | 24 / 20, alpha 255 | 0     |
| AK-47 ducking        | 4 | 16 / 20  | 16 / 20  | –                  | 0     |
| AK-47 in the air     | 8 | 32 / 20  | 32 / 20  | 32 / 20, alpha 255 | 0     |
| Desert Eagle at rest | 8 | 32 / 20  | 32 / 20  | –                  | 0     |
| Desert Eagle ducking | 4 | 16 / 20  | 16 / 20  | 16 / 20, alpha 255 | 0     |
| USP at rest          | 8 | 32 / 20  | 32 / 20  | –                  | 0     |
| M3 at rest           | 8 | 32 / 20  | 32 / 20  | –                  | 0     |
| AWP                  | – | none     | none     | –                  | 0     |

Comparison with the AK-47 vector of spec Appendix A.2 (shots from rest):

- First shot: A.2 frame f10 has distance 8 and length 7, f11 has 7.796 and 6. At 2560×1440 the update after the shot was
  32 / 28 (f10: 8 × 4, 7 × 4). At 1600×900 it was 19 / 15, one step later (f11: int(7.796 × 2.5), 6 × 2.5). The alpha
  fell by 40 (255 to 215) in both.
- Ten shots: A.2 frame f100 has distance 15, length 10, alpha 120, then f101 14.705 and alpha 122, f102 14.414 and
  alpha 124. At 2560×1440 the last update was 57 / 40 with alpha 124, the same as f102 (int(14.414 × 4), 10 × 4). At
  1600×900 it was 36 / 25 with alpha 124, also f102 (int(14.414 × 2.5), 10 × 2.5).
- Poses: the AK-47 gaps 4, 6, 4 and 8 (stand, run, duck, air) and the Desert Eagle gaps 8 and 4 (stand, duck) are the
  A.2 values.

Weapon states at rest, 1600×900, after the secondary attack (a manual run with the same tools):

| State                | A.2 g | Expected | Measured | Crop                                             |
| -------------------- | ----- | -------- | -------- | ------------------------------------------------ |
| USP, silencer on     | 11    | 27 / 12  | 27 / 12  | ![](hud/crosshair/1600x900-usp-silencer-on.png)  |
| Glock 18, burst fire | 11    | 27 / 12  | 27 / 12  | ![](hud/crosshair/1600x900-glock18-burst.png)    |
| M4A1, silencer on    | 5     | 12 / 12  | 12 / 12  | ![](hud/crosshair/1600x900-m4a1-silencer-on.png) |
| FAMAS, burst fire    | 5     | 12 / 12  | 12 / 12  | ![](hud/crosshair/1600x900-famas-burst.png)      |

Comparison with CS 1.6 (USP at rest, `.e2e/reference/cs16-ref-hud.png` and `cs16-1440-hud.png`, same crop): the set of
lit pixels is the same, 48 of 48 at 1600×900 and 80 of 80 at 2560×1440, with no pixel only in one image. Both add about
50 red and 50 blue to the background, which is (50,250,50) at alpha 255.

![CS 1.6 and Counter-Life, USP at rest, 1600×900](hud/crosshair/1600x900-usp-rest-cs16-vs-counter-life.png)

![CS 1.6 and Counter-Life, USP at rest, 2560×1440](hud/crosshair/2560x1440-usp-rest-cs16-vs-counter-life.png)

Crops of the screen centre (1600×900: 160×140 px at 3×; 2560×1440: 256×224 px at 3×):

| State                | 1600×900                                       | 2560×1440                                       |
| -------------------- | ---------------------------------------------- | ----------------------------------------------- |
| AK-47 at rest        | ![](hud/crosshair/1600x900-ak47-rest.png)      | ![](hud/crosshair/2560x1440-ak47-rest.png)      |
| AK-47 after 1 shot   | ![](hud/crosshair/1600x900-ak47-shot1.png)     | ![](hud/crosshair/2560x1440-ak47-shot1.png)     |
| AK-47 after 3 shots  | ![](hud/crosshair/1600x900-ak47-shot3.png)     | ![](hud/crosshair/2560x1440-ak47-shot3.png)     |
| AK-47 after 10 shots | ![](hud/crosshair/1600x900-ak47-shot10.png)    | ![](hud/crosshair/2560x1440-ak47-shot10.png)    |
| AK-47 running        | ![](hud/crosshair/1600x900-ak47-running.png)   | ![](hud/crosshair/2560x1440-ak47-running.png)   |
| AK-47 ducking        | ![](hud/crosshair/1600x900-ak47-ducking.png)   | ![](hud/crosshair/2560x1440-ak47-ducking.png)   |
| AK-47 in the air     | ![](hud/crosshair/1600x900-ak47-air.png)       | ![](hud/crosshair/2560x1440-ak47-air.png)       |
| Desert Eagle at rest | ![](hud/crosshair/1600x900-deagle-rest.png)    | ![](hud/crosshair/2560x1440-deagle-rest.png)    |
| Desert Eagle ducking | ![](hud/crosshair/1600x900-deagle-ducking.png) | ![](hud/crosshair/2560x1440-deagle-ducking.png) |
| USP at rest          | ![](hud/crosshair/1600x900-usp-rest.png)       | ![](hud/crosshair/2560x1440-usp-rest.png)       |
| M3 at rest           | ![](hud/crosshair/1600x900-m3-rest.png)        | ![](hud/crosshair/2560x1440-m3-rest.png)        |
| AWP (no crosshair)   | ![](hud/crosshair/1600x900-awp-rest.png)       | ![](hud/crosshair/2560x1440-awp-rest.png)       |

### Limits

- `fill.spr` is 64 px. A line longer than 64 px loses its outer end. Such lines occur only at full spread: with the AUG
  on a screen wider than 3723 px, and with the gap-4 weapons on a screen wider than 4096 px.
- The server cannot read client cvars. `cl_crosshair_color`, `cl_crosshair_size`, `cl_crosshair_translucent` and
  `cl_dynamiccrosshair` stay at their CS defaults.
- The scale needs the real screen size. A player whose screen is not `cs16_hud_res` must set `.hudres`.
- The crosshair follows a shot one network round trip later. Between shots it moves in steps of up to 0.1 s; the alpha
  ramp is smooth.
- Shots of weapons that are not CS weapons do not widen the crosshair.

### Reproduce

```sh
deno test -A tests/e2e/crosshair-lines.ts        # the tool measures the CS references (local .e2e/reference)
just sandbox /abs/.svends-crosshair && export SVEN_SERVER_DIR=/abs/.svends-crosshair
just install && just install-e2e
CL_DISPLAY=:108 CL_LISTEN_PORT=27074 CL_RESOLUTION=1600x900 deno run -A tests/e2e/crosshair.ts 27073 x1600
CL_DISPLAY=:108 CL_LISTEN_PORT=27074 CL_RESOLUTION=2560x1440 deno run -A tests/e2e/crosshair.ts 27073 x2560
deno run -A tests/e2e/crosshair-lines.ts .e2e/shots/x1600-usp-rest.png .e2e/reference/cs16-ref-hud.png
```

Stop the Xvfb of the display before you change `CL_RESOLUTION`: `just display` keeps a running one. The scenario sets
`motdfile` to a missing file (no MOTD window), `pausable 1`, `sv_timeout 300` and `cs16_hud_res` on the server, and
binds `p` to `pause` with `showpause 0` and `r_drawviewmodel 0` on the client. The last e2e client to stop puts the
player's own Sven configuration back.
