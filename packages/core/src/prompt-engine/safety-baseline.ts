/**
 * Platform Content Safety Baseline (PRD Section 12)
 * CANNOT BE DISABLED OR BYPASSED BY ANY PROFILE OR PAGE OVERRIDE.
 */

export const TEXT_SAFETY_BASELINE = `
[MANDATORY PLATFORM SAFETY BASELINE - STRICT ENFORCEMENT]
1. Absolute Restrictions: No sexual content, nudity, or sexualization; no child harm or exploitation; no graphic gore or gratuitous violence; no self-harm or suicide content; no hate speech or harassment; no instructions for weapons, dangerous substances, or criminal acts.
2. Defamation & Real People: Never invent fabricated quotes, crimes, or allegations against real, identifiable people. For real-life and true-crime content, rely strictly on public verified sources with neutral, cautious phrasing ("alleged", "according to reports"). Never glorify offenders or name non-public victims.
3. Fiction Disclosure: Fictional narratives must never be presented as real news or factual events.
4. Intellectual Property: Do not generate copyrighted franchise characters, trademarked corporate logos, or protected song lyrics.
`.trim();

export const IMAGE_SAFETY_BASELINE = `
[MANDATORY IMAGE SAFETY DIRECTIVES]
High quality, safe for work, no graphic violence, no gore, no blood splatter, no nudity or sexually suggestive depictions, no real living persons likeness, no trademarked logos, no text inside the image.
`.trim();

export const QA_SAFETY_CRITERIA = `
Evaluate strictly against platform safety rules:
- Does the content contain any graphic violence, sexual themes, harassment, or self-harm?
- Does it make fabricated factual claims about real living individuals?
- Does it infringe on copyrighted characters or brands?
- If fiction, is it clearly presented as fiction?
`.trim();

/**
 * Permanently injects the non-bypassable platform safety baseline into a prompt template.
 */
export function injectSafetyBaseline(
  prompt: string,
  kind: 'text' | 'image' | 'qa' = 'text'
): string {
  const base = prompt.trim();
  const baseline =
    kind === 'image'
      ? IMAGE_SAFETY_BASELINE
      : kind === 'qa'
        ? QA_SAFETY_CRITERIA
        : TEXT_SAFETY_BASELINE;

  if (base.includes(baseline)) {
    return base;
  }

  return `${base}\n\n${baseline}`;
}
