#!/usr/bin/env node
/**
 * wicked-signals v0.1 — CLI entry point
 *
 * Commands:
 *   ingest --text "<text>"
 *   ingest --file <path>
 *   ingest --alert --severity <level> --message "<msg>"
 *   status <id> [--json]
 *   list [--limit N]
 *   serve [--port N]
 */

import { Command } from 'commander';
import { ingestText, ingestFile, ingestAlert, isStructuredError } from './ingest.js';
import { startServer } from './serve.js';
import { getDb, getSignalById, listSignals, getLatestClassification, getLatestRoutingDecision } from './db.js';

const program = new Command();

program
  .name('wicked-signals')
  .description('Inference and routing layer for the wicked-* ecosystem')
  .version('0.1.0');

// -------------------------
// ingest command
// -------------------------

program
  .command('ingest')
  .description('Ingest a signal for classification and routing')
  .option('--text <text>', 'Ingest a text signal')
  .option('--file <path>', 'Ingest a file signal')
  .option('--alert', 'Ingest an alert signal')
  .option('--severity <level>', 'Alert severity level (info|warn|error|critical)')
  .option('--message <msg>', 'Alert message text')
  .option('--json', 'Output as JSON (default; accepted for consistency)')
  .action(async (opts: {
    text?: string;
    file?: string;
    alert?: boolean;
    severity?: string;
    message?: string;
    json?: boolean;
  }) => {
    try {
      let result;

      if (opts.text) {
        result = await ingestText(opts.text);
      } else if (opts.file) {
        result = await ingestFile(opts.file);
      } else if (opts.alert) {
        if (!opts.severity || !opts.message) {
          exitError('MISSING_ARGS', '--alert requires --severity <level> and --message "<msg>"');
        }
        result = await ingestAlert(opts.severity!, opts.message!);
      } else {
        exitError('MISSING_ARGS', 'Specify one of: --text, --file, or --alert');
      }

      if (isStructuredError(result)) {
        exitError(result.code, result.error);
      }

      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      exitError('INTERNAL_ERROR', msg);
    }
  });

// -------------------------
// status command
// -------------------------

program
  .command('status <id>')
  .description('Show the status of a signal by ID')
  .option('--json', 'Output as JSON')
  .action((id: string, _opts: { json?: boolean }) => {
    try {
      // Strip "sig-" prefix if present
      const rawId = id.startsWith('sig-') ? id.slice(4) : id;
      const signal = getSignalById(rawId);

      if (!signal) {
        exitError('NOT_FOUND', `Signal not found: ${id}`);
      }

      const classification = getLatestClassification(rawId);
      const routing = getLatestRoutingDecision(rawId);

      const output = {
        signal_id: `sig-${signal.id}`,
        status: signal.status,
        route_target: routing?.routing_path ?? null,
        source: signal.source,
        received_at: signal.received_at,
        classified_at: signal.classified_at,
        routed_at: signal.routed_at,
        confidence: classification?.confidence_score ?? null,
        classification_type: classification?.type ?? null,
        degraded: classification ? Boolean(classification.degraded) : null,
        direct_outcome_payload:
          routing?.direct_outcome_payload
            ? (JSON.parse(routing.direct_outcome_payload) as unknown)
            : null,
      };

      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      process.exit(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      exitError('INTERNAL_ERROR', msg);
    }
  });

// -------------------------
// list command
// -------------------------

program
  .command('list')
  .description('List recent signals')
  .option('--limit <n>', 'Maximum number of signals to show', '20')
  .option('--json', 'Output as JSON (default; accepted for consistency)')
  .action((opts: { limit?: string; json?: boolean }) => {
    try {
      const limit = Math.max(1, Math.min(1000, parseInt(opts.limit ?? '20', 10)));
      const signals = listSignals(limit);

      const output = signals.map((s) => ({
        signal_id: `sig-${s.id}`,
        status: s.status,
        source: s.source,
        received_at: s.received_at,
        routed_at: s.routed_at,
      }));

      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      process.exit(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      exitError('INTERNAL_ERROR', msg);
    }
  });

// -------------------------
// serve command
// -------------------------

program
  .command('serve')
  .description('Start the HTTP server for webhook ingestion')
  .option('--port <n>', 'Port to listen on (default: 8765)')
  .action((opts: { port?: string }) => {
    try {
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      startServer(port);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      exitError('INTERNAL_ERROR', msg);
    }
  });

// -------------------------
// Helpers
// -------------------------

function exitError(code: string, message: string): never {
  process.stderr.write(JSON.stringify({ error: { code, message } }, null, 2) + '\n');
  process.exit(1);
}

// Ensure DB is initialized before any command runs
program.hook('preAction', () => {
  getDb();
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: msg } }, null, 2) + '\n');
  process.exit(1);
});
