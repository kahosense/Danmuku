import { describe, expect, it } from 'vitest';

import { getVirtualUsersForVariant, listVirtualUsers } from '../roster';

const DEFAULT_VARIANT = 'baseline-v3';

describe('persona roster', () => {
  it('returns the baseline roster for the default variant', () => {
    const roster = getVirtualUsersForVariant(DEFAULT_VARIANT);

    expect(roster).toHaveLength(12);
    const ids = roster.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the default roster when the variant is unknown', () => {
    const fallback = getVirtualUsersForVariant('unknown-variant');
    const baseline = getVirtualUsersForVariant(DEFAULT_VARIANT);

    expect(fallback).toEqual(baseline);
  });

  it('returns deep clones so callers cannot mutate shared state', () => {
    const first = getVirtualUsersForVariant(DEFAULT_VARIANT);
    const originalTraitsLength = first[0]?.traits?.length ?? 0;

    first[0]?.traits?.push('should-not-persist');
    first[0].label = 'Mutated Label';

    const second = getVirtualUsersForVariant(DEFAULT_VARIANT);
    expect(second[0].label).not.toBe('Mutated Label');
    expect(second[0]?.traits?.length ?? 0).toBe(originalTraitsLength);
  });

  it('listVirtualUsers provides clones across the merged pool', () => {
    const listA = listVirtualUsers();
    const listB = listVirtualUsers();

    expect(listA).toHaveLength(listB.length);
    listA[0].label = 'temp';
    expect(listB[0].label).not.toBe('temp');
  });
});
