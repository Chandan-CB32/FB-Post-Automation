import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ContentProfile } from '../validation/schemas.js';
import { importMasterPrompt } from './importer.js';

export function createHorrorStoryProfile(): ContentProfile {
  return {
    id: crypto.randomUUID(),
    name: 'Horror Story',
    description: 'Suspenseful and psychological original horror stories for Facebook',
    type: 'fiction',
    language: 'en',
    audience: 'General Facebook English-speaking audience who enjoy horror and folklore',
    masterPrompt: `You are a master horror storyteller writing original short stories for a Facebook audience in {{language}}. Write in {{pov}} with a {{tone}} tone. Build dread slowly with specific sensory details, a strong hook in the first two lines, escalating tension, and an unsettling ending. Keep stories original, self-contained and suitable for a general social-media audience: suggest rather than show gore, no sexual content, no violence against children, no real people, no real brands. Categories: haunted places, urban legends, psychological horror, folklore and creatures, night-shift and isolation stories. Avoid clichés listed in {{avoid_list}} and do not repeat premises from {{recent_titles}}. Target {{word_target}} words ({{word_min}}–{{word_max}}). End with the configured ending style.`,
    templates: {
      captionPrompt: `Write an original horror story about {{topic}}.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.`,
      imagePromptTemplate: `Dark, moody, cinematic photograph of {{key_scene}}, atmospheric lighting, fog and deep shadows, realistic textures, no text, no people's faces in close-up, no gore.`,
      negativeImagePrompt: 'gore, blood splatter, text, watermark, deformed anatomy, modern digital artifacts',
      ideaPrompt: `Propose 3 original horror story premises within category '{{category}}'. Avoid: {{avoid_list}} and {{recent_titles}}.`,
      topicPrompt: `Select the most terrifying and coherent horror premise from the candidates.`,
      qaPrompt: `Evaluate horror story quality: pacing, slow-burn dread, hook in first 2 lines, ending twist, and verify no graphic gore or policy violations.`,
    },
    captionSettings: {
      unit: 'words',
      min: 500,
      target: 700,
      max: 900,
      hookRule: true,
      maxSentencesPerParagraph: 3,
      voice: {
        tone: 'chilling, atmospheric, slow-burn dread',
        pov: 'first-person',
        emojiPolicy: 'none',
        bannedPhrases: ['you won’t believe', 'click here', 'suddenly a jump scare'],
        requiredPhrases: [],
      },
      endingStyle: 'cliffhanger',
      includeQuestion: false,
      formatSourceLine: false,
      disclaimerLine: 'Fictional story. Any resemblance to real events or persons is purely coincidental.',
    },
    hashtagSettings: {
      count: 5,
      bannedHashtags: ['#gore', '#blood'],
      fixedHashtags: ['#HorrorStories', '#CreepyTales', '#UrbanLegends'],
      style: 'niche',
    },
    imageSettings: {
      template: `Dark, moody, cinematic photograph of {{key_scene}}, atmospheric lighting, fog and deep shadows, realistic textures, no text, no people's faces in close-up, no gore.`,
      aspectRatio: '4:5',
      width: 1080,
      height: 1350,
      style: 'dark atmospheric cinematic',
      keySceneMode: 'climax',
      allowTextInImage: false,
      allowRealPeople: false,
      allowLogos: false,
      headlinePanel: {
        enabled: false,
        heightPercent: 25,
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
      },
    },
    topicSettings: {
      sources: {
        autoTopicsWeight: 50,
        ownerQueueWeight: 50,
        researchWeight: 0,
        seriesWeight: 0,
      },
      categories: [
        { name: 'Haunted Places', weight: 30 },
        { name: 'Urban Legends', weight: 30 },
        { name: 'Psychological Horror', weight: 20 },
        { name: 'Folklore and Creatures', weight: 20 },
      ],
      preventConsecutiveCategory: true,
      dedupWindowDays: 90,
      dedupWindowPosts: 200,
      bannedTopics: [],
      includeKeywords: [],
      excludeKeywords: [],
    },
    customVariables: { niche: 'horror' },
    version: 1,
  };
}

export function createCrimeStoryProfile(): ContentProfile {
  return {
    id: crypto.randomUUID(),
    name: 'Crime Story',
    description: 'Suspenseful detective mysteries and whodunits',
    type: 'fiction',
    language: 'en',
    audience: 'General Facebook English-speaking audience who love mystery and detective fiction',
    masterPrompt: `You are a crime fiction writer producing original mystery and detective short stories for a Facebook audience in {{language}}. Open with an intriguing hook, plant clues fairly, build suspense through investigation and misdirection, and finish with a satisfying reveal. Keep violence non-graphic and off-screen, no sexual content, no real people, places of real crimes or real victims, no instructions for committing crimes. Categories: whodunit mysteries, heists, cold cases (fictional), courtroom twists, detective duos. Do not repeat premises from {{recent_titles}}. Target {{word_target}} words.`,
    templates: {
      captionPrompt: `Write an original mystery short story about {{topic}}.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nEnding style: {{ending_style}}.`,
      imagePromptTemplate: `Cinematic, noir-style photograph of {{key_scene}}, moody lighting, rain-slick streets or dim interior, realistic, no text, no real people's likeness, no blood.`,
      negativeImagePrompt: 'gore, weapons pointed at camera, text, watermark, modern oversaturated colors',
      ideaPrompt: `Propose 3 original mystery cases or heist premises within category '{{category}}'.`,
      topicPrompt: `Select the most intriguing crime mystery premise from the candidates.`,
      qaPrompt: `Verify fair clue placement, satisfying twist, non-graphic off-screen violence, and no real crime victim references.`,
    },
    captionSettings: {
      unit: 'words',
      min: 500,
      target: 750,
      max: 1000,
      hookRule: true,
      maxSentencesPerParagraph: 3,
      voice: {
        tone: 'sharp, observant, noir detective mystery',
        pov: 'third-person',
        emojiPolicy: 'none',
        bannedPhrases: ['you won’t believe who did it'],
        requiredPhrases: [],
      },
      endingStyle: 'twist',
      includeQuestion: true,
      formatSourceLine: false,
      disclaimerLine: 'Fictional story. All characters and situations are entirely fictitious.',
    },
    hashtagSettings: {
      count: 5,
      bannedHashtags: ['#realcrime'],
      fixedHashtags: ['#CrimeFiction', '#Whodunit', '#MysteryStories'],
      style: 'niche',
    },
    imageSettings: {
      template: `Cinematic, noir-style photograph of {{key_scene}}, moody lighting, rain-slick streets or dim interior, realistic, no text, no real people's likeness, no blood.`,
      aspectRatio: '4:5',
      width: 1080,
      height: 1350,
      style: 'cinematic noir photograph',
      keySceneMode: 'climax',
      allowTextInImage: false,
      allowRealPeople: false,
      allowLogos: false,
      headlinePanel: {
        enabled: false,
        heightPercent: 25,
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
      },
    },
    topicSettings: {
      sources: {
        autoTopicsWeight: 50,
        ownerQueueWeight: 50,
        researchWeight: 0,
        seriesWeight: 0,
      },
      categories: [
        { name: 'Whodunit Mysteries', weight: 30 },
        { name: 'Heists and Cons', weight: 25 },
        { name: 'Cold Cases', weight: 25 },
        { name: 'Courtroom Twists', weight: 20 },
      ],
      preventConsecutiveCategory: true,
      dedupWindowDays: 90,
      dedupWindowPosts: 200,
      bannedTopics: [],
      includeKeywords: [],
      excludeKeywords: [],
    },
    customVariables: { niche: 'crime_fiction' },
    version: 1,
  };
}

export function createScienceStoryProfile(): ContentProfile {
  return {
    id: crypto.randomUUID(),
    name: 'Science Story',
    description: 'Real discoveries, breakthrough experiments, and astronomy narratives',
    type: 'factual',
    language: 'en',
    audience: 'Science enthusiasts and curious readers worldwide',
    masterPrompt: `You are a science storyteller turning real discoveries, experiments and scientists into engaging narratives for a general audience in {{language}}. Use ONLY the verified facts in {{facts}} for factual claims; add vivid but non-factual scene-setting sparingly and never invent quotes, dates or numbers. Begin with a hook, tell the story in clear steps (the question, the attempt, the surprise, the result, why it matters), distinguish confirmed results from hypotheses, and end with a thought-provoking question. Credit sources in the Source line. Categories: space discoveries, breakthrough experiments, scientists' lives, nature's strangest facts, technology and medicine breakthroughs. Target {{word_target}} words.`,
    templates: {
      captionPrompt: `Write an engaging science story about {{topic}} based strictly on verified facts:\n{{facts}}\n\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Credit sources at the end: {{sources}}.`,
      imagePromptTemplate: `Photorealistic, high-detail image of {{key_scene}}, scientifically plausible, natural lighting, no text, no real people's likeness; if depicting something never photographed, style as an artist's illustration.`,
      negativeImagePrompt: 'text, watermark, unscientific elements, oversaturated fantasy colors',
      ideaPrompt: `Propose 3 compelling science story topics based on recent discoveries or archival breakthroughs in {{category}}.`,
      topicPrompt: `Choose the science story candidate with greatest educational value and awe factor.`,
      qaPrompt: `Confirm every single factual claim is supported by {{facts}}. Check for clear scientific distinction between hypothesis and confirmed evidence.`,
    },
    captionSettings: {
      unit: 'words',
      min: 400,
      target: 600,
      max: 800,
      hookRule: true,
      maxSentencesPerParagraph: 3,
      voice: {
        tone: 'awe-inspiring, scientifically accurate, accessible',
        pov: 'third-person',
        emojiPolicy: 'minimal',
        bannedPhrases: ['mind-blowing miracle', 'scientists are baffled'],
        requiredPhrases: [],
      },
      endingStyle: 'question',
      includeQuestion: true,
      formatSourceLine: true,
    },
    hashtagSettings: {
      count: 5,
      bannedHashtags: [],
      fixedHashtags: ['#Science', '#Discovery', '#Astronomy', '#Tech'],
      style: 'mixed',
    },
    imageSettings: {
      template: `Photorealistic, high-detail image of {{key_scene}}, scientifically plausible, natural lighting, no text, no real people's likeness; if depicting something never photographed, style as an artist's illustration.`,
      aspectRatio: '4:5',
      width: 1080,
      height: 1350,
      style: 'scientifically plausible illustration',
      keySceneMode: 'climax',
      allowTextInImage: false,
      allowRealPeople: false,
      allowLogos: false,
      headlinePanel: {
        enabled: true,
        heightPercent: 28,
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
      },
    },
    topicSettings: {
      sources: {
        autoTopicsWeight: 30,
        ownerQueueWeight: 30,
        researchWeight: 40,
        seriesWeight: 0,
      },
      categories: [
        { name: 'Space Discoveries', weight: 30 },
        { name: 'Breakthrough Experiments', weight: 25 },
        { name: 'Scientists Lives', weight: 25 },
        { name: 'Nature Secrets', weight: 20 },
      ],
      preventConsecutiveCategory: true,
      dedupWindowDays: 90,
      dedupWindowPosts: 200,
      bannedTopics: [],
      includeKeywords: [],
      excludeKeywords: [],
    },
    customVariables: { niche: 'science_story' },
    version: 1,
  };
}

/**
 * Loads and returns all 7 seed content profiles (4 imported from /prompts + 3 starters from Appendix A).
 */
export function getSeedProfiles(promptsDir?: string): ContentProfile[] {
  const dir = promptsDir || path.resolve(process.cwd(), 'prompts');

  const importedProfiles: ContentProfile[] = [];

  const promptFiles = [
    {
      file: 'historical_photos_master_prompt.md',
      name: 'Historical Photos',
      niche: 'historical_photos',
      headlinePanel: false,
    },
    {
      file: 'real_life_photography_master_prompt.md',
      name: 'Real-Life Photography',
      niche: 'real_life_photography',
      headlinePanel: false,
    },
    {
      file: 'science_space_master_prompt.md',
      name: 'Science & Space',
      niche: 'science_space',
      headlinePanel: true,
    },
    {
      file: 'vintage_cars_master_prompt.md',
      name: 'Vintage Cars',
      niche: 'vintage_cars',
      headlinePanel: false,
    },
  ];

  for (const item of promptFiles) {
    const fullPath = path.join(dir, item.file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const profile = importMasterPrompt(content, {
        name: item.name,
        niche: item.niche,
        headlinePanel: item.headlinePanel,
        type: 'factual',
      });
      importedProfiles.push(profile);
    }
  }

  return [
    ...importedProfiles,
    createHorrorStoryProfile(),
    createCrimeStoryProfile(),
    createScienceStoryProfile(),
  ];
}

export * from './extended-niches.js';

import { getExtendedNicheProfiles } from './extended-niches.js';

/**
 * Loads all seed profiles PLUS the expanded catalog of 20+ viral niches.
 */
export function getAllNicheProfiles(promptsDir?: string): ContentProfile[] {
  return [...getSeedProfiles(promptsDir), ...getExtendedNicheProfiles()];
}
