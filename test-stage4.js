/* ============================================================
   test-stage4.js — STAGE 4 tests. Run with plain node:
       node tests/test-stage4.js
   ------------------------------------------------------------
   WHY this file can exist with no browser, no canvas, no DOM:
   everything it tests lives in js/simulator.js, which is PURE —
   it reads only its arguments and returns new arrays. That was
   the whole point of the pure-function discipline; this file is
   where the payoff is collected. (recognize.js is pure too, so
   a future test could feed it fake strokes the same way.)

   No test framework — a circuit's worth of honesty is enough:
   check(name, ok, detail) prints one line per verdict, and the
   process exits 1 if anything failed (so a CI could call it).
   ============================================================ */

const sim = require("../js/simulator.js");

let passed = 0;
let failed = 0;

/* Tiny test kit. Floats never compare equal exactly (1/√2 is
   irrational — H's "50%" genuinely arrives as 0.4999999...),
   so approx() allows a 1e-9 tolerance. label() is the SAME
   rule panel.js uses for bar names: index → binary, q0 left. */
function check(name, ok, detail) {
  if (ok) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-9; }
function label(k, n) { return k.toString(2).padStart(n, "0"); }

/* ---- 1. One wire, H → 50/50. --------------------------------- */
{
  const probs = sim.simulate([{ gate: "H", q: 0, col: 0 }], 1);
  check("1. one wire, H once → 50% on 0, 50% on 1",
    approx(probs[0], 0.5) && approx(probs[1], 0.5),
    JSON.stringify(probs));
}

/* ---- 2. H twice → 100% zeros. ---------------------------------
   H splits, H re-joins: averaging twice undoes itself. --------- */
{
  const probs = sim.simulate([
    { gate: "H", q: 0, col: 0 },
    { gate: "H", q: 0, col: 1 },
  ], 1);
  check("2. H then H → 100% on 0",
    approx(probs[0], 1) && approx(probs[1], 0),
    JSON.stringify(probs));
}

/* ---- 3. X → 100% on 1. ---------------------------------------- */
{
  const probs = sim.simulate([{ gate: "X", q: 0, col: 0 }], 1);
  check("3. X alone → 100% on 1",
    approx(probs[0], 0) && approx(probs[1], 1),
    JSON.stringify(probs));
}

/* ---- 4. H, Z, H → 100% on 1 (the sign trick). ------------------
   Z alone is invisible (squares hide signs), but it flips the
   sign of the "1" half WHILE the qubit is split, so the second H
   averages + and − instead of + and + → difference = all odds
   on 1. Z behaving like X is phase kickback, made visible. ----- */
{
  const probs = sim.simulate([
    { gate: "H", q: 0, col: 0 },
    { gate: "Z", q: 0, col: 1 },
    { gate: "H", q: 0, col: 2 },
  ], 1);
  check("4. H then Z then H → 100% on 1",
    approx(probs[0], 0) && approx(probs[1], 1),
    JSON.stringify(probs));
}

/* ---- 5. Two wires, H on the TOP wire → 50% "00" + 50% "10". ----
   The LABELS are the point: q0 is the LEFTMOST bit (simulator.js
   banner), so lighting q0 must light "10" — if this printed
   "01" the convention would be inverted. ------------------------ */
{
  const probs = sim.simulate([{ gate: "H", q: 0, col: 0 }], 2);
  const lit = probs
    .map((p, k) => ({ p: p, label: label(k, 2) }))
    .filter((x) => x.p > 0.01);
  const ok =
    approx(probs[0], 0.5) && approx(probs[2], 0.5) &&
    probs[1] === 0 && probs[3] === 0 &&      // untouched pairs: exactly 0
    lit.length === 2 &&
    lit[0].label === "00" && lit[1].label === "10";
  check("5. two wires, H on top → 50% 00 + 50% 10 (labels!)", ok,
    JSON.stringify(probs));
}

/* ---- 6. New wire ABOVE everything → same gates, new numbers. ---
   Gates are anchored to wire ROWS; qubit numbers are derived at
   sim time from the sorted rows. Slide a fresh wire in above and
   the SAME gates must come out one qubit higher, same columns. */
{
  const twoWires = [
    { y: 200, x1: 80, x2: 400 }, // will be q0...
    { y: 240, x1: 80, x2: 400 }, // ...and q1
  ];
  const circuit = [
    { gate: "H", y: 200, col: 0 }, // on the top wire
    { gate: "X", y: 240, col: 1 }, // on the bottom wire
  ];

  const convBefore = sim.toSimInput(twoWires, circuit);
  const beforeOk =
    convBefore.n === 2 &&
    convBefore.ops[0].gate === "H" && convBefore.ops[0].q === 0 &&
    convBefore.ops[0].col === 0 &&
    convBefore.ops[1].gate === "X" && convBefore.ops[1].q === 1 &&
    convBefore.ops[1].col === 1;

  const threeWires = [
    { y: 160, x1: 80, x2: 400 }, // NEW wire above everything
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const convAfter = sim.toSimInput(threeWires, circuit); // SAME circuit object
  const afterOk =
    convAfter.n === 3 &&
    convAfter.ops.length === 2 && // same gates, none lost, none added
    convAfter.ops[0].gate === "H" && convAfter.ops[0].q === 1 &&
    convAfter.ops[0].col === 0 &&
    convAfter.ops[1].gate === "X" && convAfter.ops[1].q === 2 &&
    convAfter.ops[1].col === 1;

  check("6. wire drawn above: H q0→q1, X q1→q2, columns kept",
    beforeOk && afterOk,
    JSON.stringify({ before: convBefore, after: convAfter }));
}

/* ---- Bonus A: applyGate is pure — the input list survives. ---- */
{
  const amps = [1, 0];
  const copy = amps.slice();
  sim.applyGate(amps, sim.GATES.H, 0, 1);
  check("A. applyGate leaves its input untouched",
    amps.length === copy.length && amps.every((v, i) => v === copy[i]));
}

/* ---- Bonus B: validateCircuit speaks plain English. ------------ */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const orphan = sim.validateCircuit(wires, [{ gate: "X", y: 999, col: 0 }]);
  const unknown = sim.validateCircuit(wires, [{ gate: "Q", y: 200, col: 0 }]);
  const clean = sim.validateCircuit(wires, [{ gate: "H", y: 200, col: 0 }]);
  const empty = sim.validateCircuit([], []); // zero wires → NOT a problem
  check("B. validator: orphan flagged, unknown flagged, clean clean, empty silent",
    orphan.length === 1 && unknown.length === 1 &&
    clean.length === 0 && empty.length === 0,
    JSON.stringify({ orphan: orphan, unknown: unknown }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
