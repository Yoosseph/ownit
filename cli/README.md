# getownit

The `ownit` command. Right after you `git push`, it runs a short debrief in your terminal about
what you just shipped: why, how, and what's next. NVIDIA Nemotron (on Nebius or NVIDIA) writes the questions
and grades your answers generously.

Install the CLI and sign in with GitHub:

```sh
npm i -g getownit
ownit login
```

Save your key. Pick Nebius or NVIDIA, then paste it; it is stored only in `~/.ownit/config.json`.

```sh
ownit key set
```

Inside your repo, install the pre-push hook and register the repo:

```sh
ownit init
```

If the [Ownit GitHub App](https://github.com/apps/ownit-app/installations/new) is not on the repo yet,
`ownit init` opens its install page and waits. Select the repo you push to (or your fork), click
Install, then press Enter in the terminal. If someone else owns the repo, send them the link and
run `ownit init` again once they have installed it. Without the App, Git pushes still work, but
Ownit cannot record debriefs.

Everyone who commits to an Ownit repo owes the debrief for their own commits. The repo's page
lists anyone who pushed without finishing theirs.

On each push: `Debrief now? [Y/n]`. Ownit never blocks a push. Pending debriefs can be
finished any time with `ownit interview`, which lets you pick the push.

Your code is never stored, your answers only if the repo's admins choose to show them on its page, and your key is never stored or logged by the server.

Full documentation: [github.com/Yoosseph/ownit](https://github.com/Yoosseph/ownit).
