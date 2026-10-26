/* parity_runner.js — the JS half of the parity test.
   Usage: node scripts/parity_runner.js <circuits.json>
   Reads {circuits: [{n, ops}]}, runs each through js/simulator.js,
   prints one JSON array of probability lists. */
const fs = require("fs");
const path = require("path");
const sim = require(path.join(__dirname, "..", "js", "simulator.js"));

const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = data.circuits.map((c) => sim.simulate(c.ops, c.n));
process.stdout.write(JSON.stringify(out));
