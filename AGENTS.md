# Agent Instructions

This repository contains a pi hook for git-based orchestration logging. Read this file first.

## Quick Start

To use the shadow-git hook in your agent workflow:

```bash
PI_WORKSPACE_ROOT="/path/to/workspace" \
PI_AGENT_NAME="your-agent-name" \
  pi --hook /path/to/src/shadow-git.ts "your prompt"
```

## What This Hook Does

When enabled, the hook:

1. **Commits after every tool call** — `[agent:tool] write: path/to/file`
2. **Commits after every turn** — `[agent:turn] turn 3 complete`
3. **Commits on agent completion** — `[agent:end] completed`
4. **Writes structured audit logs** — `audit.jsonl` in the agent directory

This enables the orchestrator to:
- View agent history with `git log`
- Branch from any point with `git checkout -b`
- Rewind agent state with `git checkout HEAD~N`
- Query events with `jq` on the audit file

## Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `PI_WORKSPACE_ROOT` | Absolute path to the shadow git workspace (must be git-initialized) |
| `PI_AGENT_NAME` | Name of this agent (used in commit messages and file paths) |

## Optional Environment Variables

| Variable | Purpose |
|----------|---------|
| `PI_TARGET_REPOS` | Comma-separated paths to target repos (for patch capture) |
| `PI_TARGET_BRANCH` | Branch name to include in commits (for linkage) |

## File Structure

When the hook runs, it expects this workspace structure:

```
{PI_WORKSPACE_ROOT}/
├── .git/                    # Required: workspace must be a git repo
├── agents/
│   └── {PI_AGENT_NAME}/
│       ├── audit.jsonl      # Created by hook: structured event log
│       ├── plan.md          # Your agent's plan (optional)
│       ├── log.md           # Your agent's execution log (optional)
│       └── output/          # Your agent's outputs (optional)
└── target-patches/          # Created by hook: diffs of target repo changes
```

## Spawning Pattern

For orchestrators spawning subagents:

```bash
# Create workspace
mkdir -p workspace/agents/scout1/{workspace,output}
cd workspace && git init

# Option 1: Use the spawn script (recommended)
./examples/spawn-with-logging.sh "$(pwd)" scout1 "Read plan.md and execute."

# Option 2: Set env vars before tmux to avoid quoting issues
WORKSPACE="$(pwd)"
PI_WORKSPACE_ROOT="$WORKSPACE" \
PI_AGENT_NAME="scout1" \
  tmux new-session -d -s scout1 \
    "cd $WORKSPACE/agents/scout1 && \
     pi --hook /path/to/src/shadow-git.ts \
        --model claude-haiku-4-5 \
        --no-input \
        \"Read plan.md and execute.\" \
        2>&1 | tee output/run.log"
```

**Warning**: Complex shell quoting in tmux commands can cause arguments to be split incorrectly. If you encounter issues where parts of arguments are sent as prompts, use the spawn script or write a temp script file.

## Querying Audit Logs

```bash
# All events for an agent
cat agents/scout1/audit.jsonl

# Tool calls only
jq 'select(.event == "tool_call")' agents/scout1/audit.jsonl

# Errors only
jq 'select(.error == true)' agents/scout1/audit.jsonl

# Event timeline
jq -c '{ts, event, tool}' agents/scout1/audit.jsonl
```

## Branching Workflow

```bash
# See agent history
git log --oneline

# Branch from specific commit
git checkout -b alternative abc1234

# Continue with new agent from that point
PI_WORKSPACE_ROOT="$(pwd)" PI_AGENT_NAME="scout1-v2" \
  pi --hook /path/to/src/shadow-git.ts ...
```

## Integration with pi Subagent Orchestration

This hook complements the pi subagent orchestration skill:

| Layer | Scope | This Hook's Role |
|-------|-------|------------------|
| Workspace | Plans, logs, outputs | Tracks via shadow git commits |
| Target repo | Code being modified | Captures patches only |

The skill doc's git worktrees/branches handle target repo isolation. This hook handles workspace state tracking.
