import { Hono } from 'hono';
import type { Env } from './env';
import { createGitHub, type GitHub } from './github';
import { FAVICON_SVG } from './favicon';
import { log } from './log';
import { PROVIDERS } from './model';
import { auth } from './routes/auth';
import { interview } from './routes/interview';
import { publicPages } from './routes/public';
import { pushes } from './routes/pushes';
import { repos } from './routes/repos';
import { webhook } from './routes/webhook';
import { requireSession } from './sessions';

export type AppEnv = { Bindings: Env; Variables: { userId: number | null; login: string | null; github: GitHub } };

export interface Deps {
  github?: (env: Env) => GitHub;
}

const MAX_BODY_BYTES = 512 * 1024;

export function createApp(deps: Deps = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('userId', null);
    c.set('login', null);
    c.set('github', (deps.github ?? createGitHub)(c.env));
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return c.json({ error: 'too_large', message: 'Request body is too large.' }, 413);
    await next();
  });

  app.get('/', (c) => c.text('Ownit: debrief the code you ship.\n'));
  app.get('/healthz', (c) => c.json({ ok: true }));
  // Browsers ask for /favicon.ico on their own; both paths serve the SVG.
  for (const path of ['/favicon.svg', '/favicon.ico']) {
    app.get(path, (c) => c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' }));
  }
  // Which model each provider runs on this server, for `ownit model`. Public: it holds no secrets.
  app.get('/models', (c) =>
    c.json({
      providers: Object.entries(PROVIDERS).map(([id, spec]) => ({ id, name: spec.name, model: spec.model(c.env) })),
    }),
  );
  app.route('/auth', auth);
  app.use('/api/*', requireSession);
  app.route('/api/interview', interview);
  app.route('/api/pushes', pushes);
  app.route('/api/repos', repos);
  app.route('/webhooks', webhook);
  // Last: /:owner/:repo would otherwise shadow the routes above.
  app.route('/', publicPages);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    log('error', { path: new URL(c.req.url).pathname, name: error.name, message: error.message.slice(0, 200) });
    return c.json({ error: 'internal', message: 'Something went wrong on the Ownit server.' }, 500);
  });
  return app;
}
