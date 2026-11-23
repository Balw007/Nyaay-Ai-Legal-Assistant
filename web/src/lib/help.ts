// Plain-language explanations behind every (i) in Nyaay. Keyed by the title shown on screen, so a panel or page
// with one of these titles gets its (i) automatically. Each one says what the feature is, what to do with it,
// and anything a lawyer should know before relying on it. Keep them short: two or three sentences.

export type Help = { what: string; how?: string; note?: string };

export const HELP: Record<string, Help> = {
  /* ------------------------------------------------------------------ pages */
  "Home": {
    what: "Your day at a glance: hearings, deadlines, approvals waiting, recent matters and what the AI agents have done.",
    how: "Type in the big search bar to research, or use the buttons under it to start common work.",
  },
  "Research": {
    what: "Search the judgments in your library down to the exact paragraph, and look up sections of the Bare Acts.",
    how: "Type a question or words from a judgment. Filter by court and year on the left. Ask the AI research assistant on the right for a written answer with sources.",
    note: "Only judgments you have loaded into the Library are searched.",
  },
  "Bare Acts": {
    what: "The text of the Acts you cite, section by section, linked to the judgments in your library that discuss each section.",
    how: "Pick an Act, then a section. Download the standard Acts first if the list is empty.",
  },
  "Matters": {
    what: "Every case you are handling, with its stage, next hearing and nearest deadline.",
    how: "Click a matter to open its workspace. Use New matter to add one, or Add a test case to try Nyaay out.",
  },
  "Approvals": {
    what: "Everything Nyaay proposes (tasks, date changes, stage changes, client messages) waits here until an advocate approves it.",
    how: "Approve or reject one at a time, or select several. Every decision is recorded with the name of the person who made it.",
    note: "Nothing proposed by Nyaay changes a matter until it is approved.",
  },
  "Calendar": {
    what: "Hearings and statutory deadlines from all your matters on one calendar.",
    how: "Click a day to see what is due. Download a .ics file or subscribe to see these dates in Google Calendar or Outlook.",
  },
  "Drafts": {
    what: "Notices, complaints and applications filled in from a matter's facts using templates.",
    how: "Choose a template and a matter, then Create draft. Facts that are missing stay as visible blanks for you to fill.",
  },
  "Citation check": {
    what: "Checks every citation in a draft against your library and finds the paragraph it relies on.",
    how: "Paste text or upload a Word or PDF file, then Check citations. Each citation is marked Verified, Found but not yet checked, Does not support the point, or Does not match.",
    note: "A citation is only marked Verified when the AI or an advocate confirms the paragraph supports the point.",
  },
  "Clients": {
    what: "Everyone you act for, with their matters and the next date in each.",
    how: "Click a matter under a client to open it.",
  },
  "AI Intelligence Centre": {
    what: "Where you start AI agents, watch what each one does step by step, and check the health of the systems they rely on.",
    how: "Start an agent from the cards, then click it under Agents at work to see its steps and result.",
    note: "Nothing an agent produces is applied anywhere until a person acts on it.",
  },
  "Authority map": {
    what: "A map of how the judgments in your library cite each other, and how later courts treated them (followed, distinguished, overruled).",
    how: "Search for a judgment to add it to the map, click a point to see its details, and use the presets to show only some kinds of links.",
    note: "Only links found in the text of judgments in your library are drawn.",
  },
  "Library": {
    what: "The judgments Nyaay searches, quotes and checks citations against. Everything is stored on your computer.",
    how: "Load judgments from the official Supreme Court and High Court open data, or upload your own files.",
  },
  "Gold set": {
    what: "Judgments an advocate in your chambers has read and vouched for. They show as Verified across Nyaay.",
    how: "Pick a section to see which judgments are worth reading first, then write the headnote in your own words.",
  },
  "Section converter": {
    what: "Converts sections between the old and new criminal laws: IPC to BNS, CrPC to BNSS, Evidence Act to BSA, and back.",
    how: "Type a section such as 302 IPC or 103 BNS.",
    note: "Always check the new section's text in the Gazette before relying on it.",
  },
  "Settings": {
    what: "Your profile, your chambers, team members, the local AI, legal rules, court holidays and your data.",
  },
  "Matter": {
    what: "Everything about one case: where it stands, what to do now, every date and deadline, orders, tasks, drafts and notes.",
    how: "The bar at the top shows the stage. Use the tabs below the timeline for orders, tasks, drafts, notes and saved authorities.",
  },
  "Judgment": {
    what: "The full text of a judgment, numbered by paragraph, with its citations and how other judgments treat it.",
    how: "Use the navigator on the left to jump to a paragraph. The panel on the right gives an AI headnote, lets you ask questions of this judgment, and shows who cites it.",
  },

  /* ------------------------------------------------------------------ home */
  "Today's intelligence": {
    what: "A quick count of today's hearings, this week's deadlines, approvals waiting, your library size and whether the local AI is running.",
  },
  "Active agents": {
    what: "The AI agents that are running or have finished recently.",
    how: "Click one to open it in AI Agents and see each step it took.",
  },
  "Recent matters": {
    what: "The matters you worked on most recently, and anything you opened on this device.",
    how: "Click to open. The 'Opened here' list is kept only in this browser.",
  },
  "AI insights": {
    what: "The latest answer from the Research Agent, with the paragraphs it relied on.",
    note: "AI text is a draft to check, never a verified result.",
  },
  "Your practice": {
    what: "Your week in one sentence, then your workspace panels.",
    how: "Click any number to go to the work behind it. Use Arrange to reorder or hide panels.",
  },
  "The next two weeks": {
    what: "Hearings (blue) and statutory deadlines (red) for the next 14 days.",
    how: "Click an item to open its matter, or Calendar for the full view.",
  },
  "Cause list": {
    what: "Your hearings this week, with each matter's stage and what to prepare.",
    note: "The preparation points come from the stage playbook, not from the court.",
  },
  "Deadlines": {
    what: "Statutory deadlines worked out by fixed rules from the dates you confirmed, with days left (negative means overdue).",
    note: "Deadlines are calculated by rules, never by AI. Check each date before relying on it.",
  },
  "Recently opened": {
    what: "Judgments and matters you opened recently on this device.",
    note: "Kept only in this browser; not shared with colleagues.",
  },
  "Matters by stage": {
    what: "How many of your active matters are at each stage of the case.",
  },
  "Recent activity": {
    what: "What happened recently in your chambers: logins, approvals, new matters and automatic work, with who did it.",
  },

  /* ------------------------------------------------------------------ agents */
  "Start an agent": {
    what: "AI agents do a piece of legal work in the background and show every step they take.",
    how: "Pick an agent, fill in what it needs, and start it. Agents marked Needs AI work only when the local AI (Ollama) is running.",
  },
  "Agents at work": {
    what: "Every agent task: queued, working, ready for your review, or failed.",
    how: "Click a task to see its steps and result. Use the filter to show only some.",
  },
  "System health": {
    what: "Whether each part Nyaay depends on is working: the local AI, your judgment library, meaning search and reading scans.",
    how: "Green is working, amber is working with limits, red is off.",
  },
  "Capabilities": {
    what: "Every feature in Nyaay, what it relies on (fixed rules, your library, the local AI), and what it can do right now.",
  },
  "Running now": {
    what: "Library jobs in progress, such as loading judgments or building the search index.",
  },
  "Waiting for an advocate": {
    what: "Proposals from Nyaay that need an advocate's approval before anything changes.",
    how: "Click Review to go to Approvals.",
  },
  "Done by Nyaay": {
    what: "Work Nyaay did on its own, such as citation checks, reading orders and syncing with eCourts.",
  },

  /* ------------------------------------------------------------------ research and reader */
  "AI research assistant": {
    what: "Asks the Research Agent to answer your question from the judgments in your library, citing each paragraph it uses.",
    note: "Without the local AI it returns the most relevant paragraphs instead of a written answer.",
  },
  "AI headnote": {
    what: "An AI summary of this judgment: the issues, the holding and the key paragraphs.",
    note: "A draft to check against the judgment, not a verified headnote.",
  },
  "Ask this judgment": {
    what: "Ask a question and get an answer from this judgment only, with the paragraphs it relies on.",
  },
  "Verified headnote": {
    what: "A headnote an advocate in your chambers wrote and vouched for.",
  },
  "Provisions discussed": {
    what: "The sections of Acts this judgment discusses, linked to the Bare Act.",
  },
  "Sources": {
    what: "The paragraphs the answer was built from. Each [S] reference in the answer points to one of these.",
  },
  "Network insights": {
    what: "Counts of each kind of link on the map, and the judgments most cited by others here.",
  },
  "Reading the map": {
    what: "What each shape and line on the map means.",
  },

  /* ------------------------------------------------------------------ matter */
  "Case timeline": {
    what: "Every date in the matter on one line: dates you entered, deadlines calculated by rule, and dates from the court.",
  },
  "Key dates": {
    what: "The facts that start the statutory clocks, such as the cheque date and the date of the bank's memo.",
    how: "Confirm each date from the documents. Deadlines are recalculated from these by fixed rules.",
  },
  "Case status": {
    what: "The matter's stage, next hearing, status, court, case number and CNR.",
    note: "The stage usually changes when you approve a proposal read from an order.",
  },
  "Statutory deadlines": {
    what: "Deadlines calculated by fixed rules (for example NI Act s.138 and s.142) from the key dates, moved past court holidays.",
    note: "Rules stay marked as a draft until an advocate in your chambers signs them off in Settings.",
  },
  "Erase matter permanently": {
    what: "Deletes the matter and everything in it. This cannot be undone.",
    note: "The audit log keeps only a record that it happened.",
  },
  "Add an order": {
    what: "Paste or upload a court order. Nyaay reads the date, next date, directions and stage, and proposes changes.",
    note: "Nothing changes until an advocate approves the proposals.",
  },
  "Parties and cheque": {
    what: "The facts used to fill drafts: names, addresses, cheque and bank details.",
    how: "Leave a field empty and the draft shows a visible blank.",
  },
  "Drafts for this matter": {
    what: "Drafts created from this matter's facts.",
  },
  "What if…": {
    what: "Try a different date and see how the deadlines would move.",
    note: "Nothing here is saved to the matter.",
  },
  "What could the other side say?": {
    what: "Checks your saved authorities for later adverse treatment and finds paragraphs in your library that point the other way.",
  },

  /* ------------------------------------------------------------------ approvals, drafts, acts, gold */
  "Decision log": {
    what: "Every approval and rejection, newest first, with the name of the person who decided.",
  },
  "New draft": {
    what: "Create a new draft from a template, filled with a matter's facts.",
  },
  "AI suggestion": {
    what: "The AI's suggested improvements to your draft.",
    note: "Your draft is unchanged until you accept. A suggestion that drops a blank or adds a citation or number is blocked.",
  },
  "Blanks to fill": {
    what: "Facts the draft still needs. Fill them in the matter or directly in the draft.",
  },
  "Acts": {
    what: "The Acts loaded into Nyaay.",
  },
  "Old and new law": {
    what: "How this section maps between the old and new criminal laws.",
    note: "Check the new text before relying on the change.",
  },
  "Load official text": {
    what: "Load an Act from the official PDF from India Code or the Gazette, for BNS, BNSS and BSA or to replace any Act.",
  },
  "Judgments that discuss this section": {
    what: "Judgments in your library that discuss this section, with the paragraph where they do.",
  },
  "What to read first": {
    what: "The judgments in your library that discuss a section the most and are cited the most by others.",
  },
  "Does search find them?": {
    what: "A check that search finds the right judgment for each verified topic, so you know search can be trusted.",
  },

  /* ------------------------------------------------------------------ library */
  "Load judgments": {
    what: "Download judgments from official open data (Supreme Court, High Courts) or upload your own files.",
    note: "Judgments already loaded are skipped. You can stop and resume.",
  },
  "Activity": {
    what: "Progress of the current loading job: how many judgments were added or failed.",
  },
  "Courts in your library": {
    what: "How many judgments you have from each court.",
  },
  "Local AI": {
    what: "The AI model that runs on this computer (Ollama). It writes answers, headnotes and draft suggestions.",
    note: "Nothing is sent to an AI company.",
  },
  "Search by meaning": {
    what: "Finds paragraphs with the same idea in different words, not just the same keywords.",
    how: "Build the meaning index once after loading judgments.",
  },
  "Data quality": {
    what: "Each judgment is scored out of 100 from checks you can read. Below 70, look at it before relying on it.",
  },

  /* ------------------------------------------------------------------ settings */
  "Your profile": { what: "Your name, bar enrolment number and contact details. Your name is recorded with every approval." },
  "Password": { what: "Change the password you sign in with." },
  "Chambers": { what: "Your chambers' name and the settings that apply to everyone in it." },
  "People": {
    what: "Everyone in your chambers and their role.",
    note: "Clerks prepare work. Only advocates and above approve.",
  },
  "Invite a colleague": { what: "Send a link that lets a colleague join your chambers with a chosen role." },
  "Local AI with Ollama": {
    what: "Set up the free AI that runs on this computer.",
    note: "Models run here and nothing is sent to an AI company.",
  },
  "Court calendar": { what: "Days the courts are closed, used to move filing deadlines to the next open day." },
  "Court holidays": {
    what: "Filing deadlines that fall on these days move to the next open day.",
    note: "Under s.10 of the General Clauses Act.",
  },
  "Add a holiday": { what: "Add a day the court is closed." },
  "Import a list": { what: "Add many holidays at once, one per line: date,name[,court]." },
  "Morning brief on Telegram": { what: "Get today's hearings and deadlines on Telegram at 8 am every day." },
  "Calendar subscription": { what: "A private link that shows your hearings and deadlines in Google Calendar, Apple Calendar or Outlook." },
  "System check": { what: "Whether this computer is ready: AI models, OCR, open-data access, disk space and ports." },
  "Your data": { what: "Export or delete your data. Client data stays on the machine running Nyaay." },
  "Privacy and limits": { what: "What Nyaay keeps, what it never sends anywhere, and its limits." },
  "Usage this month": { what: "How much each feature was used this month." },
  "Pilot signals": { what: "Signs of whether Nyaay is becoming part of your daily work." },
};

export function helpFor(title: unknown): Help | undefined {
  return typeof title === "string" ? HELP[title] : undefined;
}
