import { spawnSync } from "node:child_process";

function run(args, env = {}) {
  return spawnSync(process.execPath, ["dist/index.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const init = run(["init"]);
if (init.status !== 1) {
  throw new Error(`Expected init to exit 1, got ${init.status}\nstdout:\n${init.stdout}\nstderr:\n${init.stderr}`);
}
if (!init.stderr.includes("Unknown command: init")) {
  throw new Error(`Expected init to print unknown command, got:\n${init.stderr}`);
}

const doctor = run(["doctor"], { SHOPLINE_API_TOKEN: "", SHOPLINE_STORES_JSON: "" });
if (doctor.status !== 1) {
  throw new Error(`Expected doctor without token to exit 1, got ${doctor.status}\nstdout:\n${doctor.stdout}\nstderr:\n${doctor.stderr}`);
}
if (!doctor.stderr.includes("Set SHOPLINE_API_TOKEN or SHOPLINE_STORES_JSON")) {
  throw new Error(`Expected doctor to explain missing token, got:\n${doctor.stderr}`);
}

console.log("CLI command smoke checks passed");
