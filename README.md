# Shopline MCP Server

An MCP server for the Shopline Open API, published as `shopline-mcp`.

It exposes 143 AI-callable tools for Shopline store analysis and operations:

- 75 read tools for orders, products, inventory, customers, promotions, analytics, reviews, conversations, and store settings
- 68 write tools for creating, updating, and deleting Shopline resources
- stdio transport for Claude Code, Claude Desktop, Codex, and other MCP-compatible clients

## Links

- Repository: [slinedev/shopline-mcp](https://github.com/slinedev/shopline-mcp)
- Official website: [https://sline.dev/shopline-mcp/](https://sline.dev/shopline-mcp/)

## Requirements

- Node.js 24 or newer
- A Shopline Open API access token

Set your token before running the server:

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

## Install

```bash
npm install shopline-mcp
```

Or run it directly:

```bash
npx shopline-mcp
```

The executable command is:

```bash
shopline-mcp
```

## Claude Code

```bash
claude mcp add --transport stdio shopline -e SHOPLINE_API_TOKEN=your_token_here -- npx shopline-mcp
```

## Claude Desktop

```json
{
  "mcpServers": {
    "shopline": {
      "command": "npx",
      "args": ["shopline-mcp"],
      "env": {
        "SHOPLINE_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Write Tools

This server includes write tools that can create, update, or delete data in your Shopline store.

Write tools are marked with `[WRITE]` in their descriptions and include a side-effect section. Use a token with the narrowest permissions needed.

## API Notes

- Base URL: `https://open.shopline.io`
- Auth: `Authorization: Bearer <SHOPLINE_API_TOKEN>`
- Pagination: `page` + `per_page`, max `per_page` 50
- Large order searches are paginated internally
- Online revenue orders use `confirmed`; POS revenue orders use `completed`
- Channel source: `created_from = "shop"` for online and `"pos"` for POS
- Money values are returned as TWD numbers by extracting Shopline money object `dollars`

## Package Name

Use `shopline-mcp` for npm registry installs.

`shopline/mcp` without `@` is not an npm package name. npm treats that form as a GitHub repository shorthand.
