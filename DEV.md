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
│   │   ├── register.ts       # 工具注册
│   │   ├── custom.ts         # Python parity business handlers
│   │   └── generic.ts        # 通用 endpoint executor
│   └── generated/
│       ├── endpoints.ts      # endpoint map
│       └── toolSpecs.ts      # 静态工具 metadata
├── tests/                    # Vitest、parity、request、smoke tests
├── reference/                # Shopline endpoint inventory
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

## API 约束

- Base URL：`https://open.shopline.io`
- Token env var：`SHOPLINE_API_TOKEN`
- 分页使用 `page` + `per_page`，`per_page` 上限 50。
- Search limit 为 10,000 results，大日期区间需要分段查询。
- Orders search 不支持 `sort_by`。
- 线上有效营收订单状态为 `confirmed`，POS 为 `completed`。
- 通路来源：`created_from = "shop"` 表示线上，`"pos"` 表示 POS。
- 金额从 Shopline money object 的 `dollars` 字段转成数字。

## 已知测试缺口

本地测试会验证 metadata parity、请求 body、mocked read outputs、endpoint coverage、client behavior 与 stdio `tools/list`。

完整 live 验证仍取决于测试店铺资料与 token scope。有些工具需要特定资料，比如限时特卖活动、联盟活动使用记录、商品订阅、已完成退货单、配送时段、客服对话、通路权限与商品评价。

全部 68 个写入工具都避免默认 live 执行。只有在使用专用测试店铺且明确设置 `SHOPLINE_TEST_WRITES=1` 时才应执行 live 写入检查。

## 开发计划

- [x] TypeScript/Node.js 套件，npm 名称为 `shopline-mcp`
- [x] 保留 Python 版 143 个工具基线
- [x] 保留读写工具数量与 endpoint 覆盖
- [x] 加入 Python parity 测试，覆盖 metadata、request body 与 read output shape
- [ ] 支持多商店
- [ ] 新增 webhook 即时订单通知
