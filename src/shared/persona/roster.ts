import rosterSeed from './roster.seed.json';
import type { VirtualUserProfile } from './types';

function cloneProfile(profile: VirtualUserProfile): VirtualUserProfile {
  return {
    ...profile,
    traits: profile.traits ? [...profile.traits] : undefined,
    extraSpeechTics: profile.extraSpeechTics ? [...profile.extraSpeechTics] : undefined,
    disallowedPhrases: profile.disallowedPhrases ? [...profile.disallowedPhrases] : undefined,
    styleGuidelines: profile.styleGuidelines ? [...profile.styleGuidelines] : undefined
  };
}

const RAW_ROSTERS = rosterSeed as Record<string, VirtualUserProfile[]>;

const ROSTERS: Record<string, VirtualUserProfile[]> = Object.fromEntries(
  Object.entries(RAW_ROSTERS).map(([variantId, profiles]) => [
    variantId,
    profiles.map((profile) => cloneProfile(profile))
  ])
);

const DEFAULT_VARIANT_ID = 'baseline-v3';

export function getVirtualUsersForVariant(variantId: string): VirtualUserProfile[] {
  const roster = ROSTERS[variantId] ?? ROSTERS[DEFAULT_VARIANT_ID] ?? [];
  return roster.map(cloneProfile);
}

export function listVirtualUsers(): VirtualUserProfile[] {
  return Object.values(ROSTERS).flat().map(cloneProfile);
}
