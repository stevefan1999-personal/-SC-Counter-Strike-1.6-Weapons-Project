// CS 1.6 ammo counter at the bottom right: clip, bar, reserve and the ammo icon (cs16-hud-spec.md 3.3). Content sizes
// and positions are the contract of docs/hud-sprites.md.
namespace CS16HUD
{
  const uint8 AMMO_FADE_ALPHA = 200; // the ammo fade starts here (cs16-hud-spec.md 1.4)
  // Three digit cells. CS sends the reserve as a byte, but the weapons of this port carry up to 1000 rounds.
  const int MAX_RESERVE = HUNDRED * DECIMAL - 1;
  const int NO_AMMO_TYPE = 0; // Half-Life never gives ammo index 0 to an ammo type, Sven gives -1 for none
  const int AMMO_ICON_SIZE = 24;
  const float CLIPLESS_SHIFT = -2.0f; // CS draws the reserve and the icon 2 px further left without a clip
  // Each shot restarts the CS ammo fade, and sending all four parts for each shot cost a P90 player 60 reliable messages
  // a second. The clip goes out with each shot; the reserve and the icon take the fade of the clip when they are
  // AMMO_PARTS_SYNC behind it, and again AMMO_PARTS_SETTLE after the last shot. So during fire their alpha is at most
  // 10 below the clip's (the fade falls 20 a second), and once the shots stop all parts fade together again.
  const float AMMO_PARTS_SYNC = 0.5f;
  const float AMMO_PARTS_SETTLE = 0.3f;

  // "<left>,<top>,<ammo type>,...": the 24x24 CS ammo icons on 640hud7.spr (cs16-hud-spec.md 3.3) and the ammo types
  // that show them. CS weapons use the AMMO_TYPE of scripts/cs16/**/weapon_*.as; the HE grenade and the C4 are their
  // own ammo. Sven ammo of the same calibre shows the CS icon too, and the medkit shows the CS health cross. Other
  // ammo types (rockets, uranium, bolts, ...) have no CS icon and show only the digits. tests/hud-elements.test.ts
  // checks the CS rows against the weapon lists.
  const array<string> AMMO_ICONS = {
    "0,72,cs16_12gauge,buckshot",
    "24,72,cs16_.50ae",
    "48,72,cs16_9mm,9mm",
    "72,72,cs16_7.62nato,m40a1",
    "96,72,cs16_45acp",
    "120,72,cs16_.357sig,357",
    "0,96,cs16_5.56nato,cs16_5.56ap,556",
    "24,96,cs16_.338lapua",
    "72,96,weapon_hegrenade,Hand Grenade",
    "96,96,weapon_c4",
    "120,96,cs16_5.7mm",
    "48,25,health"
  };

  final class AmmoElement : IHudElement
  {
    private Part@ m_clip = Part( GENERATED_SPRITE_DIR + "clip.spr", 72, 25, -112, -12 );
    private Part@ m_reserveHigh = Part( GENERATED_SPRITE_DIR + "two_cells.spr", 40, 25, -62, -12 );
    private Part@ m_reserveLow = Part( GENERATED_SPRITE_DIR + "reserve_lo.spr", 20, 25, -42, -12 );
    private dictionary m_icons; // ammo type -> icon part, placed for a weapon with a clip

    // Per player slot: the drawn weapon (entity index; NO_VALUE while the counter is hidden), its clip, reserve and the
    // FOV. CS restarts the fade when the weapon, the clip or the FOV changes (CurWeapon) or the player spawns, not for
    // a reserve change (AmmoX).
    private array<int> m_weapon = array<int>( MAX_PLAYERS + 1, NO_VALUE );
    private array<int> m_clipCount = array<int>( MAX_PLAYERS + 1 );
    private array<int> m_reserve = array<int>( MAX_PLAYERS + 1 );
    private array<int> m_fov = array<int>( MAX_PLAYERS + 1 );
    private array<bool> m_spawned = array<bool>( MAX_PLAYERS + 1 );
    private array<float> m_fadeStart = array<float>( MAX_PLAYERS + 1, SETTLED ); // of the clip
    private array<float> m_partsFadeStart = array<float>( MAX_PLAYERS + 1, SETTLED ); // of the reserve and the icon

    AmmoElement()
    {
      const uint firstType = 2;
      for( uint row = 0; row < AMMO_ICONS.length(); ++row )
      {
        const array<string>@ fields = AMMO_ICONS[row].Split( "," );
        Part@ icon = Part( ICON_SHEET_DIR + "640hud7.spr", AMMO_ICON_SIZE, AMMO_ICON_SIZE, -18, -16, AT_PIXELS,
          atoi( fields[0] ), atoi( fields[1] ) );
        for( uint field = firstType; field < fields.length(); ++field )
          m_icons.set( fields[field], @icon );
      }
    }

    void OnSpawn( CBasePlayer@ player )
    {
      m_spawned[player.entindex()] = true;
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
      CBasePlayerWeapon@ weapon = null;
      // CS sends CurWeapon without a weapon at death (ReGameDLL CBasePlayer::Killed): a dead player has no counter.
      if( ShowsStatus( player ) && player.IsAlive() )
        @weapon = cast<CBasePlayerWeapon@>( player.m_hActiveItem.GetEntity() );
      const int ammoType = weapon is null ? NO_AMMO_TYPE : weapon.PrimaryAmmoIndex();
      // CS draws no counter for a weapon without ammo, such as the knife.
      if( ammoType <= NO_AMMO_TYPE )
      {
        if( m_weapon[slot] != NO_VALUE || resend )
          Hide( player );
        m_weapon[slot] = NO_VALUE;
        return;
      }
      const int id = weapon.entindex();
      const int clip = weapon.m_iClip;
      const int reserve = Math.clamp( 0, MAX_RESERVE, player.m_rgAmmo( ammoType ) );
      // CS restarts the fade for a new weapon, clip or FOV and at a spawn (CurWeapon). A new clip (a shot, a reload)
      // sends the clip; the other changes and a resend draw every part.
      const bool changed = m_spawned[slot] || id != m_weapon[slot] || player.m_iFOV != m_fov[slot];
      const bool restart = changed || clip != m_clipCount[slot];
      const bool layout = changed || resend;
      const float now = g_Engine.time;
      // A start of an earlier map lies in the future (g_Engine.time restarts with each map): the parts are not behind.
      const float partsBehind = m_fadeStart[slot] - m_partsFadeStart[slot];
      const bool partsSettle = partsBehind > 0.0f && now - m_fadeStart[slot] >= AMMO_PARTS_SETTLE;
      if( !restart && !layout && reserve == m_reserve[slot] && !partsSettle )
        return;
      if( restart )
        m_fadeStart[slot] = now;
      const bool sendParts = layout || reserve != m_reserve[slot] || partsSettle
        || now - m_partsFadeStart[slot] >= AMMO_PARTS_SYNC || now < m_partsFadeStart[slot];
      m_spawned[slot] = false;
      m_weapon[slot] = id;
      m_clipCount[slot] = clip;
      m_reserve[slot] = reserve;
      m_fov[slot] = player.m_iFOV;

      Look@ look = Fading( WithAlpha( HUD_ORANGE, AMMO_FADE_ALPHA ), WithAlpha( HUD_ORANGE, MIN_ALPHA ), FADE_TIME,
        now - m_fadeStart[slot] );
      const bool clipped = clip >= 0; // grenades and the C4 have no clip
      const float shift = clipped ? 0.0f : CLIPLESS_SHIFT;
      if( restart || layout )
      {
        if( clipped )
          SendPart( player, CLIP, m_clip, clip, look );
        else
          HideElement( player, CLIP );
      }
      if( !sendParts )
        return;
      m_partsFadeStart[slot] = m_fadeStart[slot];
      SendPart( player, RESERVE_HIGH, m_reserveHigh.Moved( shift ), ReserveHighFrame( reserve ), look );
      SendPart( player, RESERVE_LOW, m_reserveLow.Moved( shift ), reserve % DECIMAL, look );
      Part@ icon;
      if( m_icons.get( weapon.pszAmmo1(), @icon ) )
        SendPart( player, AMMO_ICON, icon.Moved( shift ), 0, look );
      else
        HideElement( player, AMMO_ICON );
    }

    private void Hide( CBasePlayer@ player )
    {
      HideElement( player, CLIP );
      HideElement( player, RESERVE_HIGH );
      HideElement( player, RESERVE_LOW );
      HideElement( player, AMMO_ICON );
    }
  }

  // The first two reserve cells of docs/hud-sprites.md: both digits from 100, else a blank and the tens, else blanks.
  int ReserveHighFrame( int reserve )
  {
    if( reserve >= HUNDRED )
      return reserve / DECIMAL;
    if( reserve >= DECIMAL )
      return TWO_CELL_BLANK_TENS + reserve / DECIMAL;
    return TWO_CELL_BLANK;
  }
}
