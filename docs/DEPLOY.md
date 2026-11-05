# Deployment & 100% Free Production Hosting Guide

This guide provides click-by-click instructions to deploy and host the **FB Auto 247** (Autonomous Multi-Page Facebook Content System, Made by Chandan Biswas) for **$0.00 (100% Free Tier)** using:
- **Supabase Free Tier:** PostgreSQL relational database, Row Level Security (RLS), and private image storage.
- **Vercel Hobby Plan:** Next.js full-stack web dashboard & OAuth management endpoints.
- **GitHub Actions Free Tier:** Autonomous background worker running every 15 minutes.
- **Meta Graph API / Facebook Login for Business:** Autonomous multi-page feed and photo publishing.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Hobby Tier)                      │
│   Next.js Dashboard & Facebook Login for Business OAuth     │
│   • /api/auth/facebook           • /privacy                 │
│   • /api/auth/facebook/callback  • /terms                   │
│   • /api/auth/facebook/data-del  • /data-deletion           │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│     Supabase (Free Tier)     │   │  GitHub Actions (Free Tier)  │
│   • 19 Relational Tables     │◄──┤  • Runs every 15 mins (cron) │
│   • AES-256-GCM Vault        │   │  • 11-min safe time budget   │
│   • Row Level Security (RLS) │   │  • Autonomous publish worker │
└──────────────▲───────────────┘   └──────────────┬───────────────┘
               │                                  │
               └─────────────────┬────────────────┘
                                 │
                                 ▼
               ┌──────────────────────────────────┐
               │    Meta Graph API (Free Tier)    │
               │   • Facebook Pages feed/photos   │
               │   • Token inspection & metrics   │
               └──────────────────────────────────┘
```

---

## Part 1: Supabase Database Setup

1. Log in to your **[supabase.com](https://supabase.com)** dashboard and open your project.
2. In the left menu, click **SQL Editor** → **New query**.
3. Copy the entire contents of [`supabase/all_migrations.sql`](../supabase/all_migrations.sql) and paste into the query editor.
4. Click **Run**. This creates:
   - All 19 relational tables in `public` schema.
   - Row Level Security (RLS) policies.
   - The private `post-images` storage bucket.
   - Default seed niche profiles and baseline configurations.
5. In the left menu, click **Project Settings** (gear icon) → **API**:
   - Copy **Project URL** (`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`).
   - Copy **anon public key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`).
   - Copy **service_role secret key** (`SUPABASE_SERVICE_ROLE_KEY`). Keep this secret!
6. In the left menu, click **Authentication** → **Users**:
   - Click **Add User** → **Create User**.
   - Enter your email (e.g. `owner@example.com`) and choose a strong password. You will use these credentials to sign in to your deployed dashboard.

---

## Part 2: Facebook Developer App Setup (Facebook Login for Business)

Your Meta App is configured with the **"Manage everything on your Page"** use case and **"Facebook Login for Business"**. Follow these click-by-click instructions:

### 2.1 Retrieve App Credentials
1. Navigate to **[developers.facebook.com](https://developers.facebook.com)** and log in.
2. Select your Meta App from the **My Apps** dropdown.
3. In the left sidebar, navigate to **App Settings** → **Basic**:
   - Copy **App ID** (This is `FACEBOOK_APP_ID`).
   - Click **Show** next to **App Secret** and copy it (This is `FACEBOOK_APP_SECRET`). Keep this secret!

### 2.2 Create Facebook Login for Business Configuration
1. In the left sidebar under your Products/Use Cases, click **Facebook Login for Business** → **Configurations** (or click **Add Configuration**).
2. Click **Create Configuration**:
   - **Configuration Name:** Enter a label, e.g. `Pages Automation`.
   - Under **Permissions**, select or search and check the following 3 permissions:
     - `pages_show_list` (Lists pages managed by your Facebook accounts)
     - `pages_read_engagement` (Reads post engagement and delivery receipts)
     - `pages_manage_posts` (Publishes captions, photos, and scheduled content)
3. Click **Save changes**.
4. In the Configurations table, find your newly created configuration and copy the numeric **Configuration ID** (e.g. `1234567890123456`).
   - This value is your `FACEBOOK_LOGIN_CONFIG_ID`.

### 2.3 Set Valid OAuth Redirect URIs
1. In the left sidebar under **Facebook Login for Business**, click **Settings**.
2. Under **Client OAuth Settings**:
   - Ensure **Client OAuth Login** is set to **Yes**.
   - Ensure **Web OAuth Login** is set to **Yes**.
3. Under **Valid OAuth Redirect URIs**, enter:
   ```
   https://<your-vercel-domain>.vercel.app/api/auth/facebook/callback
   http://localhost:3000/api/auth/facebook/callback
   ```
   *(Replace `<your-vercel-domain>` with your actual Vercel project domain).*
4. Click **Save Changes** at the bottom right.

### 2.4 Add Public Compliance & Data Deletion URLs
In **App Settings** → **Basic**:
- **Privacy Policy URL:** `https://<your-vercel-domain>.vercel.app/privacy`
- **Terms of Service URL:** `https://<your-vercel-domain>.vercel.app/terms`
- **User Data Deletion:**
  - Select **Data Deletion Callback URL**: `https://<your-vercel-domain>.vercel.app/api/auth/facebook/data-deletion`
  - *OR* **Data Deletion Instructions URL**: `https://<your-vercel-domain>.vercel.app/data-deletion`
- Click **Save Changes**.

---

## Part 3: Environment Variable Matrix

### Where Each Variable Must Be Set

| Variable Name | Set in Vercel | Set in GitHub Secrets | Set in Local `.env` | Description |
| :--- | :---: | :---: | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | ❌ No | ✅ Yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | ❌ No | ✅ Yes | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | ✅ Yes | ✅ Yes | Secret service role key |
| `SUPABASE_URL` | ❌ No | ✅ Yes | ❌ No | Supabase URL alias for worker |
| `ENCRYPTION_KEY` | ✅ Yes | ✅ Yes | ✅ Yes | 32-byte base64 AES-256-GCM vault key |
| `APP_URL` | ✅ Yes | ❌ No | ✅ Yes | Full root URL (e.g. `https://<app>.vercel.app`) |
| `FACEBOOK_APP_ID` | ✅ Yes | ✅ Yes (Optional) | ✅ Yes | Numeric Meta App ID |
| `FACEBOOK_APP_SECRET` | ✅ Yes | ✅ Yes (Optional) | ✅ Yes | Meta App Secret |
| `FACEBOOK_LOGIN_CONFIG_ID` | ✅ Yes | ❌ No | ✅ Yes | Facebook Login for Business Config ID |
| `FACEBOOK_REDIRECT_URI` | ✅ Yes | ❌ No | ✅ Yes | Exact callback URL |
| `OWNER_EMAIL` | ✅ Yes | ❌ No | ✅ Yes | Allowed admin email for dashboard login |
| `NODE_ENV` | ✅ Yes (`production`) | ❌ No | ✅ Yes | `production` or `development` |

> [!TIP]
> **Generate your 32-byte `ENCRYPTION_KEY`:**
> Run in terminal:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```
> Use the exact same `ENCRYPTION_KEY` in Vercel, GitHub Secrets, and local `.env` so encrypted tokens can be read by both the web app and the worker.

---

## Part 4: Vercel Deployment (Web Dashboard)

1. Go to **[vercel.com](https://vercel.com)** and sign in.
2. Click **Add New...** → **Project** → Import your `FB-Post-Automation` repository.
3. Configure Project Settings:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** `apps/web` (check "Include source files outside of the Root Directory in the Build Step")
   - **Build Command:** `next build` (default)
   - **Output Directory:** `.next` (default)
   - **Install Command:** `pnpm install` (default)
4. Add all required **Vercel Environment Variables** listed in the table above.
5. Click **Deploy**. Vercel will install dependencies and compile serverless functions.
6. Once deployed, note your assigned domain (e.g. `https://fb-post-automation.vercel.app`) and verify that:
   - `APP_URL` and `FACEBOOK_REDIRECT_URI` in Vercel environment variables match that domain.
   - Valid OAuth Redirect URIs in the Meta Developer App match that domain.

---

## Part 5: GitHub Secrets & Background Worker Setup

1. In your GitHub repository, click **Settings** → **Secrets and variables** → **Actions**.
2. Under **Repository secrets**, click **New repository secret** and add:
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY`: `eyJ...`
   - `ENCRYPTION_KEY`: (Your 32-byte base64 encryption key)
   - `FACEBOOK_APP_ID`: (Your Meta App ID)
   - `FACEBOOK_APP_SECRET`: (Your Meta App Secret)
3. The background worker workflow `.github/workflows/worker.yml` runs automatically every 15 minutes (`*/15 * * * *`) and on manual `workflow_dispatch`.
4. Concurrency lock prevents overlapping runs, and a 11-minute time budget safely enforces limits.

---

## Part 6: How to Test the Facebook Connection

### Step 1: Create a Meta Test Page
1. Go to **[facebook.com/pages/create](https://www.facebook.com/pages/create)** (or use an existing Page where you are Admin).
2. Name it e.g. `Test Automation Sandbox` and complete the creation.

### Step 2: Connect from Dashboard
1. Open your deployed Vercel dashboard: `https://<your-app>.vercel.app`.
2. Sign in with your Supabase credentials.
3. Navigate to **Pages & Accounts** (or **FB Accounts & IDs**).
4. Click **🚀 Connect via Facebook Login for Business**.
5. Facebook will open the OAuth dialog:
   - Log in and approve the `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts` permissions.
   - Select your test Facebook Page.
6. Facebook redirects back to `/api/auth/facebook/callback`.
7. The system automatically:
   - Exchanges code for long-lived user token (~60 days).
   - Ingests your Facebook User ID and Name into `facebook_accounts`.
   - Calls `/me/accounts` to fetch your managed Pages and permanent Page Access Tokens.
   - Encrypts all tokens with **AES-256-GCM** before writing to Supabase.
   - Redirects to your dashboard showing:
     `🎉 Facebook Connected Successfully! Synced 1 Facebook Page(s) with encrypted tokens stored safely in the Supabase vault.`

### Step 3: Verify Token Health & Reconnect
- On the Page card, click **🩺 Check**: The live token inspection checks with Meta Graph API and verifies permissions and non-expiring status.
- If you ever need to grant additional pages or permissions, click **🔄 Reconnect** to re-prompt Meta OAuth with `auth_type=rerequest`.
