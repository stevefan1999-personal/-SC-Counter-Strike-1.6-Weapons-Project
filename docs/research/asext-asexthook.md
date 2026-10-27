# asext and asexthook: screen size and other uses for Counter-Life

Research notes for the screen size of the CS HUD. They tell what the metamod plugins asext and asexthook are and how
they work. They also tell if these plugins, or another legitimate mechanism, can give the server the screen size of each
player. Companion documents: [HUD architecture](../hud-architecture.md#screen-size) (the sources of the size today),
[Metamod plugin](../metamod.md) and [Sven client HUD](sven-client-hud.md) section 5 (stufftext filter).

Scope: Sven Co-op 5.26, engine build 10269, Linux, 32-bit, with metamod-svencoop `v20261009a` (metamod interface 5:16).
State of the repositories and releases: 2026-10-27.

## Evidence

This document merges five research passes: asext, asexthook, the plugin ecosystem, a live cvar sweep and side channels.
The side-channel pass returned no result. Section 4 covers side channels only as far as the other passes did.

- I read the repositories as shallow clones. I did not build them, run their scripts or load their binaries.
- `asext/src/meta_api.cpp:148` is a file and a line at the commit of the table below. Links go to the same commit.
- An address such as `hw.so 0x7D260` is a location in the IDA database of that binary. A name such as `Host_SetInfo_f`
  is a name that I gave from the strings of the binary and from the HLDS reference code (ReHLDS).
- "Static" means that the result comes from code. "Live" means that a game ran.

| Short name          | Repository                                                                                                                 | Commit                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `asext/`            | [metamod-svencoop/asext](https://github.com/metamod-svencoop/asext)                                                        | `d65dbb54` (2026-10-25), main                             |
| `asext@df03faf/`    | the same repository                                                                                                        | `df03faf8`, the build in the `v20261009a` release         |
| `asexthook/`        | [DrAbcOfficial/asexthook](https://github.com/DrAbcOfficial/asexthook)                                                      | `3b908f31` (2026-10-24), master. Last release `v20250831` |
| `asqcvar/`          | [metamod-svencoop/asqcvar](https://github.com/metamod-svencoop/asqcvar)                                                    | `272309bf`                                                |
| `asusermsg/`        | [metamod-svencoop/asusermsg](https://github.com/metamod-svencoop/asusermsg)                                                | `71c4188f`                                                |
| `astemplate/`       | [metamod-svencoop/astemplate](https://github.com/metamod-svencoop/astemplate)                                              | `658931ca`                                                |
| `metamod/`          | [metamod-svencoop/metamod](https://github.com/metamod-svencoop/metamod)                                                    | `e642d19e`, interface 5:17, no release                    |
| `metamod-svencoop/` | [metamod-svencoop/metamod-svencoop](https://github.com/metamod-svencoop/metamod-svencoop), formerly hzqst/metamod-fallguys | `964dce4a`. Last release `v20261009a` (2026-10-09)        |
| `ReHLDS_Sven/`      | [DrAbcOfficial/ReHLDS_Sven](https://github.com/DrAbcOfficial/ReHLDS_Sven)                                                  | `11cb8abc`                                                |
| `ReGameDLL_CS/`     | [rehlds/ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS), the workspace copy                                          | `4a50c42e`                                                |
| `amxmodx/`          | [alliedmodders/amxmodx](https://github.com/alliedmodders/amxmodx)                                                          | `8fc12670`                                                |
| `VibeSignatures/`   | [HLND2T/GoldSrc_VibeSignatures](https://github.com/HLND2T/GoldSrc_VibeSignatures)                                          | `71b36e15`                                                |
| `MetaHookSv/`       | [MetaHookSv/MetaHookSv](https://github.com/MetaHookSv/MetaHookSv), formerly hzqst/MetaHookSv                               | `6730950d`                                                |
| `metamod-p-rs/`     | the checkout next to this repository                                                                                       | `9459e87`                                                 |
| `outputdocs.txt`    | `sven-coop.github.io/outputdocs.txt`, the Sven AngelScript API dump                                                        | `623a077`                                                 |

| File             | SHA-256                                                            | Notes                                                                                                     |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `hw.so`          | `8cead76a51204a4ba1036c85cc2099b7c3542950d924846a9aa2ccf619df7dfd` | engine of the client and of a listen server, `.re/engine/hw.so.i64`                                       |
| `server.so`      | `7a980bbd4b03f7380092e45d0a7515085ffb5142e62589d87e2596e90d89d2ca` | game, `.re/server/server.so.i64`                                                                          |
| `client.so`      | `50580344e1c59b3c77e8e4e52ed9f185fcec7da2da936873ec122f12c735a022` | client DLL, `.re/client/client.so.i64`                                                                    |
| `engine_i686.so` | `ce7f5a36f7de11bfbe89707180ae4984e2de5a7b047c962c3ae1fc3e93354e3d` | engine of the dedicated server. No IDA database                                                           |
| `asext.so`       | `f2956fbe8665949ea378ed0befd3ef64d2d24fd5bb2a77362370e6bbb6c159d0` | in `metamod-fallguys-ubuntu-i386.zip` of `v20261009a` (SHA-256 in `Justfile:472`). Not loaded into a game |

The GoldSrc_VibeSignatures dataset `svencoop-10257`
([snapshot](https://hlnd2t.github.io/GoldSrc_VibeSignatures/gamesymbols/svencoop-10257.354ed3ba2443e3ca53043ddb35e6093c6303124585f13670d08188640f857c5c.json),
depot manifest in [`download.yaml:86-92`][vs-download]) lists the same SHA-256 for `hw.so`, `server.so` and `client.so`.
The build date in `hw.so` is `Dec  5 2024` (0x25CA70). Its build number function (0x564C0) counts the days from 24
October 1996, which gives 10269. Thus "10257" and "10269" are names for the same files. The dataset has no record for
`engine_i686.so`.

[vs-download]: https://github.com/HLND2T/GoldSrc_VibeSignatures/blob/71b36e1595eb71481b42ed31980e32667034281e/download.yaml#L86-L92

## Summary

1. asext is a server-side bridge. It lets other metamod plugins add native functions, types, hooks, `#if` words and
   script directories to Sven's AngelScript. It has no function that reads data from a client.
2. asexthook is an AngelScript extension on top of asext. It adds 14 hooks (13 work), two `CEngineFuncs` methods, binary
   strings, SQLite and the cvar `sv_fixgmr`. The only client data that it reads is the userinfo string and the client
   commands `medic` and `grenade`.
3. Neither plugin can give the server the screen size of a remote player. No engine channel carries the size. A live
   query of all 410 client cvars at 1600x900 and at 2560x1440 found 0 differences (section 5).
4. The most universal legitimate source is a private userinfo key that the client keeps, for example
   `setinfo _cs16res 2560x1440`. The client engine saves the key in `config.cfg` and sends it to every server. The
   server does not send `_` keys to other players. A stock AngelScript plugin reads the key with `GetInfoKeyBuffer`. CS
   1.6 uses the same mechanism for its player settings `_vgui_menus`, `_ah` and `_cl_autowepswitch` (section 6).
5. A server can put that key into the client's config with stufftext, because the client filter allows `setinfo` in both
   modes. Thus one `.hudres` on one machine can give the size to every Counter-Life server, also on a LAN. The player
   must still give the size one time on each machine.
6. Recommendation: do not install asext or asexthook for this problem. Add the userinfo key as a source of the HUD, and
   let `.hudres` put the key into the client's config. Keep asext in reserve for a native function or an event that a
   file, a cvar or a userinfo key cannot carry (section 9).

## 1. asext

### 1.1 What it is

asext ("AngelScriptExt") is a metamod plugin of the metamod-svencoop package, which hzqst started as metamod-fallguys.
It exports a C API, `ASEXT_*`. Other metamod plugins use this API to add native code to Sven's AngelScript, for map
scripts and for plugins. asext does nothing alone.

The `v20261009a` release has `asext.so` and four consumers of it: asqcvar, asusermsg, ascurl and fallguys (fallguys
loads asext in [`fallguys@dac8db54/src/meta_api.cpp:296-307`][fg-asext]). The release `plugins.ini` does not list asext,
because each consumer loads it with metamod's `pfnLoadPlugin`. This project downloads the release, but
`just metamod-install` keeps its plugins off ([Metamod plugin](../metamod.md#install-on-a-dedicated-server)).

### 1.2 How it works

1. **Symbols.** At `Meta_Attach`, asext finds 40 private functions and data objects in `server.so`. The release build
   uses Linux byte signatures when `server.so` has the interface `SCServerDLL003`, as ours has (string at 0x8FA078)
   ([`asext@df03faf/src/meta_api.cpp:218-284`][axr-meta]). Else it looks for the symbol names of Sven 5.15. The main
   branch uses the GoldSrc_VibeSignatures catalog through `pfnResolveGameSymbol` of metamod 5:17
   ([`asext/src/meta_api.cpp:148`][ax-meta]). One missing symbol stops the attach.
2. **Hooks.** asext puts inline hooks on three functions of Sven's script system
   ([`asext/src/server_hook.cpp:181-260`][ax-hooks]):
   - `CASDocumentation::RegisterObjectType` (`server.so` 0x11990A). When Sven registers `CSurvivalMode` (call at
     0x33FF5C), asext runs the documentation callbacks of its consumers. The consumers register their API in Sven's own
     registration pass.
   - `CASDirectoryList::CreateDirectory` (0x1625C2). Before Sven makes `scripts/plugins/store` (0x1A35FE), asext runs
     the directory callbacks.
   - `CScriptBuilder::DefineWord` (0xEE470). After each module builder defines `SERVER` (0x11E497), asext runs the
     define callbacks.
3. **Time.** AngelScript starts one time for each process, at the end of `pfnGameInit` (`server.so` 0x37CC20, call at
   0x37DCFA). Thus a consumer registers its callbacks in `Meta_Attach` at server start
   ([`asext/USAGE.md:41`][ax-usage]). A registered function stays until the process stops, so a consumer must never
   unload ([`astemplate/src/plugin.cpp:162`][at-detach]).
4. **Calls.** A native function uses one of the AngelScript calling conventions `asCALL_CDECL` (0), `asCALL_THISCALL`
   (3), `asCALL_CDECL_OBJLAST` (4) and `asCALL_CDECL_OBJFIRST` (5). `server.so` contains AngelScript 2.36.1, built with
   `AS_NO_EXCEPTIONS AS_LINUX AS_X86`. Thus native calls work.
5. **ABI.** The release `asext.so` exports 48 `ASEXT_*` symbols: 46 `extern "C"` cdecl functions and 2 function pointers
   (`ASEXT_CallHook`, `ASEXT_CallCASBaseCallable`). It has no version query. Its callbacks get no user-data pointer.

Static check of the release asext against our `server.so` (no run):

- A replay of metamod's pattern search (0x2A is the wildcard) found all 39 signatures and the CASHook/GOT pattern.
- 38 of the 40 addresses are the same as in the catalog. The two other addresses are harmless. `CString_dtor` resolves
  to a free-and-reset helper (0x1787A2) instead of the destructor (0x177780). `CScriptDictionary_GetSize` resolves to
  0xD4ECC, a byte-identical copy of 0xF11AA. The audit in
  [metamod-svencoop issue #55](https://github.com/metamod-svencoop/metamod-svencoop/issues/55) found the same two.
- The signature of `asGetActiveContext` contains a GOT offset (`add ebx, 0x5225F5`) that fits only this build
  ([`asext@df03faf/src/signatures.h:127`][axr-sig]). A Sven update breaks it.

### 1.3 Capabilities

| Capability         | What a consumer gets                                                                               | How                                                                                                      | Evidence                                                       | Use for Counter-Life                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Native script API  | global functions, object types, methods, properties, funcdefs and enums, optionally in a namespace | `ASEXT_RegisterDocInitCallback`, then the `ASEXT_Register*` functions in the callback                    | [`asext_api.h:141-260`][ax-api-reg]                            | a bridge only, for example `CounterLife::LocalScreenSize`. It is not a source of the size              |
| Script hooks       | new `Hooks::<domain>::<name>` hooks for `g_Hooks.RegisterHook`, which native code fires            | `ASEXT_RegisterHook` with type 2 (links the hook into Sven's list), then `(*ASEXT_CallHook)(hook, 0, …)` | [`server_hook.cpp:262-277`][ax-hook-reg]                       | events, for example "the size is known". Registration only before `pfnGameInit` (`server.so` 0x11B338) |
| Stored callbacks   | a script function handle that native code calls later                                              | `ASEXT_CreateCASFunction`, `ASEXT_CallCASBaseCallable`, `ASEXT_DereferenceCASFunction`                   | [`asext_api.h:68-110`][ax-api-cas]                             | late answers to a script, as asqcvar does for cvar queries                                             |
| `#if` words        | a word such as `METAMOD_PLUGIN_COUNTERLIFE` in each module compile                                 | `ASEXT_RegisterScriptBuilderDefineCallback` and `ASEXT_CScriptBuilder_DefineWord`, at any time           | [`server_hook.cpp:245-260`][ax-define]                         | the HUD script uses native functions only when the plugin is loaded                                    |
| Script directories | new roots of the script file system, with access flags                                             | `ASEXT_RegisterDirInitCallback` and `ASEXT_CreateDirectory`                                              | [`server_hook.cpp:200-223`][ax-dir]                            | none for the size: these are files of the server                                                       |
| Runtime access     | the script engine, the current module and context, a type by name                                  | `ASEXT_GetServerManager`, `ASEXT_GetCurrentContext`, `ASEXT_CASBaseManager_GetTypeInfoByName`            | [`asext_api.h:114-134`][ax-api-rt]                             | none. Calls into `asIScriptEngine` from Rust need the C++ ABI of Sven's AngelScript                    |
| Data helpers       | script strings (a 36-byte `CString`), arrays, `any` values and dictionaries                        | `ASEXT_CStringAssign`, `ASEXT_CStringdtor`, `ASEXT_CScriptDictionary_*`                                  | [`asext_api.h:311-381`][ax-api-data]                           | needed to give strings to a script                                                                     |
| Client data        | none                                                                                               | the cvar-query slots of its engine and DLL tables are NULL                                               | [`engine_api.cpp:244-246`][ax-eng], [`dllapi.cpp:240`][ax-dll] | none                                                                                                   |

[axr-meta]: https://github.com/metamod-svencoop/asext/blob/df03faf88e7e547d3f4f84b75ed0385bec5a0678/src/meta_api.cpp#L218-L284
[fg-asext]: https://github.com/metamod-svencoop/fallguys/blob/dac8db54db189346e2e0eb5beefbc8de6c53985f/src/meta_api.cpp#L296-L307
[axr-sig]: https://github.com/metamod-svencoop/asext/blob/df03faf88e7e547d3f4f84b75ed0385bec5a0678/src/signatures.h#L127
[ax-meta]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/meta_api.cpp#L148
[ax-hooks]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/server_hook.cpp#L181-L260
[ax-usage]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/USAGE.md?plain=1#L41
[ax-api-reg]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/include/asext_api.h#L141-L260
[ax-hook-reg]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/server_hook.cpp#L262-L277
[ax-api-cas]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/include/asext_api.h#L68-L110
[ax-define]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/server_hook.cpp#L245-L260
[ax-dir]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/server_hook.cpp#L200-L223
[ax-api-rt]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/include/asext_api.h#L114-L134
[ax-api-data]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/include/asext_api.h#L311-L381
[ax-eng]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/engine_api.cpp#L244-L246
[ax-dll]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/dllapi.cpp#L240
[at-detach]: https://github.com/metamod-svencoop/astemplate/blob/658931ca6723d53d200b828b8675ee6a2ebb833f/src/plugin.cpp#L160-L163

## 2. asexthook

### 2.1 What it is

asexthook is an AngelScript extension by DrAbc on top of asext. It adds hooks for combat, entities and relationships, a
few methods and types, and the cvar `sv_fixgmr`. It has 42 releases, from `v20221112` to `v20250831`. The master branch
(`3b908f31`) moved to the gamedata stack of metamod 5:17 on 2026-10-22 and 2026-10-23 (commits `825222f`, `628c28c` and
`ad90ad8`). No release contains this code. Its README says that gameplay was checked only on a Windows listen server
([`README.md:159-165`][ah-readme]).

### 2.2 How it works

1. `Meta_Query` accepts only the exact interface of its headers, `5:17` on master ([`src/meta_api.cpp:93`][ah-query]).
2. `Meta_Attach` resolves 11 targets in `server.so` from the gamedata. Without a full catalog it does not attach. Then
   it loads asext with `LOAD_PLUGIN` and imports the asext API ([`src/meta_api.cpp:149-170`][ah-attach]).
3. It registers its types, methods and 14 hooks in the asext callbacks ([`src/angelscript.cpp:206-226`][ah-hooks]).
4. It installs the inline hooks at the first `ServerActivate`, and the grapple hook in `GetEngineFunctions`
   ([`src/dll_hook.cpp:238-305`][ah-install], [`src/engine_hook.cpp:72`][ah-grapple]).
5. Three hooks come from metamod DLL hooks, not from inline hooks. `PlayerCallMedic` and `PlayerCallGrenade` come from
   `ClientCommand`, and `PlayerUserInfoChanged` comes from `ClientUserInfoChanged`
   ([`src/dllapi.cpp:59-94`][ah-dllapi]).
6. Its engine table leaves both client cvar query functions NULL ([`src/engine_api.cpp:266-268`][ah-query-null]). It has
   no `NEW_DLL_FUNCTIONS` table, so it cannot get cvar answers ([`src/meta_api.cpp:60-61`][ah-newdll]).

### 2.3 Capabilities

| Capability                                                                          | What it does                                                                                                                                                      | Evidence                                                             | Use for Counter-Life                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Hooks::Player::PlayerUserInfoChanged`                                              | runs before the game handles a userinfo change. It gives the player, the raw userinfo string and a `uint &out` flag. A flag other than 0 stops Sven's own handler | [`dllapi.cpp:81-94`][ah-uic], [`angelscript.cpp:209`][ah-uic-reg]    | the only client data. The engine calls it at connect and after a `setinfo`, at most one time each second (`hw.so` 0xBF9D0, called from 0xC0080). Stock `GetInfoKeyBuffer` reads the same keys, and metamod-p-rs has the same hook (`src/plugin.rs:275`) |
| `PlayerCallMedic`, `PlayerCallGrenade`                                              | run before the voice calls. Each command that starts with `medic` or `grenade` fires them                                                                         | [`dllapi.cpp:59-80`][ah-medic]                                       | none                                                                                                                                                                                                                                                    |
| `PlayerPostTakeDamage(DamageInfo@)`                                                 | runs after `CBasePlayer::TakeDamage` (the README says before)                                                                                                     | [`dll_hook.cpp:207-218`][ah-ptd]                                     | minor: the damage after armour. The stock hook `PlayerTakeDamage` exists                                                                                                                                                                                |
| `PlayerTakeHealth(HealthInfo@)`                                                     | runs before `TakeHealth`. The script can change the amount                                                                                                        | [`dll_hook.cpp:219-228`][ah-pth]                                     | minor: a HUD update at the time of healing. The HUD tick runs at 20 Hz                                                                                                                                                                                  |
| `EntitySpawn`, `MonsterSpawn`                                                       | run after an entity spawns                                                                                                                                        | [`dllapi.cpp:184-201`][ah-spawn]                                     | none                                                                                                                                                                                                                                                    |
| `IRelationship`                                                                     | changes a relationship result (114514 means "no change")                                                                                                          | [`dll_hook.cpp:229-234`][ah-irel]                                    | none. It runs AngelScript at each AI relationship check                                                                                                                                                                                                 |
| `MonsterTraceAttack`, `BreakableTraceAttack`, `BreakableDie`, `BreakableTakeDamage` | run before these functions of monsters and breakables                                                                                                             | [`dll_hook.cpp:160-206`][ah-trace]                                   | none. The kill feed gets headshots from the stock `m_LastHitGroup`                                                                                                                                                                                      |
| `MonsterPostTakeDamage`                                                             | registered, but never fired                                                                                                                                       | [`angelscript.cpp:220`][ah-mptd]                                     | none                                                                                                                                                                                                                                                    |
| `GrappleGetMonsterType`                                                             | changes what the grapple pulls                                                                                                                                    | [`engine_hook.cpp:35-79`][ah-grapple-fn]                             | none                                                                                                                                                                                                                                                    |
| `CEngineFuncs::CRC32`, `ClassMemcpy`                                                | a CRC-32 of a string, and a copy between script class objects, which crashes the game with other arguments                                                        | [`angelscript.cpp:15-33`][ah-methods]                                | none                                                                                                                                                                                                                                                    |
| `CBinaryStringBuilder`                                                              | reads and writes binary values in a string                                                                                                                        | [`angelscript.cpp:80-103`][ah-bsb]                                   | none                                                                                                                                                                                                                                                    |
| `CSQLite`, `CSQLGrid`, `CSQLItem`                                                   | SQLite from scripts. Paths must be in `scripts/plugins/store`, but the URI and memory modes skip this limit                                                       | [`CASSQLite.cpp:40-60`][ah-sqlite]                                   | none. A security risk on a server with map scripts of other authors                                                                                                                                                                                     |
| `sv_fixgmr`                                                                         | a model-index lookup of a model that the global model replacement replaced returns the replacement                                                                | [`dllapi.cpp:178-183`][ah-gmr], [`engine_api.cpp:45-61`][ah-gmr-eng] | none                                                                                                                                                                                                                                                    |
| Gamedata inline hooks                                                               | 11 `server.so` targets through `pfnResolveGameSymbol` and `pfnInlineHook`                                                                                         | [`dll_hook.cpp:238-305`][ah-install]                                 | the technique only (section 7)                                                                                                                                                                                                                          |

[ah-readme]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/README.md?plain=1#L159-L165
[ah-query]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/meta_api.cpp#L93
[ah-attach]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/meta_api.cpp#L149-L170
[ah-hooks]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/angelscript.cpp#L206-L226
[ah-install]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dll_hook.cpp#L238-L305
[ah-grapple]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/engine_hook.cpp#L72
[ah-dllapi]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dllapi.cpp#L59-L94
[ah-query-null]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/engine_api.cpp#L266-L268
[ah-newdll]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/meta_api.cpp#L60-L61
[ah-uic]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dllapi.cpp#L81-L94
[ah-uic-reg]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/angelscript.cpp#L209
[ah-medic]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dllapi.cpp#L59-L80
[ah-ptd]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dll_hook.cpp#L207-L218
[ah-pth]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dll_hook.cpp#L219-L228
[ah-spawn]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dllapi.cpp#L184-L201
[ah-irel]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dll_hook.cpp#L229-L234
[ah-trace]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dll_hook.cpp#L160-L206
[ah-mptd]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/angelscript.cpp#L220
[ah-grapple-fn]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/engine_hook.cpp#L35-L79
[ah-methods]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/angelscript.cpp#L15-L33
[ah-bsb]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/angelscript.cpp#L80-L103
[ah-sqlite]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/CASSQLite.cpp#L40-L60
[ah-gmr]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/dllapi.cpp#L178-L183
[ah-gmr-eng]: https://github.com/DrAbcOfficial/asexthook/blob/3b908f31c8166dc0b3f2cd7db53aab1413edb18a/src/engine_api.cpp#L45-L61

## 3. The plugin family and the client side

| Project                                       | Side                  | What it does                                                                                                                                                                                                                                                                                 | Screen size                                   |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| metamod 5:17 ([`meta_api.h:70`][mm-ver])      | server                | adds `pfnResolveGameSymbol`: a catalog lookup by the CRC-64 of the loaded module and a symbol name                                                                                                                                                                                           | no                                            |
| asqcvar ([`USAGE.md:19-64`][aq-usage])        | server                | AngelScript hooks `QueryCvar` and `QueryCvar2` and `SetQueryCvar2Callback`. The script sends `svc_sendcvarvalue2` (58) as a raw `NetworkMessage`                                                                                                                                             | no client cvar holds the size (section 5)     |
| asusermsg ([`engine_api.cpp:43-145`][au-eng]) | server                | AngelScript hooks on outgoing user messages, with `BlockCurrentUserMsg`                                                                                                                                                                                                                      | server to client only                         |
| ascurl                                        | server                | HTTP from AngelScript                                                                                                                                                                                                                                                                        | only through a web page (rejected, section 4) |
| fallguys                                      | server                | visibility, semiclip, LOD and physics for each player                                                                                                                                                                                                                                        | no                                            |
| slowdl, gsphysfix                             | server                | hooks on private engine functions. The catalog covers `hw.so` only, so they need a listen server                                                                                                                                                                                             | no                                            |
| GoldSrc_VibeSignatures                        | data                  | symbol records for each binary. `svencoop-10257`: 569 Linux records for `hw.so` and 70 for `server.so`. No client-message parser and no userinfo function                                                                                                                                    | no                                            |
| ReHLDS_Sven                                   | server engine         | a replacement dedicated engine for Sven 5.26 with ReHLDS hook chains. It is not binary compatible with `svends`                                                                                                                                                                              | the client sends no size                      |
| MetaHookSv, ABCEnchance, SvenMod              | client mods (Windows) | a replacement launcher with client plugins ([`MetaHookSv/README.md:25`][mhs-readme], [SvenMod](https://github.com/sw1ft747/svenmod)). No current plugin reports to the server. The old CommunicationDemo handshake is gone ([issue #89](https://github.com/MetaHookSv/MetaHookSv/issues/89)) | only for their users                          |

[mm-ver]: https://github.com/metamod-svencoop/metamod/blob/e642d19ef74f50c8eeaac0ddfb43e20c7f79a2fe/include/meta_api.h#L70
[aq-usage]: https://github.com/metamod-svencoop/asqcvar/blob/272309bf4d225cfae4128b6cd8fdb4bcd1e560fb/USAGE.md?plain=1#L19-L64
[au-eng]: https://github.com/metamod-svencoop/asusermsg/blob/71c4188f0f25c4f53e14b2fa66db3e3dc32f18ab/src/engine_api.cpp#L43-L145
[mhs-readme]: https://github.com/MetaHookSv/MetaHookSv/blob/6730950d308d902d349a04036b56505353d44e67/README.md?plain=1#L25

A stock Sven client sends 12 kinds of client messages to the server (`engine_i686.so` strings 0xB1769–0xB17EE). Their
names are bad, nop, move, stringcmd, delta, resourcelist, tmove, fileconsistency, voicedata, hltv, cvarvalue and
cvarvalue2. No message carries display data.

## 4. Screen-size ideas, ranked

Criteria:

- Universality: which players get their real size, and what they must do for it.
- Feasibility: "yes" (done, or ready to build with stock interfaces), "partial" or "no".
- Fidelity: how near the value is to the real video mode.
- Risk: what can go wrong.

Sources of the size, best mix of universality and fidelity first:

| Rank | Source                                                                                                                           | Universality                                                                                                       | Feasibility                                                 | Fidelity                                         | Risk                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | A private userinfo key `_cs16res` on the client. A valid `.hudres` puts it there with a stuffed `setinfo`, or the player sets it | every stock client (Linux and Windows) on every Counter-Life server, also on a LAN. One `.hudres` for each machine | yes, static evidence (section 6). The in-game check is open | exact, until the player changes the video mode   | low. The userinfo holds 256 bytes. A crash before a clean exit loses a new key. A future client filter can block a stuffed `setinfo`. Each server that the player joins can read the key |
| 2    | `.hudres` and the plugin store (main today)                                                                                      | one server, by auth id. All LAN players share `STEAM_ID_LAN`                                                       | yes, on main                                                | exact, until a video mode change                 | none new                                                                                                                                                                                 |
| 3    | A client on the server's machine: the Rust plugin reads the client's `svencoop.conf` (branch `feat/local-hudres`, `a112815`)     | only clients on the server's machine. They do nothing                                                              | yes, on the branch                                          | exact: the last video mode that the client saved | low: two clients on one machine share one file, and `net.ipv4.ip_nonlocal_bind = 1` makes each client local                                                                              |
| 4    | A MetaHookSv client plugin that sets the key of rank 1 from `pfnGetScreenInfo`                                                   | only Windows clients with MetaHookSv                                                                               | partial: a new client plugin and its distribution           | exact and live                                   | a client binary to maintain. The server side is the same as rank 1                                                                                                                       |
| 5    | A cvar that a client plugin registers, read with a cvar query (asqcvar or `pfnQueryClientCvarValue2`)                            | only clients with that plugin                                                                                      | partial                                                     | exact                                            | a round trip and a bridge from Rust to the script. Rank 4 needs less                                                                                                                     |
| 6    | The server default `cs16_hud_res`                                                                                                | every player                                                                                                       | yes, on main                                                | an estimate                                      | a wrong crosshair scale and wrong kill-feed gaps for other sizes                                                                                                                         |

Helpers. They carry or time a size. They do not find one:

| Helper                                                                                   | Feasibility | Note                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A menu of common sizes (`CTextMenu`, `outputdocs.txt:1291`) for a player who has no size | yes         | exact only if the player selects the right item. It adds nothing that `.hudres` cannot do. Optional                                                      |
| An asext native function or hook that gives the script a size that the Rust plugin knows | yes         | not needed: a userinfo key or a store file carries the value. It costs startup-only registration, a plugin that never unloads and a lock to metamod 5:16 |
| `#if METAMOD_PLUGIN_COUNTERLIFE` around native size functions                            | yes         | it selects a source. It is not a source                                                                                                                  |
| A new read at each `ClientUserInfoChanged` (asexthook, or the metamod-p-rs hook)         | yes         | not needed: the HUD reads the key at each resend                                                                                                         |

Rejected, one line each:

- asext as a source: it has no function that reads client data ([`asext/src/asext.h:35-176`][ax-exports]).
- asexthook as a source: only the userinfo and the `medic` and `grenade` commands come from clients (section 2.2).
- A stock client cvar: no cvar follows the screen size (section 5).
- A hidden or unlisted cvar: `cvarlist` walks the full list (`hw.so` 0x64E80), and the string harvest found none.
- Private engine hooks or ReHLDS_Sven: no client message carries the size (section 3). The catalog has no
  `engine_i686.so`, and ReHLDS_Sven is a different engine.
- An asext script directory that lets AngelScript read the host's `svencoop.conf`: it covers the host machine only and
  copies the Rust fallback. It also gives scripts access to more files.
- A web calibration page (ascurl): the size of a browser is not the video mode of the game, and it needs a web service.
- Client timing (fps, msec): it changes with the GPU, `fps_max` and the scene, and it is fingerprinting.
- Client dump files (`cvarlist log`, `condump`): they stay on the client, and `upload` sends only `custom.hpk` (`hw.so`
  0x110420).
- A MOTD with HTML or JavaScript: the Sven MOTD is a plain-text VGUI1 panel (`client.so` 0x124C3C).
- `exec` or `dlfile` of the client's `svencoop.conf`: `exec` runs only `.cfg` and `.rc` files. It refuses `..`, `:`,
  `~`, `\` and a leading `/` (`hw.so` 0x58880). `dlfile` sends only the sound cache of the map.
- File consistency hashes (`pfnForceUnmodified`) of `svencoop.conf`: covert fingerprinting of a file on the player's
  machine. Out of scope.
- Client vulnerabilities or memory corruption: out of scope.

[ax-exports]: https://github.com/metamod-svencoop/asext/blob/d65dbb54aa6007cf0e855cc77067eadf63a5eb40/src/asext.h#L35-L176

## 5. Cvar sweep (live)

Question: does a stock client cvar follow the screen size? A server can read each client cvar with
`pfnQueryClientCvarValue2`, and the answer comes back in `pfnCvarValue2`.

Result: no. Between 1600x900 and 2560x1440, 0 of the 410 client cvars change.

| Count                                | 1600x900 | 2560x1440 |
| ------------------------------------ | -------- | --------- |
| names queried                        | 17,711   | 17,711    |
| answers                              | 17,711   | 17,711    |
| answers "Bad CVAR request"           | 17,291   | 17,291    |
| answers with a value                 | 420      | 420       |
| values that differ between the sizes | 0        | 0         |
| cvars at only one size               | 0        | 0         |

- The 420 values are the 410 cvars of `cvarlist` and case variants such as `CROSSHAIR`, `NAME` and `VOLUME`, because the
  lookup ignores case.
- `cvarlist` walks the full cvar list with no filter (`hw.so` 0x64E80) and prints each line as `"%-32s : %s%s"`
  (0x64C20). The string harvest found no cvar outside this list.
- The cvars nearest to the screen had the same values at both sizes (see the table below).
- `client.so` has no `cl_crosshair_color`, `cl_crosshair_size`, `cl_crosshair_translucent` or `cl_dynamiccrosshair`.
- The client answers each registered cvar, with no filter for protected cvars (`hw.so` 0x105390). Thus a server can read
  `rcon_password`, `password` and `sv_password` of a client. Query only fixed names, and never log the values.
- asext and asexthook cannot query cvars: their engine tables leave both query functions NULL (section 1.3, section
  2.2). Sven's AngelScript API has no query function. Only a metamod plugin can query. metamod-p-rs already gets the
  answers (`metamod-p-rs/src/plugin.rs:305`).

| Cvar                                | Value at both sizes |
| ----------------------------------- | ------------------- |
| `hud_bordersize`                    | "16"                |
| `net_graph`, `net_graphpos`         | "2", "1"            |
| `net_graphwidth`, `net_graphheight` | "200", "64"         |
| `cl_scaleenginefont`                | "1"                 |
| `gl_max_size`                       | "1024"              |
| `r_borderless`                      | "0"                 |
| `scr_ofsx`, `scr_ofsy`, `scr_ofsz`  | "0"                 |
| `sdl_double_click_size`             | "2"                 |
| `default_fov`, `viewmodel_fov`      | "70", "0"           |
| `hud_draw`, `crosshair`             | "1", "1"            |

Method:

1. A sandbox server: `just sandbox`, `just install`, `just metamod-install` (metamod-svencoop `v20261009a`).
2. A temporary server command `cvarsweep <names> <answers>` in the Counter-Life plugin (appendix A). It kept 16 queries
   in flight and wrote each answer to a file. One `unsafe` call used the raw engine table, because metamod-p-rs has no
   safe sender.
3. A Deno driver started `just server-metamod` on `testcenter` and joined with `just client`. The client ran in a window
   (`-w W -h H`) on an Xvfb screen of the same size. The driver typed `cvarlist` in the client console.
4. The names to query:
   - the 410 names of `cvarlist`
   - each identifier string in `.rodata` and `.data` of the 9 game libraries that the client loads, and of
     `dlls/server.so`
   - each part of such a string after a `_`
   - the first word of each line of `config.cfg`, `autoexec.cfg`, `userconfig.cfg` and `svencoop.conf`
5. Each sweep took about 97 s, about 180 answers each second. The logs show no overflow, drop or plugin error.
6. At the end, the branch, the sandbox and the Xvfb display were removed. The player's `svencoop.conf` and `config.cfg`
   were byte-identical to the saved originals.

Not tested: full screen, Windows clients and other GPUs (the test used llvmpipe on Xvfb).

## 6. The userinfo key in the engine (static)

Path of a key such as `_cs16res`, in `hw.so` unless the item names another file:

1. **Set.** `Host_SetInfo_f` (0x7D260) handles `setinfo <key> <value>`. When the command comes from the client's own
   console, a config or a stufftext (`cmd_source` is 1), it calls `Info_SetValueForKey` on `cls.userinfo` (0x1C16FF8,
   256 bytes). Then it forwards the command to the server (0x58490). On the server, the same function writes the
   server's copy of the client's userinfo and sets its send flag (0x7D2D0, 0x7D2DC). ReHLDS has the same code
   ([`host_cmd.cpp:2577-2597`][rh-setinfo]).
2. **Limits.** `Info_SetValueForKey` (0x868C0) refuses these keys and values:
   - a key that starts with `*`
   - a key or a value with `\`, `"` or `..`
   - text that is not UTF-8
   - a key or a value of 128 characters or more

   It removes the old key first (0x858E0), then it adds the new pair if the whole userinfo stays in 256 bytes (0x85EF0).
   Thus an empty value removes the key, and a new value that does not fit leaves no key ("Info string: Length
   exceeded"). The client forwards the command to the server also when its own copy refused it.

   The engine makes room only for an important key: `name`, `model`, `rate`, `topcolor`, `bottomcolor`, `cl_updaterate`,
   `cl_lw`, `cl_lc` and keys that start with `*`. It then removes the largest other key until the pair fits (0x85EF0,
   0x85C80). Thus in a full userinfo, a longer name can remove `_cs16res` when it is the largest other key.
3. **Save.** `Info_WriteVars` (0x792C0) writes `setinfo "<key>" "<value>"` for each userinfo key that is not a cvar and
   does not start with `*`. `Host_WriteConfiguration` (0x79410) calls it, and `Host_Shutdown` (0x7BDB0, call at 0x7BF60)
   calls that at a clean exit. The command `writecfg` (0x796C0) also writes the keys. The client runs `config.cfg` at
   the next start, so the key comes back. ReHLDS has the same code ([`host.cpp:178-227`][rh-writevars]).
4. **Connect.** `CL_SendConnectPacket` (0x114260) sends `connect %i %i "<protinfo>" "<userinfo>"` with all of
   `cls.userinfo`. The client removes no key. The only callers of `Info_RemovePrefixedKeys` (0x85A50) are server
   functions.
5. **Server.** The HLDS reference removes only the key `password` from a new client's userinfo
   ([`ReHLDS_Sven/rehlds/engine/sv_main.cpp:2198`][rh-checkuserinfo]). The engine gives the game the userinfo through
   `pfnGetInfoKeyBuffer`. AngelScript reads it with `KeyValueBuffer@ GetInfoKeyBuffer(edict_t@ pEdict)` and
   `string GetValue(const string& in szKey) const` (`outputdocs.txt:5145` and `:5398`).
6. **Other players.** `SV_FullClientUpdate` (0xBCAE0), the update for a new connection (0xB88D0) and 0xB9540 call
   `Info_RemovePrefixedKeys(info, '_')` before `svc_updateuserinfo` (13). Thus other clients never get a `_` key. ReHLDS
   does the same ([`sv_main.cpp:4116`][rh-fullupdate]). I did not check this in `engine_i686.so`.
7. **Change during a game.** `SV_UpdateToReliableMessages` (0xC0080) handles the send flag of item 1 at most one time
   each second for each client. It calls `SV_ExtractFromUserinfo` (0xBF9D0, call at 0xC0367), which calls the game's
   `ClientUserInfoChanged`, and then `SV_FullClientUpdate`.
8. **Stufftext.** The command filter (`Cmd_IsAllowedFromServer`, 0x56E90) does not block `setinfo`, with
   `cl_filterstuffcmd` 0 or 1. With the filter on, the client drops a stufftext that has a control character other than
   `\n` (0x1039B0). See [Sven client HUD](sven-client-hud.md) section 5.
9. **Precedent.** CS 1.6 reads the player settings `_cl_autowepswitch`, `_vgui_menus` and `_ah` from the userinfo
   ([`ReGameDLL_CS/regamedll/dlls/player.cpp:9388-9411`][rg-prefs]). AMX Mod X reads the admin password from the key
   `_pw` ([`amxmodx/configs/amxx.cfg:14`][amxx-pw]).

Correction: the research brief said that `cl_filterstuffcmd` blocks only control characters (`hw.so` 0x1039B0). That is
only the message check. The command filter at 0x56E90 also blocks commands from the server, as
[Sven client HUD](sven-client-hud.md) section 5 tells.

[rh-setinfo]: https://github.com/DrAbcOfficial/ReHLDS_Sven/blob/11cb8abce102ac3c088b138c1f0d10d9018c3171/rehlds/engine/host_cmd.cpp#L2577-L2597
[rh-writevars]: https://github.com/DrAbcOfficial/ReHLDS_Sven/blob/11cb8abce102ac3c088b138c1f0d10d9018c3171/rehlds/engine/host.cpp#L178-L227
[rh-checkuserinfo]: https://github.com/DrAbcOfficial/ReHLDS_Sven/blob/11cb8abce102ac3c088b138c1f0d10d9018c3171/rehlds/engine/sv_main.cpp#L2198
[rh-fullupdate]: https://github.com/DrAbcOfficial/ReHLDS_Sven/blob/11cb8abce102ac3c088b138c1f0d10d9018c3171/rehlds/engine/sv_main.cpp#L4116
[rg-prefs]: https://github.com/rehlds/ReGameDLL_CS/blob/4a50c42e85fd3778c2b7d24731c7d30c83bbab01/regamedll/dlls/player.cpp#L9388-L9411
[amxx-pw]: https://github.com/alliedmodders/amxmodx/blob/8fc12670ea86470a0bfed4c35db5de73d3a39e8a/configs/amxx.cfg#L14

## 7. Other opportunities for Counter-Life

1. **Obituary filter.** This plugin family does not make it simpler. asusermsg holds a message and sends it again, as
   our plugin does ([`asusermsg/src/engine_api.cpp:43-145`][au-eng]). It also needs asext. Two plugins that hold the
   same `TextMsg` send two copies ([Metamod plugin](../metamod.md#limits)). An inline hook on `DeathNotice` (`server.so`
   0x4261C4) could stop the line at its source. Metamod 5:16 has `pfnInlineHook` and `pfnSearchPattern`
   (`metamod-p-rs/metamod-fallguys/metamod/include/mutil.h:126-128`). But the hook needs `unsafe` code and a byte
   signature that breaks at each Sven update. `DeathNotice` can also do more than the line. Keep the message filter.
2. **asexthook hooks.** The HUD needs none of them. `PlayerPostTakeDamage` gives the damage after armour, and
   `PlayerTakeHealth` gives healing at once. The stock hook `Hooks::Player::PlayerTakeDamage` and the 20 Hz HUD tick
   already cover the HUD.
3. **Client cvar queries for hints**, from the Rust plugin, without asext:
   - `default_fov`: the README asks for 74 (`README.md:47`), and the default is 70. The server can see the value and
     tell the player.
   - `hud_bordersize`: the kill feed assumes 16 (`docs/hud.md:1075`). The server can read the real value.
   - `net_graph` and `net_graphpos`: the net graph covers the bottom right, where the CS ammo HUD is.
   - The cost: a safe `Engine::query_client_cvar(player, name, request_id)` in metamod-p-rs, about 10 lines, because the
     answer hook exists. The script also needs the value, for example in a `_` key of the server's copy of the userinfo,
     as the local-size plugin does.
4. **Rust access to the asext C API**, if a future feature needs it:
   - Find asext with `pfnLoadPlugin(plid, "addons/metamod/dlls/asext.so", now, &handle)` and each export with
     `pfnGetProcAddress`. Both are in `Engine::util_functions` (`metamod-p-rs/src/engine.rs:128`). When asext is already
     loaded, metamod gives its handle.
   - Write the declarations by hand: `RegisterDocInitCallback`, `RegisterGlobalFunction`, `SetDefaultNamespace`,
     `RegisterScriptBuilderDefineCallback`, `CScriptBuilder_DefineWord`, `RegisterHook`, `CallHook`, `CStringAssign` and
     `CStringdtor`. Do not run bindgen on `asext_api.h`, because it includes Sven's changed AngelScript C++ API.
   - Put the binding in metamod-p-rs as a safe module behind a feature. Then the Counter-Life crate stays free of
     `unsafe` code ([Metamod plugin](../metamod.md)).
   - Set `loadable` to `Startup` and `unloadable` to `Never` (today `AnyTime` and `AnyPause`,
     `metamod/counterlife/src/lib.rs:116-117`). Register only when `attach` runs at `LoadTime::Startup`.
   - Keep state in statics, because the callbacks get no user data. Never let a panic leave an `extern "C"` native
     function, because that stops the server.
   - Keep the native API to primitives: `int`, `float`, `bool`, `&out` parameters, and entity indexes instead of
     `CBasePlayer@`. Register globals with `asCALL_CDECL` in `ASEXT_SetDefaultNamespace`.
5. **`#if` words.** With a define callback, a word such as `METAMOD_PLUGIN_COUNTERLIFE` lets the HUD script use native
   functions only when the plugin is loaded. The script then compiles also without the plugin
   ([`astemplate/examples/astemplate.as:5-9`][at-example]).
6. **Corrections for other documents.**
   - `docs/hud.md:678` and `:1076` say that the server cannot read client cvars. The engine can
     (`pfnQueryClientCvarValue2`). The conclusion stays for a different reason: Sven's `client.so` has none of the CS
     crosshair cvars (section 5).
   - asext `USAGE.md:73` uses `ASHookFlag_*`, but the header defines `ASFlag_*` (`asext_api.h:10-11`). Copy samples from
     asqcvar or astemplate.
7. **Security.** Do not install asexthook on a server that runs map scripts of other authors. `CSQLite` with the URI or
   memory mode skips the store-path limit ([`asexthook/src/CASSQLite.cpp:40-60`][ah-sqlite]). Then a script can open
   each file that the server can write.
8. **After a 5:17 release.** asext main and asexthook master can then load, and asext main fixes the wrong
   `CString_dtor`. Change the `Justfile` pin, the metamod-p-rs headers and asext together. Our 5:16 plugin loads in a
   5:17 metamod, because metamod accepts an older minor interface ([`metamod/src/mplugin.cpp:822-825`][mm-minor]).
   metamod-p-rs accepts a newer minor interface (`metamod-p-rs/src/export.rs:127-138`).

[at-example]: https://github.com/metamod-svencoop/astemplate/blob/658931ca6723d53d200b828b8675ee6a2ebb833f/examples/astemplate.as#L5-L9
[mm-minor]: https://github.com/metamod-svencoop/metamod/blob/e642d19ef74f50c8eeaac0ddfb43e20c7f79a2fe/src/mplugin.cpp#L822-L825

## 8. Compatibility and operational cost

| Option                                      | Extra server plugins                        | Symbols from                       | Metamod interface         | Client side          | After a Sven update                                                          |
| ------------------------------------------- | ------------------------------------------- | ---------------------------------- | ------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| Userinfo key (recommended)                  | none                                        | none                               | any, or no metamod        | stock                | no change expected: it is the userinfo protocol of the Half-Life engine      |
| Local `svencoop.conf` (`feat/local-hudres`) | none (the Counter-Life plugin)              | none                               | 5:16 or newer minor       | stock                | no change expected, unless the client changes its config format              |
| asext `v20261009a`                          | `asext.so` and a consumer                   | 40 byte signatures                 | exactly 5:16              | stock                | breaks: one signature holds a GOT offset of this build                       |
| asext main                                  | `asext.so`, a consumer and the gamedata     | GoldSrc_VibeSignatures             | exactly 5:17 (no release) | stock                | no attach until the catalog lists the new files                              |
| asexthook master                            | `asext.so`, `asexthook.so` and the gamedata | GoldSrc_VibeSignatures, 11 targets | exactly 5:17 (no release) | stock                | no attach until the catalog lists the new files                              |
| asexthook `v20250831`                       | `asext.so` and `asexthook.so`               | byte signatures                    | exactly 5:16              | stock                | can break (byte signatures). Its ABI fit with the release asext is not known |
| asqcvar `v20261009a`                        | `asext.so` and `asqcvar.so`                 | through asext                      | exactly 5:16 (asext)      | stock                | breaks with asext                                                            |
| MetaHookSv plugin                           | none                                        | client gamedata                    | none                      | a Windows client mod | the client plugin needs updates                                              |

- Our binaries are the dataset `svencoop-10257` (Evidence). The release asext resolves all its symbols on our
  `server.so` (section 1.2). This is static evidence. Nothing ran.
- The newest releases on 2026-10-27: metamod-svencoop `v20261009a` (5:16) and asexthook `v20250831`.
  metamod-svencoop/metamod and metamod-svencoop/asext have no tags (`git ls-remote --tags`).
- asext main pins metamod `1a620468` (interface 5:17, `asext/cmake/Revisions.cmake:2`). The `v20261009a` metamod refuses
  a 5:17 plugin, and asext main refuses 5:16 (`asext/src/meta_api.cpp:93`).
- asexthook `v20250831` compares the interface with `strcmp`, as master does (`src/source/meta_api.cpp:93` at
  `836807ea`, the commit of the tag). It builds against the metamod-fallguys tree of 2025, which says 5:16
  (`metamod/meta_api.h` at `3a02119`). asqcvar itself accepts 5:14 or newer (`asqcvar/src/meta_api.cpp:117-130`), but it
  loads asext, and the release asext accepts only 5:16.
- The release `asext.so` needs GLIBC_2.38, as the release `metamod.so` does.
- Server-only and client mods: the whole asext family runs on the server only. MetaHookSv, ABCEnchance and SvenMod are
  client mods for Windows. The userinfo key needs no mod on either side.
- Hook overlap with our Rust plugin: none. asexthook uses `ClientCommand`, `ClientUserInfoChanged`, `ServerActivate`,
  `GameInit`, `Spawn`, `pfnModelIndex` and inline hooks. Our plugin uses `MESSAGE_BEGIN`, the `WRITE_*` functions and
  `MESSAGE_END`. A `TextMsg` hook of asusermsg conflicts with our filter ([Metamod plugin](../metamod.md#limits)).

## 9. Recommendation

Do not install asext or asexthook for the screen size. Neither can see a client's video mode, and each one ties the
server to one metamod interface and to signatures of one Sven build. Use the client's own userinfo: it is the only
channel that a stock client keeps and sends to every server.

The key is `_cs16res`, not `_cs16_hudres`. The local-size plugin of `feat/local-hudres` removes `_cs16_hudres` from each
remote client on purpose (`metamod/counterlife/src/lib.rs`, `client_connect`). A separate key keeps the two sources
apart, and the `.hudres` reply can name the source.

Next steps:

1. **Check the engine in a game first.** In a sandbox, with the stock client, on a dedicated server and on a listen
   server:
   - Type `setinfo _cs16res 2560x1440` in the client console. Connect. Log
     `g_EngineFuncs.GetInfoKeyBuffer( player.edict() ).GetValue( "_cs16res" )` in a probe script.
   - Stuff `setinfo _cs16res 1600x900` from the server. Make sure that the value arrives, with `cl_filterstuffcmd` 0 and
     1.
   - Quit the client normally. Read its `config.cfg` before `just client-stop` puts the original back. It must contain
     `setinfo "_cs16res" "1600x900"`. Start the client again, connect, and read the key.
   - Type `setinfo` without arguments in the client console and record the length of the userinfo.
   - If a step fails, stop and write the result here.
2. **Read the key in the HUD** (`scripts/cs16/hud/screen.as`). Add the source "your game config" just before the stored
   `.hudres`. With `feat/local-hudres` merged, the order is:
   1. a `.hudres` of this connection
   2. the size of a client on the server's machine (`_cs16_hudres`)
   3. the key `_cs16res`
   4. the stored `.hudres` of the auth id
   5. `cs16_hud_res`

   Read the key when the player enters the game and at each resend, as the branch reads `_cs16_hudres`. Check the value
   with `ParseScreenSize`, because the client controls it. Build this on the branch. There a typed size lasts for the
   whole connection, so an old key cannot replace a new `.hudres` at a map change.
3. **Put the key into the client's config on `.hudres`.** After a valid `.hudres <W>x<H>`, if the key differs, send one
   stufftext to that player only. The text holds only the digits and the `x` that `ParseScreenSize` accepted. Tell the
   player in the reply that the game keeps the size for all servers, and how to remove it: `setinfo _cs16res ""`. Never
   write the key without the player's `.hudres`.
4. **Optional:** when a player without an own size enters the game, tell the player one time:
   `[CS HUD] The HUD assumes 1920x1080. Type .hudres <width>x<height> one time.`
5. **Tests.** `just check <port>` for the script. Extend the `.hudres` scenario: the key in `config.cfg` after a clean
   exit, and the size on a new sandbox server with an empty plugin store.
6. **Documents.** Update `docs/hud-architecture.md` (Screen size, Known limits) and the player settings in `README.md`
   (`setinfo _cs16res <W>x<H>` in `userconfig.cfg` is the manual form). Correct `docs/hud.md:678` and `:1076` (section
   7).
7. **Keep asext in reserve.** Use it only when a script needs a native function or an event that a file, a cvar or a
   userinfo key cannot carry. Decide about the metamod interface first (section 8).

A sketch of steps 2 and 3, in the style of `screen.as` (stufftext as in `tests/e2e/e2e.as:217-219`):

```angelscript
// The client keeps this key in config.cfg and sends it to every server. The server sends no "_" key to other players.
const string CLIENT_KEY = "_cs16res";

ScreenSize@ ReadClientScreen( CBasePlayer@ player )
{
  return ParseScreenSize( g_EngineFuncs.GetInfoKeyBuffer( player.edict() ).GetValue( CLIENT_KEY ) );
}

// Only after a valid .hudres: size.ToString() holds only digits and "x".
void SaveClientScreen( CBasePlayer@ player, const ScreenSize@ size )
{
  NetworkMessage message( MSG_ONE, NetworkMessages::SVC_STUFFTEXT, player.edict() );
  message.WriteString( "setinfo " + CLIENT_KEY + " " + size.ToString() + "\n" );
  message.End();
}
```

## Open points

- No in-game check of the userinfo key yet (step 1). Everything in section 6 is static.
- `engine_i686.so` has no IDA database. The removal of `_` keys for other players (section 6, item 6) is checked only in
  `hw.so` and in ReHLDS.
- The length of a real Sven 5.26 userinfo is not measured. A full userinfo refuses the key, and a longer name or model
  can remove it later (section 6, item 2).
- A crash of the client skips `Host_WriteConfiguration`. Then a key that the server put in during that session is lost,
  but the stored `.hudres` still works on that server.
- If a future client blocks a stuffed `setinfo`, an old key stays in the client's config. At the next connection it
  comes before the stored `.hudres`. The `.hudres` reply names the source, so the player can see it.
- Steam Cloud: not checked. If it syncs `config.cfg`, the key follows the player to other machines, where it can be
  wrong.
- The other caller of `SV_ExtractFromUserinfo` (`hw.so` 0x9C0B0) is not known. It can be one more trigger of
  `ClientUserInfoChanged`.
- The cvar sweep did not cover full screen, Windows clients or other GPUs.
- The side-channel research pass returned no result.

## Appendix A. Cvar sweep code

The experiment ran from a temporary branch, which is deleted. This is its code, for a new run (for example in full
screen or on Windows). It needs one `unsafe` call, so it does not belong in the Counter-Life plugin.

<details>
<summary><code>metamod/counterlife/src/cvarsweep.rs</code> and its wiring</summary>

Wiring in `metamod/counterlife/src/lib.rs`:

```rust
pub mod cvarsweep;
// In `CounterLife`: `sweep: Rc<CvarSweep>`. In `attach`:
let sweep = Rc::new(CvarSweep::new(engine));
let command = Rc::clone(&sweep);
engine.register_command(c"cvarsweep", move |args| command.command(args));
// In `impl Plugin`:
fn start_frame(&self) -> MetaResult<()> {
    self.sweep.frame();
    MetaResult::Ignored
}
fn cvar_value(&self, _player: Edict, request_id: i32, name: &CStr, value: &CStr) -> MetaResult<()> {
    self.sweep.answer(request_id, name, value)
}
```

The module:

```rust
use metamod_p::{CommandArgs, Edict, Engine, MetaResult};
use std::{
    cell::{Cell, RefCell},
    error::Error,
    ffi::{CStr, CString},
    fs::{self, File},
    io::{BufWriter, Write},
};
const WINDOW: usize = 16; // queries in flight; the answers share the client's reliable stream
const TIMEOUT: f32 = 20.0; // seconds without an answer
const INDEX_BITS: u32 = 20; // request id = generation << 20 | index
const NOT_A_CVAR: &CStr = c"Bad CVAR request"; // hw.so 0x105390
struct Sweep {
    player: Edict,
    generation: i32,
    names: Vec<CString>,
    sent: usize,
    answered: usize,
    found: usize,
    progress_at: f32,
    out: BufWriter<File>,
}
pub struct CvarSweep {
    engine: &'static Engine,
    generations: Cell<i32>,
    sweep: RefCell<Option<Sweep>>,
}
impl CvarSweep {
    pub fn new(engine: &'static Engine) -> Self {
        Self {
            engine,
            generations: Cell::default(),
            sweep: RefCell::default(),
        }
    }
    pub fn command(&self, args: &CommandArgs) {
        let text = match self.start(args) {
            Ok(count) => format!("cvarsweep: started, {count} names\n"),
            Err(error) => format!("cvarsweep: {error}\n"),
        };
        self.engine.server_print(&text);
    }
    fn start(&self, args: &CommandArgs) -> Result<usize, Box<dyn Error>> {
        let [names, out] = [1, 2].map(|index| {
            args.get(index)
                .map(|word| word.to_string_lossy().into_owned())
        });
        let (Some(names), Some(out)) = (names, out) else {
            return Err("usage: cvarsweep <names file> <answers file>".into());
        };
        let player = self
            .engine
            .players()
            .next()
            .ok_or("no player in the game")?;
        let names = fs::read_to_string(names)?
            .lines()
            .filter(|line| !line.is_empty())
            .map(CString::new)
            .collect::<Result<Vec<_>, _>>()?;
        let generation = self.generations.get() + 1;
        self.generations.set(generation);
        let count = names.len();
        *self.sweep.borrow_mut() = Some(Sweep {
            player,
            generation,
            names,
            sent: 0,
            answered: 0,
            found: 0,
            progress_at: self.engine.time(),
            out: BufWriter::new(File::create(out)?),
        });
        Ok(count)
    }
    pub fn frame(&self) {
        let mut slot = self.sweep.borrow_mut();
        let Some(sweep) = slot.as_mut() else { return };
        let end = if sweep.player.is_valid() {
            let query = self
                .engine
                .functions()
                .pfnQueryClientCvarValue2
                .expect("pfnQueryClientCvarValue2 is in the engine table");
            let batch = sweep.sent..sweep.names.len().min(sweep.answered + WINDOW);
            batch.clone().for_each(|index| {
                let id = sweep.generation << INDEX_BITS | index as i32;
                // SAFETY: valid player handle; the name outlives the call and the engine copies it.
                unsafe { query(sweep.player.as_ptr(), sweep.names[index].as_ptr(), id) }
            });
            sweep.sent = sweep.sent.max(batch.end);
            if sweep.answered == sweep.names.len() {
                Some("done")
            } else if self.engine.time() - sweep.progress_at > TIMEOUT {
                Some("timeout")
            } else {
                None
            }
        } else {
            Some("the player left")
        };
        if let Some(reason) = end {
            let mut sweep = slot.take().expect("the sweep that just ended");
            let flushed = sweep.out.flush().map_or_else(
                |error| format!(", write failed: {error}"),
                |()| String::new(),
            );
            self.engine.server_print(&format!(
                "cvarsweep: {reason}: {}/{} answered, {} cvars{flushed}\n",
                sweep.answered,
                sweep.names.len(),
                sweep.found
            ));
        }
    }
    pub fn answer(&self, request_id: i32, name: &CStr, value: &CStr) -> MetaResult<()> {
        let mut slot = self.sweep.borrow_mut();
        let Some(sweep) = slot.as_mut() else {
            return MetaResult::Ignored;
        };
        let index = (request_id & ((1 << INDEX_BITS) - 1)) as usize;
        if request_id >> INDEX_BITS != sweep.generation
            || sweep.names.get(index).map(CString::as_c_str) != Some(name)
        {
            return MetaResult::Ignored;
        }
        if let Err(error) = writeln!(
            sweep.out,
            "{index}\t{}\t{:?}",
            name.to_string_lossy(),
            value.to_string_lossy()
        ) {
            log::error!("cvarsweep: {error}");
        }
        sweep.answered += 1;
        sweep.found += usize::from(value != NOT_A_CVAR);
        sweep.progress_at = self.engine.time();
        MetaResult::Supercede(()) // only our own ids; other answers go on to the game
    }
}
```

The compare script, `tests/e2e/cvarsweep-diff.ts <answers A> <answers B>`:

```ts
const NOT_A_CVAR = '"Bad CVAR request"';

async function answers(path: string) {
  const lines = (await Deno.readTextFile(path)).split("\n").filter(Boolean);
  return new Map(
    lines.map((line) => line.split("\t")).filter(([, , value]) => value !== NOT_A_CVAR).map((
      [, name, value],
    ) => [name, value]),
  );
}

const [left, right] = Deno.args;
const [a, b] = await Promise.all([answers(left), answers(right)]);
console.log(JSON.stringify(
  {
    cvars: { [left]: a.size, [right]: b.size },
    onlyIn: {
      [left]: [...a.keys()].filter((name) => !b.has(name)),
      [right]: [...b.keys()].filter((name) => !a.has(name)),
    },
    differ: [...a].filter(([name, value]) => b.has(name) && b.get(name) !== value).map(([name, value]) => ({
      name,
      [left]: value,
      [right]: b.get(name),
    })),
  },
  null,
  2,
));
```

The driver (`tests/e2e/cvarsweep.ts`, on `tests/e2e/driver.ts`) did these steps:

1. `server.start("testcenter", "server-metamod", "+motdfile", "cvarsweep-no-motd.txt")`, then `client.join(server)`.
2. `client.console("cvarlist")`. Wait for `/\d+ Total CVars/` in `.e2e/client/client.log`, and take `/^(\S+)\s+: /` from
   the lines after "CVar List".
3. Harvest strings: `readelf -W -p .rodata -p .data <library>` for each library in `/proc/<pid>/maps` of the client
   process group (`.e2e/client/client.pgid`) that is in the client directory. Keep each match of
   `^[A-Za-z_][A-Za-z0-9_]{1,62}$` and each part after a `_`.
4. Add the first word of each line of `config.cfg`, `autoexec.cfg`, `userconfig.cfg` and `svencoop.conf` (split at white
   space or `=`, quotes removed).
5. Write the sorted names to `names-<W>x<H>.txt`, take a screenshot, and run
   `server.commandAndWait("cvarsweep <names> <answers>", /cvarsweep: (done|timeout|the player left)[^\n]*/, 1_800_000)`.
6. `client.stop()` and `server.stop()`.

Run:
`CL_DISPLAY=:134 CL_RESOLUTION=<W>x<H> CL_LISTEN_PORT=27142 SVEN_SERVER_DIR=<sandbox> deno run -A
tests/e2e/cvarsweep.ts 27141 <out>`,
one time for each size. Stop the Xvfb of the display between the sizes. A command that the plugin registers needs
`pfnAddServerCommand` in the fake host of `metamod/counterlife/tests/support`, else the fake-host tests fail.

</details>
