export type Vec = { x: number; y: number };
export type Ring = Vec[];
export type Poly = Ring[];
export type MultiPoly = Poly[];

const TAU = Math.PI * 2;

/** a - b wrapped into (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

export function ringArea(r: Ring): number {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polyArea(p: Poly): number {
  if (p.length === 0) return 0;
  let a = ringArea(p[0]);
  for (let i = 1; i < p.length; i++) a -= ringArea(p[i]);
  return a;
}

export function pointInRing(p: Vec, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPoly(p: Vec, poly: Poly): boolean {
  if (poly.length === 0 || !pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}

function orient(a: Vec, b: Vec, c: Vec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSeg(a: Vec, b: Vec, p: Vec): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

export function segIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (o1 === 0 && onSeg(a, b, c)) return true;
  if (o2 === 0 && onSeg(a, b, d)) return true;
  if (o3 === 0 && onSeg(c, d, a)) return true;
  if (o4 === 0 && onSeg(c, d, b)) return true;
  return false;
}

export function distPointSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function circleRing(c: Vec, r: number, n: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

export function clampToCircle(p: Vec, r: number): Vec {
  const d = Math.hypot(p.x, p.y);
  if (d <= r) return { x: p.x, y: p.y };
  const k = r / d;
  return { x: p.x * k, y: p.y * k };
}

/** Ramer-Douglas-Peucker; always keeps the endpoints. */
export function simplifyPolyline(pts: Vec[], tol: number): Vec[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distPointSeg(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
