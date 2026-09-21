# Setting up the shared dashboard

Everything below is done in your web browser. No coding, nothing to install, no
command line. About 10 minutes.

At the end you'll have a private web address your team logs into, where everyone
sees the same live data.

---

## Step 1 — Put the app online

Vercel is the service that hosts the dashboard. It's free for this.

1. Go to **<https://vercel.com/new>**
2. Click **Continue with GitHub** and sign in.
3. You'll see a list of your repositories. Find **HLPL-BI-Dashboard** and click
   **Import**.
4. Leave all the build settings alone — they're already configured.
5. Find the **Production Branch** (or "Git Branch") box and set it to:
   ```
   Main
   ```
   Capital M — it is case-sensitive. This is the one setting worth getting
   right: it decides which branch the live site is built from, and every other
   branch only ever produces a private preview. Point it anywhere else and the
   site quietly stops updating, while Vercel still reports each push as
   deployed.
6. Click **Deploy** and wait about a minute.

You'll get a success screen with a web address. The app won't work yet — it has
nowhere to store data. That's next.

---

## Step 2 — Add the database

1. In your new Vercel project, click the **Storage** tab at the top.
2. Click **Create Database**.
3. Choose **Neon** (labelled *Serverless Postgres*), then **Continue**.
4. Accept the free plan and confirm, making sure it's connected to this project.

Vercel handles the connection details itself — there's nothing to copy or paste.

---

## Step 3 — Wake the app up

The app needs one restart to notice the database you just added.

1. Go to the **Deployments** tab.
2. On the top (most recent) deployment, click the **⋯** menu → **Redeploy**.
3. Confirm, and wait for it to finish.

---

## Step 4 — Create your login

1. Click **Visit** (or open your project's web address).
2. You'll see a **"Welcome — let's set up your dashboard"** screen.
3. Enter the email and password you want to sign in with (at least 8
   characters), and click **Create my account**.

That one click creates the database tables, loads your product list with its
costs, creates your account, and signs you in. You should land on the dashboard.

This screen only ever appears once. After your account exists it's replaced by a
normal sign-in screen, and nobody can use it to create an account.

---

## Step 5 — Add your team

Inside the dashboard, go to **Settings → Team → Add teammate**.

Enter their email and a temporary password, then send those to them directly.
The password is stored scrambled and can't be looked up later — so if someone
forgets theirs, remove them and add them again.

Everyone you add can sign in, upload reports, and edit product costs. To remove
someone, click **Remove** on that page; it takes effect immediately.

---

## Check that sharing actually works

Worth doing once, since shared data is the whole point:

1. Sign in and upload a report (**Data → Upload Reports**).
2. Open the same web address in a **different browser**, or a private/incognito
   window, and sign in.
3. The data from step 1 should already be there.

Also try signing out and then pasting a dashboard link — you should land on the
sign-in screen, not the data.

---

## Good to know

- **Re-uploading a file is safe.** Upload the same report twice and nothing
  doubles up. Upload an updated version (say June grew from 24 rows to 30) and
  only the 6 new rows are added. This holds even if two people upload at the
  same moment.
- **The old GitHub Pages address is no longer updated.** That version had no
  login, so it would have left real P&L figures on a public web address. It's
  switched off. You can delete it entirely in the repository's GitHub settings.
- **Everyone has the same access.** There's no view-only role yet — anyone you
  add can upload and change costs. Ask if you'd like that added.

---

## For developers

The setup screen covers everything above, but the same steps can be run from a
terminal against `DATABASE_URL`:

```bash
npm install
export DATABASE_URL='...'      # Vercel → Settings → Environment Variables
npm run init-db                # create the tables
npm run seed-sku-master        # load the product catalogue
npm run create-user -- you@yourcompany.com
```

The schema itself lives in [`api/_lib/schema.ts`](api/_lib/schema.ts) as a
single `DO` block — one statement, so it can be pasted into a database console
without tripping the "cannot insert multiple commands into a prepared statement"
error.

---

## The site is not showing my latest change

The sidebar prints the build it is running: `Build <commit> (<branch>) · <time>`.
Compare it with the newest commit on `Main` at
<https://github.com/krinesh-gif/HLPL-BI-Dashboard/commits/Main>.

**The branch in the brackets is not `Main`.** Vercel is building a different
branch. Fix it at **Settings → Git → Production Branch**, set it to `Main`, then
deploy a commit as below.

**The branch is `Main` but the commit is older.** Vercel has not built the newer
commit. Open **Deployments** and look at the newest one: a failed build leaves
the previous deployment live, which looks exactly like nothing having happened.

**Do not use the Redeploy button to pick up a new commit.** It rebuilds the
commit that deployment was originally made from, so it returns the same build
however many times it is pressed. To deploy a newer commit, either open its
deployment and choose **Promote to Production**, or push a new commit to `Main`.

**The build and branch are both right but a figure looks stale.** The browser
caches the app. Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac).
