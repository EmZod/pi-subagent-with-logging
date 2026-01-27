/**
 * Shadow Git Extension
 *
 * Enables git-based orchestration control over subagents:
 * - Commits agent state after each tool call, turn, and agent end
 * - Captures patches when agents modify target repos
 * - Enables branching, rewinding, and forking agent execution paths
 * - Mission Control dashboard for monitoring multiple agents
 *
 * Environment Variables:
 *   PI_WORKSPACE_ROOT      - Root of the shadow git workspace (required)
 *   PI_AGENT_NAME          - Name of this agent (required for logging, optional for dashboard)
 *   PI_TARGET_REPOS        - Comma-separated target repo paths (optional)
 *   PI_TARGET_BRANCH       - Branch/worktree name agent is using in target (optional)
 *   PI_SHADOW_GIT_DISABLED - Set to "1" or "true" to disable (killswitch)
 *
 * Commands:
 *   /shadow-git           - Show status
 *   /shadow-git enable    - Enable logging
 *   /shadow-git disable   - Disable logging (killswitch)
 *   /shadow-git history   - Show recent commits
 *   /mission-control      - Open Mission Control dashboard
 *   /mc                   - Alias for mission-control
 *
 * Failure Mode: FAIL-OPEN
 *   Git commit failures are logged but do NOT block the agent.
 *   This ensures agent execution continues even if git operations fail.
 *
 * Commit Message Format:
 *   [agent:start] initialized              - When agent starts
 *   [agent:tool]  {toolName}: {brief}      - After each tool call
 *   [agent:turn]  turn {N} complete        - After each turn
 *   [agent:end]   {status}                 - When agent completes
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { registerMissionControl } from "./mission-control.js";

// =============================================================================
// Types
// =============================================================================

interface Config {
	workspaceRoot: string;
	agentName: string;
	targetRepos: string[];
	targetBranch?: string;
	agentDir: string;
	auditFile: string;
	patchDir: string;
}

interface AuditEntry {
	ts: number;
	event: string;
	agent: string;
	turn: number;
	[key: string]: unknown;
}

interface Stats {
	commits: number;
	commitErrors: number;
	toolCalls: number;
	turns: number;
	patchesCaptured: number;
}

// =============================================================================
// Extension
// =============================================================================

export default function (pi: ExtensionAPI) {
	// -------------------------------------------------------------------------
	// Configuration
	// -------------------------------------------------------------------------

	const workspaceRoot = process.env.PI_WORKSPACE_ROOT;
	const agentName = process.env.PI_AGENT_NAME;

	// Always register Mission Control (only needs PI_WORKSPACE_ROOT)
	registerMissionControl(pi);

	// Shadow-git logging needs both PI_WORKSPACE_ROOT and PI_AGENT_NAME
	if (!workspaceRoot || !agentName) {
		registerCommands(pi, null, null, { enabled: false, reason: "Not configured (missing PI_WORKSPACE_ROOT or PI_AGENT_NAME)" });
		return;
	}

	// Check initial killswitch state
	let enabled = !isKillswitchActive();

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

	// Ensure directories exist (fail-open: log error but continue)
	try {
		mkdirSync(dirname(config.auditFile), { recursive: true });
		mkdirSync(config.patchDir, { recursive: true });
	} catch (err) {
		console.error(`[shadow-git] Failed to create directories: ${err}`);
	}

	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------

	let currentTurn = 0;
	let toolCallCount = 0;
	const stats: Stats = {
		commits: 0,
		commitErrors: 0,
		toolCalls: 0,
		turns: 0,
		patchesCaptured: 0,
	};

	// Track if agent repo is initialized
	let agentRepoInitialized = false;

	// -------------------------------------------------------------------------
	// Utility Functions
	// -------------------------------------------------------------------------

	/**
	 * Initialize a git repository in the agent's directory.
	 * This gives each agent its own .git, eliminating lock conflicts.
	 * 
	 * Goedecke: "One owner, one writer" - each agent owns its own repo.
	 */
	async function initAgentRepo(): Promise<boolean> {
		const gitDir = join(config.agentDir, ".git");
		
		// Already initialized
		if (existsSync(gitDir)) {
			agentRepoInitialized = true;
			return true;
		}

		try {
			// Initialize git repo in agent directory
			const init = await pi.exec("git", ["init"], { cwd: config.agentDir });
			if (init.code !== 0) {
				throw new Error(`git init failed: ${init.stderr}`);
			}

			// Create .gitignore to exclude audit.jsonl (it's for real-time, not git)
			const gitignorePath = join(config.agentDir, ".gitignore");
			writeFileSync(gitignorePath, "audit.jsonl\n");

			// Initial commit
			await pi.exec("git", ["add", ".gitignore"], { cwd: config.agentDir });
			await pi.exec("git", ["commit", "-m", "agent initialized", "--allow-empty"], { cwd: config.agentDir });

			agentRepoInitialized = true;
			emit("git_init", { agentDir: config.agentDir });
			return true;
		} catch (err) {
			// FAIL-OPEN: Log error but don't block agent
			emit("git_init_error", { error: String(err) });
			console.error(`[shadow-git] Failed to init agent repo (continuing): ${err}`);
			return false;
		}
	}

	function isKillswitchActive(): boolean {
		const val = process.env.PI_SHADOW_GIT_DISABLED;
		return val === "1" || val === "true";
	}

	function emit(event: string, data: Record<string, unknown>): void {
		if (!enabled) return;

		const entry: AuditEntry = {
			ts: Date.now(),
			event,
			agent: config.agentName,
			turn: currentTurn,
			...data,
		};

		try {
			appendFileSync(config.auditFile, JSON.stringify(entry) + "\n");
		} catch (err) {
			console.error(`[shadow-git] Failed to write audit log: ${err}`);
		}
	}

	async function gitCommitInternal(message: string): Promise<boolean> {
		// Skip if agent repo not initialized (fail-open)
		if (!agentRepoInitialized) {
			return true;
		}

		try {
			// Stage all changes in agent directory (now uses agentDir, not workspaceRoot)
			const addAgent = await pi.exec("git", ["add", "-A"], { cwd: config.agentDir });
			if (addAgent.code !== 0) {
				throw new Error(`git add failed: ${addAgent.stderr}`);
			}

			// Commit (allow empty for timeline continuity)
			const fullMessage = config.targetBranch
				? `${message} [target: ${config.targetBranch}]`
				: message;

			const commit = await pi.exec("git", [
				"commit",
				"-m",
				fullMessage,
				"--allow-empty",
			], { cwd: config.agentDir });

			if (commit.code !== 0) {
				throw new Error(`git commit failed: ${commit.stderr}`);
			}

			stats.commits++;
			return true;
		} catch (err) {
			// FAIL-OPEN: Log error but don't block agent
			stats.commitErrors++;
			emit("commit_error", { message, error: String(err) });
			console.error(`[shadow-git] Commit failed (continuing): ${err}`);
			return false;
		}
	}

	// Commit to agent's git repo (no queue needed - per-agent repos eliminate lock conflicts)
	function gitCommit(message: string): Promise<boolean> {
		if (!enabled) return Promise.resolve(true);
		return gitCommitInternal(message);
	}

	function isTargetRepoPath(filePath: string): string | null {
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
	}

	async function capturePatch(
		targetRepo: string,
		filePath: string,
		toolName: string
	): Promise<void> {
		if (!enabled) return;

		try {
			const repoName = targetRepo === "unknown"
				? "target"
				: dirname(targetRepo).split("/").pop() || "repo";
			const patchSubdir = join(config.patchDir, repoName);
			mkdirSync(patchSubdir, { recursive: true });

			const patchFile = join(
				patchSubdir,
				`turn-${String(currentTurn).padStart(3, "0")}-${toolName}-${toolCallCount}.patch`
			);

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
				stats.patchesCaptured++;
				emit("patch_captured", { file: filePath, patch: patchFile });
			}
		} catch (err) {
			emit("patch_error", { file: filePath, error: String(err) });
			console.error(`[shadow-git] Patch capture failed: ${err}`);
		}
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (!enabled) {
			ctx.ui.setStatus("shadow-git", "🔇 shadow-git: disabled");
		} else {
			const errorSuffix = stats.commitErrors > 0 ? ` ⚠️${stats.commitErrors}` : "";
			ctx.ui.setStatus("shadow-git", `📝 ${config.agentName} T${currentTurn}${errorSuffix}`);
		}
	}

	// -------------------------------------------------------------------------
	// Register Commands
	// -------------------------------------------------------------------------

	registerCommands(pi, config, stats, {
		enabled: true,
		getEnabled: () => enabled,
		setEnabled: (val: boolean, ctx: ExtensionContext) => {
			enabled = val;
			updateStatus(ctx);
			emit(val ? "enabled" : "disabled", {});
		},
	});

	// -------------------------------------------------------------------------
	// Session Lifecycle Events
	// -------------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		// Re-check killswitch on session start (env may have changed)
		if (isKillswitchActive()) {
			enabled = false;
		}

		updateStatus(ctx);

		if (!enabled) return;

		// Initialize per-agent git repo (Goedecke: "one owner, one writer")
		await initAgentRepo();

		emit("session_start", {});
		await gitCommit(`[${config.agentName}:start] session began`);
	});

	pi.on("session_shutdown", async () => {
		if (!enabled) return;

		emit("session_shutdown", { stats });
		// NOTE: No commit here - turn_end commits capture state
		// Stats are preserved in audit.jsonl
	});

	// -------------------------------------------------------------------------
	// Agent Events
	// -------------------------------------------------------------------------

	pi.on("agent_end", async (event) => {
		if (!enabled) return;

		emit("agent_end", { messageCount: event.messages.length, stats });
		// NOTE: No commit here - agent_end fires BEFORE final turn_end
		// which causes confusing commit order. Turn commits are sufficient.
	});

	// -------------------------------------------------------------------------
	// Turn Events
	// -------------------------------------------------------------------------

	pi.on("turn_start", async (event, ctx) => {
		currentTurn = event.turnIndex;
		stats.turns++;
		updateStatus(ctx);

		if (!enabled) return;

		emit("turn_start", { turn: event.turnIndex });
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!enabled) return;

		const toolCount = event.toolResults.length;

		emit("turn_end", {
			turn: event.turnIndex,
			toolResultCount: toolCount,
		});

		// Turn-level commits (Goedecke: "Complexity is debt" - 10x fewer commits)
		// Summary includes tool count for meaningful checkpoints
		const summary = toolCount > 0 ? `${toolCount} tools` : "no tools";
		await gitCommit(`[${config.agentName}:turn-${event.turnIndex}] ${summary}`);
		updateStatus(ctx);
	});

	// -------------------------------------------------------------------------
	// Tool Events
	// -------------------------------------------------------------------------

	pi.on("tool_call", async (event) => {
		toolCallCount++;
		stats.toolCalls++;

		if (!enabled) return;

		emit("tool_call", {
			tool: event.toolName,
			toolCallId: event.toolCallId,
			input: event.input,
		});
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!enabled) return;

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

		// NOTE: Per-tool commits REMOVED (Goedecke: "Complexity is debt")
		// Commits now happen at turn_end only - see turn_end handler
		// Tool-level granularity is preserved in audit.jsonl
		updateStatus(ctx);
	});
}

// =============================================================================
// Command Registration (separated for reuse in unconfigured mode)
// =============================================================================

interface CommandState {
	enabled: boolean;
	reason?: string;
	getEnabled?: () => boolean;
	setEnabled?: (val: boolean, ctx: ExtensionContext) => void;
}

function registerCommands(
	pi: ExtensionAPI,
	config: Config | null,
	stats: Stats | null,
	state: CommandState
): void {
	pi.registerCommand("shadow-git", {
		description: "Shadow-git status and control (enable|disable|history|stats)",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0] || "status";

			// Handle unconfigured state
			if (!config || !stats) {
				if (ctx.hasUI) {
					ctx.ui.notify(`shadow-git: ${state.reason || "not configured"}`, "warning");
				}
				return;
			}

			switch (subcommand) {
				case "status": {
					const enabled = state.getEnabled?.() ?? state.enabled;
					const lines = [
						`Shadow-Git Status`,
						`─────────────────`,
						`Enabled:    ${enabled ? "✅ yes" : "❌ no (killswitch)"}`,
						`Agent:      ${config.agentName}`,
						`Workspace:  ${config.workspaceRoot}`,
						`Turn:       ${stats.turns}`,
						`Commits:    ${stats.commits}`,
						`Errors:     ${stats.commitErrors}`,
						`Patches:    ${stats.patchesCaptured}`,
						`Audit:      ${config.auditFile}`,
					];
					if (ctx.hasUI) {
						await ctx.ui.select("Shadow-Git Status", lines);
					}
					break;
				}

				case "enable": {
					state.setEnabled?.(true, ctx);
					if (ctx.hasUI) {
						ctx.ui.notify("shadow-git enabled", "success");
					}
					break;
				}

				case "disable": {
					state.setEnabled?.(false, ctx);
					if (ctx.hasUI) {
						ctx.ui.notify("shadow-git disabled (killswitch active)", "warning");
					}
					break;
				}

				case "history": {
					const { stdout, code } = await pi.exec("git", [
						"log",
						"--oneline",
						"-20",
					], { cwd: config.agentDir });

					if (code === 0 && stdout.trim()) {
						const lines = stdout.trim().split("\n");
						if (ctx.hasUI) {
							await ctx.ui.select("Recent Commits (last 20)", lines);
						}
					} else if (ctx.hasUI) {
						ctx.ui.notify("No commits found or git error", "warning");
					}
					break;
				}

				case "stats": {
					const lines = [
						`Commits:         ${stats.commits}`,
						`Commit errors:   ${stats.commitErrors}`,
						`Tool calls:      ${stats.toolCalls}`,
						`Turns:           ${stats.turns}`,
						`Patches:         ${stats.patchesCaptured}`,
					];
					if (ctx.hasUI) {
						await ctx.ui.select("Shadow-Git Stats", lines);
					}
					break;
				}

				default: {
					if (ctx.hasUI) {
						ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use: status|enable|disable|history|stats`, "warning");
					}
				}
			}
		},
	});
}
