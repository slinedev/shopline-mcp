import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const english = readFileSync("README.md", "utf8");
const traditionalChinese = readFileSync("README.zh-TW.md", "utf8");
const dev = readFileSync("DEV.md", "utf8");

const englishSections = [
  "What This Does",
  "API Reference",
  "Quick Start",
  "Important: Write Tools",
  "Tools (279 total)",
  "API Endpoint Coverage",
  "API Constraints",
  "Usage Examples",
  "License",
];

const zhSections = [
  "功能特色",
  "API 參考文件",
  "快速開始",
  "重要：寫入工具",
  "工具清單（279 個）",
  "API 端點覆蓋範圍",
  "API 限制",
  "使用範例",
  "授權",
];

const devSections = ["项目结构", "开发环境", "测试", "Python parity", "新增或更新工具", "API 约束", "已知测试缺口", "开发计划"];

describe("README Python parity", () => {
  it("keeps the English README focused on user-facing setup and usage", () => {
    for (const section of englishSections) {
      expect(english).toContain(`## ${section}`);
    }

    expect(english).toContain("npm install shopline-mcp");
    expect(english).toContain("npx shopline-mcp");
    expect(english).toContain("10 assistant tools");
    expect(english).toContain("dry_run: true");
    expect(english).toContain("approval_code");
    expect(english).toContain("SHOPLINE_REQUIRE_WRITE_APPROVAL=1");
    expect(english).toContain("Human in the loop");
    expect(english).toContain("third-party open-source package");
    expect(english).toContain("SHOPLINE_STORES_JSON");
    expect(english).toContain("npx shopline-mcp doctor");
    expect(english).toContain("~/.codex/config.toml");
    expect(english).toContain("[mcp_servers.shopline]");
    expect(english).toContain("opencode.json");
    expect(english).toContain('"mcp"');
    expect(english).toContain(".vscode/mcp.json");
    expect(english).toContain('"servers"');
    expect(english).toContain("${input:shopline-api-token}");
    expect(english).toContain(
      "rebuilt with reference to the MIT-licensed Python project [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)",
    );
    expect(english).toContain("Reference Python project (MIT): [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)");
    expect(english).toContain("263 documented method/path endpoints");
    expect(english).not.toContain("## Project Structure");
    expect(english).not.toContain("## Development");
    expect(english).not.toContain("## Known Test Gaps");
    expect(english).not.toContain("## Roadmap");
    expect(english).not.toContain("npm run verify");
    expect(english).not.toContain("npm pack --dry-run");
    expect(english).not.toContain("pip install mcp-shopline");
    expect(english).not.toContain("uvx --from mcp-shopline");
    expect(english).not.toContain("npx shopline-mcp init");
    expect(english).not.toContain("initialization wizard");
  });

  it("keeps the Traditional Chinese README focused on user-facing setup and usage", () => {
    for (const section of zhSections) {
      expect(traditionalChinese).toContain(`## ${section}`);
    }

    expect(traditionalChinese).toContain("npm install shopline-mcp");
    expect(traditionalChinese).toContain("npx shopline-mcp");
    expect(traditionalChinese).toContain("10 個輔助工具");
    expect(traditionalChinese).toContain("dry_run: true");
    expect(traditionalChinese).toContain("approval_code");
    expect(traditionalChinese).toContain("SHOPLINE_REQUIRE_WRITE_APPROVAL=1");
    expect(traditionalChinese).toContain("Human in the loop");
    expect(traditionalChinese).toContain("第三方開源套件");
    expect(traditionalChinese).toContain("SHOPLINE_STORES_JSON");
    expect(traditionalChinese).toContain("npx shopline-mcp doctor");
    expect(traditionalChinese).toContain("~/.codex/config.toml");
    expect(traditionalChinese).toContain("[mcp_servers.shopline]");
    expect(traditionalChinese).toContain("opencode.json");
    expect(traditionalChinese).toContain('"mcp"');
    expect(traditionalChinese).toContain(".vscode/mcp.json");
    expect(traditionalChinese).toContain('"servers"');
    expect(traditionalChinese).toContain("${input:shopline-api-token}");
    expect(traditionalChinese).toContain("參考自採用 MIT 授權的 Python 專案 [asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)");
    expect(traditionalChinese).toContain("參考 Python 專案（MIT）：[asgard-ai-platform/mcp-shopline](https://github.com/asgard-ai-platform/mcp-shopline)");
    expect(traditionalChinese).toContain("263 個 method/path endpoint");
    expect(traditionalChinese).not.toContain("## 專案結構");
    expect(traditionalChinese).not.toContain("## 開發");
    expect(traditionalChinese).not.toContain("## 已知測試缺口");
    expect(traditionalChinese).not.toContain("## 開發計畫");
    expect(traditionalChinese).not.toContain("npm run verify");
    expect(traditionalChinese).not.toContain("npm pack --dry-run");
    expect(traditionalChinese).not.toContain("pip install mcp-shopline");
    expect(traditionalChinese).not.toContain("uvx --from mcp-shopline");
    expect(traditionalChinese).not.toContain("npx shopline-mcp init");
    expect(traditionalChinese).not.toContain("初始化嚮導");
  });

  it("moves development content into the Simplified Chinese DEV.md", () => {
    for (const section of devSections) {
      expect(dev).toContain(`## ${section}`);
    }

    expect(dev).toContain("npm run verify");
    expect(dev).toContain("npm pack --dry-run");
    expect(dev).toContain("SHOPLINE_TEST_WRITES=1");
    expect(dev).toContain("SHOPLINE_STORES_JSON");
    expect(dev).toContain("SHOPLINE_REQUIRE_WRITE_APPROVAL");
    expect(dev).toContain("approval_code");
    expect(dev).toContain("Human in the loop");
    expect(dev).toContain("store_alias");
    expect(dev).toContain("assistant tools");
    expect(dev).toContain("tests/fixtures/python-tool-baseline.json");
    expect(dev).not.toContain("## 專案結構");
    expect(dev).not.toContain("## 開發計畫");
  });
});
