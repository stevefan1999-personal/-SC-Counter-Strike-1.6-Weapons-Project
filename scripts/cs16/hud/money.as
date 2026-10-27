// CS 1.6 money at the bottom right, its change row and its blink (cs16-hud-spec.md 3.5; CS client.so
// CHudAccountBalance::Draw 0x9c920, MsgFunc_Money 0xa3b80, MsgFunc_BlinkAcct 0xa3bf0). The buy menu and the damage
// money report every change through ShowMoney and BlinkMoney. Content sizes and positions are the contract of
// docs/hud-sprites.md.
namespace CS16HUD
{
  const RGBA MONEY_GAIN = RGBA( 0, 255, 0, 255 ); // a gain fades from green to HUD orange
  const RGBA MONEY_LOSS = RGBA( 255, 0, 0, 255 ); // a loss fades from red to HUD orange
  const float MONEY_DELTA_TIME = 2.5f; // the change row fades out in this time
  const int MAX_MONEY = ( MAX_FRAME + 1 ) * HUNDRED - 1; // money_hi.spr holds the hundreds in its 256 frames
  const int MONEY_BLINKS = 2; // a failed purchase blinks twice (RGD dlls/client.h BlinkAccount)
  const float MONEY_BLINK_PHASE = 0.1f; // CS switches the blink every 0.1 s, bright phase first
  const float MONEY_BLINK_TIME = ( 2 * MONEY_BLINKS - 1 ) * MONEY_BLINK_PHASE; // until the end of the last bright phase
  // A normal resend ends the toggle. It must reach the client in the phase after the last bright one, which starts at
  // MONEY_BLINK_TIME. Aim at the middle of that phase; the tick that sends it comes up to TICK_PERIOD late.
  const float MONEY_BLINK_END = MONEY_BLINK_TIME + ( MONEY_BLINK_PHASE - TICK_PERIOD ) / 2;
  const float MONEY_Y = -50; // CS row H - 3 fh with the suit
  const float MONEY_Y_NO_SUIT = -100; // H - 5 fh without the suit
  const float MONEY_DELTA_RISE = -37; // the change row is fh / 2 + fh above the money

  final class MoneyElement : IHudElement
  {
    private Part@ m_high = Part( GENERATED_SPRITE_DIR + "money_hi.spr", 78, 25, -56, MONEY_Y );
    private Part@ m_low = Part( GENERATED_SPRITE_DIR + "two_cells.spr", 40, 25, -16, MONEY_Y );
    private Part@ m_plus = Part( GENERATED_SPRITE_DIR + "money_delta_plus_hi.spr", 77, 25, -56, MONEY_Y );
    private Part@ m_minus = Part( GENERATED_SPRITE_DIR + "money_delta_minus_hi.spr", 73, 25, -56, MONEY_Y );

    // Per player slot, the state of the CS element: the amount, the last change and its time, whether the change row
    // shows (tracked changes only), and the blink.
    private array<int> m_amount = array<int>( MAX_PLAYERS + 1 );
    private array<int> m_delta = array<int>( MAX_PLAYERS + 1 );
    private array<float> m_changed = array<float>( MAX_PLAYERS + 1, SETTLED );
    private array<bool> m_showDelta = array<bool>( MAX_PLAYERS + 1 );
    private array<bool> m_blinking = array<bool>( MAX_PLAYERS + 1 );
    private array<float> m_blinkStart = array<float>( MAX_PLAYERS + 1 );
    // What is on screen: the y of the money row (NO_VALUE: hidden), and whether the state changed since the draw.
    private array<float> m_drawnY = array<float>( MAX_PLAYERS + 1, NO_VALUE );
    private array<bool> m_dirty = array<bool>( MAX_PLAYERS + 1 );

    // tracked: a change in play (a purchase, a reward), which CS shows in the change row. Untracked: the wallet was
    // loaded (connect, map change, spawn). CS resets its money to 0 at each spawn and then receives the amount
    // untracked, so the amount fades in from green without a change row.
    void Show( CBasePlayer@ player, int amount, bool tracked )
    {
      const int slot = player.entindex();
      const int previous = tracked ? m_amount[slot] : 0;
      amount = Math.clamp( 0, MAX_MONEY, amount );
      m_showDelta[slot] = tracked && amount != previous;
      if( amount != previous )
      {
        m_delta[slot] = amount - previous;
        m_changed[slot] = g_Engine.time;
      }
      else if( !tracked )
        m_changed[slot] = SETTLED;
      if( !tracked )
        m_blinking[slot] = false;
      m_amount[slot] = amount;
      m_dirty[slot] = true;
    }

    void Blink( CBasePlayer@ player )
    {
      const int slot = player.entindex();
      m_blinking[slot] = true;
      m_blinkStart[slot] = g_Engine.time;
      m_dirty[slot] = true;
    }

    void OnSpawn( CBasePlayer@ player )
    {
      Show( player, m_amount[player.entindex()], false );
    }

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
      const float now = g_Engine.time;
      // CS hides the money from spectators and moves it up when the player has no suit.
      float y = player.HasSuit() ? MONEY_Y : MONEY_Y_NO_SUIT;
      if( player.GetObserver().IsObserver() )
        y = NO_VALUE;
      // A blink that started on an earlier map has a start in the future (g_Engine.time restarts with each map).
      const float blinkTime = now - m_blinkStart[slot];
      const bool blinkOver = m_blinking[slot] && ( blinkTime >= MONEY_BLINK_END || blinkTime < 0.0f );
      if( blinkOver )
        m_blinking[slot] = false;
      if( y == m_drawnY[slot] && !m_dirty[slot] && !blinkOver && !resend )
        return;
      m_drawnY[slot] = y;
      m_dirty[slot] = false;
      if( y == NO_VALUE )
      {
        HideElement( player, MONEY_HIGH );
        HideElement( player, MONEY_LOW );
        HideDelta( player );
        return;
      }
      const int amount = m_amount[slot];
      const float elapsed = now - m_changed[slot];
      Look@ look = MoneyLook( slot, elapsed );
      // The blink shows HUD orange at full alpha in its bright phases and the money colour between them. The client
      // starts the toggle when the element arrives, so the blink time counts from this send.
      if( m_blinking[slot] )
      {
        @look = Toggling( WithAlpha( HUD_ORANGE, FULL_ALPHA ), ColourNow( look ), 2 * MONEY_BLINK_PHASE );
        m_blinkStart[slot] = now;
      }
      SendPart( player, MONEY_HIGH, m_high.At( y ), amount / HUNDRED, look );
      SendPart( player, MONEY_LOW, m_low.At( y ), LowCellsFrame( amount ), look );
      DrawDelta( player, y + MONEY_DELTA_RISE, elapsed );
    }

    // The change row has the money colour, faded out once more in MONEY_DELTA_TIME. Sven's fade-out multiplies the
    // alpha by the share of time left, as CS's second ScaleColors does, and hides the row at the end.
    private void DrawDelta( CBasePlayer@ player, float y, float elapsed )
    {
      const int slot = player.entindex();
      if( !m_showDelta[slot] || elapsed >= MONEY_DELTA_TIME )
      {
        HideDelta( player );
        return;
      }
      Look@ look = MoneyLook( slot, elapsed );
      // A resend in the middle starts Sven's fade-out again, so it starts from the share that is left.
      const float left = 1.0f - elapsed / MONEY_DELTA_TIME;
      look.colour1.a = uint8( float( look.colour1.a ) * left );
      look.colour2.a = uint8( float( look.colour2.a ) * left );
      look.holdTime = 0.0f;
      look.fadeoutTime = MONEY_DELTA_TIME - elapsed;
      const int delta = m_delta[slot];
      const int change = Math.clamp( 0, MAX_MONEY, delta < 0 ? -delta : delta );
      Part@ sign = m_minus;
      if( delta > 0 )
        @sign = m_plus;
      SendPart( player, MONEY_DELTA_HIGH, sign.At( y ), change / HUNDRED, look );
      SendPart( player, MONEY_DELTA_LOW, m_low.At( y ), LowCellsFrame( change ), look );
    }

    private void HideDelta( CBasePlayer@ player )
    {
      HideElement( player, MONEY_DELTA_HIGH );
      HideElement( player, MONEY_DELTA_LOW );
    }

    private Look@ MoneyLook( int slot, float elapsed )
    {
      RGBA start = MONEY_LOSS;
      if( m_delta[slot] > 0 )
        start = MONEY_GAIN;
      return Fading( WithAlpha( start, STATUS_FADE_ALPHA ), WithAlpha( HUD_ORANGE, MIN_ALPHA ), FADE_TIME, elapsed );
    }
  }

  // The colour that a look shows when it is sent: the start of a ramp, or the steady colour.
  RGBA ColourNow( const Look@ look )
  {
    if( look.effect == HUD_EFFECT_RAMP_DOWN )
      return look.colour2;
    return look.colour1;
  }

  // The last two cells of the "%5i" money field: both digits from 10, else a blank and the digit (docs/hud-sprites.md).
  int LowCellsFrame( int amount )
  {
    return amount >= DECIMAL ? amount % HUNDRED : TWO_CELL_BLANK_TENS + amount;
  }

  MoneyElement@ g_Money; // made in RegisterStatusElements, after every global of the module is set

  // The player's money changed or was loaded (see MoneyElement::Show). Safe before the player is ready: the element
  // draws at its next tick or resend.
  void ShowMoney( CBasePlayer@ player, int amount, bool tracked )
  {
    if( player !is null && g_Money !is null )
      g_Money.Show( player, amount, tracked );
  }

  // A purchase failed for lack of money.
  void BlinkMoney( CBasePlayer@ player )
  {
    if( player !is null && g_Money !is null )
      g_Money.Blink( player );
  }
}
