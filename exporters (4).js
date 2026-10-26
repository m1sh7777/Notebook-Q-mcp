/* exporters.js — export/save serialization (pure: no DOM, no
   global `state`, so plain node can test it).

     toQiskitCode(...)      -> Qiskit source text
     buildTrainingData(...) -> training JSON (teach-mode examples)
     serializeDrawing(...)  -> the whole notebook as one JSON object
     parseDrawing(...)      -> ...and back; accepts only data shaped
                               like our save format (a loaded file
                               is user input and never trusted)

   Shared rule with the simulator: qubit index = position in the
   SORTED row list, top row = 0 — export and odds panel can never
   disagree about which wire is which qubit. */

/* toQiskitCode(wires, circuit, variables, blocks): drawing ->
   Qiskit source text. Wires map to QuantumCircuit(n) with qubit
   index = position in the sorted row list (top = 0). Blocks are
   expanded first, so exported code never contains block names.
   An R exports its variable's VALUE (Qiskit knows nothing of our
   variables). Returns { code, error }. Text only — Qiskit is
   never imported or run. */
function toQiskitCode(wires, circuit, variables, blocks) {
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

  // Orphans are skipped here; the validator explains them. An R
  // with a non-numeric variable stops the export, though — the
  // angle is untranslatable.
  const lines = [];
  const keyed = [];
  for (const g of expanded.gates) {
    const col = g.col;
    if (g.gate === "CNOT") {
      const c = qubitOfRow[g.cy];
      const t = qubitOfRow[g.ty];
      if (c === undefined || t === undefined) continue; // orphan end
      keyed.push({ k: [col, Math.min(c, t)], line: "qc.cx(" + c + ", " + t + ")" });
      continue;
    }
    const q = qubitOfRow[g.y];
    if (q === undefined) continue; // orphan
    if (g.gate === "R") {
      const v = variables[g.angle];
      if (typeof v !== "number" || !isFinite(v)) {
        return {
          code: null,
          error: 'Cannot export: the R in column ' + col + ' uses the variable "' +
                 g.angle + '", which does not hold a number. Fix it in the variables panel.',
        };
      }
      keyed.push({ k: [col, q], line: "qc.ry(" + fmtAngle(v) + ", " + q + ")" });
      continue;
    }
    keyed.push({ k: [col, q], line: "qc." + g.gate.toLowerCase() + "(" + q + ")" });
  }
  keyed.sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]));

  lines.push("# NotebookQ -> Qiskit. q0 is the TOP wire (QuantumCircuit's qubit 0).");
  const varNames = Object.keys(variables);
  if (varNames.length > 0) {
    lines.push("# Variables: " + varNames.map((n) => n + " = " + fmtAngle(variables[n])).join(", "));
  }
  lines.push("from qiskit import QuantumCircuit");
  lines.push("qc = QuantumCircuit(" + rows.length + ")");
  for (const k of keyed) lines.push(k.line);

  return { code: lines.join("\n"), error: null };
}

/* A variable value for export: full precision shows floating
   noise (1.5707963267948966); trim to 9 decimals, which keeps
   every angle a student will ever type. */
function fmtAngle(v) {
  return String(Math.round(v * 1e9) / 1e9);
}

/* buildTrainingData(store): the Teach-mode notebook -> training
   JSON. `store` is the taught-examples dictionary teach.js keeps
   in localStorage: { H: [ example, ... ], R: [...] }, where one
   example = [ strokes ] and one stroke = [ {x, y} points ].
   Each example is NORMALIZED before export: shifted so its own
   middle sits at (0,0) and scaled so its longest side is 1 — size
   and position on the pad were never the letter, the shape is.
   Stroke structure is kept (unlike the recognizer's 32-point
   cloud) so a model can still see where each stroke began and
   ended. Returns { exportedAt, count, examples }. */
function buildTrainingData(store) {
  const examples = [];
  for (const label of Object.keys(store)) {
    for (const example of store[label]) {

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let hasPoint = false;
      for (const stroke of example) {
        for (const p of stroke) {
          hasPoint = true;
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      }
      if (!hasPoint) continue; // empty example

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const size = Math.max(maxX - minX, maxY - minY) || 1; // guard /0

      examples.push({
        label: label,
        strokes: example.map((stroke) =>
          stroke.map((p) => ({
            x: Math.round(((p.x - cx) / size) * 1e4) / 1e4,
            y: Math.round(((p.y - cy) / size) * 1e4) / 1e4,
          }))
        ),
      });
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    note: "points normalized: center (0,0), longest side 1; one stroke array per pen stroke",
    count: examples.length,
    examples: examples,
  };
}

/* serializeDrawing() / parseDrawing(json): the whole notebook as
   portable JSON, and back. Strokes, wires, circuit, variables and
   block definitions travel; teach examples stay in their own
   localStorage (recognizer vocabulary, not drawing). parseDrawing
   accepts only data shaped like OUR save format and reports a
   plain-English error otherwise. */
const NOTEBOOKQ_SAVE_FORMAT = "notebookq-drawing";
const NOTEBOOKQ_SAVE_VERSION = 1;

function serializeDrawing() {
  return {
    format: NOTEBOOKQ_SAVE_FORMAT,
    version: NOTEBOOKQ_SAVE_VERSION,
    savedAt: new Date().toISOString(),
    // Deep-copy so later edits can never mutate the exported text.
    strokes: JSON.parse(JSON.stringify(state.strokes)),
    wires: JSON.parse(JSON.stringify(state.wires)),
    circuit: JSON.parse(JSON.stringify(state.circuit)),
    variables: Object.assign({}, state.variables),
    blocks: JSON.parse(JSON.stringify(state.blocks || {})),
  };
}

function parseDrawing(json) {
  let data;
  try {
    data = (typeof json === "string") ? JSON.parse(json) : json;
  } catch (err) {
    return { ok: false, error: "That file is not valid JSON — nothing was loaded." };
  }
  const bad = (why) => ({ ok: false, error: why });

  if (!data || typeof data !== "object") return bad("That file holds no drawing data.");
  if (data.format !== NOTEBOOKQ_SAVE_FORMAT) {
    return bad("That file was not saved by NotebookQ — nothing was loaded.");
  }
  if (!Array.isArray(data.strokes) || !Array.isArray(data.wires) ||
      !Array.isArray(data.circuit)) {
    return bad("That save file is missing its strokes, wires or circuit — nothing was loaded.");
  }

  // Accept it, but keep only the fields we understand — a file
  // with extra or hostile fields cannot smuggle them into `state`.
  return {
    ok: true,
    data: {
      strokes: data.strokes,
      wires: data.wires,
      circuit: data.circuit,
      variables: (data.variables && typeof data.variables === "object") ? data.variables : {},
      blocks: (data.blocks && typeof data.blocks === "object") ? data.blocks : {},
    },
  };
}

/* Module hook for node tests; inert in the browser. */
if (typeof module !== "undefined") {
  module.exports = { toQiskitCode, buildTrainingData, serializeDrawing, parseDrawing, fmtAngle };
}
