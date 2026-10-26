# Ownit

![A developer thinking through her work at a laptop in a naturally lit home office.](docs/assets/ownit-hero.png)

## Own the code you ship.

**A short debrief for the code you just pushed.** Ownit asks one to three questions about
your change, right in your terminal. Build understanding alongside your AI coding workflow.

[Watch the narrated ad](media/ownit-ad-1080p.mp4) · [Get started](#setup) · [See how it works](docs/DETAILS.md)

[![Ownit](https://ownit.ownit-worker.workers.dev/badge/Yoosseph/ownit.svg)](https://ownit.ownit-worker.workers.dev/Yoosseph/ownit)
[![CI](https://github.com/Yoosseph/ownit/actions/workflows/ci.yml/badge.svg)](https://github.com/Yoosseph/ownit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/getownit?logo=npm&color=CB3837)](https://www.npmjs.com/package/getownit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![NVIDIA Nemotron](https://img.shields.io/badge/NVIDIA-Nemotron-76B900?logo=nvidia&logoColor=white)](https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b)
[![Nebius Token Factory](https://img.shields.io/badge/Nebius-Token%20Factory-052B42)](https://tokenfactory.nebius.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

When you run `git push`, Ownit's pre-push hook offers a debrief: why you made the change,
how it works, and what could come next. NVIDIA Nemotron (on Nebius or NVIDIA) writes the
questions and grades your answers. Debrief now or return later with `ownit interview`.

| Push | Explain | Build your record |
| --- | --- | --- |
| Use your normal Git workflow. | Answer 1–3 short questions about the change. | Passing debriefs mark commits as verified on GitHub and your repo page. |

![Illustrative Ownit terminal session showing a retry explanation and a verified push.](docs/assets/ownit-terminal-demo.png)

*Illustrative session, based on the example below. Questions and grading vary with your change.*

```text
$ git push
Ownit (2 commits to octo/shop) Debrief now? [Y/n] y

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
gets a hint and a new question, and you can always stop and finish later.

![Two developers discussing a change together at a desk with a laptop and notebook.](docs/assets/ownit-understanding.png)

| Why | How | Next |
| --- | --- | --- |
| Explain the purpose of the change. | Describe the approach and how it works. | Consider a limitation, risk, or improvement. |

Small pushes get one question; larger ones get two or three. Ownit is a learning tool:
a passed debrief records understanding at the keyboard, not proof of authorship or code correctness.

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

On Windows, use Git Bash in Windows Terminal for the interactive debrief.

## Use

Push as usual. Ownit asks before each push:

| Answer | What happens |
| --- | --- |
| **Y** or Enter | Answer the questions now. |
| **n** | Do it later with `ownit interview`. |

Your push always goes through, whatever you answer.

Each push is **verified** (all questions passed) or **pending** (not done yet). Pending commits
count as unverified, with no deadline. Run `ownit interview` whenever you like: it lists the
waiting pushes by commit message, and you pick which one to debrief. Its commits then become
verified. During a debrief, type `s` to stop and come back to it later.
GitHub shows the result as a check on the commit.

### Commands

| Command | What it does |
| --- | --- |
| `ownit login` | Sign in with GitHub. |
| `ownit init` | Install the pre-push hook in this repo and register it. |
| `ownit interview` | List your waiting pushes (including ones an AI agent made) and debrief the one you pick. |
| `ownit interview --all` | Debrief every waiting push in turn. |
| `ownit interview --range A..B` | Debrief any commit range, or `--range <sha>` for one commit. |
| `ownit key set [nebius\|nvidia]` | Save your API key. Paste it at the hidden prompt, never after the command. |
| `ownit key status` / `ownit key clear` | Show or remove the key. |
| `ownit badge` | Print this repo's badge Markdown to paste into your README. |
| `ownit settings` | Show this repo's settings and page link. |
| `ownit settings questions\|answers on\|off` | Choose what the page shows. Repo admins and maintainers only. |
| `ownit settings earlier on\|off` | Let older commits count once someone debriefs them. Admins and maintainers only. |
| `ownit whoami` | Show the server, your GitHub login, your key and its model. |
| `ownit model` | Show which provider and model your debriefs use (also `ownit plan`). Your key applies in every repo on this computer. |
| `ownit uninstall` | Remove the hook from this repo. |
| `ownit logout` | Sign out. |
| `OWNIT_SKIP=1 git push` | Push once without the prompt. The push is pending. |
| `ownit help <command>` | Details and examples for one command (same as `ownit <command> --help`). |

### Pushes from AI agents

When a coding agent (Claude Code, Cursor, Codex, CI…) pushes, nobody is at the terminal, so Ownit
records the push as **pending** and lets it through. Run `ownit interview` yourself to answer for the
change; until then its commits count as unverified.

### Where to see your record

- **GitHub:** each commit gets an **Ownit** check: verified or pending.
- **Repo page:** `https://ownit.ownit-worker.workers.dev/<owner>/<repo>` lists recent pushes and stats. It shows the debrief questions unless the repo's admins hide them,
  and passing answers only if they turn that on.
- **Badge:** like `Ownit | Verified 55% | Unverified 45%`, linking to the repo page. `ownit init` prints the code to paste
  into your README; `ownit badge` prints it again, and the repo page has a Copy button.

## Updating

The server updates itself; there is nothing to do for it. For the CLI:

```sh
npm install -g getownit@latest
ownit --version
```

Releases are listed on the [releases page](https://github.com/Yoosseph/ownit/releases). Your login,
key and repo setup are kept across updates.

## More

The [launch campaign](media/README.md) includes the ad video, poster, captions, artwork prompts,
and source renderer.

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
