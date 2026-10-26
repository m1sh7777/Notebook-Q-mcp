# NotebookQ

Sketch quantum circuits **by hand** on a notebook page — wires, boxed
gates (H, X, Z, R), hand-drawn CNOTs — and watch the measurement odds
update live.
Optional extras: a tiny Python server with an AI "interpret sketch" door
(Z.ai), and an MCP server so AI assistants can run your circuits.

## Installation

With the local server (adds the AI door + proper URLs):

```bash
python3 server.py            # serves the app at http://localhost:8000
```

## How to draw

- **Wire** — a long flat line. The top wire is q0.
- **Gate** — a box with a letter inside: H (split), X (flip),
  Z (sign flip), R (rotation; picks a variable's angle).
- **CNOT** — a near-vertical line between two wires with a round blob
  on the TARGET wire (a dot on the control wire is optional).
- **Teach** — click a letter in the toolbar, draw it a few times, click
  again. Your handwriting becomes the template.
- **Variables** — name + number in the strip (theta = 1.57). R gates
  point at the NAME; edit the number and the odds move live.
- **Blocks** — Select mode, rectangle over gates, "Save as block",
  pick a letter A–F. Box that letter later to place the whole group.
- **Code** — the same circuit as OpenQASM text. Edit the text and
  press *Apply to drawing* to redraw (one undo step); errors name
  their line and nothing changes until the text parses. Variable
  names ride along in a `// theta` comment so they survive the trip.
- **Undo** — Ctrl+Z / Ctrl+Y.
- Everything autosaves in your browser; Save/Load use JSON files.

## The Code view (OpenQASM)

Press **Code** to see the circuit as OpenQASM 2.0 text. You can edit that text
and press **Apply to drawing** to redraw the page from it.

OpenQASM is a plain-text format for describing quantum circuits, one gate per
line. The Bell circuit looks like this:

```
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
h q[0];
cx q[0],q[1];
```

`qreg q[2]` makes two qubits, `h q[0]` applies an H gate to qubit 0, and
`cx q[0],q[1]` is a CNOT with qubit 0 as control and qubit 1 as target.

Only what the drawing can express is supported: `h`, `x`, `z`, `ry(angle)` and
`cx`. Angles can be numbers or simple maths like `pi/2`. Anything else is
rejected with the line number, and nothing changes until the text parses.
Variable names are kept in a trailing comment (`ry(pi/2) q[1]; // theta`) so
they survive a round trip. Blocks are expanded into plain gates on export,
because OpenQASM has no equivalent.

## Limits

- Five gate types, at most 5 qubits
- Handwriting recognition is heuristic and has only been tested by the author.
  Expect misreads on unfamiliar handwriting, and use Teach to fix them
- Not a replacement for Qiskit, Quirk or IBM Composer

## Tests

```bash
node tests/test-m7-qasm.js                            # drawing <-> OpenQASM round trip
node tests/test-stage4.js && node tests/test-stage5.js   # earlier stages
node tests/test-m0.js && node tests/test-m1.js           # fixes + exports
node tests/test-m2.js && node tests/test-m3.js           # variables + blocks
python3 tests/test_m4_server.py                          # server (mocked model)
python3 tests/parity/parity_test.py                      # 200 circuits, JS vs Python
python3 scripts/mcp_smoke.py                             # full MCP handshake (needs venv, see below)
```

## Python package (M5)

```bash
python3 scripts/sync_web.py      # copy the web app into the package
python3 -m venv venv
venv/bin/pip install '.[mcp]'    # base install needs NOTHING; [mcp] adds the SDK
venv/bin/notebookq               # serve + open the browser
venv/bin/notebookq mcp           # MCP server over stdio
```

Why `mcp<2` in requirements: the MCP SDK's 2.x line reorganized the
FastMCP API this server uses; the pin keeps fresh installs working
(the same comment lives in `notebookq_mcp.py` and `requirements.txt`).
```

To connect an MCP client, point it at the command:

```json
{
  "mcpServers": {
    "notebookq": { "command": "notebookq", "args": ["mcp"] }
  }
}
```

Tools: `simulate_circuit(n_qubits, gates)` and `validate_circuit(n_qubits, gates)`.
The MCP SDK is pinned to `mcp<2` because 2.x changed the API this server uses.

## The AI interpret sketch and your api key

`POST /interpret` sends a drawing image to Z.ai when `ZAI_API_KEY` is set
(model from `ZAI_MODEL`). With no key it returns a clearly labelled fake
example. The key is read only from the environment. It is never written to a
file or sent to the browser. Never commit a key; `.gitignore` already skips
`.env` files.



## Credits

NotebookQ is inspired by the UIST 2022 paper
**"Notational Programming for Notebook Environments: A Case Study with
Quantum Circuits"** by Ian Arawjo, Anthony J. DeArmas, Michael Roberts,
Shrutarshi Basu, and Tapan Parikh.

https://doi.org/10.1145/3526113.3545619

NotebookQ is **not** an implementation of that system. It has no shared code scope, wire bundles or
recursion, which are that paper's main contributions. It takes the idea that
a circuit diagram can be a way of writing a program and applies it to a
standalone learning tool.

