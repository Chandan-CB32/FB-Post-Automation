# Production Deployment Guide: Vercel + Supabase + GitHub Actions

This guide provides click-by-click instructions to deploy and host the **Autonomous Multi-Page Facebook Content System** for **$0.00 (100% Free Tier)** using:
- **Vercel:** Hosts the Web Management Dashboard & Admin UI.
- **Supabase:** Provides the PostgreSQL database, pipeline state machine, and distributed locks.
- **GitHub Actions:** Operates as the 24/7 autonomous worker runner executing every 15 minutes with time-budgeting and distributed database locks.

---

## Architecture Overview

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│         Vercel (Free)           │       │    GitHub Actions Cron (Free)   │
│   Web Dashboard & Admin API     │       │   Worker Runner (Every 15 mins) │
│ • Page & prompt configuration   │       │ • Topic selection & research    │
│ • Key pool & failover settings  │       │ • Long-form writing & QA audit  │
│ • Live inspector & simulator    │       │ • Sharp image compositing       │
│ • Review inbox approval gate    │       │ • Facebook Graph API publisher  │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │      Direct Database Queries            │
                 └──────────────────┬──────────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                             Supabase (Free)                               │
│ • Multi-page configurations & AES-256-GCM encrypted tokens                │
│ • Central pipeline queue with atomic locks (claim_next_post_job)          │
│ • Distributed worker lock table (settings) to prevent overlapping runs    │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        Meta Facebook Graph API                            │
│ • Publishes scheduled feed posts and carousel photo objects               │
│ • Auto-drops community First Comments                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Supabase Setup (Database & Distributed Locks)

### 1.1 Create a Free Project
1. Navigate to **[supabase.com](https://supabase.com)** and sign in (or create a free account).
2. Click **New Project**.
3. Fill in the project details:
   - **Name:** `fb-post-automation`
   - **Database Password:** Choose a strong password and save it securely.
   - **Region:** Choose a region close to your primary audience (e.g. `us-east-1` or `eu-central-1`).
   - **Pricing Plan:** **Free ($0/month)**.
4. Click **Create new project** and wait ~2 minutes for the database to provision.

### 1.2 Run Schema Migrations
1. In the Supabase dashboard sidebar, click the **SQL Editor** icon (`>_`).
2. Click **New Query**.
3. Open [`supabase/migrations/20261102000000_init_schema.sql`](../supabase/migrations/20261102000000_init_schema.sql) in this repository, copy the entire SQL script, and paste it into the SQL Editor.
4. Click **Run** (green button).
5. Verify in the output: `Success. No rows returned`.
6. Click **Table Editor** in the left sidebar to confirm the following tables are created:
   - `content_profiles`
   - `pages`
   - `providers`
   - `provider_keys`
   - `posts`
   - `topic_history`
   - `settings`
   - `audit_log`
   - `job_logs`
   - `alerts`

### 1.3 Retrieve Database Credentials
1. In the left sidebar, click the **Project Settings** (gear icon) → **API**.
2. Locate and copy:
   - **Project URL:** e.g. `https://xyzcompany.supabase.co` (This is `NEXT_PUBLIC_SUPABASE_URL`).
   - **service_role (secret):** Click *Reveal* and copy the token starting with `eyJ...` (This is `SUPABASE_SERVICE_ROLE_KEY`).

> [!WARNING]
> Keep the `service_role` secret private. It bypasses Row Level Security and is only used by your server and GitHub Actions worker.

---

## Part 2: Facebook Developer App Setup

### 2.1 Create Your Meta App
1. Navigate to **[developers.facebook.com](https://developers.facebook.com)** and log in with your Facebook account.
2. Click **My Apps** → **Create App**.
3. Under *What do you want your app to do?*, select **Other** → Click **Next**.
4. Under *Select an app type*, select **Business** → Click **Next**.
5. Enter an **App name** (e.g., `Content Auto Engine`) and your contact email. Click **Create app**.

### 2.2 Configure Page Permissions
1. In the App Dashboard, go to **Add products to your app** and click **Set up** on **Facebook Login for Business**.
2. Go to **Tools** in the top navigation bar → Click **Graph API Explorer**.
3. Under *User or Page*, select the Facebook Page you want to automate.
4. In the *Permissions* dropdown, add the following required permissions:
   - `pages_manage_posts` (Required to create, schedule, and publish posts)
   - `pages_read_engagement` (Required to verify post statuses and read reach)
   - `pages_show_list` (Required to list pages owned by the account)
5. Click **Generate Access Token**. Approve the Facebook popup dialog giving access to your page.

### 2.3 Exchange for a Permanent Long-Lived Token
1. In the Graph API Explorer, copy the generated short-lived User Access Token.
2. Go to **Tools** → **Access Token Debugger**.
3. Paste the token and click **Debug**.
4. Scroll to the bottom and click **Extend Access Token** to receive a 60-day long-lived token.
5. In Graph API Explorer, make a `GET` request to:
   ```http
   GET /me/accounts?access_token=LONG_LIVED_USER_TOKEN
   ```
6. The JSON response contains your permanent Page Access Token:
   ```json
   {
     "data": [
       {
         "access_token": "EAAB...", // This is your Page Access Token
         "id": "123456789012345",   // This is your Facebook Page ID
         "name": "My Page Name"
       }
     ]
   }
   ```
7. Retrieve your App credentials: Go to **App Settings** → **Basic**:
   - Copy **App ID** (`FACEBOOK_APP_ID`).
   - Click *Show* next to **App Secret** and copy (`FACEBOOK_APP_SECRET`).

---

## Part 3: GitHub Secrets Setup

Your GitHub Actions worker needs access to your database and encryption keys to run headless background cycles.

1. Go to your GitHub repository (e.g. `https://github.com/YOUR_USERNAME/FB-Post-Automation`).
2. Click **Settings** (tab on the top right) → In the left sidebar, click **Secrets and variables** → **Actions**.
3. Under **Repository secrets**, click **New repository secret** for each of the following:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project.supabase.co` | Your Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase `service_role` secret key |
| `ENCRYPTION_KEY` | 32-byte hex string (64 chars) | AES-256-GCM encryption key |
| `FACEBOOK_APP_ID` | e.g. `123456789012345` | Meta Developer App ID |
| `FACEBOOK_APP_SECRET` | e.g. `a1b2c3d4e5f6...` | Meta Developer App Secret |

> [!TIP]
> **How to generate your 32-byte `ENCRYPTION_KEY`:**
> Run this command in any terminal:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

## Part 4: Vercel Deployment (Web Dashboard)

### 4.1 Deploy via Vercel Dashboard
1. Go to **[vercel.com](https://vercel.com)** and sign in with GitHub.
2. Click **Add New...** → **Project**.
3. Under *Import Git Repository*, find your `FB-Post-Automation` repository and click **Import**.
4. Configure Project Settings:
   - **Project Name:** `fb-post-automation`
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** `pnpm build`
   - **Output Directory:** `public`
5. Expand the **Environment Variables** section and add:
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://your-project.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: (Publishable anon key)
   - `SUPABASE_SERVICE_ROLE_KEY`: `eyJ...` (Secret service_role key)
   - `ENCRYPTION_KEY`: (Your 32-byte base64 encryption key)
   - `OWNER_EMAIL`: `your-email@example.com`
   - `NODE_ENV`: `production`
6. Click **Deploy**. Vercel will install dependencies, compile the packages, and give you a live production URL (e.g. `https://fb-post-automation.vercel.app`).

---

## Part 5: Complete Environment Variable Matrix

| Variable Name | Required In | Sensitivity | Description |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, GitHub Actions, Local | Public | Supabase API endpoint URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel, GitHub Actions, Local | **Critical Secret** | Secret service role key for backend DB operations |
| `ENCRYPTION_KEY` | Vercel, GitHub Actions, Local | **Critical Secret** | 32-byte hex key for encrypting tokens with AES-256-GCM |
| `FACEBOOK_APP_ID` | GitHub Actions, Local | Secret | Meta App ID for Graph API publishing |
| `FACEBOOK_APP_SECRET` | GitHub Actions, Local | **Critical Secret** | Meta App Secret for Graph API token inspection |
| `WORKER_TIME_BUDGET` | GitHub Actions, Local | Optional Config | Time budget for one-shot runs (Default: `11m`) |
| `NODE_ENV` | Vercel, GitHub Actions | Config | `production` or `development` |

---

## Part 6: How the GitHub Actions Worker Operates

### 6.1 Automated 15-Minute Cadence
The workflow file [`.github/workflows/worker.yml`](../.github/workflows/worker.yml) executes every 15 minutes:
```bash
npm run worker:once -- --time-budget=11m
```
- **Concurreny Protection:** The workflow defines `concurrency: group: worker-execution, cancel-in-progress: false`.
- **Distributed DB Lock:** When the worker boots, it attempts to acquire a lease lock in Supabase (`settings` table key `worker_distributed_lock`). If another runner is still active, the new run gracefully logs the condition and exits with code 0 without collisions.
- **Time Budget Enforcement:** At the 11-minute mark, the worker cleanly finishes its active task, releases the lock, and exits. The next scheduled 15-minute run automatically resumes the pipeline.
- **Resumability:** Any post interrupted in mid-stage (`writing`, `imaging`, etc.) is recovered on the next run.

### 6.2 Monthly Keepalive Ping
GitHub automatically disables scheduled actions in repositories with no git activity for 60 consecutive days. The workflow [`.github/workflows/keepalive.yml`](../.github/workflows/keepalive.yml) runs on the 1st of every month at midnight UTC, committing an automated timestamp update to `docs/keepalive.txt` to guarantee your automated publisher runs continuously forever.

---

## Part 7: Verifying Production Execution

1. In your GitHub repository, click the **Actions** tab.
2. In the left workflow list, click **Autonomous Publishing Worker**.
3. Click **Run workflow** (top right dropdown) → Select `main` branch → Click **Run workflow**.
4. Click on the active workflow run to watch real-time logs.
5. Confirm the log shows:
   ```
   [Worker] Running in one-shot mode (--once) [Time budget: 11m]...
   [Worker] Acquired distributed lock [...]. Beginning execution cycle...
   [Worker] Heartbeat #1 at ...
   [Worker] Executed cycle #1.
   [Worker] Released distributed lock [...]. Run finished in ...
   ```
6. Open your Vercel URL to view your live dashboard, connect Facebook pages, configure AI providers, and observe the production stream!

