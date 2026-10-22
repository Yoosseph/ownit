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
4. ~~`repository` in `cli/package.json`~~ Done 2026-10-21. `DEFAULT_SERVER` already points to the deployed URL. Published 2026-10-22 as `getownit@0.1.0` (npm account `zeruxe`, security-key 2FA). A clean `npm install getownit` gets 0.1.0 and `ownit --version` works. The user runs `npm publish` themselves (Claude's attempt was blocked by the permission classifier); npm asks them to approve each publish in the browser. npm's first publish also left a public `0.0.0-stage` placeholder (staged-publishing machinery); it is a prerelease, so installs and ranges skip it.
5. Hackathon rules (from summaries; the official Devpost rules page blocked fetching, so the user should confirm there): public repo with an open-source license (MIT stays), an NVIDIA open model on Nebius (met), a working demo URL, a YouTube video, a description, and tool feedback. Deadline Oct 30, 2026, 10:00 PT. The GitHub repo is public (2026-10-21). Judges need `DEMO_NEBIUS_KEY` set to try it without a key.
6. ~~Redeploy~~ Done 2026-10-21 (version 3d7070d8): lenient grading and the public page footer are live.
7. ~~Deploy NVIDIA support~~ Done 2026-10-22 (version 6c042029): pushed and deployed with the provider choice. The worker still accepts the old `x-nebius-key` header as a Nebius key. **Still needs a live check with an `nvapi-` key** (and the interactive `ownit key set` menu run once in a real terminal). `getownit` is not on npm yet.
8. Stretch (only after the above): late-pass and backfill labels, trivial-push exemption, per-author badges, global `core.hooksPath` install.

- Prompts live in `prompts/*.txt` at the repo root; `worker/src/prompts.ts` imports them (Wrangler's default Text rule; `worker/test/helpers/textFiles.ts` does the same for vitest). Edit prompts only there.
- Grading softened 2026-10-22 after a real debrief failed a fair README answer: one-thing questions, docs-only pushes get a simple purpose question, a pass gets one short line, follow-ups get easier. Live check covers that answer (8/8 passing). Deployed 2026-10-22 (version 55af83e0).
- Open-source files added 2026-10-22: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY (private vulnerability reporting is enabled on the repo), issue/PR templates, CI (`.github/workflows/ci.yml`, Node 22 and 24, green).

- Refactor for readability (2026-10-22, merged to main and deployed as worker version 4b4df03d): behavior kept identical, checked by the test suites plus a temporary golden capture of every route, log line, command output and real hook push, compared against the pre-refactor code. Layout rules are in CONTRIBUTING ("Code conventions"). Found while reading, deliberately not changed: `POST /api/interview/answer` calls `modelFor` outside its try, so a missing or unknown key there returns 500 instead of the 502 `provider_error` that `/start` returns.

- Stats model changed 2026-10-22 (user's request, departs from SPEC.md): the badge reads `Ownit | Verified N% | Unverified M%`, verified commits over all tracked commits. Skipped, pending and provider_error commits are all unverified, and every non-verified push stays debriefable (`/api/pushes/open` includes skipped; only `verified` is final). The 24-hour expiry cron is gone (`crons = []` in wrangler.toml unregisters it). The CLI hook now re-asks for skipped pushes; that part needs a new `getownit` release, but older CLIs already get the catch-up list from the server.
- Merge-button commits ignored 2026-10-23 (PR #2): the webhook drops commits by `web-flow` whose message starts `Merge pull request #N from ` or `Merge branch '…' into `. Squash/rebase merges still count (open question). Stats model and this fix deployed 2026-10-23 as worker version ed173947. The pending push for merge commit b088a21 (from before the fix) is still open in production. `getownit@0.1.1` (hook re-asks for skipped pushes) still needs `npm publish` by the user.

## Settled decisions

- npm package `getownit`; the command is `ownit` (`ownit` on npm is an unrelated 2022 package).
- Model `nvidia/nemotron-3-super-120b-a12b` at `https://api.tokenfactory.nebius.com/v1/` (Nebius Token Factory), set in `worker/wrangler.toml`. Requests use `response_format: json_object`; `<think>` blocks are stripped.
- NVIDIA as a second provider for people without a Nebius account (2026-10-21): same model ID at `https://integrate.api.nvidia.com/v1/` (confirmed in its public `/v1/models` list). The user picks the provider in `ownit key set` (menu, or `ownit key set nvidia`); config saves `provider` + `apiKey` (the old `nebiusKey` still reads as Nebius). The CLI sends `x-model-key` (was `x-nebius-key`) and `x-model-provider` (missing means nebius, unknown means `provider_error` / `unknown_provider`). Providers are a `PROVIDERS` table in `worker/src/model.ts` and `cli/src/providers.ts`, so Claude/OpenAI can be added later (an OpenAI-compatible one is one `openAiCompatible(...)` line; others get their own `create` function). The CLI refuses a key with another provider's prefix (`nvapi-` saved as Nebius). The interactive menu has not been run in a real terminal yet; piped `key set` is covered in `cli/test/config.test.ts`. `DEMO_NEBIUS_KEY` stays Nebius. **Not live-tested yet**: run `NVIDIA_API_KEY=nvapi-… scripts/live-injection-check` to confirm NVIDIA accepts `response_format: json_object`.
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
