// The always-visible CS 1.6 HUD elements (docs/hud.md "Status elements"): their sprites and their registration.
#include "draw"
#include "health"
#include "armour"
#include "ammo"

namespace CS16HUD
{
  const array<string> STATUS_SPRITES = { "health.spr", "armor.spr", "armor_full.spr", "armor_helmet.spr",
    "armor_helmet_full.spr", "clip.spr", "two_cells.spr", "reserve_lo.spr" };

  // Call in PluginInit after PluginInit of the foundation.
  void RegisterStatus()
  {
    for( uint index = 0; index < STATUS_SPRITES.length(); ++index )
      PrecacheSprite( GENERATED_SPRITE_DIR + STATUS_SPRITES[index] );
    PrecacheSprite( ICON_SHEET_DIR + "640hud7.spr" ); // ammo icons
    Register( HealthElement() );
    Register( ArmourElement() );
    Register( AmmoElement() );
  }
}
