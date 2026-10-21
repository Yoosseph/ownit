import { Hono } from 'hono';
import type { Env } from './env';
import { log } from './log';
import { interview } from './routes/interview';

export type AppEnv = { Bindings: Env; Variables: { userId: number | null } };

const MAX_BODY_BYTES = 512 * 1024;

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('userId', null);
    const length = Number(c.req.header('content-length') ?? 0);
    if (length > MAX_BODY_BYTES) return c.json({ error: 'too_large', message: 'Request body is too large.' }, 413);
    await next();
  });

  app.get('/', (c) => c.text('Ownit: debrief the code you ship. https://github.com/yosephnaoom/ownit\n'));
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/api/interview', interview);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    log('error', { path: new URL(c.req.url).pathname, name: error.name, message: error.message.slice(0, 200) });
    return c.json({ error: 'internal', message: 'Something went wrong on the Ownit server.' }, 500);
  });
  return app;
}
