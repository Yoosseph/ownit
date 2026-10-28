# Contributing to Ownit

Thanks for helping. Bug reports, prompt improvements, docs fixes and code are all welcome.

## Ground rules

- Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security problems go through a [private report](SECURITY.md), not a public issue.
- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- By contributing, you agree that your work is released under the [MIT License](LICENSE).

## Set up

You need Node 22.5 or newer (the worker tests use `node:sqlite`) and git. `npm test` runs the
worker and CLI tests, fully offline.

```sh
git clone https://github.com/Yoosseph/ownit.git
cd ownit
npm install
npm test
npm run typecheck
```

`npm test` never calls a real model or GitHub: the worker uses a fixture model and a `node:sqlite`
stand-in for D1, and the CLI tests run real `git push`es against a fake server.

To run the whole thing locally (worker, CLI and a test repo), follow
[Self-hosting](docs/DETAILS.md#self-hosting) and the steps in [docs/HANDOFF.md](docs/HANDOFF.md#running-locally).

## Where things are

| Path | What |
| --- | --- |
| `cli/` | The `getownit` npm package: the `ownit` command and the pre-push hook. |
| `worker/` | The Cloudflare Worker: API, model calls, GitHub App, badge and page. |
| `prompts/` | Every prompt sent to Nemotron. Edit them here; see [prompts/README.md](prompts/README.md). |
| `docs/` | How it works ([ARCHITECTURE](docs/ARCHITECTURE.md), [DETAILS](docs/DETAILS.md)), the spec, the demo script. |

## Making a change

1. Branch from `main`.
2. Add or update tests with the change. Bugs get a test that fails before the fix.
3. Run `npm test` and `npm run typecheck`.
4. If you changed a prompt, also run `scripts/live-injection-check` with your own Nebius or NVIDIA
   key and paste the result in the PR. Injected answers must still fail and rough honest answers
   must still pass.
5. Open a pull request and fill in the template.

Style: match the code around you. TypeScript strict mode, small functions, comments that explain
why rather than what. Commit messages say what the change does in plain words ("Keep accepting the
older x-nebius-key header").

## Things to keep true

- **A push is never blocked.** The hook exits 0 whatever happens.
- **No code or keys are stored**, on the server or in logs. Answers are stored only for public repos whose admins turned them on. See [Privacy](docs/DETAILS.md#privacy).
- **The server picks the model and endpoint**, never the client.
- **The worker stays compatible with older CLIs**, since people update the CLI on their own schedule.
- **Grading is generous.** Ownit is a learning habit, not an exam.

## Code conventions

- **Routes** (`worker/src/routes/`) never import each other; what they share is in `routes/shared.ts`.
  They hold no SQL: queries on the core tables live in `worker/src/db.ts`.
- **Prompts** live in `prompts/*.txt`. Code never depends on their wording: the offline fixture
  model answers by each prompt's `task`.
- **Public URLs** (repo page, badge, App install) are built in `worker/src/links.ts`.

## Adding things

- **A model provider:** an entry in `PROVIDERS` in `worker/src/model.ts` and in `cli/src/providers.ts`,
  plus its endpoint and model in `worker/wrangler.toml`. An OpenAI-compatible provider is one line
  (`openAiCompatible(...)`); one with a different API gets its own `create` function.
- **A CLI command:** a file in `cli/src/commands/` and an entry in the `COMMANDS` table in
  `cli/src/index.ts`. Its help lines go in that entry, so `ownit help` lists it.
- **A worker route:** a router in `worker/src/routes/`, mounted in `worker/src/app.ts`.

## Releasing and deploying (maintainers)

Three workflows live in `.github/workflows/`:

- **CI** (`ci.yml`) typechecks and tests both packages on Node 22 and 24, on every pull request
  and every push to `main`.
- **Release** (`release.yml`) runs when a tag like `v0.1.3` is pushed. It checks that the tag
  matches `cli/package.json`, runs the tests, publishes `getownit` to npm with provenance, and
  creates the GitHub release with generated notes. To cut a release: bump `version` in
  `cli/package.json` (and `package-lock.json`), merge it, then
  `git tag -a v0.1.3 -m "getownit 0.1.3" && git push origin v0.1.3`.
- **Deploy** (`deploy.yml`) runs when worker or prompt changes reach `main`. It tests the worker,
  applies D1 migrations, then deploys it, and shows up under **Deployments** as `production`.

One-time setup:

- **npm:** on npmjs.com, open `getownit` → Settings → Trusted publishing, and add GitHub Actions
  with owner `Yoosseph`, repository `ownit`, workflow `release.yml`. No npm token is stored in
  GitHub.
- **Cloudflare:** create an API token with the "Edit Cloudflare Workers" template plus
  D1 edit access, then add the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  Until both exist, the deploy workflow skips itself with a notice.
