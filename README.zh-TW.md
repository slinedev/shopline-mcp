# Shopline MCP Server

[English](README.md)

Shopline Open API 的 MCP server，npm 套件名稱為 `shopline-mcp`。

此套件將 Shopline Open API 封裝成 143 個 AI 可呼叫工具（75 個讀取 + 68 個寫入），可用於電商資料分析與商店操作。Server 使用 stdio transport，可接 Claude Code、Claude Desktop、Codex 與其他 MCP client。

本專案參考自採用 MIT 授權的 Python 專案 [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)，並重構為 TypeScript/Node.js 版本。

## 連結

- 倉庫地址：[slinedev/shopline-mcp](https://github.com/slinedev/shopline-mcp)
- 參考 Python 專案（MIT）：[asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)
- 官方網站：[https://sline.dev/shopline-mcp/](https://sline.dev/shopline-mcp/)

## 功能特色

- **143 個即用工具**：涵蓋訂單、商品、庫存、客戶、促銷、分類、訂閱、客服對話、評價與商店設定
- **75 個讀取工具**：查詢與分析 Shopline 資料
- **68 個寫入工具**：建立、更新、刪除 Shopline 資源
- **MCP stdio server**：可接本機 AI client
- **內建 API 處理**：認證、分頁、重試、日期區間與 DELETE JSON body
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

## 工具清單（143 個）

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

## API 端點覆蓋範圍

目前套件覆蓋：

- 共 143 個工具
- 75 個讀取工具
- 68 個寫入工具
- 135 個 endpoint key
- 135 個 method/path endpoint

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

## 授權

MIT
