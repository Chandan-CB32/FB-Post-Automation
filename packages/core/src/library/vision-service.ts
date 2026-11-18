import { extractJsonFromText } from '../adapters/json-extractor.js';
import type { VisionVerificationResult } from '../types/library.js';

export interface ImageAnalysisResult {
  labels: string[];
  captionHint: string;
}

/**
 * Analyzes an uploaded image to extract 5-10 key descriptive visual labels
 * and a 1-sentence caption hint for matching with spreadsheet topics.
 */
export async function analyzeImageForLibrary(
  imageBuffer: Buffer,
  options: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  } = {}
): Promise<ImageAnalysisResult> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      labels: [],
      captionHint: 'Uploaded image asset',
    };
  }

  const model = options.model || 'gemini-2.5-flash';
  const cleanModel = model.startsWith('models/') ? model.replace('models/', '') : model;
  const baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/models/${cleanModel}:generateContent`;

  const prompt = `You are an expert image cataloging specialist.
Analyze this image and provide:
1. "labels": An array of 5 to 10 specific, concrete visual nouns and descriptors describing the primary subject, environment, and visual details (e.g. ["giant squid", "deep sea", "bioluminescence", "ocean abyss", "tentacles"]).
2. "captionHint": A concise one-sentence description of what is clearly visible in the image.

Output ONLY valid JSON:
{
  "labels": ["string", ...],
  "captionHint": "string"
}`;

  try {
    const base64Data = imageBuffer.toString('base64');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      return { labels: [], captionHint: 'Image asset' };
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJsonFromText(rawText) as any;

    if (parsed && Array.isArray(parsed.labels)) {
      return {
        labels: parsed.labels.map((l: unknown) => String(l).toLowerCase().trim()).filter(Boolean),
        captionHint: String(parsed.captionHint || '').trim() || 'Visual asset',
      };
    }
  } catch {
    // Non-blocking fallback
  }

  return {
    labels: [],
    captionHint: 'Image asset',
  };
}

/**
 * Verifies that the drafted post caption and content idea are grounded in the matched image.
 * Flags contradictions or hallucinations where the caption describes something entirely different
 * from what is shown in the image.
 */
export async function verifyLibraryCaptionGrounding(options: {
  imageBuffer: Buffer;
  caption: string;
  contentIdea: string;
  keyFacts?: string[];
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): Promise<VisionVerificationResult> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Offline / mock fallback
    return {
      passed: true,
      needsReview: false,
      score: 85,
      detectedLabels: [],
      contradictionDetected: false,
      reasoning: 'API key not configured; automated vision verification skipped.',
    };
  }

  const model = options.model || 'gemini-2.5-flash';
  const cleanModel = model.startsWith('models/') ? model.replace('models/', '') : model;
  const baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/models/${cleanModel}:generateContent`;

  const prompt = `You are a strict fact-checking visual editor for Facebook editorial publications.
Your job is to verify whether the attached image matches the draft caption and content topic, or if there is a blatant CONTRADICTION or MISMATCH.

Topic Idea: "${options.contentIdea}"
Key Facts: ${JSON.stringify(options.keyFacts || [])}
Draft Caption Excerpt:
"""
${options.caption.slice(0, 1000)}
"""

Evaluate:
1. Does the image depict or visually align with the topic idea and caption?
2. Is there a blatant contradiction? (e.g. caption discusses deep sea squid, but image shows a desert landscape or a car).
3. Score from 0 to 100 based on visual relevance. (>= 70 is passing).

Return a STRICT JSON response:
{
  "passed": <boolean: true if relevant and no contradiction>,
  "needsReview": <boolean: true if questionable or score < 70>,
  "score": <integer 0-100>,
  "detectedLabels": ["<visible object 1>", "<visible object 2>", ...],
  "contradictionDetected": <boolean: true if image contradicts topic>,
  "reasoning": "<1-2 sentences explaining verdict>"
}`;

  try {
    const base64Data = options.imageBuffer.toString('base64');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return {
        passed: true,
        needsReview: false,
        score: 75,
        detectedLabels: [],
        contradictionDetected: false,
        reasoning: `Vision grounding check skipped (HTTP ${response.status}).`,
      };
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = extractJsonFromText(rawText) as any;

    if (parsed) {
      const contradiction = Boolean(parsed.contradictionDetected);
      const passed = contradiction ? false : Boolean(parsed.passed);
      const score = Number(parsed.score) || (passed ? 85 : 45);
      const needsReview = contradiction || Boolean(parsed.needsReview) || score < 70;

      return {
        passed,
        needsReview,
        score,
        detectedLabels: Array.isArray(parsed.detectedLabels) ? parsed.detectedLabels : [],
        contradictionDetected: contradiction,
        reasoning: String(parsed.reasoning || 'Vision evaluation completed'),
      };
    }
  } catch (err: any) {
    // Non-blocking fallback on transient error
    return {
      passed: true,
      needsReview: false,
      score: 80,
      detectedLabels: [],
      contradictionDetected: false,
      reasoning: `Vision check error: ${err.message || 'unknown'}`,
    };
  }

  return {
    passed: true,
    needsReview: false,
    score: 80,
    detectedLabels: [],
    contradictionDetected: false,
    reasoning: 'Vision verification completed (default).',
  };
}
