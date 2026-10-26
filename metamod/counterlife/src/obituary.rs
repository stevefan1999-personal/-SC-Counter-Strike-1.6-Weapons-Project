//! The obituary lines of Sven Co-op 5.26.
//!
//! The multiplayer `DeathNotice` of `server.so` (build 10269, 0x4261C4 to
//! 0x426D97) builds one English line for each player death and sends it to
//! the notify area with `UTIL_ClientPrintAll(HUD_PRINTNOTIFY, line)`. The
//! line has no `#` token, so it is matched as text. A player name can hold
//! any character, so each format is found from its fixed parts.

/// Endings of `<victim><ending>`, in the order that `DeathNotice` tests
/// them.
const ENDINGS: &[&str] = &[
    // The victim is its own killer.
    " committed suicide.\n",
    // The world killed the victim, with or without DMG_DROWN.
    " drowned.\n",
    " fell or something.\n",
    // A BSP killer: func_tank, func_tanklaser or func_tankrocket, or another.
    " was killed by a mounted gun.\n",
    " was smashed.\n",
    // monster_mortar, and the DMG_MORTAR line below.
    " was blown to shreds by a mortar.\n",
    // The first damage type bit of the victim that has a line. "has been
    // dissolved" (0x100000) never shows: the poison test (0x130000) is first.
    " was crushed.\n",
    " was shot.\n",
    " has been chopped.\n",
    " burned down.\n",
    " froze to death.\n",
    " fell.\n",
    " blew up.\n",
    " was crowbared.\n",
    " was electrocuted.\n",
    " was killed by sound.\n",
    " was cut by a laser.\n",
    " was gibbed.\n",
    " played catapult.\n",
    " drank too much.\n",
    " was paralyzed.\n",
    " has been poisoned.\n",
    " has been dissolved.\n",
    " went nuclear.\n",
    " was baked like a cake.\n",
    " was executed by a Sniper.\n",
    // The victim has no damage type bit with a line.
    " died mysteriously.\n",
];

/// The `strcspn` set with which `DeathNotice` writes "an" instead of "a"
/// before a monster name.
const VOWELS: &[u8] = b"aeiouAEIOU";

/// Whether `line` is a line that Sven Co-op's `DeathNotice` builds.
pub fn is_obituary(line: &[u8]) -> bool {
    ENDINGS
        .iter()
        .any(|ending| line.ends_with(ending.as_bytes()))
        || killed_by_monster(line)
        || killed_by_player(line)
}

/// `<victim> was killed by a <monster>.\n`, with "an" when the monster name
/// is empty or starts with a vowel.
fn killed_by_monster(line: &[u8]) -> bool {
    const KILLED_BY: &[u8] = b" was killed by ";
    line.strip_suffix(b".\n").is_some_and(|body| {
        occurrences(body, KILLED_BY).any(|start| {
            match &body[start + KILLED_BY.len()..] {
                [b'a', b'n', b' ', monster @ ..] => {
                    monster.first().is_none_or(|first| VOWELS.contains(first))
                }
                [b'a', b' ', monster @ ..] => {
                    monster.first().is_some_and(|first| !VOWELS.contains(first))
                }
                _ => false,
            }
        })
    })
}

/// `<killer> : <weapon> : <victim>\n`. Only the weapon is sure to hold no
/// " : ", so any part between two separators can be it.
fn killed_by_player(line: &[u8]) -> bool {
    const SEPARATOR: &[u8] = b" : ";
    line.strip_suffix(b"\n").is_some_and(|body| {
        occurrences(body, SEPARATOR).any(|start| {
            let rest = &body[start + SEPARATOR.len()..];
            occurrences(rest, SEPARATOR)
                .next()
                .is_some_and(|end| is_weapon(&rest[..end]))
        })
    })
}

/// A weapon as `DeathNotice` names it: a class name without its `weapon_`,
/// `monster_` or `func_` prefix, or "gluon gun" for the egon.
fn is_weapon(name: &[u8]) -> bool {
    name == b"gluon gun"
        || (!name.is_empty()
            && name
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_'))
}

/// The start of every occurrence of `needle` in `haystack`, also of
/// occurrences that overlap.
fn occurrences<'a>(haystack: &'a [u8], needle: &'a [u8]) -> impl Iterator<Item = usize> + 'a {
    haystack
        .windows(needle.len())
        .enumerate()
        .filter(move |(_, window)| *window == needle)
        .map(|(start, _)| start)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One line for each format and branch of `DeathNotice`.
    const SVEN_LINES: &[&str] = &[
        "Stefan : csdeagle : Barney\n",
        "Stefan : 9mmhandgun : Barney\n",
        "Stefan : gluon gun : Barney\n",
        "Stefan : tau_cannon : Barney\n",
        "Stefan : world : Barney\n",
        "Stefan was killed by a Scientist.\n",
        "Stefan was killed by an Alien Grunt.\n",
        "Stefan was killed by a monster.\n",
        "Stefan was killed by an .\n",
        "Stefan committed suicide.\n",
        "Stefan drowned.\n",
        "Stefan fell or something.\n",
        "Stefan was killed by a mounted gun.\n",
        "Stefan was smashed.\n",
        "Stefan was blown to shreds by a mortar.\n",
        "Stefan was crushed.\n",
        "Stefan was shot.\n",
        "Stefan has been chopped.\n",
        "Stefan burned down.\n",
        "Stefan froze to death.\n",
        "Stefan fell.\n",
        "Stefan blew up.\n",
        "Stefan was crowbared.\n",
        "Stefan was electrocuted.\n",
        "Stefan was killed by sound.\n",
        "Stefan was cut by a laser.\n",
        "Stefan was gibbed.\n",
        "Stefan played catapult.\n",
        "Stefan drank too much.\n",
        "Stefan was paralyzed.\n",
        "Stefan has been poisoned.\n",
        "Stefan has been dissolved.\n",
        "Stefan went nuclear.\n",
        "Stefan was baked like a cake.\n",
        "Stefan was executed by a Sniper.\n",
        "Stefan died mysteriously.\n",
    ];

    /// Lines that can reach the notify area but are no obituary.
    const OTHER_LINES: &[&str] = &[
        // Chat-like lines: one separator, or no single word between two.
        "Stefan: hello\n",
        "Stefan : hello\n",
        "Stefan : gg wp : nice\n",
        "Stefan :  : Barney\n",
        // Notices of the server and of plugins.
        "Server will change level in 10 seconds.\n",
        "Vote failed.\n",
        "Vote succeeded.\n",
        "Vote for map change to \"svencoop1\" failed.\n",
        "Sequence completed!\n",
        "Only 3 more to go...\n",
        "Stefan has joined the game\n",
        "[Counter-Life] buy time is over\n",
        // The log line and the CS 1.6 console lines of a death.
        "\"Stefan\" killed \"Barney\" with \"csdeagle\"\n",
        "*** Stefan killed scientist with a headshot from deagle ***\n",
        "Stefan died\n",
        // A format with a changed part.
        "Stefan fell or something.",
        "Stefan Drowned.\n",
        "Stefan blew up.\nagain\n",
        "Stefan was killed by a Alien Grunt.\n",
        "Stefan was killed by an Scientist.\n",
        "Stefan was killed by a .\n",
        "Stefan was killed by the Scientist.\n",
        "",
    ];

    #[test]
    fn every_line_of_death_notice_is_an_obituary() {
        for line in SVEN_LINES {
            assert!(is_obituary(line.as_bytes()), "{line:?}");
        }
    }

    #[test]
    fn notices_chat_and_changed_formats_are_no_obituary() {
        for line in OTHER_LINES {
            assert!(!is_obituary(line.as_bytes()), "{line:?}");
        }
    }

    #[test]
    fn names_may_hold_the_fixed_parts_of_a_format() {
        for line in [
            "Ste : ve : csdeagle : Bar : ney\n",
            " :  : csdeagle :  : \n",
            "Stefan was killed by Barney was killed by a Zombie.\n",
            " fell.\n",
        ] {
            assert!(is_obituary(line.as_bytes()), "{line:?}");
        }
    }

    #[test]
    fn names_need_not_be_utf8() {
        assert!(is_obituary(b"St\xe9fan was shot.\n"));
        assert!(is_obituary(b"\xff : csdeagle : \xfe\n"));
    }
}
