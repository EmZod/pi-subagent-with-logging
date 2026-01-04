---
name: pi-subagent-orchestration
description: Orchestrate subagents in pi for complex, parallelizable tasks. Use when decomposing work across multiple isolated agents - research, implementation, review, refactoring, or any task benefiting from parallel execution or context isolation. Covers blocking (wait for results) and non-blocking (background) patterns, workspace setup, logging protocol enforcement, git-based coordination, and long-duration task integrity.
---

# Pi Subagent Orchestration

**YOU ARE AN ORCHESTRATING AGENT.** Your job is to decompose complex tasks, spawn subagents, coordinate their work, and synthesize results. You never execute leaf-level work yourself when subagents are more appropriate.

---

## ⚠️ THE RESOURCE COMMANDMENTS ⚠️

**SUBAGENTS CONSUME REAL RESOURCES. EVERY AGENT YOU SPAWN:**
- Uses CPU and memory on the user's machine
- Costs money (API calls to LLM providers)
- Runs until killed or max-turns reached
- Can accumulate silently if forgotten

### The 7 Commandments

1. **THOU SHALT KILL WHAT THOU SPAWNS**
   - Every spawn must have a corresponding cleanup plan
   - Never assume agents will terminate themselves

2. **THOU SHALT TRACK ALL PROCESSES**
   - Record PIDs or tmux session names
   - Maintain a list of what you spawned

3. **THOU SHALT SET MAX-TURNS**
   - Always use `--max-turns` to prevent runaway agents
   - 20-30 turns for research, 50 max for complex tasks

4. **THOU SHALT CLEAN UP ON EXIT**
   - Before ending your session, kill all spawned agents
   - `tmux kill-server` or `kill $(cat agents/*/pid)`

5. **THOU SHALT CHECK BEFORE SPAWNING**
   - Run `tmux ls` to see existing sessions
   - Run `ps aux | grep pi` to find orphaned agents
   - Kill stale processes before starting new work

6. **THOU SHALT NOT SPAWN OPUS LIGHTLY**
   - `claude-opus-4-5` costs 15x more than haiku
   - Use haiku for research, sonnet for synthesis
   - Opus only for genuinely hard problems

7. **THOU SHALT MONITOR RESOURCE USAGE**
   - Check `top` or Activity Monitor periodically
   - Watch for runaway CPU/memory consumption
   - Kill stuck agents immediately

### Cleanup Commands (Memorize These)

```bash
# See all tmux sessions
tmux ls

# Kill ALL tmux sessions (nuclear option)
tmux kill-server

# Kill specific session
tmux kill-session -t agent-name

# Find orphaned pi processes
ps aux | grep -E "[p]i --model"

# Kill by PID
kill <pid>

# Check system load
uptime
```

### Before You Start ANY Orchestration

```bash
# 1. Check for existing agents
tmux ls 2>/dev/null || echo "No tmux sessions"
ps aux | grep -E "[p]i --model" | grep -v grep

# 2. Kill any stale agents from previous work
tmux kill-server 2>/dev/null

# 3. Check system resources
uptime  # Load should be < number of CPU cores
```

**IF YOU SPAWN IT, YOU OWN IT. CLEAN UP AFTER YOURSELF.**

---

## Quick Start: Spawn a Single Agent

If you just need to spawn ONE agent quickly, here's the minimum viable setup:

```bash
# 1. Create workspace
WORKSPACE="$HOME/workspaces/$(date +%Y%m%d)-task"
mkdir -p "$WORKSPACE/agents/scout1"/{workspace,output}
cd "$WORKSPACE"
git init && git commit --allow-empty -m "Initial workspace"

# 2. Write the plan
cat > agents/scout1/plan.md << 'EOF'
# Plan: Research Task

## Objective
Research X and produce findings.

## Steps
1. Read the codebase/docs
2. Document findings in output/findings.md

## Output
- output/findings.md
EOF

# 3. Spawn (tmux for observability)
tmux new-session -d -s scout1 \
  "cd $WORKSPACE/agents/scout1 && \
   pi --model claude-haiku-4-5 --max-turns 20 --no-input \
   'Read plan.md and execute it.' \
   2>&1 | tee output/run.log"

# 4. Check status
tmux has-session -t scout1 2>/dev/null && echo "Running" || echo "Done"

# 5. View output when done
cat agents/scout1/output/findings.md
```

**That's it.** For more complex orchestration (multiple agents, audit trails, coordination), read on.

---

## Table of Contents

0. [THE RESOURCE COMMANDMENTS](#️-the-resource-commandments-️) ← **READ THIS FIRST**
1. [Critical Concepts](#critical-concepts)
2. [Pre-Flight Decisions](#pre-flight-decisions)
3. [Workspace Structure](#workspace-structure)
4. [Spawning Methods](#spawning-methods)
5. [Shadow Git Hook (Audit Trail)](#shadow-git-hook-audit-trail)
6. [Live Dashboard for Monitoring](#live-dashboard-for-monitoring)
7. [Output Aggregation Patterns](#output-aggregation-patterns)
8. [Git-Based Coordination](#git-based-coordination)
9. [Logging Protocol](#logging-protocol)
10. [Error Handling and Recovery](#error-handling-and-recovery)
11. [Quick Reference](#quick-reference)
12. [Gotchas and Hard-Won Lessons](#gotchas-and-hard-won-lessons) ← **LEARN FROM THESE**

---

## Critical Concepts

### Why Subagents?

| Problem | Solution |
|---------|----------|
| Task too large for one context window | Decompose into focused subtasks |
| Need parallelism | Spawn multiple agents simultaneously |
| Need isolation | Each agent has clean context |
| Need audit trail | Shadow git tracks everything |
| Task may exceed max turns | Handoff to continuation agent |

### Pi Sessions vs Shadow Git

**Pi has built-in session management** — it stores conversation history in `~/.pi/agent/sessions/`. This is great for single-agent work but has limitations for orchestration:

| Feature | Pi Sessions | Shadow Git |
|---------|-------------|------------|
| Scope | Per-agent, per-cwd | Cross-agent, single workspace |
| Branching | Tree structure, UI-driven | Git branches, CLI-driven |
| Multi-agent | Separate session files | Unified git history |
| Audit queries | Limited | `git log`, `jq` on JSONL |
| Target repo changes | Not tracked | Captured as patches |

**Use both**: Pi sessions for individual agent state, shadow git for orchestration-level audit trail.

### The TTY Problem (CRITICAL)

**Pi has a Terminal User Interface (TUI)** that shows progress, token counts, and costs. This TUI needs a real terminal (TTY) to render.

**The problem:** When you run `pi` in the background with `&` or `nohup`, there's no terminal. The TUI tries to render, fails, and the process crashes or hangs.

**Simple decision tree:**

```
Do you need to OBSERVE the agent while it runs?
│
├── YES → Use tmux (provides virtual terminal)
│         tmux new-session -d -s name "pi ..."
│
└── NO → Use --print-last flag (disables TUI)
          (pi --print-last ...) &
```

**NEVER do this:**
```bash
pi ... &              # WRONG: No TTY, no --print-last → crash
nohup pi ... &        # WRONG: nohup doesn't provide TTY
```

---

## Pre-Flight Decisions

**Before spawning ANY subagent, decide and document:**

### 1. Execution Mode

| Mode | When | How |
|------|------|-----|
| **Blocking** | Need result before continuing | `pi --print-last ...` (no `&`) |
| **Non-blocking** | Fire and forget, check later | tmux or `(pi --print-last ...) &` |
| **Parallel + Join** | Multiple independent tasks, wait for all | Spawn all, then `wait` |

### 2. Environment Strategy

| Strategy | When | Setup |
|----------|------|-------|
| **Shared workspace** | Read-only operations | All agents in same dir |
| **Separate directories** | Writes, no git | `agents/{name}/workspace/` |
| **Git worktrees** | Writes, need isolation + merge | `git worktree add ...` |
| **Git branches** | Sequential handoffs | Branch per stage |

### 3. Output Aggregation

| Strategy | When |
|----------|------|
| **Orchestrator reads all** | Few agents (3-5), small outputs |
| **Aggregator subagent** | Many agents, need synthesis |
| **Programmatic** | JSON/CSV, deterministic combine |
| **User explores** | Uncertain value, user guides |

**Record these decisions** in `orchestrator/decisions.md` before spawning.

---

## Workspace Structure

Every orchestration task needs a workspace:

```
{workspace_root}/
├── .git/                      # REQUIRED: For shadow git audit trail
├── orchestrator/
│   ├── decisions.md           # Pre-flight decisions
│   ├── log.md                 # Orchestrator's execution log
│   └── synthesis/             # Final outputs
│
├── agents/
│   ├── {agent_name}/
│   │   ├── plan.md            # REQUIRED: What to do
│   │   ├── log.md             # Agent's execution log
│   │   ├── audit.jsonl        # Created by shadow-git hook
│   │   ├── workspace/         # Agent's working files
│   │   └── output/            # Agent's deliverables
│   │
│   └── {agent_name_2}/
│       └── ...
│
└── target-patches/            # Created by shadow-git: changes to external repos
```

### Creating a Workspace

```bash
# Full setup with git (required for shadow-git hook)
WORKSPACE="$HOME/workspaces/$(date +%Y%m%d)-$TASK_NAME"
mkdir -p "$WORKSPACE"/{orchestrator,agents}
cd "$WORKSPACE"
git init
git commit --allow-empty -m "Initialize orchestration workspace"

# Create orchestrator files
cat > orchestrator/decisions.md << 'EOF'
# Pre-Flight Decisions

## Task
{description}

## Execution Mode
{blocking|non-blocking|parallel-join}

## Environment
{shared|directories|worktrees|branches}

## Output Aggregation
{orchestrator|aggregator|programmatic|user-explores}

## Agents
| Name | Role | Model | Tools |
|------|------|-------|-------|
| scout1 | research | claude-haiku-4-5 | read,bash,browser |
| worker1 | implement | claude-sonnet-4-20250514 | read,write,edit,bash |
EOF

echo "# Orchestrator Log" > orchestrator/log.md
```

### Creating an Agent Directory

```bash
AGENT="scout1"
mkdir -p "agents/$AGENT"/{workspace,output}

# Write plan.md (REQUIRED)
cat > "agents/$AGENT/plan.md" << 'EOF'
# Plan: {Task Name}

## Objective
{One sentence: what this agent must accomplish}

## Scope
- IN: {what IS in scope}
- OUT: {what is NOT in scope}

## Steps

### STEP-01: {Title}
- Do: {action}
- Output: {file or result}

### STEP-02: {Title}
...

### FINAL: Compile Output
- Write findings to output/
- Ensure log.md is complete

## Boundaries
- Do NOT exceed scope
- Log ambiguity, choose simplest path
- All deliverables → output/
EOF
```

---

## Spawning Methods

### Method 1: tmux (RECOMMENDED for most cases)

**Why tmux?** It provides a virtual terminal, so pi's TUI works. You can attach to observe progress, costs, and debug.

```bash
# Single agent
tmux new-session -d -s scout1 \
  "cd agents/scout1 && \
   pi --model claude-haiku-4-5 \
      --tools read,bash,browser \
      --max-turns 30 \
      --no-input \
      'Read plan.md and execute it.' \
      2>&1 | tee output/run.log"

# Check if running
tmux has-session -t scout1 2>/dev/null && echo "Running" || echo "Done"

# Attach to observe (Ctrl+B then D to detach)
tmux attach -t scout1

# Kill if stuck
tmux kill-session -t scout1
```

**Multiple agents in parallel:**

```bash
AGENTS="scout1 scout2 scout3"

for agent in $AGENTS; do
  tmux new-session -d -s "$agent" \
    "cd agents/$agent && \
     pi --model claude-haiku-4-5 --max-turns 30 --no-input \
     'Read plan.md and execute.' 2>&1 | tee output/run.log"
  echo "Spawned: $agent"
done

# List all sessions
tmux ls

# Wait for all to complete (poll)
while tmux ls 2>/dev/null | grep -qE "scout[123]"; do
  echo "Waiting... $(date)"
  sleep 30
done
echo "All done"
```

### Method 2: Bash Background with --print-last

**When to use:** Simple tasks where you don't need to observe progress.

**CRITICAL:** The `--print-last` flag is MANDATORY. It disables the TUI.

```bash
# Single agent
(cd agents/scout1 && \
 pi --model claude-haiku-4-5 \
    --max-turns 20 \
    --no-input \
    --print-last \
    'Read plan.md and execute.' \
    2>&1 | tee output/run.log) &
echo $! > agents/scout1/pid

# Check if running
ps -p $(cat agents/scout1/pid) >/dev/null 2>&1 && echo "Running" || echo "Done"

# Wait for completion
wait $(cat agents/scout1/pid)
echo "Exit code: $?"
```

**Multiple agents:**

```bash
for agent in scout1 scout2 scout3; do
  (cd agents/$agent && \
   pi --print-last --model claude-haiku-4-5 --max-turns 20 --no-input \
   'Read plan.md and execute.' 2>&1 | tee output/run.log) &
  echo $! > agents/$agent/pid
done

# Wait for all
wait
echo "All agents completed"
```

### Method 3: Blocking (Sequential)

**When to use:** Agent B needs Agent A's output.

```bash
# Agent 1 (blocking - wait for result)
cd agents/scout
pi --model claude-haiku-4-5 --max-turns 20 --no-input --print-last \
   'Read plan.md and execute.' > output/result.txt 2>&1

# Agent 2 (uses Agent 1's output)
FINDINGS=$(cat agents/scout/output/result.txt)
cd agents/planner
pi --model claude-sonnet-4-20250514 --max-turns 20 --no-input --print-last \
   "Based on these findings: $FINDINGS - create implementation plan." \
   > output/result.txt 2>&1
```

---

## Shadow Git Hook (Audit Trail)

The shadow-git hook creates a git-based audit trail of all agent activity. Every tool call, turn, and agent completion is committed to the workspace's git repo.

### Why Use It?

| Benefit | How |
|---------|-----|
| **Audit trail** | `git log` shows all agent actions |
| **Branching** | `git checkout -b` to fork agent execution |
| **Rewinding** | `git checkout HEAD~5` to go back in time |
| **Multi-agent tracking** | All agents commit to same repo |
| **Structured queries** | `jq` on audit.jsonl for analytics |

### Installation

```bash
# Option 1: Clone the repo
git clone https://github.com/EmZod/pi-hook-logging.git ~/.pi-hooks

# Option 2: Copy just the hook
mkdir -p ~/.pi/agent/hooks
curl -o ~/.pi/agent/hooks/shadow-git.ts \
  https://raw.githubusercontent.com/EmZod/pi-hook-logging/main/src/shadow-git.ts
```

### Usage

**Environment variables (REQUIRED):**

| Variable | Required | Description |
|----------|----------|-------------|
| `PI_WORKSPACE_ROOT` | Yes | Absolute path to workspace (must be git repo) |
| `PI_AGENT_NAME` | Yes | Agent name (used in commits and paths) |
| `PI_TARGET_REPOS` | No | Comma-separated paths to track external repos |
| `PI_TARGET_BRANCH` | No | Branch name to include in commits |

**Spawning with shadow-git:**

```bash
# Using tmux (RECOMMENDED)
WORKSPACE="/path/to/workspace"
AGENT="scout1"
HOOK="$HOME/.pi/agent/hooks/shadow-git.ts"

tmux new-session -d -s "$AGENT" \
  "cd $WORKSPACE/agents/$AGENT && \
   PI_WORKSPACE_ROOT='$WORKSPACE' \
   PI_AGENT_NAME='$AGENT' \
   pi --model claude-haiku-4-5 \
      --max-turns 30 \
      --no-input \
      --hook '$HOOK' \
      'Read plan.md and execute.' \
      2>&1 | tee output/run.log"
```

**Using the spawn script (easiest):**

```bash
# Clone the hook repo
git clone https://github.com/EmZod/pi-hook-logging.git

# Use the spawn script
./pi-hook-logging/examples/spawn-with-logging.sh \
  "/path/to/workspace" \
  "scout1" \
  "Read plan.md and execute."
```

### What Gets Logged

**Git commits:**
```
aed6ec9 [scout1:turn] turn 5 complete
87fc5bc [scout1:tool] write: output/findings.md
6622667 [scout1:turn] turn 2 complete
983e96f [scout1:tool] read: plan.md
b53d7f7 [scout1:start] initialized
```

**Audit JSONL** (`agents/scout1/audit.jsonl`):
```json
{"ts":1704567890123,"event":"tool_call","agent":"scout1","turn":3,"tool":"write","input":{...}}
{"ts":1704567890456,"event":"tool_result","agent":"scout1","turn":3,"tool":"write","error":false}
{"ts":1704567890789,"event":"turn_end","agent":"scout1","turn":3,"toolResultCount":1}
```

### Querying the Audit Trail

```bash
# View agent history
git log --oneline

# View specific agent's commits
git log --oneline --grep="scout1"

# Query audit events
jq 'select(.event == "tool_call")' agents/scout1/audit.jsonl

# Find errors
jq 'select(.error == true)' agents/scout1/audit.jsonl

# Event timeline
jq -c '{ts: .ts, event: .event, tool: .tool}' agents/scout1/audit.jsonl
```

### Branching and Forking Execution

```bash
# See history
git log --oneline

# Branch from specific point
git checkout -b alt-approach abc1234

# Kill current agent
tmux kill-session -t scout1

# Spawn new agent from branched state
PI_WORKSPACE_ROOT="$(pwd)" PI_AGENT_NAME="scout1-v2" \
  pi --hook ~/.pi/agent/hooks/shadow-git.ts ...
```

---

## Live Dashboard for Monitoring

A real-time dashboard helps visualize multi-agent orchestration. Located at `~/.pi/bin/pi-dashboard-smooth`.

### Architecture (Goedecke-Approved: Simple, Boring, Works)

```
[Agents] → [shadow-git] → [audit.jsonl]
                              ↓
                    [Data Generator Script]
                              ↓
                    [.dashboard-data.json]
                              ↓
                    [Browser JS polling]
                              ↓
                    [AnimeJS DOM updates]
```

### Why This Architecture?

| Bad Approach | Problem | Good Approach |
|--------------|---------|---------------|
| Meta refresh `<meta http-equiv="refresh">` | Jarring flash, loses scroll, restarts animations | JS polling + JSON |
| file:// URLs | Browser blocks `fetch()` for security | Serve via HTTP |
| Check tmux for status | tmux session exists after agent_end | Check audit.jsonl first |
| Inline data in HTML | Must regenerate entire HTML on each update | Separate JSON data file |

### Quick Start

```bash
# Start dashboard for a workspace
~/.pi/bin/pi-dashboard-smooth /path/to/workspace 2 &

# Serve via HTTP (required for fetch to work)
python3 -m http.server 8888 --directory /path/to/workspace &

# Open in browser
open http://localhost:8888/.dashboard.html
```

### Status Detection Order (CRITICAL)

The dashboard must check status in this order:

```bash
# CORRECT ORDER:
if grep -q '"event":"agent_end"' audit.jsonl; then
  status="done"      # Agent completed, even if tmux still open
elif tmux has-session -t "$agent"; then
  status="running"   # Tmux exists, no agent_end = still working
elif [ -f "output/*.md" ]; then
  status="done"      # Has output files
else
  status="pending"   # Not started
fi
```

**Why?** Tmux sessions persist after agent completion (waiting for "press enter to close"). If you only check tmux, completed agents show as "running" forever.

### Atomic File Writes

Always write data atomically to prevent dashboard reading partial files:

```bash
# WRONG: Dashboard might read half-written file
cat > data.json << EOF
{"agents": [...]}
EOF

# RIGHT: Atomic write
cat > data.json.tmp << EOF
{"agents": [...]}
EOF
mv data.json.tmp data.json
```

### Premium Dashboard (Gemini-Generated)

For a stunning visual experience, use the Gemini-generated dashboard:

```bash
# Location
/Users/jay/Documents/Broad Building/daily_workspaces/jan5/experimental-dashboard/mission_control.html

# Features:
# - Gooey blob animations for agents
# - Glassmorphism panels
# - Canvas particle background
# - Smooth number transitions with AnimeJS
# - Real-time activity feed
```

---

## Output Aggregation Patterns

### Pattern A: Orchestrator Reads All (Simple)

**Use when:** 3-5 agents, small outputs.

```
[scout1] → output/findings.md ─┐
[scout2] → output/findings.md ─┼─→ [Orchestrator reads all] → User
[scout3] → output/findings.md ─┘
```

```bash
# After all agents complete, orchestrator reads outputs
for agent in scout1 scout2 scout3; do
  echo "=== $agent ==="
  cat agents/$agent/output/findings.md
  echo ""
done
```

### Pattern B: Aggregator Subagent

**Use when:** Many agents, complex synthesis needed.

```
[scout1] ─┐
[scout2] ─┼─→ [aggregator] → output/synthesis.md → [Orchestrator] → User
[scout3] ─┘
```

```bash
# Create aggregator after scouts complete
mkdir -p agents/aggregator/{workspace,output}

cat > agents/aggregator/plan.md << 'EOF'
# Plan: Synthesize Findings

## Objective
Read all scout outputs, produce unified synthesis.

## Input
- ../scout1/output/findings.md
- ../scout2/output/findings.md
- ../scout3/output/findings.md

## Steps
1. Read all findings
2. Identify themes, conflicts, gaps
3. Write output/synthesis.md

## Output
- output/synthesis.md (executive summary + details)
EOF

# Spawn aggregator (blocking - we need the result)
cd agents/aggregator
pi --model claude-sonnet-4-20250514 --max-turns 15 --no-input --print-last \
   'Read plan.md and execute.' 2>&1 | tee output/run.log
```

### Pattern C: Programmatic Combination

**Use when:** Structured outputs (JSON, CSV), deterministic merge.

```bash
# Combine JSON
jq -s 'add' agents/*/output/data.json > results/combined.json

# Combine markdown
for agent in scout1 scout2 scout3; do
  echo "# $agent"
  cat agents/$agent/output/findings.md
  echo "---"
done > results/all-findings.md
```

### Pattern D: User-Driven Exploration

**Use when:** Uncertain value, user wants control.

Present menu to user:
```
All 5 scouts completed:

| Agent | Focus | Summary |
|-------|-------|---------|
| scout1 | Frameworks | Found 6 frameworks |
| scout2 | Use Cases | 4 production deployments |
| scout3 | Benchmarks | 3 benchmark suites |

Options:
1. "Show scout2's findings" — Read specific output
2. "Synthesize scout1 and scout3" — Partial synthesis
3. "Synthesize all" — Full synthesis
```

---

## Git-Based Coordination

### Git Worktrees (Parallel Isolation)

**Use when:** Multiple agents editing same repo, need isolation + merge.

```bash
# Setup
git worktree add agents/worker1/workspace feature/worker1
git worktree add agents/worker2/workspace feature/worker2

# Spawn agents (they work in isolated copies)
for worker in worker1 worker2; do
  tmux new-session -d -s $worker \
    "cd agents/$worker/workspace && pi ... 'Make changes per plan.md'"
done

# After completion, merge
git checkout main
git merge feature/worker1 --no-ff -m "Worker 1 changes"
git merge feature/worker2 --no-ff -m "Worker 2 changes"

# Cleanup
git worktree remove agents/worker1/workspace
git worktree remove agents/worker2/workspace
```

### Git Branches (Sequential Handoffs)

**Use when:** Review gates, audit trail needed.

```bash
git checkout -b task/implement-feature

# Stage 1: Research
cd agents/scout && pi ... 'Research and commit findings'
git add -A && git commit -m "Scout: research complete"

# Stage 2: Plan (builds on scout's commit)
cd agents/planner && pi ... 'Review commits, create plan'
git add -A && git commit -m "Planner: implementation plan"

# Stage 3: Implement
cd agents/worker && pi ... 'Execute plan'
git add -A && git commit -m "Worker: implementation complete"

# Stage 4: Review
cd agents/reviewer && pi ... 'Review all commits on branch'
```

---

## Logging Protocol

**Every subagent MUST maintain an append-only log.**

### Why?

1. **Resumability** — If agent dies, new agent reads log, continues
2. **Debugging** — See exactly what happened
3. **Audit** — Record of all decisions

### Log Format

```markdown
# Agent Log: {agent_name}

## Current
step_id: STEP-01
status: IN_PROGRESS
objective: {what we're doing}

---

## STEP-01: {Title}

### Pre-Execution
**Objective**: {what to accomplish}
**Target**: {files/resources}
**Assumptions**: {what we believe to be true}

### Execution
- Did X
- Found Y
- Wrote Z

### Post-Execution
**Outcome**: PASS | PARTIAL | FAIL
**Notes**: {anything important}

**STEP-01 COMPLETE**

---

## STEP-02: ...
```

### Rules

1. **APPEND-ONLY** — Never edit previous entries
2. **FORWARD-ONLY FIXES** — Bug in STEP-03? Create STEP-04 to fix. Never go back.
3. **ATOMIC STEPS** — Pre → Execution → Post, then sealed
4. **LOG UNCERTAINTY** — Don't hide ambiguity, document it

### Subagent Prompt Template

Include this in every subagent prompt:

```
## LOGGING REQUIREMENTS

Maintain append-only log.md:
- Before each step: Log objective, assumptions
- During: Log findings, progress
- After: Log outcome (PASS/PARTIAL/FAIL), mark COMPLETE

RULES:
- NEVER edit previous entries
- Backtrack = new step that fixes forward
- Uncertainty = log it, choose simplest approach
```

---

## Error Handling and Recovery

### Agent Crashes

```bash
# Check if agent is running
tmux has-session -t scout1 2>/dev/null || echo "Crashed or completed"

# Check exit in log
tail -20 agents/scout1/output/run.log

# Check last step in log.md
grep -A5 "STEP-" agents/scout1/log.md | tail -20
```

### Resuming Failed Agent

```bash
# Create continuation agent
cat > agents/scout1-resume/plan.md << 'EOF'
# Plan: Continue scout1 Work

## Context
Previous agent crashed. Read ../scout1/log.md to find last completed step.

## Steps
1. Read ../scout1/log.md — find last COMPLETE step
2. Continue from next step
3. Complete remaining work
4. Output to ../scout1/output/ (same location)
EOF

tmux new-session -d -s scout1-resume \
  "cd agents/scout1-resume && pi ... 'Read plan.md and continue work.'"
```

### Agent Exceeds Max Turns

```bash
# Check progress
cat agents/scout1/log.md | grep "COMPLETE"

# If partially done, spawn continuation
# If stuck, review plan.md clarity and respawn with better instructions
```

### Conflicting Outputs

Log both versions, don't resolve automatically:
```bash
# In orchestrator log
echo "## CONFLICT: scout1 vs scout2
scout1 says: X
scout2 says: Y
Decision: {your decision and reasoning}" >> orchestrator/log.md
```

---

## Quick Reference

### Spawning Commands

| Task | Command |
|------|---------|
| Spawn with tmux | `tmux new-session -d -s NAME "cd DIR && pi ..."` |
| Spawn headless | `(cd DIR && pi --print-last ...) &` |
| Spawn blocking | `cd DIR && pi --print-last ...` |
| Spawn with audit | Add `PI_WORKSPACE_ROOT=... PI_AGENT_NAME=... --hook shadow-git.ts` |

### Process Management

| Task | tmux | bash background |
|------|------|-----------------|
| Check running | `tmux has-session -t NAME` | `ps -p $(cat pid)` |
| Wait | Poll with `tmux ls` | `wait $(cat pid)` |
| Kill | `tmux kill-session -t NAME` | `kill $(cat pid)` |
| Observe | `tmux attach -t NAME` | `tail -f output/run.log` |
| List all | `tmux ls` | `ps aux \| grep pi` |

### Models

| Model | Use For | Cost |
|-------|---------|------|
| `claude-haiku-4-5` | Fast research, simple tasks | Low |
| `claude-sonnet-4-20250514` | Complex reasoning, implementation | Medium |
| `claude-opus-4-5` | Hardest problems, synthesis | High |

### Tool Sets

| Tools | Use For |
|-------|---------|
| `read,grep,find,ls` | Read-only research |
| `read,bash,browser` | Web research |
| `read,write,edit,bash` | Implementation |
| (all default) | Full capability |

### Common Mistakes

| Wrong | Right |
|-------|-------|
| `pi ... &` | `(pi --print-last ...) &` or tmux |
| `nohup pi ...` | tmux (nohup has no TTY) |
| Relative hook path | Absolute path: `--hook /full/path/to/hook.ts` |
| Env vars after tmux | Env vars inline: `VAR=x tmux new-session -d "..."` |

---

## Gotchas and Hard-Won Lessons

These are real issues encountered during orchestration. Learn from them.

### 1. Stale Dashboard HTML

**Problem**: Dashboard shows old data even after agents complete.

**Cause**: Dashboard process was killed, HTML file is stale, browser auto-refreshes but loads same old file.

**Fix**: Check if dashboard generator is running. If not, delete `.dashboard.html` and restart.

### 2. Agent Shows "Running" Forever

**Problem**: Dashboard shows agent as "running" but it completed.

**Cause**: Status check looks at tmux session, which persists after `agent_end`.

**Fix**: Check `agent_end` event in audit.jsonl BEFORE checking tmux:
```bash
if grep -q '"event":"agent_end"' audit.jsonl; then
  status="done"  # Even if tmux session still exists
fi
```

### 3. Numbers Frozen at Zero

**Problem**: Dashboard shows 0 for turns/tools despite agents working.

**Cause**: Browser opened via `file://` URL, `fetch()` blocked by security.

**Fix**: Serve via HTTP:
```bash
python3 -m http.server 8888 --directory "$WORKSPACE"
open http://localhost:8888/.dashboard.html
```

### 4. Model Override Ignored

**Problem**: Specified `--model claude-haiku-4-5` but agent uses Opus.

**Cause**: Pi may have session state or config that overrides CLI flags.

**Fix**: Check `~/.pi/agent/settings.json` or use fresh session.

### 5. Hook Not Loading

**Problem**: Shadow-git commits not appearing, audit.jsonl not created.

**Cause**: Relative path to hook file.

**Fix**: Always use absolute paths:
```bash
# WRONG
--hook ../../hooks/shadow-git.ts

# RIGHT  
--hook /full/path/to/shadow-git.ts
```

### 6. Env Vars Not Passed to tmux

**Problem**: `PI_WORKSPACE_ROOT` not set inside tmux session.

**Cause**: Env vars set after tmux command, not inherited.

**Fix**: Set env vars inline BEFORE the command:
```bash
# WRONG
tmux new-session -d -s agent "PI_WORKSPACE_ROOT=$PWD pi ..."

# RIGHT
PI_WORKSPACE_ROOT="$PWD" tmux new-session -d -s agent "PI_WORKSPACE_ROOT='$PWD' pi ..."
```

### 7. Partial File Reads

**Problem**: Dashboard shows corrupted or partial data.

**Cause**: Reading file while it's being written.

**Fix**: Atomic writes:
```bash
cat > file.json.tmp << EOF
{"data": ...}
EOF
mv file.json.tmp file.json
```

### 8. Orphaned HTTP Servers

**Problem**: Port 8888 already in use.

**Cause**: Previous HTTP server not killed.

**Fix**: Find and kill:
```bash
lsof -i :8888
kill <pid>
```

---

## Checklist Before Spawning

```
[ ] Pre-flight decisions documented
    [ ] Execution mode (blocking/non-blocking/parallel)
    [ ] Environment (shared/directories/worktrees)
    [ ] Aggregation strategy

[ ] Workspace setup
    [ ] git init (required for shadow-git)
    [ ] orchestrator/decisions.md
    [ ] agents/{name}/ directories

[ ] Per-agent setup
    [ ] plan.md with clear steps
    [ ] log.md initialized
    [ ] output/ directory exists

[ ] Spawn command ready
    [ ] TTY decision: tmux OR --print-last
    [ ] Shadow-git hook: PI_WORKSPACE_ROOT, PI_AGENT_NAME set
    [ ] Absolute paths for --hook

[ ] Monitoring plan
    [ ] How to check status
    [ ] What to do if agent fails
    [ ] When/how to collect outputs
```

---

## Final Reminder: CLEANUP

**Before you finish ANY orchestration session:**

```bash
# 1. List what's running
tmux ls
ps aux | grep -E "[p]i --model" | grep -v grep

# 2. Kill everything you spawned
tmux kill-server  # or kill specific sessions

# 3. Verify cleanup
tmux ls  # Should show "no server running"
```

**You spawned it. You kill it. No exceptions.**
