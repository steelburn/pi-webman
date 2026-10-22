# π Webman — Pi // Cockpit

A futuristic browser cockpit for the [Pi coding agent](https://pi.dev). It puts a live
flight deck around the Pi session already running in your terminal: streaming transcript,
token flux, context pressure, model core, thinking level, tool loadout, activity log,
command uplink and a keyboard-driven command palette.

Inspired by the terminal flight deck and telemetry of its sibling HUD extension
[`pi-cockpit-hud`](https://github.com/steelburn/pi-cockpit-hud), rebuilt as a
zero-dependency local web UI served by a Pi extension.

![Pi // Cockpit demo](https://raw.githubusercontent.com/steelburn/pi-webman/main/docs/cockpit-demo.gif)

A real run: directive in, tool calls, a streamed answer and live telemetry —
[full-resolution MP4](https://github.com/steelburn/pi-webman/releases/download/v0.1.5/cockpit-demo.mp4).

## Highlights

- **Live stream** — user directives, assistant text, hidden reasoning, tool calls and tool
  output arrive over Server-Sent Events. Reconnects hydrate from a full session snapshot.
- **Flight telemetry** — context gauge, input/output/cache tokens, reasoning tokens, cost,
  throughput, message and tool-call counters, mission uptime and session leaf.
- **Tool operations** — expandable HUD cards for every tool call, including input, output,
  status, duration and coloured diffs when a tool returns a patch.
- **Control surface** — send, steer or follow up; abort; switch model; change thinking
  level; enable/disable tools; rename the session; compact context; start a new session
  (interactive mode); switch between light and dark mode.
- **Command uplink** — `Ctrl/Cmd+K` palette for actions, models, Pi slash commands and tools.
- **Light & dark modes** — toggle from the top bar or the command uplink. The cockpit follows
  the OS preference on first visit, remembers your choice, and recolours the HUD, transcript
  and background canvases together.
- **Retro-futurist HUD** — neon grid, starfield, scanlines, context ring, neural pulse and
  status LEDs. Reduced-motion preferences are respected.
- **No runtime dependencies** — only Node built-ins. The UI is bundled into the extension.

## Install

From the [Pi package catalog](https://pi.dev/packages/pi-webman):

```bash
pi install npm:pi-webman
```

From a checkout of this repo:

```bash
pi install "$(pwd)"
```

Or load it for a single run while developing:

```bash
pi -e ./src/index.ts
```

Pi loads TypeScript extensions directly through `jiti`; there is no compile step.

## Start the cockpit

Inside Pi's terminal UI:

```text
/web                 start on http://127.0.0.1:4747/
/web 5000            start on a custom port
/web open            start and open the default browser
/web status          show the URL and connected clients
/web restart         restart the server
/web stop            stop the server
/webman              alias for /web
```

The URL is also printed as a Pi notification and shown in the footer as `◈ WEB :4747`.
Use `Ctrl+C` in the browser or leave the tab open; the server follows the Pi session.

### Start automatically

```bash
pi --web
pi --web --web-port 5000
pi --web --web-open
```

The cockpit is restored automatically after `/reload` when it was running.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--web` | off | Start the cockpit when a session starts |
| `--web-port` | `4747` | Listening port (`0` picks a free port) |
| `--web-host` | `127.0.0.1` | Bind interface |
| `--web-token` | empty | Require a bearer token / cookie for access |
| `--web-open` | off | Open the default browser on start |

Environment equivalents: `PI_COCKPIT_PORT`, `PI_COCKPIT_HOST`, `PI_COCKPIT_TOKEN`.

## Cockpit guide

| Area | What it does |
| --- | --- |
| **Top bar** | Brand, session callsign, working directory, uplink state, wall clock |
| **Context Matrix** | Context-window ring, used/window tokens, segment bar |
| **Telemetry** | Input, output, cache read/write, reasoning, cost, messages, tool calls |
| **Neural Pulse** | Live waveform fed by streamed text/thinking deltas |
| **Activity Log** | Running and recently completed tools with duration |
| **Transcript** | Markdown messages, collapsible thoughts, expandable tool cards |
| **Composer** | `AUTO` / `STEER` / `FOLLOW` delivery modes, prompt history, quick actions |
| **Model Core** | Current model and a searchable model palette |
| **Thinking** | Supported thinking levels for the active model |
| **Tool Loadout** | Toggle active tools on the next model request |
| **Uplink** | Host, SSE clients, uptime, branch leaf |

### Keyboard

| Key | Action |
| --- | --- |
| `Enter` | Transmit directive |
| `Shift+Enter` | Newline |
| `Esc` | Close palette/modal, otherwise abort the active run |
| `Ctrl/Cmd+K` | Open or close the command uplink |
| `↑` / `↓` | Navigate the palette |
| `↑` (empty composer) | Recall previous directive |

`AUTO` sends immediately when idle and queues a follow-up when Pi is busy. `STEER` enters
after the current assistant turn and its tool calls. `FOLLOW` waits until the run settles.

## Security

- The server binds to `127.0.0.1` by default.
- Binding to a non-loopback host automatically generates a random token. Open the URL that
  Pi prints; it contains the token and sets an `HttpOnly`, `SameSite=Strict` cookie.
- `--web-token` forces token auth even on loopback.
- Responses carry a restrictive CSP, `nosniff`, `X-Frame-Options: DENY` and no-referrer.
- POST endpoints check the request origin.
- For remote access prefer an SSH tunnel or Tailscale instead of exposing plain HTTP:

```bash
ssh -L 4747:127.0.0.1:4747 your-host
```

The cockpit has the same operating-system permissions as the Pi process. Anyone who can
reach it can send prompts and change the active model/tools, so protect the token.

## How it works

```text
src/index.ts     extension entry: flags, /web command, lifecycle events, runtime
src/server.ts    HTTP server, auth, JSON API, SSE endpoint, static assets
src/hub.ts       SSE fan-out with a hydrate-before-stream barrier
src/state.ts     branch-aware session snapshot, telemetry and capabilities
src/serialize.ts cycle-safe JSON with bounded string sizes
src/assets.ts    generated UI bundle (do not edit)
ui/              source for the HTML/CSS/JS cockpit
scripts/         UI asset bundler
```

The extension subscribes to Pi lifecycle events (`message_*`, `tool_execution_*`,
`agent_*`, `model_select`, compaction, session changes) and forwards them to the browser.
The browser receives a full snapshot in the SSE `hello` frame, then applies live events.
Session state is persisted as a branch-scoped custom entry (`pi-webman`) so the cockpit can
come back after a runtime reload without polluting model context.

### Coexistence with pi-cockpit-hud

[`pi-cockpit-hud`](https://github.com/steelburn/pi-cockpit-hud) (`npm:pi-cockpit-hud`) is a
separate terminal HUD extension and owns the `/cockpit` command. Webman uses `/web`,
`/webman` and `/web-session`, its own footer status key (`webman`) and its own custom
session entry type (`pi-webman`), so both extensions can be installed at once.

Note: the unrelated `pi-cockpit` package on npm is not part of this project.

## Development

```bash
npm install
npm run build       # bundle ui/* -> src/assets.ts
npm run typecheck
npm run check       # build + typecheck
npm run watch       # rebuild UI on change
```

After changing UI files, rebuild the bundle and restart Pi (or run `/web restart`).
In a separate terminal, a minimal smoke test:

```bash
curl -s http://127.0.0.1:4747/api/health
curl -s http://127.0.0.1:4747/api/state | head -c 400
```

## Limitations

- New sessions are only available when Pi runs in interactive (TUI) mode; RPC/JSON/print
  hosts own their session lifecycle.
- Image attachments and file uploads are not implemented yet.
- The cockpit exposes the current session only; use Pi's session picker to switch sessions.
- Throughput is estimated from streamed deltas; authoritative usage comes from provider
  responses.

## License

MIT
