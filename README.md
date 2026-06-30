# Shopline MCP Server

[Traditional Chinese](README.zh-TW.md)

An MCP server for the Shopline Open API, published as `shopline-mcp` on npm.

It wraps the Shopline Open API into 269 AI-callable business tools (124 read + 145 write) for e-commerce data analysis and store operations. It also includes 10 assistant tools for capability discovery, workflow guidance, write previews, Human in the loop approval, product content audits, SEO/GEO readiness checks, reorder forecasting, and multi-store configuration checks. It runs over stdio, so it works with Claude Code, Claude Desktop, Codex, and other MCP-compatible clients.

This is a third-party open-source package, not an official SHOPLINE product. This TypeScript/Node.js package was rebuilt with reference to the MIT-licensed Python project [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline).

## Links

- Repository: [slinedev/shopline-mcp](https://github.com/slinedev/shopline-mcp)
- Reference Python project (MIT): [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)
- Official website: [https://sline.dev/shopline-mcp/](https://sline.dev/shopline-mcp/)

## What This Does

- **269 ready-to-use tools** covering orders, products, inventory, customers, promotions, categories, subscriptions, conversations, reviews, store settings, webhooks, live sales, user coupons, wish lists, staff, purchase/return order operations, and metafields
- **124 read tools** for querying and analyzing Shopline data
- **145 write tools** for creating, updating, and deleting Shopline resources
- **10 assistant tools** for tool search, workflow recommendations, write previews, Human in the loop approval, content/SEO audits, reorder forecasting, and store alias checks
- **MCP stdio server** for local AI clients
- **Built-in API handling** for authentication, pagination, retry, date windows, and DELETE requests with JSON bodies
- **Multi-store routing** with optional `store_alias` when `SHOPLINE_STORES_JSON` is configured
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

Set your API token before starting the server:

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

For multiple stores, configure aliases:

```bash
export SHOPLINE_STORES_JSON='{"tw":{"token":"tw_token"},"hk":{"token":"hk_token"}}'
```

### Diagnostics

If you encounter issues, run the diagnostic command. It checks your local MCP server, token configuration, and a read-only Shopline API connection. It does not modify any client configuration files.

```bash
npx shopline-mcp doctor
```

### Manual Client Setup

#### Claude Code

```bash
claude mcp add --transport stdio shopline -e SHOPLINE_API_TOKEN=your_token_here -- npx shopline-mcp
```

#### Claude Desktop

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

#### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.shopline]
command = "npx"
args = ["-y", "shopline-mcp"]
env_vars = ["SHOPLINE_API_TOKEN"]
```

See the [Codex MCP configuration docs](https://developers.openai.com/codex/config-basic) for more details.

#### OpenCode

Add this to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shopline": {
      "type": "local",
      "command": ["npx", "-y", "shopline-mcp"],
      "enabled": true,
      "environment": {
        "SHOPLINE_API_TOKEN": "{env:SHOPLINE_API_TOKEN}"
      }
    }
  }
}
```

See the [OpenCode MCP servers docs](https://opencode.ai/docs/mcp-servers/) for more details.

#### VS Code

Add this to `.vscode/mcp.json` or your user MCP configuration:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "shopline-api-token",
      "description": "Shopline API Token",
      "password": true
    }
  ],
  "servers": {
    "shopline": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "shopline-mcp"],
      "env": {
        "SHOPLINE_API_TOKEN": "${input:shopline-api-token}"
      }
    }
  }
}
```

See the [VS Code MCP configuration docs](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration) for more details.

## Important: Write Tools

This server includes tools that can create, update, or delete data in your Shopline store. Your token permissions control which operations are available.

- Use the narrowest token permissions possible
- Write tools are marked with `[WRITE]`
- Write descriptions include a `【副作用】` side-effect section
- Pass `dry_run: true` to a write tool to preview the API method, path, parameters, and body without changing store data
- Dry-run previews include an `approval_code` for Human in the loop review
- Set `SHOPLINE_REQUIRE_WRITE_APPROVAL=1` to require the matching `approval_code` before any write tool can run

## Tools (279 total)

This server exposes 269 Shopline API business tools plus 10 assistant tools.

### Read Tools (124)

| Domain | Coverage |
|--------|----------|
| Orders | Query orders, sales summary, top products, trends, channel comparison, order detail, refunds, archived orders, labels, tags, logs, transactions |
| Products & Inventory | Product list, variants, inventory overview, low stock alerts, warehouses, warehouse stock, locked inventory, purchase orders, product metafields |
| Analytics | RFM, repurchase, customer geography, inventory turnover, category sales, promotion analysis, refund by store, transfer suggestions, promotion ROI, lifecycle, slow movers |
| Customers | Customers, profiles, groups, group members, store credits, membership tiers, tier history, point rules, custom fields, user coupons, wish lists, customer metafields |
| Categories & Promotions | Category tree/detail, promotions, coupon center, flash price campaigns, affiliate campaigns, gifts, add-on products, subscriptions |
| Order Extended | Return orders, order delivery, conversations, conversation messages, product reviews, live sales, order metafields |
| Store Settings | Merchants, payments, delivery options, channels, app settings, expanded settings, taxes, staff, token info, agents, webhooks |

### Write Tools (145)

| Domain | Coverage |
|--------|----------|
| Order Operations | Cancel, ship, bulk ship, split, update, status updates, tags, create |
| Customer Operations | Create, update, delete, tags, store credits, member points |
| Product Operations | Create, update, delete, variants, quantity, price, tags, images, bulk updates, category assignment |
| Promotions | Promotions, coupons, flash price campaigns, affiliate campaigns |
| Categories | Create, update, delete |
| Return Orders | Create, update, inspect, add notes, and update delivery status |
| Conversations | Send order and shop messages |
| Reviews | Create, bulk create, update, bulk update, delete, bulk delete |
| Gifts & Add-ons | Create, update, and quantity operations |
| Purchase Orders | Create, update, create child purchase orders, delete, and bulk delete |
| Media & Metafields | Upload media and create, update, delete, and bulk manage selected metafields |
| Delivery & Merchant | Update order delivery, pickup store, merchant settings, domains, theme/layout drafts, and publish settings |
| Webhooks & Live Sales | Create/update/delete webhooks and manage live sale products |

### Assistant Tools (10)

| Tool | Purpose |
|------|---------|
| `describe_shopline_mcp_capabilities` | Summarize current coverage, domains, and safety features |
| `find_shopline_tools` | Search tools by task, keyword, domain, or read/write mode |
| `explain_shopline_tool` | Explain a specific tool's parameters, endpoints, and safety notes |
| `recommend_shopline_workflow` | Recommend tool sequences for merchant tasks such as sales reports or inventory risk |
| `preview_shopline_write_tool` | Preview a write tool without calling Shopline |
| `list_shopline_store_profiles` | List configured store aliases without exposing tokens |
| `prepare_shopline_write_approval` | Generate a human-review write preview and approval code |
| `audit_shopline_product_content` | Find products missing content, images, categories, tags, or brand fields |
| `audit_shopline_seo_readiness` | Find products missing SEO/GEO fields and return review drafts |
| `forecast_shopline_reorder_candidates` | Estimate SKUs that may need replenishment from sales, stock, and locked inventory |

## API Endpoint Coverage

The package currently covers:

- 279 tools total
- 269 Shopline API business tools
- 124 read tools
- 145 write tools
- 206 endpoint keys mapped in the local endpoint table
- 263 documented method/path endpoints

This is selected v1.4 merchant-operations coverage, not full coverage of every reference endpoint in the official documentation. Cart, Storefront/OAuth, and cart item metafield endpoints remain outside the current release scope.

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

### "Preview a write before changing the store"

```text
create_customer(
  name = "Alice",
  email = "alice@example.com",
  dry_run = true
)
```

### "Require human approval before writes"

```bash
export SHOPLINE_REQUIRE_WRITE_APPROVAL=1
```

```text
prepare_shopline_write_approval(
  tool_name = "update_product",
  args = { product_id = "product_id", product_data = { status = "active" } }
)

update_product(
  product_id = "product_id",
  product_data = { status = "active" },
  approval_code = "code_from_reviewed_preview"
)
```

### "Which tool should I use?"

```text
find_shopline_tools(query = "low stock", mode = "read")
recommend_shopline_workflow(task = "Prepare a weekly sales report")
```

### "Find content, SEO, or reorder work for review"

```text
audit_shopline_product_content(max_products = 50)
audit_shopline_seo_readiness(max_products = 50)
forecast_shopline_reorder_candidates(
  start_date = "2026-03-01",
  end_date = "2026-03-31",
  horizon_days = 14
)
```

## License

MIT
