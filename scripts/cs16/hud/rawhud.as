// Raw senders for the Sven custom HUD messages. They write the client channel (0-31) and the engine text slot (0-7)
// themselves instead of the group and slot that the stock API derives from the module type, so one plugin can use
// both channel groups and all eight text slots. Byte layouts: sven-client-hud.md 1.2 (CustSpr, ToggleElem) and
// sven-client-hudtext.md 1.1 (TE_TEXTMESSAGE). Like the stock API, every message is reliable and goes to one player.
namespace CS16HUD
{
  const uint MAX_PLAYERS = 32;

  // The stock CustSpr writer clamps these, and the client relies on it (sven-client-hud.md 1.2).
  const int MAX_SPRITE_SIZE = 512;
  const float MIN_HOLD_TIME = -1.0f; // a negative hold keeps the element until it is replaced

  // TE_TEXTMESSAGE stores positions in 1/8192 steps as signed shorts and times in 1/256 s as unsigned shorts.
  const float TEXT_POSITION_SCALE = 8192.0f;
  const float TEXT_POSITION_MIN = -32768.0f;
  const float TEXT_POSITION_MAX = 32767.0f;
  const float TEXT_TIME_SCALE = 256.0f;
  const float TEXT_TIME_MAX = 65535.0f;
  const int TEXT_SCAN_EFFECT = 2; // the only effect whose message carries fxTime
  // The client copies each text line into a 268-byte stack buffer with no length check (client.so 0xE9F7E: the buffer
  // is at esp+0x40 and the saved registers at esp+0x14C), so a longer line overruns the stack and crashes the client
  // (a single 300-byte line segfaults Sven 5.26; 267 is safe). 267 also keeps the message inside the engine's 512-byte
  // buffer (engine_i686.so MessageEnd), which drops a longer message.
  const uint TEXT_MAX_LENGTH = 267;

  // Per player slot, the client channels and text slots that this plugin drew since the client last cleared its HUD,
  // so that turning the CS HUD off removes exactly those and never an element of a map or of another plugin.
  array<uint> g_SentChannels( MAX_PLAYERS + 1 );
  array<uint> g_SentTextSlots( MAX_PLAYERS + 1 );
  // Per player slot and text slot, the position of the last text. The client removes every other text at the position
  // of a new text (sven-client-hudtext.md 1.4), so the empty text that clears ours must go to the same place.
  array<float> g_SentTextX( ( MAX_PLAYERS + 1 ) * TEXT_SLOTS );
  array<float> g_SentTextY( ( MAX_PLAYERS + 1 ) * TEXT_SLOTS );

  void SendSprite( CBasePlayer@ player, uint clientChannel, const HUDSpriteParams& in params )
  {
    if( !CanSend( player, clientChannel, CLIENT_CHANNELS, "sprite channel" ) )
      return;
    NetworkMessage message( MSG_ONE, NetworkMessages::CustSpr, player.edict() );
    message.WriteByte( clientChannel );
    message.WriteLong( params.flags );
    message.WriteString( params.spritename );
    message.WriteByte( params.left );
    message.WriteByte( params.top );
    message.WriteShort( int16( Math.clamp( 0, MAX_SPRITE_SIZE, params.width ) ) );
    message.WriteShort( int16( Math.clamp( 0, MAX_SPRITE_SIZE, params.height ) ) );
    message.WriteFloat( params.x );
    message.WriteFloat( params.y );
    message.WriteByte( params.color1.r );
    message.WriteByte( params.color1.g );
    message.WriteByte( params.color1.b );
    message.WriteByte( params.color1.a );
    message.WriteByte( params.color2.r );
    message.WriteByte( params.color2.g );
    message.WriteByte( params.color2.b );
    message.WriteByte( params.color2.a );
    message.WriteByte( params.frame );
    message.WriteByte( params.numframes );
    message.WriteFloat( Math.max( 0.0f, params.framerate ) );
    message.WriteFloat( Math.max( 0.0f, params.fadeinTime ) );
    message.WriteFloat( Math.max( 0.0f, params.fadeoutTime ) );
    message.WriteFloat( Math.max( MIN_HOLD_TIME, params.holdTime ) );
    message.WriteFloat( Math.max( 0.0f, params.fxTime ) );
    message.WriteByte( params.effect );
    message.End();
    g_SentChannels[player.entindex()] |= uint( 1 ) << clientChannel;
  }

  // ToggleElem only hides; send the element again to show it (its hold time may have ended meanwhile).
  void HideElement( CBasePlayer@ player, uint clientChannel )
  {
    if( !CanSend( player, clientChannel, CLIENT_CHANNELS, "sprite channel" ) )
      return;
    NetworkMessage message( MSG_ONE, NetworkMessages::ToggleElem, player.edict() );
    message.WriteByte( clientChannel );
    message.WriteByte( 0 ); // not visible
    message.End();
  }

  // params.channel is ignored: engineSlot is the slot. A new text on a slot replaces the old one on that slot.
  void SendText( CBasePlayer@ player, uint engineSlot, const HUDTextParams& in params, const string& in text )
  {
    if( !CanSend( player, engineSlot, TEXT_SLOTS, "text slot" ) )
      return;
    NetworkMessage message( MSG_ONE, NetworkMessages::SVC_TEMPENTITY, player.edict() );
    message.WriteByte( TE_TEXTMESSAGE );
    message.WriteByte( engineSlot );
    message.WriteShort( TextPosition( params.x ) );
    message.WriteShort( TextPosition( params.y ) );
    message.WriteByte( uint8( params.effect ) );
    message.WriteByte( params.r1 );
    message.WriteByte( params.g1 );
    message.WriteByte( params.b1 );
    message.WriteByte( params.a1 );
    message.WriteByte( params.r2 );
    message.WriteByte( params.g2 );
    message.WriteByte( params.b2 );
    message.WriteByte( params.a2 );
    message.WriteShort( TextTime( params.fadeinTime ) );
    message.WriteShort( TextTime( params.fadeoutTime ) );
    message.WriteShort( TextTime( params.holdTime ) );
    if( params.effect == TEXT_SCAN_EFFECT )
      message.WriteShort( TextTime( params.fxTime ) );
    message.WriteString( text.SubString( 0, TEXT_MAX_LENGTH ) );
    message.End();
    g_SentTextSlots[player.entindex()] |= uint( 1 ) << engineSlot;
    g_SentTextX[SentTextIndex( player, engineSlot )] = params.x;
    g_SentTextY[SentTextIndex( player, engineSlot )] = params.y;
  }

  // Hides every channel and empties every text slot that this plugin drew for the player.
  void ClearSent( CBasePlayer@ player )
  {
    const int slot = player.entindex();
    // An empty text with no fades and no hold replaces the old text of its slot and expires at once.
    HUDTextParams empty;
    empty.effect = 0;
    empty.fadeinTime = 0;
    empty.fadeoutTime = 0;
    empty.holdTime = 0;
    for( uint channel = 0; channel < CLIENT_CHANNELS; ++channel )
    {
      if( ( g_SentChannels[slot] & ( uint( 1 ) << channel ) ) != 0 )
        HideElement( player, channel );
    }
    for( uint textSlot = 0; textSlot < TEXT_SLOTS; ++textSlot )
    {
      if( ( g_SentTextSlots[slot] & ( uint( 1 ) << textSlot ) ) == 0 )
        continue;
      empty.x = g_SentTextX[SentTextIndex( player, textSlot )];
      empty.y = g_SentTextY[SentTextIndex( player, textSlot )];
      SendText( player, textSlot, empty, "" );
    }
    ForgetSent( player );
  }

  uint SentTextIndex( CBasePlayer@ player, uint textSlot )
  {
    return uint( player.entindex() ) * TEXT_SLOTS + textSlot;
  }

  // The client deleted its custom elements (new map or new connection), so nothing is left to clear.
  void ForgetSent( CBasePlayer@ player )
  {
    g_SentChannels[player.entindex()] = 0;
    g_SentTextSlots[player.entindex()] = 0;
  }

  // A client channel above 31 makes the Sven client write past its element array (sven-client-hud.md 1.3).
  bool CanSend( CBasePlayer@ player, uint target, uint limit, const string& in kind )
  {
    if( player !is null && target < limit )
      return true;
    g_Game.AlertMessage( at_logged, "[CS16HUD] refused %1 %2 (valid: 0-%3) for %4\n", kind, target, limit - 1,
      player is null ? "no player" : string( player.pev.netname ) );
    return false;
  }

  int16 TextPosition( float fraction )
  {
    return int16( Math.clamp( TEXT_POSITION_MIN, TEXT_POSITION_MAX, fraction * TEXT_POSITION_SCALE ) );
  }

  // Times above 127.99 s wrap to negative shorts; the engine reads the same 16 bits back as unsigned.
  int16 TextTime( float seconds )
  {
    return int16( int( Math.clamp( 0.0f, TEXT_TIME_MAX, seconds * TEXT_TIME_SCALE ) ) );
  }
}
