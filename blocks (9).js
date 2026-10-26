/* blocks.js — SELECT mode and reusable blocks.
   A block definition stores gates with coordinates relative to the
   block's top-left wire/column, so the same block can be placed on
   any wires later. Select mode shares the canvas with the pen;
   drawing.js checks isSelectMode() and stands down when it is on. */

let selectMode = false;  // is the rectangle tool active?
let selectDrag = null;   // while dragging: the rectangle's first corner

// The six legal block names (the letters we ship templates for).
const BLOCK_LETTERS = "ABCDEF";

function isBlockLetter(s) {
  return typeof s === "string" && s.length === 1 &&
         BLOCK_LETTERS.indexOf(s) !== -1;
}

function isSelectMode() { return selectMode; }

function toggleSelectMode() {
  selectMode = !selectMode;
  // Teaching and selecting both want the pen's meaning — one at a time.
  if (selectMode && isTeaching()) {
    state.teach = null;
    refreshTeachButtons();
  }
  document.getElementById("selectBtn").classList.toggle("on", selectMode);
  canvas.classList.toggle("selecting", selectMode); // CSS swaps the cursor
  if (!selectMode) clearSelection();
  showMessage(selectMode
    ? "Select mode — drag a rectangle over some gates"
    : "Sketch mode");
}

function clearSelection() {
  state.selection = null;
  hideSaveChip();
  render();
}

function setupBlocksUI() {
  document.getElementById("selectBtn").addEventListener("click", toggleSelectMode);

  canvas.addEventListener("pointerdown", onSelectDown);
  canvas.addEventListener("pointermove", onSelectMove);
  canvas.addEventListener("pointerup", onSelectUp);
  canvas.addEventListener("pointercancel", onSelectCancel);

  document.getElementById("saveAsBlockBtn").addEventListener("click", openBlockModal);
  document.getElementById("blockOkBtn").addEventListener("click", saveBlockFromSelection);
  document.getElementById("blockCancelBtn").addEventListener("click", closeBlockModal);
  const modal = document.getElementById("blockModal");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeBlockModal();
  });
  document.getElementById("blockNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBlockFromSelection();
    if (e.key === "Escape") closeBlockModal();
  });
}

function onSelectDown(e) {
  if (!selectMode || e.button !== 0) return;
  selectDrag = eventToCanvasPoint(e);
  state.selection = { x1: selectDrag.x, y1: selectDrag.y,
                      x2: selectDrag.x, y2: selectDrag.y };
  hideSaveChip(); // a new drag means the old pick is void
  render();
}

function onSelectMove(e) {
  if (!selectDrag) return;
  const p = eventToCanvasPoint(e);
  state.selection.x2 = p.x;
  state.selection.y2 = p.y;
  render();
}

function onSelectUp() {
  if (!selectDrag) return;
  selectDrag = null;
  const picked = gatesInSelection(state.selection);
  if (picked.length === 0) {
    state.selection = null; // an empty rectangle selects nothing
  } else {
    showSaveChip();
  }
  render();
}

function onSelectCancel() {
  selectDrag = null;
}

// A gate is selected when its anchor column's center is inside the x
// range and ALL its wires are inside the y range (a CNOT needs both
// ends, a block its whole frame). `pad` forgives a slightly short rect.
// Pure function: entries and a rect in, a filtered list out.
function gatesInSelection(rect) {
  if (!rect) return [];
  const pad = 10;
  const nx1 = Math.min(rect.x1, rect.x2) - pad;
  const nx2 = Math.max(rect.x1, rect.x2) + pad;
  const ny1 = Math.min(rect.y1, rect.y2) - pad;
  const ny2 = Math.max(rect.y1, rect.y2) + pad;
  return state.circuit.filter((g) => {
    const cx = columnCenterX(g.col);
    if (cx < nx1 || cx > nx2) return false;
    return rowsOfEntry(g).every((y) => y >= ny1 && y <= ny2);
  });
}

// Every wire row an entry touches (single / CNOT / BLOCK).
function rowsOfEntry(g) {
  if (g.gate === "CNOT") return [g.cy, g.ty];
  if (g.gate === "BLOCK") return [g.y, g.y2 !== undefined ? g.y2 : g.y];
  return [g.y];
}

function showSaveChip() { document.getElementById("saveAsBlockChip").classList.add("show"); }
function hideSaveChip() {
  const el = document.getElementById("saveAsBlockChip");
  if (el) el.classList.remove("show");
}

function openBlockModal() {
  const modal = document.getElementById("blockModal");
  const input = document.getElementById("blockNameInput");
  input.value = "";
  modal.classList.add("open");
  input.focus();
}

function closeBlockModal() {
  document.getElementById("blockModal").classList.remove("open");
}

// Turn the selection into a block definition: rows become indices
// inside the block, columns become offsets from the leftmost selected
// column. expandBlocks (simulator.js) stamps the definition back out.
function saveBlockFromSelection() {
  const input = document.getElementById("blockNameInput");
  const letter = input.value.trim().toUpperCase();
  if (!isBlockLetter(letter)) {
    showMessage("Block names are one letter, A to F");
    return;
  }
  const picked = gatesInSelection(state.selection);
  if (picked.length === 0) {
    showMessage("Nothing selected — drag a rectangle over some gates first");
    closeBlockModal();
    return;
  }

  // The selection's rows, sorted — the block's wire universe.
  const rowSet = [];
  for (const g of picked) {
    for (const y of rowsOfEntry(g)) {
      if (rowSet.indexOf(y) === -1) rowSet.push(y);
    }
  }
  rowSet.sort((a, b) => a - b);

  // Relativize every entry. minCol is the block's new "col 0".
  const minCol = Math.min(...picked.map((g) => g.col));
  const gates = picked.map((g) => {
    const rel = { col: g.col - minCol };
    if (g.gate === "CNOT") {
      rel.gate = "CNOT";
      rel.cy = rowSet.indexOf(g.cy);
      rel.ty = rowSet.indexOf(g.ty);
    } else if (g.gate === "BLOCK") {
      rel.gate = "BLOCK";
      rel.name = g.name;
      rel.y = rowSet.indexOf(g.y);
    } else {
      rel.gate = g.gate;
      rel.y = rowSet.indexOf(g.y);
      if (g.angle !== undefined) rel.angle = g.angle; // R keeps its variable
    }
    return rel;
  });

  // Overwriting an existing letter is allowed and announced.
  beforeChange();
  const existed = !!state.blocks[letter];
  state.blocks[letter] = {
    wires: rowSet.length,
    cols: Math.max(...gates.map((g) => g.col)) + 1,
    gates: gates,
  };
  closeBlockModal();
  clearSelection(); // also hides the chip + renders
  showMessage(existed
    ? 'Block "' + letter + '" replaced'
    : 'Block "' + letter + '" saved — box the letter ' + letter +
      ' on a wire to place it');
}

// The user boxed a block letter on a wire (called from drawing.js).
// Frame corners (y2/col2) are computed here and stored, so
// gateSlotTaken and the painter need no lookups later.
function tryPlaceBlock(gate, indices, strokeObjs) {
  const letter = gate.gate;
  const def = state.blocks[letter];

  if (!def || !Array.isArray(def.gates)) {
    showMessage('There is no block "' + letter + '" yet — select gates and save one first.');
    return true;
  }

  const rows = state.wires.map((w) => w.y).sort((a, b) => a - b);
  const topRank = rows.indexOf(gate.y);
  const need = def.wires || 1;
  if (topRank === -1 || topRank + need > rows.length) {
    showMessage('Block "' + letter + '" needs ' + need + ' wires starting at its top wire — only ' +
                (topRank === -1 ? 0 : rows.length - topRank) + ' fit there.');
    return true;
  }

  // The whole frame must be free: every wire it covers, every column it spans.
  const cols = def.cols || 1;
  for (let k = 0; k < need; k++) {
    for (let c = gate.col; c < gate.col + cols; c++) {
      if (gateSlotTaken(state.circuit, rows[topRank + k], c)) {
        showMessage('Placing block "' + letter + '" here would overlap an existing gate.');
        return true;
      }
    }
  }

  beforeChange();
  if (indices) removeStrokesAt(indices);
  else if (strokeObjs) removeStrokesByObject(strokeObjs);
  state.circuit.push({
    gate: "BLOCK", name: letter,
    y: gate.y, col: gate.col,
    y2: rows[topRank + need - 1],
    col2: gate.col + cols - 1,
  });
  render();
  showMessage('Placed block "' + letter + '"');
  return true;
}
