#!/usr/bin/env python3
# ============================================================
# parity_test.py — M5b: 200 random circuits, TWO engines, one law.
# Run:  python3 tests/parity/parity_test.py
# ------------------------------------------------------------
# Generates 200 random valid circuits (H, X, Z, R with random
# angles, CNOT; 1–4 qubits; one gate per time column so every
# circuit is valid by construction), then runs each through
#   • the REAL JavaScript simulator (js/simulator.js, via node)
#   • the Python mirror (src/notebookq/quantum.py)
# and asserts every probability agrees to 1e-9.
#
# The SAME JSON feeds both engines — the ops use the JS sim-input
# naming, which quantum.py deliberately shares. Honest output: the
# actual max difference is printed, not just "ok".
# ============================================================

import json
import math
import os
import random
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # notebookq/
sys.path.insert(0, os.path.join(ROOT, "src"))

import notebookq.quantum as q  # noqa: E402


def random_circuits(count):
    rng = random.Random(7)  # fixed seed: the test is reproducible
    circuits = []
    for _ in range(count):
        n = rng.randint(1, 4)
        ops = []
        for col in range(rng.randint(1, 8)):
            kind = rng.choice(["H", "X", "Z", "R", "R", "CNOT"])
            if kind == "CNOT" and n < 2:
                kind = "H"  # a CNOT needs two wires; n=1 draws singles
            if kind == "CNOT":
                a, b = rng.sample(range(n), 2)
                ops.append({"gate": "CNOT", "c": a, "t": b, "col": col})
            elif kind == "R":
                # Anchors + noise: the anchors pin the known cases
                # (0 = nothing, pi = flip, pi/2 = coin), the uniform
                # draws stress the floating point everywhere else.
                angle = rng.choice([
                    0.0, math.pi, math.pi / 2,
                    rng.uniform(0, 2 * math.pi),
                ])
                ops.append({"gate": "R", "q": rng.randrange(n),
                            "col": col, "angle": angle})
            else:
                ops.append({"gate": kind, "q": rng.randrange(n), "col": col})
        circuits.append({"n": n, "ops": ops})
    return circuits


def main():
    count = 200
    circuits = random_circuits(count)

    # 1. The JS engine, under node, on the same JSON.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"circuits": circuits}, f)
        path = f.name
    try:
        runner = os.path.join(ROOT, "scripts", "parity_runner.js")
        res = subprocess.run(
            ["node", runner, path],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode != 0:
            print("node runner FAILED:\n" + res.stderr)
            return 1
        js_results = json.loads(res.stdout)
    finally:
        os.unlink(path)

    # 2. The Python engine, on the same list.
    max_diff = 0.0
    worst = -1
    for idx, (c, js_probs) in enumerate(zip(circuits, js_results)):
        py_probs = q.simulate(c["ops"], c["n"])
        if len(py_probs) != len(js_probs):
            print("CIRCUIT %d: different result sizes (%d vs %d)"
                  % (idx, len(py_probs), len(js_probs)))
            return 1
        for a, b in zip(js_probs, py_probs):
            d = abs(a - b)
            if d > max_diff:
                max_diff, worst = d, idx

    print("parity: %d random circuits, %d/200 through BOTH engines"
          % (count, count))
    print("max |JS - Python| = %.3e   (worst circuit #%d)" % (max_diff, worst))
    if max_diff < 1e-9:
        print("PASS: the two simulators agree to 1e-9.")
        return 0
    print("FAIL: the simulators disagree beyond 1e-9.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
