/* qasm.js — OpenQASM 2.0 translator (pure: no DOM, no global
   `state`, so plain node can test it).

     toQasm(wires, circuit, variables, blocks)   drawing -> text
     fromQasm(text, existingVariables)           text -> drawing

   QASM is declarative (no loops or functions), so every program in
   the supported subset has exactly one picture and vice versa.
   Supported subset: OPENQASM 2.0; include "qelib1.inc"; qreg q[n];
   h/x/z/ry(angle)/cx. creg/measure/barrier are accepted and
   ignored (the app always measures every wire), with a warning;
   any other gate is refused with its line number.

   Variables survive the trip: toQasm writes the variable NAME in
   a trailing comment ("ry(pi/2) q[1]; // theta") and fromQasm
   reads it back; hand-written angles without that comment get a
   fresh name, reusing a variable that already holds the same
   value. Blocks are expanded on export and do not survive a text
   round trip (the gates inside do).

   fromQasm lays out on the same grid the canvas uses (wire rows
   80px apart, one column = 80px) via the GRID_SIZE / COLUMN_*
   names if they exist, else the same numbers. */

const QASM_MAX_QUBITS = (typeof MAX_QUBITS !== "undefined") ? MAX_QUBITS : 5;
const QASM_GRID = (typeof GRID_SIZE !== "undefined") ? GRID_SIZE : 40;
const QASM_COL_W = (typeof COLUMN_WIDTH !== "undefined") ? COLUMN_WIDTH : 80;
const QASM_COL_0 = (typeof COLUMN_ORIGIN !== "undefined") ? COLUMN_ORIGIN : 40;

/* Angle formatting: nice pi fractions when exact, else the full
   precision number (pi/2 reads better than 1.5707963267948966). */
function qasmFmtAngle(v) {
  if (v === 0) return "0";
  for (let d = 1; d <= 8; d++) {
    const num = Math.round((v / Math.PI) * d);
    if (num !== 0 && Math.abs(v - (num * Math.PI) / d) < 1e-12) {
      const sign = num < 0 ? "-" : "";
      const n = Math.abs(num);
      const top = n === 1 ? "pi" : n + "*pi";
      return sign + top + (d === 1 ? "" : "/" + d);
    }
  }
  return String(Number(v.toPrecision(15)));
}

/* toQasm — drawing -> OpenQASM 2.0 text. Top wire = q[0] (the
   sorted-rows rule). Returns { code, error } like toQiskitCode. */
function toQasm(wires, circuit, variables, blocks) {
  variables = variables || {};
  blocks = blocks || {};
  if (wires.length === 0) {
    return { code: null, error: "Nothing to export yet — draw a circuit first." };
  }

  const rows = wires.map((w) => w.y).sort((a, b) => a - b);
  const qubitOfRow = {};
  rows.forEach((y, i) => { qubitOfRow[y] = i; });

  const expanded = expandBlocks(circuit, wires, blocks);
  if (expanded.error) return { code: null, error: expanded.error };

  const keyed = [];
  for (const g of expanded.gates) {
    if (g.gate === "CNOT") {
      const c = qubitOfRow[g.cy];
      const t = qubitOfRow[g.ty];
      if (c === undefined || t === undefined) continue; // orphan: the validator reports it
      keyed.push({ k: [g.col, Math.min(c, t)], line: "cx q[" + c + "],q[" + t + "];" });
      continue;
    }
    const q = qubitOfRow[g.y];
    if (q === undefined) continue;
    if (g.gate === "R") {
      const v = variables[g.angle];
      if (typeof v !== "number" || !isFinite(v)) {
        return {
          code: null,
          error: 'Cannot export: the R in column ' + g.col + ' uses the variable "' +
                 g.angle + '", which does not hold a number. Fix it in the variables panel.',
        };
      }
      // The trailing comment is what lets the NAME survive the round trip.
      keyed.push({
        k: [g.col, q],
        line: "ry(" + qasmFmtAngle(v) + ") q[" + q + "]; // " + g.angle,
      });
      continue;
    }
    keyed.push({ k: [g.col, q], line: g.gate.toLowerCase() + " q[" + q + "];" });
  }
  keyed.sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]));

  const lines = [
    "OPENQASM 2.0;",
    'include "qelib1.inc";',
    "qreg q[" + rows.length + "];",
  ];
  for (const k of keyed) lines.push(k.line);
  return { code: lines.join("\n"), error: null };
}

/* qasmEvalAngle — a small, safe calculator for angle expressions:
   numbers, pi, + - * /, parentheses, unary minus. No eval().
   Returns a number, or throws Error with a plain-English message. */
function qasmEvalAngle(src) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(pi)|([+\-*/()])|(\S))/gy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src)) !== null) {
    if (m[1] !== undefined) toks.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: "num", v: Math.PI });
    else if (m[3] !== undefined) toks.push({ t: "op", v: m[3] });
    else throw new Error('I do not understand "' + m[4] + '" in the angle "' + src.trim() + '"');
  }
  if (toks.length === 0) throw new Error("The angle is empty");
  let i = 0;
  const peek = () => toks[i];
  function expr() {
    let v = term();
    while (peek() && (peek().v === "+" || peek().v === "-")) {
      const op = toks[i++].v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() && (peek().v === "*" || peek().v === "/")) {
      const op = toks[i++].v;
      const r = unary();
      if (op === "/" && r === 0) throw new Error("The angle divides by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function unary() {
    if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")) {
      const s = toks[i++].v;
      const v = unary();
      return s === "-" ? -v : v;
    }
    return atom();
  }
  function atom() {
    const t = toks[i++];
    if (!t) throw new Error('The angle "' + src.trim() + '" ends too early');
    if (t.t === "num") return t.v;
    if (t.v === "(") {
      const v = expr();
      const close = toks[i++];
      if (!close || close.v !== ")") throw new Error('The angle "' + src.trim() + '" is missing a )');
      return v;
    }
    throw new Error('The angle "' + src.trim() + '" is not written correctly');
  }
  const v = expr();
  if (i < toks.length) throw new Error('The angle "' + src.trim() + '" has extra characters at the end');
  if (!isFinite(v)) throw new Error("The angle is not a finite number");
  return v;
}

/* fromQasm — OpenQASM 2.0 text -> a drawing. Returns:
     { ok: true,  wires, circuit, variables, warnings: [string] }
     { ok: false, errors: [{ line, message }], warnings: [string] }
   All or nothing: one error and nothing is applied, so a
   half-typed program never wrecks the drawing.
   `existingVariables` lets hand-written angles reuse a name that
   already holds the same number; the returned `variables` is that
   map plus anything new. */
function fromQasm(text, existingVariables) {
  const errors = [];
  const warnings = [];
  const fail = (line, message) => errors.push({ line: line, message: message });

  const vars = Object.assign({}, existingVariables || {});
  const isNum = (v) => typeof v === "number" && isFinite(v);

  let nQubits = 0;
  let regName = null;
  let sawQreg = false;
  const ops = []; // { kind, q | c,t | angle, name, line }
  const ignored = {};

  // 1. Split into statements, remembering line numbers and the
  //    trailing comment that rides on each line (variable names).
  const stmts = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const cut = raw.indexOf("//");
    const code = cut === -1 ? raw : raw.slice(0, cut);
    const comment = cut === -1 ? "" : raw.slice(cut + 2).trim();
    const parts = code.split(";");
    // The last piece has no ';' after it — only legal if it is blank.
    const tail = parts.pop();
    if (tail.trim() !== "") fail(lineNo, 'Line ' + lineNo + ': "' + tail.trim() + '" is missing a ; at the end.');
    parts.forEach((p, k) => {
      if (p.trim() === "") return;
      stmts.push({ text: p.trim(), line: lineNo, comment: k === parts.length - 1 ? comment : "" });
    });
  });

  const refRe = /^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/;
  function qref(s, line) {
    const m = refRe.exec(s.trim());
    if (!m) { fail(line, 'Line ' + line + ': I expected a qubit like q[0], not "' + s.trim() + '".'); return null; }
    if (!sawQreg || m[1] !== regName) {
      fail(line, 'Line ' + line + ': "' + m[1] + '" is not the declared qubit register' + (regName ? ' (' + regName + ')' : '') + '.');
      return null;
    }
    const idx = parseInt(m[2], 10);
    if (idx >= nQubits) {
      fail(line, 'Line ' + line + ': qubit ' + idx + ' does not exist — the register has ' + nQubits + '.');
      return null;
    }
    return idx;
  }

  // 2. Interpret each statement.
  for (const st of stmts) {
    const s = st.text;
    const line = st.line;

    if (/^OPENQASM\b/i.test(s)) {
      if (!/^OPENQASM\s+2(\.0)?$/i.test(s)) fail(line, "Line " + line + ": NotebookQ reads OpenQASM 2.0 only.");
      continue;
    }
    if (/^include\b/.test(s)) continue;

    let m = /^qreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/.exec(s);
    if (m) {
      if (sawQreg) { fail(line, "Line " + line + ": NotebookQ supports one qreg only."); continue; }
      const n = parseInt(m[2], 10);
      if (n < 1) { fail(line, "Line " + line + ": a qreg needs at least 1 qubit."); continue; }
      if (n > QASM_MAX_QUBITS) { fail(line, "Line " + line + ": NotebookQ simulates at most " + QASM_MAX_QUBITS + " qubits, not " + n + "."); continue; }
      sawQreg = true; regName = m[1]; nQubits = n;
      continue;
    }

    if (/^creg\b/.test(s)) { ignored.creg = true; continue; }
    if (/^measure\b/.test(s)) { ignored.measure = true; continue; }
    if (/^barrier\b/.test(s)) { ignored.barrier = true; continue; }

    // gate statement:  name [ (args) ] operands
    m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/.exec(s);
    if (!m) { fail(line, 'Line ' + line + ': I cannot read "' + s + '".'); continue; }
    const name = m[1].toLowerCase();
    const argSrc = m[2];
    const operands = m[3];

    if (!sawQreg) { fail(line, "Line " + line + ": declare the qubits first, e.g. qreg q[2];"); continue; }

    if (name === "h" || name === "x" || name === "z") {
      if (argSrc !== undefined) { fail(line, "Line " + line + ": " + name + " takes no angle."); continue; }
      const q = qref(operands, line);
      if (q !== null) ops.push({ kind: name.toUpperCase(), q: q });
      continue;
    }

    if (name === "ry") {
      if (argSrc === undefined) { fail(line, "Line " + line + ": ry needs an angle, like ry(pi/2) q[0];"); continue; }
      let angle;
      try { angle = qasmEvalAngle(argSrc); }
      catch (e) { fail(line, "Line " + line + ": " + e.message + "."); continue; }
      const q = qref(operands, line);
      if (q === null) continue;
      const hint = /^[A-Za-z_][A-Za-z0-9_]*$/.test(st.comment) ? st.comment : null;
      ops.push({ kind: "R", q: q, angle: angle, hint: hint, line: line });
      continue;
    }

    if (name === "cx") {
      if (argSrc !== undefined) { fail(line, "Line " + line + ": cx takes no angle."); continue; }
      const pair = operands.split(",");
      if (pair.length !== 2) { fail(line, "Line " + line + ": cx needs two qubits, like cx q[0],q[1];"); continue; }
      const c = qref(pair[0], line);
      const t = qref(pair[1], line);
      if (c === null || t === null) continue;
      if (c === t) { fail(line, "Line " + line + ": a CNOT cannot start and end on the same qubit (q[" + c + "])."); continue; }
      ops.push({ kind: "CNOT", c: c, t: t });
      continue;
    }

    fail(line, 'Line ' + line + ': the gate "' + m[1] + '" is not in NotebookQ yet (it knows h, x, z, ry and cx).');
  }

  if (!sawQreg && errors.length === 0) {
    fail(1, "Declare the qubits first, e.g. qreg q[2];");
  }
  if (ignored.creg) warnings.push("creg ignored — NotebookQ always measures every wire.");
  if (ignored.measure) warnings.push("measure ignored — NotebookQ always measures every wire.");
  if (ignored.barrier) warnings.push("barrier ignored — the drawing has no barriers.");

  if (errors.length > 0) {
    errors.sort((a, b) => a.line - b.line);
    return { ok: false, errors: errors, warnings: warnings };
  }

  // 3. Name the angles. A comment name wins (that is the round
  //    trip). Otherwise reuse a variable with the same value, or
  //    invent theta1, theta2, ...
  const fresh = (() => { let n = 0; return () => { let nm; do { n++; nm = "theta" + n; } while (nm in vars); return nm; }; })();
  for (const op of ops) {
    if (op.kind !== "R") continue;
    const same = (nm) => isNum(vars[nm]) && Math.abs(vars[nm] - op.angle) < 1e-9;
    if (op.hint) {
      if (!(op.hint in vars) || same(op.hint)) { vars[op.hint] = op.angle; op.name = op.hint; continue; }
      // The comment's name is taken by a DIFFERENT number: do not
      // overwrite it — pick a free name and say so.
      const nm = fresh();
      vars[nm] = op.angle; op.name = nm;
      warnings.push('Line ' + op.line + ': "' + op.hint + '" already holds a different number, so this angle is called ' + nm + ".");
      continue;
    }
    const reuse = Object.keys(vars).find(same);
    if (reuse) { op.name = reuse; continue; }
    const nm = fresh();
    vars[nm] = op.angle; op.name = nm;
  }

  // 4. Lay out. Wires 2 grid cells apart; each op goes in the
  //    earliest column after everything already on the rows it
  //    touches. A CNOT occupies EVERY row it crosses (the
  //    validator's span rule), so a gate on a middle wire is never
  //    put beside it.
  const rowY = (i) => QASM_GRID * 2 * (i + 1);
  const busy = new Array(nQubits).fill(-1); // last used column per qubit
  const circuit = [];
  let lastCol = 0;
  for (const op of ops) {
    const lo = op.kind === "CNOT" ? Math.min(op.c, op.t) : op.q;
    const hi = op.kind === "CNOT" ? Math.max(op.c, op.t) : op.q;
    let col = 0;
    for (let q = lo; q <= hi; q++) col = Math.max(col, busy[q] + 1);
    for (let q = lo; q <= hi; q++) busy[q] = col;
    lastCol = Math.max(lastCol, col);
    if (op.kind === "CNOT") circuit.push({ gate: "CNOT", cy: rowY(op.c), ty: rowY(op.t), col: col });
    else if (op.kind === "R") circuit.push({ gate: "R", y: rowY(op.q), col: col, angle: op.name });
    else circuit.push({ gate: op.kind, y: rowY(op.q), col: col });
  }

  const x2 = QASM_COL_0 + QASM_COL_W * (lastCol + 1);
  const wires = [];
  for (let i = 0; i < nQubits; i++) wires.push({ y: rowY(i), x1: 0, x2: x2 });

  return { ok: true, wires: wires, circuit: circuit, variables: vars, warnings: warnings };
}

if (typeof module !== "undefined") {
  module.exports = { toQasm, fromQasm, qasmEvalAngle, qasmFmtAngle };
}
