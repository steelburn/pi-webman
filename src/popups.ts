/**
 * Popup bridge.
 *
 * Pi's extension UI (`ctx.ui.select/confirm/input/custom`) renders into the
 * terminal, and the extension API only tells other extensions *that* a prompt is
 * open (`ui_prompt_start`), never what it contains or how to answer it.
 *
 * So the cockpit offers both halves:
 *
 *  1. `ui_prompt_*` is mirrored to the browser as "a terminal prompt is open"
 *     — works for every extension, no cooperation needed.
 *  2. This bridge lets an extension render its popup natively in the cockpit and
 *     receive the answer, through the shared `pi.events` bus:
 *
 *       pi.events.emit("webman:popup:open", spec)
 *       pi.events.on("webman:popup:answer", (answer) => { ... })
 *       pi.events.emit("webman:popup:close", { id })
 *
 * See `examples/popup-extension.ts` for a working extension.
 */

export interface PopupOption {
  value: string;
  label: string;
  description?: string;
}

export type PopupKind = "select" | "confirm" | "input" | "notice";

export interface PopupSpec {
  id: string;
  kind: PopupKind;
  title: string;
  message?: string;
  options?: PopupOption[];
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  allowCancel?: boolean;
  source?: string;
  createdAt: number;
}

export interface PopupAnswer {
  id: string;
  value?: string;
  cancelled?: boolean;
}

export const POPUP_OPEN_CHANNEL = "webman:popup:open";
export const POPUP_PING_CHANNEL = "webman:popup:ping";
export const POPUP_PONG_CHANNEL = "webman:popup:pong";
export const POPUP_READY_CHANNEL = "webman:popup:ready";
export const POPUP_CLOSE_CHANNEL = "webman:popup:close";
export const POPUP_ANSWER_CHANNEL = "webman:popup:answer";

const MAX_POPUPS = 4;
const MAX_TTL_MS = 10 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePopup(raw: unknown): PopupSpec | undefined {
  if (!isRecord(raw)) return undefined;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!id || !title) return undefined;
  if (id.length > 120 || title.length > 200) return undefined;

  const kinds: PopupKind[] = ["select", "confirm", "input", "notice"];
  const kind = kinds.includes(raw.kind as PopupKind) ? (raw.kind as PopupKind) : "notice";

  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option): PopupOption | undefined => {
          if (typeof option === "string") return { value: option, label: option };
          if (!isRecord(option)) return undefined;
          const value = typeof option.value === "string" ? option.value : undefined;
          const label = typeof option.label === "string" ? option.label : value;
          if (value === undefined || label === undefined) return undefined;
          return {
            value,
            label,
            description: typeof option.description === "string" ? option.description : undefined,
          };
        })
        .filter((option): option is PopupOption => option !== undefined)
        .slice(0, 40)
    : undefined;

  if (kind === "select" && (!options || options.length === 0)) return undefined;

  return {
    id,
    kind,
    title,
    message: typeof raw.message === "string" ? raw.message.slice(0, 8_000) : undefined,
    options,
    placeholder: typeof raw.placeholder === "string" ? raw.placeholder : undefined,
    value: typeof raw.value === "string" ? raw.value : undefined,
    defaultValue: typeof raw.defaultValue === "string" ? raw.defaultValue : undefined,
    allowCancel: raw.allowCancel === undefined ? true : Boolean(raw.allowCancel),
    source: typeof raw.source === "string" ? raw.source : undefined,
    createdAt: Date.now(),
  };
}

export class PopupRegistry {
  private readonly popups = new Map<string, PopupSpec>();

  list(): PopupSpec[] {
    this.prune();
    return Array.from(this.popups.values());
  }

  get(id: string): PopupSpec | undefined {
    this.prune();
    return this.popups.get(id);
  }

  open(raw: unknown): PopupSpec | undefined {
    this.prune();
    const spec = normalizePopup(raw);
    if (!spec) return undefined;
    if (this.popups.size >= MAX_POPUPS) {
      const oldest = this.list()[0];
      if (oldest) this.popups.delete(oldest.id);
    }
    this.popups.delete(spec.id);
    this.popups.set(spec.id, spec);
    return spec;
  }

  close(id: string): boolean {
    this.prune();
    return this.popups.delete(id);
  }

  clear(): void {
    this.popups.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, popup] of this.popups) {
      if (now - popup.createdAt > MAX_TTL_MS) this.popups.delete(id);
    }
  }
}
