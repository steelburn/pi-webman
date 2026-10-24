# Launch kit — pi-webman

Everything here is copy-paste ready. Nothing has been posted yet.

Assets

- Hero loop (9 s, 900 px, 2.5 MB): `docs/cockpit-demo.gif`
- Full demo (20 s, 1440×900, mp4): <https://github.com/steelburn/pi-webman/releases/download/v0.1.5/cockpit-demo.mp4>
- Still: `docs/cockpit.png`
- Install line: `pi install npm:pi-webman` → then `/web open` inside Pi

## Positioning

One-liner (short):
> A live browser cockpit for the Pi coding agent: transcript, telemetry, models, tools.

One-liner (medium):
> pi-webman serves a local web UI next to a running Pi session — streaming transcript,
> token/context telemetry, model and thinking controls, per-tool loadout, and a ⌘K uplink.

Who it is for: people who run Pi in a terminal all day and want a second screen / remote
view of the same session without a new runtime, a cloud service, or extra dependencies.

What makes it distinct (use these, they are all true):
- It is an *extension of the running session*, not another agent front-end: same process,
  same tools, same context.
- Zero runtime dependencies, binds to 127.0.0.1, origin checks + CSP + optional token.
- Works with any provider Pi supports, because it only renders Pi state.
- MIT, ~1.5k lines of TypeScript/vanilla JS.

## Show HN

Title:
> Show HN: Pi Webman – a local browser cockpit for the Pi coding agent

Body (HN gives you a text field; keep it plain, no marketing):
> I run the Pi coding agent in a terminal most of the day and kept wanting the session on a
> second screen: what is the context gauge doing, which tool is running, what did the last
> tool actually return. So I wrote a Pi extension that serves a small web UI from inside the
> session.
>
> It streams the transcript over SSE (reconnects hydrate from a full snapshot), shows token
> and cost telemetry, and lets you send/steer/follow up, abort, switch model and thinking
> level, toggle tools, compact, or start a new session. There is a Ctrl/Cmd+K palette for
> all of it, and typing `/` completes Pi's own slash commands (cockpit, extension, prompt
> template, skill) with Tab/↑/↓, refusing the terminal-only ones instead of silently
> forwarding them to the model.
>
> Design constraints I set: no runtime dependencies (Node built-ins only, the UI is bundled
> into the extension), loopback by default, origin checks, strict CSP, optional bearer token
> for non-loopback binds. It renders Pi's own state, so it works with whatever provider you
> already use.
>
> `pi install npm:pi-webman`, then `/web open`. Source and screenshots:
> https://github.com/steelburn/pi-webman
>
> Happy to answer anything about the SSE hub, the snapshot format, or what broke while
> building it (session replacement was the fun one).

First comment (post immediately after submitting):
> Two implementation notes people usually ask about:
>
> 1. Hydration order. The client is registered before the snapshot is built, so events
>    published during hydration queue up per client (capped, oldest dropped) and flush
>    right after the `hello` frame. No gap, no duplicated frames.
> 2. Session replacement. Pi rebuilds extensions on new/fork/resume, which orphaned the
>    server at first: the old instance kept the port and answered "no active session".
>    The fix is a handoff of host/port/token through module scope so the next instance
>    adopts the same URL and the open tab just reconnects.
>
> Bonus for 0.2.x: `/` in the browser completes Pi's own slash commands — cockpit commands,
> extension commands (from `registerCommand`), prompt templates, skills and terminal-only
> builtins — and refuses to forward the ones that must run in the terminal, so `/thinking low`
> in the browser does not silently bill you for a model request. Extension TUI dialogs
> (`ctx.ui.select`, `ctx.ui.input`) also mirror into the browser through an opt-in event
> bridge, with the terminal staying authoritative.

Rules: no vote solicitation, reply to every comment for the first 2–3 hours, expect
criticism about "why not TUI" — the honest answer is a second screen and remote view.

## Reddit — r/LocalLLaMA

Title:
> I built a local web cockpit for the Pi coding agent (transcript, telemetry, model/tool controls, SSE, zero deps)

Body:
> Pi is a terminal-first coding agent, and I wanted the running session on a second screen —
> context pressure, tokens, cost, which tool is executing, plus a way to steer from the
> browser. So I wrote an extension that serves that UI from inside the session:
> http://127.0.0.1:4747 by default.
>
> What it does: streamed transcript with expandable tool cards (input/output/duration/diffs),
> context ring and token/cost telemetry, model + thinking-level switching, per-tool loadout,
> abort/compact/new-session, and a Ctrl/Cmd+K command palette.
>
> Constraints: no runtime dependencies (Node built-ins only), loopback by default, origin
> checks, strict CSP, optional token when you bind elsewhere. It renders Pi's state, so it
> works with any provider Pi can talk to.
>
> `pi install npm:pi-webman`, then `/web open`.
> Repo (MIT): https://github.com/steelburn/pi-webman
>
> Feedback welcome — especially on the SSE/snapshot design and on what is missing for
> long-running sessions.

Same body works for r/ChatGPTCoding with one line changed: mention you can run any provider
Pi supports. Disclose "I wrote this" in the first line on every sub, and post at most one
sub per day.

## X / Twitter

> Pi is a great terminal agent. But I wanted the session on my second screen.
>
> So I built pi-webman: a live cockpit served from inside the running Pi session. [gif]
>
> — streamed transcript + expandable tool cards
> — context/token/cost telemetry
> — model, thinking, tool toggles
> — ⌘K command uplink
> — `/` completes Pi's own slash commands
> — zero runtime deps, localhost only
>
> `pi install npm:pi-webman` · `/web open`
> https://github.com/steelburn/pi-webman

Reply with the 20 s mp4 (native video gets more reach than a GIF) and one screenshot of a
tool diff.

## Discord (Pi community — invited via https://discord.com/invite/3cU7Bz4UPx)

Post in the showcase/show-and-tell channel if one exists, otherwise the general channel:

> Made a web cockpit for Pi sessions — live transcript, telemetry, model/tool controls,
> ⌘K palette. Served by the extension itself, localhost only, no runtime deps.
> `pi install npm:pi-webman` then `/web open`. Feedback very welcome, especially bugs on
> your pi version. https://github.com/steelburn/pi-webman

Ask the maintainers before cross-posting it anywhere else in the server.

## Directories

- PR to `thevibeworks/awesome-pi-agent` (Frontends): **open** —
  https://github.com/thevibeworks/awesome-pi-agent/pull/18
- `qualisero/awesome-pi-agent` is retired (its README says so) — do not PR it.
- `shaftoe/awesome-pi-coding-agent` is generated/curated automatically — it picks projects
  up on its own; re-check in a couple of weeks.
- Pi package catalog listing already exists: https://pi.dev/packages/pi-webman

## Order of operations

1. **T+0** Discord (small, safe, gets feedback fast).
2. **T+0** X thread with the video.
3. **T+1 day** r/LocalLLaMA, then r/ChatGPTCoding the day after.
4. **T+2 days, 07:00–09:00 PT** Show HN (weekday). Only if the repo has had no new bug
   reports in the previous 24 h.
5. Answer everything for the first 3 hours of each post.

## What to watch

- npm downloads: `npm view pi-webman` + https://api.npmjs.org/downloads/point/last-week/pi-webman
- GitHub: stars/traffic (`Insights → Traffic`), issues opened
- Catalog position changes on https://pi.dev/packages (sorted by downloads)
- Post-launch: cut 0.1.6 from the top three bug reports, and re-post the fix as a comment in
  the launch thread — that is what keeps a launch thread alive.

## Known gaps to mention honestly if asked

- Image attachments / file uploads are not implemented.
- The cockpit shows the current session only; use Pi's session picker to switch.
- Throughput is estimated from streamed deltas; authoritative usage comes from the provider.
- New sessions require Pi's interactive (TUI) mode.
