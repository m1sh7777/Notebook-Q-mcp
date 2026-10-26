// recognize.js — pure stroke/circuit recognition helpers: raw strokes →
// wires, gate boxes, letters, CNOTs. Every function reads only its
// arguments (no state, no canvas, no DOM), so the app and node tests
// can share this file. Tuning constants centralized: GROUP_MS, BOX_*,
// CLOUD_*, CONFIDENCE_MIN, DIR_*, CNOT_*.

// Shared geometry: every measurement starts from pointsBox(), so all
// verdicts agree on where a stroke is.

// Axis-aligned bounding box of points: edges (minX…), size (w, h), center (cx, cy).
function pointsBox(pts) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX, minY: minY, maxX: maxX, maxY: maxY,
    w: maxX - minX, h: maxY - minY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
  };
}

// True if the boxes overlap or come within `pad` px: a negative axis
// gap (overlap) also satisfies gap <= pad.
function boxesNear(a, b, pad) {
  return (
    a.minX - pad <= b.maxX && b.minX - pad <= a.maxX &&
    a.minY - pad <= b.maxY && b.minY - pad <= a.maxY
  );
}

// Wires

// One pass over a stroke's points collects every number the wire
// verdicts need. (minX/maxX ride along for snapToWire.)
function measureStroke(stroke) {
  const pts = stroke.points;
  let sumY = 0;
  for (const pt of pts) sumY += pt.y;
  const b = pointsBox(pts);
  return {
    minX: b.minX, maxX: b.maxX,
    span: b.w,
    drift: b.h,
    avgY: sumY / pts.length,
  };
}

// Snap a measured stroke to the grid → wire piece {y, x1, x2}.
function snapToWire(m) {
  const snap = (v) => Math.round(v / GRID_SIZE) * GRID_SIZE;

  // Row from the AVERAGE y, not an endpoint — hand-drawn wires tilt,
  // so their two ends can sit on different grid lines.
  const y = snap(m.avgY);

  const x1 = snap(m.minX);
  const x2 = snap(m.maxX);

  // A wire drawn right-to-left still gets x1 < x2.
  return { y: y, x1: Math.min(x1, x2), x2: Math.max(x1, x2) };
}

// Whole-wire verdict: spans at least 3 grid cells horizontally and
// drifts vertically by less than 20% of its span. Returns the snapped
// piece or null.
function detectWire(stroke) {
  const m = measureStroke(stroke);
  if (m.span < 3 * GRID_SIZE) return null;
  if (m.drift >= 0.2 * m.span) return null;
  return snapToWire(m);
}

// Short stroke joins an EXISTING wire if: flat by the same 20% rule
// (a dot fails 0 >= 0 and stays ink), its snapped row equals a known
// wire's row, and its x-range overlaps that wire or lies within one
// grid cell of it.
function detectWireStub(stroke, wires) {
  const m = measureStroke(stroke);
  if (m.span >= 3 * GRID_SIZE) return null;
  if (m.drift >= 0.2 * m.span) return null;
  const piece = snapToWire(m);
  for (const wire of wires) {
    if (wire.y !== piece.y) continue;
    // Interval gap: negative when overlapping, so max(..., 0) = 0.
    const gap = Math.max(wire.x1 - piece.x2, piece.x1 - wire.x2, 0);
    if (gap <= GRID_SIZE) return piece;
  }
  return null;
}

// The one public door for wires. drawing.js calls only this.
function recognizeStroke(stroke, wires) {
  return detectWire(stroke) || detectWireStub(stroke, wires);
}

// Gate grouping

const GROUP_MS = 600; // ms of pen-up that still counts as one group

// Pen-up time (ms) between two consecutive strokes.
function strokeGap(prev, next) {
  // Older strokes (or hand-built test data) may lack endedAt:
  // fall back to the last recorded point's time.
  const prevEnd =
    prev.endedAt !== undefined
      ? prev.endedAt
      : prev.points[prev.points.length - 1].t;
  return next.points[0].t - prevEnd;
}

// Group strokes by time (< GROUP_MS pen-up) AND spatial proximity —
// both must hold for every neighboring pair. Returns groups of
// INDICES into the input array (the caller splices the originals
// out of state.strokes once a group is promoted).
function groupStrokes(strokes) {
  const groups = [];
  if (strokes.length === 0) return groups;

  let current = [0];
  for (let i = 1; i < strokes.length; i++) {
    const prev = strokes[i - 1];
    const curr = strokes[i];
    const nearInTime = strokeGap(prev, curr) < GROUP_MS;
    const nearInSpace = boxesNear(
      pointsBox(prev.points), pointsBox(curr.points), GRID_SIZE / 2
    );
    if (nearInTime && nearInSpace) {
      current.push(i);
    } else {
      groups.push(current);
      current = [i];
    }
  }
  groups.push(current);
  return groups;
}

// Time-only grouping, for TEACH MODE. A taught letter's strokes (an
// H's two verticals) are far apart, so the space rule would shatter
// the example; teaching happens on empty paper, so time alone is the
// right glue.
function groupStrokesByTime(strokes) {
  const groups = [];
  if (strokes.length === 0) return groups;
  let current = [0];
  for (let i = 1; i < strokes.length; i++) {
    if (strokeGap(strokes[i - 1], strokes[i]) < GROUP_MS) {
      current.push(i);
    } else {
      groups.push(current);
      current = [i];
    }
  }
  groups.push(current);
  return groups;
}

// Box test

const BOX_MIN = 22;          // px — smaller holds no letter
const BOX_MAX = 64;          // px — wider spills across time columns
const BOX_ASPECT_MIN = 0.35; // w/h — below: tall mark, not a box
const BOX_ASPECT_MAX = 2.2;  // w/h — above: wire-like flat line
const BOX_CLOSURE = 0.30;    // end may sit this fraction of max(w,h) from start
const SIDE_TOUCH = 0.25;     // a side is "touched" within 25% of box size

// Shape test only — whether the box sits on a wire is decided later,
// in recognizeGate().
function isBox(stroke) {
  const pts = stroke.points;
  if (pts.length < 4) return false;

  const b = pointsBox(pts);

  if (b.w < BOX_MIN || b.h < BOX_MIN) return false;
  if (b.w > BOX_MAX || b.h > BOX_MAX) return false;

  const aspect = b.w / b.h;
  if (aspect < BOX_ASPECT_MIN || aspect > BOX_ASPECT_MAX) return false;

  // Closed: the pen must come back to its starting corner.
  const first = pts[0], last = pts[pts.length - 1];
  const closure = Math.hypot(last.x - first.x, last.y - first.y);
  if (closure > BOX_CLOSURE * Math.max(b.w, b.h)) return false;

  // Container: an open "U" or "C" fails this even when it looks closed.
  return touchesAllSides(pts, b);
}

// Does the stroke reach near each of the four sides of box b?
function touchesAllSides(pts, b) {
  const mx = b.w * SIDE_TOUCH;
  const my = b.h * SIDE_TOUCH;
  let left = false, right = false, top = false, bottom = false;
  for (const p of pts) {
    if (p.x - b.minX <= mx) left = true;
    if (b.maxX - p.x <= mx) right = true;
    if (p.y - b.minY <= my) top = true;
    if (b.maxY - p.y <= my) bottom = true;
  }
  return left && right && top && bottom;
}

// Letter test — template matching with two cheap signals, averaged:
// 1. $P point-cloud match (32 resampled points, greedy pairing tried
//    from every starting point; scale/position normalized away).
// 2. A direction fingerprint — clouds alone are too forgiving (N and
//    H cover almost the same paper): one heading per ~8px of ink,
//    folded onto [0, π), compared with a soft 60° kernel.
// Measured: true letters score 0.92–0.98, impostors (Y, O, W, N — N
// is the hardest, its geometry genuinely overlaps H) just below
// CONFIDENCE_MIN. Teach-mode examples score higher (own hand).

const CLOUD_SIZE = 32;      // points per gesture cloud
const CLOUD_SCALE = 100;    // clouds are scaled to fit this box before comparing
const CONFIDENCE_MIN = 0.85; // below this: unknown letter → stays ink

// Total walking length of a point list (polyline).
function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

// Resample a polyline to exactly n evenly-spaced points ($1-style);
// works on a copy, never mutates the caller's points.
function resamplePath(pts, n) {
  if (pts.length < 2) {
    // A single point (a dot): the "path" is just that point, n times.
    return Array.from({ length: n }, () => ({ x: pts[0].x, y: pts[0].y }));
  }
  const work = pts.map((p) => ({ x: p.x, y: p.y }));
  const interval = pathLength(work) / (n - 1);
  const out = [{ x: work[0].x, y: work[0].y }];
  let D = 0; // distance walked since the last emitted point
  for (let i = 1; i < work.length; i++) {
    const a = work[i - 1], b = work[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > 0 && D + d >= interval) {
      // Cut the segment at the next emission mark; the cut point
      // becomes the new segment start.
      const t = (interval - D) / d;
      const np = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(np);
      work.splice(i, 0, np);
      D = 0;
    } else {
      D += d;
    }
  }
  // Rounding can leave one short — pad with the final point.
  while (out.length < n) out.push({ x: out[out.length - 1].x, y: out[out.length - 1].y });
  return out.slice(0, n);
}

// Strokes → one canonical cloud of exactly CLOUD_SIZE points (or null
// for dots-only input). Points are shared per stroke proportional to
// length and resampled PER STROKE, so no phantom line is invented
// between separate strokes. Centered, scaled so the longest bbox side
// is CLOUD_SCALE.
function normalizeStrokes(pointArrays) {
  let totalLen = 0;
  for (const pts of pointArrays) totalLen += pathLength(pts);
  if (totalLen === 0) return null; // only dots → no shape to match

  const cloud = [];
  for (const pts of pointArrays) {
    const len = pathLength(pts);
    if (len === 0) continue; // skip dots hiding among strokes
    const n = Math.max(2, Math.round(CLOUD_SIZE * (len / totalLen)));
    cloud.push(...resamplePath(pts, n));
  }
  if (cloud.length === 0) return null;

  // Trim over-shares, pad under-shares.
  while (cloud.length > CLOUD_SIZE) cloud.pop();
  while (cloud.length < CLOUD_SIZE) {
    cloud.push({ x: cloud[cloud.length - 1].x, y: cloud[cloud.length - 1].y });
  }

  const b = pointsBox(cloud);
  const size = Math.max(b.w, b.h);
  if (size === 0) return null;
  for (const p of cloud) {
    p.x = (p.x - b.cx) / size * CLOUD_SCALE;
    p.y = (p.y - b.cy) / size * CLOUD_SCALE;
  }
  return cloud;
}

// Greedy matching walk starting at `start`; returns Σ (matched
// distance × weight) — early-matched points weigh more.
function cloudDistance(cloud, template, start) {
  const matched = new Array(template.length).fill(false);
  let total = 0;
  let steps = 0;
  let i = start;
  do {
    // Nearest still-unused template point for cloud[i].
    let best = Infinity, bestJ = -1;
    for (let j = 0; j < template.length; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(cloud[i].x - template[j].x, cloud[i].y - template[j].y);
      if (d < best) { best = d; bestJ = j; }
    }
    matched[bestJ] = true;
    total += best * (1 - steps / cloud.length); // weight 1 → 1/n
    steps++;
    i = (i + 1) % cloud.length;
  } while (i !== start);
  return total;
}

// Cheapest walk over every starting point — robust to where on the
// letter the pen was first put down.
function greedyCloudMatch(cloud, template) {
  let best = Infinity;
  for (let start = 0; start < cloud.length; start++) {
    const d = cloudDistance(cloud, template, start);
    if (d < best) best = d;
  }
  return best;
}

// Direction fingerprint

const DIR_SPAN = 8;               // px of ink per heading sample
const DIR_TOLERANCE = Math.PI / 3; // 60° soft kernel for heading comparison

// One heading per ~DIR_SPAN px of ink, folded onto [0, π) so up ≡ down
// (the same line drawn either way, or in any stroke order, gives the
// same list). Headings are measured along the stroke RESAMPLED to ~8px
// steps: raw 2px micro-segments from a real pen wobble ±30°.
function strokeHeadings(pointArrays) {
  const out = [];
  for (const pts of pointArrays) {
    if (pts.length < 2) continue;
    const len = pathLength(pts);
    if (len === 0) continue;
    const path = resamplePath(pts, Math.max(2, Math.ceil(len / DIR_SPAN)));
    for (let i = 1; i < path.length; i++) {
      let a = Math.atan2(path[i].y - path[i - 1].y, path[i].x - path[i - 1].x);
      if (a < 0) a += Math.PI; // fold: drawing up ≡ drawing down
      out.push(a);
    }
  }
  return out;
}

// Symmetric soft heading comparison: each sample finds its closest
// partner and earns a triangular-kernel score; the result is the MIN
// of the two directions. An impostor often finds some support one way
// (N's diagonal is 32° off H's verticals), but H's crossbar finds
// nothing in N — only the reverse pass sees that.
function headingSimilarity(headsA, headsB) {
  if (headsA.length === 0 || headsB.length === 0) return 0;

  const oneWay = (from, to) => {
    let total = 0;
    for (const a of from) {
      let best = 0;
      for (const b of to) {
        let d = Math.abs(a - b);
        // 0 and π are the same line (horizontal): wrap the fold.
        if (d > Math.PI / 2) d = Math.PI - d;
        const k = Math.max(0, 1 - d / DIR_TOLERANCE);
        if (k > best) best = k;
      }
      total += best;
    }
    return total / from.length;
  };

  return Math.min(oneWay(headsA, headsB), oneWay(headsB, headsA));
}

// Best {label, score} whose combined score clears CONFIDENCE_MIN,
// or null ("unknown letter": leave as ink).
//   letterStrokes : stroke objects ({points: [...]}) inside a box
//   templates     : { label: [example, ...] }, each example = array of strokes
function classifyLetter(letterStrokes, templates) {
  const rawStrokes = letterStrokes.map((s) => s.points);
  const cloud = normalizeStrokes(rawStrokes);
  if (!cloud) return null; // dots only → no shape, no headings

  const hist = strokeHeadings(rawStrokes);

  let bestLabel = null, bestScore = -Infinity;
  for (const label in templates) {
    for (const example of templates[label]) {
      const template = normalizeStrokes(example);
      if (!template) continue;

      // Signal 1 — where the ink is: cloud overlap.
      const total = greedyCloudMatch(cloud, template);
      const shapeScore = 1 - (2 * total) / cloud.length / CLOUD_SCALE;

      // Signal 2 — which way the pen moved: heading fingerprint.
      const dirScore = headingSimilarity(hist, strokeHeadings(example));

      // An impostor can fool one signal (right region OR right
      // headings) but rarely both at once.
      const score = (shapeScore + dirScore) / 2;
      if (score > bestScore) { bestScore = score; bestLabel = label; }
    }
  }
  if (bestLabel === null || bestScore < CONFIDENCE_MIN) return null;
  return { label: bestLabel, score: bestScore };
}

// Gate assembly

// Which wire (if any) does this box sit on? Vertical center within
// half a grid cell of the wire's row; x-range inside the wire's span
// or touching it.
function wireUnderBox(b, wires) {
  for (const wire of wires) {
    if (Math.abs(b.cy - wire.y) > GRID_SIZE / 2) continue;
    if (b.minX <= wire.x2 && b.maxX >= wire.x1) return wire;
  }
  return null;
}

const LETTER_INSIDE_PAD = 10;        // px a letter may poke past the box lines
const LETTER_INSIDE_FRACTION = 0.75; // share of points that must be inside

// Is a stroke (mostly) inside the box b?
function strokeInsideBox(stroke, b) {
  if (stroke.points.length === 0) return false;
  let inside = 0;
  for (const p of stroke.points) {
    if (
      p.x >= b.minX - LETTER_INSIDE_PAD && p.x <= b.maxX + LETTER_INSIDE_PAD &&
      p.y >= b.minY - LETTER_INSIDE_PAD && p.y <= b.maxY + LETTER_INSIDE_PAD
    ) inside++;
  }
  return inside / stroke.points.length >= LETTER_INSIDE_FRACTION;
}

// Time column for an x: columns are COLUMN_WIDTH wide, centered on
// COLUMN_ORIGIN + k × COLUMN_WIDTH; round() snaps to the nearest one.
function columnForX(cx) {
  return Math.max(0, Math.round((cx - COLUMN_ORIGIN) / COLUMN_WIDTH));
}

// Judge one candidate group (pure). Returns the circuit entry to
// file — {gate, y, col}, anchored to the wire's ROW, never a qubit
// number (qubit numbers are derived from sorted rows later, so
// drawing a new wire above never renumbers existing gates) — or null.
function recognizeGate(strokes, wires, templates) {
  // 1. Find the box: the biggest box-shaped stroke (a looped letter
  //    like O loses to the container on area).
  let boxStroke = null, boxArea = -1;
  for (const s of strokes) {
    if (!isBox(s)) continue;
    const b = pointsBox(s.points);
    const area = b.w * b.h;
    if (area > boxArea) { boxArea = area; boxStroke = s; }
  }
  if (!boxStroke) return null;

  const b = pointsBox(boxStroke.points);

  // 2. The box must sit on a wire — a gate drawn in empty space is
  //    just ink.
  const wire = wireUnderBox(b, wires);
  if (!wire) return null;

  // 3. Collect and classify the letter strokes inside the box.
  const letterStrokes = [];
  for (const s of strokes) {
    if (s === boxStroke) continue;
    if (strokeInsideBox(s, b)) letterStrokes.push(s);
  }
  if (letterStrokes.length === 0) return null;
  const hit = classifyLetter(letterStrokes, templates);
  if (!hit) return null;

  // 4. Gate anchored to its wire's row, in its time column.
  return { gate: hit.label, y: wire.y, col: columnForX(b.cx) };
}

// Is this wire-row × column slot already occupied? (Pure policy
// check — drawing.js decides what to do about it.)
// Circuit holds three entry shapes: boxed gates {gate, y, col}, CNOTs
// {gate:"CNOT", cy, ty, col} — a CNOT also occupies every wire row
// between cy and ty, because its connector crosses them — and blocks
// {gate:"BLOCK", y..y2, col..col2, stored at placement time}, checked
// as a RANGE so nothing can be drawn through a placed block.
function gateSlotTaken(circuit, y, col) {
  for (const g of circuit) {
    if (g.gate === "CNOT") {
      if (g.col !== col) continue;
      const lo = Math.min(g.cy, g.ty);
      const hi = Math.max(g.cy, g.ty);
      if (y >= lo && y <= hi) return true;
    } else if (g.gate === "BLOCK") {
      // A block spans a range of columns (col..col2), so the check
      // is a range test, not a single-column equality.
      const cHi = (g.col2 !== undefined ? g.col2 : g.col);
      if (col < g.col || col > cHi) continue;
      const yLo = g.y, yHi = (g.y2 !== undefined ? g.y2 : g.y);
      if (y >= yLo && y <= yHi) return true;
    } else {
      if (g.col !== col) continue;
      if (g.y === y) return true;
    }
  }
  return false;
}

// Hand-drawn CNOT — the first circuit part connecting TWO wires.
// Up to three strokes, each with a pure shape test below:
//   CONNECTOR — long near-vertical stroke (horizontal drift < 25% of
//     height); the user starts it ON the control wire.
//   TARGET — small roughly-closed loop on one end wire; an optional
//     plus inside is consumed with it.
//   CONTROL — optional dot near the other end (many hand-drawn CNOTs
//     just start the connector there).
// The circle decides which wire is target vs control — above or
// below, nothing in the code cares. Ends must snap to TWO DIFFERENT
// rows (letter strokes on one wire can never pass), and a connector
// with no circle is a loud rejection, not silently eaten.

const CNOT_MIN_TALL = 1.5 * GRID_SIZE;   // px — more than one wire gap, so letter strokes can't reach it
const CNOT_MAX_DRIFT = 0.25;             // connector's horizontal drift < 25% of height
const CNOT_END_SNAP = GRID_SIZE / 2;     // px — end must land this near a wire row (strict: midway snaps to neither)
const CNOT_TARGET_MIN = 0.4 * GRID_SIZE; // px — target loop, at least this across
// Raised 1.2→1.9 grids (48→76px): hand-drawn target blobs measure
// ~70px across and were silently not targets at the old 48px ceiling.
const CNOT_TARGET_MAX = 1.9 * GRID_SIZE; // px — target loop, at most this across
const CNOT_TARGET_ASPECT_MIN = 0.6;      // w/h — roughly round
const CNOT_TARGET_ASPECT_MAX = 1.6;      // w/h — noodles and ribbons are out
const CNOT_CIRCLE_CLOSURE = 0.45;        // end may sit up to 45% of size from start (a "C" fails)
// Corner-ness threshold between the measured blob family (1.09–1.19)
// and squares (1.41), with air on both sides — see isCnotTarget.
const CNOT_RECTANGLE_SPREAD = 1.30;
// Resample count for the corner-ness probe: dense enough to expose
// edge-midpoint samples even of corner-only-sampled squares.
const CNOT_TARGET_RESAMPLE = 24;
const CNOT_DOT_MAX = 0.6 * GRID_SIZE;    // px — a control dot (or tiny scribble) is under this
const CNOT_DOT_NEAR = 0.75 * GRID_SIZE;  // px — and within this of the connector's end

// Shape only — whether the ends actually reach two wires needs the
// wires list and is the engine's job (this function stays wire-free).
function isCnotConnector(stroke) {
  const pts = stroke.points;
  if (pts.length < 2) return false;
  const b = pointsBox(pts);
  if (b.h < CNOT_MIN_TALL) return false;
  if (b.w >= CNOT_MAX_DRIFT * b.h) return false;
  return true;
}

// Wire (if any) under a connector END: row within half a grid cell
// AND x inside the wire's span — an end in empty space next to a wire
// is not "on" the wire. Strict inequality: an end exactly halfway
// between two rows snaps to neither (keeps ambiguous strokes out).
function wireAtEnd(x, y, wires) {
  for (const w of wires) {
    if (Math.abs(y - w.y) < CNOT_END_SNAP && x >= w.x1 && x <= w.x2) return w;
  }
  return null;
}

// Corner-ness: max/min distance of the ink from the middle. A
// circle's ink stays roughly one radius out in every direction
// (spread ≈ 1.0–1.25); a rectangle's corners are √2 ≈ 1.41 times
// farther than its edge midpoints — the one signal boxes can't fake.
function radialSpread(pts, b) {
  let rMin = Infinity, rMax = 0;
  for (const p of pts) {
    const r = Math.hypot(p.x - b.cx, p.y - b.cy);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  return rMin > 0 ? rMax / rMin : Infinity;
}

// Is this stroke a target circle? A lumpy blob passes; a gate box
// never does; a NEAT circle also passes (resampling a circle gives
// ~1.0–1.2 spread).
function isCnotTarget(stroke) {
  const pts = stroke.points;
  if (pts.length < 4) return false;
  const b = pointsBox(pts);
  const across = Math.max(b.w, b.h);
  if (across < CNOT_TARGET_MIN || across > CNOT_TARGET_MAX) return false;
  if (b.h === 0) return false; // flat dash: guard the aspect divide
  const aspect = b.w / b.h;
  if (aspect < CNOT_TARGET_ASPECT_MIN || aspect > CNOT_TARGET_ASPECT_MAX) return false;

  // Squares are the target's impostor. Corner-only-sampled squares
  // have no edge-midpoint samples, so their raw spread looks like a
  // circle's; measuring on RESAMPLED points manufactures the missing
  // midpoints, and a square's spread reaches the true √2 ≈ 1.41
  // regardless of size (measured: blobs 1.09–1.19, circles ~1.0–1.2,
  // squares 1.41 → threshold 1.30).
  if (radialSpread(resamplePath(pts, CNOT_TARGET_RESAMPLE), b) > CNOT_RECTANGLE_SPREAD) {
    return false;
  }

  // Roughly closed: even a lumpy blob comes back to its start.
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) > CNOT_CIRCLE_CLOSURE * across) {
    return false;
  }
  return true;
}

// A control DOT: a single tap, or a tiny scribble. (An H crossbar is
// also small, but the gate recognizer already had its chance on the
// group before this matters.)
function isCnotDot(stroke) {
  if (stroke.points.length === 1) return true;
  const b = pointsBox(stroke.points);
  return b.w < CNOT_DOT_MAX && b.h < CNOT_DOT_MAX;
}

// Every wire row from cy to ty inclusive (sorted wires only — a gap
// with no wire cannot hold a gate, so it needs no slot).
function wireRowsBetween(wires, cy, ty) {
  const lo = Math.min(cy, ty), hi = Math.max(cy, ty);
  const rows = [];
  for (const w of wires) {
    if (w.y >= lo && w.y <= hi) rows.push(w.y);
  }
  return rows;
}

// The ONE engine both public doors share. Returns
//   { reason: null, cy, ty, col, used } — a full verdict, or
//   { reason: "sentence" }              — a loud rejection, or
//   { reason: null } with no cy         — silent: not a CNOT.
// `group` is a list of stroke objects (drawing.js maps indices to
// objects first, same as tryCommitGate).
function cnotVerdict(group, wires, circuit) {
  // 1. Find THE connector: exactly one tall near-vertical stroke.
  //    Zero (letter/wire) or two+ (confusing ink) → silent.
  let connector = null;
  let connectorCount = 0;
  for (const s of group) {
    if (!isCnotConnector(s)) continue;
    connectorCount++;
    connector = s;
  }
  if (connectorCount !== 1) return { reason: null };

  // 2. Both ends (first/last points) must land on TWO DIFFERENT
  //    wires. Same row → letter stroke on one wire (the H guard):
  //    silent, the gate recognizer takes over.
  const pts = connector.points;
  const first = pts[0], last = pts[pts.length - 1];
  const w1 = wireAtEnd(first.x, first.y, wires);
  const w2 = wireAtEnd(last.x, last.y, wires);
  if (!w1 || !w2) return { reason: null };
  if (w1.y === w2.y) return { reason: null };

  // 3. The target circle: a loop among the other strokes that sits
  //    on a wire (same test gate boxes use) AND on one of the
  //    connector's end wires. First in drawing order wins.
  const others = group.filter((s) => s !== connector);
  let circle = null, circleWire = null;
  for (const s of others) {
    if (!isCnotTarget(s)) continue;
    const b = pointsBox(s.points);
    const w = wireUnderBox(b, wires);
    if (!w) continue;
    if (w.y !== w1.y && w.y !== w2.y) continue;
    circle = s;
    circleWire = w;
    break;
  }
  // A connector touching two wires with no circle on either end is
  // a CNOT attempt — say so, stay ink (the loud case).
  if (!circle) return { reason: "A CNOT needs a circle on the target wire." };

  // 4. The circle's wire IS the target; the other end is the control.
  const ty = circleWire.y;
  const cy = ty === w1.y ? w2.y : w1.y;
  const controlEnd = ty === w1.y ? last : first;

  // 5. A plus INSIDE the circle (its middle near the circle's middle)
  //    is consumed with the target; the rest are dot candidates.
  const circleBox = pointsBox(circle.points);
  const circleAcross = Math.max(circleBox.w, circleBox.h);
  const plus = [];
  const rest = [];
  for (const s of others) {
    if (s === circle) continue;
    const b = pointsBox(s.points);
    const d = Math.hypot(b.cx - circleBox.cx, b.cy - circleBox.cy);
    if (d < circleAcross * 0.75) plus.push(s);
    else rest.push(s);
  }

  // 6. Optional control dot near the connector's control END. Far
  //    dots are NOT consumed — a lone dot on a wire must survive as
  //    ink (tests assert this).
  let dot = null;
  for (const s of rest) {
    if (!isCnotDot(s)) continue;
    const b = pointsBox(s.points);
    if (Math.hypot(b.cx - controlEnd.x, b.cy - controlEnd.y) < CNOT_DOT_NEAR) {
      dot = s;
      break;
    }
  }

  // 7. Time column from the connector's mean x — same formula and
  //    clamp as boxed gates use.
  let sumX = 0;
  for (const p of pts) sumX += p.x;
  const col = columnForX(sumX / pts.length);

  // 8. The connector may CROSS middle wires, but their slots in this
  //    column must still be free. Any clash → loud rejection.
  for (const r of wireRowsBetween(wires, cy, ty)) {
    if (gateSlotTaken(circuit, r, col)) {
      return { reason: "That column is already used between those wires." };
    }
  }

  // 9. Full verdict: rows (never qubit numbers), column, and exactly
  //    the strokes that belong to this CNOT.
  const used = [connector, circle];
  if (dot) used.push(dot);
  for (const s of plus) used.push(s);
  return { reason: null, cy: cy, ty: ty, col: col, used: used };
}

// Public door for committing (shape: {cy, ty, col, used} or null).
// drawing.js commits only on a non-null answer.
function recognizeCnot(group, wires, circuit) {
  const v = cnotVerdict(group, wires, circuit);
  if (v.reason === null && v.used) {
    return { cy: v.cy, ty: v.ty, col: v.col, used: v.used };
  }
  return null;
}

// Public door for explaining: when recognizeCnot said null, was it a
// loud rejection (a sentence to show) or a silent one (let the boxed-
// gate recognizer try)? Runs the same engine — pure and cheap.
function cnotRejection(group, wires, circuit) {
  const v = cnotVerdict(group, wires, circuit);
  return v.reason;
}

// Built-in letter templates: one clean example per letter, drawn as
// plain polylines in an abstract 0–100 space (size/position are
// normalized away). Teach mode adds the user's own examples, saved
// to localStorage by teach.js. Shape: label → [examples] →
// [strokes] → [{x, y}].

const DEFAULT_TEMPLATES = {
  H: [
    [
      [{ x: 25, y: 10 }, { x: 25, y: 90 }],
      [{ x: 75, y: 10 }, { x: 75, y: 90 }],
      [{ x: 25, y: 50 }, { x: 75, y: 50 }],
    ],
  ],
  X: [
    [
      [{ x: 25, y: 15 }, { x: 75, y: 85 }],
      [{ x: 75, y: 15 }, { x: 25, y: 85 }],
    ],
  ],
  Z: [
    [
      [{ x: 15, y: 15 }, { x: 85, y: 15 }, { x: 15, y: 85 }, { x: 85, y: 85 }],
    ],
  ],
  // R — rotation gate: left stem, then one continuous path around
  // the bump and out the leg. X and Z share diagonal ink with R;
  // the direction fingerprint separates them (R's bump curves,
  // theirs cut).
  R: [
    [
      [{ x: 25, y: 10 }, { x: 25, y: 90 }],
      [
        { x: 26, y: 12 }, { x: 52, y: 14 }, { x: 66, y: 28 },
        { x: 60, y: 44 }, { x: 30, y: 52 },
        { x: 48, y: 64 }, { x: 70, y: 90 },
      ],
    ],
  ],
  // BLOCK letters A–F: meaningful only when state.blocks has a
  // definition of the same name; drawing.js turns a recognized A–F
  // into a block placement (or explains that none exists yet).
  A: [
    [
      [{ x: 15, y: 90 }, { x: 50, y: 10 }, { x: 85, y: 90 }],
      [{ x: 30, y: 60 }, { x: 70, y: 60 }],
    ],
  ],
  B: [
    [
      [{ x: 25, y: 10 }, { x: 25, y: 90 }],
      [
        { x: 25, y: 10 }, { x: 60, y: 13 }, { x: 70, y: 28 },
        { x: 60, y: 46 }, { x: 26, y: 50 },
        { x: 64, y: 56 }, { x: 70, y: 76 }, { x: 56, y: 88 }, { x: 25, y: 90 },
      ],
    ],
  ],
  C: [
    [
      [{ x: 80, y: 22 }, { x: 54, y: 9 }, { x: 26, y: 22 },
       { x: 15, y: 50 }, { x: 27, y: 78 }, { x: 55, y: 91 }, { x: 80, y: 78 }],
    ],
  ],
  D: [
    [
      [{ x: 25, y: 10 }, { x: 25, y: 90 }],
      [
        { x: 25, y: 10 }, { x: 58, y: 15 }, { x: 74, y: 36 },
        { x: 72, y: 64 }, { x: 56, y: 86 }, { x: 25, y: 90 },
      ],
    ],
  ],
  E: [
    [
      [{ x: 70, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 90 }, { x: 70, y: 90 }],
      [{ x: 25, y: 48 }, { x: 62, y: 48 }],
    ],
  ],
  F: [
    [
      [{ x: 70, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 90 }],
      [{ x: 25, y: 48 }, { x: 60, y: 48 }],
    ],
  ],
};

// Test hook: tests run this file under node too (tests/test-stage5.js).
// In the browser the hook does nothing. NOTE: tuning constants are
// computed from canvas.js's GRID_SIZE at load time — node tests shim
// GRID_SIZE/COLUMN_ORIGIN/COLUMN_WIDTH BEFORE requiring this file.
if (typeof module !== "undefined") {
  module.exports = {
    pointsBox, boxesNear, detectWire, recognizeStroke, groupStrokes,
    isBox, recognizeGate, gateSlotTaken, columnForX, DEFAULT_TEMPLATES,
    isCnotConnector, isCnotTarget, isCnotDot, wireRowsBetween,
    recognizeCnot, cnotRejection,
  };
}
