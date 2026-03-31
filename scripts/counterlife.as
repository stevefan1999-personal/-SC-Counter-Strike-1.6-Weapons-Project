// Counter-Life: Replaces Half-Life weapons with random Counter-Strike 1.6 weapons
// HL ammo entities in the world are replaced with equivalent CS16 ammo
// Usage: Add to plugins.txt

// Distance (in units) to search for NPC-dropped weapons around a death position
const float DROP_SEARCH_RADIUS = 128.0f;

// Specific CS weapon to spawn when an NPC drops a given HL weapon
dictionary g_NPCDropMap = {
    { "weapon_9mmAR",      "weapon_m4a1"     },    // Soldier M16  -> M4A1
    { "weapon_9mmhandgun", "weapon_csdeagle"  },    // Medic/Eng     -> Desert Eagle
    { "weapon_shotgun",    "weapon_m3"        },    // Shotgun grunt -> M3
    { "weapon_357",        "weapon_csdeagle"  },    // .357          -> Desert Eagle
    { "weapon_crowbar",    "weapon_csknife"   }
};

// Pending players whose spawn weapons need replacing (entindex)
array<int>    g_PendingSpawnPlayers;
bool          g_bSpawnScheduled = false;

// Per-player last inventory-check timestamp (keyed by entindex)
dictionary    g_fLastWeaponCheck;

// Pending NPC death positions whose dropped weapons need replacing
array<Vector> g_PendingDropPositions;
bool          g_bDropScheduled  = false;

// CS weapon pools per category
array<string> CS_PISTOLS = {
    "weapon_csglock18", "weapon_usp", "weapon_p228",
    "weapon_fiveseven", "weapon_dualelites", "weapon_csdeagle"
};
array<string> CS_SHOTGUNS = { "weapon_m3", "weapon_xm1014" };
array<string> CS_SMGS = {
    "weapon_mac10", "weapon_tmp", "weapon_mp5navy",
    "weapon_ump45", "weapon_p90"
};
array<string> CS_RIFLES = {
    "weapon_famas", "weapon_galil", "weapon_ak47",
    "weapon_m4a1", "weapon_aug", "weapon_sg552"
};
array<string> CS_SNIPERS = { "weapon_scout", "weapon_awp", "weapon_sg550", "weapon_g3sg1" };
array<string> CS_LMGS = { "weapon_csm249" };


// HL weapon classname -> CS weapon category
dictionary g_HLWeaponCategory = {
    { "weapon_crowbar",      "melee" },
    { "weapon_9mmhandgun",   "pistol" },
    { "weapon_357",          "pistol" },
    { "weapon_eagle",        "pistol" },  // OpFor Desert Eagle
    { "weapon_9mmAR",        "rifle" },
    { "weapon_m16",          "rifle" },   // OpFor M16
    { "weapon_shotgun",      "shotgun" },
    { "weapon_crossbow",     "sniper" },
    { "weapon_m40a1",        "sniper" },  // OpFor sniper rifle
    { "weapon_sniperrifle",  "sniper" },  // SC sniper rifle
    { "weapon_egon",         "lmg" },
    { "weapon_hornetgun",    "smg" },
    { "weapon_mp5",          "smg" },    // SC MP5 alias
    { "weapon_uzi",          "smg" },    // OpFor/SC Uzi
    { "weapon_uziakimbo",    "smg" },    // OpFor/SC Akimbo Uzi
    { "weapon_m249",         "lmg" },    // OpFor M249
    { "weapon_saw",          "lmg" },    // SC SAW (M249 alias)
    { "weapon_minigun",      "lmg" },    // SC Minigun
    { "weapon_pipewrench",   "melee" },  // OpFor Pipe Wrench
    { "weapon_handgrenade",  "explosive" },
    { "weapon_satchel",      "explosive" },
    { "weapon_tripmine",     "explosive" },
    { "weapon_snark",        "explosive" }
};

// HL ammo classname -> CS16 ammo classname (all replaced unconditionally)
dictionary g_HLAmmoMap = {
    { "ammo_9mmclip",    "ammo_mp5navy"     },  // 9mm pistol clip  -> MP5 9mm
    { "ammo_9mmAR",      "ammo_mp5navy"     },  // 9mm AR clip      -> MP5 9mm
    { "ammo_9mmbox",     "ammo_mp5navy"     },  // 9mm ammo box     -> MP5 9mm
    { "ammo_357",        "ammo_p228"        },  // .357 Magnum      -> P228 .357SIG
    { "ammo_556",        "ammo_m4a1"        },  // 5.56 NATO        -> M4A1 5.56
    { "ammo_buckshot",   "ammo_m3"          },  // 12 gauge         -> M3 shotgun
    { "ammo_762",        "ammo_ak47"        },  // 7.62 NATO        -> AK-47 7.62
    { "ammo_crossbow",   "ammo_scout"       },  // crossbow bolt    -> Scout 7.62
    { "ammo_gaussclip",  "ammo_awp"         },  // gauss/tau clip   -> AWP .338 Lapua
    { "ammo_rpgclip",    "ammo_csm249"      },  // RPG rocket       -> M249 5.56
    { "ammo_sporeclip",  "ammo_csm249"      },  // spore clip       -> M249 5.56
    { "ammo_ARgrenades", "weapon_hegrenade" }   // AR grenades      -> HE grenade
};

string PickRandomCS( const string&in category )
{
    if( category == "melee" )
        return "weapon_csknife";
    if( category == "pistol" )
        return CS_PISTOLS[Math.RandomLong( 0, int(CS_PISTOLS.length()) - 1 )];
    if( category == "shotgun" )
        return CS_SHOTGUNS[Math.RandomLong( 0, int(CS_SHOTGUNS.length()) - 1 )];
    if( category == "smg" )
        return CS_SMGS[Math.RandomLong( 0, int(CS_SMGS.length()) - 1 )];
    if( category == "rifle" )
        return CS_RIFLES[Math.RandomLong( 0, int(CS_RIFLES.length()) - 1 )];
    if( category == "sniper" )
        return CS_SNIPERS[Math.RandomLong( 0, int(CS_SNIPERS.length()) - 1 )];
    if( category == "lmg" )
        return CS_LMGS[Math.RandomLong( 0, int(CS_LMGS.length()) - 1 )];
    if( category == "explosive" )
    {
        // 70% hegrenade, 30% c4
        if( Math.RandomLong( 1, 10 ) <= 7 )
            return "weapon_hegrenade";
        else
            return "weapon_c4";
    }
    return "";
}

void PluginInit()
{
    g_Module.ScriptInfo.SetAuthor( "Counter-Life" );
    g_Module.ScriptInfo.SetContactInfo( "CS16 weapon replacement plugin" );

    // Hooks registered once here — not in MapInit — to avoid duplicate registration on map change.
    // CS16 weapon registration, buy menu, and kill feed are handled by the cs16/cs16_register plugin.
    RegisterGameHooks();
}

void MapInit()
{
    // CS1.6 view bobbing
    if( g_EngineFuncs.CVarGetFloat( "cl_bob" ) != 0.01f )
        g_EngineFuncs.CVarSetFloat( "cl_bob", 0.01f );
    if( g_EngineFuncs.CVarGetFloat( "cl_bobcycle" ) != 0.8f )
        g_EngineFuncs.CVarSetFloat( "cl_bobcycle", 0.8f );
    if( g_EngineFuncs.CVarGetFloat( "cl_bobup" ) != 0.5f )
        g_EngineFuncs.CVarSetFloat( "cl_bobup", 0.5f );
}

void MapActivate()
{
    // Delay to ensure all map entities are fully spawned
    g_Scheduler.SetTimeout( "ReplaceHLWeapons", 0.0f );
    g_Scheduler.SetTimeout( "ReplaceHLAmmo", 0.0f );
    // Reset per-player check timestamps so PostThink scans fire immediately on new map
    g_fLastWeaponCheck.deleteAll();
}

void ReplaceHLWeapons()
{
    array<string> hlWeapons = g_HLWeaponCategory.getKeys();
    int weaponsReplaced = 0;

    // Collect all HL weapon entities first (no modifications),
    // then remove+replace each one. Avoids re-visiting the same entity if Remove() is deferred.
    for( uint w = 0; w < hlWeapons.length(); w++ )
    {
        string hlClass = hlWeapons[w];
        string category;
        g_HLWeaponCategory.get( hlClass, category );

        // Collect handles - pure read pass, no entity modifications
        array<CBaseEntity@> found;
        CBaseEntity@ pEnt = null;
        while( ( @pEnt = g_EntityFuncs.FindEntityByClassname( pEnt, hlClass ) ) !is null )
            found.insertLast( pEnt );

        // Remove and replace each collected entity
        for( uint i = 0; i < found.length(); i++ )
        {
            string csWeapon = PickWorldCS( hlClass, category );
            if( csWeapon == "" ) continue;

            Vector vecOrigin = found[i].pev.origin;
            Vector vecAngles = found[i].pev.angles;

            g_EntityFuncs.Remove( found[i] );

            CBaseEntity@ pNew = g_EntityFuncs.Create( csWeapon, vecOrigin, vecAngles, false );
            if( pNew !is null )
                weaponsReplaced++;
            else
                g_Game.AlertMessage( at_console, "Counter-Life: Failed to create %1 at (%2, %3, %4)\n", csWeapon, vecOrigin.x, vecOrigin.y, vecOrigin.z );
        }
    }

    g_Game.AlertMessage( at_console, "Counter-Life: Replaced %1 world weapons.\n", weaponsReplaced );
}

void ReplaceHLAmmo()
{
    array<string> hlAmmos = g_HLAmmoMap.getKeys();
    int ammoReplaced = 0;

    for( uint a = 0; a < hlAmmos.length(); a++ )
    {
        string hlAmmoClass = hlAmmos[a];
        string csAmmoClass;
        if( !g_HLAmmoMap.get( hlAmmoClass, csAmmoClass ) )
            continue;

        // Collect all entities of this class first, then remove+replace
        array<CBaseEntity@> found;
        CBaseEntity@ pEnt = null;
        while( ( @pEnt = g_EntityFuncs.FindEntityByClassname( pEnt, hlAmmoClass ) ) !is null )
            found.insertLast( pEnt );

        for( uint i = 0; i < found.length(); i++ )
        {
            Vector vecOrigin = found[i].pev.origin;
            Vector vecAngles = found[i].pev.angles;

            g_EntityFuncs.Remove( found[i] );

            CBaseEntity@ pNew = g_EntityFuncs.Create( csAmmoClass, vecOrigin, vecAngles, false );
            if( pNew !is null )
                ammoReplaced++;
        }
    }

    g_Game.AlertMessage( at_console, "Counter-Life: Replaced %1 HL ammo pickups.\n", ammoReplaced );
}

// World weapon picks — specific overrides, otherwise random pool
string PickWorldCS( const string&in hlClass, const string&in category )
{
    // Revolvers / Desert Eagles always become CS Desert Eagle
    if( hlClass == "weapon_357" || hlClass == "weapon_eagle" )
        return "weapon_csdeagle";
    // Assault rifles always become M4A1
    if( hlClass == "weapon_9mmAR" || hlClass == "weapon_m16" )
        return "weapon_m4a1";
    // Sniper rifles always become AWP
    if( hlClass == "weapon_m40a1" || hlClass == "weapon_sniperrifle" )
        return "weapon_awp";
    // Hand grenade always becomes HE grenade (not C4)
    if( hlClass == "weapon_handgrenade" )
        return "weapon_hegrenade";
    // Melee always becomes knife
    if( hlClass == "weapon_crowbar" || hlClass == "weapon_pipewrench" )
        return "weapon_csknife";
    // MP5 always becomes MP5 Navy
    if( hlClass == "weapon_mp5" )
        return "weapon_mp5navy";
    // Minigun always becomes M249
    if( hlClass == "weapon_minigun" )
        return "weapon_csm249";
    // Everything else falls through to the random category pool
    return PickRandomCS( category );
}

// Spawn-specific weapon picks — fixed choices per HL weapon class
string PickSpawnCS( const string&in hlClass, const string&in category )
{
    // Melee
    if( hlClass == "weapon_crowbar" || hlClass == "weapon_pipewrench" )
        return "weapon_csknife";

    // Pistols
    if( hlClass == "weapon_9mmhandgun" )
        return ( Math.RandomLong( 0, 1 ) == 0 ) ? "weapon_usp" : "weapon_csglock18";
    if( hlClass == "weapon_357" || hlClass == "weapon_eagle" )
        return "weapon_csdeagle";

    // Submachine guns
    if( hlClass == "weapon_9mmAR" )
        return CS_SMGS[ Math.RandomLong( 0, int(CS_SMGS.length()) - 1 ) ];
    if( hlClass == "weapon_mp5" )
        return "weapon_mp5navy";

    // Assault rifle / M16
    if( hlClass == "weapon_m16" )
    {
        array<string> rifles = { "weapon_m4a1", "weapon_ak47", "weapon_aug", "weapon_sg552" };
        return rifles[ Math.RandomLong( 0, int(rifles.length()) - 1 ) ];
    }

    // Sniper rifles
    if( hlClass == "weapon_crossbow" )
        return "weapon_scout";
    if( hlClass == "weapon_m40a1" || hlClass == "weapon_sniperrifle" )
        return "weapon_awp";

    // Minigun becomes M249
    if( hlClass == "weapon_minigun" )
        return "weapon_csm249";

    // Hand grenade always becomes HE grenade (not C4)
    if( hlClass == "weapon_handgrenade" )
        return "weapon_hegrenade";

    // Fall back to the normal random pool for anything else
    return PickRandomCS( category );
}

// ── Hook registration ────────────────────────────────────────────────────────

void RegisterGameHooks()
{
    g_Hooks.RegisterHook( Hooks::Player::ClientPutInServer,  @OnClientPutInServer );
    g_Hooks.RegisterHook( Hooks::Player::PlayerSpawn,        @OnPlayerSpawn );
    g_Hooks.RegisterHook( Hooks::Player::PlayerPostThink,    @OnPlayerPostThink );
    g_Hooks.RegisterHook( Hooks::PickupObject::Collected,    @OnItemCollected );
    g_Hooks.RegisterHook( Hooks::Monster::MonsterKilled,     @OnMonsterKilled );
}

// ── Player spawn weapon replacement ─────────────────────────────────────────

void QueuePlayerForWeaponSwap( CBasePlayer@ pPlayer )
{
    int idx = pPlayer.entindex();
    if( g_PendingSpawnPlayers.find( idx ) < 0 )
        g_PendingSpawnPlayers.insertLast( idx );

    if( !g_bSpawnScheduled )
    {
        g_bSpawnScheduled = true;
        // 1s delay: covers game_player_equip and any engine weapon assignment
        g_Scheduler.SetTimeout( "ProcessSpawnWeapons", 0.0f );
    }
}

HookReturnCode OnClientPutInServer( CBasePlayer@ pPlayer )
{
    if( pPlayer is null )
        return HOOK_CONTINUE;
    g_Game.AlertMessage( at_console, "[CL] ClientPutInServer: %1 (idx=%2)\n", pPlayer.pev.netname, pPlayer.entindex() );
    QueuePlayerForWeaponSwap( pPlayer );
    return HOOK_CONTINUE;
}

HookReturnCode OnPlayerSpawn( CBasePlayer@ pPlayer )
{
    if( pPlayer is null )
        return HOOK_CONTINUE;
    g_Game.AlertMessage( at_console, "[CL] PlayerSpawn: %1 (idx=%2)\n", pPlayer.pev.netname, pPlayer.entindex() );
    QueuePlayerForWeaponSwap( pPlayer );
    return HOOK_CONTINUE;
}

// Replaces all HL weapons in a single player's inventory with CS equivalents.
// Returns the number of weapons replaced.
int ReplacePlayerHLWeapons( CBasePlayer@ pPlayer )
{
    array<string> hlWeapons = g_HLWeaponCategory.getKeys();
    int nReplaced = 0;

    for( uint w = 0; w < hlWeapons.length(); w++ )
    {
        string hlClass = hlWeapons[w];

        CBasePlayerItem@ pItem = pPlayer.HasNamedPlayerItem( hlClass );
        if( pItem is null )
            continue;

        string category;
        g_HLWeaponCategory.get( hlClass, category );
        string csWeapon = PickSpawnCS( hlClass, category );
        if( csWeapon == "" )
            continue;

        g_Game.AlertMessage( at_console, "[CL]  %1 -> %2\n", hlClass, csWeapon );
        pPlayer.RemovePlayerItem( pItem );
        g_EntityFuncs.Remove( pItem );
        pPlayer.GiveNamedItem( csWeapon );
        nReplaced++;
    }

    return nReplaced;
}

void ProcessSpawnWeapons()
{
    g_bSpawnScheduled = false;
    g_Game.AlertMessage( at_console, "[CL] ProcessSpawnWeapons: %1 player(s) pending\n", g_PendingSpawnPlayers.length() );

    for( uint i = 0; i < g_PendingSpawnPlayers.length(); i++ )
    {
        CBasePlayer@ pPlayer = g_PlayerFuncs.FindPlayerByIndex( g_PendingSpawnPlayers[i] );
        if( pPlayer is null )
        {
            g_Game.AlertMessage( at_console, "[CL] idx %1: null\n", g_PendingSpawnPlayers[i] );
            continue;
        }
        if( !pPlayer.IsAlive() )
        {
            g_Game.AlertMessage( at_console, "[CL] %1: not alive, skipping\n", pPlayer.pev.netname );
            continue;
        }

        g_Game.AlertMessage( at_console, "[CL] Scanning %1 for HL weapons\n", pPlayer.pev.netname );
        int n = ReplacePlayerHLWeapons( pPlayer );
        g_Game.AlertMessage( at_console, "[CL] Done: %1 replaced for %2\n", n, pPlayer.pev.netname );
    }

    g_PendingSpawnPlayers.resize( 0 );
}

// Fires when a player picks up a world item — replace immediately if it's an HL weapon.
HookReturnCode OnItemCollected( CBaseEntity@ pItem, CBaseEntity@ pCollector )
{
    if( pItem is null || pCollector is null )
        return HOOK_CONTINUE;

    string cls = pItem.GetClassname();
    if( !g_HLWeaponCategory.exists( cls ) )
        return HOOK_CONTINUE;

    CBasePlayer@ pPlayer = cast<CBasePlayer@>( pCollector );
    if( pPlayer is null )
        return HOOK_CONTINUE;

    // The weapon is now in the player's inventory — find and replace it.
    string category;
    g_HLWeaponCategory.get( cls, category );
    string csWeapon = PickSpawnCS( cls, category );
    if( csWeapon == "" )
        return HOOK_CONTINUE;

    CBasePlayerItem@ pWpn = pPlayer.HasNamedPlayerItem( cls );
    if( pWpn !is null )
    {
        pPlayer.RemovePlayerItem( pWpn );
        g_EntityFuncs.Remove( pWpn );
    }
    pPlayer.GiveNamedItem( csWeapon );

    return HOOK_CONTINUE;
}

// PostThink — runs every frame per player, but only scans inventory every 2s.
// Catches weapons given at any time (portals, class selection, triggers, etc.)
HookReturnCode OnPlayerPostThink( CBasePlayer@ pPlayer )
{
    if( pPlayer is null || !pPlayer.IsAlive() )
        return HOOK_CONTINUE;

    string key = "" + pPlayer.entindex();
    float lastCheck = 0.0f;
    g_fLastWeaponCheck.get( key, lastCheck );

    if( g_Engine.time - lastCheck < 2.0f )
        return HOOK_CONTINUE;

    g_fLastWeaponCheck[ key ] = g_Engine.time;
    ReplacePlayerHLWeapons( pPlayer );

    return HOOK_CONTINUE;
}

// ── NPC dropped weapon replacement ──────────────────────────────────────────

HookReturnCode OnMonsterKilled( CBaseMonster@ pVictim, CBaseEntity@ pAttacker, int iGib )
{
    if( pVictim is null )
        return HOOK_CONTINUE;

    string cls = pVictim.GetClassname();
    if( cls != "monster_human_grunt" && cls != "monster_human_grunt_ally" )
        return HOOK_CONTINUE;

    g_PendingDropPositions.insertLast( pVictim.pev.origin );

    if( !g_bDropScheduled )
    {
        g_bDropScheduled = true;
        g_Scheduler.SetTimeout( "ProcessDroppedWeapons", 0.0f );
    }

    return HOOK_CONTINUE;
}

void ProcessDroppedWeapons()
{
    g_bDropScheduled = false;

    array<string> hlClasses = g_NPCDropMap.getKeys();

    for( uint d = 0; d < g_PendingDropPositions.length(); d++ )
    {
        Vector deathPos = g_PendingDropPositions[d];

        for( uint w = 0; w < hlClasses.length(); w++ )
        {
            string hlClass = hlClasses[w];
            string csWeapon;
            if( !g_NPCDropMap.get( hlClass, csWeapon ) )
                continue;

            // Collect HL weapon entities near the death position
            array<CBaseEntity@> found;
            CBaseEntity@ pEnt = null;
            while( ( @pEnt = g_EntityFuncs.FindEntityByClassname( pEnt, hlClass ) ) !is null )
            {
                if( ( pEnt.pev.origin - deathPos ).Length() <= DROP_SEARCH_RADIUS )
                    found.insertLast( pEnt );
            }

            for( uint i = 0; i < found.length(); i++ )
            {
                Vector vecOrigin = found[i].pev.origin;
                Vector vecAngles = found[i].pev.angles;
                g_EntityFuncs.Remove( found[i] );
                g_EntityFuncs.Create( csWeapon, vecOrigin, vecAngles, false );
            }
        }
    }

    g_PendingDropPositions.resize( 0 );
}
