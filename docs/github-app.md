# Creating the Ownit GitHub App

The GitHub App lets the worker receive push events, post the `Ownit` check run on each push, and
confirm that a user has push access to a repo, without storing anyone's GitHub token. The device
flow behind `ownit login` uses the same App.

You need the worker's public URL first, for example `https://ownit.<your-subdomain>.workers.dev`.
For local development, see [Testing webhooks locally](#testing-webhooks-locally).

## 1. Create the App

1. Open GitHub **Settings → Developer settings → GitHub Apps → New GitHub App**
   (direct link: <https://github.com/settings/apps/new>; for an organization use
   `https://github.com/organizations/<org>/settings/apps/new`).
2. **GitHub App name**: `Ownit`, or something like `ownit-yourname` if that is taken. The name
   becomes the App's slug in its URL.
3. **Homepage URL**: the Ownit repository URL, or your worker URL.
4. **Identifying and authorizing users**:
   - Leave **Callback URL** empty.
   - Leave **Expire user authorization tokens** as is. Ownit discards the user token right after
     reading the GitHub identity.
   - Check **Enable Device Flow**. `ownit login` needs it.
   - Leave **Request user authorization (OAuth) during installation** unchecked.
5. **Post installation**: leave empty.
6. **Webhook**:
   - Check **Active**.
   - **Webhook URL**: `https://<worker-host>/webhooks/github`
   - **Webhook secret**: a long random string, for example from `openssl rand -hex 32`. Save it,
     because it becomes `GITHUB_WEBHOOK_SECRET`.
7. **Permissions → Repository permissions** (leave everything else at "No access"):
   - **Checks**: Read and write
   - **Contents**: Read-only
   - **Metadata**: Read-only (GitHub selects this automatically)
8. **Subscribe to events**: check **Push**.
9. **Where can this GitHub App be installed?** Pick **Any account** if other people should be able
   to use your server. Pick **Only on this account** for a private setup.
10. Click **Create GitHub App**.

## 2. Collect the credentials

On the App's settings page (**General**):

- **App ID**: a number near the top.
- **Client ID**: starts with `Iv`.
- **Slug**: the last part of the App's public URL, `https://github.com/apps/<slug>`.
- **Private key**: scroll to **Private keys** and click **Generate a private key**. A `.pem` file
  downloads. Treat it like a password.

## 3. Configure the worker

Put the public values in `worker/wrangler.toml`:

```toml
[vars]
GITHUB_APP_ID = "123456"
GITHUB_APP_SLUG = "ownit"
GITHUB_CLIENT_ID = "Iv23li..."
PUBLIC_URL = "https://ownit.<your-subdomain>.workers.dev"
```

Set the secrets. GitHub's key is PKCS#1 (`BEGIN RSA PRIVATE KEY`), and the worker accepts it
as is:

```sh
cd worker
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < path/to/ownit.private-key.pem
npx wrangler secret put GITHUB_WEBHOOK_SECRET    # paste the webhook secret
```

For `wrangler dev`, put them in the repo's `.env` instead (see `.env.example`). Write the key on
one line with `\n` in place of each line break, inside double quotes.

## 4. Install the App on a repo

1. Open `https://github.com/apps/<slug>/installations/new`.
2. Choose the account and **Only select repositories**, then pick the repo.
3. In that repo, run `ownit init`. It installs the hook and registers the repo, and from then on
   pushes are tracked. If you install the App after `ownit init`, run `ownit init` again so the
   worker records the installation. The first push webhook also records it.

## 5. Check that it works

- **App settings → Advanced → Recent Deliveries**: the `ping` delivery should show a `200`
  response. The worker answers `{"ok":true}`.
- Push a commit to the repo, then open it on GitHub. The **Checks** list should show **Ownit**
  with one of:
  - **Ownit: verified** (green): you passed the debrief.
  - **Ownit: skipped** (grey): you chose `s`, or the push stayed pending for 24 hours.
  - **Ownit: pending** (yellow, in progress): no debrief yet. Run `ownit interview`.
- A delivery that returns `401` means `GITHUB_WEBHOOK_SECRET` doesn't match the App's secret.

## Testing webhooks locally

GitHub has to reach your machine. Either:

- run `cloudflared tunnel --url http://localhost:8787` and use the printed
  `https://….trycloudflare.com/webhooks/github` as the Webhook URL while testing, or
- use <https://smee.io>: create a channel, set its URL as the Webhook URL, and run
  `npx smee-client --url https://smee.io/<channel> --target http://localhost:8787/webhooks/github`.

Remember to point the Webhook URL back at the deployed worker afterwards.
