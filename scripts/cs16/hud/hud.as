// Shared foundation of the server-side CS 1.6 HUD (docs/hud-architecture.md): the element registry and its update
// loop, plus the channel map, the raw senders, the screen size and the native HUD hiding that it includes.
#include "channels"
#include "rawhud"
#include "screen"
#include "hidenative"

namespace CS16HUD
{
  // One HUD part. Each callback runs only while cs16_hud is 1 and the player can receive messages.
  interface IHudElement
  {
    // After a respawn or a revive, before the client resets its HUD: update state here, draw in OnResend.
    void OnSpawn( CBasePlayer@ player );
    void OnDeath( CBasePlayer@ player );
    // Every TICK_PERIOD, or every player frame for elements registered with everyFrame.
    void OnTick( CBasePlayer@ player, float dt );
    // The client lost or never had this element: draw it again from the player's current state. Runs after each
    // connection and map change (the client deletes all custom elements then), after each spawn once the client has
    // reset its HUD (that clears all HUD texts), after cs16_hud goes back to 1 and after .hudres or cs16_hud_res.
    void OnResend( CBasePlayer@ player );
  }

  // 20 Hz. The fastest automatic CS weapon fires every 0.066 s (P90), so the ammo counter still shows each shot,
  // while one pass over 32 players and all elements stays cheap. Elements that must follow every frame (the dynamic
  // crosshair) register with everyFrame instead.
  const float TICK_PERIOD = 0.05f;

  // Sprites that tools/hudgen.ts writes at install time (docs/hud-sprites.md), relative to sprites/.
  const string GENERATED_SPRITE_DIR = "cs16/hud/";

  // After a spawn the server sends ResetHUD from the player's next PreThink, and ResetHUD makes the client clear
  // every HUD text (CHudMessage::Reset, client.so 0xE99B2) but no custom element. Two PostThinks after the spawn that
  // message is out, so a resend from then on arrives after it, whether the spawn ran inside or before a PreThink.
  const int POST_THINKS_UNTIL_HUD_RESET = 2;

  array<IHudElement@> g_Elements;
  array<IHudElement@> g_TickElements;
  array<IHudElement@> g_FrameElements;
  array<string> g_Sprites;
  CCVar@ g_EnabledCvar;
  CScheduledFunction@ g_TickTimer;
  float g_LastTickTime;
  // Per player slot: put in the server on this map (so messages are safe), waiting for a resend, and PostThinks left
  // until the client has reset its HUD after a spawn.
  array<bool> g_Ready( MAX_PLAYERS + 1 );
  array<bool> g_ResendPending( MAX_PLAYERS + 1 );
  array<int> g_PostThinksUntilHudReset( MAX_PLAYERS + 1 );
  array<float> g_LastFrameTime( MAX_PLAYERS + 1 );

  // everyFrame: OnTick runs from PlayerPostThink, once per user command of the player, instead of every TICK_PERIOD.
  void Register( IHudElement@ element, const bool everyFrame = false )
  {
    g_Elements.insertLast( element );
    if( everyFrame )
      g_FrameElements.insertLast( element );
    else
      g_TickElements.insertLast( element );
  }

  // Sprite name as in HUDSpriteParams.spritename (relative to sprites/). Precached for clients in every MapInit.
  void PrecacheSprite( const string& in spriteName )
  {
    if( g_Sprites.find( spriteName ) < 0 )
      g_Sprites.insertLast( spriteName );
  }

  bool IsEnabled()
  {
    return g_EnabledCvar.GetBool();
  }

  // An element that sends from its own hooks (not from the callbacks above) checks this first.
  bool IsActive( CBasePlayer@ player )
  {
    return player !is null && g_Ready[player.entindex()] && IsEnabled();
  }

  void PluginInit()
  {
    @g_EnabledCvar = CCVar( "cs16_hud", 1, "1: draw the CS 1.6 HUD, 0: draw the native Sven HUD",
      ConCommandFlag::AdminOnly, @OnEnabledChanged );
    InitScreen( @RequestResend );
    g_Hooks.RegisterHook( Hooks::Player::ClientPutInServer, @OnClientPutInServer );
    g_Hooks.RegisterHook( Hooks::Player::ClientDisconnect, @OnClientDisconnect );
    g_Hooks.RegisterHook( Hooks::Player::PlayerSpawn, @OnPlayerSpawn );
    g_Hooks.RegisterHook( Hooks::Player::PlayerRevived, @OnPlayerSpawn );
    g_Hooks.RegisterHook( Hooks::Player::PlayerKilled, @OnPlayerKilled );
    g_Hooks.RegisterHook( Hooks::Player::PlayerPostThink, @OnPlayerPostThink );
    @g_TickTimer = g_Scheduler.SetInterval( "CS16HUD_Tick", TICK_PERIOD, g_Scheduler.REPEAT_INFINITE_TIMES );
    if( g_TickTimer is null )
      g_Game.AlertMessage( at_logged, "[CS16HUD] could not schedule CS16HUD_Tick; the CS HUD will not update\n" );
    g_LastTickTime = g_Engine.time;
    AdoptConnectedPlayers();
  }

  void MapInit()
  {
    for( uint index = 0; index < g_Sprites.length(); ++index )
      g_Game.PrecacheGeneric( "sprites/" + g_Sprites[index] );
    // Every player gets a new player object and a cleared client HUD on the new map.
    for( uint slot = 0; slot <= MAX_PLAYERS; ++slot )
      g_Ready[slot] = false;
    g_LastTickTime = g_Engine.time;
  }

  // A plugin reload keeps the players in the game but starts this module empty: take them over, and treat native
  // bits that are already set as ours, because the previous instance of this plugin most likely set them.
  void AdoptConnectedPlayers()
  {
    for( int slot = 1; slot <= g_Engine.maxClients; ++slot )
    {
      CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( slot );
      if( player is null || !player.IsConnected() )
        continue;
      g_OwnedHideBits[slot] = player.m_iHideHUD & NATIVE_HIDE_BITS;
      MarkReady( player );
      RequestResend( player );
    }
  }

  void MarkReady( CBasePlayer@ player )
  {
    const int slot = player.entindex();
    g_Ready[slot] = true;
    g_LastFrameTime[slot] = g_Engine.time;
    if( IsEnabled() )
      HideNative( player );
  }

  // Resend once the client has reset its HUD after this spawn (see POST_THINKS_UNTIL_HUD_RESET).
  void ResendAfterHudReset( CBasePlayer@ player )
  {
    g_PostThinksUntilHudReset[player.entindex()] = POST_THINKS_UNTIL_HUD_RESET;
  }

  // Every element of the player is drawn again at the next tick that finds the player active. One path for all
  // causes, so a burst of causes (connect, then cs16_hud 1, then .hudres) still costs one resend.
  void RequestResend( CBasePlayer@ player )
  {
    g_ResendPending[player.entindex()] = true;
  }

  void Tick()
  {
    const float dt = g_Engine.time - g_LastTickTime;
    g_LastTickTime = g_Engine.time;
    for( int slot = 1; slot <= g_Engine.maxClients; ++slot )
    {
      CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( slot );
      if( !IsActive( player ) || !player.IsConnected() )
        continue;
      HideNative( player );
      if( g_ResendPending[slot] )
      {
        g_ResendPending[slot] = false;
        for( uint index = 0; index < g_Elements.length(); ++index )
          g_Elements[index].OnResend( player );
      }
      for( uint index = 0; index < g_TickElements.length(); ++index )
        g_TickElements[index].OnTick( player, dt );
    }
  }

  HookReturnCode OnClientPutInServer( CBasePlayer@ player )
  {
    ForgetSent( player );
    ForgetNative( player );
    LoadPlayerScreen( player );
    MarkReady( player );
    // The first spawn of a connection runs before this hook, so it never reaches OnPlayerSpawn.
    ResendAfterHudReset( player );
    return HOOK_CONTINUE;
  }

  HookReturnCode OnClientDisconnect( CBasePlayer@ player )
  {
    g_Ready[player.entindex()] = false;
    return HOOK_CONTINUE;
  }

  HookReturnCode OnPlayerSpawn( CBasePlayer@ player )
  {
    if( !IsActive( player ) )
      return HOOK_CONTINUE;
    HideNative( player );
    for( uint index = 0; index < g_Elements.length(); ++index )
      g_Elements[index].OnSpawn( player );
    ResendAfterHudReset( player );
    return HOOK_CONTINUE;
  }

  HookReturnCode OnPlayerKilled( CBasePlayer@ player, CBaseEntity@ attacker, int gib )
  {
    if( !IsActive( player ) )
      return HOOK_CONTINUE;
    for( uint index = 0; index < g_Elements.length(); ++index )
      g_Elements[index].OnDeath( player );
    return HOOK_CONTINUE;
  }

  HookReturnCode OnPlayerPostThink( CBasePlayer@ player )
  {
    const int slot = player.entindex();
    if( g_PostThinksUntilHudReset[slot] > 0 && --g_PostThinksUntilHudReset[slot] == 0 )
      RequestResend( player );
    if( g_FrameElements.isEmpty() || !IsActive( player ) )
      return HOOK_CONTINUE;
    const float dt = g_Engine.time - g_LastFrameTime[slot];
    g_LastFrameTime[slot] = g_Engine.time;
    for( uint index = 0; index < g_FrameElements.length(); ++index )
      g_FrameElements[index].OnTick( player, dt );
    return HOOK_CONTINUE;
  }

  // 0: give the native HUD back and remove what this plugin drew. 1: hide the native HUD and draw everything again.
  void OnEnabledChanged( CCVar@ cvar, const string& in oldValue, float oldNumber )
  {
    const bool enabled = cvar.GetBool();
    if( enabled == ( oldNumber != 0 ) )
      return;
    g_Game.AlertMessage( at_logged, "[CS16HUD] cs16_hud %1: %2 HUD\n", cvar.GetString(), enabled ? "CS 1.6" : "Sven" );
    for( int slot = 1; slot <= g_Engine.maxClients; ++slot )
    {
      CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( slot );
      if( player is null || !g_Ready[slot] )
        continue;
      if( enabled )
      {
        HideNative( player );
        RequestResend( player );
      }
      else
      {
        RestoreNative( player );
        ClearSent( player );
      }
    }
  }
}

// g_Scheduler looks up functions by name in the global namespace only.
void CS16HUD_Tick()
{
  CS16HUD::Tick();
}
