/* Canvas setup and painting primitives (grid, wires, gates, ink).
   This file knows how to draw; main.js decides what and when. */

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Tuning constants, all in CSS pixels.
const GRID_SIZE = 40;   // distance between grid lines; wires snap onto rows
const COLUMN_WIDTH = 2 * GRID_SIZE; // one TIME column = 2 grid cells wide;
                        // column k's center sits on a grid line
const COLUMN_ORIGIN = GRID_SIZE;    // first column's center = 40px
const GATE_BOX = 32;    // smaller than GRID_SIZE so it fits the row spacing
const PAPER = "#faf9f4"; // must match the canvas background in style.css:
                        // drawGate()/drawCnot() fill with it to MASK the
                        // wire running underneath
const WIRE_WIDTH = 3.5; // slightly thicker than pen ink (2.8px)
const WIRE_LABEL_LIFT = 14; // labels float above the wire so a gate box
                            // can't paint over them
const INK = "#26364a";  // dark blue ink
const GRID_COLOR = "rgba(96, 125, 189, 0.14)"; // faint graph-paper blue

/* Make the bitmap match the screen's sharpness. */
function setupCanvas() {
  // Bitmap size = CSS size * devicePixelRatio, so ink stays sharp on
  // high-dpi screens; ctx is scaled by dpr so drawing code can keep
  // thinking in CSS pixels. (Setting canvas.width wipes the bitmap —
  // main.js always calls render() right afterwards.)
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1; // 1 on ordinary screens

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* Faint graph-paper lines, GRID_SIZE apart. */
function drawGrid() {
  ctx.save();              // remember the current brush settings...
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;

  ctx.beginPath();
  // +0.5 lands the line between pixels, keeping 1px lines crisp.
  for (let x = GRID_SIZE; x < canvas.clientWidth; x += GRID_SIZE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, canvas.clientHeight);
  }
  for (let y = GRID_SIZE; y < canvas.clientHeight; y += GRID_SIZE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(canvas.clientWidth, y + 0.5);
  }
  ctx.stroke();

  ctx.restore();           // ...and put the brush back afterwards
}

/* One recognized wire: a single clean horizontal line. */
function drawWire(wire) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = WIRE_WIDTH;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(wire.x1, wire.y);  // perfectly horizontal: both ends sit
  ctx.lineTo(wire.x2, wire.y);  // on the same snapped grid row
  ctx.stroke();
}

/* "q0", "q1", ... left of the wire's start, lifted above the line so
   a gate box on the wire can never hide it. */
function drawWireLabel(wire, label) {
  ctx.fillStyle = INK;
  ctx.font = "600 20px Caveat, cursive";  // the handwriting font
  ctx.textAlign = "right";      // the text grows leftwards from its anchor
  ctx.textBaseline = "middle";  // vertically centered on the anchor
  ctx.fillText(label, wire.x1 - 8, wire.y - WIRE_LABEL_LIFT);
}

/* The center of time column k (a grid line, by design). */
function columnCenterX(col) {
  return COLUMN_ORIGIN + col * COLUMN_WIDTH;
}

/* Draw one recognized gate: { gate: "H", y: 200, col: 3 }. The entry
   stores the wire's row, so no qubit number is needed. */
function drawGate(entry) {
  const cx = columnCenterX(entry.col);
  const half = GATE_BOX / 2;

  // Paper fill masks the wire running through the box.
  ctx.fillStyle = PAPER;
  ctx.fillRect(cx - half, entry.y - half, GATE_BOX, GATE_BOX);

  ctx.strokeStyle = INK;
  ctx.lineWidth = WIRE_WIDTH;
  ctx.strokeRect(cx - half, entry.y - half, GATE_BOX, GATE_BOX);

  ctx.fillStyle = INK;
  ctx.font = "700 18px Caveat, cursive";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(entry.gate, cx, entry.y + 1); // +1: optical centering
}

// The clean CNOT notation: connector line, filled control dot,
// circle-with-plus target.
const CNOT_DOT_R = 5;    // the filled control dot's radius
const CNOT_TARGET_R = 10; // the target circle's radius (hand ones are
                         // 8–24px across; this sits in the middle)

function drawCnot(entry) {
  const cx = columnCenterX(entry.col);       // same column math as boxes
  const top = Math.min(entry.cy, entry.ty);  // the connector runs from the
  const bottom = Math.max(entry.cy, entry.ty); // upper wire DOWN to the lower,
                                             // whichever is control/target

  ctx.strokeStyle = INK;
  ctx.lineWidth = WIRE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, bottom);
  ctx.stroke();

  // The control: a filled dot sitting ON its wire.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, entry.cy, CNOT_DOT_R, 0, Math.PI * 2);
  ctx.fill();

  // The target: paper fill first (masks the wire and connector under
  // the circle), then the ring.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, entry.ty, CNOT_TARGET_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = WIRE_WIDTH;
  ctx.beginPath();
  ctx.arc(cx, entry.ty, CNOT_TARGET_R, 0, Math.PI * 2);
  ctx.stroke();

  // The plus inside the ring, arms stopping just inside it.
  const arm = CNOT_TARGET_R - 4;
  ctx.beginPath();
  ctx.moveTo(cx - arm, entry.ty);
  ctx.lineTo(cx + arm, entry.ty);
  ctx.moveTo(cx, entry.ty - arm);
  ctx.lineTo(cx, entry.ty + arm);
  ctx.stroke();
}

/* A placed BLOCK: a rounded frame over {gate:"BLOCK", name, y, col,
   y2, col2} (top/bottom wire rows, leftmost/rightmost columns). The
   frame is a light tint with no paper fill so wires stay visible
   through it; only the name chip gets a paper fill. */
function drawBlock(entry) {
  const x1 = columnCenterX(entry.col) - COLUMN_WIDTH / 2 + 6;
  const x2 = columnCenterX(entry.col2) + COLUMN_WIDTH / 2 - 6;
  const y1 = entry.y;
  const y2 = entry.y2 || entry.y;
  const w = x2 - x1, h = y2 - y1;

  // The tinted frame: rounded rectangle, light ink, no mask.
  ctx.save();
  ctx.beginPath();
  const r = 10;
  ctx.moveTo(x1 + r, y1);
  ctx.arcTo(x2, y1, x2, y2, r);
  ctx.arcTo(x2, y2, x1, y2, r);
  ctx.arcTo(x1, y2, x1, y1, r);
  ctx.arcTo(x1, y1, x2, y1, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(38, 54, 74, 0.06)"; // a breath of ink
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // The name chip: paper-filled so the letter reads cleanly even on
  // a wire crossing the frame's middle.
  const chipW = 44, chipH = 30;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  ctx.fillStyle = PAPER;
  ctx.fillRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - chipW / 2, cy - chipH / 2, chipW, chipH);
  ctx.fillStyle = INK;
  ctx.font = "700 22px Caveat, cursive";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(entry.name || "?", cx, cy + 1);
  ctx.restore();
}

/* The selection rectangle (Select mode): pure painting of
   state.selection = {x1,y1,x2,y2} (normalized by blocks.js). */
function drawSelection(rect) {
  ctx.save();
  ctx.setLineDash([7, 5]); // dashed = provisional, not yet circuit
  ctx.strokeStyle = "rgba(38, 54, 74, 0.75)";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(
    Math.min(rect.x1, rect.x2), Math.min(rect.y1, rect.y2),
    Math.abs(rect.x2 - rect.x1), Math.abs(rect.y2 - rect.y1)
  );
  // A faint fill so "inside" reads as a region, not just a frame.
  ctx.fillStyle = "rgba(74, 123, 208, 0.07)";
  ctx.fillRect(
    Math.min(rect.x1, rect.x2), Math.min(rect.y1, rect.y2),
    Math.abs(rect.x2 - rect.x1), Math.abs(rect.y2 - rect.y1)
  );
  ctx.restore();
}

/* One stroke as smooth, pressure-aware ink. Segments end at midpoints
   and bend toward their anchor point, which rounds corners off;
   pressure maps to width (mouse/touch always 0.5 → one width). */
function drawStroke(stroke) {
  const pts = stroke.points;

  // A one-point stroke is a tap → a single dot (kept: a
  // lone dot means a CNOT control point).
  if (pts.length === 1) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, inkWidth(pts[0].p) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.strokeStyle = INK;
  ctx.lineCap = "round";   // round ends make separate segments melt...
  ctx.lineJoin = "round";  // ...into one continuous ink line

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]; // the "anchor" point the curve bends toward
    const curr = pts[i];

    // Segment start: the midpoint behind the anchor (or the true
    // first point, for the very first segment).
    const startX = i === 1 ? prev.x : (prev.x + pts[i - 2].x) / 2;
    const startY = i === 1 ? prev.y : (prev.y + pts[i - 2].y) / 2;

    // Segment end: the midpoint ahead of the anchor (or the true
    // last point, for the very last segment).
    const isLast = i === pts.length - 1;
    const endX = isLast ? curr.x : (prev.x + curr.x) / 2;
    const endY = isLast ? curr.y : (prev.y + curr.y) / 2;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(prev.x, prev.y, endX, endY); // bend toward anchor
    ctx.lineWidth = inkWidth((prev.p + curr.p) / 2);  // pressure → width
    ctx.stroke();
  }
}

/* Pressure (0..1) → ink width in CSS pixels.
   0.5 (mouse/touch) → 2.8px. */
function inkWidth(pressure) {
  return 1.6 + pressure * 2.4;
}
