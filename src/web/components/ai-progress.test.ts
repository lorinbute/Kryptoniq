// FD-AISLOW §4: the line that says how far the user's AI got with the last 48 hours.
import { describe, expect, it } from 'vitest';
import { progressText } from './ai-progress.ts';

const MIN = 60_000;

describe('progress, said (FD-AISLOW §4)', () => {
  const now = Date.parse('2026-10-20T19:20:00Z');
  it('how many of the last 48 hours’ news, and the last score', () => {
    expect(progressText('Gemini', { total: 3508, scored: 1869, lastAt: now - 2 * MIN }, now)).toBe('Ultimele 48 h: Gemini a scorat 1.869 din 3.508 titluri; ultimul scor acum 2 min.');
    expect(progressText('Gemini', { total: 120, scored: 120, lastAt: now - 30_000 }, now)).toBe('Ultimele 48 h: Gemini a scorat toate cele 120 de titluri; ultimul scor acum.');
    expect(progressText('Claude', { total: 25, scored: 0, lastAt: null }, now)).toBe('Ultimele 48 h: Claude a scorat 0 din 25 de titluri.');
    expect(progressText('Claude', { total: 1, scored: 0, lastAt: null }, now)).toBe('Ultimele 48 h: Claude nu a scorat încă singurul titlu.');
    expect(progressText('Claude', { total: 1, scored: 1, lastAt: now - 3 * 3_600_000 }, now)).toBe('Ultimele 48 h: Claude a scorat singurul titlu; ultimul scor acum 3 h.');
    expect(progressText('ChatGPT', { total: 2, scored: 1, lastAt: now + 5_000 }, now)).toBe('Ultimele 48 h: ChatGPT a scorat 1 din 2 titluri; ultimul scor acum.');
  });
});
