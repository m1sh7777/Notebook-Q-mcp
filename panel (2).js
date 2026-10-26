/* The results panel: rebuilt from state on every render, like the
   canvas. Pipeline: no wires → greeting; validation problems → show
   them and refuse; otherwise simulate and show probability bars. */

// Scripts sit at the end of <body>, so these elements exist.
const resultsBody = document.getElementById("resultsBody");
const simLimit = document.getElementById("simLimit");
// The one-line "invisible Z" note, a strip of its own between the
// panel head and the bars (so the flex row of bars is untouched).
const phaseHintEl = document.getElementById("phaseHint");

// Tallest a bar may grow, in CSS pixels.
const BAR_TRACK = 56;

// Written here from MAX_QUBITS itself, not typed into the HTML, so
// the note follows the limit in simulator.js automatically.
simLimit.textContent = "simulates up to " + MAX_QUBITS + " qubits";

/* Show or hide the "Z changes a hidden sign" note; hidden = empty. */
function setPhaseHint(text) {
  if (phaseHintEl) {
    phaseHintEl.textContent = text || "";
    phaseHintEl.style.display = text ? "block" : "none";
  }
}

/* Refresh the panel. Called from render(), so every state change
   (wire, gate, Clear) reaches it with no extra wiring. */
function renderResults() {
  // Empty canvas → a friendly hello, never an error. (This is why
  // validateCircuit treats zero wires as "not a problem".)
  if (state.wires.length === 0) {
    state.results = null; // nothing to remember
    setPhaseHint(null);   // no circuit → no physics footnotes
    setPanel([makeNote(
      "results-empty",
      "Draw a wire, then box a letter on it — the odds of every bit pattern appear here."
    )]);
    return;
  }

  // Problems → one red sentence each, no simulation.
  const problems = validateCircuit(state.wires, state.circuit, state.blocks, state.variables);
  if (problems.length > 0) {
    state.results = null;
    setPhaseHint(null);
    setPanel(problems.map((p) => makeNote("results-problem", p)));
    return;
  }

  // Rows → numbers → odds. Variables ride along: an R's name is
  // resolved here, so editing a variable re-runs this and the bars
  // move live.
  const sim = toSimInput(state.wires, state.circuit, state.blocks, state.variables);
  const probs = simulate(sim.ops, sim.n);

  // probs[k] is the odds of bit pattern k.
  state.results = { n: sim.n, probs: probs };

  // One bar per bit pattern, labeled with k in binary, q0 leftmost
  // (the same convention simulator.js uses).
  const bars = [];
  for (let k = 0; k < probs.length; k++) {
    bars.push(makeBar(k.toString(2).padStart(sim.n, "0"), probs[k] * 100));
  }
  setPanel(bars);

  // The pure rule (phaseHint in simulator.js) decides when the note
  // is honest; the panel only decides where it sits.
  setPhaseHint(phaseHint(state.circuit));
}

/* Small DOM builders. textContent (never innerHTML) so any text that
   ends up here is just text, never markup. */

/* Replace everything the panel shows. */
function setPanel(nodes) {
  resultsBody.replaceChildren(...nodes);
}

/* A text note — the friendly hello, or one validation problem. */
function makeNote(cls, text) {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = text;
  return p;
}

/* One bar: percentage on top, ink fill, bit pattern below. A
   near-zero result still gets a 2px stub so the pattern's slot stays
   visible — the panel shows all 2^n outcomes, not just winners. */
function makeBar(label, pct) {
  const wrap = document.createElement("div");
  wrap.className = "bar";

  const num = document.createElement("span");
  num.className = "bar-pct";
  num.textContent = fmtPct(pct);

  const fill = document.createElement("div");
  fill.className = "bar-fill";
  const h = Math.round((pct / 100) * BAR_TRACK);
  fill.style.height = Math.max(h, 2) + "px"; // the 2px stub floor

  const lab = document.createElement("span");
  lab.className = "bar-label";
  lab.textContent = label;

  wrap.append(num, fill, lab);
  return wrap;
}

/* 0..100 → short text: 49.99999… → "50%", 33.333… → "33.3%". */
function fmtPct(pct) {
  const v = Math.round(pct * 10) / 10;
  return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + "%";
}
