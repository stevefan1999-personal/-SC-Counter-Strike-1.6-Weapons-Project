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
