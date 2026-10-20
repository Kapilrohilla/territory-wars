import { describe, it, expect } from 'vitest';
import {
  buildLeaderboard, cleanName, countdownFraction, countdownSeconds, createPctTween, formatPct, formatTime,
  reviveSubtitle, type BoardEntry,
} from '../src/ui/screens';

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

describe('pct tween', () => {
  it('counts up towards a new value with ease-out over ~300 ms', () => {
    const t = createPctTween(300);
    t.snap(1);
    expect(t.value(0)).toBe(1);
    t.set(5, 1000);
    expect(t.active(1000)).toBe(true);
    expect(t.value(1000)).toBeCloseTo(1, 9);
    const mid = t.value(1150);
    expect(mid).toBeGreaterThan(3); // ease-out: past the halfway value at half time
    expect(mid).toBeLessThan(5);
    expect(t.value(1100)).toBeLessThan(mid); // monotonic
    expect(t.value(1300)).toBe(5);
    expect(t.active(1300)).toBe(false);
    expect(t.value(5000)).toBe(5);
  });

  it('retargets smoothly from the current displayed value', () => {
    const t = createPctTween(300);
    t.snap(0);
    t.set(10, 0);
    const shown = t.value(100);
    t.set(20, 100);
    expect(t.value(100)).toBeCloseTo(shown, 9);
    expect(t.value(400)).toBe(20);
  });

  it('setting the same target does not restart the tween', () => {
    const t = createPctTween(300);
    t.snap(0);
    t.set(10, 0);
    t.set(10, 250);
    expect(t.value(300)).toBe(10);
  });
});

describe('revive modal helpers', () => {
  it('shows whole seconds remaining, rounded up, never below 0', () => {
    expect(countdownSeconds(5000)).toBe(5);
    expect(countdownSeconds(4999)).toBe(5);
    expect(countdownSeconds(4001)).toBe(5);
    expect(countdownSeconds(4000)).toBe(4);
    expect(countdownSeconds(1)).toBe(1);
    expect(countdownSeconds(0)).toBe(0);
    expect(countdownSeconds(-20)).toBe(0);
  });
  it('gives the ring fraction left, clamped to [0, 1]', () => {
    expect(countdownFraction(5000, 5000)).toBe(1);
    expect(countdownFraction(2500, 5000)).toBe(0.5);
    expect(countdownFraction(-1, 5000)).toBe(0);
    expect(countdownFraction(6000, 5000)).toBe(1);
  });
  it('words the subtitle by cause', () => {
    expect(reviveSubtitle('trail', 'Mango')).toEqual({ pre: 'Rival ', name: 'Mango', post: ' crossed your trail' });
    expect(reviveSubtitle('headon', 'Kiwi')).toEqual({ pre: 'Rival ', name: 'Kiwi', post: ' crashed into you' });
    expect(reviveSubtitle('captured', 'Kiwi')).toEqual({ pre: 'Rival ', name: 'Kiwi', post: ' crashed into you' });
    expect(reviveSubtitle('self', null)).toEqual({ pre: 'You crossed your own trail', name: '', post: '' });
    expect(reviveSubtitle('trail', null)).toEqual({ pre: 'You crossed your own trail', name: '', post: '' });
  });
});
