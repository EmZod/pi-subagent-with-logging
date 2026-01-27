#!/bin/bash
# TDD-01-4: Parallel agents should have ZERO git lock conflicts
# RED: Should FAIL on current code (shared .git causes locks)
set -e
EXT="${EXT:-$HOME/.pi/agent/extensions/shadow-git.ts}"
TEST_WS=$(mktemp -d)
cd "$TEST_WS"
git init >/dev/null 2>&1
mkdir -p agents/{a1,a2,a3}
git add -A && git commit -m "init" >/dev/null 2>&1

for agent in a1 a2 a3; do
  PI_WORKSPACE_ROOT="$TEST_WS" PI_AGENT_NAME="$agent" \
    pi --max-turns 2 --no-input -p \
    -e "$EXT" "Write 'hello' to output/greeting.txt" 2>&1 >/dev/null &
done
wait

LOCK_ERRORS=$(grep -r "index.lock\|Unable to create.*lock" "$TEST_WS"/agents/*/audit.jsonl 2>/dev/null | wc -l | tr -d ' ' || echo 0)

if [ "$LOCK_ERRORS" -eq 0 ]; then
  echo "PASS: zero lock conflicts"
  rm -rf "$TEST_WS"
  exit 0
else
  echo "FAIL: $LOCK_ERRORS lock conflicts detected"
  rm -rf "$TEST_WS"
  exit 1
fi
