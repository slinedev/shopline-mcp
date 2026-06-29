# 开发文档

这份文档给维护者和贡献者使用。面向使用者的项目介绍、安装方式和调用示例放在 `README.md` 与 `README.zh-TW.md`。

## 项目结构

```text
shopline-mcp/
├── src/
│   ├── index.ts              # stdio 入口
│   ├── server.ts             # MCP server 创建
│   ├── client.ts             # Shopline HTTP client
│   ├── schemas.ts            # zod input schema builder
│   ├── tools/
│   │   ├── assistant.ts      # 能力索引、工具搜索、工作流建议、写入审批、内容/SEO/补货分析
│   │   ├── register.ts       # 工具注册
│   │   ├── custom.ts         # Python parity business handlers
│   │   ├── generic.ts        # 通用 endpoint executor
│   │   └── operationPlan.ts  # 请求/预览/approval_code 共用的 endpoint/body 推导
│   └── generated/
│       ├── endpoints.ts      # endpoint map
│       └── toolSpecs.ts      # 静态工具 metadata
├── tests/                    # Vitest、parity、request、smoke tests
├── README.md
├── README.zh-TW.md
└── DEV.md
```

## 开发环境

```bash
npm install
npm run build
```

本地运行 server：

```bash
export SHOPLINE_API_TOKEN=your_token_here
node dist/index.js
```

安装后的命令为：

```bash
shopline-mcp
```

多商店运行时可通过 JSON 配置别名：

```bash
export SHOPLINE_STORES_JSON='{"tw":{"token":"tw_token"},"hk":{"token":"hk_token","base_url":"https://open.shopline.io"}}'
```

所有 Shopline 业务工具都会接受可选 `store_alias`。如果没有传 `store_alias`，仍使用原来的 `SHOPLINE_API_TOKEN`。

如需强制 Human in the loop 写入审阅，可启用：

```bash
export SHOPLINE_REQUIRE_WRITE_APPROVAL=1
```

启用后，真实写入必须先通过 `dry_run: true` 或 `prepare_shopline_write_approval` 取得人工审阅用的 `approval_code`，再用相同写入参数带回该 code 执行。

## 测试

```bash
npm run typecheck
npm run build
npm test
npm run test:smoke
npm run verify
npm pack --dry-run
```

本地测试不需要 `SHOPLINE_API_TOKEN`。Live 读取检查需要 `SHOPLINE_API_TOKEN`。Live 写入检查必须保留 `SHOPLINE_TEST_WRITES=1` 开关，并且只应在专用测试店铺中执行。

## Python parity

当前 TypeScript 版本从 `mcp-shopline-python/` 重构而来，Python 项目是功能和接口对齐的基线。

- 保留 143 个工具。
- 保留 75 个读取工具和 68 个写入工具的拆分。
- 保留工具名、参数、说明、读写标记和 endpoint 映射。
- 10 个 assistant tools 不属于 Python parity 基线，因此 `SHOPLINE_TOOL_SPECS` 仍只统计 143 个业务工具。
- v1.4 新增工具是追加层，放在 `src/v14/`；实际注册使用 `ALL_SHOPLINE_TOOL_SPECS`，不要把 v1.4 工具混入 Python parity fixture。
- `tests/fixtures/python-tool-baseline.json` 是从 Python 项目生成的基线 fixture，用于本地测试，不会进入 npm 包。
- `npm pack --dry-run --json` 应确认发布包只包含 `dist/`、README、license 和 `package.json` 等发布文件。

## 新增或更新工具

1. 保持既有工具名称稳定，不要添加 `shopline_` 前缀。
2. 工具描述维持繁体中文，因为这些说明会展示给 AI client。
3. 写入工具需以 `[WRITE]` 开头，并包含 `【副作用】`。
4. 若工具会整理数据或组合多个 endpoint，请在 `src/tools/custom.ts` 补 Python parity 逻辑。
5. 只有单纯 endpoint wrapper 才使用 `src/tools/generic.ts`。
6. 行为变更前先补或更新测试。
7. 写入工具应尽量返回 `success`、`resource_id` 和 `message`。
8. 读取工具应在 MCP annotations 中标记为 read-only；写入工具应标记为 non-read-only 和 destructive。
9. 运行时参数 `store_alias`、`dry_run`、`confirm_write`、`approval_code` 不属于 Shopline API 参数，不能透传到 query 或 body。
10. 新增 assistant tools 时放在 `src/tools/assistant.ts`，不要混入 Python parity 业务工具清单。
11. v1.4 以后新增的单纯 endpoint wrapper 放在 `src/v14/toolSpecs.ts` 与 `src/v14/endpoints.ts`，并补 `tests/v14-tools.test.ts`。
12. Human in the loop 工具只负责生成审阅清单、草稿和写入预览；不要在审查工具中直接执行写入。

## API 约束

- Base URL：`https://open.shopline.io`
- Token env var：`SHOPLINE_API_TOKEN`
- Multi-store env var：`SHOPLINE_STORES_JSON`
- Optional write approval env var：`SHOPLINE_REQUIRE_WRITE_APPROVAL`
- 分页使用 `page` + `per_page`，`per_page` 上限 50。
- Search limit 为 10,000 results，大日期区间需要分段查询。
- Orders search 不支持 `sort_by`。
- 线上有效营收订单状态为 `confirmed`，POS 为 `completed`。
- 通路来源：`created_from = "shop"` 表示线上，`"pos"` 表示 POS。
- 金额从 Shopline money object 的 `dollars` 字段转成数字。

## 已知测试缺口

本地测试会验证 metadata parity、请求 body、mocked read outputs、endpoint coverage、assistant tools、multi-store runtime、client behavior 与 stdio `tools/list`。

写入审批测试需覆盖：dry-run 不呼叫 Shopline、`approval_code` 对相同写入参数稳定、启用 `SHOPLINE_REQUIRE_WRITE_APPROVAL=1` 后缺少或不匹配 code 会被拦截、默认未启用时保持旧写入行为。

完整 live 验证仍取决于测试店铺资料与 token scope。有些工具需要特定资料，比如限时特卖活动、联盟活动使用记录、商品订阅、已完成退货单、配送时段、客服对话、通路权限与商品评价。

全部写入工具都避免默认 live 执行。只有在使用专用测试店铺且明确设置 `SHOPLINE_TEST_WRITES=1` 时才应执行 live 写入检查。

## 开发计划

- [x] TypeScript/Node.js 套件，npm 名称为 `shopline-mcp`
- [x] 保留 Python 版 143 个工具基线
- [x] 保留读写工具数量与 endpoint 覆盖
- [x] 加入 Python parity 测试，覆盖 metadata、request body 与 read output shape
- [x] 支持多商店 `store_alias` 运行时选择
- [x] 新增能力索引、工具搜索、工具解释、工作流推荐与写入 dry-run 预览
- [x] 新增 Human in the loop 写入 approval_code 机制
- [x] 新增商品内容、SEO/GEO 与补货候选辅助工具
- [x] 新增 v1.4 商家运营核心覆盖：Webhooks、扩展 Settings、Live Sales、User Coupons、Wish Lists、Staff、Return/Purchase 补全与选定 Metafields
- [ ] 新增 webhook 事件接收服务

当前 server 仍是 stdio transport，不直接接收 HTTP webhook。实时事件需要另建 HTTP/Webhook adapter，再把事件转成 MCP 可查询或可推送的上下文。
