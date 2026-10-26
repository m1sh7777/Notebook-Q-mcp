#!/usr/bin/env python3
# sync_web.py — copy the web app into the Python package.
# The repo root is the single editing home; src/notebookq/web/ is BUILD
# OUTPUT. Run this before `pip install .`:
#   python3 scripts/sync_web.py && pip install .
# Also copies server.py itself into the package — one implementation,
# two homes (the package copy serves its bundled web/ via default_web_dir()).

import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "src", "notebookq")
WEB = os.path.join(PKG, "web")


def main():
    # Clean the build output so stale files can never survive.
    if os.path.exists(WEB):
        shutil.rmtree(WEB)
    os.makedirs(os.path.join(WEB, "js"))
    os.makedirs(os.path.join(WEB, "css"))

    shutil.copy2(os.path.join(ROOT, "index.html"), WEB)
    for name in os.listdir(os.path.join(ROOT, "js")):
        if name.endswith(".js"):
            shutil.copy2(os.path.join(ROOT, "js", name), os.path.join(WEB, "js", name))
    for name in os.listdir(os.path.join(ROOT, "css")):
        if name.endswith(".css"):
            shutil.copy2(os.path.join(ROOT, "css", name), os.path.join(WEB, "css", name))
    shutil.copy2(os.path.join(ROOT, "server.py"), os.path.join(PKG, "server.py"))

    count = len(os.listdir(os.path.join(WEB, "js")))
    print("synced: web/index.html, web/css/, web/js/ (%d js files), server.py" % count)


if __name__ == "__main__":
    sys.exit(main())
