# Ownit in detail

The [README](../README.md) covers setup and use. This page has everything else.

## How a push is recorded

| Status | Meaning | On the badge |
| --- | --- | --- |
| **verified** | Every question passed. All commits in the push are verified. | Yes |
| **pending** | No debrief yet. This covers `n` at the prompt, `s` during a debrief, no terminal (GUI clients, coding agents, CI), `--no-verify`, edits on github.com, and the hook not installed. Run `ownit interview`. | Unverified |
| **skipped** | Only from CLI versions before 0.1.2, which had an `s=skip` choice. Treated like pending. | Unverified |
| **provider_error** | Nebius or NVIDIA rejected the key, ran out of credit, or was down. Retry with `ownit interview`. | Unverified |

How a push becomes a debrief:

1. The pre-push hook works out which commits are being pushed. Because git uses the hook's stdin
   for the ref list, it reads your answers from `/dev/tty`.
2. The CLI builds the diff locally and filters it (see [What the model sees](#what-the-model-sees)).
   It sends the diff, the commit messages, and your API key to the Ownit worker.
3. The worker makes the model calls and records the push and its questions.
4. When GitHub's push webhook arrives, the worker matches the landed commits to the debrief by
   SHA and sets the check run. It always completes green, titled **Ownit: verified** or
   **Ownit: not debriefed yet**, so it never blocks a merge. Commits that
   landed without a debrief become a pending push. The merge commit GitHub's **Merge pull request**
   or **Update branch** button makes is ignored, because it adds no code of its own.
5. Nothing expires. Unverified pushes wait in `ownit interview`, which lists them by commit
   message so you pick the one to debrief.

The number of questions grows with the size of the push, counted as changed lines in non-ignored
files: under 50 → 1 question, 50–300 → 2, over 300 → 3. They come in this order:

1. **why**: the purpose of the change
2. **how**: the approach at a high level
3. **next**: what could break, a limitation, or an improvement

Questions name the feature or area, never a file path or function name.

## Bring your own key

Ownit runs on **your own account**. Create a key in
[Nebius Token Factory](https://tokenfactory.nebius.com/), or at [build.nvidia.com](https://build.nvidia.com/)
if you have no Nebius account, then run `ownit key set` and pick the provider (or name it:
`ownit key set nebius`, `ownit key set nvidia`; piping a key needs the name). The key is
saved in `~/.ownit/config.json` (mode 600) and sent only with debrief requests. The worker uses it
for that request and then drops it. It never stores or logs the key. A debrief usually costs
under a cent, and a few cents at most for a large push with several follow-ups.

The server chooses the endpoint and model for each provider, and the client cannot change them.
Both run NVIDIA's Nemotron Super (120B parameters, 12B active): `nvidia/nemotron-3-super-120b-a12b`
on Nebius at `https://api.tokenfactory.nebius.com/v1/`, and `nvidia/nemotron-3.5-super-vl-120b-a12b`
(thinking off) on NVIDIA at `https://integrate.api.nvidia.com/v1/`, because NVIDIA's free endpoint
no longer serves the 3.0 model to newer accounts. NVIDIA's free endpoint usually answers in about
a second but sometimes stalls, so the worker sends another copy of a request that hasn't answered
after 3 and 6 seconds (or right away after a server error), uses whichever answers first, and gives
up after 10 seconds. If the model still doesn't answer, the CLI tries once more by itself and then
asks before trying again, so the debrief in progress is kept.
`NVIDIA_API_KEY` or `NEBIUS_API_KEY` in the environment overrides the saved key.

If a provider says your key's account can't use the model, it answered `404 ... Not found for
account`: the key works, but its account isn't enabled for that hosted model. Make a new key from
the model's own page on build.nvidia.com, ask on NVIDIA's developer forum, or use the other
provider.

Adding a provider means an entry in `PROVIDERS` in both `worker/src/model.ts` and
`cli/src/providers.ts`, plus its endpoint and model in `worker/wrangler.toml`. Both current providers
use the OpenAI-compatible chat API, so each is one `openAiCompatible(...)` line; a provider with a
different API (Anthropic's, for example) gets its own `create` function with its own client.

Hackathon judges can try Ownit without a key. A server may set an optional shared
`DEMO_NEBIUS_KEY`, which has a daily cap and is used only when a request carries no key.

## Privacy

- **Code is never stored.** The diff exists only for the duration of a request. It goes to the
  model on **your** Nebius or NVIDIA account and is then discarded.
- **Your answers are not stored by default.** Each answer goes to the grader and is then discarded.
  The one exception is a public repo whose admins turned answers on (`ownit settings answers on`):
  then the answer that passed each question is kept and shown on the repo page, and the CLI says
  so before you answer. Failed answers are never kept. Turning answers off deletes the saved ones.
- **Keys are never stored or logged.** Logs hold metadata only: repo, status, timings.
- **What is stored:** repos (owner, name, App installation, tracked-since date), GitHub user IDs and
  logins, pushes (SHAs, status, timestamps), commit SHAs and authors, and each question's text with
  pass/fail and attempt count, plus passing answers where the repo shows them.
- **Answer keys stay sealed.** Each question has a reference describing a good answer. It travels
  between requests inside an encrypted token that only the server can open. It is never stored,
  and your CLI cannot read it.
- **GitHub tokens are not kept.** Login uses GitHub's device flow. The worker reads your identity,
  discards the GitHub token, and issues its own session token, storing only a hash of it. Push
  access is checked with the GitHub App's installation token.
- **Public page:** `/<owner>/<repo>` shows stats, recent pushes and, by default, question text. It
  never shows code. Repo admins and maintainers choose what else it shows with `ownit settings`:
  `ownit settings questions off` hides the questions, `ownit settings answers on` shows passing answers.
  Private repos never show questions or answers.

## What the model sees

The CLI drops lockfiles, `node_modules`, `dist`/`build` and similar output folders, minified files,
binaries, and generated files (files marked `@generated` or `DO NOT EDIT`, protobuf output, and so
on). It also drops anything listed in a `.ownitignore` at the repo root, which uses `.gitignore`
syntax:

```gitignore
# .ownitignore
fixtures/
*.snap
docs/api/
```

The diff is capped at about 60,000 characters. Every file header is kept, the remaining space is
shared fairly between files, and the model is told when the diff was truncated.

### Prompt-injection design

Three separate calls, and **the grader never sees the code**:

1. **Question writer** reads the commits and diff and writes the questions, each with a reference
   answer.
2. **Grader** reads one question, its reference, and your answer.
3. **Follow-up writer** reads the diff, the missed question, its reference, and the grader's
   feedback. It never sees your raw answer.

An instruction hidden in a code comment can only reach the question writers, and the worst it can
do there is make the questions easier. All data sits inside tags that it cannot close (`</diff>` in
your code is escaped). Every reply is strict JSON, validated against a schema; an invalid reply
is retried once, and a second failure records a provider error.
`scripts/live-injection-check` runs these attacks against the real model.

## The badge

```markdown
[![Ownit](https://<server>/badge/<owner>/<repo>.svg)](https://<server>/<owner>/<repo>)
```

It reads, for example, `Ownit | Verified 55% | Unverified 45%`, with the verified part colored by
percentage. The percentages are commit-weighted: verified commits over all tracked commits. A commit
is unverified until its push passes a debrief, whenever that happens; putting it off never
locks it out. Only commits GitHub confirmed after the repo's "tracked since" date count. History before Ownit doesn't count.

### Earlier commits (optional)

Repo admins and maintainers can let older work count: `ownit settings earlier on`. Then anyone with
push access can debrief commits from before tracking began with `ownit interview --range A..B`, or
`--range <sha>` for one commit. Once that debrief passes, those commits count as verified and the
push shows on the page as **earlier work**. They never count as unverified, so turning this on can
only raise the percentage. The server checks that the head commit exists in the repo on GitHub, so
only real history can be credited. Credit goes to the commit's GitHub author when Ownit knows it,
otherwise to whoever debriefed it. Turning the setting off stops new credit; commits already
credited stay.
Copy the snippet from your repo's page.

### Is a badge real?

Ownit is open source, so anyone can run their own copy, and a copy can show any number it likes.
To check a badge:

- **Click it.** It opens the repo's page on the server that made it. The official server is
  `https://ownit.ownit-worker.workers.dev`; any other address is a copy.
- **Look at the check run** on a commit in GitHub. Official ones come from the **ownit-app** GitHub
  App. GitHub App names are unique, so a copy has to use a different one.
- **Look the repo up yourself** at `https://ownit.ownit-worker.workers.dev/<owner>/<repo>`. If it
  isn't there, the official server never tracked it.

## Hook managers and custom hooks paths

- **Plain repos:** `ownit init` writes `.git/hooks/pre-push`.
- **`core.hooksPath`:** the hook goes into that directory, with the same chaining.
- **husky:** husky owns the hooks directory, so `ownit init` prints three lines to append to
  `.husky/pre-push`.

To push once without the prompt, use `OWNIT_SKIP=1 git push`. The push then shows up as pending.

## Self-hosting

The server is one Cloudflare Worker with a D1 database. Clone and install, then create the
database:

```sh
git clone https://github.com/<you>/ownit && cd ownit && npm install
cd worker
npx wrangler d1 create ownit
```

Paste the `database_id` it prints into `wrangler.toml`, then apply the migrations:

```sh
npx wrangler d1 migrations apply ownit --remote
```

Set the session secret (any long random string, for example from `openssl rand -hex 32`) and deploy:

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

Then create your own GitHub App ([docs/github-app.md](github-app.md)), put its ID, slug, and
client ID in `wrangler.toml`, set the `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`
secrets, and deploy again. Optionally set `DEMO_NEBIUS_KEY` and `DEMO_DAILY_CALL_CAP`.
Point the CLI at your server with `ownit login --server https://ownit.<you>.workers.dev`.

When you update a server you already run, apply new migrations before deploying:
`npx wrangler d1 migrations apply ownit --remote`, then `npx wrangler deploy`.

For local development, see [docs/HANDOFF.md](HANDOFF.md#running-locally). `MODEL_BACKEND =
"fixture"` gives an offline fake model.

## Limitations

- **A learning tool, not proof of authorship.** A pass means someone at the keyboard could explain
  the change roughly. It doesn't prove who wrote the code, and nobody should treat a badge as a
  hiring signal on its own.
- Grading is deliberately generous, and determined cheating is possible. That's by design: Ownit
  invests in encouragement, not anti-cheat.
- The interactive prompt needs a terminal. GUI clients, coding agents, and CI produce pending
  pushes that you finish with `ownit interview`. On Windows, use Git Bash in Windows Terminal. If
  the prompt ever gets no input, it gives up after 2 minutes and the push is pending.
- Only GitHub is supported. Pushes count once the GitHub App is installed.
- Model output varies. Questions are usually specific, but occasionally generic.

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for setup and how to send a change. You need Node 22.5+.

Run the worker and CLI tests offline (fixture model, `node:sqlite` D1 shim):

```sh
npm install
npm test
```

Run the live prompt-injection checks against Nemotron (needs a Nebius or NVIDIA key):

```sh
scripts/live-injection-check
```

The layout: `cli/` is the `getownit` npm package, `worker/` is the Cloudflare Worker, and `docs/`
holds the guides. [docs/SPEC.md](SPEC.md) is the full spec and
[docs/demo.md](demo.md) is the demo script.

## Credits

- [NVIDIA Nemotron](https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/)
  writes and grades the debriefs, served by [Nebius Token Factory](https://tokenfactory.nebius.com/).
  Built for the Nebius x NVIDIA Global AI Hackathon.
- [parthh01/sphinx](https://github.com/parthh01/sphinx) (MIT): Ownit's hook chaining (keep the
  existing hook and run it first), `core.hooksPath` detection, recursion guard, and launcher
  fallback follow its approach.
- Related projects that shaped the thinking:
  [shekharrs/explainit](https://github.com/shekharrs/explainit), a multiple-choice quiz on staged
  changes, and [bhaskargurram-ai/proofcheck](https://github.com/bhaskargurram-ai/proofcheck),
  "evidence, not authorship" for pull requests.
