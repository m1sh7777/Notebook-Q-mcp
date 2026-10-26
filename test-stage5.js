/* ============================================================
   test-stage5.js — STAGE 5 tests. Run with plain node:
       node tests/test-stage5.js
   ------------------------------------------------------------
   Same idea as test-stage4.js: everything under test is PURE,
   so node can run it with no browser. One new wrinkle: this
   stage also tests the RECOGNIZER (recognizeCnot), which lives
   in recognize.js — a browser file whose tuning constants are
   computed from canvas.js's GRID_SIZE at LOAD time. So the shim
   below must come BEFORE the require: it mirrors canvas.js's
   three layout constants (change canvas.js → change these).

   The kit: check(name, ok, detail), approx() for floats (1/√2
   again), label() = the SAME bar-naming rule panel.js uses.
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
function approx(a, b) { return Math.abs(a - b) < 1e-9; }
function label(k, n) { return k.toString(2).padStart(n, "0"); }

/* ---- 1. Bell state: H on q0, CNOT(q0→q1) → 50% 00 + 50% 11. ---
   H splits the control into 00 + 10; the CNOT copies the flip
   onto the target → 00 + 11. The 0% on 01/10 IS entanglement. -- */
{
  const probs = sim.simulate([
    { gate: "H", q: 0, col: 0 },
    { gate: "CNOT", c: 0, t: 1, col: 1 },
  ], 2);
  const ok =
    approx(probs[0], 0.5) && approx(probs[3], 0.5) &&
    probs[1] === 0 && probs[2] === 0 &&
    label(0, 2) === "00" && label(3, 2) === "11";
  check("1. H then CNOT(q0->q1) → 50% 00 + 50% 11 (Bell state)", ok,
    JSON.stringify(probs));
}

/* ---- 2. X on q0 then CNOT(q0→q1) → 100% 11. -------------------
   X puts the control certainly at 1, so the CNOT flips the
   target with certainty: 10 → 11. ------------------------------- */
{
  const probs = sim.simulate([
    { gate: "X", q: 0, col: 0 },
    { gate: "CNOT", c: 0, t: 1, col: 1 },
  ], 2);
  check("2. X then CNOT(q0->q1) → 100% 11",
    approx(probs[3], 1) && probs[0] === 0 && probs[1] === 0 && probs[2] === 0,
    JSON.stringify(probs));
}

/* ---- 3. CNOT with no preparation → 100% 00. -------------------
   The control starts at 0, and control-0 means "do nothing". --- */
{
  const probs = sim.simulate([{ gate: "CNOT", c: 0, t: 1, col: 0 }], 2);
  check("3. CNOT alone → 100% 00 (control is 0)",
    approx(probs[0], 1) && probs[1] === 0 && probs[2] === 0 && probs[3] === 0,
    JSON.stringify(probs));
}

/* ---- 4. CNOT twice = identity. --------------------------------
   A conditional swap undone by itself — CNOT is its own inverse. */
{
  const probs = sim.simulate([
    { gate: "X", q: 1, col: 0 }, // sprinkle some asymmetry: start |01⟩
    { gate: "CNOT", c: 0, t: 1, col: 1 },
    { gate: "CNOT", c: 0, t: 1, col: 2 },
  ], 2);
  check("4. CNOT twice → identity (01 stays 01)",
    approx(probs[1], 1) && probs[0] === 0 && probs[2] === 0 && probs[3] === 0,
    JSON.stringify(probs));
}

/* ---- 5. Control BELOW the target: X on q1, CNOT(q1→q0). -------
   The convention must not care which wire is on top: control q1
   (bottom) is 1 after X, so it flips q0 → 01 becomes 11. -------- */
{
  const probs = sim.simulate([
    { gate: "X", q: 1, col: 0 },
    { gate: "CNOT", c: 1, t: 0, col: 1 },
  ], 2);
  check("5. X on q1 then CNOT(q1->q0) → 100% 11 (control below)",
    approx(probs[3], 1) && probs[0] === 0 && probs[1] === 0 && probs[2] === 0,
    JSON.stringify(probs));
}

/* ---- 6. Three qubits: the GHZ chain. --------------------------
   H on q0, then CNOT down the line: each CNOT copies its
   control's coin-flip onto the next qubit → only 000 and 111
   survive, 50/50. Three entangled qubits. ----------------------- */
{
  const probs = sim.simulate([
    { gate: "H", q: 0, col: 0 },
    { gate: "CNOT", c: 0, t: 1, col: 1 },
    { gate: "CNOT", c: 1, t: 2, col: 2 },
  ], 3);
  const ok =
    approx(probs[0], 0.5) && approx(probs[7], 0.5) &&
    probs.slice(1, 7).every((p) => p === 0) &&
    label(0, 3) === "000" && label(7, 3) === "111";
  check("6. H, CNOT, CNOT on three qubits → 50% 000 + 50% 111", ok,
    JSON.stringify(probs));
}

/* ---- 7. A wire above everything: numbers shift, rows don't. ---
   The circuit entry stores cy/ty ROWS; toSimInput derives qubit
   numbers from the sorted wire list. Slide a new wire in above:
   same entry object, new numbers. ------------------------------- */
{
  const wires2 = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const circuit = [
    { gate: "CNOT", cy: 200, ty: 240, col: 0 },
    { gate: "H", y: 200, col: 1 },
  ];
  const before = sim.toSimInput(wires2, circuit);
  const beforeOk =
    before.n === 2 &&
    before.ops[0].gate === "CNOT" && before.ops[0].c === 0 && before.ops[0].t === 1 &&
    before.ops[1].gate === "H" && before.ops[1].q === 0;

  const wires3 = [{ y: 160, x1: 80, x2: 400 }, ...wires2]; // NEW wire above
  const after = sim.toSimInput(wires3, circuit); // SAME circuit entries
  const afterOk =
    after.n === 3 &&
    after.ops[0].gate === "CNOT" && after.ops[0].c === 1 && after.ops[0].t === 2 &&
    after.ops[1].gate === "H" && after.ops[1].q === 1 &&
    circuit[0].cy === 200 && circuit[0].ty === 240; // the STORED rows never moved

  check("7. wire above: CNOT c0→c1, t1→t2; stored cy/ty untouched",
    beforeOk && afterOk,
    JSON.stringify({ before: before, after: after }));
}

/* ---- 8. applyCnot does not modify its input list. -------------- */
{
  const amps = [0.7, 0, 0.7, 0]; // mid-Bell superposition
  const copy = amps.slice();
  sim.applyCnot(amps, 0, 1, 2);
  check("8. applyCnot leaves its input untouched",
    amps.length === copy.length && amps.every((v, i) => v === copy[i]));
}

/* ---- 9. Validator: orphan CNOT end flagged; collision flagged. - */
{
  const wires = [
    { y: 160, x1: 80, x2: 400 },
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const orphan = sim.validateCircuit(wires, [
    { gate: "CNOT", cy: 160, ty: 999, col: 0 }, // target end on no wire
  ]);
  const collision = sim.validateCircuit(wires, [
    { gate: "H", y: 200, col: 1 },               // sits in the middle...
    { gate: "CNOT", cy: 160, ty: 240, col: 1 },  // ...of this CNOT's span
  ]);
  const clean = sim.validateCircuit(wires, [
    { gate: "H", y: 200, col: 0 },
    { gate: "CNOT", cy: 160, ty: 240, col: 1 }, // different column → fine
  ]);
  check("9. validator: orphan end flagged, span collision flagged, clean clean",
    orphan.length === 1 && collision.length === 1 && clean.length === 0,
    JSON.stringify({ orphan: orphan, collision: collision }));
}

/* ---- 10. recognizeCnot on synthetic hand-drawn strokes. --------
   (a) A wobbly connector (drift ≈ 20%) + a lumpy blob → the
       right cy, ty, col and exactly two consumed strokes.
   (b) The same connector with NO circle → null (loud case).
   (c) An H's two verticals inside a box → null (silent).
   (d) A tall vertical on ONE wire (both ends same row) → null
       — the guard that keeps letter strokes safe. --------------- */
{
  // A wobbly line from (200,160) to (212,240): height 80, drift ~16
  // → 20% — inside the 25% budget; both ends within 20px of a row.
  const connector = { points: [{ x: 200, y: 160 }] };
  for (let i = 1; i < 24; i++) {
    const t = i / 23;
    connector.points.push({
      x: 200 + 12 * t + 2 * Math.sin(i * 1.7), // ±2px wobble
      y: 160 + 80 * t,
    });
  }
  connector.points.push({ x: 212, y: 240 });

  // A lumpy blob around (206,240), radius ~9 ± wobble, not quite
  // closing (ends 10° early — hand-drawn circles never meet).
  const blob = { points: [] };
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI * 0.972; // ~350°
    blob.points.push({
      x: 206 + 9 * Math.cos(a) + Math.sin(i * 2.3),
      y: 240 + 9 * Math.sin(a) + Math.cos(i * 1.9),
    });
  }

  const wires = [
    { y: 160, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];

  const hit = rec.recognizeCnot([connector, blob], wires, []);
  const a = !!hit && hit.cy === 160 && hit.ty === 240 && hit.col === 2 &&
    hit.used.length === 2 &&
    hit.used.indexOf(connector) !== -1 && hit.used.indexOf(blob) !== -1;

  const b = rec.recognizeCnot([connector], wires, []) === null &&
    rec.cnotRejection([connector], wires, []) ===
      "A CNOT needs a circle on the target wire.";

  // An H inside a normal box: two ~30px verticals + a crossbar —
  // no stroke is tall enough to be a connector → silent null.
  const box = { points: [
    { x: 184, y: 184 }, { x: 216, y: 184 }, { x: 216, y: 216 },
    { x: 184, y: 216 }, { x: 184, y: 184 },
  ] };
  const v1 = { points: [{ x: 192, y: 188 }, { x: 192, y: 212 }] };
  const v2 = { points: [{ x: 208, y: 188 }, { x: 208, y: 212 }] };
  const c = rec.recognizeCnot([box, v1, v2], wires, []) === null &&
    rec.cnotRejection([box, v1, v2], wires, []) === null;

  // A tall vertical whose BOTH ends hug ONE wire row (200): the
  // two-different-rows rule must reject it silently.
  const letterTall = { points: [{ x: 300, y: 182 }, { x: 302, y: 218 }] };
  const wiresOne = [{ y: 200, x1: 80, x2: 400 }, { y: 240, x1: 80, x2: 400 }];
  const d = rec.recognizeCnot([letterTall], wiresOne, []) === null &&
    rec.cnotRejection([letterTall], wiresOne, []) === null;

  check("10. recognizer: blob CNOT found; no circle → loud null; H verticals → silent null; one-wire vertical → silent null",
    a && b && c && d,
    JSON.stringify({ hit: hit }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
