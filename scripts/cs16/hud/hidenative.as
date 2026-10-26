// Hides the native Sven HUD parts that the CS HUD replaces, through the player's m_iHideHUD bits.
// Never HIDEHUD_WEAPONS or HIDEHUD_WEAPON_SELECT: they also stop weapon switching with the slot keys. Never
// HIDEHUD_ALL or HIDEHUD_CUSTOM_*: they hide the custom elements that draw the CS HUD (sven-client-hud.md 2.3).
namespace CS16HUD
{
  const int NATIVE_HIDE_BITS =
    HIDEHUD_HEALTH | HIDEHUD_SUITPOWER | HIDEHUD_AMMO | HIDEHUD_FLASHLIGHT | HIDEHUD_CROSSHAIR;

  // Per player slot, the bits that this plugin turned on. A map or another plugin can own the other bits, or the same
  // bits before this plugin asserts them, so turning the CS HUD off clears only these.
  array<int> g_OwnedHideBits( MAX_PLAYERS + 1 );

  // Safe to call every tick: bits that are already set stay owned by whoever set them.
  void HideNative( CBasePlayer@ player )
  {
    const int missing = NATIVE_HIDE_BITS & ~player.m_iHideHUD;
    player.m_iHideHUD |= missing;
    g_OwnedHideBits[player.entindex()] |= missing;
  }

  void RestoreNative( CBasePlayer@ player )
  {
    player.m_iHideHUD &= ~g_OwnedHideBits[player.entindex()];
    g_OwnedHideBits[player.entindex()] = 0;
  }

  // A new player object starts without our bits (new connection or new map).
  void ForgetNative( CBasePlayer@ player )
  {
    g_OwnedHideBits[player.entindex()] = 0;
  }
}
