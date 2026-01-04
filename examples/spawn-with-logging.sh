#!/bin/bash
#
# Example: Spawn a pi agent with shadow-git logging
#
# Usage:
#   ./spawn-with-logging.sh <workspace-dir> <agent-name> "<prompt>"
#
# Example:
#   ./spawn-with-logging.sh ~/workspaces/task-001 scout1 "Research X and write findings"

set -e

WORKSPACE_DIR="${1:?Usage: $0 <workspace-dir> <agent-name> \"<prompt>\"}"
AGENT_NAME="${2:?Usage: $0 <workspace-dir> <agent-name> \"<prompt>\"}"
PROMPT="${3:?Usage: $0 <workspace-dir> <agent-name> \"<prompt>\"}"

# Resolve paths
WORKSPACE_DIR="$(cd "$WORKSPACE_DIR" 2>/dev/null && pwd || mkdir -p "$WORKSPACE_DIR" && cd "$WORKSPACE_DIR" && pwd)"
HOOK_PATH="$(dirname "$0")/../src/shadow-git.ts"
HOOK_PATH="$(cd "$(dirname "$HOOK_PATH")" && pwd)/$(basename "$HOOK_PATH")"

# Initialize workspace if needed
if [ ! -d "$WORKSPACE_DIR/.git" ]; then
    echo "Initializing git in $WORKSPACE_DIR"
    git -C "$WORKSPACE_DIR" init
    git -C "$WORKSPACE_DIR" commit --allow-empty -m "Initial workspace"
fi

# Create agent directory
AGENT_DIR="$WORKSPACE_DIR/agents/$AGENT_NAME"
mkdir -p "$AGENT_DIR"/{workspace,output}

echo "Workspace: $WORKSPACE_DIR"
echo "Agent: $AGENT_NAME"
echo "Hook: $HOOK_PATH"
echo ""

# Spawn in tmux
tmux new-session -d -s "$AGENT_NAME" \
    "cd '$AGENT_DIR' && \
     PI_WORKSPACE_ROOT='$WORKSPACE_DIR' \
     PI_AGENT_NAME='$AGENT_NAME' \
     pi \
       --model claude-haiku-4-5 \
       --tools read,write,bash \
       --max-turns 30 \
       --no-input \
       --hook '$HOOK_PATH' \
       '$PROMPT' \
       2>&1 | tee output/run.log; \
     echo 'Agent completed. Press enter to close.'; read"

echo "Spawned agent '$AGENT_NAME' in tmux session"
echo ""
echo "Commands:"
echo "  tmux attach -t $AGENT_NAME    # Observe agent"
echo "  git -C $WORKSPACE_DIR log     # View commits"
echo "  cat $AGENT_DIR/audit.jsonl    # View events"
