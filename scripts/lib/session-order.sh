# Putting two database sessions in a KNOWN order, without guessing at timing (sourced by the concurrency scripts).
#
# A fixed `sleep` between starting a first session in the background and a second one in the foreground only works
# when the machine is fast enough; on a loaded runner the second gets in first and a correct refusal reads as a
# failure (CI, 2026-11-24). Instead:
#   gate_close                 a session of its own takes an advisory lock (the gate) and keeps it;
#   held U "BEFORE" "AFTER"    member U runs BEFORE in one transaction, then waits AT the gate, then runs AFTER and
#                              commits (run it in the background, note its $!);
#   parked PID                 waits until that session is at the gate: everything BEFORE is done and its locks are
#                              held (or the session has ended, e.g. with an error: the caller's checks then say so);
#   blocked_or_done PID        waits until a second session is waiting on a lock, or has finished; sets BLOCKED=1/0;
#   gate_open                  ends the gate session: the held one goes on and commits.
# Every wait has a timeout of 30 s and fails the script with what it was waiting for.
# Needs PGURL, and a function `fail` in the caller.
SESSION_GATE_KEY=5050
_count() { psql "$PGURL" -X -qtA -c "$1" 2>/dev/null || echo 0; }

gate_close() {
  PGAPPNAME=cellr_gate psql "$PGURL" -X -qtA -c "select pg_advisory_lock($SESSION_GATE_KEY); select pg_sleep(300)" >/dev/null 2>&1 &
  GATE_PID=$!
  local i
  for i in $(seq 1 600); do
    [ "$(_count "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                 where a.application_name = 'cellr_gate' and l.locktype = 'advisory' and l.objid = $SESSION_GATE_KEY and l.granted")" -ge 1 ] && return 0
    sleep 0.05
  done
  fail "session-order: the gate was not taken within 30 s"
}

gate_open() {
  _count "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name = 'cellr_gate'" >/dev/null
  wait "$GATE_PID" 2>/dev/null || true
}

# held U "BEFORE" ["AFTER"]: one transaction of member U that stops at the gate between BEFORE and AFTER.
held() {
  PGAPPNAME=cellr_held psql "$PGURL" -X -qtA -c "begin; select test.as_user($1); $2; select pg_advisory_xact_lock_shared($SESSION_GATE_KEY); ${3:+$3;} commit;" 2>&1 | grep -v '^$' || true
}

parked() {   # $1 = the background job's pid
  local i
  for i in $(seq 1 600); do
    kill -0 "$1" 2>/dev/null || return 0
    [ "$(_count "select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
                 where a.application_name = 'cellr_held' and l.locktype = 'advisory' and l.objid = $SESSION_GATE_KEY and not l.granted")" -ge 1 ] && return 0
    sleep 0.05
  done
  fail "session-order: the first session did not reach the gate within 30 s"
}

# blocked_or_done PID [APPNAME]: the second session (started with PGAPPNAME=APPNAME, default cellr_second).
blocked_or_done() {
  local app="${2:-cellr_second}" i
  BLOCKED=0
  for i in $(seq 1 600); do
    if [ "$(_count "select count(*) from pg_stat_activity where application_name = '$app' and wait_event_type = 'Lock'")" -ge 1 ]; then
      BLOCKED=1; return 0
    fi
    kill -0 "$1" 2>/dev/null || return 0
    sleep 0.05
  done
  fail "session-order: the second session neither waited on a lock nor finished within 30 s"
}
