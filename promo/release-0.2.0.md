# pi-webman 0.2.0 — commands and popups

Two things the terminal editor had and the browser did not.

## `/` completion

Type `/` in the composer: fuzzy command search with per-command argument hints,
`↑`/`↓`/`Tab`/`Enter`/`Esc` handling, and argument completion for models, thinking levels
and themes.

Every entry is tagged where it runs: `COCKPIT`, `EXTENSION`, `PROMPT`, `SKILL` or
`TERMINAL`.

![Command completion](https://raw.githubusercontent.com/steelburn/pi-webman/v0.2.0/docs/completion.png)

## Cockpit commands

`/compact`, `/model`, `/thinking`, `/name`, `/new`, `/abort`, `/theme`, `/copy`, `/status`
and `/help` execute against the cockpit API instead of the model, so they work on the first
`Enter`.

This also fixes a real cost bug: Pi handles builtin slash commands in the interactive
editor, so `/thinking low` typed in the browser was sent as a prompt and answered — and
billed — by the model. Known builtins are now refused in both the UI and the server, while
ordinary text starting with `/` (a path, say) still passes through.

## Extension popups

Pi draws extension dialogs in the terminal, and the extension API only reports *that* a
prompt is open — it never exposes the content or an answer channel. Both halves are covered:

- **Nothing to install.** While any extension dialog blocks the terminal, the composer shows
  a `TERMINAL PROMPT` banner with the prompt kind and title, and it clears when you answer
  in the terminal. The browser never looks frozen.
- **Popup bridge.** Extensions can render the popup natively in the browser and get the
  answer back over the shared `pi.events` bus:

| Channel | Direction | Payload |
| --- | --- | --- |
| `webman:popup:open` | extension → cockpit | `{ id, kind, title, message?, options?, placeholder?, allowCancel?, source? }` |
| `webman:popup:answer` | cockpit → extension | `{ id, value? , cancelled? }` |
| `webman:popup:close` | either way | `{ id }` |
| `webman:popup:ping` / `pong` | extension ⇄ cockpit | presence probe, so an extension can fall back to the terminal |
| `webman:popup:ready` | cockpit → extensions | `{ url, version, clients }` on server start |

`examples/popup-bridge-demo.ts` implements all of it, including the terminal fallback:

```bash
pi -e ./examples/popup-bridge-demo.ts --web
/hud-demo      # select popup, answered in the browser
/hud-notice    # notice popup
/hud-terminal  # counter-example: terminal-only dialog, mirrored as a banner
```

## Install

```bash
pi install npm:pi-webman
```

MIT, zero runtime dependencies, loopback by default.
