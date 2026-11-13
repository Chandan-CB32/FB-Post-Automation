import { getSupabaseClient } from '../db/client.js';
import { decryptPageToken } from '../facebook/tokens.js';
import { FacebookPublisher, PhotoInput, computePostContentHash } from '../facebook/publisher.js';
import { ContentProfile } from '../validation/schemas.js';
import { reconcileScheduledPosts, ReconciliationSummary } from './reconciler.js';
import { calculateNextSlots, PageScheduleConfig } from './slot-planner.js';
import { runGenerationPipeline } from '../pipeline/generation-pipeline.js';
import { rasterizeHeadlineCardToJpeg } from '../pipeline/headline-renderer.js';
import { decrypt } from '../crypto/encryption.js';
import { runDailyContentResearch } from '../topics/daily-research.js';
import { generateTopicKey } from '../topics/dedup.js';

export interface AutonomousCycleOptions {
  now?: Date;
  forceSlotGeneration?: boolean; // if true, will generate for the next upcoming slot even if > 45m away
  targetPageId?: string;
  leadWindowMinutes?: number; // default 45 minutes (covers T-30m with cron jitter)
}

export interface GeneratedPostSummary {
  postId: string;
  pageId: string;
  pageName: string;
  title: string;
  status: string;
  scheduledFor: string;
  fbPostId?: string | null;
  fbPermalink?: string | null;
  qaScore?: number;
}

export interface AutonomousCycleResult {
  executed: boolean;
  message: string;
  reconciled: ReconciliationSummary | null;
  duePublishedCount: number;
  generatedPosts: GeneratedPostSummary[];
  errors: string[];
}

/**
 * Executes a full autonomous posting cycle:
 * 1. Reconciles posts previously scheduled on Facebook (marks published with permalinks).
 * 2. Publishes any due posts stored as scheduled in DB.
 * 3. Identifies upcoming slots for live pages (~30 minutes prior to slot time).
 * 4. Generates content via the unified 7-stage pipeline and schedules on Facebook.
 */
export async function runAutonomousCycle(
  options: AutonomousCycleOptions = {}
): Promise<AutonomousCycleResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      executed: false,
      message: 'Supabase client unavailable',
      reconciled: null,
      duePublishedCount: 0,
      generatedPosts: [],
      errors: ['Supabase client unavailable'],
    };
  }

  const now = options.now || new Date();
  const leadWindowMinutes = options.leadWindowMinutes ?? 45;
  const errors: string[] = [];
  const generatedPosts: GeneratedPostSummary[] = [];
  let duePublishedCount = 0;

  console.log(`[Autonomous Worker] Starting cycle at ${now.toISOString()} (Lead window: ${leadWindowMinutes}m)...`);

  // =========================================================================
  // STEP 1: Reconcile Facebook Scheduled Posts
  // =========================================================================
  let reconciliationSummary: ReconciliationSummary | null = null;
  try {
    reconciliationSummary = await reconcileScheduledPosts(supabase, { nowMs: now.getTime() });
    if (reconciliationSummary.publishedCount > 0) {
      console.log(`[Autonomous Worker] Reconciled ${reconciliationSummary.publishedCount} post(s) as published on Facebook.`);
    }
  } catch (recErr: any) {
    const msg = `Reconciliation error: ${recErr?.message || String(recErr)}`;
    console.warn(`[Autonomous Worker] ${msg}`);
    errors.push(msg);
  }

  // =========================================================================
  // STEP 2: Publish Due Posts stored with status 'scheduled' in Supabase
  // =========================================================================
  try {
    const { data: duePosts, error: dueErr } = await supabase
      .from('posts')
      .select('id, page_id, title, caption, scheduled_for, pages(fb_page_id, fb_page_token, token_status)')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now.toISOString())
      .limit(20);

    if (!dueErr && duePosts && duePosts.length > 0) {
      const publisher = new FacebookPublisher();
      for (const dp of duePosts) {
        const pageData = (dp as any).pages;
        if (!pageData?.fb_page_token || pageData.token_status === 'revoked') {
          continue;
        }

        try {
          const rawToken = decryptPageToken(pageData.fb_page_token);
          const pubRes = await publisher.publishFeedPost(
            pageData.fb_page_id,
            rawToken,
            {
              message: dp.caption,
              published: true,
            }
          );

          await supabase
            .from('posts')
            .update({
              status: 'published',
              fb_post_id: pubRes.postId,
              fb_permalink: pubRes.permalinkUrl,
              published_at: new Date().toISOString(),
            })
            .eq('id', dp.id);

          duePublishedCount++;
          console.log(`[Autonomous Worker] Published due post '${dp.title}' to Facebook page ${pageData.fb_page_id}.`);
        } catch (postErr: any) {
          console.warn(`[Autonomous Worker] Failed publishing due post ${dp.id}:`, postErr?.message);
          errors.push(`Due post ${dp.id} publish error: ${postErr?.message}`);
        }
      }
    }
  } catch (dueCheckErr: any) {
    console.warn('[Autonomous Worker] Due posts check error:', dueCheckErr?.message);
  }

  // =========================================================================
  // STEP 3: Scan Live Pages and Pre-Generate Posts (~30m before slot)
  // =========================================================================
  try {
    let pagesQuery = supabase.from('pages').select('*');
    if (options.targetPageId) {
      pagesQuery = pagesQuery.eq('id', options.targetPageId);
    }

    const { data: allPages, error: pagesErr } = await pagesQuery;
    if (pagesErr) {
      throw new Error(`Failed to query pages: ${pagesErr.message}`);
    }

    // Filter active and live pages: strictly require active === true AND schedule.is_live !== false
    const livePages = (allPages || []).filter((p) => {
      if (p.active !== true) return false;
      if (p.schedule && (p.schedule.is_live === false || p.schedule.active === false)) return false;
      const isTokenOk = p.fb_page_token && p.token_status !== 'revoked' && p.token_status !== 'inaccessible';
      return isTokenOk;
    });

    console.log(`[Autonomous Worker] Found ${livePages.length} active live page(s) to evaluate.`);

    for (const page of livePages) {
      try {
        const sched = page.schedule || {};
        const postsPerDay = sched.postsPerDay || page.daily_cap || 5;
        const postingTimes = sched.postingTimes || sched.times || ['08:00', '10:00', '12:00', '15:00', '17:00'];
        const timezone = sched.timezone || 'America/New_York';
        const minGapMinutes = sched.minGapMinutes || 60;
        const activeDays = sched.daysOfWeek || [1, 2, 3, 4, 5, 6, 7];

        const scheduleConfig: PageScheduleConfig = {
          active: true,
          is_live: true,
          postsPerDay,
          postingTimes,
          timezone,
          daysOfWeek: activeDays,
          minGapMinutes,
          mode: sched.mode || 'fixed',
        };

        // Load active providers with decrypted keys for multi-provider failover
        let activeProvidersWithKeys: any[] = [];
        try {
          let pQuery: any = supabase.from('providers').select('*');
          if (typeof pQuery.order === 'function') {
            pQuery = pQuery.order('priority', { ascending: true });
          }
          const { data: dbProviders } = await pQuery;
          let kQuery: any = supabase.from('provider_keys').select('*');
          if (typeof kQuery.eq === 'function') {
            kQuery = kQuery.eq('status', 'active');
          }
          const { data: dbKeys } = await kQuery;

          activeProvidersWithKeys = (dbProviders || [])
            .filter((p: any) => p.active !== false)
            .map((p: any) => {
              const matchingKey = (dbKeys || []).find((k: any) => k.provider_id === p.id);
              let decryptedKey: string | undefined;
              if (matchingKey && matchingKey.key_encrypted) {
                try {
                  decryptedKey = decrypt(matchingKey.key_encrypted);
                } catch (_) {}
              }
              return {
                id: p.id,
                name: p.name,
                kind: p.kind || p.adapter_kind,
                model_name: p.model_name,
                priority: p.priority || 1,
                base_url: p.base_url,
                config: p.config,
                apiKey: decryptedKey,
                keyMasked: matchingKey?.key_masked,
              };
            });
        } catch (pLoadErr) {
          console.warn('[Autonomous Worker] Could not load provider keys:', pLoadErr);
        }

        // Run Daily Content Research once per day or when topic queue is below target count
        try {
          await runDailyContentResearch({
            page,
            supabase,
            activeProviders: activeProvidersWithKeys,
            force: false,
          });
        } catch (resErr: any) {
          console.warn(`[Autonomous Worker] Daily research warning for '${page.name}':`, resErr?.message || resErr);
        }

        // Calculate upcoming slots from now
        const upcomingSlots = calculateNextSlots(scheduleConfig, now, 10);
        if (upcomingSlots.length === 0) {
          continue;
        }

        // Determine if any slot falls within the pre-generation window (~30m before slot time)
        // Window: slot is within [now - 15m, now + leadWindowMinutes]
        for (let i = 0; i < upcomingSlots.length; i++) {
          const slot = upcomingSlots[i];
          const diffMs = slot.getTime() - now.getTime();
          const diffMinutes = diffMs / 60000;

          // Eligible if within the window, OR if forceSlotGeneration is requested on the earliest upcoming slot
          const isNextSlot = i === 0;
          const isInPreGenWindow = diffMinutes <= leadWindowMinutes && diffMinutes >= -15;
          const isEligible = isInPreGenWindow || (options.forceSlotGeneration && isNextSlot);

          if (!isEligible) {
            continue;
          }

          // Check if post already exists for this slot (within 25 minute tolerance)
          const windowStart = new Date(slot.getTime() - 25 * 60000).toISOString();
          const windowEnd = new Date(slot.getTime() + 25 * 60000).toISOString();

          const { data: existingPosts } = await supabase
            .from('posts')
            .select('id, status, scheduled_for')
            .eq('page_id', page.id)
            .gte('scheduled_for', windowStart)
            .lte('scheduled_for', windowEnd)
            .not('status', 'in', '("failed","skipped")')
            .limit(1);

          if (existingPosts && existingPosts.length > 0) {
            console.log(`[Autonomous Worker] Slot at ${slot.toISOString()} for '${page.name}' already fulfilled by post ${existingPosts[0].id}.`);
            continue;
          }

          console.log(
            `[Autonomous Worker] Generating post for '${page.name}' for slot ${slot.toISOString()} (T${diffMinutes >= 0 ? '-' : '+'}${Math.abs(Math.round(diffMinutes))}m)...`
          );

          // Pop next pending researched topic from queue
          let chosenQueueItem: any = null;
          let queueItemId: string | null = null;
          try {
            const { data: qRows } = await supabase
              .from('topic_queue_items')
              .select('*')
              .eq('page_id', page.id)
              .eq('status', 'pending')
              .order('sort_order', { ascending: true })
              .limit(1);

            if (qRows && qRows.length > 0) {
              queueItemId = qRows[0].id;
              try {
                chosenQueueItem = JSON.parse(qRows[0].text);
              } catch (_) {
                chosenQueueItem = {
                  title: qRows[0].text,
                  category: qRows[0].category,
                };
              }
            }
          } catch (qErr: any) {
            console.warn('[Autonomous Worker] Could not fetch next pending topic queue item:', qErr?.message || qErr);
          }

          // Resolve content profile
          let profile: ContentProfile | null = null;
          if (page.profile_id) {
            const { data: pRow } = await supabase
              .from('content_profiles')
              .select('*')
              .eq('id', page.profile_id)
              .maybeSingle();
            if (pRow) profile = pRow;
          }

          if (!profile) {
            const { data: pRows } = await supabase
              .from('content_profiles')
              .select('*')
              .ilike('name', '%science%')
              .limit(1);
            if (pRows && pRows.length > 0) {
              profile = pRows[0];
            }
          }

          // Prepare effective page with overrides
          const pageWithOverrides = {
            ...page,
            ...(page.overrides || {}),
            custom_niche: page.overrides?.custom_niche || null,
            custom_caption_prompt: page.overrides?.custom_caption_prompt || null,
            publishing_mode: page.publishing_mode || 'auto',
          };

          // Run unified 7-stage generation pipeline with multi-provider failover
          const pipelineResult = await runGenerationPipeline({
            page: pageWithOverrides,
            profile: profile || undefined,
            activeProviders: activeProvidersWithKeys,
            userTopic: chosenQueueItem?.title,
            queueItem: chosenQueueItem,
            isTestRun: false,
          });

          if (!pipelineResult.success) {
            const failMsg = `Pipeline generation failed for '${page.name}': ${pipelineResult.error || 'Unknown error'}`;
            console.warn(`[Autonomous Worker] ${failMsg}`);
            errors.push(failMsg);
            continue;
          }

          // Stage 7: Publishing & Scheduling
          let postStatus: 'scheduled_on_fb' | 'published' | 'pending_review' = 'scheduled_on_fb';
          let fbPostId: string | null = null;
          let fbPermalink: string | null = null;
          const contentHash = computePostContentHash(pipelineResult.caption);

          const publishingMode = page.publishing_mode || 'auto';
          const requiresReview =
            publishingMode === 'review' ||
            pipelineResult.requires_human_review ||
            (publishingMode === 'hybrid' && (pipelineResult.qaScore ?? 0) < (page.hybrid_min_score || 80));

          if (requiresReview) {
            postStatus = 'pending_review';
          } else {
            // Attempt Facebook Publishing / Scheduling
            try {
              const publisher = new FacebookPublisher();
              let rawToken = page.fb_page_token;
              if (rawToken && rawToken.includes(':') && rawToken.split(':').length === 3) {
                rawToken = decryptPageToken(rawToken);
              }

              // 1. Primary photo: 1080x1350 composed card with top photo & lower headline panel
              let photoBuffer: Buffer | undefined = (pipelineResult as any).compositeJpegBuffer;

              if (!photoBuffer && (pipelineResult as any).svgXml) {
                try {
                  photoBuffer = await rasterizeHeadlineCardToJpeg((pipelineResult as any).svgXml);
                } catch (rErr) {
                  console.warn('[Autonomous Worker] Rasterizing SVG card to JPEG buffer failed:', rErr);
                }
              }

              // 2. Fallback photo: raw AI image (buffer or URL)
              let fallbackBuffer: Buffer | undefined;
              let fallbackUrl: string | undefined;

              if (pipelineResult.thumbnailUrl) {
                if (pipelineResult.thumbnailUrl.startsWith('data:image/')) {
                  try {
                    const parts = pipelineResult.thumbnailUrl.split(',');
                    const isB64 = parts[0].includes(';base64');
                    fallbackBuffer = isB64
                      ? Buffer.from(parts[1], 'base64')
                      : Buffer.from(decodeURIComponent(parts[1]), 'utf-8');
                  } catch (_) {}
                } else if (
                  pipelineResult.thumbnailUrl.startsWith('http://') ||
                  pipelineResult.thumbnailUrl.startsWith('https://')
                ) {
                  fallbackUrl = pipelineResult.thumbnailUrl;
                }
              }

              const photoInput: PhotoInput | undefined = photoBuffer
                ? {
                    buffer: photoBuffer,
                    filename: 'composed_card.jpg',
                    fallbackBuffer,
                    fallbackUrl,
                  }
                : fallbackBuffer
                ? {
                    buffer: fallbackBuffer,
                    filename: 'post_photo.jpg',
                    fallbackUrl,
                  }
                : fallbackUrl
                ? {
                    url: fallbackUrl,
                  }
                : undefined;

              // RULE D.6: If image is missing, NEVER publish text-only to Facebook! Route to Review Inbox.
              if (!photoInput) {
                console.warn('[Autonomous Worker] Image missing: Refusing to publish text-only post to Facebook. Routing to Review Inbox.');
                postStatus = 'pending_review';
                errors.push('failed: no image - Refusing to publish text-only post to Facebook.');
              } else {
                const pubRes = await publisher.publishFeedPost(
                  page.fb_page_id,
                  rawToken,
                  {
                    message: pipelineResult.caption,
                    photo: photoInput,
                    scheduledPublishTime: slot,
                  }
                );

                fbPostId = pubRes.postId;
                fbPermalink = pubRes.permalinkUrl || null;
                postStatus = pubRes.isScheduled ? 'scheduled_on_fb' : 'published';
              }
            } catch (fbPubErr: any) {
              console.error(`[Autonomous Worker] Facebook schedule/publish error:`, fbPubErr?.message || fbPubErr);
              postStatus = 'pending_review';
              errors.push(`Facebook publish failed: ${fbPubErr?.message || fbPubErr}`);
            }
          }

          // Insert into posts table in Supabase
          const postPayload = {
            page_id: page.id,
            fb_account_id: page.fb_account_id || null,
            title: pipelineResult.topic?.title || 'Daily Discovery',
            headline: (pipelineResult as any).headlinePanel?.headlineText || pipelineResult.topic?.title || '',
            headline_segments: (pipelineResult as any).headlineSegments || [],
            caption: pipelineResult.caption,
            caption_word_count: pipelineResult.caption.trim().split(/\s+/).length,
            status: postStatus,
            scheduled_for: slot.toISOString(),
            topic_key: pipelineResult.topic?.category || 'General',
            topic_title: pipelineResult.topic?.title || '',
            category: pipelineResult.topic?.category || '',
            qa_score: pipelineResult.qaScore,
            qa_result: pipelineResult.stages.find((st: any) => st.stage === 'qa_safety') || {},
            image_prompt: pipelineResult.imagePrompt || null,
            composed_image_path: pipelineResult.compositeImageUrl || pipelineResult.thumbnailUrl || null,
            raw_image_path: pipelineResult.thumbnailUrl || null,
            content_hash: contentHash,
            fb_post_id: fbPostId,
            fb_permalink: fbPermalink,
            published_at: postStatus === 'published' ? new Date().toISOString() : null,
            review_state: postStatus === 'pending_review' ? 'pending' : 'n/a',
            created_at: new Date().toISOString(),
          };

          let { data: insertedPost, error: insertErr } = await supabase
            .from('posts')
            .insert(postPayload)
            .select()
            .single();

          if (insertErr && (insertErr.message?.includes('headline_segments') || insertErr.message?.includes('schema cache'))) {
            const fallbackPayload = { ...postPayload };
            delete (fallbackPayload as any).headline_segments;
            const retryRes = await supabase
              .from('posts')
              .insert(fallbackPayload)
              .select()
              .single();
            insertedPost = retryRes.data;
            insertErr = retryRes.error;
          }

          if (insertErr) {
            console.error(`[Autonomous Worker] Failed to save post to Supabase: ${insertErr.message}`);
            errors.push(`Database error: ${insertErr.message}`);
          } else {
            console.log(
              `[Autonomous Worker] Successfully created & scheduled post '${insertedPost.title}' (${postStatus}) for ${slot.toISOString()}!`
            );

            // Mark queue item as used
            if (queueItemId) {
              try {
                await supabase
                  .from('topic_queue_items')
                  .update({ status: 'used', used_at: new Date().toISOString() })
                  .eq('id', queueItemId);
              } catch (qUpdErr: any) {
                console.warn('[Autonomous Worker] Could not mark queue item as used:', qUpdErr?.message || qUpdErr);
              }
            }

            // Record in topic history
            try {
              const topicTitle = pipelineResult.topic?.title || insertedPost.title;
              await supabase.from('topic_history').insert({
                page_id: page.id,
                topic_key: generateTopicKey(topicTitle),
                title: topicTitle,
                category: pipelineResult.topic?.category || '',
                post_id: insertedPost.id,
                created_at: new Date().toISOString(),
              });
            } catch (_) {}

            // Record in audit log
            try {
              await supabase.from('audit_log').insert({
                page_id: page.id,
                action: 'autonomous_post_scheduled',
                status: 'success',
                details: {
                  postId: insertedPost.id,
                  slot: slot.toISOString(),
                  status: postStatus,
                  fbPostId,
                  qaScore: pipelineResult.qaScore,
                },
                created_at: new Date().toISOString(),
              });
            } catch (_) {}

            // Record provider daily quota usage dynamically based on providers actually used
            try {
              const todayStr = new Date().toISOString().slice(0, 10);
              const textProvId = (pipelineResult as any).usedTextProviderId || '11111111-1111-1111-1111-111111111101';
              const imgProvId = (pipelineResult as any).usedImageProviderId || '11111111-1111-1111-1111-111111111105';

              // Text generation provider
              const { data: textData } = await supabase
                .from('provider_usage_daily')
                .select('id, requests_count, tokens_count')
                .eq('provider_id', textProvId)
                .eq('date', todayStr)
                .maybeSingle();

              if (textData?.id) {
                await supabase
                  .from('provider_usage_daily')
                  .update({
                    requests_count: (textData.requests_count || 0) + 1,
                    tokens_count: (textData.tokens_count || 0) + (pipelineResult.tokensUsed || 1200),
                  })
                  .eq('id', textData.id);
              } else {
                await supabase.from('provider_usage_daily').insert({
                  provider_id: textProvId,
                  date: todayStr,
                  requests_count: 1,
                  tokens_count: pipelineResult.tokensUsed || 1200,
                });
              }

              // Image generation provider
              const { data: imgData } = await supabase
                .from('provider_usage_daily')
                .select('id, requests_count')
                .eq('provider_id', imgProvId)
                .eq('date', todayStr)
                .maybeSingle();

              if (imgData?.id) {
                await supabase
                  .from('provider_usage_daily')
                  .update({
                    requests_count: (imgData.requests_count || 0) + 1,
                  })
                  .eq('id', imgData.id);
              } else {
                await supabase.from('provider_usage_daily').insert({
                  provider_id: imgProvId,
                  date: todayStr,
                  requests_count: 1,
                  tokens_count: 0,
                });
              }
            } catch (_) {}

            generatedPosts.push({
              postId: insertedPost.id,
              pageId: page.id,
              pageName: page.name,
              title: insertedPost.title,
              status: postStatus,
              scheduledFor: slot.toISOString(),
              fbPostId,
              fbPermalink,
              qaScore: pipelineResult.qaScore,
            });
          }

          // Generated 1 post for this page, break to evaluate next page
          break;
        }
      } catch (pageErr: any) {
        console.warn(`[Autonomous Worker] Error processing page '${page.name}':`, pageErr?.message);
        errors.push(`Page '${page.name}' error: ${pageErr?.message}`);
      }
    }
  } catch (scanErr: any) {
    console.error('[Autonomous Worker] Error scanning pages:', scanErr?.message);
    errors.push(`Page scan error: ${scanErr?.message}`);
  }

  const summaryMsg = `Autonomous cycle finished: reconciled ${reconciliationSummary?.publishedCount ?? 0}, published due ${duePublishedCount}, generated & scheduled ${generatedPosts.length} post(s).`;
  console.log(`[Autonomous Worker] ${summaryMsg}`);

  return {
    executed: true,
    message: summaryMsg,
    reconciled: reconciliationSummary,
    duePublishedCount,
    generatedPosts,
    errors,
  };
}
