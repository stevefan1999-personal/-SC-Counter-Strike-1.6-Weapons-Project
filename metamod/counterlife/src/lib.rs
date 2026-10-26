//! Counter-Life metamod plugin for Sven Co-op: it keeps Sven's obituary
//! lines out of the top-left notify area, because Counter-Strike 1.6 shows
//! deaths only in its kill feed (`docs/metamod.md`).
//!
//! Sven sends each obituary as a `TextMsg` to `HUD_PRINTNOTIFY`. The engine
//! sends a message as soon as the game ends it, so the plugin holds every
//! `TextMsg` back: it supersedes `MESSAGE_BEGIN` and each write, and at
//! `MESSAGE_END` it drops an obituary or sends the message again, unchanged,
//! through the engine functions, which skip the hooks of every plugin.

pub mod obituary;

use std::{
    cell::{Cell, RefCell},
    error::Error,
    ffi::{CStr, CString},
    panic::{self, AssertUnwindSafe},
};

use log::LevelFilter;
use metamod_p::{
    sys, Cvar, CvarFlags, Edict, Engine, LoadTime, MessageDestination, MessageType, MessageWriter,
    MetaResult, Plugin, PluginInfo, StaticCvar,
};

/// `HUD_PRINTNOTIFY` of the HLSDK's `dlls/util.h`: the notify area.
const HUD_PRINTNOTIFY: u8 = 1;

/// `1` drops obituaries, `0` lets them through.
static FILTER: StaticCvar = StaticCvar::new(c"cl_obituary_filter", c"1", CvarFlags::EXTDLL);

/// One typed write of a held message, with the value that the game passed.
#[derive(Debug, Clone, PartialEq)]
enum Write {
    Byte(i32),
    Char(i32),
    Short(i32),
    Long(i32),
    Angle(f32),
    Coord(f32),
    String(CString),
    Entity(i32),
}

impl Write {
    /// Writes the value again with the same engine function. A value out of
    /// the range of its type keeps its low bits, which is all that the engine
    /// sends.
    fn replay(&self, writer: &mut MessageWriter<'_>, engine: &'static Engine) {
        match *self {
            Self::Byte(value) => writer.byte(value as u8),
            Self::Char(value) => writer.char(value as i8),
            Self::Short(value) => {
                match i16::try_from(value) {
                    Ok(value) => writer.short(value),
                    Err(_) => writer.unsigned_short(value as u16),
                }
            }
            Self::Long(value) => writer.long(value),
            Self::Angle(degrees) => writer.angle(degrees),
            Self::Coord(value) => writer.coord(value),
            Self::String(ref text) => writer.string(text),
            // Only a live entity has a handle; the engine sends an entity
            // index as a short in any case.
            Self::Entity(index) => {
                match engine.edict(index) {
                    Some(entity) => writer.entity(entity),
                    None => writer.short(index as i16),
                }
            }
        };
    }
}

/// A `TextMsg` that the engine has not seen yet.
struct Held {
    destination: MessageDestination,
    kind:        MessageType,
    writes:      Vec<Write>,
}

impl Held {
    /// The line of a Sven Co-op obituary in the notify area. `DeathNotice`
    /// writes the destination byte and the line, nothing more.
    fn obituary(&self) -> Option<&CStr> {
        match self.writes.as_slice() {
            [Write::Byte(area), Write::String(line)]
                if *area as u8 == HUD_PRINTNOTIFY && obituary::is_obituary(line.to_bytes()) =>
            {
                Some(line)
            }
            _ => None,
        }
    }
}

struct CounterLife {
    engine:   &'static Engine,
    filter:   Cvar,
    /// The `TextMsg` id, once the game has registered it.
    text_msg: Cell<Option<MessageType>>,
    /// The messages between `MESSAGE_BEGIN` and `MESSAGE_END`, innermost
    /// last; `None` for a message that the engine writes as usual.
    open:     RefCell<Vec<Option<Held>>>,
}

#[metamod_p::plugin]
impl Plugin for CounterLife {
    const INFO: PluginInfo = PluginInfo {
        name:       c"Counter-Life",
        version:    c"0.1.0",
        date:       c"2026-10-27",
        author:     c"Counter-Life",
        url:
            c"https://github.com/stevefan1999-personal/-SC-Counter-Strike-1.6-Weapons-Project",
        log_tag:    c"CLIFE",
        loadable:   LoadTime::AnyTime,
        unloadable: LoadTime::AnyPause,
    };

    fn attach(engine: &'static Engine, _now: LoadTime) -> Result<Self, Box<dyn Error>> {
        let filter = FILTER.register(engine)?;
        // Dropped lines go to the developer log, which metamod prints only
        // while `developer` is on.
        log::set_max_level(LevelFilter::Debug);
        Ok(Self {
            engine,
            filter,
            text_msg: Cell::default(),
            open: RefCell::default(),
        })
    }

    fn message_begin(
        &self,
        destination: i32,
        kind: MessageType,
        origin: Option<[f32; 3]>,
        receiver: Option<Edict>,
    ) -> MetaResult<()> {
        let held = self
            .holds(kind)
            .then(|| replayable(destination, origin, receiver))
            .flatten();
        let result = match held {
            Some(_) => MetaResult::Supercede(()),
            None => MetaResult::Ignored,
        };
        self.open.borrow_mut().push(held.map(|destination| {
            Held {
                destination,
                kind,
                writes: Vec::new(),
            }
        }));
        result
    }

    fn message_end(&self) -> MetaResult<()> {
        let Some(Some(held)) = self.open.borrow_mut().pop() else {
            return MetaResult::Ignored;
        };
        // The engine never began a held message, so its MESSAGE_END must not
        // reach the engine, also when the copy cannot be sent.
        if panic::catch_unwind(AssertUnwindSafe(|| self.finish(held))).is_err() {
            log::error!("lost a held TextMsg");
        }
        MetaResult::Supercede(())
    }

    fn write_byte(&self, value: i32) -> MetaResult<()> {
        self.hold(|| Write::Byte(value))
    }

    fn write_char(&self, value: i32) -> MetaResult<()> {
        self.hold(|| Write::Char(value))
    }

    fn write_short(&self, value: i32) -> MetaResult<()> {
        self.hold(|| Write::Short(value))
    }

    fn write_long(&self, value: i32) -> MetaResult<()> {
        self.hold(|| Write::Long(value))
    }

    fn write_angle(&self, value: f32) -> MetaResult<()> {
        self.hold(|| Write::Angle(value))
    }

    fn write_coord(&self, value: f32) -> MetaResult<()> {
        self.hold(|| Write::Coord(value))
    }

    fn write_string(&self, value: &CStr) -> MetaResult<()> {
        self.hold(|| Write::String(value.to_owned()))
    }

    fn write_entity(&self, value: i32) -> MetaResult<()> {
        self.hold(|| Write::Entity(value))
    }
}

impl CounterLife {
    /// Whether to hold a new message of this type. Below an open message
    /// that the engine writes, a new one stays the engine's: holding it
    /// would mean to send its copy while the engine has a message open.
    fn holds(&self, kind: MessageType) -> bool {
        self.filter.value() != 0.0
            && self.text_msg() == Some(kind)
            && self.open.borrow().iter().all(Option::is_some)
    }

    /// The `TextMsg` id. The game registers its messages after metamod
    /// loads the plugin, so the lookup repeats until it succeeds.
    fn text_msg(&self) -> Option<MessageType> {
        self.text_msg.get().or_else(|| {
            let found = self.engine.user_message(c"TextMsg");
            self.text_msg.set(found);
            found
        })
    }

    /// Adds a write to the innermost message if the plugin holds it.
    fn hold(&self, write: impl FnOnce() -> Write) -> MetaResult<()> {
        match self.open.borrow_mut().last_mut() {
            Some(Some(held)) => {
                held.writes.push(write());
                MetaResult::Supercede(())
            }
            _ => MetaResult::Ignored,
        }
    }

    /// Drops an obituary, or sends the held message as the game wrote it.
    fn finish(&self, held: Held) {
        if let Some(line) = held.obituary() {
            log::debug!("dropped obituary {line:?}");
            return;
        }
        let sent = self.engine.message(held.destination, held.kind, |writer| {
            for write in &held.writes {
                write.replay(writer, self.engine);
            }
        });
        if let Err(error) = sent {
            log::error!("lost a TextMsg: {error}");
        }
    }
}

/// The destination of a message, if the safe API can begin it again with
/// the same destination code, origin and receiver.
fn replayable(
    destination: i32,
    origin: Option<[f32; 3]>,
    receiver: Option<Edict>,
) -> Option<MessageDestination> {
    use MessageDestination as To;
    Some(match (u32::try_from(destination).ok()?, origin, receiver) {
        (sys::MSG_BROADCAST, None, None) => To::Broadcast,
        (sys::MSG_ALL, None, None) => To::All,
        (sys::MSG_INIT, None, None) => To::Init,
        (sys::MSG_SPEC, None, None) => To::Spectators,
        (sys::MSG_ONE, None, Some(player)) => To::One(player),
        (sys::MSG_ONE_UNRELIABLE, None, Some(player)) => To::OneUnreliable(player),
        (sys::MSG_PVS, Some(origin), None) => To::Visible(origin),
        (sys::MSG_PVS_R, Some(origin), None) => To::VisibleReliable(origin),
        (sys::MSG_PAS, Some(origin), None) => To::Audible(origin),
        (sys::MSG_PAS_R, Some(origin), None) => To::AudibleReliable(origin),
        _ => return None,
    })
}
