import { apiDelete, apiGet, apiPatch, apiPost, apiPut, fetchAllPages } from "../client.js";
import {
  asArray,
  asRecord,
  dateOnly,
  dateRangeDays,
  daysBetween,
  getTranslation,
  increment,
  itemsFrom,
  moneyToFloat,
  orderItemProductId,
  pageCountForLimit,
  parseDate,
  percent,
  periodParams,
  round,
  sortObjectByValueDesc,
  sumQuantity,
  VALID_ORDER_STATUSES,
} from "../shared/helpers.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<Record<string, unknown>>;

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value !== "";
}

function itemOrSelf(result: Record<string, unknown>): Record<string, unknown> {
  if ("id" in result) return result;
  const item = asRecord(result.item);
  return Object.keys(item).length ? item : result;
}

function stringArg(args: Args, key: string, fallback = ""): string {
  return String(args[key] ?? fallback);
}

function numberArg(args: Args, key: string, fallback: number): number {
  const value = Number(args[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function maxResultsArg(args: Args, fallback = 50): number {
  const value = Number(args.max_results ?? args.top_n ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}





function stockQuantity(product: Record<string, unknown>): number {
  const variations = asArray(product.variations);
  return variations.length ? sumQuantity(variations, 0) : Number(product.quantity ?? 0);
}

function zhHantFields(record: Record<string, unknown>): string[] {
  return asArray(asRecord(record.fields_translations)["zh-hant"]).map(String);
}

function stockVariations(stockData: Record<string, unknown>): Record<string, unknown>[] {
  const variations = asArray(stockData.variations).map(asRecord);
  if (variations.length) return variations;
  const flatStocks = itemsFrom(stockData, "items").map(asRecord);
  if (!flatStocks.length) return [];
  return [
    {
      sku: flatStocks[0]?.sku ?? "",
      fields_translations: {},
      stocks: flatStocks,
    },
  ];
}



async function searchOrders(startDate: string, endDate: string, maxPages = 200): Promise<Record<string, unknown>[]> {
  return fetchAllPages("orders_search", periodParams(startDate, endDate), undefined, maxPages);
}

function validRevenueOrders(orders: Record<string, unknown>[]): Record<string, unknown>[] {
  return orders.filter((order) => VALID_ORDER_STATUSES.has(String(order.status ?? "")));
}

function filterChannel(orders: Record<string, unknown>[], channel: unknown): Record<string, unknown>[] {
  if (channel === "online") return orders.filter((order) => order.created_from === "shop");
  if (channel === "pos") return orders.filter((order) => order.created_from === "pos");
  return orders;
}

function filterStore(orders: Record<string, unknown>[], storeName: unknown): Record<string, unknown>[] {
  if (!storeName) return orders;
  const needle = String(storeName);
  return orders.filter((order) => {
    const channel = asRecord(order.channel);
    return getTranslation(channel.created_by_channel_name).includes(needle);
  });
}

function orderStoreName(order: Record<string, unknown>): string {
  if (order.created_from === "pos") {
    const channel = asRecord(order.channel);
    return getTranslation(channel.created_by_channel_name) || "未知門市";
  }
  return "線上官網";
}

function orderSummary(order: Record<string, unknown>): Record<string, unknown> {
  const channel = asRecord(order.channel);
  const payment = asRecord(order.order_payment);
  const delivery = asRecord(order.order_delivery);
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    channel: order.created_from === "pos" ? "POS" : "線上",
    store_name: getTranslation(channel.created_by_channel_name) || null,
    total: moneyToFloat(order.total),
    subtotal: moneyToFloat(order.subtotal),
    discount: moneyToFloat(order.order_discount),
    payment_type: getTranslation(payment.name_translations),
    payment_status: payment.status,
    delivery_type: getTranslation(delivery.name_translations),
    delivery_status: delivery.delivery_status,
    customer_name: order.customer_name,
    items_count: asArray(order.subtotal_items).length,
    created_at: order.created_at,
  };
}

async function queryOrders(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const params: Record<string, unknown> = periodParams(startDate, endDate);
  if (args.status) params.status = args.status;
  let orders = await fetchAllPages("orders_search", params, undefined, 20);
  orders = filterChannel(orders, args.channel ?? "all");
  orders = filterStore(orders, args.store_name);
  const maxResults = numberArg(args, "max_results", 100);
  const results = orders.slice(0, maxResults).map(orderSummary);
  return { total_found: orders.length, returned: results.length, orders: results };
}

async function getSalesSummary(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  let orders = await searchOrders(startDate, endDate);
  const status = String(args.status ?? "completed");
  if (status === "completed") orders = validRevenueOrders(orders);
  else if (status) orders = orders.filter((order) => order.status === status);
  orders = filterChannel(orders, args.channel ?? "all");
  orders = filterStore(orders, args.store_name);

  let totalRevenue = 0;
  let totalSubtotal = 0;
  let totalDiscount = 0;
  let totalItemsQty = 0;
  const paymentBreakdown: Record<string, number> = {};
  const deliveryBreakdown: Record<string, number> = {};
  const storeBreakdown: Record<string, { revenue: number; orders: number }> = {};

  for (const order of orders) {
    const revenue = moneyToFloat(order.total);
    totalRevenue += revenue;
    totalSubtotal += moneyToFloat(order.subtotal);
    totalDiscount += moneyToFloat(order.order_discount);
    totalItemsQty += sumQuantity(order.subtotal_items);
    const paymentName = getTranslation(asRecord(order.order_payment).name_translations);
    const deliveryName = getTranslation(asRecord(order.order_delivery).name_translations);
    if (paymentName) increment(paymentBreakdown, paymentName);
    if (deliveryName) increment(deliveryBreakdown, deliveryName);
    const store = orderStoreName(order);
    storeBreakdown[store] ??= { revenue: 0, orders: 0 };
    storeBreakdown[store].revenue += revenue;
    storeBreakdown[store].orders += 1;
  }

  const orderCount = orders.length;
  return {
    period: `${startDate} ~ ${endDate}`,
    status_filter: status,
    channel_filter: args.channel ?? "all",
    order_count: orderCount,
    total_revenue: round(totalRevenue),
    total_subtotal: round(totalSubtotal),
    total_discount: round(totalDiscount),
    net_revenue: round(totalRevenue),
    total_items_qty: totalItemsQty,
    avg_order_value: orderCount ? round(totalRevenue / orderCount) : 0,
    avg_item_price: totalItemsQty ? round(totalRevenue / totalItemsQty) : 0,
    payment_breakdown: sortObjectByValueDesc(paymentBreakdown),
    delivery_breakdown: sortObjectByValueDesc(deliveryBreakdown),
    store_breakdown: Object.fromEntries(Object.entries(storeBreakdown).sort((a, b) => b[1].revenue - a[1].revenue)),
  };
}

async function getTopProducts(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const sortBy = String(args.sort_by ?? "revenue");
  let orders = validRevenueOrders(await searchOrders(startDate, endDate));
  orders = filterChannel(orders, args.channel ?? "all");

  const stats: Record<string, Record<string, unknown> & { quantity: number; revenue: number }> = {};
  for (const order of orders) {
    for (const rawItem of asArray(order.subtotal_items)) {
      const item = asRecord(rawItem);
      const sku = String(item.sku ?? "");
      const title = getTranslation(item.title_translations);
      const fields = asArray(asRecord(item.fields_translations)["zh-hant"]);
      const objectData = asRecord(item.object_data);
      const key = sku || title;
      stats[key] ??= { title, sku, brand: objectData.brand ?? "", color: "", size: "", quantity: 0, revenue: 0 };
      stats[key].title = title;
      stats[key].sku = sku;
      stats[key].brand = objectData.brand ?? "";
      stats[key].color = fields[0] ?? "";
      stats[key].size = fields[1] ?? "";
      stats[key].quantity += Number(item.quantity ?? 1);
      stats[key].revenue += moneyToFloat(item.total);
    }
  }

  const topN = numberArg(args, "top_n", 20);
  const sorted = Object.values(stats).sort((a, b) => Number(b[sortBy] ?? 0) - Number(a[sortBy] ?? 0));
  return {
    period: `${startDate} ~ ${endDate}`,
    sort_by: sortBy,
    total_skus: Object.keys(stats).length,
    top_products: sorted.slice(0, topN).map((product, index) => ({ ...product, revenue: round(product.revenue), rank: index + 1 })),
  };
}

async function getSalesTrend(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const granularity = String(args.granularity ?? "daily");
  let orders = validRevenueOrders(await searchOrders(startDate, endDate));
  orders = filterChannel(orders, args.channel ?? "all");
  const trend: Record<string, { revenue: number; orders: number; items: number }> = {};

  for (const order of orders) {
    const created = String(order.created_at ?? "");
    if (!created) continue;
    const date = parseDate(created);
    let key = dateOnly(created);
    if (granularity === "monthly") key = key.slice(0, 7);
    if (granularity === "weekly") {
      const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      key = `${date.getUTCFullYear()}-W${String(Math.floor(daysBetween(first, date) / 7)).padStart(2, "0")}`;
    }
    const bucket = (trend[key] ??= { revenue: 0, orders: 0, items: 0 });
    bucket.revenue += moneyToFloat(order.total);
    bucket.orders += 1;
    bucket.items += sumQuantity(order.subtotal_items);
  }

  return {
    period: `${startDate} ~ ${endDate}`,
    granularity,
    data_points: Object.keys(trend).length,
    trend: Object.entries(trend)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({
        date,
        revenue: round(value.revenue),
        orders: value.orders,
        items: value.items,
        avg_order_value: value.orders ? round(value.revenue / value.orders) : 0,
      })),
  };
}

async function getChannelComparison(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const orders = validRevenueOrders(await searchOrders(startDate, endDate));
  const channels: Record<string, { revenue: number; orders: number; items: number; discount: number }> = {};

  for (const order of orders) {
    const name = orderStoreName(order);
    const bucket = (channels[name] ??= { revenue: 0, orders: 0, items: 0, discount: 0 });
    bucket.revenue += moneyToFloat(order.total);
    bucket.orders += 1;
    bucket.discount += moneyToFloat(order.order_discount);
    bucket.items += sumQuantity(order.subtotal_items);
  }

  const totalRevenue = Object.values(channels).reduce((sum, value) => sum + value.revenue, 0);
  return {
    period: `${startDate} ~ ${endDate}`,
    total_revenue: round(totalRevenue),
    channels: Object.entries(channels)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([channel, value]) => ({
        channel,
        revenue: round(value.revenue),
        orders: value.orders,
        items: value.items,
        discount: round(value.discount),
        avg_order_value: value.orders ? round(value.revenue / value.orders) : 0,
        revenue_share: percent(value.revenue, totalRevenue),
      })),
  };
}

async function getOrderDetail(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("order_detail", undefined, { order_id: args.order_id });
  const order = "order_number" in data ? data : asRecord(data.item) || data;
  const payment = asRecord(order.order_payment);
  const delivery = asRecord(order.order_delivery);
  const channel = asRecord(order.channel);
  const items = asArray(order.subtotal_items).map((rawItem) => {
    const item = asRecord(rawItem);
    const fields = asArray(asRecord(item.fields_translations)["zh-hant"]);
    const objectData = asRecord(item.object_data);
    return {
      title: getTranslation(item.title_translations),
      sku: item.sku,
      quantity: item.quantity ?? 1,
      price: moneyToFloat(item.price),
      sale_price: moneyToFloat(item.price_sale),
      item_total: moneyToFloat(item.total),
      cost: moneyToFloat(item.cost),
      brand: objectData.brand ?? "",
      color: fields[0] ?? "",
      size: fields[1] ?? "",
    };
  });
  const promotions = asArray(order.promotion_items).map((rawPromotion) => {
    const item = asRecord(rawPromotion);
    const promotion = asRecord(item.promotion);
    return {
      title: getTranslation(promotion.title_translations),
      discount_type: promotion.discount_type,
      discounted_amount: moneyToFloat(item.discounted_amount),
    };
  });

  return {
    order_number: order.order_number,
    status: order.status,
    channel: order.created_from === "pos" ? "POS" : "線上",
    store_name: getTranslation(channel.created_by_channel_name) || null,
    created_at: order.created_at,
    customer_name: order.customer_name,
    customer_id: order.customer_id,
    subtotal: moneyToFloat(order.subtotal),
    discount: moneyToFloat(order.order_discount),
    total: moneyToFloat(order.total),
    payment_type: getTranslation(payment.name_translations),
    payment_status: payment.status,
    delivery_type: getTranslation(delivery.name_translations),
    delivery_status: delivery.delivery_status,
    delivery_city: asRecord(order.delivery_address).city,
    items,
    promotions,
    utm_data: order.utm_data ?? {},
  };
}

async function getRefundSummary(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const returnOrders = await fetchAllPages("return_orders", periodParams(startDate, endDate), undefined, 50);
  const statusBreakdown: Record<string, number> = {};
  const itemStats: Record<string, { title: string; sku: string; brand: string; quantity: number; refund_amount: number }> = {};
  let totalRefund = 0;
  let completedCount = 0;
  let pendingCount = 0;

  for (const returnOrder of returnOrders) {
    const status = String(returnOrder.status ?? "");
    increment(statusBreakdown, status);
    if (status === "completed") {
      completedCount += 1;
      totalRefund += moneyToFloat(returnOrder.total);
    } else if (status === "pending") {
      pendingCount += 1;
    }
    for (const rawItem of asArray(returnOrder.items)) {
      const item = asRecord(rawItem);
      const objectData = asRecord(item.object_data);
      const title = getTranslation(objectData.title_translations);
      const sku = String(objectData.sku ?? "");
      const key = sku || title || "unknown";
      itemStats[key] ??= { title, sku, brand: String(objectData.brand ?? ""), quantity: 0, refund_amount: 0 };
      itemStats[key].quantity += Number(item.quantity ?? 1);
      itemStats[key].refund_amount += moneyToFloat(item.total);
    }
  }

  return {
    period: `${startDate} ~ ${endDate}`,
    total_return_orders: returnOrders.length,
    completed_returns: completedCount,
    pending_returns: pendingCount,
    total_refund_amount: round(totalRefund),
    status_breakdown: sortObjectByValueDesc(statusBreakdown),
    top_refund_items: Object.values(itemStats).sort((a, b) => b.refund_amount - a.refund_amount).slice(0, 20),
  };
}

async function getArchivedOrders(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const maxResults = numberArg(args, "max_results", 100);
  const orders = await fetchAllPages("orders_archived", periodParams(startDate, endDate), undefined, 20);
  const results = orders.slice(0, maxResults).map(orderSummary);
  return { total_found: orders.length, returned: results.length, orders: results };
}

async function getProductList(args: Args): Promise<Record<string, unknown>> {
  let products = await fetchAllPages("products", {}, undefined, 10);
  const keyword = args.keyword ? String(args.keyword).toLowerCase() : "";
  const brand = args.brand ? String(args.brand).toLowerCase() : "";
  if (keyword) {
    products = products.filter((product) => {
      const title = getTranslation(product.title_translations).toLowerCase();
      const sku = String(product.sku ?? "").toLowerCase();
      return title.includes(keyword) || sku.includes(keyword);
    });
  }
  if (brand) products = products.filter((product) => String(product.brand ?? "").toLowerCase().includes(brand));
  const maxResults = numberArg(args, "max_results", 50);
  const results = products.slice(0, maxResults).map((product) => {
    const variations = asArray(product.variations).map(asRecord);
    const totalQty = variations.length ? sumQuantity(variations, 0) : Number(product.quantity ?? 0);
    const supplier = asRecord(product.supplier);
    return {
      id: product.id,
      title: getTranslation(product.title_translations),
      sku: product.sku,
      brand: product.brand,
      supplier: supplier.name ?? "",
      price: moneyToFloat(product.price),
      price_sale: moneyToFloat(product.price_sale),
      cost: moneyToFloat(product.cost),
      quantity: totalQty,
      category_ids: product.category_ids ?? [],
      status: product.status,
      variants_count: variations.length,
      tags: product.tags ?? [],
    };
  });
  return { total_found: products.length, returned: results.length, products: results };
}

async function getProductVariants(args: Args): Promise<Record<string, unknown>> {
  const productId = stringArg(args, "product_id");
  const products = await fetchAllPages("products", {}, undefined, 10);
  const product = products.find((entry) => entry.id === productId);
  if (!product) return { error: `Product ${productId} not found` };
  const fieldTitles = asArray(product.field_titles).map((field) => getTranslation(asRecord(field).name_translations));
  const variants = asArray(product.variations).map((rawVariation) => {
    const variation = asRecord(rawVariation);
    const fields = asArray(asRecord(variation.fields_translations)["zh-hant"]);
    const feed = asRecord(variation.feed_variations);
    return {
      id: variation.id,
      sku: variation.sku,
      color: "color" in feed ? getTranslation(feed.color) : fields[0] ?? "",
      size: "size" in feed ? getTranslation(feed.size) : fields[1] ?? "",
      price: moneyToFloat(variation.price),
      price_sale: moneyToFloat(variation.price_sale),
      cost: moneyToFloat(variation.cost),
      quantity: Number(variation.quantity ?? 0),
      total_orderable_quantity: variation.total_orderable_quantity ?? 0,
    };
  });
  return {
    product_id: productId,
    title: getTranslation(product.title_translations),
    brand: product.brand,
    dimensions: fieldTitles,
    variants_count: variants.length,
    total_quantity: sumQuantity(variants, 0),
    variants,
  };
}

async function getInventoryOverview(args: Args): Promise<Record<string, unknown>> {
  let products = await fetchAllPages("products", {}, undefined, 10);
  if (args.brand) {
    const brand = String(args.brand).toLowerCase();
    products = products.filter((product) => String(product.brand ?? "").toLowerCase().includes(brand));
  }

  let totalQuantity = 0;
  let totalCostValue = 0;
  let totalSkus = 0;
  let outOfStockSkus = 0;
  let lowStockSkus = 0;
  const brandBreakdown: Record<string, { quantity: number; skus: number; oos: number }> = {};
  const productSummary: Record<string, unknown>[] = [];

  for (const product of products) {
    const brand = String(product.brand ?? "未設定");
    const variations = asArray(product.variations).map(asRecord);
    let productQty = 0;
    let productSkuCount = 0;
    let productOos = 0;
    brandBreakdown[brand] ??= { quantity: 0, skus: 0, oos: 0 };

    if (variations.length) {
      for (const variation of variations) {
        const qty = Number(variation.quantity ?? 0);
        totalSkus += 1;
        productSkuCount += 1;
        productQty += qty;
        totalQuantity += qty;
        totalCostValue += moneyToFloat(variation.cost) * qty;
        if (qty === 0) {
          outOfStockSkus += 1;
          productOos += 1;
          brandBreakdown[brand].oos += 1;
        } else if (qty <= 3) {
          lowStockSkus += 1;
        }
        brandBreakdown[brand].quantity += qty;
        brandBreakdown[brand].skus += 1;
      }
    } else {
      const qty = Number(product.quantity ?? 0);
      totalSkus += 1;
      productSkuCount = 1;
      productQty = qty;
      totalQuantity += qty;
      if (qty === 0) {
        outOfStockSkus += 1;
        productOos = 1;
      }
    }

    productSummary.push({
      title: getTranslation(product.title_translations),
      brand,
      total_quantity: productQty,
      sku_count: productSkuCount,
      out_of_stock_skus: productOos,
    });
  }

  return {
    total_products: products.length,
    total_skus: totalSkus,
    total_quantity: totalQuantity,
    total_cost_value: round(totalCostValue),
    out_of_stock_skus: outOfStockSkus,
    low_stock_skus: lowStockSkus,
    brand_breakdown: Object.fromEntries(Object.entries(brandBreakdown).sort((a, b) => b[1].quantity - a[1].quantity)),
    products: productSummary.sort((a, b) => Number(a.total_quantity ?? 0) - Number(b.total_quantity ?? 0)),
  };
}

async function getLowStockAlerts(args: Args): Promise<Record<string, unknown>> {
  const threshold = numberArg(args, "threshold", 5);
  const products = await fetchAllPages("products", {}, undefined, 10);
  const alerts: Record<string, unknown>[] = [];
  for (const product of products) {
    const title = getTranslation(product.title_translations);
    for (const rawVariation of asArray(product.variations)) {
      const variation = asRecord(rawVariation);
      const qty = Number(variation.quantity ?? 0);
      if (qty <= threshold) {
        const fields = asArray(asRecord(variation.fields_translations)["zh-hant"]);
        alerts.push({
          product_title: title,
          sku: variation.sku,
          color: fields[0] ?? "",
          size: fields[1] ?? "",
          quantity: qty,
          status: qty === 0 ? "缺貨" : "低庫存",
          brand: product.brand,
        });
      }
    }
  }
  alerts.sort((a, b) => Number(a.quantity ?? 0) - Number(b.quantity ?? 0));
  return {
    threshold,
    total_alerts: alerts.length,
    out_of_stock: alerts.filter((alert) => alert.quantity === 0).length,
    low_stock: alerts.filter((alert) => Number(alert.quantity ?? 0) > 0).length,
    alerts,
  };
}

async function getWarehouses(): Promise<Record<string, unknown>> {
  const data = await apiGet("warehouses", { per_page: 50 });
  const warehouses = itemsFrom(data, "items").map((warehouse) => {
    const record = asRecord(warehouse);
    return { id: record.id, name: record.name, status: record.status };
  });
  return { total: warehouses.length, warehouses };
}

async function getRfmAnalysis(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const rDaysThreshold = numberArg(args, "r_days_threshold", 30);
  const fThreshold = numberArg(args, "f_threshold", 2);
  const mThreshold = numberArg(args, "m_threshold", 5000);
  const orders = validRevenueOrders(await searchOrders(startDate, endDate));
  const now = new Date(`${endDate}T23:59:59Z`);
  const customers: Record<string, { name: string; orders: string[]; total_spent: number }> = {};
  for (const order of orders) {
    const customerId = String(order.customer_id ?? "");
    if (!customerId) continue;
    customers[customerId] ??= { name: String(order.customer_name ?? ""), orders: [], total_spent: 0 };
    customers[customerId].orders.push(String(order.created_at ?? ""));
    customers[customerId].total_spent += moneyToFloat(order.total);
  }

  const labels: Record<string, string> = {
    HHH: "最佳客戶",
    HHL: "高頻低消",
    HLH: "近期高消",
    HLL: "近期新客",
    LHH: "流失高價值",
    LHL: "流失高頻",
    LLH: "流失高消",
    LLL: "流失低價值",
  };
  const segmentCounts: Record<string, number> = {};
  const rfmData = Object.entries(customers).map(([customerId, data]) => {
    const dates = [...data.orders].sort();
    const latest = dates.at(-1) ?? "";
    const recency = latest ? daysBetween(parseDate(latest), now) : 999;
    const frequency = dates.length;
    const monetary = data.total_spent;
    const segment = `${recency <= rDaysThreshold ? "H" : "L"}${frequency >= fThreshold ? "H" : "L"}${monetary >= mThreshold ? "H" : "L"}`;
    increment(segmentCounts, segment);
    return {
      customer_id: customerId,
      customer_name: data.name,
      recency_days: recency,
      frequency,
      monetary: round(monetary),
      segment,
      segment_label: labels[segment] ?? segment,
    };
  });

  rfmData.sort((a, b) => b.monetary - a.monetary);
  return {
    period: `${startDate} ~ ${endDate}`,
    thresholds: { recency_days: rDaysThreshold, frequency: fThreshold, monetary: mThreshold },
    total_customers: rfmData.length,
    segment_distribution: Object.fromEntries(
      Object.entries(segmentCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([segment, count]) => [`${segment} (${labels[segment] ?? segment})`, count]),
    ),
    top_customers: rfmData.slice(0, 20),
  };
}

async function getRepurchaseAnalysis(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const orders = validRevenueOrders(await searchOrders(startDate, endDate));
  const customerOrders: Record<string, string[]> = {};
  const customerRevenue: Record<string, number> = {};
  for (const order of orders) {
    const customerId = String(order.customer_id ?? "");
    if (!customerId) continue;
    customerOrders[customerId] ??= [];
    customerOrders[customerId].push(String(order.created_at ?? ""));
    customerRevenue[customerId] = (customerRevenue[customerId] ?? 0) + moneyToFloat(order.total);
  }
  const totalCustomers = Object.keys(customerOrders).length;
  const newCustomers = Object.values(customerOrders).filter((dates) => dates.length === 1).length;
  const returningCustomers = totalCustomers - newCustomers;
  const gaps: number[] = [];
  for (const dates of Object.values(customerOrders)) {
    const sorted = [...dates].sort();
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = daysBetween(parseDate(sorted[i - 1] ?? ""), parseDate(sorted[i] ?? ""));
      if (gap > 0) gaps.push(gap);
    }
  }
  const newRevenue = Object.entries(customerOrders)
    .filter(([, dates]) => dates.length === 1)
    .reduce((sum, [id]) => sum + (customerRevenue[id] ?? 0), 0);
  const returningRevenue = Object.entries(customerOrders)
    .filter(([, dates]) => dates.length >= 2)
    .reduce((sum, [id]) => sum + (customerRevenue[id] ?? 0), 0);
  const totalRevenue = newRevenue + returningRevenue;
  return {
    period: `${startDate} ~ ${endDate}`,
    total_orders: orders.length,
    total_customers: totalCustomers,
    new_customers: newCustomers,
    returning_customers: returningCustomers,
    repurchase_rate: percent(returningCustomers, totalCustomers),
    avg_repurchase_days: gaps.length ? round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length, 1) : 0,
    median_repurchase_days: gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0,
    new_customer_revenue: round(newRevenue),
    returning_customer_revenue: round(returningRevenue),
    new_customer_revenue_share: percent(newRevenue, totalRevenue),
    returning_customer_revenue_share: percent(returningRevenue, totalRevenue),
  };
}

async function getCustomerGeoAnalysis(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  let orders = validRevenueOrders(await searchOrders(startDate, endDate));
  orders = filterChannel(orders, args.channel ?? "all");
  const cityStats: Record<string, { orders: number; revenue: number; customers: Set<string> }> = {};
  for (const order of orders) {
    const city = String(asRecord(order.delivery_address).city ?? "未填寫");
    cityStats[city] ??= { orders: 0, revenue: 0, customers: new Set() };
    cityStats[city].orders += 1;
    cityStats[city].revenue += moneyToFloat(order.total);
    if (order.customer_id) cityStats[city].customers.add(String(order.customer_id));
  }
  const totalOrders = Object.values(cityStats).reduce((sum, city) => sum + city.orders, 0);
  return {
    period: `${startDate} ~ ${endDate}`,
    total_orders: totalOrders,
    total_cities: Object.keys(cityStats).length,
    cities: Object.entries(cityStats)
      .sort((a, b) => b[1].orders - a[1].orders)
      .map(([city, value]) => ({
        city,
        orders: value.orders,
        revenue: round(value.revenue),
        unique_customers: value.customers.size,
        order_share: percent(value.orders, totalOrders),
      })),
  };
}

async function listCustomers(args: Args): Promise<Record<string, unknown>> {
  const maxResults = numberArg(args, "max_results", 50);
  const searchKeyword = args.search_keyword ? String(args.search_keyword) : "";
  const customers = searchKeyword
    ? itemsFrom(await apiGet("customers_search", { keyword: searchKeyword, per_page: Math.min(maxResults, 50) }), "items")
    : await fetchAllPages("customers", {}, undefined, pageCountForLimit(maxResults));
  const results = customers.slice(0, maxResults).map((rawCustomer) => {
    const customer = asRecord(rawCustomer);
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      gender: customer.gender,
      birthday: customer.birthday,
      tags: customer.tags ?? [],
      membership_tier: customer.membership_tier_id,
      total_spent: moneyToFloat(customer.total_spent),
      orders_count: customer.orders_count ?? 0,
      created_at: customer.created_at,
    };
  });
  return { total_found: customers.length, returned: results.length, customers: results };
}

async function getCustomerProfile(args: Args): Promise<Record<string, unknown>> {
  const customerId = args.customer_id;
  const pathParams = { customer_id: customerId };
  const detail = await apiGet("customer_detail", undefined, pathParams);
  const customer = "name" in detail ? detail : asRecord(detail.item);
  const load = async (endpointKey: string, mapper: (record: Record<string, unknown>) => Record<string, unknown>, error: string) => {
    try {
      const data = await apiGet(endpointKey, undefined, pathParams);
      return itemsFrom(data, "items").map((item) => mapper(asRecord(item)));
    } catch {
      return [{ error }];
    }
  };

  return {
    profile: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      gender: customer.gender,
      birthday: customer.birthday,
      tags: customer.tags ?? [],
      total_spent: moneyToFloat(customer.total_spent),
      orders_count: customer.orders_count ?? 0,
      membership_tier_id: customer.membership_tier_id,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
    },
    store_credits: await load(
      "customer_store_credit_history",
      (record) => ({
        amount: moneyToFloat(record.amount),
        balance: moneyToFloat(record.balance),
        type: record.type,
        note: record.note,
        created_at: record.created_at,
      }),
      "無法取得儲值金紀錄",
    ),
    member_points: await load(
      "customer_member_points",
      (record) => ({ points: record.points ?? 0, balance: record.balance ?? 0, type: record.type, note: record.note, created_at: record.created_at }),
      "無法取得會員點數紀錄",
    ),
    tier_history: await load(
      "customer_membership_tier_history",
      (record) => ({ from_tier: record.from_tier, to_tier: record.to_tier, reason: record.reason, created_at: record.created_at }),
      "無法取得會員等級變動紀錄",
    ),
    promotions: await load(
      "customer_promotions",
      (record) => ({
        id: record.id,
        title: getTranslation(record.title_translations),
        status: record.status,
        discount_type: record.discount_type,
      }),
      "無法取得客戶優惠",
    ),
  };
}

async function endpointItems(
  endpointKey: string,
  args: Args = {},
  pathParams?: Record<string, unknown>,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const limit = maxResultsArg(args, 50);
  const items = await fetchAllPages(endpointKey, params, pathParams, pageCountForLimit(limit));
  return items.slice(0, limit);
}

function commonTitle(record: Record<string, unknown>): string {
  return getTranslation(record.title_translations) || getTranslation(record.name_translations) || String(record.title ?? record.name ?? "");
}

function simpleCountList(key: string, items: Record<string, unknown>[]): Record<string, unknown> {
  return { total: items.length, [key]: items };
}

function foundList(key: string, allItems: Record<string, unknown>[], returnedItems = allItems): Record<string, unknown> {
  return { total_found: allItems.length, returned: returnedItems.length, [key]: returnedItems };
}

function campaignDetail(campaign: Record<string, unknown>): Record<string, unknown> {
  return {
    id: campaign.id,
    title: commonTitle(campaign),
    status: campaign.status,
    commission_type: campaign.commission_type,
    commission_value: campaign.commission_value,
    discount_type: campaign.discount_type,
    discount_value: campaign.discount_value,
    tracking_code: campaign.tracking_code,
    description: getTranslation(campaign.description_translations) || campaign.description,
    start_at: campaign.start_at,
    end_at: campaign.end_at,
    products: campaign.products ?? [],
    conditions: campaign.conditions ?? [],
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
  };
}

async function getAffiliateCampaignDetail(args: Args): Promise<Record<string, unknown>> {
  return campaignDetail(await apiGet("affiliate_campaign_detail", undefined, { campaign_id: args.campaign_id }));
}

async function getAffiliateCampaignUsage(args: Args): Promise<Record<string, unknown>> {
  const campaignId = stringArg(args, "campaign_id");
  const data = await apiGet("affiliate_campaign_order_usage", undefined, { campaign_id: campaignId });
  const orders = itemsFrom(data, "items").map(asRecord);
  const totalRevenue = orders.reduce((sum, order) => sum + moneyToFloat(order.revenue ?? order.total), 0);
  const totalCommission = orders.reduce((sum, order) => sum + moneyToFloat(order.commission), 0);
  return {
    campaign_id: campaignId,
    total_orders: orders.length,
    total_revenue: round(totalRevenue),
    total_commission: round(totalCommission),
    items: orders.map((order) => ({
      order_id: order.order_id ?? order.id,
      order_number: order.order_number,
      revenue: moneyToFloat(order.revenue ?? order.total),
      commission: moneyToFloat(order.commission),
      created_at: order.created_at,
    })),
  };
}

async function listAgents(): Promise<Record<string, unknown>> {
  const agents = await endpointItems("agents");
  return simpleCountList(
    "agents",
    agents.map((agent) => ({
      id: agent.id,
      name: getTranslation(agent.name_translations) || agent.name,
      email: agent.email,
      role: agent.role,
      enabled: agent.enabled,
      created_at: agent.created_at,
    })),
  );
}

async function getInventoryTurnover(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const periodDays = dateRangeDays(startDate, endDate);
  const products = await endpointItems("products", { max_results: 50 });
  const orders = validRevenueOrders(await searchOrders(startDate, endDate, 20));
  const salesByProduct: Record<string, { qty: number; revenue: number }> = {};
  for (const order of orders) {
    for (const rawItem of asArray(order.subtotal_items)) {
      const item = asRecord(rawItem);
      const productId = orderItemProductId(item);
      if (!productId) continue;
      salesByProduct[productId] ??= { qty: 0, revenue: 0 };
      salesByProduct[productId].qty += Number(item.quantity ?? 1);
      salesByProduct[productId].revenue += moneyToFloat(item.total);
    }
  }
  const productTurnover = products.map((product) => {
    const quantity = stockQuantity(product);
    const sales = salesByProduct[String(product.id ?? "")] ?? { qty: 0, revenue: 0 };
    const dailySales = sales.qty / periodDays;
    const daysOfStock = dailySales > 0 ? quantity / dailySales : Number.POSITIVE_INFINITY;
    const turnoverRate = quantity > 0 ? sales.qty / quantity : Number.POSITIVE_INFINITY;
    return {
      title: getTranslation(product.title_translations),
      product_id: product.id,
      brand: product.brand,
      current_stock: quantity,
      period_sales_qty: sales.qty,
      period_sales_revenue: round(sales.revenue),
      daily_sales_rate: round(dailySales),
      estimated_days_of_stock: Number.isFinite(daysOfStock) ? round(daysOfStock, 1) : "無銷售",
      turnover_rate: Number.isFinite(turnoverRate) ? round(turnoverRate) : "無庫存",
    };
  });
  productTurnover.sort((a, b) => {
    const aDays = typeof a.estimated_days_of_stock === "number" ? a.estimated_days_of_stock : 99999;
    const bDays = typeof b.estimated_days_of_stock === "number" ? b.estimated_days_of_stock : 99999;
    return aDays - bDays;
  });
  return { period: `${startDate} ~ ${endDate}`, period_days: periodDays, total_products: productTurnover.length, products: productTurnover };
}

async function getCategorySales(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const channel = args.channel ?? "all";
  const categories = await endpointItems("categories", { max_results: 50 });
  const categoryMap = new Map<string, string>();
  for (const category of categories) {
    const categoryId = String(category.id ?? "");
    if (categoryId) categoryMap.set(categoryId, commonTitle(category));
    for (const rawChild of asArray(category.children)) {
      const child = asRecord(rawChild);
      const childId = String(child.id ?? "");
      if (childId) categoryMap.set(childId, commonTitle(child));
    }
  }
  const products = await endpointItems("products", { max_results: 50 });
  const productCategories = new Map<string, string[]>();
  const skuToProductId = new Map<string, string>();
  for (const product of products) {
    const productId = String(product.id ?? "");
    const categoryNames = asArray(product.category_ids).map((id) => categoryMap.get(String(id)) ?? "未分類");
    if (productId) productCategories.set(productId, categoryNames.length ? categoryNames : ["未分類"]);
    for (const rawVariation of asArray(product.variations)) {
      const variation = asRecord(rawVariation);
      const sku = String(variation.sku ?? "");
      if (sku && productId) skuToProductId.set(sku, productId);
    }
  }
  let orders = validRevenueOrders(await searchOrders(startDate, endDate, 20));
  orders = filterChannel(orders, channel);
  const stats: Record<string, { revenue: number; quantity: number; orders: Set<string>; products: Set<string> }> = {};
  let totalRevenue = 0;
  for (const order of orders) {
    for (const rawItem of asArray(order.subtotal_items)) {
      const item = asRecord(rawItem);
      const sku = String(item.sku ?? "");
      const productId = skuToProductId.get(sku) ?? orderItemProductId(item);
      const names = productCategories.get(productId) ?? ["未分類"];
      const revenue = moneyToFloat(item.total);
      const qty = Number(item.quantity ?? 1);
      totalRevenue += revenue;
      for (const name of names) {
        stats[name] ??= { revenue: 0, quantity: 0, orders: new Set(), products: new Set() };
        stats[name].revenue += revenue;
        stats[name].quantity += qty;
        if (order.id) stats[name].orders.add(String(order.id));
        if (productId) stats[name].products.add(productId);
      }
    }
  }
  const result = Object.entries(stats).map(([category, stat]) => ({
    category,
    revenue: round(stat.revenue),
    revenue_share: percent(stat.revenue, totalRevenue),
    quantity: stat.quantity,
    order_count: stat.orders.size,
    product_count: stat.products.size,
    avg_item_price: stat.quantity ? round(stat.revenue / stat.quantity) : 0,
  }));
  return {
    period: `${startDate} ~ ${endDate}`,
    channel_filter: channel,
    total_categories: result.length,
    total_revenue: round(totalRevenue),
    categories: result.sort((a, b) => b.revenue - a.revenue),
  };
}

async function getPromotionAnalysis(args: Args): Promise<Record<string, unknown>> {
  const promotions = await endpointItems("promotions", { max_results: args.max_results ?? 50 });
  const filtered = promotions.filter((promotion) => {
    const status = args.status ?? "all";
    if (status !== "all" && promotion.status !== status) return false;
    if (args.discount_type && promotion.discount_type !== args.discount_type) return false;
    return true;
  });
  const statusBreakdown: Record<string, number> = {};
  const typeBreakdown: Record<string, { count: number; total_use_count: number }> = {};
  const results: Record<string, unknown>[] = [];
  for (const promotion of filtered) {
    const type = String(promotion.discount_type ?? "unknown");
    const status = String(promotion.status ?? "");
    const sumUseCount = Number(promotion.sum_use_count ?? 0);
    const maxUseCount = Number(promotion.max_use_count ?? 0);
    increment(statusBreakdown, status);
    typeBreakdown[type] ??= { count: 0, total_use_count: 0 };
    typeBreakdown[type].count += 1;
    typeBreakdown[type].total_use_count += sumUseCount;
    results.push({
      id: promotion.id,
      title: commonTitle(promotion),
      discount_type: type,
      discount_amount: promotion.discount_amount ?? 0,
      discount_percentage: promotion.discount_percentage ?? 0,
      status,
      use_count: promotion.use_count ?? 0,
      sum_use_count: sumUseCount,
      max_use_count: maxUseCount,
      utilization: maxUseCount ? percent(sumUseCount, maxUseCount) : "無上限",
      start_at: promotion.start_at,
      end_at: promotion.end_at,
      codes: promotion.codes ?? [],
      platforms: promotion.available_platforms ?? [],
    });
  }
  results.sort((a, b) => Number(b.sum_use_count ?? 0) - Number(a.sum_use_count ?? 0));
  return {
    total_promotions: results.length,
    status_breakdown: statusBreakdown,
    type_breakdown: typeBreakdown,
    promotions: results,
  };
}

async function getRefundByStore(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const returnOrders = await endpointItems("return_orders", { max_results: 100 }, undefined, periodParams(startDate, endDate));
  const orderChannelMap = new Map<string, string>();
  for (const orderId of new Set(returnOrders.map((order) => String(order.order_id ?? "")).filter(Boolean))) {
    try {
      const data = await apiGet("order_detail", undefined, { order_id: orderId });
      orderChannelMap.set(orderId, orderStoreName(itemOrSelf(data)));
    } catch {
      orderChannelMap.set(orderId, "未知通路");
    }
  }
  const storeStats: Record<string, { refund_count: number; refund_amount: number; items: Record<string, number> }> = {};
  for (const returnOrder of returnOrders) {
    const orderId = String(returnOrder.order_id ?? "");
    const storeName = orderChannelMap.get(orderId) ?? "未知通路";
    storeStats[storeName] ??= { refund_count: 0, refund_amount: 0, items: {} };
    storeStats[storeName].refund_count += 1;
    storeStats[storeName].refund_amount += moneyToFloat(returnOrder.total);
    for (const rawItem of asArray(returnOrder.items)) {
      const item = asRecord(rawItem);
      const objectData = asRecord(item.object_data);
      const title = getTranslation(objectData.title_translations);
      const key = String(objectData.sku ?? (title || "unknown"));
      increment(storeStats[storeName].items, key, Number(item.quantity ?? 1));
    }
  }
  const stores = Object.entries(storeStats)
    .sort((a, b) => b[1].refund_amount - a[1].refund_amount)
    .map(([storeName, stats]) => ({
      store_name: storeName,
      refund_count: stats.refund_count,
      refund_amount: round(stats.refund_amount),
      top_refunded_items: Object.entries(stats.items)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([item, quantity]) => ({ item, quantity })),
    }));
  return {
    period: `${startDate} ~ ${endDate}`,
    total_return_orders: returnOrders.length,
    stores,
  };
}

async function getStockTransferSuggestions(args: Args): Promise<Record<string, unknown>> {
  const minStockDiff = numberArg(args, "min_stock_diff", 10);
  const warehouses = await endpointItems("warehouses", { max_results: 50 });
  const warehouseMap = new Map(warehouses.map((warehouse) => [String(warehouse.id), String(warehouse.name ?? warehouse.id ?? "")]));
  const products = await endpointItems("products", { max_results: 30 });
  const suggestions: Record<string, unknown>[] = [];
  for (const product of products) {
    const productId = String(product.id ?? "");
    if (!productId) continue;
    let stockData: Record<string, unknown>;
    try {
      stockData = await apiGet("product_stocks", undefined, { product_id: productId });
    } catch {
      continue;
    }
    const title = getTranslation(stockData.title_translations) || getTranslation(product.title_translations);
    for (const variation of stockVariations(stockData)) {
      const stocks = asArray(variation.stocks).map(asRecord);
      if (stocks.length < 2) continue;
      const warehouseStocks = stocks
        .map((stock) => {
          const warehouseId = String(stock.warehouse_id ?? "");
          return {
            warehouse_id: warehouseId,
            warehouse_name: warehouseMap.get(warehouseId) ?? warehouseId,
            quantity: Number(stock.quantity ?? 0),
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
      const highest = warehouseStocks[0];
      const lowest = warehouseStocks[warehouseStocks.length - 1];
      if (!highest || !lowest) continue;
      const diff = highest.quantity - lowest.quantity;
      if (diff < minStockDiff) continue;
      const fields = zhHantFields(variation);
      suggestions.push({
        product_title: title,
        variant: String(variation.sku ?? "") || fields.join(" / ") || "default",
        from_warehouse: highest.warehouse_name,
        from_quantity: highest.quantity,
        to_warehouse: lowest.warehouse_name,
        to_quantity: lowest.quantity,
        stock_diff: diff,
        suggested_transfer_qty: Math.floor(diff / 2),
      });
    }
  }
  suggestions.sort((a, b) => Number(b.stock_diff ?? 0) - Number(a.stock_diff ?? 0));
  return { min_stock_diff: minStockDiff, products_analyzed: products.length, suggestions_count: suggestions.length, suggestions };
}

async function getPromotionRoi(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const promotions = await endpointItems("promotions", { max_results: 50 });
  const promotionMap = new Map(
    promotions.map((promotion) => [
      String(promotion.id ?? ""),
      {
        title: commonTitle(promotion),
        discount_type: promotion.discount_type ?? "",
        status: promotion.status ?? "",
        start_at: promotion.start_at ?? null,
        end_at: promotion.end_at ?? null,
      },
    ]),
  );
  const orders = validRevenueOrders(await searchOrders(startDate, endDate, 20));
  const promoStats: Record<string, { orders_count: number; total_revenue: number; total_discount: number; order_ids: Set<string> }> = {};
  for (const order of orders) {
    const orderId = String(order.id ?? "");
    const orderRevenue = moneyToFloat(order.total);
    for (const rawPromotionItem of asArray(order.promotion_items)) {
      const promotionItem = asRecord(rawPromotionItem);
      const promotion = asRecord(promotionItem.promotion);
      const promotionId = String(promotion.id ?? promotionItem.promotion_id ?? "");
      if (!promotionId) continue;
      promoStats[promotionId] ??= { orders_count: 0, total_revenue: 0, total_discount: 0, order_ids: new Set() };
      if (!promoStats[promotionId].order_ids.has(orderId)) {
        promoStats[promotionId].orders_count += 1;
        promoStats[promotionId].total_revenue += orderRevenue;
        promoStats[promotionId].order_ids.add(orderId);
      }
      promoStats[promotionId].total_discount += moneyToFloat(promotionItem.discounted_amount);
    }
  }
  const results = Object.entries(promoStats)
    .map(([promotionId, stats]) => {
      const info = promotionMap.get(promotionId) ?? {
        title: `未知活動 (${promotionId})`,
        discount_type: "",
        status: "",
        start_at: null,
        end_at: null,
      };
      const avgDiscount = stats.orders_count ? stats.total_discount / stats.orders_count : 0;
      return {
        promotion_id: promotionId,
        title: info.title,
        discount_type: info.discount_type,
        status: info.status,
        start_at: info.start_at,
        end_at: info.end_at,
        orders_count: stats.orders_count,
        total_revenue: round(stats.total_revenue),
        total_discount: round(stats.total_discount),
        avg_discount_per_order: round(avgDiscount),
        discount_rate: percent(stats.total_discount, stats.total_revenue),
      };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue);
  return {
    period: `${startDate} ~ ${endDate}`,
    total_orders_analyzed: orders.length,
    total_promotions_used: results.length,
    promotions: results,
  };
}

async function getCustomerLifecycle(args: Args): Promise<Record<string, unknown>> {
  const segmentLabels: Record<string, string> = {
    HHH: "Champions（最佳客戶）",
    HHL: "Loyal（高頻低消）",
    HLH: "Big Spender（近期高消）",
    HLL: "New（近期新客）",
    LHH: "At Risk（流失高價值）",
    LHL: "Needs Attention（流失高頻）",
    LLH: "About to Sleep（流失高消）",
    LLL: "Lost（流失低價值）",
  };
  const segmentRank: Record<string, number> = { LLL: 0, LLH: 1, LHL: 2, LHH: 3, HLL: 4, HLH: 5, HHL: 6, HHH: 7 };
  const rDays = numberArg(args, "r_days", 30);
  const fThreshold = numberArg(args, "f_threshold", 2);
  const mThreshold = numberArg(args, "m_threshold", 5000);
  const label = (segment: string) => `${segment} (${segmentLabels[segment] ?? segment})`;
  const computeRfm = async (startDate: string, endDate: string) => {
    const refDate = parseDate(`${endDate}T23:59:59Z`);
    const orders = validRevenueOrders(await searchOrders(startDate, endDate, 20));
    const customers: Record<string, { name: string; orders: string[]; total_spent: number }> = {};
    for (const order of orders) {
      const customerId = String(order.customer_id ?? "");
      if (!customerId) continue;
      customers[customerId] ??= { name: "", orders: [], total_spent: 0 };
      customers[customerId].name = String(order.customer_name ?? "");
      customers[customerId].orders.push(String(order.created_at ?? ""));
      customers[customerId].total_spent += moneyToFloat(order.total);
    }
    const rfm: Record<string, { name: string; segment: string; recency: number; frequency: number; monetary: number }> = {};
    for (const [customerId, customer] of Object.entries(customers)) {
      const dates = customer.orders.filter(Boolean).sort();
      const latest = dates.at(-1);
      const recency = latest ? daysBetween(parseDate(latest), refDate) : 999;
      const frequency = dates.length;
      const monetary = customer.total_spent;
      const segment = `${recency <= rDays ? "H" : "L"}${frequency >= fThreshold ? "H" : "L"}${monetary >= mThreshold ? "H" : "L"}`;
      rfm[customerId] = { name: customer.name, segment, recency, frequency, monetary: round(monetary) };
    }
    return rfm;
  };
  const rfm1 = await computeRfm(stringArg(args, "period1_start"), stringArg(args, "period1_end"));
  const rfm2 = await computeRfm(stringArg(args, "period2_start"), stringArg(args, "period2_end"));
  const migration: Record<string, { from_segment: string; to_segment: string; count: number }> = {};
  const upgradeCustomers: Record<string, unknown>[] = [];
  const churnCustomers: Record<string, unknown>[] = [];
  let newCount = 0;
  let lostCount = 0;
  for (const customerId of new Set([...Object.keys(rfm1), ...Object.keys(rfm2)])) {
    const period1 = rfm1[customerId];
    const period2 = rfm2[customerId];
    if (period1 && period2) {
      const key = `${period1.segment}->${period2.segment}`;
      migration[key] ??= { from_segment: label(period1.segment), to_segment: label(period2.segment), count: 0 };
      migration[key].count += 1;
      const rank1 = segmentRank[period1.segment] ?? 0;
      const rank2 = segmentRank[period2.segment] ?? 0;
      if (rank2 > rank1) {
        upgradeCustomers.push({
          customer_id: customerId,
          name: period2.name,
          from_segment: label(period1.segment),
          to_segment: label(period2.segment),
        });
      } else if (rank2 < rank1) {
        churnCustomers.push({
          customer_id: customerId,
          name: period2.name,
          from_segment: label(period1.segment),
          to_segment: label(period2.segment),
        });
      }
    } else if (!period1 && period2) {
      newCount += 1;
    } else if (period1 && !period2) {
      lostCount += 1;
    }
  }
  const distribution = (rfm: Record<string, { segment: string }>) => {
    const counts: Record<string, number> = {};
    for (const customer of Object.values(rfm)) increment(counts, label(customer.segment));
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
  };
  return {
    period1: `${args.period1_start} ~ ${args.period1_end}`,
    period2: `${args.period2_start} ~ ${args.period2_end}`,
    thresholds: { recency_days: rDays, frequency: fThreshold, monetary: mThreshold },
    period1_customers: Object.keys(rfm1).length,
    period2_customers: Object.keys(rfm2).length,
    period1_distribution: distribution(rfm1),
    period2_distribution: distribution(rfm2),
    upgrade_count: upgradeCustomers.length,
    churn_count: churnCustomers.length,
    new_count: newCount,
    lost_count: lostCount,
    segment_migration: Object.values(migration)
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    top_upgrades: upgradeCustomers.slice(0, 10),
    top_churns: churnCustomers.slice(0, 10),
  };
}

async function getSlowMovers(args: Args): Promise<Record<string, unknown>> {
  const startDate = stringArg(args, "start_date");
  const endDate = stringArg(args, "end_date");
  const daysThreshold = numberArg(args, "days_threshold", 30);
  const periodDays = dateRangeDays(startDate, endDate);
  const products = await endpointItems("products", { max_results: 50 });
  const orders = validRevenueOrders(await searchOrders(startDate, endDate, 20));
  const salesByProduct: Record<string, number> = {};
  for (const order of orders) {
    for (const rawItem of asArray(order.subtotal_items)) {
      const item = asRecord(rawItem);
      const productId = orderItemProductId(item);
      if (productId) increment(salesByProduct, productId, Number(item.quantity ?? 1));
    }
  }
  const withStock = products.filter((product) => stockQuantity(product) > 0);
  const slowMovers = withStock
    .map((product) => {
      const productId = String(product.id ?? "");
      const currentStock = stockQuantity(product);
      const unitsSold = salesByProduct[productId] ?? 0;
      const dailyAvgSales = unitsSold / periodDays;
      const daysOfSupply = dailyAvgSales > 0 ? currentStock / dailyAvgSales : Number.POSITIVE_INFINITY;
      return {
        product_id: product.id,
        title: getTranslation(product.title_translations),
        sku: product.sku ?? "",
        brand: product.brand ?? "",
        current_stock: currentStock,
        units_sold: unitsSold,
        daily_avg_sales: round(dailyAvgSales),
        days_of_supply: Number.isFinite(daysOfSupply) ? round(daysOfSupply, 1) : "無銷售",
        status: unitsSold === 0 ? "零銷售" : "滯銷",
        is_slow: !Number.isFinite(daysOfSupply) || daysOfSupply > daysThreshold,
      };
    })
    .filter((product) => product.is_slow)
    .map(({ is_slow: _isSlow, ...product }) => product)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "零銷售" ? -1 : 1;
      return Number(b.current_stock) - Number(a.current_stock);
    });
  return {
    period: `${startDate} ~ ${endDate}`,
    period_days: periodDays,
    days_threshold: daysThreshold,
    total_products_with_stock: withStock.length,
    slow_movers_count: slowMovers.length,
    zero_sales_count: slowMovers.filter((product) => product.status === "零銷售").length,
    slow_movers: slowMovers,
  };
}

async function getCategoryTree(): Promise<Record<string, unknown>> {
  const categories = await endpointItems("categories", { max_results: 50 });
  const flat = categories.map((category) => ({
    id: category.id,
    name: commonTitle(category),
    parent_id: category.parent_id,
    position: category.position,
    children: asArray(category.children),
  }));
  const roots = flat.filter((category) => !category.parent_id);
  return { total: flat.length, tree: roots, flat };
}

async function getCategoryDetail(args: Args): Promise<Record<string, unknown>> {
  const category = await apiGet("category_detail", undefined, { category_id: args.category_id });
  return {
    id: category.id,
    name: commonTitle(category),
    parent_id: category.parent_id,
    description: getTranslation(category.description_translations) || category.description,
    position: category.position,
    image_url: category.image_url,
    created_at: category.created_at,
    updated_at: category.updated_at,
  };
}

async function listChannels(): Promise<Record<string, unknown>> {
  const channels = await endpointItems("channels");
  return simpleCountList(
    "channels",
    channels.map((channel) => ({
      id: channel.id,
      name: getTranslation(channel.name_translations) || channel.name,
      channel_type: channel.channel_type,
      enabled: channel.enabled,
      created_at: channel.created_at,
      updated_at: channel.updated_at,
    })),
  );
}

async function getChannelDetail(args: Args): Promise<Record<string, unknown>> {
  const channel = await apiGet("channel_detail", undefined, { channel_id: args.channel_id });
  return {
    id: channel.id,
    name: getTranslation(channel.name_translations) || channel.name,
    channel_type: channel.channel_type,
    enabled: channel.enabled,
    created_at: channel.created_at,
    updated_at: channel.updated_at,
  };
}

async function listConversations(args: Args): Promise<Record<string, unknown>> {
  const conversations = await endpointItems("conversations", args);
  return foundList("conversations", conversations, conversations);
}

async function getConversationMessages(args: Args): Promise<Record<string, unknown>> {
  const messages = await endpointItems("conversation_messages", args, { conversation_id: args.conversation_id });
  return { conversation_id: args.conversation_id, total_found: messages.length, returned: messages.length, messages };
}

async function listCustomFields(): Promise<Record<string, unknown>> {
  const fields = await endpointItems("custom_fields");
  return simpleCountList(
    "fields",
    fields.map((field) => ({
      id: field.id,
      name: getTranslation(field.name_translations) || field.name,
      type: field.type,
      options: field.options ?? [],
      required: field.required,
    })),
  );
}

async function listCustomerGroups(args: Args): Promise<Record<string, unknown>> {
  const groups = args.search_keyword
    ? itemsFrom(await apiGet("customer_groups_search", { keyword: args.search_keyword, per_page: Math.min(maxResultsArg(args), 50) }), "items").map(asRecord)
    : await endpointItems("customer_groups", args);
  return foundList(
    "groups",
    groups,
    groups.map((group) => ({
      id: group.id,
      name: group.name,
      customers_count: group.customers_count ?? asArray(group.customer_ids).length,
      created_at: group.created_at,
    })),
  );
}

async function getCustomerGroupMembers(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("customer_group_customers", undefined, { group_id: args.group_id });
  const members = itemsFrom(data, "items").map(asRecord);
  const ids = members.map((member) => member.id ?? member.customer_id).filter(Boolean);
  return { group_id: args.group_id, total_members: ids.length, customer_ids: ids };
}

async function listDeliveryOptions(): Promise<Record<string, unknown>> {
  const options = await endpointItems("delivery_options");
  return simpleCountList("delivery_options", options);
}

async function getDeliveryOptionDetail(args: Args): Promise<Record<string, unknown>> {
  const option = await apiGet("delivery_option_detail", undefined, { delivery_option_id: args.delivery_option_id });
  return {
    id: option.id,
    name: getTranslation(option.name_translations) || option.name,
    delivery_type: option.delivery_type,
    enabled: option.enabled,
    position: option.position,
    price: moneyToFloat(option.price),
    weight_limit: option.weight_limit,
    regions: option.regions ?? [],
    created_at: option.created_at,
    updated_at: option.updated_at,
  };
}

async function getDeliveryTimeSlots(args: Args): Promise<Record<string, unknown>> {
  const slots = await endpointItems("delivery_option_time_slots", args, { delivery_option_id: args.delivery_option_id });
  return { delivery_option_id: args.delivery_option_id, total: slots.length, time_slots: slots };
}

async function getFlashPriceCampaignDetail(args: Args): Promise<Record<string, unknown>> {
  return campaignDetail(await apiGet("flash_price_campaign_detail", undefined, { campaign_id: args.campaign_id }));
}

async function listMemberPointRules(): Promise<Record<string, unknown>> {
  const rules = await endpointItems("member_point_rules");
  return simpleCountList("rules", rules);
}

async function listMembershipTiers(): Promise<Record<string, unknown>> {
  const tiers = await endpointItems("membership_tiers");
  return simpleCountList("tiers", tiers);
}

async function getCustomerTierHistory(args: Args): Promise<Record<string, unknown>> {
  const history = await endpointItems("customer_membership_tier_history", args, { customer_id: args.customer_id });
  return { customer_id: args.customer_id, total_changes: history.length, history };
}

async function listMerchants(): Promise<Record<string, unknown>> {
  const merchants = await endpointItems("merchants");
  return simpleCountList(
    "merchants",
    merchants.map((merchant) => ({
      id: merchant.id,
      name: getTranslation(merchant.name_translations) || merchant.name,
      handle: merchant.handle,
      currency: merchant.currency,
      locale: merchant.locale,
      created_at: merchant.created_at,
    })),
  );
}

async function getMerchantDetail(args: Args): Promise<Record<string, unknown>> {
  const merchant = await apiGet("merchant_detail", undefined, { merchant_id: args.merchant_id });
  return {
    id: merchant.id,
    name: getTranslation(merchant.name_translations) || merchant.name,
    handle: merchant.handle,
    currency: merchant.currency,
    locale: merchant.locale,
    country: merchant.country,
    timezone: merchant.timezone,
    email: merchant.email,
    phone: merchant.phone,
    address: merchant.address,
    created_at: merchant.created_at,
    updated_at: merchant.updated_at,
  };
}

async function getOrderDelivery(args: Args): Promise<Record<string, unknown>> {
  const delivery = await apiGet("order_delivery_detail", undefined, { delivery_id: args.delivery_id });
  return {
    id: delivery.id,
    status: delivery.status,
    tracking_number: delivery.tracking_number,
    tracking_url: delivery.tracking_url,
    carrier: delivery.carrier,
    shipping_address: delivery.shipping_address,
    line_items: delivery.line_items ?? [],
    created_at: delivery.created_at,
    updated_at: delivery.updated_at,
  };
}

async function getOrderTags(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("order_tags", undefined, { order_id: args.order_id });
  return { order_id: args.order_id, tags: data.tags ?? itemsFrom(data, "items") };
}

async function getOrderActionLogs(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("order_action_logs", undefined, { order_id: args.order_id });
  const logs = itemsFrom(data, "items", "logs").map(asRecord);
  return { order_id: args.order_id, total: logs.length, logs };
}

async function getOrderTransactions(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("order_transactions", undefined, { order_id: args.order_id });
  const transactions = itemsFrom(data, "items", "transactions").map(asRecord);
  return { order_id: args.order_id, total: transactions.length, transactions };
}

async function listPayments(): Promise<Record<string, unknown>> {
  const payments = await endpointItems("payments");
  return simpleCountList("payments", payments);
}

async function getStockByWarehouse(args: Args): Promise<Record<string, unknown>> {
  const warehouses = await endpointItems("warehouses", { max_results: 50 });
  const warehouseMap = new Map(warehouses.map((warehouse) => [String(warehouse.id), String(warehouse.name ?? warehouse.id ?? "")]));
  const products = args.product_id ? [asRecord({ id: args.product_id })] : await endpointItems("products", { max_results: 50 });
  const productStocks: Record<string, unknown>[] = [];
  for (const product of products.slice(0, 50)) {
    const productId = String(product.id ?? args.product_id ?? "");
    if (!productId) continue;
    try {
      const stockData = await apiGet("product_stocks", undefined, { product_id: productId });
      productStocks.push({ ...stockData, id: stockData.id ?? productId });
    } catch {
      continue;
    }
  }
  const warehouseTotals: Record<string, { total_quantity: number; sku_count: number; oos_skus: number }> = {};
  const details: Record<string, unknown>[] = [];
  for (const productStock of productStocks) {
    const title = getTranslation(productStock.title_translations);
    const productId = String(productStock.id ?? "");
    for (const variation of stockVariations(productStock)) {
      const fields = zhHantFields(variation);
      const variantDetail: Record<string, unknown> = {
        product_title: title,
        product_id: productId,
        sku: variation.sku ?? "",
        color: fields[0] ?? "",
        size: fields[1] ?? "",
        warehouses: {},
      };
      const variantWarehouses = asRecord(variantDetail.warehouses);
      for (const rawStock of asArray(variation.stocks)) {
        const stock = asRecord(rawStock);
        const warehouseId = String(stock.warehouse_id ?? "");
        if (args.warehouse_id && warehouseId !== args.warehouse_id) continue;
        const quantity = Number(stock.quantity ?? 0);
        const warehouseName = warehouseMap.get(warehouseId) ?? warehouseId;
        variantWarehouses[warehouseName] = quantity;
        warehouseTotals[warehouseName] ??= { total_quantity: 0, sku_count: 0, oos_skus: 0 };
        warehouseTotals[warehouseName].total_quantity += quantity;
        warehouseTotals[warehouseName].sku_count += 1;
        if (quantity === 0) warehouseTotals[warehouseName].oos_skus += 1;
      }
      if (Object.keys(variantWarehouses).length) details.push(variantDetail);
    }
  }
  return {
    products_queried: productStocks.length,
    total_variants: details.length,
    warehouse_summary: Object.fromEntries(Object.entries(warehouseTotals).sort((a, b) => b[1].total_quantity - a[1].total_quantity)),
    details: details.slice(0, 100),
  };
}

async function getLockedInventory(): Promise<Record<string, unknown>> {
  const data = await apiGet("products_locked_inventory");
  const items = itemsFrom(data, "items").map(asRecord);
  return { total: items.length, items };
}

async function listPurchaseOrders(args: Args): Promise<Record<string, unknown>> {
  const orders = await endpointItems("purchase_orders", args);
  return foundList("purchase_orders", orders, orders);
}

async function getPurchaseOrderDetail(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("purchase_order_detail", undefined, { purchase_order_id: args.purchase_order_id });
  const items = asArray(data.items).map(asRecord);
  return {
    id: data.id,
    status: data.status,
    created_at: data.created_at,
    total: moneyToFloat(data.total),
    items_count: items.length,
    items,
  };
}

async function getPromotionDetail(args: Args): Promise<Record<string, unknown>> {
  const promotion = await apiGet("promotion_detail", undefined, { promotion_id: args.promotion_id });
  return {
    ...campaignDetail(promotion),
    target_type: promotion.target_type,
    usage_count: promotion.usage_count,
    usage_limit: promotion.usage_limit,
    user_usage_limit: promotion.user_usage_limit,
    coupon_code: promotion.coupon_code,
  };
}

async function listReturnOrders(args: Args): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  if (args.start_date) params.created_after = args.start_date;
  if (args.end_date) params.created_before = args.end_date;
  const orders = await endpointItems("return_orders", args, undefined, params);
  return foundList("return_orders", orders, orders);
}

async function getReturnOrderDetail(args: Args): Promise<Record<string, unknown>> {
  const order = await apiGet("return_order_detail", undefined, { return_order_id: args.return_order_id });
  return {
    id: order.id,
    status: order.status,
    reason: order.reason,
    order_id: order.order_id,
    total: moneyToFloat(order.total),
    refund_amount: moneyToFloat(order.refund_amount),
    line_items: asArray(order.items).map(asRecord),
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

async function listProductReviews(args: Args): Promise<Record<string, unknown>> {
  const reviews = await endpointItems("product_review_comments", args);
  return foundList("reviews", reviews, reviews);
}

async function getProductReviewDetail(args: Args): Promise<Record<string, unknown>> {
  const review = await apiGet("product_review_comment_detail", undefined, { comment_id: args.comment_id });
  return {
    id: review.id,
    product_id: review.product_id,
    product_name: getTranslation(review.product_title_translations) || review.product_title,
    rating: review.rating,
    content: review.content,
    reviewer_name: review.reviewer_name ?? review.author,
    status: review.status,
    reply: review.reply,
    images: review.images ?? [],
    created_at: review.created_at,
    updated_at: review.updated_at,
  };
}

async function getAppSettings(): Promise<Record<string, unknown>> {
  return { settings: await apiGet("settings_app") };
}

async function getStaffPermissions(args: Args): Promise<Record<string, unknown>> {
  const data = await apiGet("staff_permissions", undefined, { staff_id: args.staff_id });
  return { staff_id: args.staff_id, permissions: data.permissions ?? data };
}

async function listStoreCredits(args: Args): Promise<Record<string, unknown>> {
  const credits = await endpointItems("user_credits", args);
  const totalBalance = credits.reduce((sum, credit) => sum + moneyToFloat(credit.balance), 0);
  return { total_found: credits.length, returned: credits.length, total_balance: round(totalBalance), credits };
}

async function getProductSubscriptionDetail(args: Args): Promise<Record<string, unknown>> {
  const subscription = await apiGet("product_subscription_detail", undefined, { subscription_id: args.subscription_id });
  return {
    id: subscription.id,
    customer_id: subscription.customer_id,
    product_id: subscription.product_id,
    variant_id: subscription.variant_id,
    status: subscription.status,
    frequency: subscription.frequency,
    frequency_unit: subscription.frequency_unit,
    quantity: subscription.quantity,
    price: moneyToFloat(subscription.price),
    next_billing_at: subscription.next_billing_at,
    last_billed_at: subscription.last_billed_at,
    payment_method: subscription.payment_method,
    shipping_address: subscription.shipping_address,
    created_at: subscription.created_at,
    updated_at: subscription.updated_at,
  };
}

async function listTaxes(): Promise<Record<string, unknown>> {
  const taxes = await endpointItems("taxes");
  return simpleCountList("taxes", taxes);
}

async function getTokenInfo(): Promise<Record<string, unknown>> {
  return { token_info: await apiGet("token_info") };
}

async function createCustomer(args: Args): Promise<Record<string, unknown>> {
  const name = stringArg(args, "name");
  const body: Record<string, unknown> = { name };
  for (const key of ["email", "phone", "gender", "birthday", "tags"]) {
    if (hasValue(args[key])) body[key] = args[key];
  }

  const customer = itemOrSelf(await apiPost("customer_create", body));
  return {
    success: true,
    resource_id: String(customer.id ?? ""),
    message: `客戶 ${name} 建立成功`,
    customer,
  };
}

async function updateCustomer(args: Args): Promise<Record<string, unknown>> {
  const customerId = stringArg(args, "customer_id");
  const body: Record<string, unknown> = {};
  for (const key of ["name", "email", "phone", "gender", "birthday"]) {
    if (args[key] !== undefined && args[key] !== null) body[key] = args[key];
  }

  if (!Object.keys(body).length) {
    return { success: false, resource_id: customerId, message: "未提供任何要更新的欄位" };
  }

  await apiPut("customer_update", body, undefined, { customer_id: customerId });
  return { success: true, resource_id: customerId, message: `客戶 ${customerId} 資料已更新` };
}

async function updateCustomerStoreCredits(args: Args): Promise<Record<string, unknown>> {
  const customerId = stringArg(args, "customer_id");
  const amount = Number(args.amount);
  const body: Record<string, unknown> = { amount };
  if (hasValue(args.note)) body.note = args.note;

  await apiPut("customer_store_credits_update", body, undefined, { customer_id: customerId });
  return {
    success: true,
    resource_id: customerId,
    message: `客戶 ${customerId} 儲值金已調整 ${amount >= 0 ? "+" : ""}${amount.toFixed(2)}`,
  };
}

async function adjustCustomerMemberPoints(args: Args): Promise<Record<string, unknown>> {
  const customerId = stringArg(args, "customer_id");
  const points = Number(args.points);
  const body: Record<string, unknown> = { points };
  if (hasValue(args.note)) body.note = args.note;

  await apiPut("customer_member_points_update", body, undefined, { customer_id: customerId });
  return {
    success: true,
    resource_id: customerId,
    message: `客戶 ${customerId} 點數已調整 ${points >= 0 ? "+" : ""}${points} 點`,
  };
}

async function cancelOrder(args: Args): Promise<Record<string, unknown>> {
  const orderId = stringArg(args, "order_id");
  const body: Record<string, unknown> = {};
  if (args.reason !== undefined && args.reason !== null) body.reason = args.reason;

  const order = itemOrSelf(await apiPost("order_cancel", body, undefined, { order_id: orderId }));
  return {
    success: true,
    resource_id: String(order.id ?? orderId),
    message: `訂單 ${orderId} 已取消`,
  };
}

async function bulkExecuteShipment(args: Args): Promise<Record<string, unknown>> {
  const orderIds = asArray(args.order_ids).map(String);
  await apiPost("orders_shipment_bulk", { order_ids: orderIds });
  return {
    success: true,
    resource_id: orderIds.join(","),
    message: `批次出貨成功，共 ${orderIds.length} 筆訂單`,
    order_ids: orderIds,
  };
}

async function updateOrderStatus(args: Args): Promise<Record<string, unknown>> {
  const orderId = stringArg(args, "order_id");
  const updatedFields: string[] = [];

  if (args.status === undefined && args.delivery_status === undefined && args.payment_status === undefined) {
    return {
      success: false,
      resource_id: orderId,
      message: "未提供任何狀態參數，至少需傳入一個狀態欄位",
      updated_fields: [],
    };
  }

  if (args.status !== undefined && args.status !== null) {
    await apiPatch("order_status", { status: args.status }, undefined, { order_id: orderId });
    updatedFields.push("status");
  }
  if (args.delivery_status !== undefined && args.delivery_status !== null) {
    await apiPatch("order_delivery_status", { delivery_status: args.delivery_status }, undefined, { order_id: orderId });
    updatedFields.push("delivery_status");
  }
  if (args.payment_status !== undefined && args.payment_status !== null) {
    await apiPatch("order_payment_status", { payment_status: args.payment_status }, undefined, { order_id: orderId });
    updatedFields.push("payment_status");
  }

  if (!updatedFields.length) {
    return {
      success: false,
      resource_id: orderId,
      message: "未提供任何狀態參數，至少需傳入一個狀態欄位",
      updated_fields: [],
    };
  }

  return {
    success: true,
    resource_id: orderId,
    message: `訂單 ${orderId} 狀態已更新：${updatedFields.join(", ")}`,
    updated_fields: updatedFields,
  };
}

async function deletePurchaseOrders(args: Args): Promise<Record<string, unknown>> {
  const purchaseOrderIds = asArray(args.purchase_order_ids).map(String);
  if (!purchaseOrderIds.length) {
    return { success: false, resource_id: "", message: "未提供任何採購單 ID" };
  }

  await apiDelete("purchase_order_delete", undefined, undefined, { ids: purchaseOrderIds });
  const ids = purchaseOrderIds.join(", ");
  return {
    success: true,
    resource_id: ids,
    message: `採購單已刪除（共 ${purchaseOrderIds.length} 筆）：${ids}`,
  };
}

export const customHandlers: Record<string, Handler> = {
  query_orders: queryOrders,
  get_sales_summary: getSalesSummary,
  get_top_products: getTopProducts,
  get_sales_trend: getSalesTrend,
  get_channel_comparison: getChannelComparison,
  get_order_detail: getOrderDetail,
  get_refund_summary: getRefundSummary,
  get_archived_orders: getArchivedOrders,
  get_product_list: getProductList,
  get_product_variants: getProductVariants,
  get_inventory_overview: getInventoryOverview,
  get_low_stock_alerts: getLowStockAlerts,
  get_warehouses: getWarehouses,
  get_rfm_analysis: getRfmAnalysis,
  get_repurchase_analysis: getRepurchaseAnalysis,
  get_customer_geo_analysis: getCustomerGeoAnalysis,
  get_inventory_turnover: getInventoryTurnover,
  get_category_sales: getCategorySales,
  get_promotion_analysis: getPromotionAnalysis,
  get_refund_by_store: getRefundByStore,
  get_stock_transfer_suggestions: getStockTransferSuggestions,
  get_promotion_roi: getPromotionRoi,
  get_customer_lifecycle: getCustomerLifecycle,
  get_slow_movers: getSlowMovers,
  list_customers: listCustomers,
  get_customer_profile: getCustomerProfile,
  list_agents: listAgents,
  get_affiliate_campaign_detail: getAffiliateCampaignDetail,
  get_affiliate_campaign_usage: getAffiliateCampaignUsage,
  get_category_tree: getCategoryTree,
  get_category_detail: getCategoryDetail,
  list_channels: listChannels,
  get_channel_detail: getChannelDetail,
  list_conversations: listConversations,
  get_conversation_messages: getConversationMessages,
  list_custom_fields: listCustomFields,
  list_customer_groups: listCustomerGroups,
  get_customer_group_members: getCustomerGroupMembers,
  list_delivery_options: listDeliveryOptions,
  get_delivery_option_detail: getDeliveryOptionDetail,
  get_delivery_time_slots: getDeliveryTimeSlots,
  get_flash_price_campaign_detail: getFlashPriceCampaignDetail,
  list_member_point_rules: listMemberPointRules,
  list_membership_tiers: listMembershipTiers,
  get_customer_tier_history: getCustomerTierHistory,
  list_merchants: listMerchants,
  get_merchant_detail: getMerchantDetail,
  get_order_delivery: getOrderDelivery,
  get_order_tags: getOrderTags,
  get_order_action_logs: getOrderActionLogs,
  get_order_transactions: getOrderTransactions,
  list_payments: listPayments,
  get_stock_by_warehouse: getStockByWarehouse,
  get_locked_inventory: getLockedInventory,
  list_purchase_orders: listPurchaseOrders,
  get_purchase_order_detail: getPurchaseOrderDetail,
  get_promotion_detail: getPromotionDetail,
  list_return_orders: listReturnOrders,
  get_return_order_detail: getReturnOrderDetail,
  list_product_reviews: listProductReviews,
  get_product_review_detail: getProductReviewDetail,
  get_app_settings: getAppSettings,
  get_staff_permissions: getStaffPermissions,
  list_store_credits: listStoreCredits,
  get_product_subscription_detail: getProductSubscriptionDetail,
  list_taxes: listTaxes,
  get_token_info: getTokenInfo,
  create_customer: createCustomer,
  update_customer: updateCustomer,
  update_customer_store_credits: updateCustomerStoreCredits,
  adjust_customer_member_points: adjustCustomerMemberPoints,
  cancel_order: cancelOrder,
  bulk_execute_shipment: bulkExecuteShipment,
  update_order_status: updateOrderStatus,
  delete_purchase_orders: deletePurchaseOrders,
};
