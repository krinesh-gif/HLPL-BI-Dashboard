# Setting up the shared dashboard on Vercel

One-time setup. After this, the dashboard is live at a Vercel URL, requires a login,
and every teammate sees the same data.

Steps 1–5 are things only you can do (they need your Vercel account).

---

## 1. Import the repo into Vercel

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Find **HLPL-BI-Dashboard** and click **Import**.
3. Leave every build setting as-is — `vercel.json` already specifies them.
4. Under **Git Branch**, set the production branch to `claude/bold-ramanujan-m7g3dp`
   (or merge that branch into `main` first and leave it as `main`).
5. Click **Deploy**. The first deploy will succeed but the app won't work yet —
   there's no database.

## 2. Create the database

1. In the project, open the **Storage** tab.
2. **Create Database** → choose **Neon** (Serverless Postgres) → **Continue**.
3. Accept the free plan and connect it to this project.

Vercel injects `DATABASE_URL` automatically. You don't paste any secret by hand.

## 3. Create the tables, seed products, and create your login

Run these on your own computer, from a clone of this repo:

```bash
npm install

# Copy this from Vercel: Project → Settings → Environment Variables → DATABASE_URL
export DATABASE_URL='postgres://...'

npm run init-db                      # creates the tables
npm run seed-sku-master              # loads the 45 real SKUs and their costs
npm run create-user -- you@yourcompany.com   # prompts for a password (min 8 chars)
```

All three are safe to re-run — `init-db` and `seed-sku-master` skip anything
that already exists, so a re-run never overwrites cost edits made in the app.

> **Why not just paste `db/schema.sql` into the Neon query box?** That editor
> sends the whole thing as one prepared statement and rejects it with
> *"cannot insert multiple commands into a prepared statement"*. `npm run init-db`
> reads the same file and sends each statement separately.

## 4. Redeploy and sign in

1. Back in Vercel, open **Deployments** → **⋯** on the latest → **Redeploy**
   (so the app picks up the database connection).
2. Open your Vercel URL. You should see a login page.
3. Sign in with the account you created in step 3.

---

## Adding your team

Once signed in: **Settings → Team → Add teammate**. Enter their email and a
temporary password, then pass those to them directly — the password is stored
hashed and cannot be looked up later. Anyone you add can sign in, upload
reports, and edit product costs.

To revoke someone's access, use **Remove** on that same page. It takes effect
immediately.

## Confirming it actually works

The point of this setup is shared data, so verify that specifically:

1. Sign in and upload a report (**Data → Upload Reports**).
2. Open the same URL in a **different browser** (or a private window) and sign
   in as a different teammate.
3. The data from step 1 should already be there. That's the proof it's shared
   rather than saved per-browser.

Also worth checking once: sign out, then paste a dashboard URL directly — you
should land on the login page, not the dashboard.

## Notes

- **Uploads are de-duplicated in the database.** Re-uploading the same file
  changes nothing; re-uploading a file that has grown adds only the new rows.
  This holds even if two people upload at the same moment.
- **The old GitHub Pages site is no longer updated.** Its build has no login,
  so leaving it live would keep an unauthenticated copy of real P&L figures on
  a public URL. Auto-deploy is disabled in
  `.github/workflows/deploy.yml`; delete the Pages deployment in the repo's
  GitHub settings if you want it gone entirely.
- **Everyone has full access.** There is no view-only role — any teammate you
  add can upload and edit costs. Add a role column and a permission check on
  the API routes if that changes.
