export interface Env {
  DB: D1Database;
  NEBIUS_BASE_URL: string;
  NEBIUS_MODEL: string;
  MODEL_BACKEND: string;
  DEMO_DAILY_CALL_CAP: string;
  PUBLIC_URL: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  SESSION_SECRET?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  DEMO_NEBIUS_KEY?: string;
  /** "1" skips the GitHub push-access check, but only for requests to localhost (wrangler dev). */
  DEV_LOCAL_TRUST?: string;
}
