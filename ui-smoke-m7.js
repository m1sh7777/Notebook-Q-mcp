/* ui-smoke-m7.js — drives the REAL index.html in jsdom: open Code,
   edit, Apply, check state, undo. Needs jsdom (npm i jsdom, run from
   a folder that can resolve it). Canvas is stubbed (jsdom has no 2D). */
const { JSDOM } = require(process.env.JSDOM_PATH || "jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
const noop = () => {};
const ctxStub = new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : (k in t ? t[k] : noop)), set: (t, k, v) => { t[k] = v; return true; } });
w.HTMLCanvasElement.prototype.getContext = () => ctxStub;
w.HTMLCanvasElement.prototype.setPointerCapture = noop;
Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { get() { return 900; } });
Object.defineProperty(w.HTMLElement.prototype, "clientHeight", { get() { return 500; } });

Object.defineProperty(w.document, "fonts", { value: { ready: Promise.resolve() } });
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener: noop, addListener: noop }));

// Concatenate scripts in index.html order into ONE classic-script scope, like the browser.
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const code = srcs.map((s) => fs.readFileSync(path.join(root, s), "utf8")).join("\n;\n") +
  "\n;window.__t={state,render};";
w.eval(code);
if (!w.__t) { console.log("FAIL scripts did not load"); process.exit(1); }
const { state } = w.__t;
const $ = (id) => w.document.getElementById(id);
let bad = 0;
const ck = (n, ok, d) => { console.log((ok ? "ok   " : "FAIL ") + n + (ok ? "" : " — " + (d || ""))); if (!ok) bad++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Empty drawing -> Code opens with the starter example.
  $("codeBtn").click();
  ck("1a. modal opens", $("codeModal").classList.contains("open"));
  ck("1b. starter shown for empty drawing", /qreg q\[2\]/.test($("codeText").value));
  ck("1c. Apply enabled, status says reads fine", !$("codeApplyBtn").disabled && /Reads fine/.test($("codeStatus").textContent));

  // 2. Apply -> drawing exists.
  $("codeApplyBtn").click();
  ck("2a. modal closes", !$("codeModal").classList.contains("open"));
  ck("2b. 2 wires + H + CNOT in state", state.wires.length === 2 && state.circuit.length === 2,
     JSON.stringify(state.circuit));
  ck("2c. odds panel shows the Bell state (00 and 11 at 50%)", /00/.test($("resultsBody").textContent) && /11/.test($("resultsBody").textContent) && /50/.test($("resultsBody").textContent), $("resultsBody").textContent);

  // 3. Reopen: text comes FROM the drawing.
  $("codeBtn").click();
  ck("3. text regenerated from drawing", $("codeText").value === 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];');

  // 4. Bad edit -> error with line, Apply disabled, drawing untouched.
  $("codeText").value = "OPENQASM 2.0;\nqreg q[2];\ns q[0];";
  $("codeText").dispatchEvent(new w.Event("input"));
  ck("4a. Apply disabled immediately while typing", $("codeApplyBtn").disabled);
  await sleep(450);
  ck("4b. error names line 3", /Line 3/.test($("codeStatus").textContent), $("codeStatus").textContent);
  ck("4c. Apply stays disabled", $("codeApplyBtn").disabled);
  $("codeApplyBtn").click(); // disabled button: no effect
  ck("4d. drawing untouched", state.circuit.length === 2);

  // 5. Good edit with an angle -> new variable appears.
  $("codeText").value = "OPENQASM 2.0;\nqreg q[1];\nry(pi/2) q[0]; // theta";
  $("codeText").dispatchEvent(new w.Event("input"));
  await sleep(450);
  ck("5a. verdict ok", !$("codeApplyBtn").disabled, $("codeStatus").textContent);
  $("codeApplyBtn").click();
  ck("5b. R box + variable theta", state.circuit.length === 1 && state.circuit[0].angle === "theta" &&
     Math.abs(state.variables.theta - Math.PI / 2) < 1e-12, JSON.stringify([state.circuit, state.variables]));

  // 6. Undo restores the Bell drawing in one step.
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  ck("6. Ctrl+Z brings the previous drawing back", state.circuit.length === 2 && state.wires.length === 2,
     JSON.stringify(state.circuit));

  // 7. Escape closes.
  $("codeBtn").click();
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ck("7. Escape closes the panel", !$("codeModal").classList.contains("open"));

  console.log(bad === 0 ? "\nUI smoke: all ok" : "\nUI smoke: " + bad + " FAILED");
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.log("CRASH", e); process.exit(1); });
