/**
 * wicked-signals v0.1 — HTTP server (webhook adapter)
 *
 * POST /ingest  — accept JSON body, return {signal_id, status:"received"} with 202
 * GET  /health  — return {status:"ok"}
 *
 * Default port: 8765 (WICKED_SIGNALS_PORT env var overrides)
 */

import express, { Request, Response, NextFunction } from 'express';
import { ingestWebhook, isStructuredError } from './ingest.js';

const DEFAULT_PORT = 8765;

export function createApp(): express.Application {
  const app = express();

  // Parse JSON bodies
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Webhook ingest
  app.post('/ingest', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const result = await ingestWebhook(body);

      if (isStructuredError(result)) {
        res.status(400).json({ error: { code: result.code, message: result.error } });
        return;
      }

      // Return 202 Accepted with signal_id and status
      res.status(202).json({
        signal_id: result.signal_id,
        status: 'received',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: msg } });
    }
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  });

  return app;
}

export function startServer(port?: number): void {
  const envPort = process.env.WICKED_SIGNALS_PORT
    ? Number(process.env.WICKED_SIGNALS_PORT)
    : undefined;
  const resolvedPort = port ?? envPort ?? DEFAULT_PORT;

  const app = createApp();

  app.listen(resolvedPort, () => {
    process.stdout.write(
      JSON.stringify({ status: 'listening', port: resolvedPort }) + '\n',
    );
  });
}
