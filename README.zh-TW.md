# Shopline MCP Server

[English](README.md)

Shopline Open API 的 MCP server，npm 套件名稱為 `shopline-mcp`。

此套件將 Shopline Open API 封裝成 143 個 AI 可呼叫的業務工具（75 個讀取 + 68 個寫入），可用於電商資料分析與商店操作。另提供 10 個輔助工具，用於能力查詢、工作流建議、寫入預覽、Human in the loop 審核、商品內容檢查、SEO/GEO 準備度檢查、補貨預測與多商店設定檢查。Server 使用 stdio transport，可接 Claude Code、Claude Desktop、Codex 與其他 MCP client。

本專案是第三方開源套件，並非 SHOPLINE 官方產品。本專案參考自採用 MIT 授權的 Python 專案 [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)，並重構為 TypeScript/Node.js 版本。

## 連結

- 倉庫地址：[slinedev/shopline-mcp](https://github.com/slinedev/shopline-mcp)
- 參考 Python 專案（MIT）：[asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)
- 官方網站：[https://sline.dev/shopline-mcp/](https://sline.dev/shopline-mcp/)

## 功能特色

- **143 個即用工具**：涵蓋訂單、商品、庫存、客戶、促銷、分類、訂閱、客服對話、評價與商店設定
- **75 個讀取工具**：查詢與分析 Shopline 資料
- **68 個寫入工具**：建立、更新、刪除 Shopline 資源
- **10 個輔助工具**：搜尋工具、推薦工作流、預覽寫入、Human in the loop 審核、內容/SEO 檢查、補貨預測、檢查 store alias
- **MCP stdio server**：可接本機 AI client
- **內建 API 處理**：認證、分頁、重試、日期區間與 DELETE JSON body
- **多商店路由**：設定 `SHOPLINE_STORES_JSON` 後，可用 `store_alias` 指定店鋪
- **適合 AI Agent 使用**：結構化 JSON 輸出，日期參數使用 `YYYY-MM-DD`

## API 參考文件

本專案基於 [Shopline Open API v1](https://open-api.docs.shoplineapp.com/docs/getting-started)。

- API 文件：https://open-api.docs.shoplineapp.com
- Base URL：`https://open.shopline.io`
- 認證：`Authorization: Bearer <SHOPLINE_API_TOKEN>`

您需要從 Shopline 商家帳號取得有效的 Open API access token。

## 快速開始

### 安裝

```bash
npm install shopline-mcp
```

或直接執行：

```bash
npx shopline-mcp
```

啟動前先設定 API token：

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

若要配置多個商店，可設定 alias：

```bash
export SHOPLINE_STORES_JSON='{"tw":{"token":"tw_token"},"hk":{"token":"hk_token"}}'
```

之後在任一 Shopline 業務工具中傳入 `store_alias` 即可指定店鋪。

### 搭配 Claude Code 使用

```bash
claude mcp add --transport stdio shopline -e SHOPLINE_API_TOKEN=your_token_here -- npx shopline-mcp
```

### 搭配 Claude Desktop 使用

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

## 重要：寫入工具

此 server 包含會建立、更新或刪除 Shopline 商店資料的工具。實際可用操作取決於您的 token 權限。

- 請使用最小必要權限的 token
- 寫入工具都以 `[WRITE]` 標示
- 寫入工具描述包含 `【副作用】` 說明
- 寫入工具可傳入 `dry_run: true`，只預覽 API method、path、參數與 body，不修改商店資料
- dry-run 預覽會回傳 `approval_code`，供 Human in the loop 人工審閱
- 設定 `SHOPLINE_REQUIRE_WRITE_APPROVAL=1` 後，寫入工具必須帶入相符的 `approval_code` 才能執行

## 工具清單（153 個）

此 server 提供 143 個 Shopline API 業務工具，以及 10 個輔助工具。

### 讀取工具（75 個）

| 領域 | 覆蓋內容 |
|------|----------|
| 訂單 | 訂單查詢、銷售摘要、暢銷商品、趨勢、通路比較、訂單詳情、退款、封存訂單、標籤、日誌、交易 |
| 商品與庫存 | 商品列表、變體、庫存總覽、低庫存警示、倉庫、倉庫庫存、鎖定庫存、採購單 |
| 分析 | RFM、回購、客戶地區、庫存周轉、分類銷售、促銷分析、門市退貨、調撥建議、促銷 ROI、生命週期、滯銷商品 |
| 客戶 | 客戶列表、客戶完整資料、客戶群組、群組成員、購物金、會員等級、等級歷史、點數規則、自訂欄位 |
| 分類與促銷 | 分類樹、分類詳情、促銷、限時特賣、聯盟活動、贈品、加購品、商品訂閱 |
| 訂單延伸 | 退貨單、訂單物流、客服對話、對話訊息、商品評價 |
| 商店設定 | 商家、付款方式、物流選項、通路、App 設定、稅務、員工權限、Token 資訊、客服人員 |

### 寫入工具（68 個）

| 領域 | 覆蓋內容 |
|------|----------|
| 訂單操作 | 取消、出貨、批次出貨、拆單、更新、狀態更新、標籤、建立訂單 |
| 客戶操作 | 建立、更新、刪除、標籤、購物金、會員點數 |
| 商品操作 | 建立、更新、刪除、變體、庫存、價格、標籤、圖片、批次更新、分類指派 |
| 促銷活動 | 促銷、優惠券、限時特賣、聯盟活動 |
| 分類 | 建立、更新、刪除分類 |
| 退貨單 | 建立與更新退貨單 |
| 客服對話 | 發送訂單訊息與商店訊息 |
| 評價 | 建立、批次建立、更新、批次更新、刪除、批次刪除 |
| 贈品與加購 | 建立、更新與庫存數量操作 |
| 採購單 | 建立與刪除採購單 |
| 媒體與自訂欄位 | 上傳媒體與建立 metafield |
| 物流與商家 | 更新訂單物流、自取門市與商家設定 |

### 輔助工具（10 個）

| 工具 | 用途 |
|------|------|
| `describe_shopline_mcp_capabilities` | 摘要目前覆蓋範圍、領域與安全功能 |
| `find_shopline_tools` | 依任務、關鍵字、領域或讀寫模式搜尋工具 |
| `explain_shopline_tool` | 解釋單一工具的參數、端點與安全注意事項 |
| `recommend_shopline_workflow` | 依商家任務推薦工具順序，例如銷售報告或庫存風險 |
| `preview_shopline_write_tool` | 不呼叫 Shopline，先預覽寫入工具 |
| `list_shopline_store_profiles` | 列出已配置的 store alias，不顯示 token |
| `prepare_shopline_write_approval` | 產生人工審閱用的寫入預覽與 approval code |
| `audit_shopline_product_content` | 找出缺少內容、圖片、分類、標籤或品牌欄位的商品 |
| `audit_shopline_seo_readiness` | 找出缺少 SEO/GEO 欄位的商品並回傳審閱草稿 |
| `forecast_shopline_reorder_candidates` | 依銷量、庫存與鎖定庫存估算可能需要補貨的 SKU |

## API 端點覆蓋範圍

目前套件覆蓋：

- 共 153 個工具
- 143 個 Shopline API 業務工具
- 75 個讀取工具
- 68 個寫入工具
- 135 個 endpoint key
- 137 個 method/path endpoint

實際 endpoint 是否可用仍取決於 Shopline token 權限。

## API 限制

- 分頁使用 `page` + `per_page`，`per_page` 上限 50
- 大量訂單查詢會在工具內部分頁
- 訂單搜尋不支援 `sort_by`
- 線上有效營收訂單狀態為 `confirmed`，POS 為 `completed`
- 通路來源：`created_from = "shop"` 表示線上，`"pos"` 表示 POS
- 金額從 Shopline money object 的 `dollars` 欄位轉成數字
- 大型商店的查詢可能需要依日期區間分段

## 使用範例

### 「這個月的銷售狀況如何？」

```text
get_sales_summary(
  start_date = "2026-04-01",
  end_date = "2026-04-30",
  channel = "all"
)
```

### 「哪些商品賣最好？」

```text
get_top_products(
  start_date = "2026-03-01",
  end_date = "2026-03-31",
  top_n = 5,
  sort_by = "revenue"
)
```

### 「查詢客戶資訊」

```text
list_customers(search_keyword = "Alice")
get_customer_profile(customer_id = "customer_id_from_search")
```

### 「哪些商品快缺貨了？」

```text
get_low_stock_alerts(threshold = 5)
```

### 「建立新客戶」（寫入工具）

```text
create_customer(
  name = "Alice",
  email = "alice@example.com"
)
```

### 「先預覽寫入，不直接修改商店」

```text
create_customer(
  name = "Alice",
  email = "alice@example.com",
  dry_run = true
)
```

### 「寫入前要求人工審核」

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

### 「我該用哪個工具？」

```text
find_shopline_tools(query = "low stock", mode = "read")
recommend_shopline_workflow(task = "Prepare a weekly sales report")
```

### 「找出需要審閱的內容、SEO 或補貨工作」

```text
audit_shopline_product_content(max_products = 50)
audit_shopline_seo_readiness(max_products = 50)
forecast_shopline_reorder_candidates(
  start_date = "2026-03-01",
  end_date = "2026-03-31",
  horizon_days = 14
)
```

## 授權

MIT
