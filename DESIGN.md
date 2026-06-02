---
name: Crossword Battle
description: White-label live crossword game — editorial restraint with theatrical reveals.
colors:
  coral: "#FE414D"
  coral-ink: "#C4242F"
  coral-tint: "#FE414D1A"
  coral-line: "#FE414D73"
  ink: "#1F1B19"
  grey: "#5A5550"
  grey-soft: "#8C867E"
  cream: "#F5F2EA"
  paper: "#FBF9F2"
  paper-edge: "#EFEBDF"
  night: "#181513"
  night-2: "#221E1B"
  inword-highlight: "#FBE9D2"
  line: "#1F1B191F"
  line-2: "#1F1B1933"
  line-3: "#1F1B196B"
typography:
  display:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "clamp(2.875rem, 6vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.125rem)"
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Space Grotesk, Inter, sans-serif"
    fontSize: "clamp(1.25rem, 3vw, 1.625rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "0.14em"
rounded:
  sm: "7px"
  md: "12px"
  lg: "18px"
  cell: "4px"
  pill: "100px"
spacing:
  sm: "10px"
  md: "16px"
  lg: "22px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "16px 22px"
  button-primary-hover:
    backgroundColor: "#EC3743"
    textColor: "#FFFFFF"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "16px 22px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px 22px"
  chip-coral-soft:
    backgroundColor: "{colors.coral-tint}"
    textColor: "{colors.coral-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  chip-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  well:
    backgroundColor: "{colors.paper-edge}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "18px 18px"
  crossword-cell-active:
    backgroundColor: "{colors.coral}"
    textColor: "#FFFFFF"
    rounded: "0px"
---

# Design System: Crossword Battle

## 1. Overview

**Creative North Star: "The Editorial Stage"**

Crossword Battle is Swiss editorial print that flips to a lit stage in the moments that earn it. At rest it is a press-cream broadsheet: warm paper, charcoal ink (never pure black), mono labels set in small caps, hairline rules, generous restraint. Then the countdown drops to full-bleed dark, a single 260px coral digit pops on every tick, and the same calm system becomes a game show. The console is quiet so the reveals can be loud.

The accent — Spotlight Coral — behaves like a stage light, not a brand fill. On any given view it marks exactly one thing: the primary action, the active crossword cell, the current leader, the winner. Its rarity is the entire point; spread across a screen it stops meaning anything. Depth never comes from shadows. It comes from a tonal paper ladder (cream background → paper cards → recessed paper-edge wells) and charcoal hairlines, the way a well-set page separates columns without drawing boxes.

This system explicitly rejects four things. It is **not** a generic SaaS dashboard (no SaaS blue, no hero-metric template, no endless identical card grids). It is **not** a gamified consumer app (no confetti, mascots, badges, rainbow palettes, or bouncy elastic motion). It is **not** a Kahoot-style quiz (no saturated primary blocks, giant emoji, or playful-rounded everything). And it is **not** an austere enterprise tool (the restraint is editorial and warm, never cold or clinical).

**Key Characteristics:**
- Press-cream paper + a single coral spotlight; ink, never black.
- Three type voices with strict jobs: Space Grotesk titles, Inter prose, JetBrains Mono system text.
- Flat by default; depth via tonal layering and hairlines, not shadows.
- Quiet operational controls; theatrical weight reserved for countdown, winner, and the public board.
- Big tabular numbers dominate; the 16:9 booth display is legible across a room.
- White-label by construction: one editable accent re-themes the whole stage.

## 2. Colors

A warm, low-chroma editorial neutral field carrying one high-energy accent. Charcoal ink and press-cream do almost all the work; coral is the spotlight.

### Primary
- **Spotlight Coral** (#FE414D): The single accent. Primary actions (`Create New Session`, `Join`), the active crossword cell, the current leader's row, the winner, the live timer once it drops to ≤20s, and the countdown digit. Reserved for the one most important element on a view and nothing else.
- **Coral Ink** (#C4242F): Coral *text* on light surfaces (AI commentary, coral-soft chips), where the raw accent wouldn't clear contrast. Never used as a fill.
- **Coral Tint** (#FE414D1A) and **Coral Line** (#FE414D73): The 10%/45% washes for coral-soft chips, the input focus ring, and live/AI affordances that should whisper, not shout.

### Neutral
- **Ink** (#1F1B19): Primary text and all dark panels. The near-black that is never #000.
- **Grey** (#5A5550): Secondary text and body copy on paper.
- **Grey Soft** (#8C867E): Tertiary text and the mono labels at rest.
- **Cream** (#F5F2EA): The app background — warm press cream.
- **Paper** (#FBF9F2): Cards and raised surfaces, one step brighter than the background.
- **Paper Edge** (#EFEBDF): Recessed wells, key caps, the "pressed in" layer.
- **Night** (#181513) / **Night 2** (#221E1B): Full-bleed dark stages (countdown, leader spotlight panels, dark footers).
- **Inword Highlight** (#FBE9D2): The warm wash on the current clue's cell path — the only non-coral, non-neutral hue, and only inside the grid.
- **Hairlines** — Line (#1F1B191F, 12%), Line 2 (#1F1B1933, 20%), Line 3 (#1F1B196B, 42%): charcoal-at-low-alpha dividers and borders that carry structure instead of shadows.

### Named Rules
**The Spotlight Rule.** Coral marks at most one element per view — the single most important action, state, or result. It is forbidden as decoration, as a background wash on neutral content, or as a second emphasis competing with the first. Rarity is the meaning.

**The No-Black Rule.** Pure #000 is prohibited. All "black" text and dark surfaces are Ink (#1F1B19) or Night (#181513).

**The No-SaaS-Blue Rule.** Generic SaaS blue is forbidden anywhere. There is one accent and it is coral.

## 3. Typography

**Display / UI Titles:** Space Grotesk (with Inter, sans-serif fallback)
**Body:** Inter (with system-ui, sans-serif fallback)
**Label / Mono — timers, room codes, labels, system states:** JetBrains Mono (with ui-monospace, monospace fallback)

**Character:** A confident geometric grotesk for headlines, a neutral humanist sans for prose, and a precise monospace for every machine-y signal (clocks, codes, status). Three voices, three jobs, no overlap — the pairing reads editorial, not decorative. (Space Grotesk stands in for the brief's Futura; swap to licensed Futura in production if desired.)

### Hierarchy
- **Display** (700, clamp 46–96px, line-height 0.92, tracking −0.025em): Hero titles, the winner's name, the player's rank. Tight but never touching. The countdown digit is a special case (200–420px, `count-num`), scale-popped each tick.
- **Headline** (700, 30–34px, line-height 1.0, tracking −0.02em): Screen-level H1s and stat values.
- **Title** (600, 20–26px, line-height 1.05, tracking −0.015em): Card headings, player names, section titles. (An H3 step at 600, 15–20px continues the ladder.)
- **Body** (Inter 400, 13–15px, line-height 1.5): Prose and supporting copy in Grey; prose capped at 65–75ch. `.body-ink` lifts to Ink when it needs to read as primary.
- **Label** (JetBrains Mono 500, ~11px, tracking 0.14em, UPPERCASE): Eyebrows, timers, join codes, status chips, system states. Grey Soft at rest; `.label-coral` for the live state.

### Named Rules
**The Mono-System Rule.** Anything the machine says — timers, room codes, status, labels, percentages — is JetBrains Mono, uppercase, 0.14em tracking. Anything a person reads as a sentence is Inter. Anything that announces is Space Grotesk. Never blur these jobs.

**The Tabular-Numerals Rule.** Every timer, score, code, and leaderboard figure uses `font-variant-numeric: tabular-nums`. Digits must not jitter as they tick.

## 4. Elevation

This system is flat by default. Surfaces do not lift on shadows; depth is built from the tonal paper ladder (Cream background → Paper cards → recessed Paper-Edge wells) and charcoal hairlines. A card is a paper rectangle with a 1px Line border, not a floating object. (The prototype's heavy device-frame drop shadows were a phone-mockup affordance and are intentionally not part of the shipped product.)

### Shadow Vocabulary (state only)
- **Focus ring** (`box-shadow: 0 0 0 3px var(--coral-tint)` + coral border): the one deliberate "glow", and it appears only on an input while focused.
- **Toggle knob** (`box-shadow: 0 1px 3px rgba(0,0,0,0.25)`): a hairline lift on the switch handle so it reads as physical.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. The only elevation in the system is state-driven (an input focus ring, the switch knob) or a full tonal shift to a dark stage (Night panels). If you reach for a resting drop shadow on a card, you are off-system — use a hairline border or the next rung of the paper ladder instead.

## 5. Components

The controlling phrase is **quiet controls, loud moments**: operational controls stay restrained and familiar; theatrical weight is spent only on countdown, winner, and the booth board.

### Buttons
- **Shape:** Gently squared corners (12px, `--r-md`); the small variant uses 7px (`--r-sm`). Full-width by default in footers.
- **Primary (coral):** Spotlight Coral fill, white text, Space Grotesk 600 16px, padding 16px 22px. Hover deepens to #EC3743. The single most important action per screen — never two coral buttons competing.
- **Dark:** Ink fill, cream text — for destructive or terminal actions (`End Round`), hover #322C28.
- **Ghost:** Transparent with a 1.5px inset Line-3 border; hover tightens the border to Ink with a faint 3% ink wash. Secondary and tertiary actions.
- **Press feedback:** `transform: scale(0.985)` on `:active`; disabled drops to 0.4 opacity.

### Chips
- **Style:** Pill (100px), JetBrains Mono 11px uppercase, 0.1em tracking.
- **Variants:** `line` (inset hairline, grey — neutral metadata), `ink` (ink fill, cream text — strong status), `coral` (coral fill, white — emphasis), `coral-soft` (coral-tint fill, coral-ink text, coral-line inset — live/AI states). A pulsing 7px dot precedes "live" chips.

### Cards / Containers
- **Corner Style:** 18px (`--r-lg`) for cards; 12px for wells.
- **Background:** Paper (#FBF9F2) for cards; Paper Edge (#EFEBDF) for recessed wells.
- **Shadow Strategy:** None (see Elevation — flat by default).
- **Border:** 1px Line (#1F1B191F). Nested cards are forbidden; use a well or a hairline divider instead.

### Inputs / Fields
- **Style:** Paper background, Space Grotesk 600 ~22px, 1.5px Line-2 border, 12px radius, generous 18px padding.
- **Focus:** Border shifts to coral and a 3px coral-tint ring blooms (the only glow in the system).
- **Placeholder:** Grey Soft at 500 weight.

### Navigation
- App-shell column: a `screen-scroll` content area plus an optional sticky footer holding the primary action(s). Footers carry a 1px Line top border and a safe-area bottom inset (clears the home bar and the mobile keyboard via `100dvh`). Within sections, selection uses pill groups and segmented toggles, not a persistent nav bar.

### Crossword Cell (signature)
- Paper cells on an Ink 2px grid gutter, 4px container radius, Space Grotesk 600 letters. **Active** cell = Spotlight Coral, white letter. **In-word** path = Inword Highlight (#FBE9D2) warm wash. Cell numbers are 9px mono in Grey Soft (white at 85% on the active cell). **Selection backgrounds change instantly — no CSS transition** (transitions can stick mid-state in throttled webviews).

### LetterPad (signature)
- On-screen QWERTY for the player's solve, with DEL and a coral ✓ submit, mirroring physical-keyboard input. A custom affordance that is justified because the standard mobile keyboard can't drive a fixed-grid crossword.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Spotlight Coral for the single most important element on a view (per The Spotlight Rule). Everything else lives in ink, grey, and cream.
- **Do** build depth from the tonal paper ladder (cream → paper → paper-edge) and charcoal hairlines, not drop shadows.
- **Do** set all system text (timers, codes, labels, status) in JetBrains Mono, uppercase, 0.14em; use `tabular-nums` on every figure.
- **Do** keep big numbers dominant on the 16:9 booth display and nothing critical below ~14px — it is read across a room.
- **Do** collapse empty white-label brand fields cleanly (the `lockup` helper joins only non-empty parts) so the neutral default reads intentional, not unfinished.
- **Do** animate entrances transform-only (`riseIn` translateY 12→0, `popIn` scale .94→1) on the `cubic-bezier(.2,.7,.2,1)` curve with ~70ms child stagger.

### Don't:
- **Don't** use generic SaaS blue, the hero-metric template, or endless identical card grids (anti-reference: generic SaaS dashboard).
- **Don't** gamify: no confetti, cartoon mascots, badges/XP, rainbow palettes, or bouncy/elastic motion (anti-reference: gamified consumer app).
- **Don't** fall into Kahoot-style quiz clichés — saturated primary blocks, oversized emoji, playful-rounded everything (anti-reference: quiz-app clichés).
- **Don't** go cold, dense, or clinical gray (anti-reference: austere enterprise tool). The restraint here is warm and editorial.
- **Don't** use pure black (#000) — text and dark surfaces are Ink (#1F1B19) or Night (#181513).
- **Don't** put a CSS `transition` on any selection-state background (active cell, selected pill/tab) — set them instantly.
- **Don't** animate content in from `opacity: 0` — entrances are transform-only so content is never invisible if a timeline is throttled.
- **Don't** over-round: cards top out at 18px; reaching for 24/32px+ on a card is off-system.
- **Don't** spread coral as a fill or second emphasis. One spotlight per view.
