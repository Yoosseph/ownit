import { createApp } from './app';
import { expirePending } from './cron';
import type { Env } from './env';
import { createGitHub } from './github';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(expirePending(env, createGitHub(env)));
  },
} satisfies ExportedHandler<Env>;
