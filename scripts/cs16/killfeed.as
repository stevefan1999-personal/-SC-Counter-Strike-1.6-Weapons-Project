// Counter-Strike 1.6 Kill Feed (Death Notices)
// True implementation of cl_dll/death.cpp for AngelScript.
//
// CS1.6 reference (death.cpp):
//   - Up to MAX_DEATHNOTICES (4) notices stacked top-right
//   - Each entry expires after hud_deathnotice_time (6 s)
//   - Layout: [KillerName] [weapon sprite] [headshot sprite?] [VictimName]
//   - Weapon sprites drawn from 640hud1.spr / 640hud2.spr / 640hud16.spr
//     using the frame offsets defined in cstrike/sprites/hud.txt
//   - Skull sprite (d_skull) for world/fall/suicide kills
//   - Headshot sprite (d_headshot) drawn after weapon sprite when bHeadshot
//
// Sprite sheets required (copy from cstrike/sprites/ to svencoop/sprites/cs16/):
//   640hud1.spr  — contains most weapon kill icons + d_skull + d_headshot
//   640hud2.spr  — contains d_famas, d_galil
//   640hud16.spr — contains d_fiveseven, d_sg550, d_ump45
//
// Layout uses HUD channels 1-4 (channel 0 reserved for BuyMenu money display).
// Sprite sheet offsets match hud.txt exactly (640-res entries).

#include "base"

namespace CS16KILLFEED {

// ── Sprite sheet frame descriptor ──────────────────────────────────────────
    class SpriteFrame {
        string sheet;   // e.g. "cs16/640hud1.spr"
        uint8  left;    // pixel offset x in sheet
        uint8  top;     // pixel offset y in sheet
        int16  width;   // frame width in pixels
        int16  height;  // frame height in pixels
    }

    SpriteFrame@ MakeFrame(const string& in sheet, uint8 left, uint8 top, int16 w, int16 h) {
        SpriteFrame@ f = SpriteFrame();
        f.sheet  = "cs16/" + sheet + ".spr";
        f.left   = left;
        f.top    = top;
        f.width  = w;
        f.height = h;
        return f;
    }

// ── hud.txt frame table (640-res entries, matching death.cpp sprite IDs) ───
// Format: name → (sheet, left, top, width, height)
// Source: cstrike/sprites/hud.txt, 640-resolution section
    SpriteFrame@ GetDeathSprite(const string& in name) {
        // 640hud1.spr entries
        if (name == "d_knife")      return MakeFrame("640hud1", 192,   0, 48, 16);
        if (name == "d_ak47")       return MakeFrame("640hud1", 192,  80, 48, 16);
        if (name == "d_awp")        return MakeFrame("640hud1", 192, 128, 48, 16);
        if (name == "d_deagle")     return MakeFrame("640hud1", 224,  16, 32, 16);
        if (name == "d_flashbang")  return MakeFrame("640hud1", 192, 192, 48, 16);
        if (name == "d_g3sg1")      return MakeFrame("640hud1", 192, 144, 48, 16);
        if (name == "d_glock18")    return MakeFrame("640hud1", 192,  16, 32, 16);
        if (name == "d_grenade")    return MakeFrame("640hud1", 224, 192, 32, 16);
        if (name == "d_m249")       return MakeFrame("640hud1", 192, 160, 48, 16);
        if (name == "d_m3")         return MakeFrame("640hud1", 192,  48, 48, 16);
        if (name == "d_m4a1")       return MakeFrame("640hud1", 192,  96, 48, 16);
        if (name == "d_mp5navy")    return MakeFrame("640hud1", 192,  64, 32, 16);
        if (name == "d_p228")       return MakeFrame("640hud1", 224,  32, 32, 16);
        if (name == "d_p90")        return MakeFrame("640hud1", 192, 176, 48, 16);
        if (name == "d_scout")      return MakeFrame("640hud1", 192, 208, 48, 16);
        if (name == "d_sg552")      return MakeFrame("640hud1", 192, 112, 48, 16);
        if (name == "d_usp")        return MakeFrame("640hud1", 192,  32, 32, 16);
        if (name == "d_tmp")        return MakeFrame("640hud1", 224,  64, 32, 16);
        if (name == "d_xm1014")     return MakeFrame("640hud1", 192, 224, 48, 16);
        if (name == "d_skull")      return MakeFrame("640hud1", 224, 240, 32, 16);
        if (name == "d_tracktrain") return MakeFrame("640hud1", 192, 240, 32, 16);
        if (name == "d_aug")        return MakeFrame("640hud1", 148, 240, 44, 16);
        if (name == "d_mac10")      return MakeFrame("640hud1", 109, 240, 34, 16);
        if (name == "d_elite")      return MakeFrame("640hud1",  52, 240, 57, 16);
        if (name == "d_headshot")   return MakeFrame("640hud1",   0, 240, 36, 16);
        // 640hud2.spr entries
        if (name == "d_famas")      return MakeFrame("640hud2", 192, 144, 48, 16);
        if (name == "d_galil")      return MakeFrame("640hud2", 192, 160, 48, 16);
        // 640hud16.spr entries
        if (name == "d_fiveseven")  return MakeFrame("640hud16", 192,  0, 32, 16);
        if (name == "d_sg550")      return MakeFrame("640hud16", 192, 48, 48, 16);
        if (name == "d_ump45")      return MakeFrame("640hud16", 192, 80, 48, 16);
        // Fallback — skull
        return MakeFrame("640hud1", 224, 240, 32, 16);
    }

// ── Weapon classname → death sprite name (matching CS1.6 d_<weapon> naming) ─
    string GetDeathSpriteName(const string& in cls) {
        if (cls == "weapon_ak47")       return "d_ak47";
        if (cls == "weapon_m4a1")       return "d_m4a1";
        if (cls == "weapon_awp")        return "d_awp";
        if (cls == "weapon_scout")      return "d_scout";
        if (cls == "weapon_sg550")      return "d_sg550";
        if (cls == "weapon_g3sg1")      return "d_g3sg1";
        if (cls == "weapon_aug")        return "d_aug";
        if (cls == "weapon_sg552")      return "d_sg552";
        if (cls == "weapon_famas")      return "d_famas";
        if (cls == "weapon_galil")      return "d_galil";
        if (cls == "weapon_csdeagle")   return "d_deagle";
        if (cls == "weapon_csglock18")  return "d_glock18";
        if (cls == "weapon_usp")        return "d_usp";
        if (cls == "weapon_p228")       return "d_p228";
        if (cls == "weapon_fiveseven")  return "d_fiveseven";
        if (cls == "weapon_dualelites") return "d_elite";
        if (cls == "weapon_m3")         return "d_m3";
        if (cls == "weapon_xm1014")     return "d_xm1014";
        if (cls == "weapon_mac10")      return "d_mac10";
        if (cls == "weapon_tmp")        return "d_tmp";
        if (cls == "weapon_mp5navy")    return "d_mp5navy";
        if (cls == "weapon_ump45")      return "d_ump45";
        if (cls == "weapon_p90")        return "d_p90";
        if (cls == "weapon_csm249")     return "d_m249";
        if (cls == "weapon_csknife")    return "d_knife";
        if (cls == "weapon_hegrenade")  return "d_grenade";
        if (cls == "weapon_c4")         return "d_skull"; // no C4 kill icon, use skull
        return "d_skull";
    }

// ── Weapon display name (for console log, matching death.cpp ConsolePrint) ──
    string GetWeaponDisplayName(const string& in cls) {
        if (cls == "weapon_ak47")       return "AK-47";
        if (cls == "weapon_m4a1")       return "M4A1";
        if (cls == "weapon_awp")        return "AWP";
        if (cls == "weapon_scout")      return "Scout";
        if (cls == "weapon_sg550")      return "SG-550";
        if (cls == "weapon_g3sg1")      return "G3SG1";
        if (cls == "weapon_aug")        return "AUG";
        if (cls == "weapon_sg552")      return "SG-552";
        if (cls == "weapon_famas")      return "FAMAS";
        if (cls == "weapon_galil")      return "Galil";
        if (cls == "weapon_csdeagle")   return "Desert Eagle";
        if (cls == "weapon_csglock18")  return "Glock-18";
        if (cls == "weapon_usp")        return "USP";
        if (cls == "weapon_p228")       return "P228";
        if (cls == "weapon_fiveseven")  return "Five-SeveN";
        if (cls == "weapon_dualelites") return "Dual Elites";
        if (cls == "weapon_m3")         return "M3";
        if (cls == "weapon_xm1014")     return "XM1014";
        if (cls == "weapon_mac10")      return "MAC-10";
        if (cls == "weapon_tmp")        return "TMP";
        if (cls == "weapon_mp5navy")    return "MP5";
        if (cls == "weapon_ump45")      return "UMP-45";
        if (cls == "weapon_p90")        return "P90";
        if (cls == "weapon_csm249")     return "M249";
        if (cls == "weapon_csknife")    return "Knife";
        if (cls == "weapon_hegrenade")  return "HE Grenade";
        if (cls == "weapon_c4")         return "C4";
        return cls;
    }

// ── Monster display name ────────────────────────────────────────────────────
    string GetMonsterDisplayName(const string& in cls) {
        if (cls == "monster_zombie")             return "Zombie";
        if (cls == "monster_headcrab")           return "Headcrab";
        if (cls == "monster_barnacle")           return "Barnacle";
        if (cls == "monster_bullsquid")          return "Bullsquid";
        if (cls == "monster_bigmomma")           return "Big Momma";
        if (cls == "monster_alien_slave")        return "Vortigaunt";
        if (cls == "monster_alien_grunt")        return "Alien Grunt";
        if (cls == "monster_alien_controller")   return "Alien Controller";
        if (cls == "monster_houndeye")           return "Houndeye";
        if (cls == "monster_human_grunt")        return "HECU Soldier";
        if (cls == "monster_human_assassin")     return "Black Ops";
        if (cls == "monster_apache")             return "Apache";
        if (cls == "monster_osprey")             return "Osprey";
        if (cls == "monster_snark")              return "Snark";
        if (cls == "monster_turret")             return "Turret";
        if (cls == "monster_miniturret")         return "Mini Turret";
        if (cls == "monster_sentry")             return "Sentry";
        if (cls == "monster_gargantua")          return "Gargantua";
        if (cls == "monster_ichthyosaur")        return "Ichthyosaur";
        if (cls == "monster_leech")              return "Leech";
        if (cls == "monster_tentacle")           return "Tentacle";
        if (cls == "monster_nihilanth")          return "Nihilanth";
        if (cls == "monster_gonome")             return "Gonome";
        if (cls == "monster_pitdrone")           return "Pit Drone";
        if (cls == "monster_shockroach")         return "Shock Roach";
        if (cls == "monster_shocktrooper")       return "Shock Trooper";
        if (cls == "monster_voltigore")          return "Voltigore";
        if (cls == "monster_babygarg")           return "Baby Gargantua";
        if (cls == "monster_blkop_apache")       return "Black Ops Apache";
        if (cls == "monster_blkop_osprey")       return "Black Ops Osprey";
        if (cls.SubString(0, 8) == "monster_")
            return cls.SubString(8);
        return cls;
    }

// ── KillNotice — mirrors CS1.6 DeathNoticeItem struct ──────────────────────
    class KillNotice {
        string szKiller;
        string szVictim;
        string szWeaponSpriteName; // e.g. "d_ak47"
        bool   bHeadshot;
        bool   bSuicide;
        float  flExpireTime;
        int    iChannel;           // HUD channel 1-4
    }

    array<KillNotice@> g_Notices; // max 4, matches MAX_DEATHNOTICES

// ── Precache all sprite sheets ─────────────────────────────────────────────
    void PrecacheSprites() {
        g_Game.PrecacheGeneric("sprites/cs16/640hud1.spr");
        g_Game.PrecacheGeneric("sprites/cs16/640hud2.spr");
        g_Game.PrecacheGeneric("sprites/cs16/640hud16.spr");
    }

// ── PushNotice (mirrors MsgFunc_DeathMsg logic) ────────────────────────────
    void PushNotice(const string& in szKiller, const string& in szVictim,
                    const string& in szWeaponCls, bool bHeadshot, bool bSuicide) {

        // Evict oldest if at capacity (mirrors memmove in death.cpp:186)
        if (g_Notices.length() >= 4)
            g_Notices.removeAt(0);

        KillNotice@ notice  = KillNotice();
        notice.szKiller           = szKiller;
        notice.szVictim           = szVictim;
        notice.szWeaponSpriteName = bSuicide ? "d_skull" : GetDeathSpriteName(szWeaponCls);
        notice.bHeadshot          = bHeadshot;
        notice.bSuicide           = bSuicide;
        notice.flExpireTime       = g_Engine.time + 6.0f; // DEATHNOTICE_DISPLAY_TIME
        g_Notices.insertLast(notice);

        // Re-assign channels (1-based, top to bottom)
        for (uint i = 0; i < g_Notices.length(); i++)
            g_Notices[i].iChannel = int(i) + 1;

        // Console log (mirrors death.cpp ConsolePrint lines 262-301)
        string log;
        if (bSuicide) {
            log = szVictim + " suicided";
        } else if (szWeaponCls.IsEmpty()) {
            log = szKiller + " killed " + szVictim;
        } else {
            if (bHeadshot) log = "*** ";
            log += szKiller + " killed " + szVictim;
            if (bHeadshot)
                log += " with a headshot from " + GetWeaponDisplayName(szWeaponCls) + " ***";
            else
                log += " with " + GetWeaponDisplayName(szWeaponCls);
        }
        g_Game.AlertMessage(at_notice, "[KillFeed] " + log + "\n");

        // HUD text line for players (once on push)
        string line;
        if (bSuicide) {
            line = szVictim + " suicided";
        } else if (szWeaponCls.IsEmpty()) {
            line = szKiller + " killed " + szVictim;
        } else {
            line = szKiller;
            if (bHeadshot) line += " (HS)";
            line += " " + szVictim;
        }
        g_PlayerFuncs.ClientPrintAll(HUD_PRINTNOTIFY, line + "\n");
    }

// ── DrawNotices (mirrors CHudDeathNotice::Draw) ─────────────────────────────
// CS1.6 layout (right-to-left calculation, left-to-right drawing):
//   [KillerName] [WeaponSprite] [HSSprite?] [VictimName]  ← all flush right
//
// We approximate with:
//   - HudMessage  channel N+8:  killer name, x=right-anchor offset
//   - HUDSprite   channel N:    weapon sprite, x=right-anchor
//   - HUDSprite   channel N+4:  headshot sprite (if HS), x=right-anchor - weaponWidth
//   - HudMessage  channel N+12: victim name, x=right edge (0.99)
//
// Approximate character width: ~8px per char at 640 ref width → 8/640 = 0.0125 per char.
// Sprite widths from hud.txt: 48px wide rifles, 32px wide pistols → /640
    void DrawNotices() {
        for (int i = int(g_Notices.length()) - 1; i >= 0; i--) {
            if (g_Notices[i].flExpireTime < g_Engine.time)
                g_Notices.removeAt(i);
        }
        for (uint i = 0; i < g_Notices.length(); i++)
            g_Notices[i].iChannel = int(i) + 1;

        if (g_Notices.length() == 0) return;

        // Layout uses normalized coordinates (no HUD_ELEM_ABSOLUTE flags).
        // x in (-1, 0) = right-to-left from right edge.
        // y in (0, 1) = top to bottom.
        // Sprite widths normalized to 0..1 range (ref width 640).
        // CHAR_W: approximate normalized width per character (~8px / 640 = 0.0125)
        const float CHAR_W  = 0.013f;   // slightly wider than 8/640 for safety
        const float GAP     = 0.01f;    // gap between elements

        for (int iPlayer = 1; iPlayer <= g_Engine.maxClients; iPlayer++) {
            CBasePlayer@ pPlayer = g_PlayerFuncs.FindPlayerByIndex(iPlayer);
            if (pPlayer is null || !pPlayer.IsConnected()) continue;

            for (uint i = 0; i < g_Notices.length(); i++) {
                KillNotice@ n  = g_Notices[i];
                int          ch = n.iChannel;  // 1-4

                // Y: DEATHNOTICE_TOP(32+2) + 20*slot, normalized (ref 480)
                float yNorm = float(34 + 20 * int(i)) / 480.0f;

                SpriteFrame@ wf = GetDeathSprite(n.szWeaponSpriteName);

                // Normalized widths
                float wSprN  = float(wf.width)  / 640.0f;
                float hSprN  = 36.0f / 640.0f;  // d_headshot always 36px wide
                float victimN = float(n.szVictim.Length()) * CHAR_W;
                float killerN = n.bSuicide ? 0.0f : float(n.szKiller.Length()) * CHAR_W;
                float hsN     = n.bHeadshot ? hSprN : 0.0f;

                // Layout: [KillerName] [space] [WeaponSprite] [HSSprite?] [VictimName]
                // Text and sprites use same negative-x normalized coordinate system.
                // x = left edge of element, as negative fraction from right edge.
                // All elements laid out right-to-left:
                float xVictim  = -victimN;
                float xHS      = -(victimN + hsN);
                float xWeapon  = -(victimN + hsN + wSprN + GAP);
                float xKiller  = -(victimN + hsN + wSprN + GAP + killerN + GAP);

                // ── Weapon sprite ─────────────────────────────────────────
                HUDSpriteParams wp;
                wp.channel    = ch;
                wp.flags      = 0;
                wp.x          = xWeapon;
                wp.y          = yNorm;
                wp.spritename = wf.sheet;
                wp.left       = wf.left;
                wp.top        = wf.top;
                wp.width      = 0;   // 0 = auto (full sprite width)
                wp.height     = 0;   // 0 = auto (full sprite height)
                wp.color1     = RGBA(255, 80, 0, 255);
                wp.holdTime   = 0.15f;
                g_PlayerFuncs.HudCustomSprite(pPlayer, wp);

                // ── Headshot sprite ───────────────────────────────────────
                if (n.bHeadshot) {
                    HUDSpriteParams hp;
                    hp.channel    = ch + 4;
                    hp.flags      = 0;
                    hp.x          = xHS;
                    hp.y          = yNorm;
                    hp.spritename = "cs16/640hud1.spr";
                    hp.left       = 0;
                    hp.top        = 240;
                    hp.width      = 36;
                    hp.height     = 16;
                    hp.color1     = RGBA(255, 80, 0, 255);
                    hp.holdTime   = 0.5f;
                    g_PlayerFuncs.HudCustomSprite(pPlayer, hp);
                }

                // ── Victim name ───────────────────────────────────────────
                HUDTextParams vtp;
                vtp.channel     = ch;
                vtp.x           = xVictim;
                vtp.y           = yNorm;
                vtp.r1 = 255; vtp.g1 = 255; vtp.b1 = 255; vtp.a1 = 255;
                vtp.r2 = 255; vtp.g2 = 255; vtp.b2 = 255; vtp.a2 = 0;
                vtp.effect      = 0;
                vtp.fadeinTime  = 0.0f;
                vtp.holdTime    = 0.15f;
                vtp.fadeoutTime = 0.0f;
                vtp.fxTime      = 0.0f;
                g_PlayerFuncs.HudMessage(pPlayer, vtp, n.szVictim);

                // ── Killer name (channel ch+8 to avoid overwriting victim) ─
                // HUDTextParams docs say 1-4, but try ch+8 — if it fails, it
                // simply won't show. The victim name is the most important element.
                if (!n.bSuicide && !n.szKiller.IsEmpty()) {
                    HUDTextParams ktp;
                    ktp.channel     = ch + 8;
                    ktp.x           = xKiller;
                    ktp.y           = yNorm;
                    ktp.r1 = 255; ktp.g1 = 255; ktp.b1 = 255; ktp.a1 = 255;
                    ktp.r2 = 255; ktp.g2 = 255; ktp.b2 = 255; ktp.a2 = 0;
                    ktp.effect      = 0;
                    ktp.fadeinTime  = 0.0f;
                    ktp.holdTime    = 0.15f;
                    ktp.fadeoutTime = 0.0f;
                    ktp.fxTime      = 0.0f;
                    g_PlayerFuncs.HudMessage(pPlayer, ktp, n.szKiller);
                }
            }
        }
    }

// ── PlayerKilled hook ───────────────────────────────────────────────────────
    HookReturnCode OnPlayerKilled(CBasePlayer@ pVictim, CBaseEntity@ pKiller, entvars_t@ pevInflictor) {
        if (pVictim is null) return HOOK_CONTINUE;

        string szVictimName = string(pVictim.pev.netname);
        int    victimIdx    = pVictim.entindex();
        string szKillerName = "";
        string szWeaponCls  = "";
        bool   bHeadshot    = false;
        bool   bSuicide     = false;

        CBasePlayer@ pKillerPlayer = cast<CBasePlayer@>(pKiller);
        if (pKillerPlayer !is null) {
            szKillerName = string(pKillerPlayer.pev.netname);
            bSuicide     = (pKillerPlayer.entindex() == victimIdx);
            if (!bSuicide && victimIdx >= 1 && victimIdx <= 32
                && CS16BASE::g_PlayerLastAttacker[victimIdx] == pKillerPlayer.entindex()) {
                szWeaponCls = CS16BASE::g_PlayerLastWeapon[victimIdx];
                bHeadshot   = CS16BASE::g_PlayerLastWasHeadshot[victimIdx];
            }
        } else if (pKiller !is null) {
            string szNetname = string(pKiller.pev.netname);
            szKillerName = (szNetname.IsEmpty())
                ? GetMonsterDisplayName(pKiller.GetClassname())
                : szNetname;
        } else {
            bSuicide = true;
        }

        if (victimIdx >= 1 && victimIdx <= 32) {
            CS16BASE::g_PlayerLastAttacker[victimIdx]    = 0;
            CS16BASE::g_PlayerLastWeapon[victimIdx]      = "";
            CS16BASE::g_PlayerLastWasHeadshot[victimIdx] = false;
        }

        PushNotice(szKillerName, szVictimName, szWeaponCls, bHeadshot, bSuicide);
        return HOOK_CONTINUE;
    }

// ── MonsterKilled hook ──────────────────────────────────────────────────────
    HookReturnCode OnMonsterKilled(CBaseMonster@ pVictim, CBaseEntity@ pAttacker, int iGib) {
        if (pVictim is null) return HOOK_CONTINUE;

        string szVictimName = GetMonsterDisplayName(pVictim.GetClassname());

        string sMKey        = "" + pVictim.entindex();
        string szKillerName = "";
        string szWeaponCls  = "";
        bool   bHeadshot    = false;

        CBasePlayer@ pKillerPlayer = cast<CBasePlayer@>(pAttacker);
        if (pKillerPlayer !is null) {
            szKillerName = string(pKillerPlayer.pev.netname);
            int iAIdx    = pKillerPlayer.entindex();
            if (iAIdx >= 1 && iAIdx <= 32 && CS16BASE::g_AttackerLastWeapon[iAIdx] != "") {
                szWeaponCls = CS16BASE::g_AttackerLastWeapon[iAIdx];
                bHeadshot   = CS16BASE::g_AttackerLastWasHeadshot[iAIdx];
            }
        } else {
            int iAttackerIdx = 0;
            CS16BASE::g_MonsterLastHitter.get(sMKey, iAttackerIdx);
            if (iAttackerIdx >= 1 && iAttackerIdx <= 32) {
                CBasePlayer@ pFallback = g_PlayerFuncs.FindPlayerByIndex(iAttackerIdx);
                if (pFallback !is null) {
                    szKillerName = string(pFallback.pev.netname);
                    string sWeaponCls = "";
                    CS16BASE::g_MonsterLastWeapon.get(sMKey, sWeaponCls);
                    szWeaponCls = sWeaponCls;
                    bool bHS = false;
                    CS16BASE::g_MonsterLastHeadshot.get(sMKey, bHS);
                    bHeadshot = bHS;
                }
            }
        }

        CS16BASE::g_MonsterLastHitter.delete(sMKey);
        CS16BASE::g_MonsterLastWeapon.delete(sMKey);
        CS16BASE::g_MonsterLastHeadshot.delete(sMKey);

        if (szKillerName.IsEmpty()) return HOOK_CONTINUE;

        PushNotice(szKillerName, szVictimName, szWeaponCls, bHeadshot, false);
        return HOOK_CONTINUE;
    }

} // namespace CS16KILLFEED
