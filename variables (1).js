/* variables.js — named numbers and the R gate's angle.
   An R gate stores the variable NAME, not the number
   ({ gate: "R", angle: "theta" }), so changing a variable's value
   once re-resolves every R on the next render. */

const varNameInput = document.getElementById("varNameInput");
const varValueInput = document.getElementById("varValueInput");
const varAddBtn = document.getElementById("varAddBtn");
const varChips = document.getElementById("varChips");

// Redraw the chips; called from render() like the canvas and odds panel.
function renderVariables() {
  const chips = [];
  for (const name of Object.keys(state.variables)) {
    chips.push(makeVarChip(name, state.variables[name]));
  }
  varChips.replaceChildren(...chips);
}

// One chip: `name` = input value ×. The value is an <input>, not text,
// so typing fires `input` and the odds bars move live.
function makeVarChip(name, value) {
  const chip = document.createElement("span");
  chip.className = "var-chip";

  const label = document.createElement("span");
  label.className = "var-chip-name";
  label.textContent = name;

  const val = document.createElement("input");
  val.className = "var-chip-val";
  val.value = String(value);
  val.setAttribute("aria-label", "value of variable " + name);
  // Unparseable text is stored as text on purpose: validateCircuit
  // then reports "that variable does not hold a number" instead of
  // the angle silently going wrong.
  val.addEventListener("input", () => {
    state.variables[name] = parseVarValue(val.value);
    render();
  });

  const del = document.createElement("button");
  del.className = "var-chip-del";
  del.textContent = "×";
  del.title = "Delete variable " + name;
  del.addEventListener("click", () => {
    beforeChange();
    delete state.variables[name];
    render(); // an R pointing at it now shows a validator problem
  });

  chip.append(label, val, del);
  return chip;
}

// "1.57" → 1.57; "abc" → "abc" (kept as text on purpose); "" → "".
function parseVarValue(text) {
  const t = text.trim();
  if (t === "") return "";
  const n = Number(t);
  return isFinite(n) ? n : t;
}

// Add / update a variable from the two input boxes.
function addOrUpdateVariable() {
  const name = varNameInput.value.trim();
  if (!name) { showMessage("Give the variable a name (like theta)"); return; }
  // Letters/digits only so a chip can never look like a sentence.
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    showMessage("Variable names: letters and digits, starting with a letter");
    return;
  }
  beforeChange();
  state.variables[name] = parseVarValue(varValueInput.value);
  varNameInput.value = "";
  varValueInput.value = "";
  render();
  showMessage("Variable " + name + " = " + state.variables[name]);
}

// The one angle picker (created on demand, positioned over the canvas).
let anglePickerEl = null;
let anglePickerEntry = null; // the R entry it is editing (a state.circuit object)

// Called by drawing.js when an R lands on the canvas. Picking a
// variable writes the NAME into the entry, never the number.
function openAnglePicker(entry) {
  closeAnglePicker();
  anglePickerEntry = entry;

  const names = Object.keys(state.variables);
  if (names.length === 0) {
    // Nothing to point at yet — leave the R angleless; the validator
    // keeps reporting it until a variable exists.
    showMessage("Add a variable below (like theta = 1.57), then pick it for this R");
  }

  const wrap = document.createElement("div");
  wrap.className = "angle-picker";

  const lab = document.createElement("span");
  lab.textContent = "angle:";
  lab.className = "angle-picker-label";

  const sel = document.createElement("select");
  sel.className = "angle-picker-select";
  sel.setAttribute("aria-label", "Choose the angle variable for this R gate");

  // Value "" = no angle (no variables yet, or clearing the choice).
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = names.length === 0 ? "(no variables yet)" : "(none)";
  sel.appendChild(noneOpt);
  for (const n of names) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n + " = " + state.variables[n];
    sel.appendChild(opt);
  }
  sel.value = entry.angle && names.indexOf(entry.angle) !== -1 ? entry.angle : "";

  sel.addEventListener("change", () => {
    if (anglePickerEntry) {
      anglePickerEntry.angle = sel.value || undefined;
      render(); // the validator sentence (if any) updates immediately
    }
    closeAnglePicker();
  });

  wrap.append(lab, sel);

  // Position just under the gate's box (canvas-wrap is position:relative).
  const x = columnCenterX(entry.col);
  const y = entry.y + GATE_BOX / 2 + 8;
  wrap.style.left = Math.max(8, x - 60) + "px";
  wrap.style.top = y + "px";

  document.querySelector(".canvas-wrap").appendChild(wrap);
  anglePickerEl = wrap;
  sel.focus();
}

function closeAnglePicker() {
  if (anglePickerEl) { anglePickerEl.remove(); anglePickerEl = null; }
  anglePickerEntry = null;
}

function setupVariablesUI() {
  varAddBtn.addEventListener("click", addOrUpdateVariable);
  varValueInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addOrUpdateVariable();
  });
  varNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") varValueInput.focus();
  });
  // Each dialog handles its own Escape (files.js owns the export modal's).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAnglePicker();
  });
}
