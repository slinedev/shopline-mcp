# Shopline MCP Server

Shopline Open API 的 MCP server，npm 套件名稱為 `@shopline/mcp`。

此 server 提供 143 個可供 AI Agent 呼叫的 Shopline 工具：

- 75 個讀取工具：訂單、商品、庫存、客戶、促銷、分析、評論、對話、商店設定
- 68 個寫入工具：建立、更新、刪除 Shopline 資源
- 使用 stdio transport，可接 Claude Code、Claude Desktop、Codex 與其他 MCP client

## 環境需求

- Node.js 24 或更新版本
- Shopline Open API access token

執行前先設定 token：

```bash
export SHOPLINE_API_TOKEN=your_token_here
```

## 安裝

```bash
npm install @shopline/mcp
```

或直接執行：

```bash
npx @shopline/mcp
```

安裝後的命令為：

```bash
shopline-mcp
```

## Claude Code

```bash
claude mcp add --transport stdio shopline -e SHOPLINE_API_TOKEN=your_token_here -- npx @shopline/mcp
```

## Claude Desktop

```json
{
  "mcpServers": {
    "shopline": {
      "command": "npx",
      "args": ["@shopline/mcp"],
      "env": {
        "SHOPLINE_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

## 寫入工具

此 server 包含會建立、更新或刪除 Shopline 資料的寫入工具。

寫入工具的描述都以 `[WRITE]` 開頭，並包含副作用說明。請使用權限最小化的 API token。

## API 注意事項

- Base URL：`https://open.shopline.io`
- 認證：`Authorization: Bearer <SHOPLINE_API_TOKEN>`
- 分頁：`page` + `per_page`，`per_page` 上限 50
- 大量訂單查詢會在工具內部分頁處理
- 線上有效營收訂單狀態為 `confirmed`，POS 有效營收訂單狀態為 `completed`
- 通路來源：`created_from = "shop"` 表示線上，`"pos"` 表示 POS
- 金額以 TWD 數字回傳，來源是 Shopline money object 的 `dollars`

## 套件名稱

npm registry 安裝請使用 `@shopline/mcp`。

沒有 `@` 的 `shopline/mcp` 不是 npm 套件名稱，npm 會把它當成 GitHub repository shorthand。
