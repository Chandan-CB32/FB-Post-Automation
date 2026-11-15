-- ============================================================================
-- CONTENT VARIETY ENGINE & CATEGORY DISTRIBUTION MIGRATION (Idempotent)
-- ============================================================================

-- 1. Ensure pages table has category distribution and variety configuration columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'category_weights'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN category_weights JSONB DEFAULT '{
      "Space & Astronomy": 20,
      "Animals & Ocean Life": 14,
      "Earth & Extreme Phenomena": 11,
      "Physics & Chemistry": 11,
      "Human Body & Brain": 10,
      "Plants/Fungi & Nature": 8,
      "Ancient Life & Evolution": 8,
      "Technology & AI": 7,
      "Microscopic World": 6,
      "Scientists & Big Ideas": 5
    }'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'max_daily_space'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN max_daily_space INTEGER DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'max_daily_per_category'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN max_daily_per_category INTEGER DEFAULT 2;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pages' AND column_name = 'vision_check_enabled'
  ) THEN
    ALTER TABLE public.pages ADD COLUMN vision_check_enabled BOOLEAN DEFAULT true;
  END IF;
END $$;

-- 2. Add category and image_brief columns to posts if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'posts' AND column_name = 'image_brief'
  ) THEN
    ALTER TABLE public.posts ADD COLUMN image_brief JSONB;
  END IF;
END $$;

-- 3. Add category index to posts for fast 50-post deficit calculation
CREATE INDEX IF NOT EXISTS idx_posts_page_category_created 
ON public.posts(page_id, category, created_at DESC);

-- 4. Research sources registry table
CREATE TABLE IF NOT EXISTS public.research_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  feed_type TEXT NOT NULL DEFAULT 'rss',
  enabled BOOLEAN NOT NULL DEFAULT true,
  terms TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Seed initial reputable research sources (idempotent upsert)
INSERT INTO public.research_sources (id, name, category, url, feed_type, enabled, terms, description)
VALUES
  ('nasa_breaking', 'NASA Breaking News', 'Space & Astronomy', 'https://www.nasa.gov/news-release/feed/', 'rss', true, 'Public domain US government work.', 'Mission updates, planetary science, James Webb observations.'),
  ('esa_space_science', 'ESA Space Science', 'Space & Astronomy', 'https://www.esa.int/rssfeed/Our_Activities/Space_Science', 'rss', true, 'Open editorial attribution.', 'European Space Agency astrophysics, solar system, and cosmology.'),
  ('sciencedaily_animals', 'ScienceDaily Plants & Animals', 'Animals & Ocean Life', 'https://www.sciencedaily.com/rss/plants_animals.xml', 'rss', true, 'Free RSS feed for news aggregation.', 'Peer-reviewed zoology, marine biology, and evolutionary adaptations.'),
  ('noaa_ocean_news', 'NOAA News Releases', 'Animals & Ocean Life', 'https://www.noaa.gov/news-releases/rss', 'rss', true, 'Public domain US government agency.', 'Oceanic exploration, marine ecosystems, and fisheries science.'),
  ('physorg_earth', 'Phys.org Earth Sciences', 'Earth & Extreme Phenomena', 'https://phys.org/rss-feed/earth-news/', 'rss', true, 'Free public RSS for editorial syndication.', 'Geology, seismology, volcanology, deep mantle discoveries.'),
  ('usgs_hazards', 'USGS Natural Hazards', 'Earth & Extreme Phenomena', 'https://www.usgs.gov/news/rss', 'rss', true, 'Public domain US Geological Survey.', 'Plate tectonics, volcanic eruptions, and planetary geology.'),
  ('physorg_physics', 'Phys.org Physics News', 'Physics & Chemistry', 'https://phys.org/rss-feed/physics-news/', 'rss', true, 'Free public RSS feed.', 'Quantum optics, superconductivity, particle physics, and thermodynamics.'),
  ('quanta_physics', 'Quanta Magazine Physics', 'Physics & Chemistry', 'https://api.quantamagazine.org/feed', 'rss', true, 'Non-profit foundation science journalism.', 'Deep investigative science reporting on theoretical physics.'),
  ('nih_news_releases', 'NIH News Releases', 'Human Body & Brain', 'https://www.nih.gov/news-events/news-releases/rss', 'rss', true, 'Public domain National Institutes of Health.', 'Neuroscience, immunology, cellular genetics, and human physiology.'),
  ('sciencedaily_mind', 'ScienceDaily Mind & Brain', 'Human Body & Brain', 'https://www.sciencedaily.com/rss/mind_brain.xml', 'rss', true, 'Free public RSS feed.', 'Cognitive architecture, brain mapping, perception, and neurotransmitters.'),
  ('physorg_biology', 'Phys.org Biology & Nature', 'Plants/Fungi & Nature', 'https://phys.org/rss-feed/biology-news/', 'rss', true, 'Free public RSS feed.', 'Mycology, mycorrhizal networks, plant bio-signaling, and botany.'),
  ('eurekalert_biology', 'EurekAlert Biology News', 'Plants/Fungi & Nature', 'https://www.eurekalert.org/rss/biology.xml', 'rss', true, 'AAAS press release platform; open media distribution.', 'Botanical defense mechanisms, fungal symbiosis, and forest ecosystems.'),
  ('sciencedaily_fossils', 'ScienceDaily Fossils & Ruins', 'Ancient Life & Evolution', 'https://www.sciencedaily.com/rss/fossils_ruins.xml', 'rss', true, 'Free public RSS feed.', 'Paleontology, fossil discoveries, Cambrian explosion, and hominid evolution.'),
  ('sciencedaily_ai', 'ScienceDaily AI & Computing', 'Technology & AI', 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml', 'rss', true, 'Free public RSS feed.', 'Brain-computer interfaces, quantum computing, and bio-inspired robotics.'),
  ('physorg_nano', 'Phys.org Nanotechnology & Cells', 'Microscopic World', 'https://phys.org/rss-feed/nanotechnology-news/', 'rss', true, 'Free public RSS feed.', 'Molecular machinery, tardigrade cryptobiosis, diatoms, and phages.'),
  ('nature_news', 'Nature News', 'Scientists & Big Ideas', 'https://www.nature.com/nature.rss', 'rss', true, 'Free RSS headlines with standard attribution.', 'Milestone experimental breakthroughs, history of science, and Nobel laureates.')
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  url = EXCLUDED.url,
  terms = EXCLUDED.terms,
  description = EXCLUDED.description,
  updated_at = timezone('utc', now());
