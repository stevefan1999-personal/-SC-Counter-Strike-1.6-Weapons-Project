// CS 1.6 pain arrows around the screen centre (cs16-hud-spec.md 3.14; CS client.so CHudHealth::DrawPain 0xaf6f0 and
// CalcDamageDirection): after a hit, the arrows on the side of the damage light up red and fade within 0.3 s. Sven's own
// arrows go with HIDEHUD_HEALTH, which the CS HUD sets.
namespace CS16HUD
{
  // An install-time copy of Half-Life's valve/sprites/640_pain.spr (cstrike-assets.txt), which CS draws: frames 0-3 are
  // the front, right, rear and left arrow.
  const string PAIN_SPRITE = ICON_SHEET_DIR + "640_pain.spr";
  const uint PAIN_ARROWS = 4;
  const int PAIN_ARROW_LONG = 128;
  const int PAIN_ARROW_SHORT = 48;
  // CS puts the front arrow at H/2 - 3 × 48 and the right one at W/2 + 2 × 48, so the middle of each arrow is 2.5 × 48
  // from the screen centre. The client centres each element (SCR_CENTER), so these offsets hold at every screen size.
  const int PAIN_OFFSET = 3 * PAIN_ARROW_SHORT - PAIN_ARROW_SHORT / 2;
  const int PAIN_FLAGS = HUD_ELEM_ABSOLUTE_X | HUD_ELEM_ABSOLUTE_Y | HUD_ELEM_SCR_CENTER_X | HUD_ELEM_SCR_CENTER_Y
    | HUD_ELEM_NO_BORDER;

  // The strength of an arrow falls 2 a second; the arrow shows while it is above 0.4, at alpha 255 × strength, but not
  // below the alpha of strength 0.5. A hit gives an arrow the cosine between the view and the way to the damage, when it
  // is above 0.3; damage within 50 units lights all four.
  const float PAIN_FALL_PER_SECOND = 2.0f;
  const float PAIN_VISIBLE = 0.4f;
  const float PAIN_DIM = 0.5f;
  const float PAIN_SIDE = 0.3f;
  const float PAIN_NEAR = 50.0f;
  const float PAIN_FULL = 1.0f;
  const float PAIN_RAMP_MARGIN = 0.01f; // the ramp outlasts the hold by this, see DrawArrow

  final class PainElement : IHudElement
  {
    private array<Part@> m_arrows = {
      Part( PAIN_SPRITE, PAIN_ARROW_LONG, PAIN_ARROW_SHORT, 0, -PAIN_OFFSET, PAIN_FLAGS ),
      Part( PAIN_SPRITE, PAIN_ARROW_SHORT, PAIN_ARROW_LONG, PAIN_OFFSET, 0, PAIN_FLAGS ),
      Part( PAIN_SPRITE, PAIN_ARROW_LONG, PAIN_ARROW_SHORT, 0, PAIN_OFFSET, PAIN_FLAGS ),
      Part( PAIN_SPRITE, PAIN_ARROW_SHORT, PAIN_ARROW_LONG, -PAIN_OFFSET, 0, PAIN_FLAGS )
    };
    // Per player slot and arrow: the strength of its last hit and when it came, and the hits since the last tick. A hit
    // waits for the tick, which draws it only if the player lost health or armour: CS shows the arrows only for damage
    // that the server applied (the Damage message of UpdateClientData).
    private array<array<float>> m_strength( MAX_PLAYERS + 1, array<float>( PAIN_ARROWS, 0.0f ) );
    private array<array<float>> m_hitTime( MAX_PLAYERS + 1, array<float>( PAIN_ARROWS, SETTLED ) );
    private array<array<float>> m_pending( MAX_PLAYERS + 1, array<float>( PAIN_ARROWS, 0.0f ) );
    private array<float> m_lastLife( MAX_PLAYERS + 1 ); // health plus armour at the last tick

    // CalcDamageDirection: the arrows that a hit from `from` lights, with their strengths.
    void Hit( CBasePlayer@ player, const Vector& in from )
    {
      array<float>@ pending = m_pending[player.entindex()];
      Vector toDamage = from - player.pev.origin;
      if( toDamage.Length() <= PAIN_NEAR )
      {
        for( uint arrow = 0; arrow < PAIN_ARROWS; ++arrow )
          pending[arrow] = PAIN_FULL;
        return;
      }
      toDamage = toDamage.Normalize();
      g_EngineFuncs.MakeVectors( player.pev.v_angle );
      const float ahead = DotProduct( toDamage, g_Engine.v_forward );
      const float right = DotProduct( toDamage, g_Engine.v_right );
      const array<float> sides = { ahead, right, -ahead, -right }; // front, right, rear, left
      for( uint arrow = 0; arrow < PAIN_ARROWS; ++arrow )
      {
        if( sides[arrow] > PAIN_SIDE )
          pending[arrow] = Math.max( pending[arrow], sides[arrow] );
      }
    }

    void OnSpawn( CBasePlayer@ player )
    {
      const int slot = player.entindex();
      for( uint arrow = 0; arrow < PAIN_ARROWS; ++arrow )
      {
        m_strength[slot][arrow] = 0.0f;
        m_pending[slot][arrow] = 0.0f;
      }
      m_lastLife[slot] = Life( player );
    }

    void OnDeath( CBasePlayer@ player ) {}

    void OnTick( CBasePlayer@ player, float dt )
    {
      const int slot = player.entindex();
      const float life = Life( player );
      const bool hurt = life < m_lastLife[slot];
      m_lastLife[slot] = life;
      array<float>@ pending = m_pending[slot];
      for( uint arrow = 0; arrow < PAIN_ARROWS; ++arrow )
      {
        // As in CS, a hit raises an arrow to its strength and never lowers it.
        if( hurt && pending[arrow] > Strength( slot, arrow ) )
        {
          m_strength[slot][arrow] = pending[arrow];
          m_hitTime[slot][arrow] = g_Engine.time;
          DrawArrow( player, arrow );
        }
        pending[arrow] = 0.0f;
      }
    }

    // An arrow that still shows comes back with the rest of its fade.
    void OnResend( CBasePlayer@ player )
    {
      for( uint arrow = 0; arrow < PAIN_ARROWS; ++arrow )
      {
        if( Strength( player.entindex(), arrow ) > PAIN_VISIBLE )
          DrawArrow( player, arrow );
      }
    }

    // The strength of an arrow now. A hit time of an earlier map lies in the future (g_Engine.time restarts): no arrow.
    private float Strength( int slot, uint arrow )
    {
      const float since = g_Engine.time - m_hitTime[slot][arrow];
      return since < 0.0f ? 0.0f : Math.max( 0.0f, m_strength[slot][arrow] - PAIN_FALL_PER_SECOND * since );
    }

    // The arrow shows until the strength reaches 0.4. CS colours it HUD orange, or low red at 25 health and below
    // (GetPainColor); the red palette of 640_pain.spr makes both red.
    private void DrawArrow( CBasePlayer@ player, uint arrow )
    {
      const float strength = Strength( player.entindex(), arrow );
      const RGBA colour = HealthValue( player ) > HEALTH_LOW ? HUD_ORANGE : LOW_RED;
      const float visible = ( strength - PAIN_VISIBLE ) / PAIN_FALL_PER_SECOND;
      Look@ look = Steady( WithAlpha( colour, AlphaOf( PAIN_DIM ) ) );
      if( strength > PAIN_DIM )
      {
        // A ramp with EFFECT_ONCE stops the client clock at 0.999 of fxTime, also for the hold time, so the ramp must
        // last longer than the arrow shows, or the arrow never goes. It falls at the CS rate the whole time: the alpha
        // is the CS alpha down to the dim alpha, and in the last 0.05 s it falls on below the 127 that CS keeps.
        const float ramp = visible + PAIN_RAMP_MARGIN;
        @look = Fading( WithAlpha( colour, AlphaOf( strength ) ),
          WithAlpha( colour, AlphaOf( strength - PAIN_FALL_PER_SECOND * ramp ) ), ramp, 0.0f );
      }
      look.holdTime = visible;
      SendPart( player, PAIN_ARROW_FIRST + arrow, m_arrows[arrow], arrow, look );
    }
  }

  uint8 AlphaOf( float strength )
  {
    return uint8( int( FULL_ALPHA * strength ) );
  }

  // Health and armour together: a hit that the armour takes in full still lights the arrows, as in CS.
  float Life( CBasePlayer@ player )
  {
    return player.pev.health + player.pev.armorvalue;
  }

  PainElement@ g_Pain; // made in RegisterStatus

  // Sven calls this before the damage lands; the element draws the hit at its next tick if it took health or armour.
  HookReturnCode OnPlayerTakeDamage( DamageInfo@ info )
  {
    CBasePlayer@ player = cast<CBasePlayer@>( info.pVictim );
    if( player is null || g_Pain is null )
      return HOOK_CONTINUE;
    // CS UpdateClientData: the damage comes from the middle of the inflictor, or from the player when there is none,
    // which lights all four arrows.
    CBaseEntity@ inflictor = info.pInflictor;
    g_Pain.Hit( player, inflictor is null ? player.pev.origin : inflictor.Center() );
    return HOOK_CONTINUE;
  }
}
