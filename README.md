# pi-hook-logging

Git-based orchestration logging for [pi](https://github.com/badlogic/pi) subagents.

Enables branching, rewinding, and forking agent execution paths through automatic git commits and structured audit logging.

## The Problem

When orchestrating multiple pi agents, you need:
- **Auditability**: What did each agent do, when?
- **Recoverability**: Branch from any point, rewind mistakes
- **Observability**: Real-time progress tracking

## The Solution

A pi hook that:
1. Commits workspace state after every tool call, turn, and agent completion
2. Writes structured JSONL audit logs
3. Captures patches when agents modify external repos

## Installation

```bash
# Clone
git clone https://github.com/EmZod/pi-hook-logging.git

# Copy hook to pi's global hooks directory
cp pi-hook-logging/src/shadow-git.ts ~/.pi/agent/hooks/
```

Or use directly with `--hook`:

```bash
pi --hook /path/to/pi-hook-logging/src/shadow-git.ts ...
```

## Usage

### 1. Create a Shadow Git Workspace

```bash
mkdir -p ~/workspaces/task-001
cd ~/workspaces/task-001
git init

mkdir -p orchestrator agents/scout1/{workspace,output}
git add -A && git commit -m "Initial workspace"
```

### 2. Spawn Agent with Hook

```bash
PI_WORKSPACE_ROOT="$(pwd)" \
PI_AGENT_NAME="scout1" \
  pi \
    --model claude-haiku-4-5 \
    --tools read,write,bash \
    --no-input \
    --hook ~/.pi/agent/hooks/shadow-git.ts \
    "Read agents/scout1/plan.md and execute."
```

### 3. View History

```bash
git log --oneline
# aed6ec9 [scout1:turn] turn 5 complete
# 87fc5bc [scout1:tool] write: output/findings.md
# 6622667 [scout1:turn] turn 2 complete
# 983e96f [scout1:tool] read: plan.md
# b53d7f7 [scout1:start] initialized
```

### 4. Branch and Fork

```bash
# Branch from turn 2
git checkout -b alternative 6622667

# Spawn new agent from that state
PI_WORKSPACE_ROOT="$(pwd)" PI_AGENT_NAME="scout1-v2" \
  pi --hook ~/.pi/agent/hooks/shadow-git.ts ...
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PI_WORKSPACE_ROOT` | Yes | Root of the shadow git workspace |
| `PI_AGENT_NAME` | Yes | Agent name for commits and paths |
| `PI_TARGET_REPOS` | No | Comma-separated target repo paths |
| `PI_TARGET_BRANCH` | No | Branch name for commit linkage |

## Commit Messages

| Event | Format |
|-------|--------|
| Session start | `[agent:start] initialized` |
| Tool call | `[agent:tool] {tool}: {path or brief}` |
| Turn end | `[agent:turn] turn {N} complete` |
| Agent end | `[agent:end] completed ({N} messages)` |

## Audit Log

Events are appended to `agents/{name}/audit.jsonl`:

```json
{"ts":1704567890123,"event":"tool_call","agent":"scout1","turn":3,"tool":"write","input":{...}}
{"ts":1704567890456,"event":"tool_result","agent":"scout1","turn":3,"tool":"write","error":false}
{"ts":1704567890789,"event":"turn_end","agent":"scout1","turn":3,"toolResultCount":1}
```

Query with jq:

```bash
# Tool calls only
jq 'select(.event == "tool_call")' agents/scout1/audit.jsonl

# Errors
jq 'select(.error == true)' agents/scout1/audit.jsonl
```

## Target Repo Patches

When agents modify files outside the workspace, patches are captured:

```
target-patches/
└── repo-name/
    ├── turn-001-write-1.patch
    └── turn-003-edit-2.patch
```

Replay: `git apply target-patches/repo-name/turn-001-write-1.patch`

## For AI Agents

See [AGENTS.md](AGENTS.md) for agent-specific instructions.

## License

MIT
