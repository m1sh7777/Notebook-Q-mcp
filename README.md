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

## Connect an MCP client

Like the KSRTC README example — point the client at the command:

```json
{
  "mcpServers": {
    "notebookq": {
      "command": "notebookq",
      "args": ["mcp"]
    }
  }
}
```

From an uninstalled checkout, use `"command": "python3"`,
`"args": ["notebookq_mcp.py"]` instead.

Tools exposed:

- `simulate_circuit(n_qubits, gates)` → probabilities per bit pattern.
  Gates: `{"gate":"H","qubit":0}`, `{"gate":"R","qubit":1,"angle":1.57}`
  (angle is a NUMBER), `{"gate":"CNOT","control":0,"target":1}`.
- `validate_circuit(n_qubits, gates)` → plain-English problem list.

## The AI interpret door (M4)

`POST /interpret` accepts `{image: "<png data url>"}`. With
`ZAI_API_KEY` set it calls Z.ai (model from `ZAI_MODEL`, default
`glm-5.3-flash`; documented vision fallbacks: `glm-4.5v`, `glm-4.6v`)
and returns a sanitized proposal. Without a key it returns a canned
FAKE example, clearly labelled. The key lives ONLY in the environment.
The browser shows the proposal, validates it with the same rules as
hand-drawn circuits, and nothing enters the drawing without Accept.


## Credits

NotebookQ is inspired by the UIST 2022 paper
**"Notational Programming for Notebook Environments: A Case Study with
Quantum Circuits"** by Ian Arawjo, Anthony J. DeArmas, Michael Roberts,
Shrutarshi Basu, and Tapan Parikh.
https://doi.org/10.1145/3526113.3545619
