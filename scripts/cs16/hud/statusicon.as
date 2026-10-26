// CS 1.6 status icon at the left: the c4 of the bomb carrier (cs16-hud-spec.md 3.10; CS client.so
// CHudStatusIcons::Draw 0xc7b00).
namespace CS16HUD
{
  const float STATUS_FLASH_PERIOD = 0.2f; // CS flashes a status icon red every 0.1 s

  // The c4 icon while the player carries the C4, flashing red inside a bomb target, as CS shows it to the bomb carrier.
  // It is the first CS status icon: x crossW / 2, top H / 2 - (32 + 5), drawn centre-relative so it follows H.
  final class StatusIconElement : IHudElement
  {
    private Part@ m_c4 = Part( ICON_SHEET_DIR + "640hud7.spr", 32, 32, 12, -21, AT_PIXELS | HUD_ELEM_SCR_CENTER_Y, 0,
      148 );
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
      const bool inZone = player.GetCustomKeyvalues().GetKeyvalue( CS16_BOMBTARGET::INBOMB_KV ).GetInteger() == 1;
      const int shown = CarriesC4( player ) ? ( inZone ? 1 : 0 ) : NO_VALUE;
      if( shown == m_drawn[slot] && !resend )
        return;
      m_drawn[slot] = shown;
      if( shown == NO_VALUE )
      {
        HideElement( player, STATUS_ICON );
        return;
      }
      const RGBA green = WithAlpha( STATUS_GREEN, FULL_ALPHA );
      Look@ look = Steady( green );
      if( inZone )
        @look = Toggling( green, WithAlpha( LOW_RED, FULL_ALPHA ), STATUS_FLASH_PERIOD );
      SendPart( player, STATUS_ICON, m_c4, 0, look );
    }
  }

  bool CarriesC4( CBasePlayer@ player )
  {
    CBasePlayerItem@ c4 = player.HasNamedPlayerItem( CS16_C4::GetName() );
    const int ammoType = c4 is null ? NO_AMMO_TYPE : c4.PrimaryAmmoIndex();
    return ammoType > NO_AMMO_TYPE && player.m_rgAmmo( ammoType ) > 0;
  }
}
