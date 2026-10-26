# quantum.py — pure-Python simulator, a line-for-line mirror of
# js/simulator.js so the parity test can compare the two outputs.
# Conventions: n qubits = 2^n real amplitudes, index k read as binary;
# q0 is the top wire and the LEFTMOST bit (stride 2^(n-1)); all gates
# here keep amplitudes real, so no complex numbers. Every apply_* returns
# a new list. Op dicts match the JS simulator's input exactly, so one
# JSON description feeds both engines.

import math

MAX_QUBITS = 5  # same ceiling as the app (drawing.js refuses a 6th wire)

# The 2x2 real tables — same numbers as js/simulator.js's GATES.
SQRT1_2 = 1.0 / math.sqrt(2.0)
GATES = {
    "H": [[SQRT1_2, SQRT1_2], [SQRT1_2, -SQRT1_2]],
    "X": [[0.0, 1.0], [1.0, 0.0]],
    "Z": [[1.0, 0.0], [0.0, -1.0]],
}


def apply_gate(amps, matrix, qubit, n):
    """One 2x2 mix on every pair of amplitudes that differ only in
    `qubit`'s bit. stride = the qubit's place value (q0 → 2^(n-1))."""
    stride = 1 << (n - 1 - qubit)
    out = list(amps)  # a copy, like JS's state.slice()
    for i in range(len(amps)):
        if i & stride:
            continue                      # visit only the "0" side...
        j = i + stride                    # ...its partner is stride away
        a, b = amps[i], amps[j]
        out[i] = matrix[0][0] * a + matrix[0][1] * b
        out[j] = matrix[1][0] * a + matrix[1][1] * b
    return out


def apply_cnot(amps, control, target, n):
    """Where the control bit is 1, swap each amplitude with its
    target-bit-flipped partner."""
    cstride = 1 << (n - 1 - control)
    tstride = 1 << (n - 1 - target)
    out = list(amps)
    for i in range(len(amps)):
        if not (i & cstride):
            continue                      # control 0 → do nothing
        if i & tstride:
            continue                      # pair-picking: target-bit-0 side
        j = i | tstride                   # partner: target bit flipped
        out[i], out[j] = amps[j], amps[i]  # SWAP, not mix
    return out


def simulate(ops, n):
    """Run the op list column by column from |00...0⟩, return the
    2^n probabilities (amplitudes squared)."""
    size = 1 << n
    amps = [0.0] * size
    amps[0] = 1.0
    for op in ops:
        name = op["gate"]
        if name == "CNOT":
            amps = apply_cnot(amps, op["c"], op["t"], n)
        elif name == "R":
            a = op["angle"]
            ry = [[math.cos(a / 2), -math.sin(a / 2)],
                  [math.sin(a / 2), math.cos(a / 2)]]
            amps = apply_gate(amps, ry, op["q"], n)
        else:
            amps = apply_gate(amps, GATES[name], op["q"], n)
    return [a * a for a in amps]


def probs_to_labels(probs, n):
    """{'00': 0.5, '11': 0.5} — labels use the app's convention
    (q0 leftmost), matching the panel's bar names."""
    return {
        format(k, "0%db" % n): round(p, 12)
        for k, p in enumerate(probs)
        if p > 1e-12
    }


# validate_circuit: MCP-side validator. Gates arrive as dicts with QUBIT
# numbers (MCP-speak, not drawing-speak): {"gate": "H", "qubit": 0},
# {"gate": "R", "qubit": 1, "angle": 1.57}, {"gate": "CNOT", "control": 0,
# "target": 1}. Mirrors the browser validator's rules, including the
# same-wire CNOT case (one problem, not two). Returns a list of
# plain-English sentences (empty = all clear).
def validate_circuit(n_qubits, gates):
    problems = []
    if not isinstance(n_qubits, int) or isinstance(n_qubits, bool) or n_qubits < 1:
        return ["n_qubits must be a whole number, 1 or more."]
    if n_qubits > MAX_QUBITS:
        problems.append(
            "This circuit has %d qubits — NotebookQ simulates at most %d."
            % (n_qubits, MAX_QUBITS)
        )

    spans = []  # (row_lo, row_hi, col) for the collision check
    for idx, g in enumerate(gates):
        if not isinstance(g, dict) or "gate" not in g:
            problems.append("Gate #%d is not a {gate, ...} object." % (idx + 1))
            continue
        name = g.get("gate")
        col = g.get("col", 0)
        if name == "CNOT":
            c, t = g.get("control"), g.get("target")
            if not (_is_wire(c, n_qubits) and _is_wire(t, n_qubits)):
                problems.append(
                    "The CNOT in column %s has an end off the circuit — "
                    "control and target must be wires 0..%d." % (col, n_qubits - 1)
                )
                continue
            if c == t:
                # Same-wire CNOT: one complaint, then move on — the
                # ends-on-wires check is skipped here (it would repeat
                # the same single mistake).
                problems.append(
                    "The CNOT in column %s starts and ends on the same wire — "
                    "control and target must be two different wires." % col
                )
                continue
            spans.append((min(c, t), max(c, t), col))
        elif name in GATES or name == "R":
            q = g.get("qubit")
            if not _is_wire(q, n_qubits):
                problems.append(
                    "The %s in column %s has no wire under it — qubit must be 0..%d."
                    % (name, col, n_qubits - 1)
                )
                continue
            spans.append((q, q, col))
            if name == "R":
                a = g.get("angle")
                if isinstance(a, bool) or not isinstance(a, (int, float)):
                    problems.append(
                        "The R in column %s needs a numeric angle (radians), "
                        "like 1.57." % col
                    )
        else:
            problems.append(
                'The gate "%s" in column %s is not one the simulator '
                "knows (H, X, Z, R, CNOT)." % (name, col)
            )

    # Slot collisions: two gates clash when they share a column AND
    # their row spans overlap (a CNOT spans control..target inclusive).
    for i in range(len(spans)):
        for j in range(i + 1, len(spans)):
            (lo1, hi1, c1), (lo2, hi2, c2) = spans[i], spans[j]
            if c1 == c2 and lo1 <= hi2 and lo2 <= hi1:
                problems.append(
                    "Column %s is already used between those wires." % c1
                )
    return problems


def _is_wire(q, n):
    return isinstance(q, int) and not isinstance(q, bool) and 0 <= q < n
