/* Start-up and render loop. render() repaints the whole canvas from
   state on every change — nothing tracks incremental canvas edits. */

/* Repaint the whole canvas from `state`. */
function render() {
  // Clear to transparent; the paper color comes from CSS behind the canvas.
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  drawGrid();

  // Wires, sorted by row: position in the sorted list IS the qubit number.
  // Sort a copy — render() only reads state.
  const wiresByRow = [...state.wires].sort((a, b) => a.y - b.y);
  wiresByRow.forEach((wire, index) => {
    drawWire(wire);
    drawWireLabel(wire, "q" + index); // its position in the sorted list
  });                                 // IS its qubit number (top = q0)

  // Circuit entries draw after wires (paper fills mask the wire
  // underneath) and before ink, so fresh handwriting sits on top.
  for (const entry of state.circuit) {
    if (entry.gate === "CNOT") drawCnot(entry);
    else if (entry.gate === "BLOCK") drawBlock(entry);
    else drawGate(entry);
  }

  // Selection under ink so it never hides handwriting.
  if (state.selection) drawSelection(state.selection);

  // Freehand ink on top.
  for (const stroke of state.strokes) {
    drawStroke(stroke);
  }

  // All state changes funnel through render(), so this one call keeps
  // the results panel live for wires, gates and Clear alike.
  renderResults();

  // Autosave is debounced (files.js): re-armed on every render, only
  // the last timer writes, so a refresh loses at most one interval.
  scheduleAutosave();

  renderVariables();
}

/* One-time setup: connect all the pieces and start. */
function init() {
  setupCanvas();  // size the bitmap to match the screen's sharpness
  setupDrawing(); // attach the pointer listeners (drawing.js)

  // Built-in letter templates plus the user's own from localStorage (teach.js).
  state.templates = initialTemplates();
  setupTeachUI();  // toolbar buttons: Teach H / X / Z / R

  setupFilesUI();
  setupCodeUI();      // the Code view (OpenQASM <-> drawing)
  setupVariablesUI(); // the variables strip + R angle picker
  setupBlocksUI();    // select mode + block save/place
  setupAIUI();        // the AI sketch door
  setupUndoUI();      // undo/redo buttons + keyboard

  const helpOverlay = document.getElementById("helpOverlay");
  document.getElementById("helpBtn").addEventListener("click", () => {
    helpOverlay.classList.add("open");
    document.getElementById("helpCloseBtn").focus(); // keyboard flow starts here
  });
  document.getElementById("helpCloseBtn").addEventListener("click", () => {
    helpOverlay.classList.remove("open");
  });
  helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) helpOverlay.classList.remove("open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && helpOverlay.classList.contains("open")) {
      helpOverlay.classList.remove("open");
    }
  });

  if (restoreAutosave()) {
    // showMessage needs a rendered chip to attach to, so defer one tick.
    setTimeout(() => showMessage("Restored your last drawing"), 50);
  }

  render();       // paint the first (empty) frame: grid only

  // Webfonts load async, so repaint once when document.fonts settles —
  // otherwise canvas text stays in the fallback font forever.
  document.fonts.ready.then(render);

  document.getElementById("clearBtn").addEventListener("click", () => {
    beforeChange(); // the pre-clear state becomes an undo step
    closeAnglePicker(); // an open R dropdown would point at a ghost
    clearSelection();   // a dangling rectangle selects nothing now
    state.strokes = []; // clear every layer: raw ink, recognized wires,
    state.wires = [];   // and recognized gates — all of it is drawing.
    state.circuit = [];
    // Blocks and variables survive Clear — they are definitions, not drawing.
    render();
  });

  // setupCanvas() re-creates the bitmap (which wipes it), so repaint
  // immediately; the drawing survives because state is not pixels.
  window.addEventListener("resize", () => {
    setupCanvas();
    render();
  });
}

/* Transient message, bottom-left of the paper. Fades out by itself. */
let msgTimer = null; // remembers the pending fade-out

function showMessage(text) {
  const el = document.getElementById("msg");
  el.textContent = text;
  el.classList.add("show");          // CSS fades the chip IN
  if (msgTimer !== null) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {       // ...and OUT again 2.6s later
    el.classList.remove("show");
    msgTimer = null;
  }, 2600);
}

init();
