import type { ApiOperation, DocEndpoint, ParamSpec, ToolSpec } from "../types.js";

type Method = DocEndpoint["method"];
type ParamInput = Omit<ParamSpec, "default" | "hasDefault" | "optional"> & {
  readonly default?: unknown;
  readonly optional?: boolean;
};

let sourceLine = 1;

const maxResults = param("max_results", "最多回傳筆數", "integer", { default: 50 });
const webhookId = param("webhook_id", "Webhook ID", "string");
const saleId = param("sale_id", "直播銷售活動 ID", "string");
const saleProductId = param("sale_product_id", "直播商品 ID", "string");
const couponCode = param("coupon_code", "User coupon code", "string");
const staffId = param("staff_id", "員工 ID", "string");
const returnOrderId = param("return_order_id", "退貨單 ID", "string");
const purchaseOrderId = param("purchase_order_id", "採購單 ID", "string");
const productId = param("product_id", "商品 ID", "string");
const orderId = param("order_id", "訂單 ID", "string");
const customerId = param("customer_id", "顧客 ID", "string");
const metafieldId = param("metafield_id", "Metafield ID", "string");
const metafieldDefinitionId = param("metafield_definition_id", "Metafield definition ID", "string");

function param(name: string, description: string, kind: ParamSpec["kind"], options: { default?: unknown; optional?: boolean; enum?: readonly string[] } = {}): ParamSpec {
  return {
    name,
    description,
    default: options.default ?? null,
    hasDefault: Object.prototype.hasOwnProperty.call(options, "default"),
    kind,
    optional: options.optional ?? false,
    enum: options.enum,
  };
}

function dataParam(name: string, description: string): ParamSpec {
  return param(name, description, "object");
}

function optionalDataParam(name: string, description: string): ParamSpec {
  return param(name, description, "object", { optional: true });
}

function arrayParam(name: string, description: string): ParamSpec {
  return param(name, description, "array");
}

function queryParam(name: string, description: string, kind: ParamSpec["kind"] = "string"): ParamSpec {
  return param(name, description, kind, { optional: true });
}

function cleanParams(params: readonly (ParamSpec | undefined)[]): readonly ParamSpec[] {
  return params.filter((item): item is ParamSpec => Boolean(item));
}

function op(kind: string, method: Method, endpointKey: string, options: Pick<ApiOperation, "json_body" | "params" | "path_params"> = {}): ApiOperation {
  return { kind, method, endpointKey, ...options };
}

function tool(input: {
  readonly name: string;
  readonly module: string;
  readonly write: boolean;
  readonly description: string;
  readonly params?: readonly ParamSpec[];
  readonly endpoints: readonly DocEndpoint[];
  readonly operations: readonly ApiOperation[];
}): ToolSpec {
  const line = sourceLine;
  sourceLine += 8;
  return {
    module: input.module,
    name: input.name,
    write: input.write,
    description: input.description,
    params: input.params ?? [],
    docEndpoints: input.endpoints,
    operations: input.operations,
    sourceLocation: { line, endLine: line + 6 },
  };
}

function readDescription(title: string, purpose: string, apiLines: readonly string[]): string {
  return `${title}\n\n【用途】\n${purpose}\n\n【呼叫的 Shopline API】\n${apiLines.map((line) => `- ${line}`).join("\n")}\n\n【回傳結構】\n回傳 Shopline API 原始資料，供 AI client 依實際商店設定判讀。`;
}

function writeDescription(title: string, purpose: string, apiLines: readonly string[], sideEffects: readonly string[]): string {
  return `[WRITE] ${title}\n\n【用途】\n${purpose}\n\n【呼叫的 Shopline API】\n${apiLines.map((line) => `- ${line}`).join("\n")}\n\n【回傳結構】\ndict 含 success, resource_id, message, result。\n\n【副作用】\n${sideEffects.map((line) => `- ${line}`).join("\n")}`;
}

function readTool(name: string, endpointKey: string, methodPath: string, title: string, purpose: string, params: readonly ParamSpec[] = [], fetchAll = false): ToolSpec {
  return tool({
    name,
    module: "tools/v14_tools.py",
    write: false,
    description: readDescription(title, purpose, [methodPath]),
    params,
    endpoints: [{ method: "GET", path: methodPath.replace(/^GET /, "") }],
    operations: [op(fetchAll ? "fetch_all_pages" : "api_get", "GET", endpointKey)],
  });
}

function writeTool(
  name: string,
  endpointKey: string,
  method: Exclude<Method, "GET">,
  path: string,
  title: string,
  purpose: string,
  params: readonly ParamSpec[],
  bodyExpression: string | undefined,
  sideEffects: readonly string[],
): ToolSpec {
  return tool({
    name,
    module: "tools/v14_tools.py",
    write: true,
    description: writeDescription(title, purpose, [`${method} ${path}`], sideEffects),
    params,
    endpoints: [{ method, path }],
    operations: [op("api_write", method, endpointKey, { json_body: bodyExpression })],
  });
}

function metafieldTools(input: {
  readonly resource: string;
  readonly title: string;
  readonly baseEndpoint: string;
  readonly detailEndpoint?: string;
  readonly bulkEndpoint: string;
  readonly basePath: string;
  readonly detailPath?: string;
  readonly bulkPath: string;
  readonly idParam?: ParamSpec;
}): ToolSpec[] {
  const idParams = input.idParam ? [input.idParam] : [];
  const resourceTitle = input.title;
  const detailPath = input.detailPath ?? `${input.basePath}/{metafield_id}`;
  const detailEndpoint = input.detailEndpoint ?? `${input.baseEndpoint}_detail`;
  return [
    readTool(`list_${input.resource}_metafields`, input.baseEndpoint, `GET ${input.basePath}`, `取得 ${resourceTitle} metafields`, `查詢 ${resourceTitle} 已建立的 metafield 資料。`, [...idParams, maxResults], true),
    readTool(`get_${input.resource}_metafield`, detailEndpoint, `GET ${detailPath}`, `取得單一 ${resourceTitle} metafield`, `用 metafield ID 查詢 ${resourceTitle} 的單一 metafield。`, [...idParams, metafieldId]),
    writeTool(`create_${input.resource}_metafield`, input.baseEndpoint, "POST", input.basePath, `建立 ${resourceTitle} metafield`, `為 ${resourceTitle} 建立一筆 metafield。`, [...idParams, dataParam("metafield_data", "Metafield 建立資料")], "metafield_data", [`會新增 ${resourceTitle} metafield 資料`, "相同 namespace/key 是否允許重複取決於 Shopline API"] ),
    writeTool(`bulk_create_${input.resource}_metafields`, input.bulkEndpoint, "POST", input.bulkPath, `批次建立 ${resourceTitle} metafields`, `為 ${resourceTitle} 批次建立 metafields。`, [...idParams, dataParam("metafields_data", "Metafields 批次建立資料")], "metafields_data", [`會新增多筆 ${resourceTitle} metafield 資料`, "批次資料錯誤可能造成整批失敗"] ),
    writeTool(`update_${input.resource}_metafield`, detailEndpoint, "PUT", detailPath, `更新 ${resourceTitle} metafield`, `更新 ${resourceTitle} 的單一 metafield。`, [...idParams, metafieldId, dataParam("metafield_data", "Metafield 更新資料")], "metafield_data", [`會修改既有 ${resourceTitle} metafield`, "修改會立即影響讀取該 metafield 的應用"] ),
    writeTool(`bulk_update_${input.resource}_metafields`, input.bulkEndpoint, "PUT", input.bulkPath, `批次更新 ${resourceTitle} metafields`, `批次更新 ${resourceTitle} metafields。`, [...idParams, dataParam("metafields_data", "Metafields 批次更新資料")], "metafields_data", [`會修改多筆 ${resourceTitle} metafield`, "批次更新不可由 MCP 自動回復"] ),
    writeTool(`delete_${input.resource}_metafield`, detailEndpoint, "DELETE", detailPath, `刪除 ${resourceTitle} metafield`, `刪除 ${resourceTitle} 的單一 metafield。`, [...idParams, metafieldId], undefined, [`會刪除 ${resourceTitle} metafield`, "刪除後依 Shopline API 行為可能不可復原"] ),
    writeTool(`bulk_delete_${input.resource}_metafields`, input.bulkEndpoint, "DELETE", input.bulkPath, `批次刪除 ${resourceTitle} metafields`, `批次刪除 ${resourceTitle} metafields。`, [...idParams, arrayParam("metafield_ids", "要刪除的 metafield ID 陣列")], "{'ids': metafield_ids}", [`會刪除多筆 ${resourceTitle} metafield`, "請先 dry_run 確認刪除清單"] ),
  ];
}

export const v14ToolSpecs: readonly ToolSpec[] = [
  readTool("list_webhooks", "webhooks", "GET /v1/webhooks", "取得 Webhook 列表", "查看目前商店已建立的 Webhook 訂閱。", [maxResults], true),
  readTool("get_webhook", "webhook_detail", "GET /v1/webhooks/{webhook_id}", "取得單一 Webhook", "查詢指定 Webhook 的 topic、URL 與狀態。", [webhookId]),
  writeTool("create_webhook", "webhooks", "POST", "/v1/webhooks", "建立 Webhook", "建立新的 Shopline Webhook 訂閱；URL 應使用 HTTPS 443，並避免同 topic + URL 重複訂閱。", [dataParam("webhook_data", "Webhook 建立資料，通常包含 topic 與 url")], "webhook_data", ["會新增 Webhook 訂閱", "接收端若未快速回 200，Shopline 可能重送最多 3 次並可能封鎖接收端", "若有防火牆白名單，需同步維護 Shopline 對外 IP"] ),
  writeTool("update_webhook", "webhook_detail", "PUT", "/v1/webhooks/{webhook_id}", "更新 Webhook", "更新既有 Webhook 的 topic、URL 或狀態；URL 應使用 HTTPS 443。", [webhookId, dataParam("webhook_data", "Webhook 更新資料")], "webhook_data", ["會修改 Webhook 訂閱", "錯誤 URL 可能導致事件無法送達", "Shopline 會限制同 topic + URL 重複訂閱"] ),
  writeTool("delete_webhook", "webhook_detail", "DELETE", "/v1/webhooks/{webhook_id}", "刪除 Webhook", "刪除指定 Webhook 訂閱。", [webhookId], undefined, ["會刪除 Webhook 訂閱", "刪除後該 topic 不會再推送至原 URL"] ),

  readTool("get_settings", "settings", "GET /v1/settings", "取得設定總覽", "取得 Shopline settings 總覽資料。"),
  readTool("get_checkout_setting", "settings_checkout", "GET /v1/settings/checkout", "取得結帳設定", "查看最低消費、結帳流程與相關結帳設定。"),
  readTool("get_orders_setting", "settings_orders", "GET /v1/settings/orders", "取得訂單設定", "查看訂單編號、訂單期限與訂單規則設定。"),
  readTool("get_users_setting", "settings_users", "GET /v1/settings/users", "取得顧客設定", "查看會員註冊、生日禮與顧客相關設定。"),
  readTool("get_tax_setting", "settings_tax", "GET /v1/settings/tax", "取得稅務設定", "查看全店稅務收費設定。"),
  readTool("get_payments_setting", "settings_payments", "GET /v1/settings/payments", "取得付款設定", "查看付款方式與付款相關設定。"),
  readTool("get_products_setting", "settings_products", "GET /v1/settings/products", "取得商品設定", "查看商品與庫存相關設定。"),
  readTool("get_promotions_setting", "settings_promotions", "GET /v1/settings/promotions", "取得優惠設定", "查看促銷與優惠相關設定。"),
  readTool("get_shop_setting", "settings_shop", "GET /v1/settings/shop", "取得網店分頁設定", "查看 online store pages 設定。"),
  readTool("get_pos_setting", "settings_pos", "GET /v1/settings/pos", "取得 POS 設定", "查看 POS 發票與收據相關設定。"),
  readTool("get_product_review_setting", "settings_product_review", "GET /v1/settings/product_review", "取得商品評價設定", "查看商品評價功能設定。"),
  readTool("get_theme_setting", "settings_theme", "GET /v1/settings/theme", "取得主題設定", "查看目前主題設定。"),
  readTool("get_theme_draft_setting", "settings_theme_draft", "GET /v1/settings/theme/draft", "取得主題草稿設定", "查看尚未發布的主題草稿設定。"),
  readTool("get_layouts_setting", "settings_layouts", "GET /v1/settings/layouts", "取得版面設定", "查看目前 layouts 設定。"),
  readTool("get_layouts_draft_setting", "settings_layouts_draft", "GET /v1/settings/layouts/draft", "取得版面草稿設定", "查看尚未發布的 layouts 草稿設定。"),
  readTool("get_domains_setting", "settings_domains", "GET /v1/settings/domains", "取得網域驗證設定", "查看 Google、Bing、Facebook、Pinterest 與 Google Merchant Center 等驗證設定。"),
  readTool("get_third_party_ads_setting", "settings_third_party_ads", "GET /v1/settings/third_party_ads", "取得第三方廣告設定", "查看第三方廣告追蹤設定。"),
  writeTool("update_domains_setting", "settings_domains", "PUT", "/v1/settings/domains", "更新網域驗證設定", "更新第三方網域工具驗證設定。", [dataParam("setting_data", "網域驗證設定資料")], "setting_data", ["會修改第三方網域驗證設定", "錯誤設定可能影響廣告、搜尋或商品中心驗證"] ),
  writeTool("save_theme_draft_setting", "settings_theme_draft", "PUT", "/v1/settings/theme/draft", "儲存主題草稿設定", "更新尚未發布的 theme draft。", [dataParam("setting_data", "主題草稿設定資料")], "setting_data", ["會修改主題草稿", "發布前請先由商家確認外觀影響"] ),
  writeTool("save_layouts_draft_setting", "settings_layouts_draft", "PUT", "/v1/settings/layouts/draft", "儲存版面草稿設定", "更新尚未發布的 layouts draft。", [dataParam("setting_data", "版面草稿設定資料")], "setting_data", ["會修改版面草稿", "發布前請先由商家確認頁面影響"] ),
  writeTool("publish_theme_setting", "settings_theme_publish", "POST", "/v1/settings/theme/publish", "發布主題設定", "發布目前 theme draft。", [optionalDataParam("setting_data", "發布設定資料，可依 Shopline API 文件留空或帶入必要欄位")], "setting_data", ["會影響實際店面外觀", "發布後消費者可能立即看到變更", "建議強制 dry_run 與人工審核"] ),
  writeTool("publish_layouts_setting", "settings_layouts_publish", "POST", "/v1/settings/layouts/publish", "發布版面設定", "發布目前 layouts draft。", [optionalDataParam("setting_data", "發布設定資料，可依 Shopline API 文件留空或帶入必要欄位")], "setting_data", ["會影響實際店面版面", "發布後消費者可能立即看到變更", "建議強制 dry_run 與人工審核"] ),

  readTool("list_sale_products", "sale_products", "GET /v1/sales/{sale_id}/products", "取得直播商品", "查詢直播活動中的商品與規格。", [saleId, maxResults], true),
  readTool("get_sale_comments", "sale_comments", "GET /v1/sales/{sale_id}/comments", "取得直播留言", "查詢直播活動留言。", [saleId, maxResults], true),
  readTool("get_sale_customers", "sale_customers", "GET /v1/sales/{sale_id}/customers", "取得直播留言顧客", "查詢直播留言關聯顧客。", [saleId, maxResults], true),
  writeTool("add_sale_products", "sale_products", "POST", "/v1/sales/{sale_id}/products", "新增直播商品", "將商品加入直播活動。", [saleId, dataParam("products_data", "直播商品新增資料")], "products_data", ["會修改直播活動商品清單", "新增後可能立即影響直播銷售流程"] ),
  writeTool("remove_sale_products", "sale_products_delete", "POST", "/v1/sales/{sale_id}/delete_products", "移除直播商品", "使用官方 delete_products 動作從直播活動移除商品。", [saleId, arrayParam("product_ids", "要移除的商品 ID 陣列")], "{'product_ids': product_ids}", ["會從直播活動移除商品", "移除後相關留言關鍵字或銷售流程可能受影響"] ),
  writeTool("update_sale_products", "sale_products", "PUT", "/v1/sales/{sale_id}/products", "更新直播商品", "更新直播商品與規格關鍵字設定。", [saleId, dataParam("products_data", "直播商品更新資料")], "products_data", ["會修改直播商品設定", "變更可能立即影響直播購買關鍵字"] ),
  writeTool("update_sale_product_status", "sale_product_status", "PUT", "/v1/sales/{sale_id}/products/{sale_product_id}/status", "更新直播商品狀態", "更新單一直播商品狀態。", [saleId, saleProductId, dataParam("status_data", "直播商品狀態資料")], "status_data", ["會修改直播商品狀態", "商品上下架狀態可能立即影響直播銷售"] ),

  readTool("list_user_coupons", "user_coupons", "GET /v1/user_coupons", "取得 User Coupons", "查詢已領取的 user coupon 列表。", [maxResults], true),
  readTool("list_user_coupons_cursor", "user_coupons_cursor", "GET /v1/user_coupons/list", "以 cursor 取得 User Coupons", "使用 cursor 查詢 user coupon 列表。", [queryParam("cursor", "Cursor token"), queryParam("limit", "單次回傳筆數", "integer")]),
  writeTool("create_user_coupon", "user_coupons", "POST", "/v1/user_coupons", "建立 User Coupon", "建立 user coupon。", [dataParam("coupon_data", "User coupon 建立資料")], "coupon_data", ["會建立 user coupon", "建立後可能可被顧客領取或使用"] ),
  writeTool("claim_user_coupon", "user_coupon_claim", "POST", "/v1/user_coupons/{coupon_code}/claim", "領取 User Coupon", "為指定 coupon code 執行領取流程。", [couponCode, optionalDataParam("coupon_data", "領取資料，可依文件帶入顧客資訊")], "coupon_data", ["會變更 coupon 領取狀態", "可能影響顧客可用優惠"] ),
  writeTool("redeem_user_coupon", "user_coupon_redeem", "POST", "/v1/user_coupons/{coupon_code}/redeem", "核銷 User Coupon", "為指定 coupon code 執行核銷流程。", [couponCode, optionalDataParam("coupon_data", "核銷資料，可依文件帶入訂單或顧客資訊")], "coupon_data", ["會核銷 user coupon", "核銷後優惠可能不可再次使用"] ),

  readTool("list_wish_list_items", "wish_list_items", "GET /v1/wish_list_items", "取得追蹤清單", "查詢顧客 wish list items。", [queryParam("customer_id", "顧客 ID"), maxResults], true),
  writeTool("create_wish_list_item", "wish_list_items", "POST", "/v1/wish_list_items", "建立追蹤清單項目", "新增顧客追蹤商品。", [dataParam("wish_list_data", "Wish list item 建立資料")], "wish_list_data", ["會新增顧客追蹤清單項目", "可能影響再行銷或顧客行為資料"] ),
  writeTool("delete_wish_list_item", "wish_list_items", "DELETE", "/v1/wish_list_items", "刪除追蹤清單項目", "刪除顧客追蹤商品。", [dataParam("wish_list_data", "Wish list item 刪除資料")], "wish_list_data", ["會刪除顧客追蹤清單項目", "刪除後追蹤資料可能不可復原"] ),

  readTool("list_staff", "staffs", "GET /v1/staffs", "取得員工列表", "查詢商店員工列表。", [maxResults], true),
  readTool("get_staff_detail", "staff_detail", "GET /v1/staffs/{staff_id}", "取得員工資料", "查詢指定員工資料。", [staffId]),

  writeTool("execute_return_order_inspection", "return_order_inspection", "POST", "/v1/return_orders/{return_order_id}/inspection", "執行退貨單驗貨", "對退貨單執行驗貨結果。", [returnOrderId, dataParam("inspection_data", "退貨驗貨資料")], "inspection_data", ["會更新退貨單驗貨狀態", "可能影響退款、入庫或後續客服流程"] ),
  writeTool("update_return_order_delivery_status", "return_order_delivery_status_v14", "PUT", "/v1/return_orders/{return_order_id}/return_order_delivery_status", "更新退貨物流狀態", "更新退貨單退貨物流狀態。", [returnOrderId, dataParam("delivery_status_data", "退貨物流狀態資料")], "delivery_status_data", ["會更新退貨物流狀態", "可能影響客服與退貨流程判斷"] ),
  writeTool("create_return_order_message", "return_order_message", "POST", "/v1/return_orders/{return_order_id}/messages", "建立退貨單備註", "為退貨單建立 note/message。", [returnOrderId, dataParam("message_data", "退貨單備註資料")], "message_data", ["會新增退貨單訊息或備註", "訊息可能被客服流程使用"] ),
  writeTool("update_purchase_order", "purchase_order_update", "PUT", "/v1/pos/purchase_orders/{purchase_order_id}", "更新採購單", "更新 POS 採購單資料。", [purchaseOrderId, dataParam("purchase_order_data", "採購單更新資料")], "purchase_order_data", ["會修改採購單", "可能影響進貨與庫存流程"] ),
  writeTool("create_child_purchase_order", "purchase_order_child", "POST", "/v1/pos/purchase_orders/{purchase_order_id}/child", "建立子採購單", "由既有採購單建立 child purchase order。", [purchaseOrderId, dataParam("purchase_order_data", "子採購單建立資料")], "purchase_order_data", ["會建立子採購單", "可能影響後續進貨與供應商流程"] ),
  writeTool("bulk_delete_purchase_orders_v14", "purchase_orders_bulk_delete", "PUT", "/v1/pos/purchase_orders/bulk_delete", "批次刪除採購單", "使用官方 bulk_delete 端點批次刪除採購單。", [arrayParam("purchase_order_ids", "要刪除的採購單 ID 陣列")], "{'ids': purchase_order_ids}", ["會批次刪除採購單", "刪除後可能不可復原，請先 dry_run"] ),

  readTool("get_product_promotions", "product_promotions", "GET /v1/products/{product_id}/promotions", "取得商品可用促銷", "查詢特定商品對特定顧客可用的促銷。", [productId, queryParam("customer_id", "顧客 ID"), queryParam("promotion_ids", "促銷 ID 清單")]),
  readTool("get_coupon_center_promotions", "coupon_center_promotions", "GET /v1/promotions/coupon-center", "取得優惠券中心活動", "查詢 coupon center promotions。", [maxResults], true),
  readTool("get_customer_coupon_promotions", "customer_coupon_promotions", "GET /v1/customers/{customer_id}/coupon_promotions", "取得顧客可領優惠", "使用 promotion_ids 查詢顧客可領或已領的優惠活動。", [customerId, queryParam("promotion_ids", "促銷 ID 清單")]),

  ...metafieldTools({ resource: "merchant_app", title: "商家 app", baseEndpoint: "merchant_app_metafields", detailEndpoint: "merchant_app_metafield_detail", bulkEndpoint: "merchant_app_metafields_bulk", basePath: "/v1/merchants/current/app_metafields", detailPath: "/v1/merchants/current/app_metafields/{metafield_id}", bulkPath: "/v1/merchants/current/app_metafields/bulk" }),
  ...metafieldTools({ resource: "merchant", title: "商家", baseEndpoint: "merchant_metafields", detailEndpoint: "merchant_metafield_detail", bulkEndpoint: "merchant_metafields_bulk", basePath: "/v1/merchants/current/metafields", detailPath: "/v1/merchants/current/metafields/{metafield_id}", bulkPath: "/v1/merchants/current/metafields/bulk" }),
  ...metafieldTools({ resource: "product_app", title: "商品 app", baseEndpoint: "product_app_metafields", detailEndpoint: "product_app_metafield_detail", bulkEndpoint: "product_app_metafields_bulk", basePath: "/v1/products/{product_id}/app_metafields", detailPath: "/v1/products/{product_id}/app_metafields/{metafield_id}", bulkPath: "/v1/products/{product_id}/app_metafields/bulk", idParam: productId }),
  ...metafieldTools({ resource: "product", title: "商品", baseEndpoint: "product_metafields", detailEndpoint: "product_metafield_detail", bulkEndpoint: "product_metafields_bulk", basePath: "/v1/products/{product_id}/metafields", detailPath: "/v1/products/{product_id}/metafields/{metafield_id}", bulkPath: "/v1/products/{product_id}/metafields/bulk", idParam: productId }),
  ...metafieldTools({ resource: "order_app", title: "訂單 app", baseEndpoint: "order_app_metafields", detailEndpoint: "order_app_metafield_detail", bulkEndpoint: "order_app_metafields_bulk", basePath: "/v1/orders/{order_id}/app_metafields", detailPath: "/v1/orders/{order_id}/app_metafields/{metafield_id}", bulkPath: "/v1/orders/{order_id}/app_metafields/bulk", idParam: orderId }),
  ...metafieldTools({ resource: "order", title: "訂單", baseEndpoint: "order_metafields", detailEndpoint: "order_metafield_detail", bulkEndpoint: "order_metafields_bulk", basePath: "/v1/orders/{order_id}/metafields", detailPath: "/v1/orders/{order_id}/metafields/{metafield_id}", bulkPath: "/v1/orders/{order_id}/metafields/bulk", idParam: orderId }),
  ...metafieldTools({ resource: "customer_app", title: "顧客 app", baseEndpoint: "customer_app_metafields", detailEndpoint: "customer_app_metafield_detail", bulkEndpoint: "customer_app_metafields_bulk", basePath: "/v1/customers/{customer_id}/app_metafields", detailPath: "/v1/customers/{customer_id}/app_metafields/{metafield_id}", bulkPath: "/v1/customers/{customer_id}/app_metafields/bulk", idParam: customerId }),
  ...metafieldTools({ resource: "customer", title: "顧客", baseEndpoint: "customer_metafields", detailEndpoint: "customer_metafield_detail", bulkEndpoint: "customer_metafields_bulk", basePath: "/v1/customers/{customer_id}/metafields", detailPath: "/v1/customers/{customer_id}/metafields/{metafield_id}", bulkPath: "/v1/customers/{customer_id}/metafields/bulk", idParam: customerId }),
  readTool("list_order_item_app_metafields", "order_item_app_metafields", "GET /v1/orders/{order_id}/items/app_metafields", "取得訂單品項 app metafields", "查詢訂單品項 app metafields。", [orderId, maxResults], true),
  writeTool("bulk_create_order_item_app_metafields", "order_item_app_metafields_bulk", "POST", "/v1/orders/{order_id}/items/app_metafields/bulk", "批次建立訂單品項 app metafields", "批次建立訂單品項 app metafields。", [orderId, dataParam("metafields_data", "訂單品項 app metafields 批次建立資料")], "metafields_data", ["會新增多筆訂單品項 app metafield", "批次資料錯誤可能造成整批失敗"] ),
  writeTool("bulk_update_order_item_app_metafields", "order_item_app_metafields_bulk", "PUT", "/v1/orders/{order_id}/items/app_metafields/bulk", "批次更新訂單品項 app metafields", "批次更新訂單品項 app metafields。", [orderId, dataParam("metafields_data", "訂單品項 app metafields 批次更新資料")], "metafields_data", ["會修改多筆訂單品項 app metafield", "修改會立即影響讀取該 metafield 的應用"] ),
  writeTool("bulk_delete_order_item_app_metafields", "order_item_app_metafields_bulk", "DELETE", "/v1/orders/{order_id}/items/app_metafields/bulk", "批次刪除訂單品項 app metafields", "批次刪除訂單品項 app metafields。", [orderId, arrayParam("metafield_ids", "要刪除的 metafield ID 陣列")], "{'ids': metafield_ids}", ["會刪除多筆訂單品項 app metafield", "請先 dry_run 確認刪除清單"] ),
  readTool("list_order_item_metafields", "order_item_metafields", "GET /v1/orders/{order_id}/items/metafields", "取得訂單品項 metafields", "查詢訂單品項 merchant metafields。", [orderId, maxResults], true),
  writeTool("bulk_create_order_item_metafields", "order_item_metafields_bulk", "POST", "/v1/orders/{order_id}/items/metafields/bulk", "批次建立訂單品項 metafields", "批次建立訂單品項 merchant metafields。", [orderId, dataParam("metafields_data", "訂單品項 metafields 批次建立資料")], "metafields_data", ["會新增多筆訂單品項 metafield", "批次資料錯誤可能造成整批失敗"] ),
  writeTool("bulk_update_order_item_metafields", "order_item_metafields_bulk", "PUT", "/v1/orders/{order_id}/items/metafields/bulk", "批次更新訂單品項 metafields", "批次更新訂單品項 merchant metafields。", [orderId, dataParam("metafields_data", "訂單品項 metafields 批次更新資料")], "metafields_data", ["會修改多筆訂單品項 metafield", "修改會立即影響讀取該 metafield 的應用"] ),
  writeTool("bulk_delete_order_item_metafields", "order_item_metafields_bulk", "DELETE", "/v1/orders/{order_id}/items/metafields/bulk", "批次刪除訂單品項 metafields", "批次刪除訂單品項 merchant metafields。", [orderId, arrayParam("metafield_ids", "要刪除的 metafield ID 陣列")], "{'ids': metafield_ids}", ["會刪除多筆訂單品項 metafield", "請先 dry_run 確認刪除清單"] ),
  readTool("get_product_metafield_definition", "product_metafield_definition", "GET /v1/metafield_definitions/products/{metafield_definition_id}", "取得商品 metafield definition", "查詢商品 metafield definition。", [metafieldDefinitionId]),
];
