#!/bin/sh
# Runs inside the "jobs" container. Times are UTC: brief 08:00 IST, eCourts sync 22:30 IST, backup 01:30 IST.
# Each job runs once per day: a marker file stops a drifting loop from running it twice or skipping it.
# Times are HHMM in UTC. A job runs at its start time, or later if the server was down, but never after its end time.
set -u
mkdir -p /data/backups /data/markers

once() {  # once <name> <from HHMM UTC> <until HHMM UTC> <command...>
  name=$1; from=$2; until=$3; shift 3
  now=$(date -u +%H%M); today=$(date -u +%F)
  if [ "$now" -ge "$from" ] && [ "$now" -le "$until" ] && [ "$(cat /data/markers/$name 2>/dev/null)" != "$today" ]; then
    echo "$(date -u +%FT%TZ) running $name"
    if "$@"; then echo "$today" > /data/markers/$name; else echo "$(date -u +%FT%TZ) $name failed"; fi
  fi
}

pg_backup() {  # pg_dump of the firm database + judgment library copy, 14 kept, then a test restore (see app/dbtool.py)
  python -m app.jobs backup
}

while true; do
  once brief  0230 0430 python -m app.jobs brief      # only in the 2 hours after 08:00 IST, never late
  once sync   1700 2359 python -m app.jobs sync       # 22:30 IST, catches up later the same UTC day
  once backup 2000 2359 pg_backup                     # 01:30 IST next morning
  sleep 60
done
