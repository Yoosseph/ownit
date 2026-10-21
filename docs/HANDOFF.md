# Handoff

Read this first, then [SPEC.md](SPEC.md). Keep this file current after each milestone.

## Progress

| Milestone | Status | Commit |
| --- | --- | --- |
| 1. Worker skeleton, D1 schema, Nebius client | Done, verified with the fixture model. **Live Nemotron check not run yet** (waiting on a Nebius key). | c033546 |
| 2. CLI debrief end to end | Done: `ownit interview --range A..B` against local `wrangler dev` (fixture model): fail, feedback, follow-up, pass, recorded in D1. | c9fcaab |
| 3. Pre-push hook | Done: Y, n, s verified with real `git push` in a ConPTY reading `/dev/tty`; no-TTY, unreachable worker, chained hook covered by `cli/test/hook.test.ts`. | f9649d3 |
| 4. GitHub App, webhook, check runs | Next | |
| 5. Cron, stats, badge, public page | | |
| 6. Login and permissions | | |
| 7. Docs | | |

Pending live checks (need a Nebius key in `worker/.dev.vars` as `DEMO_NEBIUS_KEY`, or `NEBIUS_API_KEY` for the CLI): milestone 1 curl against Nemotron, milestone 2 against Nemotron, and `scripts/live-injection-check` (not written yet).

## Settled decisions

- npm package `getownit`; the command is `ownit` (`ownit` on npm is an unrelated 2022 package).
- Model `nvidia/nemotron-3-super-120b-a12b` at `https://api.tokenfactory.nebius.com/v1/` (Nebius Token Factory), set in `worker/wrangler.toml`. Requests use `response_format: json_object`; `<think>` blocks are stripped.
- Question references are sealed into an AES-GCM token (`worker/src/seal.ts`, key from `SESSION_SECRET`) that the CLI carries between requests, so the worker stores no references and the CLI cannot read them.
- The CLI resends the diff with each answer so the follow-up writer can use it without the worker storing code.
- Tests run D1 on a `node:sqlite` shim (`worker/test/helpers/d1.ts`) with the real migrations.
- `MODEL_BACKEND = "fixture"` switches to an offline fake model (`worker/src/fixtureModel.ts`).
- Extra columns beyond the spec's data model: `repos.private`, `pushes.check_run_id`, plus `sessions`, `rate_limits`, `demo_usage` tables.
- Until milestone 6, API routes have no auth and `upsertRepo` auto-registers repos on first use.
- The hook script exits 0 unless `pre-push.local` fails. Coding-agent env vars (`CLAUDECODE`, `CI`, …) count as no TTY. The Y/n prompt times out after 120 s and becomes pending.
- Test seam: `OWNIT_TTY_DEVICE` replaces `/dev/tty` in the hook script.

## Ask the user before

- Deploying to Cloudflare or running any remote `wrangler` / D1 command (their account).
- Anything that touches the hackathon rules (required models, submission format).

## Running locally

```sh
npm install                      # at the repo root (npm workspaces)
cp worker/.dev.vars.example worker/.dev.vars   # then fill in SESSION_SECRET
cd worker && npx wrangler d1 migrations apply ownit --local
npx wrangler dev --var MODEL_BACKEND:fixture   # or omit the var to use Nebius
cd ../cli && npm run build
OWNIT_SERVER=http://127.0.0.1:8787 node dist/index.js interview --range HEAD~1..HEAD
npm test                         # at the root: worker + cli
```
