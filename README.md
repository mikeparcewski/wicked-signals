# wicked-signals

**Text in. Intent out.**

Your agents get signals constantly — Slack threads, monitoring alerts, file changes, user requests. Wicked-signals classifies each one and routes it to exactly the right place, with confidence.

No more "what should I do with this?" logic scattered across your codebase.

## Install

```bash
npm install -g wicked-signals
# or without installing:
npx wicked-signals <command>
```

Requires a wicked-bus instance and `ANTHROPIC_API_KEY` in your environment. Operates in degraded mode (store-only, no routing) if the API key is absent.

## How it works

```
signal in → classify (Claude) → route → store + emit bus event
```

Four routing targets:

- **direct_outcome** — answered inline; Claude returns the resolution text
- **crew_idd** — needs a crew session (feature, analysis, ops, etc.)
- **aggregate** — low confidence; signal stored for batching
- **pending** — degraded mode or classification in progress

Confidence tiers: HIGH (>0.85) → direct route; MEDIUM (0.65–0.85) → crew_idd; LOW (<0.65) → aggregate.

## Usage

```bash
# Text signal
wicked-signals ingest --text "Build a dark mode toggle for the web app"
# → { signal_id, status: "crew_idd", route_target: "crew_idd", confidence: 0.87 }

# File signal
wicked-signals ingest --file ./feedback.txt

# Monitoring alert
wicked-signals ingest --alert critical "Database connection pool exhausted"

# HTTP webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"source":"pagerduty","text":"p95 latency > 2s"}'

# List recent signals
wicked-signals list --limit 20 --json
```

## Events

| Event | When |
|-------|------|
| `wicked.signals.signal.received` | Signal stored |
| `wicked.signals.signal.classified` | Classification complete |
| `wicked.signals.signal.routed` | Route decision made |
| `wicked.signals.action.launched` | Crew session or action started |

## Storage

Local SQLite at `.wicked/signals.db` (override with `WICKED_SIGNALS_DB`). Signals are stored before classification — the store-first guarantee means no signal is lost even if classification fails.

---

MIT licensed. Part of the [wicked-* ecosystem](https://wickedagile.com).
