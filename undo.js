/* undo.js — undo/redo for strokes and placed items.
   Every mutation point calls beforeChange(), which snapshots the
   WHOLE state as JSON. Whole-state snapshots are used on purpose:
   no feature has to know how to reverse itself. Snapshots are taken
   at commit points (stroke end, gate commit, variable edit, block
   save, Clear, Load, AI accept); dedupe: skip pushing a state
   identical to the top. Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, but not
   while typing in a field (the browser owns text-undo there). */

const UNDO_LIMIT = 50; // snapshots kept — small drawings, tiny JSON

const undoStack = [];
const redoStack = [];

// The hook every mutation point calls. Pushes the pre-change state.
function beforeChange() {
  const snap = JSON.stringify({
    strokes: state.strokes,
    wires: state.wires,
    circuit: state.circuit,
    variables: state.variables,
    blocks: state.blocks,
  });
  const top = undoStack[undoStack.length - 1];
  if (top === snap) return;   // nothing actually changed — no ghost step
  undoStack.push(snap);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;       // a new move kills the redo future
}

// Restore a snapshot WITHOUT touching the stacks (restore is not
// itself a mutation to record).
function restoreSnapshot(snap) {
  // A pending group-commit timer belongs to the pre-undo future; if
  // it fired after a restore it would re-commit the restored ink
  // back into a wire.
  if (typeof pendingCommit !== "undefined" && pendingCommit !== null) {
    clearTimeout(pendingCommit);
    pendingCommit = null;
  }
  const d = JSON.parse(snap);
  closeAnglePicker(); // a picker pointing at an un-placed R is a ghost
  state.strokes = d.strokes;
  state.wires = d.wires;
  state.circuit = d.circuit;
  state.variables = d.variables;
  state.blocks = d.blocks;
  render();
}

function undo() {
  if (undoStack.length === 0) { showMessage("Nothing to undo"); return; }
  // The CURRENT state goes to the redo stack — undo is reversible.
  redoStack.push(JSON.stringify({
    strokes: state.strokes,
    wires: state.wires,
    circuit: state.circuit,
    variables: state.variables,
    blocks: state.blocks,
  }));
  restoreSnapshot(undoStack.pop());
  showMessage("Undone");
}

function redo() {
  if (redoStack.length === 0) { showMessage("Nothing to redo"); return; }
  undoStack.push(JSON.stringify({
    strokes: state.strokes,
    wires: state.wires,
    circuit: state.circuit,
    variables: state.variables,
    blocks: state.blocks,
  }));
  restoreSnapshot(redoStack.pop());
  showMessage("Redone");
}

function setupUndoUI() {
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);

  // Never while typing in a field (the browser's native text-undo
  // owns Ctrl+Z inside inputs).
  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const key = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) &&
               (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });
}
