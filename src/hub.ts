import type { IncomingMessage, ServerResponse } from "node:http";
import { safeStringify } from "./serialize.ts";

interface Client {
  res: ServerResponse;
  ready: boolean;
  queue: string[];
}

/**
 * A tiny SSE fan-out hub.
 *
 * New clients receive a full `hello` snapshot before any live events. Events
 * produced while that snapshot is being built are queued per client, so there is
 * no gap between hydration and the live stream.
 */
export class EventHub {
  private readonly clients = new Set<Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.ping(), 15_000);
    this.heartbeat.unref?.();
  }

  get subscriberCount(): number {
    return this.clients.size;
  }

  subscribe(req: IncomingMessage, res: ServerResponse, snapshot: () => unknown): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1500\n\n");

    const client: Client = { res, ready: false, queue: [] };
    this.clients.add(client);

    const cleanup = () => {
      this.clients.delete(client);
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    let hello: string;
    try {
      hello = safeStringify({ type: "hello", snapshot: snapshot() });
    } catch (error) {
      hello = safeStringify({
        type: "hello",
        snapshot: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    client.ready = true;
    this.write(client, hello);
    for (const queued of client.queue) this.write(client, queued);
    client.queue.length = 0;
  }

  publish(payload: Record<string, unknown>): void {
    const frame = safeStringify({ ts: Date.now(), ...payload });
    for (const client of this.clients) {
      if (!client.ready) {
        client.queue.push(frame);
        if (client.queue.length > 500) client.queue.shift();
        continue;
      }
      this.write(client, frame);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        /* already gone */
      }
    }
    this.clients.clear();
  }

  private ping(): void {
    for (const client of this.clients) {
      try {
        client.res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private write(client: Client, frame: string): void {
    try {
      client.res.write(`data: ${frame}\n\n`);
    } catch {
      this.clients.delete(client);
    }
  }
}
