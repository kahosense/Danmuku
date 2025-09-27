import { describe, expect, it } from 'vitest';

import { formatGuidelineList, formatSubtitleWindow } from '../messages';
import type { SubtitleCue } from '../types';

describe('shared message utilities', () => {
  it('numberizes guideline lines and skips empties', () => {
    const guidelines = formatGuidelineList([' Keep it short ', '', 'Avoid spoilers']);
    expect(guidelines).toBe('1. Keep it short\n2. Avoid spoilers');
  });

  it('renders subtitle cues with timestamps', () => {
    const cues: SubtitleCue[] = [
      {
        contentId: 'c1',
        cueId: 'cue-1',
        text: 'First line',
        startTime: 1_500,
        endTime: 2_000,
        duration: 1_000,
        source: 'netflix-api'
      },
      {
        contentId: 'c1',
        cueId: 'cue-2',
        text: 'Second line',
        startTime: 8,
        endTime: 12,
        duration: 4,
        source: 'dom-fallback'
      }
    ];

    expect(formatSubtitleWindow(cues)).toBe('[00:01] First line\n[00:08] Second line');
  });
});
