import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { EventHub } from "./hub.ts";
import {
  createRequestHandler,
  type CockpitBackend,
  type PromptMode,
} from "./server.ts";
import {
  buildSnapshot,
  snapshotLite,
  ALL_THINKING_LEVELS,
  TERMINAL_COMMANDS,
  WEB_COMMANDS,
  type ActivityItem,
  type CockpitSnapshot,
  type CockpitStatus,
} from "./state.ts";
import {
  PopupRegistry,
  POPUP_ANSWER_CHANNEL,
  POPUP_CLOSE_CHANNEL,
  POPUP_OPEN_CHANNEL,
  POPUP_PING_CHANNEL,
  POPUP_PONG_CHANNEL,
  POPUP_READY_CHANNEL,
} from "./popups.ts";

const DEFAULT_PORT = 4747;
const DEFAULT_HOST = "127.0.0.1";
const SESSION_STATE_ENTRY = "pi-webman";
const HANDOFF_TTL_MS = 60_000;

/**
 * Session replacement tears down this extension instance and loads a fresh one,
 * so the running server cannot be inherited. Hand its coordinates over through
 * module scope: the module itself stays loaded, only the factory runs again.
 */
interface ServerHandoff {
  host: string;
  port: number;
  token?: string;
  at: number;
}

let handoff: ServerHandoff | undefined;

function readVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const VERSION = readVersion();

interface PersistedState {
  enabled: boolean;
  port?: number;
  host?: string;
  updatedAt: number;
}

interface StartOptions {
  port?: number | string;
  host?: string;
  token?: string;
  open?: boolean;
  quiet?: boolean;
}

class CockpitRuntime {
  private readonly pi: ExtensionAPI;
  private ctx: ExtensionContext | undefined;
  private server: Server | undefined;
  private hub: EventHub | undefined;
  private url = "";
  private host = DEFAULT_HOST;
  private port = DEFAULT_PORT;
  private startedAt = 0;
  private token: string | undefined;
  private status: CockpitStatus = "idle";
  private statusDetail: string | undefined;
  private statusSince = Date.now();
  private lastError: string | undefined;
  private readonly activeTools = new Map<string, ActivityItem>();
  private activity: ActivityItem[] = [];
  private stateTimer: NodeJS.Timeout | undefined;
  /** Set while a Pi extension dialog is blocking the terminal. */
  private uiPrompt: { kind: string; title: string | undefined; since: number } | null = null;
  /** Popups published by extensions through the webman popup bridge. */
  private readonly popups = new PopupRegistry();
  private popupUnsubscribers: Array<() => void> = [];

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  register(): void {
    this.pi.registerFlag("web", {
      type: "boolean",
      default: false,
      description: "Start the Pi Cockpit web UI when a session starts",
    });
    this.pi.registerFlag("web-port", {
      type: "string",
      default: String(DEFAULT_PORT),
      description: "Port for the Pi Cockpit web UI",
    });
    this.pi.registerFlag("web-host", {
      type: "string",
      default: DEFAULT_HOST,
      description: "Host interface for the Pi Cockpit web UI",
    });
    this.pi.registerFlag("web-token", {
      type: "string",
      default: "",
      description: "Require this token for Pi Cockpit web access",
    });
    this.pi.registerFlag("web-open", {
      type: "boolean",
      default: false,
      description: "Open the browser when the Pi Cockpit starts",
    });

    const cockpitCommand = async (args: string, ctx: ExtensionCommandContext) => {
      this.ctx = ctx;
      try {
        await this.handleCockpitCommand(args, ctx);
      } catch (error) {
        this.notify(ctx, `Web Cockpit: ${errorMessage(error)}`, "error");
      }
    };

    this.pi.registerCommand("web", {
      description: "Start the futuristic Pi web cockpit (start [port] | stop | status | open | restart)",
      handler: cockpitCommand,
    });

    // Familiar alias that does not collide with the sibling pi-cockpit-hud extension.
    this.pi.registerCommand("webman", {
      description: "Alias for /web — open the Pi web cockpit",
      handler: cockpitCommand,
    });

    this.pi.registerCommand("web-session", {
      description: "Pi Web Cockpit bridge: session operations requested by the web UI",
      handler: async (args, ctx) => {
        this.ctx = ctx;
        const action = args.trim().split(/\s+/)[0] ?? "new";
        try {
          if (action === "new") {
            if (ctx.mode !== "tui") {
              this.notify(ctx, "New sessions must be started from the terminal in this mode", "warning");
              return;
            }
            this.publish({ type: "notice", level: "info", message: "Creating a new session…" });
            await ctx.newSession();
          } else if (action === "compact") {
            ctx.compact();
          }
        } catch (error) {
          this.notify(ctx, `Web Cockpit session: ${errorMessage(error)}`, "error");
        }
      },
    });

    this.pi.on("session_start", (event, ctx) => {
      this.ctx = ctx;
      this.status = "idle";
      this.statusDetail = undefined;
      this.statusSince = Date.now();
      this.activeTools.clear();
      this.activity = [];

      if (this.hub) {
        try {
          ctx.ui.setStatus("webman", `◈ WEB :${this.port}`);
        } catch {
          /* status is cosmetic */
        }
        this.publish({ type: "session", snapshot: this.snapshotOrUndefined() });
      }
      this.scheduleState(0);

      const inherited = handoff && Date.now() - handoff.at <= HANDOFF_TTL_MS ? handoff : undefined;
      handoff = undefined;
      const shouldAutoStart = this.pi.getFlag("web") === true;
      const shouldRestore =
        Boolean(inherited) ||
        ((event.reason === "reload" || event.reason === "resume") && this.wasEnabled(ctx));
      if (!this.server && (shouldAutoStart || shouldRestore)) {
        void this.start({
          open: !inherited && this.pi.getFlag("web-open") === true,
          quiet: false,
          host: inherited?.host,
          token: inherited?.token,
          port: inherited ? inherited.port : shouldRestore ? this.persistedPort(ctx) : undefined,
        }).catch((error: unknown) => {
          this.notify(ctx, `Web Cockpit failed to start: ${errorMessage(error)}`, "error");
        });
      }
    });

    this.pi.on("session_shutdown", async (event, ctx) => {
      const replacing =
        event.reason === "new" || event.reason === "resume" || event.reason === "fork";
      if (replacing) {
        // pi rebuilds the extension for the replacement session; release the port
        // and let the next instance adopt it so the browser keeps its URL.
        if (this.server) {
          handoff = { host: this.host, port: this.port, token: this.token, at: Date.now() };
        }
        this.ctx = undefined;
        await this.stop({ persist: false });
      } else if (event.reason === "quit" || event.reason === "reload") {
        await this.stop({ persist: false });
      } else {
        this.ctx = undefined;
      }
      try {
        ctx.ui.setStatus("webman", undefined);
      } catch {
        /* cosmetic */
      }
    });

    this.pi.on("session_info_changed", (event) => {
      this.publish({ type: "session_info", name: event.name });
      this.scheduleState(50);
    });

    this.pi.on("agent_start", () => {
      this.setStatus("thinking", "Agent run started");
      this.publish({ type: "agent_start" });
    });

    this.pi.on("agent_end", () => {
      this.setStatus("settling", "Waiting for Pi to settle");
      this.publish({ type: "agent_end" });
    });

    this.pi.on("agent_settled", (event) => {
      for (const tool of this.activeTools.values()) {
        this.updateActivity(tool.id, {
          status: "error",
          durationMs: Date.now() - tool.startedAt,
        });
      }
      this.activeTools.clear();
      this.setStatus(
        "idle",
        event.aborted ? "Aborted" : this.lastError ? "Last run failed" : undefined,
      );
      this.publish({ type: "agent_settled", aborted: event.aborted });
      this.scheduleState(0);
    });

    this.pi.on("turn_start", (event) => {
      this.publish({ type: "turn_start", turnIndex: event.turnIndex });
    });

    this.pi.on("turn_end", (event) => {
      this.publish({ type: "turn_end", turnIndex: event.turnIndex });
      this.scheduleState(120);
    });

    this.pi.on("message_start", (event) => {
      if (event.message.role === "assistant") {
        this.setStatus("streaming", "Model response streaming");
      } else if (event.message.role === "user") {
        this.setStatus("thinking", "Directive received");
      }
      this.publish({ type: "message_start", message: event.message });
      this.scheduleState(150);
    });

    this.pi.on("message_update", (event) => {
      const assistantEvent = event.assistantMessageEvent as unknown as Record<string, unknown>;
      const partial = assistantEvent.partial;
      const payload: Record<string, unknown> = { type: "message_update" };
      for (const [key, value] of Object.entries(assistantEvent)) {
        if (key === "partial" || key === "type") continue;
        payload[key] = value;
      }
      payload.eventType = assistantEvent.type;
      // `done` and `error` carry an authoritative message. Send it so the UI can
      // finalize without waiting for message_end.
      if (assistantEvent.type === "done" && assistantEvent.message) {
        payload.finalMessage = assistantEvent.message;
      }
      if (assistantEvent.type === "error" && assistantEvent.error) {
        payload.finalMessage = assistantEvent.error;
      }
      void partial;
      this.publish(payload);
      this.scheduleState(350);
    });

    this.pi.on("message_end", (event) => {
      const message = event.message;
      if (message.role === "assistant") {
        const stopReason = (message as unknown as Record<string, unknown>).stopReason;
        if (stopReason === "error" || stopReason === "aborted") {
          const errorMessageText = (message as unknown as Record<string, unknown>).errorMessage;
          this.lastError = typeof errorMessageText === "string" ? errorMessageText : `Response ${String(stopReason)}`;
          this.setStatus("error", this.lastError);
        } else {
          this.lastError = undefined;
        }
      }
      this.publish({ type: "message_end", message });
      this.scheduleState(80);
    });

    this.pi.on("tool_execution_start", (event) => {
      const item: ActivityItem = {
        id: event.toolCallId,
        name: event.toolName,
        status: "running",
        startedAt: Date.now(),
        durationMs: null,
        summary: summarizeArgs(event.args),
      };
      this.activeTools.set(event.toolCallId, item);
      this.pushActivity(item);
      this.setStatus("tool", `${event.toolName} executing`);
      this.publish({
        type: "tool_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        parentToolCallId: event.parentToolCallId,
        startedAt: item.startedAt,
      });
      this.scheduleState(100);
    });

    this.pi.on("tool_execution_update", (event) => {
      this.publish({
        type: "tool_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
        parentToolCallId: event.parentToolCallId,
      });
      this.scheduleState(250);
    });

    this.pi.on("tool_execution_end", (event) => {
      const existing = this.activeTools.get(event.toolCallId);
      this.activeTools.delete(event.toolCallId);
      this.updateActivity(event.toolCallId, {
        status: event.isError ? "error" : "ok",
        durationMs: event.durationMs ?? (existing ? Date.now() - existing.startedAt : null),
      });
      this.setStatus(
        this.activeTools.size > 0 ? "tool" : "streaming",
        this.activeTools.size > 0 ? `${this.activeTools.size} tool(s) executing` : "Tool finished",
      );
      this.publish({
        type: "tool_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
        durationMs: event.durationMs ?? null,
        parentToolCallId: event.parentToolCallId,
      });
      this.scheduleState(100);
    });

    this.pi.on("model_select", (event) => {
      const previous = event.previousModel
        ? `${event.previousModel.provider}/${event.previousModel.id}`
        : undefined;
      this.publish({
        type: "model_select",
        model: { provider: event.model.provider, id: event.model.id, name: event.model.name },
        previous,
      });
      this.scheduleState(50);
    });

    this.pi.on("thinking_level_select", (event) => {
      this.publish({
        type: "thinking_level_select",
        level: event.level,
        previous: event.previousLevel,
      });
      this.scheduleState(50);
    });

    this.pi.on("session_before_compact", (event) => {
      this.setStatus("compacting", `Compacting (${event.reason})`);
      this.publish({ type: "compact_start", reason: event.reason });
    });

    this.pi.on("session_compact", (event) => {
      this.setStatus("idle", "Compaction complete");
      this.publish({
        type: "compact_end",
        reason: event.reason,
        summary: event.compactionEntry.summary,
        tokensBefore: event.compactionEntry.tokensBefore,
      });
      this.publish({ type: "session", snapshot: this.snapshotOrUndefined() });
      this.scheduleState(0);
    });

    this.pi.on("session_compact_failed", (event) => {
      const detail = event.aborted ? "Compaction aborted" : event.errorMessage ?? "Compaction failed";
      this.lastError = detail;
      this.setStatus("error", detail);
      this.publish({ type: "compact_failed", reason: event.reason, error: detail });
      this.scheduleState(0);
    });

    this.pi.on("session_tree", (event) => {
      this.publish({
        type: "tree",
        newLeafId: event.newLeafId,
        oldLeafId: event.oldLeafId,
      });
      this.publish({ type: "session", snapshot: this.snapshotOrUndefined() });
      this.scheduleState(0);
    });

    this.pi.on("ui_prompt_start", (event) => {
      this.uiPrompt = { kind: event.kind, title: event.title, since: Date.now() };
      this.publish({
        type: "ui_prompt",
        active: true,
        kind: event.kind,
        title: event.title,
        since: this.uiPrompt.since,
      });
      this.scheduleState(0);
    });

    this.pi.on("ui_prompt_end", (event) => {
      this.uiPrompt = null;
      this.publish({ type: "ui_prompt", active: false, kind: event.kind, title: event.title });
      this.scheduleState(0);
    });

    this.bindPopupBridge();
  }

  /**
   * Popups an extension wants rendered in the browser. The pi extension API
   * cannot mirror arbitrary TUI components, so extensions publish a description
   * on the shared event bus and get the answer back on it.
   */
  private bindPopupBridge(): void {
    this.unbindPopupBridge();
    const events = this.pi.events;
    if (!events) return;
    this.popupUnsubscribers = [
      events.on(POPUP_OPEN_CHANNEL, (payload: unknown) => {
        const spec = this.popups.open(payload);
        if (!spec) return;
        this.publish({ type: "popup_open", popup: spec });
        this.scheduleState(0);
      }),
      events.on(POPUP_CLOSE_CHANNEL, (payload: unknown) => {
        const id = typeof payload === "object" && payload !== null ? (payload as { id?: unknown }).id : payload;
        if (typeof id !== "string") return;
        if (!this.popups.close(id)) return;
        this.publish({ type: "popup_close", id });
        this.scheduleState(0);
      }),
      // Presence probe: an extension can ask whether a browser is actually
      // listening before it decides between a web popup and a terminal dialog.
      events.on(POPUP_PING_CHANNEL, (payload: unknown) => {
        const id = typeof payload === "object" && payload !== null ? (payload as { id?: unknown }).id : undefined;
        try {
          events.emit(POPUP_PONG_CHANNEL, {
            id,
            url: this.url,
            version: VERSION,
            clients: this.hub?.subscriberCount ?? 0,
          });
        } catch {
          /* extension unloaded */
        }
      }),
    ];
  }

  private unbindPopupBridge(): void {
    for (const off of this.popupUnsubscribers) {
      try {
        off();
      } catch {
        /* bus may already be torn down */
      }
    }
    this.popupUnsubscribers = [];
  }

  private answerPopup(payload: { id?: unknown; value?: unknown; cancelled?: unknown }): { ok: boolean; error?: string } {
    const id = typeof payload.id === "string" ? payload.id : "";
    const popup = id ? this.popups.get(id) : undefined;
    if (!popup) return { ok: false, error: "Unknown or expired popup" };
    this.popups.close(id);
    const value = typeof payload.value === "string" ? payload.value : undefined;
    const cancelled = payload.cancelled === true || (popup.kind !== "notice" && value === undefined);
    const answer = { id, ...(value !== undefined ? { value } : {}), ...(cancelled ? { cancelled: true } : {}) };
    try {
      this.pi.events?.emit(POPUP_ANSWER_CHANNEL, answer);
    } catch {
      /* an extension may have unloaded */
    }
    this.publish({ type: "popup_close", id, answer });
    this.scheduleState(0);
    return { ok: true };
  }

  async start(options: StartOptions = {}): Promise<{ url: string; started: boolean }> {
    if (this.server) {
      this.syncStatusIndicator();
      if (!options.quiet) this.notifyUrl();
      if (options.open) await this.openBrowser();
      return { url: this.url, started: false };
    }

    const host = options.host ?? stringFlag(this.pi, "web-host") ?? process.env.PI_COCKPIT_HOST ?? DEFAULT_HOST;
    const port = normalizePort(
      options.port ?? stringFlag(this.pi, "web-port") ?? process.env.PI_COCKPIT_PORT ?? DEFAULT_PORT,
    );
    const configuredToken =
      options.token || stringFlag(this.pi, "web-token") || process.env.PI_COCKPIT_TOKEN || "";
    const token = configuredToken || (isLoopbackHost(host) ? undefined : randomBytes(18).toString("base64url"));

    const hub = new EventHub();
    const backend = this.createBackend();
    const handler = createRequestHandler(backend, hub, { token, version: VERSION, host });
    const server = createServer(handler);

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });

    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : port;

    this.server = server;
    this.hub = hub;
    this.host = host;
    this.port = actualPort;
    this.startedAt = Date.now();
    this.token = token;
    this.url = buildUrl(host, actualPort, token);

    server.on("error", (error) => {
      this.lastError = `Cockpit server: ${error.message}`;
      this.publish({ type: "notice", level: "error", message: this.lastError });
    });
    server.on("close", () => {
      this.server = undefined;
      this.hub = undefined;
    });

    this.syncStatusIndicator();
    this.scheduleState(0);
    this.publish({
      type: "notice",
      level: "info",
      message: token ? "Pi Web Cockpit online (token auth enabled)" : "Pi Web Cockpit online",
    });
    // Announce the browser endpoint so extensions can route popups here.
    try {
      this.pi.events?.emit(POPUP_READY_CHANNEL, {
        url: this.url,
        version: VERSION,
        clients: this.hub.subscriberCount,
      });
    } catch {
      /* no bus in this host */
    }
    this.persistState(true);

    if (!options.quiet) this.notifyUrl();
    if (options.open) await this.openBrowser();
    return { url: this.url, started: true };
  }

  async stop(options: { persist?: boolean } = {}): Promise<void> {
    const server = this.server;
    const hub = this.hub;
    if (!server && !hub) return;

    // Keep the persisted "enabled" flag through reloads so the new runtime can
    // restore the cockpit automatically.
    if (options.persist !== false) this.persistState(false);
    this.server = undefined;
    this.hub = undefined;
    this.url = "";
    this.startedAt = 0;

    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = undefined;
    }
    this.uiPrompt = null;
    this.popups.clear();
    this.unbindPopupBridge();
    hub?.close();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
        setTimeout(resolve, 1_000).unref?.();
      });
    }
    this.syncStatusIndicator();
    if (this.ctx) this.notify(this.ctx, "Pi Web Cockpit offline", "info");
  }

  async restart(options: StartOptions = {}): Promise<{ url: string; started: boolean }> {
    const port = options.port ?? (this.port || DEFAULT_PORT);
    const host = options.host ?? this.host;
    await this.stop();
    return this.start({ ...options, port, host });
  }

  private createBackend(): CockpitBackend {
    return {
      snapshot: () => this.snapshot(),
      prompt: (message, mode) => this.prompt(message, mode),
      abort: () => this.abort(),
      setModel: (provider, id) => this.setModel(provider, id),
      setThinking: (level) => this.setThinking(level),
      setTools: (names) => this.setTools(names),
      compact: (instructions) => this.compact(instructions),
      rename: (name) => this.rename(name),
      newSession: () => this.newSession(),
      answerPopup: (payload) => this.answerPopup(payload),
      isBusy: () => (this.ctx ? !this.ctx.isIdle() : true),
    };
  }

  private snapshot(): CockpitSnapshot {
    const ctx = this.requireCtx();
    return buildSnapshot(this.pi, ctx, {
      version: VERSION,
      url: publicUrl(this.url),
      host: this.host,
      port: this.port,
      startedAt: this.startedAt,
      clients: this.hub?.subscriberCount ?? 0,
      authRequired: Boolean(this.token),
      status: this.status,
      statusDetail: this.statusDetail,
      lastError: this.lastError,
      statusSince: this.statusSince,
      activity: this.activity,
      uiPrompt: this.uiPrompt,
      popups: this.popups.list(),
    });
  }

  private snapshotOrUndefined(): CockpitSnapshot | undefined {
    try {
      return this.snapshot();
    } catch {
      return undefined;
    }
  }

  private async prompt(message: string, mode: PromptMode): Promise<{ disposition: string; busy: boolean }> {
    const ctx = this.requireCtx();
    this.assertRunnableCommand(message);
    const busy = !ctx.isIdle();
    let deliverAs: "steer" | "followUp" | undefined;
    if (busy) deliverAs = mode === "steer" ? "steer" : "followUp";
    this.pi.sendUserMessage(message, {
      ...(deliverAs ? { deliverAs } : {}),
      expandPromptTemplates: true,
    });
    if (!busy) this.setStatus("thinking", "Directive accepted");
    return {
      disposition: !busy ? "started" : deliverAs === "steer" ? "queued-steer" : "queued-followup",
      busy,
    };
  }

  private abort(): void {
    const ctx = this.requireCtx();
    ctx.abort();
    this.publish({ type: "notice", level: "warning", message: "Abort requested" });
    this.scheduleState(0);
  }

  private async setModel(provider: string, id: string): Promise<boolean> {
    const ctx = this.requireCtx();
    let model = ctx.modelRegistry.find(provider, id);
    if (!model) {
      model = ctx.modelRegistry
        .getAvailable()
        .find((entry) => entry.provider === provider && entry.id === id);
    }
    if (!model) return false;
    const ok = await this.pi.setModel(model);
    if (ok) this.scheduleState(0);
    return ok;
  }

  private setThinking(level: string): void {
    this.requireCtx();
    if (!(ALL_THINKING_LEVELS as readonly string[]).includes(level)) {
      throw new Error(`Unknown thinking level: ${level}`);
    }
    this.pi.setThinkingLevel(level as (typeof ALL_THINKING_LEVELS)[number]);
    this.scheduleState(0);
  }

  private setTools(names: string[]): void {
    this.requireCtx();
    this.pi.setActiveTools(names);
    this.scheduleState(0);
  }

  private compact(instructions?: string): void {
    const ctx = this.requireCtx();
    ctx.compact(instructions ? { customInstructions: instructions } : undefined);
    this.scheduleState(0);
  }

  private rename(name: string): void {
    this.requireCtx();
    this.pi.setSessionName(name);
    this.scheduleState(0);
  }

  private newSession(): void {
    const ctx = this.requireCtx();
    if (!ctx.isIdle()) throw new Error("Cannot start a new session while Pi is running");
    if (ctx.hasPendingMessages()) throw new Error("Clear or wait for the queued messages first");
    if (ctx.mode !== "tui") {
      throw new Error("New sessions must be started from the terminal in RPC/JSON/print mode");
    }
    this.pi.sendUserMessage("/web-session new", { expandPromptTemplates: true });
  }

  /**
   * Pi's builtin slash commands are handled by the interactive editor, not by the
   * session. Forwarding one would silently bill a model request for text like
   * "/thinking low", so known-but-unrunnable commands are refused here. Unknown
   * `/` words still pass through: they are ordinary prompt text such as a path.
   */
  private assertRunnableCommand(message: string): void {
    const match = /^\/([A-Za-z0-9:_-]+)/.exec(message.trim());
    if (!match) return;
    const name = match[1] ?? "";
    if (!name) return;
    let live: Set<string>;
    try {
      live = new Set(this.pi.getCommands().map((command) => command.name));
    } catch {
      return;
    }
    if (live.has(name)) return;
    if (WEB_COMMANDS.some((command) => command.name === name)) {
      throw new Error(`/${name} is a cockpit command — run it from the composer`);
    }
    if (TERMINAL_COMMANDS.some((command) => command.name === name)) {
      throw new Error(`/${name} only runs in the Pi terminal`);
    }
  }

  private requireCtx(): ExtensionContext {
    if (!this.ctx) throw new Error("No active Pi session");
    return this.ctx;
  }

  private handleCockpitCommand(args: string, ctx: ExtensionCommandContext): void {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    let action = parts[0] ?? "start";
    let port: string | number | undefined = parts[1];
    if (/^\d+$/.test(action)) {
      port = action;
      action = "start";
    }

    switch (action) {
      case "start": {
        void this.start({ port, quiet: false }).catch((error: unknown) => {
          this.notify(ctx, `Web Cockpit failed to start: ${errorMessage(error)}`, "error");
        });
        return;
      }
      case "open": {
        void this.start({ port, open: true, quiet: false }).catch((error: unknown) => {
          this.notify(ctx, `Web Cockpit failed to start: ${errorMessage(error)}`, "error");
        });
        return;
      }
      case "stop": {
        void this.stop();
        return;
      }
      case "restart": {
        void this.restart({ port }).catch((error: unknown) => {
          this.notify(ctx, `Web Cockpit failed to restart: ${errorMessage(error)}`, "error");
        });
        return;
      }
      case "status": {
        if (this.server) {
          this.notify(ctx, `Pi Web Cockpit online → ${this.url} (${this.hub?.subscriberCount ?? 0} client(s))`, "info");
        } else {
          this.notify(ctx, "Pi Web Cockpit is offline. Run /web to start it.", "info");
        }
        return;
      }
      default:
        this.notify(
          ctx,
          "Usage: /web [start [port] | open | stop | restart | status]",
          "warning",
        );
    }
  }

  private async openBrowser(): Promise<void> {
    if (!this.url) return;
    const url = this.url;
    const platform = process.platform;
    try {
      if (platform === "darwin") {
        await this.pi.exec("open", [url], { timeout: 5_000 });
      } else if (platform === "win32") {
        await this.pi.exec("cmd", ["/c", "start", "", url], { timeout: 5_000 });
      } else {
        await this.pi.exec("xdg-open", [url], { timeout: 5_000 });
      }
    } catch {
      if (this.ctx) {
        this.notify(this.ctx, `Could not open a browser. Open ${url} manually.`, "warning");
      }
    }
  }

  private setStatus(kind: CockpitStatus, detail?: string): void {
    if (this.status === kind && this.statusDetail === detail) return;
    this.status = kind;
    this.statusDetail = detail;
    this.statusSince = Date.now();
    this.publish({ type: "status", kind, detail, since: this.statusSince });
    this.scheduleState(50);
  }

  private scheduleState(delayMs = 250): void {
    if (!this.hub || !this.ctx) return;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => {
      this.stateTimer = undefined;
      this.emitState();
    }, delayMs);
    this.stateTimer.unref?.();
  }

  private emitState(): void {
    if (!this.hub || !this.ctx) return;
    try {
      const state = snapshotLite(this.pi, this.ctx, {
        status: this.status,
        statusDetail: this.statusDetail,
        lastError: this.lastError,
        statusSince: this.statusSince,
        activity: this.activity,
        clients: this.hub.subscriberCount,
      });
      this.hub.publish({ type: "state", state });
    } catch {
      /* the session can disappear between ticks */
    }
  }

  private publish(payload: Record<string, unknown>): void {
    this.hub?.publish(payload);
  }

  private pushActivity(item: ActivityItem): void {
    this.activity = [item, ...this.activity.filter((entry) => entry.id !== item.id)].slice(0, 14);
  }

  private updateActivity(
    id: string,
    patch: Partial<Pick<ActivityItem, "status" | "durationMs">>,
  ): void {
    this.activity = this.activity.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
  }

  private syncStatusIndicator(): void {
    if (!this.ctx) return;
    try {
      this.ctx.ui.setStatus(
        "webman",
        this.server ? `◈ WEB :${this.port}` : undefined,
      );
    } catch {
      /* cosmetic */
    }
  }

  private notifyUrl(): void {
    if (!this.ctx || !this.url) return;
    const clientNote = this.hub?.subscriberCount ? ` · ${this.hub.subscriberCount} client(s)` : "";
    this.notify(this.ctx, `Pi Web Cockpit online → ${this.url}${clientNote}`, "info");
  }

  private notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
    try {
      ctx.ui.notify(message, type);
    } catch {
      /* non-interactive mode */
    }
  }

  private persistState(enabled: boolean): void {
    try {
      const previous = this.ctx ? this.persisted(this.ctx) : undefined;
      if (
        previous &&
        previous.enabled === enabled &&
        previous.port === (this.port || undefined) &&
        previous.host === this.host
      ) {
        return;
      }
      const state: PersistedState = {
        enabled,
        port: this.port || undefined,
        host: this.host,
        updatedAt: Date.now(),
      };
      this.pi.appendEntry(SESSION_STATE_ENTRY, state);
    } catch {
      /* not fatal */
    }
  }

  private persisted(ctx: ExtensionContext): PersistedState | undefined {
    try {
      const branch = ctx.sessionManager.getBranch();
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index];
        if (entry && entry.type === "custom" && entry.customType === SESSION_STATE_ENTRY) {
          const data = entry.data as PersistedState | undefined;
          if (data && typeof data.enabled === "boolean") return data;
        }
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private wasEnabled(ctx: ExtensionContext): boolean {
    return this.persisted(ctx)?.enabled === true;
  }

  private persistedPort(ctx: ExtensionContext): number | undefined {
    const port = this.persisted(ctx)?.port;
    return typeof port === "number" ? port : undefined;
  }
}

function normalizePort(input: number | string | undefined): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    return Math.max(0, Math.min(65_535, Math.trunc(input)));
  }
  const parsed = Number.parseInt(String(input ?? DEFAULT_PORT), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65_535) return DEFAULT_PORT;
  return parsed;
}

function stringFlag(pi: ExtensionAPI, name: string): string | undefined {
  const value = pi.getFlag(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "") return "127.0.0.1";
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

function publicUrl(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return url.replace(/\?.*$/, "");
  }
}

function buildUrl(host: string, port: number, token: string | undefined): string {
  let display = displayHost(host);
  if (display === "127.0.0.1") {
    // Prefer a reachable LAN address in the hint when bound to all interfaces.
    if (host === "0.0.0.0" || host === "::") {
      const lan = firstLanAddress();
      if (lan) display = lan;
    }
  }
  const base = `http://${display}:${port}/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function firstLanAddress(): string | undefined {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args.slice(0, 140);
  if (typeof args !== "object") return String(args).slice(0, 140);
  const record = args as Record<string, unknown>;
  const preferred = [
    "command", "path", "file", "file_path", "pattern", "query", "url", "name",
    "prompt", "description", "task", "cwd", "dir", "glob", "symbol",
  ];
  for (const key of preferred) {
    const value = record[key];
    if (typeof value === "string" && value) return `${key}: ${value.slice(0, 140)}`;
  }
  try {
    return JSON.stringify(args).slice(0, 160);
  } catch {
    return "";
  }
}

export default function piWebman(pi: ExtensionAPI): void {
  const runtime = new CockpitRuntime(pi);
  runtime.register();
}

export { CockpitRuntime, VERSION };
