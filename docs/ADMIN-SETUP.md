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

The same token lets **Actions → typeset-prune** delete typeset renders nothing
uses any more (docs/TYPESETTING.md, "Drawing and publishing").

For your Mac, make a second token the same way (name it `cantusorgani Mac`),
put its values in the 1Password Environment, and check with
`uv run noh r2-check`.

## 6. Database changes

The admin screen and the readers' Corrections form share one D1 database.
When a change adds a migration (`workers/corrections/migrations/NNNN_*.sql`),
apply it to the live database **before** merging the change, because the new
code expects it. Check each migration's compatibility with the deployed site
and Worker: migrations can change indexes or rebuild tables as well as add
columns. Export the live database first. From `workers/corrections/`:

```bash
mkdir -p backups
pnpm exec wrangler d1 export cantusorgani-corrections --remote --output backups/pre-migration.sql
```

Use a new backup filename for each release; keep the export private. Then:

```bash
pnpm migrate:remote
```

It lists what it will apply, and asks first. Each migration has a way back in
`workers/corrections/rollback/`; export the database before using one.

## 7. Releasing corrections changes

The public API at `https://api.cantusorgani.org` is a separate Worker. The site
workflow tests its code but deploys **Pages only**. Merging a site pull request
does not deploy the public corrections API.

For the corrections compatibility release (migration 0004), use this order:

1. Use the reviewed release commit. Run `pnpm test` and `pnpm typecheck` in
   both `workers/corrections/` and `web/`, and the corrections browser tests
   against a freshly built local site.
2. Export live D1 as above, then run `pnpm migrate:remote` from
   `workers/corrections/`. Check that `0004_target_deduplication.sql` is among
   the intended migrations. It preserves every report and changes the pending
   unique index from piece-based to target-based identity; legacy null targets
   and explicit piece targets still count as the same piece. The currently
   deployed Worker and admin can continue using this database.
3. From that same reviewed commit and directory, run:

   ```bash
   pnpm deploy
   ```

   Check Wrangler's deployed version and the custom domain. Existing bindings
   and the `TURNSTILE_SECRET` remain configured; no secret belongs in the site
   bundle or these instructions.
4. Verify the API responds at `https://api.cantusorgani.org`, then merge the
   reviewed Pages change and wait for its site deployment to succeed.
5. Complete the report lifecycle checks below. Record the Worker version,
   Pages commit and migration applied so a later audit can identify what is live.

Migration 0004 changes no stored rows. Its rollback is deliberately guarded:
once different targets have equal-valued pending reports, the old piece-based
constraint cannot represent them. `rollback/0004_target_deduplication_down.sql`
refuses that case before dropping the new index. **Do not delete reports to
make rollback succeed.** Prefer a forward fix, or roll back the application
code while retaining the compatible target-aware index. Take a fresh export
before any manual rollback.

### Corrections release checks

Use a genuine report with a correct proposed value, or a clearly identified
test report that an editor will reject afterward; do not publish a fabricated
catalogue change merely to exercise the workflow.

- From a Kyriale Mass, report a missing or mislabelled section. Its whole-piece
  form should offer the section field. Also check a long keyed-section link,
  such as `part:ordinarium-missae-xvii/other:deo-gratias-vi`.
- Check the public status row identifies the piece and section/item. Notes
  must remain absent from both the public table and the API JSON.
- Approve a reader page-range, section-start or chant-ID report in the admin.
  Its public row should remain visible as pending after approval and queueing,
  and become accepted only after its correction merges. Reject an unused test
  report and confirm it remains visible as rejected.
- Verify equal-valued reports for distinct targets are retained, while a
  repeat of the same pending target/field/value is acknowledged as a duplicate.
  This behavior is covered in local D1 regression tests; if performing a live
  check, label the test reports and reject them after review.

Local browser regressions intercept the public API and use a throwaway D1
database, so they do not submit live reports. From `web/`, after building with
the public corrections endpoint and Turnstile site key configured:

```bash
pnpm exec playwright test e2e/corrections.e2e.ts e2e/site.e2e.ts --grep 'Corrections|Report links'
```

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
