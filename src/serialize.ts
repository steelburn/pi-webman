/**
 * JSON serialization that tolerates the odd values that can appear in agent
 * runtime objects (cycles, bigints, errors) and keeps a single SSE frame from
 * growing without bound.
 */

const MAX_STRING = 240_000;
const MAX_DEPTH = 24;

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input === "boolean" || typeof input === "number") {
      return input;
    }
    if (typeof input === "string") {
      return input.length > MAX_STRING
        ? `${input.slice(0, MAX_STRING)}\n…[pi-webman: truncated ${input.length - MAX_STRING} chars]`
        : input;
    }
    if (typeof input === "bigint") return Number(input);
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") {
      return undefined;
    }
    if (depth > MAX_DEPTH) return "[pi-webman: depth limit]";
    if (input instanceof Error) {
      return { name: input.name, message: input.message, stack: input.stack };
    }
    if (Array.isArray(input)) {
      if (seen.has(input)) return "[pi-webman: circular]";
      seen.add(input);
      const out = input.map((entry) => walk(entry, depth + 1));
      seen.delete(input);
      return out;
    }
    if (typeof input === "object") {
      if (seen.has(input as object)) return "[pi-webman: circular]";
      seen.add(input as object);
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
        const next = walk(entry, depth + 1);
        if (next !== undefined) out[key] = next;
      }
      seen.delete(input as object);
      return out;
    }
    return String(input);
  };

  return JSON.stringify(walk(value, 0)) ?? "null";
}
