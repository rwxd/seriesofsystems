import type { ComponentKind, Profile, Settings } from '@/sim/types';

const PROFILE_KEY = 'sos.profile.v1';

export const BASE_UNLOCKED: ComponentKind[] = ['dns', 'lb', 'vm', 'db'];

const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  sound: true,
  showHints: true,
};

export function defaultProfile(): Profile {
  return {
    version: 1,
    stars: {},
    completed: [],
    unlocked: [...BASE_UNLOCKED],
    settings: { ...DEFAULT_SETTINGS },
    sandboxBest: 0,
  };
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function uniqueKinds(kinds: ComponentKind[]): ComponentKind[] {
  return [...new Set(kinds)];
}

export function loadProfile(): Profile {
  const fallback = defaultProfile();
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
    return {
      version: 1,
      stars: { ...(parsed.stars ?? {}) },
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      unlocked: uniqueKinds([
        ...BASE_UNLOCKED,
        ...(Array.isArray(parsed.unlocked) ? (parsed.unlocked as ComponentKind[]) : []),
      ]),
      settings,
      sandboxBest: typeof parsed.sandboxBest === 'number' ? parsed.sandboxBest : 0,
    };
  } catch {
    return fallback;
  }
}

export function saveProfile(profile: Profile): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private modes; the game still works in-memory.
  }
}

export function clearProfile(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Ignore.
  }
}

export function unlockedSet(profile: Profile): Set<ComponentKind> {
  return new Set(profile.unlocked);
}
