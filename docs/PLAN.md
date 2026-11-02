# Autonomous Multi-Page Facebook Content System — Implementation Plan

> **Based on:** `PRD_autonomous_content_system.md`  
> **Environment:** Windows (PowerShell compatible), Node.js, Next.js, Supabase, Railway, Vercel  
> **Execution Strategy:** One verified step at a time with automated testing, self-review, and manual verification instructions before moving to the next.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js Dashboard (Vercel)                      │
│  - Settings & Effective Settings Viewer                                │
│  - Prompt Studio (with variable engine & live preview)                 │
│  - Content Profiles (Factual, Fiction, True Story, Evergreen)          │
│  - Review Inbox (Inline edit, approve, regenerate, reject)             │
│  - Provider Management & Key Pool (AES-256-GCM encrypted)              │
│  - Quality Bench, Demand/Budget Tracker, Queue/Calendar                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ SQL via PostgREST / RLS
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Supabase (PostgreSQL + Storage)                 │
│  - Relational Schema with RLS (Single Owner)                           │
│  - Stored Procedures (RPCs) for atomic job claiming (SKIP LOCKED)      │
│  - Encrypted Credentials & Tokens                                      │
│  - Image Storage Bucket with retention lifecycle                       │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Service Role / Direct DB
                                    │
┌───────────────────────────────────┴────────────────────────────────────┐
│                    24x7 Background Worker (Railway)                    │
│  - Slot Planner & Daily Budget Throttler                               │
│  - Research Collector (SSRF-safe fetcher, RSS/API, item hashing)       │
│  - Idea & Topic Selector (Category weights, dedup window)              │
│  - Content Writer (Outline → Section Chunks → Stitch → Polish)         │
│  - QA Scorer & Safety Baseline Classifier (0-100, sensitive flags)     │
│  - Image Generator & Sharp Compositor (Headline panel, QA, 1080x1350)  │
│  - Facebook Graph API Publisher & Status Reconciler                    │
│  - Provider Router (Chains, token buckets, failovers, health)          │
│  - Retention & Image Cleanup Engine                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Folder Structure

```
FB-Post-Automation/
├── apps/
│   └── web/                         # Next.js 14/15 App Router (Dashboard & Web UI)
│       ├── app/                     # App router pages & API routes
│       │   ├── (auth)/              # Login page (single-owner)
│       │   ├── (dashboard)/         # Main layout & dashboard views
│       │   │   ├── pages/           # Facebook Pages management & wizard
│       │   │   ├── profiles/        # Content Profiles & Prompt Studio
│       │   │   ├── inbox/           # Review Inbox
│       │   │   ├── queue/           # Calendar & queue
│       │   │   ├── providers/       # Providers, keys & quality bench
│       │   │   ├── series/          # Story bibles & series continuity
│       │   │   ├── research/        # Research sources & item feeds
│       │   │   └── settings/        # Global settings, retention, kill switch
│       │   └── api/                 # Web API routes (FB OAuth, webhooks)
│       ├── components/              # shadcn/ui and custom components
│       ├── lib/                     # Client/server utils for Next.js
│       └── package.json
├── worker/                          # Standalone Node.js TypeScript Worker
│   ├── src/
│   │   ├── index.ts                 # Worker entrypoint (heartbeat loop & runner)
│   │   ├── stages/                  # Pipeline stages
│   │   │   ├── 01-slot-planner.ts
│   │   │   ├── 02-research-idea.ts
│   │   │   ├── 03-topic-select.ts
│   │   │   ├── 04-write.ts          # Outline -> Chunked Sections -> Polish
│   │   │   ├── 05-qa-safety.ts      # QA Score + Sensitive flags
│   │   │   ├── 06-image.ts          # Generation + Sharp compositing
│   │   │   └── 07-post.ts           # Facebook scheduling/publishing
│   │   ├── router/                  # Provider router, chains, rate limits
│   │   ├── schedulers/              # Cron loops, daily budget planner
│   │   └── server.ts                # Lightweight health/test server
│   ├── Dockerfile
│   ├── railway.json
│   └── package.json
├── packages/
│   └── core/                        # Shared business logic, schemas, adapters
│       ├── src/
│       │   ├── adapters/            # Provider adapters (OpenAI, Gemini, CF, etc.)
│       │   ├── crypto/              # AES-256-GCM encryption/decryption
│       │   ├── facebook/            # Graph API client & types
│       │   ├── prompt-engine/       # Template interpolation, variables, safety
│       │   ├── settings-resolver/   # Global -> Profile -> Page -> Post hierarchy
│       │   ├── types/               # TypeScript interfaces & enums
│       │   └── validation/          # Zod schemas for all models & settings
│       └── package.json
├── prompts/                         # Seed master prompts (Historical, Space, etc.)
├── supabase/
│   ├── migrations/                  # Versioned SQL migrations + RLS + RPCs
│   └── seed.sql                     # Seed profiles, provider presets, defaults
├── docs/
│   ├── PLAN.md                      # This document
│   ├── PROGRESS.md                  # Milestone & step progress log
│   └── DECISIONS.md                 # Architecture and technical decision log
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Lint, test, build verification
│       └── worker-cron.yml          # Optional worker fallback runner
├── package.json                     # Root pnpm/npm workspace config
├── tsconfig.base.json
└── README.md
```

---

## 3. Technology Choices

| Layer | Technology | Rationale |
|---|---|---|
| **Language & Runtime** | Node.js (>=20 LTS) + TypeScript 5.x | Strict typing across packages; native fetch and crypto support. |
| **Workspace Manager** | pnpm workspaces (or npm workspaces) | Clean monorepo dependency management without duplication. |
| **Web Framework** | Next.js (App Router) + Tailwind CSS + shadcn/ui | Modern, responsive, mobile-first dashboard with dark/light mode. |
| **Database & Auth** | Supabase (PostgreSQL 15+, Auth, Storage) | Relational integrity, built-in RLS, object storage for images. |
| **Worker Execution** | Native Node.js background process | Reliable 24x7 event loop on Railway; can run standalone (`worker:once`). |
| **Image Processing** | `sharp` | Fast, low-memory C-lib image manipulation (text panels, resizing, pHash). |
| **Perceptual Hashing**| `blockhash-core` or `sharp` luminance matrix | Fast duplicate/uniform image detection. |
| **Validation** | `zod` | Runtime schema validation across dashboard, worker, and APIs. |
| **Encryption** | Node.js `node:crypto` AES-256-GCM | Industry standard authenticated encryption for tokens and keys. |
| **Testing** | Vitest | Fast ESM-native unit and integration testing with mocked fetch. |

---

## 4. Database Schema & Data Model

1. **`content_profiles`**: Profiles defining master prompts, stage templates, caption settings (min/target/max, hook rule, voice, structure), hashtag settings, image settings, topic settings, and custom variables.
2. **`profile_versions`**: Audit log of profile templates with rollback snapshots.
3. **`pages`**: Connected Facebook Pages, encrypted Page Access Tokens, token status, linked profile, field overrides, posting schedules, publishing modes (`auto`, `review`, `hybrid`), and notifications.
4. **`providers` & `provider_keys`**: Generic AI providers (OpenAI-compatible, Gemini native, Cloudflare, Pollinations, custom HTTP) with encrypted keys, rate limits, RPM/RPD quotas, and active status.
5. **`provider_chains`**: Stage-level priority or weighted chains (idea, topic, outline, write, qa, image, etc.).
6. **`provider_usage_daily`**: Daily counters tracking requests, tokens, neurons, and estimated costs per key.
7. **`research_sources` & `research_items`**: Configured feeds (RSS/APIs) and deduplicated short excerpts with content hashes.
8. **`topic_queue_items`**: Owner-curated topics/premises with ordering and consumption status.
9. **`series` & `series_episodes`**: Story bibles, continuity summaries, and episode history.
10. **`posts`**: Core state machine (`planned` → `researching` → `topic_selected` → `outlining` → `writing` → `qa` → `imaging` → `composing` → `ready` → `pending_review` → `scheduled_on_fb` → `published` / `failed` / `skipped`), holding all stage artifacts, QA scores, flags, and Facebook IDs.
11. **`job_logs`, `alerts`, `audit_log`, `settings`**: Health telemetry, worker heartbeats, and audit trails.

---

## 5. Third-Party Service Integrations & API Analysis

| Service | Endpoint / Method | Verified Specifications & Constraints |
|---|---|---|
| **Facebook Graph API** | `POST /{page-id}/photos`<br>`POST /{page-id}/feed` | • Schedule window: 10 minutes to 30 days in future.<br>• Single photo post: Upload photo unpublished (`published=false`) then attach to feed post via `attached_media=[{"media_fbid":"..."}]` with `scheduled_publish_time` UNIX timestamp.<br>• Caption limit: 63,206 chars.<br>• Dev Mode: Restricts actions to Pages owned by app admin/testers. |
| **Google Gemini** | `POST .../v1beta/models/{model}:generateContent` | • Supported models: `gemini-2.5-flash`, `gemini-1.5-pro`.<br>• Search grounding: `tools: [{ google_search: {} }]`.<br>• Auth: `x-goog-api-key` header or query parameter. |
| **Cloudflare Workers AI** | `POST .../v4/accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell` | • Requires Account ID + Bearer Token.<br>• Text models return JSON; FLUX image model returns raw binary PNG stream.<br>• Free quota: 10,000 neurons/day. |
| **OpenRouter** | `POST https://openrouter.ai/api/v1/chat/completions` | • Standard OpenAI-compatible format with `Authorization: Bearer <key>`.<br>• Respects `X-Title` and `HTTP-Referer` headers.<br>• Provides free-tier models (`:free`). |
| **NVIDIA NIM / Groq / Cerebras / ZenMux** | `POST .../v1/chat/completions` | • Standard OpenAI-compatible endpoints with model-specific token limits. |
| **Pollinations AI** | `GET https://gen.pollinations.ai/image/{prompt}` | • Parameters: `?model=flux&width=1080&height=1350&nologo=true`.<br>• Supports `Authorization: Bearer sk_...` for registered API keys. |
| **Hugging Face** | `POST https://router.huggingface.co/v1/chat/completions` | • Serverless router using OpenAI-compatible interface with `Authorization: Bearer hf_...`. |
| **Supabase** | PostgreSQL 15, PostgREST, Storage | • Atomic queue claiming via Postgres function with `FOR UPDATE SKIP LOCKED`.<br>• Single-owner RLS. Heartbeat prevents free-tier pause. |

---

## 6. Detailed Implementation Steps (Grouped by Milestone)

Each step is atomic, testable, and verified before proceeding to the next.

### Milestone 1: Workspace Scaffolding, Core Foundations & Worker Skeleton
- **Step 1.1: Monorepo & Package Setup**
  - **Goal:** Initialize monorepo structure (`apps/web`, `worker`, `packages/core`), configure TypeScript root, ESLint, Vitest, and script commands.
  - **Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/core/package.json`, `apps/web/package.json`, `worker/package.json`, `.gitignore`.
  - **Testing:** `pnpm install`, `pnpm build`, `pnpm test`.
  - **Done Criteria:** Workspace builds cleanly without dependency conflicts; Vitest runs.
- **Step 1.2: Core Cryptography & Data Schemas**
  - **Goal:** Build AES-256-GCM encryption/decryption module for provider keys and Facebook tokens; build initial Zod schemas for models and settings.
  - **Files:** `packages/core/src/crypto/encryption.ts`, `packages/core/src/validation/schemas.ts`, unit tests.
  - **Testing:** Unit tests verifying encryption/decryption with valid keys, tampered ciphertexts, empty inputs, and round-trips.
  - **Done Criteria:** 100% test pass for cryptographic round-trips and Zod validation checks.
- **Step 1.3: Supabase Schema, Migrations & RLS**
  - **Goal:** Author complete SQL schema covering all 13 tables, indexes, RLS policies (single-owner access), and Postgres RPC for job queue claiming (`claim_next_post_job`).
  - **Files:** `supabase/migrations/20261102000000_init_schema.sql`, `supabase/seed.sql`.
  - **Testing:** Migration verification script or mock Postgres execution testing syntax and RLS rules.
  - **Done Criteria:** Schema executes cleanly with no syntax errors; tables, constraints, and RPC function exist.
- **Step 1.4: Worker Skeleton & Heartbeat Engine**
  - **Goal:** Create standalone worker process with graceful shutdown, loop timer, health server, and database heartbeat writer.
  - **Files:** `worker/src/index.ts`, `worker/src/server.ts`, `worker/src/db.ts`.
  - **Testing:** Run worker in one-shot mode (`npm run worker:once`) and test HTTP health endpoint.
  - **Done Criteria:** Worker boots, logs heartbeat, serves `/health`, handles SIGINT/SIGTERM cleanly.

### Milestone 2: Generic Provider Framework & Adapters
- **Step 2.1: Provider Adapter Interface & OpenAI-Compatible Chat Adapter**
  - **Goal:** Define `TextProviderAdapter` and `ImageProviderAdapter` interfaces. Implement `openai_compatible_chat` with JSON extraction fallback.
  - **Files:** `packages/core/src/adapters/types.ts`, `packages/core/src/adapters/openai-chat.ts`, tests.
  - **Testing:** Vitest with mocked HTTP responses covering normal completions, JSON-mode responses, markdown-wrapped JSON, and network errors.
  - **Done Criteria:** OpenAI chat adapter parses standard and malformed LLM responses with robust fallbacks.
- **Step 2.2: Native Adapters (Gemini, Cloudflare Workers AI, Pollinations)**
  - **Goal:** Implement native Gemini API adapter (with search grounding support), Cloudflare Workers AI (text & FLUX binary image), and Pollinations AI image adapter.
  - **Files:** `packages/core/src/adapters/gemini.ts`, `packages/core/src/adapters/cloudflare.ts`, `packages/core/src/adapters/pollinations.ts`, tests.
  - **Testing:** Unit tests mocking Gemini JSON, Cloudflare FLUX stream/arraybuffer, and Pollinations image download.
  - **Done Criteria:** Adapters transform provider-specific payloads to system standard shapes.
- **Step 2.3: Custom HTTP Template Adapter with SSRF Protection**
  - **Goal:** Implement the generic `custom_http` adapter supporting template variables, JSONPath response extraction, binary response handling, and SSRF IP blocking.
  - **Files:** `packages/core/src/adapters/custom-http.ts`, `packages/core/src/security/ssrf.ts`, tests.
  - **Testing:** Unit tests checking template variable substitution, JSONPath extraction, and blocked local/private/metadata IP addresses.
  - **Done Criteria:** Custom HTTP provider executes safely; rejects `127.0.0.1`, `169.254.169.254`, and private RFC1918 subnets.
- **Step 2.4: Provider Key Pool & Presets**
  - **Goal:** Implement provider key management (storage, rotation, masking, validation) and seed default provider presets.
  - **Files:** `packages/core/src/providers/key-pool.ts`, `packages/core/src/providers/presets.ts`, tests.
  - **Testing:** Unit tests verifying key rotation on failure, masking format (`sk-...1234`), and preset validation.
  - **Done Criteria:** Key pool rotates keys accurately and masks secrets safely.

### Milestone 3: Provider Router, Chains, Quotas & Quality Bench
- **Step 3.1: Provider Router & Execution Engine**
  - **Goal:** Build the provider router that resolves chains (priority, round-robin, least-used, weighted) and handles 429/quota cooldowns and automatic failovers.
  - **Files:** `worker/src/router/provider-router.ts`, `worker/src/router/strategies.ts`, tests.
  - **Testing:** Vitest simulation of 429 status, 401 invalid key, timeout, and consecutive failovers down the chain.
  - **Done Criteria:** Router fails over seamlessly to backup provider without dropping requests; tracks cooldown timestamps.
- **Step 3.2: Quota Tracking & Daily Demand Planner**
  - **Goal:** Track daily usage (requests, tokens, neurons) per provider/key; implement daily planner estimating capacity vs upcoming post demand.
  - **Files:** `worker/src/router/quota-tracker.ts`, `worker/src/schedulers/daily-planner.ts`, tests.
  - **Testing:** Unit tests asserting 80% quota warnings and throttling when demand exceeds available budget.
  - **Done Criteria:** Accurately records usage counters and triggers throttling when budget limits are reached.
- **Step 3.3: Provider Health Checks & Quality Benchmarking**
  - **Goal:** Periodic lightweight ping for active providers and bench runner allowing side-by-side prompt output comparisons.
  - **Files:** `worker/src/router/health-checker.ts`, `worker/src/router/bench-runner.ts`, tests.
  - **Testing:** Mock bench execution comparing two model outputs on the same prompt.
  - **Done Criteria:** Generates benchmark records and health status badges.

### Milestone 4: Settings Resolver & Prompt Engine
- **Step 4.1: Settings Resolver (Global → Profile → Page → Post)**
  - **Goal:** Implement the multi-tier settings inheritance resolver where specific levels override broader levels, with an audit trail showing the source of each setting.
  - **Files:** `packages/core/src/settings-resolver/resolver.ts`, tests.
  - **Testing:** Unit tests verifying that Page overrides beat Profile defaults, and Profile beats Global defaults, with correct provenance reporting.
  - **Done Criteria:** Generates exact "effective settings" map with source labels (`global`, `profile`, `page`, `post`).
- **Step 4.2: Prompt Template Engine & Safety Baseline Injection**
  - **Goal:** Build the template interpolation engine supporting standard and custom variables, and permanently inject the platform safety baseline into all prompt templates.
  - **Files:** `packages/core/src/prompt-engine/interpolator.ts`, `packages/core/src/prompt-engine/safety-baseline.ts`, tests.
  - **Testing:** Unit tests validating variable replacements, missing variable warnings, and safety baseline presence in output prompts.
  - **Done Criteria:** Template substitutes all `{{variables}}` cleanly and preserves mandatory safety directives.

### Milestone 5: Content Profiles & Prompt Studio
- **Step 5.1: Profile Importer & Seed Profiles**
  - **Goal:** Implement parser to import master prompt markdown files (stripping interactive rules like "enter a number") and seed starter profiles (Historical, Science & Space, Photography, Vintage Cars, Horror, Crime, Science Story).
  - **Files:** `packages/core/src/profiles/importer.ts`, `packages/core/src/profiles/seed-profiles.ts`, tests.
  - **Testing:** Import each file in `/prompts` and verify that categories, caption constraints, and clean templates are generated.
  - **Done Criteria:** All 7 starter profiles seeded into database/schemas with correct types (`factual`, `fiction`, `true_story`).
- **Step 5.2: Test Run Runner (Pipeline Simulation without Posting)**
  - **Goal:** Implement a sandboxed test runner executing research/idea → topic → write → QA → image generation without saving to the live posting queue.
  - **Files:** `worker/src/stages/test-run-runner.ts`, tests.
  - **Testing:** Execute end-to-end test run with mocked provider adapters; verify returned intermediate artifacts and token counts.
  - **Done Criteria:** Test run produces caption, image, QA score, and token usage logs without publishing.

### Milestone 6: Research, Idea & Topic Selection Engine
- **Step 6.1: Research Collector (Factual & True Story)**
  - **Goal:** Build RSS and HTTP research collector with SSRF protection, robots.txt compliance, short excerpt truncation (~2,000 chars), and hash deduplication.
  - **Files:** `worker/src/stages/02-research-idea.ts`, `worker/src/research/rss-fetcher.ts`, tests.
  - **Testing:** Unit tests parsing sample NASA/Phys.org RSS XML and verifying duplicate excerpt rejection.
  - **Done Criteria:** Stores new unique `research_items` with SHA-256 content hashes.
- **Step 6.2: Idea Generator & Owner Topic Queue**
  - **Goal:** Implement fiction idea generator from profile premises/story bible, and owner topic queue importer (CSV/TXT/paste).
  - **Files:** `worker/src/stages/02-idea-generator.ts`, `packages/core/src/topics/queue-manager.ts`, tests.
  - **Testing:** Unit tests for CSV topic parsing and fiction premise generation prompt creation.
  - **Done Criteria:** Loads owner topics in order and marks items as used/pending.
- **Step 6.3: Topic Selection with Category Mix & Dedup Window**
  - **Goal:** Candidate pool scoring via LLM + programmatic enforcement of dedup window (default 90 days), category weights, and no consecutive category repetition.
  - **Files:** `worker/src/stages/03-topic-select.ts`, `packages/core/src/topics/dedup.ts`, tests.
  - **Testing:** Unit tests verifying category rotation rules, exclusion list matching, and fuzzy near-duplicate rejection.
  - **Done Criteria:** Selects top-scoring topic respecting all weighting and dedup constraints.

### Milestone 7: Write Pipeline, Long-Form Chunking & QA Validation
- **Step 7.1: Fact Extraction (Factual & True Story)**
  - **Goal:** Extract explicit factual claims and source URLs from research items; strictly constrain writer to only use extracted facts.
  - **Files:** `worker/src/stages/04-fact-extractor.ts`, tests.
  - **Testing:** Unit tests verifying extracted claim JSON structure and source attribution mapping.
  - **Done Criteria:** Generates validated facts list with strict grounding prompt.
- **Step 7.2: Long-Form Generation Engine (Outline → Sections → Stitch → Polish)**
  - **Goal:** Implement multi-step chunked writer: creates structured outline, writes section by section with running summary, stitches sections, and runs polishing pass.
  - **Files:** `worker/src/stages/04-write.ts`, `worker/src/stages/chunker.ts`, tests.
  - **Testing:** Unit tests verifying that target word counts (e.g., 800-1,200 words) are reached reliably across sections.
  - **Done Criteria:** Assembles complete stories/articles meeting min/target/max length requirements.
- **Step 7.3: Programmatic Caption Validators**
  - **Goal:** Implement validators for exact hashtag count, banned/required phrases, n-gram repetition, emoji policy, and fiction disclaimers.
  - **Files:** `packages/core/src/validation/caption-validator.ts`, tests.
  - **Testing:** Unit tests checking rejection of banned phrases, emoji policy violations, incorrect hashtag counts, and repetitive text.
  - **Done Criteria:** Validates caption compliance before reaching QA stage.
- **Step 7.4: QA Scorer & Sensitive Content Classifier**
  - **Goal:** Implement secondary LLM QA scoring (0-100) and sensitive content classifier (violence, real persons, tragedy).
  - **Files:** `worker/src/stages/05-qa-safety.ts`, tests.
  - **Testing:** Unit tests verifying rewrite on first QA failure, skip on second failure, and sensitivity flag triggers.
  - **Done Criteria:** Accurately scores drafts and flags sensitive content for mandatory review.

### Milestone 8: Image Pipeline & Sharp Compositing
- **Step 8.1: Key-Scene Extraction & Image Prompt Generation**
  - **Goal:** Extract key visual scene from story/caption, apply image prompt template, style controls, negative prompts, and series visual bibles.
  - **Files:** `worker/src/stages/06-image-prompt.ts`, tests.
  - **Testing:** Unit tests asserting proper substitution of `{{key_scene}}`, negative prompts, and anti-text/anti-logo directives.
  - **Done Criteria:** Produces complete, compliant image generation prompt.
- **Step 8.2: Image QA & Perceptual Hashing**
  - **Goal:** Validate downloaded image (resolution, uniform/blank check via pixel variance, perceptual hash to prevent duplicate visuals).
  - **Files:** `worker/src/image/qa-checker.ts`, `worker/src/image/phash.ts`, tests.
  - **Testing:** Unit tests testing blank/solid images, low-res images, and duplicate hash matching.
  - **Done Criteria:** Flags defective images and initiates provider retry.
- **Step 8.3: Sharp Image Compositor (Headline Panel & Format Output)**
  - **Goal:** Use `sharp` to render optional custom lower headline panel (for Science & Space profile), resize to 1080×1350, and export JPEG quality 85.
  - **Files:** `worker/src/image/compositor.ts`, tests.
  - **Testing:** Visual compositing tests creating an image with text overlay on black lower panel and inspecting output buffer dimensions.
  - **Done Criteria:** Outputs 1080×1350 JPEG with crisp text overlay when configured, or clean full-bleed image.

### Milestone 9: Facebook Graph API Integration & Publishing
- **Step 9.1: Facebook Graph API Client & Token Management**
  - **Goal:** Build robust Facebook Graph API client supporting long-lived Page tokens, token health verification, rate limit handling, and permission checks.
  - **Files:** `packages/core/src/facebook/client.ts`, `packages/core/src/facebook/tokens.ts`, tests.
  - **Testing:** Mocked Graph API calls testing token expiration detection, rate-limit backoff, and permission validation.
  - **Done Criteria:** Client handles errors gracefully with exponential backoff and actionable error codes.
- **Step 9.2: Photo Scheduling & Publishing Engine**
  - **Goal:** Implement the two-step scheduled photo publisher (`POST /{page-id}/photos` unpublished → `POST /{page-id}/feed` scheduled with `attached_media`), immediate publishing, rescheduling, and post deletion.
  - **Files:** `worker/src/stages/07-post.ts`, tests.
  - **Testing:** Mocked publishing workflows testing `scheduled_publish_time` calculation, error retries, and permalink storage.
  - **Done Criteria:** Posts scheduled accurately within Facebook's 10-minute to 30-day window; permalink and ID recorded.

### Milestone 10: Orchestration, Slot Planning, Modes & Review Inbox
- **Step 10.1: Slot Planning & Schedule Engine**
  - **Goal:** Calculate Page posting slots based on timezone, days of week, time jitter (±10 min), minimum gap, and lead time; maintain queue depth.
  - **Files:** `worker/src/stages/01-slot-planner.ts`, tests.
  - **Testing:** Unit tests asserting slot generation across timezones, jitter bounds, and min-gap enforcement.
  - **Done Criteria:** Dynamically generates upcoming slots to fulfill lead time.
- **Step 10.2: Publishing Modes & Review Inbox State Machine**
  - **Goal:** Enforce `auto`, `review`, and `hybrid` publishing logic: route posts to `pending_review` or `scheduled_on_fb`, and handle auto-approval timeouts.
  - **Files:** `worker/src/stages/publishing-modes.ts`, `packages/core/src/types/inbox.ts`, tests.
  - **Testing:** Unit tests verifying that sensitive-flagged posts are held even in `auto` mode, and low-score posts in `hybrid` go to review.
  - **Done Criteria:** State machine transitions match PRD rules under all mode and flag conditions.
- **Step 10.3: Series Continuity Engine & Story Memory**
  - **Goal:** Manage series bibles, episode numbering, rolling summaries, and continuity verification.
  - **Files:** `worker/src/series/continuity-manager.ts`, tests.
  - **Testing:** Unit tests checking rolling summary updates after episode completion and prompt injection of `{{story_so_far}}`.
  - **Done Criteria:** Continuity state updates sequentially after every episode post.

### Milestone 11: Web Dashboard & UI Views
- **Step 11.1: Dashboard App Shell, Auth & Navigation**
  - **Goal:** Scaffold Next.js dashboard layout with Supabase Auth (single-owner protection), dark/light mode, mobile responsive sidebar, and worker status pill.
  - **Files:** `apps/web/app/(dashboard)/layout.tsx`, `apps/web/components/nav.tsx`, `apps/web/middleware.ts`.
  - **Testing:** Next.js build and route protection testing.
  - **Done Criteria:** Clean UI shell rendered; unauthorized users redirected to login.
- **Step 11.2: Effective Settings Viewer & Prompt Studio UI**
  - **Goal:** Build interactive Effective Settings viewer (showing inheritance source) and Prompt Studio with variable inserter and live preview.
  - **Files:** `apps/web/app/(dashboard)/profiles/prompt-studio.tsx`, `apps/web/components/effective-settings.tsx`.
  - **Testing:** Component tests verifying live variable replacement and diff viewer.
  - **Done Criteria:** Visual editing of all stage templates with instant sample preview.
- **Step 11.3: Review Inbox & Queue/Calendar UI**
  - **Goal:** Build mobile-friendly Review Inbox (inline edit, approve, regenerate topic/caption/image, reject with reason) and calendar view.
  - **Files:** `apps/web/app/(dashboard)/inbox/page.tsx`, `apps/web/app/(dashboard)/queue/page.tsx`.
  - **Testing:** Component tests for action dispatch (approve, reject, edit).
  - **Done Criteria:** Full review workflow operable on mobile and desktop.
- **Step 11.4: Providers, Keys, Chains & Bench UI**
  - **Goal:** Build provider management screen (add custom HTTP, test button, encrypted key input, drag-and-drop chain ordering, usage meters, quality bench).
  - **Files:** `apps/web/app/(dashboard)/providers/page.tsx`, `apps/web/components/chain-editor.tsx`.
  - **Testing:** Form submission and custom HTTP test button interaction testing.
  - **Done Criteria:** Live testing of custom providers and visual chain configuration.

### Milestone 12: Deployment, Hardening & End-to-End Verification
- **Step 12.1: Retention & Pruning Engine**
  - **Goal:** Implement storage retention cleanup: delete images 24h after publishing, delete failed images after 3 days, prune research items >30 days and logs >90 days.
  - **Files:** `worker/src/schedulers/retention-cleaner.ts`, tests.
  - **Testing:** Unit tests verifying image deletion criteria and database prune queries.
  - **Done Criteria:** Deletes eligible storage assets and prunes expired logs.
- **Step 12.2: Production Hardening, Docker & Railway Setup**
  - **Goal:** Create production Dockerfile for worker, Railway deployment configuration (`railway.json`), and GitHub Actions workflow.
  - **Files:** `worker/Dockerfile`, `railway.json`, `.github/workflows/worker-cron.yml`, `README.md`.
  - **Testing:** Docker build and container startup verification.
  - **Done Criteria:** Worker container builds and executes in isolated container environment.
- **Step 12.3: Final End-to-End Acceptance Test Suite**
  - **Goal:** Run comprehensive end-to-end verification across all 12 acceptance criteria in PRD Section 23.
  - **Files:** `tests/e2e/system-acceptance.test.ts`.
  - **Testing:** Full pipeline execution with mock providers and Facebook test fixtures.
  - **Done Criteria:** All PRD acceptance criteria verified and documented in `docs/PROGRESS.md`.

---

## 7. External Credentials & Setup Checklist

To keep things smooth and avoid asking for everything upfront, here is exactly what you will need to provide and at which step:

| Step | Item Needed | Where to Get / How to Set Up | Notes |
|---|---|---|---|
| **Step 1.2** | `ENCRYPTION_KEY` | Generate via `openssl rand -base64 32` or we can generate one automatically for your local `.env`. | Used for encrypting keys & FB tokens. |
| **Step 1.3** | Supabase Project (`URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`) | Free account on [supabase.com](https://supabase.com) → Create Project. | We provide SQL migrations you can paste into SQL Editor or run via CLI. |
| **Step 2.1 - 2.4** | At least ONE AI API key (e.g. Gemini, OpenRouter, Groq, or Cloudflare) | Free API key from Google AI Studio, OpenRouter, Groq, or Cloudflare. | Can test with mocks first; real key added when verifying live generation. |
| **Step 9.1** | Facebook Developer App (`APP_ID`, `APP_SECRET`, Test Page) | [developers.facebook.com](https://developers.facebook.com) → Create App (Business type) in Development Mode. | We will test with a TEST Page only. |
| **Step 12.2** | Railway Project & Vercel Project | [railway.app](https://railway.app) and [vercel.com](https://vercel.com). | For live 24x7 deployment when ready. |

---

## 8. Rules & Safeguards Followed
- **No Hard-Coded Secrets:** All secrets live in `.env` (development) or encrypted database records.
- **PowerShell Compatible:** All commands, file paths, and scripts use standard Windows PowerShell syntax.
- **Fail-Safe & Idempotent:** Worker state machine uses Postgres row locks (`SKIP LOCKED`) and stores intermediate artifacts to prevent duplicate posting or wasted AI tokens.
- **Strict Content Safety:** Platform safety baseline cannot be disabled by any profile or override.

