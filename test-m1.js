/* ============================================================
   test-m1.js — M1 export tests. Run with plain node:
       node tests/test-m1.js
   ------------------------------------------------------------
   exporters.js is PURE, so node tests it all. One shim mirrors
   the browser: in the page, every classic script shares ONE
   scope, so exporters.js can call expandBlocks (simulator.js)
   and read `state` directly. Under node each require() has its
   OWN scope — so the test puts those names on globalThis first,
   exactly like test-stage5.js shims GRID_SIZE for recognize.js.

   What is proven here:
   • Qiskit export: right lines, right order, sorted-rows rule
     (a new wire above renumbers — same rule as toSimInput),
     R → qc.ry(value, q), blocks expanded away.
   • training data: normalized strokes, count, structure kept.
   • save/load bouncer: round-trip works; garbage is refused
     with a sentence, never a crash.
   ============================================================ */

// -- Shims BEFORE the requires (see header). --
globalThis.GRID_SIZE = 40;
globalThis.COLUMN_ORIGIN = 40;
globalThis.COLUMN_WIDTH = 80;

const sim = require("../js/simulator.js");
Object.assign(globalThis, sim); // expandBlocks becomes "global", like in the browser
globalThis.state = { strokes: [], wires: [], circuit: [], variables: {}, blocks: {} };

const exp = require("../js/exporters.js");

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}

/* ---- 1. The Bell circuit exports as real Qiskit lines. -------- */
{
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const circuit = [
    { gate: "H", y: 200, col: 0 },
    { gate: "CNOT", cy: 200, ty: 240, col: 1 },
  ];
  const res = exp.toQiskitCode(wires, circuit, {}, {});
  const lines = res.code ? res.code.split("\n") : [];
  const iH = lines.indexOf("qc.h(0)");
  const iCx = lines.indexOf("qc.cx(0, 1)");
  check("1. Bell circuit → QuantumCircuit(2), qc.h(0) before qc.cx(0, 1)",
    res.error === null &&
    lines.includes("from qiskit import QuantumCircuit") &&
    lines.includes("qc = QuantumCircuit(2)") &&
    iH !== -1 && iCx !== -1 && iH < iCx,
    res.code || res.error);
}

/* ---- 2. The sorted-rows rule: a wire ABOVE renumbers the code. -
   Same circuit entries, one new wire at y=160. The top row is
   qubit 0 — so H (row 200) must come out as qc.h(1). ------------- */
{
  const wires3 = [
    { y: 160, x1: 80, x2: 400 },
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const circuit = [
    { gate: "H", y: 200, col: 0 },
    { gate: "CNOT", cy: 200, ty: 240, col: 1 },
  ];
  const res = exp.toQiskitCode(wires3, circuit, {}, {});
  const ok = res.code.includes("qc = QuantumCircuit(3)") &&
             res.code.includes("qc.h(1)") &&
             res.code.includes("qc.cx(1, 2)");
  check("2. wire above → same gates, numbers shifted (sorted-rows rule)", ok,
    res.code || res.error);
}

/* ---- 3. R exports as qc.ry(value, q); missing variable → error.  */
{
  const wires = [{ y: 200, x1: 80, x2: 400 }];
  const circuit = [{ gate: "R", y: 200, col: 2, angle: "theta" }];
  const good = exp.toQiskitCode(wires, circuit, { theta: 1.57 }, {});
  const bad = exp.toQiskitCode(wires, circuit, {}, {});
  check("3. R → qc.ry(1.57, 0); missing variable → polite error",
    good.error === null && good.code.includes("qc.ry(1.57, 0)") &&
    bad.code === null && bad.error.indexOf("theta") !== -1,
    JSON.stringify({ good: good.code, bad: bad.error }));
}

/* ---- 4. Blocks are expanded away before export (M3 preview). --- */
{
  const wires = [
    { y: 200, x1: 80, x2: 400 },
    { y: 240, x1: 80, x2: 400 },
  ];
  const blocks = {
    A: { wires: 2, gates: [
      { gate: "H", y: 0, col: 0 },
      { gate: "CNOT", cy: 0, ty: 1, col: 1 },
    ] },
  };
  const res = exp.toQiskitCode(wires, [
    { gate: "BLOCK", name: "A", y: 200, col: 0 },
  ], {}, blocks);
  const ok = res.error === null &&
    res.code.includes("qc.h(0)") && res.code.includes("qc.cx(0, 1)") &&
    !res.code.includes("BLOCK");
  check("4. a placed block exports as its plain gates", ok,
    res.code || res.error);
}

/* ---- 5. Training data: normalized, counted, structure kept. ---- */
{
  const store = {
    H: [[ // one example: two strokes (a wobbly H)
      [{ x: 90, y: 80 }, { x: 90, y: 120 }],   // left vertical
      [{ x: 110, y: 100 }, { x: 130, y: 100 }], // crossbar
    ]],
  };
  const data = exp.buildTrainingData(store);
  const ex = data.examples[0];
  // The longest side must now be exactly 1 (x spans 90..130 = 40px):
  // so points are centered on 0 and the long axis runs -0.5..0.5.
  const xs = ex.strokes.flat().map((p) => p.x);
  const longAxis = Math.max(...xs) - Math.min(...xs);
  check("5. training data: 1 example, label kept, normalized to unit box",
    data.count === 1 && ex.label === "H" && ex.strokes.length === 2 &&
    Math.abs(longAxis - 1) < 1e-9,
    JSON.stringify(data).slice(0, 200));
}

/* ---- 6. Save/Load round-trip; the bouncer refuses garbage. ----- */
{
  state.strokes = [{ points: [{ x: 1, y: 2, p: 0.5, t: 3 }], endedAt: 4 }];
  state.wires = [{ y: 200, x1: 80, x2: 400 }];
  state.circuit = [{ gate: "H", y: 200, col: 0 }];
  state.variables = { theta: 1.57 };
  state.blocks = { A: { wires: 1, gates: [{ gate: "X", y: 0, col: 0 }] } };

  const saved = JSON.stringify(exp.serializeDrawing());
  const back = exp.parseDrawing(saved);
  const roundTrip = back.ok &&
    back.data.wires[0].y === 200 && back.data.circuit[0].gate === "H" &&
    back.data.variables.theta === 1.57 && back.data.blocks.A.wires === 1 &&
    back.data.strokes[0].points[0].x === 1;

  const notJson = exp.parseDrawing("{oops");
  const alien = exp.parseDrawing(JSON.stringify({ hello: "world" }));
  const missing = exp.parseDrawing(JSON.stringify({ format: "notebookq-drawing", version: 1 }));
  const hostile = exp.parseDrawing(JSON.stringify({
    format: "notebookq-drawing", version: 1,
    strokes: [], wires: [], circuit: [], evil: "<script>",
  }));

  state.strokes = []; state.wires = []; state.circuit = []; // cleanup
  check("6. save/load round-trip; not-JSON / alien / missing-fields all refused",
    roundTrip && !notJson.ok && !alien.ok && !missing.ok && hostile.ok,
    JSON.stringify({ roundTrip: roundTrip, notJson: notJson.error, alien: alien.error }));
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
