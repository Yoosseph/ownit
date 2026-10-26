# getownit

The `ownit` command. Right after you `git push`, it runs a short debrief in your terminal about
what you just shipped: why, how, and what's next. NVIDIA Nemotron (on Nebius or NVIDIA) writes the questions
and grades your answers generously.

```sh
npm i -g getownit
ownit login       # GitHub device flow
ownit key set     # pick Nebius or NVIDIA, then paste your key; stored only in ~/.ownit/config.json
ownit init        # in a repo: installs the pre-push hook
```

The repository owner must [install the Ownit GitHub App](https://github.com/apps/ownit-app/installations/new)
and select the repo you push to (or your fork). GitHub sign-in alone does not install it.
Run `ownit init` again after installation. Without the App, Git pushes still work, but Ownit
cannot record debriefs.

On each push: `Debrief now? [Y/n]`. Ownit never blocks a push. Pending debriefs can be
finished any time with `ownit interview`, which lets you pick the push.

Your code is never stored, your answers only if the repo's admins choose to show them on its page, and your key is never stored or logged by the server.

Full documentation: [github.com/Yoosseph/ownit](https://github.com/Yoosseph/ownit).
