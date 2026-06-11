# CLAUDE.md

## Project Overview

Shopline API MCP Server implemented in TypeScript/Node.js. The package is published as `shopline-mcp` and exposes 143 tools (75 read + 68 write) over stdio for MCP-compatible clients.

Tool descriptions remain in Traditional Chinese (`zh-Hant`) because they are shown to AI clients and match the Shopline merchant context.

## Setup

```bash
npm install
export SHOPLINE_API_TOKEN=your_token_here
```

## Running

```bash
npm run build
node dist/index.js
```

Installed package command:

```bash
shopline-mcp
```

## Tests

```bash
npm run build
npm test
npm run test:smoke
npm pack --dry-run
```

Local tests do not require `SHOPLINE_API_TOKEN`. Live read checks require `SHOPLINE_API_TOKEN`. Live write checks must remain gated behind `SHOPLINE_TEST_WRITES=1`.

## Architecture

- `src/index.ts` — stdio entrypoint
- `src/server.ts` — creates `shopline-mcp-server`
- `src/tools/register.ts` — registers all tools with `McpServer.registerTool`
- `src/tools/custom.ts` — hand-ported business logic for high-value analytical tools
- `src/tools/generic.ts` — generic API executor for direct endpoint tools
- `src/client.ts` — shared Shopline HTTP client with auth, retry, pagination, and DELETE body support
- `src/generated/toolSpecs.ts` — static tool metadata baseline
- `src/generated/endpoints.ts` — static Shopline endpoint map
- `tests/` — Node/Vitest tests and stdio smoke test

## Tool Conventions

- Use `@modelcontextprotocol/sdk` and `zod`.
- Register tools with `server.registerTool()`.
- Keep existing tool names stable; do not add a `shopline_` prefix unless explicitly requested.
- Write tool descriptions must start with `[WRITE]` and include `【副作用】`.
- Write tools should return a standard result containing `success`, `resource_id`, and `message` where practical.
- Read tools should be marked read-only in MCP annotations; write tools should be marked non-read-only and destructive.

## API Constraints

- Base URL: `https://open.shopline.io`
- Token env var: `SHOPLINE_API_TOKEN`
- Pagination: `page` + `per_page`, max 50
- Search limit: 10,000 results; split large date ranges when needed
- Orders search does not support `sort_by`
- Valid revenue statuses: online `confirmed`, POS `completed`
- Channel source: `created_from = "shop"` or `"pos"`
- Money objects are converted from their `dollars` field
