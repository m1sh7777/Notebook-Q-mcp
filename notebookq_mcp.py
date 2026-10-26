#!/usr/bin/env python3
# notebookq_mcp.py — run the NotebookQ MCP server from this one file:
#   python3 notebookq_mcp.py   (stdio; same as `notebookq mcp` after install)
# mcp<2 pin in requirements: the 2.x SDK line reorganized the FastMCP API,
# which would break the 1.x imports used here.

import os
import sys

# Make the in-repo package importable when running from a checkout
# (after `pip install .[mcp]` this line is redundant).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from notebookq.mcp_server import run  # noqa: E402

if __name__ == "__main__":
    run()
