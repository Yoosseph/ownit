# Ownit

After you push, Ownit runs a short debrief in the same terminal about what you just shipped: why you
made the change, how it works, and what could come next. NVIDIA Nemotron (served by Nebius) writes the
questions and grades your answers generously. Each push is recorded as verified, skipped, or pending,
and a badge shows your repo's record.

Ownit is a learning tool, built for the Nebius x NVIDIA Global AI Hackathon. It's meant for developers
who ship code written with coding agents and want to understand it.

> Work in progress. A full README (privacy, self-hosting, limitations, credits) comes with milestone 7.

## Install

```sh
npm i -g getownit     # the command is `ownit`
ownit login           # GitHub device flow
ownit key set         # your own Nebius API key, stored only in ~/.ownit/config.json
ownit init            # in a repo: installs the pre-push hook
```

Then install the Ownit GitHub App on the repo.

On your next `git push`, Ownit asks `Debrief now? [Y/n/s=skip]`. Run `ownit interview` any time to
finish pending debriefs.

### CLI environment variables

- `OWNIT_SERVER`: use a different Ownit server (for example `http://127.0.0.1:8787` for local dev).
- `NEBIUS_API_KEY`: overrides the key saved by `ownit key set`.
- `OWNIT_SKIP=1`: push once without the prompt (the push shows up as pending).

## Development

See [docs/HANDOFF.md](docs/HANDOFF.md) for status and local setup, and [docs/SPEC.md](docs/SPEC.md)
for the full spec.

## Credits

Hook chaining and `core.hooksPath` handling follow the approach of
[parthh01/sphinx](https://github.com/parthh01/sphinx) (MIT).
