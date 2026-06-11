import { apiGet, fetchAllPages } from "../client.js";
import {
  asArray,
  asRecord,
  dateOnly,
  daysBetween,
  getTranslation,
  increment,
  itemsFrom,
  moneyToFloat,
  pageCountForLimit,
  parseDate,
  percent,
  round,
  sortObjectByValueDesc,
  sumQuantity,
  VALID_ORDER_STATUSES,
} from "../shared/helpers.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<Record<string, unknown>>;

function stringArg(args: Args, key: string, fallback = ""): string {
  return String(args[key] ?? fallback);
}

function numberArg(args: Args, key: string, fallback: number): number {
  const value = Number(args[key] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function periodParams(startDate: string, endDate: string): Record<string, string> {
  return {
    created_after: `${startDate}T00:00:00Z`,
    created_before: `${endDate}T23:59:59Z`,
  };
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
  list_customers: listCustomers,
  get_customer_profile: getCustomerProfile,
};
