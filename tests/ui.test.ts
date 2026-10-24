import { describe, it, expect } from 'vitest';
import {
  dangerSegments, heartbeatSeconds,
  buildLeaderboard, rankChanges, overtakeToastText, cleanName, countdownFraction, countdownSeconds, pausedRemaining, createPctTween, formatPct, formatTime,
  highestBest, hudAlerts, milestoneRibbonText, streakChipText, NAME_MAX, randomName, readChoice, readFlag, writeChoice, reviveSubtitle, territoryVerdict, writeFlag, type BoardEntry,
} from '../src/ui/screens';
import { isVibrationOn, setVibrationOn } from '../src/native/platform';
import { COLOR_NAMES, PALETTE } from '../src/game/palette';

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
  it('a hidden tab pauses the countdown with what was left, never below 0', () => {
    // deadline 7000, hidden at 4500: 2500 left; resumes later with the same 2500 left.
    expect(pausedRemaining(7000, 4500)).toBe(2500);
    expect(pausedRemaining(7000, 9000)).toBe(0);
  });
  it('words the subtitle by cause', () => {
    expect(reviveSubtitle('trail', 'Mango')).toEqual({ pre: 'Rival ', name: 'Mango', post: ' crossed your trail' });
    expect(reviveSubtitle('headon', 'Kiwi')).toEqual({ pre: 'Rival ', name: 'Kiwi', post: ' crashed into you' });
    expect(reviveSubtitle('captured', 'Kiwi')).toEqual({ pre: 'Rival ', name: 'Kiwi', post: ' crashed into you' });
    expect(reviveSubtitle('self', null)).toEqual({ pre: 'You crossed your own trail', name: '', post: '' });
    expect(reviveSubtitle('trail', null)).toEqual({ pre: 'Your trail burned out', name: '', post: '' });
    expect(reviveSubtitle('captured', null)).toEqual({ pre: 'Your land was taken', name: '', post: '' });
    expect(reviveSubtitle('self', 'Kiwi')).toEqual({ pre: 'You crossed your own trail', name: '', post: '' });
  });
});

describe('hudAlerts', () => {
  const p = (over: Partial<{ alive: boolean; burn: null | { s0: number; back: number; front: number; killerId: number; killerDeaths: number }; protectedUntil: number }>) =>
    ({ alive: true, burn: null, protectedUntil: 0, ...over });
  const burn = { s0: 1, back: 1, front: 1, killerId: 2, killerDeaths: 0 };
  it('is quiet by default', () => {
    expect(hudAlerts(p({}), 10)).toEqual({ burning: false, shielded: false });
  });
  it('flags a burning trail and an active shield', () => {
    expect(hudAlerts(p({ burn }), 10).burning).toBe(true);
    expect(hudAlerts(p({ protectedUntil: 12 }), 10).shielded).toBe(true);
    expect(hudAlerts(p({ protectedUntil: 12 }), 12).shielded).toBe(false);
  });
  it('shows nothing once the player is down', () => {
    expect(hudAlerts(p({ alive: false, burn, protectedUntil: 99 }), 10)).toEqual({ burning: false, shielded: false });
  });
});

describe('highestBest', () => {
  const b = (pct: number, kills = 0) => ({ pct, kills, time: 60 });
  it('needs at least two bests to name one', () => {
    expect(highestBest({})).toBeNull();
    expect(highestBest({ hard: b(5) })).toBeNull();
  });
  it('picks the top % and breaks ties on kills', () => {
    expect(highestBest({ easy: b(41.2), normal: b(18.2), hard: null })).toBe('easy');
    expect(highestBest({ easy: b(10, 1), hard: b(10, 3) })).toBe('hard');
  });
});

describe('readChoice / writeChoice', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  const MODES = ['die', 'pass'] as const;
  it('round-trips a known value and falls back when unset or unknown', () => {
    const s = mem();
    expect(readChoice('k', MODES, 'die', s)).toBe('die');
    writeChoice('k', 'pass', s);
    expect(readChoice('k', MODES, 'die', s)).toBe('pass');
    s.setItem('k', 'bogus');
    expect(readChoice('k', MODES, 'die', s)).toBe('die');
  });
  it('falls back when storage throws', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readChoice('k', MODES, 'die', broken)).toBe('die');
    expect(() => writeChoice('k', 'pass', broken)).not.toThrow();
  });
});

describe('readFlag / writeFlag', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };
  it('round-trips and falls back when unset', () => {
    const s = mem();
    expect(readFlag('k', true, s)).toBe(true);
    writeFlag('k', false, s);
    expect(readFlag('k', true, s)).toBe(false);
    writeFlag('k', true, s);
    expect(readFlag('k', false, s)).toBe(true);
  });
  it('falls back when storage throws or is missing', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readFlag('k', true, broken)).toBe(true);
    expect(() => writeFlag('k', true, broken)).not.toThrow();
    expect(readFlag('k', false, undefined)).toBe(false);
  });
});

describe('vibration setting', () => {
  it('is on by default and can be turned off', () => {
    expect(isVibrationOn()).toBe(true);
    setVibrationOn(false);
    expect(isVibrationOn()).toBe(false);
    setVibrationOn(true);
    expect(isVibrationOn()).toBe(true);
  });
});

describe('palette', () => {
  it('names every player colour', () => {
    expect(COLOR_NAMES).toHaveLength(PALETTE.players.length);
  });
});

describe('territoryVerdict', () => {
  it('words the result by territory, a win first', () => {
    expect(territoryVerdict(5, true)).toBe('Conquered the arena');
    expect(territoryVerdict(34.8, false)).toBe('Dominated the arena');
    expect(territoryVerdict(12, false)).toBe('Strong showing');
    expect(territoryVerdict(4, false)).toBe('Solid patch of land');
    expect(territoryVerdict(0.5, false)).toBe('Loop wider next time');
  });
});

describe('randomName', () => {
  it('picks a name that fits and differs from the current one', () => {
    const names = ['Kiwi', 'Mango', 'A really long name here'];
    expect(randomName('Kiwi', () => 0, names)).toBe('Mango');
    expect(randomName('Kiwi', () => 0.999, names)).toBe('Mango');
    expect(randomName('Mango', () => 0, names)).toBe('Kiwi');
  });
  it('keeps the current name when nothing else fits', () => {
    expect(randomName('Kiwi', () => 0.5, ['Kiwi'])).toBe('Kiwi');
  });
  it('only returns names within the field limit by default', () => {
    for (let i = 0; i < 20; i++) expect(randomName('You', () => i / 20).length).toBeLessThanOrEqual(NAME_MAX);
  });
});

describe('danger pill', () => {
  it('lights one meter segment per full third of danger', () => {
    expect(dangerSegments(0)).toBe(0);
    expect(dangerSegments(0.35)).toBe(1);
    expect(dangerSegments(2 / 3)).toBe(2);
    expect(dangerSegments(0.9)).toBe(2);
    expect(dangerSegments(1)).toBe(3);
  });
  it('beats faster with danger: 1.0 − 0.55·danger seconds', () => {
    expect(heartbeatSeconds(0)).toBeCloseTo(1);
    expect(heartbeatSeconds(1)).toBeCloseTo(0.45);
    expect(heartbeatSeconds(0.5)).toBeCloseTo(0.75);
    expect(heartbeatSeconds(0.9)).toBeLessThan(heartbeatSeconds(0.4));
  });
});

describe('milestoneRibbonText', () => {
  it('names each milestone tier', () => {
    expect(milestoneRibbonText(0)).toBe('10% CLAIMED!');
    expect(milestoneRibbonText(1)).toBe('25% CLAIMED!');
    expect(milestoneRibbonText(2)).toBe('HALF THE MAP!');
  });

  it('clamps an out-of-range tier', () => {
    expect(milestoneRibbonText(-1)).toBe('10% CLAIMED!');
    expect(milestoneRibbonText(7)).toBe('HALF THE MAP!');
  });
});

describe('streakChipText', () => {
  it('shows no chip for a lone knockout', () => {
    expect(streakChipText(1)).toBeNull();
    expect(streakChipText(0)).toBeNull();
  });

  it('counts the kills in the streak from the second one on', () => {
    expect(streakChipText(2)).toBe('×2 STREAK');
    expect(streakChipText(3)).toBe('×3 STREAK');
  });
});

describe('rankChanges', () => {
  const rows = (...ents: BoardEntry[]) => buildLeaderboard(ents, ents.length);
  const me = (pct: number) => e(0, pct, true);

  it('passing one rival', () => {
    const r = rankChanges(rows(me(4), e(1, 5), e(2, 3)), rows(me(6), e(1, 5), e(2, 3)));
    expect(r.overtaken.map((o) => o.name)).toEqual(['P1']);
    expect(r.humanDelta).toBe(1);
  });

  it('passing two rivals at once', () => {
    const r = rankChanges(rows(me(1), e(1, 5), e(2, 3), e(3, 0.5)), rows(me(9), e(1, 5), e(2, 3), e(3, 0.5)));
    expect(r.overtaken.map((o) => o.name).sort()).toEqual(['P1', 'P2']);
    expect(r.humanDelta).toBe(2);
  });

  it('counts a pass between two rows that are both off the shown top 5', () => {
    const others = [1, 2, 3, 4, 5, 6].map((i) => e(i, 10 + i));
    const r = rankChanges(rows(me(1), ...others, e(9, 2)), rows(me(3), ...others, e(9, 2)));
    expect(r.overtaken.map((o) => o.name)).toEqual(['P9']);
  });

  it('dropping reports a negative delta and no overtakes', () => {
    const r = rankChanges(rows(me(6), e(1, 5)), rows(me(4), e(1, 5)));
    expect(r.overtaken).toEqual([]);
    expect(r.humanDelta).toBe(-1);
  });

  it('no change', () => {
    const b = rows(me(4), e(1, 5), e(2, 3));
    expect(rankChanges(b, b)).toEqual({ overtaken: [], humanDelta: 0 });
  });

  it('a rival above you dying is not an overtake', () => {
    const r = rankChanges(rows(me(4), e(1, 5), e(2, 3)), rows(me(4), e(2, 3)));
    expect(r.overtaken).toEqual([]);
    expect(r.humanDelta).toBe(0);
  });

  it('a rival respawning below you is not an overtake', () => {
    const r = rankChanges(rows(me(4), e(2, 3)), rows(me(4), e(2, 3), e(1, 0.1)));
    expect(r.overtaken).toEqual([]);
    expect(r.humanDelta).toBe(0);
  });

  it('matches by id, not name', () => {
    const renamed = { ...e(1, 5), name: 'Newbie' };
    const r = rankChanges(rows(me(4), e(1, 5)), rows(me(6), renamed));
    expect(r.overtaken).toEqual([{ id: 1, name: 'Newbie', colorIndex: 1 }]);
  });

  it('the first refresh of a round (no previous board) reports nothing', () => {
    expect(rankChanges([], rows(me(4), e(1, 5)))).toEqual({ overtaken: [], humanDelta: 0 });
  });
});

describe('overtakeToastText', () => {
  it('names one rival, counts several', () => {
    expect(overtakeToastText([{ name: 'Mango' }])).toBe('You passed Mango!');
    expect(overtakeToastText([{ name: 'A' }, { name: 'B' }])).toBe('You passed 2 rivals!');
  });
});
