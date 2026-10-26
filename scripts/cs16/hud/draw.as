// Drawing shared by the CS 1.6 status elements (health, armour, ammo, money, flashlight, status icon): the CS colours,
// the CS fades as Sven colour effects, and one sprite at its CS position (docs/hud.md, docs/hud-sprites.md).
namespace CS16HUD
{
  // CS colours (cs16-hud-spec.md 1.3). The alpha of an element is the CS alpha: Sven multiplies it into the RGB with
  // the truncation of CS ScaleColors (sven-client-hud.md 1.9), so the raw colours give CS's pixels.
  const RGBA HUD_ORANGE = RGBA( 255, 160, 0, 255 );
  const RGBA LOW_RED = RGBA( 250, 0, 0, 255 ); // low health, flashing status icons
  const RGBA ALERT_RED = RGBA( 255, 16, 16, 255 ); // flashlight with a low battery
  const RGBA STATUS_GREEN = RGBA( 0, 160, 0, 255 ); // the colour that the CS server gives the c4 status icon

  const uint8 MIN_ALPHA = 100; // every CS fade ends here
  const uint8 STATUS_FADE_ALPHA = 228; // health, armour and money start their fade here (cs16-hud-spec.md 1.4)
  const uint8 FULL_ALPHA = 255;
  const float FADE_TIME = 5.0f; // health, armour, ammo and money fade to MIN_ALPHA in 5 s (cs16-hud-spec.md 1.4)
  const float SETTLED = -FADE_TIME; // a fade start that is over at any server time
  const int NO_VALUE = -1; // per player state before the first value, or an element that is not drawn

  // Frames are bytes; the generated sprites hold one frame for each value (docs/hud-sprites.md).
  const int MAX_FRAME = 255;
  const int DECIMAL = 10;
  const int HUNDRED = DECIMAL * DECIMAL;
  // two_cells.spr: frames 0-99 draw both digits, 100-109 a blank tens cell and the digit, 110 nothing.
  const int TWO_CELL_BLANK_TENS = HUNDRED;
  const int TWO_CELL_BLANK = TWO_CELL_BLANK_TENS + DECIMAL;

  // x and y in screen pixels: v >= 0 is the left (top) edge, v < 0 puts the right (bottom) edge -v pixels inside the
  // screen, without the hud_bordersize inset (sven-client-hud.md 1.5).
  const int AT_PIXELS = HUD_ELEM_ABSOLUTE_X | HUD_ELEM_ABSOLUTE_Y | HUD_ELEM_NO_BORDER;
  // x as a screen fraction: armour at W/5, and the flashlight flush with the right edge, which pixels cannot express.
  const int AT_FRACTION_X = HUD_ELEM_ABSOLUTE_Y | HUD_ELEM_NO_BORDER;

  RGBA WithAlpha( const RGBA& in colour, uint8 alpha )
  {
    return RGBA( colour.r, colour.g, colour.b, alpha );
  }

  // The colour of an element in the fields of HUDSpriteParams.
  final class Look
  {
    uint8 effect = HUD_EFFECT_NONE;
    RGBA colour1;
    RGBA colour2;
    float fxTime = 0.0f;
    float fadeoutTime = 0.0f;
    float holdTime = MIN_HOLD_TIME;
    int flags = 0;
  }

  Look@ Steady( const RGBA& in colour )
  {
    Look look;
    look.colour1 = colour;
    return look;
  }

  // A CS fade from `start` to `end` in `duration` seconds that began `elapsed` seconds ago. Sven ramps the raw
  // RGBA from color2 to color1 and then multiplies RGB by A, as CS does (cs16-hud-spec.md 5.4). A resend in the middle
  // starts the ramp at the colour that the fade reached, so the fade goes on instead of starting again.
  Look@ Fading( const RGBA& in start, const RGBA& in end, float duration, float elapsed )
  {
    if( elapsed >= duration )
      return Steady( end );
    Look look;
    look.effect = HUD_EFFECT_RAMP_DOWN;
    look.colour1 = end;
    look.colour2 = Mix( start, end, elapsed / duration );
    look.fxTime = duration - elapsed;
    look.flags = HUD_ELEM_EFFECT_ONCE; // keep the end colour after the ramp
    return look;
  }

  // `first` for half of the period, then `second`, again and again until the element is sent again.
  Look@ Toggling( const RGBA& in first, const RGBA& in second, float period )
  {
    Look look;
    look.effect = HUD_EFFECT_TOGGLE;
    look.colour1 = first;
    look.colour2 = second;
    look.fxTime = period;
    return look;
  }

  RGBA Mix( const RGBA& in from, const RGBA& in to, float fraction )
  {
    return RGBA( MixChannel( from.r, to.r, fraction ), MixChannel( from.g, to.g, fraction ),
      MixChannel( from.b, to.b, fraction ), MixChannel( from.a, to.a, fraction ) );
  }

  uint8 MixChannel( uint8 from, uint8 to, float fraction )
  {
    return uint8( int( float( from ) + ( float( to ) - float( from ) ) * fraction + 0.5f ) );
  }

  // One sprite at its CS position: a generated sprite of docs/hud-sprites.md with its content size, or a rect of a CS
  // sheet. Never a width or height of 0: the client reads 0 as "to the edge of the frame".
  final class Part
  {
    string sprite;
    int width;
    int height;
    float x;
    float y;
    int flags;
    int left;
    int top;

    Part( const string& in sprite, int width, int height, float x, float y, int flags = CS16HUD::AT_PIXELS,
      int left = 0, int top = 0 )
    {
      this.sprite = sprite;
      this.width = width;
      this.height = height;
      this.x = x;
      this.y = y;
      this.flags = flags;
      this.left = left;
      this.top = top;
    }

    // The same part moved by dx pixels.
    Part@ Moved( float dx ) const
    {
      return Part( sprite, width, height, x + dx, y, flags, left, top );
    }

    // The same part at another y.
    Part@ At( float y ) const
    {
      return Part( sprite, width, height, x, y, flags, left, top );
    }
  }

  void SendPart( CBasePlayer@ player, uint channel, const Part@ part, int frame, const Look@ look )
  {
    HUDSpriteParams params;
    params.spritename = part.sprite;
    params.left = uint8( part.left );
    params.top = uint8( part.top );
    params.width = int16( part.width );
    params.height = int16( part.height );
    params.x = part.x;
    params.y = part.y;
    params.flags = part.flags | look.flags;
    params.frame = uint8( Math.clamp( 0, MAX_FRAME, frame ) );
    params.numframes = 1; // a static frame
    params.color1 = look.colour1;
    params.color2 = look.colour2;
    params.effect = look.effect;
    params.fxTime = look.fxTime;
    params.fadeinTime = 0.0f;
    params.fadeoutTime = look.fadeoutTime;
    params.holdTime = look.holdTime;
    SendSprite( player, channel, params );
  }

  // CS draws health, armour, ammo and the flashlight only with the HEV suit and not for a spectator
  // (cs16-hud-spec.md 2.5); the native Sven parts that they replace need the suit too (sven-client-hud.md 2.3).
  bool ShowsStatus( CBasePlayer@ player )
  {
    return player.HasSuit() && !player.GetObserver().IsObserver();
  }

  // When the CS fade of an element started for each player. A new value restarts the fade, as each CS message with a
  // new value does; the first value that the plugin sees does not.
  final class FadeClock
  {
    private array<int> m_value = array<int>( MAX_PLAYERS + 1, NO_VALUE );
    private array<float> m_start = array<float>( MAX_PLAYERS + 1, SETTLED );

    void Track( int slot, int value )
    {
      if( value == m_value[slot] )
        return;
      if( m_value[slot] != NO_VALUE )
        m_start[slot] = g_Engine.time;
      m_value[slot] = value;
    }

    void Restart( int slot )
    {
      m_start[slot] = g_Engine.time;
    }

    float Elapsed( int slot ) const
    {
      return g_Engine.time - m_start[slot];
    }
  }
}
