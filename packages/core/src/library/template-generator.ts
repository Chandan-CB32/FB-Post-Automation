import * as XLSX from 'xlsx';

export function generateLibraryTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();

  // Tab 1: Template data with headers and 3 realistic rows
  const templateHeaders = [
    'ID',
    'Page',
    'Planned Date/Slot',
    'Category',
    'Content Idea',
    'Image Idea',
    'Image Prompt',
    'Image File Name',
    'Teaser Seed',
    'Hidden Clue',
    'Key Facts',
    'Source Links',
  ];

  const templateRows = [
    [
      'SCI-001',
      'Beyond the Known',
      '2026-11-20 14:00',
      'Deep Sea & Biology',
      'Giant Squid Bioluminescent Hunting Tail',
      'Glowing green photophores on the tail tip of a giant squid in midnight abyss',
      'Hyper-detailed photorealistic giant squid deep ocean dark bioluminescent green tail glow',
      'giant_squid_bioluminescence.jpg',
      'Under crushing darkness, a deep-sea creature reveals a luminous secret weapon.',
      'Photophores emit 510nm green light tuned to deep-water transmission',
      'Giant squid (Architeuthis dux) has bioluminescent organ at tip of tail\nROV imaging confirmed 510 nm green wavelength\nLight illuminates prey up to 30m away',
      'https://ocean.si.edu/ocean-life/invertebrates/giant-squid',
    ],
    [
      'SPC-002',
      'Beyond the Known',
      '2026-11-21 18:30',
      'Space & Astronomy',
      'Jupiter-sized gas giant surviving white dwarf orbit',
      'Massive striped gas giant orbiting close to a blinding white dwarf star',
      'Cinematic deep space illustration of massive gas planet orbiting tiny white dwarf star',
      'gas_giant_white_dwarf.jpg',
      'Imagine a planet bigger than Jupiter orbiting a dead star in just 34 hours.',
      'TESS spotted WD 1856+534 b surviving inside the Roche limit',
      'Planet radius 2.2x Jupiter\nOrbits white dwarf every 1.4 days\nHost star is 0.6-solar-mass white dwarf barely 1% Sun radius\nDiscovered in Nature 2021',
      'https://www.nature.com/articles/s41586-020-2713-y',
    ],
    [
      'FIC-003',
      'Beyond the Known',
      '2026-11-22 20:00',
      'Lost Mysteries',
      'The clockmaker who trapped time in a glass prism',
      'Victorian clockmaker in candlelight holding an iridescent glowing glass prism',
      'Atmospheric oil painting of Victorian watchmaker holding glowing glass prism with frozen light',
      'clockmaker_prism.jpg',
      'In 1884, London watchmaker Silas Vance made a clock that never ticked forward.',
      'The dust inside the prism was frozen mid-air',
      'Vance disappeared from his workshop on Fleet Street\nEvery clock within a 5-mile radius stopped at 11:42 PM\nNotebook found with coordinates',
      'https://example.com/fiction-archives',
    ],
  ];

  const wsTemplate = XLSX.utils.aoa_to_sheet([templateHeaders, ...templateRows]);

  // Set column widths for readability
  wsTemplate['!cols'] = [
    { wch: 10 }, // ID
    { wch: 20 }, // Page
    { wch: 18 }, // Planned Date/Slot
    { wch: 22 }, // Category
    { wch: 35 }, // Content Idea
    { wch: 40 }, // Image Idea
    { wch: 40 }, // Image Prompt
    { wch: 30 }, // Image File Name
    { wch: 40 }, // Teaser Seed
    { wch: 35 }, // Hidden Clue
    { wch: 50 }, // Key Facts
    { wch: 35 }, // Source Links
  ];

  XLSX.utils.book_append_sheet(wb, wsTemplate, 'Content');

  // Tab 2: How to fill
  const instructions = [
    ['FB Auto 247 - Content Library Sheet Instructions'],
    [''],
    ['COLUMN GUIDE:'],
    ['ID', 'Optional unique identifier (e.g. SCI-001, ROW-01). Used for tracking and matching.'],
    ['Page', 'Target Facebook Page name. If left blank, the library defaults to the currently selected page.'],
    ['Planned Date/Slot', 'Scheduled slot in YYYY-MM-DD HH:mm or ISO format. When set, system maps post to this slot.'],
    ['Category', 'Content niche or category (e.g. Space & Astronomy, Deep Sea & Oceans, History). Used for variety balancing.'],
    ['Content Idea', 'REQUIRED. The core topic, story synopsis, or news summary.'],
    ['Image Idea', 'Description of what the visual depicts.'],
    ['Image Prompt', 'Prompt used for AI generation if no image is uploaded (or for reference).'],
    ['Image File Name', 'Exact filename of the image in your uploaded image library (e.g. giant_squid.jpg).'],
    ['Teaser Seed', 'Opening hook or headline seed for caption generation.'],
    ['Hidden Clue / Twist', 'Ending revelation, twist, or clincher fact.'],
    ['Key Facts', 'Ground truth bullet points (one per line or semicolon-separated). Strictly enforced in factual mode.'],
    ['Source Links', 'Verified reference URLs (separated by newlines or commas).'],
    [''],
    ['IMAGE MATCHING HIERARCHY:'],
    ['1. Exact filename match: "squid.jpg" matches "squid.jpg" (100% confidence)'],
    ['2. Ignore extension: "squid.png" matches "squid.jpg" or "squid" (95% confidence)'],
    ['3. Normalized match: "Squid-Deep-Sea" matches "squid_deep_sea.jpg" (90% confidence)'],
    ['4. Manual match: Selected on the Matching Board in the UI (100% confidence)'],
    ['5. Vision AI suggestion: Suggested based on image visual tags and topic idea (75-85% confidence)'],
    ['6. Order match: Sequential 1:1 row assignment if filenames omitted (60% confidence)'],
    [''],
    ['IMPORTANT RULES:'],
    ['- Never leaves a post text-only. In excel_library mode, an approved image is mandatory before publishing.'],
    ['- After live Facebook publishing, original uploaded images are automatically deleted from storage.'],
    ['- In hybrid mode, Full-AI image generation will automatically kick in if your library runs out of images.'],
  ];

  const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
  wsInstructions['!cols'] = [{ wch: 25 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'How to fill');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
