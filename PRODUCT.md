# Product

## Register

product

## Users

Three roles share one live round, each on its own device and surface:

- **Organizer** (phone, `/host`) — runs the round like a game-show host. Logs in, configures a session, builds or picks a puzzle, opens the lobby, fires the countdown, monitors the live board, reveals the winner, marks the prize given. Context: standing at a booth or front-of-room, one hand, often mid-conversation with a crowd. Needs control and confidence at a glance, not a settings maze.
- **Player** (phone, `/j/:code`) — a passerby or teammate who scans a QR, types a name, waits, then races to solve a tiny timed crossword with optional AI hints. Context: thumb-driven, distracted, competitive, may never have seen the app before. Needs zero-instruction onboarding and a game that feels fast and fair.
- **Spectators** (booth/room 16:9 screen, `/tv/:code`) — everyone watching the public display: the QR to join, the live leaderboard, the countdown, the winner reveal. Context: read at a distance, no interaction. Needs big, legible, theatrical.

The job to be done: **run a fair, fast, fun "fastest-correct-solve-wins" crossword round at any gathering** — expo booth, classroom, sales kickoff, team offsite — with minimal setup and a server that can't be cheated.

## Product Purpose

Crossword Battle is a white-label, server-authoritative live crossword game. One Cloudflare Worker + Durable Object owns the authoritative game state per join code and fans synchronized snapshots to the three surfaces in real time. An organizer authors puzzles two ways (manual word+clue, or AI generation from a topic prompt) and a deterministic auto-layout engine interlocks them into a phone-sized grid.

It exists so a single deployment can host *any* event without a redeploy: the entire identity — app name, event line, venue label, accent color, AI tone, prize label, prompt copy — is an editable `Brand` persisted in D1 and re-skinned at runtime from the organizer's Event branding page. `DEFAULT_BRAND` is the neutral out-of-the-box state; saving a brand re-themes every surface on next load.

Success looks like: an organizer who has never read a manual opens a session, gets players solving within a minute, and the room watches a clean countdown → race → winner reveal — and the same build does it again next week under a completely different brand.

## Brand Personality

Confident, editorial, theatrical. Swiss/editorial restraint (Space Grotesk display, mono labels, generous hairlines, press-cream paper) carrying game-show showmanship in the moments that earn it (the full-bleed countdown, the winner reveal, the public board). Voice is dry, self-assured, lightly witty — never hype, never cute. The coral accent behaves like a stage spotlight: it marks the single most important thing on any view and nothing else.

Emotional goals: the organizer feels in command; the player feels the clock and the thrill of a fair race; the room feels a show worth watching.

## Anti-references

Future work must **not** drift toward any of these:

- **Generic SaaS dashboard** — SaaS blue, endless identical card grids, neutral-gray everything, the hero-metric template. (The build already bans "generic SaaS blue.")
- **Gamified consumer app** — confetti, cartoon mascots, badges/XP, rainbow palettes, bouncy/elastic motion. Premium-editorial, never toy-like.
- **Quiz-app clichés (Kahoot-style)** — saturated primary color blocks, oversized emoji, playful-rounded everything. This is the live-quiz category default; avoid it.
- **Austere enterprise tool** — cold, dense, all-business gray admin panel with no warmth or personality. Restraint here is editorial, not clinical.

## Design Principles

1. **Three surfaces, one truth.** Every surface derives its view from one server-authoritative state. Design must never let organizer, player, and display drift, contradict, or imply the client decides anything that the server owns (correctness, ranking, the clock).
2. **The tool disappears; the show appears.** Operational UI (console, setup, builder) gets out of the way and earns trust through familiar, consistent affordances. Theatrical delight is rationed to the moments that deserve it — countdown, winner reveal, the public board — not sprayed across every screen.
3. **Coral is a spotlight, not paint.** The single accent marks the one thing that matters on a given view: the primary action, the active cell, the leader, the winner. Emphasis is earned, never decorative; everything else lives in ink, grey, and cream.
4. **White-label by construction.** Nothing event-specific is ever hardcoded. Name, venue, accent, tone, prize, and copy flow from the editable Brand. Empty brand fields collapse cleanly (no dangling separators); the neutral default must look intentional, not unfinished.
5. **Legible in the hand and across the room.** Phone surfaces are thumb-reachable and survive the mobile keyboard (dynamic viewport). The booth display assumes distance: big numbers dominate, nothing critical below ~14px.

## Accessibility & Inclusion

Best-effort, fixed opportunistically rather than to a formal WCAG commitment. Practical bars already baked into the build and worth protecting:

- **Crossword is keyboard-playable** (letters type, Backspace deletes, arrows move) alongside the on-screen LetterPad.
- **Motion is reduced-motion-safe by design:** entrance animations are transform-only (never opacity-from-0), so content is never invisible if a timeline is throttled, and selection-state backgrounds change instantly rather than via transitions that can stick mid-state.
- **Contrast:** body and label colors run against press-cream; coral text on light uses the darker `--coral-ink` for contrast. When adding surfaces, keep body text toward the ink end of the ramp rather than muted grey on tint.
- **Distance legibility** on the public display is a usability requirement, not a nicety.
