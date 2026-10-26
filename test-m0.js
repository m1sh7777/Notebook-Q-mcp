/* ============================================================
   test-m0.js — M0 fix tests. Run with plain node:
       node tests/test-m0.js
   ------------------------------------------------------------
   M0 is three small honest fixes, and each gets proof:
   (a) target size: 70px blobs are targets now, neat squares of
       ANY size (40px or 70px, dense or corner-only sampling)
       are still rejected — the resampled corner-ness numbers.
   (b) a same-wire CNOT produces exactly ONE validator problem,
       whether or not a wire exists under it.
   (c) the "invisible Z" hint rule (phaseHint) fires only when
       the sign truly cannot show up in the odds.
   Same shim as test-stage5.js: recognize.js's tuning constants
   are computed from canvas.js's GRID_SIZE at load time, so the
   shims must exist BEFORE the require.
   ============================================================ */

// -- The canvas.js shim, BEFORE the require (see header). --
globalThis.GRID_SIZE = 40;
globalThis.COLUMN_ORIGIN = 40;
globalThis.COLUMN_WIDTH = 80;

const sim = require("../js/simulator.js");
const rec = require("../js/recognize.js");

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}

/* ---- Stroke factories (the same ones the measurements used). -- */

// A lumpy blob: circle sweeping ~350° with wobble. r = target radius.
function blob(cx, cy, r) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI * 0.972;
    pts.push({
      x: cx + r * Math.cos(a) + Math.sin(i * 2.3),
      y: cy + r * Math.sin(a) + Math.cos(i * 1.9),
    });
  }
  return { points: pts };
}

// A NEAT square, corner-only sampling (5 points) — the hole the old
// raw-spread check could not see: no edge-midpoint samples at all.
function square5(x, y, s) {
  return { points: [
    { x: x,     y: y     }, { x: x + s, y: y     },
    { x: x + s, y: y + s }, { x: x,     y: y + s },
    { x: x,     y: y     },
  ] };
}

// A NEAT square, dense sampling (points along the edges too).
function squareDense(x, y, s) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * 4; // walk the perimeter: 4 sides
    const side = Math.floor(t), f = t - side;
    const c = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]][side];
    const n = [[x + s, y], [x + s, y + s], [x, y + s], [x, y], [x, y]][side];
    pts.push({ x: c[0] + (n[0] - c[0]) * f, y: c[1] + (n[1] - c[1]) * f });
  }
  return { points: pts };
}

/* ---- 1. A ~70px blob IS a target now (M0a's whole point). ----- */
{
  const big = blob(206, 240, 35); // ~70px across
  check("1. 70px blob passes isCnotTarget",
    rec.isCnotTarget(big),
    "size limit is now 1.9*GRID = 76px; blob measured ~70px");
}

/* ---- 2. A 70px blob + connector + wires → full CNOT verdict. --- */
{
  const connector = { points: [{ x: 200, y: 160 }] };
  for (let i = 1; i < 24; i++) {
    const t = i / 23;
    connector.points.push({ x: 200 + 8 * t, y: 160 + 80 * t });
  }
  connector.points.push({ x: 208, y: 240 });
  const wires = [
    { y: 160, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const hit = rec.recognizeCnot([connector, blob(206, 240, 35)], wires, []);
  check("2. 70px blob committed as a real CNOT target",
    !!hit && hit.cy === 160 && hit.ty === 240,
    JSON.stringify(hit));
}

/* ---- 3. Neat squares are STILL rejected, at every size. -------- */
{
  const ok =
    !rec.isCnotTarget(squareDense(100, 100, 40)) &&   // 40px, dense
    !rec.isCnotTarget(squareDense(100, 100, 70)) &&   // 70px, dense
    !rec.isCnotTarget(square5(100, 100, 40)) &&       // 40px, corners only
    !rec.isCnotTarget(square5(100, 100, 70));         // 70px, corners only
  check("3. neat squares 40px/70px, dense/corner-sampled → all rejected", ok,
    "resampled corner-ness: squares 1.41 > 1.30 threshold");
}

/* ---- 4. Same-wire CNOT → exactly ONE problem (M0b). ------------ */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const onWire = sim.validateCircuit(wires, [
    { gate: "CNOT", cy: 200, ty: 200, col: 0 },
  ]);
  const offWire = sim.validateCircuit(wires, [
    { gate: "CNOT", cy: 999, ty: 999, col: 0 }, // no wire anywhere either
  ]);
  check("4. same-wire CNOT → exactly 1 problem (wire present or not)",
    onWire.length === 1 && offWire.length === 1,
    JSON.stringify({ onWire: onWire, offWire: offWire }));
}

/* ---- 5. phaseHint: fires only for a truly hidden sign (M0c). --- */
{
  const hidden = sim.phaseHint([{ gate: "Z", y: 200, col: 1 }]);
  const visible = sim.phaseHint([
    { gate: "Z", y: 200, col: 1 },
    { gate: "H", y: 200, col: 2 }, // a later H mixes the sign into the odds
  ]);
  const noZ = sim.phaseHint([{ gate: "H", y: 200, col: 0 }]);
  const hTooEarly = sim.phaseHint([
    { gate: "H", y: 200, col: 0 }, // H BEFORE the Z does not help
    { gate: "Z", y: 200, col: 1 },
  ]);
  check("5. phaseHint: Z alone → note; Z then H → silent; no Z → silent; H before Z → note",
    typeof hidden === "string" && visible === null &&
    noZ === null && typeof hTooEarly === "string",
    JSON.stringify({ hidden: hidden, visible: visible, hTooEarly: hTooEarly }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
