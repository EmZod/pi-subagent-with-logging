#!/bin/bash
# TDD-02-1: Commits should NOT happen after each tool call
# RED: Should FAIL on current code (commits after every tool)
set -e
EXT="${EXT:-$HOME/.pi/agent/extensions/shadow-git.ts}"
TEST_WS=$(mktemp -d)
mkdir -p "$TEST_WS/agents/test1"

PI_WORKSPACE_ROOT="$TEST_WS" PI_AGENT_NAME="test1" \
  timeout 120 pi --max-turns 2 --no-input -p \
  -e "$EXT" "Write 'a' to output/a.txt, 'b' to output/b.txt, 'c' to output/c.txt" 2>&1 >/dev/null || true

AGENT_DIR="$TEST_WS/agents/test1"
TOOL_CALLS=$(grep -c '"event":"tool_call"' "$AGENT_DIR/audit.jsonl" 2>/dev/null || echo 0)

if [ -d "$AGENT_DIR/.git" ]; then
  COMMITS=$(cd "$AGENT_DIR" && git log --oneline 2>/dev/null | wc -l | tr -d ' ')
else
  COMMITS=$(cd "$TEST_WS" && git log --oneline 2>/dev/null | wc -l | tr -d ' ')
fi

echo "Tool calls: $TOOL_CALLS, Commits: $COMMITS"

if [ "$TOOL_CALLS" -ge 3 ] && [ "$COMMITS" -lt "$TOOL_CALLS" ]; then
  echo "PASS: commits ($COMMITS) < tool calls ($TOOL_CALLS)"
  rm -rf "$TEST_WS"
  exit 0
else
  echo "FAIL: too many commits"
  rm -rf "$TEST_WS"
  exit 1
fi
