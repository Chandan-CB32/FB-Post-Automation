export interface SeriesData {
  id: string;
  page_id: string;
  name: string;
  premise: string;
  visual_bible?: string;
  total_episodes: number;
  current_episode_number: number;
  status: 'active' | 'completed' | 'paused';
}

export interface SeriesEpisodeData {
  id?: string;
  series_id: string;
  episode_number: number;
  title: string;
  summary: string;
  characters_introduced?: string[];
  cliffhanger?: string;
}

export interface SeriesPromptContext {
  series_name: string;
  series_premise: string;
  episode_number: number;
  total_episodes: number;
  story_so_far: string;
  series_bible: string;
  previous_cliffhanger: string;
  is_finale: boolean;
}

/**
 * Builds a running narrative summary of all past episodes to maintain continuity in multi-part series.
 */
export function formatSeriesStorySoFar(episodes: SeriesEpisodeData[]): string {
  if (!episodes || episodes.length === 0) {
    return 'This is the premiere episode of the series.';
  }

  const sorted = [...episodes].sort((a, b) => a.episode_number - b.episode_number);

  return sorted
    .map((ep) => {
      let entry = `[Episode ${ep.episode_number}: "${ep.title}"] ${ep.summary.trim()}`;
      if (ep.cliffhanger) {
        entry += ` (Ending cliffhanger: ${ep.cliffhanger.trim()})`;
      }
      return entry;
    })
    .join('\n\n');
}

/**
 * Constructs prompt variables and story context for generating the next episode.
 */
export function buildSeriesPromptContext(
  series: SeriesData,
  previousEpisodes: SeriesEpisodeData[]
): SeriesPromptContext {
  const nextEpNum = series.current_episode_number + 1;
  const isFinale = nextEpNum >= series.total_episodes;

  const sorted = [...previousEpisodes].sort((a, b) => a.episode_number - b.episode_number);
  const lastEp = sorted[sorted.length - 1];

  return {
    series_name: series.name,
    series_premise: series.premise,
    episode_number: nextEpNum,
    total_episodes: series.total_episodes,
    story_so_far: formatSeriesStorySoFar(previousEpisodes),
    series_bible: series.visual_bible || 'Consistent cinematic visual style matching the series universe.',
    previous_cliffhanger: lastEp?.cliffhanger || 'None. Begin directly from the premise.',
    is_finale: isFinale,
  };
}

/**
 * Updates series state after a new episode is produced.
 */
export function updateSeriesMemory(
  series: SeriesData,
  newEpisode: { episode_number: number; title: string; summary: string; cliffhanger?: string }
): { nextEpisodeNumber: number; isCompleted: boolean } {
  const nextEpNum = newEpisode.episode_number;
  const isCompleted = nextEpNum >= series.total_episodes;

  return {
    nextEpisodeNumber: nextEpNum,
    isCompleted,
  };
}

