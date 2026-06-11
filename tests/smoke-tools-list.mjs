import { spawn } from "node:child_process";
import { once } from "node:events";

const child = spawn(process.execPath, ["dist/index.js"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, SHOPLINE_API_TOKEN: "" },
});

let buffer = "";
const responses = new Map();

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined) responses.set(message.id, message);
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(id, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (responses.has(id)) return responses.get(id);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for response ${id}`);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "shopline-smoke", version: "1.0.0" },
  },
});
await waitFor(1);
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const listResponse = await waitFor(2);

const tools = listResponse.result?.tools ?? [];
if (tools.length !== 143) {
  throw new Error(`Expected 143 tools, got ${tools.length}`);
}

child.stdin.end();
child.kill("SIGTERM");
await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1000))]);
console.log(`tools/list returned ${tools.length} tools`);
