# Security policy

Nyaay handles client and case information for advocates, so security problems are treated as urgent.

## Reporting a problem

Please do **not** open a public issue for a security problem. Email the owner instead:
**labanabalwindersingh16@gmail.com**, with "Nyaay security" in the subject.

Include what you found, how to reproduce it, and what could be affected. You will get a reply within 3 working days.
Please give us reasonable time to fix the problem before telling anyone else.

## What Nyaay does to keep data safe

- Everything runs on the computer or server of the chambers using it. Client data is not sent to Nyaay's owner or to
  any AI company: the AI runs locally through Ollama.
- Secrets (`.env`), databases, logs and backups are never committed to this repository (see `.gitignore`).
- AI proposals are never applied until an advocate approves them, and every decision is recorded with the name of the
  person who made it.

## Keys and tokens

If a token or password is ever committed by mistake, treat it as exposed: revoke it with the provider straight away,
issue a new one, and then remove it from the repository history.
