#!/bin/bash
# TDD-02-1: Commits should NOT happen after each tool call
# Current behavior: Commits per tool (should FAIL)
# Target behavior: Commits per turn (should PASS after implementation)
set -e
EXT="${EXT:-$HOME/.pi/agent/extensions/shadow-git.ts}"
TEST_WS=$(mktemp -d)
cd "$TEST_WS"
git init >/dev/null 2>&1
mkdir -p agents/test1
git add -A && git commit -m "init" --allow-empty >/dev/null 2>&1

# Run agent - max 2 turns, should make multiple tool calls
PI_WORKSPACE_ROOT="$TEST_WS" PI_AGENT_NAME="test1" \
  pi --max-turns 2 --no-input -p \
  -e "$EXT" "Write 'a' to output/a.txt and 'b' to output/b.txt" 2>&1 >/dev/null || true

AGENT_DIR="$TEST_WS/agents/test1"
TOOL_CALLS=$(grep -c '"event":"tool_call"' "$AGENT_DIR/audit.jsonl" 2>/dev/null || echo 0)

# Count commits (either in agent dir or root)
if [ -d "$AGENT_DIR/.git" ]; then
  COMMITS=$(cd "$AGENT_DIR" && git log --oneline 2>/dev/null | wc -l | tr -d ' ')
else
  COMMITS=$(git log --oneline 2>/dev/null | wc -l | tr -d ' ')
fi

echo "Tool calls: $TOOL_CALLS, Commits: $COMMITS"
rm -rf "$TEST_WS" 2>/dev/null || true

# ASSERTION: After refactor, commits should be LESS than tool calls
# Currently: commits >= tool calls (per-tool commits), so test should FAIL
# After: commits < tool calls (per-turn commits), so test should PASS

if [ "$TOOL_CALLS" -gt 0 ] && [ "$COMMITS" -le "$TOOL_CALLS" ]; then
  echo "PASS: commits ($COMMITS) <= tool calls ($TOOL_CALLS) - turn-level commits"
  exit 0
else
  echo "FAIL: commits ($COMMITS) > tool calls ($TOOL_CALLS) - still per-tool commits"
  exit 1
fi
