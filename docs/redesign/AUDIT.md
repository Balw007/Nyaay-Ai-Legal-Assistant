# Repository audit and feature-preservation matrix

## Stack found
- **Backend:** FastAPI + SQLAlchemy (SQLite by default; Postgres via Docker), SQLite FTS5 judgment corpus with
  optional vectors (fastembed or Ollama embeddings), Ollama (default `qwen3:8b` / `qwen3:4b`) or Anthropic for AI,
  Tesseract OCR. 151 tests.
- **Frontend:** Next.js 16 App Router, React 19, Tailwind 4, Motion 14, cmdk, React Query 5, sonner, Lucide.
  `/api/*` is proxied to FastAPI (same origin, cookie session). A legacy vanilla UI is still mounted at `/app`.
- **Animation library already present:** Motion. It was kept; the only dependency added is `d3-force` (graph layout).

Full per-route matrix with every endpoint, query param, storage key and shortcut:
[appendix-feature-matrix.md](appendix-feature-matrix.md). Engine and no-AI behaviour of every capability:
[appendix-capabilities.md](appendix-capabilities.md).

## Preservation status
"Verified" means exercised in a browser against the running backend (RESULTS.md, workflow suite) or by screenshot.

| Route | Existing features | Status | How verified |
|---|---|---|---|
| `/login` | sign in, first-run chambers setup, invite acceptance, `?next=` | Preserved (restyled; fake constellation removed) | workflow: login |
| `/` | counts, 14-day rail, cause list, deadlines, stages, library, activity, recent searches | Preserved; counts now a sentence; panels arrangeable; intelligence and recents added | workflow: arrange + persist; screenshots |
| `/research` | search, Ask AI, court/year filters, pagination, URL state `q/court/from/to/offset/ask`, answer checks | Preserved; filters apply immediately; peek; morph | workflow: search, peek, reader |
| `/judgments/[id]` | `?para=` jump, find (Ctrl F), text size (`nyaay-reader-size`), copy with citation, save to matter, headnote, ask this judgment, citation graph, cited by, treatment warning, original PDF | Preserved; minimap, selection toolbar, tabbed panel; panel now reachable on phones | workflow: find, selection, ask prefill |
| `/matters`, `?new=1` | list, filters, test case, new matter | Preserved; rows morph into workspace | workflow: create matter |
| `/matters/[id]` | goal, stage rail, do-now/next, 8 tabs (overview, orders, tasks, drafts, notes, authorities, routes, parties), eCourts sync, client update, .ics, erase | Preserved; case timeline added; two broken `#p{n}` paragraph links fixed | workflow: palette → matter, tab keys |
| `/approvals` | queue, batch approve, select, reject, decision log | Preserved; bulk-approve label corrected (see below) | workflow: approve one |
| `/citations` | paste or upload, statuses, advocate confirm, export gate | Preserved | workflow: check citation |
| `/drafts`, `/drafts/[id]` | templates, editor, Ctrl S, polish, export | Preserved; polish suggestion set as machine text | screenshots |
| `/calendar`, `/clients`, `/library`, `/settings`, `/tools/convert` | unchanged logic | Preserved; converter accepts `?q=` | workflow: palette → converter |
| new `/graph` | Authority map + Saved paragraphs (restores bookmark list/edit/remove that only the old UI had) | Added | workflow: inspector, saved list |
| new `/intelligence` | live runtime, capabilities, job log, queue, automatic activity | Added | workflow: shows real AI state |

## Defects found during the audit
Fixed in this branch (frontend only):
1. Authorities tab and opposing-check panel linked to `#p{n}`, which the reader never handled → now `?para=`.
2. Saved paragraphs could be created but never listed in the new UI → Saved paragraphs view.
3. "Approve all safe" tooltip said client messages are excluded, but the backend's `safe_ids` includes order-created
   "Send client update" reminders (`action == null`) → relabelled "Approve all without date or stage changes" with an
   accurate tooltip. The backend rule itself was not changed.
4. Theme choice was overwritten on reload in development (Strict Mode double effects) → saved only on toggle.

Backend issues found and **not** changed (they touch behaviour or legal rules; listed for a decision):
see LIMITATIONS.md, "Backend findings".

## Legal business rules: confirmed untouched
Deadline computation (`services/playbook.py` `compute_deadlines`, `add_period`, `add_months`), holiday adjustment
(`services/deadlines.py` `recompute`, `next_open_day`, `is_closed`), citation extraction/normalisation/resolution and
the export gate (`services/citations.py`), citator treatment (`services/citator.py`), order reading rules
(`services/order_reader.py`) and the IPC→BNS table. `git diff main -- app tests` is empty. The UI never computes a
legal date; the case timeline only places backend dates on an axis.
