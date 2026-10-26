/* Pointer input -> strokes in `state`. This file never paints; it
   changes state and calls render(). At stroke end it hands strokes to
   the pure recognizers (recognize.js) and commits their verdicts.

   Two judgment moments: a LONG flat stroke is an unambiguous wire and
   is promoted the instant the pen lifts. A SHORT flat stroke is
   ambiguous (wire stub vs. an H's crossbar), so it waits for the
   group commit, where the gate recognizer sees the whole group first
   and only leftovers become wire stubs. Gates are several strokes
   drawn in sequence, so after each stroke end a GROUP_MS countdown is
   armed; the group is judged only after the pen rests that long. */

// Pointer currently drawing (e.pointerId), or null.
let activePointerId = null;

// Pending group-commit timer; every stroke end re-arms it.
let pendingCommit = null;

// Watermark: groups whose last stroke ended at or before this time
// were already judged in an earlier commit and are skipped.
let judgedBefore = 0;

/* Attach all input listeners. Called once from main.js. */
function setupDrawing() {
  canvas.addEventListener("pointerdown", onStart);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onEnd);

  // pointercancel must reset activePointerId or drawing stops forever
  // (e.g. the OS cancels the gesture for a palm or an incoming call).
  canvas.addEventListener("pointercancel", onEnd);

  // Safety net if the browser quietly takes our capture away; also
  // fires after a normal pointerup, where it is a harmless no-op.
  canvas.addEventListener("lostpointercapture", onEnd);

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* A pointer touched the canvas: begin a new stroke. */
function onStart(e) {
  // Palm rejection, the simple way: only one pointer draws at a time.
  if (activePointerId !== null) return;

  // In Select mode the pen drags a rectangle (blocks.js), not a stroke.
  if (isSelectMode()) return;

  // Only the primary button / pen tip (1 = middle, 2 = right/barrel).
  if (e.button !== 0) return;

  activePointerId = e.pointerId;

  state.strokes.push({ points: [eventToCanvasPoint(e)] });
  render(); // state changed → repaint

  // Capture keeps the pointer's events coming even if the drag leaves
  // the canvas. setPointerCapture is an optimization — synthetic
  // events may refuse it, and the stroke just ends at the edge.
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    /* no capture → the stroke simply ends at the canvas edge */
  }
}

/* The active pointer moved. */
function onMove(e) {
  if (e.pointerId !== activePointerId) return; // not our pointer → ignore

  const stroke = state.strokes[state.strokes.length - 1]; // newest stroke
  if (!stroke) return; // safety: Clear can empty `strokes` mid-draw

  const point = eventToCanvasPoint(e);

  // Ignore micro-jitters (< 1.5px): keeps point arrays small, lines smoother.
  const last = stroke.points[stroke.points.length - 1];
  const distance = Math.hypot(point.x - last.x, point.y - last.y);
  if (distance < 1.5) return;

  stroke.points.push(point); // the stroke grows — state changed...
  render();                  // ...so repaint
}

/* The pointer went away (lifted, or the browser cancelled it). */
function onEnd(e) {
  if (e.pointerId !== activePointerId) return;
  // The finished stroke is already safely stored in state.strokes.
  activePointerId = null;      // we are ready for the next pointer

  // Stamp the pen-up moment — grouping measures pen-up gaps from these.
  const stroke = state.strokes[state.strokes.length - 1];
  if (stroke) stroke.endedAt = performance.now();

  // Every finished stroke is an undo step; a later commit dedupes
  // this snapshot if the stroke becomes a wire/gate/CNOT (undo.js).

  // Instant path: only unambiguous (long flat) wires; short flat
  // strokes wait for the group commit. In teach mode nothing is
  // interpreted at all (teach.js).
  beforeChange();
  if (!isTeaching()) promoteStrokeToWire();

  scheduleGroupCommit();
}

/* Called once, right after a stroke finishes — the INSTANT path.
   Only LONG unambiguous wires are promoted here; short flat strokes
   are deferred to the group commit. */
function promoteStrokeToWire() {
  const stroke = state.strokes[state.strokes.length - 1];
  if (!stroke) return; // safety: Clear can empty strokes mid-draw

  // A long flat stroke cannot be a letter inside a gate box (boxes
  // are at most ~64px wide, wires span 120px+), so this is safe
  // to take instantly.
  const wire = detectWire(stroke);

  if (!wire) return; // not a whole wire → judgment deferred

  // Simulator limit guard: refuse BEFORE consuming the ink, so the
  // rejected shape stays as ink with an explanation.
  if (wireWouldExceedLimit(wire)) {
    showMessage("NotebookQ simulates up to " + MAX_QUBITS +
                " qubits — this wire stays as ink");
    return;
  }

  beforeChange(); // undo hook
  state.strokes.pop(); // remove the wobbly original...
  addWire(wire);       // ...file the clean, snapped version
  render();            // state changed → repaint
}

/* Arm (or re-arm) the one countdown. Called after EVERY stroke
   end — including pointercancel — so the group only commits after
   a real pause, no matter how it ended. */
function scheduleGroupCommit() {
  if (pendingCommit !== null) clearTimeout(pendingCommit);
  pendingCommit = setTimeout(commitClosedGroup, GROUP_MS);
}

/* The grouping window passed with no new stroke: judge every group
   that closed in the recent burst, not only the trailing one (a
   fluent user can draw gate A then gate B inside one window). */
function commitClosedGroup() {
  pendingCommit = null;

  // A new stroke began before the window closed: it will end and
  // re-arm the countdown itself. Don't fire half a thought.
  if (activePointerId !== null) return;
  if (state.strokes.length === 0) return; // e.g. Clear wiped the pad

  // Groups are index lists into state.strokes. Gates chain on time
  // AND space; teach examples chain on time only (bare letters' thin
  // strokes sit a letter-width apart — see recognize.js).
  const groups = isTeaching()
    ? groupStrokesByTime(state.strokes)
    : groupStrokes(state.strokes);

  // Walk groups LAST-FIRST: committing splices strokes out of
  // state.strokes, so removing high indices first keeps lower
  // groups' indices valid.
  //
  // Compare against the watermark as it was BEFORE this commit
  // (prevWatermark): groups are chronological, so updating
  // judgedBefore mid-loop would mark this burst's earlier groups
  // as already judged.
  const prevWatermark = judgedBefore;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const group = groups[gi];
    if (!group || group.length === 0) continue;

    // Already judged in an earlier commit? (Watermark.)
    const lastStroke = state.strokes[group[group.length - 1]];
    if (!lastStroke || lastStroke.endedAt <= prevWatermark) continue;
    judgedBefore = Math.max(judgedBefore, lastStroke.endedAt);

    if (isTeaching()) {
      takeTeachExample(group); // teach.js: store + clear the example
      continue;
    }

    // Select mode owns the pen — nothing below should judge ink.
    if (isSelectMode()) continue;

    // 1. CNOT gets first claim: its long vertical connector is the
    //    one stroke a box or letter can never be. Returns true when
    //    the group was consumed (committed, or loudly rejected with
    //    a message), false when it simply isn't a CNOT.
    if (tryCommitCnot(group)) continue;

    // 2. Boxed gates next.
    if (tryCommitGate(group)) continue;

    // 3. A LONE stroke may still be a wire stub. Multi-stroke groups
    //    are never stub-merged: a boxed H whose letter failed to
    //    classify would otherwise lose its crossbar (a short flat
    //    stroke on the wire's row — exactly the stub shape). A lone
    //    dot also lands here and stays a dot: the stub rule fails
    //    for zero-span strokes.
    if (group.length === 1) promoteStub(group[0]);
  }
}

/* A lone dash that didn't become a gate: the FULL recognizer
   verdict (recognizeStroke), whose stub branch can still claim
   it as a piece of an existing wire. */
function promoteStub(index) {
  const stroke = state.strokes[index];
  if (!stroke) return; // safety

  const piece = recognizeStroke(stroke, state.wires);
  if (!piece) return; // just ink — leave it

  // Same qubit limit as the whole-wire path: only a stub that would
  // OPEN a new row can be refused; merging is always fine.
  if (wireWouldExceedLimit(piece)) {
    showMessage("NotebookQ simulates up to " + MAX_QUBITS +
                " qubits — this wire stays as ink");
    return;
  }

  beforeChange(); // undo hook
  state.strokes.splice(index, 1); // the dash goes...
  addWire(piece);                  // ...into its wire
  render();
}

/* Gate pipeline, wired to state: the pure functions decide, this
   executes. Returns true if the group was consumed. */
function tryCommitGate(indices) {
  const strokes = indices.map((i) => state.strokes[i]);

  const gate = recognizeGate(strokes, state.wires, state.templates);
  if (!gate) return false; // not a gate / unknown letter → ink

  // Letters A–F are BLOCK NAMES, not gates: with a definition, this
  // is a placement request; without one, the ink stays with a
  // message. Either way the group is consumed.
  if (isBlockLetter(gate.gate)) {
    return tryPlaceBlock(gate);
  }

  // One gate per wire per column; the drawn shape stays as ink.
  if (gateSlotTaken(state.circuit, gate.y, gate.col)) {
    showMessage("Column " + gate.col + " on this wire already has a gate");
    return true; // consumed as a REJECTED gate — not a stub
  }

  beforeChange(); // undo hook: the pre-gate state becomes a step

  removeStrokesAt(indices);        // the hand-drawn box + letter go...
  state.circuit.push(gate);        // ...the clean entry arrives
  render();                       // state changed → repaint

  // An R is born needing an angle; the entry is passed by reference,
  // so picking a variable writes into the circuit entry itself.
  if (gate.gate === "R") openAnglePicker(gate);

  return true;
}

/* Delete strokes by index. Splice highest-first so removed indices
   don't shift pending ones. */
function removeStrokesAt(indices) {
  const sorted = [...indices].sort((a, b) => b - a); // descending
  for (const i of sorted) state.strokes.splice(i, 1);
}

/* Same job, by stroke identity: after any splice old indices go
   stale, but object identity never does. */
function removeStrokesByObject(strokes) {
  state.strokes = state.strokes.filter((s) => strokes.indexOf(s) === -1);
}

/* CNOT pipeline, the mirror of tryCommitGate. Returns true when the
   group was consumed as a CNOT attempt: committed, or loudly
   rejected (message shown, ink kept). False when it simply isn't a
   CNOT attempt and the gate recognizer gets its turn. */
function tryCommitCnot(indices) {
  const strokes = indices.map((i) => state.strokes[i]);

  // Pure verdict: {cy, ty, col, used} — or null.
  const cnot = recognizeCnot(strokes, state.wires, state.circuit);

  // null → the engine distinguishes a loud rejection (user tried a
  // CNOT and something is wrong) from a silent miss (it's a letter
  // or wire). A loud rejection consumes the whole group.
  if (!cnot) {
    const why = cnotRejection(strokes, state.wires, state.circuit);
    if (why) {
      showMessage(why);
      return true; // consumed as a REJECTED CNOT — never a stub/letter
    }
    return false; // silent: not a CNOT attempt at all
  }

  // Compute leftovers BEFORE splicing: the CNOT may share its group
  // with another gate drawn in the same burst. Leftovers are
  // remembered as objects, so the splice cannot stale them.
  const leftoverStrokes = strokes.filter(
    (s) => cnot.used.indexOf(s) === -1
  );

  // Remove exactly the consumed strokes, by identity → index.
  const usedIdx = indices.filter(
    (i) => cnot.used.indexOf(state.strokes[i]) !== -1
  );
  beforeChange(); // undo hook
  removeStrokesAt(usedIdx);

  state.circuit.push({ gate: "CNOT", cy: cnot.cy, ty: cnot.ty, col: cnot.col });
  render(); // state changed → repaint

  // Whatever the CNOT did not consume still gets its own verdict.
  judgeGateLeftover(leftoverStrokes);
  return true;
}

/* A committed CNOT's leftovers (usually a boxed gate drawn in the
   same burst): gate first, then the lone-stroke stub rule. */
function judgeGateLeftover(strokes) {
  if (strokes.length === 0) return;

  const gate = recognizeGate(strokes, state.wires, state.templates);
  if (gate) {
    // A leftover boxed A–F is a block placement request too.
    if (isBlockLetter(gate.gate)) return tryPlaceBlock(gate, null, strokes);
    // Same slot policy as tryCommitGate — the CNOT that just landed
    // counts, because it is already in state.circuit.
    if (gateSlotTaken(state.circuit, gate.y, gate.col)) {
      showMessage("Column " + gate.col + " on this wire already has a gate");
      return; // stays ink
    }
    removeStrokesByObject(strokes); // the hand-drawn box + letter go...
    state.circuit.push(gate);       // ...the clean entry arrives
    render();
    // A leftover R also gets its angle picker (one behavior for
    // every R placement path).
    if (gate.gate === "R") openAnglePicker(gate);
    return;
  }

  // Lone leftover → the stub rule, with the qubit limit guard.
  if (strokes.length === 1) {
    const piece = recognizeStroke(strokes[0], state.wires);
    if (!piece || wireWouldExceedLimit(piece)) return; // ink stays ink
    beforeChange(); // undo hook
    removeStrokesByObject(strokes);
    addWire(piece);
    render();
  }
}

/* Would filing this wire push the circuit past MAX_QUBITS? Merging
   into an occupied row is never a NEW qubit, so only a wire on a
   fresh row can hit the ceiling. Pure read. */
function wireWouldExceedLimit(wire) {
  for (const w of state.wires) {
    if (w.y === wire.y) return false; // same row → a merge, not a new qubit
  }
  return state.wires.length >= MAX_QUBITS; // a fresh row, and no room left
}

/* File a wire into state.wires, MERGING it if its row is occupied.
   Gaps must merge: pen lifts over gate boxes split one wire into
   several strokes, and both pieces are the same qubit. */
function addWire(newWire) {
  for (const wire of state.wires) {
    if (wire.y !== newWire.y) continue; // different rows live apart

    // Same row → stretch the existing wire to cover both pieces.
    wire.x1 = Math.min(wire.x1, newWire.x1);
    wire.x2 = Math.max(wire.x2, newWire.x2);
    return; // merged into the existing wire; no new entry
  }
  state.wires.push(newWire); // first wire on this row
}

/* Turn a pointer event into a storable {x, y, p, t} point. */
function eventToCanvasPoint(e) {
  // Events are in page coordinates; subtract the canvas's top-left
  // to translate to canvas coordinates.
  const rect = canvas.getBoundingClientRect();

  // Pens report a real 0..1 pressure; mice and most touch screens
  // report a constant, so pin those at 0.5.
  const pressure = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;

  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    p: pressure,
    t: performance.now(), // the moment this point arrived (grouping)
  };
}
