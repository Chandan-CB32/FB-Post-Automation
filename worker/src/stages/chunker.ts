export interface SectionOutline {
  index: number;
  title: string;
  focus: string;
  targetWords: number;
}

/**
 * Accurately counts words in text by splitting on whitespace.
 */
export function countWords(text: string): number {
  if (!text || typeof text !== 'string') return 0;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

/**
 * Builds a balanced multi-section outline distributing a target word count
 * across standard narrative / exposition phases:
 * 1. Hook & Introduction (~18%)
 * 2. Rising Tension / Investigation (~32%)
 * 3. Climax / Revelation (~32%)
 * 4. Aftermath / Reflection / Resolution (~18%)
 */
export function planSectionBudgets(targetWords: number, numSections = 4): SectionOutline[] {
  const sections: SectionOutline[] = [];
  const safeTotal = Math.max(250, targetWords);

  if (numSections <= 3) {
    const w1 = Math.round(safeTotal * 0.25);
    const w2 = Math.round(safeTotal * 0.50);
    const w3 = safeTotal - (w1 + w2);
    return [
      { index: 1, title: 'The Hook & Exposition', focus: 'Immediate opening scene, mysterious premise, and key stakes', targetWords: w1 },
      { index: 2, title: 'The Core Conflict', focus: 'Escalation, unexpected discovery, and rising tension', targetWords: w2 },
      { index: 3, title: 'The Climax & Aftermath', focus: 'Pivotal revelation, emotional climax, and haunting closing thought', targetWords: w3 },
    ];
  }

  // 4 sections standard
  const hookBudget = Math.round(safeTotal * 0.18);
  const risingBudget = Math.round(safeTotal * 0.32);
  const climaxBudget = Math.round(safeTotal * 0.32);
  const resolutionBudget = safeTotal - (hookBudget + risingBudget + climaxBudget);

  return [
    {
      index: 1,
      title: 'The Hook & Opening Atmosphere',
      focus: 'Scroll-stopping opening line, establishing setting, and presenting the initial anomaly or curiosity',
      targetWords: hookBudget,
    },
    {
      index: 2,
      title: 'The Unfolding Mystery & Escalation',
      focus: 'Deeper investigation, eyewitness accounts or background evidence, building suspense and stakes',
      targetWords: risingBudget,
    },
    {
      index: 3,
      title: 'The Climactic Revelation',
      focus: 'The critical turning point, dramatic confrontation, or shocking discovery at the heart of the story',
      targetWords: climaxBudget,
    },
    {
      index: 4,
      title: 'The Aftermath & Echoes',
      focus: 'Lingering questions, lasting consequences, and a resonant closing reflection',
      targetWords: resolutionBudget,
    },
  ];
}

/**
 * Splits prose into clean, mobile-friendly paragraphs adhering to the
 * PRD requirement of max N sentences per paragraph (default 3).
 */
export function formatParagraphs(text: string, maxSentences = 3): string {
  if (!text || typeof text !== 'string') return '';

  // Clean existing excessive newlines
  const rawParagraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const formattedParagraphs: string[] = [];

  for (const p of rawParagraphs) {
    // Split paragraph into sentences by punctuation followed by whitespace
    const sentences = p.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    if (!sentences || sentences.length <= maxSentences) {
      formattedParagraphs.push(p);
      continue;
    }

    // Chunk sentences into groups of maxSentences
    for (let i = 0; i < sentences.length; i += maxSentences) {
      const group = sentences.slice(i, i + maxSentences).join('').trim();
      if (group) {
        formattedParagraphs.push(group);
      }
    }
  }

  return formattedParagraphs.join('\n\n');
}
