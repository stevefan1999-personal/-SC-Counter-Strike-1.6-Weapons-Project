// Counter-Strike 1.6 kill feed (CHudDeathNotice), drawn for each player by the server: up to four notices under the
// top-right corner, the newest at the bottom, each for 6 s. A notice reads [killer] [weapon] [headshot] [victim] and is
// packed against the right edge with gaps of s(5). Names are HudMessage text and icons are rects of the CS sheets.
// docs/hud.md ("Kill feed") gives the layout, the measurements against CS 1.6 and what Sven cannot match.
#include "hud/hud"
#include "hud/textfont"

namespace CS16KILLFEED
{
  const float NOTICE_TIME = 6.0f; // hud_deathnotice_time

  // CHudDeathNotice metrics in units of a 480-line screen, scaled by s(n) = n * H / 480 (cs16-hud-spec.md 3.9).
  const int SCALE_BASE_HEIGHT = 480;
  const int TOP = 32;
  const int LINE_STEP = 16;
  const int RIGHT_MARGIN = 12;
  const int GAP = 5;

  // Players stand in for the CT team and monsters for the T team (cs16-killfeed-reference.md 5.5). The Sven client draws
  // text one level darker than it gets (255,63,63 shows as 254,62,62), so each channel goes one level above the CS colours
  // 153,204,255 and 255,63,63; a channel at 255 cannot.
  const RGBA PLAYER_COLOUR = RGBA( 154, 205, 255, 255 );
  const RGBA MONSTER_COLOUR = RGBA( 255, 64, 64, 255 );
  // The icons are added to the screen with this tint, as CS SPR_DrawAdditive does.
  const RGBA ICON_COLOUR = RGBA( 255, 80, 0, 255 );
  // x in pixels from the right edge and y as a fraction of the height. On the screen size of the player both are the CS
  // pixel. On another size the icons still end the row at the right edge, as the names do, and the rows scale with H.
  const int ICON_FLAGS = HUD_ELEM_ABSOLUTE_X | HUD_ELEM_NO_BORDER;
  const int16 ICON_HEIGHT = 16;

  // HudMessage text (sven-client-hudtext.md 2, 3): positions are fractions of the screen inside the HUD border, and the
  // face is as tall as 12 * H / 480, at most 128. tools/hudfont.ts holds the same width model and its measurements.
  const int HUD_BORDER = 16; // hud_bordersize default; the server cannot read the player's value
  const int TEXT_SCHEME_TALL = 12;
  const int TEXT_MAX_TALL = 128;
  const float TEXT_STEP = 1.0f / CS16HUD::TEXT_POSITION_SCALE;
  const float HALF = 0.5f;
  const int64 SUBPIXELS = 64; // FreeType 26.6
  const int64 FIXED_ONE = 65536; // FreeType 16.16
  const uint BYTE_MASK = 0xFF; // a char converts to a sign-extended uint
  const int TEXT_EFFECT_FADE = 0; // HudMessage effect 0 only fades, and these texts have no fade times

  const string HUD1 = "640hud1";
  const string HUD2 = "640hud2";
  const string HUD16 = "640hud16";
  const array<string> ICON_SHEETS = { HUD1, HUD2, HUD16 };
  const string HEADSHOT = "headshot";
  const string NO_WEAPON = "world"; // the DeathMsg weapon of a death that nothing inflicted
  // CS strips these from the class that names the weapon; the plugin's other classes get their CS name in CsWeapon.
  const array<string> CLASS_PREFIXES = { "weapon_", "monster_", "func_" };

  final class DeathIcon
  {
    string sprite; // relative to sprites/
    uint8 left;
    uint8 top;
    int16 width;

    DeathIcon( const string& in sheet, uint8 left, uint8 top, int16 width )
    {
      sprite = CS16HUD::IconSheet( sheet );
      this.left = left;
      this.top = top;
      this.width = width;
    }
  }

  final class Notice
  {
    uint serial; // tells each player's rows which notice they show
    // The pair of text slots of the names (victim, killer). It stays with the notice while its row moves up, so a moving
    // name replaces only its own text, and the client removes an expired name by its hold time.
    uint pair;
    string killer; // empty: the world or the victim itself killed, which CS draws without a killer
    RGBA killerColour;
    string victim;
    RGBA victimColour;
    DeathIcon@ icon;
    bool headshot;
    float expireTime;
  }

  // cs16_killfeed_names: which names the feed draws. The engine has 8 text slots, and the kill feed shares them: game_text
  // and map scripts use 4-7, plugins and Sven's target info 0-3 (docs/hud-architecture.md, "Conflicts"). A new name on a
  // slot replaces the text of a map or another plugin there, so by default only the victims show, on slots 0-3.
  enum Names { NO_NAMES = 0, VICTIM_NAMES = 1, ALL_NAMES = 2 }
  CCVar@ g_NamesCvar;

  const uint NO_NOTICE = 0; // a row that is empty on the client; serials start at 1
  array<Notice@> g_Notices; // oldest first, as the rows from the top
  uint g_LastSerial = NO_NOTICE;
  // Per player slot and row, the serial of the notice that the client shows, so that each text goes out once per change.
  array<array<uint>> g_DrawnSerials( CS16HUD::MAX_PLAYERS + 1, array<uint>( CS16HUD::KILLFEED_ROWS, NO_NOTICE ) );
  // A full feed moves every row with each new notice, so a fight with 10 kills a second sent 3.4 KB/s of reliable
  // messages to each player. Changes go out at most this often for each player: a notice that comes within this time
  // of the last change waits, and the rows of all notices that came meanwhile go out together.
  const float REDRAW_INTERVAL = 0.2f;
  array<float> g_LastDrawTime( CS16HUD::MAX_PLAYERS + 1 ); // per player slot

  void PluginInit()
  {
    @g_NamesCvar = CCVar( "cs16_killfeed_names", VICTIM_NAMES, "Kill feed names. 2: killer and victim, as CS 1.6 (all 8 HUD "
      + "text slots, so a kill replaces texts of game_text and map scripts), 1: victims only (text slots 0-3), 0: none",
      ConCommandFlag::AdminOnly, @OnNamesChanged );
    for( uint index = 0; index < ICON_SHEETS.length(); ++index )
      CS16HUD::PrecacheSprite( CS16HUD::IconSheet( ICON_SHEETS[index] ) );
    CS16HUD::Register( KillFeed() );
    g_Hooks.RegisterHook( Hooks::Player::PlayerKilled, @OnPlayerKilled );
    g_Hooks.RegisterHook( Hooks::Monster::MonsterKilled, @OnMonsterKilled );
  }

  // g_Engine.time starts again with each map, so a notice of the last map would outlive its 6 s.
  void MapInit()
  {
    g_Notices.resize( 0 );
  }

  HookReturnCode OnPlayerKilled( CBasePlayer@ victim, CBaseEntity@ attacker, int gib )
  {
    AddNotice( victim, attacker );
    return HOOK_CONTINUE;
  }

  // Sven also calls this for players, and again for a monster that takes damage while it dies. A monster gets a notice
  // once, while its dead flag is still DEAD_NO, and only when a player killed it.
  HookReturnCode OnMonsterKilled( CBaseMonster@ victim, CBaseEntity@ attacker, int gib )
  {
    if( !victim.IsPlayer() && victim.pev.deadflag == DEAD_NO && attacker !is null && attacker.IsPlayer() )
      AddNotice( victim, attacker );
    return HOOK_CONTINUE;
  }

  void AddNotice( CBaseEntity@ victim, CBaseEntity@ attacker )
  {
    Notice notice;
    notice.serial = ++g_LastSerial;
    notice.victim = DisplayName( victim );
    notice.victimColour = TeamColour( victim );
    const bool killedSelf = attacker !is null && attacker.entindex() == victim.entindex();
    // A death from the world or from the victim itself shows the skull and no killer. Only a kill reads the inflictor:
    // a death without damage (the kill command) leaves an old one in the victim.
    string weapon = NO_WEAPON;
    if( attacker !is null && !killedSelf && ( attacker.IsPlayer() || attacker.IsMonster() ) )
    {
      notice.killer = DisplayName( attacker );
      notice.killerColour = TeamColour( attacker );
      weapon = WeaponName( victim, attacker );
      // CS sends the headshot flag of the victim's last hit group (players and monsters both keep one).
      notice.headshot = victim.MyMonsterPointer().m_LastHitGroup == HITGROUP_HEAD;
    }
    @notice.icon = FindIcon( weapon );
    notice.expireTime = g_Engine.time + NOTICE_TIME;
    // A fifth notice pushes the oldest out (death.cpp MsgFunc_DeathMsg) and takes its text slots.
    if( g_Notices.length() == CS16HUD::KILLFEED_ROWS )
      g_Notices.removeAt( 0 );
    notice.pair = FreePair();
    g_Notices.insertLast( notice );
    PrintConsoleLine( notice, weapon, killedSelf );
  }

  // The lowest text slot pair that no notice on screen holds. A new notice always finds one: at most KILLFEED_ROWS - 1
  // notices remain when it comes.
  uint FreePair()
  {
    uint pair = 0;
    while( IsPairUsed( pair ) )
      ++pair;
    return pair;
  }

  bool IsPairUsed( uint pair )
  {
    for( uint index = 0; index < g_Notices.length(); ++index )
    {
      if( g_Notices[index].pair == pair )
        return true;
    }
    return false;
  }

  // Every row goes out again with the new setting, and the rows clear the names that it no longer draws.
  void OnNamesChanged( CCVar@ cvar, const string& in oldValue, float oldNumber )
  {
    for( uint slot = 0; slot < g_DrawnSerials.length(); ++slot )
      ForgetRows( slot );
  }

  // The client shows none of the rows of this player slot, as far as the next Draw knows.
  void ForgetRows( uint slot )
  {
    array<uint>@ drawn = g_DrawnSerials[slot];
    for( uint row = 0; row < drawn.length(); ++row )
      drawn[row] = NO_NOTICE;
  }

  // Players by their name, monsters by Sven's name for them ("Head Crab", or the map's display name).
  string DisplayName( CBaseEntity@ entity )
  {
    if( entity.IsPlayer() )
      return entity.pev.netname;
    CBaseMonster@ monster = entity.MyMonsterPointer();
    if( monster is null || string( monster.m_FormattedName ).IsEmpty() )
      return entity.pev.classname;
    return monster.m_FormattedName;
  }

  RGBA TeamColour( CBaseEntity@ entity )
  {
    if( entity.IsPlayer() )
      return PLAYER_COLOUR;
    return MONSTER_COLOUR;
  }

  // The DeathMsg weapon (ReGameDLL CHalfLifeMultiplay::DeathNotice): a player who is also the inflictor fired the
  // weapon in his hands (the CS bullets are inflicted by the player), else the inflictor's class names it.
  string WeaponName( CBaseEntity@ victim, CBaseEntity@ attacker )
  {
    CBaseEntity@ inflictor = g_EntityFuncs.Instance( victim.pev.dmg_inflictor );
    CBasePlayer@ killer = cast<CBasePlayer@>( attacker );
    if( killer !is null && inflictor !is null && inflictor.entindex() == killer.entindex() )
      @inflictor = killer.m_hActiveItem.GetEntity();
    if( inflictor is null )
      return NO_WEAPON;
    return CsWeapon( inflictor.GetClassname() );
  }

  string CsWeapon( const string& in classname )
  {
    if( classname == "weapon_csdeagle" )
      return "deagle";
    if( classname == "weapon_csglock18" )
      return "glock18";
    if( classname == "weapon_dualelites" )
      return "elite";
    if( classname == "weapon_csm249" )
      return "m249";
    if( classname == "weapon_csknife" )
      return "knife";
    if( classname == CS16GRENADEPROJECTILE::DEFAULT_PROJ_NAME )
      return "grenade";
    for( uint index = 0; index < CLASS_PREFIXES.length(); ++index )
    {
      if( classname.StartsWith( CLASS_PREFIXES[index] ) )
        return classname.SubString( CLASS_PREFIXES[index].Length() );
    }
    return classname;
  }

  // The d_<weapon> rects of the 640 set in cstrike/sprites/hud.txt (cs16-hud-spec.md 3.9). As in CS, a weapon without
  // an icon gets d_skull.
  DeathIcon@ FindIcon( const string& in weapon )
  {
    if( weapon == "knife" ) return DeathIcon( HUD1, 192, 0, 48 );
    if( weapon == "ak47" ) return DeathIcon( HUD1, 192, 80, 48 );
    if( weapon == "awp" ) return DeathIcon( HUD1, 192, 128, 48 );
    if( weapon == "deagle" ) return DeathIcon( HUD1, 224, 16, 32 );
    if( weapon == "flashbang" ) return DeathIcon( HUD1, 192, 192, 48 );
    if( weapon == "g3sg1" ) return DeathIcon( HUD1, 192, 144, 48 );
    if( weapon == "glock18" ) return DeathIcon( HUD1, 192, 16, 32 );
    if( weapon == "grenade" ) return DeathIcon( HUD1, 224, 192, 32 );
    if( weapon == "m249" ) return DeathIcon( HUD1, 192, 160, 48 );
    if( weapon == "m3" ) return DeathIcon( HUD1, 192, 48, 48 );
    if( weapon == "m4a1" ) return DeathIcon( HUD1, 192, 96, 48 );
    if( weapon == "mp5navy" ) return DeathIcon( HUD1, 192, 64, 32 );
    if( weapon == "p228" ) return DeathIcon( HUD1, 224, 32, 32 );
    if( weapon == "p90" ) return DeathIcon( HUD1, 192, 176, 48 );
    if( weapon == "scout" ) return DeathIcon( HUD1, 192, 208, 48 );
    if( weapon == "sg552" ) return DeathIcon( HUD1, 192, 112, 48 );
    if( weapon == "usp" ) return DeathIcon( HUD1, 192, 32, 32 );
    if( weapon == "tmp" ) return DeathIcon( HUD1, 224, 64, 32 );
    if( weapon == "xm1014" ) return DeathIcon( HUD1, 192, 224, 48 );
    if( weapon == "tracktrain" ) return DeathIcon( HUD1, 192, 240, 32 );
    if( weapon == "aug" ) return DeathIcon( HUD1, 148, 240, 44 );
    if( weapon == "mac10" ) return DeathIcon( HUD1, 109, 240, 34 );
    if( weapon == "elite" ) return DeathIcon( HUD1, 52, 240, 57 );
    if( weapon == HEADSHOT ) return DeathIcon( HUD1, 0, 240, 36 );
    if( weapon == "famas" ) return DeathIcon( HUD2, 192, 144, 48 );
    if( weapon == "galil" ) return DeathIcon( HUD2, 192, 160, 48 );
    if( weapon == "fiveseven" ) return DeathIcon( HUD16, 192, 0, 32 );
    if( weapon == "sg550" ) return DeathIcon( HUD16, 192, 48, 48 );
    if( weapon == "ump45" ) return DeathIcon( HUD16, 192, 80, 48 );
    return DeathIcon( HUD1, 224, 240, 32 ); // d_skull
  }

  // death.cpp prints each notice to the console; the server prints the same line to every client.
  void PrintConsoleLine( const Notice@ notice, const string& in weapon, bool killedSelf )
  {
    string line;
    if( notice.killer.IsEmpty() )
      line = notice.victim + ( killedSelf ? " killed self" : " died" );
    else if( notice.headshot )
      line = "*** " + notice.killer + " killed " + notice.victim + " with a headshot from " + weapon + " ***";
    else
      line = notice.killer + " killed " + notice.victim + " with " + weapon;
    g_Game.AlertMessage( at_notice, "[KillFeed] " + line + "\n" );
    g_PlayerFuncs.ClientPrintAll( HUD_PRINTCONSOLE, line + "\n" );
  }

  void ExpireNotices()
  {
    while( !g_Notices.isEmpty() && g_Notices[0].expireTime <= g_Engine.time )
      g_Notices.removeAt( 0 );
  }

  // The rows hold the notices from the top. Each part is sent with the notice's remaining time as its hold time, so
  // the client hides an expired row by itself; when the oldest expires the server moves the others up.
  final class KillFeed : CS16HUD::IHudElement
  {
    void OnSpawn( CBasePlayer@ player ) {}

    void OnDeath( CBasePlayer@ player ) {}

    void OnTick( CBasePlayer@ player, float dt )
    {
      ExpireNotices();
      // A time of an earlier map lies in the future (g_Engine.time starts again with each map): that draw is long ago.
      const float sinceDraw = g_Engine.time - g_LastDrawTime[player.entindex()];
      if( sinceDraw >= 0.0f && sinceDraw < REDRAW_INTERVAL )
        return;
      Draw( player );
    }

    // The client lost its rows (or must draw them for a new screen size): every notice goes out again.
    void OnResend( CBasePlayer@ player )
    {
      ForgetRows( player.entindex() );
      Draw( player );
    }

    void Draw( CBasePlayer@ player )
    {
      array<uint>@ drawn = g_DrawnSerials[player.entindex()];
      for( uint row = 0; row < CS16HUD::KILLFEED_ROWS; ++row )
      {
        const uint serial = row < g_Notices.length() ? g_Notices[row].serial : NO_NOTICE;
        if( drawn[row] == serial )
          continue;
        if( serial == NO_NOTICE )
          ClearRow( player, row );
        else
          DrawRow( player, row, g_Notices[row] );
        drawn[row] = serial;
        g_LastDrawTime[player.entindex()] = g_Engine.time;
      }
    }

    // Right to left from W - s(12): the victim name, s(5), the headshot icon and s(5) if any, the weapon icon, s(5), the
    // killer name. Every part has the row's top. Names that cs16_killfeed_names leaves out leave no gap.
    void DrawRow( CBasePlayer@ player, uint row, Notice@ notice )
    {
      const CS16HUD::ScreenSize screen = CS16HUD::GetScreenSize( player );
      const float hold = notice.expireTime - g_Engine.time;
      const int top = Scaled( TOP, screen ) + int( row ) * Scaled( LINE_STEP, screen );
      const int gap = Scaled( GAP, screen );
      const int names = g_NamesCvar.GetInt();
      const uint victimSlot = CS16HUD::KILLFEED_VICTIM_SLOT_FIRST + notice.pair;
      int left = screen.width - Scaled( RIGHT_MARGIN, screen );
      if( names >= VICTIM_NAMES )
      {
        SendName( player, victimSlot, notice.victim, notice.victimColour, left, top, screen, hold );
        left -= TextWidth( notice.victim, screen.height ) + gap;
      }
      else
        CS16HUD::ClearText( player, victimSlot );
      const uint headshotChannel = CS16HUD::KILLFEED_HEADSHOT_FIRST + row;
      if( notice.headshot )
      {
        DeathIcon@ headshot = FindIcon( HEADSHOT );
        left -= headshot.width;
        SendIcon( player, headshotChannel, headshot, left, top, screen, hold );
        left -= gap;
      }
      else
        CS16HUD::HideElement( player, headshotChannel );
      left -= notice.icon.width;
      SendIcon( player, CS16HUD::KillfeedIconChannel( row ), notice.icon, left, top, screen, hold );
      // The pair may still hold the killer of the notice that a fifth one pushed out, or of the last names setting.
      const uint killerSlot = CS16HUD::KILLFEED_KILLER_SLOT_FIRST + notice.pair;
      if( names >= ALL_NAMES && !notice.killer.IsEmpty() )
        SendName( player, killerSlot, notice.killer, notice.killerColour, left - gap, top, screen, hold );
      else
        CS16HUD::ClearText( player, killerSlot );
    }

    // The names of the notice that left this row moved up with it or end by their hold time, so only the icons go.
    void ClearRow( CBasePlayer@ player, uint row )
    {
      CS16HUD::HideElement( player, CS16HUD::KillfeedIconChannel( row ) );
      CS16HUD::HideElement( player, CS16HUD::KILLFEED_HEADSHOT_FIRST + row );
    }
  }

  int Scaled( int units, const CS16HUD::ScreenSize& in screen )
  {
    return units * screen.height / SCALE_BASE_HEIGHT;
  }

  void SendIcon( CBasePlayer@ player, uint channel, DeathIcon@ icon, int left, int top,
    const CS16HUD::ScreenSize& in screen, float hold )
  {
    HUDSpriteParams params;
    params.flags = ICON_FLAGS;
    params.spritename = icon.sprite;
    params.left = icon.left;
    params.top = icon.top;
    params.width = icon.width;
    params.height = ICON_HEIGHT;
    params.x = left + icon.width - screen.width; // below 0: the right edge of the icon, this far from the screen edge
    params.y = ( top + HALF ) / float( screen.height ); // the middle of the pixel row, so that int(y * H) is top
    params.color1 = ICON_COLOUR;
    params.effect = HUD_EFFECT_NONE;
    params.fadeinTime = 0.0f;
    params.fadeoutTime = 0.0f;
    params.holdTime = hold;
    CS16HUD::SendSprite( player, channel, params );
  }

  // One line of text whose right end is at the pixel column `right` (exclusive) and whose top is at `top`. a1 > 0 draws
  // opaque glyphs, and fades would only darken them (sven-client-hudtext.md 4).
  void SendName( CBasePlayer@ player, uint slot, const string& in name, const RGBA& in colour, int right, int top,
    const CS16HUD::ScreenSize& in screen, float hold )
  {
    HUDTextParams params;
    // A negative x anchors the right end of the line; the step next to 0 puts it on the border, the furthest right.
    params.x = Math.min( TextPosition( right - HUD_BORDER, screen.width ) - 1.0f, -TEXT_STEP );
    params.y = TextPosition( top - HUD_BORDER, screen.height );
    params.effect = TEXT_EFFECT_FADE;
    params.r1 = colour.r;
    params.g1 = colour.g;
    params.b1 = colour.b;
    params.a1 = colour.a;
    params.fadeinTime = 0.0f;
    params.fadeoutTime = 0.0f;
    params.holdTime = hold;
    CS16HUD::SendText( player, slot, params, name );
  }

  // The client puts text at int(fraction * (side - 2 * border) + border). Aim at the middle of the pixel, in the
  // 1/8192 steps of TE_TEXTMESSAGE, so that neither the step nor float rounding moves the text by a pixel.
  float TextPosition( int pixelsInsideBorder, int screenSide )
  {
    const float fraction = ( pixelsInsideBorder + HALF ) / float( screenSide - 2 * HUD_BORDER );
    return Math.Floor( fraction * CS16HUD::TEXT_POSITION_SCALE + HALF ) * TEXT_STEP;
  }

  // The client measures a line as the sum of the glyph widths of its bytes: the hinted advance in whole pixels, at the
  // em size where the face's Windows ascent plus descent fills the tall (FreeType FT_DivFix and FT_MulFix, rounded).
  int TextWidth( const string& in text, int screenHeight )
  {
    int tall = TEXT_SCHEME_TALL * screenHeight / SCALE_BASE_HEIGHT;
    if( tall > TEXT_MAX_TALL )
      tall = TEXT_MAX_TALL;
    const int64 pixelsPerEm = tall * CS16HUD::TEXT_FONT_UNITS_PER_EM / CS16HUD::TEXT_FONT_CELL_UNITS;
    const int64 scale = ( pixelsPerEm * SUBPIXELS * FIXED_ONE + CS16HUD::TEXT_FONT_UNITS_PER_EM / 2 )
      / CS16HUD::TEXT_FONT_UNITS_PER_EM;
    int width = 0;
    for( uint index = 0; index < text.Length(); ++index )
    {
      const int64 advance = CS16HUD::TEXT_GLYPH_ADVANCES[uint( text[index] ) & BYTE_MASK];
      width += int( ( ( advance * scale + FIXED_ONE / 2 ) / FIXED_ONE + SUBPIXELS / 2 ) / SUBPIXELS );
    }
    return width;
  }
}
