# __main__.py — the `notebookq` command.
#   notebookq            → serve the web app and open the browser
#   notebookq --port N   → same, on a chosen port
#   notebookq mcp        → the MCP server over stdio (see README)
# The heavy lifting stays in server.py / mcp_server.py; this file only
# routes the command line.

import sys


def main():
    argv = sys.argv[1:]

    if argv and argv[0] == "mcp":
        # MCP stdio mode: no port, no browser — stdin/stdout only.
        from .mcp_server import run
        run()
        return

    port = 8000
    if "--port" in argv or "-p" in argv:
        i = argv.index("--port") if "--port" in argv else argv.index("-p")
        port = int(argv[i + 1])

    from .server import serve_and_open
    serve_and_open(port)


if __name__ == "__main__":
    main()
