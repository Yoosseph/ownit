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

- Refactor for readability (2026-10-22, merged to main and deployed as worker version 4b4df03d): behavior kept identical, checked by the test suites plus a temporary golden capture of every route, log line, command output and real hook push, compared against the pre-refactor code. Layout rules are in CONTRIBUTING ("Code conventions"). Found while reading and fixed in the 2026-10-28 pass below: `POST /api/interview/answer` called `modelFor` outside its try, so a missing or unknown key returned 500 instead of the 502 `provider_error` that `/start` returns.
- Hand-in pass (2026-10-28, branch `refactor-hand-in`): the `/answer` key fix above (with a test), helpers only their own module uses are no longer exported (knip clean), `vite` declared as a worker dev dependency, `npm audit fix` for dev tooling (0 advisories; `allowScripts` follows the new workerd), and doc commands no longer carry inline `#` comments. Not changed: nothing prunes expired `sessions`, old `rate_limits` rows or past `demo_usage` days (no cron since the expiry job was removed).

- Stats model changed 2026-10-22 (user's request, departs from SPEC.md): the badge reads `Ownit | Verified N% | Unverified M%`, verified commits over all tracked commits. Skipped, pending and provider_error commits are all unverified, and every non-verified push stays debriefable (`/api/pushes/open` includes skipped; only `verified` is final). The 24-hour expiry cron is gone (`crons = []` in wrangler.toml unregisters it). The CLI hook now re-asks for skipped pushes; that part needs a new `getownit` release, but older CLIs already get the catch-up list from the server.
- Merge-button commits ignored 2026-10-23 (PR #2): the webhook drops commits by `web-flow` whose message starts `Merge pull request #N from ` or `Merge branch '…' into `. Squash/rebase merges still count (open question). Stats model and this fix deployed 2026-10-23 as worker version ed173947. The pending push for merge commit b088a21 (from before the fix) is still open in production. `getownit@0.1.1` (hook re-asks for skipped pushes) published by the user 2026-10-23. 0.1.2 adds a "Did you mean" hint for mistyped commands, and `prepublishOnly` now builds and tests before every `npm publish`.
- Repo presentation 2026-10-23: description, homepage (the repo's own Ownit page) and topics set with `gh repo edit`; tags and releases v0.1.0 (57c9dc0) and v0.1.1 (15e6b6c). Branch `release-and-deploy-workflows` adds `release.yml` (tag v* -> npm publish via Trusted Publishing + GitHub release), `deploy.yml` (main -> migrations + wrangler deploy, skipped until CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID secrets exist) and Dependabot. Both need one-time setup by the user (CONTRIBUTING, "Releasing and deploying"). Once Deploy has secrets, merging to main deploys without asking.
- Repo page cleanup and page settings (2026-10-23, branch `page-settings`): one summary card instead of four, author table only with 2+ authors, short commit links, "Not debriefed yet" on empty pending/skipped pushes, "Showing the latest N of M". Migration 0002 adds `repos.show_questions` (default 1), `repos.show_answers` (default 0) and `questions.answer`. `ownit page [questions|answers on|off]` (since renamed `ownit settings`; `page` stays an alias), changing needs GitHub admin or maintain. Passing answers are stored only while a public repo shows them; turning answers off deletes them. Private repos never show either. **Deploy needs `wrangler d1 migrations apply ownit --remote` before `wrangler deploy`.**
- Interview picker and two-choice prompt (2026-10-23, branch `interview-picker`, part of the unreleased 0.1.2): `ownit interview` lists waiting pushes (status, short SHA, date, last commit subject, `+N more`) and debriefs only the one picked (number, Enter = newest, `a` = all, `q` = quit), then shows the rest again. `--all` keeps the old run-through. The hook asks `Debrief now? [Y/n]`; `s` there now means later (pending). `s` during a debrief stops without recording anything (outcome reason `later`) and returns to the list. The CLI no longer creates `skipped`; the server still accepts it from older CLIs.
- Earlier commits / backfill (2026-10-23, branch `settings-and-backfill`, built on `interview-picker`): migration 0003 adds `repos.allow_backfill` (default 0) and `commits.backfilled`. `ownit settings earlier on|off` (admin or maintain; allowed on private repos). When a push is verified in such a repo, `creditBackfill` (routes/interview.ts) checks the head commit exists via `GitHub.commitExists` and marks its commits that never landed after tracking (`pushed_at` null or before `tracked_since`) as `backfilled`; stats count `backfilled = 1 AND status = 'verified'` too, so earlier work only ever adds verified commits. The answer response carries `earlier_credited`. `--range` also takes a single SHA. The page tags such pushes "earlier work" and its header follows the setting. Page dark colors changed to the user's palette (#0f1011 bg, #151718 cards).
- Released 2026-10-23: `getownit@0.1.2` by the Release workflow (Trusted Publishing validated); worker version 4768a31f by the Deploy workflow. 0.1.3 (branch `clearer-cli-help`): `ownit help <command>` and `ownit <command> --help` with examples (`details` on each COMMANDS entry), a Get started line in `ownit help`, aliases `interviews` and `setting`, a hint after a mistyped option, "Add on or off" for `ownit settings questions`, a clear error for an unknown commit in `--range`, and the "saved answers are deleted" note only when answers actually get hidden. Open question: cap how many earlier commits one debrief can credit (suggested 20).

## Settled decisions

- npm package `getownit`; the command is `ownit` (`ownit` on npm is an unrelated 2022 package).
- Models, set in `worker/wrangler.toml`: Nebius `nvidia/Nemotron-3.5-Super-VL` at `https://api.tokenfactory.nebius.com/v1/`, thinking off (2026-10-30: Nebius emailed that `nvidia/nemotron-3-super-120b-a12b`, the earlier Nebius model, leaves Serverless on 2026-11-09; switched at the user's request; the live check passed 8/8 on Nebius that day, about 0.5s per call, though the catalog showed status `error` for 3.5 Super VL); NVIDIA `nvidia/nemotron-3.5-super-vl-120b-a12b` with `chat_template_kwargs.enable_thinking=false` (2026-10-23: NVIDIA's free endpoint answered 404 "Function ... Not found for account" for the 3.0 model on the user's key; 3.5 Super returned clean JSON in ~3s). NVIDIA requests are hedged (`firstResponse` in model.ts: second copy after 3s, first answer wins, 10s cap) because the free endpoint stalls at random; measured 20/20 answered, median 0.9s, max 4.9s, and the live check passed 8/8 on NVIDIA. 3.5 Lightning was rejected: it passed "idk" and both injection answers. Since 0.1.4 / branch `steadier-nvidia`: copies at 3s and 6s, and at once after a 5xx or network error (`hedgesMs`); the CLI's `withRetry` retries an `unavailable` provider error once by itself, then asks "Try again? [Y/n]", keeping the session. 0.1.5 (branch `model-command`): `GET /models` (public) lists each provider's model from `ProviderSpec.model`; `ownit model` (aliases `plan`, `currentplan`, `models`) and `ownit whoami` show it. Requests use `response_format: json_object`; `<think>` blocks are stripped.
- NVIDIA as a second provider for people without a Nebius account (2026-10-21): same model ID at `https://integrate.api.nvidia.com/v1/` (confirmed in its public `/v1/models` list). The user picks the provider in `ownit key set` (menu, or `ownit key set nvidia`); config saves `provider` + `apiKey` (the old `nebiusKey` still reads as Nebius). The CLI sends `x-model-key` (was `x-nebius-key`) and `x-model-provider` (missing means nebius, unknown means `provider_error` / `unknown_provider`). Providers are a `PROVIDERS` table in `worker/src/model.ts` and `cli/src/providers.ts`, so Claude/OpenAI can be added later (an OpenAI-compatible one is one `openAiCompatible(...)` line; others get their own `create` function). The CLI refuses a key with another provider's prefix (`nvapi-` saved as Nebius). The interactive menu has not been run in a real terminal yet; piped `key set` is covered in `cli/test/config.test.ts`. `DEMO_NEBIUS_KEY` stays Nebius. **Not live-tested yet**: run `NVIDIA_API_KEY=nvapi-… scripts/live-injection-check` to confirm NVIDIA accepts `response_format: json_object`.
- Question references are sealed into an AES-GCM token (`worker/src/seal.ts`, key from `SESSION_SECRET`) that the CLI carries between requests, so the worker stores no references and the CLI cannot read them.
- The CLI resends the diff with each answer so the follow-up writer can use it without the worker storing code.
- Tests run D1 on a `node:sqlite` shim (`worker/test/helpers/d1.ts`) with the real migrations.
- `MODEL_BACKEND = "fixture"` switches to an offline fake model (`worker/src/fixtureModel.ts`).
- Extra columns beyond the spec's data model: `repos.private`, `pushes.check_run_id`, plus `sessions`, `rate_limits`, `demo_usage` tables.
- Repos must be registered (`POST /api/repos`, called by `ownit init`) before debrief routes accept them. Until milestone 6, API routes have no auth.
- Check runs (since 2026-10-28, user's request): always `completed` / `success`, so no orange "in progress" dot and nothing blocks a merge; verified is titled "Ownit: verified", every other status "Ownit: not debriefed yet". Unverified work shows on the badge and repo page. Earlier: verified = success, skipped = neutral, pending and provider_error = in_progress. They are created only after the webhook confirms the head commit landed (`commits.pushed_at`).
- Unmatched commits in a push webhook become a new pending push owned by the sender.
- Stats count only commits GitHub confirmed (`pushed_at` set, on or after `tracked_since`), so a repo without the App shows "no pushes yet". provider_error pushes never expire; only pending ones do.
- Private repos: the public page hides question text (stats and statuses still show), and page settings are refused.
- Auth: the CLI runs GitHub's device flow itself (client ID from `GET /auth/config`), because github.com/login/* returns 429 to Cloudflare Workers' shared IPs. It sends the GitHub user token once to `POST /auth/github`; the worker verifies it with `GET /user`, discards it, and issues an `ownit_…` session token (SHA-256 stored, 90 days). Every `/api/*` route needs one. Repo routes check push access (admin, maintain, write) with the installation token, cached for 5 minutes per isolate; changing page settings needs admin or maintain. Registration needs the App installed.
- Debrief sessions are bound to the user who started them; a push owned by another user cannot be taken over.
- `DEV_LOCAL_TRUST=1` (a var, not a secret; `npm run dev` sets it) skips the push-access check only for requests to localhost/127.0.0.1. `worker/scripts/dev-login.mjs` mints a local session.
- The hook script exits 0 unless `pre-push.local` fails. Coding-agent env vars (`CLAUDECODE`, `CI`, …) count as no TTY. The Y/n prompt times out after 120 s and becomes pending.
- Test seam: `OWNIT_TTY_DEVICE` replaces `/dev/tty` in the hook script.

## Ask the user before

- Deploying to Cloudflare or running any remote `wrangler` / D1 command (their account).
- Anything that touches the hackathon rules (required models, submission format).

## Running locally

At the repo root (npm workspaces), install and create `.env`, then fill in `SESSION_SECRET`:

```sh
npm install
cp .env.example .env
```

Apply the migrations and start the worker. Add `--var MODEL_BACKEND:fixture` to `npm run dev` for the offline fake model.

```sh
cd worker
npx wrangler d1 migrations apply ownit --local
npm run dev
```

In another terminal, build the CLI and log it in to the local worker:

```sh
cd cli
npm run build
node ../worker/scripts/dev-login.mjs yourlogin | node dist/index.js login --with-token --server http://127.0.0.1:8787
```

Then, inside a test repo, set it up and debrief the last commit:

```sh
node path/to/ownit/cli/dist/index.js init --repo you/test-repo
node path/to/ownit/cli/dist/index.js interview --range HEAD~1..HEAD
```

Optional demo data (repo `demo/seeded`), from `worker/`:

```sh
npx wrangler d1 execute ownit --local --file seed/demo.sql
```

Run every test from the repo root:

```sh
npm test
```
