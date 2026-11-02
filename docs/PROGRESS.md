# Implementation Progress Log

## Phase 0 & Phase 1: Planning and Documentation
- [x] Read PRD (`PRD_autonomous_content_system.md`) and all 4 master prompt files in `/prompts`.
- [x] Researched live official documentation for Facebook Graph API, Gemini, Cloudflare Workers AI, OpenRouter, Pollinations, Hugging Face, Supabase, Railway, Vercel.
- [x] Created `docs/PLAN.md` with complete architecture, folder structure, data model, step-by-step milestones, and user prerequisites.
- [x] Created `DECISIONS.md` capturing initial architectural decisions (DEC-001 through DEC-006).
- [ ] Awaiting user approval ("go") to begin Milestone 1, Step 1.1.

---

## Phase 2: Implementation Milestones

### Milestone 1: Workspace Scaffolding, Core Foundations & Worker Skeleton
- [x] **Step 1.1: Monorepo & Package Setup**
  - **What was built:**
    - Git repository initialized with comprehensive `.gitignore` (ignoring `.env`, secrets, build artifacts, `.pnpm-store`).
    - Monorepo workspace configuration via `pnpm-workspace.yaml` spanning `packages/*`, `apps/*`, and `worker/`.
    - Root TypeScript configuration (`tsconfig.base.json`) with strict ES2022/NodeNext module resolution.
    - Package manifests & TypeScript configs for `@fb-auto/core`, `@fb-auto/worker`, and `@fb-auto/web`.
    - Automated test suite using Vitest with cross-package resolution tests.
  - **Tests run & results:**
    - `pnpm install`: Clean installation in 672ms with approved build scripts.
    - `pnpm run build`: `packages/core` and `worker` compiled successfully (`tsc -b`).
    - `pnpm run type-check`: 0 type errors across all packages.
    - `pnpm test`: 3 passing tests in `tests/workspace.test.ts`.
    - Manual execution: `node worker/dist/index.js` outputs `[Worker] Initialized with @fb-auto/core v0.1.0`.
  - **Issues found & fixed:**
    - *Issue 1:* Missing Node.js global types in `worker` during first build pass.
      *Fix:* Added `@types/node` to root devDependencies and configured `"types": ["node"]` in `tsconfig.base.json`.
    - *Issue 2:* pnpm v11 build script gating for `esbuild`.
      *Fix:* Ran `pnpm approve-builds --all` to authorize esbuild postinstall binary extraction.
  - **Decisions made:**
    - Monorepo structure approved and implemented per DEC-001.
  - **Known limitations:**
    - Sub-packages currently contain minimal scaffold code; cryptographic foundations and schemas will be added in Step 1.2.
- [x] **Step 1.2: Core Cryptography & Data Schemas**
  - **What was built:**
    - Authenticated AES-256-GCM encryption/decryption module in `packages/core/src/crypto/encryption.ts` using fresh 96-bit random IVs and 128-bit authentication tags.
    - Key normalization supporting raw buffers, 64-character hex strings, and 32-byte base64 strings with strict length validation.
    - `maskSecret` helper to safely log and display sensitive API keys and Facebook tokens.
    - Comprehensive Zod validation schemas in `packages/core/src/validation/schemas.ts` and TypeScript interfaces in `packages/core/src/types/index.ts` covering profiles, pages, schedules, posts, and settings.
    - Generated `.env.example` template and initialized a local `.env` with a cryptographically secure 32-byte key.
  - **Tests run & results:**
    - `pnpm run build`: Succeeded with 0 errors across all packages.
    - `pnpm run type-check`: Succeeded with 0 type errors.
    - `pnpm test`: 18/18 tests passed across 3 test suites (`workspace.test.ts`, `crypto.test.ts`, `schemas.test.ts`).
    - Cryptographic verification: Verified round-trips, fallback to `process.env.ENCRYPTION_KEY`, IV non-determinism, tampered ciphertext rejection, and wrong key rejection.
  - **Issues found & fixed:**
    - *Issue:* TypeScript flagged `z.record(valueSchema)` requiring two arguments (`z.record(keySchema, valueSchema)`) under strict type checking.
      *Fix:* Updated `customVariables`, `overrides`, and `qaResult` in `schemas.ts` to explicitly provide `z.string()` as key schema.
  - **Decisions made:**
    - Wire/storage format for encrypted secrets established as `<iv_base64>:<tag_base64>:<ciphertext_base64>`.
  - **Known limitations:**
    - Database persistence and migrations for these schemas are created in Step 1.3.
- [x] **Step 1.3: Supabase Schema, Migrations & RLS**
  - **What was built:**
    - Full PostgreSQL migration in `supabase/migrations/20261102000000_init_schema.sql` covering all 18 relational tables, primary keys, foreign keys, and indexes.
    - Stored procedure `claim_next_post_job()` implementing atomic row locking with `FOR UPDATE SKIP LOCKED` and stage attempt tracking.
    - Row-Level Security (RLS) enabled on all 18 tables with single-owner authenticated access policy (`owner_all_access`).
    - Seed configuration in `supabase/seed.sql` providing default kill switches, retention policies, and provider presets (Gemini, OpenRouter, Groq, Cloudflare, Pollinations, Hugging Face).
  - **Tests run & results:**
    - `pnpm test`: 23/23 tests passed across 4 test suites, including automated verification of all 18 tables, RLS enforcement, RPC function, and seed presets in `tests/migrations.test.ts`.
    - `pnpm run build` and `pnpm run type-check`: Succeeded with 0 errors.
  - **Decisions made:**
    - Concurrency queue mechanism formalized via Postgres RPC (`claim_next_post_job`) per DEC-002.
  - **Known limitations:**
    - Applying migration to a live cloud Supabase instance requires user's project connection, which can be run via Supabase SQL Editor.
- [x] **Step 1.4: Worker Skeleton & Heartbeat Engine**
  - **What was built:**
    - Supabase client factory with cached singleton in `packages/core/src/db/client.ts`.
    - Native Node.js HTTP health & metrics server in `worker/src/server.ts` serving `/health` and authenticated `/trigger` endpoint (authorized via Bearer `WORKER_SECRET`).
    - 24x7 background worker process in `worker/src/index.ts` with configurable loop interval (`WORKER_LOOP_SECONDS`), graceful shutdown (`SIGINT`/`SIGTERM`), and heartbeat recording to the database.
    - One-shot execution support via `node worker/dist/index.js --once` (`npm run worker:once`).
  - **Tests run & results:**
    - `pnpm test`: 27/27 tests passed across 5 test suites (`worker.test.ts`, `migrations.test.ts`, `crypto.test.ts`, `schemas.test.ts`, `workspace.test.ts`).
    - `pnpm run build` and `pnpm run type-check`: 0 errors.
    - Live execution tests:
      - Ran one-shot mode: `node worker/dist/index.js --once` ran cycle #1 and exited with code 0.
      - Ran live background process and queried `http://localhost:8080/health`: verified 200 OK with `status: "healthy"`, `loopCount: 1`, `uptimeSeconds`, and `version`.
  - **Issues found & fixed:**
    - *Issue:* `getWorkerStatus` was missing from `worker/src/index.ts` exports after refactoring to full runner.
      *Fix:* Added `getWorkerStatus` back and re-exported `workerState` and `createHealthServer`.
  - **Decisions made:**
    - Built health server using Node's zero-dependency `node:http` module to keep the worker image lean and memory-efficient.
  - **Known limitations:**
    - Pipeline stages (Milestones 6-10) will be plugged into `runWorkerCycle()` as they are built.

---

### Milestone 2: Generic Provider Framework & Adapters
- [x] **Step 2.1: Provider Adapter Interface & OpenAI-Compatible Chat Adapter**
  - **What was built:**
    - Standard adapter contracts in `packages/core/src/adapters/types.ts`: `TextProviderAdapter`, `ImageProviderAdapter`, `TextGenerateOptions`, `TextGenerateResult`, `ImageGenerateOptions`, `ImageGenerateResult`.
    - Typed `ProviderError` with categorized error kinds (`auth`, `rate_limit`, `timeout`, `content_policy`, `server_error`, `invalid_output`, `network_error`).
    - Robust JSON extractor in `packages/core/src/adapters/json-extractor.ts` handling raw JSON, markdown-wrapped blocks (````json ... ````), and bracket substring extraction.
    - `OpenAIChatAdapter` in `packages/core/src/adapters/openai-chat.ts` supporting OpenAI-compatible providers (OpenRouter, Groq, NVIDIA NIM, ZenMux, Cerebras, Together, Hugging Face), with automatic OpenRouter headers, timeout abort signals, retry fallbacks on unsupported `response_format`, and 429 `retry-after` header extraction.
  - **Tests run & results:**
    - `pnpm test`: 40/40 tests passed across 7 test suites.
    - Verified `tests/json-extractor.test.ts` (6 tests) and `tests/openai-chat.test.ts` (7 tests).
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Error classification structure standardizes error recovery and chain failover decisions for Milestone 3.
  - **Known limitations:**
    - Native adapters for Gemini, Cloudflare, and Pollinations are implemented in Step 2.2.
- [x] **Step 2.2: Native Adapters (Gemini, Cloudflare Workers AI, Pollinations)**
  - **What was built:**
    - `GeminiNativeAdapter` in `packages/core/src/adapters/gemini.ts` with multimodal contents mapping, `systemInstruction`, Google Search grounding support (`tools: [{ google_search: {} }]`), and safety block interception.
    - `CloudflareWorkersAIAdapter` in `packages/core/src/adapters/cloudflare.ts` implementing both text completions (Llama 3.1) and binary image stream processing (FLUX.1-schnell 1080×1350 PNG) with account ID resolution.
    - `PollinationsImageAdapter` in `packages/core/src/adapters/pollinations.ts` with watermark disabling (`nologo=true`), custom dimensions, seed support, and optional Bearer auth.
  - **Tests run & results:**
    - `pnpm test`: 49/49 tests passed across 8 test suites.
    - 9 new unit tests in `tests/native-adapters.test.ts` validating search grounding, safety filters, quota errors, FLUX arraybuffer parsing, and Pollinations query parameters.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Cloudflare adapter handles both `TextProviderAdapter` and `ImageProviderAdapter` interfaces in a single class to unify Cloudflare API token and account management.
  - **Known limitations:**
    - Custom HTTP template adapter and SSRF protection will be built in Step 2.3.
- [x] **Step 2.3: Custom HTTP Template Adapter with SSRF Protection**
  - **What was built:**
    - SSRF protection engine in `packages/core/src/security/ssrf.ts` enforcing `https://`, blocking credentials in userinfo, resolving all DNS A/AAAA records, and rejecting private RFC 1918 subnets, loopbacks, link-local, and cloud metadata (`169.254.169.254`).
    - `ssrfSafeFetch` with pre-connection DNS validation and safe manual redirect following up to `maxRedirects`.
    - Zero-eval JSONPath extractor in `packages/core/src/adapters/jsonpath.ts` supporting nested dot notation and array indexes (`choices[0].message.content`, `data[0].url`) with prototype pollution hardening.
    - Generic `CustomHttpAdapter` in `packages/core/src/adapters/custom-http.ts` supporting arbitrary text and image HTTP APIs with sandboxed template substitution (`{{prompt}}`, `{{model}}`, `{{key}}`, `{{width}}`, `{{height}}`), and response extraction from JSONPath text, base64 data, image URLs, or raw binary streams.
  - **Tests run & results:**
    - `pnpm test`: 62/62 tests passed across 10 test suites.
    - 6 new unit tests in `tests/ssrf.test.ts` and 7 new unit tests in `tests/custom-http.test.ts`.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Implemented strict pre-connection DNS IP validation and manual redirect tracking (`redirect: 'manual'`) per DEC-005.
  - **Known limitations:**
    - Provider key pooling, rotation, and database presets will be implemented in Step 2.4.
- [x] **Step 2.4: Provider Key Pool & Presets**
  - **What was built:**
    - Key pool management module in `packages/core/src/providers/key-pool.ts`:
      - Authenticated AES-256-GCM encryption on creation and masked display (`sk-...1234`).
      - Bulk key import parsing multi-line text with comment filtering (`parseBulkKeys`).
      - Load balancing key selection prioritizing least-used active keys (`getNextAvailableKey`).
      - Automatic cooldown expiration and re-activation.
      - Immediate disable on auth failure (401/403) and dynamic cooldown assignment on rate limit (429).
    - Provider presets registry in `packages/core/src/providers/presets.ts` with configurations for Google Gemini, OpenRouter, Groq, Cloudflare Workers AI, Pollinations AI, Hugging Face Inference, and NVIDIA NIM.
  - **Tests run & results:**
    - `pnpm test`: 73/73 tests passed across 11 test suites.
    - Added 11 unit tests in `tests/key-pool.test.ts` covering key creation, bulk parsing, load balancing, cooldown lifecycles, and preset lookups.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Key selection uses least-used-today strategy to prevent overloading a single key when multiple account keys are configured.
  - **Known limitations:**
    - Provider chains, failover routing, and daily budget planning are built in Milestone 3.

---

### Milestone 3: Provider Router, Chains, Quotas & Quality Bench
- [x] **Step 3.1: Provider Router & Execution Engine**
  - **What was built:**
    - Chain strategy engine in `worker/src/router/strategies.ts`:
      - `priority`: Fixed priority order as configured.
      - `round_robin`: Sequential starting provider rotation.
      - `least_used_today`: Dynamic sorting by lowest daily request count.
      - `weighted_by_remaining_budget`: Sorts by largest remaining daily request capacity.
      - `filterEligibleCandidates`: Filtering out disabled, over-quota, and cooling providers with automatic cooldown expiration.
    - `ProviderRouter` in `worker/src/router/provider-router.ts`:
      - Stage-aware text and image routing (`idea`, `topic`, `outline`, `write`, `polish`, `qa`, `image`, `vision_check`).
      - In-flight automatic failover across keys and providers on 429 (rate limits), 401/403 (invalid keys), 5xx (server errors), and timeouts.
      - `ProviderRouterError` logging full multi-attempt diagnostics when all candidates in a chain fail.
  - **Tests run & results:**
    - `pnpm test`: 84/84 tests passed across 13 test suites.
    - Verified `tests/strategies.test.ts` (6 tests) and `tests/provider-router.test.ts` (5 tests).
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Provider configuration objects (including custom headers, account IDs, and extra request parameters) are automatically merged and forwarded to adapters during router execution.
  - **Known limitations:**
    - Quota tracking database persistence and daily budget demand planning will be added in Step 3.2.
- [x] **Step 3.2: Quota Tracking & Daily Demand Planner**
  - **What was built:**
    - `QuotaTracker` in `worker/src/router/quota-tracker.ts` tracking daily request counts, tokens, neurons, units, and estimated costs with in-memory caching and Supabase `provider_usage_daily` table upserts.
    - Quota check logic calculating percentage utilization, 80% warning threshold alerts, and 100% capacity exhaustion.
    - `DailyDemandPlanner` in `worker/src/schedulers/daily-planner.ts` estimating upcoming text and image demand per Page and caption preset (Short, Standard, Long, Story, Epic) with 20% image retry buffering.
    - Capacity evaluation comparing demand against provider supply, raising actionable warnings, setting `status: 'throttled'`, and expanding slot gaps to 240m when budgets are exceeded.
  - **Tests run & results:**
    - `pnpm test`: 90/90 tests passed across 14 test suites.
    - 6 new unit tests in `tests/daily-planner.test.ts` verifying usage tracking, 80% warning triggers, 100% capacity exhaustion, healthy capacity planning, tight capacity warnings, and demand throttling.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Token estimation calibrated based on PRD Section 2 & 14.3 (Short: 500, Standard: 800, Long: 1500, Story: 3500, Epic: 7500 tokens per post).
  - **Known limitations:**
    - Provider health checks and the quality benchmarking tool are implemented in Step 3.3.
- [x] **Step 3.3: Provider Health Checks & Quality Benchmarking**
  - **What was built:**
    - `ProviderHealthChecker` in `worker/src/router/health-checker.ts` providing lightweight status pings across active providers and key pools with latency measurement and error reporting.
    - `QualityBenchRunner` in `worker/src/router/bench-runner.ts` executing side-by-side prompt comparisons across multiple providers for text and image models.
    - Automatic chain order suggestion (`calculateSuggestedOrder`) ranking providers based on success rates and fastest latency.
  - **Tests run & results:**
    - `pnpm test`: 95/95 tests passed across 15 test suites.
    - 5 new unit tests in `tests/health-bench.test.ts` verifying health checks, inactive provider handling, multi-model text benchmarking, image benchmarking, and suggested chain ordering.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Benchmarking executes providers in parallel via `Promise.all` to provide immediate comparative metrics.
  - **Known limitations:**
    - The settings hierarchy and prompt engine will be built in Milestone 4.

---

### Milestone 4: Settings Resolver & Prompt Engine
- [x] **Step 4.1: Settings Resolver (Global → Profile → Page → Post)**
  - **What was built:**
    - `resolveSettings` engine in `packages/core/src/settings-resolver/resolver.ts` implementing the 4-tier inheritance hierarchy: Global Defaults → Content Profile → Page Overrides → Post Overrides.
    - Full provenance tracking (`ProvenanceRecord`) recording exact origins (`'global'`, `'profile'`, `'page'`, `'page (appended)'`, `'post'`) for every resolved setting, powering the dashboard's "Effective Settings" inspector.
    - Custom prompt resolution supporting both `'append'` and `'replace'` modes for custom caption and image prompts.
    - Global defaults catalog (`GLOBAL_DEFAULTS`) matching production PRD specifications.
  - **Tests run & results:**
    - `pnpm test`: 102/102 tests passed across 16 test suites.
    - 7 new unit tests in `tests/settings-resolver.test.ts` verifying default fallbacks, profile overrides, page supersedence, post-level overrides, custom prompt appending/replacing, and headline panel resolution.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Audit trail maps keys directly by path (e.g. `caption.min`, `templates.captionPrompt`) to simplify UI diff display.
  - **Known limitations:**
    - Prompt template variable interpolation and safety baseline injection are implemented in Step 4.2.
- [x] **Step 4.2: Prompt Template Engine & Safety Baseline Injection**
  - **What was built:**
    - Non-bypassable platform safety baseline engine in `packages/core/src/prompt-engine/safety-baseline.ts`:
      - `TEXT_SAFETY_BASELINE`: Enforces anti-gore, zero sexual content, minor protection, anti-hate, anti-defamation of real individuals, and copyright protection.
      - `IMAGE_SAFETY_BASELINE`: Enforces SFW imagery, no blood/gore, and no living persons' likenesses.
      - `QA_SAFETY_CRITERIA`: Safety evaluation standards for secondary QA models.
      - `injectSafetyBaseline`: Permanent, idempotent baseline injection into all stage prompts.
    - `PromptInterpolator` in `packages/core/src/prompt-engine/interpolator.ts`:
      - Resolves standard template variables (`{{topic}}`, `{{facts}}`, `{{sources}}`, `{{key_scene}}`, `{{word_target}}`, `{{tone}}`, etc.) and owner custom variables (`{{custom.<name>}}`).
      - Automatically formats array inputs (facts, sources) into clean markdown bulleted lists.
      - Tracks and reports any `unresolvedVariables`.
  - **Tests run & results:**
    - `pnpm test`: 110/110 tests passed across 17 test suites.
    - Added 8 unit tests in `tests/prompt-engine.test.ts` verifying text safety injection, image safety injection, QA criteria, variable interpolation, array formatting, custom variables, and unresolved variable detection.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - The safety baseline cannot be disabled by user-configured templates or custom prompt overrides.
  - **Known limitations:**
    - Content profile importing from master prompt files and Prompt Studio test runner are built in Milestone 5.

---

### Milestone 5: Content Profiles & Prompt Studio
- [x] **Step 5.1: Profile Importer & Seed Profiles**
  - **What was built:**
    - Profile importer module in `packages/core/src/profiles/importer.ts`:
      - `stripInteractiveRules`: Strips interactive/human-in-the-loop instructions (e.g. conversational back-and-forth, "wait for my input", "ask before continuing") from legacy prompt markdown to adapt them for autonomous background worker execution.
      - `extractCategoriesFromPrompt`: Automatically parses category bullet lists and topic domains from system prompts into structured array entries.
      - `importMasterPrompt`: Converts markdown master prompt text files into typed `ContentProfile` objects with default length targets, tone, and safety rules.
    - Seed starter profiles catalog in `packages/core/src/profiles/seed-profiles.ts`:
      - 7 production starter profiles: `horror_story` (The Haunting Hour), `crime_story` (Cold Case Chronicles), `science_story` (Science Oddities), `historical_facts` (Echoes of History), `tech_deep_dive` (Future Byte), `psychology_facts` (Mind Curiosities), and `creepy_wikipedia` (Rabbit Hole Oddities).
      - Configured with custom generation prompts, headline overlays, aspect ratios (4:5 / 1:1), and quality standards.
  - **Tests run & results:**
    - `pnpm test`: 115/115 tests passed across 18 test suites.
    - Added 5 unit tests in `tests/profiles.test.ts` covering interactive rule stripping, category extraction, prompt importing, seed profile validation, and profile retrieval by slug.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Interactive rule stripping removes conversational setup rules preceding the first markdown horizontal rule (`---`) to ensure prompt execution in worker batches without stalls.
  - **Known limitations:**
    - Test Run Runner for simulating full multi-stage pipeline generation will be implemented in Step 5.2.
- [x] **Step 5.2: Test Run Runner (Pipeline Simulation without Posting)**
  - **What was built:**
    - `TestRunRunner` class in `worker/src/stages/test-run-runner.ts` powering the Prompt Studio test execution:
      - Simulates the full multi-stage pipeline without saving to the live database or publishing to Facebook:
        1. **Effective Settings**: Resolves settings across the 4 tiers (Global Defaults → Profile → Page Overrides → Post Overrides) with provenance tracking.
        2. **Stage 1 (Topic Selection)**: Handles user-provided manual test topics or auto-proposes high-engagement topics from profile categories via the ProviderRouter.
        3. **Stage 2 (Outline or Fact Extraction)**: Extracts factual bullet points for `factual`/`true_story` profiles, or generates narrative beats/hook points for `fiction` profiles.
        4. **Stage 3 (Caption Writing & Polishing)**: Writes full story posts meeting word count bounds, injecting voice/POV/audience parameters, and extracting hashtags and fiction disclaimers.
        5. **Stage 4 (QA & Safety Scoring)**: Audits length, quality, and platform safety baseline compliance using secondary evaluation models, returning structured QA score (0-100) and sensitivity flags.
        6. **Stage 5 (Image Generation)**: Formulates image prompt with mandatory visual safety directives, calls image providers with target aspect ratio, and returns generated image URLs/buffers.
      - Tracks and returns granular stage metadata: prompts, raw outputs, parsed JSON, token metrics, execution latencies, and overall post summaries.
      - Graceful error containment: Catches router errors or format discrepancies and reports structured failure summaries without worker crashes.
    - Added generic type parsing to `extractJsonFromText<T>` and expanded `PromptContext` in `packages/core`.
  - **Tests run & results:**
    - `pnpm test`: 120/120 tests passed across 19 test suites.
    - Added 5 unit tests in `tests/test-run-runner.test.ts` verifying full fiction pipeline simulation, manual topic overrides, factual profile fact extraction without fiction disclaimers, page override inheritance, and router error containment.
    - `pnpm run build` & `pnpm run type-check`: 0 errors across all workspace packages.
  - **Decisions made:**
    - Test Run operates completely in-memory and sandboxed, never triggering database inserts into `posts` or Facebook Graph API calls per PRD specifications.
  - **Known limitations:**
    - Production batch execution stages (RSS feeds, dedup window, slot planning) are built in Milestones 6 through 10.

---

### Milestone 6: Research, Idea & Topic Selection Engine
- [x] **Step 6.1: Research Collector & Feed Fetcher**
  - **What was built:**
    - SSRF-safe RSS 2.0, RSS 1.0 (RDF), and Atom feed parser in `worker/src/research/rss-fetcher.ts`:
      - Validates feed URLs against loopback, private subnets (RFC 1918), and cloud metadata (`169.254.169.254`) via `ssrfSafeFetch`.
      - Extracts clean titles, URLs, and pubDates across CDATA blocks and standard XML tags without XXE exposure.
      - `stripHtml`: Sanitizes HTML markup, scripts, style blocks, and decodes HTML entities into clean plain text.
      - `truncateExcerpt`: Bounds excerpt text cleanly at word boundaries to ~2,000 characters.
      - `generateContentHash`: Computes deterministic SHA-256 hashes (`title|url/excerpt`) for deduplication.
    - Research ingestion engine in `worker/src/research/collector.ts`:
      - `ResearchCollector` tracking active sources, interval-based polling schedules (`isSourceDue`), and database/in-memory deduplication.
      - Automatic ingestion of fresh articles into Supabase `research_items` and updates `last_fetched_at` on `research_sources`.
    - Stage 02 Research & Idea module in `worker/src/stages/02-research-idea.ts`:
      - Feeds research items into factual / true_story post candidate pipelines.
      - Generates creative story premises via LLM for fiction profiles adhering to tone, genre, and series continuity.
  - **Tests run & results:**
    - `pnpm test`: 130/130 tests passed across 20 test suites.
    - Added 10 unit tests in `tests/research-collector.test.ts` covering HTML stripping, excerpt truncation, SHA-256 hashing, RSS/Atom feed parsing, SSRF URL blocking, source polling intervals, deduplication skipping, and stage execution.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - XML feed parser parses feeds directly using safe RegExp matching without DTD entity expansion, ensuring 100% XXE immunity and eliminating external XML parsing dependencies.
  - **Known limitations:**
    - Owner topic queue management (CSV/paste import, random/ordered usage) and category-weighted topic selection will be implemented in Steps 6.2 and 6.3.
- [x] **Step 6.2: Idea Generator & Owner Topic Queue**
  - **What was built:**
    - Owner Topic Queue manager in `packages/core/src/topics/queue-manager.ts`:
      - `parseTopicImport`: Robust parser for bulk topic imports supporting multi-line plain text, comma-separated entries, standard CSVs with headers (`topic/text`, `category`), comment filtering (`#` and `//`), and double-quoted fields with embedded commas.
      - `enqueueTopics`: Converts parsed entries into typed `TopicQueueItem` objects with UUIDs, sort orders, and pending statuses.
      - `getNextTopic`: Retrieves the next eligible topic using FIFO ordering (lowest `sort_order`) or random selection, with optional case-insensitive category filtering.
      - `markTopicStatus`: Transition states (`pending` → `used` | `skipped`) and records ISO timestamps.
      - `getQueueStats`: Comprehensive queue distribution counters across statuses and categories.
    - Autonomous Idea Generator in `worker/src/stages/02-idea-generator.ts`:
      - Generates high-engagement story topics and premises via the `ProviderRouter` for fiction and general niches.
      - Constrains generation by profile categories, target audiences, tone, POV, and negative keyword/banned topic avoidance.
      - Supports series continuity memory (`seriesBible`, `storySoFar`, `episodeNumber`) and flags ideas as `series` or `auto_idea`.
      - Extracts key visual scene concepts and estimated hook strength scores (1-10) with graceful unstructured fallback handling.
  - **Tests run & results:**
    - `pnpm test`: 140/140 tests passed across 21 test suites.
    - Added 10 unit tests in `tests/topic-queue.test.ts` covering plain-text/CSV parsing, FIFO queue progression, random selection, category filtering, queue statistics, series continuity incorporation, and LLM idea generation.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Topic CSV parsing parses double-quoted fields natively without third-party CSV libraries to maintain minimal dependency footprint and total security.
  - **Known limitations:**
    - Topic selection scoring and 90-day history deduplication window are implemented in Step 6.3.
- [x] **Step 6.3: Topic Selector, Category Weights & Dedup**
  - **What was built:**
    - Deduplication engine in `packages/core/src/topics/dedup.ts`:
      - `normalizeTopic`: Strips noise stop words, punctuation, and accents for clean comparison.
      - `computeTopicSimilarity`: Hybrid token Jaccard and character-bigram Dice coefficient (0.0 to 1.0) detecting near-duplicates across topic rewordings.
      - `isTopicDuplicate`: Enforces the PRD 90-day / 200-post deduplication window, rejecting candidate topics with similarity >= 0.65 against history.
      - `generateTopicKey`: Generates 32-character SHA-256 hash keys for indexed fast lookups in `topic_history`.
      - `recordTopicHistory`: Helper storing published topics into Supabase `topic_history`.
    - Category weighting & mix selector in `packages/core/src/topics/category-selector.ts`:
      - `selectTargetCategory`: Roulette-wheel weighted category selection honoring configured weights and enforcing the "prevent consecutive repeated category" rule.
    - Stage 03 Topic Selector in `worker/src/stages/03-topic-select.ts`:
      - Gathers candidate pool from enabled sources (`owner_queue`, `research`, `auto_topics`, `series`).
      - Filters candidate pool against 90-day post history, banned topics, and negative keyword exclusion lists.
      - Executes multi-candidate LLM scoring judging curiosity gap, emotional hook, profile fit, and visual image potential.
      - Generates clean emergency fallback candidates if all inputs were filtered out.
  - **Tests run & results:**
    - `pnpm test`: 147/147 tests passed across 22 test suites.
    - Added 7 unit tests in `tests/topic-selector.test.ts` covering normalization, similarity scoring, 90-day window dedup rejection, consecutive category avoidance, multi-candidate LLM selection, and fallback generation.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Combined word token Jaccard and character bigram Dice coefficient to accurately flag semantic duplicates regardless of phrasing changes.
  - **Known limitations:**
    - Long-form chunked writing and programmatic caption validators are built in Milestone 7.

---

### Milestone 7: Write Pipeline, Long-Form Chunking & QA Validation
- [x] **Step 7.1: Fact Extraction Pipeline (Factual / True-Story)**
  - **What was built:**
    - Dedicated Fact Extractor stage in `worker/src/stages/04-fact-extractor.ts`:
      - Produces structured, verified `FactSheet` objects for `factual` and `true_story` profiles:
        - `confirmedFacts`: Strict array of verified factual claims supported by research evidence or public records.
        - `timeline`: Chronological event breakdown (`time` and `event`) for historical/true-crime narratives.
        - `hypotheticalOrAlleged`: Explicitly tags unverified theories, disputed hypotheses, or allegations with cautious phrasing ("alleged", "claimed", "theorized").
        - `sourceLine` / `sourceUrl`: Attribution line recording source provenance.
        - `allFactBullets`: Clean flattened list of factual constraints supplied exclusively to downstream writing stages.
      - Hallucination prevention: Strict instruction forbidding invented dates, numbers, quotes, or people.
      - Fault-tolerant fallback: Gracefully converts plain-text or markdown bullet lists into structured fact sheets if secondary LLM returns unstructured text.
      - Mandates safety baseline injection (`injectSafetyBaseline`).
  - **Tests run & results:**
    - `pnpm test`: 150/150 tests passed across 23 test suites.
    - Added 3 unit tests in `tests/fact-extractor.test.ts` verifying confirmed facts extraction, timeline construction, cautious wording for true-crime, safety baseline presence, and unstructured markdown bullet fallback.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Fact extractor enforces JSON output mode and aggregates facts, timeline items, and alleged claims into `allFactBullets` to ensure writers only use verified material.
  - **Known limitations:**
    - Long-form writer chunking (outline → sections → stitch → polish) and length enforcement are built in Step 7.2.
- [x] **Step 7.2: Long-Form Writer & Chunker (Outline → Sections → Stitch → Polish)**
  - **What was built:**
    - Narrative chunking engine in `worker/src/stages/chunker.ts`:
      - `planSectionBudgets`: Distributes target word budgets (250–2,500 words) across 4 standard narrative phases: Hook & Opening (~18%), Rising Tension / Evidence (~32%), Climactic Revelation (~32%), and Aftermath / Reflection (~18%).
      - `formatParagraphs`: Formats post prose into mobile-friendly paragraphs of maximum 1–3 sentences (`\n\n`) per PRD readability standards.
      - `countWords`: Accurately computes word counts.
    - Full Write stage in `worker/src/stages/04-write.ts`:
      - **Short-form direct generation (<250 words)**: Single-pass generation bypassing chunking overhead, producing concise viral posts.
      - **Long-form 4-phase chunked generation (>=250 words)**:
        1. **Outline & Budgeting**: Establishes section boundaries and target word counts.
        2. **Sequential Section Writing**: Writes sections sequentially while maintaining a running summary across calls for continuity.
        3. **Stitching**: Seamlessly connects section narratives without duplicate seam sentences.
        4. **Polish Pass**: Optional editing pass via the `'polish'` pipeline stage to smooth transitions, tighten pacing, and enforce mobile paragraph structures.
      - Extracts and bounds hashtags, formats source attribution lines, and attaches fiction disclaimers for creative fiction profiles.
      - Passed series continuity memory (`seriesBible`, `storySoFar`, `episodeNumber`) into long-form sections.
  - **Tests run & results:**
    - `pnpm test`: 156/156 tests passed across 24 test suites.
    - Added 6 unit tests in `tests/write-chunker.test.ts` verifying word counting, section budget planning, paragraph sentence chunking, short-form direct execution, 4-phase long-form chunked generation, and series bible continuity passing.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Preserves consistent provider within a post run, providing running summaries across section calls to prevent drift or disjointed transitions.
  - **Known limitations:**
    - Programmatic caption validators and secondary QA safety audits are built in Steps 7.3 and 7.4.
- [x] **Step 7.3: Programmatic Caption Validators (Lengths, Sentences, Hooks, Emojis, Disclaimers)**
  - **What was built:**
    - Pure deterministic caption validator in `packages/core/src/validation/caption-validator.ts`:
      - `validateCaption`: Rapid zero-token compliance auditing across 7 critical constraints:
        1. **Length Boundaries**: Bounds word count or character count strictly within `[min, max]` settings.
        2. **Opening Hook Check**: Rejects conversational opening greetings ("Hello everyone", "Hey guys", "In this post", "Buckle up") to protect the scroll-stopping hook before Facebook's "...See more" fold.
        3. **Paragraph Length**: Enforces mobile readability standards, flagging wall-of-text paragraphs exceeding `maxSentencesPerParagraph` (default 3 sentences).
        4. **Emoji Policy**: Enforces `none` (0 emojis), `minimal` (max 2 emojis), or `moderate` (max 1 per paragraph) policies via Unicode property analysis.
        5. **Banned Phrases**: Searches for forbidden cliches or buzzwords configured in profile/page settings.
        6. **Required Phrases**: Verifies presence of mandatory call-to-action phrases.
        7. **Fiction Disclaimer**: Enforces mandatory disclosure on creative fiction profiles.
      - Calculates deterministic compliance score (0–100) and actionable fix suggestions.
      - `repairCaption`: Auto-repair utility that strips emojis under `none` policy, splits bloated paragraphs at sentence boundaries, and appends missing fiction disclaimers.
  - **Tests run & results:**
    - `pnpm test`: 169/169 tests passed across 25 test suites.
    - Added 13 unit tests in `tests/caption-validator.test.ts` verifying min/max lengths, greeting hook rejections, paragraph sentence checks, emoji policies, banned/required phrases, fiction disclaimer checks, and auto-repair routines.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - All programmatic formatting checks run locally in memory without invoking LLMs, ensuring sub-millisecond execution and zero token cost.
  - **Known limitations:**
    - Secondary LLM QA scoring and sensitive-content classification are implemented in Step 7.4.
- [x] **Step 7.4: QA Scoring & Content Safety Classifier (Secondary Model Audit)**
  - **What was built:**
    - Secondary model QA evaluation & safety audit stage in `worker/src/stages/05-qa-safety.ts`:
      - Evaluates posts across 4 quality dimensions: `hookScore` (0-25), `flowVoiceScore` (0-25), `groundingScore` (0-25), and `complianceScore` (0-25), summing to a 0–100 composite score.
      - Content safety classification detecting sensitive violations: `gore_violence`, `sexual_content`, `hate_harassment`, `self_harm`, `defamation_real_person`, `copyright_infringement`, and `misleading_news`.
      - **PRD Mandatory Safety Rule**: Any post with a sensitive flag is ALWAYS held for manual review (`mustHoldForReview = true`), even when a Page is configured in `auto` publishing mode, preventing platform bans.
      - Hybrid mode thresholding (`hybridMinScore`, default 80): Automatically routes subpar posts to the Review Inbox while approving high-scoring clean posts.
      - Actionable feedback and remediation directions attached to post records.
  - **Tests run & results:**
    - `pnpm test`: 174/174 tests passed across 26 test suites.
    - Added 5 unit tests in `tests/qa-safety.test.ts` verifying high-quality post approval, mandatory review hold for sensitive posts in auto mode, hybrid mode score threshold routing, review mode universal holding, and unparseable output fallback handling.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Combined deterministic caption validation with secondary LLM scoring to provide multi-layered defense against policy violations.
  - **Known limitations:**
    - Image prompt generation, perceptual hashing, and Sharp panel compositing will be built in Milestone 8.

---

### Milestone 8: Image Pipeline & Sharp Compositing
- [x] **Step 8.1: Key Scene Extractor & Image Prompt Template Builder**
  - **What was built:**
    - Key Scene extraction engine in `worker/src/stages/06-image-prompt.ts`:
      - `extractKeySceneFromProse`: Extracts the central visual scene across 4 configurable modes:
        - `opening`: Setting and atmospheric visual hook from the first 1–2 sentences.
        - `climax`: Pivotal dramatic revelation or confrontation from the narrative's climax (60%–80% story mark).
        - `mood`: Environmental tone, weather, lighting, and textural atmosphere.
        - `character`: Central figure, expression, attire, and immediate surroundings.
        - Direct seed override: Prioritizes explicit visual concepts generated in earlier pipeline stages when available.
    - Image prompt template builder in `worker/src/stages/06-image-prompt.ts`:
      - `executeImagePromptStage`: Interpolates templates with visual styles (`cinematic`, `photorealistic`, `vintage`, etc.).
      - Mandates non-bypassable image safety directives (`IMAGE_SAFETY_BASELINE`: SFW, no gore, no blood, no text inside image, no living persons' likenesses).
      - Consolidates and deduplicates negative prompts.
      - Calculates dimensions based on target aspect ratio (`4:5` -> 1080×1350, `1:1` -> 1080×1080, `16:9` -> 1920×1080).
  - **Tests run & results:**
    - `pnpm test`: 182/182 tests passed across 27 test suites.
    - Added 8 unit tests in `tests/image-prompt.test.ts` verifying scene extraction for opening, climax, mood, and character modes, seed concept priority, safety baseline injection, negative prompt deduplication, and aspect ratio dimension calculation.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Extracted scene descriptions are stripped of transitional dialogue and filler to keep diffusion model prompts dense with visual descriptors.
  - **Known limitations:**
    - Image QA (blank / solid color checks, perceptual hashing) and Sharp headline compositing are implemented in Steps 8.2 and 8.3.
- [x] **Step 8.2: Image QA, Uniformity / Blank Check & Perceptual Hashing (pHash)**
  - **What was built:**
    - High-performance image QA and perceptual difference hashing module in `worker/src/image/image-qa.ts` powered by `sharp`:
      - `computeImageStdDev`: Resizes image to 64x64 grayscale and calculates pixel intensity standard deviation $\sigma$ across raw bytes. Detects blank, solid color, black, or refusal outputs ($\sigma < 5.0$).
      - `computeImagePhash`: Calculates a 64-bit difference hash (dHash) by resizing to 9x8 grayscale and comparing 64 adjacent horizontal pixel gradient pairs, returning an invariant 16-character hexadecimal hash.
      - `computeHammingDistance`: Computes bit differences (0 to 64) between two 16-hex perceptual hashes using bitwise XOR.
      - `validateImageBuffer`: Comprehensive QA gate evaluating:
        - Corruption & minimum buffer size checks.
        - Minimum resolution validation (e.g. $\ge 512\times 512$).
        - Solid color / blank image rejection.
        - Perceptual duplicate detection against historical post hashes with configurable Hamming distance threshold ($\le 10$).
  - **Tests run & results:**
    - `pnpm test`: 196/196 tests passed across 28 test suites.
    - Added 14 unit tests in `tests/image-qa.test.ts` verifying std-dev calculation for solid colors vs complex patterns, 16-char hex dHash formatting, exact Hamming distances, corruption rejection, dimension rejection, solid color rejection, duplicate detection, and clean validation.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Selected 64-bit dHash over block mean pHash for its superior resistance to minor gamma / compression artifacts and high computation speed in `sharp`.
  - **Known limitations:**
    - Sharp headline panel compositing and aspect ratio letterbox/pillarbox/crop rendering will be built in Step 8.3.
- [x] **Step 8.3: Sharp Headline Panel Renderer & Aspect Ratio Composition**
  - **What was built:**
    - High-performance image compositing and headline panel overlay engine in `worker/src/image/compositor.ts`:
      - `getAspectDimensions`: Dimension mappings for Facebook-optimized aspect ratios: `4:5` (1080×1350), `1:1` (1080×1080), and `16:9` (1920×1080).
      - `escapeXml`: Sanitizes headline, source, and watermark strings preventing SVG/XML parsing failures on quotes, ampersands, and angle brackets.
      - `wrapTextToLines`: Clean word-wrapping breaking long headlines into balanced, readable lines without splitting individual words.
      - `buildHeadlinePanelSvg`: Generates crisp SVG overlay with:
        - Configurable panel height (10%–50%, default 25%).
        - Solid high-contrast background (e.g. `#000000`, customizable hex/rgba).
        - Dynamic auto-scaling font size sizing (54px down to 24px) ensuring headlines (8–22 words) fit comfortably within horizontal and vertical panel bounds.
        - Text alignment (`center` or `left`) with customizable padding.
        - Optional upper watermark / page branding tag and lower source attribution note (`sourceText`).
      - `composePostImage`:
        - Sharp pipeline scaling raw generation buffer to exact target dimensions (`cover` / `contain` / `fill`).
        - Composites SVG headline panel overlay when enabled.
        - Exports progressive JPEG at quality 85 with mozjpeg optimization.
  - **Tests run & results:**
    - `pnpm test`: 209/209 tests passed across 29 test suites.
    - Added 13 unit tests in `tests/compositor.test.ts` covering aspect ratio dimension calculations, XML escaping, word wrapping, SVG panel generation with source/watermark, clean image scaling to 1080x1350 JPEG, full panel overlay compositing, square (1:1) and widescreen (16:9) formats, and custom dimension overrides.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Rendered the headline panel as a vectorized SVG overlay in `sharp` rather than relying on image diffusion models, ensuring 100% spelling precision, perfect typography contrast, and mobile readability per PRD Section 8 & Master Prompts.
  - **Known limitations:**
    - Image compositing is completed. Facebook Graph API publishing of composed images will be built in Milestone 9.

---

### Milestone 9: Facebook Graph API Integration & Publishing
- [x] **Step 9.1: Facebook Graph API Client & Token Management**
  - **What was built:**
    - Official Facebook Graph API client in `packages/core/src/facebook/client.ts` targeting Graph API `v21.0`:
      - `FacebookGraphClient`: Handles GET, POST, and DELETE with automatic query formatting, Bearer token authorization, and abort timeouts.
      - Error classification in `FacebookGraphError`:
        - `isAuthError`: Code 190 (expired/revoked session, invalid token).
        - `isRateLimit`: Codes 4, 17, 32, 368 (user/app/business rate limits and action spam protection).
        - `isPermissionError`: Codes 10, 200–299 (missing scopes or non-admin roles).
        - `isRetryable`: Network errors, server 5xx errors, codes 1, 2, 500, and rate limits with exponential backoff and jitter.
      - Usage telemetry tracking for `x-app-usage` and `x-page-usage` headers with 80% capacity warning detection.
      - `debugToken` & `inspectTokenHealth`: Evaluates token validity, expiration timestamps (recognizing permanent Page tokens with `expires_at === 0`), and verifies granted vs missing required scopes (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`).
      - `verifyPagePermissions`: Verifies administrative and publishing tasks (`CREATE_CONTENT` / `MANAGE`) on target Page IDs.
    - Encrypted token management in `packages/core/src/facebook/tokens.ts`:
      - `encryptPageToken` & `decryptPageToken`: Authenticated AES-256-GCM encryption for stored Page tokens.
      - `maskFacebookToken`: Safe logging mask (`EAABcd...1234`).
      - `exchangeForLongLivedUserToken`: Exchanges short-lived OAuth tokens for 60-day user tokens.
      - `fetchManagedPages`: Retrieves all managed Pages with permanent Page access tokens and tasks.
  - **Tests run & results:**
    - `pnpm test`: 222/222 tests passed across 30 test suites.
    - Added 13 unit tests in `tests/facebook-client.test.ts` verifying API request construction, error categorization, retry backoff on transient errors, permanent page token inspection, expired token rejection, missing scope detection, page task verification, AES-256-GCM token encryption roundtrips, and long-lived token exchange.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Treated `expires_at: 0` as permanent (never-expiring) per Facebook Graph API specifications for Page access tokens generated from long-lived user tokens.
  - **Known limitations:**
    - Photo upload and feed scheduling will be implemented in Step 9.2.
- [x] **Step 9.2: Photo Scheduling & Publishing Engine**
  - **What was built:**
    - High-level Facebook publishing orchestrator in `packages/core/src/facebook/publisher.ts`:
      - `validateSchedulingWindow`: Enforces Facebook Graph API scheduling boundaries: scheduled posts must be scheduled between 10 minutes and 30 days into the future.
      - `computePostContentHash`: Deterministic SHA-256 hash of caption and image perceptual hash (`caption + phash`) preventing duplicate submissions.
      - `FacebookPublisher`:
        - Two-step publishing architecture:
          1. `uploadUnpublishedPhoto`: Uploads JPEG buffer (via multipart `FormData`) or remote image URL to `POST /{page-id}/photos` with `published=false`, returning the generated `media_fbid`.
          2. `publishFeedPost`: Creates feed post on `POST /{page-id}/feed` attaching the uploaded photo (`attached_media=[{ media_fbid }]`), setting `published=false` and `scheduled_publish_time` for future posts, or `published=true` for immediate publishing.
        - `reschedulePost`: Updates `scheduled_publish_time` on existing scheduled posts.
        - `deletePost`: Removes scheduled or published posts from Facebook via `DELETE /{post-id}`.
        - `getPostDetails`: Fetches publication status and canonical permalink (`permalink_url`).
    - Worker Stage 7 Publishing Pipeline in `worker/src/stages/07-post.ts`:
      - `executePublishStage`: Integrates content hash calculation, AES-256-GCM token decryption, safety overrides, and mode routing:
        - Mandatory review holds for sensitive content (`mustHoldForReview` or sensitive flags) even in `auto` mode.
        - Review mode hold routing to Review Inbox.
        - Hybrid mode scoring thresholding (`qaScore >= hybridMinScore`).
        - Facebook scheduling via `FacebookPublisher`.
  - **Tests run & results:**
    - `pnpm test`: 236/236 tests passed across 31 test suites.
    - Added 14 unit tests in `tests/facebook-publisher.test.ts` verifying scheduling window validation (10 min minimum, 30 days maximum, past date rejection), deterministic SHA-256 content hashing, two-step photo upload and scheduled feed post creation, immediate publishing, rescheduling, post deletion, mandatory safety hold rules, review mode routing, hybrid score thresholds, and token decryption.
    - `pnpm run build` & `pnpm run type-check`: 0 errors.
  - **Decisions made:**
    - Structured publishing as an explicit two-step transaction (`photos` unpublished -> `feed` with `attached_media`) matching Meta's recommended Graph API pattern for high-resolution feed photo scheduling.
  - **Known limitations:**
    - Publication status reconciliation loop and exponential retry poller will be implemented in Step 9.3.
- [ ] **Step 9.3: Publishing Status Reconciliation & Error Retries**

