import * as pc from 'polygon-clipping';
import {
  type MultiPoly, type Poly, type Ring, type Vec,
  polyArea, pointInPoly, distPointSeg, simplifyPolyline,
} from './geometry';

type Pair = [number, number];
type PCPoly = Pair[][];
type PCMulti = Pair[][][];

const TRAIL_WIDTH = 0.6;
const SIMPLIFY_TOL = 0.05;

const toPCPoly = (p: Poly): PCPoly => p.map((r) => r.map((v): Pair => [v.x, v.y]));
const toPCMulti = (m: MultiPoly): PCMulti => m.map(toPCPoly);

function fromPCMulti(m: PCMulti): MultiPoly {
  return m.map((poly) =>
    poly.map((ring) => {
      const out: Ring = ring.map(([x, y]) => ({ x, y }));
      const a = out[0], b = out[out.length - 1];
      if (out.length > 1 && a.x === b.x && a.y === b.y) out.pop();
      return out;
    }),
  );
}

export function landArea(m: MultiPoly): number {
  let s = 0;
  for (const p of m) s += polyArea(p);
  return s;
}

export function landContains(m: MultiPoly, p: Vec): boolean {
  for (const poly of m) if (pointInPoly(p, poly)) return true;
  return false;
}

/** Thick polyline as a union of one quad per segment plus a square at each vertex. */
export function thickTrail(trail: Vec[], width: number = TRAIL_WIDTH): MultiPoly {
  if (trail.length === 0) return [];
  const pts = simplifyPolyline(trail, SIMPLIFY_TOL);
  const h = width / 2;
  const pieces: PCPoly[] = [];
  for (const p of pts) {
    pieces.push([[[p.x - h, p.y - h], [p.x + h, p.y - h], [p.x + h, p.y + h], [p.x - h, p.y + h]]]);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = (-dy / len) * h, ny = (dx / len) * h;
    pieces.push([[
      [a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny],
    ]]);
  }
  try {
    const [first, ...rest] = pieces;
    return fromPCMulti(pc.union(first, ...rest) as PCMulti);
  } catch {
    return [];
  }
}

/** union(own, thickTrail), then every hole is filled. Never smaller than own. */
export function captureLand(own: MultiPoly, trail: Vec[]): MultiPoly {
  try {
    const thick = thickTrail(trail);
    if (thick.length === 0) return own;
    const merged = fromPCMulti(pc.union(toPCMulti(own), toPCMulti(thick)) as PCMulti);
    return merged.map((poly) => poly.slice(0, 1));
  } catch {
    return own;
  }
}

export function subtractLand(m: MultiPoly, cut: MultiPoly): MultiPoly {
  if (m.length === 0 || cut.length === 0) return m;
  try {
    return fromPCMulti(pc.difference(toPCMulti(m), toPCMulti(cut)) as PCMulti);
  } catch {
    return m;
  }
}

function distToOuter(poly: Poly, p: Vec): number {
  const r = poly[0];
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    best = Math.min(best, distPointSeg(p, r[j], r[i]));
  }
  return best;
}

/** The single polygon containing head, else the one nearest to it; [] if empty. */
export function keepPiece(m: MultiPoly, head: Vec): MultiPoly {
  if (m.length === 0) return [];
  for (const poly of m) if (pointInPoly(head, poly)) return [poly];
  let best = m[0], bd = Infinity;
  for (const poly of m) {
    const d = distToOuter(poly, head);
    if (d < bd) { bd = d; best = poly; }
  }
  return [best];
}
