/* ============================================================
   PI // COCKPIT — client
   ============================================================ */
(() => {
  "use strict";

  const TOKEN = new URLSearchParams(location.search).get("token") || "";
  const $ = (selector, root = document) => root.querySelector(selector);

  const dom = {
    app: $("#app"),
    boot: $("#boot"),
    bootLog: $("#boot-log"),
    bootProgress: $("#boot-progress"),
    version: $("#version"),
    sessionName: $("#session-name"),
    renameBtn: $("#rename-btn"),
    cwd: $("#cwd"),
    net: $("#net"),
    netLabel: $("#net-label"),
    clock: $("#clock"),
    themeBtn: $("#theme-btn"),
    themeColor: $("#theme-color"),
    statusWrap: $("#status-wrap"),
    statusText: $("#status-text"),
    statusSub: $("#status-sub"),
    abortBtn: $("#abort-btn"),
    scrollLive: $("#scroll-live"),
    transcript: $("#transcript"),
    emptyState: $("#empty-state"),
    input: $("#input"),
    sendBtn: $("#send-btn"),
    modeSwitch: $("#mode-switch"),
    composerHint: $("#composer-hint"),
    quick: $("#quick-actions"),
    queueInfo: $("#queue-info"),
    ctxPercent: $("#ctx-percent"),
    ctxTokens: $("#ctx-tokens"),
    ctxWindow: $("#ctx-window"),
    ctxBars: $("#ctx-bars"),
    gaugeFill: $("#gauge-fill"),
    statInput: $("#stat-input"),
    statOutput: $("#stat-output"),
    statCacheRead: $("#stat-cache-read"),
    statCacheWrite: $("#stat-cache-write"),
    statReasoning: $("#stat-reasoning"),
    statCost: $("#stat-cost"),
    statMessages: $("#stat-messages"),
    statTools: $("#stat-tools"),
    statRate: $("#stat-rate"),
    pulseCanvas: $("#pulse-canvas"),
    pulseCode: $("#pulse-code"),
    activity: $("#activity"),
    activityCount: $("#activity-count"),
    modelBtn: $("#model-btn"),
    modelName: $("#model-name"),
    modelProvider: $("#model-provider"),
    modelMeta: $("#model-meta"),
    thinkingSeg: $("#thinking-seg"),
    thinkingCode: $("#thinking-code"),
    toolList: $("#tool-list"),
    toolCount: $("#tool-count"),
    uplinkHost: $("#uplink-host"),
    uplinkClients: $("#uplink-clients"),
    uplinkUptime: $("#uplink-uptime"),
    uplinkLeaf: $("#uplink-leaf"),
    uplinkCode: $("#uplink-code"),
    palette: $("#palette"),
    paletteInput: $("#palette-input"),
    paletteList: $("#palette-list"),
    modal: $("#modal"),
    modalKicker: $("#modal-kicker"),
    modalTitle: $("#modal-title"),
    modalBody: $("#modal-body"),
    modalInput: $("#modal-input"),
    modalCancel: $("#modal-cancel"),
    modalOk: $("#modal-ok"),
    toasts: $("#toasts"),
    bgCanvas: $("#bg-canvas"),
  };

  const GAUGE_LENGTH = 314.159;
  const STATUS_LABELS = {
    idle: "STANDBY",
    thinking: "THINKING",
    streaming: "STREAMING",
    tool: "EXECUTING",
    settling: "SETTLING",
    compacting: "COMPACTING",
    error: "FAULT",
    offline: "OFFLINE",
  };

  const state = {
    snapshot: null,
    history: [],
    live: null,
    liveCounter: 0,
    toolResults: new Map(),
    toolCallIds: new Set(),
    toolExec: new Map(),
    activity: [],
    status: "idle",
    statusDetail: "",
    busy: false,
    idle: true,
    hasRun: false,
    pending: false,
    mode: "auto",
    stick: true,
    openThinking: new Set(),
    openTools: new Set(),
    es: null,
    booted: false,
    connected: false,
    rate: 0,
    streamChars: 0,
    pulse: new Array(128).fill(0),
    lastOutputTokens: 0,
    lastOutputAt: 0,
    promptHistory: loadPromptHistory(),
    programmaticScroll: false,
    promptIndex: -1,
    palette: { open: false, items: [], filtered: [], index: 0, scope: "all" },
    modal: null,
    toolsSignature: "",
    thinkingSignature: "",
    lastModelKey: "",
    uptimeStart: 0,
    notifiedOffline: false,
    maxContextSeen: 0,
    capabilities: {},
    sessionMode: "",
  };

  /* ------------------------------------------------------------
     utilities
     ------------------------------------------------------------ */

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&": return "&amp;";
        case "<": return "&lt;";
        case ">": return "&gt;";
        case '"': return "&quot;";
        default: return "&#39;";
      }
    });

  const escapeAttr = escapeHtml;

  /* ------------------------------------------------------------
     theme
     ------------------------------------------------------------ */

  const THEME_KEY = "pi-cockpit-theme";
  const THEME_META = { dark: "#04060c", light: "#dfe9f3" };
  const themeMedia = window.matchMedia("(prefers-color-scheme: light)");
  let themePaletteCache = null;

  function storedTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function applyTheme(theme, persist = true) {
    const next = theme === "light" ? "light" : "dark";
    const changed = currentTheme() !== next;
    if (changed) document.documentElement.classList.add("theme-switching");
    document.documentElement.dataset.theme = next;
    themePaletteCache = null;
    if (dom.themeColor) dom.themeColor.setAttribute("content", THEME_META[next]);
    const label = next === "light" ? "Switch to dark mode" : "Switch to light mode";
    if (dom.themeBtn) {
      dom.themeBtn.setAttribute("aria-label", label);
      dom.themeBtn.title = label;
      dom.themeBtn.setAttribute("aria-pressed", next === "light" ? "true" : "false");
    }
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage disabled */
      }
    }
    if (changed) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching"));
      });
    }
  }

  function toggleTheme() {
    const next = currentTheme() === "light" ? "dark" : "light";
    applyTheme(next);
    toast(`Visual mode → ${next.toUpperCase()}`, "info", 2200);
  }

  function themePalette() {
    if (themePaletteCache) return themePaletteCache;
    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    themePaletteCache = {
      cyan: read("--cyan-rgb", "56, 245, 255"),
      violet: read("--violet-rgb", "139, 125, 255"),
      magenta: read("--magenta-rgb", "255, 69, 216"),
      star: read("--star-rgb", "118, 224, 255"),
      grid: read("--grid-line", "rgba(56, 245, 255, 0.08)"),
    };
    return themePaletteCache;
  }

  function formatTokens(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "0";
    if (number < 1000) return String(Math.round(number));
    if (number < 1_000_000) {
      const scaled = number / 1000;
      return `${scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0)}K`;
    }
    return `${(number / 1_000_000).toFixed(2)}M`;
  }

  function formatExact(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function formatCost(value) {
    const number = Number(value || 0);
    if (number === 0) return "$0.00";
    if (number < 0.01) return `$${number.toFixed(4)}`;
    return `$${number.toFixed(2)}`;
  }

  function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  function formatClock(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("en-GB", { hour12: false });
  }

  function truncate(value, length = 120) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function elFromHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function contentBlocks(message) {
    if (!message) return [];
    if (typeof message.content === "string") return [{ type: "text", text: message.content }];
    return Array.isArray(message.content) ? message.content : [];
  }

  function textFromContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        if (block.type === "text") return block.text || "";
        if (block.type === "image") return `[image ${block.mimeType || "unknown"}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  function toolResultText(result) {
    if (!result) return "";
    let text = textFromContent(result.content);
    if (result.details && typeof result.details === "object") {
      const details = result.details;
      const diff = details.diff || details.patch || details.unifiedDiff;
      if (typeof diff === "string" && !text.includes(diff)) {
        text = text ? `${text}\n\n${diff}` : diff;
      }
    }
    return text;
  }

  function findDiff(result) {
    const details = result && result.details;
    if (!details || typeof details !== "object") return null;
    for (const key of ["diff", "patch", "unifiedDiff"]) {
      if (typeof details[key] === "string") return details[key];
    }
    return null;
  }

  function summarizeArgs(args) {
    if (args === undefined || args === null) return "";
    if (typeof args === "string") return truncate(args, 140);
    if (typeof args !== "object") return truncate(String(args), 140);
    const preferred = [
      "command", "path", "file", "file_path", "pattern", "query", "url", "name",
      "prompt", "description", "task", "cwd", "dir", "glob", "symbol",
    ];
    for (const key of preferred) {
      if (typeof args[key] === "string" && args[key]) {
        return `${key}: ${truncate(args[key], 140)}`;
      }
    }
    try {
      return truncate(JSON.stringify(args), 160);
    } catch {
      return "";
    }
  }

  function prettyJson(value, limit = 24_000) {
    try {
      const text = JSON.stringify(value, null, 2);
      if (!text) return "";
      return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text;
    } catch {
      return String(value ?? "");
    }
  }

  function shortId(id) {
    if (!id) return "—";
    const text = String(id);
    return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
  }

  /* ------------------------------------------------------------
     markdown
     ------------------------------------------------------------ */

  function inlineMarkdown(raw) {
    const codeSpans = [];
    let text = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_match, code) => {
      const index = codeSpans.push(code) - 1;
      return `\u0001IC${index}\u0001`;
    });
    text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    text = text.replace(/_([^_\n]+)_/g, "<em>$1</em>");
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|#[^)\s]*)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    return text.replace(/\u0001IC(\d+)\u0001/g, (_match, index) => `<code>${codeSpans[Number(index)]}</code>`);
  }

  function renderCodeBlock(language, code) {
    const lang = (language || "text").trim().toLowerCase() || "text";
    return `<div class="code-block"><div class="code-head"><span>${escapeHtml(lang)}</span><button class="code-copy" type="button">COPY</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
  }

  function renderMarkdown(source) {
    if (source === undefined || source === null) return "";
    const raw = String(source);
    if (!raw.trim()) return "";

    const codeBlocks = [];
    let text = raw.replace(/```([\w+#.-]*)[ \t]*\r?\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const index = codeBlocks.push({ lang, code }) - 1;
      return `\n\u0000CODE${index}\u0000\n`;
    });

    const lines = text.split(/\r?\n/);
    const out = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      const codeMatch = trimmed.match(/^\u0000CODE(\d+)\u0000$/);
      if (codeMatch) {
        const block = codeBlocks[Number(codeMatch[1])];
        if (block) out.push(renderCodeBlock(block.lang, block.code));
        index += 1;
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        out.push("<hr>");
        index += 1;
        continue;
      }

      if (trimmed.startsWith("&gt;") || trimmed.startsWith(">")) {
        const quoted = [];
        while (index < lines.length && lines[index].trim().startsWith(">")) {
          quoted.push(lines[index].trim().replace(/^>\s?/, ""));
          index += 1;
        }
        out.push(`<blockquote>${quoted.map((entry) => inlineMarkdown(entry)).join("<br>")}</blockquote>`);
        continue;
      }

      const listMatch = trimmed.match(/^([-*+]|\d+\.)\s+(.*)$/);
      if (listMatch) {
        const ordered = /^\d+\./.test(listMatch[1]);
        const tag = ordered ? "ol" : "ul";
        const items = [];
        while (index < lines.length) {
          const candidate = lines[index].trim();
          const match = candidate.match(/^([-*+]|\d+\.)\s+(.*)$/);
          if (!match) break;
          items.push(`<li>${inlineMarkdown(match[2])}</li>`);
          index += 1;
        }
        out.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      const paragraph = [];
      while (index < lines.length) {
        const candidate = lines[index];
        const candidateTrim = candidate.trim();
        if (!candidateTrim) break;
        if (/^\u0000CODE\d+\u0000$/.test(candidateTrim)) break;
        if (/^(#{1,6})\s+/.test(candidateTrim)) break;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(candidateTrim)) break;
        if (candidateTrim.startsWith(">")) break;
        if (/^([-*+]|\d+\.)\s+/.test(candidateTrim)) break;
        paragraph.push(candidateTrim);
        index += 1;
      }
      out.push(`<p>${paragraph.map((entry) => inlineMarkdown(entry)).join("<br>")}</p>`);
    }

    return out.join("");
  }

  function renderDiff(diff) {
    return String(diff)
      .split("\n")
      .map((line) => {
        let cls = "";
        if (/^(\+\+\+|---|@@|diff )/.test(line)) cls = "hunk";
        else if (line.startsWith("+")) cls = "add";
        else if (line.startsWith("-")) cls = "del";
        const safe = escapeHtml(line);
        return cls ? `<span class="${cls}">${safe}</span>` : safe;
      })
      .join("\n");
  }

  /* ------------------------------------------------------------
     api + connection
     ------------------------------------------------------------ */

  function apiUrl(path) {
    const url = new URL(path, location.origin);
    if (TOKEN) url.searchParams.set("token", TOKEN);
    return url.toString();
  }

  async function api(path, body) {
    const response = await fetch(apiUrl(path), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(TOKEN ? { "x-pi-token": TOKEN } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error((payload && payload.error) || `HTTP ${response.status}`);
    }
    return payload;
  }

  function setNet(mode) {
    dom.net.dataset.state = mode;
    dom.netLabel.textContent = mode === "online" ? "ONLINE" : mode === "offline" ? "OFFLINE" : "LINKING";
  }

  function connect() {
    if (state.es) {
      state.es.close();
      state.es = null;
    }
    setNet("linking");
    const url = apiUrl("/api/events");
    let source;
    try {
      source = new EventSource(url);
    } catch (error) {
      setNet("offline");
      toast(`Event stream failed: ${error.message}`, "error");
      return;
    }
    state.es = source;
    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      handleEvent(payload);
    };
    source.onerror = () => {
      if (state.connected) {
        setNet("offline");
        if (!state.notifiedOffline) {
          state.notifiedOffline = true;
          toast("Uplink interrupted — reconnecting…", "warning");
        }
      }
    };
  }

  function handleEvent(payload) {
    if (!payload || typeof payload !== "object") return;
    switch (payload.type) {
      case "hello":
        state.notifiedOffline = false;
        applySnapshot(payload.snapshot);
        setNet("online");
        break;
      case "state":
        applyLiteState(payload.state);
        break;
      case "status":
        setStatusUI(payload.kind, payload.detail);
        break;
      case "session":
        if (payload.snapshot) {
          state.notifiedOffline = false;
          applySnapshot(payload.snapshot);
          finishBoot("SESSION RELINKED");
        }
        break;
      case "session_info":
        if (state.snapshot) state.snapshot.session.name = payload.name;
        dom.sessionName.textContent = payload.name || "UNNAMED";
        break;
      case "agent_start":
        state.hasRun = true;
        state.busy = true;
        updateBusyUI();
        setStatusUI("thinking", "Agent run started");
        break;
      case "agent_end":
        setStatusUI("settling", "Waiting for Pi to settle");
        break;
      case "agent_settled":
        state.busy = false;
        updateBusyUI();
        setStatusUI("idle", payload.aborted ? "Aborted" : "");
        break;
      case "message_start":
        handleMessageStart(payload.message);
        break;
      case "message_update":
        handleMessageUpdate(payload);
        break;
      case "message_end":
        handleMessageEnd(payload.message);
        break;
      case "tool_start":
        handleToolStart(payload);
        break;
      case "tool_update":
        handleToolUpdate(payload);
        break;
      case "tool_end":
        handleToolEnd(payload);
        break;
      case "model_select":
        if (state.snapshot && payload.model) {
          state.snapshot.model = { ...(state.snapshot.model || {}), ...payload.model };
          applyModel(state.snapshot.model);
        }
        break;
      case "thinking_level_select":
        if (state.snapshot) state.snapshot.thinkingLevel = payload.level;
        renderThinking();
        break;
      case "compact_start":
        setStatusUI("compacting", "Compacting context");
        toast(`Compaction started (${payload.reason})`, "info");
        break;
      case "compact_end":
        toast(`Context compacted · ${formatTokens(payload.tokensBefore)} tokens before`, "success");
        break;
      case "compact_failed":
        toast(payload.error || "Compaction failed", "error");
        break;
      case "ui_prompt":
        if (payload.active) {
          toast(`Pi is waiting for terminal input${payload.title ? `: ${payload.title}` : ""}`, "warning", 9000);
        }
        break;
      case "notice":
        toast(payload.message || "", payload.level || "info");
        break;
      case "tree":
        toast("Session tree moved", "info");
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------
     snapshot + top-level state
     ------------------------------------------------------------ */

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      setNet("offline");
      return;
    }
    state.snapshot = snapshot;
    state.connected = true;
    state.uptimeStart = Date.now() - (snapshot.server?.uptimeMs || 0);
    state.notifiedOffline = false;

    state.history = (snapshot.history || []).map((item) => ({ ...item, _key: item.entryId }));
    state.live = null;
    state.openThinking.clear();
    state.openTools.clear();

    indexToolMaps();
    state.activity = Array.isArray(snapshot.activity) ? snapshot.activity : [];

    dom.version.textContent = `v${snapshot.version || "0.1.0"}`;
    dom.sessionName.textContent = snapshot.session?.name || "UNNAMED";
    dom.sessionName.title = `${snapshot.session?.id || ""}\n${snapshot.session?.file || ""}`;
    dom.cwd.textContent = snapshot.session?.cwd || "—";
    dom.cwd.title = snapshot.session?.cwd || "";
    dom.uplinkHost.textContent = snapshot.server?.host || "—";
    dom.uplinkClients.textContent = String(snapshot.server?.clients ?? 0);
    dom.uplinkCode.textContent = snapshot.server?.authRequired ? "AUTH" : "LOCAL";

    applyModel(snapshot.model);
    renderThinking();
    renderTools();
    applyTotals(snapshot.totals || {});
    applyUsage(snapshot.contextUsage);
    applyActivity();
    state.busy = !(snapshot.status?.idle ?? true);
    state.idle = snapshot.status?.idle ?? true;
    state.pending = snapshot.status?.pending ?? false;
    state.hasRun = (snapshot.totals?.messages || 0) > 0;
    state.sessionMode = snapshot.session?.mode || "";
    state.capabilities = snapshot.capabilities || {};
    setStatusUI(snapshot.status?.kind || "idle", snapshot.status?.detail || "");
    updateBusyUI();

    if (snapshot.historyTruncated > 0) {
      toast(`${snapshot.historyTruncated} older transcript entries omitted`, "info");
    }
    if (snapshot.error) {
      setNet("offline");
      toast(snapshot.error, "error");
      return;
    }

    renderTranscript();
    finishBoot("UPLINK ESTABLISHED");
  }

  function applyLiteState(lite) {
    if (!lite || typeof lite !== "object") return;
    state.connected = true;
    if (dom.net.dataset.state !== "online") setNet("online");
    if (state.snapshot) {
      if (lite.totals) state.snapshot.totals = lite.totals;
      if (lite.usage !== undefined) state.snapshot.contextUsage = lite.usage;
      if (lite.model) state.snapshot.model = lite.model;
      if (lite.thinkingLevel) state.snapshot.thinkingLevel = lite.thinkingLevel;
      if (Array.isArray(lite.thinkingLevels)) state.snapshot.thinkingLevels = lite.thinkingLevels;
      if (lite.sessionName !== undefined) state.snapshot.session.name = lite.sessionName;
      if (lite.leafId !== undefined) state.snapshot.session.leafId = lite.leafId;
      if (lite.clients !== undefined && state.snapshot.server) state.snapshot.server.clients = lite.clients;
    }

    state.idle = Boolean(lite.idle);
    state.busy = !lite.idle;
    if (!lite.idle || (lite.totals?.messages || 0) > 0) state.hasRun = true;
    state.capabilities = {
      ...state.capabilities,
      compact: Boolean(lite.idle),
      newSession:
        state.sessionMode === "tui" &&
        Boolean(lite.idle) &&
        !Boolean(lite.pending),
    };
    state.pending = Boolean(lite.pending);
    setStatusUI(lite.kind || "idle", lite.detail || "");

    if (lite.totals) applyTotals(lite.totals);
    if (lite.usage !== undefined) applyUsage(lite.usage);
    if (lite.model) applyModel(lite.model);
    if (lite.thinkingLevel) {
      dom.thinkingCode.textContent = String(lite.thinkingLevel).toUpperCase();
      renderThinking();
    }
    if (Array.isArray(lite.activity)) {
      state.activity = lite.activity;
      applyActivity();
    }
    if (lite.sessionName !== undefined) dom.sessionName.textContent = lite.sessionName || "UNNAMED";
    if (lite.clients !== undefined) dom.uplinkClients.textContent = String(lite.clients);
    if (lite.leafId !== undefined) dom.uplinkLeaf.textContent = shortId(lite.leafId);
    updateBusyUI();
  }

  function updateBusyUI() {
    dom.abortBtn.hidden = !state.busy && !state.pending;
    dom.sendBtn.classList.toggle("busy", state.busy);
    dom.queueInfo.hidden = !state.pending;
    dom.queueInfo.textContent = state.pending ? "QUEUE ACTIVE" : "";
  }

  function setStatusUI(kind, detail) {
    const normalized = STATUS_LABELS[kind] ? kind : "idle";
    state.status = normalized;
    state.statusDetail = detail || "";
    state.busy = normalized !== "idle" && normalized !== "error";
    updateBusyUI();
    dom.statusWrap.dataset.status = normalized;
    const label = normalized === "idle" && state.hasRun ? "NOMINAL" : STATUS_LABELS[normalized];
    dom.statusText.textContent = label;
    dom.statusSub.textContent = detail || "";
    dom.pulseCode.textContent = normalized === "idle" ? (state.hasRun ? "NOMINAL" : "IDLE") : normalized.toUpperCase();
  }

  /* ------------------------------------------------------------
     telemetry
     ------------------------------------------------------------ */

  function applyUsage(usage) {
    if (!usage || usage.percent === null || usage.percent === undefined) {
      dom.ctxPercent.textContent = "—";
      dom.ctxTokens.textContent = usage?.tokens ? formatTokens(usage.tokens) : "—";
      dom.ctxWindow.textContent = usage?.contextWindow ? formatTokens(usage.contextWindow) : "—";
      dom.gaugeFill.style.strokeDashoffset = String(GAUGE_LENGTH);
      dom.gaugeFill.classList.remove("danger");
      renderContextBars(0);
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(usage.percent)));
    state.maxContextSeen = Math.max(state.maxContextSeen, percent);
    dom.ctxPercent.textContent = `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
    dom.ctxTokens.textContent = formatTokens(usage.tokens);
    dom.ctxWindow.textContent = formatTokens(usage.contextWindow);
    dom.gaugeFill.style.strokeDashoffset = String(GAUGE_LENGTH * (1 - percent / 100));
    dom.gaugeFill.classList.toggle("danger", percent >= 85);
    renderContextBars(percent);
  }

  function renderContextBars(percent) {
    const segments = 24;
    const on = Math.round((percent / 100) * segments);
    if (dom.ctxBars.children.length !== segments) {
      dom.ctxBars.innerHTML = "";
      for (let index = 0; index < segments; index += 1) {
        const span = document.createElement("span");
        dom.ctxBars.append(span);
      }
    }
    Array.from(dom.ctxBars.children).forEach((child, index) => {
      child.classList.toggle("on", index < on);
    });
  }

  function applyTotals(totals) {
    dom.statInput.textContent = formatExact(totals.input);
    dom.statOutput.textContent = formatExact(totals.output);
    dom.statCacheRead.textContent = formatExact(totals.cacheRead);
    dom.statCacheWrite.textContent = formatExact(totals.cacheWrite);
    dom.statReasoning.textContent = formatExact(totals.reasoning);
    dom.statCost.textContent = formatCost(totals.cost);
    dom.statMessages.textContent = formatExact(totals.messages);
    dom.statTools.textContent = formatExact(totals.toolCalls);
  }

  function applyModel(model) {
    const key = model ? `${model.provider}/${model.id}` : "none";
    if (key === state.lastModelKey) return;
    state.lastModelKey = key;
    if (!model) {
      dom.modelName.textContent = "NO MODEL";
      dom.modelProvider.textContent = "configure a provider";
      dom.modelMeta.innerHTML = "";
      return;
    }
    dom.modelName.textContent = model.name || model.id;
    dom.modelProvider.textContent = `${model.provider} / ${model.id}`;
    dom.modelMeta.innerHTML = [
      `<div><span>CONTEXT</span><strong>${formatTokens(model.contextWindow)}</strong></div>`,
      `<div><span>MAX OUT</span><strong>${formatTokens(model.maxTokens)}</strong></div>`,
      `<div><span>REASONING</span><strong>${model.reasoning ? "YES" : "NO"}</strong></div>`,
      `<div><span>INPUT</span><strong>${escapeHtml((model.input || []).join("+") || "text")}</strong></div>`,
    ].join("");
  }

  function renderThinking() {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const levels = snapshot.thinkingLevels || ["off"];
    const current = snapshot.thinkingLevel || "off";
    const signature = `${levels.join(",")}|${current}`;
    if (signature === state.thinkingSignature) return;
    state.thinkingSignature = signature;
    dom.thinkingCode.textContent = String(current).toUpperCase();
    dom.thinkingSeg.innerHTML = "";
    for (const level of levels) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = level.toUpperCase();
      button.classList.toggle("active", level === current);
      button.addEventListener("click", () => setThinking(level));
      dom.thinkingSeg.append(button);
    }
  }

  function renderTools() {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const tools = snapshot.tools || [];
    const signature = tools.map((tool) => `${tool.name}:${tool.active}`).join("|");
    if (signature === state.toolsSignature) return;
    state.toolsSignature = signature;
    dom.toolCount.textContent = String(tools.filter((tool) => tool.active).length);
    dom.toolList.innerHTML = "";
    if (tools.length === 0) {
      dom.toolList.innerHTML = '<div class="rail-empty">No tools registered</div>';
      return;
    }
    for (const tool of tools) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tool-toggle${tool.active ? " active" : ""}`;
      button.title = tool.description || tool.name;
      button.innerHTML = `<span class="tick">✓</span><span>${escapeHtml(tool.name)}</span><span class="exposure">${escapeHtml(tool.exposure)}</span>`;
      button.addEventListener("click", () => toggleTool(tool.name));
      dom.toolList.append(button);
    }
  }

  function applyActivity() {
    dom.activityCount.textContent = String(state.activity.length);
    if (state.activity.length === 0) {
      dom.activity.innerHTML = '<div class="rail-empty">No operations yet</div>';
      return;
    }
    dom.activity.innerHTML = state.activity
      .map((item) => {
        const duration = item.status === "running"
          ? formatDuration(Date.now() - item.startedAt)
          : formatDuration(item.durationMs);
        return `<div class="activity-item" data-status="${escapeAttr(item.status)}">
          <span class="activity-dot"></span>
          <span class="activity-name">${escapeHtml(item.name)}<br><span class="activity-summary">${escapeHtml(truncate(item.summary || "", 54))}</span></span>
          <span class="activity-time">${escapeHtml(duration)}</span>
        </div>`;
      })
      .join("");
  }

  /* ------------------------------------------------------------
     transcript rendering
     ------------------------------------------------------------ */

  function allItems() {
    return state.live ? [...state.history, state.live] : state.history;
  }

  function indexToolMaps() {
    state.toolResults.clear();
    state.toolCallIds.clear();
    for (const item of state.history) {
      if (item.kind !== "message" || !item.message) continue;
      const message = item.message;
      if (message.role === "assistant") {
        for (const block of contentBlocks(message)) {
          if (block && block.type === "toolCall" && block.id) state.toolCallIds.add(block.id);
        }
      } else if (message.role === "toolResult" && message.toolCallId) {
        state.toolResults.set(message.toolCallId, message);
      }
    }
  }

  function renderTranscript() {
    dom.transcript.innerHTML = "";
    if (state.history.length === 0 && !state.live) {
      dom.emptyState = elFromHtml(`<div class="empty-state" id="empty-state">
        <div class="empty-ring"><span>Π</span></div>
        <div class="empty-title">AWAITING DIRECTIVE</div>
        <div class="empty-sub">Transmit below · <kbd>Ctrl</kbd>+<kbd>K</kbd> for command uplink</div>
      </div>`);
      dom.transcript.append(dom.emptyState);
      return;
    }
    dom.emptyState = null;
    for (const item of allItems()) {
      appendItem(item);
    }
    scrollToBottom(true);
  }

  function appendItem(item) {
    if (item._el) return;
    const element = renderEntry(item);
    if (!element) return;
    item._el = element;
    dom.transcript.append(element);
    scrollIfStick();
  }

  function updateItem(item) {
    const fresh = renderEntry(item);
    const previous = item._el;
    if (!fresh) {
      if (previous) previous.remove();
      item._el = null;
      return;
    }
    if (previous && previous.isConnected) {
      previous.replaceWith(fresh);
    } else {
      dom.transcript.append(fresh);
    }
    item._el = fresh;
    scrollIfStick();
  }

  function queueItemUpdate(item) {
    if (item._queued) return;
    item._queued = true;
    requestAnimationFrame(() => {
      item._queued = false;
      if (allItems().includes(item)) updateItem(item);
    });
  }

  function renderEntry(item) {
    if (!item) return null;
    if (item.kind === "compaction" || item.kind === "branch_summary") {
      return renderDivider(item);
    }
    if (item.kind === "custom") {
      return renderCustomEntry(item);
    }
    if (item.kind === "message") {
      return renderMessageEntry(item);
    }
    return null;
  }

  function renderDivider(item) {
    const title = item.kind === "compaction" ? "CONTEXT COMPACTED" : "BRANCH SUMMARY";
    const summary = truncate(item.summary || "", 160);
    return elFromHtml(`<div class="entry divider" title="${escapeAttr(item.summary || "")}">
      <span class="divider-icon">⟁</span>
      <span>${title}</span>
      <span class="divider-summary">${escapeHtml(summary)}</span>
    </div>`);
  }

  function renderCustomEntry(item) {
    const text = textFromContent(item.content);
    return elFromHtml(`<div class="entry state-note" title="${escapeAttr(item.customType || "custom")}">
      ${escapeHtml(item.customType || "custom")} · ${escapeHtml(truncate(text, 220))}
    </div>`);
  }

  function renderMessageEntry(item) {
    const message = item.message;
    if (!message) return null;

    const role = message.role;
    if (role === "system") return null;
    if (role === "toolResult" && state.toolCallIds.has(message.toolCallId)) return null;
    if (role === "toolResult") return renderStandaloneToolResult(item);

    if (role === "branchSummary" || role === "compactionSummary") {
      return renderDivider({
        kind: role === "branchSummary" ? "branch_summary" : "compaction",
        summary: message.summary,
      });
    }

    if (role === "bashExecution") return renderBashExecution(item);

    const isUser = role === "user";
    const isAssistant = role === "assistant";
    const isError = isAssistant && (message.stopReason === "error");
    const glyph = isUser ? "▸" : isAssistant ? "Π" : role === "custom" ? "✶" : "·";
    const label = isUser
      ? "OPERATOR"
      : isAssistant
        ? "PI // ASSISTANT"
        : role === "custom"
          ? `SYSTEM // ${message.customType || "CUSTOM"}`
          : String(role).toUpperCase();

    let content = "";
    if (isAssistant) {
      content = renderAssistantContent(message, item._key, Boolean(item._streaming));
    } else if (role === "custom") {
      content = `<div class="md">${renderMarkdown(textFromContent(message.content))}</div>`;
    } else {
      const blocks = contentBlocks(message);
      content = blocks
        .map((block) => {
          if (block.type === "image") {
            return `<img src="data:${escapeAttr(block.mimeType || "image/png")};base64,${block.data}" alt="image" />`;
          }
          return `<div class="md">${renderMarkdown(block.text || "")}</div>`;
        })
        .join("");
    }

    if (isError && message.errorMessage) {
      content += `<div class="md"><p style="color:var(--red)">${escapeHtml(message.errorMessage)}</p></div>`;
    }

    const time = message.timestamp ? formatClock(message.timestamp) : "";
    const modelTag = isAssistant && message.model ? `<span class="msg-tag">${escapeHtml(message.model)}</span>` : "";
    const liveTag = item._streaming ? '<span class="msg-tag live">LIVE</span>' : "";
    const animate = !item._el && !item._streaming;
    const classes = `entry msg ${isUser ? "user" : isAssistant ? "assistant" : ""}${isError ? " error" : ""}${animate ? "" : " no-anim"}`;

    return elFromHtml(`<div class="${classes}" data-key="${escapeAttr(item._key || "")}">
      <div class="msg-head">
        <span class="msg-glyph">${glyph}</span>
        <span>${escapeHtml(label)}</span>
        ${modelTag}
        ${liveTag}
        <span class="msg-time">${escapeHtml(time)}</span>
      </div>
      <div class="msg-body">${content}</div>
    </div>`);
  }

  function renderAssistantContent(message, key, streaming) {
    const blocks = contentBlocks(message);
    const parts = [];
    blocks.forEach((block, index) => {
      if (!block || typeof block !== "object") return;
      if (block.type === "text") {
        const text = block.text || "";
        if (!text) return;
        const cursor = streaming && index === lastContentIndex(blocks, "text") ? '<span class="cursor"></span>' : "";
        parts.push(`<div class="md">${renderMarkdown(text)}${cursor}</div>`);
      } else if (block.type === "thinking") {
        parts.push(renderThinkingBlock(block, `${key}:${index}`, streaming));
      } else if (block.type === "toolCall") {
        parts.push(renderToolCall(block));
      } else if (block.type === "image") {
        parts.push(`<img src="data:${escapeAttr(block.mimeType || "image/png")};base64,${block.data}" alt="image" />`);
      }
    });
    if (parts.length === 0 && streaming) {
      parts.push('<div class="md"><span class="cursor"></span></div>');
    }
    return parts.join("");
  }

  function lastContentIndex(blocks, type) {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      if (blocks[index] && blocks[index].type === type) return index;
    }
    return -1;
  }

  function renderThinkingBlock(block, key, streaming) {
    const open = state.openThinking.has(key);
    const text = block.thinking || "";
    const stateLabel = streaming ? "STREAMING" : open ? "COLLAPSE" : "EXPAND";
    return `<div class="thinking${open ? " open" : ""}" data-key="${escapeAttr(key)}">
      <button type="button" class="thinking-head">
        <span class="thinking-glyph">◈</span>
        <span>THOUGHT PROCESS</span>
        <span class="thinking-state">${stateLabel}</span>
      </button>
      <div class="thinking-body">${escapeHtml(text)}${streaming ? '<span class="cursor"></span>' : ""}</div>
    </div>`;
  }

  function toolStatus(toolCall) {
    const id = toolCall.id;
    if (!id) return "pending";
    const result = state.toolResults.get(id);
    if (result) return result.isError ? "error" : "ok";
    const exec = state.toolExec.get(id);
    if (exec) {
      if (exec.status === "running") return "running";
      if (exec.status === "error") return "error";
      if (exec.status === "ok") return "ok";
    }
    return "pending";
  }

  function toolDuration(toolCall) {
    const id = toolCall.id;
    const result = state.toolResults.get(id);
    if (result && typeof result.durationMs === "number") return result.durationMs;
    const exec = state.toolExec.get(id);
    if (!exec) return null;
    if (exec.status === "running") return Date.now() - exec.startedAt;
    return exec.durationMs ?? null;
  }

  function renderToolCall(toolCall) {
    const id = toolCall.id || "";
    const name = toolCall.name || "tool";
    const status = toolStatus(toolCall);
    const result = id ? state.toolResults.get(id) : undefined;
    const exec = id ? state.toolExec.get(id) : undefined;
    const duration = toolDuration(toolCall);
    const open = id ? state.openTools.has(id) : false;
    const args = toolCall.arguments && Object.keys(toolCall.arguments).length > 0
      ? toolCall.arguments
      : exec?.args || {};
    const summary = summarizeArgs(args);
    const resultText = result ? toolResultText(result) : exec?.result ? toolResultText(exec.result) : "";
    const diff = result ? findDiff(result) : null;
    const statusLabel = status === "running" ? "RUNNING" : status === "ok" ? "COMPLETE" : status === "error" ? "FAILED" : "PENDING";

    const inputSection = `<div class="tool-section"><label>INPUT</label><pre>${escapeHtml(prettyJson(args, 16_000))}</pre></div>`;
    const outputSection = resultText
      ? `<div class="tool-section"><label>OUTPUT</label><pre class="${diff ? "diff" : ""}">${diff ? renderDiff(diff) : escapeHtml(truncateOutput(resultText))}</pre></div>`
      : status === "running"
        ? '<div class="tool-section"><label>OUTPUT</label><pre>streaming…</pre></div>'
        : "";

    return `<div class="tool-card${open ? " open" : ""}" data-tool-id="${escapeAttr(id)}" data-status="${status}">
      <button type="button" class="tool-head">
        <span class="tool-glyph">⚙</span>
        <span class="tool-name">${escapeHtml(name)}</span>
        <span class="tool-status">${statusLabel}</span>
        <span class="tool-time">${escapeHtml(formatDuration(duration))}</span>
        <span class="tool-chevron">▾</span>
      </button>
      ${summary ? `<div class="tool-summary">${escapeHtml(summary)}</div>` : ""}
      <div class="tool-detail">${inputSection}${outputSection}</div>
    </div>`;
  }

  function truncateOutput(text, limit = 40_000) {
    const value = String(text || "");
    return value.length > limit ? `${value.slice(0, limit)}\n…[output truncated]` : value;
  }

  function renderStandaloneToolResult(item) {
    const message = item.message;
    const text = toolResultText(message);
    return elFromHtml(`<div class="entry tool-card open" data-status="${message.isError ? "error" : "ok"}">
      <div class="tool-head">
        <span class="tool-glyph">⚙</span>
        <span class="tool-name">${escapeHtml(message.toolName || "tool")}</span>
        <span class="tool-status">RESULT</span>
        <span class="tool-time">${escapeHtml(formatDuration(message.durationMs))}</span>
      </div>
      <div class="tool-detail">
        <div class="tool-section"><label>OUTPUT</label><pre>${escapeHtml(truncateOutput(text))}</pre></div>
      </div>
    </div>`);
  }

  function renderBashExecution(item) {
    const message = item.message;
    return elFromHtml(`<div class="entry tool-card open" data-status="${message.exitCode === 0 ? "ok" : "error"}">
      <div class="tool-head">
        <span class="tool-glyph">$</span>
        <span class="tool-name">${escapeHtml(message.command || "shell")}</span>
        <span class="tool-status">${message.cancelled ? "CANCELLED" : `EXIT ${message.exitCode ?? "?"}`}</span>
      </div>
      <div class="tool-detail"><div class="tool-section"><label>OUTPUT</label><pre>${escapeHtml(truncateOutput(message.output || ""))}</pre></div></div>
    </div>`);
  }

  function scrollIfStick() {
    if (state.stick) scrollToBottom(false);
  }

  function scrollToBottom(force) {
    if (!force && !state.stick) return;
    state.programmaticScroll = true;
    dom.transcript.scrollTop = dom.transcript.scrollHeight;
    state.stick = true;
    dom.scrollLive.hidden = true;
    requestAnimationFrame(() => {
      state.programmaticScroll = false;
    });
  }

  /* ------------------------------------------------------------
     live event handling
     ------------------------------------------------------------ */

  function handleMessageStart(message) {
    if (!message || message.role === "system") return;
    state.busy = true;
    updateBusyUI();
    if (state.live) commitLive();
    state.liveCounter += 1;
    const item = {
      kind: "message",
      entryId: `live-${state.liveCounter}`,
      message: cloneMessage(message),
      _key: `live-${state.liveCounter}`,
      _streaming: message.role === "assistant",
    };
    state.live = item;
    if (message.role === "assistant") {
      for (const block of contentBlocks(message)) {
        if (block && block.type === "toolCall" && block.id) state.toolCallIds.add(block.id);
      }
    }
    if (message.role === "toolResult" && message.toolCallId) {
      state.toolResults.set(message.toolCallId, message);
    }
    setStatusUI(
      message.role === "assistant" ? "streaming" : message.role === "user" ? "thinking" : state.status,
      message.role === "assistant" ? "Model response streaming" : "Directive received",
    );
    appendItem(item);
  }

  function handleMessageUpdate(payload) {
    const item = state.live;
    if (!item || item.message.role !== "assistant") return;
    const message = item.message;
    if (!Array.isArray(message.content)) message.content = [];
    const index = Number.isInteger(payload.contentIndex) ? payload.contentIndex : 0;
    const eventType = payload.eventType;

    switch (eventType) {
      case "start":
        message.content = [];
        break;
      case "text_start":
        message.content[index] = { type: "text", text: "" };
        break;
      case "text_delta": {
        const block = ensureBlock(message.content, index, { type: "text", text: "" });
        block.text = (block.text || "") + (payload.delta || "");
        noteOutput(payload.delta || "");
        break;
      }
      case "text_end": {
        const block = ensureBlock(message.content, index, { type: "text", text: "" });
        block.text = payload.content ?? block.text;
        break;
      }
      case "thinking_start":
        message.content[index] = { type: "thinking", thinking: "" };
        break;
      case "thinking_delta": {
        const block = ensureBlock(message.content, index, { type: "thinking", thinking: "" });
        block.thinking = (block.thinking || "") + (payload.delta || "");
        noteOutput(payload.delta || "");
        break;
      }
      case "thinking_end": {
        const block = ensureBlock(message.content, index, { type: "thinking", thinking: "" });
        block.thinking = payload.content ?? block.thinking;
        break;
      }
      case "toolcall_start":
        message.content[index] = { type: "toolCall", id: "", name: "", arguments: {} };
        break;
      case "toolcall_delta": {
        const block = ensureBlock(message.content, index, { type: "toolCall", id: "", name: "", arguments: {} });
        block._argsText = (block._argsText || "") + (payload.delta || "");
        break;
      }
      case "toolcall_end": {
        const call = payload.toolCall;
        if (call) {
          message.content[index] = { ...call };
          if (call.id) state.toolCallIds.add(call.id);
        }
        break;
      }
      case "done":
      case "error":
        if (payload.finalMessage) {
          item.message = cloneMessage(payload.finalMessage);
          item._streaming = false;
        }
        break;
      default:
        break;
    }
    queueItemUpdate(item);
  }

  function ensureBlock(content, index, fallback) {
    if (!content[index] || typeof content[index] !== "object") content[index] = { ...fallback };
    return content[index];
  }

  function handleMessageEnd(message) {
    if (!message || message.role === "system") return;
    const live = state.live;

    if (message.role === "toolResult" && message.toolCallId) {
      state.toolResults.set(message.toolCallId, message);
      // The authoritative result message supersedes the transient execution
      // record; drop the latter so long sessions do not retain duplicates.
      state.toolExec.delete(message.toolCallId);
      const target = findCallItem(message.toolCallId);
      if (target) queueItemUpdate(target);
    }
    if (message.role === "assistant") {
      for (const block of contentBlocks(message)) {
        if (block && block.type === "toolCall" && block.id) state.toolCallIds.add(block.id);
      }
    }

    if (live && live.message && live.message.role === message.role) {
      live.message = cloneMessage(message);
      live._streaming = false;
      updateItem(live);
      commitLive();
    } else {
      state.liveCounter += 1;
      const item = {
        kind: "message",
        entryId: `live-${state.liveCounter}`,
        message: cloneMessage(message),
        _key: `live-${state.liveCounter}`,
      };
      if (message.role === "toolResult" && message.toolCallId && state.toolCallIds.has(message.toolCallId)) {
        const target = findCallItem(message.toolCallId);
        if (target) queueItemUpdate(target);
        return;
      }
      state.history.push(item);
      appendItem(item);
    }

    if (message.role === "assistant") {
      setStatusUI("thinking", "Awaiting next step");
    }
  }

  function commitLive() {
    if (!state.live) return;
    const item = state.live;
    item._streaming = false;
    state.live = null;
    state.history.push(item);
    if (item._el) updateItem(item);
  }

  function noteOutput(text) {
    state.streamChars += text.length;
    state.pulse[state.pulse.length - 1] = Math.min(1, state.pulse[state.pulse.length - 1] + Math.min(0.9, text.length / 12 + 0.12));
  }

  function findCallItem(toolCallId) {
    const items = allItems();
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.kind !== "message" || !item.message || item.message.role !== "assistant") continue;
      const blocks = contentBlocks(item.message);
      if (blocks.some((block) => block && block.type === "toolCall" && block.id === toolCallId)) return item;
    }
    return null;
  }

  function handleToolStart(payload) {
    const id = payload.toolCallId;
    state.toolExec.set(id, {
      status: "running",
      startedAt: payload.startedAt || Date.now(),
      args: payload.args,
      result: null,
      durationMs: null,
    });
    const existing = state.activity.findIndex((item) => item.id === id);
    const activity = {
      id,
      name: payload.toolName,
      status: "running",
      startedAt: payload.startedAt || Date.now(),
      durationMs: null,
      summary: summarizeArgs(payload.args),
    };
    if (existing >= 0) state.activity[existing] = activity;
    else state.activity = [activity, ...state.activity].slice(0, 14);
    applyActivity();
    setStatusUI("tool", `${payload.toolName} executing`);
    const target = findCallItem(id);
    if (target) queueItemUpdate(target);
  }

  function handleToolUpdate(payload) {
    const entry = state.toolExec.get(payload.toolCallId);
    if (entry) entry.partialResult = payload.partialResult;
  }

  function handleToolEnd(payload) {
    const entry = state.toolExec.get(payload.toolCallId) || { startedAt: Date.now() };
    entry.status = payload.isError ? "error" : "ok";
    entry.durationMs = payload.durationMs ?? (Date.now() - entry.startedAt);
    entry.result = payload.result;
    state.toolExec.set(payload.toolCallId, entry);
    state.activity = state.activity.map((item) =>
      item.id === payload.toolCallId
        ? { ...item, status: payload.isError ? "error" : "ok", durationMs: entry.durationMs }
        : item,
    );
    applyActivity();
    const running = Array.from(state.toolExec.values()).filter((tool) => tool.status === "running").length;
    setStatusUI(running > 0 ? "tool" : "streaming", running > 0 ? `${running} tool(s) executing` : "Tool finished");
    const target = findCallItem(payload.toolCallId);
    if (target) queueItemUpdate(target);
  }

  /* ------------------------------------------------------------
     controls
     ------------------------------------------------------------ */

  async function sendPrompt() {
    const text = dom.input.value.trim();
    if (!text) return;
    dom.sendBtn.disabled = true;
    try {
      const result = await api("/api/prompt", { message: text, mode: state.mode });
      dom.input.value = "";
      autoGrow();
      rememberPrompt(text);
      if (result && result.disposition === "queued-steer") toast("Directive queued as steering message", "success");
      else if (result && result.disposition === "queued-followup") toast("Directive queued as follow-up", "success");
      else if (result && result.disposition === "handled") toast("Command handled", "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      dom.sendBtn.disabled = false;
      dom.input.focus();
    }
  }

  async function abortRun() {
    try {
      await api("/api/abort", {});
      toast("Abort requested", "warning");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function setModel(provider, id, name) {
    try {
      await api("/api/model", { provider, id });
      toast(`Model core switched → ${name || id}`, "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function setThinking(level) {
    try {
      await api("/api/thinking", { level });
      toast(`Thinking level → ${level.toUpperCase()}`, "info");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function toggleTool(name) {
    if (!state.snapshot) return;
    const tools = state.snapshot.tools || [];
    const active = new Set(tools.filter((tool) => tool.active).map((tool) => tool.name));
    if (active.has(name)) active.delete(name);
    else active.add(name);
    try {
      await api("/api/tools", { tools: Array.from(active) });
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function compactContext() {
    try {
      await api("/api/compact", {});
      toast("Compaction requested", "info");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function renameSession() {
    const current = state.snapshot?.session?.name || "";
    const value = await openModal({
      title: "RENAME SESSION",
      body: "Set a callsign for this mission. Leave empty to clear it.",
      input: true,
      value: current,
      placeholder: "e.g. ORBITAL-7",
      confirmLabel: "SET CALLSIGN",
    });
    if (value === null) return;
    try {
      await api("/api/session/rename", { name: value });
      toast(value ? `Session renamed → ${value}` : "Session name cleared", "success");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function newSession() {
    const confirmed = await openModal({
      title: "NEW SESSION",
      body: "Start a fresh session? The current transcript remains in its session file and can be resumed later.",
      confirmLabel: "INITIALIZE",
      kicker: "MISSION CONTROL",
    });
    if (!confirmed) return;
    try {
      await api("/api/session/new", {});
      toast("New session requested", "info");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function copyLastResponse() {
    const items = allItems();
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const message = items[index].message;
      if (!message || message.role !== "assistant") continue;
      const text = contentBlocks(message)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (text) {
        await copyText(text, "Last response copied");
        return;
      }
    }
    toast("No assistant response to copy", "warning");
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message || "Copied", "success", 2200);
    } catch {
      toast("Clipboard unavailable", "error");
    }
  }

  /* ------------------------------------------------------------
     palette
     ------------------------------------------------------------ */

  function buildPaletteItems(scope) {
    const snapshot = state.snapshot || {};
    const items = [];

    if (scope !== "models") {
      if (state.busy) {
        items.push({ group: "ACTIONS", icon: "■", label: "Abort current run", hint: "ESC", run: () => abortRun() });
      }
      items.push({ group: "ACTIONS", icon: "⌁", label: "Compact context", hint: "/compact", run: () => compactContext(), disabled: state.capabilities.compact === false });
      items.push({ group: "ACTIONS", icon: "＋", label: "Start new session", hint: state.capabilities.newSession === false ? "terminal only" : "new", run: () => newSession(), disabled: state.capabilities.newSession === false });
      items.push({ group: "ACTIONS", icon: "✎", label: "Rename session", hint: "callsign", run: () => renameSession() });
      items.push({ group: "ACTIONS", icon: "⧉", label: "Copy last response", hint: "clipboard", run: () => copyLastResponse() });
      items.push({ group: "ACTIONS", icon: "◐", label: `Switch to ${currentTheme() === "light" ? "dark" : "light"} mode`, hint: currentTheme().toUpperCase(), run: () => toggleTheme() });
      items.push({ group: "ACTIONS", icon: "↻", label: "Reconnect event stream", hint: "uplink", run: () => connect() });
    }

    const currentModel = snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : "";
    for (const model of snapshot.models || []) {
      const key = `${model.provider}/${model.id}`;
      const current = key === currentModel;
      items.push({
        group: "MODEL CORES",
        icon: current ? "◉" : "◈",
        label: `${current ? "● " : ""}${model.name || model.id}`,
        hint: `${key}${current ? " · CURRENT" : ""}`,
        run: () => setModel(model.provider, model.id, model.name),
      });
    }

    if (scope !== "models") {
      const terminalOnlyCommands = new Set(["web", "webman", "web-session", "cockpit"]);
      for (const command of snapshot.commands || []) {
        if (terminalOnlyCommands.has(command.name)) continue;
        items.push({
          group: "COMMANDS",
          icon: "/",
          label: `/${command.name}`,
          hint: command.description || command.source,
          run: () => insertCommand(command.name),
        });
      }
      for (const tool of snapshot.tools || []) {
        items.push({
          group: "TOOL LOADOUT",
          icon: "⚙",
          label: `${tool.active ? "Disable" : "Enable"} ${tool.name}`,
          hint: tool.exposure,
          run: () => toggleTool(tool.name),
        });
      }
    }

    return items;
  }

  function scoreMatch(item, query) {
    if (!query) return 1;
    const haystack = `${item.label} ${item.hint || ""} ${item.group}`.toLowerCase();
    const needle = query.toLowerCase().trim();
    if (!needle) return 1;
    if (haystack.includes(needle)) return 100 - haystack.indexOf(needle);
    let position = 0;
    for (const char of needle) {
      position = haystack.indexOf(char, position);
      if (position === -1) return -1;
      position += 1;
    }
    return 10;
  }

  function openPalette(scope = "all", query = "") {
    state.palette.open = true;
    state.palette.scope = scope;
    state.palette.items = buildPaletteItems(scope);
    state.palette.index = 0;
    dom.palette.hidden = false;
    dom.paletteInput.value = query;
    dom.paletteInput.placeholder = scope === "models" ? "Search model cores…" : "Search commands, models, actions…";
    filterPalette();
    requestAnimationFrame(() => dom.paletteInput.focus());
  }

  function closePalette() {
    state.palette.open = false;
    dom.palette.hidden = true;
    dom.input.focus();
  }

  function filterPalette() {
    const query = dom.paletteInput.value;
    const scored = state.palette.items
      .map((item) => ({ item, score: scoreMatch(item, query) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => (a.item.group === b.item.group ? b.score - a.score : a.item.group.localeCompare(b.item.group)))
      .map((entry) => entry.item);
    state.palette.filtered = scored;
    state.palette.index = Math.min(state.palette.index, Math.max(0, scored.length - 1));
    renderPalette();
  }

  function renderPalette() {
    const items = state.palette.filtered;
    if (items.length === 0) {
      dom.paletteList.innerHTML = '<div class="palette-empty">No matching uplink targets</div>';
      return;
    }
    let group = "";
    const html = items
      .map((item, index) => {
        const header = item.group !== group ? `<div class="palette-group">${escapeHtml(item.group)}</div>` : "";
        group = item.group;
        return `${header}<button type="button" class="palette-item${index === state.palette.index ? " selected" : ""}${item.disabled ? " is-disabled" : ""}" data-index="${index}" aria-disabled="${item.disabled ? "true" : "false"}">
          <span class="p-icon">${escapeHtml(item.icon || "·")}</span>
          <span>${escapeHtml(item.label)}</span>
          ${item.hint ? `<span class="p-hint">${escapeHtml(item.hint)}</span>` : ""}
        </button>`;
      })
      .join("");
    dom.paletteList.innerHTML = html;
    const selected = dom.paletteList.querySelector(".palette-item.selected");
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }

  function paletteMove(delta) {
    const length = state.palette.filtered.length;
    if (length === 0) return;
    state.palette.index = (state.palette.index + delta + length) % length;
    renderPalette();
  }

  function paletteRun(index = state.palette.index) {
    const item = state.palette.filtered[index];
    if (!item) return;
    if (item.disabled) {
      toast("That action is unavailable right now", "warning", 2200);
      return;
    }
    closePalette();
    item.run();
  }

  function insertCommand(name) {
    dom.input.value = `/${name} `;
    autoGrow();
    dom.input.focus();
    dom.input.setSelectionRange(dom.input.value.length, dom.input.value.length);
  }

  /* ------------------------------------------------------------
     modal
     ------------------------------------------------------------ */

  function openModal(options) {
    return new Promise((resolve) => {
      state.modal = { resolve, input: Boolean(options.input) };
      dom.modalKicker.textContent = options.kicker || "COCKPIT";
      dom.modalTitle.textContent = options.title || "";
      dom.modalBody.textContent = options.body || "";
      dom.modalBody.hidden = !options.body;
      dom.modalOk.textContent = options.confirmLabel || "CONFIRM";
      if (options.input) {
        dom.modalInput.hidden = false;
        dom.modalInput.value = options.value || "";
        dom.modalInput.placeholder = options.placeholder || "";
        requestAnimationFrame(() => {
          dom.modalInput.focus();
          dom.modalInput.select();
        });
      } else {
        dom.modalInput.hidden = true;
        dom.modalInput.value = "";
        requestAnimationFrame(() => dom.modalOk.focus());
      }
      dom.modal.hidden = false;
    });
  }

  function closeModal(result) {
    if (!state.modal) return;
    const { resolve, input } = state.modal;
    state.modal = null;
    dom.modal.hidden = true;
    resolve(input ? result : Boolean(result));
  }

  /* ------------------------------------------------------------
     toast
     ------------------------------------------------------------ */

  function toast(message, level = "info", timeout = 4200) {
    if (!message) return;
    const node = document.createElement("div");
    node.className = "toast";
    node.dataset.level = level;
    node.textContent = message;
    dom.toasts.append(node);
    const remove = () => {
      if (!node.isConnected) return;
      node.classList.add("out");
      setTimeout(() => node.remove(), 240);
    };
    setTimeout(remove, timeout);
    node.addEventListener("click", remove);
  }

  /* ------------------------------------------------------------
     prompt history
     ------------------------------------------------------------ */

  function loadPromptHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem("pi-cockpit-prompts") || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 60) : [];
    } catch {
      return [];
    }
  }

  function rememberPrompt(text) {
    state.promptHistory = [text, ...state.promptHistory.filter((item) => item !== text)].slice(0, 60);
    state.promptIndex = -1;
    try {
      localStorage.setItem("pi-cockpit-prompts", JSON.stringify(state.promptHistory));
    } catch {
      /* storage disabled */
    }
  }

  /* ------------------------------------------------------------
     input
     ------------------------------------------------------------ */

  function autoGrow() {
    dom.input.style.height = "auto";
    dom.input.style.height = `${Math.min(dom.input.scrollHeight, window.innerHeight * 0.34)}px`;
  }

  function handleComposerKey(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendPrompt();
      return;
    }
    if (event.key === "ArrowUp" && dom.input.value === "" && state.promptHistory.length > 0) {
      event.preventDefault();
      state.promptIndex = Math.min(state.promptIndex + 1, state.promptHistory.length - 1);
      dom.input.value = state.promptHistory[state.promptIndex] || "";
      autoGrow();
      return;
    }
    if (event.key === "ArrowDown" && dom.input.value === "") {
      if (state.promptIndex > 0) {
        state.promptIndex -= 1;
        dom.input.value = state.promptHistory[state.promptIndex] || "";
      } else {
        state.promptIndex = -1;
        dom.input.value = "";
      }
      autoGrow();
      return;
    }
    if (event.key === "Escape") {
      if (state.busy) {
        event.preventDefault();
        abortRun();
      } else {
        dom.input.blur();
      }
    }
  }

  /* ------------------------------------------------------------
     boot
     ------------------------------------------------------------ */

  const bootState = { startedAt: performance.now(), minUntil: performance.now() + 900, done: false, timer: null };

  function bootLog(text, ok = false) {
    const line = document.createElement("div");
    if (ok) line.className = "ok";
    line.textContent = `[${formatClock()}] ${text}`;
    dom.bootLog.append(line);
    while (dom.bootLog.children.length > 5) dom.bootLog.firstElementChild.remove();
    dom.bootProgress.style.width = ok ? "100%" : "62%";
  }

  function finishBoot(message) {
    if (bootState.done) return;
    bootState.done = true;
    bootLog(message || "UPLINK ESTABLISHED", true);
    const wait = Math.max(0, bootState.minUntil - performance.now());
    setTimeout(() => {
      resizeCanvases();
      dom.boot.classList.add("done");
      setTimeout(() => {
        dom.boot.hidden = true;
        dom.input.focus();
      }, 500);
    }, wait);
    state.booted = true;
  }

  function scheduleBoot() {
    dom.app.hidden = false;
    bootLog("PI COCKPIT KERNEL v0.1.0");
    setTimeout(() => bootLog("MOUNTING SESSION TELEMETRY"), 260);
    setTimeout(() => bootLog("OPENING EVENT UPLINK"), 540);
    setTimeout(() => {
      if (!state.booted) bootLog("AWAITING HANDSHAKE · RETRYING", false);
    }, 2200);
    // Safety: never trap the user behind the boot screen.
    setTimeout(() => finishBoot("BOOT TIMEOUT · CONTINUING"), 5200);
  }

  /* ------------------------------------------------------------
     canvases
     ------------------------------------------------------------ */

  const bg = { stars: [], w: 0, h: 0, dpr: 1 };
  const pulseCtx = dom.pulseCanvas.getContext("2d");
  const bgCtx = dom.bgCanvas.getContext("2d");

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    bg.dpr = dpr;
    bg.w = window.innerWidth;
    bg.h = window.innerHeight;
    dom.bgCanvas.width = Math.floor(bg.w * dpr);
    dom.bgCanvas.height = Math.floor(bg.h * dpr);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rect = dom.pulseCanvas.getBoundingClientRect();
    const pw = Math.max(120, Math.floor(rect.width));
    const ph = Math.max(48, Math.floor(rect.height));
    dom.pulseCanvas.width = Math.floor(pw * dpr);
    dom.pulseCanvas.height = Math.floor(ph * dpr);
    pulseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(60, Math.round((bg.w * bg.h) / 16_000));
    bg.stars = Array.from({ length: count }, () => ({
      x: Math.random() * bg.w,
      y: Math.random() * bg.h,
      z: Math.random() * 0.8 + 0.2,
      t: Math.random() * Math.PI * 2,
    }));
  }

  let lastFrame = 0;
  function drawFrame(time) {
    requestAnimationFrame(drawFrame);
    if (document.hidden) return;
    const delta = Math.min(64, time - lastFrame);
    lastFrame = time;
    if (!bgCtx || !pulseCtx) return;

    // starfield
    const palette = themePalette();
    bgCtx.clearRect(0, 0, bg.w, bg.h);
    for (const star of bg.stars) {
      star.t += 0.0025;
      star.y += star.z * 0.06;
      if (star.y > bg.h + 2) {
        star.y = -2;
        star.x = Math.random() * bg.w;
      }
      const alpha = 0.14 + Math.sin(star.t) * 0.08 + star.z * 0.14;
      bgCtx.fillStyle = `rgba(${palette.star}, ${Math.max(0.04, alpha)})`;
      bgCtx.fillRect(star.x, star.y, star.z > 0.7 ? 1.6 : 1, star.z > 0.7 ? 1.6 : 1);
    }

    // pulse trace
    const pw = dom.pulseCanvas.clientWidth || 1;
    const ph = dom.pulseCanvas.clientHeight || 1;
    pulseCtx.clearRect(0, 0, pw, ph);

    pulseCtx.strokeStyle = palette.grid;
    pulseCtx.lineWidth = 1;
    for (let y = 0; y < ph; y += 12) {
      pulseCtx.beginPath();
      pulseCtx.moveTo(0, y + 0.5);
      pulseCtx.lineTo(pw, y + 0.5);
      pulseCtx.stroke();
    }

    const decay = Math.pow(0.9, delta / 16);
    for (let index = 0; index < state.pulse.length; index += 1) {
      state.pulse[index] *= decay;
    }

    const gradient = pulseCtx.createLinearGradient(0, 0, pw, 0);
    gradient.addColorStop(0, `rgba(${palette.cyan}, 0.25)`);
    gradient.addColorStop(0.55, `rgba(${palette.violet}, 0.9)`);
    gradient.addColorStop(1, `rgba(${palette.magenta}, 0.9)`);
    pulseCtx.strokeStyle = gradient;
    pulseCtx.lineWidth = 1.6;
    pulseCtx.beginPath();
    const center = ph / 2;
    const amplitude = ph * 0.34;
    for (let index = 0; index < state.pulse.length; index += 1) {
      const x = (index / (state.pulse.length - 1)) * pw;
      const idle = state.busy ? Math.sin(index * 0.21 + time / 480) * 0.08 : Math.sin(index * 0.16 + time / 1700) * 0.04;
      const value = Math.min(1, state.pulse[index] + Math.abs(idle));
      const sign = index % 2 === 0 ? 1 : -1;
      const y = center - sign * value * amplitude;
      if (index === 0) pulseCtx.moveTo(x, y);
      else pulseCtx.lineTo(x, y);
    }
    pulseCtx.stroke();

    // sweep head
    const headX = pw - 1;
    pulseCtx.fillStyle = state.busy ? `rgba(${palette.cyan}, 0.85)` : `rgba(${palette.cyan}, 0.3)`;
    pulseCtx.fillRect(headX - 1, center - 2, 2, 4);
  }

  /* ------------------------------------------------------------
     interval tick
     ------------------------------------------------------------ */

  function tick() {
    dom.clock.textContent = formatClock();

    if (state.snapshot?.server?.startedAt) {
      const uptime = Date.now() - (state.snapshot.server.startedAt || Date.now());
      const seconds = Math.floor(uptime / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      dom.uplinkUptime.textContent = hours > 0
        ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
        : `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }
    if (state.snapshot?.session?.leafId) dom.uplinkLeaf.textContent = shortId(state.snapshot.session.leafId);

    const instantaneous = state.streamChars / 4;
    state.streamChars = 0;
    state.rate = state.rate * 0.55 + instantaneous * 0.45;
    if (!state.busy) state.rate *= 0.75;
    if (state.rate < 0.05) state.rate = 0;
    dom.statRate.textContent = `${state.rate.toFixed(1)} t/s`;

    // live activity durations
    if (state.activity.some((item) => item.status === "running")) applyActivity();

    // tool durations in open cards refresh through normal state events; keep
    // the transcript cheap and only re-render when a live message is streaming.
    if (state.live && state.live._streaming) {
      // no-op: updates arrive from the server stream
    }
  }

  /* ------------------------------------------------------------
     wiring
     ------------------------------------------------------------ */

  function wire() {
    dom.input.addEventListener("input", () => {
      autoGrow();
      state.promptIndex = -1;
    });
    dom.input.addEventListener("keydown", handleComposerKey);
    dom.sendBtn.addEventListener("click", sendPrompt);
    dom.abortBtn.addEventListener("click", abortRun);
    dom.scrollLive.addEventListener("click", () => {
      state.stick = true;
      scrollToBottom(true);
    });

    dom.modeSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      state.mode = button.dataset.mode;
      dom.modeSwitch.querySelectorAll("button").forEach((entry) => entry.classList.toggle("active", entry === button));
    });

    dom.quick.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      if (button.dataset.action === "compact") compactContext();
      else if (button.dataset.action === "new-session") {
        if (state.capabilities.newSession === false) toast("New sessions are available in interactive mode only", "warning");
        else newSession();
      } else if (button.dataset.action === "palette") openPalette();
    });

    dom.renameBtn.addEventListener("click", renameSession);
    dom.themeBtn.addEventListener("click", toggleTheme);
    themeMedia.addEventListener?.("change", (event) => {
      if (storedTheme()) return;
      applyTheme(event.matches ? "light" : "dark", false);
    });
    dom.modelBtn.addEventListener("click", () => openPalette("models"));

    dom.transcript.addEventListener("scroll", () => {
      if (state.programmaticScroll) return;
      const distance = dom.transcript.scrollHeight - dom.transcript.scrollTop - dom.transcript.clientHeight;
      state.stick = distance < 90;
      dom.scrollLive.hidden = state.stick;
    });

    dom.transcript.addEventListener("click", (event) => {
      const thinkingHead = event.target.closest(".thinking-head");
      if (thinkingHead) {
        const box = thinkingHead.closest(".thinking");
        const key = box?.dataset.key;
        if (!key) return;
        if (state.openThinking.has(key)) state.openThinking.delete(key);
        else state.openThinking.add(key);
        box.classList.toggle("open");
        const label = box.querySelector(".thinking-state");
        if (label) label.textContent = box.classList.contains("open") ? "COLLAPSE" : "EXPAND";
        scrollIfStick();
        return;
      }

      const toolHead = event.target.closest(".tool-head");
      if (toolHead) {
        const card = toolHead.closest(".tool-card");
        const id = card?.dataset.toolId;
        if (!id) return;
        if (state.openTools.has(id)) state.openTools.delete(id);
        else state.openTools.add(id);
        card.classList.toggle("open");
        scrollIfStick();
        return;
      }

      const copyButton = event.target.closest(".code-copy");
      if (copyButton) {
        const pre = copyButton.closest(".code-block")?.querySelector("pre");
        if (pre) {
          navigator.clipboard.writeText(pre.innerText).then(() => {
            copyButton.textContent = "COPIED";
            copyButton.classList.add("copy-ok");
            setTimeout(() => {
              copyButton.textContent = "COPY";
              copyButton.classList.remove("copy-ok");
            }, 1400);
          }).catch(() => toast("Clipboard unavailable", "error"));
        }
      }
    });

    dom.palette.addEventListener("click", (event) => {
      if (event.target === dom.palette) closePalette();
      const item = event.target.closest(".palette-item");
      if (item) paletteRun(Number(item.dataset.index));
    });

    dom.paletteInput.addEventListener("input", filterPalette);
    dom.paletteInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        paletteMove(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        paletteMove(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        paletteRun();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
      }
    });

    dom.modalCancel.addEventListener("click", () => closeModal(null));
    dom.modalOk.addEventListener("click", () => {
      if (state.modal?.input) closeModal(dom.modalInput.value);
      else closeModal(true);
    });
    dom.modalInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        closeModal(dom.modalInput.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeModal(null);
      }
    });
    dom.modal.addEventListener("click", (event) => {
      if (event.target === dom.modal) closeModal(null);
    });

    document.addEventListener("keydown", (event) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (state.palette.open) closePalette();
        else openPalette();
        return;
      }
      if (event.key === "Escape") {
        if (state.modal) {
          closeModal(null);
          return;
        }
        if (state.palette.open) {
          closePalette();
          return;
        }
        if (document.activeElement === document.body && state.busy) abortRun();
      }
    });

    window.addEventListener("resize", resizeCanvases);
    window.addEventListener("beforeunload", () => {
      if (state.es) state.es.close();
    });
  }

  /* ------------------------------------------------------------
     boot
     ------------------------------------------------------------ */

  function cloneMessage(message) {
    try {
      return structuredClone(message);
    } catch {
      try {
        return JSON.parse(JSON.stringify(message));
      } catch {
        return message;
      }
    }
  }

  applyTheme(currentTheme(), false);
  wire();
  resizeCanvases();
  scheduleBoot();
  requestAnimationFrame(drawFrame);
  setInterval(tick, 1000);
  renderContextBars(0);
  connect();
})();
