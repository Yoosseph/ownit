# Handoff

Read this first, then [SPEC.md](SPEC.md). [ARCHITECTURE.md](ARCHITECTURE.md) has the short overview. Keep this file current after each milestone.

## Progress

| Milestone | Status | Commit |
| --- | --- | --- |
| 1. Worker skeleton, D1 schema, Nebius client | Done. Live check passed 2026-10-21: curl to /api/interview/start returned a validated question from Nemotron in about 3.7 s. | c033546 |
| 2. CLI debrief end to end | Done: `ownit interview --range A..B` against local `wrangler dev` (fixture model): fail, feedback, follow-up, pass, recorded in D1. | c9fcaab |
| 3. Pre-push hook | Done: Y, n, s verified with real `git push` in a ConPTY reading `/dev/tty`; no-TTY, unreachable worker, chained hook covered by `cli/test/hook.test.ts`. | f9649d3 |
| 4. GitHub App, webhook, check runs | Done in code and tests (fake GitHub). Signed webhooks verified against local `wrangler dev`. **Real check run not seen yet**: needs the App from docs/github-app.md and a public worker URL. | 3575033 |
| 5. Cron, stats, badge, public page | Done: tests on a seeded repo; locally `seed/demo.sql` + `wrangler dev --test-scheduled` shows 70% → 54% after the cron expires a 30-hour-old pending push. | 0c4faef |
| 6. Login and permissions | Done in code and tests (fake GitHub): device flow, session tokens (hash stored), 401 without a valid token on every `/api/*` route, 403 without push access. Locally verified token rejection and the full hook flow with a dev session. **Real device flow not run yet**: needs the App's client ID. | 8350a71 |
| 7. Docs | Done: README (what/why, install, BYOK, privacy, self-hosting, limitations, credits), docs/demo.md, docs/github-app.md, scripts/live-injection-check. | (this commit) |

## Still to do before the hackathon demo

1. ~~Live model checks~~ Done 2026-10-21: `scripts/live-injection-check` 4/4 (both injected answers failed, a rough honest answer passed), the milestone 1 curl, and a CLI debrief with fail, feedback, follow-up and pass. Nemotron accepts `response_format: json_object`; calls take 1–4 s.
2. ~~GitHub App~~ Done 2026-10-21: `ownit-app` (App ID 5413583), push event, installed on Yoosseph/test-repo. Live end to end verified: `ownit login` (device flow), `ownit init`, a push through a real terminal with fail, feedback, follow-up and pass, then a green **Ownit: verified** check run on GitHub, the badge at 100%, and the page.
3. ~~Deploy~~ Done 2026-10-21: https://ownit.ownit-worker.workers.dev (D1 `ownit`, migrations applied, SESSION_SECRET set, hourly cron registered). No DEMO_NEBIUS_KEY on the server yet (user's choice; revisit before submission). GitHub App secrets still to set.
4. ~~`repository` in `cli/package.json`~~ Done 2026-10-21. `DEFAULT_SERVER` already points to the deployed URL. Ready for `npm publish` once the user says so.
5. Hackathon rules (from summaries; the official Devpost rules page blocked fetching, so the user should confirm there): public repo with an open-source license (MIT stays), an NVIDIA open model on Nebius (met), a working demo URL, a YouTube video, a description, and tool feedback. Deadline Oct 30, 2026, 10:00 PT. The GitHub repo is public (2026-10-21). Judges need `DEMO_NEBIUS_KEY` set to try it without a key.
6. ~~Redeploy~~ Done 2026-10-21 (version 3d7070d8): lenient grading and the public page footer are live.
7. Stretch (only after the above): late-pass and backfill labels, trivial-push exemption, per-author badges, global `core.hooksPath` install.

## Settled decisions

- npm package `getownit`; the command is `ownit` (`ownit` on npm is an unrelated 2022 package).
- Model `nvidia/nemotron-3-super-120b-a12b` at `https://api.tokenfactory.nebius.com/v1/` (Nebius Token Factory), set in `worker/wrangler.toml`. Requests use `response_format: json_object`; `<think>` blocks are stripped.
- Question references are sealed into an AES-GCM token (`worker/src/seal.ts`, key from `SESSION_SECRET`) that the CLI carries between requests, so the worker stores no references and the CLI cannot read them.
- The CLI resends the diff with each answer so the follow-up writer can use it without the worker storing code.
- Tests run D1 on a `node:sqlite` shim (`worker/test/helpers/d1.ts`) with the real migrations.
- `MODEL_BACKEND = "fixture"` switches to an offline fake model (`worker/src/fixtureModel.ts`).
- Extra columns beyond the spec's data model: `repos.private`, `pushes.check_run_id`, plus `sessions`, `rate_limits`, `demo_usage` tables.
- Repos must be registered (`POST /api/repos`, called by `ownit init`) before debrief routes accept them. Until milestone 6, API routes have no auth.
- Check runs: verified = success, skipped = neutral, pending and provider_error = in_progress. They are created only after the webhook confirms the head commit landed (`commits.pushed_at`).
- Unmatched commits in a push webhook become a new pending push owned by the sender.
- Stats count only commits GitHub confirmed (`pushed_at` set, on or after `tracked_since`), so a repo without the App shows "no pushes yet". provider_error pushes never expire; only pending ones do.
- Private repos: the public page hides question text (stats and statuses still show).
- Auth: the CLI runs GitHub's device flow itself (client ID from `GET /auth/config`), because github.com/login/* returns 429 to Cloudflare Workers' shared IPs. It sends the GitHub user token once to `POST /auth/github`; the worker verifies it with `GET /user`, discards it, and issues an `ownit_…` session token (SHA-256 stored, 90 days). Every `/api/*` route needs one. Repo routes check push access (admin, maintain, write) with the installation token, cached for 5 minutes per isolate. Registration needs the App installed.
- Debrief sessions are bound to the user who started them; a push owned by another user cannot be taken over.
- `DEV_LOCAL_TRUST=1` (a var, not a secret; `npm run dev` sets it) skips the push-access check only for requests to localhost/127.0.0.1. `worker/scripts/dev-login.mjs` mints a local session.
- The hook script exits 0 unless `pre-push.local` fails. Coding-agent env vars (`CLAUDECODE`, `CI`, …) count as no TTY. The Y/n prompt times out after 120 s and becomes pending.
- Test seam: `OWNIT_TTY_DEVICE` replaces `/dev/tty` in the hook script.

## Ask the user before

- Deploying to Cloudflare or running any remote `wrangler` / D1 command (their account).
- Anything that touches the hackathon rules (required models, submission format).

## Running locally

```sh
npm install                      # at the repo root (npm workspaces)
cp .env.example .env            # then fill in SESSION_SECRET
cd worker && npx wrangler d1 migrations apply ownit --local
npm run dev -- --test-scheduled  # add --var MODEL_BACKEND:fixture for the offline fake model
# in another terminal:
cd worker && node scripts/dev-login.mjs yourlogin | node ../cli/dist/index.js login --with-token --server http://127.0.0.1:8787
cd ../cli && npm run build
node dist/index.js init --repo you/test-repo   # in a test repo
node dist/index.js interview --range HEAD~1..HEAD
npx wrangler d1 execute ownit --local --file seed/demo.sql   # optional demo data (repo demo/seeded)
npm test                         # at the root: worker + cli
```
