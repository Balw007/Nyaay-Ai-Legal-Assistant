# Design system: Liquid Intelligence

## Concept: chambers at night
A lit desk in a dark room. Light is the only ornament, and every light means something. The memorable element is
the light itself: a specular sheen that follows the pointer across glass, and workspaces that morph into each other.
Everything else is quiet. Nyaay's identity comes from its own subject (the brass seal of न्याय, the court's
serif, the red tape of deadlines), not from imitating any operating system.

## Colour is meaning
| Token | Dark | Light | Means |
|---|---|---|---|
| `paper` / `night-2` | `#05080f` / `#0a1222` | `#f3f2ee` / `#e9e8e2` | the room (midnight to deep navy; frosted ivory to warm white) |
| `brass` | `#e3c07a` champagne | `#77530e` muted gold | authority: sourced citations, and the one primary action on a screen |
| `leaf` | `#5fd3a0` | `#1a7349` | verified, approved, done. Citation **VERIFIED is leaf, never brass** |
| `cyan` / `electric` | `#6fd3ee` / `#5b8cff` | `#0e6178` / `#2f5fd0` | anything the machine produced or is doing |
| `amber` | `#f2c45a` | `#8a5900` | needs a person to check: test data, unconfirmed dates, partial results |
| `tape` | `#ff7a6b` | `#bf3a2c` | deadlines and negative treatment only |
| `platinum` | `#c9d1de` | `#6b7486` | courts and neutral structure |

All text tokens meet WCAG AA (4.5:1) on the page and panel backgrounds; values were computed, not eyeballed
(`faint` was raised from 3.36:1 to 4.7:1 in light mode after the red-team review).

## Type is meaning
- **Literata** (serif, display optical size for headings): page titles and **the court's own words**. Judgment text,
  quoted paragraphs and saved excerpts are serif.
- **IBM Plex Sans + Devanagari**: the interface, and **everything a machine wrote**. AI answers, headnotes and polish
  suggestions are sans with a cyan rule, so an AI sentence can never be mistaken for a quotation from a judgment.
- **Sora**, tabular figures (`.tnum`): counts, dates, deadlines, paragraph numbers.
- Scale: 14 px base, minor third; display sizes 2.5 rem and 3.25 rem. Body line length kept under ~74ch in the reader.
- No all-caps eyebrows; sentence case everywhere.

## The five glass levels
Blur is spent only where content scrolls underneath. That is the core performance decision.

| Level | Class | Used for | Treatment |
|---|---|---|---|
| L1 atmosphere | `.atmosphere` | the room | three fixed light fields, one slow transform-only drifting pool, a fading drafting grid |
| L2 primary | `.glass-2` | rail, command bar, mobile dock | `backdrop-filter: blur(22px) saturate(165%)`, top inner highlight |
| L3 secondary | `.glass` / `.glass-3` | panels, cards, results | **no blur**: tinted fill + top sheen; cheap on long pages |
| L4 floating | `.glass-4` | palette, sheets, peek, selection toolbar, inspector | blur(28px), raised float shadow |
| L5 active | `.glass-5` | the selected tool or destination | brass-lit fill with inner ring and glow |

Shared by all levels: a 1 px **gradient rim** (bright where the lamp catches the top edge), drawn with a masked
pseudo-element so it costs no layout. `data-specular` surfaces get a pointer-tracked sheen from one delegated,
rAF-throttled listener (`components/shell/specular.tsx`) writing three CSS variables, with zero React re-renders,
disabled for coarse pointers. `prefers-reduced-transparency` swaps glass for solid surfaces; `forced-colors` drops
rims and sheen for plain borders. The material lives in `@layer components` so Tailwind utilities still win.

Radius follows hierarchy: 5 px badges, 8 px controls, 14 px cards, 20–26 px floating chrome.

## Components (src/components)
- `ui/misc.tsx`: `Panel` (`level`, `lit`), `PanelHeader`, `PageHeader` (editorial, `hero` = morph target),
  `Tabs` (gliding lit indicator, arrow keys), `Segmented`, `Badge`, `Kbd`, `Spinner` (breathing light),
  `Skeleton` (shimmer), `Empty`, `ErrorNote`.
- `ui/button.tsx`: `primary` (brass), `secondary`, `ghost`, `brass`, `danger`, and `ai` (cyan, for actions that run the model).
- `matters/modal.tsx` `Drawer`: floating L4 sheet with focus trap and focus return.
- `shell/*`: rail, command bar + AI orb, palette, dock, shortcuts, specular, seal/boot.
- `visuals/case-timeline.tsx`, `graph/authority-graph.tsx`: see ARCHITECTURE.md.
