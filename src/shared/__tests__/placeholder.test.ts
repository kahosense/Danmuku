import { describe, expect, it } from 'vitest';
import { placeholder } from '../index';

describe('shared placeholder', () => {
  it('exports placeholder flag', () => {
    expect(placeholder).toBe(true);
  });
});
