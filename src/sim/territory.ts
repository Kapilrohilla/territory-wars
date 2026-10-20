import * as pc from 'polygon-clipping';
import {
  type MultiPoly, type Poly, type Ring, type Vec,
  polyArea, pointInPoly, distPointSeg, simplifyPolyline,
} from './geometry';

type Pair = [number, number];
type PCPoly = Pair[][];
type PCMulti = Pair[][][];

const TRAIL_WIDTH = 0.6;
const SIMPLIFY_TOL = 0.15;

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

/** Trail points after simplification, with exact/near duplicates removed. */
function trailPoints(trail: Vec[]): Vec[] {
  const pts: Vec[] = [];
  for (const p of simplifyPolyline(trail, SIMPLIFY_TOL)) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) pts.push(p);
  }
  return pts;
}

/**
 * The thick trail as ONE ring: left offsets forward, right offsets back, square end caps.
 * At each joint the inner side is routed through the joint vertex itself and the outer side
 * is bevelled. As a chain this ring equals the sum of the per-segment quads plus the bevel
 * triangles, all with the same orientation, so under polygon-clipping's non-zero rule it
 * covers exactly their union — but as a single input with few crossings, which is far
 * cheaper to union than hundreds of overlapping pieces.
 */
function bandRing(trail: Vec[], width: number): PCPoly | null {
  const pts = trailPoints(trail);
  if (pts.length === 0) return null;
  const h = width / 2;
  if (pts.length === 1) {
    const p = pts[0];
    return [[[p.x - h, p.y - h], [p.x + h, p.y - h], [p.x + h, p.y + h], [p.x - h, p.y + h]]];
  }
  const left: Pair[] = [];
  const right: Pair[] = [];
  const last = pts.length - 2;
  let pux = 0, puy = 0;
  for (let i = 0; i <= last; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const nx = -uy * h, ny = ux * h;
    if (i > 0) {
      // Joint at a: the inner side goes through the vertex itself; the outer side is a
      // bevel, or for turns sharper than 90° a square join (each quad extended by h).
      const turn = pux * uy - puy * ux;
      const sharp = pux * ux + puy * uy < 0;
      if (turn !== 0 || sharp) {
        const inner = turn >= 0 ? left : right;
        const outer = turn >= 0 ? right : left;
        const s = turn >= 0 ? -1 : 1; // outer side normal sign
        inner.push([a.x, a.y]);
        if (sharp) {
          outer.push(
            [a.x + s * -puy * h + pux * h, a.y + s * pux * h + puy * h],
            [a.x + s * nx - ux * h, a.y + s * ny - uy * h],
          );
        }
      }
    }
    // Square caps: extend the first and last segments by h.
    const ax = i === 0 ? a.x - ux * h : a.x, ay = i === 0 ? a.y - uy * h : a.y;
    const bx = i === last ? b.x + ux * h : b.x, by = i === last ? b.y + uy * h : b.y;
    left.push([ax + nx, ay + ny], [bx + nx, by + ny]);
    right.push([ax - nx, ay - ny], [bx - nx, by - ny]);
    pux = ux; puy = uy;
  }
  right.reverse();
  return [left.concat(right)];
}

/** Thick polyline (width `width`) as a clean MultiPoly. */
export function thickTrail(trail: Vec[], width: number = TRAIL_WIDTH): MultiPoly {
  const ring = bandRing(trail, width);
  if (!ring) return [];
  try {
    return fromPCMulti(pc.union(ring) as PCMulti);
  } catch {
    return [];
  }
}

/** Drops every hole: each polygon keeps only its outer ring. */
const fillHoles = (m: PCMulti): PCMulti => m.map((poly) => poly.slice(0, 1));

/**
 * union(own, thickTrail), then every hole is filled. Never smaller than own (unless `clip`
 * is given: the result is then intersected with it, e.g. the arena).
 */
export function captureLand(own: MultiPoly, trail: Vec[], clip?: MultiPoly): MultiPoly {
  try {
    const band = bandRing(trail, TRAIL_WIDTH);
    if (!band) return own;
    let merged = fillHoles(pc.union(toPCMulti(own), band) as PCMulti);
    // A filled hole may now cover an own island: merge the overlap so area isn't double counted.
    if (merged.length > 1) merged = fillHoles(pc.union(merged) as PCMulti);
    if (clip && clip.length > 0) merged = pc.intersection(merged, toPCMulti(clip)) as PCMulti;
    return fromPCMulti(merged);
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
