# Changelog

## 1.0.0

- Rebuilt the project as a TypeScript/Node.js MCP server.
- Package name is now `shopline-mcp`.
- Added `shopline-mcp` executable.
- Switched runtime to stdio via `@modelcontextprotocol/sdk`.
- Preserved the 143-tool baseline: 75 read tools and 68 write tools.
- Preserved full reference endpoint coverage.
- Added Node client support for auth, retry, pagination, date segmentation, and DELETE requests with JSON bodies.
- Added Vitest coverage for tool registration, endpoint coverage, client behavior, representative business calculations, and stdio `tools/list`.
- Replaced PyPI publishing with npm provenance publishing.
