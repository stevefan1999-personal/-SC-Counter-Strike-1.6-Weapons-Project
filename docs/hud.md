# CS 1.6 HUD

The CS16 Weapons plugin draws the Counter-Strike 1.6 HUD with Sven Co-op custom HUD elements. The shared foundation is
in `scripts/cs16/hud/hud.as`. Each section of this page describes one element.

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
