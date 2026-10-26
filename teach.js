/* Teach mode: the user's letter examples extend the built-in
   templates for classifyLetter. Each paused gesture in teach mode
   becomes one example, stored in state.templates AND in localStorage
   (survives refresh; nothing leaves the browser). Examples are raw
   {x, y} polylines — normalized late, on demand. */

// The localStorage key — one entry holding all taught examples.
const TEACH_KEY = "notebookq.templates";

// Session start time. Strokes drawn BEFORE it must never join an
// example: the time-chain grouper only sees gaps between strokes, so
// without this stamp, old sketch ink could chain into the first one.
let teachSince = 0;

/* Are we teaching right now? In teach mode no stroke is interpreted
   as circuit — each group becomes one letter example instead. */
function isTeaching() {
  return state.teach !== null;
}

/* Read all taught examples from localStorage:
   { H: [example, ...], X: [...] } — possibly missing keys.
   try/catch: corrupted or blocked storage must never brick the app. */
function loadTaughtStore() {
  try {
    return JSON.parse(localStorage.getItem(TEACH_KEY)) || {};
  } catch (err) {
    return {};
  }
}

/* The template pool the classifier sees at startup:
   built-in defaults + the user's saved personal examples. */
function initialTemplates() {
  const pool = {};
  for (const label of Object.keys(DEFAULT_TEMPLATES)) {
    // Deep-copy the built-ins so teaching never mutates the
    // recognizer's shipped data.
    pool[label] = DEFAULT_TEMPLATES[label].map((example) =>
      example.map((stroke) => stroke.map((p) => ({ x: p.x, y: p.y })))
    );
  }
  const store = loadTaughtStore();
  for (const label of Object.keys(store)) {
    if (pool[label]) pool[label].push(...store[label]);
  }
  return pool;
}

/* One grouped gesture was drawn in teach mode: save it as one
   example for the letter being taught. Called by drawing.js when
   the group commit fires. `indices` point into state.strokes. */
function takeTeachExample(indices) {
  const label = state.teach;

  // Only strokes drawn during teach mode are example material —
  // stale sketch ink stays on the pad.
  const fresh = indices.filter(
    (i) => state.strokes[i].points[0].t >= teachSince
  );
  if (fresh.length === 0) return;
  const strokes = fresh.map((i) => state.strokes[i]);

  // A single dot has no shape — reject it, keep everything as ink.
  const hasShape = strokes.some((s) => s.points.length > 1);
  if (!hasShape) {
    showMessage("Too small to teach — draw the letter bigger");
    return;
  }

  // Strip to bare {x, y} polylines: only the shape is remembered;
  // normalizeStrokes scales size and position away.
  const example = strokes.map((s) => s.points.map((p) => ({ x: p.x, y: p.y })));

  // 1. Persist: localStorage (survives refresh).
  const store = loadTaughtStore();
  if (!store[label]) store[label] = [];
  store[label].push(example);
  localStorage.setItem(TEACH_KEY, JSON.stringify(store));

  // 2. Activate: state.templates (used by the classifier NOW).
  state.templates[label].push(example);

  // 3. Clear the pad — the saved example shouldn't linger as ink.
  beforeChange(); // the pre-save pad is an undo step
  removeStrokesAt(fresh);
  render();

  showMessage(
    "Saved " + label + " example " +
    state.templates[label].length + " — draw a few more"
  );
}

/* Wire the toolbar's teach buttons. Called once from main.js. */
function setupTeachUI() {
  for (const btn of document.querySelectorAll(".btn-teach")) {
    btn.addEventListener("click", () => {
      const label = btn.dataset.label; // "H" | "X" | "Z" (from index.html)
      // Clicking the same button again turns teaching OFF.
      state.teach = state.teach === label ? null : label;
      // Stamp the session start — examples may only contain strokes
      // drawn from now on.
      if (state.teach !== null) teachSince = performance.now();
      refreshTeachButtons();
      showMessage(
        state.teach
          ? "Teaching " + label + " — draw it a few times, pause after each one"
          : "Teach mode off"
      );
    });
  }
}

/* Highlight whichever letter is being taught (CSS class "on"). */
function refreshTeachButtons() {
  for (const btn of document.querySelectorAll(".btn-teach")) {
    btn.classList.toggle("on", btn.dataset.label === state.teach);
  }
}
