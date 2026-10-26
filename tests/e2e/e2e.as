// Counter-Life end-to-end helpers. Loaded only by "just install-e2e", never in production plugin lists.
// Sven Co-op blocks cheat commands for non-admin players, so tests drive the game through these commands:
//   as_command e2e.spawn <classname> [distance]   spawn in front of player 1; monsters are pinned in place after landing
//   as_command e2e.aim [head|body] [classname]    turn player 1 towards the nearest live monster (default monster_*)
//   as_command e2e.kill [head|body] [count] [cls] kill the nearest live monsters, credited to player 1 and its held weapon
//   as_command e2e.give <classname>               give player 1 an item or weapon
//   as_command e2e.stuff <client command...>      run a console command on player 1's client
//   as_command e2e.health <value>                 set player 1's health
//   as_command e2e.armor <value>                  set player 1's armour
//   as_command e2e.hurt <amount>                  damage player 1 from the world (pain, armour absorption)

const float DEFAULT_SPAWN_DISTANCE = 160.0f;
const float LETHAL_DAMAGE = 10000.0f;
const float PIN_DELAY = 1.0f;
// Head shots aim this share of the height below the top of the box, as the CS 1.6 reference capture does
// (cs16-killfeed-reference.md 2.4); the eye position of a monster lies below its head hit box.
const float HEAD_DROP = 0.08f;

array<CConCommand@> g_Commands;

void PluginInit()
{
  g_Module.ScriptInfo.SetAuthor( "Counter-Life" );
  g_Module.ScriptInfo.SetContactInfo( "e2e test helpers" );
  // Plugins must create console commands at init time; global CConCommand objects never register.
  g_Commands.insertLast( CConCommand( "spawn", "<classname> [distance] - spawn in front of player 1", @SpawnInFront ) );
  g_Commands.insertLast( CConCommand( "aim", "[head|body] [classname] - turn player 1 towards the nearest live monster", @AimAtNearestMonster ) );
  g_Commands.insertLast( CConCommand( "kill", "[head|body] [count] [classname] - kill the nearest live monsters, credited to player 1", @KillMonsters ) );
  g_Commands.insertLast( CConCommand( "give", "<classname> - give player 1 an item", @GiveItem ) );
  g_Commands.insertLast( CConCommand( "stuff", "<command...> - run a client command on player 1", @StuffText ) );
  g_Commands.insertLast( CConCommand( "health", "<value> - set player 1 health", @SetHealth ) );
  g_Commands.insertLast( CConCommand( "armor", "<value> - set player 1 armour", @SetArmor ) );
  g_Commands.insertLast( CConCommand( "hurt", "<amount> - damage player 1 from the world", @HurtPlayer ) );
}

CBasePlayer@ FirstPlayer()
{
  CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( 1 );
  if( player is null || !player.IsConnected() )
  {
    g_EngineFuncs.ServerPrint( "[e2e] no player in slot 1\n" );
    return null;
  }
  return player;
}

array<CBaseEntity@> LiveMonsters( const string& in classname = "monster_*" )
{
  array<CBaseEntity@> monsters;
  CBaseEntity@ entity = null;
  while( ( @entity = g_EntityFuncs.FindEntityByClassname( entity, classname ) ) !is null )
  {
    if( entity.IsMonster() && entity.IsAlive() )
      monsters.insertLast( entity );
  }
  return monsters;
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

// Once the monster has dropped to the floor, stop its AI so a test can shoot it at a known spot.
// Sven's movement code ignores movetype changes, but a monster that never thinks never moves;
// taking damage still runs Killed(), which restarts thinking for the death animation.
void PinInPlace( EHandle handle )
{
  CBaseEntity@ entity = handle.GetEntity();
  if( entity is null )
    return;
  entity.pev.velocity = g_vecZero;
  entity.pev.nextthink = 0;
  g_EngineFuncs.ServerPrint( "[e2e] pinned " + entity.pev.classname + "\n" );
}

// Turn player 1's view onto the nearest live monster so a real shot from the held weapon hits it.
void AimAtNearestMonster( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null )
    return;
  const bool aimAtHead = args.ArgC() < 2 || args.Arg( 1 ) != "body";
  const Vector eye = player.EyePosition();
  CBaseEntity@ nearest = null;
  array<CBaseEntity@> monsters = LiveMonsters( args.ArgC() > 2 ? args.Arg( 2 ) : "monster_*" );
  for( uint index = 0; index < monsters.length(); ++index )
  {
    if( nearest is null || ( monsters[index].Center() - eye ).Length() < ( nearest.Center() - eye ).Length() )
      @nearest = monsters[index];
  }
  if( nearest is null )
  {
    g_EngineFuncs.ServerPrint( "[e2e] aim: no live monster\n" );
    return;
  }
  const Vector target = aimAtHead ? HeadOf( nearest ) : nearest.Center();
  Vector viewAngles;
  g_EngineFuncs.VecToAngles( target - eye, viewAngles );
  // VecToAngles returns model pitch; player view pitch has the opposite sign.
  viewAngles.x = -viewAngles.x;
  player.pev.angles = viewAngles;
  player.pev.v_angle = viewAngles;
  player.pev.fixangle = FAM_FORCEVIEWANGLES;
  g_EngineFuncs.ServerPrint( "[e2e] aim " + ( aimAtHead ? "head" : "body" ) + " of " + nearest.pev.classname + " live " + monsters.length() + "\n" );
}

Vector HeadOf( CBaseEntity@ monster )
{
  const Vector centre = monster.Center();
  return Vector( centre.x, centre.y, monster.pev.absmax.z - HEAD_DROP * monster.pev.size.z );
}

// Scripted kill for tests that do not need real bullets: the held weapon is the inflictor, as when it fires.
// Kills the nearest [count] live monsters; "head" marks the hit group so the kill feed shows a headshot.
void KillMonsters( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null )
    return;
  const bool headshot = args.ArgC() > 1 && args.Arg( 1 ) == "head";
  array<CBaseEntity@> monsters = LiveMonsters( args.ArgC() > 3 ? args.Arg( 3 ) : "monster_*" );
  const uint count = args.ArgC() > 2 ? Math.min( uint( atoi( args.Arg( 2 ) ) ), monsters.length() ) : monsters.length();
  const Vector eye = player.EyePosition();
  // Nearest first, so a test can predict the kill order.
  for( uint first = 0; first < monsters.length(); ++first )
  {
    for( uint other = first + 1; other < monsters.length(); ++other )
    {
      if( ( monsters[other].Center() - eye ).Length() < ( monsters[first].Center() - eye ).Length() )
      {
        CBaseEntity@ nearer = monsters[other];
        @monsters[other] = monsters[first];
        @monsters[first] = nearer;
      }
    }
  }
  CBaseEntity@ weapon = player.m_hActiveItem.GetEntity();
  entvars_t@ inflictor = weapon is null ? player.pev : weapon.pev;
  for( uint index = 0; index < count; ++index )
  {
    CBaseMonster@ monster = cast<CBaseMonster@>( monsters[index] );
    if( monster !is null )
      monster.m_LastHitGroup = headshot ? HITGROUP_HEAD : HITGROUP_CHEST;
    monsters[index].TakeDamage( inflictor, player.pev, LETHAL_DAMAGE, DMG_BULLET );
  }
  g_EngineFuncs.ServerPrint( "[e2e] killed " + count + " monster(s) with " + inflictor.classname + ( headshot ? " (head)" : "" ) + "\n" );
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

void SetHealth( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  player.pev.health = atof( args.Arg( 1 ) );
  g_EngineFuncs.ServerPrint( "[e2e] health " + player.pev.health + "\n" );
}

void SetArmor( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  player.pev.armorvalue = atof( args.Arg( 1 ) );
  g_EngineFuncs.ServerPrint( "[e2e] armor " + player.pev.armorvalue + "\n" );
}

void HurtPlayer( const CCommand@ args )
{
  CBasePlayer@ player = FirstPlayer();
  if( player is null || args.ArgC() < 2 )
    return;
  CBaseEntity@ world = g_EntityFuncs.Instance( 0 );
  player.TakeDamage( world.pev, world.pev, atof( args.Arg( 1 ) ), DMG_GENERIC );
  g_EngineFuncs.ServerPrint( "[e2e] hurt to " + player.pev.health + "\n" );
}
