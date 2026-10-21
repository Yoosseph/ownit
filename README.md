# Ownit

[![Ownit](https://ownit.ownit-worker.workers.dev/badge/Yoosseph/ownit.svg)](https://ownit.ownit-worker.workers.dev/Yoosseph/ownit)
[![CI](https://github.com/Yoosseph/ownit/actions/workflows/ci.yml/badge.svg)](https://github.com/Yoosseph/ownit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![NVIDIA Nemotron](https://img.shields.io/badge/NVIDIA-Nemotron-76B900?logo=nvidia&logoColor=white)](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b)
[![Nebius Token Factory](https://img.shields.io/badge/Nebius-Token%20Factory-052B42)](https://tokenfactory.nebius.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Own the code you ship.** After each `git push`, Ownit asks you one to three short questions about
the change, right in your terminal: why you made it, how it works, and what could come next.
NVIDIA Nemotron (on Nebius or NVIDIA) writes the questions and grades your answers.

```text
$ git push
Ownit (2 commits to octo/shop) Debrief now? [Y/n/s=skip] y

Question 1/2 (why)
  Why does checkout now retry some failed card payments instead of failing the order right away?
> so temporary card errors dont lose the sale
✓ Passed.

Question 2/2 (how)
  How does the retry decide when to give up?
> permanent declines fail right away, temporary ones retry up to 3 times
✓ Passed.

✓ Push verified. 2 commits owned. Nice work.
```

## Why

Coding agents let you ship code faster than you can read it. Ownit makes understanding your own
code a habit: a two-minute check while the change is still fresh. Rough answers are fine. A miss
gets a hint and a new question, and you can always retry or skip.

## Setup

You need Node 20+, a GitHub repo and an API key from [Nebius Token Factory](https://tokenfactory.nebius.com/)
or, if you have no Nebius account, from [NVIDIA](https://build.nvidia.com/). Both serve the same Nemotron
model. `ownit key set` asks which one your key is for (or name it: `ownit key set nvidia`).

```sh
npm i -g getownit
ownit login       # sign in with GitHub
ownit key set     # pick Nebius or NVIDIA, then paste your key (stays on your machine)
cd your-repo
ownit init        # installs the pre-push hook
```

Then install the Ownit GitHub App on the repo. `ownit init` prints the link.

## Use

Push as usual. Ownit asks before each push:

| Answer | What happens |
| --- | --- |
| **Y** or Enter | Answer the questions now. |
| **n** | Do it later with `ownit interview`. |
| **s** | Skip this push. |

Your push always goes through, whatever you answer.

Each push is marked **verified** (all questions passed), **skipped**, or **pending** (not done yet;
it becomes skipped after 24 hours). GitHub shows the result as a check on the commit.

### Commands

| Command | What it does |
| --- | --- |
| `ownit login` | Sign in with GitHub. |
| `ownit init` | Install the pre-push hook in this repo and register it. |
| `ownit interview` | Debrief your pending pushes, including ones an AI agent made. |
| `ownit interview --range A..B` | Debrief any commit range. |
| `ownit key set [nebius\|nvidia]` | Save your API key. Paste it at the hidden prompt, never after the command. |
| `ownit key status` / `ownit key clear` | Show or remove the key. |
| `ownit badge` | Print this repo's badge Markdown to paste into your README. |
| `ownit whoami` | Show the server, your GitHub login and your key. |
| `ownit uninstall` | Remove the hook from this repo. |
| `ownit logout` | Sign out. |
| `OWNIT_SKIP=1 git push` | Push once without the prompt. The push is pending. |

### Pushes from AI agents

When a coding agent (Claude Code, Cursor, Codex, CI…) pushes, nobody is at the terminal, so Ownit
records the push as **pending** and lets it through. Run `ownit interview` yourself within 24 hours
to answer for the change, or it counts as skipped.

### Where to see your record

- **GitHub:** each commit gets an **Ownit** check: verified, skipped, or pending.
- **Repo page:** `https://ownit.ownit-worker.workers.dev/<owner>/<repo>` lists recent pushes and stats.
- **Badge:** like `ownit | 90% verified`, linking to the repo page. `ownit init` prints the code to paste
  into your README; `ownit badge` prints it again, and the repo page has a Copy button.

## More

Privacy, self-hosting, how it works and limitations: [docs/DETAILS.md](docs/DETAILS.md).
Overview of the code: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Every prompt sent to the model: [prompts/](prompts/).

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and
what to keep true; please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security
problems privately, as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). You can use, copy, change and redistribute Ownit, including commercially and in
closed-source projects, as long as you keep the copyright and license notice. It comes with no
warranty. Contributions are released under the same license.
