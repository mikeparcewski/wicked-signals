# wicked-signals

**Text in. Intent out.**

Your agents get signals constantly — Slack threads, monitoring alerts, file changes, user requests. wicked-signals classifies each one with Claude and routes it to exactly the right place, with confidence — so *"what should I do with this?"* stops being logic scattered across your codebase.

It's the inference and routing layer of the [wicked-* ecosystem](https://wickedagile.com): **signal in → classify → route → store + emit**.

> **Status: v0.1.0 — early / pre-release.** A working CLI, webhook server, and classifier exist in this repo. It is **not published to npm yet** — there is no `npm install -g wicked-signals`. Build from source (below) to try it.

## Install (build from source)

Not on a registry yet — clone and build:

```bash
git clone https://github.com/mikeparcewski/wicked-signals
cd wicked-signals
npm install
npm run build
node dist/cli.js ingest --text "Build a dark mode toggle for the web app"
```

Set `ANTHROPIC_API_KEY` in your environment to classify. Without it, wicked-signals runs in **degraded mode** — signals are still stored (store-first), but classification and routing are held as `pending`.

**wicked-bus is optional.** Bus emission is fire-and-forget (`npx wicked-bus emit`); failures are silent and wicked-signals runs fine with no bus present. It is an integration, not a dependency.

## How it works

```
signal in → classify (Claude) → route → store + emit bus event
```

Four routing targets:

- **direct_outcome** — answered inline; Claude returns the resolution text
- **crew_idd** — needs a crew session (feature, spike, analysis, ops, etc.)
- **aggregate** — low confidence; signal stored for batching instead of acting on a guess
- **pending** — degraded mode or classification in progress

Confidence tiers: HIGH (> 0.85) → direct route; MEDIUM (0.65–0.85) → crew_idd; LOW (< 0.65) → aggregate. Routing itself is LLM-free — a plain threshold comparison over the classifier's score.

## Usage

```bash
# Text signal
node dist/cli.js ingest --text "Build a dark mode toggle for the web app"
# → { signal_id, status: "crew_idd", route_target: "crew_idd", confidence: 0.78 }

# File signal
node dist/cli.js ingest --file ./feedback.txt

# Monitoring alert
node dist/cli.js ingest --alert critical "Database connection pool exhausted"

# HTTP webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"source":"pagerduty","text":"p95 latency > 2s"}'

# List recent signals
node dist/cli.js list --limit 20 --json
```

## Events

Emitted fire-and-forget via wicked-bus when present (domain `wicked-signals`):

| Event | When |
|-------|------|
| `wicked.signals.signal.received` | Signal stored |
| `wicked.signals.signal.classified` | Classification complete |
| `wicked.signals.signal.routed` | Route decision made |
| `wicked.signals.action.launched` | Crew session or action started |

## Storage

Local SQLite at `.wicked/signals.db` (override with `WICKED_SIGNALS_DB`). Signals are stored **before** classification — the store-first guarantee means no signal is lost even if classification fails.

## Marketing site

The product site (`wsig.wickedagile.com`) lives in [`site/`](./site) — an Astro build on the shared `wicked-web` chrome. Build it with `npm install && npm run build` inside `site/`.

---

MIT licensed. Part of the [wicked-* ecosystem](https://wickedagile.com).
