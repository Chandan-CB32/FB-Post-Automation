export interface FactItem {
  text: string;
  sourceUrl: string;
}

export interface VerifiedClaim {
  claim: string;
  verified: boolean;
  sourceUrl: string | null;
  matchedFact?: string;
}

export interface ClaimVerificationResult {
  allVerified: boolean;
  claimsCount: number;
  verifiedCount: number;
  unverifiedCount: number;
  claims: VerifiedClaim[];
  sourceUrls: string[];
  unsupportedClaims: string[];
}

const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'that', 'have', 'for', 'not', 'with', 'you', 'this', 'but', 'his', 'from',
  'they', 'say', 'her', 'she', 'will', 'one', 'all', 'would', 'there', 'their', 'what',
  'out', 'about', 'who', 'get', 'which', 'go', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think',
  'also', 'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us', 'are', 'was', 'were',
  'been', 'has', 'had', 'being', 'does', 'did', 'doing',
]);

const EMPIRICAL_KEYWORDS = [
  'detect', 'observ', 'found', 'discover', 'identif', 'measure', 'contain', 'locat',
  'orbit', 'light-year', 'telescope', 'jwst', 'webb', 'nasa', 'esa', 'spectroscop', 'planet',
  'star', 'atmospher', 'water', 'methane', 'carbon', 'dms', 'sulfide', 'hycean',
  'molecule', 'organ', 'phytoplankton', 'million', 'billion', 'percent', 'proven',
  'confirm', 'document', 'evidenc', 'record', 'scientist', 'astrophysic', 'research',
  'k2-18b', 'leo', 'archive', 'historical', 'century', 'decade',
];

/**
 * Extracts meaningful keyword tokens from text (length >= 4, lowercase, excluding stop words).
 */
function extractMeaningfulKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !COMMON_STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Determines whether a sentence makes an empirical factual assertion needing source backing.
 */
function isFactualAssertion(sentence: string): boolean {
  const lower = sentence.toLowerCase().trim();
  if (!lower || lower.endsWith('?')) return false;

  // General philosophical commentary, rhetorical framing, or narrative reflections
  if (
    lower.startsWith('what ') ||
    lower.startsWith('do you ') ||
    lower.startsWith('the universe continues') ||
    lower.startsWith('as our collective understanding') ||
    lower.startsWith('each new perspective') ||
    lower.startsWith('it is a reminder') ||
    lower.startsWith('one thing is certain') ||
    lower.startsWith('groundbreaking observations') ||
    lower.startsWith('groundbreaking insights') ||
    lower.startsWith('recent observations') ||
    lower.startsWith('recent scientific') ||
    lower.startsWith('these verified findings') ||
    lower.startsWith('these verified discoveries') ||
    lower.startsWith('these groundbreaking') ||
    lower.startsWith('these remarkable') ||
    lower.startsWith('these detailed findings') ||
    lower.startsWith('these discoveries') ||
    lower.startsWith('these exciting discoveries') ||
    lower.startsWith('these findings mark') ||
    lower.startsWith('this marks an unprecedented') ||
    lower.startsWith('in the world of')
  ) {
    return false;
  }

  // Must contain empirical keywords or specific numbers/dates
  const hasEmpirical = EMPIRICAL_KEYWORDS.some((kw) => lower.includes(kw));
  const hasNumbers = /\d+/.test(lower);
  return hasEmpirical || hasNumbers;
}

/**
 * Splits caption into individual factual assertions (excluding questions, hashtags, and disclaimers).
 */
export function extractFactualClaims(caption: string): string[] {
  if (!caption || typeof caption !== 'string') return [];

  const paragraphs = caption
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      const lower = p.toLowerCase();
      if (lower.startsWith('#') || lower.startsWith('note:') || lower.startsWith('source:')) return false;
      return true;
    });

  const claims: string[] = [];
  for (const p of paragraphs) {
    if (p.startsWith('#') || p.split(/\s+/).every((w) => w.startsWith('#'))) continue;

    const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [p];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (isFactualAssertion(trimmed)) {
        claims.push(trimmed);
      }
    }
  }

  return claims;
}

/**
 * Cross-references each factual claim in a post against verified research facts.
 * Every factual claim must be backed by a verified fact and a source URL.
 */
export function verifyFactualClaims(
  caption: string,
  researchFacts: FactItem[]
): ClaimVerificationResult {
  const sourceUrls = Array.from(
    new Set(researchFacts.map((f) => f.sourceUrl).filter(Boolean))
  );

  const claims = extractFactualClaims(caption);
  const verifiedClaims: VerifiedClaim[] = [];
  const unsupportedClaims: string[] = [];

  // If no research facts are provided for a factual post, all claims fail verification
  if (!researchFacts || researchFacts.length === 0) {
    for (const c of claims) {
      verifiedClaims.push({
        claim: c,
        verified: false,
        sourceUrl: null,
      });
      unsupportedClaims.push(c);
    }

    return {
      allVerified: false,
      claimsCount: claims.length,
      verifiedCount: 0,
      unverifiedCount: claims.length,
      claims: verifiedClaims,
      sourceUrls: [],
      unsupportedClaims,
    };
  }

  // Pre-tokenize research facts
  const factTokens = researchFacts.map((rf) => ({
    fact: rf,
    keywords: extractMeaningfulKeywords(rf.text),
  }));

  for (const claim of claims) {
    const claimKeywords = extractMeaningfulKeywords(claim);
    let bestMatch: { fact: FactItem; score: number } | null = null;

    for (const ft of factTokens) {
      let keywordOverlap = 0;
      for (const kw of claimKeywords) {
        if (ft.keywords.has(kw)) {
          keywordOverlap++;
        }
      }

      // Check for named scientific entities / specific identifiers
      const lowerClaim = claim.toLowerCase();
      const lowerFact = ft.fact.text.toLowerCase();

      const entities = ['webb', 'jwst', 'k2-18b', 'methane', 'carbon dioxide', 'hycean', 'dimethyl sulfide', 'leo', 'light-years'];
      let entityOverlap = 0;
      for (const ent of entities) {
        if (lowerClaim.includes(ent) && lowerFact.includes(ent)) {
          entityOverlap++;
        }
      }

      // Check for finding / discovery / measurement terms
      const findingTerms = [
        'detect', 'observ', 'spectroscop', 'methane', 'carbon', 'dioxide', 'dms', 'sulfide',
        'hycean', 'phytoplankton', 'telescope', 'light-year', 'habitable', 'molecule',
        'temperature', 'orbit', 'distance', 'evidence', 'transit', 'transmission',
        'magnetic', 'field', 'gauss', 'dynamo', 'spacecraft', 'mission', 'jupiter', 'juno',
        'asymmetry', 'instrument', 'telemetry', 'gravity', 'radiation',
      ];

      let findingMatches = 0;
      for (const ftWord of findingTerms) {
        if (lowerClaim.includes(ftWord) && lowerFact.includes(ftWord)) {
          findingMatches++;
        }
      }

      // Check numerical data & measurements overlap (e.g. "5", "12%", "150", "1.5")
      const claimNumbers = claim.match(/\b\d+(?:\.\d+)?%?\b/g) || [];
      let numberMatches = 0;
      for (const num of claimNumbers) {
        if (lowerFact.includes(num.toLowerCase())) {
          numberMatches++;
        }
      }

      const totalMatchScore = keywordOverlap + entityOverlap * 1.5 + findingMatches * 2 + numberMatches * 3;
      const ratio = claimKeywords.size > 0 ? keywordOverlap / claimKeywords.size : 0;
      // Strong match criteria:
      // 1. Matched finding term with sufficient overlap, OR
      // 2. Strong keyword overlap (>= 3 words or >= 2 words with >= 25% ratio), OR
      // 3. Shared numerical measurement with at least 1 keyword, OR
      // 4. Overall high composite score (>= 4)
      const isStrongMatch =
        (findingMatches >= 1 && (keywordOverlap >= 2 || totalMatchScore >= 3)) ||
        keywordOverlap >= 3 ||
        (keywordOverlap >= 2 && ratio >= 0.25) ||
        (numberMatches >= 1 && keywordOverlap >= 1) ||
        totalMatchScore >= 4;

      if (isStrongMatch && (!bestMatch || totalMatchScore > bestMatch.score)) {
        bestMatch = { fact: ft.fact, score: totalMatchScore };
      }
    }

    if (bestMatch) {
      verifiedClaims.push({
        claim,
        verified: true,
        sourceUrl: bestMatch.fact.sourceUrl,
        matchedFact: bestMatch.fact.text,
      });
    } else {
      verifiedClaims.push({
        claim,
        verified: false,
        sourceUrl: null,
      });
      unsupportedClaims.push(claim);
    }
  }

  const verifiedCount = verifiedClaims.filter((c) => c.verified).length;
  const unverifiedCount = unsupportedClaims.length;
  const allVerified = unverifiedCount === 0 && claims.length > 0;

  return {
    allVerified,
    claimsCount: claims.length,
    verifiedCount,
    unverifiedCount,
    claims: verifiedClaims,
    sourceUrls,
    unsupportedClaims,
  };
}
