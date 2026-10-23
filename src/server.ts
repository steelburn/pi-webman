import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { UI_ASSETS, UI_VERSION } from "./assets.ts";
import type { EventHub } from "./hub.ts";
import { safeStringify } from "./serialize.ts";
import type { CockpitSnapshot } from "./state.ts";

export type PromptMode = "auto" | "steer" | "followup";

export interface CockpitBackend {
  snapshot(): CockpitSnapshot;
  prompt(message: string, mode: PromptMode): Promise<{ disposition: string; busy: boolean }>;
  abort(): void;
  setModel(provider: string, id: string): Promise<boolean>;
  setThinking(level: string): void;
  setTools(names: string[]): void;
  compact(instructions?: string): void;
  rename(name: string): void;
  newSession(): void;
  /** Answer or dismiss a popup published through the extension popup bridge. */
  answerPopup(payload: { id?: unknown; value?: unknown; cancelled?: unknown }): { ok: boolean; error?: string };
  isBusy(): boolean;
}

export interface ServerOptions {
  token: string | undefined;
  version: string;
  host: string;
}

const MAX_BODY = 2 * 1024 * 1024;
const MAX_PROMPT = 200_000;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export function createRequestHandler(
  backend: CockpitBackend,
  hub: EventHub,
  options: ServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const expectedToken = options.token;

  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (!authorized(req, url, expectedToken)) {
      respondJson(res, 401, { error: "Pi Cockpit auth required. Open the URL printed in the Pi session." });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const asset = UI_ASSETS["index.html"];
      if (!asset) {
        respondText(res, 500, "UI assets missing. Run `node scripts/build-ui.mjs`.");
        return;
      }
      const headers: Record<string, string> = { ...SECURITY_HEADERS, "Cache-Control": "no-store" };
      const queryToken = url.searchParams.get("token");
      if (expectedToken && queryToken === expectedToken) {
        headers["Set-Cookie"] = `pi_cockpit_token=${encodeURIComponent(expectedToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`;
      }
      respondAsset(res, asset, headers);
      return;
    }

    if (req.method === "GET" && assetFor(url.pathname)) {
      const asset = assetFor(url.pathname);
      if (asset) respondAsset(res, asset, { ...SECURITY_HEADERS, "Cache-Control": "no-store" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      if (!sameOrigin(req)) {
        respondJson(res, 403, { error: "Cross-origin request rejected" });
        return;
      }
      hub.subscribe(req, res, () => backend.snapshot());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      try {
        respondJson(res, 200, backend.snapshot());
      } catch (error) {
        respondJson(res, 503, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      respondJson(res, 200, {
        ok: true,
        name: "pi-webman",
        version: options.version,
        ui: UI_VERSION,
        clients: hub.subscriberCount,
        cwd: process.cwd(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      if (!sameOrigin(req)) {
        respondJson(res, 403, { error: "Cross-origin request rejected" });
        return;
      }
      void handlePost(req, res, url.pathname, backend).catch((error: unknown) => {
        respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }

    respondJson(res, 404, { error: "Not found" });
  };
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  backend: CockpitBackend,
): Promise<void> {
  const body = await readJson(req);

  switch (pathname) {
    case "/api/prompt": {
      const message = body.message;
      const mode = body.mode;
      if (typeof message !== "string" || message.trim() === "") {
        respondJson(res, 400, { error: "message is required" });
        return;
      }
      if (message.length > MAX_PROMPT) {
        respondJson(res, 413, { error: `message exceeds ${MAX_PROMPT} characters` });
        return;
      }
      if (mode !== undefined && mode !== "auto" && mode !== "steer" && mode !== "followup") {
        respondJson(res, 400, { error: "mode must be auto, steer or followup" });
        return;
      }
      const result = await backend.prompt(message, (mode as PromptMode | undefined) ?? "auto");
      respondJson(res, 200, { ok: true, ...result });
      return;
    }

    case "/api/abort": {
      backend.abort();
      respondJson(res, 200, { ok: true });
      return;
    }

    case "/api/model": {
      const provider = body.provider;
      const id = body.id;
      if (typeof provider !== "string" || typeof id !== "string") {
        respondJson(res, 400, { error: "provider and id are required" });
        return;
      }
      const ok = await backend.setModel(provider, id);
      respondJson(res, ok ? 200 : 400, ok ? { ok: true } : { error: `Model not available: ${provider}/${id}` });
      return;
    }

    case "/api/thinking": {
      const level = body.level;
      if (typeof level !== "string") {
        respondJson(res, 400, { error: "level is required" });
        return;
      }
      backend.setThinking(level);
      respondJson(res, 200, { ok: true });
      return;
    }

    case "/api/tools": {
      const tools = body.tools;
      if (!Array.isArray(tools) || !tools.every((tool) => typeof tool === "string")) {
        respondJson(res, 400, { error: "tools must be an array of names" });
        return;
      }
      backend.setTools(tools as string[]);
      respondJson(res, 200, { ok: true });
      return;
    }

    case "/api/compact": {
      if (backend.isBusy()) {
        respondJson(res, 409, { error: "Cannot compact while Pi is running. Abort first." });
        return;
      }
      const instructions = typeof body.instructions === "string" ? body.instructions : undefined;
      backend.compact(instructions);
      respondJson(res, 202, { ok: true });
      return;
    }

    case "/api/session/rename": {
      const name = body.name;
      if (typeof name !== "string") {
        respondJson(res, 400, { error: "name is required" });
        return;
      }
      backend.rename(name.trim());
      respondJson(res, 200, { ok: true });
      return;
    }

    case "/api/session/new": {
      try {
        backend.newSession();
      } catch (error) {
        respondJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      respondJson(res, 202, { ok: true });
      return;
    }

    case "/api/ui/answer": {
      const result = backend.answerPopup(body);
      if (!result.ok) {
        respondJson(res, 404, { error: result.error || "Unknown popup" });
        return;
      }
      respondJson(res, 200, { ok: true });
      return;
    }

    default:
      respondJson(res, 404, { error: "Not found" });
  }
}

function assetFor(pathname: string): { type: string; body: string } | undefined {
  if (pathname === "/app.css") return UI_ASSETS["app.css"];
  if (pathname === "/app.js") return UI_ASSETS["app.js"];
  if (pathname === "/favicon.svg") return UI_ASSETS["favicon.svg"];
  return undefined;
}

function authorized(req: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;
  const query = url.searchParams.get("token");
  if (query === token) return true;
  const header = req.headers["x-pi-token"];
  if (typeof header === "string" && header === token) return true;
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "pi_cockpit_token" && decodeURIComponent(rest.join("=")) === token) return true;
  }
  return false;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function respondAsset(
  res: ServerResponse,
  asset: { type: string; body: string },
  headers: Record<string, string>,
): void {
  const body = Buffer.from(asset.body, "utf8");
  res.writeHead(200, {
    ...headers,
    "Content-Type": asset.type,
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function respondJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(safeStringify(payload), "utf8");
  if (res.headersSent) {
    try {
      res.end(body);
    } catch {
      /* already closed */
    }
    return;
  }
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function respondText(res: ServerResponse, status: number, text: string): void {
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

/** Stable short hash used for asset cache-busting headers and diagnostics. */
export function hashAssets(): string {
  const hash = createHash("sha256");
  for (const [name, asset] of Object.entries(UI_ASSETS)) {
    hash.update(name);
    hash.update(asset.body);
  }
  return hash.digest("hex").slice(0, 10);
}
