import { describe, it, expect } from 'vitest';
import { countWords, readingTime } from './textstats.ts';

describe('textstats', () => {
  it('counts words, not markdown syntax', () => {
    expect(countWords('# Title\n\n- **bold** item')).toBe(3);
  });
  it('reading time rounds at ~230 wpm, at least 1 minute for any text', () => {
    expect(readingTime(0)).toBe(0);
    expect(readingTime(5)).toBe(1);
    expect(readingTime(346)).toBe(2);
    expect(readingTime(2300)).toBe(10);
  });
});
