import { describe, it, expect } from 'vitest';
import { resolveSettings, GLOBAL_DEFAULTS } from '../packages/core/src/settings-resolver/resolver.js';

describe('Settings Resolver & 4-Tier Inheritance Engine', () => {
  it('falls back to global defaults when no profile, page, or post settings are provided', () => {
    const resolved = resolveSettings({});

    expect(resolved.caption.min).toBe(GLOBAL_DEFAULTS.caption.min);
    expect(resolved.caption.max).toBe(GLOBAL_DEFAULTS.caption.max);
    expect(resolved.image.aspectRatio).toBe('4:5');
    expect(resolved.provenance['caption.min'].source).toBe('global');
    expect(resolved.provenance['image.aspectRatio'].source).toBe('global');
  });

  it('allows Content Profile to override Global defaults', () => {
    const resolved = resolveSettings({
      profile: {
        captionSettings: {
          min: 500,
          max: 900,
          endingStyle: 'cliffhanger',
        },
        imageSettings: {
          style: 'dark moody photograph',
        },
      },
    });

    expect(resolved.caption.min).toBe(500);
    expect(resolved.caption.max).toBe(900);
    expect(resolved.caption.endingStyle).toBe('cliffhanger');
    expect(resolved.image.style).toBe('dark moody photograph');

    expect(resolved.provenance['caption.min'].source).toBe('profile');
    expect(resolved.provenance['caption.max'].source).toBe('profile');
    expect(resolved.provenance['caption.endingStyle'].source).toBe('profile');
    expect(resolved.provenance['image.style'].source).toBe('profile');

    // Unset profile values remain global
    expect(resolved.caption.unit).toBe('words');
    expect(resolved.provenance['caption.unit'].source).toBe('global');
  });

  it('allows Page overrides to supersede Profile settings', () => {
    const resolved = resolveSettings({
      profile: {
        captionSettings: {
          min: 500,
          target: 700,
          max: 900,
        },
      },
      page: {
        overrides: {
          'caption.min': 600,
          'caption.target': 800,
        },
        publishingMode: 'hybrid',
        hybridMinScore: 85,
      },
    });

    expect(resolved.caption.min).toBe(600);
    expect(resolved.caption.target).toBe(800);
    expect(resolved.caption.max).toBe(900); // from profile
    expect(resolved.publishingMode).toBe('hybrid');
    expect(resolved.hybridMinScore).toBe(85);

    expect(resolved.provenance['caption.min'].source).toBe('page');
    expect(resolved.provenance['caption.target'].source).toBe('page');
    expect(resolved.provenance['caption.max'].source).toBe('profile');
    expect(resolved.provenance['publishingMode'].source).toBe('page');
  });

  it('allows Post overrides to supersede Page and Profile settings', () => {
    const resolved = resolveSettings({
      profile: {
        captionSettings: { min: 500, max: 900 },
      },
      page: {
        overrides: { 'caption.min': 600 },
      },
      postOverrides: {
        captionSettings: { min: 750 },
      },
    });

    expect(resolved.caption.min).toBe(750);
    expect(resolved.provenance['caption.min'].source).toBe('post');
  });

  it('appends Page custom caption prompt when mode is append', () => {
    const resolved = resolveSettings({
      profile: {
        templates: {
          captionPrompt: 'Write a horror story about {{topic}}',
        },
      },
      page: {
        customCaptionPrompt: 'Always mention our Page name at the end!',
        customCaptionPromptMode: 'append',
      },
    });

    expect(resolved.templates.captionPrompt).toBe(
      'Write a horror story about {{topic}}\n\nAlways mention our Page name at the end!'
    );
    expect(resolved.provenance['templates.captionPrompt'].source).toBe('page (appended)');
  });

  it('replaces Page custom caption prompt when mode is replace', () => {
    const resolved = resolveSettings({
      profile: {
        templates: {
          captionPrompt: 'Write a horror story about {{topic}}',
        },
      },
      page: {
        customCaptionPrompt: 'Strictly custom prompt for this specific Page only.',
        customCaptionPromptMode: 'replace',
      },
    });

    expect(resolved.templates.captionPrompt).toBe('Strictly custom prompt for this specific Page only.');
    expect(resolved.provenance['templates.captionPrompt'].source).toBe('page');
  });

  it('correctly resolves headline panel configuration for Science & Space profile', () => {
    const resolved = resolveSettings({
      profile: {
        imageSettings: {
          headlinePanel: {
            enabled: true,
            heightPercent: 30,
            backgroundColor: '#000000',
            textColor: '#00FFCC',
          },
        },
      },
    });

    expect(resolved.image.headlinePanel.enabled).toBe(true);
    expect(resolved.image.headlinePanel.heightPercent).toBe(30);
    expect(resolved.image.headlinePanel.textColor).toBe('#00FFCC');
    expect(resolved.provenance['image.headlinePanel.enabled'].source).toBe('profile');
  });
});

