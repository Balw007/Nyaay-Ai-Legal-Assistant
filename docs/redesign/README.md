# Nyaay — Liquid Intelligence redesign

Branch `liquid-intelligence`. Frontend only: no backend file, API contract, database behaviour, deadline rule or
citation rule was changed. All 151 backend tests pass unchanged.

## What changed, in one paragraph
Nyaay moved from a dark SaaS dashboard (solid sidebar, uniform cards) to a layered workspace: a floating glass rail
whose active light glides between destinations, a floating command bar that knows which workspace you are in, a
command palette that searches, opens, converts sections and asks, and workspaces that morph into one another
(a search result becomes the judgment reader; a matter row becomes the matter workspace). Two new workspaces,
the **Authority map** and **Intelligence**, show only what the backend actually records and reports.

## Documents
| File | What it covers |
|---|---|
| [AUDIT.md](AUDIT.md) | Repository audit, feature-preservation matrix with status, defects found |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Identity, colour and type semantics, the five glass levels, components |
| [MOTION.md](MOTION.md) | Motion language, tokens, shared-element transitions, reduced motion |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Spatial interface architecture, files, data flow, what is grounded where |
| [RESULTS.md](RESULTS.md) | Build, tests, 26 end-to-end workflows, accessibility, before/after performance |
| [RED-TEAM.md](RED-TEAM.md) | The independent critique and what was done about each point |
| [PHASE-2-AGENTS-AND-LOOK.md](PHASE-2-AGENTS-AND-LOOK.md) | Phase 2: real agents, the command-centre look, cursor-following glass, navigation bar, logo and welcome |
| [LIMITATIONS.md](LIMITATIONS.md) | What is not done, backend issues found, future proposals (clearly separated) |
| `appendix-*.md` | Full audit agent outputs and the red-team report, unedited |
| `screenshots/` | Before and after, dark, light and 390 px mobile (WebP) |

## Implemented (tested) vs proposed
Everything listed under "Implemented" in ARCHITECTURE.md was exercised in a browser against the running backend
(RESULTS.md). Anything that is an idea and not built is in LIMITATIONS.md under "Future proposals" and nowhere else.

## How it was built
Agent Teams were not available in this environment. The work used the fallback the brief allows: a director
(design, motion, code, integration), a read-only audit subagent (legal workflow + frontend architecture), and an
independent red-team critic subagent that judged rendered screenshots without seeing the implementation reasoning.
One editor wrote code, so no two agents edited the same files.

## Run it
Unchanged: `start-nyaay.bat` / `./start-nyaay.sh`. New dependency: `d3-force` (graph layout only, loaded only on
`/graph`). Everything else uses what the project already had (Next 16, React 19, Tailwind 4, Motion, cmdk,
React Query, Lucide).
