/* codepanel.js — the CODE view (browser side of qasm.js).
   Open: text is written from the drawing. Typing: re-parsed after a
   short pause; errors name the line number, and Apply stays off
   until the text parses. Apply: redraws the page from the text as
   one undo step. Nothing touches the drawing until Apply. */

const CODE_STARTER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n';

let codeCheckTimer = null;

function setupCodeUI() {
  const modal = document.getElementById("codeModal");
  const text = document.getElementById("codeText");
  const status = document.getElementById("codeStatus");
  const applyBtn = document.getElementById("codeApplyBtn");

  function fillFromDrawing() {
    const res = toQasm(state.wires, state.circuit, state.variables, state.blocks);
    // An empty or unexportable drawing starts from a small example
    // instead of a blank box — the example IS the documentation.
    text.value = res.error ? CODE_STARTER : res.code;
    checkNow();
  }

  // Re-parse the textarea and show the verdict. textContent only —
  // the text is the user's, never trusted as HTML.
  function checkNow() {
    const res = fromQasm(text.value, state.variables);
    status.textContent = "";
    const add = (cls, msg) => {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = msg;
      status.appendChild(d);
    };
    if (!res.ok) {
      res.errors.slice(0, 4).forEach((e) => add("code-err", e.message));
      if (res.errors.length > 4) add("code-err", "…and " + (res.errors.length - 4) + " more.");
      applyBtn.disabled = true;
      return;
    }
    // Parsed — but is the DRAWING it would make valid? The same
    // validator as hand-drawn circuits gets a veto.
    const problems = validateCircuit(res.wires, res.circuit, state.blocks, res.variables);
    if (problems.length > 0) {
      problems.slice(0, 3).forEach((p) => add("code-err", p));
      applyBtn.disabled = true;
      return;
    }
    res.warnings.forEach((w) => add("code-warn", w));
    add("code-ok", "Reads fine — " + res.wires.length + " qubit" + (res.wires.length === 1 ? "" : "s") +
                   ", " + res.circuit.length + " gate" + (res.circuit.length === 1 ? "" : "s") + ".");
    applyBtn.disabled = false;
  }

  function open() {
    fillFromDrawing();
    modal.classList.add("open");
    text.focus();
  }
  function close() {
    modal.classList.remove("open");
    if (codeCheckTimer !== null) { clearTimeout(codeCheckTimer); codeCheckTimer = null; }
  }

  document.getElementById("codeBtn").addEventListener("click", open);
  document.getElementById("codeCloseBtn").addEventListener("click", close);
  document.getElementById("codeReloadBtn").addEventListener("click", fillFromDrawing);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) close();
  });

  // Parse on pause (300ms), not on every keystroke — a half-typed
  // line is normal while typing.
  text.addEventListener("input", () => {
    if (codeCheckTimer !== null) clearTimeout(codeCheckTimer);
    applyBtn.disabled = true;           // unknown until the pause ends
    codeCheckTimer = setTimeout(checkNow, 300);
  });
  // Tab inserts two spaces instead of leaving the box.
  text.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const a = text.selectionStart, b = text.selectionEnd;
      text.value = text.value.slice(0, a) + "  " + text.value.slice(b);
      text.selectionStart = text.selectionEnd = a + 2;
      text.dispatchEvent(new Event("input"));
    }
  });

  applyBtn.addEventListener("click", () => {
    // Re-parse at click time: never apply a stale verdict.
    const res = fromQasm(text.value, state.variables);
    if (!res.ok) { checkNow(); return; }
    if (validateCircuit(res.wires, res.circuit, state.blocks, res.variables).length > 0) { checkNow(); return; }
    beforeChange();                    // the old drawing becomes an undo step
    state.strokes = [];                // loose ink would sit on top of the new drawing
    state.wires = res.wires;
    state.circuit = res.circuit;
    state.variables = res.variables;   // existing variables + any new ones
    render();
    close();
    showMessage("Redrawn from code — " + res.wires.length + " wires, " +
                res.circuit.length + " gates. Ctrl+Z undoes it.");
  });
}
