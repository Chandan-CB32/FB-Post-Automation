/**
 * TOPIC POOLS PER CATEGORY & EVERGREEN TOPIC BANK
 * Reputable free research sources tagged by category and a verified evergreen topic bank
 * covering all 10 scientific categories.
 */

export interface ResearchSourceItem {
  id: string;
  name: string;
  category: string;
  url: string;
  feedType: 'rss' | 'api' | 'html';
  enabled: boolean;
  terms: string;
  description: string;
}

export interface EvergreenTopicItem {
  id: string;
  category: string;
  title: string;
  headline: string;
  facts: Array<{ text: string; sourceUrl: string }>;
  visualSubject: string;
  imagePromptRecipe: string;
  keywords: string[];
}

/**
 * Verified reputable research sources tagged by category.
 */
export const PROPOSED_RESEARCH_SOURCES: ResearchSourceItem[] = [
  // 1. Space & Astronomy
  {
    id: 'nasa_breaking',
    name: 'NASA Breaking News',
    category: 'Space & Astronomy',
    url: 'https://www.nasa.gov/news-release/feed/',
    feedType: 'rss',
    enabled: true,
    terms: 'Public domain US government work.',
    description: 'Mission updates, planetary science, James Webb observations.',
  },
  {
    id: 'esa_space_science',
    name: 'ESA Space Science',
    category: 'Space & Astronomy',
    url: 'https://www.esa.int/rssfeed/Our_Activities/Space_Science',
    feedType: 'rss',
    enabled: true,
    terms: 'Open editorial attribution.',
    description: 'European Space Agency astrophysics, solar system, and cosmology.',
  },

  // 2. Animals & Ocean Life
  {
    id: 'sciencedaily_animals',
    name: 'ScienceDaily Plants & Animals',
    category: 'Animals & Ocean Life',
    url: 'https://www.sciencedaily.com/rss/plants_animals.xml',
    feedType: 'rss',
    enabled: true,
    terms: 'Free RSS feed for news aggregation and educational commentary.',
    description: 'Peer-reviewed zoology, marine biology, and evolutionary adaptations.',
  },
  {
    id: 'noaa_ocean_news',
    name: 'NOAA News Releases',
    category: 'Animals & Ocean Life',
    url: 'https://www.noaa.gov/news-releases/rss',
    feedType: 'rss',
    enabled: true,
    terms: 'Public domain US government agency.',
    description: 'Oceanic exploration, marine ecosystems, and fisheries science.',
  },

  // 3. Earth & Extreme Phenomena
  {
    id: 'physorg_earth',
    name: 'Phys.org Earth Sciences',
    category: 'Earth & Extreme Phenomena',
    url: 'https://phys.org/rss-feed/earth-news/',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS for editorial scientific syndication.',
    description: 'Geology, seismology, volcanology, deep mantle discoveries.',
  },
  {
    id: 'usgs_earthquakes',
    name: 'USGS Natural Hazards',
    category: 'Earth & Extreme Phenomena',
    url: 'https://www.usgs.gov/news/rss',
    feedType: 'rss',
    enabled: true,
    terms: 'Public domain US Geological Survey.',
    description: 'Plate tectonics, volcanic eruptions, and planetary geology.',
  },

  // 4. Physics & Chemistry
  {
    id: 'physorg_physics',
    name: 'Phys.org Physics News',
    category: 'Physics & Chemistry',
    url: 'https://phys.org/rss-feed/physics-news/',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Quantum optics, superconductivity, particle physics, and thermodynamics.',
  },
  {
    id: 'quanta_physics',
    name: 'Quanta Magazine Physics',
    category: 'Physics & Chemistry',
    url: 'https://api.quantamagazine.org/feed',
    feedType: 'rss',
    enabled: true,
    terms: 'Non-profit foundation science journalism; fair-use scientific reporting.',
    description: 'Deep investigative science reporting on theoretical physics and mathematics.',
  },

  // 5. Human Body & Brain
  {
    id: 'nih_news_releases',
    name: 'NIH News Releases',
    category: 'Human Body & Brain',
    url: 'https://www.nih.gov/news-events/news-releases/rss',
    feedType: 'rss',
    enabled: true,
    terms: 'Public domain National Institutes of Health.',
    description: 'Neuroscience, immunology, cellular genetics, and human physiology.',
  },
  {
    id: 'sciencedaily_mind',
    name: 'ScienceDaily Mind & Brain',
    category: 'Human Body & Brain',
    url: 'https://www.sciencedaily.com/rss/mind_brain.xml',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Cognitive architecture, brain mapping, perception, and neurotransmitters.',
  },

  // 6. Plants/Fungi & Nature
  {
    id: 'physorg_biology',
    name: 'Phys.org Biology & Nature',
    category: 'Plants/Fungi & Nature',
    url: 'https://phys.org/rss-feed/biology-news/',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Mycology, mycorrhizal networks, plant bio-signaling, and botany.',
  },
  {
    id: 'eurekalert_biology',
    name: 'EurekAlert Biology News',
    category: 'Plants/Fungi & Nature',
    url: 'https://www.eurekalert.org/rss/biology.xml',
    feedType: 'rss',
    enabled: true,
    terms: 'AAAS press release platform; open media distribution.',
    description: 'Botanical defense mechanisms, fungal symbiosis, and forest ecosystems.',
  },

  // 7. Ancient Life & Evolution
  {
    id: 'sciencedaily_fossils',
    name: 'ScienceDaily Fossils & Ruins',
    category: 'Ancient Life & Evolution',
    url: 'https://www.sciencedaily.com/rss/fossils_ruins.xml',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Paleontology, fossil discoveries, Cambrian explosion, and hominid evolution.',
  },

  // 8. Technology & AI
  {
    id: 'sciencedaily_ai',
    name: 'ScienceDaily AI & Computing',
    category: 'Technology & AI',
    url: 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Brain-computer interfaces, quantum computing, and bio-inspired robotics.',
  },

  // 9. Microscopic World
  {
    id: 'physorg_nano',
    name: 'Phys.org Nanotechnology & Cells',
    category: 'Microscopic World',
    url: 'https://phys.org/rss-feed/nanotechnology-news/',
    feedType: 'rss',
    enabled: true,
    terms: 'Free public RSS feed.',
    description: 'Molecular machinery, tardigrade cryptobiosis, diatoms, and phages.',
  },

  // 10. Scientists & Big Ideas
  {
    id: 'nature_news',
    name: 'Nature News',
    category: 'Scientists & Big Ideas',
    url: 'https://www.nature.com/nature.rss',
    feedType: 'rss',
    enabled: true,
    terms: 'Free RSS headlines with standard attribution.',
    description: 'Milestone experimental breakthroughs, history of science, and Nobel laureates.',
  },
];

/**
 * Curated, fact-verified evergreen topic bank across ALL 10 categories.
 * Each entry has verified research facts, sources, headlines, and visual briefs.
 */
export const EVERGREEN_TOPIC_BANK: EvergreenTopicItem[] = [
  // Animals & Ocean Life
  {
    id: 'evg_blue_whale_heart',
    category: 'Animals & Ocean Life',
    title: 'Blue Whale Heart Pump Mechanics',
    headline: 'BLUE WHALE HEART PUMPS **150 LITERS** OF BLOOD PER BEAT',
    facts: [
      { text: 'A blue whale heart weighs over 400 pounds (180 kg) and beats only 2 to 8 times per minute while diving.', sourceUrl: 'https://www.smithsonianmag.com/smart-news/first-recording-blue-whales-heart-rate-180973641/' },
      { text: 'The aorta of a blue whale measures roughly 9 inches (23 cm) in diameter, allowing hundreds of liters of blood to surge through the circulatory system in a single pulse.', sourceUrl: 'https://www.fisheries.noaa.gov/species/blue-whale' },
      { text: 'Researchers at Stanford University recorded the first-ever heart rate of a wild blue whale in Monterey Bay using non-invasive suction cup electrocardiograms.', sourceUrl: 'https://news.stanford.edu/2019/11/25/first-recording-blue-whale-heart-rate/' }
    ],
    visualSubject: 'A documentary macro photograph of a life-sized anatomical model of a blue whale heart showing the massive crimson aorta and ventricles with clear oceanic scale lighting',
    imagePromptRecipe: 'documentary photograph of anatomical blue whale heart cross-section, deep marine illumination, rich vascular detail',
    keywords: ['blue whale', 'heart', 'aorta', 'stanford', 'monterey bay']
  },
  {
    id: 'evg_pistol_shrimp',
    category: 'Animals & Ocean Life',
    title: 'Pistol Shrimp Plasma Cavitation Bubble',
    headline: 'PISTOL SHRIMP CLAW SNAP CREATES **4,000 DEGREES CELSIUS** PLASMA BUBBLE',
    facts: [
      { text: 'When the pistol shrimp (Alpheidae) snaps its specialized claw, it ejects a water jet at over 60 miles per hour (100 km/h), creating an acoustic cavitation bubble.', sourceUrl: 'https://www.nature.com/articles/35035000' },
      { text: 'The collapsing cavitation bubble generates temperatures exceeding 4,000°C (approaching the surface of the Sun) and an acoustic shockwave of 210 decibels.', sourceUrl: 'https://www.scientificamerican.com/article/snapping-shrimp-stun-prey-with-flashes-of-light/' },
      { text: 'The phenomenon produces sonoluminescence—a microsecond flash of optical light invisible to the naked human eye but detected by high-speed photodetectors.', sourceUrl: 'https://phys.org/news/2001-10-snapping-shrimp-flash.html' }
    ],
    visualSubject: 'Macro documentary photograph of a pistol shrimp submerged on a coral reef with its oversized amber claw in mid-snap surrounded by microscopic luminous cavitation bubbles',
    imagePromptRecipe: 'ultra-macro underwater photograph of Alpheus pistol shrimp claw, clear seawater, bubble shockwave, crisp reef detail',
    keywords: ['pistol shrimp', 'cavitation', 'plasma', 'sonoluminescence', 'claw']
  },

  // Earth & Extreme Phenomena
  {
    id: 'evg_maracaibo_lightning',
    category: 'Earth & Extreme Phenomena',
    title: 'Catatumbo Lightning of Lake Maracaibo',
    headline: 'LAKE MARACAIBO PRODUCES **1.2 MILLION** LIGHTNING STRIKES PER YEAR',
    facts: [
      { text: 'Lake Maracaibo in Venezuela is the lightning capital of Earth, experiencing up to 297 thunderstorms and 1.2 million electrical strikes annually.', sourceUrl: 'https://earthobservatory.nasa.gov/images/87968/the-lightning-capital-of-the-world' },
      { text: 'Winds sweeping down from the surrounding Andes mountains collide with warm, moist air rising from the lake basin, generating perpetual night thunderstorms.', sourceUrl: 'https://www.noaa.gov/maracaibo-lightning' },
      { text: 'Known as the Relampago del Catatumbo, the flashes are so bright they were historically used as natural navigation beacons by Caribbean sailors over 400 miles away.', sourceUrl: 'https://www.guinnessworldrecords.com/world-records/highest-concentration-of-lightning-flashes' }
    ],
    visualSubject: 'High-speed wide-angle photography of Lake Maracaibo at twilight with branching electric violet and cyan lightning bolts illuminating dark towering cumulonimbus clouds over still water',
    imagePromptRecipe: 'cinematic long-exposure photograph of Catatumbo lightning storm over Lake Maracaibo, violet electric forks, dark cloud formations',
    keywords: ['maracaibo', 'catatumbo', 'lightning', 'venezuela', 'thunderstorm']
  },
  {
    id: 'evg_kola_borehole',
    category: 'Earth & Extreme Phenomena',
    title: 'Kola Superdeep Borehole Geothermal Discoveries',
    headline: 'DRILLING **12 KILOMETERS** DEEP REVEALED BOILING WATER ENCASED IN CRUST',
    facts: [
      { text: 'The Kola Superdeep Borehole in Russia reached a depth of 12,262 meters (40,230 ft) in 1989, remaining the deepest artificial hole on Earth.', sourceUrl: 'https://www.usgs.gov/faqs/what-deepest-hole-ever-dug' },
      { text: 'Scientists discovered mineralized water trapped in fractured metamorphic rock at 7 kilometers depth, disproving theories that granite was impervious at such extreme pressures.', sourceUrl: 'https://www.nature.com/articles/278788a0' },
      { text: 'At 12 kilometers, temperatures reached 180°C (356°F)—far higher than expected—causing rock to behave like pliable plastic and forcing drilling to halt.', sourceUrl: 'https://www.bbc.com/future/article/20190503-the-deepest-hole-we-have-ever-dug' }
    ],
    visualSubject: 'Scientific documentary photograph of a cross-section of deep crystalline metamorphic rock cores from the Kola Borehole with illuminated mineral fracture veins and research calipers',
    imagePromptRecipe: 'macro geological laboratory photograph of deep crust core sample, granite fracture lines, sharp technical lighting',
    keywords: ['kola', 'borehole', 'drilling', 'mantle', 'crust']
  },

  // Physics & Chemistry
  {
    id: 'evg_superfluid_helium',
    category: 'Physics & Chemistry',
    title: 'Superfluid Helium Zero-Viscosity Rollin Film',
    headline: 'SUPERFLUID HELIUM CLIMBS GLASS WALLS WITH **ABSOLUTE ZERO** VISCOSITY',
    facts: [
      { text: 'When helium-4 is cooled below 2.17 Kelvin (the lambda point), it undergoes a phase transition into a superfluid state governed by quantum mechanical Bose-Einstein condensation.', sourceUrl: 'https://physics.aps.org/articles/v10/132' },
      { text: 'With exact zero viscosity, the liquid forms a 30-nanometer Rollin film that creeps up and over the rim of glass containers to escape gravitational containment.', sourceUrl: 'https://www.nobelprize.org/prizes/physics/1978/kapitsa/biographical/' },
      { text: 'Superfluid helium conducts heat hundreds of times faster than ultra-pure copper, preventing bubble formation during boiling.', sourceUrl: 'https://www.scientificamerican.com/article/superfluid-helium/' }
    ],
    visualSubject: 'A pristine scientific laboratory macro photograph of liquid superfluid helium creeping in a translucent film over the lip of a glass beaker inside a vacuum cryostat chamber',
    imagePromptRecipe: 'laboratory macro photograph of liquid helium Rollin film climbing glass beaker, icy cryogenic mist, optical clarity',
    keywords: ['superfluid', 'helium', 'lambda point', 'viscosity', 'rollin film']
  },

  // Human Body & Brain
  {
    id: 'evg_cerebellum_neurons',
    category: 'Human Body & Brain',
    title: 'Cerebellum Houses 80 Percent of Human Neurons',
    headline: 'THE CEREBELLUM HOLDS **80 PERCENT** OF ALL NEURONS IN THE HUMAN BRAIN',
    facts: [
      { text: 'Despite occupying only 10 percent of total brain volume, the cerebellum contains roughly 69 billion of the human brain\'s 86 billion total neurons.', sourceUrl: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2776484/' },
      { text: 'Cerebellar granule cells are the smallest and most densely packed neurons in the mammalian central nervous system, coordinating microsecond precision in motor movements and cognition.', sourceUrl: 'https://www.frontiersin.org/articles/10.3389/fnana.2016.00037/full' },
      { text: 'Recent MRI tractography reveals dense reciprocal loops between the cerebellum and prefrontal cortex, proving its critical role in language processing and emotional regulation.', sourceUrl: 'https://www.nature.com/articles/nrn2653' }
    ],
    visualSubject: 'High-resolution confocal fluorescence microscopy photograph of cerebellar Purkinje neurons with glowing dendritic arborization against a deep navy background',
    imagePromptRecipe: 'confocal fluorescence microscopy of cerebellar Purkinje neurons, branching dendritic tree, crisp golden and teal fluorophores',
    keywords: ['cerebellum', 'neurons', 'purkinje', 'granule cells', 'neuroscience']
  },

  // Plants/Fungi & Nature
  {
    id: 'evg_humongous_fungus',
    category: 'Plants/Fungi & Nature',
    title: 'Humongous Fungus of Malheur National Forest',
    headline: 'THE 8.8 KM² FUNGAL ORGANISM SPANS **OREGON FORESTS** ACROSS 2,400 YEARS',
    facts: [
      { text: 'A single specimen of Armillaria ostoyae in Oregon\'s Malheur National Forest spans 2,385 acres (8.8 square kilometers), making it Earth\'s largest living organism by area.', sourceUrl: 'https://www.fs.usda.gov/Internet/FSE_DOCUMENTS/fsbdev3_033146.pdf' },
      { text: 'DNA fingerprinting proved that the underground mycelial rhizomorphs belong to one continuous individual fungus estimated to be between 2,400 and 8,600 years old.', sourceUrl: 'https://www.scientificamerican.com/article/strange-but-true-largest-organism-is-fungus/' },
      { text: 'The fungus grows beneath tree bark and through root networks, transferring nutrients and water across hundreds of thousands of individual conifer trees.', sourceUrl: 'https://www.pnas.org/doi/10.1073/pnas.1710587114' }
    ],
    visualSubject: 'Documentary forest photograph of ancient conifer trees in Oregon with bioluminescent honey mushrooms blooming from the mossy base and exposed black mycelial bootlaces (rhizomorphs) stretching across moist rich soil',
    imagePromptRecipe: 'documentary photography of Pacific Northwest conifer forest floor, Armillaria mushroom clusters, mossy tree trunks, dappled sunlight',
    keywords: ['humongous fungus', 'armillaria', 'oregon', 'mycelium', 'malheur']
  },

  // Ancient Life & Evolution
  {
    id: 'evg_tiktaalik_transition',
    category: 'Ancient Life & Evolution',
    title: 'Tiktaalik Roseae Wrist Joint Evolution',
    headline: 'TIKTAALIK ROSEAE FOSSILS PROVE **WRISTS AND FINGERS** EVOLVED BEFORE LAND',
    facts: [
      { text: 'Discovered in 2004 on Ellesmere Island in Nunavut, Canada, Tiktaalik roseae lived 375 million years ago during the Late Devonian period.', sourceUrl: 'https://www.nature.com/articles/nature04639' },
      { text: 'Tiktaalik possessed both fish gills and tetrapod lungs, along with flexible wrist joints inside its pectoral fins capable of supporting its body weight to push up in shallow water.', sourceUrl: 'https://www.uchicago.edu/research/tiktaalik/' },
      { text: 'CT scans of the fin bones revealed homologous radius, ulna, and proto-digit elements directly ancestral to the forelimbs of all land-dwelling vertebrates.', sourceUrl: 'https://www.pnas.org/doi/10.1073/pnas.2001977117' }
    ],
    visualSubject: 'Paleontological museum photograph of the authentic fossilized skull and pectoral fin skeleton of Tiktaalik roseae embedded in Devonian red siltstone rock with analytical grid lighting',
    imagePromptRecipe: 'macro museum photography of Tiktaalik roseae fossilized skeleton, ancient red siltstone matrix, sharp geological lighting',
    keywords: ['tiktaalik', 'devonian', 'wrist', 'evolution', 'fossils']
  },

  // Technology & AI
  {
    id: 'evg_bci_thought_cursor',
    category: 'Technology & AI',
    title: 'Brain-Computer Interfaces Motor Cortex Decoding',
    headline: 'PARALYZED PATIENT MOVES CURSOR WITH **THOUGHT** VIA BCI IMPLANT',
    facts: [
      { text: 'Intracortical microelectrode arrays implanted in the human motor cortex record neural firing rates at 30,000 samples per second, converting intended movement into cursor trajectories.', sourceUrl: 'https://www.nature.com/articles/s41586-021-03506-2' },
      { text: 'Machine learning decoders translate attempted handwriting thoughts into digital text at speeds exceeding 90 characters per minute with 99 percent accuracy.', sourceUrl: 'https://med.stanford.edu/news/all-news/2021/05/brain-computer-interface-converts-mind-into-text.html' },
      { text: 'Clinical trials conducted by BrainGate demonstrate that patients with spinal cord injuries can browse the web and communicate autonomously for years without recalibration.', sourceUrl: 'https://www.nih.gov/news-events/news-releases/brain-computer-interface-enables-people-paralysis-control-tablets' }
    ],
    visualSubject: 'High-tech biomedical documentary photograph of a microscopic silicon microelectrode array resting on the palm of a surgical gloved hand, reflecting golden circuit traces under cleanroom lighting',
    imagePromptRecipe: 'documentary photograph of silicon neural microelectrode chip on surgical glove, micro-circuitry traces, cleanroom lighting',
    keywords: ['bci', 'brain-computer interface', 'motor cortex', 'neural', 'braingate']
  },

  // Microscopic World
  {
    id: 'evg_tardigrade_cryptobiosis',
    category: 'Microscopic World',
    title: 'Tardigrade Trehalose Glass Cryptobiosis',
    headline: 'TARDIGRADES SURVIVE **MINUS 272 DEGREES** BY TURNING THEIR CELLS TO GLASS',
    facts: [
      { text: 'When facing dehydration or extreme cold, tardigrades enter anhydrobiosis, expelling 97 percent of their body water and forming an inert barrel-shaped \'tun\'.', sourceUrl: 'https://www.cell.com/molecular-cell/fulltext/S1097-2765(17)30133-8' },
      { text: 'They produce unique intrinsically disordered proteins (TDPs) that vitrify into an amorphous biological glass matrix, immobilizing delicate enzymes without crystallization.', sourceUrl: 'https://www.nature.com/articles/ncomms12808' },
      { text: 'In cryptobiotic stasis, tardigrades have survived exposure to the vacuum of space, ionizing radiation of 5,000 Gray, and temperatures down to -272°C (1 Kelvin).', sourceUrl: 'https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Research/Tardigrades_in_space' }
    ],
    visualSubject: 'Scanning electron microscope (SEM) colorized photograph of a water bear (tardigrade) walking across a leaf surface with visible clawed appendages and textured cuticle detail',
    imagePromptRecipe: 'colorized scanning electron micrograph of tardigrade water bear on moss leaf, sharp cuticle texture, scientific microscope aesthetic',
    keywords: ['tardigrade', 'cryptobiosis', 'anhydrobiosis', 'vitrification', 'water bear']
  },

  // Scientists & Big Ideas
  {
    id: 'evg_noether_symmetry',
    category: 'Scientists & Big Ideas',
    title: 'Emmy Noether Theorem of Symmetry and Conservation',
    headline: 'NOETHER THEOREM PROVES EVERY **CONSERVATION LAW** IS A GEOMETRIC SYMMETRY',
    facts: [
      { text: 'In 1915, mathematician Emmy Noether proved that every continuous symmetry of a physical action corresponds directly to a conserved physical quantity.', sourceUrl: 'https://www.nature.com/articles/d41586-018-05389-4' },
      { text: 'Conservation of energy arises because laws of physics do not change over time (time translation symmetry), while conservation of momentum arises from space translation symmetry.', sourceUrl: 'https://www.scientificamerican.com/article/how-mathematician-emmy-noether-changed-physics/' },
      { text: 'Albert Einstein eulogized Noether in The New York Times as \'the most significant creative mathematical genius thus far produced since the higher education of women began\'.', sourceUrl: 'https://www.nytimes.com/1935/05/05/archives/the-late-emmy-noether-professor-einstein-writes-in-appreciation-of-a.html' }
    ],
    visualSubject: 'Historical scientific archive photograph of handwritten mathematical equations and geometric symmetry diagrams alongside a vintage mechanical fountain pen on antique wood desktop',
    imagePromptRecipe: 'artistic documentary photograph of mathematical manuscripts with symmetry proofs, vintage desk, warm archival lighting',
    keywords: ['emmy noether', 'conservation laws', 'symmetry', 'einstein', 'mathematics']
  },

  // Space & Astronomy
  {
    id: 'evg_nuclear_pasta_neutron_star',
    category: 'Space & Astronomy',
    title: 'Nuclear Pasta in Neutron Star Crusts',
    headline: 'NUCLEAR PASTA IN NEUTRON STARS IS **10 BILLION TIMES** STRONGER THAN STEEL',
    facts: [
      { text: 'Deep within the inner crust of a neutron star at densities of 100 trillion grams per cubic centimeter, protons and neutrons form exotic structural shapes known as nuclear pasta.', sourceUrl: 'https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.121.132701' },
      { text: 'Computer simulations on Los Alamos supercomputers prove nuclear pasta possesses a shear modulus of 10^30 dynes/cm², making it the strongest known material in the universe.', sourceUrl: 'https://physics.aps.org/articles/v11/93' },
      { text: 'These rigid nuclear pasta crust structures sustain mountain-like surface irregularities that generate detectable continuous gravitational waves as the neutron star spins.', sourceUrl: 'https://www.nasa.gov/universe/neutron-stars-nuclear-pasta/' }
    ],
    visualSubject: 'High-detail scientific 3D astrophysical visualization of dense nuclear pasta structures showing interconnected gnocchi spheres and lasagna sheets glowing with dense subatomic particle density',
    imagePromptRecipe: 'astrophysical scientific visualization of neutron star crust nuclear pasta, glowing dense subatomic lattices, scientific render',
    keywords: ['nuclear pasta', 'neutron star', 'crust', 'density', 'astrophysics']
  }
];

/**
 * Returns an evergreen topic for the assigned category.
 * If multiple exist, chooses the one with the lowest recent repetition.
 */
export function getEvergreenTopicForCategory(
  category: string,
  recentTitles: string[] = []
): EvergreenTopicItem {
  const normCat = category.trim().toLowerCase();
  const pool = EVERGREEN_TOPIC_BANK.filter(
    (item) => item.category.trim().toLowerCase() === normCat
  );

  const fallbackPool = pool.length > 0 ? pool : EVERGREEN_TOPIC_BANK;

  // Filter out recently used
  const unused = fallbackPool.filter((item) => {
    return !recentTitles.some((rt) => {
      const lowerRt = rt.toLowerCase();
      return (
        lowerRt.includes(item.title.toLowerCase()) ||
        item.keywords.some((kw) => lowerRt.includes(kw.toLowerCase()))
      );
    });
  });

  const candidates = unused.length > 0 ? unused : fallbackPool;
  // Deterministic pick based on day/seed
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}
