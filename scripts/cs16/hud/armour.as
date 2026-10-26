// CS 1.6 armour at W/5 on the health row (cs16-hud-spec.md 3.2). It fades as the health does. Content sizes and
// positions are the contract of docs/hud-sprites.md.
namespace CS16HUD
{
  const int ARMOUR_FULL_MAX = 100; // the bright part of the armour icon is whole from 100 up
  const float ARMOUR_X = 0.2f; // W/5 for every real screen width (cs16-hud-spec.md U16)

  // The empty icon with the digits, and the bright part that fills the icon from the bottom, in the same box. They are
  // two sprites because CS adds them after the colour multiply (docs/hud-sprites.md).
  final class ArmourElement : IHudElement
  {
    private Part@ m_vest = Part( GENERATED_SPRITE_DIR + "armor.spr", 84, 25, ARMOUR_X, -12, AT_FRACTION_X );
    private Part@ m_vestFull = Part( GENERATED_SPRITE_DIR + "armor_full.spr", 24, 25, ARMOUR_X, -12, AT_FRACTION_X );
    private Part@ m_helmet = Part( GENERATED_SPRITE_DIR + "armor_helmet.spr", 84, 25, ARMOUR_X, -12, AT_FRACTION_X );
    private Part@ m_helmetFull = Part( GENERATED_SPRITE_DIR + "armor_helmet_full.spr", 24, 25, ARMOUR_X, -12,
      AT_FRACTION_X );
    private FadeClock m_fade;
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
      const int armour = Math.clamp( 0, MAX_FRAME, int( player.pev.armorvalue ) );
      m_fade.Track( slot, armour );
      // Sven has no armour type: the helmet icons follow the CS16 buy menu's helmet. CS shows the vest at 0 armour.
      const bool helmet = CS16BASE::g_PlayerHelmet[slot] && armour > 0;
      const int shown = ShowsStatus( player ) ? armour * 2 + ( helmet ? 1 : 0 ) : NO_VALUE;
      if( shown == m_drawn[slot] && !resend )
        return;
      m_drawn[slot] = shown;
      if( shown == NO_VALUE )
      {
        HideElement( player, ARMOUR );
        HideElement( player, ARMOUR_FULL );
        return;
      }
      // A new armour type alone keeps the running fade, as the CS ArmorType message does.
      Look@ look = Fading( WithAlpha( HUD_ORANGE, STATUS_FADE_ALPHA ), WithAlpha( HUD_ORANGE, MIN_ALPHA ), FADE_TIME,
        m_fade.Elapsed( slot ) );
      SendPart( player, ARMOUR, helmet ? m_helmet : m_vest, armour, look );
      SendPart( player, ARMOUR_FULL, helmet ? m_helmetFull : m_vestFull, Math.clamp( 0, ARMOUR_FULL_MAX, armour ),
        look );
    }
  }
}
