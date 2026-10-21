import { Hono } from 'hono';
import type { Env } from './env';
import { createGitHub, type GitHub } from './github';
import { log } from './log';
import { interview } from './routes/interview';
import { pushes } from './routes/pushes';
import { repos } from './routes/repos';
import { webhook } from './routes/webhook';

export type AppEnv = { Bindings: Env; Variables: { userId: number | null; github: GitHub } };

export interface Deps {
  github?: (env: Env) => GitHub;
}

const MAX_BODY_BYTES = 512 * 1024;

export function createApp(deps: Deps = {}) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('userId', null);
    c.set('github', (deps.github ?? createGitHub)(c.env));
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return c.json({ error: 'too_large', message: 'Request body is too large.' }, 413);
    await next();
  });

  app.get('/', (c) => c.text('Ownit: debrief the code you ship.\n'));
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/api/interview', interview);
  app.route('/api/pushes', pushes);
  app.route('/api/repos', repos);
  app.route('/webhooks', webhook);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    log('error', { path: new URL(c.req.url).pathname, name: error.name, message: error.message.slice(0, 200) });
    return c.json({ error: 'internal', message: 'Something went wrong on the Ownit server.' }, 500);
  });
  return app;
}
