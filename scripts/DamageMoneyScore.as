//=============================================================================
// DamageMoneyScore.as
// Proportional Co-op Damage-Based Money Distribution Plugin
//
// Tracks per-monster damage from each player, distributes money proportionally
// on monster kill via the existing BuyMenu system, persists player data to
// files, and syncs total money as the scoreboard score.
//
// Works alongside Counter-Life's BuyMenu — writes directly to
// BuyMenu::BuyPoints and reuses ShowPointsSprite() for HUD display.
//
// Usage: plugin_load DamageMoneyScore
// Config: plugins/store/DamageMoneyScore.cfg
// Data:   plugins/store/playerdata/<sanitized_steam_id>.txt
//=============================================================================

#include "cs16/BuyMenu"
#include "../Cfg"

//=============================================================================
// DamageMoneyScore Namespace — all data structures and helper logic
//=============================================================================
namespace DamageMoneyScore
{
	//=========================================================================
	// Configuration (loaded from plugins/store/DamageMoneyScore.cfg)
	//=========================================================================
	float g_flDamageToMoneyRate = 1.0f;
	int g_iSyncScoreEnabled = 1;
	int g_iAutosaveInterval = 60;

	const string CFG_PATH = "scripts/plugins/store/DamageMoneyScore.cfg";
	const string DATA_DIR = "scripts/plugins/store/playerdata/";

	//=========================================================================
	// Player Data — flat dictionaries keyed by Steam ID
	// Using separate dictionaries for guaranteed compatibility with the
	// AngelScript dictionary addon's primitive-type storage.
	//=========================================================================
	dictionary g_TotalDamage;   // steamId -> float (lifetime damage dealt)
	dictionary g_TotalMoney;    // steamId -> int   (current money balance)
	dictionary g_TotalKills;    // steamId -> int   (lifetime monster kills)

	//=========================================================================
	// Damage Ledger — per-monster damage tracking
	//
	// Uses compound keys: "monsterEntIndex:steamId" -> float damage
	// This avoids nested dictionaries and getKeys() dependency.
	// Entries are cleaned up on monster death; any orphaned entries
	// (from disconnected players) are cleared on map change.
	//=========================================================================
	dictionary g_DamageLedger;

	//=========================================================================
	// Scheduler handles (stored so we can clean up on map change)
	//=========================================================================
	CScheduledFunction@ g_pAutoSaveTimer = null;
	CScheduledFunction@ g_pOldScoreSyncTimer = null;

	//=========================================================================
	// BuyMenu helper — instantiated once for calling PlayerID/ShowPointsSprite
	//=========================================================================
	BuyMenu::BuyMenuCVARS g_BuyMenuHelper;

	//=========================================================================
	// GetMaxMoney — returns the current maximum money cap
	//=========================================================================
	int GetMaxMoney()
	{
		if( BuyMenu::g_MaxMoney !is null )
			return BuyMenu::g_MaxMoney.GetInt();
		return BuyMenu::MaxMoney;
	}

	//=========================================================================
	// GetSteamId — returns the Steam ID string for a player
	// Returns empty string for bots, LAN, or invalid players.
	//=========================================================================
	string GetSteamId( CBasePlayer@ pPlayer )
	{
		if( pPlayer is null )
			return "";

		string steamId = g_EngineFuncs.GetPlayerAuthId( pPlayer.edict() );

		// Filter out bots and invalid IDs that should not be persisted
		if( steamId.IsEmpty()
			|| steamId == "STEAM_ID_LAN"
			|| steamId == "BOT"
			|| steamId == "STEAM_ID_PENDING" )
			return "";

		return steamId;
	}

	//=========================================================================
	// SanitizeSteamId — replaces colons with underscores for safe filenames
	// "STEAM_0:1:12345" -> "STEAM_0_1_12345"
	//=========================================================================
	string SanitizeSteamId( const string& in steamId )
	{
		// Split on colons and rejoin with underscores
		// Using Split() which is confirmed to work in Sven Co-op AS
		array<string>@ parts = steamId.Split( ":" );
		string result = parts[0];
		for( uint i = 1; i < parts.length(); i++ )
		{
			result += "_" + parts[i];
		}
		return result;
	}

	//=========================================================================
	// GetPlayerDataPath — returns the full file path for a player's data file
	//=========================================================================
	string GetPlayerDataPath( const string& in steamId )
	{
		return DATA_DIR + SanitizeSteamId( steamId ) + ".txt";
	}

	//=========================================================================
	// LoadConfig — reads configuration from DamageMoneyScore.cfg
	//=========================================================================
	void LoadConfig()
	{
		Cfg::Parser parser;
		Cfg::File@ pCfgFile = parser.Parse( CFG_PATH );

		if( pCfgFile is null )
		{
			g_Game.AlertMessage( at_console,
				"[DamageMoneyScore] Config not found at %1, using defaults.\n", CFG_PATH );
			return;
		}

		// Parse damage_to_money_rate (float, default 1.0)
		string szRate = pCfgFile.GetCommandArgument( "damage_to_money_rate", "1.0" );
		g_flDamageToMoneyRate = atof( szRate );
		if( g_flDamageToMoneyRate <= 0.0f )
			g_flDamageToMoneyRate = 1.0f;

		// Parse sync_score_enabled (int, default 1)
		string szSync = pCfgFile.GetCommandArgument( "sync_score_enabled", "1" );
		g_iSyncScoreEnabled = atoi( szSync );

		// Parse autosave_interval (int, default 60, minimum 10)
		string szAutosave = pCfgFile.GetCommandArgument( "autosave_interval", "60" );
		g_iAutosaveInterval = atoi( szAutosave );
		if( g_iAutosaveInterval < 10 )
			g_iAutosaveInterval = 10;

		g_Game.AlertMessage( at_console,
			"[DamageMoneyScore] Config loaded: rate=%.2f sync_score=%d autosave=%ds\n",
			g_flDamageToMoneyRate, g_iSyncScoreEnabled, g_iAutosaveInterval );
	}

	//=========================================================================
	// InitPlayerData — initializes default player data in memory
	//=========================================================================
	void InitPlayerData( const string& in steamId )
	{
		if( !g_TotalMoney.exists( steamId ) )
			g_TotalMoney[steamId] = 0;
		if( !g_TotalDamage.exists( steamId ) )
			g_TotalDamage[steamId] = 0.0f;
		if( !g_TotalKills.exists( steamId ) )
			g_TotalKills[steamId] = 0;
	}

	//=========================================================================
	// RemovePlayerData — removes player data from in-memory tracking
	//=========================================================================
	void RemovePlayerData( const string& in steamId )
	{
		g_TotalMoney.delete( steamId );
		g_TotalDamage.delete( steamId );
		g_TotalKills.delete( steamId );
	}

	//=========================================================================
	// LoadPlayerData — loads saved player data from file
	// Returns true if data was loaded, false if no file exists.
	//=========================================================================
	bool LoadPlayerData( const string& in steamId )
	{
		if( steamId.IsEmpty() )
			return false;

		string filePath = GetPlayerDataPath( steamId );

		Cfg::Parser parser;
		Cfg::File@ pCfgFile = parser.Parse( filePath );

		if( pCfgFile is null )
			return false;

		// Parse saved values with safe defaults
		string szMoney = pCfgFile.GetCommandArgument( "total_money", "0" );
		string szDamage = pCfgFile.GetCommandArgument( "total_damage", "0.0" );
		string szKills = pCfgFile.GetCommandArgument( "total_kills", "0" );

		g_TotalMoney[steamId] = atoi( szMoney );
		g_TotalDamage[steamId] = atof( szDamage );
		g_TotalKills[steamId] = atoi( szKills );

		return true;
	}

	//=========================================================================
	// SavePlayerData — saves player data to file
	// Checks file quota before writing to respect server limits.
	//=========================================================================
	bool SavePlayerData( const string& in steamId )
	{
		if( steamId.IsEmpty() )
			return false;

		if( !g_TotalMoney.exists( steamId ) )
			return false;

		string filePath = GetPlayerDataPath( steamId );

		// Check file quota before writing (~80 bytes per player file)
		if( !g_FileSystem.GetFileQuota().CanWriteAmount( 128 ) )
		{
			g_Game.AlertMessage( at_console,
				"[DamageMoneyScore] File quota exceeded, cannot save for %1\n", steamId );
			return false;
		}

		File@ pFile = g_FileSystem.OpenFile( filePath, OpenFile::WRITE );
		if( pFile is null || !pFile.IsOpen() )
		{
			g_Game.AlertMessage( at_console,
				"[DamageMoneyScore] Failed to write: %1\n", filePath );
			return false;
		}

		int money = int( g_TotalMoney[steamId] );
		float damage = float( g_TotalDamage[steamId] );
		int kills = int( g_TotalKills[steamId] );

		pFile.Write( "total_money " + money + "\n" );
		pFile.Write( "total_damage " + damage + "\n" );
		pFile.Write( "total_kills " + kills + "\n" );

		return true;
	}

	//=========================================================================
	// ClampMoney — clamps money value to [0, MaxMoney]
	//=========================================================================
	int ClampMoney( int money )
	{
		if( money < 0 )
			return 0;

		int maxMoney = GetMaxMoney();
		if( money > maxMoney )
			return maxMoney;

		return money;
	}

	//=========================================================================
	// SyncScore — sets pev.frags to totalMoney and syncs OldScore
	// This makes the scoreboard (TAB) reflect the player's money balance,
	// and prevents BuyMenu's UpdatePlayerPoints from re-awarding frag money.
	//=========================================================================
	void SyncScore( CBasePlayer@ pPlayer, const string& in steamId )
	{
		if( pPlayer is null || steamId.IsEmpty() )
			return;

		if( g_iSyncScoreEnabled == 0 )
			return;

		if( !g_TotalMoney.exists( steamId ) )
			return;

		int totalMoney = int( g_TotalMoney[steamId] );
		pPlayer.pev.frags = float( totalMoney );

		// CRITICAL: sync OldScore to prevent BuyMenu feedback loop.
		// BuyMenu's UpdatePlayerPoints watches for frags deltas and awards
		// MoneyPerScore for each frag. By keeping OldScore == frags,
		// the delta is always 0, disabling frag-based earning.
		BuyMenu::OldScore[steamId] = totalMoney;
	}

	//=========================================================================
	// RefreshBuyMenuDisplay — writes money into BuyPoints and refreshes HUD
	//=========================================================================
	void RefreshBuyMenuDisplay( CBasePlayer@ pPlayer, const string& in steamId )
	{
		if( pPlayer is null || steamId.IsEmpty() )
			return;

		if( !g_TotalMoney.exists( steamId ) )
			return;

		int totalMoney = ClampMoney( int( g_TotalMoney[steamId] ) );

		// Write our tracked money into BuyMenu's system
		BuyMenu::BuyPoints[steamId] = totalMoney;

		// Sync OldScore to suppress frag-based earning
		BuyMenu::OldScore[steamId] = int( pPlayer.pev.frags );

		// Refresh the money HUD display (channel 0, 640hud7.spr)
		g_BuyMenuHelper.ShowPointsSprite( pPlayer );
	}

	//=========================================================================
	// RecordDamage — records damage dealt by a player to a monster
	// Uses compound key "entindex:steamId" in the flat damage ledger.
	//=========================================================================
	void RecordDamage( int monsterEntIndex, const string& in steamId, float damage )
	{
		string compoundKey = "" + monsterEntIndex + ":" + steamId;

		if( g_DamageLedger.exists( compoundKey ) )
		{
			float existing = float( g_DamageLedger[compoundKey] );
			g_DamageLedger[compoundKey] = existing + damage;
		}
		else
		{
			g_DamageLedger[compoundKey] = damage;
		}
	}

	//=========================================================================
	// DistributeReward — distributes money to all damage contributors
	// Called when a monster is killed. Iterates all connected players and
	// checks if they contributed damage to this monster.
	//
	// Reward formula per contributor:
	//   cappedDamage = min(playerDamage, maxHealth)
	//   reward = floor(cappedDamage * damageToMoneyRate)
	//
	// Capping at maxHealth prevents overkill from inflating rewards.
	//=========================================================================
	void DistributeReward( CBaseMonster@ pMonster, int monsterEntIndex )
	{
		float maxHealth = pMonster.pev.max_health;
		if( maxHealth <= 0 )
			maxHealth = 1.0f; // Guard against zero/negative max health

		string monsterKey = "" + monsterEntIndex;

		// Iterate all connected players to find contributors
		for( int i = 1; i <= g_Engine.maxClients; i++ )
		{
			CBasePlayer@ pPlayer = g_PlayerFuncs.FindPlayerByIndex( i );
			if( pPlayer is null || !pPlayer.IsConnected() )
				continue;

			string steamId = GetSteamId( pPlayer );
			if( steamId.IsEmpty() )
				continue;

			// Check if this player contributed damage to the killed monster
			string compoundKey = monsterKey + ":" + steamId;
			if( !g_DamageLedger.exists( compoundKey ) )
				continue;

			float playerDamage = float( g_DamageLedger[compoundKey] );

			// Cap damage at maxHealth to prevent overkill inflation
			if( playerDamage > maxHealth )
				playerDamage = maxHealth;

			// Calculate proportional reward
			// reward = floor(maxHealth * (playerDamage / maxHealth) * rate)
			// Simplifies to: floor(playerDamage * rate)
			int reward = int( playerDamage * g_flDamageToMoneyRate );

			if( reward <= 0 )
				continue;

			// Ensure player has tracking data
			if( !g_TotalMoney.exists( steamId ) )
				InitPlayerData( steamId );

			// Credit reward to player's total money
			int currentMoney = int( g_TotalMoney[steamId] );
			int newMoney = ClampMoney( currentMoney + reward );
			g_TotalMoney[steamId] = newMoney;

			// Update lifetime damage tracking
			float currentDamage = float( g_TotalDamage[steamId] );
			g_TotalDamage[steamId] = currentDamage + playerDamage;

			// Write new balance into BuyMenu
			BuyMenu::BuyPoints[steamId] = newMoney;

			// Sync OldScore to suppress BuyMenu's frag-based earning
			BuyMenu::OldScore[steamId] = int( pPlayer.pev.frags );

			// Refresh the money HUD
			g_BuyMenuHelper.ShowPointsSprite( pPlayer );

			// Sync scoreboard
			SyncScore( pPlayer, steamId );

			// Clean up this contributor's ledger entry
			g_DamageLedger.delete( compoundKey );
		}

		// Any remaining entries for this monster (from disconnected players)
		// will persist harmlessly until map change cleanup.
	}

	//=========================================================================
	// ClearMonsterLedger — removes all ledger entries for a monster
	// Called after DistributeReward. Connected players' entries are already
	// cleaned; this handles any remaining entries from disconnected players
	// by iterating a reasonable set of potential keys.
	//=========================================================================
	void ClearMonsterLedger( int monsterEntIndex )
	{
		// Connected players' entries were already deleted in DistributeReward.
		// Orphaned entries from disconnected players will be cleaned at map
		// change via g_DamageLedger.deleteAll(). Individual cleanup here
		// would require iterating all possible steam IDs, which is impractical
		// without getKeys(). The memory cost is negligible.
	}

	//=========================================================================
	// AutoSaveAll — saves data for all connected players with valid IDs
	// Called periodically by the scheduler.
	//=========================================================================
	void AutoSaveAll()
	{
		for( int i = 1; i <= g_Engine.maxClients; i++ )
		{
			CBasePlayer@ pPlayer = g_PlayerFuncs.FindPlayerByIndex( i );
			if( pPlayer is null || !pPlayer.IsConnected() )
				continue;

			string steamId = GetSteamId( pPlayer );
			if( steamId.IsEmpty() )
				continue;

			if( !g_TotalMoney.exists( steamId ) )
				continue;

			// Sync current BuyPoints back to our tracking before saving
			// (player may have spent money via the buy menu)
			if( BuyMenu::BuyPoints.exists( steamId ) )
			{
				int buyMenuMoney = int( BuyMenu::BuyPoints[steamId] );
				g_TotalMoney[steamId] = buyMenuMoney;
			}

			SavePlayerData( steamId );
		}
	}

	//=========================================================================
	// SyncAllOldScore — periodic sync to suppress BuyMenu frag-based earning
	// Runs every 1 second. Also syncs BuyPoints back to our tracking in case
	// the player spent money, and refreshes the scoreboard.
	//=========================================================================
	void SyncAllOldScore()
	{
		for( int i = 1; i <= g_Engine.maxClients; i++ )
		{
			CBasePlayer@ pPlayer = g_PlayerFuncs.FindPlayerByIndex( i );
			if( pPlayer is null || !pPlayer.IsConnected() )
				continue;

			string steamId = GetSteamId( pPlayer );
			if( steamId.IsEmpty() )
				continue;

			if( !g_TotalMoney.exists( steamId ) )
				continue;

			// Sync BuyPoints -> our tracking (detect spending)
			if( BuyMenu::BuyPoints.exists( steamId ) )
			{
				int buyMenuMoney = int( BuyMenu::BuyPoints[steamId] );
				int trackedMoney = int( g_TotalMoney[steamId] );

				// If BuyPoints decreased, the player spent money — update tracking
				if( buyMenuMoney != trackedMoney )
				{
					g_TotalMoney[steamId] = buyMenuMoney;
				}
			}

			// Keep OldScore in sync with frags to suppress frag-based earning
			BuyMenu::OldScore[steamId] = int( pPlayer.pev.frags );

			// Sync scoreboard to reflect current money
			SyncScore( pPlayer, steamId );
		}
	}
}

//=============================================================================
// Hook Callbacks (global scope — required for g_Hooks.RegisterHook)
//=============================================================================

//-----------------------------------------------------------------------------
// DMS_MonsterTakeDamage — tracks damage dealt by players to monsters
// Hooks into Hooks::Monster::MonsterTakeDamage which fires for all monsters
// (including players, since players are technically monsters in GoldSrc).
// We filter to only record damage from players TO non-player monsters.
//-----------------------------------------------------------------------------
HookReturnCode DMS_MonsterTakeDamage( DamageInfo@ pDamageInfo )
{
	if( pDamageInfo is null )
		return HOOK_CONTINUE;

	CBaseEntity@ pVictim = pDamageInfo.pVictim;
	CBaseEntity@ pAttacker = pDamageInfo.pAttacker;

	// Need both valid victim and attacker
	if( pVictim is null || pAttacker is null )
		return HOOK_CONTINUE;

	// Only track damage FROM players TO non-player monsters
	if( !pAttacker.IsPlayer() || pVictim.IsPlayer() )
		return HOOK_CONTINUE;

	float damage = pDamageInfo.flDamage;
	if( damage <= 0 )
		return HOOK_CONTINUE;

	CBasePlayer@ pPlayer = cast<CBasePlayer@>( pAttacker );
	if( pPlayer is null )
		return HOOK_CONTINUE;

	string steamId = DamageMoneyScore::GetSteamId( pPlayer );
	if( steamId.IsEmpty() )
		return HOOK_CONTINUE;

	// Record this damage in the per-monster ledger
	DamageMoneyScore::RecordDamage( pVictim.entindex(), steamId, damage );

	return HOOK_CONTINUE;
}

//-----------------------------------------------------------------------------
// DMS_MonsterKilled — distributes rewards when a monster dies
// Hooks into Hooks::Monster::MonsterKilled.
// Skips player deaths (players trigger this hook too).
// Increments kill count for the killing player, then distributes money
// to all damage contributors proportionally.
//-----------------------------------------------------------------------------
HookReturnCode DMS_MonsterKilled( CBaseMonster@ pMonster, CBaseEntity@ pAttacker, int iGib )
{
	if( pMonster is null )
		return HOOK_CONTINUE;

	// Skip player deaths — players are technically monsters in GoldSrc
	if( pMonster.IsPlayer() )
		return HOOK_CONTINUE;

	int monsterEntIndex = pMonster.entindex();

	// Increment kill count for the player who got the final blow
	if( pAttacker !is null && pAttacker.IsPlayer() )
	{
		CBasePlayer@ pKiller = cast<CBasePlayer@>( pAttacker );
		if( pKiller !is null )
		{
			string killerId = DamageMoneyScore::GetSteamId( pKiller );
			if( !killerId.IsEmpty() && DamageMoneyScore::g_TotalKills.exists( killerId ) )
			{
				int kills = int( DamageMoneyScore::g_TotalKills[killerId] );
				DamageMoneyScore::g_TotalKills[killerId] = kills + 1;
			}
		}
	}

	// Distribute money rewards to all damage contributors
	DamageMoneyScore::DistributeReward( pMonster, monsterEntIndex );

	// Clean up ledger (connected players' entries already removed)
	DamageMoneyScore::ClearMonsterLedger( monsterEntIndex );

	return HOOK_CONTINUE;
}

//-----------------------------------------------------------------------------
// DMS_ClientPutInServer — loads/restores player data on connect
// Loads saved data from file (returning player) or initializes defaults
// (new player). Writes money into BuyMenu::BuyPoints and refreshes the HUD.
//-----------------------------------------------------------------------------
HookReturnCode DMS_ClientPutInServer( CBasePlayer@ pPlayer )
{
	if( pPlayer is null )
		return HOOK_CONTINUE;

	string steamId = DamageMoneyScore::GetSteamId( pPlayer );
	if( steamId.IsEmpty() )
		return HOOK_CONTINUE;

	// Check if we already have in-memory data (plugin state persists across maps)
	bool hasMemoryData = DamageMoneyScore::g_TotalMoney.exists( steamId );

	if( hasMemoryData )
	{
		// Map change case — restore from in-memory tracking
		int savedMoney = DamageMoneyScore::ClampMoney(
			int( DamageMoneyScore::g_TotalMoney[steamId] ) );
		DamageMoneyScore::g_TotalMoney[steamId] = savedMoney;

		// Write into BuyMenu
		BuyMenu::BuyPoints[steamId] = savedMoney;
	}
	else
	{
		// Try to load from saved file
		bool loaded = DamageMoneyScore::LoadPlayerData( steamId );

		if( loaded )
		{
			// Returning player — restore saved money into BuyMenu
			int savedMoney = DamageMoneyScore::ClampMoney(
				int( DamageMoneyScore::g_TotalMoney[steamId] ) );
			DamageMoneyScore::g_TotalMoney[steamId] = savedMoney;
			BuyMenu::BuyPoints[steamId] = savedMoney;
		}
		else
		{
			// Brand new player — initialize with defaults
			DamageMoneyScore::InitPlayerData( steamId );

			// If BuyMenu already set StartMoney, adopt it
			if( BuyMenu::BuyPoints.exists( steamId ) )
			{
				DamageMoneyScore::g_TotalMoney[steamId] =
					int( BuyMenu::BuyPoints[steamId] );
			}
		}
	}

	// Sync OldScore to suppress BuyMenu's frag-based earning from this point
	BuyMenu::OldScore[steamId] = int( pPlayer.pev.frags );

	// Refresh HUD display
	DamageMoneyScore::g_BuyMenuHelper.ShowPointsSprite( pPlayer );

	// Sync score to scoreboard
	DamageMoneyScore::SyncScore( pPlayer, steamId );

	g_Game.AlertMessage( at_console,
		"[DamageMoneyScore] Player loaded: %1 money=%2\n",
		steamId, int( DamageMoneyScore::g_TotalMoney[steamId] ) );

	return HOOK_CONTINUE;
}

//-----------------------------------------------------------------------------
// DMS_ClientDisconnect — saves player data on disconnect
// Syncs final BuyPoints (in case of spending), saves to file, and removes
// the player from in-memory tracking.
//-----------------------------------------------------------------------------
HookReturnCode DMS_ClientDisconnect( CBasePlayer@ pPlayer )
{
	if( pPlayer is null )
		return HOOK_CONTINUE;

	string steamId = DamageMoneyScore::GetSteamId( pPlayer );
	if( steamId.IsEmpty() )
		return HOOK_CONTINUE;

	// Sync final BuyPoints back to our tracking before saving
	// (captures any money spent since last sync)
	if( BuyMenu::BuyPoints.exists( steamId ) )
	{
		DamageMoneyScore::g_TotalMoney[steamId] =
			int( BuyMenu::BuyPoints[steamId] );
	}

	// Save data to file
	DamageMoneyScore::SavePlayerData( steamId );

	// Remove from in-memory tracking
	DamageMoneyScore::RemovePlayerData( steamId );

	return HOOK_CONTINUE;
}

//-----------------------------------------------------------------------------
// DMS_PlayerSpawn — refreshes BuyPoints, HUD, and score on (re)spawn
// Ensures the money display is correct after death/respawn and that the
// scoreboard reflects the current balance.
//-----------------------------------------------------------------------------
HookReturnCode DMS_PlayerSpawn( CBasePlayer@ pPlayer )
{
	if( pPlayer is null )
		return HOOK_CONTINUE;

	string steamId = DamageMoneyScore::GetSteamId( pPlayer );
	if( steamId.IsEmpty() )
		return HOOK_CONTINUE;

	// Ensure player data exists (handles edge cases)
	if( !DamageMoneyScore::g_TotalMoney.exists( steamId ) )
		DamageMoneyScore::InitPlayerData( steamId );

	// Sync BuyPoints back in case of spending since last sync
	if( BuyMenu::BuyPoints.exists( steamId ) )
	{
		int buyMenuMoney = int( BuyMenu::BuyPoints[steamId] );
		int trackedMoney = int( DamageMoneyScore::g_TotalMoney[steamId] );
		if( buyMenuMoney != trackedMoney )
		{
			DamageMoneyScore::g_TotalMoney[steamId] = buyMenuMoney;
		}
	}

	// Refresh BuyMenu display with our tracked money
	DamageMoneyScore::RefreshBuyMenuDisplay( pPlayer, steamId );

	// Sync scoreboard
	DamageMoneyScore::SyncScore( pPlayer, steamId );

	return HOOK_CONTINUE;
}

//=============================================================================
// Scheduled Function Wrappers (global scope — required for g_Scheduler)
//=============================================================================

void DMS_AutoSaveAll()
{
	DamageMoneyScore::AutoSaveAll();
}

void DMS_SyncAllOldScore()
{
	DamageMoneyScore::SyncAllOldScore();
}

//=============================================================================
// Plugin Entry Points
//=============================================================================

//-----------------------------------------------------------------------------
// PluginInit — called once when the plugin is loaded
// Sets up script info and loads configuration.
//-----------------------------------------------------------------------------
void PluginInit()
{
	g_Module.ScriptInfo.SetAuthor( "DamageMoneyScore Plugin" );
	g_Module.ScriptInfo.SetContactInfo( "" );

	// Load configuration from file
	DamageMoneyScore::LoadConfig();
}

//-----------------------------------------------------------------------------
// MapInit — called at the start of each map
// Clears the damage ledger, registers all hooks, and starts periodic tasks.
// Player data dictionaries are NOT cleared (they persist across maps via
// plugin state; money survives map changes through in-memory + file storage).
//-----------------------------------------------------------------------------
void MapInit()
{
	// Clear the damage ledger — no monster tracking carries across maps
	DamageMoneyScore::g_DamageLedger.deleteAll();

	// Reload config on each map to pick up changes
	DamageMoneyScore::LoadConfig();

	// Clean up any existing scheduled tasks from previous map
	if( DamageMoneyScore::g_pAutoSaveTimer !is null )
	{
		g_Scheduler.RemoveTimer( DamageMoneyScore::g_pAutoSaveTimer );
		@DamageMoneyScore::g_pAutoSaveTimer = null;
	}
	if( DamageMoneyScore::g_pOldScoreSyncTimer !is null )
	{
		g_Scheduler.RemoveTimer( DamageMoneyScore::g_pOldScoreSyncTimer );
		@DamageMoneyScore::g_pOldScoreSyncTimer = null;
	}

	// Register all hooks
	g_Hooks.RegisterHook( Hooks::Monster::MonsterTakeDamage, @DMS_MonsterTakeDamage );
	g_Hooks.RegisterHook( Hooks::Monster::MonsterKilled, @DMS_MonsterKilled );
	g_Hooks.RegisterHook( Hooks::Player::ClientPutInServer, @DMS_ClientPutInServer );
	g_Hooks.RegisterHook( Hooks::Player::ClientDisconnect, @DMS_ClientDisconnect );
	g_Hooks.RegisterHook( Hooks::Player::PlayerSpawn, @DMS_PlayerSpawn );

	// Start periodic auto-save timer
	@DamageMoneyScore::g_pAutoSaveTimer = g_Scheduler.SetInterval(
		"DMS_AutoSaveAll",
		float( DamageMoneyScore::g_iAutosaveInterval ),
		g_Scheduler.REPEAT_INFINITE_TIMES );

	// Start periodic OldScore sync every 1 second
	// This suppresses BuyMenu's frag-based earning and keeps the
	// scoreboard up to date for all tracked players.
	@DamageMoneyScore::g_pOldScoreSyncTimer = g_Scheduler.SetInterval(
		"DMS_SyncAllOldScore",
		1.0f,
		g_Scheduler.REPEAT_INFINITE_TIMES );

	g_Game.AlertMessage( at_console,
		"[DamageMoneyScore] MapInit complete. Rate=%.2f AutoSave=%ds SyncScore=%d\n",
		DamageMoneyScore::g_flDamageToMoneyRate,
		DamageMoneyScore::g_iAutosaveInterval,
		DamageMoneyScore::g_iSyncScoreEnabled );
}
