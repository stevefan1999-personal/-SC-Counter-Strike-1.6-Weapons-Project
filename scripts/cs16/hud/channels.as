// Channel map of the CS 1.6 HUD (docs/hud-architecture.md).
// The Sven client keeps 32 custom HUD elements. Client channels 0-15 are the map-script group and 16-31 the plugin
// group; the stock API adds 16 for plugins (sven-client-hud.md 1.3). The raw senders in rawhud.as take these client
// channels directly, so this plugin can also use the map group. Each channel holds one element at a time.
namespace CS16HUD
{
  const uint CLIENT_CHANNELS = 32;
  const uint KILLFEED_ROWS = 4;

  // Plugin group, client channels 16-31: drawn on top of the map group and never used by stock maps.
  const uint CROSSHAIR_WEST = 16;
  const uint CROSSHAIR_EAST = 17;
  const uint CROSSHAIR_NORTH = 18;
  const uint CROSSHAIR_SOUTH = 19;
  const uint KILLFEED_ICON_FIRST = 20; // weapon icon of rows 1-4: 20-23
  const uint HEALTH = 24;
  const uint ARMOUR = 25;
  const uint CLIP = 26;
  const uint RESERVE_HIGH = 27;
  const uint RESERVE_LOW = 28;
  const uint AMMO_ICON = 29;
  const uint MONEY_HIGH = 30;
  const uint MONEY_LOW = 31;

  // Map group, client channels 0-15: shared with map scripts, so only optional or secondary elements go here.
  const uint KILLFEED_HEADSHOT_FIRST = 0; // headshot icon of rows 1-4: 0-3
  const uint MONEY_DELTA_HIGH = 4;
  const uint MONEY_DELTA_LOW = 5;
  const uint FLASHLIGHT = 6;
  const uint RADAR_BACKGROUND = 7;
  const uint RADAR_DOT_FIRST = 8; // 8-13
  const uint RADAR_DOTS = 6;
  // Second parts of the two-part status elements of docs/hud-sprites.md: their bright part overlaps the base icon, so
  // it is a sprite of its own. Both parts draw additively, so their order on the client does not matter.
  const uint ARMOUR_FULL = 14;
  const uint FLASHLIGHT_ENERGY = 15;

  // Engine text slots of TE_TEXTMESSAGE: plugins get 0-3 and map scripts 4-7 (sven-client-hudtext.md 1.2).
  const uint TEXT_SLOTS = 8;
  const uint KILLFEED_VICTIM_SLOT_FIRST = 0; // victim names of rows 1-4: 0-3
  const uint KILLFEED_KILLER_SLOT_FIRST = 4; // killer names of rows 1-4: 4-7
}
