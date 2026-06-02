# AGENTS

## Design Context

This project carries committed design context. **Read these before any UI or visual work:**

- **`PRODUCT.md`** (root) — strategic: register (`product`), the three user roles (organizer / player / spectators), product purpose, brand personality, anti-references, and the five design principles.
- **`DESIGN.md`** (root) — visual: the token system and six-section design spec (Stitch format). Frontmatter tokens are normative; prose explains how to apply them.
- **`.impeccable/design.json`** — sidecar: tonal ramps, motion/shadow tokens, and live-renderable component snippets that the frontmatter can't hold.

**North Star: "The Editorial Stage."** Swiss editorial restraint (press-cream paper, charcoal ink, Space Grotesk / Inter / JetBrains Mono, hairlines) that flips to a lit stage in the moments that earn it (countdown, winner, the booth board). One accent — **Spotlight Coral (#FE414D)** — marks exactly one thing per view; its rarity is the point. Flat by default (depth from tonal layering, not shadows). Quiet controls, loud moments. Never: SaaS blue, gamified/Kahoot clichés, pure black, or cold enterprise gray.

The `impeccable` skill (`$impeccable <command>`) reads PRODUCT.md and DESIGN.md before doing design work. Live mode is pre-wired to `apps/web/index.html`.
