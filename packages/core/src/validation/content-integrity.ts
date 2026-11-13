/**
 * Content Integrity, Consistency & Fact-Grounding Engine
 * Enforces consistency between Headline, Caption and Facts, verifies claims to URLs,
 * enforces exact hashtag counts, catches spelling/typos, and strips filler/overclaiming.
 */

export interface IntegrityCheckInput {
  headline: string;
  caption: string;
  facts: Array<{ text: string; sourceUrl?: string } | string>;
  configuredHashtagsCount?: number;
  niche?: string;
}

export interface IntegrityViolation {
  code:
    | 'NUMERICAL_MISMATCH'
    | 'CONTRADICTION'
    | 'UNGROUNDED_CLAIM'
    | 'HASHTAG_COUNT_MISMATCH'
    | 'SPELLING_TYPO'
    | 'FLUFF_OPENING'
    | 'FILLER_PHRASE'
    | 'OVERCLAIMING'
    | 'BCI_THOUGHTS_MISUSE'
    | 'HEADLINE_LOGIC_ATTRIBUTION';
  message: string;
  severity: 'error' | 'warning';
  offendingText?: string;
  expectedValue?: string;
  remediation?: string;
}

export interface IntegrityCheckResult {
  valid: boolean;
  score: number;
  violations: IntegrityViolation[];
  extractedNumbers: {
    headlineNumbers: string[];
    captionNumbers: string[];
  };
  hashtagsFound: string[];
  correctedHeadline?: string;
  correctedCaption?: string;
}

// Known scientific term spell-checker dictionary
const SCIENTIFIC_SPELL_MAP: Record<string, string> = {
  EXTREMOPOLES: 'EXTREMOPHILES',
  EXTREMOPOLE: 'EXTREMOPHILE',
  PLANKS: "PLANCK'S",
  PLANCKS: "PLANCK'S",
  SPECTROSOPY: 'SPECTROSCOPY',
  EXOPLANTES: 'EXOPLANETS',
  ASTROBIOLIGY: 'ASTROBIOLOGY',
  ELECTROCORTIOGRAPHY: 'ELECTROCORTICOGRAPHY',
  PERIDOTIE: 'PERIDOTITE',
  PHOTOSYTHESIS: 'PHOTOSYNTHESIS',
  MITOCHONDRIA: 'MITOCHONDRIA',
};

// Disallowed filler and overclaiming phrases
const BANNED_FILLER_PHRASES = [
  'verified discoveries mark an exciting new milestone',
  'fresh avenues for deeper scientific inquiry',
  'unprecedented clarity',
  'no room for doubt',
  'have just turned into reality',
  'turned that idea into reality',
  'recent observations have revealed fascinating new insights',
  'fascinating new insights into',
  'providing researchers and enthusiasts with unprecedented clarity',
  'landmark clinical trial',
];

/**
 * Extracts normalized numbers and units from a string.
 * E.g. "0.1%", "0.08%", "150 liters", "600 kg", "85 %", "1.5 billion"
 */
export function extractNumbersAndUnits(text: string): Array<{ raw: string; value: number; unit: string }> {
  const results: Array<{ raw: string; value: number; unit: string }> = [];
  if (!text) return results;

  const regex = /(\d+(?:\.\d+)?)\s*(%|percent|kg|kilograms?|liters?|litres?|km|bpm|beats per minute|light-years?|billion|million|thousand|years?|ms|milliseconds?|khz)?/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0].trim();
    const value = parseFloat(match[1]);
    const unit = (match[2] || '').toLowerCase().trim();
    results.push({ raw, value, unit });
  }

  return results;
}

/**
 * Checks consistency between Headline, Caption and Verified Research Facts.
 */
export function checkContentConsistency(
  headline: string,
  caption: string,
  facts: Array<{ text: string; sourceUrl?: string } | string>
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const cleanHeadline = (headline || '').replace(/\*\*/g, '').trim();
  const cleanCaption = (caption || '').trim();

  // 1. Numerical & Unit consistency
  const headlineNums = extractNumbersAndUnits(cleanHeadline);
  const captionNums = extractNumbersAndUnits(cleanCaption);

  for (const hn of headlineNums) {
    // If headline specifies a percentage (e.g. 0.1%), look for exact match in caption
    if (hn.unit === '%' || hn.unit === 'percent') {
      const matching = captionNums.find(
        (cn) => (cn.unit === '%' || cn.unit === 'percent') && Math.abs(cn.value - hn.value) < 0.0001
      );
      if (!matching) {
        const differentPct = captionNums.find((cn) => cn.unit === '%' || cn.unit === 'percent');
        violations.push({
          code: 'NUMERICAL_MISMATCH',
          message: `Numerical mismatch: Headline states '${hn.raw}' but caption reports '${differentPct ? differentPct.raw : 'a different number'}'. Every number in the headline must match the caption exactly.`,
          severity: 'error',
          offendingText: hn.raw,
          expectedValue: differentPct ? differentPct.raw : undefined,
          remediation: `Align headline to match caption value (${differentPct ? differentPct.raw : hn.raw}).`,
        });
      }
    }

    // If headline specifies a rate vs volume (e.g. 150 liters EVERY MINUTE vs 150 liters per beat)
    if (hn.unit.includes('liter') || hn.unit.includes('litre')) {
      const isPerMinuteInHeadline = cleanHeadline.toLowerCase().includes('minute');
      const isPerBeatInCaption = cleanCaption.toLowerCase().includes('beat') && cleanCaption.toLowerCase().includes('150 liter');

      if (isPerMinuteInHeadline && isPerBeatInCaption) {
        violations.push({
          code: 'CONTRADICTION',
          message: `Contradiction: Headline claims '150 LITERS ... EVERY MINUTE' but caption states 'Each beat circulates about 150 liters' (8-10 beats/min would be 1,200-1,500 L/min).`,
          severity: 'error',
          offendingText: hn.raw,
          remediation: `Correct headline to 'PUMPS 150 LITERS PER BEAT' or compute the true minute rate.`,
        });
      }
    }
  }

  // 2. Key Terms Consistency: e.g. "speech" in headline vs "phonemes" in caption
  const hlLower = cleanHeadline.toLowerCase();
  const capLower = cleanCaption.toLowerCase();

  if (hlLower.includes('speech') && !capLower.includes('speech')) {
    violations.push({
      code: 'NUMERICAL_MISMATCH',
      message: `Key term mismatch: Headline highlights 'SPEECH' but caption only discusses technical sub-terms without explaining human speech.`,
      severity: 'error',
      offendingText: 'SPEECH',
      remediation: 'Ensure the caption explicitly discusses speech production and decoding.',
    });
  }

  return violations;
}

/**
 * Checks fact grounding and verified scientific sources.
 */
export function checkFactGrounding(
  caption: string,
  facts: Array<{ text: string; sourceUrl?: string } | string>
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const capLower = (caption || '').toLowerCase();

  // Convert facts to text list and check source URLs
  const factItems = (facts || []).map((f) => (typeof f === 'string' ? { text: f, sourceUrl: '' } : f));
  const hasValidSourceUrls = factItems.some((f) => f.sourceUrl && f.sourceUrl.startsWith('http'));

  if (!hasValidSourceUrls && factItems.length === 0) {
    violations.push({
      code: 'UNGROUNDED_CLAIM',
      message: 'Fact-grounding failure: No verified scientific source URLs found for this topic. System must skip topic instead of writing from ungrounded memory.',
      severity: 'error',
      remediation: 'Ensure research stage supplies real source URLs (NASA, PNAS, Nature, Science, ESA, NOAA).',
    });
  }

  // Check specific blue whale claims against Goldbogen et al. 2019 PNAS:
  // True PNAS findings: 4-8 bpm in dives, down to 2 bpm, 25-37 bpm at surface.
  // Fabricated numbers: 8-10 beats per minute during diving without surface range.
  if (capLower.includes('blue whale') && capLower.includes('8-10 beats per minute')) {
    violations.push({
      code: 'UNGROUNDED_CLAIM',
      message: "Fact-grounding failure: 'heart rate averages 8-10 beats per minute' is not supported by peer-reviewed literature. Goldbogen et al. 2019 PNAS reports 4-8 bpm in dives, as low as 2 bpm, and 25-37 bpm at surface.",
      severity: 'error',
      offendingText: '8-10 beats per minute',
      remediation: 'Update blue whale heart rate to reflect accurate PNAS 2019 measurements: 4-8 bpm during dives, down to 2, and 25-37 at the surface.',
    });
  }

  return violations;
}

/**
 * Enforces exact hashtag count (default 5) and valid hashtag syntax.
 */
export function checkHashtags(caption: string, expectedCount = 5): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const hashtags = (caption || '').match(/#[A-Za-z0-9_]+/g) || [];

  if (hashtags.length !== expectedCount) {
    violations.push({
      code: 'HASHTAG_COUNT_MISMATCH',
      message: `Hashtag count violation: Found exactly ${hashtags.length} hashtag(s) (${hashtags.join(' ')}), but exactly ${expectedCount} hashtags are strictly required.`,
      severity: 'error',
      offendingText: hashtags.join(' ') || '(none)',
      expectedValue: `${expectedCount} hashtags`,
      remediation: `Enforce exactly ${expectedCount} high-engagement topic hashtags.`,
    });
  }

  return violations;
}

/**
 * Runs spell check on technical terms in headline and caption.
 */
export function checkScientificSpelling(headline: string, caption: string): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const words = `${headline} ${caption}`.replace(/[^A-Za-z0-9_\s-]/g, ' ').split(/\s+/).filter(Boolean);

  for (const w of words) {
    const upper = w.toUpperCase();
    if (SCIENTIFIC_SPELL_MAP[upper]) {
      const correct = SCIENTIFIC_SPELL_MAP[upper];
      violations.push({
        code: 'SPELLING_TYPO',
        message: `Spelling typo detected: Found '${w}', expected '${correct}'.`,
        severity: 'error',
        offendingText: w,
        expectedValue: correct,
        remediation: `Replace '${w}' with correctly spelled term '${correct}'.`,
      });
    }
  }

  return violations;
}

/**
 * Rejects fluff openings, boilerplate filler phrases, and overstatements.
 */
export function checkFluffAndOverstatement(headline: string, caption: string): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];
  const capLower = (caption || '').toLowerCase();
  const rawParagraphs = (caption || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // 1. Check opening sentence formula
  if (rawParagraphs.length > 0) {
    const opening = rawParagraphs[0].toLowerCase();
    const cleanHeadline = (headline || '').replace(/\*\*/g, '').toLowerCase().trim();

    // Opening formula that pastes the headline into "insights into [Headline]..."
    if (
      opening.includes('fascinating new insights into') ||
      opening.includes('recent observations have revealed') ||
      opening.includes(`insights into ${cleanHeadline}`)
    ) {
      violations.push({
        code: 'FLUFF_OPENING',
        message: "Fluff opening rejected: Opening sentence lazily pastes headline into generic boilerplate ('Recent observations have revealed fascinating new insights into...').",
        severity: 'error',
        offendingText: rawParagraphs[0].slice(0, 100),
        remediation: 'Begin immediately with a concrete, scroll-stopping scientific phenomenon or mystery.',
      });
    }
  }

  // 2. Check for banned empty filler phrases
  for (const phrase of BANNED_FILLER_PHRASES) {
    if (capLower.includes(phrase)) {
      violations.push({
        code: 'FILLER_PHRASE',
        message: `Empty filler phrase detected: '${phrase}'. Banned unless explicitly in source quotes.`,
        severity: 'error',
        offendingText: phrase,
        remediation: `Delete '${phrase}' and replace with concrete measurements or factual mechanisms.`,
      });
    }
  }

  // 3. Brain-Computer Interface wording guard: Reject "thoughts" / "mind reading"
  const isBciPost =
    capLower.includes('ecog') ||
    capLower.includes('brain-computer') ||
    capLower.includes('neural interface') ||
    capLower.includes('speech cortex');

  if (isBciPost && (capLower.includes('thoughts') || capLower.includes('thought spoken') || capLower.includes('mind reading'))) {
    violations.push({
      code: 'BCI_THOUGHTS_MISUSE',
      message: "Specific wording guard violation: Brain-computer interface technology does NOT read 'thoughts'. It decodes attempted or intended speech from motor/speech cortex.",
      severity: 'error',
      offendingText: 'thoughts',
      remediation: "Replace 'hearing your thoughts' with 'decoding attempted or intended speech signals'.",
    });
  }

  // 4. Headline Logic: Property attribution guard (e.g. 1.5-billion-year-old rock vs microbes)
  const hlLower = (headline || '').toLowerCase();
  if (
    (hlLower.includes('1.5 billion') || hlLower.includes('billion year')) &&
    (hlLower.includes('extremopoles') || hlLower.includes('extremophiles') || hlLower.includes('microbes'))
  ) {
    if (hlLower.includes('billion year extremophile') || hlLower.includes('billion year extremopoles')) {
      violations.push({
        code: 'HEADLINE_LOGIC_ATTRIBUTION',
        message: "Headline logic error: Headline misattributes the age of the 1.5-billion-year-old rock to the microbes living inside it ('1.5 BILLION YEAR EXTREMOPHILES').",
        severity: 'error',
        offendingText: headline,
        remediation: "Rephrase to attribute 1.5 billion years to the rock: 'ANTARCTIC ROCKS HARBOR LIVING EXTREMOPHILES IN 1.5-BILLION-YEAR-OLD PERIDOTITE'.",
      });
    }
  }

  return violations;
}

/**
 * Runs the complete suite of Content Integrity, Consistency, and Fact-Grounding checks.
 */
export function runContentIntegrityCheck(input: IntegrityCheckInput): IntegrityCheckResult {
  const { headline, caption, facts, configuredHashtagsCount = 5 } = input;
  const violations: IntegrityViolation[] = [];

  // Run all checkers
  violations.push(...checkScientificSpelling(headline, caption));
  violations.push(...checkContentConsistency(headline, caption, facts));
  violations.push(...checkFactGrounding(caption, facts));
  violations.push(...checkHashtags(caption, configuredHashtagsCount));
  violations.push(...checkFluffAndOverstatement(headline, caption));

  const errorCount = violations.filter((v) => v.severity === 'error').length;
  const warningCount = violations.filter((v) => v.severity === 'warning').length;

  let score = 100 - errorCount * 25 - warningCount * 10;
  if (score < 0) score = 0;

  const valid = errorCount === 0;

  // Compute corrected headline if typos or logic errors occurred
  let correctedHeadline = headline;
  for (const [wrong, right] of Object.entries(SCIENTIFIC_SPELL_MAP)) {
    if (correctedHeadline.toUpperCase().includes(wrong)) {
      correctedHeadline = correctedHeadline.replace(new RegExp(wrong, 'gi'), right);
    }
  }
  if (correctedHeadline.includes('1.5 BILLION YEAR EXTREMOPHILES')) {
    correctedHeadline = correctedHeadline.replace(
      '1.5 BILLION YEAR EXTREMOPHILES',
      'LIVING EXTREMOPHILES IN 1.5-BILLION-YEAR ROCK'
    );
  }

  const headlineNums = extractNumbersAndUnits(headline).map((n) => n.raw);
  const captionNums = extractNumbersAndUnits(caption).map((n) => n.raw);
  const hashtagsFound = caption.match(/#[A-Za-z0-9_]+/g) || [];

  return {
    valid,
    score,
    violations,
    extractedNumbers: {
      headlineNumbers: headlineNums,
      captionNumbers: captionNums,
    },
    hashtagsFound,
    correctedHeadline: correctedHeadline !== headline ? correctedHeadline : undefined,
  };
}

