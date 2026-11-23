# Nyaay redesign: red-team critique

## 1. Generic or templated?
- **Home is the old dashboard with a new skin.** Compare `before/home.png` with `after-dark/home.png`: the banner, 14-day strip, cause list and deadline rings sit in the same places and look the same. Only the greeting, the KPI tiles (now a sentence) and the sidebar (now an icon rail) changed. That is the "SaaS dashboard with glass cards" the brief rules out.
- **Clichés.** Big serif greeting, "Title / grey subtitle" panels everywhere, four-stat tile rows (Intelligence, Library), sparkle-for-AI, gold glow under every CTA, drafting grid, drifting radial "lamp".
- **Login**: orbit rings around a glowing coin, a stock "AI startup" hero.

## 2. Glass and depth
- `globals.css` lines 22 and 305 say L3 panels and cards get **no blur, tint only**. Every content surface is a flat translucent card with a 1px rim; only rail, command bar, dock and overlays blur. Nothing overlaps anything; depth is one shadow token.
- On mobile, page text shows through the dock almost unblurred (`after-mobile/home.png` and `matters_1.png`, where "Shreeji Agro Traders…" collides with the dock labels). It reads as a dirty overlay. Light mode is flat white cards on beige.

## 3. Motion (from code)
- `template.tsx` and `motion.ts` (`enterWorkspace`) run `filter: blur(6px)` plus scale on the **whole workspace** for 520ms on every navigation. That is a full-page filter repaint on long judgments, and a filtered ancestor disturbs descendant `backdrop-filter` during entrance.
- In `transition.tsx`, `navigate()` awaits `prepare()` for up to **700ms before the route even starts**, then can hold the view transition for up to 900ms. A click can feel dead for over a second.
- The rail expands on hover (`rail.tsx` lines 35 and 50, with a 140ms delay and a spring on `width`). Brushing the left edge animates the layout.

## 4. Coherence
- **Same data, two meanings.** On Home, past rule dates appear as red "overdue" rings (-36, -33, -13). On the matter page the same kind of item appears as grey "Rule, passed".
- **Brass means three things.** `globals.css` line 16 says "Brass light marks what is verified". Brass is also used for Approve, New matter, Load judgments, the **"Fictional test judgment" badge**, the demo citations "2099 INSC 1", and "22 AI proposals". The product's own semantic is broken.
- **Redundant controls.** Research has a "Search / Ask AI" toggle *and* a "Search" submit; Ask appears in top bar, Home and Research.
- **Light mode is unproven.** 10 of 16 `after-light` captures are dark: approvals, calendar, citations, clients, drafts, library, login, matters, settings and tools_convert (mean luminance 15–28 against about 240 for real light captures).

## 5. Legal readability
- **Paragraph numbers, the thing an advocate cites, are the faintest text on the page.** `judgments/[id]/page.tsx` line 220 uses `text-faint`. In light mode `--faint #79849a` on `#f3f2ee` is **3.36:1**, which fails AA. The preamble (line 209) and the minimap numbers (`text-[11px] text-faint`) have the same problem.
- Light-mode `--brass #9a6f1f` on paper is 4.02:1 and is used for small links ("Calendar", "Review", "Open matter"). Fails AA at that size.
- **Legal conditions are truncated.** On the matter timeline, "Last day to file the complaint (one month after cause of action; delay can be condoned f…" is cut off (`matters_1.png`). Calendar chips read "Last day to send the d…" and "Drawer's 15-day pay…" with no matter name, so two matters' deadlines cannot be told apart.

## 6. Honesty
- **The Ask-this-judgment answer can invent paragraph numbers.** `judgments/[id]/page.tsx` line 451 renders `¶ {para ?? mm[1]}`. When a `[S3]` marker does not map to a source, it shows "¶ 3", a paragraph number that does not exist, as a brass chip.
- That answer also has **no "not verified" badge** (Research has one at line 347, and the headnote has one at line 403). It is set in `prose-judgment`, the court's own typeface, so it looks like quoted judgment text. Headnote "Held" (line 417) likewise.
- **Home overstates AI.** It says "22 AI proposals are waiting". The approval queue is to-dos labelled "Playbook" and "From an order" (rules), not AI.
- **The bulk action is framed as safe.** "Approve all safe (17)" uses a ShieldCheck icon and the word "safe". The tooltip limits it to plain to-dos, but the label frames bulk approval as vetted.
- Demo and offline states are communicated well: "(Demo)" suffixes, "Fictional test judgment", "AI offline" and "Not running". Except mobile: AI offline is a bare dot.

## 7. Mobile
- **Approvals summary breaks.** `after-mobile/approvals.png`: the summary wraps one word per line ("22 / waiting / across / 4 / matters…") and is squeezed by two buttons.
- **Authority map is unusable.** `after-mobile/graph.png`: node labels are about 5px, the legend takes a third of the canvas, and the footer is hidden under the dock.
- **Clipping.** Matter stepper cut off ("Cogniz… summ…") with no scroll affordance; strip tags read "Heari…".
- **No space for the dock.** There is no bottom padding equal to the dock height, so the last content always sits under it.
- **Reader drops its tools.** Headnote/Ask/Network/Cited by are unreachable in the mobile reader as captured.

## 8. Usefulness for a real day
- Cause list, deadlines with proviso references, the "do now / next" stage panel and the approval queue are the strongest part. Undermining them: overdue noise, truncated deadlines, calendar chips without matter names, and an icon-only rail of 13 unlabeled glyphs.

## Top 10 defects (most severe first)
1. **Ask-this-judgment, invented ¶ chips** (`judgments/[id]/page.tsx` line 451). An unresolved `[S n]` is shown as "¶ n". Fix: render unresolved markers as a red "unresolved source" token that cannot be clicked, add the "AI answer, not verified" badge, and set AI text in the sans face inside a cyan-ruled container, never `prose-judgment`. Do the same for headnote "Held".
2. **Brass/verified collision** (global). Fix: reserve brass for verified citations and advocate-confirmed items only. Give "Fictional test judgment" and demo citations a hatched amber "TEST" style.
3. **Paragraph-number contrast** (judgment reader, light mode 3.36:1). Fix: use `text-muted` at a minimum (6.1:1), 13px tabular with a "¶" prefix, and brass only when targeted. Raise light `--faint` to about `#5f6a80`. Raise light `--brass` for small text to about `#7a5512`.
4. **Home mislabels and over-alarms.** Fix: "22 proposals (n from AI)". Show rule dates that have passed with a completed prerequisite as "passed", matching the matter page, and keep red for real misses only.
5. **Light mode missing or unverified on 10 screens.** Fix: apply the theme on every route, including login, and re-capture all 16. Do not accept light mode until then.
6. **Mobile approvals layout.** Fix: below `sm`, use `flex-col` with a full-width summary and a full-width button row beneath.
7. **Truncated legal text** (matter timeline, calendar chips). Fix: wrap deadline titles, never ellipsize a condition. Prefix calendar chips with a matter short-name and show the full text on focus and hover.
8. **Mobile graph.** Fix: default to a list of authorities on mobile, collapse the legend into a sheet, use labels of at least 12px or hide them until a node is tapped, and pad the bottom by dock height plus the safe-area inset.
9. **Navigation latency and the full-page blur entrance** (`transition.tsx`, `template.tsx`). Fix: navigate immediately and let the hero skeleton morph. Drop `filter: blur` from `enterWorkspace` (opacity plus 4px y, 200ms).
10. **Graph label collisions and flat depth** (`graph.png`: "Demo Traders" overprints "Illustrative Co", "Saved, n" sits under "Sharma v. Verma"). Fix: add label collision offsets with a halo background. Give content a real second plane: sticky reader toolbar and inspector as blurred L2 over scrolling text.

Also fix: duplicate Research "Search", "1 judgments", unstyled native selects, mobile "AI offline" as a dot, hover-only rail labels.

## Verdict: ACCEPT WITH FIXES (items 1–5 block release)
The redesign is coherent, mostly honest about demo and offline states, and the reader is a real improvement. But it misses the brief's central ask: structurally it is the old SaaS dashboard with a serif headline, icon rail and tinted cards, and its only spatial motion is a page-wide blur that costs speed. Worse, it breaks its own trust grammar: brass is meant to mean "verified" yet decorates test data and AI output, and the Ask panel can show nonexistent paragraph numbers in the court's typeface. The paragraph number fails contrast in light mode, and light mode was not applied on most screens. Fix 1–5 before shipping; fix 6–10 before calling this "Liquid Intelligence".
