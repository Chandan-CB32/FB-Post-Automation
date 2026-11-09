# FB Auto 247: Production Readiness, Persistence & Governance Audit

## Executive Summary
This audit and production readiness pass resolves the root causes of settings not persisting, overhauls the Page Settings experience into a beginner-friendly 3-step configuration flow, implements strict server-side write-verification with optimistic concurrency controls, delivers start/stop auto-posting governance, and establishes live system readiness and database schema diagnostics.

---

## 1. Root Cause Analysis: Why Settings Did Not Save Previously

| # | Cause | Investigation Finding | Solution Applied |
|---|---|---|---|
| **1** | **Vercel / Browser Edge HTTP Caching** | The dashboard shell (`/`, `/dashboard`) and `/api/*` endpoints lacked HTTP cache prevention headers. Next.js / Vercel served stale edge-cached HTML and cached API payloads, causing subsequent reloads to overwrite user edits with pre-rendered data. | Added strict headers `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate`, `Pragma: no-cache`, `Expires: 0` to all dashboard HTML and API routes. |
| **2** | **Client In-Memory Cache Desync** | In `apps/web/public/dashboard.js`, `ensureTabDataLoaded` only fetched `/api/pages` if `pagesData.length === 0`. Because initial data was embedded in the HTML, `pagesData` was never refreshed from Supabase upon tab navigation or post-save. | Modal opening dynamically pulls fresh page records; `pagesData` is updated on every save, and unsaved change detection ensures users see exact database state. |
| **3** | **Missing Server Write-Verification** | The backend previously issued Supabase updates without reading back the committed row to verify that every field actually persisted before returning 200 OK. | `updatePage` in `storage.ts` now immediately executes a read-back probe from Supabase, asserts field persistence, and returns the verified database row. |
| **4** | **Missing Schema Columns in Older Migrations** | Newer fields (`is_live`, `version`, `auto_posting_stopped_action`, `checklist_status`, `niche_analysis`, `ai_disclosure_text`) lacked dedicated columns on older tables, causing Supabase to discard unmapped keys. | Created migration `supabase/migrations/20261109000000_production_persistence_and_governance.sql` and standalone `supabase/delta_20261109.sql`, and rebuilt `supabase/all_migrations.sql`. |
| **5** | **Optimistic Concurrency & Race Conditions** | If two sessions or background tasks updated page settings simultaneously, the last write silently overwrote prior updates without notification. | Implemented optimistic locking: client transmits `expected_updated_at` and `expected_version`. The server rejects conflicting writes with HTTP `409 Conflict`, prompting the user to reload. |

---

## 2. Complete Entity Round-Trip & Dynamic Worker Gating Audit

| Entity | UI Component | API Route | Supabase Table | Worker Dynamic Read Status |
|---|---|---|---|---|
| **AI Providers** | Providers Tab & Key Modal | `/api/providers` | `providers` | Resolved per-cycle via key pool |
| **Provider Keys** | Quotas & Key Pool Table | `/api/provider-keys` | `provider_keys` (encrypted) | AES-256-GCM decrypted at runtime |
| **Failover Chains** | Failover Priority Card | `/api/providers/failover` | `providers.priority` | Dynamic failover order in Router |
| **Daily Quotas** | Usage KPI Cards | `/api/provider-usage` | `provider_daily_usage` | Dynamic per-cycle quota check |
| **Content Profiles** | Prompt Studio & Dropdown | `/api/content-profiles` | `content_profiles` | Dynamic fetch per slot |
| **Prompts & Voice** | Page Prompt Studio | `/api/pages/update-prompts` | `pages` (`custom_*_prompt`) | Combined with profile at runtime |
| **Facebook Accounts** | Accounts & Identities | `/api/accounts` | `facebook_accounts` | Token status checked dynamically |
| **Facebook Pages** | Connected Pages Tree | `/api/pages` | `pages` | Read directly from Supabase |
| **Page Settings & Cadence** | Page Settings 3-Step Modal | `/api/pages/update-settings` | `pages` (`schedule`, `mode`, etc.) | Checked per-page every cycle |
| **Topic Queues** | Topic Studio | `/api/topics` | `topics` | Fetched dynamically |
| **Categories & Weights** | Niche Settings | `/api/topic-categories` | `topic_categories` | Dynamic weighted selection |
| **Content Series** | Series Manager | `/api/series` | `content_series` | Read dynamically |
| **Research Sources** | Sources Tab | `/api/research-sources` | `research_sources` | Live fetching per cycle |
| **Review Inbox** | Review Inbox Grid | `/api/review-posts` | `posts` (`pending_review`) | Filtered before publishing |
| **Schedule Grid** | Interactive 7-Day Grid | `/api/pages/preview-schedule` | `pages.schedule` + slots | Planned strictly from `new Date()` |
| **Global Kill Switch** | Emergency Banner & Settings | `/api/kill-switch` | `settings` (`key = 'kill_switch'`) | **Single Source of Truth** in worker |
| **Analytics & KPIs** | Performance Tab | `/api/analytics/posts` | `posts` (`analytics`) | Aggregated dynamically |
| **Worker Heartbeat** | Status Pill & Health Check | `/api/health` | `worker_heartbeat` | Updated every worker cycle |

---

## 3. Simplified 3-Step Page Settings Interface

The Page Settings modal has been redesigned for maximum clarity and ease of use:

```
+---------------------------------------------------------------------------------+
| ⚙️ Page Settings: Beyond the Known                [ ● LIVE ]  [ Auto-Posting: ON ] |
+---------------------------------------------------------------------------------+
| 📋 Setup Checklist: [✅ Profile] [✅ Schedule] [✅ Mode] [✅ Test Run] [✅ Live]    |
+---------------------------------------------------------------------------------+
|                                                                                 |
| ⭕ STEP 1: CHOOSE NICHE & CONTENT PROFILE                                       |
|    Profile: [ Science & Space (Science)                                     ▼ ] |
|    [ 📦 Import Starter Profiles ] [ ✨ Detect Niche via AI ] [ ✍️ Edit Prompts ] |
|                                                                                 |
| ⭕ STEP 2: SET CADENCE & POSTING SCHEDULE                                        |
|    Audience Timezone: [ America/New_York (US Eastern Time)                  ▼ ] |
|    Calculated Cadence: [ 5 posts / day ]                                        |
|    Quick-fill: [ ⭐ 5 posts/day (US Prime Time) ]  [ ⚡ 3 posts/day ]             |
|    Daily Times: [ 09:00 ✕ ] [ 12:00 ✕ ] [ 15:00 ✕ ] [ 18:00 ✕ ] [ 21:00 ✕ ]    |
|    📅 Live 7-Day Slot Preview (Audience ET vs Your Local IST)                   |
|                                                                                 |
| ⭕ STEP 3: CHOOSE PUBLISHING MODE                                                |
|    [📬 Review Each Post (Recommended)]  [🚀 Fully Automatic]  [⚖️ Hybrid Mode]   |
|                                                                                 |
| ➕ Advanced (Jitter, Min Gap, Lead Time, Vacation Pause, AI Disclosures)        |
+---------------------------------------------------------------------------------+
| [ ⚡ Run Test Run Now ] [ ↩️ Revert ]            [ Cancel ] [ 💾 Save Settings ] |
+---------------------------------------------------------------------------------+
```

### Key UI Features
1. **Unsaved Changes Tracking:** A yellow badge `● Unsaved changes` appears immediately upon changing any setting, and the `↩️ Revert Changes` button activates.
2. **Verified Save Toast:** Upon clicking `Save Settings to Supabase`, the server verifies database persistence and displays a floating notification: `✅ Saved and verified at HH:MM:SS`.
3. **Time Chips with Quick-Fill:** Number of posts per day is automatically driven by the time chips. Clicking `⭐ 5 posts/day (US Prime Time)` instantly sets 09:00, 12:00, 15:00, 18:00, and 21:00 in audience timezone.
4. **Live 7-Day Preview:** Automatically translates every planned slot between Audience Timezone (default `America/New_York`) and your local timezone (`Asia/Kolkata` IST).

---

## 4. Start / Stop Auto-Posting Lifecycle

- **Start Auto-Posting (`🚀 Turn Auto-Posting ON`):**
  - Evaluates the 4 checklist prerequisites (Profile chosen, Cadence > 0, Mode selected, Test Run verified).
  - If incomplete, informs the user and allows confirmed override.
  - Sets `active: true` and `is_live: true` in Supabase with an audit log entry.
- **Stop Auto-Posting (`⏸️ Turn Auto-Posting OFF`):**
  - Prompts the user with two distinct options:
    1. **Pause new posts only (Recommended):** Pauses future slot generation while keeping in-flight drafts in queue.
    2. **Stop everything & cancel scheduled posts:** Cancels all planned and pending draft posts in Supabase (`status = 'cancelled'`), preventing any accidental publication.
- **Global Emergency Kill Switch:**
  - Active kill switch renders a prominent alert banner at the top of the dashboard.
  - The background worker checks the Supabase `settings` table directly on every cycle and skips all autonomous generation when paused.
- **Resuming from "Now":**
  - When auto-posting is resumed, `calculateNextSlots` plans strictly from `new Date()`. Past missed slots are never back-filled.

---

## 5. Database Schema & Starter Profiles

### Database Delta Migration
To apply all persistence columns, indexes, and tables to your live Supabase project:
1. Open your [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **SQL Editor ➔ New Query**.
3. Copy and paste the contents of `supabase/delta_20261109.sql`.
4. Click **Run**.

### Available Starter Profiles
Clicking **📦 Import Starter Profiles** installs 7 master niches directly into your Supabase database:
1. `Historical Photos` (Historical & Archival)
2. `Real-Life Photography` (Real-Life Photography)
3. `Science & Space` (Science & Space - tailored for *Beyond the Known*)
4. `Vintage Cars` (Vintage Automobiles)
5. `Horror Story` (Horror & Supernatural)
6. `Crime Story` (True Crime & Mystery)
7. `Science Story` (Science & Tech Breakthroughs)

---

## 6. Verification & Test Results
- **Unit & Integration Tests:** 48 test files, 370 tests passing (100% pass rate).
- **Playwright Headless Browser Smoke Tests:** Passed with 0 uncaught errors.
- **Acorn JavaScript Syntax Validation:** 100% compliant on both client files.
- **Next.js Production Build:** Compiled successfully with dynamic on-demand rendering.
- **Git Remote:** Pushed to `origin/master` (Commit `69e2db6`).
