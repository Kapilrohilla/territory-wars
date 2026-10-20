import { describe, it, expect } from 'vitest';
import { buildLeaderboard, cleanName, formatPct, formatTime, type BoardEntry } from '../src/ui/screens';

const e = (id: number, pct: number, isHuman = false): BoardEntry => ({ id, name: `P${id}`, colorIndex: id, pct, isHuman });

describe('buildLeaderboard', () => {
  it('orders by % desc and marks the leader', () => {
    const rows = buildLeaderboard([e(0, 1, true), e(1, 5), e(2, 3)]);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 0]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.leader)).toEqual([true, false, false]);
  });

  it('shows top 5 plus your row when you are outside it', () => {
    const entries = [e(0, 0.1, true), ...[1, 2, 3, 4, 5, 6, 7].map((i) => e(i, i))];
    const rows = buildLeaderboard(entries);
    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 5).map((r) => r.id)).toEqual([7, 6, 5, 4, 3]);
    expect(rows[5]).toMatchObject({ id: 0, isHuman: true, rank: 8, leader: false });
  });

  it('does not duplicate you when you are in the top 5', () => {
    const entries = [e(0, 50, true), ...[1, 2, 3, 4, 5, 6].map((i) => e(i, i))];
    const rows = buildLeaderboard(entries);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ id: 0, leader: true });
  });

  it('breaks ties by id', () => {
    expect(buildLeaderboard([e(3, 2), e(1, 2), e(2, 2)]).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe('formatting', () => {
  it('formats percentages with fixed decimals', () => {
    expect(formatPct(12.345, 2)).toBe('12.35%');
    expect(formatPct(3.04, 1)).toBe('3.0%');
    expect(formatPct(-0.001, 1)).toBe('0.0%');
  });
  it('formats time as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });
  it('cleans names', () => {
    expect(cleanName('   ')).toBe('You');
    expect(cleanName('  a   b ')).toBe('a b');
    expect(cleanName('abcdefghijklmnopq')).toBe('abcdefghijklmn');
  });
});
