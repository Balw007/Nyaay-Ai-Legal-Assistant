# Putting Nyaay on a server

For one chambers with a few people. Allow an afternoon. You need a Linux server you can log in to, and a web address.

Nothing here is needed to try Nyaay on your own PC: use `start-nyaay.bat` for that.

## What you need

- A small Linux server (Ubuntu 22.04 or 24.04). Choose a data centre in India (for example Mumbai) so client data stays in India.
- About 4 GB of RAM is a comfortable start for Nyaay itself. Local AI on the same server needs much more (see "AI on a server" below).
- A web address such as `nyaay.yourfirm.in`, with its DNS **A record** pointing at the server's IP address.
- Ports 80 and 443 open on the server's firewall (the provider's panel and `ufw`).

## Steps

1. **Log in** to the server and install Docker:
   ```
   curl -fsSL https://get.docker.com | sh
   ```
2. **Copy Nyaay** to the server (the whole folder), for example to `/opt/nyaay`. From your PC: `scp -r nyaai user@SERVER:/opt/nyaay`.
3. **Make the settings file**:
   ```
   cd /opt/nyaay
   cp .env.example .env
   nano .env
   ```
   Fill in the SERVER section at the bottom: `NYAAY_DOMAIN` (your address, without https) and `POSTGRES_PASSWORD`
   (make one with `openssl rand -base64 24`). Choose the AI you want in the AI section.
4. **Start it**:
   ```
   docker compose up -d --build
   ```
   The first build takes several minutes. HTTPS certificates are fetched automatically once the DNS record is right.
5. **Open** `https://your-address`. The first screen creates the chambers account. The first user becomes the owner.
6. **Load judgments** from the Library screen (Supreme Court, then High Courts), or on the server:
   ```
   docker compose exec app python -m app.ingest sc --years 2024
   ```
7. **Check everything**: Settings > Data & pilot > System check, or
   ```
   docker compose exec app python -m app.doctor
   ```

## AI on a server

Nyaay needs an AI model for answers, summaries and reading orders. Search, deadlines and the citation matching rules work without one. Pick one:

| Choice | How | Good to know |
|---|---|---|
| **Your own PC or an office computer** | Install Ollama there and run `setup-ai.bat`. In `.env` set `OLLAMA_SERVER_URL=http://THAT-COMPUTER:11434` and make Ollama listen on the network (`OLLAMA_HOST=0.0.0.0`). | Free. Slow without a GPU. Keep it on a private network only. |
| **A server with a GPU** | Rent a GPU machine, install Ollama, point `OLLAMA_SERVER_URL` at it. | Much faster. A GPU server costs money every hour it is on; check your provider's current rates. |
| **The same server, CPU only** | `docker compose --profile local-ai up -d`, then `docker compose exec ollama ollama pull qwen3:8b` (and `qwen3:4b`, `nomic-embed-text`). | Works, but answers take a while. Use `OLLAMA_MODEL=qwen3:4b` on a small server. |
| **Hosted Claude** | Set `NYAAI_LLM=anthropic` and `ANTHROPIC_API_KEY`. | Fastest to start, billed per use by Anthropic. Text leaves your server (client names are redacted first). Decide whether your clients' consent and your privacy policy allow it. |
| **No AI** | `NYAAI_LLM=none` | Search, deadlines, matters and drafting from templates still work. |

The free default is local Ollama. Nothing in Nyaay requires a paid service.

## Backups

- Every night the `jobs` service makes a `pg_dump` of the firm database and a copy of the judgment library in `/data/backups` (inside the `corpus` volume, 14 of each kept). Straight after, it **restores the firm backup into a scratch database (`nyaai_verify`) and checks every table and the schema version**. If that test fails, the job log says `verify: FAILED`.
  - The scratch database is created automatically on a new server. On a server set up before this version, create it once:
    `docker compose exec db psql -U nyaai -c "CREATE DATABASE nyaai_verify" nyaai`
- One backup now, or a check of the newest one:
  ```
  docker compose exec jobs python -m app.dbtool backup
  docker compose exec jobs python -m app.dbtool verify-backup
  ```
- To copy them off the server (do this, a backup on the same disk is not a backup):
  ```
  docker compose cp jobs:/data/backups ./backups-copy
  ```
  then move that folder somewhere else (another computer, or an object store with `rclone`). A weekly copy is a good minimum.
- **Restore** the firm database:
  ```
  docker compose stop app web
  docker compose exec jobs python -m app.dbtool restore /data/backups/pg-20260131-013000.dump --force --yes
  docker compose start app web
  ```
  It restores in a single transaction: if anything goes wrong, the database is left as it was.

## Database versions

- Nyaay upgrades its own database on start-up (`app/migrations`). Nothing to run by hand when you update.
- Check: `docker compose exec app python -m app.dbtool status` (schema version and rows per table). `check-nyaay.bat` / `python -m app.doctor` warns if the database is behind.

## Moving from the office PC (SQLite) to the server (PostgreSQL)

1. On the PC, stop Nyaay and make a backup: `python -m app.dbtool backup`.
2. See what will be copied: `python -m app.dbtool move --to postgresql+psycopg://nyaai:PASSWORD@SERVER:5432/nyaai --dry-run`
3. Copy it: the same command without `--dry-run`. It refuses to write into a database that already has data, copies every
   table, and then compares every table row for row with the original. Your SQLite file is not changed.
4. Copy `corpus.db` (the judgment library) into the server's `corpus` volume, set `NYAAI_DATABASE_URL`, start Nyaay.

## Updating

```
cd /opt/nyaay
# copy in the new version of the folder (keep your .env and Docker volumes)
docker compose up -d --build
```
Your data lives in Docker volumes, not in the folder, so updating the code does not touch it.

## Security checklist

- `POSTGRES_PASSWORD` is long and random. `.env` is readable only by you: `chmod 600 .env`.
- Only ports 80, 443 and your SSH port are open. The database and the backend are not published.
- Turn on automatic security updates: `sudo apt install unattended-upgrades`.
- Use SSH keys instead of a password, and turn off password login.
- WhatsApp webhook URL (if you use it): `https://your-address/api/webhooks/whatsapp`.

## If something is wrong

| Problem | Try |
|---|---|
| The page does not open | `docker compose ps` (all should be running). `docker compose logs caddy` shows certificate problems, usually the DNS record. |
| "Library is empty" after loading | `docker compose logs app`. The server may not reach the open-data bucket: run `docker compose exec app python -m app.doctor`. |
| AI is slow or "not connected" | `docker compose exec app python -m app.doctor` names the missing model and the exact command. |
| Out of memory | Use `qwen3:4b`, or move AI to a separate computer. |
