// Smart measure tool: detects points, edges (line, circle, arc) and faces
// (plane, cylinder) under the cursor, and measures between two picks.
import * as THREE from './three.module.min.js';
import { LineSegments2 } from './LineSegments2.js';
import { LineSegmentsGeometry } from './LineSegmentsGeometry.js';
import { LineMaterial } from './LineMaterial.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = 180 / Math.PI;
const PARALLEL_DEG = 0.1;

// ---------- Small linear algebra ----------
function eigenSym3(m) {
  // Jacobi eigen decomposition of a symmetric 3x3 matrix (row-major array of 9).
  const a = m.slice();
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-24) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq; a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk; a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq; v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const vals = [a[0], a[4], a[8]];
  const vecs = [0, 1, 2].map(i => V(v[i], v[3 + i], v[6 + i]).normalize());
  const order = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
  return { values: order.map(i => vals[i]), vectors: order.map(i => vecs[i]) };
}

function solve3(A, b) {
  // Gaussian elimination with partial pivoting; A is 3x3 row-major.
  const M = [[A[0], A[1], A[2], b[0]], [A[3], A[4], A[5], b[1]], [A[6], A[7], A[8], b[2]]];
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

function basisFor(n) {
  const u = Math.abs(n.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const w = V().crossVectors(n, u);
  return [u, w];
}

function fitCircle(points, n, c0) {
  // Algebraic (Kasa) circle fit of 3D points projected onto the plane (c0, n).
  const [u, w] = basisFor(n);
  const xy = points.map(p => { const d = p.clone().sub(c0); return [d.dot(u), d.dot(w)]; });
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, Sz = 0, Sxz = 0, Syz = 0;
  for (const [x, y] of xy) {
    const z = x * x + y * y;
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; Sz += z; Sxz += x * z; Syz += y * z;
  }
  const N = xy.length;
  const sol = solve3([Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, N], [-Sxz, -Syz, -Sz]);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxErr = 0;
  for (const [x, y] of xy) maxErr = Math.max(maxErr, Math.abs(Math.hypot(x - cx, y - cy) - r));
  const center = c0.clone().addScaledVector(u, cx).addScaledVector(w, cy);
  const angles = xy.map(([x, y]) => Math.atan2(y - cy, x - cx));
  return { center, r, maxErr, angles };
}

function centroidOf(points) {
  const c = V();
  for (const p of points) c.add(p);
  return c.divideScalar(Math.max(points.length, 1));
}

function covariance(points, c) {
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    m[0] += x * x; m[1] += x * y; m[2] += x * z; m[4] += y * y; m[5] += y * z; m[8] += z * z;
  }
  m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
  return m;
}

// ---------- Topology per part ----------
function buildTopology(part, diag) {
  const geo = part.mesh.geometry;
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  const nTri = idx.length / 3, nV = pos.length / 3;
  const tol = diag * 1e-4 + 1e-4;

  // 1. Weld coincident vertices (B-rep faces are meshed separately).
  const q = Math.max(diag * 1e-6, 1e-7);
  const weld = new Int32Array(nV);
  const keyMap = new Map();
  const wp = [];
  for (let i = 0; i < nV; i++) {
    const k = Math.round(pos[3 * i] / q) + ',' + Math.round(pos[3 * i + 1] / q) + ',' + Math.round(pos[3 * i + 2] / q);
    let id = keyMap.get(k);
    if (id === undefined) { id = wp.length / 3; keyMap.set(k, id); wp.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); }
    weld[i] = id;
  }
  const W = wp.length / 3;
  const P = (id) => V(wp[3 * id], wp[3 * id + 1], wp[3 * id + 2]);

  // 2. Triangle normals and areas.
  const tn = new Float32Array(nTri * 3), ta = new Float32Array(nTri);
  const a = V(), b = V(), c = V(), e1 = V(), e2 = V(), cr = V();
  for (let t = 0; t < nTri; t++) {
    a.fromArray(pos, 3 * idx[3 * t]); b.fromArray(pos, 3 * idx[3 * t + 1]); c.fromArray(pos, 3 * idx[3 * t + 2]);
    cr.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const l = cr.length();
    ta[t] = l / 2;
    if (l > 0) cr.divideScalar(l);
    tn[3 * t] = cr.x; tn[3 * t + 1] = cr.y; tn[3 * t + 2] = cr.z;
  }

  // 3. Edge adjacency on welded vertices.
  const edgeTris = new Map();
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const va = weld[idx[3 * t + k]], vb = weld[idx[3 * t + (k + 1) % 3]];
      if (va === vb) continue;
      const key = va < vb ? va * W + vb : vb * W + va;
      const list = edgeTris.get(key);
      if (list) list.push(t); else edgeTris.set(key, [t]);
    }
  }

  // 4. Face id per triangle: B-rep faces when known, else region growing.
  const faceOf = new Int32Array(nTri).fill(-1);
  let nFaces = 0;
  if (part.faceRanges && part.faceRanges.length) {
    for (const f of part.faceRanges) {
      for (let t = f.first; t <= f.last && t < nTri; t++) faceOf[t] = nFaces;
      nFaces++;
    }
    for (let t = 0; t < nTri; t++) if (faceOf[t] < 0) faceOf[t] = nFaces++;
  } else {
    const nbr = Array.from({ length: nTri }, () => []);
    for (const list of edgeTris.values()) {
      if (list.length === 2) { nbr[list[0]].push(list[1]); nbr[list[1]].push(list[0]); }
    }
    const cosLim = Math.cos(20 / DEG);
    for (let s = 0; s < nTri; s++) {
      if (faceOf[s] >= 0) continue;
      const id = nFaces++;
      faceOf[s] = id;
      const stack = [s];
      while (stack.length) {
        const t = stack.pop();
        for (const u of nbr[t]) {
          if (faceOf[u] >= 0) continue;
          const d = tn[3 * t] * tn[3 * u] + tn[3 * t + 1] * tn[3 * u + 1] + tn[3 * t + 2] * tn[3 * u + 2];
          if (d >= cosLim) { faceOf[u] = id; stack.push(u); }
        }
      }
    }
  }

  // 5. Classify faces.
  const faceTris = Array.from({ length: nFaces }, () => []);
  for (let t = 0; t < nTri; t++) faceTris[faceOf[t]].push(t);
  let faces = faceTris.map((tris, fid) => classifyFace(part, fid, tris, idx, weld, P, tn, ta, tol));

  // 5b. Merge neighbour faces on the same cylinder or plane (B-rep splits a
  //     full cylinder into two halves, so a hole edge would read as two arcs).
  const parent = faces.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  let merged = false;
  for (const list of edgeTris.values()) {
    if (list.length !== 2) continue;
    const fa = faceOf[list[0]], fb = faceOf[list[1]];
    if (fa === fb || !sameSurface(faces[fa], faces[fb], tol)) continue;
    const ra = find(fa), rb = find(fb);
    if (ra !== rb) { parent[ra] = rb; merged = true; }
  }
  if (merged) {
    const newId = new Map();
    for (let f = 0; f < faces.length; f++) { const r = find(f); if (!newId.has(r)) newId.set(r, newId.size); }
    for (let t = 0; t < nTri; t++) faceOf[t] = newId.get(find(faceOf[t]));
    const ft = Array.from({ length: newId.size }, () => []);
    for (let t = 0; t < nTri; t++) ft[faceOf[t]].push(t);
    faces = ft.map((tris, fid) => classifyFace(part, fid, tris, idx, weld, P, tn, ta, tol));
  }

  // 6. Boundary edges between faces, chained into curves.
  const groups = new Map();
  for (const [key, list] of edgeTris) {
    const fa = faceOf[list[0]], fb = list.length > 1 ? faceOf[list[1]] : -1;
    if (list.length === 2 && fa === fb) continue;
    const va = Math.floor(key / W), vb = key % W;
    const gk = Math.min(fa, fb) + ':' + Math.max(fa, fb);
    let g = groups.get(gk);
    if (!g) { g = []; groups.set(gk, g); }
    g.push([va, vb]);
  }
  const edges = [];
  const vertexIds = new Map();
  for (const segs of groups.values()) {
    for (const chain of chainSegments(segs)) {
      const ent = classifyEdge(part, chain.ids.map(P), chain.closed, tol);
      if (!ent) continue;
      edges.push(ent);
      if (!chain.closed) {
        for (const id of [chain.ids[0], chain.ids[chain.ids.length - 1]]) vertexIds.set(id, (vertexIds.get(id) || 0) + 1);
      }
    }
  }
  const vertices = [...vertexIds.keys()].map(id => ({ kind: 'point', part, p: P(id), label: 'Vertex' }));
  const mids = [];
  for (const e of edges) {
    if (e.kind === 'line') mids.push({ kind: 'point', part, p: e.p0.clone().add(e.p1).multiplyScalar(0.5), label: 'Midpoint', of: e });
    else if (e.kind === 'arc' || e.kind === 'curve') mids.push({ kind: 'point', part, p: pointAtHalfLength(e), label: 'Midpoint', of: e });
  }
  return { faceOf, faces, edges, vertices, mids };
}

function pointAtHalfLength(e) {
  const half = e.length / 2;
  let acc = 0;
  for (let i = 1; i < e.pts.length; i++) {
    const L = e.pts[i].distanceTo(e.pts[i - 1]);
    if (acc + L >= half) return e.pts[i - 1].clone().lerp(e.pts[i], (half - acc) / L);
    acc += L;
  }
  return e.pts[e.pts.length - 1].clone();
}

function sameSurface(A, B, tol) {
  const cosT = Math.cos(0.1 / DEG);
  if (A.kind === 'cylinder' && B.kind === 'cylinder') {
    if (Math.abs(A.r - B.r) > tol * 3 || Math.abs(A.axis.dot(B.axis)) < cosT) return false;
    const w = A.center.clone().sub(B.center);
    return w.sub(B.axis.clone().multiplyScalar(w.dot(B.axis))).length() < tol * 3;
  }
  if (A.kind === 'plane' && B.kind === 'plane') {
    return A.normal.dot(B.normal) > cosT && Math.abs(A.point.clone().sub(B.point).dot(B.normal)) < tol * 3;
  }
  return false;
}

function chainSegments(segs) {
  const adj = new Map();
  segs.forEach(([a, b], i) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i); adj.get(b).push(i);
  });
  const used = new Uint8Array(segs.length);
  const chains = [];
  const walk = (start, segIdx, out) => {
    let v = start, s = segIdx;
    while (true) {
      used[s] = 1;
      const [a, b] = segs[s];
      v = a === v ? b : a;
      out.push(v);
      const next = (adj.get(v) || []).filter(i => !used[i]);
      if ((adj.get(v) || []).length !== 2 || next.length === 0) return v;
      s = next[0];
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const [a, b] = segs[i];
    const fwd = [a];
    const endF = walk(a, i, fwd);
    let ids = fwd;
    let closed = endF === a;
    if (!closed && (adj.get(a) || []).length === 2) {
      const back = [];
      const rest = (adj.get(a) || []).filter(k => !used[k]);
      if (rest.length) { walk(a, rest[0], back); ids = back.reverse().concat(fwd); }
      closed = ids[0] === ids[ids.length - 1];
    }
    chains.push({ ids, closed });
  }
  return chains;
}

function classifyFace(part, fid, tris, idx, weld, P, tn, ta, tol) {
  let area = 0;
  const nAvg = V();
  const vset = new Set();
  const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const t of tris) {
    const A = ta[t], nx = tn[3 * t], ny = tn[3 * t + 1], nz = tn[3 * t + 2];
    area += A;
    nAvg.x += A * nx; nAvg.y += A * ny; nAvg.z += A * nz;
    m[0] += A * nx * nx; m[1] += A * nx * ny; m[2] += A * nx * nz; m[4] += A * ny * ny; m[5] += A * ny * nz; m[8] += A * nz * nz;
    for (let k = 0; k < 3; k++) vset.add(weld[idx[3 * t + k]]);
  }
  m[3] = m[1]; m[6] = m[2]; m[7] = m[5];
  const pts = [...vset].map(P);
  const base = { part, fid, tris, area };
  if (area <= 0) return { ...base, kind: 'surface' };
  const n = nAvg.clone().normalize();
  let minDot = 1;
  for (const t of tris) if (ta[t] > 0) minDot = Math.min(minDot, n.x * tn[3 * t] + n.y * tn[3 * t + 1] + n.z * tn[3 * t + 2]);
  const c = centroidOf(pts);
  if (minDot > Math.cos(0.5 / DEG)) {
    let maxOff = 0;
    for (const p of pts) maxOff = Math.max(maxOff, Math.abs(p.clone().sub(c).dot(n)));
    if (maxOff < tol * 5) return { ...base, kind: 'plane', normal: n, point: c };
  }
  // Cylinder: all normals perpendicular to one axis, vertices on a circle around it.
  const eig = eigenSym3(m);
  const axis = eig.vectors[0];
  let maxAx = 0;
  for (const t of tris) if (ta[t] > 0) maxAx = Math.max(maxAx, Math.abs(axis.x * tn[3 * t] + axis.y * tn[3 * t + 1] + axis.z * tn[3 * t + 2]));
  if (maxAx < Math.sin(3 / DEG) && pts.length >= 4) {
    const fit = fitCircle(pts, axis, c);
    if (fit && fit.maxErr < Math.max(tol * 3, fit.r * 1e-4)) {
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { const s = p.clone().sub(fit.center).dot(axis); lo = Math.min(lo, s); hi = Math.max(hi, s); }
      const p0 = fit.center.clone().addScaledVector(axis, lo), p1 = fit.center.clone().addScaledVector(axis, hi);
      return { ...base, kind: 'cylinder', axis, r: fit.r, p0, p1, center: p0.clone().add(p1).multiplyScalar(0.5), length: hi - lo };
    }
  }
  return { ...base, kind: 'surface' };
}

function classifyEdge(part, pts, closed, tol) {
  if (pts.length < 2) return null;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
  if (length < tol) return null;
  const flat = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => p.toArray(flat, 3 * i));
  const base = { part, pts, flat, length, closed };
  const p0 = pts[0], p1 = pts[pts.length - 1];
  if (!closed) {
    const d = p1.clone().sub(p0);
    const L = d.length();
    if (L > tol) {
      d.divideScalar(L);
      let maxOff = 0;
      for (const p of pts) { const w = p.clone().sub(p0); maxOff = Math.max(maxOff, w.sub(d.clone().multiplyScalar(w.dot(d))).length()); }
      if (maxOff < tol * 2) return { ...base, kind: 'line', p0: p0.clone(), p1: p1.clone(), dir: d };
    }
  }
  const uniq = closed ? pts.slice(0, -1) : pts;
  if (uniq.length >= 4) {
    const c = centroidOf(uniq);
    const eig = eigenSym3(covariance(uniq, c));
    const n = eig.vectors[0];
    let maxOff = 0;
    for (const p of uniq) maxOff = Math.max(maxOff, Math.abs(p.clone().sub(c).dot(n)));
    if (maxOff < tol * 5) {
      const fit = fitCircle(uniq, n, c);
      if (fit && fit.maxErr < Math.max(tol * 3, fit.r * 1e-4)) {
        // Arc span from the unwrapped angles.
        let span = 0;
        for (let i = 1; i < fit.angles.length; i++) {
          let da = fit.angles[i] - fit.angles[i - 1];
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          span += da;
        }
        const full = closed || Math.abs(span) > 2 * Math.PI - 0.01;
        return { ...base, kind: full ? 'circle' : 'arc', center: fit.center, normal: n, r: fit.r, span: Math.abs(span) * DEG };
      }
    }
  }
  return { ...base, kind: 'curve' };
}

// ---------- Formatting ----------
const fmt = (n, d = 3) => (Math.abs(n) < 0.5 * Math.pow(10, -d) ? 0 : n).toFixed(d);
const fv = (v) => `${fmt(v.x, 2)}, ${fmt(v.y, 2)}, ${fmt(v.z, 2)}`;

function describe(ent) {
  switch (ent.kind) {
    case 'point': { const t = ent.label || 'Point'; return { title: t, rows: [['Position', fv(ent.p)]], short: `${t} ${fv(ent.p)}` }; }
    case 'line': return { title: 'Line edge', rows: [['Length', `${fmt(ent.length)} mm`], ['Direction', fv(ent.dir)]], short: `Line ${fmt(ent.length)} mm` };
    case 'circle': return { title: 'Circle edge', rows: [['Diameter', `Ø${fmt(2 * ent.r)} mm`], ['Centre', fv(ent.center)], ['Normal', fv(ent.normal)]], short: `Circle Ø${fmt(2 * ent.r)} mm` };
    case 'arc': return { title: 'Arc edge', rows: [['Radius', `R${fmt(ent.r)} mm`], ['Angle', `${fmt(ent.span, 1)}°`], ['Length', `${fmt(ent.length)} mm`], ['Centre', fv(ent.center)]], short: `Arc R${fmt(ent.r)} mm, ${fmt(ent.span, 1)}°` };
    case 'curve': return { title: 'Edge', rows: [['Length', `${fmt(ent.length)} mm`]], short: `Edge ${fmt(ent.length)} mm` };
    case 'plane': return { title: 'Plane face', rows: [['Area', `${fmt(ent.area, 2)} mm²`], ['Normal', fv(ent.normal)]], short: `Plane ${fmt(ent.area, 1)} mm²` };
    case 'cylinder': return { title: 'Cylinder face', rows: [['Diameter', `Ø${fmt(2 * ent.r)} mm`], ['Axis', fv(ent.axis)], ['Length', `${fmt(ent.length)} mm`], ['Axis centre', fv(ent.center)]], short: `Cylinder Ø${fmt(2 * ent.r)} mm` };
    default: return { title: 'Surface', rows: [['Area', `${fmt(ent.area, 2)} mm²`]], short: `Surface ${fmt(ent.area, 1)} mm²` };
  }
}

// Reduce an entity to a primitive for relations.
function prim(ent) {
  switch (ent.kind) {
    case 'point': return { t: 'P', p: ent.p };
    case 'circle': case 'arc': return { t: 'P', p: ent.center, label: 'centre' };
    case 'line': return { t: 'L', p: ent.p0, d: ent.dir };
    case 'cylinder': return { t: 'L', p: ent.center, d: ent.axis, label: 'axis' };
    case 'plane': return { t: 'S', p: ent.point, n: ent.normal };
    default: return { t: 'P', p: ent.pick || ent.p || V(), label: 'picked point' };
  }
}

function angleBetween(u, w) { return Math.acos(Math.min(1, Math.abs(u.dot(w)))) * DEG; }

function relate(A, B) {
  let a = prim(A), b = prim(B);
  const order = { P: 0, L: 1, S: 2 };
  let swapped = false;
  if (order[a.t] > order[b.t]) { [a, b] = [b, a]; swapped = true; }
  const rows = [];
  let seg = null;
  const T = a.t + b.t;
  if (T === 'PP') {
    const d = b.p.clone().sub(a.p);
    rows.push(['Distance', `${fmt(d.length())} mm`, true], ['ΔX', fmt(swapped ? -d.x : d.x)], ['ΔY', fmt(swapped ? -d.y : d.y)], ['ΔZ', fmt(swapped ? -d.z : d.z)]);
    seg = [a.p, b.p];
  } else if (T === 'PL') {
    const w = a.p.clone().sub(b.p);
    const foot = b.p.clone().addScaledVector(b.d, w.dot(b.d));
    const d = a.p.distanceTo(foot);
    rows.push([b.label === 'axis' ? 'Distance to axis' : 'Distance to line', `${fmt(d)} mm`, true]);
    const cyl = [A, B].find(e => e.kind === 'cylinder');
    if (cyl) rows.push(['Distance to cylinder surface', `${fmt(Math.abs(d - cyl.r))} mm`]);
    seg = [a.p, foot];
  } else if (T === 'PS') {
    const s = a.p.clone().sub(b.p).dot(b.n);
    rows.push(['Distance to plane', `${fmt(Math.abs(s))} mm`, true]);
    seg = [a.p, a.p.clone().addScaledVector(b.n, -s)];
  } else if (T === 'LL') {
    const ang = angleBetween(a.d, b.d);
    rows.push(['Angle', `${fmt(ang, 2)}°`, ang >= PARALLEL_DEG]);
    const w = a.p.clone().sub(b.p);
    if (ang < PARALLEL_DEG) {
      const perp = w.clone().sub(b.d.clone().multiplyScalar(w.dot(b.d)));
      const lbl = (a.label === 'axis' && b.label === 'axis') ? 'Axis to axis' : 'Parallel distance';
      rows.unshift([lbl, `${fmt(perp.length())} mm`, true]);
      seg = [a.p, a.p.clone().sub(perp)];
    } else {
      const n = V().crossVectors(a.d, b.d).normalize();
      const dist = Math.abs(w.dot(n));
      rows.push(['Closest distance', `${fmt(dist)} mm`]);
      // closest points on the two infinite lines
      const d1 = a.d, d2 = b.d, r = a.p.clone().sub(b.p);
      const aa = d1.dot(d1), bb = d1.dot(d2), cc = d2.dot(d2), dd = d1.dot(r), ee = d2.dot(r);
      const den = aa * cc - bb * bb;
      const s = (bb * ee - cc * dd) / den, t = (aa * ee - bb * dd) / den;
      seg = [a.p.clone().addScaledVector(d1, s), b.p.clone().addScaledVector(d2, t)];
    }
  } else if (T === 'LS') {
    const ang = 90 - angleBetween(a.d, b.n);
    rows.push(['Angle to plane', `${fmt(ang, 2)}°`, ang >= PARALLEL_DEG]);
    if (ang < PARALLEL_DEG) {
      const s = a.p.clone().sub(b.p).dot(b.n);
      rows.unshift(['Distance to plane', `${fmt(Math.abs(s))} mm`, true]);
      seg = [a.p, a.p.clone().addScaledVector(b.n, -s)];
    }
  } else if (T === 'SS') {
    const ang = angleBetween(a.n, b.n);
    if (ang < PARALLEL_DEG) {
      const s = a.p.clone().sub(b.p).dot(b.n);
      rows.push(['Distance (parallel planes)', `${fmt(Math.abs(s))} mm`, true]);
      seg = [a.p, a.p.clone().addScaledVector(b.n, -s)];
    } else {
      rows.push(['Angle', `${fmt(ang, 2)}°`, true], ['Included angle', `${fmt(180 - ang, 2)}°`]);
    }
  }
  if (A.kind === 'circle' || A.kind === 'arc' || B.kind === 'circle' || B.kind === 'arc' || A.kind === 'cylinder' || B.kind === 'cylinder') {
    rows.push(['Reference', 'centre / axis']);
  }
  return { rows, seg };
}

// ---------- Tool ----------
export function createMeasure(ctx) {
  const { scene, renderer, stage, getCamera, getParts, isShown, getClipPlanes, isClipped, accent, card, body, tip, diag } = ctx;
  const overlay = new THREE.Group();
  overlay.renderOrder = 20;
  scene.add(overlay);
  const colors = { hover: accent(), a: accent(), b: '#2f7bd8', dim: '#111827' };

  let enabled = false, built = false, hovered = null, selection = [];
  let freeMode = false, shiftHeld = false;
  const isFree = () => freeMode !== shiftHeld;
  let hoverObjs = [], selObjs = [], dimObj = null, dimLabel = null;
  const lineMats = new Set();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let lastMove = null, rafPending = false;

  function ensureBuilt() {
    if (built) return;
    const d = diag();
    for (const p of getParts()) p.topo = buildTopology(p, d);
    built = true;
  }

  function lineMat(color, width, dashed = false) {
    const m = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true, dashed, dashSize: 1, gapSize: 0.6 });
    m.resolution.set(stage.clientWidth, stage.clientHeight);
    lineMats.add(m);
    return m;
  }

  function makeVisual(ent, color, strong) {
    const objs = [];
    if (ent.kind === 'point') {
      const g = new THREE.BufferGeometry().setFromPoints([ent.p]);
      const m = new THREE.PointsMaterial({ color, size: strong ? 11 : 9, sizeAttenuation: false, depthTest: false, map: dotTexture(), transparent: true, alphaTest: 0.3 });
      const o = new THREE.Points(g, m); o.renderOrder = 30; objs.push(o);
    } else if (ent.flat) {
      const arr = [];
      for (let i = 0; i + 3 < ent.flat.length; i += 3) arr.push(ent.flat[i], ent.flat[i + 1], ent.flat[i + 2], ent.flat[i + 3], ent.flat[i + 4], ent.flat[i + 5]);
      const g = new LineSegmentsGeometry().setPositions(arr);
      const o = new LineSegments2(g, lineMat(color, strong ? 4 : 3)); o.renderOrder = 25; objs.push(o);
      if (ent.center) objs.push(...makeVisual({ kind: 'point', p: ent.center }, color, false));
    } else if (ent.tris) {
      const geo = ent.part.mesh.geometry, pos = geo.attributes.position.array, idx = geo.index.array;
      const out = new Float32Array(ent.tris.length * 9);
      ent.tris.forEach((t, i) => { for (let k = 0; k < 3; k++) { const v = idx[3 * t + k]; out.set(pos.subarray(3 * v, 3 * v + 3), 9 * i + 3 * k); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: strong ? 0.55 : 0.4, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: getClipPlanes() });
      const o = new THREE.Mesh(g, m); o.renderOrder = 22; objs.push(o);
      if (ent.kind === 'cylinder') {
        const g2 = new LineSegmentsGeometry().setPositions([...ent.p0.toArray(), ...ent.p1.toArray()]);
        const ax = new LineSegments2(g2, lineMat(color, 2, true)); ax.computeLineDistances(); ax.renderOrder = 26; objs.push(ax);
      }
    }
    objs.forEach(o => overlay.add(o));
    return objs;
  }

  let _dot = null;
  function dotTexture() {
    if (_dot) return _dot;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 13, 0, Math.PI * 2); g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.stroke();
    _dot = new THREE.CanvasTexture(c);
    return _dot;
  }

  function dispose(objs) {
    for (const o of objs) {
      overlay.remove(o);
      o.geometry && o.geometry.dispose();
      if (o.material) { lineMats.delete(o.material); o.material.dispose(); }
    }
  }

  // ----- Picking -----
  function depthOf(p, cam) {
    const dir = V(); cam.getWorldDirection(dir);
    return p.clone().sub(cam.position).dot(dir);
  }
  function toScreen(p, cam, rect) {
    const v = p.clone().project(cam);
    return [(v.x + 1) / 2 * rect.width, (1 - v.y) / 2 * rect.height, v.z];
  }

  function pickAt(clientX, clientY, free = false) {
    ensureBuilt();
    const cam = getCamera();
    const rect = renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    ndc.set(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    const parts = getParts().filter(p => isShown(p.holder));
    const hits = raycaster.intersectObjects(parts.map(p => p.mesh), false).filter(h => !isClipped(h.point));
    const hit = hits[0] || null;
    const eps = diag() * 0.004;
    const hitDepth = hit ? depthOf(hit.point, cam) : Infinity;
    const visible = (p) => !isClipped(p) && depthOf(p, cam) <= hitDepth + eps;

    // Candidates: true vertices, circle/arc centres, edges. The nearest on screen
    // wins; true vertices get a 2 px bonus. Then the face under the cursor.
    let bestV = null, dV = 6, bestC = null, dC = 8, bestE = null, dE = 7, pickE = null;
    for (const part of parts) {
      for (const v of part.topo.vertices.concat(part.topo.mids)) {
        const [sx, sy, sz] = toScreen(v.p, cam, rect);
        if (sz > 1) continue;
        const d = Math.hypot(sx - mx, sy - my);
        if (d < dV && visible(v.p)) { dV = d; bestV = v; }
      }
      for (const e of part.topo.edges) {
        if (!e.center) continue;
        const [sx, sy, sz] = toScreen(e.center, cam, rect);
        if (sz > 1) continue;
        const d = Math.hypot(sx - mx, sy - my);
        if (d < dC && visible(e.center)) { dC = d; bestC = { kind: 'point', part, p: e.center.clone(), of: e, label: 'Centre' }; }
      }
    }
    const a = V(), b = V();
    for (const part of parts) {
      for (const e of part.topo.edges) {
        const f = e.flat;
        let prev = null;
        for (let i = 0; i < f.length; i += 3) {
          a.set(f[i], f[i + 1], f[i + 2]);
          const s = toScreen(a, cam, rect);
          if (prev && prev[2] <= 1 && s[2] <= 1) {
            const dx = s[0] - prev[0], dy = s[1] - prev[1];
            const L2 = dx * dx + dy * dy;
            let t = L2 > 0 ? ((mx - prev[0]) * dx + (my - prev[1]) * dy) / L2 : 0;
            t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(prev[0] + t * dx - mx, prev[1] + t * dy - my);
            if (d < dE) {
              b.set(f[i - 3], f[i - 2], f[i - 1]);
              const p3 = b.clone().lerp(a, t);
              if (visible(p3)) { dE = d; bestE = e; pickE = p3; }
            }
          }
          prev = s;
        }
      }
    }
    if (free) {
      // Free point: snap only to a vertex, midpoint or centre within 4 px,
      // else the exact point on the edge, else on the face.
      if (bestV && dV < 4) return bestV;
      if (bestC && dC < 4) return bestC;
      if (bestE) return { kind: 'point', part: bestE.part, p: pickE.clone(), label: 'Point on edge' };
      if (hit) return { kind: 'point', part: hit.object.userData.part, p: hit.point.clone(), label: 'Point on face' };
      return null;
    }
    // Vertices and midpoints win inside their 6 px snap radius. A circle centre
    // wins only when it is nearer than the edge, so small hole edges stay pickable.
    if (bestV) return bestV;
    if (bestC && (!bestE || dC < dE)) return bestC;
    if (bestE) { bestE.pick = pickE; return bestE; }
    if (hit) {
      const part = hit.object.userData.part;
      const face = part.topo.faces[part.topo.faceOf[hit.faceIndex]];
      if (face) { face.pick = hit.point.clone(); return face; }
    }
    return null;
  }

  // ----- UI -----
  function showTip(ent, x, y) {
    if (!ent) { tip.style.display = 'none'; return; }
    const rect = stage.getBoundingClientRect();
    tip.textContent = describe(ent).short;
    tip.style.display = 'block';
    tip.style.left = `${x - rect.left + 14}px`;
    tip.style.top = `${y - rect.top + 14}px`;
  }

  function sameEnt(a, b) {
    if (!a || !b) return false;
    if (a.kind === 'point' && b.kind === 'point') return a.p.distanceTo(b.p) < 1e-6;
    return a === b;
  }

  function setHover(ent) {
    if (sameEnt(ent, hovered)) return;
    dispose(hoverObjs); hoverObjs = [];
    hovered = ent;
    if (ent && !selection.some(s => sameEnt(s, ent))) hoverObjs = makeVisual(ent, colors.hover, false);
  }

  function renderCard() {
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const block = (ent, tag, color) => {
      const d = describe(ent);
      return `<div class="m-ent"><span class="m-tag" style="background:${color}">${tag}</span><b>${esc(d.title)}</b></div>` +
        `<dl class="props">${d.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    };
    if (!selection.length) {
      body.innerHTML = '<p class="hint">Hover to see what is under the cursor. Click a point, edge or face, then a second one to measure between them. Lines snap to their midpoint. For any point on an edge or face, hold Shift or switch to Free points.</p>';
      return;
    }
    let html = block(selection[0], 'A', colors.a);
    if (selection.length === 2) {
      html += block(selection[1], 'B', colors.b);
      const r = relate(selection[0], selection[1]);
      html += `<div class="m-rel"><h3>A to B</h3><dl class="props">${r.rows.map(([k, v, big]) => `<dt>${esc(k)}</dt><dd class="${big ? 'big' : ''}">${esc(v)}</dd>`).join('')}</dl></div>`;
      drawDim(r.seg, r.rows.find(x => x[2]));
    } else {
      drawDim(null);
    }
    body.innerHTML = html;
  }

  function drawDim(seg, mainRow) {
    if (dimObj) { dispose([dimObj]); dimObj = null; }
    if (dimLabel) { dimLabel.remove(); dimLabel = null; }
    if (!seg || seg[0].distanceTo(seg[1]) < 1e-9) return;
    const g = new LineSegmentsGeometry().setPositions([...seg[0].toArray(), ...seg[1].toArray()]);
    dimObj = new LineSegments2(g, lineMat(colors.dim, 2, true));
    dimObj.computeLineDistances(); dimObj.renderOrder = 40;
    overlay.add(dimObj);
    if (mainRow) {
      dimLabel = document.createElement('div');
      dimLabel.className = 'm-dim';
      dimLabel.textContent = mainRow[1];
      dimLabel.dataset.mid = JSON.stringify(seg[0].clone().add(seg[1]).multiplyScalar(0.5).toArray());
      stage.appendChild(dimLabel);
    }
  }

  function refreshSelectionVisuals() {
    dispose(selObjs); selObjs = [];
    selection.forEach((e, i) => selObjs.push(...makeVisual(e, i === 0 ? colors.a : colors.b, true)));
  }

  function snapshot(ent) {
    // Keep the picked point with the selection (pickAt reuses entity objects).
    const copy = Object.assign(Object.create(Object.getPrototypeOf(ent)), ent);
    if (ent.pick) copy.pick = ent.pick.clone();
    return copy;
  }

  return {
    setEnabled(on) {
      enabled = on;
      card.classList.toggle('on', on);
      if (on) { ensureBuilt(); renderCard(); }
      else { this.clear(); setHover(null); showTip(null); }
    },
    get enabled() { return enabled; },
    move(e) {
      if (!enabled) return;
      shiftHeld = !!e.shiftKey;
      lastMove = [e.clientX, e.clientY];
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!lastMove) return;
        const ent = pickAt(lastMove[0], lastMove[1], isFree());
        setHover(ent);
        showTip(ent, lastMove[0], lastMove[1]);
      });
    },
    leave() { lastMove = null; setHover(null); showTip(null); },
    setFree(on) { freeMode = on; this.refreshHover(); },
    setShift(on) { if (shiftHeld !== on) { shiftHeld = on; this.refreshHover(); } },
    refreshHover() {
      if (!enabled || !lastMove) return;
      hovered = undefined;
      const ent = pickAt(lastMove[0], lastMove[1], isFree());
      setHover(ent); showTip(ent, lastMove[0], lastMove[1]);
    },
    get free() { return freeMode; },
    click(e) {
      if (!enabled) return null;
      shiftHeld = !!e.shiftKey;
      const ent = pickAt(e.clientX, e.clientY, isFree());
      if (!ent) { this.clear(); return null; }
      if (selection.length >= 2) selection = [];
      if (selection.length === 1 && sameEnt(selection[0], ent)) return ent;
      selection.push(snapshot(ent));
      setHover(null);
      refreshSelectionVisuals();
      renderCard();
      return ent;
    },
    clear() { selection = []; refreshSelectionVisuals(); drawDim(null); if (enabled) renderCard(); },
    reset() { this.clear(); setHover(null); built = false; },
    update() {
      for (const m of lineMats) m.resolution.set(stage.clientWidth, stage.clientHeight);
      if (dimLabel) {
        const cam = getCamera();
        const p = V().fromArray(JSON.parse(dimLabel.dataset.mid)).project(cam);
        dimLabel.style.left = `${(p.x + 1) / 2 * stage.clientWidth}px`;
        dimLabel.style.top = `${(1 - p.y) / 2 * stage.clientHeight}px`;
      }
    },
    pickAt, // exposed for testing
    stats() {
      ensureBuilt();
      const out = {};
      for (const p of getParts()) {
        const t = p.topo;
        const count = (arr) => arr.reduce((m, e) => (m[e.kind] = (m[e.kind] || 0) + 1, m), {});
        out[p.name] = {
          faces: count(t.faces), edges: count(t.edges), vertices: t.vertices.length,
          cylDia: [...new Set(t.faces.filter(f => f.kind === 'cylinder').map(f => (2 * f.r).toFixed(3)))].sort((a, b) => a - b),
          circleDia: [...new Set(t.edges.filter(f => f.kind === 'circle').map(f => (2 * f.r).toFixed(3)))].sort((a, b) => a - b),
        };
      }
      return out;
    },
    select(ent) { if (selection.length >= 2) selection = []; selection.push(snapshot(ent)); refreshSelectionVisuals(); renderCard(); },
    relate, describe,
  };
}
