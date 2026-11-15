import { LEVELS } from '@/content/levels';
import { isLevelUnlocked as storeIsLevelUnlocked, levelStars } from '@/game/store';
import type { ComponentKind, Profile, Scenario } from '@/sim/types';

/**
 * Campaign metadata. The content lane owns the level definitions; the UI only
 * sorts them and derives act grouping / lock state.
 */
export const CAMPAIGN_LEVELS: Scenario[] = Array.isArray(LEVELS)
  ? [...LEVELS].sort((a, b) => a.act - b.act || a.order - b.order)
  : [];

export interface ActMeta {
  act: number;
  title: string;
  blurb: string;
}

const ACTS: Record<number, Omit<ActMeta, 'act'>> = {
  1: {
    title: 'Hold the Line',
    blurb: 'Keep one site up and learn what a failure domain actually is.',
  },
  2: {
    title: 'Cattle Country',
    blurb: 'Pods, caches, and the first deploy that goes sideways.',
  },
  3: {
    title: 'Someone Else’s Computer',
    blurb: 'Regions, retries, and the bill for both.',
  },
};

export function actMeta(act: number): ActMeta {
  const fallbackTitle = act > 0 ? `Act ${act}` : 'Extra Credit';
  const known = ACTS[act];
  return {
    act,
    title: known?.title ?? fallbackTitle,
    blurb: known?.blurb ?? 'More systems, more ways to be paged.',
  };
}

export function groupByAct(levels: Scenario[]): Array<{ meta: ActMeta; levels: Scenario[] }> {
  const acts = new Map<number, Scenario[]>();
  for (const level of levels) {
    const bucket = acts.get(level.act) ?? [];
    bucket.push(level);
    acts.set(level.act, bucket);
  }
  return [...acts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([act, bucket]) => ({ meta: actMeta(act), levels: bucket }));
}

export function levelIndex(levelId: string): number {
  return CAMPAIGN_LEVELS.findIndex((level) => level.id === levelId);
}

/** Delegates to the store so a card can never look unlocked when the run isn't. */
export function isLevelUnlocked(levelId: string, profile: Profile): boolean {
  return storeIsLevelUnlocked(profile, levelId);
}

export function starsFor(profile: Profile, levelId: string): number {
  return levelStars(profile, levelId);
}

export function previousLevelTitle(levelId: string): string | null {
  const index = levelIndex(levelId);
  if (index <= 0) return null;
  return CAMPAIGN_LEVELS[index - 1]?.title ?? null;
}

export function nextCampaignLevel(currentId: string | undefined): Scenario | null {
  if (!currentId || CAMPAIGN_LEVELS.length === 0) return CAMPAIGN_LEVELS[0] ?? null;
  const index = levelIndex(currentId);
  if (index < 0) return CAMPAIGN_LEVELS[0] ?? null;
  return CAMPAIGN_LEVELS[index + 1] ?? null;
}

/** "Unlocks after “Two Is One”" — falls back to a generic hint. */
export function unlockHintFor(kind: ComponentKind): string {
  const unlocker = CAMPAIGN_LEVELS.find((level) => level.unlockOnComplete?.includes(kind));
  if (!unlocker) return 'Unlocks later in the campaign';
  return `Unlocks after “${unlocker.title}”`;
}

export const DIFFICULTIES: Array<{
  id: 'relaxed' | 'normal' | 'chaos';
  name: string;
  blurb: string;
  detail: string;
}> = [
  {
    id: 'relaxed',
    name: 'Relaxed',
    blurb: 'Slow traffic, gentler incidents, longer timers.',
    detail: 'Good for a first shift. You will still get paged, just not constantly.',
  },
  {
    id: 'normal',
    name: 'Normal',
    blurb: 'The intended experience. Traffic grows, things break.',
    detail: 'Random incidents every 60–120 seconds with a rising request curve.',
  },
  {
    id: 'chaos',
    name: 'Chaos',
    blurb: 'Harsher incidents, spikier traffic, less mercy.',
    detail: 'For people who think a pager is a personality. No score to protect.',
  },
];

export function sandboxBest(profile: Profile): number {
  return profile.sandboxBest ?? 0;
}

export function totalStars(profile: Profile): number {
  return Object.values(profile.stars ?? {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function levelBudgetLabel(level: Scenario): string {
  return `$${Math.round(level.startingBudgetPerMonth).toLocaleString('en-US')}/mo budget`;
}
