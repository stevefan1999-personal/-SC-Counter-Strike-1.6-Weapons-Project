// Usage suited for Counter-Strike Weapons in Sven Co-op
// Author: KernCore

namespace CS16BASE
{ //Namespace start

bool ShouldUseCustomAmmo = true; // true = Uses custom ammo values; false = Uses SC's default ammo values.

//default Ammo
//9mm
const string DF_AMMO_9MM    = "9mm";
const int DF_MAX_CARRY_9MM    = 250;
//buckshot
const string DF_AMMO_BUCK    = "buckshot";
const int DF_MAX_CARRY_BUCK    = 125;
//357
const string DF_AMMO_357    = "357";
const int DF_MAX_CARRY_357    = 36;
//m40a1
const string DF_AMMO_M40A1    = "m40a1";
const int DF_MAX_CARRY_M40A1= 15;
//556
const string DF_AMMO_556    = "556";
const int DF_MAX_CARRY_556    = 600;
//rockets
const string DF_AMMO_RKT    = "rockets";
const int DF_MAX_CARRY_RKT    = 5;
const int DF_MAX_CARRY_RKT2    = 10;
//uranium
const string DF_AMMO_URAN    = "uranium";
const int DF_MAX_CARRY_URAN    = 100;
//ARgrenades
const string DF_AMMO_ARGR    = "ARgrenades";
const int DF_MAX_CARRY_ARGR    = 10;
//sporeclip
const string DF_AMMO_SPOR    = "sporeclip";
const int DF_MAX_CARRY_SPOR    = 30;

// Precaches an array of sounds
void PrecacheSounds( const array<string> pSound )
{
    for( uint i = 0; i < pSound.length(); i++ )
    {
        g_SoundSystem.PrecacheSound( pSound[i] );
        g_Game.PrecacheGeneric( "sound/" + pSound[i] );
        //g_Game.AlertMessage( at_notice, "Precached: sound/" + pSound[i] + "\n" );
    }
}

// Precaches a single sound
void PrecacheSound( const string pSound )
{
    g_SoundSystem.PrecacheSound( pSound );
    g_Game.PrecacheGeneric( "sound/" + pSound );
    //g_Game.AlertMessage( at_notice, "Precached: sound/" + pSound + "\n" );
}

edict_t@ ENT( const entvars_t@ pev )
{
    return pev.pContainingEntity;
}

//Register Custom weapon entities along with custom ammo entity
void RegisterCWEntity( const string szNameSpace, const string szWeaponClass, const string szWeaponName, const string szAmmoName, const string szAmmoClass, 
    const string& in szSpriteDir, const string szAmmoType1 /*, const string szAmmoType2 = "", const string szAmmoEntity2 = ""*/ )
{
    // Check if the Ammo Entity Name doesn't exist yet
    if( !g_CustomEntityFuncs.IsCustomEntity( szAmmoName ) )
    {
        g_CustomEntityFuncs.RegisterCustomEntity( szNameSpace + szAmmoClass, szAmmoName ); // Register the ammo entity
    }

    // Check if the Weapon Entity Name doesn't exist yet
    if( !g_CustomEntityFuncs.IsCustomEntity( szWeaponName ) )
    {
        g_CustomEntityFuncs.RegisterCustomEntity( szNameSpace + szWeaponClass, szWeaponName ); // Register the weapon entity
        g_ItemRegistry.RegisterWeapon( szWeaponName, szSpriteDir, szAmmoType1, "", szAmmoName/*, szAmmoEntity2*/ ); // Register the weapon
    }
}

//Same purpose as the one above, but this one assumes you'll be using Exhaustible weapons with the weapon acting as the ammo
void RegisterCWEntityEX( const string szNameSpace, const string szWeaponClass, const string szWeaponName, const string szAmmoName, const string& in szSpriteDir, 
    const string szAmmoType1 )
{
    // Check if the Weapon Entity Name doesn't exist yet
    if( !g_CustomEntityFuncs.IsCustomEntity( szWeaponName ) )
    {
        g_CustomEntityFuncs.RegisterCustomEntity( szNameSpace + szWeaponClass, szWeaponName ); // Register the weapon entity
        g_ItemRegistry.RegisterWeapon( szWeaponName, szSpriteDir, szAmmoType1, "", szAmmoName ); // Register the weapon
    }
}

//Weapon Fire Modes
enum FIREMODE_OPTIONS
{
    MODE_NORMAL = 0,
    MODE_BURST
};

//Weapon Zoom Modes
enum ZOOM_OPTIONS
{
    MODE_FOV_NORMAL = 0,
    MODE_FOV_ZOOM,
    MODE_FOV_2X_ZOOM
};

//Weapon Suppressor Modes
enum SUPPRESSOR_OPTIONS
{
    MODE_SUP_OFF = 0,
    MODE_SUP_ON
};

enum CS16_Scope_Animations
{
    SCP_IDLE_DEFAULT = 0,
    SCP_IDLE_FOV40,
    SCP_IDLE_FOV15
};

//Model files
string SCOPE_MODEL          = "models/cs16/wpn/scope.mdl";
string SHELL_PISTOL         = "models/cs16/shells/pshell.mdl";
string SHELL_RIFLE          = "models/cs16/shells/rshell.mdl";
string SHELL_SNIPER         = "models/cs16/shells/rshell_big.mdl";
string SHELL_SHOTGUN        = "models/hlclassic/shotgunshell.mdl";
//Sound files
string EMPTY_PISTOL_S       = "cs16/misc/emptyp.wav";
string EMPTY_RIFLE_S        = "cs16/misc/emptyr.wav";
string AMMO_PICKUP_S        = "hlclassic/items/9mmclip1.wav";
string ZOOM_SOUND           = "cs16/misc/zoom.wav";
//Main Sprite Folder
string MAIN_SPRITE_DIR      = "sprites/";
string MAIN_CSTRIKE_DIR     = "cs16/";
//Zoom information
int RESET_ZOOM_VALUE         = 0;
int DEFAULT_AUG_SG_ZOOM     = 55;
int DEFAULT_ZOOM_VALUE      = 40;
int DEFAULT_2X_ZOOM_VALUE     = 15;

// Fixed damage loss rate per unit of wall travel (TraceTexture unavailable in SC API).
const float PEN_LOSS_RATE = 0.05f;

// CS1.6 armor state — indexed by pPlayer.entindex() (valid range 1–32)
array<int>  g_PlayerArmor(33, 0);
array<bool> g_PlayerHelmet(33, false);

// Kill feed tracking — last CS16 weapon hit per victim (indexed by victim entindex 1-32)
array<int>    g_PlayerLastAttacker(33, 0);
array<string> g_PlayerLastWeapon(33, "");
array<bool>   g_PlayerLastWasHeadshot(33, false);

// Kill feed tracking — last CS16 weapon fired by each player (indexed by attacker entindex 1-32)
// Used for monster-kill notices where the victim is not a CBasePlayer.
array<string> g_AttackerLastWeapon(33, "");
array<bool>   g_AttackerLastWasHeadshot(33, false);

// Kill feed: per-monster last-hit dictionary (key = monster entindex as string).
// Fallback for when MonsterKilled's pAttacker is null — happens with friendly NPCs
// such as scientists whose death code doesn't propagate the attacker entity.
dictionary g_MonsterLastHitter;   // → attacker player entindex (int)
dictionary g_MonsterLastWeapon;   // → weapon classname (string)
dictionary g_MonsterLastHeadshot; // → was headshot (bool)

// CS1.6 hitgroup damage multipliers
float GetHitgroupMultiplier( int iHitgroup )
{
    switch( iHitgroup )
    {
        case HITGROUP_HEAD:                                     return 4.0f;
        case HITGROUP_STOMACH:                                  return 1.25f;
        case HITGROUP_LEFTARM:  case HITGROUP_RIGHTARM:
        case HITGROUP_LEFTLEG:  case HITGROUP_RIGHTLEG:         return 0.75f;
        default: /* HITGROUP_CHEST, HITGROUP_GENERIC */         return 1.0f;
    }
}

// CS1.6 armor absorption: 50% absorbed by armor; helmet required for head protection.
// Returns the damage that should reach health after armor.
float ApplyArmorDamage( CBasePlayer@ pVictim, float flDamage, int iHitgroup )
{
    int idx = pVictim.entindex();
    if( idx < 1 || idx > 32 ) return flDamage;

    int iArmor = CS16BASE::g_PlayerArmor[idx];
    if( iArmor <= 0 ) return flDamage;

    // Head bypasses armor unless the player has a helmet
    if( iHitgroup == HITGROUP_HEAD && !CS16BASE::g_PlayerHelmet[idx] )
        return flDamage;

    float flAbsorb = flDamage * 0.5f;
    if( float(iArmor) >= flAbsorb )
    {
        CS16BASE::g_PlayerArmor[idx] -= int( flAbsorb );
        return flDamage * 0.5f;
    }
    else
    {
        // armor runs dry mid-shot — partial protection
        float flProtect = float( iArmor );
        CS16BASE::g_PlayerArmor[idx] = 0;
        return flDamage - flProtect;
    }
}

mixin class WeaponBase
{
    protected int   m_iShotsFired = 0;
    protected float m_flAccuracy = 0.0f;      // CS16 accuracy bloom value (updated each shot, reset on reload/deploy)
    protected float m_flAccuracyStart = 0.0f; // Per-weapon starting/reset value for m_flAccuracy
    protected float m_flLastFireTime = 0.0f;  // For pistol time-based accuracy decay
    protected int   m_iPenCount = 0;    // walls bullet can penetrate (CS16 iPenetration per weapon)
    protected int   m_iPenPower = 0;    // max wall thickness in units (CS16 iPenetrationPower per bullet type)
    protected float m_flPenDist = 0.0f; // max pen range in units (CS16 flPenetrationDistance per bullet type)
    protected float m_flRangeModifier = 1.0f; // CS16 range damage falloff (e.g. 0.75 = Glock, 0.99 = AWP)
    protected int WeaponFireMode;
    protected int WeaponZoomMode;
    protected int WeaponSilMode;
    protected int m_iShell;
    private bool m_iDirection = true;
    private string g_watersplash_spr = "sprites/wep_smoke_01.spr";

    protected float WeaponTimeBase() // map time
    {
        return g_Engine.time;
    }

    protected bool m_fDropped;
    CBasePlayerItem@ DropItem() // drops the item
    {
        m_fDropped = true;
        return self;
    }

    void CommonSpawn( const string worldModel, const int GiveDefaultAmmo ) // things that are commonly executed in spawn
    {
        m_iShotsFired = 0;
        m_flAccuracy = m_flAccuracyStart;
        g_EntityFuncs.SetModel( self, self.GetW_Model( worldModel ) );
        self.m_iDefaultAmmo = GiveDefaultAmmo;
        self.pev.scale = 1.4;

        self.FallInit();
    }

    void CommonSpritePrecache()
    {
        //MuzzleFlash
        g_Game.PrecacheModel( MAIN_SPRITE_DIR + MAIN_CSTRIKE_DIR + "csflashx.spr" );
        g_Game.PrecacheGeneric( "events/" + "cs16_flashx.txt" );
        //HUD
        g_Game.PrecacheGeneric( MAIN_SPRITE_DIR + MAIN_CSTRIKE_DIR + "cs1024.spr" );
        g_Game.PrecacheGeneric( MAIN_SPRITE_DIR + MAIN_CSTRIKE_DIR + "640hud7.spr" );
        g_Game.PrecacheGeneric( MAIN_SPRITE_DIR + MAIN_CSTRIKE_DIR + "crosshairs.spr" );
        g_Game.PrecacheModel( g_watersplash_spr );
    }

    bool CommonAddToPlayer( CBasePlayer@ pPlayer ) // adds a weapon to the player
    {
        if( !BaseClass.AddToPlayer( pPlayer ) )
            return false;

        NetworkMessage weapon( MSG_ONE, NetworkMessages::WeapPickup, pPlayer.edict() );
            weapon.WriteShort( g_ItemRegistry.GetIdForName( self.pev.classname ) );
        weapon.End();

        return true;
    }

    bool Deploy( string vModel, string pModel, int iAnim, string pAnim, int iBodygroup, float flDeployTime ) // deploys the weapon
    {
        m_fDropped = false;
        m_iShotsFired = 0;
        m_flAccuracy = m_flAccuracyStart;
        self.DefaultDeploy( self.GetV_Model( vModel ), self.GetP_Model( pModel ), iAnim, pAnim, 0, iBodygroup );
        self.m_flTimeWeaponIdle = self.m_flNextPrimaryAttack = self.m_flNextSecondaryAttack = self.m_flNextTertiaryAttack = WeaponTimeBase() + flDeployTime;
        return true;
    }

    bool CommonPlayEmptySound( const string szEmptySound ) // plays a empty sound when the player has no ammo left in the magazine
    {
        if( self.m_bPlayEmptySound )
        {
            self.m_bPlayEmptySound = false;
            g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_STREAM, szEmptySound, 0.9, 1.5, 0, PITCH_NORM );
        }

        return false;
    }

    void CommonHolster() // things that plays on holster
    {
        self.m_fInReload = false;
        SetThink( null );

        m_iShotsFired = 0;
        m_flAccuracy = m_flAccuracyStart;
        m_pPlayer.pev.fuser4 = 0;

        WeaponZoomMode = MODE_FOV_NORMAL;
        ResetFoV();
    }

    //Sets the Player's FOV
    void SetFOV( int fov )
    {
        m_pPlayer.pev.fov = m_pPlayer.m_iFOV = fov;
    }
    
    //Toggles it
    void ToggleZoom( int zoomedFOV )
    {
        if ( self.m_fInZoom == true )
        {
            SetFOV( 0 ); // 0 means reset to default fov
        }
        else if ( self.m_fInZoom == false )
        {
            SetFOV( zoomedFOV );
        }
    }

    void ApplyFoVSniper( int& in iValue, int& in flMaxSpeed, string& in szAnimExtension = "sniperscope", bool bUseFixedVModelPos = true )
    {
        if( bUseFixedVModelPos )
            m_pPlayer.SetVModelPos( Vector( 0, 0, 0 ) );

        ToggleZoom( iValue );

        m_pPlayer.SetMaxSpeedOverride( flMaxSpeed ); //m_pPlayer.pev.maxspeed = flMaxSpeed;

        m_pPlayer.m_szAnimExtension = szAnimExtension;
    }

    void ResetFoV( string& in szAnimExtension = "sniper" )
    {
        m_pPlayer.ResetVModelPos();
        ToggleZoom( RESET_ZOOM_VALUE );

        m_pPlayer.SetMaxSpeedOverride( -1 ); //m_pPlayer.pev.maxspeed = 0;

        m_pPlayer.m_szAnimExtension = szAnimExtension;
    }

    // Precise shell casting
    void GetDefaultShellInfo( CBasePlayer@ pPlayer, Vector& out ShellVelocity, Vector& out ShellOrigin, float forwardScale, float rightScale, float upScale, bool leftShell, bool downShell )
    {
        Vector vecForward, vecRight, vecUp;

        g_EngineFuncs.AngleVectors( pPlayer.pev.v_angle, vecForward, vecRight, vecUp );

        const float fR = (leftShell == true) ? Math.RandomFloat( -120, -60 ) : Math.RandomFloat( 60, 120 );
        const float fU = (downShell == true) ? Math.RandomFloat( -150, -90 ) : Math.RandomFloat( 90, 150 );

        for( int i = 0; i < 3; ++i )
        {
            ShellVelocity[i] = pPlayer.pev.velocity[i] + vecRight[i] * fR + vecUp[i] * fU + vecForward[i] * Math.RandomFloat( 1, 50 );
            ShellOrigin[i]   = pPlayer.pev.origin[i] + pPlayer.pev.view_ofs[i] + vecUp[i] * upScale + vecForward[i] * forwardScale + vecRight[i] * rightScale;
        }
    }

    // Execute shell ejecting
    void ShellEject( CBasePlayer@ pPlayer, int& in mShell, Vector& in Pos, bool leftShell = false, bool downShell = false, TE_BOUNCE shelltype = TE_BOUNCE_SHELL ) // eject spent shell casing
    {
        Vector vecShellVelocity, vecShellOrigin;
        GetDefaultShellInfo( pPlayer, vecShellVelocity, vecShellOrigin, Pos.x, Pos.y, Pos.z, leftShell, downShell ); //23 4.75 -5.15
        vecShellVelocity.y *= 1;
        g_EntityFuncs.EjectBrass( vecShellOrigin, vecShellVelocity, pPlayer.pev.angles.y, mShell, shelltype );
    }

    // Recoil
    void KickBack( float up_base, float lateral_base, float up_modifier, float lateral_modifier, float up_max, float lateral_max, int direction_change )
    {
        float flFront, flSide;

        if( m_iShotsFired == 1 )
        {
            flFront = up_base;
            flSide = lateral_base;
        }
        else
        {
            flFront = m_iShotsFired * up_modifier + up_base;
            flSide = m_iShotsFired * lateral_modifier + lateral_base;
        }

        m_pPlayer.pev.punchangle.x -= flFront;

        if( m_pPlayer.pev.punchangle.x < -up_max )
            m_pPlayer.pev.punchangle.x = -up_max;

        if( m_iDirection )
        {
            m_pPlayer.pev.punchangle.y += flSide;

            if( m_pPlayer.pev.punchangle.y > lateral_max )
                m_pPlayer.pev.punchangle.y = lateral_max;
        }
        else
        {
            m_pPlayer.pev.punchangle.y -= flSide;

            if( m_pPlayer.pev.punchangle.y < -lateral_max )
                m_pPlayer.pev.punchangle.y = -lateral_max;
        }

        if( Math.RandomLong( 0, direction_change ) == 0 )
        {
            m_iDirection = !m_iDirection;
        }
    }

    // CS16-style cubic/quadratic accuracy bloom for rifles and SMGs.
    // Call once per shot after incrementing m_iShotsFired.
    // flExponent: 3.0 = cubic (AK47, AUG, M4A1, MAC10), 2.0 = quadratic (MP5, UMP45, P90, TMP)
    protected void UpdateAccuracyBloom( float flDivisor, float flExponent, float flBase, float flCap )
    {
        float fShots = float(m_iShotsFired);
        float fPow = (flExponent >= 3.0f) ? (fShots * fShots * fShots) : (fShots * fShots);
        m_flAccuracy = fPow / flDivisor + flBase;
        if( m_flAccuracy > flCap )
            m_flAccuracy = flCap;
    }

    // CS16-style time-based accuracy decay for pistols.
    // Accuracy worsens when shots are fired in quick succession, recovers with time.
    // flDecayRate: how fast accuracy degrades per shot (e.g. 0.35 for Deagle)
    // flMin/flMax: clamp range (e.g. 0.55/0.9 for Deagle)
    protected void UpdateAccuracyDecay( float flThreshold, float flDecayRate, float flMin, float flMax )
    {
        float flTimeSinceLastFire = g_Engine.time - m_flLastFireTime;
        m_flAccuracy -= (flThreshold - flTimeSinceLastFire) * flDecayRate;
        if (m_flAccuracy < flMin) m_flAccuracy = flMin;
        if (m_flAccuracy > flMax) m_flAccuracy = flMax;
        m_flLastFireTime = g_Engine.time;
    }

    //w00tguy - actual water spray message
    void te_spritespray( Vector pos, Vector velocity, string sprite = "sprites/bubble.spr", uint8 count = 8, uint8 speed = 16, uint8 noise = 255 )
    {
        NetworkMessage SSpray( MSG_BROADCAST, NetworkMessages::SVC_TEMPENTITY, null );
            SSpray.WriteByte( TE_SPRITE_SPRAY );
            SSpray.WriteCoord( pos.x );
            SSpray.WriteCoord( pos.y );
            SSpray.WriteCoord( pos.z );
            SSpray.WriteCoord( velocity.x );
            SSpray.WriteCoord( velocity.y );
            SSpray.WriteCoord( velocity.z );
            SSpray.WriteShort( g_EngineFuncs.ModelIndex( sprite ) );
            SSpray.WriteByte( count );
            SSpray.WriteByte( speed );
            SSpray.WriteByte( noise );
        SSpray.End();

        switch( Math.RandomLong( 0, 2 ) )
        {
            case 0: g_SoundSystem.PlaySound( self.edict(), CHAN_STREAM, "player/pl_slosh1.wav", 1, ATTN_NORM, 0, PITCH_NORM, 0, true, pos ); break;
            case 1: g_SoundSystem.PlaySound( self.edict(), CHAN_STREAM, "player/pl_slosh2.wav", 1, ATTN_NORM, 0, PITCH_NORM, 0, true, pos ); break;
            case 2: g_SoundSystem.PlaySound( self.edict(), CHAN_STREAM, "player/pl_slosh3.wav", 1, ATTN_NORM, 0, PITCH_NORM, 0, true, pos ); break;
        }
    }

    //w00tguy - water splashes and bubble trails for bullets
    void water_bullet_effects( Vector vecSrc, Vector vecEnd )
    {
        // bubble trails
        bool startInWater       = g_EngineFuncs.PointContents( vecSrc ) == CONTENTS_WATER;
        bool endInWater         = g_EngineFuncs.PointContents( vecEnd ) == CONTENTS_WATER;
        if( startInWater or endInWater )
        {
            Vector bubbleStart    = vecSrc;
            Vector bubbleEnd    = vecEnd;
            Vector bubbleDir    = bubbleEnd - bubbleStart;
            float waterLevel;

            // find water level relative to trace start
            Vector waterPos     = (startInWater) ? bubbleStart : bubbleEnd;
            waterLevel          = g_Utility.WaterLevel( waterPos, waterPos.z, waterPos.z + 1024 );
            waterLevel          -= bubbleStart.z;

            // get percentage of distance travelled through water
            float waterDist    = 1.0f; 
            if( !startInWater or !endInWater )
                waterDist    -= waterLevel / (bubbleEnd.z - bubbleStart.z);
            if( !endInWater )
                waterDist    = 1.0f - waterDist;

            // clip trace to just the water portion
            if( !startInWater )
                bubbleStart    = bubbleEnd - bubbleDir*waterDist;
            else if( !endInWater )
                bubbleEnd     = bubbleStart + bubbleDir*waterDist;

            // a shitty attempt at recreating the splash effect
            Vector waterEntry = (endInWater) ? bubbleStart : bubbleEnd;
            if( !startInWater or !endInWater )
            {
                te_spritespray( waterEntry, Vector( 0, 0, 1 ), g_watersplash_spr, 1, 64, 0);
            }

            // waterlevel must be relative to the starting point
            if( !startInWater or !endInWater )
                waterLevel = (bubbleStart.z > bubbleEnd.z) ? 0 : bubbleEnd.z - bubbleStart.z;

            // calculate bubbles needed for an even distribution
            int numBubbles = int( ( bubbleEnd - bubbleStart ).Length() / 128.0f );
            numBubbles = Math.max( 1, Math.min( 255, numBubbles ) );

            //te_bubbletrail( bubbleStart, bubbleEnd, "sprites/bubble.spr", waterLevel, numBubbles, 16.0f );
        }
    }

    void ShootWeapon( const string szSound, const uint uiNumShots, const Vector& in CONE, const float flMaxDist, const int iDamage, const int DmgType = DMG_GENERIC, bool bIsSuppressed = false )
    {
        if( szSound != string_t() || szSound != "" )
        {
            --self.m_iClip;
            g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szSound, Math.RandomFloat( 0.95, 1.0 ), 0.55, 0, 94 + Math.RandomLong( 0, 0xf ) );
        }

        Vector vecSrc       = m_pPlayer.GetGunPosition();
        Vector vecAiming     = m_pPlayer.GetAutoaimVector( AUTOAIM_2DEGREES );

        m_pPlayer.FireBullets( uiNumShots, vecSrc, vecAiming, CONE, flMaxDist, BULLET_PLAYER_CUSTOMDAMAGE, 2, 0 );

        if( self.m_iClip <= 0 && m_pPlayer.m_rgAmmo( self.m_iPrimaryAmmoType ) <= 0 )
            m_pPlayer.SetSuitUpdate( "!HEV_AMO0", false, 0 );

        if( bIsSuppressed )
        {
            m_pPlayer.pev.effects &= ~EF_MUZZLEFLASH;
            self.pev.effects &= ~EF_MUZZLEFLASH;
        }
        else
        {
            m_pPlayer.pev.effects |= EF_MUZZLEFLASH;
            self.pev.effects |= EF_MUZZLEFLASH;
        }

        m_pPlayer.SetAnimation( PLAYER_ATTACK1 );

        TraceResult tr;
        float x, y;

        for( uint uiPellet = 0; uiPellet < uiNumShots; ++uiPellet )
        {
            g_Utility.GetCircularGaussianSpread( x, y );

            Vector vecDir = vecAiming + x * CONE.x * g_Engine.v_right + y * CONE.y * g_Engine.v_up;
            Vector vecEnd = vecSrc + vecDir * flMaxDist;

            g_Utility.TraceLine( vecSrc, vecEnd, dont_ignore_monsters, m_pPlayer.edict(), tr );

            if( tr.flFraction < 1.0 )
            {
                if( tr.pHit !is null )
                {
                    CBaseEntity@ pHit = g_EntityFuncs.Instance( tr.pHit );

                    if( pHit !is null )
                    {
                        float flDamage = float( iDamage );

                        // CS1.6 distance falloff (consistent with penetration formula)
                        if( m_flRangeModifier < 1.0f )
                        {
                            float flHitDist = tr.flFraction * flMaxDist;
                            flDamage *= ( 1.0f - ( flHitDist / 500.0f ) * ( 1.0f - m_flRangeModifier ) );
                            flDamage = Math.max( 1.0f, flDamage );
                        }

                        // CS1.6 hitgroup multiplier (head ×4, stomach ×1.25, limbs ×0.75)
                        flDamage *= CS16BASE::GetHitgroupMultiplier( tr.iHitgroup );

                        // CS1.6 armor absorption (players only)
                        CBasePlayer@ pVictim = cast<CBasePlayer@>( pHit );
                        if( pVictim !is null )
                            flDamage = CS16BASE::ApplyArmorDamage( pVictim, flDamage, tr.iHitgroup );

                        // Kill feed: record who hit whom, with what weapon, and whether it was a headshot.
                        // tr.iHitgroup still holds the original value here (not yet zeroed).
                        int iAIdx = m_pPlayer.entindex();
                        if( pVictim !is null )
                        {
                            // Per-victim: used when a player dies to find their last attacker
                            int iVIdx = pVictim.entindex();
                            if( iVIdx >= 1 && iVIdx <= 32 )
                            {
                                CS16BASE::g_PlayerLastAttacker[iVIdx]    = iAIdx;
                                CS16BASE::g_PlayerLastWeapon[iVIdx]      = self.pev.classname;
                                CS16BASE::g_PlayerLastWasHeadshot[iVIdx] = ( tr.iHitgroup == HITGROUP_HEAD );
                            }
                        }
                        // Per-attacker: used when a monster dies to find the killing player's weapon
                        if( iAIdx >= 1 && iAIdx <= 32 )
                        {
                            CS16BASE::g_AttackerLastWeapon[iAIdx]      = self.pev.classname;
                            CS16BASE::g_AttackerLastWasHeadshot[iAIdx] = ( tr.iHitgroup == HITGROUP_HEAD );
                        }
                        // Per-monster dictionary: fallback for friendly NPCs where the engine
                        // does not propagate pAttacker through the death chain (e.g. scientists).
                        if( pVictim is null && iAIdx >= 1 && iAIdx <= 32 )
                        {
                            string sMKey = "" + pHit.entindex();
                            CS16BASE::g_MonsterLastHitter.set( sMKey, iAIdx );
                            CS16BASE::g_MonsterLastWeapon.set( sMKey, self.pev.classname );
                            CS16BASE::g_MonsterLastHeadshot.set( sMKey, ( tr.iHitgroup == HITGROUP_HEAD ) );
                        }

                        // Zero out hitgroup so the engine does not double-apply its own
                        // hitgroup multipliers on top of ours inside TraceAttack.
                        tr.iHitgroup = HITGROUP_GENERIC;

                        // Gib only on sniper overkill (damage > 4× current health).
                        // All other hits kill monsters cleanly.
                        int iDmgType = ( DmgType != DMG_GENERIC ) ? DmgType : DMG_BULLET;
                        if( pVictim is null )
                        {
                            bool bSniperOverkill = ( DmgType & DMG_SNIPER ) != 0
                                && pHit.pev.health > 0.0f
                                && flDamage > pHit.pev.health * 4.0f;
                            if( !bSniperOverkill )
                                iDmgType |= DMG_NEVERGIB;
                        }
                        g_WeaponFuncs.ClearMultiDamage();
                        pHit.TraceAttack( m_pPlayer.pev, int( flDamage ), vecDir, tr, iDmgType );
                        g_WeaponFuncs.ApplyMultiDamage( m_pPlayer.pev, m_pPlayer.pev );
                    }
                    g_SoundSystem.PlayHitSound( tr, vecSrc, vecSrc + (vecEnd - vecSrc) * 2, BULLET_PLAYER_CUSTOMDAMAGE );

                    //w00tguy - play water sprite
                    if( tr.fInWater == 0.0 )
                        water_bullet_effects( vecSrc, tr.vecEndPos );

                    if( pHit is null || pHit.IsBSPModel() )
                    {
                        g_WeaponFuncs.DecalGunshot( tr, BULLET_PLAYER_CUSTOMDAMAGE );
                    }

                    // CS16-style bullet penetration (replicates EV_HLDM_FireBullets / FireBullets3)
                    if( m_iPenCount > 0 && m_iPenPower > 0 )
                    {
                        float flCurrentDist = tr.flFraction * flMaxDist;
                        string hitClass = (pHit !is null) ? pHit.GetClassname() : "world/BSP";
                        g_Game.AlertMessage( at_notice, "[PEN] Hit: " + hitClass + "  dist=" + int(flCurrentDist) + "  pen_range=" + int(m_flPenDist) + "\n" );

                        // CS16: skip penetration if hit occurred beyond this bullet type's range
                        if( m_flPenDist > 0.0f && flCurrentDist > m_flPenDist )
                        {
                            g_Game.AlertMessage( at_notice, "[PEN] BLOCKED: beyond pen range\n" );
                            continue;
                        }

                        // iShotPen counts walls remaining (CS16 iShotPenetration countdown)
                        int   iShotPen   = m_iPenCount;
                        float flRemDist  = (1.0f - tr.flFraction) * flMaxDist;
                        Vector vecPenSrc = tr.vecEndPos;
                        float flPenDmg   = float(iDamage);

                        while( iShotPen > 0 && flRemDist > 0.0f && flPenDmg >= 1.0f )
                        {
                            // Backward trace finds exit face of wall entered at vecPenSrc
                            TraceResult trExit;
                            g_Utility.TraceLine( vecPenSrc + vecDir * float(m_iPenPower), vecPenSrc, ignore_monsters, m_pPlayer.edict(), trExit );

                            if( trExit.fStartSolid != 0 )
                            {
                                g_Game.AlertMessage( at_notice, "[PEN] BLOCKED: wall thicker than " + m_iPenPower + " units\n" );
                                break;
                            }
                            if( trExit.flFraction >= 1.0f )
                            {
                                g_Game.AlertMessage( at_notice, "[PEN] BLOCKED: no exit face found\n" );
                                break;
                            }

                            float flWallThick = (1.0f - trExit.flFraction) * float(m_iPenPower);

                            // CS16: halve remaining distance after each wall (energy loss model)
                            flRemDist = (flRemDist - flWallThick) * 0.5f;
                            if( flRemDist <= 0.0f ) break;

                            // Attenuate damage by wall thickness
                            flPenDmg *= Math.max( 0.15f, 1.0f - (PEN_LOSS_RATE * flWallThick) );
                            if( flPenDmg < 1.0f ) break;

                            g_Game.AlertMessage( at_notice, "[PEN] Wall thick=" + flWallThick + "  rem=" + int(flRemDist) + "  dmg=" + int(flPenDmg) + "\n" );

                            // Step past exit face using plane normal (correct for angled/triangular geometry)
                            Vector vecAfterWall = trExit.vecEndPos + trExit.vecPlaneNormal * 2.0f;

                            // Trace forward from exit to find target behind wall
                            TraceResult trBehind;
                            g_Utility.TraceLine( vecAfterWall, vecAfterWall + vecDir * flRemDist, dont_ignore_monsters, m_pPlayer.edict(), trBehind );

                            if( trBehind.flFraction >= 1.0f || trBehind.pHit is null )
                            {
                                g_Game.AlertMessage( at_notice, "[PEN] EXIT OK, nothing behind\n" );
                                break;
                            }

                            CBaseEntity@ pBehind = g_EntityFuncs.Instance( trBehind.pHit );
                            if( pBehind is null ) break;

                            // CS16 flRangeModifier: attenuate penetrated damage over air distance
                            float flBehindDist = trBehind.flFraction * flRemDist;
                            int iFinalDmg = int(flPenDmg);
                            if( m_flRangeModifier < 1.0f && flBehindDist > 0.0f )
                                iFinalDmg = int( float(iFinalDmg) * (1.0f - (flBehindDist / 500.0f) * (1.0f - m_flRangeModifier)) );

                            // CS1.6 hitgroup multiplier + armor for penetration hits
                            float flPenFinalDmg = float( iFinalDmg );
                            flPenFinalDmg *= CS16BASE::GetHitgroupMultiplier( trBehind.iHitgroup );
                            CBasePlayer@ pPenVictim = cast<CBasePlayer@>( pBehind );
                            if( pPenVictim !is null )
                                flPenFinalDmg = CS16BASE::ApplyArmorDamage( pPenVictim, flPenFinalDmg, trBehind.iHitgroup );

                            // Gib only on sniper overkill (damage > 2× current health) for penetration hits too.
                            int iPenDmgType = DMG_BULLET;
                            if( pPenVictim is null )
                            {
                                bool bPenSniperOverkill = ( DmgType & DMG_SNIPER ) != 0
                                    && pBehind.pev.health > 0.0f
                                    && flPenFinalDmg > pBehind.pev.health * 4.0f;
                                if( !bPenSniperOverkill )
                                    iPenDmgType |= DMG_NEVERGIB;
                            }

                            iFinalDmg = Math.max( 1, int( flPenFinalDmg ) );

                            // Zero out hitgroup so the engine does not double-apply its own
                            // hitgroup multipliers on top of ours inside TraceAttack.
                            trBehind.iHitgroup = HITGROUP_GENERIC;

                            g_Game.AlertMessage( at_notice, "[PEN] HIT BEHIND: " + pBehind.GetClassname() + "  dmg=" + iFinalDmg + "\n" );

                            if( iFinalDmg >= 1 )
                            {
                                g_WeaponFuncs.ClearMultiDamage();
                                pBehind.TraceAttack( m_pPlayer.pev, iFinalDmg, vecDir, trBehind, iPenDmgType );
                                g_WeaponFuncs.ApplyMultiDamage( m_pPlayer.pev, m_pPlayer.pev );

                                if( pBehind.IsBSPModel() )
                                {
                                    g_WeaponFuncs.DecalGunshot( trBehind, BULLET_PLAYER_CUSTOMDAMAGE );
                                    // Hit another wall — decrement and loop to penetrate it too
                                    iShotPen--;
                                    vecPenSrc  = trBehind.vecEndPos;
                                    flRemDist -= flBehindDist;
                                    flPenDmg   = float(iFinalDmg);
                                    continue;
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    void Reload( int iAmmo, int iAnim, float flTimer, int iBodygroup ) // things commonly executed in reloads
    {
        self.m_fInReload = true;
        self.DefaultReload( iAmmo, iAnim, flTimer, iBodygroup );
        m_iShotsFired = 0;
        m_flAccuracy = m_flAccuracyStart;
        self.m_flTimeWeaponIdle = WeaponTimeBase() + flTimer;
    }

    bool CheckButton() // returns which key the player is pressing (that might interrupt the reload)
    {
        return m_pPlayer.pev.button & (IN_ATTACK | IN_ATTACK2 | IN_ALT1) != 0;
    }
}

// Server-side view.cpp approximations are implemented in CS16ViewThink()
// in cs16_register.as — V_DropPunchAngle (view.cpp:343) and
// V_CalcViewRoll (view.cpp:404) run at 20 Hz via g_Scheduler.

mixin class GrenadeWeaponExplode
{
    void DestroyThink() // destroys the item
    {
        SetThink( null );
        self.DestroyItem();
        //g_Game.AlertMessage( at_notice, "Item Destroyed.\n" );
    }
}

mixin class MeleeWeaponBase
{
    protected TraceResult m_trHit;
    protected int m_iSwing = 0;

    bool Swing( float flDamage, string szSwingSound, string szHitFleshSound, string szHitWallSound, int& in iAnimAtk1, int& in iAnimAtk2, int& in iBodygroup, 
        float flHitDist = 48.0f, float flMissNextPriAtk = 0.35f, float flHitNextPriAtk = 0.4f, float flNextSecAtk = 0.5f )
    {
        TraceResult tr;
        bool fDidHit = false;

        Math.MakeVectors( m_pPlayer.pev.v_angle );
        Vector vecSrc    = m_pPlayer.GetGunPosition();
        Vector vecEnd    = vecSrc + g_Engine.v_forward * flHitDist;

        g_Utility.TraceLine( vecSrc, vecEnd, dont_ignore_monsters, m_pPlayer.edict(), tr );

        if( tr.flFraction >= 1.0 )
        {
            g_Utility.TraceHull( vecSrc, vecEnd, dont_ignore_monsters, head_hull, m_pPlayer.edict(), tr );
            if( tr.flFraction < 1.0 )
            {
                // Calculate the point of intersection of the line (or hull) and the object we hit
                // This is and approximation of the "best" intersection
                CBaseEntity@ pHit = g_EntityFuncs.Instance( tr.pHit );
                if( pHit is null || pHit.IsBSPModel() == true )
                    g_Utility.FindHullIntersection( vecSrc, tr, tr, VEC_DUCK_HULL_MIN, VEC_DUCK_HULL_MAX, m_pPlayer.edict() );

                vecEnd = tr.vecEndPos;    // This is the point on the actual surface (the hull could have hit space)
            }
        }

        if( tr.flFraction >= 1.0 ) //Missed
        {
            switch( (m_iSwing++) % 2 )
            {
                case 0:
                {
                    self.SendWeaponAnim( iAnimAtk1, 0, iBodygroup );
                    break;
                }

                case 1:
                {
                    self.SendWeaponAnim( iAnimAtk2, 0, iBodygroup );
                    break;
                }
            }

            self.m_flNextPrimaryAttack = g_Engine.time + flMissNextPriAtk;
            self.m_flNextSecondaryAttack = g_Engine.time + flNextSecAtk;
            self.m_flTimeWeaponIdle = g_Engine.time + 2.0f;

            // play wiff or swish sound
            g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szSwingSound, 1, ATTN_NORM, 0, 94 + Math.RandomLong( 0,0xF ) );
            m_pPlayer.SetAnimation( PLAYER_ATTACK1 ); // player "shoot" animation
        }
        else
        {
            // hit
            fDidHit = true;
            CBaseEntity@ pEntity = g_EntityFuncs.Instance( tr.pHit );

            switch( (m_iSwing++) % 2 )
            {
                case 0:
                {
                    self.SendWeaponAnim( iAnimAtk1, 0, iBodygroup );
                    break;
                }

                case 1:
                {
                    self.SendWeaponAnim( iAnimAtk2, 0, iBodygroup );
                    break;
                }
            }

            self.m_flNextPrimaryAttack = g_Engine.time + flHitNextPriAtk;
            self.m_flNextSecondaryAttack = g_Engine.time + flNextSecAtk;
            self.m_flTimeWeaponIdle = g_Engine.time + 2.0f;

            // player "shoot" animation
            m_pPlayer.SetAnimation( PLAYER_ATTACK1 );

            // AdamR: Custom damage option
            if( self.m_flCustomDmg > 0 )
                flDamage = self.m_flCustomDmg;
            // AdamR: End

            g_WeaponFuncs.ClearMultiDamage();

            if( self.m_flNextPrimaryAttack + 0.4f < g_Engine.time )
                pEntity.TraceAttack( m_pPlayer.pev, flDamage, g_Engine.v_forward, tr, DMG_SLASH | DMG_CLUB ); // first swing does full damage
            else
                pEntity.TraceAttack( m_pPlayer.pev, flDamage * 0.75, g_Engine.v_forward, tr, DMG_SLASH | DMG_CLUB ); // subsequent swings do 75% (Changed -Sniper)

            g_WeaponFuncs.ApplyMultiDamage( m_pPlayer.pev, m_pPlayer.pev );

            // play thwack, smack, or dong sound
            float flVol = 1.0;
            bool fHitWorld = true;

            if( pEntity !is null )
            {
                if( pEntity.Classify() != CLASS_NONE && pEntity.Classify() != CLASS_MACHINE && pEntity.BloodColor() != DONT_BLEED )
                {
                    if( pEntity.IsPlayer() ) // aone: lets pull them
                    {
                        pEntity.pev.velocity = pEntity.pev.velocity + (self.pev.origin - pEntity.pev.origin).Normalize() * 120;
                    } // aone: end

                    // play thwack or smack sound
                    g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szHitFleshSound, 1, ATTN_NORM, 0, 94 + Math.RandomLong( 0,0xF ) );
                    m_pPlayer.m_iWeaponVolume = 128;

                    if( !pEntity.IsAlive() )
                        return true;
                    else
                        flVol = 0.1;

                    fHitWorld = false;
                }
            }

            // play texture hit sound
            // UNDONE: Calculate the correct point of intersection when we hit with the hull instead of the line

            if( fHitWorld )
            {
                float fvolbar = g_SoundSystem.PlayHitSound( tr, vecSrc, vecSrc + ( vecEnd - vecSrc ) * 2, BULLET_PLAYER_CROWBAR );
                //self.m_flNextPrimaryAttack = self.m_flNextSecondaryAttack = g_Engine.time + 0.35; //0.25

                fvolbar = 1;

                // also play melee strike
                g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szHitWallSound, fvolbar, ATTN_NORM, 0, 98 + Math.RandomLong( 0, 3 ) );
            }

            // delay the decal a bit
            m_trHit = tr;
            SetThink( ThinkFunction( Smack ) );
            self.pev.nextthink = g_Engine.time + 0.2;

            m_pPlayer.m_iWeaponVolume = int(flVol * 512);
        }

        return fDidHit;
    }

    void Smack()
    {
        g_WeaponFuncs.DecalGunshot( m_trHit, BULLET_PLAYER_CROWBAR );
    }

    bool Stab( float flDamage, string szSwingSound, string szHitFleshSound, string szHitWallSound, int& in iAnimAtkMiss, int& in iAnimAtkHit, int& in iBodygroup, 
        float flHitDist = 32.0f, float flMissNextAtk = 1.0f, float flHitNextAtk = 1.1f )
    {
        TraceResult tr;
        bool fDidHit = false;

        Math.MakeVectors( m_pPlayer.pev.v_angle );
        Vector vecSrc    = m_pPlayer.GetGunPosition();
        Vector vecEnd    = vecSrc + g_Engine.v_forward * flHitDist;

        g_Utility.TraceLine( vecSrc, vecEnd, dont_ignore_monsters, m_pPlayer.edict(), tr );

        if( tr.flFraction >= 1.0 )
        {
            g_Utility.TraceHull( vecSrc, vecEnd, dont_ignore_monsters, head_hull, m_pPlayer.edict(), tr );
            if( tr.flFraction < 1.0 )
            {
                // Calculate the point of intersection of the line (or hull) and the object we hit
                // This is and approximation of the "best" intersection
                CBaseEntity@ pHit = g_EntityFuncs.Instance( tr.pHit );
                if( pHit is null || pHit.IsBSPModel() == true )
                    g_Utility.FindHullIntersection( vecSrc, tr, tr, VEC_DUCK_HULL_MIN, VEC_DUCK_HULL_MAX, m_pPlayer.edict() );

                vecEnd = tr.vecEndPos;    // This is the point on the actual surface (the hull could have hit space)
            }
        }

        if( tr.flFraction >= 1.0 ) //Missed
        {
            self.SendWeaponAnim( iAnimAtkMiss, 0, iBodygroup );

            self.m_flNextPrimaryAttack = g_Engine.time + flMissNextAtk;
            self.m_flNextSecondaryAttack = g_Engine.time + flMissNextAtk;
            self.m_flTimeWeaponIdle = g_Engine.time + 2.0f;

            // play wiff or swish sound
            g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szSwingSound, 1, ATTN_NORM, 0, 94 + Math.RandomLong( 0,0xF ) );
            m_pPlayer.SetAnimation( PLAYER_ATTACK1 ); // player "shoot" animation
        }
        else
        {
            // hit
            fDidHit = true;
            CBaseEntity@ pEntity = g_EntityFuncs.Instance( tr.pHit );

            self.SendWeaponAnim( iAnimAtkHit, 0, iBodygroup );

            self.m_flNextPrimaryAttack = g_Engine.time + flHitNextAtk;
            self.m_flNextSecondaryAttack = g_Engine.time + flHitNextAtk;
            self.m_flTimeWeaponIdle = g_Engine.time + 2.0f;

            // player "shoot" animation
            m_pPlayer.SetAnimation( PLAYER_ATTACK1 );

            // AdamR: Custom damage option
            if( self.m_flCustomDmg > 0 )
                flDamage = self.m_flCustomDmg;
            // AdamR: End

            if( pEntity !is null && pEntity.IsAlive() && !pEntity.IsBSPModel() && (pEntity.BloodColor() != DONT_BLEED || pEntity.Classify() != CLASS_MACHINE) )
            {
                Vector2D vec2LOS;
                float flDot;
                Vector vMyForward = g_Engine.v_forward;

                Math.MakeVectors( pEntity.pev.angles );

                vec2LOS = vMyForward.Make2D();
                vec2LOS = vec2LOS.Normalize();

                flDot = DotProduct( vec2LOS, g_Engine.v_forward.Make2D() );

                //Triple the damage if we are stabbing them in the back.
                if( flDot > 0.80f )
                {
                    flDamage *= 3.0f;
                }
            }

            g_WeaponFuncs.ClearMultiDamage();
            pEntity.TraceAttack( m_pPlayer.pev, flDamage, g_Engine.v_forward, tr, DMG_SLASH | DMG_CLUB );
            g_WeaponFuncs.ApplyMultiDamage( m_pPlayer.pev, m_pPlayer.pev );

            // play thwack, smack, or dong sound
            float flVol = 1.0;
            bool fHitWorld = true;

            if( pEntity !is null )
            {
                if( pEntity.Classify() != CLASS_NONE && pEntity.Classify() != CLASS_MACHINE && pEntity.BloodColor() != DONT_BLEED )
                {
                    if( pEntity.IsPlayer() ) // aone: lets pull them
                    {
                        pEntity.pev.velocity = pEntity.pev.velocity + (self.pev.origin - pEntity.pev.origin).Normalize() * 120;
                    } // aone: end

                    // play thwack or smack sound
                    g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szHitFleshSound, 1, ATTN_NORM, 0, 94 + Math.RandomLong( 0,0xF ) );
                    m_pPlayer.m_iWeaponVolume = 128;

                    if( !pEntity.IsAlive() )
                        return true;
                    else
                        flVol = 0.1;

                    fHitWorld = false;
                }
            }

            // play texture hit sound
            // UNDONE: Calculate the correct point of intersection when we hit with the hull instead of the line

            if( fHitWorld )
            {
                float fvolbar = g_SoundSystem.PlayHitSound( tr, vecSrc, vecSrc + ( vecEnd - vecSrc ) * 2, BULLET_PLAYER_CROWBAR );
                //self.m_flNextPrimaryAttack = self.m_flNextSecondaryAttack = g_Engine.time + 0.35; //0.25

                fvolbar = 1;

                // also play melee strike
                g_SoundSystem.EmitSoundDyn( m_pPlayer.edict(), CHAN_WEAPON, szHitWallSound, fvolbar, ATTN_NORM, 0, 98 + Math.RandomLong( 0, 3 ) );
            }

            // delay the decal a bit
            m_trHit = tr;
            SetThink( ThinkFunction( Smack ) );
            self.pev.nextthink = g_Engine.time + 0.2;

            m_pPlayer.m_iWeaponVolume = int(flVol * 512);
        }

        return fDidHit;
    }
}

mixin class AmmoBase
{
    void CommonSpawn( const string worldModel, const int iBodygroup ) // things that are commonly executed in spawn
    {
        g_EntityFuncs.SetModel( self, worldModel );
        self.pev.body = iBodygroup;
        self.pev.scale = 1.5;

        BaseClass.Spawn();
    }

    void CommonPrecache()
    {
        PrecacheSound( AMMO_PICKUP_S );
    }

    bool CommonAddAmmo( CBaseEntity& inout pOther, int& in iAmmoClip, int& in iAmmoCarry, string& in iAmmoType )
    {
        if( pOther.GiveAmmo( iAmmoClip, iAmmoType, iAmmoCarry ) != -1 )
        {
            g_SoundSystem.EmitSoundDyn( self.edict(), CHAN_ITEM, AMMO_PICKUP_S, 1, ATTN_NORM, 0, 95 + Math.RandomLong( 0, 0xa ) );
            return true;
        }
        return false;
    }
}

} // Namespace end