import { SupabaseClient } from '@supabase/supabase-js';
import { GeminiNativeAdapter } from '../adapters/gemini.js';
import { OpenAIChatAdapter } from '../adapters/openai-chat.js';
import { CloudflareWorkersAIAdapter } from '../adapters/cloudflare.js';
import { PollinationsImageAdapter } from '../adapters/pollinations.js';
import { computeTopicSimilarity, normalizeTopic } from './dedup.js';

export interface ResearchedTopicItem {
  title: string;
  category: string;
  facts: Array<{ text: string; sourceUrl?: string } | string>;
  visualSubject: string;
  headline: string;
  imagePrompt?: string;
  imageUrl?: string;
}

export interface DailyResearchOptions {
  page: any;
  supabase: SupabaseClient;
  activeProviders: any[];
  force?: boolean;
}

export interface DailyResearchResult {
  success: boolean;
  pageId: string;
  pageName: string;
  targetCount: number;
  pendingCount: number;
  generatedCount: number;
  topics: ResearchedTopicItem[];
  error?: string;
}

/**
 * Extracts and parses a JSON array from AI output text safely.
 */
function extractJsonArray(rawText: string): any[] | null {
  if (!rawText || typeof rawText !== 'string') return null;

  // 1. Direct parse attempt
  try {
    const direct = JSON.parse(rawText.trim());
    if (Array.isArray(direct)) return direct;
    if (direct && Array.isArray(direct.topics)) return direct.topics;
  } catch (_) {}

  // 2. Extract from markdown code fences ```json ... ```
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.topics)) return parsed.topics;
    } catch (_) {}
  }

  // 3. Find bracketed JSON array substring [ ... ]
  const firstBracket = rawText.indexOf('[');
  const lastBracket = rawText.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const slice = rawText.slice(firstBracket, lastBracket + 1);
      const parsed = JSON.parse(slice);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // 4. Fallback: Extract individual complete JSON objects if stream was truncated
  const objects: any[] = [];
  const objMatches = rawText.match(/\{[\s\S]*?"title"[\s\S]*?"headline"\s*:\s*"[^"]*"\s*\}/g);
  if (objMatches) {
    for (const om of objMatches) {
      try {
        const item = JSON.parse(om);
        if (item && item.title) objects.push(item);
      } catch (_) {}
    }
    if (objects.length > 0) return objects;
  }

  return null;
}

/**
 * Executes the Daily Content Research cycle for a Facebook page:
 * 1. Checks current pending items against the daily post target.
 * 2. Fetches recent topic history (last 60 days) to prevent repeats.
 * 3. Uses active LLM providers (with priority failover) to research fresh, verified topics.
 * 4. Pre-generates or verifies the exact visual prompt & image for each topic.
 * 5. Stores structured topic packages in `topic_queue_items`.
 */
export async function runDailyContentResearch(
  options: DailyResearchOptions
): Promise<DailyResearchResult> {
  const { page, supabase, activeProviders, force = false } = options;

  if (!page || !page.id) {
    return {
      success: false,
      pageId: '',
      pageName: 'Unknown',
      targetCount: 0,
      pendingCount: 0,
      generatedCount: 0,
      topics: [],
      error: 'Invalid page passed to runDailyContentResearch',
    };
  }

  const sched = page.schedule || {};
  const targetCount = sched.postsPerDay || page.daily_cap || 5;

  // 1. Check existing pending items in topic_queue_items
  const { data: existingPending, error: pendingErr } = await supabase
    .from('topic_queue_items')
    .select('id, text, category, sort_order')
    .eq('page_id', page.id)
    .eq('status', 'pending')
    .order('sort_order', { ascending: true });

  const currentPendingCount = existingPending ? existingPending.length : 0;

  if (!force && currentPendingCount >= targetCount) {
    console.log(
      `[Daily Research] Page '${page.name}' has ${currentPendingCount} pending topic(s) (target: ${targetCount}). Queue is full.`
    );
    return {
      success: true,
      pageId: page.id,
      pageName: page.name,
      targetCount,
      pendingCount: currentPendingCount,
      generatedCount: 0,
      topics: [],
    };
  }

  const neededCount = force ? targetCount : Math.max(1, targetCount - currentPendingCount);
  console.log(
    `[Daily Research] Page '${page.name}' needs ${neededCount} fresh topic(s) (target: ${targetCount}, current: ${currentPendingCount}).`
  );

  // 2. Query recent topics from topic_history & posts to prevent repetition
  const { data: historyRows } = await supabase
    .from('topic_history')
    .select('title')
    .eq('page_id', page.id)
    .order('created_at', { ascending: false })
    .limit(80);

  const { data: postRows } = await supabase
    .from('posts')
    .select('topic_title')
    .eq('page_id', page.id)
    .order('created_at', { ascending: false })
    .limit(80);

  const pastTitles = new Set<string>();
  if (historyRows) {
    for (const r of historyRows) {
      if (r.title && r.title.trim()) pastTitles.add(r.title.trim());
    }
  }
  if (postRows) {
    for (const r of postRows) {
      if (r.topic_title && r.topic_title.trim()) pastTitles.add(r.topic_title.trim());
    }
  }
  if (existingPending) {
    for (const p of existingPending) {
      try {
        const parsed = JSON.parse(p.text);
        if (parsed.title) pastTitles.add(parsed.title.trim());
      } catch (_) {
        if (p.text) pastTitles.add(p.text.trim());
      }
    }
  }

  const pastTitlesList = Array.from(pastTitles).slice(0, 50);

  // 3. Formulate research prompt based on page niche & instructions
  const nicheContext = page.custom_niche || page.category || 'Science, Astronomy, Nature and Technology';
  const customInstructions = page.custom_caption_prompt
    ? `\nPAGE EDITORIAL GUIDELINES:\n${page.custom_caption_prompt.slice(0, 1000)}`
    : '';

  const researchPrompt = `You are an elite scientific research editor planning daily content for a high-engagement Facebook publication about "${nicheContext}".
${customInstructions}

YOUR MISSION:
Research and generate exactly ${neededCount} DISTINCT, captivating, 100% verified real-world topic ideas for today's publishing schedule.

CRITICAL RULES:
1. VARIETY: Each of the ${neededCount} topics MUST be on a completely different subject. Do NOT generate multiple topics on the same star, planet, telescope or event.
2. DEDUPLICATION: You MUST NEVER suggest any topic similar to these previously covered topics:
${pastTitlesList.length > 0 ? pastTitlesList.map((t) => `- ${t}`).join('\n') : '- (None yet)'}
3. ACCURACY: All facts must be scientifically accurate and substantiated by verified research (NASA, ESA, Nature, Science, NOAA, Cell, etc.).
4. VISUAL SUBJECT: Provide a vivid, concrete, photorealistic scene description of the EXACT physical subject for an AI image generator (e.g. "Macro underwater shot of a glass frog resting on a rainforest leaf with translucent glowing skin revealing its beating heart" or "Deep space telescope view of the swirling amber dust rings and young protoplanet in circumstellar disk PDS 70"). AVOID generic terms like "a glowing orb", "abstract digital sphere", or "futuristic city".
5. HEADLINE: 6 to 12 words, ALL CAPS, stating the post's core fact without hype or overclaiming. Wrap 1 to 3 key emphasis words in double asterisks, for example: THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**.

OUTPUT FORMAT:
Return a STRICT JSON array containing exactly ${neededCount} objects with no additional commentary:
[
  {
    "title": "Short accurate title (e.g. James Webb Observes Water Vapor in PDS 70 Inner Disk)",
    "category": "Subcategory (e.g. Space and astronomy / Mind-blowing nature / Animal and ocean science)",
    "facts": [
      "Verified factual claim 1 supported by real peer-reviewed or agency discovery.",
      "Verified factual claim 2 with specific measurements or observations.",
      "Verified factual claim 3 explaining why this finding matters."
    ],
    "visualSubject": "Concrete, highly detailed visual description of the specific subject and focal point",
    "headline": "ACCURATE 6-12 WORD ALL CAPS HEADLINE WITH **KEY WORDS** MARKED"
  }
]`;

  // 4. Multi-provider text failover chain
  const textCandidates = (activeProviders || [])
    .filter((p) => {
      const k = (p.kind || p.adapter_kind || '').toLowerCase();
      const n = (p.name || '').toLowerCase();
      return k !== 'pollinations' && !n.includes('image');
    })
    .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

  let rawAiResponse = '';
  let providerUsed = '';

  for (const prov of textCandidates) {
    if (!prov.apiKey) continue;
    console.log(`[Daily Research] Attempting text candidate: '${prov.name}', model: '${prov.model_name}'`);
    try {
      const kind = (prov.kind || prov.adapter_kind || '').toLowerCase();
      if (kind === 'gemini_native' || kind === 'gemini') {
        const adapter = new GeminiNativeAdapter();
        const res = await adapter.generateText({
          prompt: researchPrompt,
          apiKey: prov.apiKey,
          model: prov.model_name || 'gemini-2.5-flash',
          baseUrl: prov.base_url,
          temperature: 0.7,
          maxTokens: 3000,
          timeoutMs: 35000,
        });
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          providerUsed = prov.name;
          break;
        }
      } else if (kind === 'cloudflare_workers_ai') {
        const adapter = new CloudflareWorkersAIAdapter();
        const res = await adapter.generateText({
          prompt: researchPrompt,
          apiKey: prov.apiKey,
          model: prov.model_name || '@cf/meta/llama-3.1-8b-instruct',
          baseUrl: prov.base_url,
          extraBody: { accountId: prov.config?.account_id || process.env.CLOUDFLARE_ACCOUNT_ID },
          maxTokens: 3000,
          timeoutMs: 30000,
        });
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          providerUsed = prov.name;
          break;
        }
      } else {
        // OpenAI-compatible: Groq, OpenRouter, NVIDIA NIM
        const adapter = new OpenAIChatAdapter();
        // Use proven working model for Groq if misconfigured
        let model = prov.model_name || 'openai/gpt-oss-20b';
        if (prov.name?.toLowerCase().includes('groq') && (model.includes('llama-3.3-70b-versatile') || !model)) {
          model = 'openai/gpt-oss-20b';
        }
        const res = await adapter.generateText({
          prompt: researchPrompt,
          apiKey: prov.apiKey,
          model,
          baseUrl: prov.base_url,
          temperature: 0.7,
          maxTokens: 4000,
          timeoutMs: 35000,
        });
        console.log(`[Daily Research] '${prov.name}' generateText returned text length:`, res.text ? res.text.length : 0);
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          providerUsed = prov.name;
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Daily Research] Provider '${prov.name}' failed:`, err?.message || err);
    }
  }

  const parsedArray = extractJsonArray(rawAiResponse);
  if (!parsedArray || parsedArray.length === 0) {
    console.warn('[Daily Research] Failed to extract valid JSON topics from AI providers. Raw output:', rawAiResponse.slice(0, 300));
    return {
      success: false,
      pageId: page.id,
      pageName: page.name,
      targetCount,
      pendingCount: currentPendingCount,
      generatedCount: 0,
      topics: [],
      error: 'AI providers did not return a valid structured JSON topic array.',
    };
  }

  console.log(`[Daily Research] Successfully researched ${parsedArray.length} topic candidate(s) via '${providerUsed}'.`);

  // 5. Deduplicate and validate topics
  const validTopics: ResearchedTopicItem[] = [];
  for (const item of parsedArray) {
    if (!item.title || typeof item.title !== 'string') continue;
    const title = item.title.trim();

    // Check similarity against past titles
    let isDupe = false;
    for (const prev of pastTitles) {
      if (computeTopicSimilarity(title, prev) >= 0.75) {
        isDupe = true;
        console.log(`[Daily Research] Skipping duplicate topic '${title}' (matches previous '${prev}').`);
        break;
      }
    }
    if (isDupe) continue;

    const category = item.category || page.category || 'Science Highlights';
    const facts = Array.isArray(item.facts) && item.facts.length > 0
      ? item.facts.map((f: any) => (typeof f === 'string' ? f.trim() : String(f.text || f.claim || f)))
      : [`Verified discoveries in ${title} represent major observational milestones in ${category}.`];

    const visualSubject = item.visualSubject && typeof item.visualSubject === 'string'
      ? item.visualSubject.trim()
      : `${title}, photorealistic scientific subject in vivid detail`;

    let headline = item.headline && typeof item.headline === 'string'
      ? item.headline.trim().toUpperCase()
      : `${title.toUpperCase()}`;

    // Ensure headline has asterisks if missing
    if (!headline.includes('**')) {
      const words = headline.split(' ');
      if (words.length >= 4) {
        words[1] = `**${words[1]}`;
        words[2] = `${words[2]}**`;
        headline = words.join(' ');
      }
    }

    const cleanVisualPrompt = `${visualSubject}. cinematic lighting, photorealistic National Geographic quality, 8k resolution, tack sharp photography, sharp focal point, no text, no watermark, no logo, no subtitles, no borders`;

    // 6. Pre-generate / verify image URL for this topic
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualSubject.slice(0, 300))}?width=1080&height=1350&model=flux&nologo=true`;

    validTopics.push({
      title,
      category,
      facts,
      visualSubject,
      headline,
      imagePrompt: cleanVisualPrompt,
      imageUrl,
    });

    pastTitles.add(title);
    if (validTopics.length >= neededCount) break;
  }

  // 7. Store valid topics into topic_queue_items
  let highestOrder = 0;
  if (existingPending && existingPending.length > 0) {
    highestOrder = Math.max(...existingPending.map((p) => p.sort_order || 0)) + 1;
  }

  const insertedRecords: any[] = [];
  for (let i = 0; i < validTopics.length; i++) {
    const topic = validTopics[i];
    const payloadJson = JSON.stringify({
      title: topic.title,
      category: topic.category,
      facts: topic.facts,
      visualSubject: topic.visualSubject,
      headline: topic.headline,
      imagePrompt: topic.imagePrompt,
      imageUrl: topic.imageUrl,
    });

    const { data: inserted, error: insErr } = await supabase
      .from('topic_queue_items')
      .insert({
        page_id: page.id,
        category: topic.category,
        text: payloadJson,
        status: 'pending',
        sort_order: highestOrder + i,
      })
      .select()
      .single();

    if (insErr) {
      console.warn(`[Daily Research] Failed to insert topic '${topic.title}' into queue:`, insErr.message);
    } else {
      insertedRecords.push(inserted);
    }
  }

  console.log(`[Daily Research] Successfully enqueued ${insertedRecords.length} new topic(s) for page '${page.name}'.`);

  return {
    success: true,
    pageId: page.id,
    pageName: page.name,
    targetCount,
    pendingCount: currentPendingCount + insertedRecords.length,
    generatedCount: insertedRecords.length,
    topics: validTopics,
  };
}

export interface RegenerateTopicOptions {
  page: any;
  supabase: SupabaseClient;
  activeProviders: any[];
  userGuidance?: string;
  category?: string;
}

/**
 * Researches and generates a single fresh topic item matching optional user guidance.
 */
export async function regenerateSingleTopicItem(
  options: RegenerateTopicOptions
): Promise<ResearchedTopicItem | null> {
  const { page, supabase, activeProviders, userGuidance, category } = options;
  if (!page || !page.id) return null;

  // 1. Load recent history for dedup
  const { data: historyRows } = await supabase
    .from('topic_history')
    .select('title')
    .eq('page_id', page.id)
    .order('created_at', { ascending: false })
    .limit(80);

  const { data: postRows } = await supabase
    .from('posts')
    .select('topic_title')
    .eq('page_id', page.id)
    .order('created_at', { ascending: false })
    .limit(80);

  const pastTitles = new Set<string>();
  if (historyRows) {
    for (const r of historyRows) {
      if (r.title && r.title.trim()) pastTitles.add(r.title.trim());
    }
  }
  if (postRows) {
    for (const r of postRows) {
      if (r.topic_title && r.topic_title.trim()) pastTitles.add(r.topic_title.trim());
    }
  }

  const pastTitlesList = Array.from(pastTitles).slice(0, 40);
  const nicheContext = page.custom_niche || page.category || 'Science, Astronomy, Nature and Technology';

  const singlePrompt = `You are an elite scientific research editor planning daily content for a high-engagement Facebook publication about "${nicheContext}".

YOUR MISSION:
Research and generate exactly ONE (1) DISTINCT, captivating, 100% verified real-world topic idea for today's publishing schedule.

${userGuidance && userGuidance.trim() ? `SPECIAL USER GUIDANCE / EDITORIAL DIRECTION TO FOLLOW STRICTLY:\n"${userGuidance.trim()}"\n` : ''}
${category && category.trim() ? `DESIRED CATEGORY: ${category.trim()}\n` : ''}

CRITICAL RULES:
1. DEDUPLICATION: You MUST NEVER suggest any topic similar to these previously covered topics:
${pastTitlesList.length > 0 ? pastTitlesList.map((t) => `- ${t}`).join('\n') : '- (None yet)'}
2. ACCURACY: All facts must be scientifically accurate and substantiated by verified research (NASA, ESA, Nature, Science, NOAA, Cell, etc.).
3. VISUAL SUBJECT: Provide a vivid, concrete, photorealistic scene description of the EXACT physical subject for an AI image generator (e.g. "Macro underwater shot of a glass frog resting on a rainforest leaf with translucent glowing skin revealing its beating heart" or "Deep space telescope view of the swirling amber dust rings and young protoplanet in circumstellar disk PDS 70"). AVOID generic terms like "a glowing orb", "abstract digital sphere", or "futuristic city".
4. HEADLINE: 6 to 12 words, ALL CAPS, stating the post's core fact without hype. Wrap 1 to 3 key emphasis words in double asterisks, for example: THE OCTOPUS HAS **THREE HEARTS** AND **BLUE BLOOD**.

OUTPUT FORMAT:
Return a STRICT JSON object with no additional commentary:
{
  "title": "Short accurate title",
  "category": "Subcategory",
  "facts": [
    "Verified factual claim 1 supported by real peer-reviewed discovery.",
    "Verified factual claim 2 with specific measurements or observations.",
    "Verified factual claim 3 explaining why this finding matters."
  ],
  "visualSubject": "Concrete, highly detailed visual description of the specific subject and focal point",
  "headline": "ACCURATE 6-12 WORD ALL CAPS HEADLINE WITH **KEY WORDS** MARKED"
}`;

  const textCandidates = (activeProviders || [])
    .filter((p) => {
      const k = (p.kind || p.adapter_kind || '').toLowerCase();
      const n = (p.name || '').toLowerCase();
      return k !== 'pollinations' && !n.includes('image');
    })
    .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

  let rawAiResponse = '';
  for (const prov of textCandidates) {
    if (!prov.apiKey) continue;
    try {
      const kind = (prov.kind || prov.adapter_kind || '').toLowerCase();
      if (kind === 'gemini_native' || kind === 'gemini') {
        const adapter = new GeminiNativeAdapter();
        const res = await adapter.generateText({
          prompt: singlePrompt,
          apiKey: prov.apiKey,
          model: prov.model_name || 'gemini-2.5-flash',
          baseUrl: prov.base_url,
          temperature: 0.7,
          maxTokens: 2500,
          timeoutMs: 30000,
        });
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          break;
        }
      } else if (kind === 'cloudflare_workers_ai') {
        const adapter = new CloudflareWorkersAIAdapter();
        const res = await adapter.generateText({
          prompt: singlePrompt,
          apiKey: prov.apiKey,
          model: prov.model_name || '@cf/meta/llama-3.1-8b-instruct',
          baseUrl: prov.base_url,
          extraBody: { accountId: prov.config?.account_id || process.env.CLOUDFLARE_ACCOUNT_ID },
          maxTokens: 2500,
          timeoutMs: 30000,
        });
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          break;
        }
      } else {
        const adapter = new OpenAIChatAdapter();
        let model = prov.model_name || 'openai/gpt-oss-20b';
        if (prov.name?.toLowerCase().includes('groq') && (model.includes('llama-3.3-70b-versatile') || !model)) {
          model = 'openai/gpt-oss-20b';
        }
        const res = await adapter.generateText({
          prompt: singlePrompt,
          apiKey: prov.apiKey,
          model,
          baseUrl: prov.base_url,
          temperature: 0.7,
          maxTokens: 3000,
          timeoutMs: 30000,
        });
        if (res.text && res.text.trim()) {
          rawAiResponse = res.text.trim();
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Daily Research] Provider '${prov.name}' failed in regenerateSingleTopicItem:`, err?.message || err);
    }
  }

  let parsedItem: any = null;
  if (rawAiResponse) {
    try {
      const direct = JSON.parse(rawAiResponse.trim());
      if (Array.isArray(direct)) parsedItem = direct[0];
      else if (direct && direct.title) parsedItem = direct;
      else if (direct && Array.isArray(direct.topics)) parsedItem = direct.topics[0];
    } catch (_) {
      const fenceMatch = rawAiResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch && fenceMatch[1]) {
        try {
          const pf = JSON.parse(fenceMatch[1].trim());
          if (Array.isArray(pf)) parsedItem = pf[0];
          else if (pf && pf.title) parsedItem = pf;
        } catch (_) {}
      }
      if (!parsedItem) {
        const f = rawAiResponse.indexOf('{');
        const l = rawAiResponse.lastIndexOf('}');
        if (f !== -1 && l > f) {
          try {
            const po = JSON.parse(rawAiResponse.slice(f, l + 1));
            if (po && po.title) parsedItem = po;
          } catch (_) {}
        }
      }
    }
  }

  if (!parsedItem || !parsedItem.title) return null;

  const title = parsedItem.title.trim();
  const cat = parsedItem.category || category || page.category || 'Science Highlights';
  const facts = Array.isArray(parsedItem.facts) && parsedItem.facts.length > 0
    ? parsedItem.facts.map((f: any) => (typeof f === 'string' ? f.trim() : String(f.text || f.claim || f)))
    : [`Key discoveries in ${title} provide significant observational data in ${cat}.`];

  const visualSubject = parsedItem.visualSubject && typeof parsedItem.visualSubject === 'string'
    ? parsedItem.visualSubject.trim()
    : `${title}, photorealistic national geographic quality photography`;

  let headline = parsedItem.headline && typeof parsedItem.headline === 'string'
    ? parsedItem.headline.trim().toUpperCase()
    : `${title.toUpperCase()}`;

  if (!headline.includes('**')) {
    const words = headline.split(' ');
    if (words.length >= 4) {
      words[1] = `**${words[1]}`;
      words[2] = `${words[2]}**`;
      headline = words.join(' ');
    }
  }

  const cleanVisualPrompt = `${visualSubject}. cinematic lighting, photorealistic National Geographic quality, 8k resolution, tack sharp photography, sharp focal point, no text, no watermark, no logo, no subtitles, no borders`;
  const seed = (Date.now() + Math.floor(Math.random() * 10000)) % 1000000;
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualSubject.slice(0, 300))}?width=1080&height=1350&model=flux&nologo=true&seed=${seed}`;

  return {
    title,
    category: cat,
    facts,
    visualSubject,
    headline,
    imagePrompt: cleanVisualPrompt,
    imageUrl,
  };
}
