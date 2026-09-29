# Setting up the admin screen

The admin screen (`/admin/`) is built and deployed. Until the steps below are
done, it answers "not configured", and nothing can change through it. Each
step is a setting in Cloudflare or GitHub that only the owner can make.

Keep every secret in 1Password. Values marked *not secret* can be sent in chat
or written into `web/wrangler.toml`.

## 1. Cloudflare Access: who can sign in

1. In the Cloudflare dashboard, open **Zero Trust**. The first time, pick a
   team name, for example `cantusorgani`. Your team domain is then
   `cantusorgani.cloudflareaccess.com`. Choose the **Free** plan, which covers
   up to 50 users. It may ask for a payment method even on the free plan.
2. Go to **Access → Applications → Add an application → Self-hosted**.
   - Name: `Cantus Organi admin`
   - Destinations:
     - `cantusorgani.org`, path `admin/*`
     - `*.cantusorgani.pages.dev`, path `admin/*` (this covers preview
       deployments)
   - Login method: **One-time PIN**, which sends a code by email. Add Google
     too if you like.
3. Add a policy: Action **Allow**, Include **Emails**: your address. Add each
   editor's address here later.
4. Save, open the application, and copy its **Application Audience (AUD)
   tag**.
5. Send me the team domain and the AUD tag (*not secret*), or put them in
   `web/wrangler.toml` under `[vars]` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`.

## 2. The editors list

The admin code checks each signed-in address against its own list, so a
mistaken Access policy alone can't let anyone in. From `web/`:

```bash
npx wrangler pages secret put EDITORS --project-name cantusorgani
```

Paste the addresses separated by commas, with **yours first**, because the
first address is the owner. To add an editor later, add them in *both* places:
the Access policy (step 1.3) and this list.

## 3. The GitHub App: publishing batches as pull requests

1. First make the webhook secret with `openssl rand -hex 32`, and save it in
   1Password.
2. Go to https://github.com/settings/apps/new.
   - Name: `cantus-organi-admin` (it has to be unique on GitHub; any name will
     do)
   - Homepage URL: `https://cantusorgani.org`
   - Webhook: **Active**
     - URL: `https://cantusorgani.org/api/github/webhook`
     - Secret: the value from step 1
   - Repository permissions:
     - **Contents: Read and write**
     - **Pull requests: Read and write**
     - **Actions: Read-only**, needed to hear about failed runs
   - Subscribe to events: **Pull request**, **Workflow run**
   - Where can it be installed: **Only on this account**
3. **Create GitHub App**. Note the **App ID** (*not secret*).
4. On the same page, use **Generate a private key**. A `.pem` file downloads.
   Save it in 1Password, then delete the download.
5. Use **Install App** → your account → **Only select repositories** →
   `cantusorgani`. The address you land on ends in
   `/installations/<number>`; that number is the **installation ID** (*not
   secret*).
6. Give the key and the webhook secret to the admin screen. From `web/`:

   ```bash
   npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY --project-name cantusorgani
   ```

   ```bash
   npx wrangler pages secret put GITHUB_WEBHOOK_SECRET --project-name cantusorgani
   ```

   Paste the whole `.pem` file, including its BEGIN and END lines, for the
   first; the webhook secret for the second.
7. Give the key to the publishing workflow, in the repo's **Settings → Secrets
   and variables → Actions**:
   - variable `ADMIN_APP_ID` = the App ID;
   - secret `ADMIN_APP_PRIVATE_KEY` = the whole `.pem` file.
8. Send me the App ID and the installation ID, or put them in
   `web/wrangler.toml` as `GITHUB_APP_ID` and `GITHUB_INSTALLATION_ID`.

## 4. Protecting `main`

Go to the repo's **Settings → Rules → Rulesets → New branch ruleset**.

- Name: `main`. Enforcement: **Active**. Target: **Default branch**.
- Bypass list: add **Repository admin**, mode **For pull requests only**. You
  can merge a pull request, but no one can push to `main` directly: not the
  App, not me, not you.
- Rules:
  - **Restrict deletions**
  - **Block force pushes**
  - **Require a pull request before merging**, with 0 required approvals: the
    bypass above means your merge is the approval.
  - **Require status checks to pass**: add `check-build-deploy`.

After this, my changes arrive as pull requests for you to merge.

Then, in **Settings → General → Pull Requests**, tick **Allow auto-merge**. The
admin screen's batches use it: a batch merges itself (and deploys) as soon as
`check-build-deploy` passes, so you do not have to merge each one. Two kinds
wait for you instead, and their pull request says why:

- a batch that moves systems between pieces (a `system_range` correction);
- a batch of 25 corrections or more.

If a batch's checks fail, the pull request is closed and its corrections go
back to the admin screen, marked with the reason.

## 5. R2 for GitHub Actions

GitHub Actions publishes to the `cantusorgani-assets` bucket (typeset music,
later). Give it its own R2 token, separate from the one on your Mac, so either
can be revoked without the other.

1. In the Cloudflare dashboard, open **R2 Object Storage**, then **Manage API
   tokens** → **Create Account API token**.
   - Name: `cantusorgani GitHub Actions`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **Apply to specific buckets only** →
     `cantusorgani-assets`
   - TTL: **Forever** (revoke it here if it ever leaks)
2. **Create API Token**. The next page shows several values, once. Use only
   these two:
   - **Access Key ID** (32 characters)
   - **Secret Access Key** (64 characters)

   Not the **Token value**: that starts `cfat_` and is a Cloudflare API token,
   not an R2 key.
3. Your **account ID** is the 32 characters at the start of the S3 endpoint
   shown on the same page (`https://<account ID>.r2.cloudflarestorage.com`),
   or on the R2 overview under **Account Details**.
4. In the repo's **Settings → Secrets and variables → Actions**:
   - secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`;
   - variable: `R2_BUCKET` = `cantusorgani-assets` (*not secret*).

   Save the token in 1Password too.
5. Go to **Actions → r2-check → Run workflow**. A green run means GitHub can
   write to the bucket; a red one says which value is wrong, without showing it.

For your Mac, make a second token the same way (name it `cantusorgani Mac`),
put its values in the 1Password Environment, and check with
`uv run noh r2-check`.

## 6. Database changes

The admin screen and the readers' Corrections form share one D1 database.
When a change adds a migration (`workers/corrections/migrations/NNNN_*.sql`),
apply it to the live database **before** merging the change, because the new
code expects it. Migrations only add, so the site already deployed keeps working
with them. From `workers/corrections/`:

```bash
pnpm migrate:remote
```

It lists what it will apply, and asks first. Each migration has a way back in
`workers/corrections/rollback/`; export the database before using one.

## Checking it works

1. Open https://cantusorgani.org/admin/. Access asks for your email and sends a
   code. You should then see "Admin · signed in as you (owner)".
2. From any piece page, use **Edit** at the foot of the page. Make a small,
   harmless correction and approve it.
3. On `/admin/`, press **Publish changes**. Within a minute or two, "On
   GitHub" shows a pull request.
4. The pull request runs the site checks and, when they pass, merges itself:
   the site deploys with the correction, and the history lists it as accepted.
   (A batch that waits for you says so in the pull request; merge it yourself.)
5. Or close it without merging: the correction goes back to "To review".

If a step fails, the admin screen says why. The GitHub side is under the
repo's **Actions** tab, in the `corrections-batch` runs.
