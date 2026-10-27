// The always-visible CS 1.6 HUD elements (docs/hud.md "Status elements") and the pain arrows of the CS health element:
// their sprites and their registration.
#include "draw"
#include "health"
#include "armour"
#include "ammo"
#include "money"
#include "flashlight"
#include "statusicon"
#include "pain"

namespace CS16HUD
{
  const array<string> STATUS_SPRITES = { "health.spr", "armor.spr", "armor_full.spr", "armor_helmet.spr",
    "armor_helmet_full.spr", "clip.spr", "two_cells.spr", "reserve_lo.spr", "money_hi.spr", "money_delta_plus_hi.spr",
    "money_delta_minus_hi.spr", "flashlight.spr", "flashlight_energy.spr" };

  // Call in PluginInit after PluginInit of the foundation.
  void RegisterStatus()
  {
    for( uint index = 0; index < STATUS_SPRITES.length(); ++index )
      PrecacheSprite( GENERATED_SPRITE_DIR + STATUS_SPRITES[index] );
    PrecacheSprite( ICON_SHEET_DIR + "640hud7.spr" ); // ammo and status icons
    PrecacheSprite( PAIN_SPRITE );
    @g_Money = MoneyElement();
    @g_Pain = PainElement();
    Register( HealthElement() );
    Register( ArmourElement() );
    Register( AmmoElement() );
    Register( g_Money );
    Register( FlashlightElement() );
    Register( StatusIconElement() );
    Register( g_Pain );
    g_Hooks.RegisterHook( Hooks::Player::PlayerTakeDamage, @OnPlayerTakeDamage );
  }
}
