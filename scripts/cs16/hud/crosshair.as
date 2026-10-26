// CS 1.6 dynamic crosshair (docs/hud.md, docs/research/cs16-hud-spec.md 3.12): four 1 px lines around the screen
// centre. Their gap grows with each shot and with the player's movement, then shrinks back. CS updates it once per
// client frame at its default fps_max 100. The server cannot see client frames, so it replays the CS rules at 100
// steps per second of the player's own command time and sends the lines only when the drawn result changes.
namespace CS16CROSSHAIR
{
  // CS 1.6 weapon ids (RGD dlls/weapontype.h) of this plugin's weapons. Any other weapon is an unknown id.
  enum WeaponId
  {
    UNKNOWN_WEAPON = 0,
    P228 = 1, SCOUT = 3, HEGRENADE = 4, XM1014 = 5, C4 = 6, MAC10 = 7, AUG = 8, ELITE = 10, FIVESEVEN = 11,
    UMP45 = 12, SG550 = 13, GALIL = 14, FAMAS = 15, USP = 16, GLOCK18 = 17, AWP = 18, MP5NAVY = 19, M249 = 20,
    M3 = 21, M4A1 = 22, TMP = 23, G3SG1 = 24, DEAGLE = 26, SG552 = 27, AK47 = 28, KNIFE = 29, P90 = 30
  }

  // Accuracy flags (GetWeaponAccuracyFlags, BIN 0xa1df0).
  const int ACCURACY_JUMP = 1;
  const int ACCURACY_RUN = 2;
  const int ACCURACY_DUCK = 4;
  const int ACCURACY_INACCURATE = 8;
  const int ACCURACY_VERY_INACCURATE = 16;
  const int PISTOL_ACCURACY = ACCURACY_JUMP | ACCURACY_RUN | ACCURACY_DUCK;
  const int RIFLE_ACCURACY = ACCURACY_JUMP | ACCURACY_RUN;

  // Minimum gap factors of each pose and weapon state (cs16-hud-spec.md 3.12.3).
  const double JUMP_SCALE = 2.0;
  const double DUCK_SCALE = 0.5;
  const double RUN_SCALE = 1.5;
  const double INACCURATE_SCALE = 1.4;

  // Per-frame rules (cs16-hud-spec.md 3.12.4, BIN 0xa1f80-0xa2024).
  const float STEPS_PER_SECOND = 100.0f; // one step per CS frame at fps_max 100
  const float MAX_DISTANCE = 15.0f;
  const double DECAY_RATE = 0.013;
  const double DECAY_OFFSET = 0.1;
  const int ALPHA_START = 200;
  const int ALPHA_RECOVERY = 2;
  const int ALPHA_SHOT_LOSS = 40;
  const int ALPHA_MIN = 120;
  const int ALPHA_MAX = 255;
  const double LENGTH_SCALE = 0.5;
  const int LENGTH_BASE = 5;
  // Any state is at rest after 80 steps (alpha 120 to 255 in 68, the widest gap 22 to the narrowest 3 in 79), so a
  // longer pause replays one second only.
  const int MAX_STEPS = int( STEPS_PER_SECOND );

  // cl_crosshair_size "auto", the CS default (cs16-hud-spec.md 3.12.5): the lines scale by W / base.
  const int SMALL_SCREEN_MAX_WIDTH = 640;
  const int LARGE_SCREEN_MIN_WIDTH = 1024;
  const int SMALL_SCREEN_BASE = 1024;
  const int MEDIUM_SCREEN_BASE = 800;
  const int LARGE_SCREEN_BASE = 640;

  // Drawing (cs16-hud-spec.md 3.12.6): additive lines in the cl_crosshair_color default, placed from the screen centre.
  const string FILL_SPRITE = CS16HUD::GENERATED_SPRITE_DIR + "fill.spr";
  const int FILL_SIZE = 64; // fill.spr is one white 64x64 frame (docs/hud-sprites.md)
  const int LINE_WIDTH = 1;
  const uint8 LINE_RED = 50;
  const uint8 LINE_GREEN = 250;
  const uint8 LINE_BLUE = 50;
  const float ALPHA_RECOVERY_PER_SECOND = ALPHA_RECOVERY * STEPS_PER_SECOND;
  const int LINE_FLAGS = HUD_ELEM_SCR_CENTER_X | HUD_ELEM_SCR_CENTER_Y | HUD_ELEM_ABSOLUTE_X | HUD_ELEM_ABSOLUTE_Y
    | HUD_ELEM_NO_BORDER;
  const array<uint> LINE_CHANNELS = {
    CS16HUD::CROSSHAIR_WEST, CS16HUD::CROSSHAIR_EAST, CS16HUD::CROSSHAIR_NORTH, CS16HUD::CROSSHAIR_SOUTH
  };
  // Every update is four reliable CustSpr messages, so the four lines move at most 10 times per second.
  const float MIN_SEND_INTERVAL = 0.1f;

  // When CS draws it (cs16-hud-spec.md 3.12.1). FOV 0 is the client's default FOV; the AUG and SG552 zoom to 55.
  const int MAX_SCOPED_FOV = 54;
  const int HIDING_BITS = HIDEHUD_WEAPONS | HIDEHUD_ALL;

  // Bytes in the reliable stream, for the developer 2 log: the user message id, the size byte of a variable-size
  // message and the CustSpr fields except the name (sven-client-hud.md 1.2), then the name and its terminator.
  const uint CUSTSPR_FIXED_BYTES = 52;
  const uint LINE_BYTES = CUSTSPR_FIXED_BYTES + FILL_SPRITE.Length() + 1;
  const uint HIDE_BYTES = 3; // ToggleElem: id, channel, visible

  // One row of cs16-hud-spec.md 3.12.3.
  final class WeaponRules
  {
    WeaponId id;
    int baseGap; // CSWTCH.196
    int shotDelta; // CSWTCH.197
    int accuracy; // with the silencer off and no burst fire
    int runLimit; // CSWTCH.178: the speed above which ACCURACY_RUN widens the gap

    WeaponRules( WeaponId id, int baseGap, int shotDelta, int accuracy, int runLimit )
    {
      this.id = id;
      this.baseGap = baseGap;
      this.shotDelta = shotDelta;
      this.accuracy = accuracy;
      this.runLimit = runLimit;
    }
  }

  // CS gives unknown ids base 4, delta 3 and no accuracy flags.
  const WeaponRules UNKNOWN_RULES( UNKNOWN_WEAPON, 4, 3, 0, 0 );
  dictionary g_Rules; // weapon classname -> WeaponRules@

  void AddRules( const string& in classname, WeaponId id, int baseGap, int shotDelta, int accuracy, int runLimit )
  {
    WeaponRules rules( id, baseGap, shotDelta, accuracy, runLimit );
    g_Rules.set( classname, @rules );
  }

  void AddAllRules()
  {
    AddRules( "weapon_p228", P228, 8, 3, PISTOL_ACCURACY, 0 );
    AddRules( "weapon_scout", SCOUT, 5, 3, 0, 0 );
    AddRules( "weapon_hegrenade", HEGRENADE, 8, 3, 0, 0 );
    AddRules( "weapon_xm1014", XM1014, 9, 4, 0, 0 );
    AddRules( "weapon_c4", C4, 6, 3, 0, 0 );
    AddRules( "weapon_mac10", MAC10, 9, 3, ACCURACY_JUMP, 0 );
    AddRules( "weapon_aug", AUG, 3, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_dualelites", ELITE, 4, 3, 0, 0 );
    AddRules( "weapon_fiveseven", FIVESEVEN, 8, 3, PISTOL_ACCURACY, 0 );
    AddRules( "weapon_ump45", UMP45, 6, 3, ACCURACY_JUMP, 0 );
    AddRules( "weapon_sg550", SG550, 5, 3, 0, 0 );
    AddRules( "weapon_galil", GALIL, 4, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_famas", FAMAS, 4, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_usp", USP, 8, 3, PISTOL_ACCURACY, 0 );
    AddRules( "weapon_csglock18", GLOCK18, 8, 3, PISTOL_ACCURACY, 0 );
    AddRules( "weapon_awp", AWP, 8, 3, 0, 0 );
    AddRules( "weapon_mp5navy", MP5NAVY, 6, 2, ACCURACY_JUMP, 0 );
    AddRules( "weapon_csm249", M249, 6, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_m3", M3, 8, 6, 0, 0 );
    AddRules( "weapon_m4a1", M4A1, 4, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_tmp", TMP, 7, 3, ACCURACY_JUMP, 0 );
    AddRules( "weapon_g3sg1", G3SG1, 6, 4, 0, 0 );
    AddRules( "weapon_csdeagle", DEAGLE, 8, 3, PISTOL_ACCURACY, 0 );
    AddRules( "weapon_sg552", SG552, 5, 3, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_ak47", AK47, 4, 4, RIFLE_ACCURACY, 140 );
    AddRules( "weapon_csknife", KNIFE, 7, 3, 0, 0 );
    AddRules( "weapon_p90", P90, 7, 3, RIFLE_ACCURACY, 170 );
  }

  const WeaponRules@ RulesOf( CBaseEntity@ weapon )
  {
    WeaponRules@ rules;
    if( weapon is null || !g_Rules.get( weapon.GetClassname(), @rules ) )
      return UNKNOWN_RULES;
    return rules;
  }

  // CS draws no dynamic crosshair for the four sniper rifles (BIN bit mask 0x1042008).
  bool IsSniperRifle( WeaponId id )
  {
    return id == SCOUT || id == SG550 || id == AWP || id == G3SG1;
  }

  // The flags of the row, plus the state flag of the USP, M4A1 (silencer) and Glock 18, FAMAS (burst fire).
  int AccuracyFlags( CBaseEntity@ weapon, const WeaponRules@ rules )
  {
    CS16BASE::IWeaponState@ state = null;
    switch( rules.id )
    {
      case USP:
      case M4A1:
        @state = cast<CS16BASE::IWeaponState@>( g_EntityFuncs.CastToScriptClass( weapon ) );
        return state !is null && state.IsSilenced() ? rules.accuracy | ACCURACY_INACCURATE : rules.accuracy;
      case GLOCK18:
      case FAMAS:
        @state = cast<CS16BASE::IWeaponState@>( g_EntityFuncs.CastToScriptClass( weapon ) );
        return state !is null && state.IsBurstFire() ? rules.accuracy | ACCURACY_VERY_INACCURATE : rules.accuracy;
    }
    return rules.accuracy;
  }

  // Minimum gap g for this frame (cs16-hud-spec.md 3.12.3). The run test uses the truncated 3-D speed, strictly.
  int MinimumGap( CBasePlayer@ player, const WeaponRules@ rules, int accuracy )
  {
    int gap = rules.baseGap;
    if( accuracy == 0 )
      return gap;
    const int flags = player.pev.flags;
    if( ( flags & FL_ONGROUND ) == 0 && ( accuracy & ACCURACY_JUMP ) != 0 )
      gap = int( gap * JUMP_SCALE );
    else if( ( flags & FL_DUCKING ) != 0 && ( accuracy & ACCURACY_DUCK ) != 0 )
      gap = int( gap * DUCK_SCALE );
    else if( int( player.pev.velocity.Length() ) > rules.runLimit && ( accuracy & ACCURACY_RUN ) != 0 )
      gap = int( gap * RUN_SCALE );
    if( ( accuracy & ACCURACY_INACCURATE ) != 0 )
      gap = int( gap * INACCURATE_SCALE );
    if( ( accuracy & ACCURACY_VERY_INACCURATE ) != 0 )
      gap = int( gap * INACCURATE_SCALE );
    return gap;
  }

  int AutoScaleBase( int screenWidth )
  {
    if( screenWidth <= SMALL_SCREEN_MAX_WIDTH )
      return SMALL_SCREEN_BASE;
    return screenWidth < LARGE_SCREEN_MIN_WIDTH ? MEDIUM_SCREEN_BASE : LARGE_SCREEN_BASE;
  }

  // One player's CS state (m_flCrosshairDistance, m_iAlpha, m_iAmmoLastCheck) and the lines that the client shows.
  final class PlayerCrosshair
  {
    float distance = 0.0f;
    int alpha = ALPHA_START;
    int lastShotCount = 0;
    float unsimulatedTime = 0.0f;
    bool clientKnown = false; // false: the client may have lost the lines, so the next draw sends all four
    bool shown = false;
    int shownGap = 0;
    int shownLength = 0;
    int shownAlpha = 0;
    bool shotSinceSend = false;
    float lastSendTime = 0.0f;

    // Replays the CS frames that fit in the time since the last call. A shot is seen at the first frame after it.
    void Simulate( float dt, int gap, int shotDelta, int shotCount )
    {
      unsimulatedTime += dt;
      const int steps = int( unsimulatedTime * STEPS_PER_SECOND );
      if( steps <= 0 )
        return;
      unsimulatedTime -= steps / STEPS_PER_SECOND;
      for( int step = 0; step < steps && step < MAX_STEPS; ++step )
        Step( gap, shotDelta, shotCount );
    }

    void Step( int gap, int shotDelta, int shotCount )
    {
      if( lastShotCount >= shotCount )
      {
        distance = float( distance - ( distance * DECAY_RATE + DECAY_OFFSET ) );
        alpha += ALPHA_RECOVERY;
      }
      else
      {
        distance = Math.min( distance + shotDelta, MAX_DISTANCE );
        alpha = Math.max( alpha - ALPHA_SHOT_LOSS, ALPHA_MIN );
        shotSinceSend = true;
      }
      lastShotCount = shotCount;
      distance = Math.max( distance, float( gap ) );
      alpha = Math.min( alpha, ALPHA_MAX );
    }
  }

  final class Crosshair : CS16HUD::IHudElement
  {
    private array<PlayerCrosshair@> m_players;

    Crosshair()
    {
      for( uint slot = 0; slot <= CS16HUD::MAX_PLAYERS; ++slot )
        m_players.insertLast( PlayerCrosshair() );
    }

    // CS keeps the crosshair state over respawns; OnTick shows the lines again once the player is alive.
    void OnSpawn( CBasePlayer@ player )
    {
    }

    void OnDeath( CBasePlayer@ player )
    {
      Hide( player, m_players[player.entindex()] );
    }

    void OnResend( CBasePlayer@ player )
    {
      PlayerCrosshair@ state = m_players[player.entindex()];
      state.clientKnown = false;
      // After a new connection in this slot, the shots of the previous player must not widen the crosshair.
      state.lastShotCount = CS16BASE::g_PlayerShotsFired[player.entindex()];
    }

    void OnTick( CBasePlayer@ player, float dt )
    {
      PlayerCrosshair@ state = m_players[player.entindex()];
      CBaseEntity@ weapon = player.m_hActiveItem.GetEntity();
      const WeaponRules@ rules = RulesOf( weapon );
      const int fov = player.m_iFOV;
      if( weapon is null || !player.IsAlive() || IsSniperRifle( rules.id ) || ( fov != 0 && fov <= MAX_SCOPED_FOV )
        || ( player.m_iHideHUD & HIDING_BITS ) != 0 )
      {
        Hide( player, state );
        return;
      }
      const int gap = MinimumGap( player, rules, AccuracyFlags( weapon, rules ) );
      state.Simulate( dt, gap, rules.shotDelta, CS16BASE::g_PlayerShotsFired[player.entindex()] );
      Draw( player, state, gap );
    }

    // Sends the lines when the scaled gap or length changed, after a shot (the alpha fell), or when the alpha is back
    // at 255 (see SendLine).
    private void Draw( CBasePlayer@ player, PlayerCrosshair@ state, int gap )
    {
      const CS16HUD::ScreenSize screen = CS16HUD::GetScreenSize( player );
      // A frame without a step (a client faster than 100 fps) may bring a new gap; CS applies it in its next frame.
      const float distance = Math.max( state.distance, float( gap ) );
      const int length = int( ( distance - gap ) * LENGTH_SCALE ) + LENGTH_BASE;
      const int base = AutoScaleBase( screen.width );
      const bool scaled = screen.width != base;
      const int lineGap = scaled ? int( double( distance ) * screen.width / base ) : int( distance );
      // shortcut: fill.spr is 64 px, so a longer line (full spread on a screen wider than 3723 px) loses its outer end;
      // ship a wider fill sprite under a new path if such screens matter.
      const int lineLength = Math.min( scaled ? screen.width * length / base : length, FILL_SIZE );
      const bool changed = !state.clientKnown || !state.shown || lineGap != state.shownGap
        || lineLength != state.shownLength || state.shotSinceSend
        || ( state.alpha == ALPHA_MAX && state.shownAlpha != ALPHA_MAX );
      // A crosshair that appears goes out at once; changes of a shown one wait for the send interval.
      if( !changed || ( state.clientKnown && state.shown && g_Engine.time - state.lastSendTime < MIN_SEND_INTERVAL ) )
        return;
      const int centreX = screen.width / 2;
      const int centreY = screen.height / 2;
      const int outerOffset = lineGap + lineLength - 1;
      SendLine( player, screen, CS16HUD::CROSSHAIR_WEST, centreX - outerOffset, centreY, lineLength, LINE_WIDTH,
        state.alpha );
      SendLine( player, screen, CS16HUD::CROSSHAIR_EAST, centreX + lineGap, centreY, lineLength, LINE_WIDTH,
        state.alpha );
      SendLine( player, screen, CS16HUD::CROSSHAIR_NORTH, centreX, centreY - outerOffset, LINE_WIDTH, lineLength,
        state.alpha );
      SendLine( player, screen, CS16HUD::CROSSHAIR_SOUTH, centreX, centreY + lineGap, LINE_WIDTH, lineLength,
        state.alpha );
      state.clientKnown = true;
      state.shown = true;
      state.shownGap = lineGap;
      state.shownLength = lineLength;
      state.shownAlpha = state.alpha;
      state.shotSinceSend = false;
      state.lastSendTime = g_Engine.time;
      g_Game.AlertMessage( at_aiconsole, "[CS16HUD] crosshair %1: gap %2 length %3 alpha %4 shots %5, %6 bytes at %7\n",
        player.entindex(), lineGap, lineLength, state.alpha, state.lastShotCount, LINE_CHANNELS.length() * LINE_BYTES,
        g_Engine.time );
    }

    // One line as a box of fill.spr with its top-left corner at (left, top) in screen pixels.
    private void SendLine( CBasePlayer@ player, const CS16HUD::ScreenSize& in screen, uint channel, int left, int top,
      int width, int height, int alpha )
    {
      HUDSpriteParams params; // the defaults keep it: hold -1 (forever), frame 0 of 1
      params.flags = LINE_FLAGS;
      params.spritename = FILL_SPRITE;
      params.width = width;
      params.height = height;
      // With SCR_CENTER and ABSOLUTE the client puts the left edge at x + ((W - width) >> 1) and ignores the border
      // (sven-client-hud.md 1.5, client.so 0xDB45D), so x is the box corner minus that centring.
      params.x = left - ( ( screen.width - width ) >> 1 );
      params.y = top - ( ( screen.height - height ) >> 1 );
      params.color1 = RGBA( LINE_RED, LINE_GREEN, LINE_BLUE, ALPHA_MAX );
      if( alpha < ALPHA_MAX )
      {
        // The client raises the alpha as the CS frames do: a linear ramp from color2 to color1, then RGB times alpha,
        // as CS FillRGBA (sven-client-hud.md 1.9). So a recovering crosshair needs no message for each step. The ramp
        // holds just short of color1 (client.so 0xDB640 truncates alpha 254.9 to 254), so Draw sends the lines again
        // once the alpha is back at 255.
        params.flags |= HUD_ELEM_EFFECT_ONCE;
        params.effect = HUD_EFFECT_RAMP_DOWN;
        params.color2 = RGBA( LINE_RED, LINE_GREEN, LINE_BLUE, alpha );
        params.fxTime = ( ALPHA_MAX - alpha ) / ALPHA_RECOVERY_PER_SECOND;
      }
      CS16HUD::SendSprite( player, channel, params );
    }

    // CS does not update a crosshair that it does not draw, so the hidden time is never replayed.
    private void Hide( CBasePlayer@ player, PlayerCrosshair@ state )
    {
      state.unsimulatedTime = 0.0f;
      if( state.clientKnown && !state.shown )
        return;
      for( uint line = 0; line < LINE_CHANNELS.length(); ++line )
        CS16HUD::HideElement( player, LINE_CHANNELS[line] );
      state.clientKnown = true;
      state.shown = false;
      g_Game.AlertMessage( at_aiconsole, "[CS16HUD] crosshair %1: hidden, %2 bytes at %3\n", player.entindex(),
        LINE_CHANNELS.length() * HIDE_BYTES, g_Engine.time );
    }
  }

  void Register()
  {
    AddAllRules();
    CS16HUD::PrecacheSprite( FILL_SPRITE );
    CS16HUD::Register( Crosshair(), true );
  }
}
