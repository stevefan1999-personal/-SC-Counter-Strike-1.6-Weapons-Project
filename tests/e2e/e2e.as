// Counter-Life end-to-end helpers. Loaded only by "just install-e2e", never in production plugin lists.
// Sven Co-op blocks cheat commands for non-admin players, so tests drive the game through these commands:
//   as_command e2e.spawn <classname> [distance]   spawn an entity in front of player 1
//   as_command e2e.kill                           kill every live monster, credited to player 1
//   as_command e2e.aim                            turn player 1 towards the nearest live monster
//   as_command e2e.give <classname>               give player 1 an item or weapon
//   as_command e2e.stuff <client command...>      run a console command on player 1's client

const float DEFAULT_SPAWN_DISTANCE = 160.0f;
const float LETHAL_DAMAGE = 10000.0f;
const float PIN_DELAY = 1.0f;

void PluginInit()
{
  g_Module.ScriptInfo.SetAuthor( "Counter-Life" );
  g_Module.ScriptInfo.SetContactInfo( "e2e test helpers" );
  // Plugins must create console commands at init time; global CConCommand objects never register.
  g_Commands.insertLast( CConCommand( "spawn", "<classname> [distance] - spawn in front of player 1", @SpawnInFront ) );
  g_Commands.insertLast( CConCommand( "kill", "- kill every live monster, credited to player 1", @KillMonsters ) );
  g_Commands.insertLast( CConCommand( "give", "<classname> - give player 1 an item", @GiveItem ) );
  g_Commands.insertLast( CConCommand( "stuff", "<command...> - run a client command on player 1", @StuffText ) );
  g_Commands.insertLast( CConCommand( "aim", "- turn player 1 towards the nearest live monster", @AimAtNearestMonster ) );
}

array<CConCommand@> g_Commands;

CBasePlayer@ FirstPlayer()
{
  CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( 1 );
  if( player is null || !player.IsConnected() )
    g_EngineFuncs.ServerPrint( "[e2e] no player in slot 1\n" );
  return player;
}

void SpawnInFront( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  const float distance = args.ArgC() > 2 ? atof( args.Arg( 2 ) ) : DEFAULT_SPAWN_DISTANCE;
  g_EngineFuncs.MakeVectors( Vector( 0, player.pev.v_angle.y, 0 ) );
  const Vector origin = player.pev.origin + g_Engine.v_forward * distance;
  CBaseEntity@ spawned = g_EntityFuncs.Create( args.Arg( 1 ), origin, Vector( 0, player.pev.v_angle.y + 180, 0 ), false );
  g_EngineFuncs.ServerPrint( "[e2e] spawn " + args.Arg( 1 ) + ( spawned is null ? " failed\n" : " ok\n" ) );
  if( spawned !is null && spawned.IsMonster() )
    g_Scheduler.SetTimeout( "PinInPlace", PIN_DELAY, EHandle( spawned ) );
}

// Once the monster has dropped to the floor, stop it from walking so a test can shoot it at a known spot.
// The engine's walk/move functions refuse to move an entity without FL_ONGROUND, FL_FLY or FL_SWIM.
void PinInPlace( EHandle handle )
{
  CBaseEntity@ entity = handle.GetEntity();
  if( entity is null )
    return;
  entity.pev.movetype = MOVETYPE_NONE;
  entity.pev.flags &= ~FL_ONGROUND;
  entity.pev.velocity = g_vecZero;
  g_EngineFuncs.ServerPrint( "[e2e] pinned " + entity.pev.classname + "\n" );
}

void KillMonsters( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null )
    return;
  int killed = 0;
  CBaseEntity@ entity = null;
  while( ( @entity = g_EntityFuncs.FindEntityByClassname( entity, "monster_*" ) ) !is null )
  {
    if( !entity.IsMonster() || !entity.IsAlive() )
      continue;
    entity.TakeDamage( player.pev, player.pev, LETHAL_DAMAGE, DMG_BULLET );
    ++killed;
  }
  g_EngineFuncs.ServerPrint( "[e2e] killed " + killed + " monster(s)\n" );
}

// Turn player 1's view onto the nearest live monster so a real shot from the held weapon hits it.
void AimAtNearestMonster( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null )
    return;
  const Vector eye = player.EyePosition();
  CBaseEntity@ nearest = null;
  CBaseEntity@ entity = null;
  while( ( @entity = g_EntityFuncs.FindEntityByClassname( entity, "monster_*" ) ) !is null )
  {
    if( entity.IsMonster() && entity.IsAlive() && ( nearest is null || ( entity.Center() - eye ).Length() < ( nearest.Center() - eye ).Length() ) )
      @nearest = entity;
  }
  if( nearest is null )
  {
    g_EngineFuncs.ServerPrint( "[e2e] aim: no live monster\n" );
    return;
  }
  Vector viewAngles;
  g_EngineFuncs.VecToAngles( nearest.Center() - eye, viewAngles );
  // VecToAngles returns model pitch; player view pitch has the opposite sign.
  viewAngles.x = -viewAngles.x;
  player.pev.angles = viewAngles;
  player.pev.v_angle = viewAngles;
  player.pev.fixangle = FAM_FORCEVIEWANGLES;
  g_EngineFuncs.ServerPrint( "[e2e] aim at " + nearest.pev.classname + "\n" );
}

void GiveItem( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  player.GiveNamedItem( args.Arg( 1 ) );
  g_EngineFuncs.ServerPrint( "[e2e] gave " + args.Arg( 1 ) + "\n" );
}

void StuffText( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  string command = args.Arg( 1 );
  for( int index = 2; index < args.ArgC(); ++index )
    command += " " + args.Arg( index );
  NetworkMessage message( MSG_ONE, NetworkMessages::SVC_STUFFTEXT, player.edict() );
  message.WriteString( command + "\n" );
  message.End();
  g_EngineFuncs.ServerPrint( "[e2e] stuffed: " + command + "\n" );
}
