# Independent red-team review and resolution

The critic was a separate agent that judged rendered screenshots and read the source, without seeing the
implementation reasoning. Its unedited report: [appendix-red-team-report.md](appendix-red-team-report.md).
Verdict: **ACCEPT WITH FIXES**, with items 1–5 blocking.

| # | Finding | Resolution |
|---|---|---|
| 1 | Reader "Ask" could render an unmatched `[S#]` as a paragraph number that does not exist; AI text was set in the court's serif | **Fixed.** Unmatched references render as a red "unmatched" chip; AI answers carry "AI answer, not verified"; all machine text (answers, headnote "Held", polish) is now sans with a cyan rule. Serif is reserved for the court's words |
| 2 | Brass meant both "verified" and "test data / primary action" | **Fixed in the system.** Semantics written into tokens and docs: brass = authority and the single primary action; VERIFIED = leaf; test data = amber with a dashed border ("Fictional test judgment, not law") |
| 3 | Paragraph numbers and small brass text failed contrast in light mode | **Fixed.** `faint` 3.36 → 4.7:1, brass 4.0 → above 5.3:1, amber, leaf and cyan raised; axe reports 0 AA violations on all 15 routes in both themes |
| 4 | "22 AI proposals" mislabelled rule-based proposals; past dates shown as red overdue rings | **Label fixed** ("22 proposals"). Overdue rings are kept: the backend reports those deadlines as overdue for that demo matter, and the UI must not soften a statutory date |
| 5 | 10 of 16 "light" screenshots were dark | **Root cause fixed** (theme storage race under Strict Mode), re-shot; covered by a workflow test |
| 6 | Mobile approvals summary squeezed to one word per line | **Fixed.** Summary takes a full row on phones |
| 7 | Timeline labels truncated; calendar chips did not say whose deadline | **Fixed.** Timeline labels wrap; chips show the matter's short name with a full accessible label |
| 8 | Authority map unusable on mobile | **Improved.** Toolbar flows above the canvas on phones, fixed canvas height, larger labels. Still cramped (LIMITATIONS.md) |
| 9 | Navigation felt slow (700 + 900 ms waits, full-page blur entrance) | **Fixed.** Waits cut to 250/600 ms; blur entrance removed; entrance starts partly visible |
| 10 | Graph labels collided | **Fixed.** Wider collision radius, shorter labels, fit-to-content view |
| – | Reader tools unreachable on phones | **Fixed.** The intelligence panel stacks under the text below 1280 px |
| – | Native dropdowns unstyled | **Fixed.** Restyled closed state; native pickers kept for accessibility |
| – | "Approve all safe" framed bulk approval as vetted | **Fixed.** "Approve all without date or stage changes", with an accurate tooltip |
| – | Home is structurally the old dashboard | **Partly addressed, partly disputed.** The advocate's day genuinely needs the docket, deadlines and horizon in that order; the change is in composition (sentence, arrangeable grid, intelligence, recents) and in how the screens connect (morphs, palette, map), not in moving panels for novelty |
| – | Cards are flat (no blur) | **Kept, deliberately.** Blur only on chrome and floating surfaces is what keeps long pages at 60 fps on a 4× throttled CPU; depth comes from the level system, rims, sheen and float shadows |
