// Channel map of the CS 1.6 HUD (docs/hud-architecture.md).
// The Sven client keeps 32 custom HUD elements. Client channels 0-15 are the map-script group and 16-31 the plugin
// group; the stock API adds 16 for plugins (sven-client-hud.md 1.3). The raw senders in rawhud.as take these client
// channels directly, so this plugin can also use the map group. Each channel holds one element at a time.
//
// The always-visible CS HUD needs 17 elements (crosshair 4, health, armour base and full part, clip, two reserve
// groups, ammo icon, two money groups, and kill-feed weapon icons), one more than the plugin group holds. Everything
// that is always on screen stays in the plugin group, plus kill-feed rows 1-3; the transient or optional parts go to
// the map group, which the few stock maps with their own HUD (polar_rescue, bm_sts, bridge, snd, th_escape) may share.
namespace CS16HUD
{
  const uint CLIENT_CHANNELS = 32;
  const uint KILLFEED_ROWS = 4;

  // Plugin group, client channels 16-31: drawn on top of the map group and never used by stock maps.
  const uint CROSSHAIR_WEST = 16;
  const uint CROSSHAIR_EAST = 17;
  const uint CROSSHAIR_NORTH = 18;
  const uint CROSSHAIR_SOUTH = 19;
  const uint HEALTH = 20;
  const uint ARMOUR = 21; // armour.spr / armor_helmet.spr: empty icon and digits
  const uint ARMOUR_FULL = 22; // armor_full.spr / armor_helmet_full.spr: the filled part, drawn in the same box
  const uint CLIP = 23;
  const uint RESERVE_HIGH = 24;
  const uint RESERVE_LOW = 25;
  const uint AMMO_ICON = 26;
  const uint MONEY_HIGH = 27;
  const uint MONEY_LOW = 28;
  const uint KILLFEED_ICON_PLUGIN_FIRST = 29; // weapon icon of rows 1-3: 29-31

  // Map group, client channels 0-15: shared with map scripts, so only transient or optional elements go here.
  const uint KILLFEED_ICON_ROW4 = 0; // weapon icon of row 4
  const uint KILLFEED_HEADSHOT_FIRST = 1; // headshot icon of rows 1-4: 1-4
  const uint MONEY_DELTA_HIGH = 5;
  const uint MONEY_DELTA_LOW = 6;
  const uint FLASHLIGHT = 7; // flashlight.spr: casing and beam
  const uint FLASHLIGHT_ENERGY = 8; // flashlight_energy.spr: the energy bar, drawn in the same box
  const uint STATUS_ICON = 9; // CS status icon (the C4 carried by the player)
  const uint RADAR_BACKGROUND = 10;
  const uint RADAR_DOT_FIRST = 11; // 11-15
  const uint RADAR_DOTS = 5;

  // Client channel of a kill-feed row's weapon icon, row 0 = the oldest line on screen.
  uint KillfeedIconChannel( uint row )
  {
    return row < KILLFEED_ROWS - 1 ? KILLFEED_ICON_PLUGIN_FIRST + row : KILLFEED_ICON_ROW4;
  }

  // Engine text slots of TE_TEXTMESSAGE: plugins get 0-3 and map scripts 4-7 (sven-client-hudtext.md 1.2).
  const uint TEXT_SLOTS = 8;
  const uint KILLFEED_VICTIM_SLOT_FIRST = 0; // victim names of rows 1-4: 0-3
  const uint KILLFEED_KILLER_SLOT_FIRST = 4; // killer names of rows 1-4: 4-7

  // Sprite sheets that are safe to address on every client: install-time copies of the CS 1.6 files under a folder
  // that no other pack uses (cstrike-assets.txt). Never draw from sprites/cs16/640hud*.spr: player caches can hold
  // other packs' files at those paths and a client never downloads a path again.
  const string ICON_SHEET_DIR = "cs16/icons/";
}
