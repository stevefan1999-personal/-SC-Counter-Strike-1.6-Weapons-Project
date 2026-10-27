// CS 1.6 flashlight at the top right (cs16-hud-spec.md 3.13; CS client.so CHudFlashlight::Draw 0xa7d90). Content sizes
// and positions are the contract of docs/hud-sprites.md.
namespace CS16HUD
{
  const uint8 FLASHLIGHT_ON_ALPHA = 225; // and MIN_ALPHA when off
  const int FLASHLIGHT_LOW_PERCENT = 20; // alert red below this battery
  const int FULL_PERCENT = 100;
  const float FLASHLIGHT_X = 1.0f; // as a fraction: the client clamps the element flush with the right edge
  // CS shows the flashlight only where the server allows flashlights: CBasePlayer::PreThink sets HIDEHUD_FLASHLIGHT
  // while mp_flashlight is 0 (ReGameDLL player.cpp; CS defaults to 0). Sven has the same cvar, 1 in its map defaults.
  const string FLASHLIGHT_CVAR = "mp_flashlight";

  // The casing (with the beam when on) and the energy bar, in the same box. They are two sprites because CS adds
  // them after the colour multiply (docs/hud-sprites.md).
  final class FlashlightElement : IHudElement
  {
    private Part@ m_casing = Part( GENERATED_SPRITE_DIR + "flashlight.spr", 48, 32, FLASHLIGHT_X, 16, AT_FRACTION_X );
    private Part@ m_energy = Part( GENERATED_SPRITE_DIR + "flashlight_energy.spr", 48, 32, FLASHLIGHT_X, 16,
      AT_FRACTION_X );
    private array<int> m_drawn = array<int>( MAX_PLAYERS + 1, NO_VALUE );

    void OnSpawn( CBasePlayer@ player ) {}
    void OnDeath( CBasePlayer@ player ) {}

    void OnTick( CBasePlayer@ player, float dt )
    {
      Draw( player, false );
    }

    void OnResend( CBasePlayer@ player )
    {
      Draw( player, true );
    }

    private void Draw( CBasePlayer@ player, bool resend )
    {
      const int slot = player.entindex();
      const int battery = Math.clamp( 0, FULL_PERCENT, player.m_iFlashBattery );
      const bool on = player.FlashlightIsOn();
      const bool allowed = g_EngineFuncs.CVarGetFloat( FLASHLIGHT_CVAR ) != 0.0f;
      const int shown = ShowsStatus( player ) && allowed ? battery * 2 + ( on ? 1 : 0 ) : NO_VALUE;
      if( shown == m_drawn[slot] && !resend )
        return;
      m_drawn[slot] = shown;
      if( shown == NO_VALUE )
      {
        HideElement( player, FLASHLIGHT );
        HideElement( player, FLASHLIGHT_ENERGY );
        return;
      }
      RGBA colour = HUD_ORANGE;
      if( battery < FLASHLIGHT_LOW_PERCENT )
        colour = ALERT_RED;
      Look@ look = Steady( WithAlpha( colour, on ? FLASHLIGHT_ON_ALPHA : MIN_ALPHA ) );
      SendPart( player, FLASHLIGHT, m_casing, on ? 1 : 0, look );
      SendPart( player, FLASHLIGHT_ENERGY, m_energy, battery, look );
    }
  }
}
