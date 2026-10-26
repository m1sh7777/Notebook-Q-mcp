/* simulator.js — state vector simulator for the drawn circuit.
   Pure math: no DOM, no global `state`; every function returns new
   data, which is what lets tests load this file under plain node.
   App-wide convention (decided here once): qubit 0 is the TOP wire
   and bit patterns are written q0 leftmost, so q0 is the most
   significant bit — bar k is labeled with k in binary. Textbook
   conventions differ, and bugs in this order are silent.
   Amplitudes are real numbers only (H, X, Z, Y-rotations never
   need complex entries).
   Global: MAX_QUBITS caps the simulator. */

/* One source of truth for the simulator's capacity: drawing.js
   refuses extra wires using it, and panel.js writes its "up to 5
   qubits" note from it. */
const MAX_QUBITS = 5;

/* Gate tables. Each is a 2x2 matrix [ [m00, m01], [m10, m11] ]:
   an amplitude's new value = m00*its own old value + m01*its
   partner's old value. */
const GATES = {
  // H: each amplitude becomes the average of its pair (total odds
  // stay 1); makes 50/50s, and is its own inverse (H·H = identity).
  H: [
    [Math.SQRT1_2,  Math.SQRT1_2],
    [Math.SQRT1_2, -Math.SQRT1_2],
  ],
  // X: the quantum NOT — swap each pair's two amplitudes.
  X: [
    [0, 1],
    [1, 0],
  ],
  // Z: flips the sign of the "1" side. Squaring hides signs, so Z
  // alone changes no visible odds — between two H's it acts like X.
  Z: [
    [1,  0],
    [0, -1],
  ],
};

/* applyGate(state, matrix, qubit, n): apply a 2x2 matrix to one
   qubit of the amplitude list; returns a NEW list. `state` is the
   quantum state — a plain array of 2^n reals — not the app's
   global object; the parameter shadows it inside this pure
   function. Partners are the two indices differing only in
   `qubit`'s bit; since q0 is the leftmost bit, its place value is
   2^(n-1) and partners sit exactly `stride` apart. Each pair gets
   the 2x2 mix, every other amplitude is left alone. */
function applyGate(state, matrix, qubit, n) {
  // the gate's qubit as a binary place value
  const stride = 1 << (n - 1 - qubit);

  // work on a copy; the caller's list is never edited
  const out = state.slice();

  for (let i = 0; i < state.length; i++) {
    if (i & stride) continue; // only visit the "0" side of each pair
    const j = i + stride;     // its "1" partner is stride away
    const a = state[i];
    const b = state[j];
    out[i] = matrix[0][0] * a + matrix[0][1] * b;
    out[j] = matrix[1][0] * a + matrix[1][1] * b;
  }
  return out;
}

/* applyCnot(state, control, target, n): the conditional swap.
   For every index whose control bit is 1, swap the amplitude with
   the index differing only in the target bit; other indices are
   left alone. Same conventions as applyGate. */
function applyCnot(state, control, target, n) {
  const controlStride = 1 << (n - 1 - control);
  const targetStride = 1 << (n - 1 - target);

  const out = state.slice(); // copy, like applyGate

  for (let i = 0; i < state.length; i++) {
    if (!(i & controlStride)) continue; // control 0: the rule does nothing here
    if (i & targetStride) continue;     // visit each target pair once
    const j = i | targetStride;         // target bit is 0 here, so OR = add
    out[i] = state[j];                  // swap the pair...
    out[j] = state[i];                  // ...instead of mixing it
  }
  return out;
}

/* simulate(circuitRows, n): run the whole circuit, return 2^n
   probabilities (amplitudes squared); entry k belongs to bit
   pattern k with q0 leftmost. circuitRows is toSimInput() output,
   already sorted by column. Two gates in one column never share a
   qubit (recognize.js slot rule), so list order inside a column
   cannot matter. Assumes VALID input: an unknown gate letter
   crashes the GATES lookup on purpose — judging validity is
   validateCircuit's job. */
function simulate(circuitRows, n) {
  // start on the all-zeros pattern; index 0 under our convention
  const size = 1 << n;
  let amps = new Array(size).fill(0);
  amps[0] = 1;

  for (const op of circuitRows) {
    // R is a rotation about the Y axis, built fresh from the angle:
    // a=0 -> identity, a=pi -> acts like X, a=pi/2 -> a fair coin.
    // All entries stay real for every angle — why this app uses RY.
    if (op.gate === "CNOT") {
      amps = applyCnot(amps, op.c, op.t, n);
    } else if (op.gate === "R") {
      const a = op.angle;
      const ry = [
        [Math.cos(a / 2), -Math.sin(a / 2)],
        [Math.sin(a / 2),  Math.cos(a / 2)],
      ];
      amps = applyGate(amps, ry, op.q, n);
    } else {
      amps = applyGate(amps, GATES[op.gate], op.q, n);
    }
  }

  // Born rule: probability = amplitude squared (signs vanish).
  return amps.map((a) => a * a);
}

/* toSimInput(wires, circuit, blocks, variables): drawing-speak ->
   simulator-speak. The circuit stores wire ROWS (y pixels), never
   qubit numbers; qubit numbers are derived HERE with the same rule
   render() uses: sort rows top to bottom, the top row is qubit 0.
   Gates are anchored to wire rows, so drawing a new wire above
   never renumbers existing gates (tests pin this behavior).
   Blocks are expanded first, so downstream sees plain gates only;
   an R stores a variable NAME, resolved to a number here so
   editing a variable value can re-run this and move the bars
   live. Returns { n, ops, error }, ops sorted by column. */
function toSimInput(wires, circuit, blocks, variables) {
  blocks = blocks || {};
  variables = variables || {};

  // 1. numeric comparator required: bare sort() compares strings
  //    ("100" < "40"). addWire() merges same-row pieces, so every
  //    wire owns a different row: no ties.
  const rows = wires.map((w) => w.y).sort((a, b) => a - b);

  // 2. y -> qubit index: the position in that sorted list.
  const qubitOfRow = {};
  rows.forEach((y, i) => { qubitOfRow[y] = i; });

  // 3. Blocks -> plain gates. On an expansion error the op list is
  //    left empty: the panel never simulates while validateCircuit
  //    has anything to say, and the error travels along for it.
  const expanded = expandBlocks(circuit, wires, blocks);
  const gates = expanded.error ? [] : expanded.gates;

  // 4. Orphans (rows with no wire) are SKIPPED, not crashed on:
  //    validateCircuit() explains problems in plain English, and
  //    the panel never simulates while it has anything to say.
  const ops = [];
  for (const g of gates) {
    if (g.gate === "CNOT") {
      const c = qubitOfRow[g.cy];
      const t = qubitOfRow[g.ty];
      if (c === undefined || t === undefined) continue; // orphan end
      ops.push({ gate: "CNOT", c: c, t: t, col: g.col });
      continue;
    }
    const q = qubitOfRow[g.y];
    if (q === undefined) continue; // orphan

    if (g.gate === "R") {
      // The entry carries a variable NAME; resolve it to a number
      // here. Missing / not a number -> skip (the validator
      // explains); NaN must never reach the math.
      const v = variables[g.angle];
      if (typeof v === "number" && isFinite(v)) {
        ops.push({ gate: "R", q: q, col: g.col, angle: v });
      }
      continue;
    }

    ops.push({ gate: g.gate, q: q, col: g.col });
  }

  // 5. Time order: sort by column. Array.sort is stable, so
  //    same-column gates keep their drawn order — harmless, they
  //    act on different wires (see simulate).
  ops.sort((a, b) => a.col - b.col);

  return { n: rows.length, ops: ops, error: expanded.error };
}

/* The wire-row span a circuit entry COVERS in its column: a boxed
   gate covers just its own row; a CNOT covers its whole connector
   span (control, target, and every row between). Used by the
   validator's collision check. */
function entryRowSpan(entry) {
  if (entry.gate === "CNOT") {
    return [Math.min(entry.cy, entry.ty), Math.max(entry.cy, entry.ty)];
  }
  return [entry.y, entry.y];
}

/* validateCircuit(wires, circuit, blocks, variables): judge before
   running. Returns a list of plain-English problems; an empty list
   means all clear (the panel refuses to simulate while non-empty).
   Checks run on the EXPANDED circuit, so block insides are judged
   by the same rules as hand-drawn gates. Checks: wire count vs
   MAX_QUBITS (defensive — drawing.js already refuses a 6th wire,
   but validators exist for paths nobody has invented yet), the
   expansion's error, a gate or CNOT end with no wire under it, a
   CNOT starting and ending on the same wire, an unknown gate
   letter (defensive — a message instead of a crash), an R whose
   variable is missing or non-numeric, and two entries claiming
   overlapping rows in one column. NO wires is deliberately not a
   problem: that is an empty notebook, not an error. */
function validateCircuit(wires, circuit, blocks, variables) {
  blocks = blocks || {};
  variables = variables || {};
  const problems = [];

  if (wires.length === 0) return problems; // empty notebook, not an error

  if (wires.length > MAX_QUBITS) {
    problems.push(
      "This circuit has " + wires.length + " qubits — " +
      "NotebookQ simulates at most " + MAX_QUBITS + "."
    );
  }

  // Expand blocks once: hand-drawn gates and block insides share
  // one set of rules.
  const expanded = expandBlocks(circuit, wires, blocks);
  if (expanded.error) {
    problems.push(expanded.error);
    return problems; // nothing sane left to check past a broken expansion
  }
  const gates = expanded.gates;

  for (const g of gates) {
    if (g.gate === "CNOT") {
      // Same-wire is the more specific diagnosis: checked first so
      // one broken CNOT gets exactly one message, not two.
      if (g.cy === g.ty) {
        problems.push(
          "The CNOT in column " + g.col + " starts and ends on the same wire — " +
          "control and target must be two different wires."
        );
        continue;
      }
      // Both ends need a wire underneath.
      const cOn = wires.some((w) => w.y === g.cy);
      const tOn = wires.some((w) => w.y === g.ty);
      if (!cOn || !tOn) {
        problems.push(
          "The CNOT in column " + g.col + " has no wire under one of its ends — " +
          "draw a wire through both."
        );
      }
      continue; // CNOT has no letter to classify — skip the checks below
    }

    const onWire = wires.some((w) => w.y === g.y);
    if (!onWire) {
      problems.push(
        "The " + g.gate + " in column " + g.col + " has no wire under it — " +
        "draw a wire through it, or it stays ink."
      );
    }
    if (!GATES[g.gate] && g.gate !== "R") {
      problems.push(
        "The letter \"" + g.gate + "\" in column " + g.col +
        " is not one the simulator knows (H, X, Z, R)."
      );
    }
    if (g.gate === "R") {
      // Missing name (never given an angle) and non-numeric value
      // (fixable in the variables panel) get distinct messages.
      if (!g.angle) {
        problems.push(
          "The R in column " + g.col + " has no angle variable yet — " +
          "click it and pick one from the dropdown."
        );
      } else if (typeof variables[g.angle] !== "number" ||
                 !isFinite(variables[g.angle])) {
        problems.push(
          "The R in column " + g.col + " uses the variable \"" + g.angle +
          "\", but that variable does not hold a number — check the variables panel."
        );
      }
    }
  }

  // Slot collisions: two entries clash when they share a column
  // AND their covered row spans overlap (covers single vs CNOT and
  // CNOT vs CNOT, since a CNOT's span covers every row it crosses).
  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      const a = gates[i];
      const b = gates[j];
      if (a.col !== b.col) continue;
      const sa = entryRowSpan(a);
      const sb = entryRowSpan(b);
      if (sa[0] <= sb[1] && sb[0] <= sa[1]) {
        if (a.gate !== "CNOT" && b.gate !== "CNOT") {
          problems.push(
            "Column " + a.col + " on one wire has two gates — only one fits."
          );
        } else {
          problems.push(
            "Column " + a.col + " is already used between those wires."
          );
        }
      }
    }
  }

  return problems;
}

/* expandBlocks(circuit, wires, blocks, seen) (pure): replace BLOCK
   placements with the gates of their definitions. A definition
   { wires, gates } stores RELATIVE wire indices (0 = the block's
   top wire) and columns relative to the block's left edge;
   relative index k maps onto the (rank of y + k)-th sorted wire
   row. Blocks may contain blocks — expansion recurses — so names
   on the current expansion path are remembered, and a repeat
   (a block containing itself) is an error instead of infinite
   recursion. Returns { gates, error: null } or
   { gates: null, error: "one plain-English sentence" }. */
function expandBlocks(circuit, wires, blocks, seen) {
  blocks = blocks || {};
  const path = seen || []; // names on the CURRENT expansion path
  const rows = wires.map((w) => w.y).sort((a, b) => a - b);
  const out = [];

  for (const g of circuit) {
    if (g.gate !== "BLOCK") {
      out.push(g); // plain gate / CNOT: passes through untouched
      continue;
    }
    const res = expandBlockDef(g, rows, blocks, path);
    if (res.error) return { gates: null, error: res.error };
    out.push(...res.gates);
  }
  return { gates: out, error: null };
}

/* Stamp ONE block placement (entry) onto the real wire rows. */
function expandBlockDef(entry, rows, blocks, path) {
  const def = blocks[entry.name];
  if (!def || !Array.isArray(def.gates)) {
    return { error: 'Block "' + entry.name + '" is placed but has no definition — select gates and save one first.' };
  }
  if (path.indexOf(entry.name) !== -1) {
    return { error: 'Block "' + entry.name + '" contains itself (directly or through other blocks) — a block cannot sit inside its own definition.' };
  }
  const topRank = rows.indexOf(entry.y); // which wire is the block's top?
  if (topRank === -1) {
    return { error: 'The block "' + entry.name + '" in column ' + entry.col + ' has no wire under it.' };
  }
  const need = def.wires || 1;
  if (topRank + need > rows.length) {
    return { error: 'Block "' + entry.name + '" needs ' + need + ' wires starting at its top wire — only ' + (rows.length - topRank) + ' fit there.' };
  }

  const out = [];
  for (const g of def.gates) {
    const col = entry.col + g.col;       // relative col → absolute col
    if (g.gate === "CNOT") {
      // CNOT entries carry cy/ty (NOT y) — both are relative wire
      // indices inside the block, and both must stamp onto real rows.
      const cy = rows[topRank + g.cy];
      const ty = rows[topRank + g.ty];
      if (cy === undefined || ty === undefined) {
        return { error: 'Block "' + entry.name + '" reaches below the wires it is placed on.' };
      }
      out.push({ gate: "CNOT", cy: cy, ty: ty, col: col });
    } else if (g.gate === "BLOCK") {
      // Nested block: relocate its anchor row/col, then recurse —
      // with this name added to the path so a loop is caught.
      const y = rows[topRank + g.y];
      if (y === undefined) {
        return { error: 'Block "' + entry.name + '" reaches below the wires it is placed on.' };
      }
      const res = expandBlockDef(
        { gate: "BLOCK", name: g.name, y: y, col: col },
        rows, blocks, path.concat(entry.name)
      );
      if (res.error) return res;
      out.push(...res.gates);
    } else {
      const y = rows[topRank + g.y];     // relative index → absolute row
      if (y === undefined) {
        return { error: 'Block "' + entry.name + '" reaches below the wires it is placed on.' };
      }
      // Copy every other property across (an R keeps its angle name).
      const copy = Object.assign({}, g, { y: y, col: col });
      out.push(copy);
    }
  }
  return { gates: out };
}

/* phaseHint(circuit) (pure): Z flips a SIGN, and the Born rule
   squares amplitudes — squaring erases signs, so a Z drawn where
   no later H mixes the sign back into odds changes nothing
   visible (H·Z·H acts like X). If the circuit contains a Z but NO
   H in a later column (on any wire), return the hint sentence;
   otherwise null. */
function phaseHint(circuit) {
  // Columns only — rows don't matter: a hidden sign hides the same
  // way on any wire.
  let lastZ = -1;
  for (const g of circuit) {
    if (g.gate === "Z" && g.col > lastZ) lastZ = g.col;
  }
  if (lastZ < 0) return null;

  // An H after the Z would fold the hidden sign into visible odds.
  const mixed = circuit.some((g) => g.gate === "H" && g.col > lastZ);
  return mixed
    ? null
    : "Z changes a hidden sign; it only shows up after an H.";
}

/* Test hook: under node this file is a module (tests load it
   directly); in the browser the block does nothing and the file
   stays a plain classic <script>. */
if (typeof module !== "undefined") {
  module.exports = { GATES, MAX_QUBITS, applyGate, applyCnot, simulate, toSimInput, validateCircuit, phaseHint, expandBlocks };
}
