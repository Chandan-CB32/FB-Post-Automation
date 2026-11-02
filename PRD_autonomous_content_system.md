# PRD : CUSTOMIZABLE AUTONOMOUS MULTI-PAGE FACEBOOK CONTENT SYSTEM
## RESEARCH / IDEA → TOPIC → WRITE → IMAGE → POST, WITH FULL PROMPT AND SETTINGS CONTROL

**Instructions for the AI coding tool:** Build the complete system described below. Before using any third-party API (Facebook Graph API, Cloudflare Workers AI, Google Gemini, OpenRouter, NVIDIA NIM, ZenMux, Pollinations, Hugging Face, Groq, Supabase, Railway, Vercel), check its CURRENT official documentation and use current endpoints, model names, versions and limits. Do not guess API shapes. Do not ask questions; where this document is open, choose the simplest option and record it in `DECISIONS.md`. Work milestone by milestone (section 22): after each milestone run the tests, commit, tell me how to verify it manually, then stop.

This PRD replaces all earlier PRDs. There is NO Meta AI, NO browser extension, NO scraping of consumer websites, and NO storage of any Meta/Facebook password anywhere in this system.

---

## 1. PRODUCT SUMMARY

A private, single-owner web app plus a 24x7 background worker. The owner connects many Facebook Pages. Each Page is linked to a **Content Profile** (a customizable "master prompt" package for one topic type, for example Science & Space, Horror Story, Crime Story, Science Story, Historical Photos, Vintage Cars) and can override any setting or prompt. After a one-time setup, the system posts every day automatically, per Page, using this pipeline:

1. **RESEARCH or IDEA:** factual profiles collect fresh, verifiable material from configured sources; fiction profiles generate story premises from the profile and series memory.
2. **TOPIC:** choose the next topic or episode that has not been used recently (or take it from the owner's topic queue).
3. **WRITE:** write the title, the caption (short fact post or long story, with the length the owner configured) and the hashtags.
4. **IMAGE:** generate ONE image for the post from the caption's key scene or topic.
5. **POST:** publish the image with the caption on the Page, either fully automatically or after the owner's review (selectable per Page).

The system uses free-tier AI APIs where possible, with automatic failover between providers and keys. The owner can add ANY new provider or key at any time from the dashboard without code changes or redeploys.

## 2. SCALE AND CONSTRAINTS

- Launch with 1 test Page, then 5, then 20 Pages (target: 20 Pages × 5 posts/day = 100 posts/day, about 120 images/day with retries). Design to grow beyond that.
- Long-form stories use many more text tokens than short posts. The system must estimate demand per Page and track daily budgets per provider, spreading generation across the day and throttling when needed.
- Free tiers are limited and change. Nothing is assumed unlimited; the system shows remaining budgets and degrades gracefully (delays generation, never publishes unverified or broken content).

## 3. GOALS AND NON-GOALS

**Goals**
- Maximum customization: every prompt, length, topic rule, style and schedule is editable at the profile level and overridable per Page and per post.
- Works for factual niches (grounded in sources) and fiction niches (story generation with continuity).
- One image per post and either a short caption or a big story caption, as configured.
- Per-Page choice of fully automatic publishing or review before publishing, plus a smart hybrid mode.
- Provider-agnostic AI layer with custom providers, failover, quotas and health.
- Low cost (target: Railway Hobby about $5/month plus free tiers).

**Non-goals**
- No Meta AI automation, no extension, no cookie/session/password use for any service.
- No engagement bots, fake comments or follow/like automation.
- No public users, billing or teams.

## 4. TECH STACK (DEFAULT)

- **Dashboard + API:** Next.js (App Router, TypeScript), Tailwind + shadcn/ui, on Vercel.
- **Database + file storage:** Supabase (Postgres + Storage).
- **Worker:** Node.js + TypeScript in `/worker` on Railway; also runnable one-shot (`npm run worker:once`).
- **Image processing:** `sharp`. **Validation:** zod. **HTTP:** native fetch with timeouts and retries.
- **Auth:** single owner (Supabase Auth, signups disabled).

## 5. ARCHITECTURE

```
Dashboard (Vercel) ──► Supabase (DB + Storage) ◄── Worker (Railway, 24x7)
                                                      │
   Stages: Research/Idea → Topic → Write (chunked) → QA → Image → Post
                                                      │
        Settings Resolver (Global → Profile → Page → Post)
        Prompt Engine (templates + variables + safety baseline)
        Provider Router (chains, failover, quotas, key pool)
```

- The worker owns all AI and Facebook calls. The dashboard reads/writes the database and queues manual actions.
- The pipeline is a durable, resumable state machine stored in Postgres; each stage stores its output so retries never repeat finished work. Use row locks (`FOR UPDATE SKIP LOCKED`); safe to run twice.

## 6. SETTINGS HIERARCHY (THE CUSTOMIZATION BACKBONE)

Every setting is resolved in this order, with the most specific winning:

**Global defaults → Content Profile → Page overrides → Per-post manual override**

- The dashboard has an **"Effective settings" viewer** for any Page showing, for each setting, its final value and where it came from.
- Every prompt and setting in sections 7 and 8 follows this hierarchy.
- The platform safety baseline (section 12) sits above all of it and cannot be removed.

## 7. CONTENT PROFILES (REUSABLE TOPIC PACKAGES)

The owner can create unlimited profiles and clone/edit them. Seed profiles are created from the four existing master prompt files in `/prompts` plus the new starters in Appendix A (Horror Story, Crime Story, Science Story). A profile contains:

### 7.1 Identity and type
- Name, description, language, audience description.
- **Content type** (drives pipeline behavior):
  - `factual`: research-grounded posts (science facts, history, nature, cars).
  - `fiction`: original stories (horror, crime fiction, romance, etc.); no research; uses idea generation, story bible and continuity.
  - `true_story`: narrative built from real, public, sourced material (history stories, public-record true crime); uses research and fact grounding with cautious language.
  - `evergreen`: advice/lifestyle/motivation content with no news dependence.

### 7.2 Master prompt and prompt templates (Prompt Studio)
- **Master prompt:** a free-text field holding the niche's full master prompt (the same style as the existing four prompt files).
- **Stage templates**, each fully editable: `idea/topic prompt`, `fact extraction prompt` (factual/true_story), `outline prompt` (long form), `caption/story prompt`, `polish prompt`, `title/headline prompt`, `hashtag prompt`, `QA prompt`, `image prompt template`, `negative image prompt`.
- Templates support variables, for example: `{{page_name}}`, `{{niche}}`, `{{topic}}`, `{{topic_title}}`, `{{category}}`, `{{facts}}`, `{{sources}}`, `{{title}}`, `{{caption}}`, `{{caption_summary}}`, `{{key_scene}}`, `{{tone}}`, `{{pov}}`, `{{audience}}`, `{{language}}`, `{{word_min}}`, `{{word_max}}`, `{{word_target}}`, `{{hashtag_count}}`, `{{story_so_far}}`, `{{series_bible}}`, `{{episode_number}}`, `{{recent_titles}}`, `{{avoid_list}}`, `{{required_phrases}}`, `{{image_style}}`, `{{date}}`, `{{custom.<name>}}` (owner-defined variables).
- **Prompt Studio UI:** editor with variable inserter, a live "effective prompt" preview with sample data, a **Test run** (runs the full pipeline for the profile or Page WITHOUT posting and shows every stage's output, tokens and provider used), and **version history with rollback**. Old interactive-only rules from the original master prompts ("when I send a number", CONTINUE, batches) are replaced by the scheduler and are stripped at import.

### 7.3 Topic and category control
- **Topic sources (combinable with weights):**
  1. *Auto topics:* the LLM proposes topics within the profile's categories.
  2. *Owner topic queue:* paste or import (CSV/TXT) a list of topics or story premises; used in order or randomly; marked used when published.
  3. *Research-based* (factual/true_story): from configured sources.
  4. *Series mode:* a continuing storyline with chapters/episodes (section 9).
- **Categories:** named categories with weights (for example Horror: haunted places 30%, urban legends 30%, psychological 20%, folklore 20%), min/max per day, and "do not repeat the same category consecutively".
- **Constraints:** include/exclude keywords and themes, banned topics, required angle, regional/cultural settings, time period.
- **Dedup window:** how many days/posts back to avoid repeating topics (default 90 days / 200 posts), with near-duplicate detection.

### 7.4 Caption and story length control
- **Unit:** words or characters. **Min, target and max**, plus presets: Short (80–150 words), Standard (120–220), Long (250–500), Story (500–1,200), Epic (1,200–2,500). Fully customizable. Hard upper limit: Facebook's caption limit (about 63,000 characters, verify in current docs); warn the owner above about 2,500 words (reader drop-off).
- **Structure template:** an ordered list of sections the caption must contain (for example Hook, Context, Story, Twist/Ending, Why it matters, Question), each optional, with its own length share; or "free-form story".
- **Hook rule:** the first 1–2 lines must work before Facebook's "See more" truncation (configurable, default on for long captions).
- **Paragraphing:** max sentences per paragraph, line-break style, optional section dividers.
- **Voice settings:** tone, point of view, reading level, humor level, emoji policy (none/minimal/moderate), banned and required phrases.
- **Ending style:** cliffhanger, twist, moral/lesson, open question, or "to be continued" (for series).
- **Engagement question:** on/off and style.
- **Hashtags:** count (default 5; configurable, with "exactly N" enforcement), style (niche/broad mix), placement (end of caption), banned hashtags, fixed hashtags always included.
- **Source line:** on/off, format ("Source: …"), for factual and true_story profiles.
- **Disclaimer/disclosure lines:** for example "Fictional story, any resemblance to real events is coincidental" for fiction, "Image is AI-generated" when relevant; positions and text editable.
- **Long-form generation method:** the system must reach the configured length reliably even with providers that have small output limits: **Outline → section-by-section drafting (each section sees the outline and a running summary) → stitch → polish pass → length and repetition check**; auto-expand or trim if outside min/max.

### 7.5 Image control (ONE IMAGE PER POST)
- **Image prompt template** (editable) with variables such as `{{key_scene}}`, `{{caption_summary}}`, `{{topic}}`, `{{image_style}}`.
- **Key scene extraction:** for stories, the system picks the single most visual, safe moment of the story for the image (configurable: opening scene, climax, atmospheric mood shot, or character portrait).
- **Style controls:** style (photorealistic, cinematic, vintage photo, illustration, dark moody, etc.), lighting/color palette, camera/composition, aspect ratio (default 4:5, 1080×1350), negative prompt, "no text in image", "no real people", "no logos/brands".
- **Series visual consistency:** a visual style bible text (recurring look, palette, character descriptions) appended to every prompt of a series.
- **Headline/title panel (optional):** black or custom-color lower panel with bold text from the title or hook, rendered by the app (not by the image model); font size, color, panel height, margins configurable.
- **Provider preference:** image chain override per profile/Page.
- **QA:** resolution check, blank/uniform check, watermark check, perceptual-hash dedup, optional vision-model check (matches caption, no deformities or garbled text), up to N regeneration attempts.

### 7.6 Research sources (factual / true_story)
- Select or add sources per profile (RSS, APIs, Wikipedia, custom HTTP, search-capable providers), with trust levels and fetch intervals. Defaults for Science & Space: NASA, ESA, Phys.org, ScienceDaily, arXiv (astro-ph), Wikipedia/Wikimedia (verify each source's terms before enabling).
- Fiction profiles skip research and use idea generation plus story memory.

## 8. PAGES

Each Page has:
- Facebook connection (Page ID, encrypted token, token status).
- **Linked Content Profile** and **Page overrides** for any profile field, including **Page custom caption prompt** and **Page custom image prompt** (either appended to, or replacing, the profile's template; owner's choice per field).
- **Posting schedule:** posts per day, post times (local times) or interval, days of week, time jitter (default ±10 min), minimum gap, lead time (how far ahead to prepare), timezone, start/end date, pause window (vacation).
- **PUBLISHING MODE (per Page):**
  - **Fully automatic:** posts are published/scheduled without review.
  - **Review before posting:** every generated post waits in the Review Inbox until the owner approves.
  - **Hybrid:** auto-publish only if the post's QA score is at least the Page's threshold and no sensitive-content flag is raised; otherwise send to review.
  - Optional **auto-approve after N hours** (off by default) for review-mode Pages.
- Notification options (optional): email or Telegram/webhook when posts await review, when a Page token breaks, or when budgets run out.
- Source/disclosure options, hashtag overrides, provider chain overrides, daily post caps.
- **Setup wizard:** connect Facebook → choose profile → set caption/image prompts and lengths → choose schedule and mode → run Test run → review sample output → "Go live". A "Go live" checklist verifies token, providers, a successful test, and the schedule.

## 9. SERIES AND STORY CONTINUITY (OPTIONAL PER PAGE)

- **Series:** name, premise, **story bible** (characters, setting, rules, tone, forbidden elements), episode count or open-ended, cadence.
- **Memory:** after each post, store a short summary and key facts; the next episode receives `{{story_so_far}}` (rolling summary) and `{{series_bible}}`.
- The system plans the next episode, avoids contradictions (QA checks continuity against the bible and summary), and can end arcs and start new ones automatically based on the owner's rules (for example every 10 episodes).
- The owner can view and edit the bible and summaries at any time.

## 10. PIPELINE IN DETAIL

**Post status machine:** `planned → researching/idea → topic_selected → outlining → writing → qa → imaging → composing → ready` → (`pending_review` per mode) → `scheduled_on_fb` → `published`; any stage may go to `failed` (reason + retry schedule) or `skipped`.

### 10.1 Slot planning
- Compute each Page's slots from its schedule (timezone, days, jitter, min gap); keep enough posts prepared to cover the lead time; schedule on Facebook as soon as a post is approved/ready (Facebook scheduling accepts about 10 minutes to 30 days ahead; verify in current docs).
- Throttle generation against provider budgets (section 14.3). If budgets are tight, delay later slots; never fill a slot with unverified, broken or low-quality content. Leave it empty and alert instead.

### 10.2 Research / Idea
- **Factual and true_story:** a collector job refreshes enabled sources and stores `research_items` (title, URL, date, short excerpt max about 2,000 chars, hash; never full articles). Respect robots.txt, polite rate limits, conditional requests, SSRF-safe fetching (https only; block private/localhost/link-local/metadata ranges, including after redirects).
- **Fiction and evergreen:** an idea generator proposes premises or topics from the profile, categories, constraints, owner topic queue, series bible and recent history.

### 10.3 Topic selection
- Candidate pool = owner queue items, research items, generated ideas. One cheap LLM call scores candidates (wow factor/hook strength, fit with profile, freshness/novelty, visual potential for ONE strong image, verifiability for factual types). Code enforces rules: dedup window, category weights and no-repeat rules, daily category mix, owner exclusions.

### 10.4 Write
- **Factual/true_story:** extract a list of facts with source URLs; the writer may use ONLY those facts as factual material. Original wording only (no copying; at most one short attributed quote under 15 words, only if essential). Distinguish confirmed vs hypothetical; no invented numbers, dates, quotes or discoveries. Use cautious wording ("alleged", "according to") for true-crime or disputed topics.
- **Fiction:** write an original story from the premise, following voice, structure, length, ending style and series memory; clearly label as fiction via the disclaimer line.
- **Long form:** outline → sections → stitch → polish (section 7.4). Reuse the same text provider within one post where possible for consistent voice; allow chain failover only at section boundaries with the running summary.
- **Title and headline:** per profile rules (internal title; optional panel headline 8–22 words).
- **Programmatic validators:** length within min/max, hashtag count exactly as configured, banned/required phrases, repetition detector (n-gram repetition and repeated paragraphs), duplicate caption (hash/similarity), emoji policy, no URLs unless allowed.

### 10.5 QA and scoring
- A QA call (different provider than the writer when possible) returns a **score 0–100**, pass/fail and issues:
  - factual/true_story: every claim supported by extracted facts and sources;
  - fiction: coherence, continuity with series bible, ending quality, hook strength, no contradictions;
  - all: matches voice/structure settings, no unsafe content (section 12), no banned elements.
- On fail: rewrite once with the issues listed; on second fail: `skipped` with reason and pick another topic. QA score feeds Hybrid mode.

### 10.6 Image (ONE per post)
- Build the image prompt from the template, key scene and style settings; generate through the image provider chain; run image QA (7.5); compose the optional headline panel; output 1080×1350 (or configured) JPEG quality about 85; upload to Storage. Never remove AI labels/watermarks added by providers. Never present generated images as real photographs; for factual topics where a generated image is an illustration or artist's impression, the disclosure line must say so.

### 10.7 Post
- `fully automatic`: schedule on Facebook immediately (`published=false` + `scheduled_publish_time`).
- `review`: `pending_review` until approved; if the slot passes before approval, move to the next free slot (never publish late silently).
- `hybrid`: apply the rule from section 8.
- Pacing: min gap per Page, backoff on "posting too fast", warn when `posts_per_day` is above about 5.
- Reconcile publish status, store permalink, then delete images per retention (section 16).

## 11. REVIEW INBOX

- A mobile-friendly inbox of posts awaiting review across all Pages (filter by Page/profile/score/flag).
- Each item shows: image, title, full caption (with word count and length status), hashtags, sources (factual types), QA score and issues, flags, providers used, scheduled time.
- Actions: **Approve**, **Approve and schedule at…**, **Edit caption/hashtags/title** inline, **Regenerate** (topic / caption only / image only / everything, optionally with a note like "make it scarier" or "shorter"), **Reject** (with reason; rejected reasons and topics feed the Page's avoid-list), **Skip slot**, bulk approve for passing posts.
- Optional keyboard shortcuts and swipe gestures on mobile.

## 12. CONTENT SAFETY BASELINE (CANNOT BE DISABLED)

The owner can customize everything above, but these protections always apply on top, because they protect the Pages from being restricted and protect real people:
- No sexual content; no sexualization or harm of minors; no graphic gore or extreme violence descriptions; no self-harm or suicide instructions or glorification; no hate or harassment; no instructions for weapons, drugs or crimes.
- No defamation or fabricated claims about real, identifiable people; for true-crime/true_story types: use only public sourced material, cautious wording, no victim identification beyond what reputable sources publish, no speculation presented as fact, no glorification of offenders.
- Fiction must be labeled as fiction (the disclaimer line is on by default and can be edited but not turned off for fiction/horror/crime profiles).
- No copyrighted characters, brands, logos or lyrics/book passages; no real-person likenesses in images.
- **Sensitive-content flagging:** a classifier step marks posts touching sensitive themes (violence, death, real people, minors, medical/legal claims, tragedy). Flagged posts are held for review even on fully automatic Pages, with the owner notified; the owner can edit and approve. Severity thresholds are tunable but the hold behavior is not removable.
- Honest labeling: AI-generated images are not presented as real photographs; an optional per-Page AI-disclosure line is provided, and the README states the owner is responsible for compliance with Meta's policies on automated and AI-generated content.

## 13. DATA MODEL

**content_profiles:** id, name, type (`factual`|`fiction`|`true_story`|`evergreen`), language, audience, master_prompt, templates (JSON of all stage templates), caption_settings (JSON: unit, min, target, max, structure, hook_rule, paragraphing, voice, ending_style, question, emoji_policy, banned/required phrases), hashtag_settings (JSON), disclosure_settings (JSON), image_settings (JSON: template, style, aspect, negative prompt, key-scene mode, panel settings, series style bible), topic_settings (JSON: sources/weights, categories, constraints, dedup window), research_source_ids, custom_variables (JSON), version, created_at.

**profile_versions / template_versions:** id, entity, version, content (JSON), created_at (rollback support).

**pages:** id, name, fb_page_id, fb_page_token (encrypted), token_status, profile_id, overrides (JSON: any profile field, plus custom caption prompt and custom image prompt with `append|replace` flag), schedule (JSON), publishing_mode (`auto`|`review`|`hybrid`), hybrid_min_score, auto_approve_after_hours, notifications (JSON), provider_chain_overrides, daily_cap, active, created_at.

**topic_queue_items:** id, page_id or profile_id, text, category, status (`pending`|`used`|`skipped`), order, created_at.

**series:** id, page_id, name, premise, bible, rolling_summary, episode_count, status, arc_rules.

**series_episodes:** id, series_id, post_id, number, summary, key_facts.

**research_sources, research_items:** as in section 7.6 (type, url/config, interval, trust level; items with excerpt and hash).

**providers, provider_keys, provider_chains, provider_usage_daily:** as in section 14.

**posts:** id, page_id, profile_version, status, scheduled_for, topic_key, topic_title, category, series_episode_id, research_item_ids, facts (JSON), outline (JSON), title, headline, caption, caption_word_count, hashtags, source_line, disclosure_line, qa_score, qa_result (JSON), sensitive_flags (JSON), image_prompt, image_provider_used, text_providers_used (JSON), tokens_used, raw_image_path, composed_image_path, image_phash, content_hash, review_state (`n/a`|`pending`|`approved`|`rejected`), review_note, fb_post_id, fb_permalink, error, stage_attempts (JSON), created_at, published_at.

**topic_history, job_logs, alerts, audit_log, settings.**

## 14. PROVIDER SYSTEM (UNCHANGED CORE, FULLY GENERIC)

### 14.1 Adapters
1. `openai_compatible_chat` (OpenRouter, Groq, NVIDIA NIM, ZenMux, Cerebras, Together, Agent Router, and others; JSON mode where available with robust JSON parsing fallback).
2. `openai_compatible_images` (`/images/generations`, b64 or URL).
3. `gemini_native` (text and image models; optional search grounding for research if available on the key).
4. `cloudflare_workers_ai` (account ID + token; text and image such as FLUX schnell; neuron tracking).
5. `huggingface_inference` (current Inference Providers API; disabled by default because free accounts may have no included credits).
6. `pollinations` (prefer a registered key; reject watermarked output).
7. `custom_http` (template adapter, 14.2).

### 14.2 Custom HTTP provider (no code needed)
- Dashboard form: name, kind (text/image/vision/search), method, https URL, headers with `{{key}}` placeholder, body template (JSON/text/multipart) with variables (`{{prompt}}`, `{{system}}`, `{{messages}}`, `{{model}}`, `{{width}}`, `{{height}}`, `{{seed}}`), response mapping via JSONPath (text path, image URL path, base64 path, or raw binary), error mapping, optional async polling (job URL, status path, success value, interval, max wait).
- Limits: requests/minute, requests/day, units/day, reset time, concurrency, optional cost per unit, max output tokens (used by the long-form chunker).
- **Test button** shows raw response, parsed result, latency and (for images) a preview; a provider can be enabled only after a passing test. Safe sandboxed template substitution (no eval), SSRF protection, response-size limits and timeouts. Export/import provider definitions as JSON without secrets.
- Presets are seeded for the owner's providers (Cloudflare, Gemini, OpenRouter text + free image models, NVIDIA NIM, ZenMux, Pollinations, Hugging Face, Groq, Agent Router) using the same machinery, so the owner only pastes keys.

### 14.3 Keys, chains, failover, budgets
- Multiple keys per provider (rotate on errors); keys encrypted (AES-256-GCM), masked after saving, never logged; bulk add (one per line); test/disable/replace actions. The UI notes that many providers apply limits per account/organization, so extra keys may not add capacity, and the owner must follow provider terms.
- **Chains** (global, per profile, per Page, per stage: idea, topic, outline, write, polish, qa, image, vision-check). Strategies: `priority`, `round_robin`, `least_used_today`, `weighted_by_remaining_budget`.
- **Per-call algorithm:** pick candidates (skip disabled/cooling/over-budget) → token-bucket RPM and concurrency limits → call with timeout → classify: success (validate), invalid output (next candidate), 429/quota (cooldown until Retry-After/reset, failover), 401/403 (disable key, alert, failover), 5xx/timeout (short backoff, failover), content-policy refusal (one conservative rewrite, then failover). If all fail: delay the stage with backoff; never skip validation.
- **Quota tracking:** requests and provider-specific units (tokens, neurons, credits, images), using response headers where available; per-provider/key usage vs limits, success rate, latency; warn at 80%.
- **Daily planner:** estimates demand (posts × expected calls and tokens per profile, including long-form stories) vs remaining budgets; throttles and alerts if demand exceeds supply.
- **Health checks and quality bench:** periodic tiny test calls; a bench tool runs the same prompts through selected providers (text or image), stores outputs, lets the owner rate them, and suggests chain order.

## 15. FACEBOOK INTEGRATION

- Official Graph API with the owner's Facebook App in Development mode; confirm permissions in current docs (typically `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`).
- Connect Pages via Facebook Login; encrypted long-lived Page tokens; token health, alerts, "Reconnect".
- Publish photo posts with the full caption (long captions supported up to Facebook's limit), scheduling via `published=false` + `scheduled_publish_time`; publish now, reschedule, delete (including removing the scheduled post on Facebook).
- Explicit handling for token/permission errors, rate limits, "posting too fast", image rejected, API down: retry with backoff; never lose a ready post. Dedup by `content_hash` and `fb_post_id`.

## 16. STORAGE AND RETENTION

- Delete image files 24 hours after a post is published; delete images of failed/rejected/skipped posts after 3 days; keep text and metadata; prune `research_items` older than 30 days and logs older than 90 days (configurable).
- Storage meter with warnings at 70% and safe mode (pause generation) at 90%. The worker's constant activity keeps free Supabase projects from pausing.

## 17. DASHBOARD

1. **Overview:** worker heartbeat; per-Page counts today (planned/ready/pending review/scheduled/published/failed); next scheduled posts; alerts; provider budget meters; demand vs capacity; estimated monthly cost.
2. **Pages:** add/edit, wizard, Connect Facebook, linked profile, overrides, custom caption and image prompts, schedule, publishing mode (Auto / Review / Hybrid), notifications, pause, "Generate now" and "Generate N posts", Effective-settings viewer.
3. **Content Profiles:** create/clone/edit all fields in sections 7.1–7.6; import a master prompt file; **Prompt Studio** with variables, preview, Test run, version history.
4. **Topics:** category weights, owner topic queue (paste/CSV), exclusions, topic history.
5. **Series:** story bibles, rolling summaries, episode list, edit tools.
6. **Research:** sources, last fetch status, recent items, "Run research now".
7. **Review Inbox:** section 11.
8. **Queue and Calendar:** per Page and all Pages; edit, reschedule, regenerate, delete, publish now.
9. **Pipeline view:** each post's stage timeline with stored artifacts (research items, facts, outline, drafts, QA results, prompts, providers, tokens).
10. **Providers:** list, add custom, test, keys, limits, chain editor (drag-and-drop per stage/Page), usage/health, quality bench, import/export.
11. **History, Logs and Alerts.**
12. **Settings:** global defaults, timezone, kill switch (pause everything), retention, notifications, export/import of profiles and settings.

UI: responsive, dark/light, mobile-friendly.

## 18. RELIABILITY

- Worker heartbeat every minute; alert if stale more than 10 minutes; graceful shutdown; health endpoint; Dockerfile/`railway.json`.
- Stage-level retries with exponential backoff (max 5 per stage); failed posts show reasons and can be retried; idempotent, resumable jobs; posts already scheduled on Facebook are unaffected if the worker is down.
- Global and per-Page pause; auto-pause a Page when its Facebook token is invalid.
- GitHub Actions `worker-cron.yml` running `worker:once` as a documented fallback (delays and free-minute limits noted).

## 19. SECURITY

- Single-owner auth; RLS on all tables; public endpoints only for the Facebook OAuth callback and a secret-protected worker trigger.
- Secrets in environment variables; provider keys and Facebook tokens encrypted at rest and never sent to the browser or logged.
- SSRF protection for custom providers and research fetching; CSRF protection; login rate limiting; zod validation; upload/response size limits; audit log of key changes, provider changes, profile edits and manual posting actions.

## 20. ENVIRONMENT VARIABLES

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_KEY=              # 32-byte base64
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=
WORKER_SECRET=
OWNER_EMAIL=
APP_URL=
WORKER_LOOP_SECONDS=60
```
AI provider keys are added in the dashboard (encrypted in the database), not in env vars.

## 21. REPOSITORY STRUCTURE

```
/apps/web            Next.js dashboard + API routes
/worker              Pipeline stages, provider router, schedulers
/packages/core       Types, zod schemas, adapters, template engine, settings resolver, prompt engine
/prompts             Seed master prompts (4 existing + Appendix A starters)
/supabase            Migrations + RLS
/docs                PRD_4_v2, PLAN.md, README, setup guides
/.github/workflows   CI + optional worker cron
DECISIONS.md, README.md, .env.example
```

## 22. MILESTONES

1. Scaffold; Supabase schema + RLS; owner auth; encrypted secrets; worker skeleton with heartbeat.
2. Provider framework: adapters, `custom_http` + test button + SSRF protection, key pool, presets, Providers screen.
3. Provider router: chains, strategies, limits, cooldowns, failover, usage tracking, health, quality bench; tests for 429/auth/timeouts/invalid output.
4. Settings resolver (Global → Profile → Page → Post) + Effective-settings viewer + Prompt engine (templates, variables, safety baseline, versioning).
5. Content Profiles and Prompt Studio: all fields in section 7, import of master prompt files, seed profiles (4 existing + Appendix A), Test run without posting.
6. Research and Idea: sources, collector, SSRF-safe fetching, owner topic queue, idea generator, topic selection with category weights and dedup.
7. Write pipeline: fact extraction, outline/section/stitch/polish long-form, length control, validators, QA scoring, sensitive-content flagging, series memory.
8. Image pipeline: key-scene extraction, prompt templates, provider chain, image QA, `sharp` composition with optional panel.
9. Facebook: connect, multiple Pages, scheduling/publishing, reconcile, retention; test on a TEST Page.
10. Orchestration: slot planning, lead time, daily budget planner and throttling, publishing modes (auto/review/hybrid), Review Inbox, notifications, retries, kill switch.
11. Dashboard completion: Overview, Pages wizard, Topics, Series, Queue/Calendar, Pipeline view, History, Logs/Alerts, Settings.
12. Deployment and hardening: Vercel + Railway + Supabase configs, GitHub Actions fallback, README with step-by-step setup (including creating the Facebook App), security review, end-to-end test: 1 Page for 48 hours in Review mode, then Auto.

## 23. ACCEPTANCE CRITERIA

- The owner can create a new profile (for example "Horror Story"), paste a master prompt, set caption length 600–900 words, set hashtag count, image style and categories, run a Test run, and get a story with ONE image whose length is within range.
- A Page can override the profile's caption prompt and image prompt; the Effective-settings viewer shows which values come from where.
- Per-Page modes work: Fully automatic publishes without review; Review holds every post in the inbox; Hybrid auto-publishes only above the score threshold and never when a sensitive flag is raised.
- Sensitive-flagged posts are held even on fully automatic Pages and the owner is notified.
- Long stories reliably meet the configured length through the outline/section pipeline, even on providers with small output limits.
- Fiction posts carry the fiction disclaimer; factual and true_story posts store source URLs and pass claim verification; posts failing QA twice are skipped, not published.
- Adding a new custom provider (OpenAI-compatible or template-based) and key takes minutes and works in any chain without redeploying; 429/auth failures fail over within the same call with no lost posts.
- After one-time setup, a Page posts every day on its schedule for 7 consecutive days without manual action, keeping the configured lead time.
- The daily planner warns and throttles when demand exceeds provider budgets.
- Images are deleted after publishing per retention; storage stays under 70%.
- No secrets in the repo; keys/tokens encrypted; no Meta/Facebook passwords handled anywhere.

## 24. KNOWN CONSTRAINTS (WRITE INTO README)

- Free tiers are limited and change without notice; quotas are often per account/organization, so extra keys from one account may not add capacity.
- Long-form stories (500+ words) use far more tokens than short posts; capacity must be planned per Page.
- Vercel Hobby is non-commercial and its cron runs at most once a day; frequent work runs in the Railway worker. Railway has no permanent free always-on tier (Hobby about $5/month with $5 usage included).
- Facebook app stays in Development mode for the owner's own Pages. Meta may restrict repetitive or automated-looking posting, and it enforces rules on graphic or sensitive content and on AI-generated content; start with 1 Page, grow gradually, keep to about 5 posts per Page per day, and keep content original.
- Check each provider's terms for commercial use of generated text and images.

## 25. HOW TO RUN THIS PRD

**Kick-off message for your AI coding tool:**
```
Read /docs/PRD_4_v2_autonomous_content_system.md fully, plus all files in
/prompts. Do NOT write code yet. Check the current official docs for the
Facebook Graph API (Page photo scheduling, long captions, permissions, tokens),
Cloudflare Workers AI, Google Gemini, OpenRouter, NVIDIA NIM, ZenMux,
Pollinations, Hugging Face Inference Providers, Supabase and Railway, and write
a short plan to /docs/PLAN.md: architecture, folder structure, risks, and
anything in the PRD that conflicts with current docs. Wait for my "go".
```
**For each milestone N from 1 to 12:**
```
Do milestone N from section 22 of /docs/PRD_4_v2_autonomous_content_system.md
and nothing else. Write tests, run them, commit, and tell me (1) what you
built, (2) exactly how I can verify it manually, (3) any decisions you made
(also in DECISIONS.md). Then stop.
```

---

## APPENDIX A: STARTER PROFILES TO SEED (editable by the owner)

Seed these as profile templates (the owner can edit everything). The four existing master prompt files in `/prompts` (Science & Space, Historical Photos, Real-Life Photography, Vintage Cars) are imported as `factual` profiles with their original categories, caption length ranges, headline panel and fact-checking rules, with their interactive-only rules removed.

### A1. HORROR STORY (type: fiction)
- **Defaults:** caption 500–900 words, ending style cliffhanger or chilling twist, hashtag count 5, disclaimer "Fictional story." on.
- **Master prompt starter:**
  > You are a master horror storyteller writing original short stories for a Facebook audience in {{language}}. Write in {{pov}} with a {{tone}} tone. Build dread slowly with specific sensory details, a strong hook in the first two lines, escalating tension, and an unsettling ending. Keep stories original, self-contained and suitable for a general social-media audience: suggest rather than show gore, no sexual content, no violence against children, no real people, no real brands. Categories: haunted places, urban legends, psychological horror, folklore and creatures, night-shift and isolation stories. Avoid clichés listed in {{avoid_list}} and do not repeat premises from {{recent_titles}}. Target {{word_target}} words ({{word_min}}–{{word_max}}). End with the configured ending style.
- **Image starter:** "Dark, moody, cinematic photograph of {{key_scene}}, atmospheric lighting, fog and deep shadows, realistic textures, no text, no people's faces in close-up, no gore." Negative: gore, blood splatter, text, watermark, deformed anatomy.

### A2. CRIME STORY (types: fiction by default; true_story variant optional)
- **Fiction defaults:** 500–1,000 words, ending style twist or reveal, disclaimer "Fictional story."
- **Master prompt starter (fiction):**
  > You are a crime fiction writer producing original mystery and detective short stories for a Facebook audience in {{language}}. Open with an intriguing hook, plant clues fairly, build suspense through investigation and misdirection, and finish with a satisfying reveal. Keep violence non-graphic and off-screen, no sexual content, no real people, places of real crimes or real victims, no instructions for committing crimes. Categories: whodunit mysteries, heists, cold cases (fictional), courtroom twists, detective duos. Do not repeat premises from {{recent_titles}}. Target {{word_target}} words.
- **True-story variant (type `true_story`, owner enables explicitly):** only publicly reported, well-sourced cases from reputable sources; neutral wording ("according to…", "was charged with…", "alleged"); no speculation as fact; do not name or describe victims beyond what reputable sources have published; no graphic details; always include a Source line; posts are always routed to review, regardless of Page mode.
- **Image starter:** "Cinematic, noir-style photograph of {{key_scene}}, moody lighting, rain-slick streets or dim interior, realistic, no text, no real people's likeness, no blood." Negative: gore, weapons pointed at camera, text, watermark.

### A3. SCIENCE STORY (type: true_story or factual narrative)
- **Defaults:** 400–800 words, ending style "why it matters" or open question, source line on, hashtag count 5.
- **Master prompt starter:**
  > You are a science storyteller turning real discoveries, experiments and scientists into engaging narratives for a general audience in {{language}}. Use ONLY the verified facts in {{facts}} for factual claims; add vivid but non-factual scene-setting sparingly and never invent quotes, dates or numbers. Begin with a hook, tell the story in clear steps (the question, the attempt, the surprise, the result, why it matters), distinguish confirmed results from hypotheses, and end with a thought-provoking question. Credit sources in the Source line. Categories: space discoveries, breakthrough experiments, scientists' lives, nature's strangest facts, technology and medicine breakthroughs. Target {{word_target}} words.
- **Image starter:** "Photorealistic, high-detail image of {{key_scene}}, scientifically plausible, natural lighting, no text, no real people's likeness; if depicting something never photographed, style as an artist's illustration." 
