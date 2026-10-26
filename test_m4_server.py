# ============================================================
# test_m4_server.py — M4 server tests with a MOCKED model.
# Run:  cd notebookq && python3 tests/test_m4_server.py
# ------------------------------------------------------------
# The real Z.ai call is never made here (no key, no network): the
# module-level call_model() function is REPLACED with stubs that
# return canned answers — that is the point of isolating it in its
# own function. Everything around it is exercised for real: the
# HTTP server, routing, JSON parsing, sanitation, fake mode.
#
# Proven, one test per behavior:
#   1. no API key        → FAKE mode, canned Bell proposal
#   2. mocked good JSON  → live mode, proposal parsed (fences stripped)
#   3. unknown gate      → refused with a plain sentence
#   4. non-JSON answer   → refused with a plain sentence
#   5. malformed gates   → refused (CNOT to itself, wire out of range)
#   6. model call raises → friendly network sentence, NO key inside
#   7. GET / serves index.html
# ============================================================

import json
import os
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as srv  # the module under test


class TestInterpret(unittest.TestCase):
    def setUp(self):
        # A fresh server on a free port, serving a stub web dir.
        self.tmp = tempfile.mkdtemp()
        (Path(self.tmp) / "index.html").write_text("<html>stub</html>")
        self.httpd = srv.serve(self.tmp, 0)
        self.port = self.httpd.server_address[1]
        self.url = "http://127.0.0.1:%d" % self.port
        import threading
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()  # return the port (silences ResourceWarning)
        # Never leave a fake key lying around for the next test.
        os.environ.pop("ZAI_API_KEY", None)
        srv.call_model = srv.__dict__.get("_original_call_model", srv.call_model)

    def post(self, payload):
        req = urllib.request.Request(
            self.url + "/interpret",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())

    # -- 1. no key → FAKE mode --------------------------------
    def test_fake_mode_without_key(self):
        os.environ.pop("ZAI_API_KEY", None)
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["mode"], "fake")
        self.assertEqual(reply["proposal"]["wires"], 2)
        self.assertEqual(len(reply["proposal"]["gates"]), 2)
        self.assertIn("Bell", reply["summary"])
        self.assertIn("FAKE", reply["summary"])

    # -- 2. mocked good JSON (with markdown fences!) → live ----
    def test_live_mode_valid_answer(self):
        os.environ["ZAI_API_KEY"] = "test-key-123"
        fenced = '```json\n{"wires": 3, "gates": ['
        fenced += '{"gate": "H", "wire_index": 0, "col": 0}, '
        fenced += '{"gate": "CNOT", "wire_index": 0, "target_index": 1, "col": 1}]}\n```'
        srv.call_model = lambda image: fenced
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["mode"], "live")
        self.assertEqual(reply["proposal"]["wires"], 3)
        self.assertEqual(reply["proposal"]["gates"][1]["target_index"], 1)

    # -- 3. unknown gate → refused -----------------------------
    def test_unknown_gate_refused(self):
        os.environ["ZAI_API_KEY"] = "test-key-123"
        srv.call_model = lambda image: '{"wires": 2, "gates": [{"gate": "W", "wire_index": 0, "col": 0}]}'
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertFalse(reply["ok"])
        self.assertIn("does not know", reply["error"])

    # -- 4. non-JSON → refused ---------------------------------
    def test_non_json_refused(self):
        os.environ["ZAI_API_KEY"] = "test-key-123"
        srv.call_model = lambda image: "I see a lovely circuit, here is a haiku instead..."
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertFalse(reply["ok"])
        self.assertIn("no JSON", reply["error"])

    # -- 5. malformed proposals → refused ----------------------
    def test_malformed_proposals_refused(self):
        os.environ["ZAI_API_KEY"] = "test-key-123"
        # A CNOT from a wire to itself...
        srv.call_model = lambda image: (
            '{"wires": 2, "gates": [{"gate": "CNOT", "wire_index": 1, '
            '"target_index": 1, "col": 0}]}')
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertFalse(reply["ok"])
        self.assertIn("same wire", reply["error"])
        # ...and a gate on a wire that does not exist.
        srv.call_model = lambda image: (
            '{"wires": 2, "gates": [{"gate": "H", "wire_index": 9, "col": 0}]}')
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertFalse(reply["ok"])
        self.assertIn("does not exist", reply["error"])

    # -- 6. network failure → friendly sentence, key NEVER leaks --
    def test_network_error_never_leaks_key(self):
        os.environ["ZAI_API_KEY"] = "super-secret-key-xyz"
        def boom(image):
            raise srv.ProposalError("Could not reach the AI service — check your internet connection.")
        srv.call_model = boom
        reply = self.post({"image": "data:image/png;base64,iVBORw0KGgo="})
        self.assertFalse(reply["ok"])
        self.assertNotIn("super-secret-key-xyz", json.dumps(reply))

    # -- 7. GET / serves the web app ---------------------------
    def test_get_serves_index(self):
        with urllib.request.urlopen(self.url + "/", timeout=10) as r:
            body = r.read().decode()
        self.assertIn("stub", body)

    # -- extra: missing image field is refused politely --------
    def test_missing_image(self):
        reply = self.post({"nope": 1})
        self.assertFalse(reply["ok"])
        self.assertIn("No canvas image", reply["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
