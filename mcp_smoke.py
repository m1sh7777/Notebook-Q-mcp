#!/usr/bin/env python3
# mcp_smoke.py — talk to the MCP server like a real client.
# Spawn `notebookq mcp` (or notebookq_mcp.py) as a subprocess and speak
# the protocol over stdio: initialize → tools/list → tools/call
# (simulate + validate). Run: python3 scripts/mcp_smoke.py

import json
import subprocess
import sys

# Command to spawn: any `notebookq mcp`-style command. Default assumes
# the `notebookq` console script is on PATH; pass your own, e.g.:
#   python3 scripts/mcp_smoke.py /path/to/venv/bin/notebookq mcp
CMD = sys.argv[1:] or ["notebookq", "mcp"]


def main():
    requests = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "smoke", "version": "1"}}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        # Bell: H on q0, CNOT 0→1 → 50% 00 / 50% 11.
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "simulate_circuit", "arguments": {
                "n_qubits": 2,
                "gates": [
                    {"gate": "H", "qubit": 0, "col": 0},
                    {"gate": "CNOT", "control": 0, "target": 1, "col": 1},
                ]}}},
        # R with a numeric angle.
        {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
            "name": "simulate_circuit", "arguments": {
                "n_qubits": 1,
                "gates": [{"gate": "R", "qubit": 0, "col": 0, "angle": 3.141592653589793}]}}},
        # A same-wire CNOT → exactly one problem.
        {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
            "name": "validate_circuit", "arguments": {
                "n_qubits": 2,
                "gates": [{"gate": "CNOT", "control": 1, "target": 1, "col": 0}]}}},
    ]

    # stdin stays OPEN while reading replies: writing everything and
    # closing early made the server race its own shutdown and swallow
    # the last reply.
    proc = subprocess.Popen(
        CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, bufsize=1,
    )
    for req in requests:
        proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()

    replies = {}
    wanted = {2, 3, 4, 5}
    import time
    deadline = time.time() + 20
    while wanted and time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break  # server closed its stdout
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("id") in wanted:
            replies[msg["id"]] = msg
            wanted.discard(msg["id"])
    proc.kill()
    proc.wait()

    failures = []

    def want(cond, what):
        if not cond:
            failures.append(what)
        print(("ok   " if cond else "FAIL ") + what)

    tools = replies.get(2, {}).get("result", {}).get("tools", [])
    names = [t["name"] for t in tools]
    want("simulate_circuit" in names and "validate_circuit" in names,
         "tools/list exposes simulate_circuit + validate_circuit")

    sim = json.loads(replies[3]["result"]["content"][0]["text"])
    want(sim["ok"] and abs(sim["probabilities"].get("00", 0) - 0.5) < 1e-9
         and abs(sim["probabilities"].get("11", 0) - 0.5) < 1e-9,
         "Bell circuit via MCP → 50% 00 + 50% 11")

    ry = json.loads(replies[4]["result"]["content"][0]["text"])
    want(ry["ok"] and abs(ry["probabilities"].get("1", 0) - 1) < 1e-9,
         "R(pi) with numeric angle via MCP → 100% on 1")

    val = json.loads(replies[5]["result"]["content"][0]["text"])
    want(len(val["problems"]) == 1 and "same wire" in val["problems"][0],
         "same-wire CNOT via MCP → exactly ONE problem")

    print("")
    if failures:
        print("%d check(s) FAILED" % len(failures))
        return 1
    print("4/4 MCP smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
