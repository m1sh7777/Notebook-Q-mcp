/* ai.js — "Interpret sketch", browser side.
   Sends a PNG of the canvas to POST /interpret (no API key in the
   browser; the server holds it or runs in FAKE mode). The answer is
   a PROPOSAL: converted to circuit data, re-validated by the same
   circuit validator as hand-drawn input, shown as a preview — only
   Accept puts it into state. R gates in a proposal carry a number;
   on Accept it becomes a new variable (r1, r2, ...) and the R entry
   points at it by name. */

const aiOverlay = document.getElementById("aiOverlay");
const aiBadge = document.getElementById("aiBadge");
const aiSummary = document.getElementById("aiSummary");
const aiProblems = document.getElementById("aiProblems");
const aiAcceptBtn = document.getElementById("aiAcceptBtn");

// The proposal currently on the table (null = overlay closed).
let aiPending = null;

function setupAIUI() {
  document.getElementById("aiBtn").addEventListener("click", requestInterpret);
  document.getElementById("aiAcceptBtn").addEventListener("click", acceptProposal);
  document.getElementById("aiRejectBtn").addEventListener("click", closeAIOverlay);
  // Backdrop click = reject. The decision buttons stay inside the card.
  aiOverlay.addEventListener("click", (e) => {
    if (e.target === aiOverlay) closeAIOverlay();
  });
  // Each dialog handles its own Escape (files.js / variables.js too).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aiPending) closeAIOverlay();
  });
}

async function requestInterpret() {
  if (window.location.protocol === "file:") {
    showMessage("AI interpret needs the local server — run: python server.py");
    return;
  }
  showMessage("Sending the sketch to the AI service...");
  let reply;
  try {
    const res = await fetch("/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: canvas.toDataURL("image/png") }),
    });
    reply = await res.json();
  } catch (err) {
    // Server down, or not a NotebookQ server on this origin.
    showMessage("Could not reach /interpret — start the server: python server.py");
    return;
  }
  if (!reply || !reply.ok) {
    // The server's sentence is pre-cleaned (no key, no raw model text).
    showMessage(reply && reply.error ? reply.error : "The interpret service failed.");
    return;
  }
  showProposal(reply.proposal, reply.summary, reply.mode);
}

// Build the preview: convert to our data shape and validate —
// problems show in red and Accept is disabled.
function showProposal(proposal, summary, mode) {
  aiPending = { proposal: proposal, variables: {} };

  // Convert wire_index numbers to wire ROWS. The temp wires live at
  // rows 0..n-1 — a pure coordinate system for the validator; on
  // Accept, real rows are chosen.
  const tempWires = [];
  for (let i = 0; i < proposal.wires; i++) tempWires.push({ y: i, x1: 0, x2: 1 });

  // R gates carry numeric angles → they become named variables here.
  let rCounter = 0;
  const tempCircuit = [];
  for (const g of proposal.gates) {
    if (g.gate === "CNOT") {
      tempCircuit.push({ gate: "CNOT", cy: g.wire_index, ty: g.target_index, col: g.col });
    } else if (g.gate === "R") {
      const name = "r" + (++rCounter);
      aiPending.variables[name] = g.angle;
      tempCircuit.push({ gate: "R", y: g.wire_index, col: g.col, angle: name });
    } else {
      tempCircuit.push({ gate: g.gate, y: g.wire_index, col: g.col });
    }
  }
  aiPending.circuit = tempCircuit;

  const problems = validateCircuit(tempWires, tempCircuit, state.blocks, aiPending.variables);

  aiBadge.textContent = mode === "fake"
    ? "FAKE mode — no API key, canned example"
    : "AI proposal — live model";
  aiSummary.textContent = summary;
  aiProblems.textContent = problems.length > 0
    ? "The validator says: " + problems.join(" ")
    : "";
  aiAcceptBtn.disabled = problems.length > 0 || proposal.wires === 0;
  aiOverlay.classList.add("open");
}

function closeAIOverlay() {
  aiOverlay.classList.remove("open");
  aiPending = null;
}

function acceptProposal() {
  if (!aiPending) return;
  const p = aiPending.proposal;

  beforeChange(); // the pre-accept drawing is an undo step

  // Reuse the current wires when the counts match (the common case),
  // otherwise lay out fresh, evenly spaced wires.
  let rows;
  if (state.wires.length === p.wires) {
    rows = state.wires.map((w) => w.y).sort((a, b) => a - b);
  } else {
    rows = [];
    for (let i = 0; i < p.wires; i++) rows.push(GRID_SIZE * (i + 1));
    state.wires = rows.map((y) => ({
      y: y, x1: COLUMN_ORIGIN, x2: canvas.clientWidth - GRID_SIZE,
    }));
  }

  // Proposal variables (r1 = 1.57, ...) land first, so the R entries'
  // names resolve on the very first render.
  Object.assign(state.variables, aiPending.variables);

  state.circuit = aiPending.circuit.map((g) => {
    if (g.gate === "CNOT") {
      return { gate: "CNOT", cy: rows[g.cy], ty: rows[g.ty], col: g.col };
    }
    return { gate: g.gate, y: rows[g.y], col: g.col, angle: g.angle };
  });
  state.strokes = []; // the sketch has been interpreted

  closeAIOverlay();
  render();
  showMessage("Accepted: " + p.wires + " wires, " + p.gates.length + " gates");
}
