# mcp_server.py — NotebookQ's MCP server over stdio: JSON-RPC on
# stdin/stdout, no ports. Tools: simulate_circuit(n_qubits, gates) and
# validate_circuit(n_qubits, gates); gate dicts use qubit/control/target
# keys. The validator is the same rules the browser enforces.
# mcp<2 pin: the 2.x SDK line reorganized the FastMCP API; this file
# targets the stable 1.x API.

import json
import sys

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    FastMCP = None

from . import quantum

mcp = FastMCP("notebookq") if FastMCP is not None else None


def _run_simulation(n_qubits, gates):
    """Shared body of the simulate tool: validate first (plain-English
    problems beat crashes), then simulate. Returns JSON so any client
    can read it."""
    problems = quantum.validate_circuit(n_qubits, gates)
    if problems:
        return json.dumps({"ok": False, "problems": problems}, indent=1)
    ops = []
    for g in gates:
        if g.get("gate") == "CNOT":
            ops.append({"gate": "CNOT", "c": g["control"], "t": g["target"],
                        "col": g.get("col", 0)})
        else:
            op = {"gate": g["gate"], "q": g["qubit"], "col": g.get("col", 0)}
            if g["gate"] == "R":
                op["angle"] = g["angle"]  # a NUMBER, per the spec
            ops.append(op)
    probs = quantum.simulate(ops, n_qubits)
    return json.dumps({
        "ok": True,
        "n_qubits": n_qubits,
        "probabilities": quantum.probs_to_labels(probs, n_qubits),
    }, indent=1)


if mcp is not None:

    @mcp.tool()
    def simulate_circuit(n_qubits: int, gates: list) -> str:
        """Simulate a NotebookQ circuit and return the measurement
        probabilities per bit pattern. Gates: {"gate":"H","qubit":0},
        {"gate":"X"|"Z", ...}, {"gate":"R","qubit":1,"angle":1.57}
        (angle in radians, a number), {"gate":"CNOT","control":0,
        "target":1}. Gates run left to right by their optional "col".
        Up to 5 qubits."""
        return _run_simulation(n_qubits, gates)

    @mcp.tool()
    def validate_circuit(n_qubits: int, gates: list) -> str:
        """Check a NotebookQ circuit without running it. Returns a list
        of plain-English problems (empty list = all clear) — the same
        rules the app's odds panel enforces."""
        return json.dumps(
            {"ok": not quantum.validate_circuit(n_qubits, gates),
             "problems": quantum.validate_circuit(n_qubits, gates)},
            indent=1,
        )


def run():
    """Entry point for `notebookq mcp` and notebookq_mcp.py."""
    if mcp is None:
        # A machine-visible failure: the client sees this on stderr and
        # a non-zero exit, not a Python traceback.
        print(
            "notebookq mcp needs the MCP SDK: pip install 'notebookq[mcp]' "
            "(the requirements pin mcp>=1.2,<2 — see mcp_server.py's header "
            "for why the 2.x line is excluded).",
            file=sys.stderr,
        )
        sys.exit(1)
    mcp.run(transport="stdio")
