// CS 1.6 health at the bottom left (cs16-hud-spec.md 3.1). It fades from alpha 228 to 100 in 5 s after each new
// value. Content size and position are the contract of docs/hud-sprites.md.
namespace CS16HUD
{
  const int HEALTH_LOW = 25; // red at this health and below
  const int HEALTH_CRITICAL = 15; // and at full alpha without a fade at this health and below

  final class HealthElement : IHudElement
  {
    private Part@ m_part = Part( GENERATED_SPRITE_DIR + "health.spr", 82, 25, 12, -12 );
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
      const int health = HealthValue( player );
      m_fade.Track( slot, health );
      const int shown = ShowsStatus( player ) ? health : NO_VALUE;
      if( shown == m_drawn[slot] && !resend )
        return;
      m_drawn[slot] = shown;
      if( shown == NO_VALUE )
      {
        HideElement( player, HEALTH );
        return;
      }
      SendPart( player, HEALTH, m_part, health, HealthLook( health, m_fade.Elapsed( slot ) ) );
    }
  }

  // Half-Life sends the health as an int, and 1 for a living player below 1 (dlls/player.cpp UpdateClientData).
  int HealthValue( CBasePlayer@ player )
  {
    const float health = player.pev.health;
    if( health > 0.0f && health < 1.0f )
      return 1;
    return Math.clamp( 0, MAX_FRAME, int( health ) );
  }

  Look@ HealthLook( int health, float elapsed )
  {
    if( health <= HEALTH_CRITICAL )
      return Steady( WithAlpha( LOW_RED, FULL_ALPHA ) );
    RGBA colour = HUD_ORANGE;
    if( health <= HEALTH_LOW )
      colour = LOW_RED;
    return Fading( WithAlpha( colour, STATUS_FADE_ALPHA ), WithAlpha( colour, MIN_ALPHA ), FADE_TIME, elapsed );
  }
}
