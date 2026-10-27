//! A fake engine and metamod, after the fake host of metamod-p-rs. The
//! plugin is loaded through its C entry points; the game's message calls go
//! through the plugin's hooks as metamod sends them, and the fake engine
//! records what reaches it.

use std::{
    cell::{Cell, RefCell},
    ffi::{c_char, c_int, CStr, CString},
    mem, ptr,
};

use metamod_p::sys::{
    cvar_t, edict_t, enginefuncs_t, gamedll_funcs_t, globalvars_t, meta_globals_t, mutil_funcs_t,
    plid_t, plugin_info_t, DLL_FUNCTIONS, ENGINE_INTERFACE_VERSION, FL_CLIENT, META_FUNCTIONS,
    META_RES, NEW_DLL_FUNCTIONS, PLUG_LOADTIME,
};

pub const MAX_CLIENTS: c_int = 4;
pub const EDICT_COUNT: usize = 16;
pub const PLAYER: c_int = 1;
pub const FREE_SLOT: c_int = 5;
/// Message ids that the fake game registers. They are not Sven's, so a
/// plugin that does not look `TextMsg` up fails the tests.
pub const TEXT_MSG: c_int = 91;
pub const SAY_TEXT: c_int = 76;

/// One call of the game, or one call that reached the engine.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Begin {
        destination: c_int,
        kind:        c_int,
        origin:      Option<[f32; 3]>,
        receiver:    Option<c_int>,
    },
    Byte(c_int),
    Char(c_int),
    Short(c_int),
    Long(c_int),
    Angle(f32),
    Coord(f32),
    String(CString),
    Entity(c_int),
    End,
    /// A call that makes the engine stop the server with this `Sys_Error`.
    Fatal(&'static str),
}

thread_local! {
    static CALLS: RefCell<Vec<Call>> = RefCell::default();
    static LOGS: RefCell<Vec<(&'static str, String)>> = RefCell::default();
    static WRITING: Cell<bool> = const { Cell::new(false) };
    static EDICTS: Cell<*mut edict_t> = const { Cell::new(ptr::null_mut()) };
    static CVARS: RefCell<Vec<*mut cvar_t>> = RefCell::default();
    static REGISTERED: Cell<bool> = const { Cell::new(true) };
}

/// Every call that reached the engine.
pub fn engine_calls() -> Vec<Call> {
    CALLS.with_borrow(Clone::clone)
}

/// The plugin's log lines, by metamod log function.
pub fn logs() -> Vec<(&'static str, String)> {
    LOGS.with_borrow(Clone::clone)
}

/// Whether the game has registered its user messages yet.
pub fn set_registered(registered: bool) {
    REGISTERED.set(registered);
}

/// Sets a registered cvar as the `set` console command does.
pub fn set_cvar(name: &str, value: f32) {
    let cvar = find_cvar(name);
    assert!(!cvar.is_null(), "cvar {name} is registered");
    // SAFETY: registered cvars are leaked copies.
    unsafe {
        (*cvar).value = value;
        (*cvar).string = leak(&value.to_string());
    }
}

/// What the engine sends for these calls: each message header, then the
/// bytes of each write as GoldSrc's `MSG_Write*` functions keep them (low
/// 8 bits of a byte or char, low 16 bits of a short or entity). Angles and
/// coordinates keep their full `f32`, which is stricter than the engine.
pub fn wire(calls: &[Call]) -> Vec<u8> {
    calls
        .iter()
        .flat_map(|call| {
            match call {
                Call::Begin {
                    destination,
                    kind,
                    origin,
                    receiver,
                } => format!("<{destination} {kind} {origin:?} {receiver:?}>").into_bytes(),
                Call::Byte(value) | Call::Char(value) => vec![*value as u8],
                Call::Short(value) | Call::Entity(value) => (*value as i16).to_le_bytes().to_vec(),
                Call::Long(value) => value.to_le_bytes().to_vec(),
                Call::Angle(value) | Call::Coord(value) => value.to_le_bytes().to_vec(),
                Call::String(text) => text.as_bytes_with_nul().to_vec(),
                Call::End => b"</>".to_vec(),
                Call::Fatal(error) => format!("!{error}!").into_bytes(),
            }
        })
        .collect()
}

fn record(call: Call) {
    CALLS.with_borrow_mut(|calls| calls.push(call));
}

/// Records a write, or the engine's fatal error for a write outside a
/// message.
fn record_write(call: Call, error: &'static str) {
    record(if WRITING.get() {
        call
    } else {
        Call::Fatal(error)
    });
}

fn text(pointer: *const c_char) -> String {
    if pointer.is_null() {
        return "<null>".into();
    }
    // SAFETY: the plugin passes NUL-terminated strings.
    unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned()
}

fn leak(text: &str) -> *mut c_char {
    CString::new(text).expect("no NUL").into_raw()
}

/// The fake edict at `index`.
pub fn edict(index: c_int) -> *mut edict_t {
    let index = usize::try_from(index).expect("index");
    assert!(index < EDICT_COUNT, "edict index");
    EDICTS.get().wrapping_add(index)
}

fn index_of(edict: *const edict_t) -> c_int {
    let offset = edict as usize - EDICTS.get() as usize;
    c_int::try_from(offset / mem::size_of::<edict_t>()).expect("index")
}

unsafe extern "C" fn message_begin(
    destination: c_int,
    kind: c_int,
    origin: *const f32,
    receiver: *mut edict_t,
) {
    if WRITING.replace(true) {
        record(Call::Fatal(
            "MessageBegin: New message started when msg '%d' has not been sent yet",
        ));
        return;
    }
    // SAFETY: a non-null origin points to three floats.
    let origin = (!origin.is_null()).then(|| unsafe { origin.cast::<[f32; 3]>().read() });
    let receiver = (!receiver.is_null()).then(|| index_of(receiver));
    record(Call::Begin {
        destination,
        kind,
        origin,
        receiver,
    });
}

unsafe extern "C" fn message_end() {
    if !WRITING.replace(false) {
        record(Call::Fatal("MessageEnd: called with no active message"));
        return;
    }
    record(Call::End);
}

unsafe extern "C" fn write_byte(value: c_int) {
    record_write(Call::Byte(value), "WriteByte called with no active message");
}

unsafe extern "C" fn write_char(value: c_int) {
    record_write(Call::Char(value), "WriteChar called with no active message");
}

unsafe extern "C" fn write_short(value: c_int) {
    record_write(
        Call::Short(value),
        "WriteShort called with no active message",
    );
}

unsafe extern "C" fn write_long(value: c_int) {
    record_write(Call::Long(value), "WriteLong called with no active message");
}

unsafe extern "C" fn write_angle(value: f32) {
    record_write(
        Call::Angle(value),
        "WriteAngle called with no active message",
    );
}

unsafe extern "C" fn write_coord(value: f32) {
    record_write(
        Call::Coord(value),
        "WriteCoord called with no active message",
    );
}

unsafe extern "C" fn write_string(value: *const c_char) {
    // SAFETY: the game and the plugin pass NUL-terminated strings.
    let value = unsafe { CStr::from_ptr(value) }.to_owned();
    record_write(
        Call::String(value),
        "WriteString called with no active message",
    );
}

unsafe extern "C" fn write_entity(value: c_int) {
    record_write(
        Call::Entity(value),
        "WriteEntity called with no active message",
    );
}

unsafe extern "C" fn entity_of_index(index: c_int) -> *mut edict_t {
    if (0..EDICT_COUNT as c_int).contains(&index) {
        edict(index)
    } else {
        ptr::null_mut()
    }
}

unsafe extern "C" fn index_of_edict(edict: *const edict_t) -> c_int {
    index_of(edict)
}

/// The byte offset from the start of the current edict array, as the engine
/// computes it.
unsafe extern "C" fn entity_offset(edict: *const edict_t) -> c_int {
    c_int::try_from(edict as isize - EDICTS.get() as isize).unwrap_or(c_int::MIN)
}

fn find_cvar(name: &str) -> *mut cvar_t {
    CVARS
        .with_borrow(|cvars| {
            // SAFETY: registered cvars are leaked copies.
            cvars
                .iter()
                .copied()
                .find(|&cvar| text(unsafe { (*cvar).name }) == name)
        })
        .unwrap_or(ptr::null_mut())
}

/// Registers a copy of the cvar, as metamod does.
unsafe extern "C" fn cvar_register(definition: *mut cvar_t) {
    // SAFETY: the plugin passes its static definition.
    let definition = unsafe { *definition };
    let (name, string) = (text(definition.name), text(definition.string));
    let copy = Box::leak(Box::new(cvar_t {
        name: leak(&name),
        string: leak(&string),
        value: string.parse().unwrap_or_default(),
        ..definition
    }));
    CVARS.with_borrow_mut(|cvars| cvars.push(copy));
}

unsafe extern "C" fn cvar_pointer(name: *const c_char) -> *mut cvar_t {
    find_cvar(&text(name))
}

macro_rules! fake_log {
    ($name:ident, $function:literal) => {
        unsafe extern "C" fn $name(_plugin: plid_t, _format: *const c_char, mut arguments: ...) {
            // SAFETY: the plugin passes one C string after its `%s` format.
            let argument = unsafe { arguments.next_arg::<*const c_char>() };
            LOGS.with_borrow_mut(|logs| logs.push(($function, text(argument))));
        }
    };
}

fake_log!(log_console, "LogConsole");
fake_log!(log_message, "LogMessage");
fake_log!(log_error, "LogError");
fake_log!(log_developer, "LogDeveloper");

unsafe extern "C" fn user_message_id(
    _plugin: plid_t,
    name: *const c_char,
    size: *mut c_int,
) -> c_int {
    let id = match text(name).as_str() {
        _ if !REGISTERED.get() => 0,
        "TextMsg" => TEXT_MSG,
        "SayText" => SAY_TEXT,
        _ => 0,
    };
    if id != 0 && !size.is_null() {
        // SAFETY: the plugin passes a writable size.
        unsafe { size.write(-1) };
    }
    id
}

fn engine_functions() -> enginefuncs_t {
    enginefuncs_t {
        pfnPEntityOfEntIndex: Some(entity_of_index),
        pfnIndexOfEdict: Some(index_of_edict),
        pfnEntOffsetOfPEntity: Some(entity_offset),
        pfnCVarRegister: Some(cvar_register),
        pfnCVarGetPointer: Some(cvar_pointer),
        pfnMessageBegin: Some(message_begin),
        pfnMessageEnd: Some(message_end),
        pfnWriteByte: Some(write_byte),
        pfnWriteChar: Some(write_char),
        pfnWriteShort: Some(write_short),
        pfnWriteLong: Some(write_long),
        pfnWriteAngle: Some(write_angle),
        pfnWriteCoord: Some(write_coord),
        pfnWriteString: Some(write_string),
        pfnWriteEntity: Some(write_entity),
        ..Default::default()
    }
}

fn util_functions() -> mutil_funcs_t {
    mutil_funcs_t {
        pfnLogConsole: Some(log_console),
        pfnLogMessage: Some(log_message),
        pfnLogError: Some(log_error),
        pfnLogDeveloper: Some(log_developer),
        pfnGetUserMsgID: Some(user_message_id),
        ..Default::default()
    }
}

/// The plugin, loaded the way metamod loads it, with its engine hooks.
pub struct Host {
    hooks:        enginefuncs_t,
    meta_globals: &'static mut meta_globals_t,
}

/// Loads the plugin on a running map: `GiveFnptrsToDll`, `Meta_Query` and
/// `Meta_Attach`, then metamod's request for the engine hook table.
pub fn load() -> Host {
    // The plugin keeps its state in statics, and the first test thread owns
    // them; plain `cargo test` runs every test in one process.
    assert!(
        std::env::var_os("NEXTEST").is_some(),
        "run these tests with cargo nextest: each test needs its own process"
    );
    let edicts = Box::leak(vec![edict_t::default(); EDICT_COUNT].into_boxed_slice());
    edicts[PLAYER as usize].v.flags = FL_CLIENT as c_int;
    edicts[FREE_SLOT as usize].free = 1;
    EDICTS.set(edicts.as_mut_ptr());
    let globals = Box::leak(Box::new(globalvars_t {
        maxClients: MAX_CLIENTS,
        maxEntities: EDICT_COUNT as c_int,
        // Any string: the logger only checks that a map runs.
        mapname: 1,
        ..Default::default()
    }));
    let mut functions = engine_functions();
    let mut util = util_functions();
    let mut info: *mut plugin_info_t = ptr::null_mut();
    let mut tables = META_FUNCTIONS::default();
    let meta_globals = Box::leak(Box::new(meta_globals_t::default()));
    let game_functions = Box::leak(Box::<gamedll_funcs_t>::default());
    game_functions.dllapi_table = Box::leak(Box::<DLL_FUNCTIONS>::default());
    game_functions.newapi_table = Box::leak(Box::<NEW_DLL_FUNCTIONS>::default());
    // SAFETY: every pointer is valid, as metamod passes them.
    unsafe {
        counterlife::GiveFnptrsToDll(&mut functions, globals);
        assert_eq!(
            counterlife::Meta_Query(c"5:16".as_ptr(), &mut info, &mut util),
            1,
            "Meta_Query"
        );
        assert_eq!(
            counterlife::Meta_Attach(
                PLUG_LOADTIME::PT_ANYTIME,
                &mut tables,
                meta_globals,
                game_functions
            ),
            1,
            "Meta_Attach"
        );
    }
    let getter = tables.pfnGetEngineFunctions.expect("engine hooks");
    let mut hooks = enginefuncs_t::default();
    let mut version = ENGINE_INTERFACE_VERSION as c_int;
    // SAFETY: both pointers are valid.
    assert_eq!(
        unsafe { getter(&mut hooks, &mut version) },
        1,
        "GetEngineFunctions"
    );
    Host {
        hooks,
        meta_globals,
    }
}

/// Runs one engine function as metamod does: the plugin's pre hook first,
/// then the engine unless the hook superseded the call.
macro_rules! through_metamod {
    ($host:ident, $hook:ident, $engine:ident($($argument:expr),*)) => {{
        $host.meta_globals.mres = META_RES::MRES_UNSET;
        if let Some(hook) = $host.hooks.$hook {
            // SAFETY: the arguments are valid, as the game passes them.
            unsafe { hook($($argument),*) }
        }
        if $host.meta_globals.mres != META_RES::MRES_SUPERCEDE {
            // SAFETY: as above.
            unsafe { $engine($($argument),*) }
        }
        $host.meta_globals.mres
    }};
}

impl Host {
    /// Makes the game's calls through metamod and returns what the plugin
    /// told metamod for each.
    pub fn play(&mut self, calls: &[Call]) -> Vec<META_RES> {
        calls.iter().map(|call| self.call(call)).collect()
    }

    fn call(&mut self, call: &Call) -> META_RES {
        match call {
            Call::Begin {
                destination,
                kind,
                origin,
                receiver,
            } => {
                let origin = origin
                    .as_ref()
                    .map_or(ptr::null(), |origin| origin.as_ptr());
                let receiver = receiver.map_or(ptr::null_mut(), edict);
                through_metamod!(
                    self,
                    pfnMessageBegin,
                    message_begin(*destination, *kind, origin, receiver)
                )
            }
            Call::Byte(value) => through_metamod!(self, pfnWriteByte, write_byte(*value)),
            Call::Char(value) => through_metamod!(self, pfnWriteChar, write_char(*value)),
            Call::Short(value) => through_metamod!(self, pfnWriteShort, write_short(*value)),
            Call::Long(value) => through_metamod!(self, pfnWriteLong, write_long(*value)),
            Call::Angle(value) => through_metamod!(self, pfnWriteAngle, write_angle(*value)),
            Call::Coord(value) => through_metamod!(self, pfnWriteCoord, write_coord(*value)),
            Call::String(text) => {
                through_metamod!(self, pfnWriteString, write_string(text.as_ptr()))
            }
            Call::Entity(value) => through_metamod!(self, pfnWriteEntity, write_entity(*value)),
            Call::End => through_metamod!(self, pfnMessageEnd, message_end()),
            Call::Fatal(error) => panic!("the game cannot call {error:?}"),
        }
    }
}
