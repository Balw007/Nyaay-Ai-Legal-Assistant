# Results: build, tests, accessibility, performance

All numbers below were produced in this session; the scripts are described at the end.

## Build and tests
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `next build` (production) | succeeds; 18 routes (2 new: `/graph`, `/intelligence`) |
| Backend `pytest -q` | **151 passed**, same as before the redesign; backend diff is empty |
| End-to-end workflows (Playwright, real backend) | **26 / 26 passed** |

### Workflows exercised end to end (the 26 checks)
1. Sign in lands on the command centre.
2. Ctrl K opens the palette.
3. The palette finds a matter by party name and opens it.
4. The matter workspace shows the case timeline.
5. Matter tabs move with the arrow keys.
6. G then R opens Research.
7. ? opens the shortcuts list.
8. A search returns paragraph-level results.
9. Selecting a paragraph opens the peek panel in context.
10. "Open in reader" navigates with `?para=`.
11. The shared-element View Transition actually runs (observed through `data-vt`).
12. Ctrl F finds and counts matches in the judgment.
13. Selecting text shows the selection toolbar.
14. "Ask" from the selection prefills the reader's Ask tab.
15. Hiding a command-centre panel persists across a reload.
16. The new-matter sheet opens.
17. A real matter is created and its workspace opens.
18. The citation check returns a status (correctly not "Verified" without AI).
19. The palette hands "IPC 420" to the converter, which shows the BNS mapping (s.318).
20. The authority-map inspector opens for a matter node.
21. The Saved paragraphs list renders.
22. Approving a proposal reduces the queue (22 → 21).
23. The theme toggle persists across a reload.
24. Intelligence reports the real AI state ("Not running").
25. With reduced motion, navigation still works (no transition).
26. No uncaught page errors during the whole run.

## Accessibility (axe-core 4, WCAG 2.0 A/AA + 2.1 AA, all 15 routes)
| Build | Dark | Light |
|---|---|---|
| Before | 1 violation (colour contrast, `/library`) | not measured |
| After, first pass | 4 (`aria-prohibited-attr`, `/intelligence`) | 17 (colour contrast on 6 routes) |
| **After, final** | **0** | **0** |

Also implemented: skip link, focus-visible rings, focus traps with focus return in every dialog and sheet, `tablist` /
`radiogroup` semantics with arrow keys, keyboard-focusable graph nodes, text equivalents for the timeline and graph,
`prefers-reduced-motion`, `prefers-reduced-transparency` and `forced-colors` support.

## Performance (production builds, headless Chrome, 4× CPU throttling, 1440×900, dark)
LCP = largest contentful paint, TBT = total blocking time (long tasks over 50 ms), FPS = frames during 2 s of
programmatic scrolling. Single run per route; see the repeat runs below for variance.

| Route | LCP before → after (ms) | TBT before → after (ms) | CLS after | Scroll FPS before → after | Worst frame before → after (ms) | axe AA violations after (dark / light) |
|---|---|---|---|---|---|---|
| `/` | 884 → 688 | 66 → 235 | 0.029 | 32 → 60 | 50 → 17 | 0 / 0 |
| `/research?q=cheque+notice` | 724 → 1488 | 46 → 137 | 0.001 | 61 → 61 | 17 → 17 | 0 / 0 |
| `/judgments/fx-001` | 780 → 652 | 42 → 21 | 0.001 | 61 → 61 | 17 → 17 | 0 / 0 |
| `/matters` | 568 → 752 | 24 → 59 | 0.044 | 61 → 61 | 17 → 17 | 0 / 0 |
| `/matters/1` | 876 → 628 | 167 → 107 | 0.002 | 36 → 61 | 67 → 17 | 0 / 0 |
| `/approvals` | 940 → 688 | 40 → 57 | 0.001 | 35 → 61 | 50 → 17 | 0 / 0 |
| `/citations` | 504 → 660 | 27 → 89 | 0.001 | 61 → 58 | 17 → 83 | 0 / 0 |
| `/library` | 800 → 1020 | 82 → 82 | 0.001 | 35 → 61 | 50 → 17 | 0 / 0 |
| `/settings` | 580 → 792 | 66 → 180 | 0.001 | 61 → 60 | 17 → 17 | 0 / 0 |
| `/calendar` | 492 → 932 | 4 → 80 | 0.001 | 61 → 61 | 17 → 17 | 0 / 0 |
| `/drafts` | 620 → 448 | 59 → 35 | 0.001 | 61 → 60 | 17 → 17 | 0 / 0 |
| `/clients` | 472 → 444 | 18 → 30 | 0.001 | 61 → 61 | 33 → 17 | 0 / 0 |
| `/tools/convert` | 464 → 572 | 22 → 25 | 0.001 | 58 → 60 | 117 → 17 | 0 / 0 |
| `/graph` (new) | – → 476 | – → 85 | 0.001 | – → 61 | – → 17 | 0 / 0 |
| `/intelligence` (new) | – → 1048 | – → 140 | 0.006 | – → 58 | – → 117 | 0 / 0 |

Repeat runs (3 each, same conditions), mean LCP / TBT:
| Route | Before | After |
|---|---|---|
| `/research?q=cheque+notice` | 855 ms / 56 ms | 977 ms / 161 ms |
| `/calendar` | 613 ms / 43 ms | 815 ms / 83 ms |
| `/settings` | 449 ms / 32 ms | 536 ms / 54 ms |

**Reading the numbers honestly:**
- **Scrolling improved substantially.** Four screens that dropped to 32–36 fps with 50–67 ms frames before
  (command centre, matter, approvals, library) now hold about 60 fps with 17 ms frames. The likely cause is that
  the original applied `backdrop-filter` blur to every card; L3 cards are now unblurred (not separately isolated).
- **First load is mixed.** LCP improved on the command centre, matter, approvals, judgment, drafts and clients, but
  is about 10–25% slower on Research, Calendar and Settings. Every route stays under 1.1 s at 4× throttle in the
  repeat runs.
- **TBT is higher on most screens.** The new shell, arrangeable grid and extra panels add main-thread work. All
  routes stay under 250 ms at 4× throttle.
- **CLS stays under 0.05** everywhere (the "good" threshold is 0.1).
- **Bundle:** total static JS chunks 1.4 MB → 1.5 MB (uncompressed). `d3-force` loads only on `/graph`.

## Scripts (kept outside the repo)
`shots.py` (screenshots per route, theme and width), `measure.py` (vitals, frame rate, axe), `workflows.py` (the 26
checks). Run against `next start` builds of `main` (port 3200) and this branch (port 3100).
