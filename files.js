/* files.js — data in and out of the page: export modal, downloads,
   Load, autosave. exporters.js does all the translating.

   Downloads: a Blob plus an <a download> link; the object URL must
   be revoked afterwards.
   Autosave is debounced (400ms): pointer moves fire render() dozens
   of times a second while a stroke is drawn, and stringifying the
   whole state that often is waste. Nothing is sent anywhere —
   localStorage only. */

// Where the autosave lives in localStorage (teach.js owns its own key).
const AUTOSAVE_KEY = "notebookq.autosave";

let autosaveTimer = null;

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;  // the name the browser's save dialog suggests
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url); // give the browser's memory back
}

// Grabbed once at load; the modal markup lives in index.html.
const exportModal = document.getElementById("exportModal");
const exportTitle = document.getElementById("exportTitle");
const exportPre = document.getElementById("exportPre");
const exportCopyBtn = document.getElementById("exportCopyBtn");

// Fill and open the modal. textContent only — exported text is shown
// as text, never as HTML, so nothing can inject markup.
function showExportModal(title, text) {
  exportTitle.textContent = title;
  exportPre.textContent = text;
  exportCopyBtn.textContent = "Copy"; // reset any earlier "Copied!"
  exportModal.classList.add("open");
}

// Clipboard API needs a secure context; fall back to select-and-copy,
// and if that fails too, say so instead of pretending.
function copyExportText() {
  const text = exportPre.textContent;
  const done = () => {
    exportCopyBtn.textContent = "Copied!";
    setTimeout(() => { exportCopyBtn.textContent = "Copy"; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  // A <pre> has no .select() (only inputs do) — select its contents
  // with a Range instead.
  try {
    const range = document.createRange();
    range.selectNodeContents(exportPre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (document.execCommand("copy")) { done(); return; }
  } catch (err) { /* fall through to the honest failure */ }
  showMessage("Copy failed — select the text and copy by hand");
}

function setupFilesUI() {
  // Export Qiskit: the pure exporter either writes code or explains why it can't.
  document.getElementById("qiskitBtn").addEventListener("click", () => {
    const res = toQiskitCode(state.wires, state.circuit, state.variables, state.blocks);
    if (res.error) { showMessage(res.error); return; }
    showExportModal("Qiskit code", res.code);
  });

  // Export training data: reads taught examples from teach.js's store.
  document.getElementById("trainBtn").addEventListener("click", () => {
    const data = buildTrainingData(loadTaughtStore());
    if (data.count === 0) {
      showMessage("No taught examples yet — use Teach mode first");
      return;
    }
    downloadText("notebookq-training.json", JSON.stringify(data, null, 2));
    showMessage("Downloaded " + data.count + " taught examples");
  });

  // Save the whole notebook as one JSON file.
  document.getElementById("saveBtn").addEventListener("click", () => {
    downloadText("notebookq-drawing.json", JSON.stringify(serializeDrawing(), null, 2));
    showMessage("Drawing saved to your downloads");
  });

  // Load: a hidden <input type=file> does the OS file picking; the
  // visible button just clicks it. parseDrawing only lets a real
  // NotebookQ save shape reach `state`.
  const loadInput = document.getElementById("loadInput");
  document.getElementById("loadBtn").addEventListener("click", () => {
    loadInput.value = ""; // re-selecting the same file must re-fire change
    loadInput.click();
  });
  loadInput.addEventListener("change", () => {
    const file = loadInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = parseDrawing(reader.result);
      if (!res.ok) { showMessage(res.error); return; }
      beforeChange(); // the pre-load state becomes an undo step
      state.strokes = res.data.strokes;
      state.wires = res.data.wires;
      state.circuit = res.data.circuit;
      state.variables = res.data.variables;
      state.blocks = res.data.blocks;
      render();
      showMessage("Loaded — " + res.data.wires.length + " wires, " +
                  res.data.circuit.length + " circuit parts");
    };
    reader.onerror = () => showMessage("Could not read that file");
    reader.readAsText(file);
  });

  // Modal plumbing: Copy, Close, backdrop click, Escape.
  exportCopyBtn.addEventListener("click", copyExportText);
  document.getElementById("exportCloseBtn").addEventListener("click", closeExportModal);
  exportModal.addEventListener("click", (e) => {
    if (e.target === exportModal) closeExportModal(); // only the backdrop
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && exportModal.classList.contains("open")) {
      closeExportModal();
    }
  });
}

function closeExportModal() {
  exportModal.classList.remove("open");
}

// Re-arm the debounced save; called from render() so every state
// change lands in localStorage within 400ms.
function scheduleAutosave() {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeDrawing()));
    } catch (err) {
      // Storage full or blocked: autosave is a convenience, never
      // worth breaking the app over. Silently try again next render.
    }
  }, 400);
}

// Restore the autosave at startup, if any. Returns true when the pad
// came back — main.js prints a note. An EMPTY saved drawing (user
// pressed Clear, then refreshed) is respected: it loads as empty,
// not as "no save".
function restoreAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const res = parseDrawing(raw);
    if (!res.ok) return false; // corrupt → start fresh, never crash
    const d = res.data;
    const empty = d.strokes.length === 0 && d.wires.length === 0 &&
                  d.circuit.length === 0;
    if (empty) return false;
    state.strokes = d.strokes;
    state.wires = d.wires;
    state.circuit = d.circuit;
    state.variables = d.variables;
    state.blocks = d.blocks;
    return true;
  } catch (err) {
    return false; // blocked storage etc. — a fresh start is fine
  }
}
