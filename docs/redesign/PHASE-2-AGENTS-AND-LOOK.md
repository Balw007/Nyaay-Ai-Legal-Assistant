# Phase 2: the command-centre look, real agents, the logo and the welcome

This phase matched the reference mockup (hero search, Today's intelligence, Active agents, research with an AI
assistant, a paper-page judgment reader, authority-map presets, an AI Intelligence Centre) using only real data,
and replaced the idea of "agents" with a working backend task system.

## Agents (backend)

Agents are background tasks that a person starts and can watch. Each one records what it did, step by step.

| Agent | What it does | Without the local AI (Ollama) |
| --- | --- | --- |
| Research Agent | Finds the most relevant paragraphs in your library, then writes a cited answer | Returns the paragraphs, no written answer |
| Judgment Analysis Agent | Drafts a headnote: issues, holding, key paragraphs | Fails honestly: "Start Ollama to generate summaries" |
| Citation Verification Agent | Checks each citation in a text against your library, saved like a normal citation check | Matches citations, but none can be marked Verified |
| Drafting Agent | Suggests improvements to a draft. Never applies them | Unavailable |

- Table `agent_tasks`, added by migration `0003_agent_tasks`. It runs on its own when the server starts.
- `app/services/agents.py` runs one task at a time on a background thread. Progress is a real count where one exists
  ("Checking 3 of 7"); otherwise the bar is shown as indeterminate, not as a made-up percentage.
- Stop is cooperative: the task stops at its next step. Tasks still running when the server restarts are marked
  failed with "Stopped because Nyaay was restarted." They are not silently resumed.
- API: `GET /agents`, `POST /agents/tasks`, `GET /agents/tasks`, `GET /agents/tasks/{id}`, `POST /agents/tasks/{id}/cancel`.
- Nothing an agent produces is applied anywhere until a person acts on it. AI text is labelled as a draft to check.
- Tests: `tests/test_agents.py` (5 tests). Whole suite: 210 passed, 2 skipped.

## Screens

- **Home**: hero with search and quick chips; Today's intelligence (real counts); Active agents; Recent matters;
  Quick actions; AI insights, which shows the latest finished research task and is labelled "AI, not verified".
- **Research**: filters, tabs for Judgments / Acts & Rules / Verified headnotes, and the AI research assistant,
  which starts a Research Agent and shows its progress in place.
- **Judgment reader**: document navigator, paper page, and a Headnote tab that runs the Judgment Analysis Agent.
- **Authority map**: presets (all, citations, followed, overruled, related) and network insights computed from the
  edges actually drawn.
- **AI Intelligence Centre** (`/intelligence`): start an agent, watch agents at work, open a task to see its steps
  and result, and system health (backend, judgment index, retrieval, local AI, OCR).
- **Navigation bar**: labelled left bar, open by default, with groups Workspace / Practice / Intelligence / System;
  the top bar adds notifications (approvals waiting, agents running or finished) and a user menu.

## Glass that follows the cursor

Cards marked `data-tilt` lean towards the cursor in 3D and lift slightly; `data-specular` adds the moving light.
One shared pointer listener writes CSS variables once per frame, so there is no per-card JavaScript. Tilt is off for
reduced motion and for touch screens.

## Logo and welcome

- The न्याय logo was cut out of the supplied artwork into two colourings (cream and gold for dark, ink and deep gold
  for light). It appears in the navigation bar, the login screen and the loading screen.
- The cinematic intro plays once per browser session as the welcome, muted, with Skip, Esc, Enter or a click to
  close and a sound button. It never plays for reduced motion. Replay it from the user menu.
- Videos are transcoded from the 4K source to 1080p (desktop) and 720p (phones).

## Checked

| Check | Result |
| --- | --- |
| Backend tests | 210 passed, 2 skipped |
| TypeScript, production build | clean |
| Workflow suite (26 real user journeys) on the production build | 26/26 |
| axe-core WCAG 2.1 AA: home, research, reader, agents, task detail, map, login, dark and light | 0 violations |
| Phone (390 px) horizontal overflow: 10 routes | none at page level |
| Layout shift, production: home / agents | 0.056 / 0.076 (target under 0.1) |

## Limitations

- With Ollama off (as in testing), only the Research and Citation agents produce results. The Judgment and Drafting
  agents were tested for their honest failure, not for the quality of AI output.
- One agent runs at a time; others wait in the queue.
- Home main-thread blocking time is about 0.7 s on a headless test machine. Most of it is the extra panels.
- "सत्यमेव जयते" and the scales appear in the supplied logo. It is not the State Emblem, but check use of the motto
  in a commercial product before launch.
