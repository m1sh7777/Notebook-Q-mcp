/* The app's shared state. Every other file reads and writes this one
   object; the canvas is always repainted from it (never edited). */

const state = {
  // Freehand strokes: [{points: [{x, y, p, t}], endedAt}]
  // x,y in canvas CSS px; p = pressure 0..1 (0.5 for mouse/touch);
  // t = point time (performance.now()); endedAt = pen-up time (grouping).
  strokes: [],

  // Recognized wires: [{y, x1, x2}] — y is the grid row, snapped.
  wires: [],

  // Recognized circuit entries, anchored to wire ROWS, never qubit
  // indices (indices shift when a new wire is drawn above; rows don't):
  // { gate, y, col } or { gate: "CNOT", cy, ty, col }.
  circuit: [],

  // Current teach letter ("H" | "X" | "Z"), null when not teaching.
  teach: null,

  // Letter templates for classifyLetter: { H: [example, ...] },
  // each example = [[{x, y}, ...], ...]. Built at startup from
  // DEFAULT_TEMPLATES plus user examples loaded from localStorage.
  templates: {},

  // Handwritten labels linked to variables.
  variables: {},

  // Reusable block definitions: state.blocks.A = { wires, gates }.
  // Relative entries: y is a wire index inside the block (0 = top
  // wire), col relative to the block's left edge. Definitions
  // survive Clear — they are vocabulary, not drawing.
  blocks: {},

  // Last simulation results ({n, probs}) or null.
  results: null,

  // Active selection rectangle in canvas CSS px: {x1, y1, x2, y2},
  // null when nothing is selected.
  selection: null,
};
