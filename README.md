# pi-hook-logging

Git-based orchestration logging for pi subagents.

Enables branching, rewinding, and forking agent execution paths through automatic git commits and structured audit logging.

## The Problem

When orchestrating multiple pi agents, you need:

- **Auditability**: What did each agent do, when?
- **Recoverability**: Branch from any point, rewind mistakes
- **Observability**: Real-time progress tracking

## The Solution

A pi extension that:

- Commits workspace state after every tool call, turn, and agent completion
- Writes structured JSONL audit logs
- Captures patches when agents modify external repos
- **Provides a runtime killswitch** for disabling during incidents
- **Fails open** — git errors are logged but don't block the agent

## Installation

```bash
# Clone
git clone https://github.com/EmZod/pi-hook-logging.git

# Copy extension to pi's global extensions directory
cp pi-hook-logging/src/shadow-git.ts ~/.pi/agent/extensions/
```

Or use directly with `--extension` / `-e`:

```bash
pi -e /path/to/pi-hook-logging/src/shadow-git.ts ...
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

### 2. Spawn Agent with Extension

**Option A: Use the spawn script (recommended)**

```bash
./examples/spawn-with-logging.sh ~/workspaces/task-001 scout1 "Read plan.md and execute."
```

The script handles workspace initialization, directory creation, and proper shell quoting.

**Option B: Manual spawning**

```bash
PI_WORKSPACE_ROOT="$(pwd)" \
PI_AGENT_NAME="scout1" \
  pi \
    --model claude-haiku-4-5 \
    --tools read,write,bash \
    --no-input \
    -e ~/.pi/agent/extensions/shadow-git.ts \
    "Read agents/scout1/plan.md and execute."
```

> **Note**: When spawning via tmux, shell quoting can cause issues. Set env vars before the tmux command, or use the spawn script.

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
  pi -e ~/.pi/agent/extensions/shadow-git.ts ...
```

## Commands

The extension provides a `/shadow-git` command for runtime control:

| Command | Description |
|---------|-------------|
| `/shadow-git` | Show status (default) |
| `/shadow-git status` | Show detailed status |
| `/shadow-git enable` | Enable logging |
| `/shadow-git disable` | Disable logging (runtime killswitch) |
| `/shadow-git history` | Show last 20 commits |
| `/shadow-git stats` | Show commit/error statistics |

## Killswitch

During an incident, disable logging instantly:

**Runtime (no restart needed):**
```
/shadow-git disable
```

**Environment variable:**
```bash
PI_SHADOW_GIT_DISABLED=1 pi -e shadow-git.ts ...
```

The extension **fails open**: if git commits fail, errors are logged but the agent continues. This prevents git issues from blocking agent execution.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PI_WORKSPACE_ROOT` | Yes | Root of the shadow git workspace |
| `PI_AGENT_NAME` | Yes | Agent name for commits and paths |
| `PI_TARGET_REPOS` | No | Comma-separated target repo paths |
| `PI_TARGET_BRANCH` | No | Branch name for commit linkage |
| `PI_SHADOW_GIT_DISABLED` | No | Set to `1` or `true` to disable (killswitch) |

## Status Bar

When running, the extension shows status in the footer:

- `📝 scout1 T3` — Agent "scout1", turn 3, logging active
- `📝 scout1 T3 ⚠️2` — 2 commit errors occurred
- `🔇 shadow-git: disabled` — Killswitch active

## Commit Messages

| Event | Format |
|-------|--------|
| Session start | `[agent:start] initialized` |
| Tool call | `[agent:tool] {tool}: {path or brief}` |
| Turn end | `[agent:turn] turn {N} complete` |
| Agent end | `[agent:end] completed ({N} messages)` |
| Shutdown | `[agent:end] shutdown ({N} commits, {M} errors)` |

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

# Errors (tool errors + commit errors)
jq 'select(.error == true or .event == "commit_error")' agents/scout1/audit.jsonl

# Commit failures specifically
jq 'select(.event == "commit_error")' agents/scout1/audit.jsonl
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

## Failure Handling

The extension is designed to **fail open**:

| Failure | Behavior |
|---------|----------|
| Git commit fails | Error logged to audit.jsonl, agent continues |
| Audit file write fails | Error to stderr, agent continues |
| Patch capture fails | Error logged, agent continues |
| Directory creation fails | Error to stderr, extension continues |

Stats track errors: use `/shadow-git stats` to see `commitErrors` count.

## For AI Agents

See [AGENTS.md](AGENTS.md) for agent-specific instructions.

## License

MIT
