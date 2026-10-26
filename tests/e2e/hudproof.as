// Proof element for the CS HUD foundation (docs/hud-architecture.md). It never ships: tests/e2e/hudproof.ts copies it
// into an e2e sandbox as cs16/hud/proof.as and adds its #include and a HudProof::Register() call to the sandbox copy
// of cs16/cs16_register.as.
// It draws through the raw senders only and logs "[hudproof] ..." lines that the driver waits for.
namespace HudProof
{
  const string SHEET = "cs16/640hud7.spr";
  const RGBA CS_ORANGE = RGBA( 255, 160, 0, 255 );
  const RGBA WHITE = RGBA( 255, 255, 255, 255 );
  const int ABSOLUTE_NO_BORDER = HUD_ELEM_ABSOLUTE_X | HUD_ELEM_ABSOLUTE_Y | HUD_ELEM_NO_BORDER;
  const float FOREVER = -1.0f;

  // CS "cross" (hud.txt: 640hud7 48 25 24 24) on map-group client channel 3, its rect 100 px from the left and 200 px
  // from the top of the screen.
  const uint CROSS_CHANNEL = 3;
  const uint8 CROSS_LEFT = 48;
  const uint8 CROSS_TOP = 25;
  const int16 CROSS_SIZE = 24;
  const float CROSS_X = 100;
  const float CROSS_Y = 200;
  // CS "dollar" (hud.txt: 640hud7 192 25 18 25) on plugin-group client channel 31, its rect 50 px from the right and
  // 60 px from the bottom of the screen.
  const uint DOLLAR_CHANNEL = 31;
  const uint8 DOLLAR_LEFT = 192;
  const uint8 DOLLAR_TOP = 25;
  const int16 DOLLAR_WIDTH = 18;
  const int16 DOLLAR_HEIGHT = 25;
  const float DOLLAR_X = -50;
  const float DOLLAR_Y = -60;

  // Texts on map-script engine slots, right-aligned at the smallest negative x. Slot 5 is static (effect 0); slot 6
  // scans in (effect 2), the only effect whose message carries fxTime.
  const uint TEXT_SLOT = 5;
  const uint SCAN_SLOT = 6;
  const float RIGHT_EDGE = -1.0f / 8192;
  const float TEXT_Y = 0.5f;
  const float SCAN_Y = 0.55f;
  const int PLAIN_EFFECT = 0;
  const int SCAN_EFFECT = 2;
  const float SCAN_CHARACTER_DELAY = 0.02f;
  const float SCAN_HIGHLIGHT_TIME = 0.5f;
  const string SCAN_TEXT = "effect 2 scan text";
  const float LONG_HOLD = 200; // above 127.99 s, so the hold short wraps (rawhud.as TextTime)

  const float REPORT_PERIOD = 5;

  int g_Ticks;
  int g_Frames;
  float g_Elapsed;
  string g_Weapon;

  final class Proof : CS16HUD::IHudElement
  {
    // Only logs: the client resets its HUD texts after a spawn, and the foundation calls OnResend after that.
    void OnSpawn( CBasePlayer@ player )
    {
      g_EngineFuncs.ServerPrint( "[hudproof] spawn " + player.pev.netname + "\n" );
    }

    void OnDeath( CBasePlayer@ player )
    {
      g_EngineFuncs.ServerPrint( "[hudproof] death " + player.pev.netname + "\n" );
    }

    // Counts ticks, reports the rates and logs each weapon switch.
    void OnTick( CBasePlayer@ player, float dt )
    {
      ++g_Ticks;
      g_Elapsed += dt;
      CBaseEntity@ weapon = player.m_hActiveItem.GetEntity();
      const string held = weapon is null ? "none" : string( weapon.pev.classname );
      if( held != g_Weapon )
      {
        g_Weapon = held;
        g_EngineFuncs.ServerPrint( "[hudproof] weapon " + held + "\n" );
      }
      if( g_Elapsed < REPORT_PERIOD )
        return;
      g_EngineFuncs.ServerPrint( "[hudproof] rate ticks/s " + g_Ticks / g_Elapsed + " frames/s " + g_Frames / g_Elapsed
        + " hide " + player.m_iHideHUD + "\n" );
      g_Ticks = 0;
      g_Frames = 0;
      g_Elapsed = 0;
    }

    void OnResend( CBasePlayer@ player )
    {
      Draw( player, "resend" );
    }
  }

  // Asks for every player frame, to measure how often PlayerPostThink runs.
  final class FrameCounter : CS16HUD::IHudElement
  {
    void OnSpawn( CBasePlayer@ player ) {}
    void OnDeath( CBasePlayer@ player ) {}
    void OnTick( CBasePlayer@ player, float dt )
    {
      ++g_Frames;
    }
    void OnResend( CBasePlayer@ player ) {}
  }

  // One rect of the CS 640hud7 sheet, placed in screen pixels from the top-left (x, y >= 0) or the bottom-right
  // (x, y < 0) corner.
  void SendSheetSprite( CBasePlayer@ player, uint channel, uint8 left, uint8 top, int16 width, int16 height, float x,
    float y )
  {
    HUDSpriteParams params;
    params.flags = ABSOLUTE_NO_BORDER;
    params.spritename = SHEET;
    params.left = left;
    params.top = top;
    params.width = width;
    params.height = height;
    params.x = x;
    params.y = y;
    params.color1 = CS_ORANGE;
    params.holdTime = FOREVER;
    CS16HUD::SendSprite( player, channel, params );
  }

  HUDTextParams RightAlignedText( float y, int effect, const RGBA& in colour, const RGBA& in highlight )
  {
    HUDTextParams text;
    text.x = RIGHT_EDGE;
    text.y = y;
    text.effect = effect;
    text.r1 = colour.r;
    text.g1 = colour.g;
    text.b1 = colour.b;
    text.a1 = colour.a;
    text.r2 = highlight.r;
    text.g2 = highlight.g;
    text.b2 = highlight.b;
    text.a2 = highlight.a;
    text.fadeinTime = 0;
    text.fadeoutTime = 0;
    text.holdTime = LONG_HOLD;
    return text;
  }

  void Draw( CBasePlayer@ player, const string& in reason )
  {
    SendSheetSprite( player, CROSS_CHANNEL, CROSS_LEFT, CROSS_TOP, CROSS_SIZE, CROSS_SIZE, CROSS_X, CROSS_Y );
    SendSheetSprite( player, DOLLAR_CHANNEL, DOLLAR_LEFT, DOLLAR_TOP, DOLLAR_WIDTH, DOLLAR_HEIGHT, DOLLAR_X, DOLLAR_Y );

    // By value, as element code uses it.
    const CS16HUD::ScreenSize size = CS16HUD::GetScreenSize( player );
    const bool own = CS16HUD::g_PlayerScreens[player.entindex()] !is null;
    HUDTextParams text = RightAlignedText( TEXT_Y, PLAIN_EFFECT, CS_ORANGE, CS_ORANGE );
    CS16HUD::SendText( player, TEXT_SLOT, text, "hudres " + size.ToString() + ( own ? " yours" : " server" ) );
    HUDTextParams scan = RightAlignedText( SCAN_Y, SCAN_EFFECT, CS_ORANGE, WHITE );
    scan.fadeinTime = SCAN_CHARACTER_DELAY;
    scan.fxTime = SCAN_HIGHLIGHT_TIME;
    CS16HUD::SendText( player, SCAN_SLOT, scan, SCAN_TEXT );

    // Targets past the client limits must be refused and never sent.
    SendSheetSprite( player, CS16HUD::CLIENT_CHANNELS, CROSS_LEFT, CROSS_TOP, CROSS_SIZE, CROSS_SIZE, CROSS_X,
      CROSS_Y );
    CS16HUD::SendText( player, CS16HUD::TEXT_SLOTS, text, "refused" );

    g_EngineFuncs.ServerPrint( "[hudproof] " + reason + " " + player.pev.netname + " screen " + size.ToString()
      + " hide " + player.m_iHideHUD + "\n" );
  }

  // Called from the sandbox copy of PluginInit, right after CS16HUD::PluginInit().
  void Register()
  {
    CS16HUD::PrecacheSprite( SHEET );
    CS16HUD::Register( Proof() );
    CS16HUD::Register( FrameCounter(), true );
  }
}
