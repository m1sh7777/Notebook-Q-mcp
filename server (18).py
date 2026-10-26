#!/usr/bin/env python3
# server.py — NotebookQ's local server: serves the web app and handles
# POST /interpret (sketch image → Z.ai chat API → circuit proposal).
# Without ZAI_API_KEY in the environment it returns a canned fake answer
# so the flow works offline (labelled "fake" in the UI). Security: the
# key comes only from env ZAI_API_KEY — never logged, never in error
# messages; model output is never trusted (extract_json + sanitize_proposal
# here, the browser re-validates and the user must Accept). Stdlib only.

import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# ---- configuration (env read at call time, so tests can flip it) ----

ZAI_BASE_URL = "https://api.z.ai/api/paas/v4"
DEFAULT_MODEL = "glm-5.3-flash"

# Canned fake answer (the Bell circuit) used when no API key is set.
FAKE_PROPOSAL = {
    "wires": 2,
    "gates": [
        {"gate": "H", "wire_index": 0, "col": 0},
        {"gate": "CNOT", "wire_index": 0, "target_index": 1, "col": 1},
    ],
}

# Strict JSON-only prompt: constraining the output shape beats parsing
# prose afterwards.
INTERPRET_PROMPT = (
    "This is a hand-drawn quantum circuit on grid paper. "
    "Horizontal lines are qubit wires, numbered top to bottom starting at 0. "
    "Boxes contain a single letter: H, X, Z or R. A vertical line with a filled dot "
    "on one wire and a circle-with-plus on another wire is a CNOT from the dot wire "
    "(control) to the circle wire (target). An R box is a rotation gate; if a small "
    "label near it shows an angle value, use it, otherwise use 1.57.\n"
    "Time columns are numbered 0, 1, 2, ... from left to right (one column is about "
    "2 grid cells wide).\n"
    "Reply with ONLY JSON, no prose, no markdown fences, in this exact shape:\n"
    '{"wires": <number of wires>, "gates": ['
    '{"gate": "H", "wire_index": 0, "col": 0}, '
    '{"gate": "CNOT", "wire_index": 0, "target_index": 1, "col": 1}, '
    '{"gate": "R", "wire_index": 1, "col": 2, "angle": 1.57}]}\n'
    "Draw gates that are not clearly on a wire are to be omitted. "
    "If the image contains no circuit at all, reply {\"wires\": 0, \"gates\": []}."
)

KNOWN_GATES = ("H", "X", "Z", "R")
MAX_WIRES = 5      # the app simulates at most 5 qubits — same ceiling
MAX_GATES = 64     # a proposal bigger than this is nonsense, refuse it


class ProposalError(Exception):
    """A model answer that fails sanitation. The message is safe to show
    in the browser: no key, no raw model text."""


# ---- the model call (isolated so tests can mock it) ----

def call_model(image_data_url):
    """POST the image + prompt to Z.ai and return the assistant's text.
    Raises ProposalError with a user-safe sentence on any failure — the
    underlying error and the key must never leak."""
    key = os.environ.get("ZAI_API_KEY", "").strip()
    model = os.environ.get("ZAI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                    {"type": "text", "text": INTERPRET_PROMPT},
                ],
            }
        ],
    }
    req = urllib.request.Request(
        ZAI_BASE_URL + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,  # env-only; never logged
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Status only — the response body could echo anything.
        raise ProposalError(
            "The AI service refused the request (HTTP " + str(e.code) + ")."
        )
    except (urllib.error.URLError, OSError, ValueError):
        raise ProposalError(
            "Could not reach the AI service — check your internet connection."
        )

    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ProposalError("The AI service answered in an unexpected shape.")


# ---- from model text to a proposal (the trust boundary) ----

def extract_json(text):
    """Pull the first JSON object out of the model's text. Models add
    markdown fences and preambles even when told not to, so we strip
    regardless. Raises ProposalError when there is no object."""
    if not isinstance(text, str):
        raise ProposalError("The AI returned no readable answer.")
    m = re.search(r"\{.*\}", text, re.DOTALL)  # first {...} block
    if not m:
        raise ProposalError("The AI's answer contained no JSON at all.")
    try:
        return json.loads(m.group(0))
    except ValueError:
        raise ProposalError("The AI's answer was not valid JSON.")


def _as_int(v, what):
    if isinstance(v, bool) or not isinstance(v, int):
        raise ProposalError("The AI's answer had a malformed " + what + ".")
    return v


def sanitize_proposal(raw):
    """Accept only a proposal shaped like our own data (types, known gates,
    indexes in range). This is the trust boundary: after it the proposal is
    our shape, and the browser still validates it again before use."""
    if not isinstance(raw, dict):
        raise ProposalError("The AI's answer was not a circuit description.")
    wires = _as_int(raw.get("wires"), "wire count")
    if wires < 0 or wires > MAX_WIRES:
        raise ProposalError(
            "The AI proposed " + str(wires) + " wires — NotebookQ draws at most "
            + str(MAX_WIRES) + "."
        )
    gates_in = raw.get("gates")
    if not isinstance(gates_in, list):
        raise ProposalError("The AI's answer had no gate list.")
    if len(gates_in) > MAX_GATES:
        raise ProposalError("The AI proposed too many gates (" + str(len(gates_in)) + ").")

    gates_out = []
    for g in gates_in:
        if not isinstance(g, dict):
            raise ProposalError("The AI proposed a malformed gate.")
        name = g.get("gate")
        col = _as_int(g.get("col", 0), "column")
        if col < 0 or col > 64:
            raise ProposalError("The AI proposed a gate at an impossible column.")
        if name == "CNOT":
            c = _as_int(g.get("wire_index"), "CNOT control")
            t = _as_int(g.get("target_index"), "CNOT target")
            if not (0 <= c < wires and 0 <= t < wires):
                raise ProposalError("The AI proposed a CNOT on wires that do not exist.")
            if c == t:
                raise ProposalError(
                    "The AI proposed a CNOT whose control and target are the same wire."
                )
            gates_out.append({"gate": "CNOT", "wire_index": c, "target_index": t, "col": col})
        elif name in KNOWN_GATES:
            q = _as_int(g.get("wire_index"), name + " wire index")
            if not (0 <= q < wires):
                raise ProposalError("The AI proposed an " + name + " on a wire that does not exist.")
            entry = {"gate": name, "wire_index": q, "col": col}
            if name == "R":
                a = g.get("angle")
                if isinstance(a, bool) or not isinstance(a, (int, float)):
                    raise ProposalError("The AI proposed an R gate without a numeric angle.")
                entry["angle"] = float(a)
            gates_out.append(entry)
        else:
            raise ProposalError(
                'The AI proposed a gate "' + str(name) + '", which NotebookQ does not know.'
            )
    return {"wires": wires, "gates": gates_out}


def build_summary(proposal, mode):
    """The preview's first line. Built here so fake and live modes read
    the same."""
    head = ("FAKE example (no API key set — a canned Bell circuit)"
            if mode == "fake"
            else "AI proposal (live model)")
    if proposal["wires"] == 0:
        return head + ": no circuit found in the image."
    parts = []
    for g in proposal["gates"]:
        if g["gate"] == "CNOT":
            parts.append("CNOT q%d→q%d (column %d)" % (g["wire_index"], g["target_index"], g["col"]))
        elif g["gate"] == "R":
            parts.append("R(%.2f) on q%d (column %d)" % (g["angle"], g["wire_index"], g["col"]))
        else:
            parts.append("%s on q%d (column %d)" % (g["gate"], g["wire_index"], g["col"]))
    return head + ": %d wires. " % proposal["wires"] + "; ".join(parts) + "."


def interpret_image(image_data_url):
    """The /interpret pipeline for one request. Returns the response dict
    and never raises (errors become ok:false + a user-safe sentence)."""
    # The browser payload is user input too — never trusted either.
    if not isinstance(image_data_url, str) or not image_data_url.startswith("data:image/"):
        return {"ok": False, "error": "No canvas image arrived — try again."}

    key = os.environ.get("ZAI_API_KEY", "").strip()
    if not key:
        proposal = sanitize_proposal(FAKE_PROPOSAL)  # canned, but same pipeline
        return {
            "ok": True,
            "mode": "fake",
            "proposal": proposal,
            "summary": build_summary(proposal, "fake"),
        }

    try:
        text = call_model(image_data_url)
        proposal = sanitize_proposal(extract_json(text))
    except ProposalError as e:
        return {"ok": False, "error": str(e)}
    return {
        "ok": True,
        "mode": "live",
        "proposal": proposal,
        "summary": build_summary(proposal, "live"),
    }


# ---- the HTTP layer ----

class NotebookQHandler(SimpleHTTPRequestHandler):
    """Static files from `directory`, plus one POST door."""

    def do_POST(self):
        if self.path.rstrip("/") != "/interpret":
            self._send_json(404, {"ok": False, "error": "Unknown endpoint."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"ok": False, "error": "The request was not valid JSON."})
            return
        result = interpret_image(body.get("image"))
        self._send_json(200, result)

    def _send_json(self, code, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        # Disabled: the default logger can print request bodies in some
        # setups — nothing that could contain the image is ever logged.
        pass


def default_web_dir():
    """Web app location: $NOTEBOOKQ_WEB_DIR, else index.html next to this
    file (dev layout), else ./web (installed-package layout)."""
    env = os.environ.get("NOTEBOOKQ_WEB_DIR")
    if env:
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(here, "index.html")):
        return here
    web = os.path.join(here, "web")
    if os.path.exists(os.path.join(web, "index.html")):
        return web
    return here


def serve(directory, port):
    """Build the server without running it — tests use this directly."""
    handler = lambda *args, **kw: NotebookQHandler(*args, directory=directory, **kw)
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def serve_and_open(port, directory=None, open_browser=True):
    """Serve forever and open a browser tab (the `notebookq` command)."""
    directory = directory or default_web_dir()
    httpd = serve(directory, port)
    port = httpd.server_address[1]  # the real port (port 0 → whatever is free)
    url = "http://localhost:%d/" % port
    print("NotebookQ serving %s at %s  (Ctrl+C to stop)" % (directory, url))
    print('AI "Interpret sketch" runs in FAKE mode unless ZAI_API_KEY is set.')
    if open_browser:
        import webbrowser
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBye!")


def main():
    args = sys.argv[1:]
    port = 8000
    if "--port" in args or "-p" in args:
        i = args.index("--port") if "--port" in args else args.index("-p")
        port = int(args[i + 1])
    serve_and_open(port)


if __name__ == "__main__":
    main()
