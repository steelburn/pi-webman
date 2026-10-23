/**
 * Popup bridge demo — the pattern for showing an extension popup in the Pi
 * Cockpit alongside the terminal.
 *
 * Pi's extension API cannot mirror arbitrary TUI components into a browser, so
 * the cockpit exposes a small event-bus contract instead: publish a popup
 * description, get the answer back. Here the same popup is offered in *both*
 * places and the first answer wins, so an extension keeps working with or
 * without the cockpit running.
 *
 * Run it from a checkout:
 *
 *   pi -e ./examples/popup-bridge-demo.ts --web
 *   /hud-demo        select popup
 *   /hud-notice      notice popup
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface PopupAnswer {
  id?: string;
  value?: string;
  cancelled?: boolean;
}

interface PopupOption {
  value: string;
  label: string;
  description?: string;
}

interface PopupSpec {
  id: string;
  kind: "select" | "confirm" | "input" | "notice";
  title: string;
  message?: string;
  options?: PopupOption[];
  placeholder?: string;
  allowCancel?: boolean;
  source?: string;
}

const OPEN = "webman:popup:open";
const CLOSE = "webman:popup:close";
const ANSWER = "webman:popup:answer";
const PING = "webman:popup:ping";
const PONG = "webman:popup:pong";

const CONTAINERS: PopupOption[] = [
  { value: "api", label: "api-7f9c", description: "up 3 hours · 412 MB · :8080" },
  { value: "worker", label: "worker-2b41", description: "up 3 hours · 189 MB" },
  { value: "db", label: "postgres-1a2b", description: "up 3 hours · 96 MB · :5432" },
];

export default function popupBridgeDemo(pi: ExtensionAPI) {
  const pending = new Map<string, (answer: PopupAnswer) => void>();

  pi.events.on(ANSWER, (raw) => {
    const answer = (raw ?? {}) as PopupAnswer;
    if (!answer.id) return;
    const resolve = pending.get(answer.id);
    if (!resolve) return;
    pending.delete(answer.id);
    resolve(answer);
  });

  /** Is a cockpit browser actually connected right now? */
  function cockpitListening(timeoutMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
      const id = `ping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let settled = false;
      const off = pi.events.on(PONG, (raw) => {
        const pong = (raw ?? {}) as { id?: string };
        if (pong.id !== id || settled) return;
        settled = true;
        off();
        resolve(true);
      });
      try {
        pi.events.emit(PING, { id });
      } catch {
        /* no bus */
      }
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
    });
  }

  /** Ask in the cockpit; resolves undefined if the browser is not listening. */
  function askWeb(spec: PopupSpec, timeoutMs = 120_000): Promise<PopupAnswer | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (answer: PopupAnswer | undefined) => {
        if (settled) return;
        settled = true;
        pending.delete(spec.id);
        resolve(answer);
      };
      pending.set(spec.id, finish);
      pi.events.emit(OPEN, spec);
      const timer = setTimeout(() => {
        finish(undefined);
        try {
          pi.events.emit(CLOSE, { id: spec.id });
        } catch {
          /* extension unloaded */
        }
      }, timeoutMs);
      timer.unref?.();
    });
  }

  /** Popup in the terminal, mirroring the same description. */
  async function askTerminal(spec: PopupSpec, ctx: ExtensionCommandContext): Promise<PopupAnswer | undefined> {
    if (!ctx.hasUI) return undefined;
    if (spec.kind === "select") {
      const labels = (spec.options ?? []).map((option) => (option.description ? `${option.label} — ${option.description}` : option.label));
      const picked = await ctx.ui.select(spec.title, labels);
      if (picked === undefined) return { id: spec.id, cancelled: true };
      const index = labels.indexOf(picked);
      const option = spec.options?.[index];
      return { id: spec.id, value: option ? option.value : picked };
    }
    if (spec.kind === "confirm") return { id: spec.id, value: (await ctx.ui.confirm(spec.title, spec.message ?? "")) ? "yes" : "no" };
    if (spec.kind === "input") {
      const value = await ctx.ui.input(spec.title, spec.placeholder ?? "");
      return value === undefined ? { id: spec.id, cancelled: true } : { id: spec.id, value };
    }
    ctx.ui.notify(`${spec.title}${spec.message ? ` — ${spec.message}` : ""}`, "info");
    return { id: spec.id, value: "ok" };
  }

  /** Cockpit first when a browser is connected, terminal otherwise. */
  async function ask(spec: PopupSpec, ctx: ExtensionCommandContext): Promise<PopupAnswer | undefined> {
    const wantsWeb = await cockpitListening();
    if (wantsWeb) {
      const answer = await askWeb(spec);
      try {
        pi.events.emit(CLOSE, { id: spec.id });
      } catch {
        /* extension unloaded */
      }
      if (answer) return answer;
    }
    return askTerminal(spec, ctx);
  }

  pi.registerCommand("hud-demo", {
    description: "Popup bridge demo: pick a container (shown in the cockpit and the terminal)",
    handler: async (_args, ctx) => {
      const nudge = ctx.mode === "tui" && ctx.hasUI ? "" : " (no terminal UI here)";
      const answer = await ask(
        {
          id: `hud-${Date.now()}`,
          kind: "select",
          title: "DOCKER HUD",
          message: "3 containers running · choose one to inspect" + nudge,
          options: CONTAINERS,
          source: "popup-bridge-demo",
        },
        ctx,
      );
      if (!answer || answer.cancelled) {
        ctx.ui.notify("Docker HUD dismissed", "info");
        return;
      }
      const container = CONTAINERS.find((option) => option.value === answer.value);
      ctx.ui.notify(`Selected ${container?.label ?? answer.value}`, "info");
    },
  });

  pi.registerCommand("hud-notice", {
    description: "Popup bridge demo: a notice rendered in the cockpit",
    handler: async (_args, ctx) => {
      await ask(
        {
          id: `hud-notice-${Date.now()}`,
          kind: "notice",
          title: "DOCKER HUD",
          message: "All 3 containers healthy · 0 restarts in the last hour.",
          source: "popup-bridge-demo",
        },
        ctx,
      );
    },
  });

  // An extension that has not adopted the bridge: the cockpit still mirrors
  // "a terminal prompt is open" so the browser never looks frozen.
  pi.registerCommand("hud-terminal", {
    description: "Popup bridge counter-example: a terminal-only dialog",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("No terminal UI in this mode", "warning");
        return;
      }
      const picked = await ctx.ui.select("DOCKER HUD (terminal only)", CONTAINERS.map((option) => option.label));
      ctx.ui.notify(picked ? `Terminal picked ${picked}` : "Terminal dialog cancelled", "info");
    },
  });
}
