const partnerState = {
  shopId: "",
  name: "",
  label: "",
  shopStatus: "",
  memberRole: "",
  user: null,
  memberships: [],
  shops: [],
  categories: [],
  dashboard: null,
  inventory: [],
  orders: [],
  allOrders: [],
  products: [],
  orderBucket: "active",
  selectedOrderId: "",
  orderRefreshTimer: null,
  orderRefreshInFlight: false,
  notifications: [],
  notificationsInitialized: false,
  seenNotificationIds: new Set(),
  notificationToastTimer: null,
  unsubscribe: null,
  productUnsubscribe: null,
  profileAddress: ""
};

const PARTNER_API_ROOT = `http://${window.location.hostname || "localhost"}:5000/api`;
const PARTNER_API_BASE_URL = `${PARTNER_API_ROOT}/partner`;

function getPartnerAccessToken() {
  return sessionStorage.getItem("partner_user_access_token") || "";
}

async function partnerAuthRequest(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const token = getPartnerAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${PARTNER_API_ROOT}/auth${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Authentication request failed (${response.status}).`);
  return payload;
}

function showPartnerAuthMessage(message, isError = false) {
  const element = document.getElementById("partnerAuthMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("text-rose-600", isError);
  element.classList.toggle("text-slate-500", !isError);
}

async function requestPartnerLoginCode(event) {
  event.preventDefault();
  const phone = document.getElementById("partnerLoginPhone").value.trim();
  try {
    const result = await partnerAuthRequest("/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone_e164: phone })
    });
    document.getElementById("partnerOtpField").hidden = false;
    document.getElementById("partnerVerifyOtpButton").hidden = false;
    if (result.development_otp) {
      document.getElementById("partnerLoginOtp").value = result.development_otp;
      showPartnerAuthMessage("Development verification code filled in.");
    } else {
      showPartnerAuthMessage("If the account is eligible, a verification code will be sent.");
    }
  } catch (error) {
    showPartnerAuthMessage(error.message, true);
  }
}

async function verifyPartnerLoginCode() {
  const phone = document.getElementById("partnerLoginPhone").value.trim();
  const otp = document.getElementById("partnerLoginOtp").value.trim();
  try {
    const result = await partnerAuthRequest("/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone_e164: phone, purpose: "LOGIN", otp })
    });
    sessionStorage.setItem("partner_user_access_token", result.access_token);
    await loadPartnerRestaurants();
  } catch (error) {
    showPartnerAuthMessage(error.message, true);
  }
}

async function signOutPartner() {
  try {
    await partnerAuthRequest("/logout", { method: "POST" });
  } catch (error) {
    console.warn("Partner sign-out request failed:", error.message);
  }
  sessionStorage.removeItem("partner_user_access_token");
  closePartnerDesk();
  partnerState.user = null;
  partnerState.memberships = [];
  partnerState.shops = [];
  partnerState.dashboard = null;
  partnerState.inventory = [];
  partnerState.notifications = [];
  partnerState.notificationsInitialized = false;
  partnerState.seenNotificationIds.clear();
  partnerState.selectedOrderId = "";
  await loadPartnerRestaurants();
}

async function partnerApiRequest(path, options = {}) {
  const headers = { Accept: "application/json" };
  const token = getPartnerAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${PARTNER_API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Partner API request failed (${response.status}).`);
  return payload?.data;
}

function isPartnerNotificationUnread(notification) {
  return notification?.read_at == null && notification?.status !== "READ";
}

function formatPartnerNotificationTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "";
}

function renderPartnerNotifications() {
  const list = document.getElementById("partnerNotificationList");
  const unreadCount = partnerState.notifications.filter(isPartnerNotificationUnread).length;
  const badge = document.getElementById("partnerNotificationBadge");
  const markAllButton = document.getElementById("partnerMarkAllReadButton");
  const summary = document.getElementById("partnerNotificationSummary");
  badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
  badge.hidden = unreadCount === 0;
  markAllButton.disabled = unreadCount === 0;
  summary.textContent = unreadCount ? `${unreadCount} unread` : "No new notifications";

  if (!partnerState.notifications.length) {
    list.innerHTML = '<p class="partner-notification-empty">No new notifications</p>';
    return;
  }
  list.innerHTML = partnerState.notifications.map(notification => {
    const unread = isPartnerNotificationUnread(notification);
    return `<button type="button" class="partner-notification-item ${unread ? "is-unread" : ""}" data-notification-id="${escapePartnerHtml(notification.id)}">
      <span class="partner-notification-dot" aria-hidden="true"></span>
      <span class="partner-notification-copy"><strong>${escapePartnerHtml(notification.title || "MyShopzy notification")}</strong><span>${escapePartnerHtml(notification.body || "")}</span><small>${escapePartnerHtml(formatPartnerNotificationTime(notification.created_at))}</small></span>
    </button>`;
  }).join("");
}

async function refreshPartnerNotifications(announceNew = false) {
  if (!getPartnerAccessToken() || !partnerState.shopId || document.visibilityState === "hidden") return;
  const token = getPartnerAccessToken();
  const shopId = partnerState.shopId;
  try {
    const rows = await partnerApiRequest("/notifications");
    if (token !== getPartnerAccessToken() || shopId !== partnerState.shopId) return;
    const notifications = Array.isArray(rows) ? rows : [];
    const newlyUnread = notifications.filter(notification => isPartnerNotificationUnread(notification)
      && !partnerState.seenNotificationIds.has(notification.id));
    if (announceNew && partnerState.notificationsInitialized) {
      newlyUnread.slice(0, 1).forEach(showPartnerNotificationToast);
    }
    notifications.forEach(notification => partnerState.seenNotificationIds.add(notification.id));
    partnerState.notifications = notifications;
    partnerState.notificationsInitialized = true;
    renderPartnerNotifications();
  } catch (error) {
    console.warn("Partner notifications could not be loaded:", error.message);
  }
}

function showPartnerNotificationToast(notification) {
  const toast = document.getElementById("partnerNotificationToast");
  if (!toast) return;
  document.getElementById("partnerToastTitle").textContent = notification.title || "New MyShopzy alert";
  document.getElementById("partnerToastMessage").textContent = notification.body || "Open notifications to view details.";
  toast.hidden = false;
  if (partnerState.notificationToastTimer) window.clearTimeout(partnerState.notificationToastTimer);
  partnerState.notificationToastTimer = window.setTimeout(dismissPartnerToast, 6500);
}

function dismissPartnerToast() {
  const toast = document.getElementById("partnerNotificationToast");
  if (toast) toast.hidden = true;
  if (partnerState.notificationToastTimer) window.clearTimeout(partnerState.notificationToastTimer);
  partnerState.notificationToastTimer = null;
}

function togglePartnerNotificationPanel() {
  const panel = document.getElementById("partnerNotificationPanel");
  const button = document.getElementById("partnerNotificationButton");
  panel.hidden = !panel.hidden;
  button.setAttribute("aria-expanded", String(!panel.hidden));
  if (!panel.hidden) refreshPartnerNotifications(false);
}

function closePartnerNotificationPanel() {
  document.getElementById("partnerNotificationPanel").hidden = true;
  document.getElementById("partnerNotificationButton").setAttribute("aria-expanded", "false");
}

async function markPartnerNotificationRead(notificationId) {
  await partnerApiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH" });
  partnerState.notifications = partnerState.notifications.map(notification => notification.id === notificationId
    ? { ...notification, status: "READ", read_at: notification.read_at || new Date().toISOString() }
    : notification);
  renderPartnerNotifications();
}

async function openPartnerNotification(notificationId) {
  const notification = partnerState.notifications.find(item => item.id === notificationId);
  if (!notification) return;
  try {
    await markPartnerNotificationRead(notificationId);
  } catch (error) {
    console.warn("Partner notification could not be marked read:", error.message);
  }
  closePartnerNotificationPanel();
  const orderId = notification.payload?.order_id;
  if (typeof orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) return;
  const shop = partnerState.shops.find(item => item.id === notification.payload?.shop_id);
  if (!shop) return;
  if (partnerState.shopId !== shop.id) await openPartnerDesk(shop.id);
  partnerState.selectedOrderId = orderId;
  document.getElementById("partnerOrderBucket").value = "all";
  navigatePartnerSection(null, "orders");
}

async function markAllPartnerNotificationsRead() {
  const button = document.getElementById("partnerMarkAllReadButton");
  button.disabled = true;
  try {
    await partnerApiRequest("/notifications/read-all", { method: "PATCH" });
    const readAt = new Date().toISOString();
    partnerState.notifications = partnerState.notifications.map(notification => isPartnerNotificationUnread(notification)
      ? { ...notification, status: "READ", read_at: readAt }
      : notification);
    renderPartnerNotifications();
  } catch (error) {
    console.error("Partner notifications could not be marked read:", error);
    button.disabled = false;
  }
}

function escapePartnerHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadPartnerRestaurants() {
  const token = getPartnerAccessToken();
  const loginScreen = document.getElementById("partnerSetup");
  const app = document.getElementById("partnerApp");
  if (!token) {
    loginScreen.hidden = false;
    app.hidden = true;
    showPartnerAuthMessage("Sign in with an active partner account.");
    return;
  }

  try {
    const identity = await partnerApiRequest("/me");
    partnerState.user = identity?.user || null;
    partnerState.memberships = Array.isArray(identity?.partners) ? identity.partners : [];
    if (!partnerState.memberships.length) throw new Error("Active partner membership required.");
    const shops = await partnerApiRequest("/shops");
    partnerState.shops = Array.isArray(shops) ? shops : [];
    if (!partnerState.shops.length) throw new Error("No active shops are linked to this partner account.");
    const partnerNames = partnerState.memberships.map(partner => partner.display_name).join(", ");
    document.getElementById("partnerAccountName").textContent = partnerState.user?.display_name || "Partner account";
    document.getElementById("partnerIdentityLabel").textContent = partnerNames || "Partner user";
    document.getElementById("partnerAvatar").textContent = (partnerState.user?.display_name || "P").trim().charAt(0).toUpperCase();
    document.getElementById("partnerWelcomeTitle").textContent = partnerState.shops.length === 1
      ? `Welcome, ${partnerState.shops[0].name}`
      : "Restaurant dashboard";
    document.getElementById("partnerHeaderSubtitle").textContent = partnerNames;
    document.getElementById("partnerSettingsUser").textContent = partnerState.user?.display_name || "Partner user";
    document.getElementById("partnerSettingsPartner").textContent = partnerNames || "Partner account";

    const selector = document.getElementById("partnerShopSelect");
    selector.innerHTML = partnerState.shops.map(shop =>
      `<option value="${escapePartnerHtml(shop.id)}">${escapePartnerHtml(shop.name)} · ${escapePartnerHtml(shop.city)}</option>`
    ).join("");
    loginScreen.hidden = true;
    app.hidden = false;
    const selectedShop = partnerState.shops.find(shop => shop.id === partnerState.shopId) || partnerState.shops[0];
    selector.value = selectedShop.id;
    await openPartnerDesk(selectedShop.id);
  } catch (error) {
    console.error("Partner identity or shops could not be loaded:", error);
    loginScreen.hidden = false;
    app.hidden = true;
    showPartnerAuthMessage(error.message, true);
  }
}

async function loadPartnerProductCategories() {
  try {
    const response = await fetch(`${PARTNER_API_ROOT}/categories`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Unable to load categories.");
    partnerState.categories = Array.isArray(payload.data) ? payload.data : [];
    const select = document.getElementById("partnerProductCategory");
    if (!select) return;
    select.innerHTML = '<option value="">No category</option>' + partnerState.categories.map(category =>
      `<option value="${escapePartnerHtml(category.id)}">${escapePartnerHtml(category.name)}</option>`
    ).join("");
    renderPartnerProducts(partnerState.products);
  } catch (error) {
    console.error("Partner product categories could not be loaded:", error);
  }
}

async function openPartnerDesk(shopId = document.getElementById("partnerShopSelect")?.value || "") {
  const shop = partnerState.shops.find(item => item.id === shopId);
  if (!shop) return;

  partnerState.shopId = shop.id;
  partnerState.name = shop.partner_name || "Partner";
  partnerState.label = shop.name || "Partner shop";
  partnerState.shopStatus = shop.status;

  document.getElementById("partnerShopSelect").value = shop.id;
  document.getElementById("partnerWelcomeTitle").textContent = shop.name;
  document.getElementById("partnerDeskTitle").textContent = `${shop.name} orders`;
  document.getElementById("partnerSettingsShop").textContent = shop.name;
  document.getElementById("partnerApp").classList.remove("sidebar-open");
  document.getElementById("partnerSidebarScrim").hidden = true;
  renderPartnerShopStatus();
  await loadPartnerProfile();
  startPartnerOrderRefresh();
}

function closePartnerDesk() {
  stopPartnerOrderRefresh();
  partnerState.orderRefreshInFlight = false;
  partnerState.notifications = [];
  partnerState.notificationsInitialized = false;
  partnerState.seenNotificationIds.clear();
  dismissPartnerToast();
  closePartnerNotificationPanel();
  renderPartnerNotifications();
  partnerState.unsubscribe?.();
  partnerState.unsubscribe = null;
  partnerState.productUnsubscribe?.();
  partnerState.productUnsubscribe = null;
  partnerState.shopId = "";
  document.getElementById("partnerApp").hidden = true;
  document.getElementById("partnerSetup").hidden = false;
}

function switchPartnerView(view) {
  const sections = { orders: "orders", products: "products", profile: "restaurant-info" };
  navigatePartnerSection(null, sections[view] || "dashboard");
}

const partnerPageTitles = {
  dashboard: "Dashboard",
  orders: "Orders",
  products: "Menu / Products",
  inventory: "Inventory",
  "restaurant-info": "Restaurant Info",
  reports: "Sales & Reports",
  reviews: "Ratings & Reviews",
  settings: "Settings"
};

function navigatePartnerSection(event, section) {
  event?.preventDefault();
  if (!partnerPageTitles[section] || !getPartnerAccessToken() || !partnerState.shopId) return;
  const pageIds = {
    dashboard: "partnerDashboardPage",
    orders: "partnerOrdersView",
    products: "partnerProductsView",
    inventory: "partnerInventoryView",
    "restaurant-info": "partnerProfileView",
    reports: "partnerReportsView",
    reviews: "partnerReviewsView",
    settings: "partnerSettingsView"
  };
  document.querySelectorAll(".partner-page").forEach(page => {
    page.hidden = page.id !== pageIds[section];
  });
  document.querySelectorAll(".partner-nav-link[data-section]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.section === section);
  });
  document.getElementById("partnerSectionTitle").textContent = partnerPageTitles[section];
  document.getElementById("partnerApp").classList.remove("sidebar-open");
  if (section === "orders") startPartnerOrderListener(document.getElementById("partnerOrderBucket").value);
  if (section === "products") startPartnerProductListener();
  if (section === "inventory") loadPartnerInventory();
}

function selectPartnerShop(shopId) {
  if (!partnerState.shops.some(shop => shop.id === shopId)) return;
  openPartnerDesk(shopId);
}

function togglePartnerSidebar() {
  document.getElementById("partnerApp").classList.toggle("sidebar-open");
  document.getElementById("partnerSidebarScrim").hidden = false;
}

function closePartnerSidebar() {
  document.getElementById("partnerApp").classList.remove("sidebar-open");
  document.getElementById("partnerSidebarScrim").hidden = true;
}

function startAddPartnerProduct() {
  navigatePartnerSection(null, "products");
  resetPartnerProductForm();
  document.getElementById("partnerProductModalTitle").textContent = "Add Product";
  document.getElementById("partnerProductModal").showModal();
  document.getElementById("partnerProductName").focus();
}

function closePartnerProductModal() {
  document.getElementById("partnerProductModal").close();
}

async function startPartnerProductListener() {
  try {
    const products = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products`);
    partnerState.products = Array.isArray(products) ? products : [];
    renderPartnerProducts(partnerState.products);
    if (partnerState.dashboard) {
      partnerState.dashboard.total_products = partnerState.products.length;
      partnerState.dashboard.active_products = partnerState.products.filter(product => product.status === "ACTIVE").length;
      renderPartnerDashboard(partnerState.dashboard);
    }
  } catch (error) {
    console.error("Partner product load failed:", error);
    document.getElementById("partnerProductsContainer").innerHTML = `<p class="col-span-full text-center text-rose-500 py-8 text-xs">${escapePartnerHtml(error.message)}</p>`;
  }
}

function renderPartnerProducts(products) {
  const container = document.getElementById("partnerProductsContainer");
  if (!container) return;
  container.innerHTML = products.length ? products.map(product => {
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const sourceImage = product.images?.[0]?.public_url || "";
    const imageUrl = (() => { try { const image = new URL(sourceImage); return ["http:", "https:"].includes(image.protocol) && !image.username && !image.password ? image.href : ""; } catch { return ""; } })();
    return `
    <article class="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex gap-3">
      <img src="${escapePartnerHtml(imageUrl)}" class="w-16 h-16 rounded-xl object-contain bg-slate-50" onerror="this.style.display='none'" alt="">
      <div class="flex-1 min-w-0"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><h3 class="text-xs font-black text-slate-900 truncate">${escapePartnerHtml(product.name)}</h3><p class="text-[10px] text-slate-500 mt-1">${escapePartnerHtml(product.status)}</p></div><button type="button" onclick="togglePartnerProductStatus('${escapePartnerHtml(product.id)}','${product.status === "ACTIVE" ? "PAUSED" : "ACTIVE"}')" class="shrink-0 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black">${product.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></div><p class="text-[11px] text-slate-500 mt-1">${escapePartnerHtml(product.description || "")}</p><div class="flex gap-1 mt-2"><button type="button" onclick="editPartnerProduct('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black">Edit product</button><button type="button" onclick="addPartnerVariant('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-cyan-50 text-cyan-900 text-[10px] font-black">Add variant</button></div><div class="mt-2 space-y-2">${variants.map(variant => `<div class="rounded-lg border border-slate-100 p-2"><div class="flex items-center justify-between gap-2"><div><strong class="text-[11px] text-slate-800">${escapePartnerHtml(variant.name || "Variant")}</strong><span class="ml-1 text-[10px] text-slate-500">${escapePartnerHtml(variant.unit_label || "Unit")}</span><p class="text-[11px] text-emerald-700">₹${Number(variant.price || 0).toFixed(2)} · Stock ${Number(variant.quantity_on_hand || 0)}</p></div><div class="flex gap-1"><button type="button" onclick="editPartnerVariant('${escapePartnerHtml(product.id)}','${escapePartnerHtml(variant.id)}')" class="px-2 py-1 rounded bg-slate-100 text-[10px] font-bold">Edit</button><button type="button" onclick="savePartnerVariantAvailability('${escapePartnerHtml(product.id)}','${escapePartnerHtml(variant.id)}',${variant.is_active === false})" class="px-2 py-1 rounded bg-amber-50 text-amber-800 text-[10px] font-bold">${variant.is_active === false ? "Enable" : "Pause"}</button></div></div><div class="flex items-center gap-2 mt-2"><label class="text-[10px] text-slate-500">Stock <input id="partnerStock_${escapePartnerHtml(variant.id)}" type="number" min="0" step="0.001" value="${Number(variant.quantity_on_hand || 0)}" class="w-20 ml-1 px-2 py-1 border border-slate-200 rounded-lg"></label><button type="button" onclick="savePartnerInventory('${escapePartnerHtml(variant.id)}')" class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-[10px] font-black">Update stock</button></div></div>`).join("")}</div></div>
    </article>
  `; }).join("") : '<div class="partner-products-empty"><p>No products added yet</p><button type="button" class="partner-button partner-button-primary" onclick="startAddPartnerProduct()">＋ Add Product</button></div>';

  if (!products.length) return;
  const cards = container.querySelectorAll("article");
  products.forEach((product, index) => {
    const card = cards[index];
    const content = card?.querySelector(".flex-1");
    if (!content) return;
    const image = card.querySelector("img");
    const sourceImage = product.images?.[0]?.public_url || "";
    const imageUrl = (() => { try { const imageValue = new URL(sourceImage); return ["http:", "https:"].includes(imageValue.protocol) && !imageValue.username && !imageValue.password ? imageValue.href : ""; } catch { return ""; } })();
    if (!imageUrl && image) {
      image.hidden = true;
      const fallback = document.createElement("div");
      fallback.className = "partner-product-image-fallback";
      fallback.textContent = (product.name || "P").trim().charAt(0).toUpperCase();
      image.before(fallback);
    }
    const category = partnerState.categories.find(item => item.id === product.category_id)?.name || "Uncategorized";
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const defaultVariant = variants.find(item => item.is_default) || variants[0];
    const availableVariantCount = variants.filter(item => item.is_active !== false).length;
    const availability = variants.length ? `${availableVariantCount}/${variants.length} variants available` : "No variants";
    const details = document.createElement("div");
    details.className = "partner-product-details";
    details.innerHTML = `<span class="partner-product-category">${escapePartnerHtml(category)}</span><span class="partner-product-status-badge ${product.status === "ACTIVE" ? "" : "is-inactive"}">${escapePartnerHtml(product.status || "UNKNOWN")}</span><strong>${defaultVariant ? `₹${Number(defaultVariant.price || 0).toFixed(2)}` : "Price not set"}</strong><span>${escapePartnerHtml(defaultVariant?.unit_label || "")}</span><span class="partner-availability ${availableVariantCount ? "is-available" : "is-unavailable"}">${availability}</span>`;
    const statusLine = content.querySelector("p");
    if (statusLine) statusLine.insertAdjacentElement("afterend", details);
    const actions = document.createElement("div");
    actions.className = "partner-product-actions";
    actions.innerHTML = `<button type="button" class="partner-text-button" onclick="deletePartnerProduct('${escapePartnerHtml(product.id)}')">Deactivate from menu</button>`;
    content.append(actions);
  });
}

async function savePartnerInventory(variantId) {
  if (!variantId) return alert("This product has no active variant to update.");
  const stockInput = document.getElementById(`partnerStock_${variantId}`);
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/inventory/${encodeURIComponent(variantId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        quantity_on_hand: Number(stockInput.value)
      })
    });
    await Promise.all([startPartnerProductListener(), loadPartnerInventory()]);
  } catch (error) {
    console.error("Partner inventory update failed:", error);
    alert(`Unable to update inventory: ${error.message}`);
  }
}

function resetPartnerProductForm() {
  document.getElementById("partnerProductId").value = "";
  document.getElementById("partnerProductName").value = "";
  document.getElementById("partnerProductDescription").value = "";
  document.getElementById("partnerProductVariantId").value = "";
  document.getElementById("partnerProductMode").value = "";
  document.getElementById("partnerProductVariantName").value = "";
  document.getElementById("partnerProductCategory").value = "";
  document.getElementById("partnerProductSku").value = "";
  document.getElementById("partnerProductPrice").value = "";
  document.getElementById("partnerProductComparePrice").value = "";
  document.getElementById("partnerProductUnit").value = "";
  document.getElementById("partnerProductUnitQuantity").value = "1";
  document.getElementById("partnerProductVariantActive").checked = true;
  document.getElementById("partnerProductImage").value = "";
  ["partnerProductName", "partnerProductCategory", "partnerProductDescription", "partnerProductImage"].forEach(id => {
    document.getElementById(id).disabled = false;
  });
  document.querySelector("#partnerProductsView form button[type='submit']").textContent = "Save product";
  document.getElementById("partnerProductModalTitle").textContent = "Add Product";
}

async function savePartnerProduct(event) {
  event.preventDefault();
  const productId = document.getElementById("partnerProductId").value;
  const variantId = document.getElementById("partnerProductVariantId").value;
  const mode = document.getElementById("partnerProductMode").value;
  const name = document.getElementById("partnerProductName").value.trim();
  const compareAtPrice = document.getElementById("partnerProductComparePrice").value;
  const variant = {
    name: document.getElementById("partnerProductVariantName").value.trim() || name,
    sku: document.getElementById("partnerProductSku").value.trim() || null,
    price: Number(document.getElementById("partnerProductPrice").value),
    compare_at_price: compareAtPrice === "" ? null : Number(compareAtPrice),
    unit_label: document.getElementById("partnerProductUnit").value.trim() || "1 pc",
    unit_quantity: Number(document.getElementById("partnerProductUnitQuantity").value),
    is_active: document.getElementById("partnerProductVariantActive").checked
  };
  const imageUrl = document.getElementById("partnerProductImage").value.trim();
  if (imageUrl.startsWith("data:image/")) {
    return alert("PostgreSQL partner catalog images must use a hosted HTTPS URL. Image files are not stored in PostgreSQL.");
  }
  const product = {
    name,
    description: document.getElementById("partnerProductDescription").value.trim() || null,
    category_id: document.getElementById("partnerProductCategory").value || null,
    image_url: imageUrl || null,
    variant
  };
  try {
    if (mode === "add_variant" || mode === "edit_variant") {
      const suffix = `/shops/${encodeURIComponent(partnerState.shopId)}/products/${encodeURIComponent(productId)}/variants${variantId ? `/${encodeURIComponent(variantId)}` : ""}`;
      await partnerApiRequest(suffix, { method: variantId ? "PATCH" : "POST", body: JSON.stringify(variant) });
    } else {
      const suffix = `/shops/${encodeURIComponent(partnerState.shopId)}/products${productId ? `/${encodeURIComponent(productId)}` : ""}`;
      await partnerApiRequest(suffix, { method: productId ? "PATCH" : "POST", body: JSON.stringify(product) });
    }
    closePartnerProductModal();
    resetPartnerProductForm();
    await Promise.all([startPartnerProductListener(), loadPartnerInventory()]);
    document.getElementById("partnerProductFeedback").textContent = mode ? "Variant saved." : productId ? "Product updated." : "Product added.";
  } catch (error) {
    console.error("Partner product save failed:", error);
    alert(`Unable to save product: ${error.message}`);
  }
}

async function editPartnerProduct(productId) {
  const product = partnerState.products.find(item => item.id === productId);
  if (!product) return;
  const variant = product.variants?.find(item => item.is_default) || product.variants?.[0] || {};
  resetPartnerProductForm();
  document.getElementById("partnerProductId").value = productId;
  document.getElementById("partnerProductName").value = product.name || "";
  document.getElementById("partnerProductDescription").value = product.description || "";
  document.getElementById("partnerProductCategory").value = product.category_id || "";
  document.getElementById("partnerProductVariantName").value = variant.name || "";
  document.getElementById("partnerProductSku").value = variant.sku || "";
  document.getElementById("partnerProductPrice").value = variant.price ?? "";
  document.getElementById("partnerProductComparePrice").value = variant.compare_at_price ?? "";
  document.getElementById("partnerProductUnit").value = variant.unit_label || "";
  document.getElementById("partnerProductUnitQuantity").value = variant.unit_quantity ?? 1;
  document.getElementById("partnerProductVariantActive").checked = variant.is_active !== false;
  const imageUrl = product.images?.[0]?.public_url || "";
  document.getElementById("partnerProductImage").value = imageUrl.startsWith("data:image/") ? "" : imageUrl;
  switchPartnerView("products");
  document.getElementById("partnerProductModalTitle").textContent = "Edit Product";
  document.getElementById("partnerProductModal").showModal();
  document.getElementById("partnerProductName").focus();
}

function preparePartnerVariantForm(productId) {
  const product = partnerState.products.find(item => item.id === productId);
  if (!product) return null;
  resetPartnerProductForm();
  document.getElementById("partnerProductId").value = product.id;
  document.getElementById("partnerProductName").value = product.name || "";
  document.getElementById("partnerProductMode").value = "add_variant";
  ["partnerProductName", "partnerProductCategory", "partnerProductDescription", "partnerProductImage"].forEach(id => {
    document.getElementById(id).disabled = true;
  });
  document.querySelector("#partnerProductsView form button[type='submit']").textContent = "Save variant";
  document.getElementById("partnerProductModalTitle").textContent = "Add Variant";
  return product;
}

function addPartnerVariant(productId) {
  const product = preparePartnerVariantForm(productId || document.getElementById("partnerProductId").value);
  if (!product) return;
  switchPartnerView("products");
  document.getElementById("partnerProductModal").showModal();
  document.getElementById("partnerProductVariantName").focus();
}

function editPartnerVariant(productId, variantId) {
  const product = preparePartnerVariantForm(productId);
  const variant = product?.variants?.find(item => item.id === variantId);
  if (!variant) return;
  document.getElementById("partnerProductMode").value = "edit_variant";
  document.getElementById("partnerProductVariantId").value = variant.id;
  document.getElementById("partnerProductVariantName").value = variant.name || "";
  document.getElementById("partnerProductSku").value = variant.sku || "";
  document.getElementById("partnerProductPrice").value = variant.price ?? "";
  document.getElementById("partnerProductComparePrice").value = variant.compare_at_price ?? "";
  document.getElementById("partnerProductUnit").value = variant.unit_label || "";
  document.getElementById("partnerProductUnitQuantity").value = variant.unit_quantity ?? 1;
  document.getElementById("partnerProductVariantActive").checked = variant.is_active !== false;
  switchPartnerView("products");
  document.getElementById("partnerProductModalTitle").textContent = "Edit Variant";
  document.getElementById("partnerProductModal").showModal();
  document.getElementById("partnerProductVariantName").focus();
}

async function savePartnerVariantAvailability(productId, variantId, isActive) {
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive })
    });
    await startPartnerProductListener();
  } catch (error) {
    alert(`Unable to update variant availability: ${error.message}`);
  }
}

async function togglePartnerProductStatus(productId, status) {
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products/${encodeURIComponent(productId)}/status`, {
      method: "PATCH", body: JSON.stringify({ status })
    });
    await startPartnerProductListener();
    document.getElementById("partnerProductFeedback").textContent = status === "ACTIVE" ? "Product made available." : "Product deactivated.";
  } catch (error) {
    alert(`Unable to update product status: ${error.message}`);
  }
}

async function deletePartnerProduct(productId) {
  if (!confirm("Remove this product from your menu? It will be deactivated, not permanently deleted.")) return;
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
    await startPartnerProductListener();
    document.getElementById("partnerProductFeedback").textContent = "Product removed from the active menu.";
  } catch (error) {
    console.error("Partner product delete failed:", error);
    alert(`Unable to delete product: ${error.message}`);
  }
}

async function loadPartnerProfile() {
  try {
    const [shop, dashboard, products, inventory, orders] = await Promise.all([
      partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}`),
      partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/dashboard`),
      partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products`),
      partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/inventory`),
      partnerApiRequest(`/orders?bucket=all&shop_id=${encodeURIComponent(partnerState.shopId)}`)
    ]);
    const safeProducts = Array.isArray(products) ? products : [];
    const safeInventory = Array.isArray(inventory) ? inventory : [];
    const safeOrders = Array.isArray(orders) ? orders : [];
    partnerState.shopStatus = shop.status;
    partnerState.memberRole = partnerState.memberships.find(item => item.partner_id === shop.partner_id)?.member_role || "";
    partnerState.profileAddress = shop.address_line1 || "";
    partnerState.dashboard = dashboard;
    partnerState.products = safeProducts;
    partnerState.inventory = safeInventory;
    partnerState.allOrders = safeOrders;
    partnerState.orders = safeOrders.filter(order => ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP"].includes(order.order_status));
    document.getElementById("partnerProfileName").value = shop.name || "";
    document.getElementById("partnerProfileAddress").value = partnerState.profileAddress;
    document.getElementById("partnerProfileDescription").value = shop.description || "";
    document.getElementById("partnerProfileAddress2").value = shop.address_line2 || "";
    document.getElementById("partnerProfileLocality").value = shop.locality || "";
    document.getElementById("partnerProfileCity").value = shop.city || "";
    document.getElementById("partnerProfileState").value = shop.state || "";
    document.getElementById("partnerProfilePostal").value = shop.postal_code || "";
    document.getElementById("partnerProfilePhone").value = shop.phone_e164 || "";
    document.getElementById("partnerProfileEmail").value = shop.email || "";
    document.getElementById("partnerSettingsShop").textContent = shop.name || "Restaurant";
    document.getElementById("partnerWelcomeTitle").textContent = shop.name || "Restaurant dashboard";
    renderPartnerProducts(safeProducts);
    renderPartnerInventory(safeInventory);
    renderPartnerDashboard(dashboard);
    renderPartnerOrders();
    await refreshPartnerNotifications(false);
    renderPartnerShopStatus();
  } catch (error) {
    console.error("Partner dashboard data could not be loaded:", error);
    document.getElementById("partnerRecentOrders").innerHTML = `<p class="partner-empty">${escapePartnerHtml(error.message)}</p>`;
    document.getElementById("partnerProductsContainer").innerHTML = `<p class="partner-empty">${escapePartnerHtml(error.message)}</p>`;
    document.getElementById("partnerInventoryContainer").innerHTML = `<p class="partner-empty">${escapePartnerHtml(error.message)}</p>`;
  }
}

function formatPartnerCurrency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function renderPartnerDashboard(data) {
  partnerState.dashboard = data;
  const pending = Number(data.pending_orders) || 0;
  const completed = Number(data.completed_orders) || 0;
  const cancelled = Number(data.cancelled_orders) || 0;
  const totalOrders = partnerState.allOrders.length;
  const totalOrdersLabel = totalOrders >= 100 ? "100+" : totalOrders.toLocaleString("en-IN");
  const sales = Number(data.delivered_item_value) || 0;
  document.getElementById("kpiTotalOrders").textContent = totalOrdersLabel;
  document.getElementById("kpiTotalSales").textContent = formatPartnerCurrency(sales);
  document.getElementById("kpiPendingOrders").textContent = pending.toLocaleString("en-IN");
  document.getElementById("kpiCompletedOrders").textContent = completed.toLocaleString("en-IN");
  document.getElementById("partnerTotalProducts").textContent = Number(data.total_products || 0).toLocaleString("en-IN");
  document.getElementById("partnerActiveProducts").textContent = Number(data.active_products || 0).toLocaleString("en-IN");
  document.getElementById("partnerStockQuantity").textContent = Number(data.stock_quantity || 0).toLocaleString("en-IN");
  document.getElementById("partnerCancelledOrders").textContent = cancelled.toLocaleString("en-IN");
  document.getElementById("partnerReportSales").textContent = formatPartnerCurrency(sales);
  document.getElementById("partnerReportSalesNote").textContent = sales > 0
    ? "Sum of item values on delivered orders."
    : "No sales data available.";
  document.getElementById("partnerReportCounts").innerHTML = [
    ["Pending", pending], ["Completed", completed], ["Cancelled", cancelled]
  ].map(([label, count]) => `<div><span>${label}</span><strong>${Number(count).toLocaleString("en-IN")}</strong></div>`).join("");
  renderPartnerOrderStatus({ pending, completed, cancelled, totalOrders });
  renderPartnerSalesCharts(sales, completed);
  renderPartnerDashboardLists();
}

function renderPartnerOrderStatus(counts) {
  const container = document.getElementById("partnerOrderStatus");
  if (!counts.totalOrders) {
    container.innerHTML = '<p class="partner-status-empty">No orders yet</p>';
    return;
  }
  const rows = [
    ["Pending", counts.pending, ""],
    ["Completed", counts.completed, "status-complete"],
    ["Cancelled", counts.cancelled, "status-cancelled"]
  ];
  container.innerHTML = rows.map(([label, count, className]) => {
    const width = Math.round((count / counts.totalOrders) * 100);
    return `<div class="partner-status-row"><span>${label}</span><div class="partner-status-track"><div class="partner-status-fill ${className}" style="width:${width}%"></div></div><strong>${count}</strong></div>`;
  }).join("");
}

function renderPartnerSalesCharts(totalSales, completedOrders) {
  const summary = document.getElementById("partnerSalesSummary");
  summary.innerHTML = `<strong>${formatPartnerCurrency(totalSales)}</strong><span>delivered item value</span>`;
  const delivered = partnerState.allOrders.filter(order => order.order_status === "DELIVERED");
  const chartTargets = [document.getElementById("partnerSalesChart"), document.getElementById("partnerReportChart")];
  if (!delivered.length) {
    const message = totalSales > 0 || completedOrders > 0
      ? "Daily sales breakdown is unavailable from the latest returned orders."
      : "No sales data available.";
    chartTargets.forEach(target => { target.innerHTML = `<p class="partner-chart-empty">${message}</p>`; });
    return;
  }

  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    date.setHours(0, 0, 0, 0);
    return { date, label: new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date), value: 0 };
  });
  delivered.forEach(order => {
    const date = new Date(order.placed_at);
    date.setHours(0, 0, 0, 0);
    const day = days.find(item => item.date.getTime() === date.getTime());
    if (day) day.value += (order.items || []).reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  });
  const maximum = Math.max(...days.map(day => day.value), 1);
  const markup = days.map(day => {
    const height = day.value > 0 ? Math.max(4, Math.round((day.value / maximum) * 100)) : 0;
    return `<div class="partner-sales-day" title="${day.label}: ${formatPartnerCurrency(day.value)}"><div class="partner-sales-bar-track"><div class="partner-sales-bar" style="height:${height}%"></div></div><small>${day.label}</small></div>`;
  }).join("");
  chartTargets.forEach(target => { target.innerHTML = markup; });
}

function renderPartnerDashboardLists() {
  const recentContainer = document.getElementById("partnerRecentOrders");
  const recent = partnerState.allOrders.slice(0, 5);
  recentContainer.innerHTML = recent.length
    ? recent.map(renderPartnerCompactOrder).join("")
    : '<p class="partner-empty">No orders yet</p>';

  const live = partnerState.allOrders.filter(order => {
    const today = new Date();
    const placedAt = new Date(order.placed_at);
    return ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP"].includes(order.order_status)
      && placedAt.toDateString() === today.toDateString();
  });
  document.getElementById("partnerLiveOrders").innerHTML = live.length
    ? live.slice(0, 4).map(renderPartnerCompactOrder).join("")
    : '<p class="partner-empty">No live orders today</p>';

  const topItems = new Map();
  partnerState.allOrders.filter(order => order.order_status === "DELIVERED").forEach(order => {
    (order.items || []).forEach(item => {
      const entry = topItems.get(item.name) || { quantity: 0, value: 0 };
      entry.quantity += Number(item.quantity) || 0;
      entry.value += Number(item.line_total) || 0;
      topItems.set(item.name, entry);
    });
  });
  const topRows = [...topItems.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 5);
  document.getElementById("partnerTopItems").innerHTML = topRows.length
    ? topRows.map(([name, item]) => `<div class="partner-compact-row"><div class="partner-compact-main"><strong>${escapePartnerHtml(name)}</strong><small>${item.quantity.toLocaleString("en-IN")} sold</small></div><span class="partner-compact-value">${formatPartnerCurrency(item.value)}</span></div>`).join("")
    : '<p class="partner-empty">No top-selling items yet</p>';
}

function renderPartnerCompactOrder(order) {
  const orderLabel = order.order_number || order.id;
  return `<div class="partner-compact-row"><div class="partner-compact-main"><strong>${escapePartnerHtml(orderLabel)}</strong><small>${escapePartnerHtml(order.customer_name || "Customer")} · ${escapePartnerHtml(getPartnerStatus(order))}</small></div><span class="partner-compact-value">${formatPartnerCurrency(order.total_amount)}</span></div>`;
}

async function loadPartnerInventory() {
  if (!partnerState.shopId) return;
  try {
    const inventory = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/inventory`);
    partnerState.inventory = Array.isArray(inventory) ? inventory : [];
    renderPartnerInventory(partnerState.inventory);
    if (partnerState.dashboard) {
      partnerState.dashboard.stock_quantity = partnerState.inventory.reduce((total, item) => total + Number(item.quantity_on_hand || 0), 0);
      renderPartnerDashboard(partnerState.dashboard);
    }
  } catch (error) {
    document.getElementById("partnerInventoryContainer").innerHTML = `<p class="partner-empty">${escapePartnerHtml(error.message)}</p>`;
  }
}

function renderPartnerInventory(inventory) {
  const container = document.getElementById("partnerInventoryContainer");
  if (!container) return;
  if (!inventory.length) {
    container.innerHTML = '<p class="partner-empty">No inventory items yet</p>';
    return;
  }
  container.innerHTML = `<table class="partner-inventory-table"><thead><tr><th>Product</th><th>Variant</th><th>On hand</th><th>Reserved</th><th>Update</th></tr></thead><tbody>${inventory.map(item => `<tr><td>${escapePartnerHtml(item.product_name)}</td><td>${escapePartnerHtml(item.variant_name || item.unit_label || "Default")}</td><td><input id="partnerStock_${escapePartnerHtml(item.variant_id)}" class="partner-stock-input" type="number" min="${Number(item.quantity_reserved) || 0}" step="1" value="${Number(item.quantity_on_hand) || 0}" aria-label="Quantity on hand for ${escapePartnerHtml(item.product_name)}"></td><td>${Number(item.quantity_reserved) || 0}</td><td><button type="button" class="partner-stock-save" onclick="savePartnerInventory('${escapePartnerHtml(item.variant_id)}')">Save</button></td></tr>`).join("")}</tbody></table>`;
}

async function savePartnerProfile(event) {
  event.preventDefault();
  const name = document.getElementById("partnerProfileName").value.trim() || partnerState.label;
  const address = document.getElementById("partnerProfileAddress").value.trim();
  const body = {
    name,
    description: document.getElementById("partnerProfileDescription").value.trim() || null,
    address_line1: address,
    address_line2: document.getElementById("partnerProfileAddress2").value.trim() || null,
    locality: document.getElementById("partnerProfileLocality").value.trim() || null,
    city: document.getElementById("partnerProfileCity").value.trim(),
    state: document.getElementById("partnerProfileState").value.trim(),
    postal_code: document.getElementById("partnerProfilePostal").value.trim(),
    phone_e164: document.getElementById("partnerProfilePhone").value.trim() || null,
    email: document.getElementById("partnerProfileEmail").value.trim() || null
  };
  try {
    const updatedShop = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    partnerState.label = name;
    partnerState.shops = partnerState.shops.map(shop => shop.id === updatedShop.id ? { ...shop, ...updatedShop } : shop);
    partnerState.profileAddress = address;
    const selectedOption = document.getElementById("partnerShopSelect").selectedOptions[0];
    if (selectedOption) selectedOption.textContent = `${updatedShop.name} · ${updatedShop.city}`;
    document.getElementById("partnerDeskTitle").textContent = `${name} orders`;
    document.getElementById("partnerWelcomeTitle").textContent = name;
    document.getElementById("partnerHeaderSubtitle").textContent = name;
    alert("Location details saved.");
  } catch (error) {
    console.error("Partner shop profile save failed:", error);
    alert(`Unable to save location: ${error.message}`);
  }
}

function renderPartnerShopStatus() {
  const button = document.getElementById("partnerShopStatusButton");
  if (!button) return;
  const canManageStatus = ["OWNER", "MANAGER"].includes(partnerState.memberRole);
  button.textContent = partnerState.shopStatus === "ACTIVE" ? "Pause shop" : "Open shop";
  button.disabled = !canManageStatus || !["ACTIVE", "PAUSED"].includes(partnerState.shopStatus);
  button.title = button.disabled ? "Only a partner owner or manager can change shop status." : `Current status: ${partnerState.shopStatus}`;
  const badge = document.getElementById("partnerShopStatusLabel");
  badge.textContent = partnerState.shopStatus || "Unknown";
  badge.classList.toggle("is-paused", partnerState.shopStatus === "PAUSED");
  badge.classList.toggle("is-closed", ["SUSPENDED", "CLOSED"].includes(partnerState.shopStatus));
}

async function togglePartnerShopStatus() {
  const status = partnerState.shopStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    const result = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    partnerState.shopStatus = result.status;
    partnerState.shops = partnerState.shops.map(shop => shop.id === partnerState.shopId ? { ...shop, status: result.status } : shop);
    renderPartnerShopStatus();
  } catch (error) {
    console.error("Partner shop status update failed:", error);
    alert(`Unable to update shop status: ${error.message}`);
  }
}

function getPartnerStatus(order) {
  return order.status === "READY_FOR_PICKUP" ? "PACKED" : order.status || "PLACED";
}

function renderPartnerStatus(order) {
  const status = getPartnerStatus(order);
  const nextStatus = { PLACED: "ACCEPTED", ACCEPTED: "PREPARING", PREPARING: "PACKED" }[status];
  const statuses = [
    ["ACCEPTED", "Accept"],
    ["PREPARING", "Preparing"],
    ["PACKED", "Ready for pickup"]
  ];
  return `<div class="flex gap-1 overflow-x-auto pt-2">${statuses.map(([key, label]) => `<button type="button" ${key !== nextStatus ? "disabled" : ""} onclick="setPartnerStatus('${escapePartnerHtml(order.id)}', '${key}')" class="px-2.5 py-1.5 rounded-lg border text-[10px] font-black shrink-0 ${status === key ? "bg-[#0B132B] text-white" : "bg-white text-slate-700"} ${key !== nextStatus ? "opacity-40" : ""}">${status === key ? "✓ " : ""}${label}</button>`).join("")}</div>`;
}

function renderPartnerOrders() {
  const container = document.getElementById("partnerOrdersContainer");
  if (!container) return;
  const liveOrders = partnerState.allOrders.filter(order => ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP"].includes(order.order_status));
  const newCount = liveOrders.filter(order => ["PLACED", "ACCEPTED"].includes(getPartnerStatus(order))).length;
  const preparingCount = liveOrders.filter(order => getPartnerStatus(order) === "PREPARING").length;
  const readyCount = liveOrders.filter(order => getPartnerStatus(order) === "PACKED").length;
  document.getElementById("partnerNewCount").textContent = newCount;
  document.getElementById("partnerPreparingCount").textContent = preparingCount;
  document.getElementById("partnerReadyCount").textContent = readyCount;
  const navCount = document.getElementById("partnerNavOrderCount");
  navCount.textContent = liveOrders.length;
  navCount.hidden = liveOrders.length === 0;

  const partnerOrders = partnerState.orders;
  if (!partnerOrders.length) {
    container.innerHTML = '<p class="partner-empty">No orders yet</p>';
    return;
  }
  container.innerHTML = partnerOrders.map(order => {
    const items = (order.items || []).map(item => `${Number(item.quantity) || 0}x ${escapePartnerHtml(item.name)} · ${formatPartnerCurrency(item.price)}`).join("<br>");
    const isSelectedOrder = order.id === partnerState.selectedOrderId;
    const pickupCodeAction = getPartnerStatus(order) === "PACKED"
      ? `<div class="partner-pickup-code-action"><button type="button" id="partnerPickupCodeButton_${escapePartnerHtml(order.id)}" class="partner-button partner-button-outline" onclick="requestPartnerPickupCode('${escapePartnerHtml(order.id)}')">Send pickup code</button><p id="partnerPickupCodeMessage_${escapePartnerHtml(order.id)}" role="status" aria-live="polite"></p></div>`
      : "";
    return `<article id="partnerOrder_${escapePartnerHtml(order.id)}" tabindex="-1" class="partner-order-card ${isSelectedOrder ? "is-notification-target" : ""}">
      <div class="partner-order-card-head"><div><h3>${escapePartnerHtml(order.order_number || order.id)}</h3><p>${escapePartnerHtml(order.customer_name || order.customer_phone || "Customer")}</p></div><span class="partner-order-badge">${escapePartnerHtml(getPartnerStatus(order))}</span></div>
      <p class="partner-order-items">${items || "No item details"}</p>
      <p class="partner-order-address">Pickup: ${escapePartnerHtml(order.delivery_address || "Customer delivery address")}</p>
      ${renderPartnerStatus(order)}
      ${pickupCodeAction}
    </article>`;
  }).join("");
  if (partnerState.selectedOrderId) {
    const target = document.getElementById(`partnerOrder_${partnerState.selectedOrderId}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      partnerState.selectedOrderId = "";
    }
  }
}

async function startPartnerOrderListener(bucket = partnerState.orderBucket) {
  partnerState.orderBucket = bucket;
  try {
    const orders = await partnerApiRequest(`/orders?bucket=${encodeURIComponent(bucket)}&shop_id=${encodeURIComponent(partnerState.shopId)}`);
    partnerState.orders = Array.isArray(orders) ? orders : [];
    if (bucket === "all") partnerState.allOrders = partnerState.orders;
    renderPartnerOrders();
  } catch (error) {
    console.error("Partner order API failed:", error);
    document.getElementById("partnerOrdersContainer").innerHTML = `<p class="text-center text-rose-500 py-10 text-xs">${escapePartnerHtml(error.message)}</p>`;
  }
}

function startPartnerOrderRefresh() {
  if (partnerState.orderRefreshTimer) window.clearInterval(partnerState.orderRefreshTimer);
  partnerState.orderRefreshTimer = null;
  if (!getPartnerAccessToken() || !partnerState.shopId || document.visibilityState === "hidden") return;
  partnerState.orderRefreshTimer = window.setInterval(refreshPartnerOrders, 15000);
}

function stopPartnerOrderRefresh() {
  if (partnerState.orderRefreshTimer) window.clearInterval(partnerState.orderRefreshTimer);
  partnerState.orderRefreshTimer = null;
}

function handlePartnerVisibilityChange() {
  if (document.visibilityState === "hidden") {
    stopPartnerOrderRefresh();
    return;
  }
  if (getPartnerAccessToken() && partnerState.shopId) {
    refreshPartnerOrders();
    startPartnerOrderRefresh();
  }
}

async function refreshPartnerOrders() {
  if (!getPartnerAccessToken() || !partnerState.shopId || partnerState.orderRefreshInFlight
      || document.visibilityState === "hidden") return;
  partnerState.orderRefreshInFlight = true;
  const shopId = partnerState.shopId;
  try {
    const [orders, dashboard] = await Promise.all([
      partnerApiRequest(`/orders?bucket=all&shop_id=${encodeURIComponent(shopId)}`),
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}/dashboard`)
    ]);
    if (shopId !== partnerState.shopId) return;
    partnerState.allOrders = Array.isArray(orders) ? orders : [];
    partnerState.dashboard = dashboard;
    const activeStatuses = new Set(["DRAFT", "PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"]);
    const pastStatuses = new Set(["DELIVERED", "CANCELLED", "REJECTED"]);
    partnerState.orders = partnerState.orderBucket === "past"
      ? partnerState.allOrders.filter(order => pastStatuses.has(order.order_status))
      : partnerState.orderBucket === "all"
        ? partnerState.allOrders
        : partnerState.allOrders.filter(order => activeStatuses.has(order.order_status));
    renderPartnerDashboard(dashboard);
    renderPartnerOrders();
    await refreshPartnerNotifications(true);
  } catch (error) {
    console.warn("Partner order refresh failed:", error.message);
  } finally {
    partnerState.orderRefreshInFlight = false;
  }
}

async function requestPartnerPickupCode(orderId) {
  const message = document.getElementById(`partnerPickupCodeMessage_${orderId}`);
  const button = document.getElementById(`partnerPickupCodeButton_${orderId}`);
  if (!partnerState.shopId || !orderId) return;
  if (button) button.disabled = true;
  if (message) message.textContent = "Sending code to the restaurant contact...";
  try {
    await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(partnerState.shopId)}/pickup-otp`, {
      method: "POST"
    });
    if (message) message.textContent = "Pickup code sent to the restaurant's registered contact.";
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function setPartnerStatus(orderId, status) {
  try {
    await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadPartnerProfile();
  } catch (error) {
    console.error("Partner order status update failed:", error);
    alert(`Unable to update order: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", loadPartnerRestaurants);
document.addEventListener("DOMContentLoaded", loadPartnerProductCategories);
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("partnerNotificationPanel").addEventListener("click", event => {
    const notification = event.target.closest("[data-notification-id]");
    if (notification) openPartnerNotification(notification.dataset.notificationId);
  });
  document.addEventListener("click", event => {
    const panel = document.getElementById("partnerNotificationPanel");
    if (!panel.hidden && !panel.contains(event.target) && !event.target.closest("#partnerNotificationButton")) {
      closePartnerNotificationPanel();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closePartnerNotificationPanel();
  });
  document.addEventListener("visibilitychange", handlePartnerVisibilityChange);
  window.addEventListener("beforeunload", () => {
    stopPartnerOrderRefresh();
    dismissPartnerToast();
  });
});
