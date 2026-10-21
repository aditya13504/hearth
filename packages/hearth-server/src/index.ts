import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { isInitializeRequest } from '@modelcontextprotocol/server';
import { CareService } from './care.js';
import { Clock } from './clock.js';
import { createHearthServer } from './mcp.js';
import { OpenFda } from './services/openfda.js';
import { RxNorm } from './services/rxnorm.js';
import { Store } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export interface HearthOptions {
  port?: number;
  dataFile?: string | null;
  demo?: boolean;
  tickMs?: number;
}

export function startHearth(opts: HearthOptions = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const demo = opts.demo ?? process.env.HEARTH_DEMO !== '0';
  const clock = new Clock();
  // The demo story starts just before the 8 AM medicines; set HEARTH_START_TIME=now to use real time.
  const start = process.env.HEARTH_START_TIME ?? '07:55';
  if (demo && start !== 'now') clock.setTimeOfDay(start);
  const store = new Store(opts.dataFile === undefined ? join(root, 'data', 'hearth.json') : opts.dataFile, clock.now());
  const care = new CareService(store, clock);
  const deps = { care, rx: new RxNorm(join(root, 'cache')), fda: new OpenFda(join(root, 'cache')), uiDir: join(root, 'ui-dist') };

  type Session = { transport: NodeStreamableHTTPServerTransport; token: string; hearth: ReturnType<typeof createHearthServer> };
  const sessions = new Map<string, Session>();

  // New reminder/alert/message for someone -> poke every session that person has open.
  care.events.on('inbox', (householdId: string, item: { to: string }) => {
    for (const s of sessions.values()) {
      if (s.hearth.householdId === householdId && s.hearth.memberId === item.to) void s.hearth.notifyInbox();
    }
  });

  const app = express();
  app.use(
    cors({
      origin: true,
      exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version', 'Last-Event-ID', 'Accept'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const bearer = (req: Request) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();

  const rpcError = (res: Response, status: number, message: string) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

  app.post('/mcp', async (req, res) => {
    const sid = req.header('mcp-session-id');
    const token = bearer(req);
    if (sid) {
      const s = sessions.get(sid);
      if (!s) return rpcError(res, 404, 'Session not found');
      if (s.token !== token) return rpcError(res, 403, 'Token does not match session');
      return s.transport.handleRequest(req, res, req.body);
    }
    if (!isInitializeRequest(req.body)) return rpcError(res, 400, 'Missing Mcp-Session-Id header');

    const who = store.identify(token);
    if (!who) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="hearth"');
      return rpcError(res, 401, 'Unknown device token. Use one of the household device tokens (see README).');
    }
    const hearth = createHearthServer(deps, { householdId: who.household.id, memberId: who.member.id });
    const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, token, hearth });
        console.log(`[hearth] session ${id.slice(0, 8)} opened for ${who.member.name} (${who.member.role})`);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await hearth.server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const sessionRequest = async (req: Request, res: Response) => {
    const s = sessions.get(req.header('mcp-session-id') ?? '');
    if (!s) return rpcError(res, 404, 'Session not found');
    if (s.token !== bearer(req)) return rpcError(res, 403, 'Token does not match session');
    await s.transport.handleRequest(req, res);
  };
  app.get('/mcp', sessionRequest); // server -> client notification stream (SSE)
  app.delete('/mcp', sessionRequest);

  // ---------------------------------------------------------------- demo controls (presenter only)
  if (demo) {
    const state = () => ({ now: clock.now().toISOString(), sessions: [...sessions.values()].map((s) => s.hearth.memberId) });
    app.get('/demo/state', (_req, res) => res.json(state()));
    app.post('/demo/clock', (req, res) => {
      const { time, advanceMinutes, reset } = req.body ?? {};
      if (reset) clock.reset();
      if (typeof time === 'string') clock.setTimeOfDay(time);
      if (typeof advanceMinutes === 'number') clock.advance(advanceMinutes);
      care.tick();
      res.json(state());
    });
    app.post('/demo/reset', (_req, res) => {
      care.reseed();
      res.json(state());
    });
  }

  app.get('/', (_req, res) =>
    res.type('text/plain').send('Hearth MCP server. Streamable HTTP endpoint: POST/GET/DELETE /mcp (protocol 2025-11-25). See README.'),
  );

  const timer = setInterval(() => care.tick(), opts.tickMs ?? 5000);
  care.tick();

  const httpServer = app.listen(port, () => console.log(`[hearth] MCP server on http://localhost:${port}/mcp  (demo controls: ${demo ? 'on' : 'off'})`));

  return {
    app,
    care,
    clock,
    httpServer,
    async close() {
      clearInterval(timer);
      for (const s of sessions.values()) await s.transport.close().catch(() => undefined);
      await new Promise<void>((r) => httpServer.close(() => r()));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startHearth();
}
