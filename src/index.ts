#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";
import { runDoctor } from "./cli/doctor.js";

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "doctor") {
    process.exitCode = await runDoctor();
    return;
  }

  if (command) {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: shopline-mcp [doctor]");
    process.exitCode = 1;
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
