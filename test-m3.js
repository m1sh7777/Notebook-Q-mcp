/* ============================================================
   test-m3.js — M3 tests (reusable blocks). Plain node:
       node tests/test-m3.js
   ------------------------------------------------------------
   The spec's three headline behaviors, plus the guard rails:
   • a block containing H then CNOT, placed on wires 0–1, makes
     the Bell state (the block is a REAL circuit fragment);
   • the SAME block placed one wire down on a 3-wire circuit gives
     50% 000 / 50% 111 on q1,q2 (relative rows → any home);
   • a self-containing block is rejected with a plain sentence.
   Plus: indirect cycles, missing definitions, "doesn't fit",
   gateSlotTaken inside a placed block's frame, and an R + CNOT
   block composing with variables.
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
function label(k, n) { return k.toString(2).padStart(n, "0"); }

/* The canonical Bell-maker block: H on the block's top wire,
   then a CNOT from wire 0 to wire 1 (relative indices). */
const bellDef = {
  wires: 2,
  cols: 2,
  gates: [
    { gate: "H", y: 0, col: 0 },
    { gate: "CNOT", cy: 0, ty: 1, col: 1 },
  ],
};

/* ---- 1. Bell block on wires 0–1 → 50% 00 + 50% 11. ------------ */
{
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const s = sim.toSimInput(wires, [{ gate: "BLOCK", name: "A", y: 200, col: 0 }], { A: bellDef });
  const probs = sim.simulate(s.ops, s.n);
  check("1. block (H then CNOT) on wires 0-1 → Bell state",
    approx(probs[0], 0.5) && approx(probs[3], 0.5) &&
    probs[1] === 0 && probs[2] === 0,
    JSON.stringify(probs));
}

/* ---- 2. Same block, one wire down on 3 wires: q0 stays |0⟩, the
   Bell pair lives on q1,q2 → 50% "000" + 50% "011". (Writing 111
   here was MY test's typo — the run caught it: the simulator was
   right, because q0 never moves.) ----------------- */
{
  const wires = [
    { y: 160, x1: 80, x2: 400 },
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  // Placed at row 200 = wire rank 1 (the middle wire).
  const s = sim.toSimInput(wires, [{ gate: "BLOCK", name: "A", y: 200, col: 0 }], { A: bellDef });
  const probs = sim.simulate(s.ops, s.n);
  const lit = probs.map((p, k) => ({ p, k })).filter((x) => x.p > 0.01);
  check("2. same block placed on wires 1-2 → 50% 000 + 50% 011 (q0 untouched)",
    lit.length === 2 && label(lit[0].k, 3) === "000" && label(lit[1].k, 3) === "011" &&
    approx(lit[0].p, 0.5) && approx(lit[1].p, 0.5),
    JSON.stringify(probs));
}

/* ---- 3. A block that contains ITSELF is rejected, politely. ---- */
{
  const blocks = {
    A: { wires: 1, gates: [{ gate: "BLOCK", name: "A", y: 0, col: 0 }] },
  };
  const res = sim.expandBlocks([{ gate: "BLOCK", name: "A", y: 200, col: 0 }],
    [{ y: 200, x1: 80, x2: 400 }], blocks);
  check("3. self-containing block → one plain-English error",
    res.error !== null && res.error.indexOf("contains itself") !== -1,
    JSON.stringify(res));
}

/* ---- 4. An INDIRECT cycle (A → B → A) is caught too. ----------- */
{
  const blocks = {
    A: { wires: 1, gates: [{ gate: "H", y: 0, col: 0 },
                           { gate: "BLOCK", name: "B", y: 0, col: 1 }] },
    B: { wires: 1, gates: [{ gate: "X", y: 0, col: 0 },
                           { gate: "BLOCK", name: "A", y: 0, col: 1 }] },
  };
  const res = sim.expandBlocks([{ gate: "BLOCK", name: "A", y: 200, col: 0 }],
    [{ y: 200, x1: 80, x2: 400 }], blocks);
  check("4. indirect cycle A→B→A → error names the looping block",
    res.error !== null && res.error.indexOf("contains itself") !== -1,
    JSON.stringify(res));
}

/* ---- 5. Missing definition + doesn't-fit, in plain English. ---- */
{
  const twoWires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const missing = sim.expandBlocks([{ gate: "BLOCK", name: "Z", y: 200, col: 0 }],
    twoWires, {});
  const threeWireBlock = { wires: 3, cols: 1, gates: [{ gate: "H", y: 0, col: 0 }] };
  const noFit = sim.expandBlocks([{ gate: "BLOCK", name: "T", y: 200, col: 0 }],
    twoWires, { T: threeWireBlock });
  check("5. missing definition → sentence; 3-wire block on 2 wires → sentence",
    missing.error !== null && missing.error.indexOf("no definition") !== -1 &&
    noFit.error !== null && noFit.error.indexOf("needs 3 wires") !== -1,
    JSON.stringify({ missing: missing.error, noFit: noFit.error }));
}

/* ---- 6. gateSlotTaken inside a placed block's frame. ----------- */
{
  const circuit = [
    { gate: "BLOCK", name: "A", y: 200, col: 3, y2: 240, col2: 4 },
  ];
  const inside = (y, c) => sim_validate(circuit, y, c);
  function sim_validate(c, y, col) { return require("../js/recognize.js").gateSlotTaken(c, y, col); }
  check("6. single gate inside the block frame → taken; same row, later column → free",
    inside(200, 3) === true && inside(240, 4) === true &&
    inside(200, 5) === false && inside(280, 3) === false,
    JSON.stringify(circuit));
}

/* ---- 7. An R + CNOT block composes with variables. ------------- */
{
  const blocks = {
    P: {
      wires: 2,
      cols: 2,
      gates: [
        { gate: "R", y: 0, col: 0, angle: "theta" },
        { gate: "CNOT", cy: 0, ty: 1, col: 1 },
      ],
    },
  };
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  // theta = pi: R(pi) flips q0 to |1⟩, then the CNOT copies it → 11.
  const s = sim.toSimInput(wires, [{ gate: "BLOCK", name: "P", y: 200, col: 0 }],
    blocks, { theta: Math.PI });
  const probs = sim.simulate(s.ops, s.n);
  check("7. block with R(theta)+CNOT, theta=pi → 100% 11 (name survives, math composes)",
    approx(probs[3], 1) && s.ops.length === 2 && s.ops[0].gate === "R",
    JSON.stringify({ ops: s.ops, probs: probs }));
}

/* ---- 8. Validator surfaces block problems + judges the inside. - */
{
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const looping = sim.validateCircuit(wires,
    [{ gate: "BLOCK", name: "A", y: 200, col: 0 }],
    { A: { wires: 1, gates: [{ gate: "BLOCK", name: "A", y: 0, col: 0 }] } }, {});
  // A block whose INSIDE has a double-occupied slot (two H, one col):
  const crowded = sim.validateCircuit(wires,
    [{ gate: "BLOCK", name: "B", y: 200, col: 0 }],
    { B: { wires: 1, cols: 1, gates: [
        { gate: "H", y: 0, col: 0 }, { gate: "X", y: 0, col: 0 },
      ] } }, {});
  check("8. validator: looping block flagged; crowded block inside flagged",
    looping.length === 1 && looping[0].indexOf("contains itself") !== -1 &&
    crowded.length === 1 && crowded[0].indexOf("two gates") !== -1,
    JSON.stringify({ looping: looping, crowded: crowded }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
