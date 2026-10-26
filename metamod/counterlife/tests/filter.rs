//! Drives the plugin through its C entry points against a fake engine and
//! metamod: the game's message calls go through the plugin's hooks, and the
//! tests compare what reaches the engine. Run with `cargo nextest run`: every
//! test gets its own process, so the plugin's statics start fresh.

mod support;

use std::ffi::{c_int, CStr};

use metamod_p::sys::{self, META_RES};
use support::{
    engine_calls, free_edict, load, logs, set_cvar, set_registered, wire, Call, FREE_SLOT, PLAYER,
    SAY_TEXT, TEXT_MSG,
};

const HELD: META_RES = META_RES::MRES_SUPERCEDE;
const PASSED: META_RES = META_RES::MRES_IGNORED;
const NOTIFY: c_int = 1;
const CONSOLE: c_int = 2;
const MSG_ALL: c_int = sys::MSG_ALL as c_int;

fn begin(destination: u32, kind: c_int) -> Call {
    Call::Begin {
        destination: destination as c_int,
        kind,
        origin: None,
        receiver: None,
    }
}

fn string(text: &CStr) -> Call {
    Call::String(text.into())
}

/// The message that `UTIL_ClientPrintAll` sends: a `TextMsg` to every
/// player with the destination byte and one line.
fn print_all(area: c_int, line: &CStr) -> Vec<Call> {
    vec![
        begin(sys::MSG_ALL, TEXT_MSG),
        Call::Byte(area),
        string(line),
        Call::End,
    ]
}

#[test]
fn obituary_never_reaches_the_engine() {
    let mut host = load();
    let results = host.play(&print_all(NOTIFY, c"Stefan fell or something.\n"));
    assert_eq!(results, [HELD; 4]);
    assert_eq!(engine_calls(), []);
    assert!(logs().contains(&(
        "LogDeveloper",
        r#"dropped obituary "Stefan fell or something.\n""#.into()
    )));
    // The engine was never left with an open message.
    let next = print_all(NOTIFY, c"Vote failed.\n");
    host.play(&next);
    assert_eq!(engine_calls(), next);
}

#[test]
fn every_obituary_format_is_dropped() {
    let mut host = load();
    for line in [
        c"Stefan : csdeagle : Barney\n",
        c"Stefan was killed by an Alien Grunt.\n",
        c"Stefan committed suicide.\n",
        c"Stefan died mysteriously.\n",
    ] {
        assert_eq!(host.play(&print_all(NOTIFY, line)), [HELD; 4], "{line:?}");
    }
    assert_eq!(engine_calls(), []);
}

#[test]
fn other_notify_text_reaches_the_engine_unchanged() {
    let mut host = load();
    let message = print_all(NOTIFY, c"Vote failed.\n");
    assert_eq!(host.play(&message), [HELD; 4]);
    assert_eq!(engine_calls(), message);
}

#[test]
fn obituary_text_outside_the_notify_format_is_sent() {
    let mut host = load();
    let line = c"Stefan fell or something.\n";
    let mut with_parameter = print_all(NOTIFY, line);
    with_parameter.insert(3, string(c""));
    let messages = [
        print_all(CONSOLE, line),
        // The notify area with 257, which the engine sends as byte 1.
        print_all(NOTIFY + 256, c"Vote failed.\n"),
        with_parameter,
        vec![begin(sys::MSG_ALL, TEXT_MSG), Call::Byte(NOTIFY), Call::End],
    ];
    for message in &messages {
        host.play(message);
    }
    assert_eq!(wire(&engine_calls()), wire(&messages.concat()));
}

#[test]
fn notify_byte_is_read_as_the_engine_sends_it() {
    let mut host = load();
    host.play(&print_all(NOTIFY + 256, c"Stefan blew up.\n"));
    assert_eq!(engine_calls(), []);
}

#[test]
fn every_write_type_is_sent_again_in_order() {
    let mut host = load();
    let message = [
        Call::Begin {
            destination: sys::MSG_ONE as c_int,
            kind:        TEXT_MSG,
            origin:      None,
            receiver:    Some(PLAYER),
        },
        Call::Byte(255),
        Call::Char(-128),
        Call::Short(-32768),
        Call::Short(65535),
        Call::Long(c_int::MIN),
        Call::Angle(-90.5),
        Call::Coord(8191.875),
        string(c"line\n"),
        Call::Entity(PLAYER),
        Call::Entity(0),
        Call::End,
    ];
    assert_eq!(host.play(&message), [HELD; 12]);
    assert_eq!(engine_calls(), message);
}

#[test]
fn values_out_of_range_keep_their_bytes() {
    let mut host = load();
    let message = [
        begin(sys::MSG_ALL, TEXT_MSG),
        Call::Byte(300),
        Call::Byte(-1),
        Call::Char(200),
        Call::Short(70_000),
        Call::Short(-40_000),
        // No live entity has a handle, so these go out as shorts.
        Call::Entity(FREE_SLOT),
        Call::Entity(-1),
        Call::Entity(4096),
        Call::End,
    ];
    assert_eq!(host.play(&message), [HELD; 10]);
    assert_eq!(wire(&engine_calls()), wire(&message));
}

#[test]
fn other_message_types_pass_untouched() {
    let mut host = load();
    let message = [
        begin(sys::MSG_ALL, SAY_TEXT),
        Call::Byte(NOTIFY),
        string(c"Stefan fell or something.\n"),
        Call::End,
    ];
    assert_eq!(host.play(&message), [PASSED; 4]);
    assert_eq!(engine_calls(), message);
}

#[test]
fn message_begun_inside_a_held_text_message_is_sent_in_place() {
    let mut host = load();
    let inner = [
        Call::Begin {
            destination: sys::MSG_ONE as c_int,
            kind:        SAY_TEXT,
            origin:      None,
            receiver:    Some(PLAYER),
        },
        Call::Byte(PLAYER),
        string(c"hi\n"),
        Call::End,
    ];
    let wrap = |line: &CStr| {
        [
            vec![begin(sys::MSG_ALL, TEXT_MSG), Call::Byte(NOTIFY)],
            inner.to_vec(),
            vec![string(line), Call::End],
        ]
        .concat()
    };
    host.play(&wrap(c"Stefan blew up.\n"));
    assert_eq!(engine_calls(), inner);
    host.play(&wrap(c"Vote failed.\n"));
    assert_eq!(
        engine_calls(),
        [
            inner.to_vec(),
            inner.to_vec(),
            print_all(NOTIFY, c"Vote failed.\n")
        ]
        .concat()
    );
}

#[test]
fn text_message_begun_inside_a_held_one_is_sent_at_its_own_end() {
    let mut host = load();
    let outer = print_all(NOTIFY, c"Vote failed.\n");
    let inner = print_all(CONSOLE, c"Vote succeeded.\n");
    let nested = [&outer[..2], &inner[..], &outer[2..]].concat();
    assert_eq!(host.play(&nested), [HELD; 8]);
    assert_eq!(engine_calls(), [inner, outer].concat());
}

#[test]
fn text_message_begun_inside_an_engine_message_stays_the_engines() {
    let mut host = load();
    let message = [
        begin(sys::MSG_ALL, SAY_TEXT),
        Call::Byte(PLAYER),
        begin(sys::MSG_ALL, TEXT_MSG),
        Call::Byte(NOTIFY),
        string(c"Stefan blew up.\n"),
        Call::End,
        Call::End,
    ];
    assert_eq!(host.play(&message), [PASSED; 7]);
    // The engine stops the server here, as it does without the plugin.
    assert_eq!(
        engine_calls(),
        [
            message[0].clone(),
            message[1].clone(),
            Call::Fatal("MessageBegin: New message started when msg '%d' has not been sent yet"),
            message[3].clone(),
            message[4].clone(),
            message[5].clone(),
            Call::Fatal("MessageEnd: called with no active message"),
        ]
    );
}

#[test]
fn cvar_turns_the_filter_off_and_on() {
    let mut host = load();
    let obituary = print_all(NOTIFY, c"Stefan was shot.\n");
    set_cvar("cl_obituary_filter", 0.0);
    assert_eq!(host.play(&obituary), [PASSED; 4]);
    assert_eq!(engine_calls(), obituary);
    set_cvar("cl_obituary_filter", 1.0);
    assert_eq!(host.play(&obituary), [HELD; 4]);
    assert_eq!(engine_calls(), obituary, "the second one is dropped");
}

#[test]
fn text_msg_id_is_looked_up_until_the_game_registers_it() {
    set_registered(false);
    let mut host = load();
    let obituary = print_all(NOTIFY, c"Stefan was shot.\n");
    assert_eq!(host.play(&obituary), [PASSED; 4]);
    set_registered(true);
    assert_eq!(host.play(&obituary), [HELD; 4]);
    assert_eq!(engine_calls(), obituary);
}

#[test]
fn destinations_are_sent_again_with_their_origin_and_receiver() {
    let mut host = load();
    let origin = Some([1.5, -2.0, 300.25]);
    let destinations = [
        (sys::MSG_BROADCAST, None, None),
        (sys::MSG_INIT, None, None),
        (sys::MSG_SPEC, None, None),
        (sys::MSG_ONE_UNRELIABLE, None, Some(PLAYER)),
        (sys::MSG_PVS, origin, None),
        (sys::MSG_PVS_R, origin, None),
        (sys::MSG_PAS, origin, None),
        (sys::MSG_PAS_R, origin, None),
    ];
    let messages: Vec<_> = destinations
        .into_iter()
        .map(|(destination, origin, receiver)| {
            [
                Call::Begin {
                    destination: destination as c_int,
                    kind: TEXT_MSG,
                    origin,
                    receiver,
                },
                Call::Byte(CONSOLE),
                string(c"text\n"),
                Call::End,
            ]
        })
        .collect();
    for message in &messages {
        assert_eq!(host.play(message), [HELD; 4], "{:?}", message[0]);
    }
    assert_eq!(engine_calls(), messages.concat());
}

#[test]
fn destination_that_cannot_be_begun_again_stays_the_engines() {
    let mut host = load();
    let unusual = [
        // An origin that the engine ignores for MSG_ALL.
        Call::Begin {
            destination: MSG_ALL,
            kind:        TEXT_MSG,
            origin:      Some([0.0; 3]),
            receiver:    None,
        },
        // A destination code that the engine does not have.
        Call::Begin {
            destination: 42,
            kind:        TEXT_MSG,
            origin:      None,
            receiver:    None,
        },
    ];
    for begin in unusual {
        let message = [
            begin,
            Call::Byte(NOTIFY),
            string(c"Stefan was shot.\n"),
            Call::End,
        ];
        assert_eq!(host.play(&message), [PASSED; 4]);
    }
    assert_eq!(engine_calls().len(), 8);
}

#[test]
fn held_message_ends_quietly_when_its_receiver_is_gone() {
    let mut host = load();
    let message = [
        Call::Begin {
            destination: sys::MSG_ONE as c_int,
            kind:        TEXT_MSG,
            origin:      None,
            receiver:    Some(PLAYER),
        },
        Call::Byte(NOTIFY),
        string(c"Vote failed.\n"),
    ];
    assert_eq!(host.play(&message), [HELD; 3]);
    free_edict(PLAYER);
    // The engine never began the message, so its end must not reach it.
    assert_eq!(host.play(&[Call::End]), [HELD]);
    assert_eq!(engine_calls(), []);
    assert!(logs().contains(&("LogError", "lost a held TextMsg".into())));
    let next = print_all(NOTIFY, c"Vote succeeded.\n");
    host.play(&next);
    assert_eq!(engine_calls(), next);
}
