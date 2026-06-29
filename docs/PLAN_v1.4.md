# v1.4 Shopline MCP 开发计划

**Summary**

已只读评审 [docs/v1.4-PRD.md](/Users/max/Documents/UGit/shopline-mcp/docs/v1.4-PRD.md)、当前仓库和官方文档索引：[llms.txt](https://open-api.docs.shoplineapp.com/llms.txt)。当前基线健康：`npm test` 112 个测试通过，`npm run typecheck` 通过。

PRD 需要先修正再实施：官方 reference 当前约 315 个 method/path，本仓库当前覆盖 137 个，PRD 的“约 45 个缺口、v1.4 达到全站 95% 覆盖”不真实。v1.4 按你选择的“修正后 P0/P1”收敛为商家运营核心覆盖，不纳入全量 Cart、Storefront/OAuth、全部 Cart item metafields。

**Key Changes**

- 先更新 PRD：修正工具统计为 143 个业务工具 + 10 个助手工具；修正已过期日期，2026-05-27 和 2026-06-03 已经过去，相关 breaking change 作为立即兼容项处理。
- 保留现有 Python parity 基线不动：新增 `src/v14/endpoints.ts`、`src/v14/toolSpecs.ts`，再用一个组合出口让 [src/tools/register.ts](/Users/max/Documents/UGit/shopline-mcp/src/tools/register.ts) 和 assistant 工具读取“143 个旧工具 + v1.4 新工具”。
- 新增核心工具组：
  - Webhooks：5 个 CRUD 工具，带 HTTPS、重复订阅、重试和白名单提示。
  - Settings：补齐官方 settings 读写端点，路径以 reference 为准，例如 `product_review`、`third_party_ads`、`theme/draft`、`layouts/draft`。
  - Live/Sales：7 个工具；删除直播商品使用官方 `POST /v1/sales/{sale_id}/delete_products`，不是 PRD 里的 DELETE。
  - User Coupons、Wish Lists、Staff：按官方 `user_coupons`、`wish_list_items`、`staffs` 路径补齐。
  - Return/Purchase：新增验货、退货物流状态、采购单更新、子采购单、官方 bulk delete；保留旧 `delete_purchase_orders` 兼容行为。
  - Metafields：只覆盖 merchant/product/order/customer/order_item 的 app 与 merchant metafields，以及 product metafield definition；排除 Cart item metafields。
- 所有新增写工具继续遵守 `[WRITE]`、`【副作用】`、`dry_run`、审批码和 destructive annotation 规则。
- README、DEV、smoke 计数和 assistant capability 输出同步更新，但工具描述继续使用繁体中文。

**Test Plan**

- 调整 Python parity 测试：旧 143 个工具必须逐项保持不变，新 v1.4 工具作为追加集合测试。
- 新增覆盖测试：验证选定 v1.4 官方端点全部有工具，明确不把全站 315 个端点当本次验收目标。
- 扩展 write parity：覆盖新写工具的真实 method、URL、body，尤其是 sales delete、purchase bulk delete、settings publish、webhook create/update。
- 扩展 dry-run 测试：确认新增写工具不会在 `dry_run: true` 时发请求，并返回正确预览。
- 最终验证命令：`npm run verify`、`npm pack --dry-run --json`；有 token 时只跑 live read smoke，live write 仍必须 gated by `SHOPLINE_TEST_WRITES=1`。

**Assumptions**

- 本轮不追求官方全站 315 endpoint 覆盖。
- 不新增依赖，不改 stdio transport，不做 HTTP webhook 接收服务。
- 不删除或重命名现有工具，避免破坏已有 MCP 客户端调用。
- 当前工作区已有 `.gitignore` 修改和未跟踪 `docs/`，实施前需要保留这些已有改动。
