# GLASSHOUSE — Botanical Tactical FPS

A bright botanical-conservatory tactical FPS for make.fun bounty
**threejs-fps-02** ($1,000, top 10 paid). Original map, art, sounds and
names — nothing copied from Counter-Strike or any commercial game.

**The game:** 5v5 round-based plant/defuse. You are a **Thorn** (attacker,
orange) against the **Keepers** (defenders, blue). Each round opens with
5 s freeze time (buy with `B`), then a 100 s round: carry the **Canister**
to Site A (amber, Palm House) or Site B (aqua, Lily Pond), plant it
(3.5 s), and defend the 40 s fuse — or eliminate the enemy team. First
to 7 rounds wins the match.

**Controls:** WASD move · mouse aim · click fire · R reload · Ctrl crouch ·
Space jump · 1/2/3/4 weapons · B buy (freeze only) · E plant · G grenade ·
Tab scoreboard · RMB scope (DM-8) · R play again (match end).

**Systems:** freeze time + buy economy ($800 start, $3,250 win / $1,900
loss, $300 kill / plant) · if the carrier dies the Canister drops where
they fell — any Thorn can pick it up and become the new carrier · 4 weapons with distinct recoil/spread tables
(S6, VX-9, AR-55, DM-8) + Kevlar/helmet + flash/smoke/frag · headshots
x3/x4 · spread triples while moving (stopping to aim pays) · bot AI on a
waypoint graph (Advance/Hold/Rotate/Retreat/Plant/Defuse) with LOS-gated
perception (a bot that cannot see you cannot shoot you), hearing, and
radio callouts · live radar with teammate dots and sound pings · WebAudio
synth sounds (gunshots, birdsong, fountain, breeze — no audio files).

**Reproduce a screenshot:** serve `game/` over HTTP and open
`index.html?shot=1..4` (fixed seed 7, scripted positions, frozen timer):
1 firefight on the Central Walk · 2 Site A plant moment · 3 freeze-time
buy menu · 4 map overview. `?debug=1` shows bot states, `?perf=1` shows
fps/draw calls, `?autoplay=1` runs a bot-only match, `?ff=N` fast-forwards
the sim N× for testing.

**Tech:** three.js 0.187.0 vendored byte-for-byte, static ES modules, no
build step, zero network requests at runtime. `main.ts` (Node 22, stdlib
only) copies `game/` + `screenshots/` to `$MAKEFUN_OUTPUT_DIR` (default
`/output`) and writes `dossier.json` via the kit's `buildDossier`.

**License:** MIT (see LICENSE).
