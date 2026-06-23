# Shopline MCP Server

[Traditional Chinese](README.zh-TW.md)

An MCP server for the Shopline Open API, published as `shopline-mcp` on npm.

It wraps the Shopline Open API into 143 AI-callable tools (75 read + 68 write) for e-commerce data analysis and store operations. It runs over stdio, so it works with Claude Code, Claude Desktop, Codex, and other MCP-compatible clients.

This TypeScript/Node.js package was rebuilt with reference to the MIT-licensed Python project [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline).

## Links

- Repository: [slinedev/shopline-mcp](https://github.com/slinedev/shopline-mcp)
- Reference Python project (MIT): [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)
- Official website: [https://sline.dev/shopline-mcp/](https://sline.dev/shopline-mcp/)

## What This Does

- **143 ready-to-use tools** covering orders, products, inventory, customers, promotions, categories, subscriptions, conversations, reviews, and store settings
- **75 read tools** for querying and analyzing Shopline data
- **68 write tools** for creating, updating, and deleting Shopline resources
- **MCP stdio server** for local AI clients
- **Built-in API handling** for authentication, pagination, retry, date windows, and DELETE requests with JSON bodies
- **Agent-friendly output** with structured JSON and natural parameters such as `YYYY-MM-DD` dates

## API Reference

This package is built on the [Shopline Open API v1](https://open-api.docs.shoplineapp.com/docs/getting-started).

- API documentation: https://open-api.docs.shoplineapp.com
- Base URL: `https://open.shopline.io`
- Auth: `Authorization: Bearer <SHOPLINE_API_TOKEN>`

You need a valid Shopline Open API access token from a Shopline merchant account.

## Quick Start

### Install

```bash
npm install shopline-mcp
```

Or run directly:

```bash
npx shopline-mcp
```

Set your API token before starting the server:

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

### Use with Claude Code

```bash
claude mcp add --transport stdio shopline -e SHOPLINE_API_TOKEN=your_token_here -- npx shopline-mcp
```

### Use with Claude Desktop

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

## Important: Write Tools

This server includes tools that can create, update, or delete data in your Shopline store. Your token permissions control which operations are available.

- Use the narrowest token permissions possible
- Write tools are marked with `[WRITE]`
- Write descriptions include a `【副作用】` side-effect section

## Tools (143)

### Read Tools (75)

| Domain | Coverage |
|--------|----------|
| Orders | Query orders, sales summary, top products, trends, channel comparison, order detail, refunds, archived orders, labels, tags, logs, transactions |
| Products & Inventory | Product list, variants, inventory overview, low stock alerts, warehouses, warehouse stock, locked inventory, purchase orders |
| Analytics | RFM, repurchase, customer geography, inventory turnover, category sales, promotion analysis, refund by store, transfer suggestions, promotion ROI, lifecycle, slow movers |
| Customers | Customers, profiles, groups, group members, store credits, membership tiers, tier history, point rules, custom fields |
| Categories & Promotions | Category tree/detail, promotions, flash price campaigns, affiliate campaigns, gifts, add-on products, subscriptions |
| Order Extended | Return orders, order delivery, conversations, conversation messages, product reviews |
| Store Settings | Merchants, payments, delivery options, channels, app settings, taxes, staff permissions, token info, agents |

### Write Tools (68)

| Domain | Coverage |
|--------|----------|
| Order Operations | Cancel, ship, bulk ship, split, update, status updates, tags, create |
| Customer Operations | Create, update, delete, tags, store credits, member points |
| Product Operations | Create, update, delete, variants, quantity, price, tags, images, bulk updates, category assignment |
| Promotions | Promotions, coupons, flash price campaigns, affiliate campaigns |
| Categories | Create, update, delete |
| Return Orders | Create and update return orders |
| Conversations | Send order and shop messages |
| Reviews | Create, bulk create, update, bulk update, delete, bulk delete |
| Gifts & Add-ons | Create, update, and quantity operations |
| Purchase Orders | Create and delete purchase orders |
| Media & Metafields | Upload media and create metafields |
| Delivery & Merchant | Update order delivery, pickup store, and merchant settings |

## API Endpoint Coverage

The package currently covers:

- 143 tools total
- 75 read tools
- 68 write tools
- 135 endpoint keys mapped in the local endpoint table
- 135 documented method/path endpoints

Endpoint availability still depends on your Shopline token permissions.

## API Constraints

- Pagination uses `page` + `per_page`; `per_page` is capped at 50
- Large order searches are paginated internally
- Order search does not support `sort_by`
- Online revenue orders use `confirmed`; POS revenue orders use `completed`
- Channel source is `created_from = "shop"` for online and `"pos"` for POS
- Money objects are converted from their `dollars` field
- Search result limits may require date-range splitting for very large stores

## Usage Examples

### "What were my sales this month?"

```text
get_sales_summary(
  start_date = "2026-04-01",
  end_date = "2026-04-30",
  channel = "all"
)
```

### "Which products are selling best?"

```text
get_top_products(
  start_date = "2026-03-01",
  end_date = "2026-03-31",
  top_n = 5,
  sort_by = "revenue"
)
```

### "Tell me about this customer"

```text
list_customers(search_keyword = "Alice")
get_customer_profile(customer_id = "customer_id_from_search")
```

### "Any products running low on stock?"

```text
get_low_stock_alerts(threshold = 5)
```

### "Create a new customer" (Write tool)

```text
create_customer(
  name = "Alice",
  email = "alice@example.com"
)
```

## License

MIT
