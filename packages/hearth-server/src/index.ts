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
  /** 'demo' (default): the fictional Alvarez household, a movable clock and /demo controls. 'production': real households only. */
  mode?: 'demo' | 'production';
  /** Origins allowed to call the server from a browser. Default: localhost on any port. */
  allowedOrigins?: string[];
  tickMs?: number;
}

const envMode = (): 'demo' | 'production' =>
  process.env.HEARTH_MODE === 'production' || process.env.HEARTH_DEMO === '0' ? 'production' : 'demo';

export function startHearth(opts: HearthOptions = {}) {
  const port = opts.port ?? Number(process.env.PORT ?? 8787);
  const mode = opts.mode ?? envMode();
  const demo = mode === 'demo';
  const clock = new Clock();
  // The demo story starts just before the 8 AM medicines; set HEARTH_START_TIME=now to use real time.
  const start = process.env.HEARTH_START_TIME ?? '07:55';
  if (demo && start !== 'now') clock.setTimeOfDay(start);
  const dataFile =
    opts.dataFile !== undefined ? opts.dataFile : resolve(process.env.HEARTH_DATA ?? join(root, 'data', demo ? 'hearth.json' : 'household.json'));
  const store = new Store(dataFile, clock.now(), mode);
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

  // Browsers may only call Hearth from trusted pages (Countertop on localhost by default). This blocks a
  // random website from reaching a server running on someone's machine. Non-browser MCP clients send no Origin.
  const allowed = opts.allowedOrigins ?? (process.env.HEARTH_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  const originAllowed = (origin?: string) => {
    if (!origin) return true;
    if (allowed.length) return allowed.includes(origin);
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
    } catch {
      return false;
    }
  };

  const app = express();
  app.use((req, res, next) => {
    if (originAllowed(req.headers.origin)) return next();
    res.status(403).json({ error: `Origin ${req.headers.origin} is not allowed. Set HEARTH_ALLOWED_ORIGINS to permit it.` });
  });
  app.use(
    cors({
      origin: (origin, cb) => cb(null, originAllowed(origin)),
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
      return rpcError(res, 401, demo ? 'Unknown device token. Use one of the household device tokens (see README).' : 'Unknown device token.');
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

  const httpServer = app.listen(port, () =>
    console.log(
      demo
        ? `[hearth] MCP server on http://localhost:${port}/mcp  (demo mode: fictional household, demo clock and /demo controls)`
        : `[hearth] MCP server on http://localhost:${port}/mcp  (production mode: ${store.db.households.length} household(s) from ${dataFile})`,
    ),
  );
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE' || process.env.VITEST) throw err;
    console.error(
      `[hearth] Port ${port} is already in use — another copy of Hearth (or "npm run dev") is probably still running.\n` +
        `         Stop it with Ctrl+C in its terminal, or start this one on another port: PORT=8788 npm run dev -w hearth-server`,
    );
    process.exit(1);
  });

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
  try {
    startHearth();
  } catch (err) {
    console.error(`[hearth] ${(err as Error).message}`);
    process.exit(1);
  }
}
