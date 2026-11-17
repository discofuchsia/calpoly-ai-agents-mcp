# A Day in the Life of an AI Engineer: AI Agents and MCP

Talk deck and live demo by **Jules Gerard, Senior AI Engineer at Qvest/Amazon**, for Cal Poly Entrepreneurs (30 minutes of talk, 30 minutes of questions).

The repo contains:

- **The deck** (`web/index.html`, `web/deck.css`, `web/deck.js`): 19 hand-rolled HTML slides with step builds, a presenter view with notes and a timer, and a reading mode for phones.
- **The demo**: the "Startup Co-founder Agent". An agent loop (`agent/`) talks to a local MCP server (`server/`, 4 tools and 1 resource, stdio transport) and streams its work to a web UI (`web/demo/`) through a small backend (`backend/`) that listens only on 127.0.0.1.
- **A recorded replay** (`web/demo/replays/sample.js`) so the demo also runs with no network and no API key.
- **`dist/`**: the built static site (deck, demo UI, replay, fonts, QR code). It contains no server code and no keys. See [DEPLOY.md](DEPLOY.md).

The day-in-the-life case study ("Project Sentinel") is a codename. It describes an architecture pattern only and is anonymized.

## Requirements

- Node.js 22.9 or newer
- Google Chrome (for presenting and for the e2e test). Set `CHROME_PATH` if Chrome is not at the default macOS path.

```bash
npm install
```

## Open the deck

Offline, from a file:

```bash
npm run build
open dist/index.html
```

With the live demo backend (mock model, no key needed):

```bash
npm run demo:mock        # then open http://127.0.0.1:8787/
```

With a real model (see "Live demo setup"):

```bash
npm start                # builds, then serves http://127.0.0.1:8787/
```

### Keyboard

| Key | Action |
|---|---|
| → Space PageDown ↓ | Next build or slide |
| ← PageUp ↑ | Previous |
| Home / End | First / last slide |
| D | Jump to the demo slide |
| P | Open the presenter view |
| G | Slide overview |
| F | Fullscreen |
| B | Black screen |
| ? | Shortcut help |
| Esc | Close overlays |

Swipe left or right on touch screens. A clicker that sends PageUp/PageDown works, including while the demo iframe has focus (the demo forwards arrow and page keys to the deck, except while you type in the idea field). URLs are `#/<n>`, e.g. `dist/index.html#/14`.

On phones and portrait screens (portrait, or narrower than 760px) the deck switches to reading mode: slides stacked and scrollable, all builds shown, notes hidden.

### Presenter view

Press **P** in the audience window. A second window opens with the current slide (unrevealed builds dimmed), the next slide, the speaker notes, an elapsed timer against 30:00, a pace indicator (on time / ahead / behind, from each slide's planned minutes), and the wall clock.

- The timer starts on the first slide change. **T** pauses or resumes, **R** resets.
- Navigating in either window moves both.
- Put the audience window on the projector and the presenter window on the laptop screen (extended display, not mirroring).

## Live demo setup

> **OPEN POINT: choose the LLM provider.** The demo supports three providers behind one interface. The choice for the talk is not made yet. Pick one, set it in `.env`, and run the pre-talk checklist with it.

Copy the template first. `.env` is git-ignored; never commit it.

```bash
cp .env.example .env
```

| Provider | Set in `.env` | Notes |
|---|---|---|
| `mock` (default) | `LLM_PROVIDER` set to `mock` | Scripted model, no key, real MCP tools. `MOCK_LATENCY_MS` adds a delay per step. |
| `anthropic` | `LLM_PROVIDER` set to `anthropic`, plus your key in `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL` | Uses the Anthropic API. |
| `bedrock` | `LLM_PROVIDER` set to `bedrock`, plus `AWS_PROFILE`, `AWS_REGION`, optional `BEDROCK_MODEL_ID` | Use a personal AWS account with model access enabled in the Bedrock console. Credentials come from the default AWS credential chain. |

Then `npm start` and open `http://127.0.0.1:8787/`. Check `http://127.0.0.1:8787/api/health`: it should report `"ready": true` and the provider and model (never the key). The demo header shows a badge such as `live · anthropic · <model>`.

### Switching to replay

The demo runs live only when the page is served from `127.0.0.1` or `localhost` and the backend is healthy. Otherwise, including on the public site, it runs the recorded replay. To switch by hand:

- click **Replay** in the Live/Replay switch, or
- press **M** (focus outside the idea field), or
- open `demo/index.html?mode=replay` (add `&speed=2` to play faster).

If a live run fails, the status line offers **Switch to replay**, which switches and starts the replay in one click.

### Re-recording the replay

The shipped replay comes from a real run through the real MCP server with the mock model. To record one with a real model before the talk:

```bash
# with LLM_PROVIDER and credentials set in .env
npm run record                         # or: npm run record -- --idea "Your idea"
npm run build
```

The recorder refuses to write a run that contains errors.

## Inspecting the MCP server

```bash
npm run tools:list   # spawns the server over stdio, lists tools and resources, calls size_market once
npm run inspect      # opens the MCP Inspector against the server
```

Server `startup-cofounder`: tools `size_market`, `scan_competitors`, `draft_landing_page`, `score_pitch`; resource `playbook://pitch-rubric`. The tools compute only from the assumptions the model supplies. They make no network calls and label results as assumption-based.

## Tests and checks

```bash
npm test         # unit and integration tests (node:test)
npm run build    # writes dist/
npm run audit    # scans repo and dist/ for internal names, secrets, wildcard binds, external URLs, leading-slash paths
npm run e2e      # Chrome e2e: deck offline from file://, presenter sync, replay, phone mode, live mode on 127.0.0.1
npm run verify   # all of the above
```

## Security notes

- The backend listens only on `127.0.0.1` (hard-coded). It checks the `Host` header and the `Origin` of every run request, only accepts JSON bodies up to 4 KB, and runs one agent at a time.
- The MCP server uses stdio, so it opens no network port.
- API keys live only in `.env` / environment variables. They are never logged and never sent to the browser.
- `dist/` contains no keys and no server code; `npm run audit` enforces this.
- Model and tool text is rendered as plain text. The drafted landing page renders only inside a sandboxed iframe with scripts disabled.

## Pre-talk checklist

- [ ] Laptop charged, charger packed
- [ ] `npm run verify` passes
- [ ] `.env` set for the chosen provider; `/api/health` shows `"ready": true`
- [ ] One full live dry run on the venue network
- [ ] Re-record the replay with the real model (`npm run record`, then `npm run build`)
- [ ] Wi-Fi off: the replay still plays from `dist/index.html`
- [ ] Display set to extended (not mirrored); presenter view on the laptop screen
- [ ] Check font size from the back of the room
- [ ] Clicker tested, including on the demo slide
- [ ] Browser zoom at 100%
- [ ] Notifications off, other tabs closed
- [ ] Public deck URL ready to share (see DEPLOY.md)
