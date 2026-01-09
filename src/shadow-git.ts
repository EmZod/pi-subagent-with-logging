/**
 * Shadow Git Extension
 *
 * Enables git-based orchestration control over subagents:
 * - Commits agent state after each tool call, turn, and agent end
 * - Captures patches when agents modify target repos
 * - Enables branching, rewinding, and forking agent execution paths
 *
 * Environment Variables:
 *   PI_WORKSPACE_ROOT - Root of the shadow git workspace (required)
 *   PI_AGENT_NAME     - Name of this agent (required)
 *   PI_TARGET_REPOS   - Comma-separated target repo paths (optional)
 *   PI_TARGET_BRANCH  - Branch/worktree name agent is using in target (optional, for linkage)
 *
 * Commit Message Format:
 *   [agent:tool]  {toolName}: {brief}     - After each tool call
 *   [agent:turn]  turn {N} complete       - After each turn
 *   [agent:end]   {status}                - When agent completes
 *   [agent:start] initialized             - When agent starts
 *
 * MIGRATION (v0.35):
 *   - HookAPI → ExtensionAPI
 *   - --hook → --extension / -e
 *   - hooks/ → extensions/
 *   - {"hooks": [...]} → {"extensions": [...]}
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";

interface Config {
	workspaceRoot: string;
	agentName: string;
	targetRepos: string[];
	targetBranch?: string;
	agentDir: string;
	auditFile: string;
	patchDir: string;
}

export default function (pi: ExtensionAPI) {
	// Parse environment
	const workspaceRoot = process.env.PI_WORKSPACE_ROOT;
	const agentName = process.env.PI_AGENT_NAME;

	if (!workspaceRoot || !agentName) {
		// Not configured — silent no-op
		return;
	}

	const targetRepos = process.env.PI_TARGET_REPOS
		? process.env.PI_TARGET_REPOS.split(",").map((p) => p.trim())
		: [];

	const config: Config = {
		workspaceRoot,
		agentName,
		targetRepos,
		targetBranch: process.env.PI_TARGET_BRANCH,
		agentDir: join(workspaceRoot, "agents", agentName),
		auditFile: join(workspaceRoot, "agents", agentName, "audit.jsonl"),
		patchDir: join(workspaceRoot, "target-patches"),
	};

	// Ensure directories exist
	mkdirSync(dirname(config.auditFile), { recursive: true });
	mkdirSync(config.patchDir, { recursive: true });

	// Track turn number
	let currentTurn = 0;
	let toolCallCount = 0;

	// ==========================================================================
	// Utility Functions
	// ==========================================================================

	const emit = (event: string, data: Record<string, unknown>) => {
		const entry = {
			ts: Date.now(),
			event,
			agent: config.agentName,
			turn: currentTurn,
			...data,
		};
		appendFileSync(config.auditFile, JSON.stringify(entry) + "\n");
	};

	const gitCommit = async (message: string) => {
		// Stage all changes in agent directory
		await pi.exec("git", ["-C", config.workspaceRoot, "add", config.agentDir]);

		// Also stage patches if any
		if (existsSync(config.patchDir)) {
			await pi.exec("git", ["-C", config.workspaceRoot, "add", config.patchDir]);
		}

		// Commit (allow empty for timeline continuity)
		const fullMessage = config.targetBranch
			? `${message} [target: ${config.targetBranch}]`
			: message;

		await pi.exec("git", [
			"-C",
			config.workspaceRoot,
			"commit",
			"-m",
			fullMessage,
			"--allow-empty",
		]);
	};

	const isTargetRepoPath = (filePath: string): string | null => {
		// Check if path is in a target repo (not in workspace)
		const absPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);

		// If it's inside workspace, it's not a target repo path
		if (absPath.startsWith(config.workspaceRoot)) {
			return null;
		}

		// Check if it's in any configured target repo
		for (const repo of config.targetRepos) {
			const absRepo = isAbsolute(repo) ? repo : join(process.cwd(), repo);
			if (absPath.startsWith(absRepo)) {
				return repo;
			}
		}

		// If no target repos configured, any path outside workspace is a target
		if (config.targetRepos.length === 0 && !absPath.startsWith(config.workspaceRoot)) {
			return "unknown";
		}

		return null;
	};

	const capturePatch = async (
		targetRepo: string,
		filePath: string,
		toolName: string
	) => {
		const repoName = targetRepo === "unknown" ? "target" : dirname(targetRepo).split("/").pop() || "repo";
		const patchSubdir = join(config.patchDir, repoName);
		mkdirSync(patchSubdir, { recursive: true });

		const patchFile = join(
			patchSubdir,
			`turn-${String(currentTurn).padStart(3, "0")}-${toolName}-${toolCallCount}.patch`
		);

		// Try to get git diff for this file
		const { stdout, code } = await pi.exec("git", [
			"-C",
			dirname(filePath),
			"diff",
			"HEAD",
			"--",
			filePath,
		]);

		if (code === 0 && stdout.trim()) {
			writeFileSync(patchFile, stdout);
			emit("patch_captured", { file: filePath, patch: patchFile });
		}
	};

	// ==========================================================================
	// Session Lifecycle Events
	// ==========================================================================

	pi.on("session_start", async () => {
		emit("session_start", {});
		await gitCommit(`[${config.agentName}:start] initialized`);
	});

	pi.on("session_shutdown", async () => {
		emit("session_shutdown", {});
		await gitCommit(`[${config.agentName}:end] shutdown`);
	});

	// ==========================================================================
	// Agent Events
	// ==========================================================================

	pi.on("agent_end", async (event) => {
		emit("agent_end", { messageCount: event.messages.length });
		await gitCommit(`[${config.agentName}:end] completed (${event.messages.length} messages)`);
	});

	// ==========================================================================
	// Turn Events
	// ==========================================================================

	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
		emit("turn_start", { turn: event.turnIndex });
	});

	pi.on("turn_end", async (event) => {
		emit("turn_end", {
			turn: event.turnIndex,
			toolResultCount: event.toolResults.length,
		});
		await gitCommit(`[${config.agentName}:turn] turn ${event.turnIndex} complete`);
	});

	// ==========================================================================
	// Tool Events
	// ==========================================================================

	pi.on("tool_call", async (event) => {
		toolCallCount++;
		emit("tool_call", {
			tool: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
		});
	});

	pi.on("tool_result", async (event) => {
		emit("tool_result", {
			tool: event.toolName,
			toolCallId: event.toolCallId,
			error: event.isError,
		});

		// Capture patches for write/edit operations on target repos
		if (event.toolName === "write" || event.toolName === "edit") {
			const filePath = event.input.path as string;
			const targetRepo = isTargetRepoPath(filePath);

			if (targetRepo) {
				await capturePatch(targetRepo, filePath, event.toolName);
			}
		}

		// Commit after each tool call
		let brief = "";
		if (event.toolName === "write" || event.toolName === "edit" || event.toolName === "read") {
			brief = event.input.path as string;
		} else if (event.toolName === "bash") {
			const cmd = event.input.command as string;
			brief = cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
		} else {
			brief = event.toolCallId;
		}

		const status = event.isError ? " (error)" : "";
		await gitCommit(`[${config.agentName}:tool] ${event.toolName}: ${brief}${status}`);
	});
}
