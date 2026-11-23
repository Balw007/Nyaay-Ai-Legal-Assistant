# Limitations, open findings and future proposals

## How this was tested, and what that means
- The sandbox could not reach the open-data S3 buckets, so real judgments were not loaded. Testing used the repo's
  three **fictional fixture judgments** (`NYAAI_DEMO=1`) and the labelled demo matters. Behaviour with tens of
  thousands of judgments (graph density, search lists) was not exercised in a browser.
- Ollama was not running, so every AI path was tested in its **no-AI state** (retrieval only, headnote unavailable,
  citations "found, not yet checked"). The AI-answer layouts were built against the documented response shapes but
  not rendered with a live model.
- Performance numbers come from headless Chrome with 4× CPU throttling on a server, a stand-in for a modest laptop,
  not a measurement on a real Intel Iris Xe machine. Single runs vary by ±150 ms.
- axe-core cannot fully judge contrast over translucent and gradient surfaces (it marks those "incomplete"). Token
  contrast was computed separately; a manual check with a real screen reader (NVDA/VoiceOver) was not done.
- The View Transitions morph works in Chromium browsers (Chrome, Edge). Firefox and older Safari fall back to an
  ordinary navigation by design.

## Known gaps in this branch
- The authority map shows judgments, courts and matters only. **Statutes and legal principles are not drawn** because
  the backend does not extract them. Large maps are capped at 24 links per expansion, with a count of what is not drawn.
- `/graph` on a phone works but is cramped; the Saved paragraphs view is the better tool on small screens.
- The rail opens on hover; some users may prefer click-only. Pinning is available.
- TBT rose on some screens (largest: command centre ~66 → ~235 ms under 4× throttle) because the shell, arrangeable
  grid and new panels add DOM and motion work. First loads on Research, Calendar and Settings are roughly 10–25%
  slower; scroll smoothness improved substantially (RESULTS.md).
- The legacy `/app` vanilla UI was not redesigned. A few legacy-only features remain only there: thumbs feedback,
  sync-all, an integrations status panel. WhatsApp replies still link to `/app/#/m/{id}/tasks`.

## Backend findings (not changed; each needs an owner's decision)
From the audit (appendix-capabilities.md), with file references there:
1. If Ollama is the embedder and stops mid-session, `/research/search`, `/research/ask` and the opposing check can
   return 500 (`vectors.py`, embedding call not caught).
2. Route options compute deadlines **without** holiday or closed-Saturday adjustment, while the Overview's stored
   deadlines include it. The two tabs can show different complaint deadlines for the same matter.
3. A citation check reports `method: "llm"` whenever the model looks available, even if every support check failed.
4. `PATCH /matters/{id}` has no role check: clerks can change stage and next date directly, bypassing approvals.
5. The firm setting `require_review` is stored and shown but enforced nowhere.
6. `brief.py` assumes order summaries are non-null.

## Future proposals (not implemented)
- Statute and principle nodes on the authority map, once the backend extracts sections cited per paragraph.
- Server-side persistence of the command-centre layout and recents (today: this browser only).
- Notes on paragraphs inside the reader (bookmarks have notes; inline display in the reader is not built).
- A dedicated agent-task API (start, progress, cancel) so long AI jobs such as bulk citation checks can be shown as
  inspectable tasks in Intelligence. Today only library jobs report progress, so only they are shown as running.
- Storybook and visual-regression snapshots for the glass components.
