# Nyaay — AI / automation capabilities, degraded behaviour, response shapes, legal rule locations

Read-only audit of `/home/claude/nyaay/app` (2026-11-23). `file:line` refers to `app/...`.

## 0. The AI plumbing (applies to every capability below)

- **Provider selection** `services/llm.py:198-222` `get_llm()`: `NYAAI_LLM=ollama` (default, `config.py:20`) → `OllamaLLM` only if Ollama answers `/api/tags` *and* has `MODEL` (`qwen3:8b`) or `MODEL_FAST` (`qwen3:4b`) installed (`llm.py:213-217`); `anthropic` → `AnthropicLLM`; otherwise `NullLLM` (`available=False`, `llm.py:31-32`).
  - A `NullLLM` is re-checked every 60 s (`llm.py:203-205`), so starting Ollama later is picked up without restart.
  - **An `OllamaLLM`, once created, is cached even if Ollama later stops**: `available` stays `True`, and each call fails only after up to 4 attempts with memory-freeing retries and 1.5 s sleeps (`llm.py:145-173`), raising `RuntimeError`. Every feature below catches that and degrades as described, but the degraded path is *slower* and some labels claim AI was used (see citation check).
  - Ollama calls force JSON mode and `think:false` (`llm.py:117-121`); temperature 0.1.
- **Per-firm gateway** `services/ai.py:104-108` `firm_llm(db, firm_id, feature)`: returns `NullLLM` if the base model is unavailable; otherwise `FirmLLM` (`ai.py:48-101`) whose `available = base.available and settings.ai_enabled` (`ai.py:53`). It enforces the **monthly token budget** (`BudgetExceeded`, `ai.py:57-59`), **PII redaction/restoration** when `redact_pii` (`ai.py:78-79`, patterns `services/security.py:79-85`: Aadhaar, PAN, email, phone, IFSC, account no.), and usage logging (`ai.py:61-68`). Strong model only for features `answer` and `polish`; everything else uses the fast model (`ai.py:21`, `ai.py:55`).
- **Status reporting** `services/llm.py:225-237` `llm_status()` re-pings Ollama on every call, so `/health.ai.ready` correctly shows offline even when a stale `OllamaLLM` is cached.

---

## 1. Capability-by-capability

### 1.1 Research search — `GET /research/search`
- Route `routes/research.py:49-56` → `Store.search` `services/store.py:429-444` → `Store.hybrid` `store.py:396-427`.
- **Engine**: SQLite FTS5 BM25 over paragraphs (`porter unicode61`, `store.py:35-39`) with a legal **synonym table** (`store.py:50-62`) and safe query builder `fts_query` (`store.py:81-96`); tries AND, falls back to OR (`store.py:401-405`; response `match: "and"|"or"`). If paragraph vectors exist and an embedder is available, results are fused with semantic cosine ranking by reciprocal rank (k=60, cosine cut-off 0.35) (`store.py:406-427`; `match: "hybrid"|"semantic"`). Grouped to judgments, ≤2 hit snippets each, treatment counts per result (`store.py:432-443`). Logs search history on first page (`research.py:54-55`).
- **No LLM is used** (re-ranking applies only to Ask).
- **Ollama down**: keyword search works. Caveat — semantic part: `vectors.get_embedder()` (`services/vectors.py:64-78`) caches `False` forever if neither fastembed nor the Ollama embed model was reachable on first use (semantic silently off until restart). Conversely, if an `OllamaEmbedder` was created and Ollama later stops while vectors exist, `vectors.search` calls `e.embed_query(q)` **outside** its try block (`vectors.py:157`), and `Store.hybrid` does not catch it (`store.py:406`) → `/research/search` (and `/research/ask`, opposing check) would return **HTTP 500**. `GET /search` (palette) is wrapped in try (`routes/workspace.py:458-461`).

### 1.2 Research ask — `POST /research/ask`
- Route `routes/research.py:59-81`; service `services/research.py:88-122`.
- **Retrieval** `research.py:38-72`: `Store.hybrid` (as above), ≤3 paragraphs per judgment, top 10; optional **LLM re-rank** of a 24-paragraph pool when AI available, `rerank` setting on and no `jid` (`research.py:43`, `:53-63`, feature `rerank`, fast model). Each source carries `treatment` (`negative|caution|positive|cited|none`) (`research.py:67-71`).
- **Generation**: strong model (`answer`), system prompt requires `[S#]` markers and JSON `{answer, confidence, limitations}` (`research.py:19-27`, `:107-108`). Sources with negative/caution treatment are flagged to the model (`:101-106`).
- **Deterministic post-check** `verify_answer` (`research.py:75-85`): removes `[S#]` markers outside 1..n, lists sentences >60 chars without a marker as `uncited_sentences`; confidence forced to `low` if markers were invalid or nothing was cited (`:116-118`).
- **Cache**: identical (normalized question, jid, court, years, paragraph count) answers reused for 7 days per firm (`routes/research.py:66-78`); only `mode=="answer"` is cached; response then has `cached:true`. Purged by `POST /firm/purge-ai-cache` (`routes/admin.py:199`).
- **Modes**: `no_sources` (nothing retrieved, `:93-96`), `retrieval_only` (LLM unavailable `:97-100`, or LLM step failed/empty `:112-114` incl. `BudgetExceeded`), `answer` (`:119-122`).
- **Ollama down**: returns `retrieval_only` with the retrieved paragraphs and a message; HTTP 200 (subject to the embedder caveat in 1.1).

### 1.3 Judgment summary / headnote — `POST /judgments/{jid}/summary`
- Route `routes/research.py:100-105`; service `services/research.py:133-155`.
- **Engine**: fast model (feature `summary`) on the first 8 + last 5 paragraphs (`:141-143`), JSON `{issues, held, disposition, key_paragraphs}` (`:125-130`). Key paragraph numbers are validated against the judgment (`:149-152`). Result is **stored in corpus.db** (`store.set_summary`, `:154`) and returned as `mode:"cached"` thereafter (`:137-138`) — shared across firms, not purged by the AI-cache purge.
- **Modes**: `cached`, `generated`, `none` ("Start Ollama to generate summaries." `:139-140`), `failed` (`:147-148`); `not_found` → 404.
- **Ollama down**: `mode:"none"` (or `failed` if a stale Ollama client is cached); reader shows the message in amber.

### 1.4 Ask-this-judgment (reader `AskThis`)
- Frontend `web/src/app/(app)/judgments/[id]/page.tsx:288` calls **`POST /research/ask` with `{question, jid}`** — the same endpoint as 1.2.
- With `jid`: retrieval restricted to that judgment (`store._where` `store.py:369-370`; semantic rows filtered `store.py:413`); **no re-rank** (`research.py:43`); not written to search history (`routes/research.py:79-80`); cached like any answer (key includes jid).
- **Ollama down**: `retrieval_only` — UI shows message and the matched paragraph numbers as jump chips.

### 1.5 Citation check — `POST /citations/check`, `POST /citations/check-file`
- Routes `routes/citations.py:32-45` (`_run`), `:48-50`, `:53-60`; service `services/citations.py:267-331` `check_text`, `:334-343` `summarize`.
- **Deterministic parts**:
  - Extraction: 10 regex reporter patterns — INSC, SCC OnLine, SCC, SCR, AIR, SCC (Cri/Civ/L&S/Tax), SCALE, MANU, CriLJ, HC neutral (`citations.py:30-41`); overlap removal, sentence span = **proposition**, case name from text before the citation (`v.` / `vs.`) (`:99-146`).
  - Normalization `_normalize` (`:48-68`) / `normalize_any` (`:80-85`).
  - Resolution against the library `StoreIndex.resolve` (`services/store.py:516-524`): exact normalized citation via `cite_index` (incl. harvested **parallel citations**, `store.py:271-286`), else title match ≥0.7 (`name_only`).
  - Case-name sanity `name_match` (`citations.py:170-173`): <0.5 → `CITATION_MISMATCH`.
  - Paragraph location: in-memory BM25 of the proposition against the judgment's paragraphs, top 2 (`:176-193`, `:314-316`).
  - Export gate `summarize`: `can_export` only when every item is `VERIFIED` **or** `advocate_confirmed` (`:334-343`).
  - Advocate confirmation `POST /citations/{id}/items/{index}/confirm` (advocate+; records `confirmed_by` = name + enrolment; audit with status at confirmation) (`routes/citations.py:76-90`).
- **LLM part (only)**: `judge_support` (`citations.py:252-264`, feature `support`, fast model) returns `supports|partly|does_not_support`.
- **External lookup**: for citations not in the library, **Indian Kanoon API** (`services/indiankanoon.py:39-53`), only if `INDIANKANOON_TOKEN` is set (`:21-22`); sends only the citation and case name. Every item also gets a public `search_url` (`:17-18`).
- **Statuses** (`citations.py:23-28`) and when they are set:
  - `VERIFIED` — in library, name consistent, LLM verdict `supports` (`:319-320`). **Never without an LLM.**
  - `EXISTS_UNCHECKED` — in library, LLM verdict `partly` (`:324-326`) or no verdict / LLM unavailable / LLM failed (`:327-329`).
  - `EXISTS_NOT_SUPPORTED` — LLM verdict `does_not_support` (`:321-323`).
  - `CITATION_MISMATCH` — resolved by name only (`:302-306`), draft name vs library title <0.5 (`:307-312`), or Indian Kanoon title vs draft name <0.5 (`:289-292`).
  - `FOUND_EXTERNALLY` — not in library but Indian Kanoon returned a doc; item gets `external: {tid,title,docsource,url,headline}` and `judgment_title` (`:287-294`).
  - `NOT_IN_LIBRARY` (constant name `NOT_FOUND`) — default (`:27`, `:295-297`).
- **check-file**: text via `services/ocr.py:335-338` `extract_text` (text layer for PDF/DOCX/TXT; Tesseract for scans if installed — **no vision-model fallback here**); unsupported/OCR-unavailable → 422 (`routes/citations.py:56-59`).
- Response `method` = `"llm"` if `llm.available` else `"rules"` (`routes/citations.py:40`) — **based on availability, not on whether support checks succeeded**; with a stale Ollama client the UI says "support checked by your local AI" though items are `EXISTS_UNCHECKED` with reason "Support check failed (RuntimeError)".
- **Ollama down**: every library hit is `EXISTS_UNCHECKED` (support `method:"none"`), `can_export` false until an advocate confirms each; NOT_IN_LIBRARY / FOUND_EXTERNALLY / CITATION_MISMATCH unaffected.

### 1.6 Order reading / intake — `POST /matters/{id}/orders` (also WhatsApp inbound and eCourts sync)
- Route `routes/orders.py:51-69` → `services/order_intake.py:64-104` `intake` → `services/order_reader.py:118-164` `read_order` → `routes/orders.py:20-48` `propose_tasks`.
- **Text acquisition** `order_intake.py:37-61` `file_to_text`: PDF text layer → Tesseract OCR (eng/hin/mar as installed; `services/ocr.py:249-300`, low-confidence pages <70 %, `ocr.py:22`) → **vision model** per page (Ollama only if `OLLAMA_VISION_MODEL` installed and only for images/rasterised pages, `order_intake.py:28-34`, `llm.py:180-191`) → for non-Ollama providers, whole-file AI transcription (`order_intake.py:50-58`). OCR/AI-transcribed text adds a "check dates and names" review note plus per-page low-confidence notes (`order_intake.py:81-92`).
- **Duplicate guard**: SHA-256 of normalized text per matter → `duplicate:true`, no new tasks (`order_intake.py:74-77`).
- **Deterministic (always)**: order date, next date (cue phrases "adjourned to", "next date"…, Indian day-first dates) (`order_reader.py:38-89`); rule-based summary + directions (`:98-102`); **stage detection from playbook keywords** `pbk.detect_stage` (`services/playbook.py:113-126`), confidence 0.45 + 0.15·hits capped 0.9; review warnings (no next date, next < order date, low stage confidence, very little text) (`order_reader.py:149-158`).
- **LLM (optional, fast model, feature `order`)**: replaces summary/directions and writes a client message in en/hi/mr; told not to invent dates (`order_reader.py:127-141`). **The LLM never sets dates or stage.** On failure: rules + review note.
- **What proposes tasks**: `propose_tasks` (`routes/orders.py:20-48`) — all `status:"proposed"`: `set_next_date` (if next date read), `set_stage` (if detected stage ≠ current and confidence ≥0.45), up to 5 "Comply with direction", up to 3 playbook "Suggested:" actions, "Send client update" (if a client message exists, `action=null`). Titles de-duplicated against existing proposed tasks.
- **Ollama down**: rules-only reading (`extraction_method:"rules"`), English template client message (+ note that hi/mr needs the LLM, `order_reader.py:105-115`); scanned images need Tesseract (else 422 "Could not read…").

### 1.7 Draft polish — `POST /drafts/{did}/polish`
- Route `routes/workspace.py:277-287`; service `services/drafting.py:180-197`.
- **Engine**: strong model (`polish`); returns `{body, changes[], problems[], accepted}`. **Deterministic guard**: blocks (`accepted:false`) if any `[[placeholder]]` was removed, any new citation appears (`extract_norms`), or any new number appears (`drafting.py:186-197`). Draft is never modified server-side.
- **Ollama down**: **HTTP 409** "AI is not available…" (`workspace.py:282-283`); failure during generation → **HTTP 502** (`:284-287`). Draft rendering itself (`drafting.py:135-167`, templates, `[[blank]]` placeholders) is fully deterministic.

### 1.8 Opposing-counsel check — `POST /matters/{id}/opposing-check`
- Route `routes/features.py:40-51`; service `services/opposing.py:26-72`.
- **Deterministic**: for each authority bookmarked to the matter, later citing judgments with `negative`/`caution` treatment from the citator (`opposing.py:28-39`); contrary paragraphs = `research.retrieve(position, k=16, per_judgment=2, rerank=False)` excluding saved authorities, flagged by a "contrary language" regex (`opposing.py:14-17`, `:41-48`).
- **LLM (optional, fast model, feature `opposing`)**: writes counter-arguments with `[S#]` markers, then the same `verify_answer` check (`:58-71`).
- **Ollama down**: `mode:"retrieval_only"` with adverse treatment + contrary sources and a message (`:49-57`, `:65-67`).

### 1.9 Client update — `POST /matters/{id}/client-update`
- Route `routes/features.py:61-85` (clerk+); service `services/client_update.py:27-71`.
- **Engine: fully deterministic templates** in English/Hindi/Marathi with localized month names (`client_update.py:12-19`), using only matter facts: client, title, court, last order date, next date, current stage, next unmet deadline, the user's own note (≤600) and advocate name. **No LLM.**
- Creates a **proposed** task (`action:"client_update"`, payload `{language, message}`); editable while proposed (`PATCH /tasks/{id}`, `routes/tasks.py:88-105`); shareable only after approval via `GET /tasks/{id}/share` → `wa.me/?text=` link (`features.py:88-97`, `client_update.py:74-77`). Nothing is ever sent by the server.
- **Ollama down**: unaffected.

### 1.10 Hearing notes — `POST /matters/{id}/hearing-notes`
- Route `routes/features.py:107-138`; service `services/hearing_notes.py:37-61`.
- Always saves the note (`features.py:115-117`). **Next date** is always rule-extracted (`order_reader.find_next_date`, `hearing_notes.py:39`) → proposed `set_next_date` if different from the matter's.
- **LLM (optional, fast, feature `hearing_notes`)**: tasks `{title, due_date}`; any due date **not literally present in the notes is dropped** with a review message (`hearing_notes.py:44-57`). Fallback/without AI: regex action-sentence rules (`hearing_notes.py:21-29`). Response `method: "ai"|"rules"`.
- **Ollama down**: rules; HTTP 201.

### 1.11 Route options — `GET /matters/{id}/routes`, `PUT /matters/{id}/goal`
- Routes `routes/features.py:148-165`, `:173-194` (goal: advocate+); service `services/route_options.py:23-48`.
- **Engine: deterministic**, from `playbooks/ni138.json` `routes` (3 routes: `notice_then_complaint`, `settle_with_notice`, `civil_recovery`). What-if query params (any playbook input name, ISO date) recomputed on the fly, never saved (`features.py:153-159`, `route_options.py:26-29`). Each route `draft = review status != "approved"` (`route_options.py:43-47`). **No LLM.**
- Note: route deadlines use `pbk.compute_deadlines` directly — **no holiday / closed-Saturday adjustment** (`route_options.py:26-27`), unlike the matter's stored deadlines (1.15). The banner text is the playbook's `deadline_note` ("court holidays are NOT applied").

### 1.12 Section converter (IPC→BNS etc.) — `GET /tools/convert`, `GET /tools/convert/table`
- Routes `routes/tools.py:15-24`; service `services/converter.py:70-116` `lookup`, `:41-55` `parse_query`, `:119-125` `browse`.
- **Engine: data-driven** table `app/data/ipc_bns.json` (`meta`, `acts` 7, `mappings` 294, `omitted` 4, `new` 6, `unchanged` 1), described as copied from MHA comparison summaries (`converter.py:1-6`). Act aliases (`:15-23`), sub-section exact vs. base match (`:83-98`), NI Act → "unchanged" (`:79-82`). **No AI.** Ollama irrelevant.

### 1.13 Semantic / vector search (embeddings)
- `services/vectors.py`. Embedder: `fastembed` (`BAAI/bge-small-en-v1.5`) if installed, else Ollama `nomic-embed-text` with `search_document:`/`search_query:` prefixes (`vectors.py:28-61`, selection `:64-78`, `NYAAI_EMBED=auto|fastembed|ollama|none` `config.py:70`). Vectors in `corpus.db.para_vec` float32, exact cosine via numpy (`:106-163`). Built automatically after library loads (`routes/library.py:75-81`) or `POST /library/embed` (admin; 409 if no embedder, `library.py:153-158`). Status `vectors.status` (`:98-103`).
- **Ollama down**: with fastembed — unaffected. With Ollama embedder — see caveats in 1.1 (first-use failure disables until restart; mid-session failure can 500 search/ask).

### 1.14 eCourts sync — `POST /matters/{id}/sync`, `POST /sync/all`
- Routes `routes/integrations.py:58-71`, `:74-89`; core `sync_matter` `:24-55`; client `services/ecourts.py:73-94` (`fetch_case`, partner API `webapi.ecourtsindia.com`, Bearer `ECOURTSINDIA_TOKEN`), defensive parser `parse_case` (`ecourts.py:59-70`). CNR validated `^[A-Z]{4}\d{12}$` (`ecourts.py:19`).
- Each order text (`markdownContent`) goes through `intake(..., source="ecourts")` (1.6); a changed next date becomes a **proposed** `set_next_date` task; sets `sync_status`/`synced_at`. Nothing applied silently.
- Errors: not configured / bad CNR / 404 / token rejected → 422 with message; other → 502. LLM only via order reading (optional). Nightly job `app/jobs.py:29`.

### 1.15 Deadlines — **deterministic, rule-based, from `app/data/playbooks/ni138.json`**
- Pure computation `services/playbook.py:73-94` **`compute_deadlines(pb, facts)`** using **`add_period`** (`:43-45`) / **`add_months`** (`:37-40`, month-end clamped) over `derived_dates` (`payment_window_end = notice_received + 15 days`, `cause_of_action_date = +1 day`) and 4 `deadline_rules`:
  - `ni138_presentation_validity` cheque_date + 3 months (s.138 proviso (a))
  - `ni138_notice_window` bank_information_received_date + 30 days (proviso (b))
  - `ni138_payment_window` notice_received_date + 15 days (proviso (c))
  - `ni138_complaint_window` cause_of_action_date + 1 month (s.142(1)(b)), **`court_act: true`**
  Missing inputs → `status:"missing_input"`, note "Needs: <input label>" (`playbook.py:84-89`, `_root_input` `:97-101`). All results `needs_confirmation: True`.
- Holiday adjustment `services/deadlines.py:50-72` **`recompute(db, m)`**: only for `court_act` rules, **`next_open_day`** (`:42-47`) skipping days where **`is_closed`** (`:30-39`) — Sunday, Saturdays per firm setting `closed_saturdays` (`none|second_fourth|all`, **`_second_or_fourth_saturday`** `:20-21`), firm **`closed_days`** holidays matching the court (`:24-27`); stores `original_due_date` and a "Moved from … Section 10, General Clauses Act" note. **`recompute_firm`** (`:75-81`) runs after holiday add/import/delete and after `closed_saturdays` changes (`routes/admin.py:70-71`, `:237`, `:268`, `:281`).
- Triggered by `PUT /matters/{id}/facts` (`routes/matters.py:80-97`; unknown facts → 422 at `:85-87`).
- Relevance: **`deadline_met`** (`playbook.py:158-166`) hides a deadline once the matter's stage reaches the rule's `met_at_stage` (used by dashboard, calendar, brief, client update).
- **The LLM never computes a date** (`playbook.py:1-5`). Ollama irrelevant.

### 1.16 Daily (morning) brief
- `GET /brief` (`routes/brief.py:20-26`, `?on=`, `?format=text`) and `POST /brief/test` (`:33-46`); builder `services/brief.py:12-51` **`build_brief`**: today's listed matters with prepare actions, computed deadlines due ≤7 days (incl. overdue, excluding met), orders created since yesterday, pending approvals count; `render_text` (`:54-72`).
- Delivery `services/brief_delivery.py` to Telegram/WhatsApp for opted-in users from `NYAAY_BRIEF_HOUR` (8) IST, 4-hour window, once per person per day, retries (`brief_delivery.py:20-37`); in-process loop `services/scheduler.py:19-28` (disable with `NYAAY_SCHEDULER=0`); cron alternative `app/jobs.py:21-26`.
- **Deterministic; no LLM.** Note: `o.summary[:200]` (`brief.py:46`) assumes order summaries are non-null.

### 1.17 Other automation touch-points
- WhatsApp inbound (`services/whatsapp.py:113-162`): "brief" → brief text; text questions → `research.ask` (`:165-178`); documents/images → order intake with matter found by CNR / case number / `#id` in caption (`:84-107`).
- Citator (treatment & parallel citations) — regex, deterministic: `services/citator.py:19-26` (NEG/CAUTION/POS/RANK), `classify` `:30-37`, `analyse` `:54-69`; run after loads `store.reindex_citator` `store.py:288-312`.

---

## 2. Response shapes

### `GET /health` (`app/main.py:73-83`, no auth)
```
{ ok: true,
  llm: "ollama"|"anthropic"|"none",            // get_llm().name
  ai: { provider, ready, model?, model_fast?, missing?: [model names], message },   // llm_status(), llm.py:225-237
      // ollama not running: {provider:"ollama", ready:false, message:"Ollama is not running. Start the Ollama app."}
  model: str|null, model_fast: str|null,      // only when llm.available
  judgments_indexed: int, real_judgments: int, index_is_fixture: bool,
  integrations: { indiankanoon: bool, ecourts: bool, whatsapp: bool, semantic_search: bool } }
```

### `GET /library/status` (`routes/library.py:104-110`, advocate+)
```
{ corpus: { judgments, real_judgments, paragraphs, fixture_only, year_min, year_max, courts: [{court, count}] },  // store.py:350-359
  job: { state: "idle"|"running"|"done"|"stopped"|"failed", kind: "sc"|"hc"|"files"|"embed"|null, label,
         started_at, finished_at, added, failed, duplicates, error, log: [str ≤80] },                           // library.py:35-46
  ai: <llm_status()>,
  semantic: { ready: bool, vectors: int, paragraphs: int, model: str|null },                                      // vectors.py:98-103
  example_data: { matters: int, judgments: int },                                                                 // admin.py:135-142
  quality: { judgments, missing_date, missing_citation, short, fallback_title, duplicates_skipped, scanned_skipped,
             clean_share: float|null },                                                                           // store.py:251-269
  ocr: { tesseract, languages_installed: [], languages_in_use, languages_missing: [], rasteriser: "pymupdf"|"pdf2image"|null,
         ready, bulk } }                                                                                          // ocr.py:135-141
```

### `GET /activity?limit=50` (`routes/workspace.py:378-380`, `_activity` `:357-375`)
Array of `{ id, actor (email|"advocate"|"system"), action, text (human label from LABELS :351-354, task actions include “<title>” in), matter_id|null, matter|null, at (ISO) }`, newest first. (Same objects appear as `/dashboard.activity`, limit 12.)

### `GET /approvals/queue?matter_id=` (`routes/tasks.py:141-162`)
```
{ total: int,
  summary: "N waiting across M matters: a to-dos, b date changes, …" | "Nothing is waiting for your decision.",
  safe_ids: [task ids with action==null and no conflict],
  groups: [ { matter: { id, title, client_name, next_date },
              tasks: [ { ...task_dict, kind: "to-do"|"date change"|"stage change"|"client message",
                         safe: bool (action==null), conflict: str|null } ] } ] }
```
`task_dict` (`app/serializers.py:29-33`): `{id, matter_id, title, detail, due_date, source, status, action, payload, decided_by, decided_at, created_at}`. Conflict = >1 proposed `set_next_date` or `set_stage` on the same matter (`tasks.py:117-128`); conflicting tasks are skipped by `POST /tasks/batch` approve (`tasks.py:179-187`).

### `GET /bookmarks?matter_id=` (`routes/workspace.py:113-119`)
Array (≤500, newest first) of `bookmark_dict` (`serializers.py:52-54`): `{ id, matter_id|null, jid, title, citation, para_no|null, excerpt (para text ≤1500 when para_no set), note, created_at }`. Without `matter_id` returns all firm bookmarks (incl. matter-less ones).

### `GET /judgments/{jid}/links` (`routes/research.py:93-97` → `store.links` `store.py:473-498`)
```
{ cites:     [ { id, title, court, year } ],                       // judgments in the library this one cites (year desc)
  cited_by:  [ { id, title, court, year, treatment: "negative"|"caution"|"positive"|"cited", paras: [int] } ],  // worst treatment first, ≤200
  treatment: { negative: int, caution: int, positive: int, cited: int },   // counts of citing judgments by worst treatment
  citations_in_text: int,     // distinct citations found in this judgment's text
  not_in_corpus: int }        // citations_in_text − len(cites)
```
(Frontend type `LinkRef` also allows `jid`, `citation`, `para_no` — not emitted.)

---

## 3. Legal business-rule locations (a UI redesign must not alter or duplicate these)

| Rule | Location |
|---|---|
| Deadline rules, derived dates, stages (keywords, actions, drafts), routes, `deadline_note`, playbook `status` (DRAFT) | `app/data/playbooks/ni138.json` |
| Deadline arithmetic (months clamp to month end, days) | `app/services/playbook.py:37-45` (`add_months`, `add_period`), `:73-94` (`compute_deadlines`), `:97-101` (`_root_input`) |
| Alert window | `app/services/playbook.py:104-108` (`is_alert_due`) — `alert_days_before` per rule |
| Deadline "met" by stage | `app/services/playbook.py:158-166` (`deadline_met`) |
| Stage plan / progress | `app/services/playbook.py:136-155` (`plan`) |
| Stage detection from order text | `app/services/playbook.py:113-126` (`detect_stage`); task threshold ≥0.45 `app/routes/orders.py:36` |
| Holiday / closed-day handling (s.10 General Clauses Act, court acts only) | `app/services/deadlines.py:20-47` (`_second_or_fourth_saturday`, `closed_days`, `is_closed`, `next_open_day`), `:50-72` (`recompute`), `:75-81` (`recompute_firm`); triggers `app/routes/admin.py:70-71, 237, 268, 281`; `closed_saturdays` validation `admin.py:63-65`; default `second_fourth` `app/services/ai.py:23-24` |
| Holiday CSV formats (`YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY`; dedupe by (day, court)) | `app/routes/admin.py:243-272` |
| Facts validation (only playbook input names) | `app/routes/matters.py:85-87` |
| Citation regexes and normalized forms | `app/services/citations.py:30-41`, `:48-68` (`_normalize`), `:71-85` (`extract_norms`, `normalize_any`) |
| Citation resolution / name matching thresholds (0.7 resolve-by-name, 0.5 mismatch) | `app/services/store.py:516-524`; `app/services/citations.py:170-173`, `:213-221`, `:289`, `:307` |
| Citation statuses, export gate, advocate confirmation | `app/services/citations.py:23-28`, `:267-343`; `app/routes/citations.py:76-90` |
| Parallel-citation harvesting & treatment classification | `app/services/citator.py:19-69`; `app/services/store.py:271-327` |
| Order date / next-date extraction (Indian day-first), directions | `app/services/order_reader.py:21-102` |
| Task proposal rules from orders | `app/routes/orders.py:20-48` |
| Hearing-notes date grounding | `app/services/hearing_notes.py:17-19`, `:53-55` |
| Approval semantics (what approval changes: next date / stage), conflicts, "safe" definition | `app/routes/tasks.py:44-62`, `:110-128`, `:141-162`, `:170-196` |
| Draft placeholders `[[…]]`, Indian money grouping, date format, final-status gate (advocate+, no placeholders) | `app/services/drafting.py:73-107`, `:169-170`; `app/routes/workspace.py:252-260` |
| Polish fact-guard | `app/services/drafting.py:180-197` |
| Client update templates (en/hi/mr) | `app/services/client_update.py:12-71` |
| Section-converter mapping table & parsing | `app/data/ipc_bns.json`; `app/services/converter.py:15-116` |
| Review/sign-off versioning (content hash → `outdated`) | `app/services/reviews.py:18-57` |
| PII redaction patterns | `app/services/security.py:79-85` |
| Legal synonyms for search | `app/services/store.py:50-62` |
| Frontend-side logic that mirrors rules (keep in sync or move server-side) | placeholder regex `web/src/components/matters/draft-editor.tsx:4`, `web/src/app/(app)/drafts/[id]/page.tsx:18`; DETAIL_FIELDS `web/src/components/matters/labels.ts:5-11` (must equal backend `drafting.FIELDS`); citation status labels `web/src/components/research/status.ts`; "nearest deadline" per matter computed client-side from `/calendar` `web/src/app/(app)/matters/page.tsx:48-56`; day arithmetic in browser local time `web/src/lib/format.ts:28-33` (backend uses server-local `date.today()`, e.g. `routes/workspace.py:387`) |

Observations relevant to rule integrity:
- `require_review` firm setting is stored and toggled in UI but **not enforced anywhere** in backend logic (only `DEFAULT_SETTINGS`, `ai.py:24`).
- The playbook `deadline_note` says holidays are not applied, while `deadlines.recompute` does apply them to `court_act` rules; route options (1.11) do not. The Overview and Route-options tabs can therefore show different complaint deadlines for the same matter.
- Several audit entries hard-code actor `"advocate"` rather than the user (`routes/matters.py:54`, `:95`; `routes/workspace.py:59`, `:84`, `:143`, `:231`), and `PATCH /matters/{id}` (incl. `current_stage`, `next_date`) has no role check — a clerk can change stage/next date directly, bypassing the approval flow.

---

## 4. Summary — constraints a UI redesign must respect

1. **Transport contract**: keep `/api/*` same-origin proxy, cookie credentials, and the `X-Requested-With: nyaai` header on all writes (403 otherwise); keep 401→`/login?next=` and the long proxy timeout/60 MB body for OCR and AI calls.
2. **Human-in-the-loop**: orders, hearing notes, eCourts sync and client updates only create *proposed* tasks; only advocate+ approve (single, selected, "safe" batch). Client messages are never sent — only copied/opened in WhatsApp after approval. Preserve the decision log.
3. **Deadlines are rule-computed** (playbook + holiday rules); the UI only collects confirmed dates. Keep "Confirm this date", "Rule not reviewed", "Moved from … court closed", and "Stage passed" signals.
4. **Citation trust gate**: "Ready to file" only when every citation is VERIFIED or advocate-confirmed; without AI nothing is VERIFIED; show FOUND_EXTERNALLY/NOT_IN_LIBRARY as "not wrong by itself".
5. **AI is optional**: every AI view must render its non-AI mode (`retrieval_only`, `no_sources`, headnote `none/failed`, hearing notes `rules`, polish 409/502) and show `[S#]` source mapping, uncited sentences and removed markers.
6. **URL/state contracts**: `?para=` (+ `id="para-N"`), `?ask=`, `?q/court/from/to/offset`, `?new=1`, `?id=`, `/login?invite=`, `/settings#tab`; localStorage `nyaay-theme`, `nyaay-reader-size`; Ctrl+K, Ctrl+F, Ctrl+S.
7. **Role gating** per §3 of the matrix (clerk/advocate/admin), and fix rather than copy the known gaps (matter-less bookmarks, `#p` anchors, tab URLs).
