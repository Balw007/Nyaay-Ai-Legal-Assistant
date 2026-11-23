# Spatial interface architecture

## Layers
```
L1  .atmosphere (fixed, aria-hidden)                         providers.tsx
L2  Rail (fixed, left)   CommandBar (sticky, top)   Dock (fixed, bottom, phones)
L3  Workspace (template.tsx entrance) → panels, results, reader
L4  Palette · Drawer sheets · Peek · Selection toolbar · Map inspector · Shortcuts
L5  active item inside any of the above
```
Business logic stayed where it was: every screen still calls the same endpoints through `lib/api.ts` (same-origin
`/api` proxy, cookie session, `X-Requested-With` header, 401 → `/login?next=`). The redesign added presentation,
navigation and composition only.

## Files added
| File | Role |
|---|---|
| `lib/motion.ts` | motion tokens |
| `lib/transition.tsx` | `TransitionProvider`, `useNavigate`, `MorphLink` (shared-element navigation) |
| `lib/recent.ts` | recently opened judgments/matters, this browser only (localStorage `nyaay-recent`) |
| `components/shell/nav.ts` | one navigation model for rail, dock, palette and shortcuts |
| `components/shell/rail.tsx`, `command-bar.tsx`, `dock.tsx`, `shortcuts.tsx`, `specular.tsx` | the shell |
| `app/(app)/template.tsx` | workspace entrance |
| `app/(app)/graph/page.tsx`, `components/graph/authority-graph.tsx` | Authority map + Saved paragraphs |
| `app/(app)/intelligence/page.tsx` | Intelligence centre |
| `components/visuals/case-timeline.tsx` | matter case timeline |

Removed: `shell/sidebar.tsx`, `shell/topbar.tsx` (replaced), `visuals/constellation.tsx` (a random decorative
"citation network" that represented no data).

## Workspaces, and what each one is grounded in
| Workspace | Grounded in (endpoint) | New interactions |
|---|---|---|
| Command centre `/` | `/dashboard`, `/calendar`, `/health` | situation sentence with linked counts; arrangeable/hideable panels (localStorage `nyaay-home-layout`); intelligence panel; recently opened |
| Palette (Ctrl K, /) | `/search` | recents, contextual actions on a judgment (find, ask, headnote), IPC/CrPC section detection → converter, Ask mode, theme, shortcuts |
| Research `/research` | `/research/stats`, `/research/search`, `/research/ask`, `/judgments/{id}` | centred field docks on search; court filter column; peek in context; morph into reader; AI answer marked "not verified", model confidence labelled as the model's own |
| Reader `/judgments/[id]` | `/judgments/{id}`, `/links`, `/summary`, `/research/ask` (jid), `/bookmarks` | paragraph minimap with reading position, cited paragraph and find hits; selection toolbar (copy with citation, ask about passage, similar, save); tabbed intelligence panel (headnote, ask, network, cited by), available on every screen size |
| Matter `/matters/[id]` | `/matters/{id}`, `/playbooks/{type}` | morph-in header; **case timeline** in three lanes: entered by you (facts), calculated by rule (deadlines as returned by the backend), from the court (orders, next hearing), with today marked and an accessible list beneath |
| Authority map `/graph` | `/bookmarks`, `/matters`, `/judgments/{id}/links`, `/judgments/{id}`, `/search` | seeded from saved paragraphs, recently opened and `?focus=`; expand a judgment to fetch its links; edges coloured by treatment with citing paragraph numbers; filters, focus mode, inspector, keyboard-focusable nodes; counts of citations not drawn |
| Saved paragraphs (in `/graph`) | `GET/PATCH/DELETE /bookmarks` | restores a feature only the old UI had: list, edit note, remove (with confirmation) |
| Intelligence `/intelligence` | `/health`, `/library/status` (polls every 2 s while a job runs), `/approvals/queue`, `/activity` | runtime cards (local AI, library, meaning search, OCR); capability table derived from each feature's audited engine; running job with live log and stop; proposals waiting; work done by Nyaay |

Nothing on any screen is simulated: no fake agents, progress, confidence or relationships. Statutes and legal
principles are not drawn on the map because the backend does not extract them (LIMITATIONS.md).

## Accessibility architecture
Skip link; `main` landmark focus target; every floating surface is `role=dialog` with focus trap, Escape, and focus
return; tabs and segmented controls are proper `tablist`/`radiogroup` with arrow keys; rail labels stay in the
accessibility tree when collapsed; graph nodes are focusable buttons with descriptive labels and an inspector list;
the timeline has a text list equivalent; live regions announce search counts, find results and job logs.
