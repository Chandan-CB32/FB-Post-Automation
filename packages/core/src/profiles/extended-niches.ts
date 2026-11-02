import crypto from 'node:crypto';
import { ContentProfile, ContentProfileSchema } from '../validation/schemas.js';

/**
 * Creates a dynamically tailored ContentProfile for any custom user-typed niche.
 */
export function createCustomNicheProfile(
  nicheName: string,
  overrides?: Partial<ContentProfile> & { customType?: 'factual' | 'fiction' | 'true_story' | 'evergreen' }
): ContentProfile {
  const cleanName = nicheName.trim() || 'Custom Niche';
  const tag = cleanName.replace(/[^a-zA-Z0-9]/g, '');
  const profileType = overrides?.customType || overrides?.type || 'factual';

  const baseProfile: ContentProfile = {
    id: overrides?.id || crypto.randomUUID(),
    name: cleanName,
    description: overrides?.description || `High-engagement Facebook content focused on ${cleanName}`,
    type: profileType,
    language: overrides?.language || 'en',
    audience: overrides?.audience || `Passionate Facebook audience interested in ${cleanName} and related topics`,
    masterPrompt:
      overrides?.masterPrompt ||
      `You are an elite social media content creator specializing in ${cleanName} for a viral Facebook page in {{language}}.
Craft compelling, informative, and audience-first posts that hook readers in the first two sentences.
Structure each piece with:
1. An irresistible hook that poses a mystery, questions common assumptions, or presents an extraordinary fact.
2. An engaging narrative breakdown that delivers high-value insights, behind-the-scenes secrets, or gripping details.
3. Clean, scannable formatting with short paragraphs (maximum 3 sentences per paragraph).
4. A thought-provoking discussion question at the end to maximize comments and viral algorithmic reach.
Tone: {{tone}}. Target word count: {{word_target}} words ({{word_min}}-{{word_max}} words). Avoid clichés in {{avoid_list}}.`,
    templates: {
      captionPrompt:
        overrides?.templates?.captionPrompt ||
        `Write a captivating post about {{topic}} for the ${cleanName} community.\nTarget word count: {{word_target}} words ({{word_min}}-{{word_max}} words).\nTone: {{tone}}.\nPOV: {{pov}}.\nEnding style: {{ending_style}}.`,
      imagePromptTemplate:
        overrides?.templates?.imagePromptTemplate ||
        `High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of ${cleanName}, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.`,
      negativeImagePrompt:
        overrides?.templates?.negativeImagePrompt ||
        'text, watermark, logo, deformed anatomy, low resolution, blurry artifacts, cartoon, oversaturated plastic textures',
      ideaPrompt:
        overrides?.templates?.ideaPrompt ||
        `Propose 3 viral, high-curiosity content topics for ${cleanName} within category '{{category}}'. Avoid recent topics in {{recent_titles}}.`,
      topicPrompt:
        overrides?.templates?.topicPrompt ||
        `Select the most compelling, educational, and high-engagement topic candidate for ${cleanName}.`,
      qaPrompt:
        overrides?.templates?.qaPrompt ||
        `Verify content quality for ${cleanName}: strong opening hook, accurate and valuable insights, compliant with community safety standards, zero policy violations.`,
    },
    captionSettings: {
      unit: overrides?.captionSettings?.unit || 'words',
      min: overrides?.captionSettings?.min || 150,
      target: overrides?.captionSettings?.target || 220,
      max: overrides?.captionSettings?.max || 350,
      hookRule: overrides?.captionSettings?.hookRule ?? true,
      maxSentencesPerParagraph: overrides?.captionSettings?.maxSentencesPerParagraph || 3,
      voice: {
        tone: overrides?.captionSettings?.voice?.tone || 'engaging, authoritative, captivating',
        pov: overrides?.captionSettings?.voice?.pov || 'third-person',
        emojiPolicy: overrides?.captionSettings?.voice?.emojiPolicy || 'minimal',
        bannedPhrases: overrides?.captionSettings?.voice?.bannedPhrases || ['click link in bio', 'subscribe now', 'share this right now'],
        requiredPhrases: overrides?.captionSettings?.voice?.requiredPhrases || [],
      },
      endingStyle: overrides?.captionSettings?.endingStyle || 'question',
      includeQuestion: overrides?.captionSettings?.includeQuestion ?? true,
      formatSourceLine: overrides?.captionSettings?.formatSourceLine ?? false,
      disclaimerLine: overrides?.captionSettings?.disclaimerLine,
    },
    hashtagSettings: {
      count: overrides?.hashtagSettings?.count || 5,
      bannedHashtags: overrides?.hashtagSettings?.bannedHashtags || ['#follow4follow', '#like4like'],
      fixedHashtags: overrides?.hashtagSettings?.fixedHashtags || [
        `#${tag}`,
        `#${tag}Community`,
        `#Daily${tag}`,
      ],
      style: overrides?.hashtagSettings?.style || 'mixed',
    },
    imageSettings: {
      template:
        overrides?.imageSettings?.template ||
        `High-end, cinematic, hyper-detailed photograph capturing {{key_scene}} in the theme of ${cleanName}, 8k resolution, authentic textures, volumetric dramatic lighting, photorealistic composition, no text, no watermarks, no logos.`,
      aspectRatio: overrides?.imageSettings?.aspectRatio || '4:5',
      width: overrides?.imageSettings?.width || 1080,
      height: overrides?.imageSettings?.height || 1350,
      style: overrides?.imageSettings?.style || `cinematic photography of ${cleanName}`,
      keySceneMode: overrides?.imageSettings?.keySceneMode || 'climax',
      allowTextInImage: overrides?.imageSettings?.allowTextInImage ?? false,
      allowRealPeople: overrides?.imageSettings?.allowRealPeople ?? false,
      allowLogos: overrides?.imageSettings?.allowLogos ?? false,
      headlinePanel: {
        enabled: overrides?.imageSettings?.headlinePanel?.enabled ?? false,
        heightPercent: overrides?.imageSettings?.headlinePanel?.heightPercent || 25,
        backgroundColor: overrides?.imageSettings?.headlinePanel?.backgroundColor || '#000000',
        textColor: overrides?.imageSettings?.headlinePanel?.textColor || '#FFFFFF',
      },
    },
    topicSettings: {
      sources: overrides?.topicSettings?.sources || {
        autoTopicsWeight: 50,
        ownerQueueWeight: 50,
        researchWeight: 0,
        seriesWeight: 0,
      },
      categories: overrides?.topicSettings?.categories || [
        { name: `${cleanName} Highlights`, weight: 35 },
        { name: 'Unknown Facts & Secrets', weight: 30 },
        { name: 'Modern Trends & Innovations', weight: 20 },
        { name: 'Milestones & History', weight: 15 },
      ],
      preventConsecutiveCategory: overrides?.topicSettings?.preventConsecutiveCategory ?? true,
      dedupWindowDays: overrides?.topicSettings?.dedupWindowDays || 90,
      dedupWindowPosts: overrides?.topicSettings?.dedupWindowPosts || 200,
      bannedTopics: overrides?.topicSettings?.bannedTopics || [],
      includeKeywords: overrides?.topicSettings?.includeKeywords || [],
      excludeKeywords: overrides?.topicSettings?.excludeKeywords || [],
    },
    customVariables: { niche: tag.toLowerCase(), ...(overrides?.customVariables || {}) },
    version: overrides?.version || 1,
  };

  return ContentProfileSchema.parse(baseProfile);
}

/**
 * Massive catalog of 20+ viral, high-CPM preset content niche profiles
 */
export function getExtendedNicheProfiles(): ContentProfile[] {
  return [
    // --- Science, Space & Future Tech ---
    createCustomNicheProfile('AI & Future Technology', {
      id: 'a1000000-0000-4000-8000-000000000001',
      description: 'Breakthrough artificial intelligence, quantum computing, robotics, and cybernetics',
      customType: 'factual',
      audience: 'Tech enthusiasts, engineers, futurists, and innovators',
      captionSettings: {
        unit: 'words',
        min: 160,
        target: 240,
        max: 380,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'visionary, analytical, accessible, forward-looking',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['sky-net is coming', 'robots take over'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#ArtificialIntelligence', '#FutureTech', '#Robotics', '#Innovation', '#TechNews'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Cinematic photograph of futuristic technology, {{key_scene}}, volumetric blue and amber lighting, sleek robotics and cybernetics, 8k resolution, photorealistic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'futuristic high-tech photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 25, backgroundColor: '#050c1a', textColor: '#38bdf8' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 40, ownerQueueWeight: 30, researchWeight: 30, seriesWeight: 0 },
        categories: [
          { name: 'Generative AI & LLMs', weight: 30 },
          { name: 'Humanoid Robotics', weight: 25 },
          { name: 'Quantum Computing', weight: 25 },
          { name: 'Brain-Computer Interfaces', weight: 20 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Deep Ocean & Marine Mysteries', {
      id: 'a1000000-0000-4000-8000-000000000002',
      description: 'Abyssal discoveries, bioluminescent life, Mariana Trench anomalies, and submarine exploration',
      customType: 'factual',
      audience: 'Ocean lovers, nature explorers, and mystery enthusiasts',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 350,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'awe-inspiring, mysterious, scientifically accurate',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['megalodon is still alive'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#DeepSea', '#MarineBiology', '#OceanExploration', '#Abyss', '#NatureWonders'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'National Geographic style underwater photography of {{key_scene}}, bioluminescence glowing in deep dark abyss, clear ocean particulates, high contrast, photorealistic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'deep ocean marine photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#020b14', textColor: '#06b6d4' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Abyssal Zone Discoveries', weight: 35 },
          { name: 'Underwater Megastructures & Shipwrecks', weight: 25 },
          { name: 'Bioluminescent Organisms', weight: 20 },
          { name: 'Deep Sea Trenches', weight: 20 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Aviation & Military Aerospace', {
      id: 'a1000000-0000-4000-8000-000000000003',
      description: 'Supersonic fighters, stealth bombers, aerospace breakthroughs, and cockpit aerodynamics',
      customType: 'factual',
      audience: 'Aviation geeks, pilots, military technology enthusiasts, and mechanical engineers',
      captionSettings: {
        unit: 'words',
        min: 160,
        target: 230,
        max: 360,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'authoritative, adrenaline-fueled, technically detailed',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['secret alien tech'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Aviation', '#FighterJets', '#Aerospace', '#MilitaryTech', '#AviationDaily'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Dynamic telephoto action photograph of {{key_scene}}, dramatic cloud vapor cone, golden hour lighting on fuselage, photorealistic aerospace photography, crisp details.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'aerospace action photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#09131f', textColor: '#f59e0b' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Stealth Aircraft & 5th/6th Gen Fighters', weight: 35 },
          { name: 'Historical Dogfights & Legends', weight: 25 },
          { name: 'Supersonic & Hypersonic Propulsion', weight: 20 },
          { name: 'Commercial Aviation Innovations', weight: 20 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Archeology & Lost Civilizations', {
      id: 'a1000000-0000-4000-8000-000000000004',
      description: 'Ancient megaliths, lost tombs, forgotten languages, and archaeological discoveries',
      customType: 'factual',
      audience: 'History buffs, archaeology fans, and ancient mystery seekers',
      captionSettings: {
        unit: 'words',
        min: 180,
        target: 250,
        max: 400,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'fascinating, scholarly yet accessible, reverent',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['aliens built the pyramids'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Archaeology', '#AncientHistory', '#LostCivilizations', '#HistoryLovers', '#Antiquity'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Archaeological expedition photograph of {{key_scene}}, golden desert dust or lush overgrown jungle ruins, natural cinematic lighting, highly detailed stone textures, realistic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'archaeological documentation photograph',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 25, backgroundColor: '#18120c', textColor: '#fbbf24' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Megaliths & Stone Architecture', weight: 30 },
          { name: 'Submerged Cities & Tombs', weight: 30 },
          { name: 'Forgotten Ancient Empires', weight: 25 },
          { name: 'Undeciphered Scripts & Artifacts', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    // --- Luxury, Engineering & Motoring ---
    createCustomNicheProfile('Hypercars & Supercar Engineering', {
      id: 'a1000000-0000-4000-8000-000000000005',
      description: 'Koenigsegg, Bugatti, Pagani, F1 telemetry, carbon-fiber aerodynamics, and twin-turbo engineering',
      customType: 'factual',
      audience: 'Automotive enthusiasts, supercar collectors, petrolheads, and design connoisseurs',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 340,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'exhilarating, sophisticated, precision-oriented',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['cheap cars', 'budget daily driver'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Supercars', '#Hypercars', '#CarEnthusiast', '#Motorsport', '#AutomotiveDesign'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Commercial automotive studio photography of {{key_scene}}, dramatic rim lighting, glossy carbon fiber reflections, rolling racetrack background, ultra-sharp detail, 8k.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'automotive commercial photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#0f0f12', textColor: '#ef4444' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Record-Breaking Top Speed Runs', weight: 35 },
          { name: 'Aerodynamic Innovations & Active Aero', weight: 25 },
          { name: 'Bespoke Hypercar Builders', weight: 25 },
          { name: 'Formula 1 Technology Transferred to Road', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Horology & Haute Watchmaking', {
      id: 'a1000000-0000-4000-8000-000000000006',
      description: 'Tourbillons, perpetual calendars, Swiss micro-mechanics, and rare luxury timepieces',
      customType: 'factual',
      audience: 'Watch collectors, horology purists, luxury aficionados, and mechanical artisans',
      captionSettings: {
        unit: 'words',
        min: 140,
        target: 210,
        max: 320,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'refined, prestigious, passionate, meticulous',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['cheap knockoffs', 'smartwatches are better'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Horology', '#LuxuryWatches', '#WatchCollector', '#HauteHorlogerie', '#Timepiece'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Macro photography of mechanical watch movement, {{key_scene}}, polished bevels, Geneva stripes, balance wheel in motion, ruby jewels, studio softbox lighting, tack-sharp.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'macro horology photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#0d0d11', textColor: '#d4af37' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Grand Complications & Tourbillons', weight: 35 },
          { name: 'Legendary Vintage Reference Pieces', weight: 25 },
          { name: 'Independent Master Watchmakers', weight: 25 },
          { name: 'Metallurgy & Exotic Materials', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Mega Architecture & Structural Engineering', {
      id: 'a1000000-0000-4000-8000-000000000007',
      description: 'Super-tall skyscrapers, extreme bridges, deep sea tunnels, and monumental engineering feats',
      customType: 'factual',
      audience: 'Civil engineers, architects, construction enthusiasts, and lovers of megastructures',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 230,
        max: 350,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'grandiose, awe-inspiring, structurally precise',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Architecture', '#Engineering', '#Megastructures', '#Skyscrapers', '#CivilEngineering'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Dramatic architectural photography of {{key_scene}}, ultra-wide angle looking up, dramatic cloud patterns, gleaming steel and glass reflections, cinematic twilight lighting.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'architectural fine art photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#101726', textColor: '#60a5fa' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Extreme Skyscrapers & Tuned Mass Dampers', weight: 35 },
          { name: 'Epic Suspension Bridges & Deep Tunnels', weight: 25 },
          { name: 'Futuristic Eco-Cities & Megaprojects', weight: 25 },
          { name: 'Historic Structural Marvels', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    // --- Mind, Philosophy, Health & Wealth ---
    createCustomNicheProfile('Stoicism & Philosophy of Mind', {
      id: 'a1000000-0000-4000-8000-000000000008',
      description: 'Marcus Aurelius, Seneca, mental toughness, emotional mastery, and timeless life philosophy',
      customType: 'evergreen',
      audience: 'Philosophers, thinkers, entrepreneurs, and seekers of clarity and discipline',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 330,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'stoic, calm, profound, deeply grounding',
          pov: 'third-person',
          emojiPolicy: 'none',
          bannedPhrases: ['get rich quick', 'hustle 24/7'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Stoicism', '#Philosophy', '#MarcusAurelius', '#Mindset', '#InnerPeace'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Moody classical marble bust sculpture in dramatic chiaroscuro lighting, {{key_scene}}, dark textured background, deep contemplative shadows, cinematic fine art portrait.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'chiaroscuro classical fine art',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#13110f', textColor: '#e2e8f0' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Dichotomy of Control & Adversity', weight: 35 },
          { name: 'Memento Mori & Perspective on Time', weight: 25 },
          { name: 'Emotional Mastery & Calm Mind', weight: 25 },
          { name: 'Ancient Lessons for Modern Stress', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Personal Finance & Wealth Creation', {
      id: 'a1000000-0000-4000-8000-000000000009',
      description: 'Compound interest, asymmetric investing, financial independence, and business case studies',
      customType: 'evergreen',
      audience: 'Aspiring entrepreneurs, investors, savers, and financial literacy seekers',
      captionSettings: {
        unit: 'words',
        min: 160,
        target: 240,
        max: 360,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'practical, strategic, clear-headed, empowering',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['guaranteed 100x return', 'crypto moon shot', 'get rich quick scheme'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: ['#crypto', '#forexscam'],
        fixedHashtags: ['#PersonalFinance', '#WealthBuilding', '#FinancialFreedom', '#InvestingTips', '#MoneyMindset'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Editorial conceptual photograph representing {{key_scene}}, elegant minimalist financial objects, warm natural architectural lighting, crisp high-end composition.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'editorial financial photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#091c13', textColor: '#10b981' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Compound Interest & Asset Allocation', weight: 35 },
          { name: 'Psychology of Spending & Saving', weight: 25 },
          { name: 'Historical Market Cycles & Lessons', weight: 25 },
          { name: 'Asymmetric Business Models', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Biohacking, Fitness & Longevity', {
      id: 'a1000000-0000-4000-8000-000000000010',
      description: 'Zone 2 training, circadian optimization, fasting, mitochondrial health, and cold exposure',
      customType: 'factual',
      audience: 'Athletes, biohackers, health enthusiasts, and longevity researchers',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 230,
        max: 350,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'science-backed, energetic, disciplined, health-focused',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['magic cure', 'miracle pill'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Biohacking', '#Longevity', '#FitnessScience', '#OptimalHealth', '#Habits'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'High-contrast athletic and scientific wellness photograph of {{key_scene}}, natural morning sunlight, clean minimalist aesthetic, high dynamic range, photorealistic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'wellness lifestyle photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#091a1e', textColor: '#14b8a6' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Circadian Biology & Sleep Optimization', weight: 30 },
          { name: 'Zone 2 Cardio & Vo2 Max Science', weight: 30 },
          { name: 'Mitochondrial Health & Fasting Protocols', weight: 25 },
          { name: 'Thermal Stress (Sauna & Cold Plunges)', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Human Psychology & Cognitive Biases', {
      id: 'a1000000-0000-4000-8000-000000000011',
      description: 'Behavioral economics, optical illusions, cognitive distortions, and social dynamics',
      customType: 'evergreen',
      audience: 'Psychology enthusiasts, curious minds, marketers, and avid readers',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 340,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'fascinating, revealing, psychological, eye-opening',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['mind control hypnosis'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Psychology', '#CognitiveBiases', '#BehavioralScience', '#HumanNature', '#Mind'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Surreal conceptual photography exploring human mind and perception, {{key_scene}}, dramatic shadow play, symbolic and thoughtful composition, photorealistic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'conceptual psychological fine art',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#130e1c', textColor: '#a855f7' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Cognitive Illusions & Mental Shortcuts', weight: 35 },
          { name: 'Social Proof & Group Dynamics', weight: 25 },
          { name: 'Memory Distortions & Recall Tricks', weight: 25 },
          { name: 'Decision-Making Paradigms', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    // --- Nature, Wildlife & Wilderness ---
    createCustomNicheProfile('Wilderness Survival & Bushcraft', {
      id: 'a1000000-0000-4000-8000-000000000012',
      description: 'Off-grid shelter building, primitive firecraft, wild foraging, and survival psychology',
      customType: 'factual',
      audience: 'Outdoorsmen, campers, survivalists, bushcraft artisans, and adventurers',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 340,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'rugged, practical, resourceful, educational',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Bushcraft', '#SurvivalSkills', '#Wilderness', '#OffGrid', '#OutdoorsLife'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Cinematic wilderness photograph of {{key_scene}}, warm campfire glow in pine forest at dusk, realistic wood craft details, authentic outdoor equipment, atmospheric mist.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'outdoor documentary photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#14170d', textColor: '#84cc16' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Primitive Fire Making & Tinder Prep', weight: 30 },
          { name: 'Natural Shelters & Thermal Insulation', weight: 30 },
          { name: 'Water Filtration in the Wild', weight: 25 },
          { name: 'Survival Knotcraft & Tool Crafting', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Apex Predators & Wildlife Secrets', {
      id: 'a1000000-0000-4000-8000-000000000013',
      description: 'Hunting strategies, territorial battles, camouflage tactics, and Serengeti migrations',
      customType: 'factual',
      audience: 'Wildlife photographers, biology fans, animal lovers, and safari enthusiasts',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 340,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'dramatic, reverent, visually vibrant, captivating',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#WildlifePhotography', '#ApexPredator', '#NatureDocumentary', '#WildAnimals', '#BigCats'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'National Geographic telephoto portrait of {{key_scene}}, shallow depth of field, sharp amber eyes, natural savanna dust or arctic snow, breathtaking detail.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'wildlife telephoto photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#171109', textColor: '#f97316' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Apex Hunting Tactics & Teamwork', weight: 35 },
          { name: 'Extreme Camouflage & Mimicry', weight: 25 },
          { name: 'Territorial Duels & Hierarchies', weight: 25 },
          { name: 'Rare Endemic Species', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Extreme Weather & Planetary Wonders', {
      id: 'a1000000-0000-4000-8000-000000000014',
      description: 'Supercell thunderstorms, volcanic lightning, aurora borealis, and tectonic phenomena',
      customType: 'factual',
      audience: 'Meteorology fans, storm chasers, earth science lovers, and nature admirers',
      captionSettings: {
        unit: 'words',
        min: 150,
        target: 220,
        max: 330,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'electrifying, powerful, awe-inspiring, educational',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#ExtremeWeather', '#StormChasing', '#EarthScience', '#MotherNature', '#Aurora'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Dramatic landscape photograph of extreme natural event, {{key_scene}}, illuminated by lightning flash or green aurora glow, majestic scale, tack sharp.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'storm chasing landscape photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#0f172a', textColor: '#38bdf8' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Supercells & Mesocyclone Dynamics', weight: 35 },
          { name: 'Volcanic Eruptions & Pyroclastic Flows', weight: 25 },
          { name: 'Solar Storms & Northern Lights', weight: 25 },
          { name: 'Tsunami & Oceanic Rogue Waves', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    // --- Storytelling, Myths & Dark Fiction ---
    createCustomNicheProfile('Dark Mythology & Ancient Legends', {
      id: 'a1000000-0000-4000-8000-000000000015',
      description: 'Norse Ragnarök, Greek underworld mythos, Slavic creatures, and primordial folklore',
      customType: 'fiction',
      audience: 'Mythology lovers, fantasy readers, gamers, and worldbuilding enthusiasts',
      captionSettings: {
        unit: 'words',
        min: 200,
        target: 300,
        max: 500,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'epic, legendary, atmospheric, evocative',
          pov: 'third-person',
          emojiPolicy: 'none',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'twist',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Mythology', '#NorseMythology', '#AncientFolklore', '#DarkFantasy', '#Legends'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Cinematic fantasy painting of {{key_scene}}, mist-shrouded ruins, glowing runes, dark mythic atmosphere, Frank Frazetta and modern fantasy illustration style, epic scale.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'epic mythic illustration',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#140c10', textColor: '#f43f5e' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Norse Gods & Ragnarök Omens', weight: 35 },
          { name: 'Greek Underworld & Primordials', weight: 25 },
          { name: 'Slavic Forest Spirits & Folklore', weight: 25 },
          { name: 'Lost Mythological Relics & Weapons', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Sci-Fi Worldbuilding & Cyberpunk', {
      id: 'a1000000-0000-4000-8000-000000000016',
      description: 'Dystopian megacities, orbital elevators, interstellar colony ships, and rogue neural AI',
      customType: 'fiction',
      audience: 'Sci-fi readers, concept artists, gamers, and futuristic dreamers',
      captionSettings: {
        unit: 'words',
        min: 220,
        target: 350,
        max: 550,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'gritty, cyberpunk, immersive, cinematic',
          pov: 'third-person',
          emojiPolicy: 'none',
          bannedPhrases: [],
          requiredPhrases: [],
        },
        endingStyle: 'cliffhanger',
        includeQuestion: false,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Cyberpunk', '#SciFi', '#WorldBuilding', '#Dystopian', '#ConceptArt'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Cinematic cyberpunk visual of {{key_scene}}, rain-slicked neon street, holographic advertisements, towering megastructures disappearing into heavy fog, Blade Runner aesthetic.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'cyberpunk cinematic concept art',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#090814', textColor: '#06b6d4' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Cybernetic Megacity Chronicles', weight: 35 },
          { name: 'Generation Colony Ships in Deep Space', weight: 25 },
          { name: 'Sentient AI Awakening Protocols', weight: 25 },
          { name: 'Subterranean Bunker Societies', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Urban Legends & Paranormal Anomalies', {
      id: 'a1000000-0000-4000-8000-000000000017',
      description: 'Cryptids, mysterious disappearances, radio signal anomalies, and strange folklore',
      customType: 'fiction',
      audience: 'Paranormal researchers, campfire story fans, and mystery enthusiasts',
      captionSettings: {
        unit: 'words',
        min: 200,
        target: 320,
        max: 500,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'eerie, investigative, unsettling, suspenseful',
          pov: 'third-person',
          emojiPolicy: 'none',
          bannedPhrases: ['ghostbusters'],
          requiredPhrases: [],
        },
        endingStyle: 'cliffhanger',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#UrbanLegends', '#Cryptids', '#Paranormal', '#UnexplainedMysteries', '#CreepyTales'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Atmospheric found-footage style photograph of {{key_scene}}, flashlight beam piercing thick autumn fog, abandoned backroads, eerie silhouette, grain and realism.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'found-footage eerie photograph',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#0c0d0e', textColor: '#e2e8f0' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Forest Cryptids & Sightings', weight: 35 },
          { name: 'Anomalous Ghost Towns & Highway Legends', weight: 25 },
          { name: 'Unidentified Radio Signals & Transmissions', weight: 25 },
          { name: 'Historical Folk Superstitions', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    // --- History, Craftsmanship & Culture ---
    createCustomNicheProfile('Gourmet Gastronomy & Culinary Secrets', {
      id: 'a1000000-0000-4000-8000-000000000018',
      description: 'Artisan fermentation, dry-aging biochemistry, Michelin knife techniques, and culinary history',
      customType: 'evergreen',
      audience: 'Foodies, chefs, culinary students, and home cooking artisans',
      captionSettings: {
        unit: 'words',
        min: 140,
        target: 210,
        max: 320,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'sensory, passionate, mouth-watering, insightful',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['tastes yummy'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Gastronomy', '#CulinaryArts', '#ChefLife', '#FoodScience', '#Gourmet'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Editorial gourmet food photography of {{key_scene}}, dark rustic wooden table, steam rising gently, beautiful micro-herbs garnish, dramatic side lighting.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'editorial gourmet photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#1c100c', textColor: '#f97316' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Fermentation & Umami Chemistry', weight: 35 },
          { name: 'Dry-Aging & Wood-Fire Mastery', weight: 25 },
          { name: 'Heritage Street Food Recipes & Origins', weight: 25 },
          { name: 'Master Knife Techniques & Plating', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Artisan Woodworking & Master Craft', {
      id: 'a1000000-0000-4000-8000-000000000019',
      description: 'Japanese mortise and tenon joinery, live-edge slab furniture, hand planes, and wood finishing',
      customType: 'evergreen',
      audience: 'Makers, carpenters, woodworkers, DIY crafters, and restoration enthusiasts',
      captionSettings: {
        unit: 'words',
        min: 140,
        target: 210,
        max: 320,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'warm, artisanal, patient, appreciative of craft',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['cheap plastic furniture'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: false,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#Woodworking', '#Handcrafted', '#ArtisanCraft', '#CustomFurniture', '#MakerCommunity'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Workshop photograph of {{key_scene}}, wooden shavings curling off a hand plane, rich walnut wood grain, warm sunbeam through vintage window, crisp focus.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'artisan workshop photography',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#1a130e', textColor: '#d97706' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Japanese Joinery & Hidden Locks', weight: 35 },
          { name: 'Live Edge Slabs & Natural Finishes', weight: 25 },
          { name: 'Hand Tool Restoration & Sharpening', weight: 25 },
          { name: 'Exotic Hardwoods & Grain Patterns', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),

    createCustomNicheProfile('Space Exploration & Mars Missions', {
      id: 'a1000000-0000-4000-8000-000000000020',
      description: 'Starship launches, Martian rovers, Artemis moon base, and planetary terraforming',
      customType: 'factual',
      audience: 'Space enthusiasts, planetary scientists, aerospace followers, and stargazers',
      captionSettings: {
        unit: 'words',
        min: 160,
        target: 240,
        max: 360,
        hookRule: true,
        maxSentencesPerParagraph: 3,
        voice: {
          tone: 'inspirational, cosmic, scientifically rigorous',
          pov: 'third-person',
          emojiPolicy: 'minimal',
          bannedPhrases: ['flat earth'],
          requiredPhrases: [],
        },
        endingStyle: 'question',
        includeQuestion: true,
        formatSourceLine: true,
      },
      hashtagSettings: {
        count: 5,
        bannedHashtags: [],
        fixedHashtags: ['#SpaceX', '#MarsMission', '#NASA', '#Astronomy', '#SpaceExploration'],
        style: 'mixed',
      },
      imageSettings: {
        template: 'Photorealistic render of {{key_scene}}, red Martian soil, dust storms on horizon, human outpost habitat gleaming under distant sun, ultra-high resolution.',
        aspectRatio: '4:5',
        width: 1080,
        height: 1350,
        style: 'astronomical planetary render',
        keySceneMode: 'climax',
        allowTextInImage: false,
        allowRealPeople: false,
        allowLogos: false,
        headlinePanel: { enabled: true, heightPercent: 24, backgroundColor: '#1a0d0a', textColor: '#f87171' },
      },
      topicSettings: {
        sources: { autoTopicsWeight: 50, ownerQueueWeight: 50, researchWeight: 0, seriesWeight: 0 },
        categories: [
          { name: 'Mars Surface Rovers & Water Discoveries', weight: 35 },
          { name: 'Starship & Interplanetary Transport', weight: 25 },
          { name: 'Artemis Lunar Base & Habitats', weight: 25 },
          { name: 'Moons of Jupiter & Saturn (Europa/Titan)', weight: 15 },
        ],
        preventConsecutiveCategory: true,
        dedupWindowDays: 90,
        dedupWindowPosts: 200,
        bannedTopics: [],
        includeKeywords: [],
        excludeKeywords: [],
      },
    }),
  ];
}

/**
 * Returns grouped niches mapped by broad genres for UI categorized optgroups
 */
export function getNicheCategoriesMap(allProfiles: ContentProfile[]): Record<string, ContentProfile[]> {
  const groups: Record<string, ContentProfile[]> = {
    '🚀 Science, Space & Future Tech': [],
    '🔮 Mystery, Horror & Dark Fiction': [],
    '🏎️ Luxury, Engineering & Mechanics': [],
    '🧠 Mind, Philosophy, Health & Wealth': [],
    '🌲 Nature, Wildlife & Survival': [],
    '🏛️ History, Culture & Craftsmanship': [],
    '✨ Other / Custom Niches': [],
  };

  for (const p of allProfiles) {
    const nameLower = p.name.toLowerCase();
    if (
      nameLower.includes('science') ||
      nameLower.includes('space') ||
      nameLower.includes('ai &') ||
      nameLower.includes('aviation') ||
      nameLower.includes('ocean') ||
      nameLower.includes('mars')
    ) {
      groups['🚀 Science, Space & Future Tech'].push(p);
    } else if (
      nameLower.includes('horror') ||
      nameLower.includes('crime') ||
      nameLower.includes('mythology') ||
      nameLower.includes('sci-fi') ||
      nameLower.includes('paranormal') ||
      nameLower.includes('legend')
    ) {
      groups['🔮 Mystery, Horror & Dark Fiction'].push(p);
    } else if (
      nameLower.includes('car') ||
      nameLower.includes('watch') ||
      nameLower.includes('architecture') ||
      nameLower.includes('engineering')
    ) {
      groups['🏎️ Luxury, Engineering & Mechanics'].push(p);
    } else if (
      nameLower.includes('stoicism') ||
      nameLower.includes('philosophy') ||
      nameLower.includes('finance') ||
      nameLower.includes('wealth') ||
      nameLower.includes('biohack') ||
      nameLower.includes('psychology')
    ) {
      groups['🧠 Mind, Philosophy, Health & Wealth'].push(p);
    } else if (
      nameLower.includes('survival') ||
      nameLower.includes('wildlife') ||
      nameLower.includes('predator') ||
      nameLower.includes('weather')
    ) {
      groups['🌲 Nature, Wildlife & Survival'].push(p);
    } else if (
      nameLower.includes('photo') ||
      nameLower.includes('history') ||
      nameLower.includes('archeology') ||
      nameLower.includes('gastronomy') ||
      nameLower.includes('woodworking')
    ) {
      groups['🏛️ History, Culture & Craftsmanship'].push(p);
    } else {
      groups['✨ Other / Custom Niches'].push(p);
    }
  }

  // Remove empty groups
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  }

  return groups;
}
