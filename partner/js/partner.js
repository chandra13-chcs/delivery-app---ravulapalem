const partnerState = {
  shopId: "",
  businessType: "",
  name: "",
  label: "",
  shopStatus: "",
  memberRole: "",
  user: null,
  memberships: [],
  shops: [],
  categories: [],
  dashboard: null,
  reportDataUpdatedAt: null,
  inventory: [],
  orders: [],
  allOrders: [],
  products: [],
  orderBucket: "active",
  orderStatusFilter: "ALL",
  selectedOrderId: "",
  orderRefreshTimer: null,
  orderRefreshInFlight: false,
  orderStatusUpdating: new Set(),
  orderStatusErrors: new Map(),
  orderDetailRequestId: 0,
  orderListRequestId: 0,
  orderCsvDownloading: false,
  reportCsvDownloading: false,
  notificationRefreshInFlight: false,
  notifications: [],
  notificationsInitialized: false,
  seenNotificationIds: new Set(),
  notificationToastTimer: null,
  unsubscribe: null,
  productUnsubscribe: null,
  profileAddress: "",
  shopProfileSnapshot: null
};

const PARTNER_API_ROOT = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:5000"
  : "";
const PARTNER_API_BASE_URL = `${PARTNER_API_ROOT}/api/partner`;
const partnerInviteParams = new URLSearchParams(window.location.hash.slice(1));
const PARTNER_INVITED_PARTNER_ID = partnerInviteParams.get("partnerId") || "";
const PARTNER_INVITE_TOKEN = partnerInviteParams.get("invite") || "";
let partnerOtpPasswordResetRequested = false;

function getPartnerAccessToken() {
  return sessionStorage.getItem("partner_user_access_token") || "";
}

async function partnerAuthRequest(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const token = getPartnerAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${PARTNER_API_BASE_URL}/auth${path}`, {
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

function showPartnerOtpLogin() {
  if (!PARTNER_INVITE_TOKEN) {
    showPartnerAuthMessage("Ask your administrator for a one-time invite link to set up or reset your password.", true);
    return;
  }
  partnerOtpPasswordResetRequested = true;
  document.getElementById("partnerOtpActions").hidden = false;
  document.getElementById("partnerShowOtpButton").hidden = true;
  document.getElementById("partnerLoginPassword").required = false;
  document.getElementById("partnerRequestOtpButton").hidden = false;
  document.getElementById("partnerVerifyOtpButton").hidden = true;
}

function hidePartnerOtpLogin() {
  partnerOtpPasswordResetRequested = false;
  document.getElementById("partnerOtpActions").hidden = true;
  document.getElementById("partnerShowOtpButton").hidden = false;
  document.getElementById("partnerLoginPassword").required = false;
  document.getElementById("partnerLoginOtp").value = "";
  showPartnerAuthMessage("");
}

async function requestPartnerLoginCode(event) {
  event?.preventDefault();
  if (!PARTNER_INVITE_TOKEN) {
    showPartnerAuthMessage("A current one-time administrator invitation is required.", true);
    return;
  }
  const phone = document.getElementById("partnerLoginPhone").value.trim();
  try {
    const result = await partnerAuthRequest("/invites/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone_e164: phone, invite_token: PARTNER_INVITE_TOKEN })
    });
    document.getElementById("partnerOtpField").hidden = false;
    document.getElementById("partnerRequestOtpButton").hidden = true;
    document.getElementById("partnerVerifyOtpButton").hidden = false;
    if (result.development_otp) {
      document.getElementById("partnerLoginOtp").value = result.development_otp;
      showPartnerAuthMessage("Development verification code filled in. Keep this invitation private.");
    } else {
      showPartnerAuthMessage("If the account is eligible, a verification code will be sent.");
    }
  } catch (error) {
    showPartnerAuthMessage(error.message, true);
  }
}

async function signInPartnerWithPassword() {
  const phone = document.getElementById("partnerLoginPhone").value.trim();
  const password = document.getElementById("partnerLoginPassword").value;
  if (!phone || !password) {
    showPartnerAuthMessage("Enter your mobile number and password.", true);
    return;
  }
  try {
    const result = await partnerAuthRequest("/password/login", {
      method: "POST",
      body: JSON.stringify({ phone, password })
    });
    sessionStorage.setItem("partner_user_access_token", result.access_token);
    await loadPartnerRestaurants();
  } catch (error) {
    showPartnerAuthMessage(error.message, true);
  }
}

async function verifyPartnerLoginCode() {
  if (!PARTNER_INVITE_TOKEN) {
    showPartnerAuthMessage("A current one-time administrator invitation is required.", true);
    return;
  }
  const phone = document.getElementById("partnerLoginPhone").value.trim();
  const otp = document.getElementById("partnerLoginOtp").value.trim();
  try {
    const result = await partnerAuthRequest("/invites/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone_e164: phone, invite_token: PARTNER_INVITE_TOKEN, otp })
    });
    sessionStorage.setItem("partner_user_access_token", result.access_token);
    await loadPartnerRestaurants();
  } catch (error) {
    showPartnerAuthMessage(error.message, true);
  }
}

async function savePartnerPassword(event) {
  event.preventDefault();
  const password = document.getElementById("partnerNewPassword").value;
  const confirmation = document.getElementById("partnerConfirmPassword").value;
  const button = document.getElementById("partnerSavePasswordButton");
  if (password !== confirmation) {
    showPartnerAuthMessage("Passwords do not match.", true);
    document.getElementById("partnerConfirmPassword").focus();
    return;
  }
  if (button) button.disabled = true;
  try {
    await partnerApiRequest("/password", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    partnerOtpPasswordResetRequested = false;
    document.getElementById("partnerPasswordSetupDialog").close();
    document.getElementById("partnerPasswordSetupForm").reset();
    await loadPartnerRestaurants();
  } catch (error) {
    const message = document.getElementById("partnerPasswordSetupMessage");
    if (message) {
      message.textContent = error.message;
      message.classList.add("text-rose-600");
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function signOutPartner() {
  try {
    await partnerAuthRequest("/logout", { method: "POST" });
  } catch (error) {
    console.warn("Partner sign-out request failed:", error.message);
  }
  sessionStorage.removeItem("partner_user_access_token");
  partnerOtpPasswordResetRequested = false;
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
    ? `${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date)} IST`
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
  if (!getPartnerAccessToken() || !partnerState.shopId || partnerState.notificationRefreshInFlight
      || document.visibilityState === "hidden") return;
  partnerState.notificationRefreshInFlight = true;
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
      if (newlyUnread.some(notification => ["partner.order.received", "partner.order.cancelled"].includes(notification.payload?.event))) {
        refreshPartnerOrders();
      }
    }
    notifications.forEach(notification => partnerState.seenNotificationIds.add(notification.id));
    partnerState.notifications = notifications;
    partnerState.notificationsInitialized = true;
    renderPartnerNotifications();
  } catch (error) {
    console.warn("Partner notifications could not be loaded:", error.message);
  } finally {
    partnerState.notificationRefreshInFlight = false;
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
  document.getElementById("partnerOrderStatusFilter").value = "ALL";
  partnerState.orderStatusFilter = "ALL";
  navigatePartnerSection(null, "orders");
  await openPartnerOrderDetail(orderId);
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
    document.getElementById("partnerShowOtpButton").hidden = !PARTNER_INVITE_TOKEN;
    if (PARTNER_INVITE_TOKEN) showPartnerOtpLogin();
    showPartnerAuthMessage("Sign in with an active partner account.");
    return;
  }

  try {
    const identity = await partnerApiRequest("/me");
    partnerState.user = identity?.user || null;
    partnerState.memberships = Array.isArray(identity?.partners) ? identity.partners : [];
    if (!partnerState.memberships.length) throw new Error("Active partner membership required.");
    if (PARTNER_INVITED_PARTNER_ID
        && !partnerState.memberships.some(partner => partner.partner_id === PARTNER_INVITED_PARTNER_ID)) {
      throw new Error("This invite link is not for an active partner account linked to your mobile.");
    }
    if (!partnerState.user?.has_password || partnerOtpPasswordResetRequested) {
      loginScreen.hidden = true;
      app.hidden = true;
      const dialog = document.getElementById("partnerPasswordSetupDialog");
      document.getElementById("partnerPasswordSetupTitle").textContent = partnerState.user?.has_password
        ? "Reset your partner password"
        : "Create your partner password";
      if (!dialog.open) dialog.showModal();
      return;
    }
    const shopsPath = PARTNER_INVITED_PARTNER_ID
      ? `/shops?partner_id=${encodeURIComponent(PARTNER_INVITED_PARTNER_ID)}`
      : "/shops";
    const shops = await partnerApiRequest(shopsPath);
    partnerState.shops = Array.isArray(shops) ? shops : [];
    if (!partnerState.shops.length) throw new Error("No active shops are linked to this partner account.");
    const partnerNames = partnerState.memberships.map(partner => partner.display_name).join(", ");
    document.title = "MyShopzy | Partner Console";
    document.getElementById("partnerAccountName").textContent = partnerState.user?.display_name || "Partner account";
    document.getElementById("partnerAvatar").textContent = (partnerState.user?.display_name || "P").trim().charAt(0).toUpperCase();
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
  const shopId = partnerState.shopId;
  if (!shopId) return;
  try {
    const categories = await partnerApiRequest(`/categories?shop_id=${encodeURIComponent(shopId)}`);
    if (partnerState.shopId !== shopId) return;
    partnerState.categories = Array.isArray(categories) ? categories : [];
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
  const membership = partnerState.memberships.find(item => item.partner_id === shop.partner_id);
  if (!membership || !membership.business_type || membership.business_type !== shop.business_type) {
    console.error("Partner shop business type could not be verified against the authenticated identity.");
    return;
  }

  if (partnerState.shopId !== shop.id) {
    partnerState.orderListRequestId += 1;
    partnerState.orders = [];
    partnerState.allOrders = [];
    partnerState.orderBucket = "active";
    partnerState.selectedOrderId = "";
    partnerState.orderStatusFilter = "ALL";
    partnerState.orderStatusErrors.clear();
    document.getElementById("partnerOrderBucket").value = "active";
    document.getElementById("partnerOrderStatusFilter").value = "ALL";
    closePartnerOrderDetail();
    renderPartnerOrders();
  }
  partnerState.businessType = membership.business_type;
  applyPartnerBusinessLabels(partnerState.businessType);
  partnerState.shopId = shop.id;
  partnerState.name = shop.partner_name || "Partner";
  partnerState.label = shop.name || "Partner shop";
  partnerState.shopStatus = shop.status;

  document.getElementById("partnerShopSelect").value = shop.id;
  document.getElementById("partnerWelcomeTitle").textContent = shop.name;
  document.getElementById("partnerHeaderSubtitle").textContent = shop.name;
  document.getElementById("partnerDeskTitle").textContent = `${shop.name} orders`;
  document.getElementById("partnerSettingsShop").textContent = shop.name;
  document.getElementById("partnerApp").classList.remove("sidebar-open");
  document.getElementById("partnerSidebarScrim").hidden = true;
  renderPartnerShopStatus();
  await loadPartnerProductCategories();
  await loadPartnerProfile();
  navigatePartnerSection(null, "dashboard");
  startPartnerOrderRefresh();
}

function closePartnerDesk() {
  stopPartnerOrderRefresh();
  closePartnerOrderDetail();
  partnerState.orderListRequestId += 1;
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
  partnerState.businessType = "";
  applyPartnerBusinessLabels("");
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
  products: "Products",
  inventory: "Inventory",
  "restaurant-info": "Shop Info",
  reports: "Sales & Reports",
  reviews: "Ratings & Reviews",
  settings: "Settings"
};

function applyPartnerBusinessLabels(businessType) {
  const isRestaurant = businessType === "RESTAURANT";
  const partnerLabel = businessType === "MEAT"
    ? "Meat partner"
    : isRestaurant ? "Restaurant partner" : "Partner";
  const shopLabel = isRestaurant ? "Restaurant" : "Shop";
  const productsLabel = isRestaurant ? "Menu / Products" : "Products";
  const productsHeading = isRestaurant ? "Menu & Products" : "Products";
  const shopInfoLabel = isRestaurant ? "Restaurant Info" : "Shop Info";

  document.getElementById("partnerSetupType").textContent = partnerLabel;
  document.getElementById("partnerBrandType").textContent = partnerLabel;
  document.getElementById("partnerIdentityLabel").textContent = partnerLabel;
  document.getElementById("partnerShopSelectLabel").textContent = shopLabel;
  document.getElementById("partnerShopSelect").setAttribute("aria-label", `Select an authorized ${shopLabel.toLowerCase()}`);
  document.getElementById("partnerProductsNavLabel").textContent = productsLabel;
  document.getElementById("partnerProductsHeading").textContent = productsHeading;
  document.getElementById("partnerShopInfoNavLabel").textContent = shopInfoLabel;
  document.getElementById("partnerQuickShopInfoLabel").textContent = shopInfoLabel;
  document.getElementById("partnerManageProductsLabel").textContent = isRestaurant ? "Manage Menu" : "Manage Products";
  document.getElementById("partnerShopInfoEyebrow").textContent = isRestaurant ? "RESTAURANT PROFILE" : "SHOP PROFILE";
  document.getElementById("partnerShopInfoHeading").textContent = shopInfoLabel;
  document.getElementById("partnerShopInfoDescription").textContent = `Keep your ${shopLabel.toLowerCase()} and pickup details current.`;
  document.getElementById("partnerProfileNameLabel").textContent = `${shopLabel} name`;
  document.getElementById("partnerSaveShopButton").textContent = `Save ${shopLabel.toLowerCase()} details`;

  partnerPageTitles.products = isRestaurant ? "Menu / Products" : "Products";
  partnerPageTitles["restaurant-info"] = shopInfoLabel;
  const selectedSection = document.querySelector(".partner-nav-link.is-active[data-section]")?.dataset.section;
  if (selectedSection && partnerPageTitles[selectedSection]) {
    document.getElementById("partnerSectionTitle").textContent = partnerPageTitles[selectedSection];
  }
}

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
  `; }).join("") : '<div class="partner-products-empty"><p>No products yet</p><button type="button" class="partner-button partner-button-primary" onclick="startAddPartnerProduct()">＋ Add Product</button></div>';

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
  document.getElementById("partnerProductBrand").value = "";
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
  ["partnerProductName", "partnerProductCategory", "partnerProductBrand", "partnerProductDescription", "partnerProductImage"].forEach(id => {
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
    brand: document.getElementById("partnerProductBrand").value.trim() || null,
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
  document.getElementById("partnerProductBrand").value = product.brand || "";
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
  ["partnerProductName", "partnerProductCategory", "partnerProductBrand", "partnerProductDescription", "partnerProductImage"].forEach(id => {
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
  const shopId = partnerState.shopId;
  try {
    const [shop, dashboard, products, inventory, orders] = await Promise.all([
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}`),
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}/dashboard`),
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}/products`),
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}/inventory`),
      partnerApiRequest(`/orders?bucket=all&shop_id=${encodeURIComponent(shopId)}`)
    ]);
    if (shopId !== partnerState.shopId) return;
    const safeProducts = Array.isArray(products) ? products : [];
    const safeInventory = Array.isArray(inventory) ? inventory : [];
    const safeOrders = Array.isArray(orders) ? orders : [];
    partnerState.shopStatus = shop.status;
    partnerState.memberRole = partnerState.memberships.find(item => item.partner_id === shop.partner_id)?.member_role || "";
    partnerState.profileAddress = shop.address_line1 || "";
    partnerState.dashboard = dashboard;
    partnerState.reportDataUpdatedAt = new Date();
    partnerState.products = safeProducts;
    partnerState.inventory = safeInventory;
    partnerState.allOrders = safeOrders;
    partnerState.orders = safeOrders.filter(order => ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP"].includes(order.order_status));
    partnerState.shopProfileSnapshot = {
      name: shop.name || "",
      description: shop.description || "",
      address_line1: shop.address_line1 || "",
      address_line2: shop.address_line2 || "",
      locality: shop.locality || "",
      city: shop.city || "",
      state: shop.state || "",
      postal_code: shop.postal_code || "",
      phone_e164: shop.phone_e164 || "",
      email: shop.email || ""
    };
    setPartnerProfileFormValues(partnerState.shopProfileSnapshot);
    document.getElementById("partnerProfileBusinessType").textContent = formatPartnerBusinessType(shop.business_type || partnerState.businessType || shop.businessType || "");
    document.getElementById("partnerProfileStatusValue").textContent = formatPartnerShopStatus(shop.status || partnerState.shopStatus);
    document.getElementById("partnerProfileOpeningTime").textContent = "Not available";
    document.getElementById("partnerProfileClosingTime").textContent = "Not available";
    document.getElementById("partnerProfileFeedback").textContent = "";
    document.getElementById("partnerSettingsShop").textContent = shop.name || "Shop";
    document.getElementById("partnerWelcomeTitle").textContent = shop.name || "Shop";
    renderPartnerProducts(safeProducts);
    renderPartnerInventory(safeInventory);
    renderPartnerDashboard(dashboard);
    renderPartnerOrders();
    await refreshPartnerNotifications(false);
    renderPartnerShopStatus();
  } catch (error) {
    if (shopId !== partnerState.shopId) return;
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
  const reportUpdatedAt = document.getElementById("partnerReportUpdatedAt");
  if (reportUpdatedAt) {
    reportUpdatedAt.textContent = partnerState.reportDataUpdatedAt
      ? `Data updated ${formatPartnerNotificationTime(partnerState.reportDataUpdatedAt)}`
      : "Report time unavailable";
  }
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
    : '<p class="partner-empty">No recent orders</p>';

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
  const placedAt = formatPartnerOrderDateTime(order.placed_at);
  return `<div class="partner-compact-row"><div class="partner-compact-main"><strong>${escapePartnerHtml(orderLabel)}</strong><small>${escapePartnerHtml(order.customer_name || "Customer")} · ${escapePartnerHtml(getPartnerStatus(order))}</small><small>${escapePartnerHtml(placedAt.date)} · ${escapePartnerHtml(placedAt.time)} IST</small></div><span class="partner-compact-value">${formatPartnerCurrency(order.total_amount)}</span></div>`;
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
  container.innerHTML = `<table class="partner-inventory-table"><thead><tr><th>Product</th><th>Variant</th><th>On hand</th><th>Reserved</th><th>Update</th></tr></thead><tbody>${inventory.map(item => `<tr><td>${escapePartnerHtml(item.product_name)}</td><td>${escapePartnerHtml(item.variant_name || item.unit_label || "Default")}</td><td><input id="partnerStock_${escapePartnerHtml(item.variant_id)}" class="partner-stock-input" type="number" min="${Number(item.quantity_reserved) || 0}" step="0.001" value="${Number(item.quantity_on_hand) || 0}" aria-label="Quantity on hand for ${escapePartnerHtml(item.product_name)}"></td><td>${Number(item.quantity_reserved) || 0}</td><td><button type="button" class="partner-stock-save" onclick="savePartnerInventory('${escapePartnerHtml(item.variant_id)}')">Save</button></td></tr>`).join("")}</tbody></table>`;
}

function formatPartnerBusinessType(value) {
  switch (value) {
    case "RESTAURANT": return "Restaurant";
    case "MEAT": return "Meat";
    case "GROCERY":
    case "OTHER": return "Local Store";
    default: return value ? String(value).replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase()) : "Not available";
  }
}

function formatPartnerShopStatus(value) {
  if (!value) return "Not available";
  if (value === "ACTIVE") return "Open";
  if (value === "PAUSED") return "Paused";
  if (value === "SUSPENDED") return "Suspended";
  if (value === "CLOSED") return "Closed";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

function showPartnerProfileFeedback(message, isError = false) {
  const feedback = document.getElementById("partnerProfileFeedback");
  if (!feedback) return;
  feedback.textContent = message;
  feedback.classList.toggle("is-error", isError);
  feedback.classList.toggle("is-success", !isError);
}

function getPartnerProfileFormValues() {
  return {
    name: document.getElementById("partnerProfileName").value.trim(),
    description: document.getElementById("partnerProfileDescription").value.trim(),
    address_line1: document.getElementById("partnerProfileAddress").value.trim(),
    address_line2: document.getElementById("partnerProfileAddress2").value.trim(),
    locality: document.getElementById("partnerProfileLocality").value.trim(),
    city: document.getElementById("partnerProfileCity").value.trim(),
    state: document.getElementById("partnerProfileState").value.trim(),
    postal_code: document.getElementById("partnerProfilePostal").value.trim(),
    phone_e164: document.getElementById("partnerProfilePhone").value.trim(),
    email: document.getElementById("partnerProfileEmail").value.trim()
  };
}

function setPartnerProfileFormValues(values = {}) {
  document.getElementById("partnerProfileName").value = values.name || "";
  document.getElementById("partnerProfileDescription").value = values.description || "";
  document.getElementById("partnerProfileAddress").value = values.address_line1 || "";
  document.getElementById("partnerProfileAddress2").value = values.address_line2 || "";
  document.getElementById("partnerProfileLocality").value = values.locality || "";
  document.getElementById("partnerProfileCity").value = values.city || "";
  document.getElementById("partnerProfileState").value = values.state || "";
  document.getElementById("partnerProfilePostal").value = values.postal_code || "";
  document.getElementById("partnerProfilePhone").value = values.phone_e164 || "";
  document.getElementById("partnerProfileEmail").value = values.email || "";
}

function restorePartnerProfileSnapshot() {
  setPartnerProfileFormValues(partnerState.shopProfileSnapshot || {});
  showPartnerProfileFeedback("");
  document.getElementById("partnerCancelShopEditButton").hidden = true;
}

function cancelPartnerProfileEdits() {
  restorePartnerProfileSnapshot();
}

function resetPartnerProfileForm() {
  const shop = partnerState.shops.find(item => item.id === partnerState.shopId) || {};
  const values = {
    name: shop.name || "",
    description: shop.description || "",
    address_line1: shop.address_line1 || "",
    address_line2: shop.address_line2 || "",
    locality: shop.locality || "",
    city: shop.city || "",
    state: shop.state || "",
    postal_code: shop.postal_code || "",
    phone_e164: shop.phone_e164 || "",
    email: shop.email || ""
  };
  partnerState.shopProfileSnapshot = values;
  setPartnerProfileFormValues(values);
  showPartnerProfileFeedback("Edit form reset to the last saved shop values.");
  document.getElementById("partnerCancelShopEditButton").hidden = false;
}

async function savePartnerProfile(event) {
  event.preventDefault();
  const values = getPartnerProfileFormValues();
  const name = values.name || partnerState.label;
  const address = values.address_line1;
  const phone = values.phone_e164 || "";
  const postalCode = values.postal_code || "";

  if (!name || !address || !values.city || !values.state || !postalCode) {
    showPartnerProfileFeedback("Name, address, city, state, and postal code are required.", true);
    return;
  }
  if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    showPartnerProfileFeedback("Phone must use international format, such as +919999999999.", true);
    return;
  }
  if (postalCode.length > 16) {
    showPartnerProfileFeedback("Postal code is too long.", true);
    return;
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    showPartnerProfileFeedback("Email format is invalid.", true);
    return;
  }

  const body = {
    name,
    description: values.description || null,
    address_line1: address,
    address_line2: values.address_line2 || null,
    locality: values.locality || null,
    city: values.city,
    state: values.state,
    postal_code: postalCode,
    phone_e164: phone || null,
    email: values.email || null
  };

  const saveButton = document.getElementById("partnerSaveShopButton");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";
  showPartnerProfileFeedback("Saving shop details...");
  try {
    const updatedShop = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    partnerState.label = name;
    partnerState.shops = partnerState.shops.map(shop => shop.id === updatedShop.id ? { ...shop, ...updatedShop } : shop);
    partnerState.profileAddress = address;
    partnerState.shopProfileSnapshot = {
      name: updatedShop.name || "",
      description: updatedShop.description || "",
      address_line1: updatedShop.address_line1 || "",
      address_line2: updatedShop.address_line2 || "",
      locality: updatedShop.locality || "",
      city: updatedShop.city || "",
      state: updatedShop.state || "",
      postal_code: updatedShop.postal_code || "",
      phone_e164: updatedShop.phone_e164 || "",
      email: updatedShop.email || ""
    };
    setPartnerProfileFormValues(partnerState.shopProfileSnapshot);
    const selectedOption = document.getElementById("partnerShopSelect").selectedOptions[0];
    if (selectedOption) selectedOption.textContent = `${updatedShop.name} · ${updatedShop.city}`;
    document.getElementById("partnerDeskTitle").textContent = `${name} orders`;
    document.getElementById("partnerWelcomeTitle").textContent = name;
    document.getElementById("partnerHeaderSubtitle").textContent = name;
    document.getElementById("partnerSettingsShop").textContent = name;
    showPartnerProfileFeedback("Shop details saved successfully.");
    document.getElementById("partnerCancelShopEditButton").hidden = true;
  } catch (error) {
    console.error("Partner shop profile save failed:", error);
    showPartnerProfileFeedback(error.message || "Unable to save shop details.", true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save shop details";
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
  badge.textContent = formatPartnerShopStatus(partnerState.shopStatus);
  badge.classList.toggle("is-paused", partnerState.shopStatus === "PAUSED");
  badge.classList.toggle("is-closed", ["SUSPENDED", "CLOSED"].includes(partnerState.shopStatus));
  const infoValue = document.getElementById("partnerProfileStatusValue");
  if (infoValue) infoValue.textContent = formatPartnerShopStatus(partnerState.shopStatus);
}

async function togglePartnerShopStatus() {
  if (!["ACTIVE", "PAUSED"].includes(partnerState.shopStatus)) {
    showPartnerProfileFeedback("This shop status cannot be changed by the partner console.", true);
    return;
  }
  const status = partnerState.shopStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    const result = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    partnerState.shopStatus = result.status;
    partnerState.shops = partnerState.shops.map(shop => shop.id === partnerState.shopId ? { ...shop, status: result.status } : shop);
    renderPartnerShopStatus();
    showPartnerProfileFeedback(`Shop status updated to ${formatPartnerShopStatus(result.status)}.`);
  } catch (error) {
    console.error("Partner shop status update failed:", error);
    showPartnerProfileFeedback(error.message || "Unable to update shop status.", true);
  }
}

function getPartnerStatus(order) {
  return order.status || order.fulfillment_status || order.order_status || "PLACED";
}

function renderPartnerStatus(order) {
  const status = getPartnerStatus(order);
  const nextAction = {
    PLACED: ["ACCEPTED", "Accept order"],
    ACCEPTED: ["PREPARING", "Start preparing"],
    PREPARING: ["READY_FOR_PICKUP", "Ready for pickup"]
  }[status];
  if (!nextAction) return "";
  const [nextStatus, label] = nextAction;
  const updating = partnerState.orderStatusUpdating.has(order.id);
  const error = partnerState.orderStatusErrors.get(order.id);
  return `<div class="partner-order-action"><button type="button" class="partner-button partner-button-primary" ${updating ? "disabled" : ""} onclick="setPartnerStatus('${escapePartnerHtml(order.id)}', '${nextStatus}')">${updating ? "Updating..." : label}</button>${error ? `<p class="partner-order-error" role="alert">${escapePartnerHtml(error)}</p>` : ""}</div>`;
}

function formatPartnerOrderStatus(value) {
  return String(value || "Status unavailable").replace(/_/g, " ").toLowerCase()
    .replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function formatPartnerOrderTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date)
    : "Time unavailable";
}

function formatPartnerOrderDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "Date unavailable", time: "Time unavailable" };
  return {
    date: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date),
    time: new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(date)
  };
}

function escapePartnerCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildPartnerOrdersCsv(orders) {
  const columns = ["Order ID", "Date", "Time", "Customer", "Items", "Total", "Payment", "Status"];
  const rows = (Array.isArray(orders) ? orders : []).map(order => {
    const placed = formatPartnerOrderDateTime(order.placed_at);
    const items = (Array.isArray(order.items) ? order.items : []).map(item =>
      `${Number(item.quantity) || 0} x ${item.name || "Item"}${item.variant_name ? ` (${item.variant_name})` : ""}`
    ).join("; ");
    const total = Number(order.total_amount);
    const payment = [order.payment_method, order.payment_status].filter(Boolean).join(" / ");
    return [
      order.order_number || order.id,
      placed.date,
      `${placed.time} IST`,
      order.customer_name || "Customer",
      items,
      Number.isFinite(total) ? total.toFixed(2) : "",
      payment,
      formatPartnerOrderStatus(getPartnerStatus(order))
    ];
  });
  return [columns, ...rows].map(row => row.map(escapePartnerCsvValue).join(",")).join("\r\n");
}

function buildPartnerSalesReportCsv(dashboard, orders, shopName, generatedAt) {
  const summary = [
    ["Metric", "Value"],
    ["Shop", shopName || ""],
    ["Report generated (IST)", formatPartnerNotificationTime(generatedAt)],
    ["Order records included (API limit 100)", orders.length],
    ["Pending orders", Number(dashboard.pending_orders) || 0],
    ["Completed orders", Number(dashboard.completed_orders) || 0],
    ["Cancelled orders", Number(dashboard.cancelled_orders) || 0],
    ["Delivered sales (INR)", (Number(dashboard.delivered_item_value) || 0).toFixed(2)],
    [],
    ["Order ID", "Date", "Time", "Order Type", "Order Status", "Fulfillment Status", "Items", "Order Total (INR)", "Payment"]
  ];
  const rows = orders.map(order => {
    const placed = formatPartnerOrderDateTime(order.placed_at);
    const items = (Array.isArray(order.items) ? order.items : []).map(item =>
      `${Number(item.quantity) || 0} x ${item.name || "Item"}${item.variant_name ? ` (${item.variant_name})` : ""}`
    ).join("; ");
    const total = Number(order.total_amount);
    return [
      order.order_number || order.id,
      placed.date,
      `${placed.time} IST`,
      formatPartnerOrderStatus(order.order_type),
      formatPartnerOrderStatus(order.order_status),
      formatPartnerOrderStatus(getPartnerStatus(order)),
      items,
      Number.isFinite(total) ? total.toFixed(2) : "",
      [order.payment_method, order.payment_status].filter(Boolean).join(" / ")
    ];
  });
  return [...summary, ...rows].map(row => row.map(escapePartnerCsvValue).join(",")).join("\r\n");
}

function triggerPartnerCsvDownload(csv, filename) {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function downloadPartnerOrdersCsv() {
  const button = document.getElementById("partnerOrderCsvButton");
  const message = document.getElementById("partnerOrderCsvStatus");
  const shopId = partnerState.shopId;
  const token = getPartnerAccessToken();
  if (!shopId || !token || partnerState.orderCsvDownloading) return;

  partnerState.orderCsvDownloading = true;
  button.disabled = true;
  button.textContent = "Preparing CSV...";
  message.textContent = "Preparing the current shop's orders...";
  try {
    const rows = await partnerApiRequest(`/orders?bucket=all&shop_id=${encodeURIComponent(shopId)}`);
    if (shopId !== partnerState.shopId || token !== getPartnerAccessToken()) return;
    const orders = (Array.isArray(rows) ? rows : []).filter(order => order.shop_id === shopId);
    const csv = buildPartnerOrdersCsv(orders);
    triggerPartnerCsvDownload(csv, `myshopzy-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    message.textContent = `Downloaded CSV with ${orders.length} orders.`;
  } catch (error) {
    if (shopId === partnerState.shopId && token === getPartnerAccessToken()) {
      message.textContent = error.message;
    }
  } finally {
    partnerState.orderCsvDownloading = false;
    button.disabled = false;
    button.textContent = "Download CSV";
  }
}

async function downloadPartnerSalesReportCsv() {
  const button = document.getElementById("partnerReportCsvButton");
  const message = document.getElementById("partnerReportCsvStatus");
  const shopId = partnerState.shopId;
  const token = getPartnerAccessToken();
  if (!shopId || !token || partnerState.reportCsvDownloading) return;

  partnerState.reportCsvDownloading = true;
  button.disabled = true;
  button.textContent = "Preparing...";
  message.textContent = "Preparing this shop's report...";
  try {
    const [dashboard, rows] = await Promise.all([
      partnerApiRequest(`/shops/${encodeURIComponent(shopId)}/dashboard`),
      partnerApiRequest(`/orders?bucket=all&shop_id=${encodeURIComponent(shopId)}`)
    ]);
    if (shopId !== partnerState.shopId || token !== getPartnerAccessToken()) return;
    const orders = (Array.isArray(rows) ? rows : []).filter(order => order.shop_id === shopId);
    const generatedAt = new Date();
    const csv = buildPartnerSalesReportCsv(dashboard, orders, partnerState.label, generatedAt);
    triggerPartnerCsvDownload(csv, `myshopzy-sales-report-${generatedAt.toISOString().slice(0, 10)}.csv`);
    message.textContent = `Downloaded report with ${orders.length} orders.`;
  } catch (error) {
    if (shopId === partnerState.shopId && token === getPartnerAccessToken()) message.textContent = error.message;
  } finally {
    partnerState.reportCsvDownloading = false;
    button.disabled = false;
    button.textContent = "Download report CSV";
  }
}

function formatPartnerOrderCurrency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function maskPartnerRiderPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits || digits.length < 4) return "Not available";
  const lastFour = digits.slice(-4);
  const masked = digits.length > 10 ? `••••••${lastFour}` : `•••••${lastFour}`;
  return digits.length > 10 ? `+${digits.slice(0, 2)}${masked}` : `+91${masked}`;
}

function renderPartnerRiderDetails(order) {
  const riderAssigned = Boolean(order.assigned_rider_id || order.assigned_rider || order.rider_id || order.rider_phone);
  if (!riderAssigned) {
    return `<div class="partner-rider-card"><p class="partner-order-detail-empty">Rider not assigned yet</p></div>`;
  }

  const riderName = order.assigned_rider || order.rider_name || "Not available";
  const riderPhone = order.rider_phone ? maskPartnerRiderPhone(order.rider_phone) : "Not available";
  const vehicleType = order.rider_vehicle_type || order.vehicle_type || "Not available";
  const vehicleNumber = order.rider_vehicle_number || order.vehicle_registration || order.vehicle_number || "Not available";
  const assignmentStatus = order.assignment_status || "Not available";
  const pickupStatus = Array.isArray(order.fulfillments) && order.fulfillments.some(item => item && item.status)
    ? order.fulfillments.find(item => item && item.status)?.status || "Not available"
    : "Not available";
  const deliveryStatus = order.assignment_status || (typeof order.status === "string" ? order.status : "Not available");

  return `<div class="partner-rider-card"><div class="partner-rider-grid"><div class="partner-rider-metric"><span>Rider name</span><strong>${escapePartnerHtml(riderName)}</strong></div><div class="partner-rider-metric"><span>Masked phone</span><strong>${escapePartnerHtml(riderPhone)}</strong></div><div class="partner-rider-metric"><span>Vehicle type</span><strong>${escapePartnerHtml(vehicleType)}</strong></div><div class="partner-rider-metric"><span>Vehicle number</span><strong>${escapePartnerHtml(vehicleNumber)}</strong></div><div class="partner-rider-metric"><span>Assignment status</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(assignmentStatus))}</strong></div><div class="partner-rider-metric"><span>Assigned time</span><strong>${escapePartnerHtml(order.assigned_at ? formatPartnerNotificationTime(order.assigned_at) : "Not available")}</strong></div><div class="partner-rider-metric"><span>Pickup status</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(pickupStatus))}</strong></div><div class="partner-rider-metric"><span>Delivery status</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(deliveryStatus))}</strong></div></div></div>`;
}

function matchesPartnerOrderStatus(order) {
  const status = getPartnerStatus(order);
  switch (partnerState.orderStatusFilter) {
    case "NEW": return ["PLACED", "ACCEPTED"].includes(status);
    case "PREPARING": return status === "PREPARING";
    case "READY_FOR_PICKUP": return status === "READY_FOR_PICKUP";
    case "COMPLETED": return order.order_status === "DELIVERED" || status === "DELIVERED";
    case "CANCELLED": return order.order_status === "CANCELLED" || status === "CANCELLED";
    default: return true;
  }
}

function setPartnerOrderStatusFilter(filter) {
  partnerState.orderStatusFilter = filter;
  const bucket = filter === "ALL" ? "all"
    : ["COMPLETED", "CANCELLED"].includes(filter) ? "past" : "active";
  document.getElementById("partnerOrderBucket").value = bucket;
  startPartnerOrderListener(bucket);
}

function renderPartnerOrders() {
  const container = document.getElementById("partnerOrdersContainer");
  if (!container) return;
  const liveOrders = partnerState.allOrders.filter(order => ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP"].includes(order.order_status));
  const newCount = liveOrders.filter(order => ["PLACED", "ACCEPTED"].includes(getPartnerStatus(order))).length;
  const preparingCount = liveOrders.filter(order => getPartnerStatus(order) === "PREPARING").length;
  const readyCount = liveOrders.filter(order => getPartnerStatus(order) === "READY_FOR_PICKUP").length;
  document.getElementById("partnerNewCount").textContent = newCount;
  document.getElementById("partnerPreparingCount").textContent = preparingCount;
  document.getElementById("partnerReadyCount").textContent = readyCount;
  const navCount = document.getElementById("partnerNavOrderCount");
  navCount.textContent = liveOrders.length;
  navCount.hidden = liveOrders.length === 0;

  const partnerOrders = partnerState.orders.filter(matchesPartnerOrderStatus);
  if (!partnerOrders.length) {
    container.innerHTML = `<p class="partner-empty">${partnerState.orders.length ? "No orders match this filter" : "No orders yet"}</p>`;
    return;
  }
  container.innerHTML = partnerOrders.map(order => {
    const items = (order.items || []).map(item => `${Number(item.quantity) || 0}x ${escapePartnerHtml(item.name)}`).join("<br>");
    const isSelectedOrder = order.id === partnerState.selectedOrderId;
    const placedAt = formatPartnerOrderDateTime(order.placed_at);
    const pickupCodeAction = getPartnerStatus(order) === "READY_FOR_PICKUP"
      ? `<div class="partner-pickup-code-action"><button type="button" id="partnerPickupCodeButton_${escapePartnerHtml(order.id)}" class="partner-button partner-button-outline" onclick="requestPartnerPickupCode('${escapePartnerHtml(order.id)}')">Send pickup code</button><p id="partnerPickupCodeMessage_${escapePartnerHtml(order.id)}" role="status" aria-live="polite"></p></div>`
      : "";
    return `<article id="partnerOrder_${escapePartnerHtml(order.id)}" tabindex="-1" class="partner-order-card ${isSelectedOrder ? "is-notification-target" : ""}">
      <div class="partner-order-card-head"><div><h3>${escapePartnerHtml(order.order_number || order.id)}</h3><p>${escapePartnerHtml(order.customer_name || "Customer")}</p></div><span class="partner-order-badge">${escapePartnerHtml(formatPartnerOrderStatus(getPartnerStatus(order)))}</span></div>
      <div class="partner-order-card-meta"><span>${escapePartnerHtml(formatPartnerOrderStatus(order.order_type))}</span><span>Date: ${escapePartnerHtml(placedAt.date)}</span><span>Time: ${escapePartnerHtml(placedAt.time)} IST</span><strong>${escapePartnerHtml(formatPartnerOrderCurrency(order.total_amount))}</strong></div>
      <p class="partner-order-items">${items || "No item details"}</p>
      <div class="partner-order-card-meta"><span>Payment: ${escapePartnerHtml(formatPartnerOrderStatus(order.payment_status))}</span><span>Order: ${escapePartnerHtml(formatPartnerOrderStatus(order.order_status))}</span></div>
      <p class="partner-order-address">Shop pickup: ${escapePartnerHtml(order.pickup_address || "Pickup location unavailable")}</p>
      <div class="partner-order-card-actions"><button type="button" class="partner-button partner-button-outline" onclick="openPartnerOrderDetail('${escapePartnerHtml(order.id)}')">View details</button>${renderPartnerStatus(order)}</div>
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

function renderPartnerOrderDetail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const placedAt = formatPartnerOrderDateTime(order.placed_at);
  const itemRows = items.length ? items.map(item => {
    const description = [item.name, item.variant_name, item.unit].filter(Boolean).map(escapePartnerHtml).join(" · ");
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    const lineTotal = item.line_total == null ? quantity * price : Number(item.line_total);
    return `<div class="partner-order-detail-item"><span><strong>${description || "Item"}</strong><small>${quantity} × ${escapePartnerHtml(formatPartnerOrderCurrency(price))}</small></span><strong>${escapePartnerHtml(formatPartnerOrderCurrency(lineTotal))}</strong></div>`;
  }).join("") : '<p class="partner-order-detail-empty">No item details are available.</p>';
  const optionalAddress = order.delivery_address
    ? `<section class="partner-order-detail-section"><h3>Delivery address</h3><p>${escapePartnerHtml(order.delivery_address)}</p></section>`
    : "";
  return `<div class="partner-order-detail-summary"><div><span>Order type</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(order.order_type))}</strong></div><div><span>Order status</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(order.order_status))}</strong></div><div><span>Fulfillment status</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(order.status))}</strong></div><div><span>Payment</span><strong>${escapePartnerHtml(formatPartnerOrderStatus(order.payment_method))} · ${escapePartnerHtml(formatPartnerOrderStatus(order.payment_status))}</strong></div><div><span>Placed date</span><strong>${escapePartnerHtml(placedAt.date)}</strong></div><div><span>Placed time (IST)</span><strong>${escapePartnerHtml(placedAt.time)}</strong></div></div>
    <section class="partner-order-detail-section"><h3>Delivery</h3>${renderPartnerRiderDetails(order)}</section>
    <section class="partner-order-detail-section"><h3>Items</h3><div class="partner-order-detail-items">${itemRows}</div></section>
    <section class="partner-order-detail-section"><h3>Payment summary</h3><dl class="partner-order-totals"><div><dt>Subtotal</dt><dd>${escapePartnerHtml(formatPartnerOrderCurrency(order.subtotal))}</dd></div><div><dt>Delivery charge</dt><dd>${escapePartnerHtml(formatPartnerOrderCurrency(order.delivery_fee))}</dd></div><div><dt>Discount</dt><dd>−${escapePartnerHtml(formatPartnerOrderCurrency(order.discount_amount))}</dd></div><div><dt>Tax</dt><dd>${escapePartnerHtml(formatPartnerOrderCurrency(order.tax_amount))}</dd></div><div class="is-total"><dt>Total</dt><dd>${escapePartnerHtml(formatPartnerOrderCurrency(order.total_amount))}</dd></div></dl></section>
    <section class="partner-order-detail-section"><h3>Shop pickup</h3><p>${escapePartnerHtml(order.pickup_address || "Pickup location unavailable")}</p></section>${optionalAddress}`;
}

async function openPartnerOrderDetail(orderId) {
  const dialog = document.getElementById("partnerOrderDetailDialog");
  const title = document.getElementById("partnerOrderDetailTitle");
  const content = document.getElementById("partnerOrderDetailContent");
  const shopId = partnerState.shopId;
  const requestId = ++partnerState.orderDetailRequestId;
  title.textContent = "Order details";
  content.innerHTML = '<p class="partner-order-detail-empty">Loading order details...</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const result = await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}?shop_id=${encodeURIComponent(shopId)}`);
    if (requestId !== partnerState.orderDetailRequestId || !dialog.open || shopId !== partnerState.shopId) return;
    const order = (Array.isArray(result) ? result : []).find(item => item.shop_id === shopId);
    if (!order) throw new Error("Order not found for this shop.");
    title.textContent = order.order_number || "Order details";
    content.innerHTML = renderPartnerOrderDetail(order);
  } catch (error) {
    if (requestId !== partnerState.orderDetailRequestId || !dialog.open) return;
    content.innerHTML = `<p class="partner-order-detail-empty" role="alert">${escapePartnerHtml(error.message)}</p>`;
  }
}

function closePartnerOrderDetail() {
  partnerState.orderDetailRequestId += 1;
  const dialog = document.getElementById("partnerOrderDetailDialog");
  if (dialog?.open) dialog.close();
}

async function startPartnerOrderListener(bucket = partnerState.orderBucket) {
  partnerState.orderBucket = bucket;
  const shopId = partnerState.shopId;
  const requestId = ++partnerState.orderListRequestId;
  try {
    const orders = await partnerApiRequest(`/orders?bucket=${encodeURIComponent(bucket)}&shop_id=${encodeURIComponent(shopId)}`);
    if (requestId !== partnerState.orderListRequestId || shopId !== partnerState.shopId) return;
    partnerState.orders = Array.isArray(orders) ? orders : [];
    if (bucket === "all") partnerState.allOrders = partnerState.orders;
    renderPartnerOrders();
  } catch (error) {
    if (requestId !== partnerState.orderListRequestId || shopId !== partnerState.shopId) return;
    console.error("Partner order API failed:", error);
    document.getElementById("partnerOrdersContainer").innerHTML = `<p class="text-center text-rose-500 py-10 text-xs">${escapePartnerHtml(error.message)}</p>`;
  }
}

function startPartnerOrderRefresh() {
  if (partnerState.orderRefreshTimer) window.clearInterval(partnerState.orderRefreshTimer);
  partnerState.orderRefreshTimer = null;
  if (!getPartnerAccessToken() || !partnerState.shopId || document.visibilityState === "hidden") return;
  partnerState.orderRefreshTimer = window.setInterval(() => {
    refreshPartnerOrders();
    refreshPartnerNotifications(true);
  }, 15000);
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
    refreshPartnerNotifications(true);
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
    partnerState.reportDataUpdatedAt = new Date();
    const activeStatuses = new Set(["DRAFT", "PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "PICKING_UP", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"]);
    const pastStatuses = new Set(["DELIVERED", "CANCELLED", "REJECTED"]);
    partnerState.orders = partnerState.orderBucket === "past"
      ? partnerState.allOrders.filter(order => pastStatuses.has(order.order_status))
      : partnerState.orderBucket === "all"
        ? partnerState.allOrders
        : partnerState.allOrders.filter(order => activeStatuses.has(order.order_status));
    renderPartnerDashboard(dashboard);
    renderPartnerOrders();
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
  if (button) button.textContent = "Sending...";
  if (message) message.textContent = "Sending code to the shop contact...";
  try {
    await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(partnerState.shopId)}/pickup-otp`, {
      method: "POST"
    });
    if (message) message.textContent = "Pickup code sent to the shop's registered contact.";
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Send pickup code";
    }
  }
}

async function setPartnerStatus(orderId, status) {
  if (!partnerState.shopId || partnerState.orderStatusUpdating.has(orderId)) return;
  partnerState.orderStatusUpdating.add(orderId);
  partnerState.orderStatusErrors.delete(orderId);
  renderPartnerOrders();
  try {
    await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await startPartnerOrderListener(partnerState.orderBucket);
  } catch (error) {
    partnerState.orderStatusErrors.set(orderId, error.message);
  } finally {
    partnerState.orderStatusUpdating.delete(orderId);
    renderPartnerOrders();
  }
}

document.addEventListener("DOMContentLoaded", loadPartnerRestaurants);
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
