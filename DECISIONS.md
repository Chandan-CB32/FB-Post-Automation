# Architecture & Technical Decisions Log

This document records key architectural, algorithmic, and integration decisions made during development.

---

### DEC-001: Monorepo Structure (`apps/web`, `worker`, `packages/core`)
- **Context:** The system consists of a Next.js web dashboard and a 24x7 background worker process running on Railway, sharing types, database models, prompt engines, and adapters.
- **Decision:** Use an npm/pnpm monorepo structure with `apps/web` (Next.js), `worker` (Node.js background process), and `packages/core` (shared types, crypto, schemas, adapters, template engine).
- **Rationale:** Keeps dependencies clear, prevents code duplication, and allows the worker to be deployed independently to Railway without web framework bloat.

### DEC-002: Atomic Job Claiming via Postgres Stored Procedure (`SKIP LOCKED`)
- **Context:** The worker pipeline requires durable, concurrent-safe job claiming so that multiple workers or loops never process the same post or slot simultaneously.
- **Decision:** Implement atomic queue claiming via a PostgreSQL function (`claim_next_post_job`) using `FOR UPDATE SKIP LOCKED`, called through Supabase RPC.
- **Rationale:** Supabase client (`@supabase/supabase-js`) does not expose `FOR UPDATE SKIP LOCKED` through standard PostgREST table queries; an RPC function provides native, transaction-safe queue mechanics.

### DEC-003: Facebook Graph API Two-Step Photo Scheduling
- **Context:** Facebook Graph API scheduling on photo posts can be unpredictable across API versions when calling `POST /{page-id}/photos` directly with `scheduled_publish_time`.
- **Decision:** Implement Facebook photo post publishing using the established two-step method:
  1. Upload the composed JPEG unpublished to `/{page-id}/photos` with `published=false` (and `temporary=true` where supported), retrieving `id`.
  2. Create the scheduled feed post on `/{page-id}/feed` with `message={caption}`, `published=false`, `scheduled_publish_time={timestamp}`, and `attached_media=[{"media_fbid": id}]`.
- **Rationale:** Guarantees proper photo album/feed attachment, consistent scheduling behavior, and full caption length support up to 63,206 characters.

### DEC-004: Hugging Face Serverless Inference Routing
- **Context:** Hugging Face transitioned serverless inference from legacy endpoints to their unified Inference Providers proxy.
- **Decision:** Configure Hugging Face adapter to point to `https://router.huggingface.co/v1` using standard OpenAI-compatible chat semantics with Bearer token auth.
- **Rationale:** Allows dynamic routing (`:cheapest`, provider pinning) and reuses robust OpenAI chat parsing logic.

### DEC-005: SSRF Protection for Custom HTTP and Research Collector
- **Context:** Users can configure custom HTTP providers and RSS/API research sources, opening potential Server-Side Request Forgery risks.
- **Decision:** Implement strict IP and protocol validation enforcing `https://` only and resolving hostnames prior to connection to reject IPv4/IPv6 loopback (`127.0.0.1`, `::1`), private networks (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local, and cloud metadata services (`169.254.169.254`).
- **Rationale:** Essential security boundary protecting local network, container metadata, and database credentials.

### DEC-006: Long-Form Generation Chunking Strategy
- **Context:** Epic and Story captions (500–2,500 words) exceed single-prompt generation reliability on many free and low-cost provider tiers.
- **Decision:** Use a 4-stage pipeline for long-form:
  1. Outline generation with section word budgets.
  2. Sequential section generation, each given the outline, the previous section text, and a rolling summary.
  3. Stitch pass with seamless transition checks.
  4. Polish pass checking tone, repetition, and exact length constraints.
- **Rationale:** Overcomes provider output token limits, eliminates abrupt endings, and ensures consistent narrative depth.

