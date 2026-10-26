// Screen size that each player renders at. The server cannot read it from the client, but Sven draws HUD sprites
// 1:1 in screen pixels and scales the HudMessage font with the height (sven-client-hud.md 1.6,
// sven-client-hudtext.md 3), so layouts that depend on the size (crosshair scale, kill-feed text widths) need it.
// Sources by priority: the player's own ".hudres <W>x<H>", stored per auth id, then the cvar cs16_hud_res.
namespace CS16HUD
{
  final class ScreenSize
  {
    int width;
    int height;

    // AngelScript needs these two to return a ScreenSize by value.
    ScreenSize()
    {
      width = 0;
      height = 0;
    }

    ScreenSize( const ScreenSize& in other )
    {
      width = other.width;
      height = other.height;
    }

    ScreenSize( int width, int height )
    {
      this.width = width;
      this.height = height;
    }

    string ToString() const
    {
      return string( width ) + "x" + height;
    }
  }

  funcdef void ScreenChanged( CBasePlayer@ player );

  const string DEFAULT_SCREEN = "1920x1080";
  const int MIN_SCREEN_WIDTH = 640; // the Sven client draws no HUD on a narrower screen (sven-client-hud.md 2.1)
  const int MIN_SCREEN_HEIGHT = 480; // the height of the 640 HUD set that CS 1.6 draws
  const int MAX_SCREEN_SIDE = 16384;
  const uint MAX_SIDE_DIGITS = 5; // digits of MAX_SCREEN_SIDE; longer input cannot be valid and would overflow atoi
  const string DIGITS = "0123456789";
  // The store cannot create directories, so the files lie flat in its root.
  const string STORE_PREFIX = "scripts/plugins/store/cs16_hudres_";
  const string STORE_SUFFIX = ".txt";
  const uint STORE_RECORD_SIZE = 16; // "16384x16384\n" with room to spare
  const array<string> HUDRES_COMMANDS = { ".hudres", "/hudres", "!hudres" };
  // An auth id that is not known yet; storing under it would hand the value to the next unvalidated player.
  const string PENDING_AUTH_ID = "STEAM_ID_PENDING";

  CCVar@ g_ScreenCvar;
  CClientCommand@ g_HudresCommand;
  ScreenSize@ g_ServerScreen;
  array<ScreenSize@> g_PlayerScreens( MAX_PLAYERS + 1 ); // null: the player follows cs16_hud_res
  ScreenChanged@ g_OnScreenChanged;

  // A copy, so a caller can keep or change it. Keep the two returns: "return own !is null ? own : g_ServerScreen;"
  // copies a conditional over handles into the result, which crashes the Sven 5.26 server (docs/hud-architecture.md).
  ScreenSize GetScreenSize( CBasePlayer@ player )
  {
    const ScreenSize@ own = g_PlayerScreens[player.entindex()];
    if( own !is null )
      return own;
    return g_ServerScreen;
  }

  void InitScreen( ScreenChanged@ onChanged )
  {
    @g_OnScreenChanged = onChanged;
    @g_ServerScreen = ParseScreenSize( DEFAULT_SCREEN );
    @g_ScreenCvar = CCVar( "cs16_hud_res", DEFAULT_SCREEN,
      "Screen size <W>x<H> for the CS HUD of players who did not set .hudres", ConCommandFlag::AdminOnly,
      @OnScreenCvarChanged );
    @g_HudresCommand = CClientCommand( "hudres", "<W>x<H> - tell the server your screen size for the CS HUD",
      @OnHudresCommand );
    g_Hooks.RegisterHook( Hooks::Player::ClientSay, @OnHudresSay );
  }

  // Parses "<W>x<H>"; null when the text is not a usable screen size.
  ScreenSize@ ParseScreenSize( string text )
  {
    text.ToLowercase();
    const array<string>@ sides = text.Split( "x" );
    if( sides.length() != 2 || !IsSide( sides[0] ) || !IsSide( sides[1] ) )
      return null;
    ScreenSize size( atoi( sides[0] ), atoi( sides[1] ) );
    const bool usable = size.width >= MIN_SCREEN_WIDTH && size.width <= MAX_SCREEN_SIDE
      && size.height >= MIN_SCREEN_HEIGHT && size.height <= MAX_SCREEN_SIDE;
    return usable ? @size : null;
  }

  bool IsSide( const string& in text )
  {
    return !text.IsEmpty() && text.Length() <= MAX_SIDE_DIGITS
      && text.FindFirstNotOf( DIGITS ) == String::INVALID_INDEX;
  }

  // A bad value is refused and the old one comes back, so the server never runs on a size it cannot use.
  void OnScreenCvarChanged( CCVar@ cvar, const string& in oldValue, float )
  {
    ScreenSize@ parsed = ParseScreenSize( cvar.GetString() );
    if( parsed is null )
    {
      g_Game.AlertMessage( at_logged, "[CS16HUD] refused cs16_hud_res \"%1\" (want <width>x<height>, %2-%3 x %4-%3); "
        + "kept %5\n", cvar.GetString(), MIN_SCREEN_WIDTH, MAX_SCREEN_SIDE, MIN_SCREEN_HEIGHT, oldValue );
      cvar.SetString( oldValue );
      return;
    }
    @g_ServerScreen = parsed;
    for( int slot = 1; slot <= g_Engine.maxClients; ++slot )
    {
      CBasePlayer@ player = g_PlayerFuncs.FindPlayerByIndex( slot );
      if( player !is null && g_PlayerScreens[slot] is null )
        g_OnScreenChanged( player );
    }
  }

  // Called for each connection and each new map, before the player's elements are sent.
  void LoadPlayerScreen( CBasePlayer@ player )
  {
    @g_PlayerScreens[player.entindex()] = null;
    const string path = StorePath( player );
    File@ file = path.IsEmpty() ? null : g_FileSystem.OpenFile( path, OpenFile::READ );
    if( file is null || !file.IsOpen() )
      return;
    string record;
    file.ReadLine( record );
    file.Close();
    @g_PlayerScreens[player.entindex()] = ParseScreenSize( record );
    if( g_PlayerScreens[player.entindex()] is null )
      g_Game.AlertMessage( at_logged, "[CS16HUD] ignored the bad screen size \"%1\" in %2\n", record, path );
  }

  void OnHudresCommand( const CCommand@ args )
  {
    HandleHudres( g_ConCommandSystem.GetCurrentPlayer(), args.ArgC() > 1 ? args.Arg( 1 ) : "" );
  }

  HookReturnCode OnHudresSay( SayParameters@ params )
  {
    const CCommand@ args = params.GetArguments();
    if( args.ArgC() == 0 || HUDRES_COMMANDS.find( args.Arg( 0 ).ToLowercase() ) < 0 )
      return HOOK_CONTINUE;
    params.ShouldHide = true;
    HandleHudres( params.GetPlayer(), args.ArgC() > 1 ? args.Arg( 1 ) : "" );
    return HOOK_HANDLED;
  }

  // A valid value becomes the player's size and is stored. A valid value or no value then draws the HUD again, so a
  // bare ".hudres" also repairs the HUD after the client deleted it (a video mode change runs VidInit). Each form
  // reports the active size.
  void HandleHudres( CBasePlayer@ player, const string& in value )
  {
    if( player is null )
      return;
    ScreenSize@ parsed = ParseScreenSize( value );
    if( !value.IsEmpty() && parsed is null )
    {
      Tell( player, "\"" + value + "\" is not a screen size. Use .hudres <width>x<height> with a width of "
        + MIN_SCREEN_WIDTH + "-" + MAX_SCREEN_SIDE + " and a height of " + MIN_SCREEN_HEIGHT + "-" + MAX_SCREEN_SIDE
        + ", for example .hudres " + DEFAULT_SCREEN + "." );
    }
    else
    {
      if( parsed !is null )
      {
        @g_PlayerScreens[player.entindex()] = parsed;
        SavePlayerScreen( player, parsed );
      }
      g_OnScreenChanged( player );
    }
    const bool own = g_PlayerScreens[player.entindex()] !is null;
    Tell( player, "Screen size " + GetScreenSize( player ).ToString()
      + ( own ? " (yours)." : " (server default). Set yours with .hudres <width>x<height>." ) );
  }

  void SavePlayerScreen( CBasePlayer@ player, ScreenSize@ size )
  {
    const string path = StorePath( player );
    if( path.IsEmpty() )
    {
      Tell( player, "Your Steam ID is not validated yet, so this size lasts only until the next map." );
      return;
    }
    File@ file = g_FileSystem.GetFileQuota().CanWriteAmount( STORE_RECORD_SIZE )
      ? g_FileSystem.OpenFile( path, OpenFile::WRITE ) : null;
    if( file is null || !file.IsOpen() )
    {
      g_Game.AlertMessage( at_logged, "[CS16HUD] cannot write %1\n", path );
      Tell( player, "The server could not save this size, so it lasts only until the next map." );
      return;
    }
    file.Write( size.ToString() + "\n" );
    file.Close();
  }

  // One flat file per auth id. On a LAN server (sv_lan 1) every player has the id STEAM_ID_LAN and shares the file.
  string StorePath( CBasePlayer@ player )
  {
    string id = g_EngineFuncs.GetPlayerAuthId( player.edict() );
    if( id.IsEmpty() || id == PENDING_AUTH_ID )
      return "";
    for( uint index = 0; index < id.Length(); ++index )
    {
      if( !isalnum( id[index] ) )
        id.SetCharAt( index, char( "_" ) );
    }
    return STORE_PREFIX + id + STORE_SUFFIX;
  }

  void Tell( CBasePlayer@ player, const string& in text )
  {
    g_PlayerFuncs.ClientPrint( player, HUD_PRINTTALK, "[CS HUD] " + text + "\n" );
  }
}
