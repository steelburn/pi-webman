import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { PopupSpec } from "./popups.ts";

export type CockpitStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool"
  | "settling"
  | "compacting"
  | "error"
  | "offline";

export interface SessionTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  cost: number;
  messages: number;
  toolCalls: number;
  turns: number;
}

export interface ActivityItem {
  id: string;
  name: string;
  status: "running" | "ok" | "error";
  startedAt: number;
  durationMs: number | null;
  summary: string;
}

export interface CockpitHistoryItem {
  kind: "message" | "compaction" | "branch_summary" | "custom";
  entryId: string;
  timestamp?: string;
  message?: AgentMessage | Record<string, unknown>;
  summary?: string;
  tokensBefore?: number;
  customType?: string;
  content?: unknown;
  display?: boolean;
}

export interface CockpitSnapshot {
  version: string;
  now: number;
  server: {
    url: string;
    host: string;
    port: number;
    startedAt: number;
    clients: number;
    authRequired: boolean;
    uptimeMs: number;
  };
  session: {
    id: string;
    file: string | undefined;
    name: string | undefined;
    cwd: string;
    leafId: string | null;
    dir: string | undefined;
    createdAt: string | undefined;
    parent: string | undefined;
    mode: string;
  };
  status: {
    kind: CockpitStatus;
    detail: string | undefined;
    idle: boolean;
    pending: boolean;
    lastError: string | undefined;
    since: number;
  };
  model: ModelInfo | null;
  models: ModelInfo[];
  thinkingLevel: string;
  thinkingLevels: string[];
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null;
  totals: SessionTotals;
  history: CockpitHistoryItem[];
  historyTruncated: number;
  tools: Array<{
    name: string;
    description: string;
    exposure: string;
    active: boolean;
    source: string | undefined;
  }>;
  commands: CockpitCommand[];
  /** A blocking extension dialog is waiting on the terminal. */
  uiPrompt: { kind: string; title: string | undefined; since: number } | null;
  /** Popups an extension rendered through the webman popup bridge. */
  popups: PopupSpec[];
  activity: ActivityItem[];
  capabilities: {
    newSession: boolean;
    compact: boolean;
    switchModel: boolean;
    switchThinking: boolean;
    toggleTools: boolean;
  };
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: string[];
  cost: Record<string, unknown> | undefined;
  thinkingLevelMap: Record<string, string | null> | undefined;
}

export const ALL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * `web` commands are executed by the cockpit itself, `extension`/`prompt`/
 * `skill` commands are real Pi commands, and `terminal` entries are Pi builtins
 * that only the terminal editor can run — offered for discovery, never sent to
 * the model.
 */
export type CommandOrigin = "web" | "extension" | "prompt" | "skill" | "terminal";

export interface CockpitCommand {
  name: string;
  description: string | undefined;
  source: string;
  origin: CommandOrigin;
  argumentHint?: string;
}

/** Commands the cockpit executes against its own API instead of the model. */
export const WEB_COMMANDS: CockpitCommand[] = [
  { name: "compact", description: "Compact the session context", source: "webman", origin: "web", argumentHint: "[instructions]" },
  { name: "model", description: "Switch model core", source: "webman", origin: "web", argumentHint: "<provider/model>" },
  { name: "thinking", description: "Set the thinking level", source: "webman", origin: "web", argumentHint: "<level>" },
  { name: "name", description: "Rename this session", source: "webman", origin: "web", argumentHint: "<callsign>" },
  { name: "new", description: "Start a new session", source: "webman", origin: "web" },
  { name: "abort", description: "Abort the active run", source: "webman", origin: "web" },
  { name: "theme", description: "Switch cockpit theme", source: "webman", origin: "web", argumentHint: "[light|dark]" },
  { name: "copy", description: "Copy the last assistant response", source: "webman", origin: "web" },
  { name: "status", description: "Show a session status summary", source: "webman", origin: "web" },
  { name: "help", description: "Open the command uplink", source: "webman", origin: "web" },
];

/**
 * Pi builtins from the current release. They are handled by the interactive
 * editor, so a web prompt containing one would otherwise be billed as a model
 * request. Listing them keeps `/` completion honest about what exists.
 */
export const TERMINAL_COMMANDS: CockpitCommand[] = [
  { name: "settings", description: "Open the settings menu", source: "pi", origin: "terminal" },
  { name: "tree", description: "Navigate the session tree", source: "pi", origin: "terminal" },
  { name: "fork", description: "Fork from an earlier user message", source: "pi", origin: "terminal" },
  { name: "clone", description: "Duplicate the session at this position", source: "pi", origin: "terminal" },
  { name: "resume", description: "Resume another saved session", source: "pi", origin: "terminal" },
  { name: "import", description: "Import and resume a JSONL session", source: "pi", origin: "terminal", argumentHint: "<path>" },
  { name: "export", description: "Export the session (HTML or JSONL)", source: "pi", origin: "terminal", argumentHint: "[path]" },
  { name: "share", description: "Share the session and get a link", source: "pi", origin: "terminal" },
  { name: "bug", description: "Prepare a bug report for the Pi developers", source: "pi", origin: "terminal", argumentHint: "[description]" },
  { name: "scoped-models", description: "Choose models for interactive cycling", source: "pi", origin: "terminal" },
  { name: "trust", description: "Save a project trust decision", source: "pi", origin: "terminal" },
  { name: "login", description: "Add provider authentication", source: "pi", origin: "terminal", argumentHint: "<provider>" },
  { name: "logout", description: "Remove provider authentication", source: "pi", origin: "terminal" },
  { name: "changelog", description: "Show changelog entries", source: "pi", origin: "terminal" },
  { name: "hotkeys", description: "Show active keyboard shortcuts", source: "pi", origin: "terminal" },
  { name: "reload", description: "Reload extensions, skills and context", source: "pi", origin: "terminal" },
  { name: "quit", description: "Quit Pi", source: "pi", origin: "terminal" },
];

const MAX_HISTORY_ITEMS = 2_500;

export function modelInfo(model: unknown): ModelInfo | null {
  if (!model || typeof model !== "object") return null;
  const value = model as Record<string, unknown>;
  if (typeof value.provider !== "string" || typeof value.id !== "string") return null;
  return {
    provider: value.provider,
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    reasoning: value.reasoning === true,
    contextWindow: typeof value.contextWindow === "number" ? value.contextWindow : 0,
    maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : 0,
    input: Array.isArray(value.input) ? value.input.map(String) : [],
    cost: isRecord(value.cost) ? value.cost : undefined,
    thinkingLevelMap: isRecord(value.thinkingLevelMap)
      ? (value.thinkingLevelMap as Record<string, string | null>)
      : undefined,
  };
}

export function supportedThinkingLevels(model: ModelInfo | null): string[] {
  if (!model) return [...ALL_THINKING_LEVELS];
  if (!model.reasoning) return ["off"];
  const map = model.thinkingLevelMap;
  if (!map) return [...ALL_THINKING_LEVELS];
  const supported = ALL_THINKING_LEVELS.filter((level) => map[level] !== null);
  return supported.length > 0 ? supported : ["off"];
}

export interface SnapshotExtras {
  version: string;
  url: string;
  host: string;
  port: number;
  startedAt: number;
  clients: number;
  authRequired: boolean;
  status: CockpitStatus;
  statusDetail?: string;
  lastError?: string;
  statusSince: number;
  activity: ActivityItem[];
  uiPrompt?: { kind: string; title: string | undefined; since: number } | null;
  popups?: PopupSpec[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageUsage(message: AgentMessage): Record<string, unknown> | undefined {
  if (message.role !== "assistant") return undefined;
  return (message as unknown as Record<string, unknown>).usage as Record<string, unknown> | undefined;
}

function sumUsage(totals: SessionTotals, usage: Record<string, unknown> | undefined): void {
  if (!usage) return;
  const input = typeof usage.input === "number" ? usage.input : 0;
  const output = typeof usage.output === "number" ? usage.output : 0;
  const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWrite = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const reasoning = typeof usage.reasoning === "number" ? usage.reasoning : 0;
  const cost = isRecord(usage.cost) && typeof usage.cost.total === "number" ? usage.cost.total : 0;
  totals.input += input;
  totals.output += output;
  totals.cacheRead += cacheRead;
  totals.cacheWrite += cacheWrite;
  totals.reasoning += reasoning;
  totals.cost += cost;
}

function countToolCalls(message: AgentMessage): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  let count = 0;
  for (const block of message.content as unknown as Array<Record<string, unknown>>) {
    if (block && block.type === "toolCall") count += 1;
  }
  return count;
}

/**
 * One command list for `/` completion: cockpit-native first, then the live Pi
 * commands, then builtins that need the terminal (shown, never executed here).
 */
export function mergeCommands(live: CockpitCommand[]): CockpitCommand[] {
  const seen = new Set<string>();
  const merged: CockpitCommand[] = [];
  const push = (command: CockpitCommand) => {
    if (!command.name || seen.has(command.name)) return;
    seen.add(command.name);
    merged.push(command);
  };
  WEB_COMMANDS.forEach(push);
  // Webman's own plumbing owns /web, /webman and /web-session; offering them
  // in the browser would let a click stop the server or replace the session
  // behind the cockpit's back.
  const plumbing = new Set(["web", "webman", "web-session"]);
  for (const command of live) {
    if (plumbing.has(command.name)) continue;
    push(command);
  }
  TERMINAL_COMMANDS.forEach(push);
  return merged;
}

export function buildSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  extras: SnapshotExtras,
): CockpitSnapshot {
  const sessionManager = ctx.sessionManager;
  const branch = sessionManager.getBranch();
  const header = sessionManager.getHeader();

  const totals: SessionTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    messages: 0,
    toolCalls: 0,
    turns: 0,
  };

  for (const entry of branch) {
    if (entry.type === "message") {
      if (entry.message.role === "system") continue;
      totals.messages += 1;
      sumUsage(totals, messageUsage(entry.message));
      totals.toolCalls += countToolCalls(entry.message);
    } else if (entry.type === "usage") {
      sumUsage(totals, entry.usage as unknown as Record<string, unknown>);
    } else if (entry.type === "compaction") {
      if (entry.usage) sumUsage(totals, entry.usage as unknown as Record<string, unknown>);
    }
  }
  totals.turns = branch.filter((entry) => entry.type === "message" && entry.message.role === "assistant").length;

  const history: CockpitHistoryItem[] = [];
  for (const entry of branch) {
    if (entry.type === "message") {
      // System prompt/tool declarations are replayed on every change and would
      // flood the transcript with huge, non-conversational payloads.
      if (entry.message.role === "system") continue;
      history.push({
        kind: "message",
        entryId: entry.id,
        timestamp: entry.timestamp,
        message: entry.message,
      });
    } else if (entry.type === "compaction") {
      history.push({
        kind: "compaction",
        entryId: entry.id,
        timestamp: entry.timestamp,
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
      });
    } else if (entry.type === "branch_summary") {
      history.push({
        kind: "branch_summary",
        entryId: entry.id,
        timestamp: entry.timestamp,
        summary: entry.summary,
      });
    } else if (entry.type === "custom_message" && entry.display) {
      history.push({
        kind: "custom",
        entryId: entry.id,
        timestamp: entry.timestamp,
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
      });
    }
  }

  const historyTruncated = Math.max(0, history.length - MAX_HISTORY_ITEMS);
  const trimmedHistory = historyTruncated > 0 ? history.slice(-MAX_HISTORY_ITEMS) : history;

  let models: ModelInfo[] = [];
  try {
    models = ctx.modelRegistry
      .getAvailable()
      .map((model) => modelInfo(model))
      .filter((model): model is ModelInfo => model !== null);
  } catch {
    models = [];
  }
  models.sort((a, b) =>
    a.provider === b.provider ? a.name.localeCompare(b.name) : a.provider.localeCompare(b.provider),
  );

  const currentModel = modelInfo(ctx.model);
  if (currentModel && !models.some((model) => model.provider === currentModel.provider && model.id === currentModel.id)) {
    models.unshift(currentModel);
  }

  let tools: CockpitSnapshot["tools"] = [];
  try {
    const active = new Set(pi.getActiveTools());
    tools = pi
      .getAllTools()
      .filter((tool) => tool.exposure !== "hidden")
      .map((tool) => ({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        exposure: tool.exposure,
        active: active.has(tool.name),
        source: tool.sourceInfo?.source,
      }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  } catch {
    tools = [];
  }

  let commands: CockpitSnapshot["commands"] = [];
  try {
    commands = pi.getCommands().map((command) => ({
      name: command.name,
      description: command.description,
      source: command.source,
      origin: command.source,
    }));
  } catch {
    commands = [];
  }

  const usage = ctx.getContextUsage();
  const thinkingLevel = ctx.thinkingLevel ?? pi.getThinkingLevel();

  return {
    version: extras.version,
    now: Date.now(),
    server: {
      url: extras.url,
      host: extras.host,
      port: extras.port,
      startedAt: extras.startedAt,
      clients: extras.clients,
      authRequired: extras.authRequired,
      uptimeMs: Math.max(0, Date.now() - extras.startedAt),
    },
    session: {
      id: sessionManager.getSessionId(),
      file: sessionManager.getSessionFile(),
      name: sessionManager.getSessionName(),
      cwd: sessionManager.getCwd(),
      leafId: sessionManager.getLeafId(),
      dir: sessionManager.getSessionDir(),
      createdAt: header?.timestamp,
      parent: header?.parentSession,
      mode: ctx.mode,
    },
    status: {
      kind: ctx.isIdle() && extras.status !== "compacting" ? (extras.status === "error" ? "error" : "idle") : extras.status,
      detail: extras.statusDetail,
      idle: ctx.isIdle(),
      pending: ctx.hasPendingMessages(),
      lastError: extras.lastError,
      since: extras.statusSince,
    },
    model: currentModel,
    models,
    thinkingLevel,
    thinkingLevels: supportedThinkingLevels(currentModel),
    contextUsage: usage ?? null,
    totals,
    history: trimmedHistory,
    historyTruncated,
    tools,
    commands: mergeCommands(commands),
    uiPrompt: extras.uiPrompt ?? null,
    popups: extras.popups ?? [],
    activity: extras.activity,
    capabilities: {
      // Session replacement through a command context is only reliable in
      // interactive mode; RPC/JSON/print hosts own their session lifecycle.
      newSession: ctx.mode === "tui" && ctx.isIdle() && !ctx.hasPendingMessages(),
      compact: ctx.isIdle(),
      switchModel: true,
      switchThinking: true,
      toggleTools: true,
    },
  };
}

export function snapshotLite(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  extras: Omit<SnapshotExtras, "version" | "url" | "host" | "port" | "startedAt" | "clients" | "authRequired"> & {
    clients: number;
  },
): Record<string, unknown> {
  const branch = ctx.sessionManager.getBranch();
  const totals: SessionTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    cost: 0,
    messages: 0,
    toolCalls: 0,
    turns: 0,
  };
  for (const entry of branch) {
    if (entry.type === "message") {
      if (entry.message.role === "system") continue;
      totals.messages += 1;
      sumUsage(totals, messageUsage(entry.message));
      totals.toolCalls += countToolCalls(entry.message);
    } else if (entry.type === "usage") {
      sumUsage(totals, entry.usage as unknown as Record<string, unknown>);
    }
  }
  totals.turns = branch.filter((entry) => entry.type === "message" && entry.message.role === "assistant").length;

  const model = modelInfo(ctx.model);
  return {
    kind: ctx.isIdle() && extras.status !== "compacting" ? (extras.status === "error" ? "error" : "idle") : extras.status,
    detail: extras.statusDetail,
    idle: ctx.isIdle(),
    pending: ctx.hasPendingMessages(),
    lastError: extras.lastError,
    since: extras.statusSince,
    usage: ctx.getContextUsage() ?? null,
    model,
    thinkingLevel: ctx.thinkingLevel ?? pi.getThinkingLevel(),
    thinkingLevels: supportedThinkingLevels(model),
    totals,
    clients: extras.clients,
    activity: extras.activity,
    sessionName: ctx.sessionManager.getSessionName(),
    leafId: ctx.sessionManager.getLeafId(),
  };
}
