# Motion system

Principle: motion answers a person's action and shows what changed. There is exactly one ambient motion (the slow
light pool in the atmosphere) and one orchestrated moment (the seal lighting up on the sign-in screen).

## Tokens (`src/lib/motion.ts`, mirrored as CSS variables in `globals.css`)
| Token | Value | Used for |
|---|---|---|
| `spring.snappy` | stiffness 520, damping 40, mass 0.7 | indicators, toggles, tab underline, rail active light, segmented control |
| `spring.smooth` | 320 / 34 / 0.9 | panels, sheets, the rail width, peek and inspector |
| `spring.gentle` | 190 / 28 / 1 | large surfaces, layout reflow, graph-adjacent panels, arranging the command centre |
| `ease.out` | cubic-bezier(.16,1,.3,1) | tweens and CSS transitions |
| `dur` | 120 / 200 / 320 / 520 ms | instant, quick, base, slow |
| `enterWorkspace` | opacity .4 → 1, y 8 → 0, 320 ms | arriving at a workspace (starts visible so the largest paint is not delayed) |
| `floatIn`, `sheetIn` | spring.smooth | L4 surfaces growing from their origin; side sheets |

## Shared-element transitions (`src/lib/transition.tsx`)
`MorphLink` / `useNavigate()` wrap the View Transitions API:
1. `prepare()` prefetches the destination's data into the React Query cache (capped at 250 ms), so the destination
   hero exists when the new snapshot is taken.
2. The clicked element (or its `[data-morph]` ancestor) gets `view-transition-name: vt-hero`; the destination's
   `.vt-hero` header already carries it. Old heroes are neutralised first to avoid duplicate names.
3. The route is pushed; the update resolves when the new pathname commits (+1 frame), or after 600 ms at most.
4. The rail and command bar have stable names (`vt-rail`, `vt-bar`) so they never cross-fade.

Wired today: research result → judgment reader; source in an AI answer → reader; peek panel → reader;
matter row → matter workspace; cause list and recently opened → matter/judgment. Unsupported browsers and
reduced-motion users get a normal navigation (verified by test).

## Morphing interfaces
- Research: the search field is one `layoutId` surface. Centred and large at rest, it docks to the top when results
  arrive. Selecting a paragraph opens a **peek** sheet with the paragraph in context; "Open in reader" morphs into the reader.
- Rail: collapsed icons widen into labels (140 ms hover intent so passing across does nothing); the L5 active light
  glides between items. Pinning keeps it open and the content reflows.
- Tabs and segmented controls: the lit indicator glides (`layoutId`).
- Command centre: "Arrange" turns panels into a reorderable list (drag via `Reorder`, or arrow buttons for keyboard
  users); the grid reflows with `spring.gentle`. The layout is saved per browser.
- Reader: paragraph actions expand in place; the intelligence panel slides in and its tabs cross-fade.

## Reduced motion
`<MotionConfig reducedMotion="user">` disables transform animation globally; the CSS block collapses animation and
transition durations; View Transitions are skipped; the graph layout is computed synchronously (260 ticks) and drawn
once instead of settling.

## Removed after review
A 520 ms full-page `filter: blur()` entrance and 700/900 ms morph waits were cut after the red-team review and
measurement: they delayed the largest paint and made navigation feel slow.
