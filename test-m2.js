/* ============================================================
   test-m2.js — M2 tests (variables + the R rotation). Plain node:
       node tests/test-m2.js
   ------------------------------------------------------------
   The physics of R in three anchor points (all real arithmetic,
   no complex numbers):
     R(0)    → identity            (nothing happens)
     R(pi)   → acts like X on |0⟩  (half a turn = a flip)
     R(pi/2) → a fair 50/50 coin   (quarter turn)
   Plus the plumbing that makes variables real: name → number is
   resolved in toSimInput (never stored), and the validator speaks
   plainly when a variable is missing or holds no number.
   ============================================================ */

globalThis.GRID_SIZE = 40;
globalThis.COLUMN_ORIGIN = 40;
globalThis.COLUMN_WIDTH = 80;

const sim = require("../js/simulator.js");

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-9; }
const PI = Math.PI;

/* ---- 1–3. The three anchor points of the rotation. ------------ */
{
  const p0 = sim.simulate([{ gate: "R", q: 0, col: 0, angle: 0 }], 1);
  const pPi = sim.simulate([{ gate: "R", q: 0, col: 0, angle: PI }], 1);
  const pHalf = sim.simulate([{ gate: "R", q: 0, col: 0, angle: PI / 2 }], 1);
  check("1. R(0) leaves the odds unchanged (100% on 0)",
    approx(p0[0], 1) && approx(p0[1], 0), JSON.stringify(p0));
  check("2. R(pi) acts like X on |0> (100% on 1)",
    approx(pPi[0], 0) && approx(pPi[1], 1), JSON.stringify(pPi));
  check("3. R(pi/2) is a fair coin (50% / 50%)",
    approx(pHalf[0], 0.5) && approx(pHalf[1], 0.5), JSON.stringify(pHalf));
}

/* ---- 4. The angle is a DIAL, not a switch: R(pi/4) lands where
   the math says — cos²(pi/8) ≈ 0.8536 on "0". One more anchor to
   prove it's a rotation, not a lookup table. -------------------- */
{
  const p = sim.simulate([{ gate: "R", q: 0, col: 0, angle: PI / 4 }], 1);
  const want = Math.cos(PI / 8) * Math.cos(PI / 8);
  check("4. R(pi/4) → cos²(pi/8) on 0 (a real dial, not a switch)",
    approx(p[0], want), JSON.stringify({ got: p[0], want: want }));
}

/* ---- 5. Variables resolve in toSimInput — the NAME is stored,
   the NUMBER is looked up at the last moment. -------------------- */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const circuit = [{ gate: "R", y: 200, col: 0, angle: "theta" }];
  const withVar = sim.toSimInput(wires, circuit, {}, { theta: 1.5707963267948966 });
  const noVar = sim.toSimInput(wires, circuit, {}, {});
  check("5. toSimInput resolves the variable NAME to a NUMBER; missing → op skipped",
    withVar.ops.length === 1 && approx(withVar.ops[0].angle, PI / 2) &&
    noVar.ops.length === 0,
    JSON.stringify({ withVar: withVar.ops, noVar: noVar.ops }));
}

/* ---- 6. Editing a variable moves the bars (the live-update
   contract, node side): same circuit, new value, different odds. - */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const circuit = [{ gate: "R", y: 200, col: 0, angle: "theta" }];
  const run = (vars) => {
    const s = sim.toSimInput(wires, circuit, {}, vars);
    return sim.simulate(s.ops, s.n);
  };
  const a = run({ theta: PI / 2 }); // 50/50
  const b = run({ theta: PI });     // 100% on 1
  check("6. same drawing, theta 1.57→3.14: bars move without touching the circuit",
    approx(a[0], 0.5) && approx(b[1], 1),
    JSON.stringify({ a: a, b: b }));
}

/* ---- 7. Validator: the two R problems, in plain English. ------- */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const noAngle = sim.validateCircuit(wires, [
    { gate: "R", y: 200, col: 0 }, // angle never picked
  ], {}, {});
  const notNumber = sim.validateCircuit(wires, [
    { gate: "R", y: 200, col: 0, angle: "theta" },
  ], {}, { theta: "wobble" }); // a variable holding text
  const clean = sim.validateCircuit(wires, [
    { gate: "R", y: 200, col: 0, angle: "theta" },
  ], {}, { theta: 1.57 });
  check("7. validator: missing angle → 1 sentence; non-number variable → 1 sentence; numeric → clean",
    noAngle.length === 1 && noAngle[0].indexOf("no angle variable") !== -1 &&
    notNumber.length === 1 && notNumber[0].indexOf("does not hold a number") !== -1 &&
    clean.length === 0,
    JSON.stringify({ noAngle: noAngle, notNumber: notNumber }));
}

/* ---- 8. An R inside a block: expansion keeps the NAME, and the
   variable resolves after stamping (block + variable compose). --- */
{
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const blocks = {
    A: { wires: 1, gates: [{ gate: "R", y: 0, col: 0, angle: "theta" }] },
  };
  const circuit = [
    { gate: "BLOCK", name: "A", y: 200, col: 0 },
    { gate: "BLOCK", name: "A", y: 240, col: 1 },
  ];
  const s = sim.toSimInput(wires, circuit, blocks, { theta: PI });
  const probs = sim.simulate(s.ops, s.n);
  // Two R(pi) rotations on two qubits → 100% on "11".
  check("8. block with R(pi) placed on both wires → 100% 11 (name survives expansion)",
    approx(probs[3], 1) && s.ops.length === 2 &&
    approx(s.ops[0].angle, PI) && approx(s.ops[1].angle, PI),
    JSON.stringify({ ops: s.ops, probs: probs }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
