/* ============================================================
   test-m7-qasm.js — notation <-> code round-trip. Run with node:
       node tests/test-m7-qasm.js
   ------------------------------------------------------------
   The claim being proven: the drawing and the QASM text are two
   views of ONE program. Specifically:
     • toQasm output is the QASM we expect (order, pi-maths, names)
     • fromQasm builds a drawing the validator accepts
     • drawing -> text -> drawing keeps the SAME probabilities
       (200 random circuits, compared through the real simulator)
     • bad input is refused with a line number and changes nothing
   ============================================================ */

globalThis.GRID_SIZE = 40;
globalThis.COLUMN_ORIGIN = 40;
globalThis.COLUMN_WIDTH = 80;

const sim = require("../js/simulator.js");
Object.assign(globalThis, sim);
globalThis.state = { strokes: [], wires: [], circuit: [], variables: {}, blocks: {} };

const q = require("../js/qasm.js");

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}

function probs(wires, circuit, variables, blocks) {
  const inp = toSimInput(wires, circuit, blocks || {}, variables);
  return simulate(inp.ops, inp.n);
}
function maxDiff(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

const BELL = {
  wires: [{ y: 80, x1: 0, x2: 240 }, { y: 160, x1: 0, x2: 240 }],
  circuit: [{ gate: "H", y: 80, col: 0 }, { gate: "CNOT", cy: 80, ty: 160, col: 1 }],
};

/* ---- 1. Bell circuit exports as exact QASM. ------------------ */
{
  const r = q.toQasm(BELL.wires, BELL.circuit, {}, {});
  const want = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];';
  check("1. Bell -> exact QASM", r.code === want, JSON.stringify(r));
}

/* ---- 2. R exports pi-maths and keeps the variable NAME. ------ */
{
  const wires = [{ y: 80, x1: 0, x2: 160 }];
  const circuit = [{ gate: "R", y: 80, col: 0, angle: "theta" }];
  const r = q.toQasm(wires, circuit, { theta: Math.PI / 2 }, {});
  check("2a. ry(pi/2) with // theta", r.code.endsWith("ry(pi/2) q[0]; // theta"), r.code);
  const back = q.fromQasm(r.code, {});
  check("2b. name survives the trip",
    back.ok && back.circuit[0].angle === "theta" &&
    Math.abs(back.variables.theta - Math.PI / 2) < 1e-12, JSON.stringify(back));
  const bad = q.toQasm(wires, circuit, {}, {});
  check("2c. missing variable -> one sentence, no code", bad.code === null && /theta/.test(bad.error));
}

/* ---- 3. Angle calculator. ----------------------------------- */
{
  const E = q.qasmEvalAngle;
  const ok = Math.abs(E("pi/2") - Math.PI / 2) < 1e-12 &&
             Math.abs(E("-pi/4") + Math.PI / 4) < 1e-12 &&
             Math.abs(E("2*pi") - 2 * Math.PI) < 1e-12 &&
             Math.abs(E("(1+2)*0.5") - 1.5) < 1e-12 &&
             Math.abs(E("1e-3") - 0.001) < 1e-15;
  let threw = 0;
  for (const bad of ["", "pi/0", "2 +", "(1", "sin(1)", "1 2", "alert(1)"]) {
    try { E(bad); } catch (e) { threw++; }
  }
  check("3. angle maths: good ones evaluate, 7 bad ones all throw", ok && threw === 7, "threw " + threw);
  check("3b. fmt: pi fractions and plain numbers",
    q.qasmFmtAngle(Math.PI) === "pi" && q.qasmFmtAngle(-Math.PI / 4) === "-pi/4" &&
    q.qasmFmtAngle(3 * Math.PI / 4) === "3*pi/4" && q.qasmFmtAngle(1.5) === "1.5" &&
    q.qasmFmtAngle(0) === "0");
}

/* ---- 4. Hand-written QASM -> a drawing the validator accepts. */
{
  const src = [
    "OPENQASM 2.0;", 'include "qelib1.inc";', "qreg q[3];", "creg c[3];",
    "h q[0];", "cx q[0],q[2];", "x q[1];", "ry(pi) q[2];", "measure q -> c;",
  ].join("\n");
  const r = q.fromQasm(src, {});
  check("4a. parses", r.ok, JSON.stringify(r));
  if (r.ok) {
    const problems = validateCircuit(r.wires, r.circuit, {}, r.variables);
    check("4b. validator is silent", problems.length === 0, JSON.stringify(problems));
    const cx = r.circuit.find((g) => g.gate === "CNOT");
    const x = r.circuit.find((g) => g.gate === "X");
    check("4c. gate on the crossed middle wire lands AFTER the CNOT column",
      x.col > cx.col, "cx col " + cx.col + ", x col " + x.col);
    check("4d. creg+measure warned, not fatal", r.warnings.length === 2, JSON.stringify(r.warnings));
    check("4e. rows 80px apart, top wire first",
      r.wires.map((w) => w.y).join() === "80,160,240");
    const p = probs(r.wires, r.circuit, r.variables);
    // H on q0, CNOT 0->2, X on q1, RY(pi) on q2 (flip): q0=q2 xor 1, q1=1
    const sum = p.reduce((a, b) => a + b, 0);
    check("4f. probabilities normalized", Math.abs(sum - 1) < 1e-12);
  }
}

/* ---- 5. Errors: line numbers, all-or-nothing. ---------------- */
{
  const cases = [
    ["gate not in app", "qreg q[1];\ns q[0];", /Line 2.*"s".*not in NotebookQ/],
    ["qubit out of range", "qreg q[2];\nh q[5];", /Line 2.*qubit 5/],
    ["too many qubits", "qreg q[9];", /Line 1.*at most 5/],
    ["same-wire CNOT", "qreg q[2];\ncx q[1],q[1];", /Line 2.*same qubit/],
    ["gate before qreg", "h q[0];", /Line 1.*declare the qubits/],
    ["missing semicolon", "qreg q[1]\nh q[0];", /missing a ;|Line/],
    ["wrong version", "OPENQASM 3.0;\nqreg q[1];", /2\.0 only/],
    ["bad angle", "qreg q[1];\nry(2 +) q[0];", /Line 2/],
    ["wrong register", "qreg q[1];\nh r[0];", /Line 2.*"r"/],
    ["empty text", "", /qubits/],
  ];
  for (const [name, src, re] of cases) {
    const r = q.fromQasm(src, {});
    const msg = r.ok ? "(accepted!)" : r.errors.map((e) => e.message).join(" | ");
    check("5. " + name, !r.ok && re.test(msg), msg);
  }
  const multi = q.fromQasm("qreg q[1];\ns q[0];\nt q[0];", {});
  check("5b. several errors reported together", !multi.ok && multi.errors.length === 2);
}

/* ---- 6. Variable naming rules. ------------------------------ */
{
  // No comment: reuse an existing variable with the same value...
  const a = q.fromQasm("qreg q[1];\nry(1.5) q[0];", { phi: 1.5 });
  check("6a. reuses an existing variable with the same value",
    a.ok && a.circuit[0].angle === "phi" && Object.keys(a.variables).length === 1, JSON.stringify(a));
  // ...else invent a fresh name that does not collide.
  const b = q.fromQasm("qreg q[1];\nry(1) q[0];\nry(2) q[0];", { theta1: 9 });
  check("6b. fresh names skip taken ones",
    b.ok && b.circuit[0].angle === "theta2" && b.circuit[1].angle === "theta3", JSON.stringify(b));
  // A comment name already holding a DIFFERENT number is not overwritten.
  const c = q.fromQasm("qreg q[1];\nry(2) q[0]; // theta", { theta: 1 });
  check("6c. comment name clash -> new name + warning, old value kept",
    c.ok && c.variables.theta === 1 && c.circuit[0].angle !== "theta" && c.warnings.length === 1, JSON.stringify(c));
}

/* ---- 7. Round trip through the real simulator, 200 circuits. -- */
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (n) => Math.floor(rnd() * n);

  let worst = 0, worstIdx = -1, done = 0, validBad = 0;
  for (let k = 0; k < 200; k++) {
    const n = 1 + pick(5);
    const wires = [];
    for (let i = 0; i < n; i++) wires.push({ y: 80 * (i + 1), x1: 0, x2: 800 });
    const variables = {};
    const circuit = [];
    const used = {}; // col -> set of rows busy (span aware)
    const m = 1 + pick(10);
    for (let j = 0; j < m; j++) {
      const col = pick(6);
      used[col] = used[col] || new Set();
      const kind = pick(5);
      if (kind === 4 && n >= 2) {
        let c = pick(n), t = pick(n);
        if (c === t) t = (t + 1) % n;
        const lo = Math.min(c, t), hi = Math.max(c, t);
        let clash = false;
        for (let r = lo; r <= hi; r++) if (used[col].has(r)) clash = true;
        if (clash) continue;
        for (let r = lo; r <= hi; r++) used[col].add(r);
        circuit.push({ gate: "CNOT", cy: 80 * (c + 1), ty: 80 * (t + 1), col: col });
      } else {
        const r = pick(n);
        if (used[col].has(r)) continue;
        used[col].add(r);
        if (kind === 3) {
          const nm = "v" + pick(3);
          if (!(nm in variables)) variables[nm] = (pick(2) ? Math.PI / (1 + pick(4)) : rnd() * 6.28);
          circuit.push({ gate: "R", y: 80 * (r + 1), col: col, angle: nm });
        } else {
          circuit.push({ gate: ["H", "X", "Z"][kind], y: 80 * (r + 1), col: col });
        }
      }
    }
    if (validateCircuit(wires, circuit, {}, variables).length > 0) { validBad++; continue; }
    const before = probs(wires, circuit, variables);
    const text = q.toQasm(wires, circuit, variables, {});
    if (text.error) { check("7. export failed #" + k, false, text.error); continue; }
    const back = q.fromQasm(text.code, {});
    if (!back.ok) { check("7. re-parse failed #" + k, false, JSON.stringify(back.errors)); continue; }
    const problems = validateCircuit(back.wires, back.circuit, {}, back.variables);
    if (problems.length) { check("7. re-parsed circuit invalid #" + k, false, JSON.stringify(problems)); continue; }
    const after = probs(back.wires, back.circuit, back.variables);
    const d = maxDiff(before, after);
    if (d > worst) { worst = d; worstIdx = k; }
    done++;
  }
  check("7. round trip: " + done + " random circuits keep their odds (worst diff " +
        worst.toExponential(2) + ", #" + worstIdx + ")", done >= 150 && worst < 1e-9,
        "done=" + done + " skippedInvalid=" + validBad);
}

/* ---- 8. Second trip is a fixed point (text -> drawing -> text). */
{
  const src = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\nry(pi/4) q[1]; // alpha\ncx q[0],q[2];\nx q[1];';
  const a = q.fromQasm(src, {});
  const t2 = q.toQasm(a.wires, a.circuit, a.variables, {});
  check("8. text -> drawing -> text is stable (canonical order)",
    a.ok && t2.code === 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\nry(pi/4) q[1]; // alpha\ncx q[0],q[2];\nx q[1];',
    t2.code);
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
