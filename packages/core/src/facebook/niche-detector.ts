/**
 * Automatic Facebook Page Niche Detection & Content Profile Suggester
 * FB Auto 247 - Made by Chandan Biswas
 */

import { FacebookGraphClient } from './client.js';
import { extractJsonFromText } from '../adapters/json-extractor.js';
import { ContentProfile } from '../validation/schemas.js';

export interface RawPageProfileData {
  id: string;
  name: string;
  category?: string;
  category_list?: Array<{ id: string; name: string }>;
  about?: string;
  description?: string;
  bio?: string;
  posts: string[];
  totalPostsFound: number;
}

export interface PageNicheAnalysisResult {
  success: boolean;
  notConfigured?: boolean;
  not_enough_info: boolean;
  suggested_profile_id?: string;
  suggested_profile_name?: string;
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  alternative_profiles: Array<{ id: string; name: string }>;
  detected_tone?: string;
  typical_caption_length?: 'short' | 'standard' | 'long' | 'story' | 'epic';
  hashtag_habits?: string;
  suggested_posts_per_day?: number;
  data_sent_summary: string;
  analyzed_at: string;
  message?: string;
}

export interface DraftProfileFromPage {
  name: string;
  niche: string;
  target_audience: string;
  master_prompt: string;
  tone: string;
  typical_caption_length: string;
  hashtag_style: string;
  categories: string[];
  notes: string;
}

/**
 * Fetches Page public metadata and recent post history using official Graph API endpoints.
 * Handles Pages with 0 posts cleanly.
 */
export async function fetchPageProfileData(
  pageId: string,
  pageToken: string,
  client?: FacebookGraphClient
): Promise<RawPageProfileData> {
  const fbClient = client || new FacebookGraphClient();

  // 1. Fetch Page Metadata (Graph API current valid fields)
  let pageInfo: any = {};
  try {
    pageInfo = await fbClient.get<any>(pageId, pageToken, {
      fields: 'id,name,category,category_list,about,description,bio',
    });
  } catch (err: any) {
    pageInfo = { id: pageId, name: `Facebook Page ${pageId}` };
  }

  // 2. Fetch Up to 25 recent posts from Page feed
  const posts: string[] = [];
  try {
    const feedResponse = await fbClient.get<{ data?: Array<{ id: string; message?: string; created_time?: string }> }>(
      `${pageId}/feed`,
      pageToken,
      {
        fields: 'id,message,created_time',
        limit: 25,
      }
    );

    if (feedResponse && Array.isArray(feedResponse.data)) {
      for (const item of feedResponse.data) {
        if (item.message && typeof item.message === 'string' && item.message.trim().length > 0) {
          posts.push(item.message.trim());
        }
      }
    }
  } catch {
    // If Page has no posts or lacks feed read permission, proceed with metadata
  }

  return {
    id: pageId,
    name: pageInfo.name || `Facebook Page ${pageId}`,
    category: pageInfo.category,
    category_list: pageInfo.category_list,
    about: pageInfo.about,
    description: pageInfo.description,
    bio: pageInfo.bio,
    posts,
    totalPostsFound: posts.length,
  };
}

/**
 * Creates a compact, clean public text summary of the Page (never containing tokens).
 */
export function formatPageTextSummary(data: RawPageProfileData): string {
  const lines: string[] = [
    `Page Name: ${data.name}`,
    `Primary Category: ${data.category || 'General'}`,
  ];

  if (data.category_list && data.category_list.length > 0) {
    lines.push(`Categories: ${data.category_list.map((c) => c.name).join(', ')}`);
  }
  if (data.about) lines.push(`About: ${data.about}`);
  if (data.description) lines.push(`Description: ${data.description}`);
  if (data.bio) lines.push(`Bio: ${data.bio}`);

  lines.push(`Sample Recent Post Messages (${data.posts.length} found):`);
  if (data.posts.length === 0) {
    lines.push('  (No public posts found on this Page yet)');
  } else {
    data.posts.slice(0, 10).forEach((msg, idx) => {
      const truncated = msg.length > 250 ? msg.slice(0, 250) + '...' : msg;
      lines.push(`  [Post ${idx + 1}]: "${truncated.replace(/\n+/g, ' ')}"`);
    });
  }

  return lines.join('\n');
}

/**
 * Evaluates Page niche against system Content Profiles using an AI provider.
 */
export async function analyzePageNiche(
  pageData: RawPageProfileData,
  availableProfiles: Array<{ id: string; name: string; audience?: string; master_prompt?: string }>,
  textProviderCall?: (prompt: string, systemPrompt?: string) => Promise<string>
): Promise<PageNicheAnalysisResult> {
  const textSummary = formatPageTextSummary(pageData);
  const nowIso = new Date().toISOString();

  // If AI text provider is not available or not configured
  if (!textProviderCall) {
    return {
      success: false,
      notConfigured: true,
      not_enough_info: false,
      confidence: 0,
      reasoning: 'AI Provider is not configured yet. Please configure an API key in the Providers & Keys tab to enable automatic niche detection.',
      alternative_profiles: [],
      data_sent_summary: textSummary,
      analyzed_at: nowIso,
      message: 'AI Provider is not configured yet.',
    };
  }

  // Check if Page has virtually zero content
  const totalContentChars =
    (pageData.about || '').length +
    (pageData.description || '').length +
    (pageData.bio || '').length +
    pageData.posts.join(' ').length;

  if (totalContentChars < 40 && pageData.posts.length === 0) {
    const fallbackProfile = availableProfiles[0];
    return {
      success: true,
      not_enough_info: true,
      suggested_profile_id: fallbackProfile?.id,
      suggested_profile_name: fallbackProfile?.name,
      confidence: 0.15,
      reasoning: `The Page "${pageData.name}" has minimal public text and 0 recent posts. We recommend selecting a Content Profile manually from the dropdown.`,
      alternative_profiles: availableProfiles.slice(1, 3).map((p) => ({ id: p.id, name: p.name })),
      detected_tone: 'Neutral / Informational',
      typical_caption_length: 'standard',
      suggested_posts_per_day: 2,
      data_sent_summary: textSummary,
      analyzed_at: nowIso,
    };
  }

  const profilesRoster = availableProfiles
    .map((p) => `- ID: "${p.id}" | Name: "${p.name}" | Target Audience: "${p.audience || 'General'}"`)
    .join('\n');

  const systemPrompt = `You are an expert Social Media Content Strategist and Facebook Algorithm Specialist for FB Auto 247.
Your task is to analyze a Facebook Page's public profile and recent posts to determine the best matching Content Profile from the provided list, assess tone, hashtag usage, and recommend an optimal posting cadence.
You must respond with STRICT JSON ONLY. Do not include markdown codeblocks, commentary, or text outside the JSON object.`;

  const userPrompt = `Analyze the following Facebook Page and match it against our available Content Profiles.

AVAILABLE CONTENT PROFILES:
${profilesRoster}

PAGE IDENTITY & CONTENT DATA:
${textSummary}

INSTRUCTIONS:
Return a valid JSON object conforming exactly to this structure:
{
  "suggested_profile_id": "<exact ID of the best matching profile>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<clear 2-3 sentence explanation of why this profile fits the Page theme, tone, and audience>",
  "alternative_profiles": [
    { "id": "<id of 2nd best profile>", "name": "<name>" },
    { "id": "<id of 3rd best profile>", "name": "<name>" }
  ],
  "detected_tone": "<e.g. Mysterious & Intriguing, Educational, Cinematic Storytelling, Inspiring>",
  "typical_caption_length": "<one of: short, standard, long, story, epic>",
  "hashtag_habits": "<e.g. 3-5 relevant thematic hashtags, minimal hashtags, or community tags>",
  "suggested_posts_per_day": <number between 1 and 4>,
  "not_enough_info": false
}`;

  try {
    const rawAiResponse = await textProviderCall(userPrompt, systemPrompt);
    const parsed = extractJsonFromText<any>(rawAiResponse);

    if (!parsed || !parsed.suggested_profile_id) {
      throw new Error('AI provider returned an invalid JSON response format for niche detection.');
    }

    const matchedProfile = availableProfiles.find((p) => p.id === parsed.suggested_profile_id);

    return {
      success: true,
      not_enough_info: Boolean(parsed.not_enough_info),
      suggested_profile_id: parsed.suggested_profile_id,
      suggested_profile_name: matchedProfile?.name || parsed.suggested_profile_id,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.75,
      reasoning: parsed.reasoning || `Matched Page "${pageData.name}" based on public topics and tone.`,
      alternative_profiles: Array.isArray(parsed.alternative_profiles)
        ? parsed.alternative_profiles.slice(0, 2).map((a: any) => ({
            id: String(a.id),
            name: String(a.name || a.id),
          }))
        : [],
      detected_tone: parsed.detected_tone || 'Engaging',
      typical_caption_length: parsed.typical_caption_length || 'standard',
      hashtag_habits: parsed.hashtag_habits || '3-5 targeted niche hashtags',
      suggested_posts_per_day:
        typeof parsed.suggested_posts_per_day === 'number'
          ? Math.max(1, Math.min(5, parsed.suggested_posts_per_day))
          : 2,
      data_sent_summary: textSummary,
      analyzed_at: nowIso,
    };
  } catch (err: any) {
    return {
      success: false,
      not_enough_info: false,
      confidence: 0,
      reasoning: `Analysis failed: ${err.message}`,
      alternative_profiles: [],
      data_sent_summary: textSummary,
      analyzed_at: nowIso,
      message: err.message,
    };
  }
}

/**
 * Generates a draft ContentProfile directly synthesized from the Page's actual voice and posts.
 * The draft can be stored for user review and editing in Page Prompt Studio.
 */
export async function generateDraftProfileFromPage(
  pageData: RawPageProfileData,
  textProviderCall?: (prompt: string, systemPrompt?: string) => Promise<string>
): Promise<DraftProfileFromPage> {
  const textSummary = formatPageTextSummary(pageData);

  if (!textProviderCall) {
    return {
      name: `${pageData.name} Voice`,
      niche: pageData.category || 'General',
      target_audience: 'Curious followers seeking insightful content',
      master_prompt: `Write engaging, authentic Facebook posts tailored specifically for ${pageData.name}. Maintain an insightful, conversational tone.`,
      tone: 'Engaging, authentic, and informative',
      typical_caption_length: 'standard',
      hashtag_style: '#BeyondTheKnown #Discover #Knowledge',
      categories: ['Insights', 'Stories', 'Curiosity', 'Highlights'],
      notes: `Draft generated automatically from Page "${pageData.name}" public analysis. Review in Page Prompt Studio.`,
    };
  }

  const systemPrompt = `You are a professional brand voice architect for FB Auto 247.
Create a complete custom Content Profile master prompt based on a Facebook Page's public voice and sample posts.
Respond with STRICT JSON ONLY.`;

  const userPrompt = `Synthesize a custom Content Profile from this Page's content:
${textSummary}

Return JSON with:
{
  "name": "${pageData.name} Signature Voice",
  "niche": "<short niche category>",
  "target_audience": "<description of primary target audience>",
  "master_prompt": "<detailed 2-3 paragraph instruction guiding how to write viral, authentic Facebook posts in this Page's unique tone and style>",
  "tone": "<description of tone>",
  "typical_caption_length": "<short, standard, long, or story>",
  "hashtag_style": "<3-5 sample hashtags>",
  "categories": ["<topic1>", "<topic2>", "<topic3>", "<topic4>"],
  "notes": "Generated from Page ${pageData.name} analysis."
}`;

  try {
    const raw = await textProviderCall(userPrompt, systemPrompt);
    const parsed = extractJsonFromText<any>(raw);
    if (!parsed || !parsed.master_prompt) {
      throw new Error('Failed to generate draft profile');
    }
    return {
      name: parsed.name || `${pageData.name} Signature Voice`,
      niche: parsed.niche || pageData.category || 'Custom',
      target_audience: parsed.target_audience || 'Targeted Facebook audience',
      master_prompt: parsed.master_prompt,
      tone: parsed.tone || 'Engaging and authoritative',
      typical_caption_length: parsed.typical_caption_length || 'standard',
      hashtag_style: parsed.hashtag_style || '#Discover',
      categories: Array.isArray(parsed.categories) ? parsed.categories : ['General'],
      notes: `Generated from Page "${pageData.name}" analysis. Review and approve in Page Prompt Studio before activating.`,
    };
  } catch {
    return {
      name: `${pageData.name} Signature Voice`,
      niche: pageData.category || 'Custom',
      target_audience: 'Targeted Facebook audience',
      master_prompt: `Create compelling, thought-provoking Facebook posts inspired by the theme of ${pageData.name}. Emphasize clarity, intriguing hooks, and strong reader discussion.`,
      tone: 'Thought-provoking, authentic, and clear',
      typical_caption_length: 'standard',
      hashtag_style: '#Explore #Discover #Knowledge',
      categories: ['Discovery', 'Curiosities', 'Discussion'],
      notes: `Generated from Page "${pageData.name}" analysis. Review and approve in Page Prompt Studio.`,
    };
  }
}
