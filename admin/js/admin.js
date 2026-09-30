// ==========================================
// 🛡️ ADMIN OPERATIONS HUB ENGINE (admin.js)
// ==========================================

let allFetchedOrders = [];
let selectedFilterDate = ""; // Empty means today
let selectedFilterToDate = "";
let salesReportOrders = [];
let salesShopPage = 0;
let salesOrderPage = 0;
let salesReportRequestId = 0;
const SALES_REPORT_PAGE_SIZE = 25;
let ADMIN_RIDER_PROFILES = [];
let ADMIN_DELIVERY_RIDERS = [];
let adminOrderIdsInitialized = false;
let adminOrderPollTimer = null;
let adminTrackingPollTimer = null;
let adminKnownOrderIds = new Set();
let adminCountdownTimer = null;
let pendingAdminOrderAlerts = [];
let adminAlertSoundStopped = false;
const ADMIN_ORDER_SOUND = new Audio("../assets/audio/admin-rider-order.mpeg");
const ADMIN_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
const ADMIN_RIDER_API_BASE_URL = 'http://localhost:5000';
ADMIN_ORDER_SOUND.loop = true;

async function adminRiderApiRequest(path, options = {}) {
  const response = await fetch(`${ADMIN_RIDER_API_BASE_URL}${path}`, {
    headers: buildAdminApiHeaders({
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }),
    ...options
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) {
      ['admin_access_token', 'myshopzy_admin_access_token'].forEach(key => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      });
      sessionStorage.removeItem('hub_session_unlocked');
      document.getElementById('adminAuthLock')?.classList.remove('hidden');
    }
    const message = payload?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function loadAdminRiderEarningConfig() {
  const status = document.getElementById('riderEarningConfigStatus');
  if (status) status.textContent = 'Loading rider earnings configuration...';
  try {
    const result = await adminRiderApiRequest('/api/admin/deliveries/rider-earnings/config', { cache: 'no-store' });
    const config = result.data;
    const base = document.getElementById('riderBaseEarningInput');
    const rain = document.getElementById('riderRainSurgeInput');
    const active = document.getElementById('riderRainSurgeActiveInput');
    if (base) base.value = String(config.base_earning_inr);
    if (rain) rain.value = String(config.rain_surge_inr);
    if (active) active.checked = Boolean(config.rain_surge_active);
    if (status) status.textContent = config.configured ? 'Saved configuration loaded.' : 'Default configuration loaded.';
  } catch (error) {
    if (status) status.textContent = error.message || 'Unable to load rider earnings configuration.';
  }
}

async function saveAdminRiderEarningConfig(event) {
  event.preventDefault();
  const button = document.getElementById('saveRiderEarningConfigButton');
  const status = document.getElementById('riderEarningConfigStatus');
  const payload = {
    base_earning_inr: Number(document.getElementById('riderBaseEarningInput')?.value),
    rain_surge_inr: Number(document.getElementById('riderRainSurgeInput')?.value),
    rain_surge_active: Boolean(document.getElementById('riderRainSurgeActiveInput')?.checked)
  };
  if (button) button.disabled = true;
  if (status) status.textContent = 'Saving rider earnings configuration...';
  try {
    const result = await adminRiderApiRequest('/api/admin/deliveries/rider-earnings/config', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (status) status.textContent = 'Rider earnings configuration saved.';
    if (result.data) {
      const base = document.getElementById('riderBaseEarningInput');
      const rain = document.getElementById('riderRainSurgeInput');
      if (base) base.value = String(result.data.base_earning_inr);
      if (rain) rain.value = String(result.data.rain_surge_inr);
    }
  } catch (error) {
    if (status) status.textContent = error.message || 'Unable to save rider earnings configuration.';
  } finally {
    if (button) button.disabled = false;
  }
}

function stopAdminOrderSound() {
  ADMIN_ORDER_SOUND.pause();
  ADMIN_ORDER_SOUND.currentTime = 0;
}

function showNextAdminOrderAlert() {
  const order = pendingAdminOrderAlerts[0];
  const alertBox = document.getElementById("adminNewOrderAlert");
  if (!order || !alertBox) {
    if (alertBox) alertBox.classList.add("hidden");
    return;
  }

  alertBox.classList.remove("hidden");
  document.getElementById("adminAlertOrderId").innerText = order.id;
  document.getElementById("adminAlertCustomer").innerText = order.customer_name || order.customer_phone || "Customer";
  document.getElementById("adminAlertAmount").innerText = `₹${Number(order.total_amount || order.total || 0)}`;
  if (!adminAlertSoundStopped) ADMIN_ORDER_SOUND.play().catch(() => {});
}

function stopAdminOrderAlertSound() {
  adminAlertSoundStopped = true;
  stopAdminOrderSound();
}

async function acceptAdminOrderAlert() {
  if (!pendingAdminOrderAlerts.length) return;
  pendingAdminOrderAlerts.shift();
  adminAlertSoundStopped = false;
  stopAdminOrderSound();
  showNextAdminOrderAlert();
}

function getAdminOrderDeadlineMs(order) {
  const deadline = Number(order?.delivery_deadline_ms);
  if (Number.isFinite(deadline)) return deadline;
  const createdAt = Number(order?.created_at_ms);
  return Number.isFinite(createdAt) ? createdAt + (25 * 60 * 1000) : null;
}

function formatAdminCountdown(order) {
  if (String(order?.status || "").toUpperCase() === "DELIVERED") return "Delivered";
  const deadline = getAdminOrderDeadlineMs(order);
  if (!Number.isFinite(deadline)) return "25 min delivery";
  const remaining = Math.max(0, deadline - Date.now());
  return remaining > 0
    ? `${Math.floor(remaining / 60000)}:${Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0")} left`
    : "Arriving now";
}

function updateAdminCountdowns() {
  document.querySelectorAll("[data-admin-delivery-deadline]").forEach(element => {
    const order = allFetchedOrders.find(item => item.id === element.dataset.orderId);
    if (order) element.innerText = formatAdminCountdown(order);
  });
}

function formatOrderDateTime(order) {
  let date = null;
  if (Number.isFinite(Number(order?.created_at_ms))) {
    date = new Date(Number(order.created_at_ms));
  } else if (order?.created_at?.toDate) {
    date = order.created_at.toDate();
  } else if (order?.created_at?.seconds) {
    date = new Date(Number(order.created_at.seconds) * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function getAdminLocalDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getAdminReportDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getAdminOrderDateKey(order) {
  if (Number.isFinite(Number(order?.created_at_ms))) {
    return getAdminLocalDateKey(new Date(Number(order.created_at_ms)));
  }
  if (order?.created_at?.toDate) return getAdminLocalDateKey(order.created_at.toDate());
  if (order?.created_at?.seconds) return getAdminLocalDateKey(new Date(Number(order.created_at.seconds) * 1000));
  return "";
}

async function startRegisteredRiderListener() {
  try {
    const result = await adminRiderApiRequest('/api/admin/riders');
    const profiles = Array.isArray(result?.data) ? result.data : [];
    ADMIN_RIDER_PROFILES = profiles.map(profile => ({
      ...profile,
      name: profile.name || profile.display_name || 'Unnamed rider',
      mobile: profile.mobile || profile.phone_e164 || '-',
      email: profile.email || '-',
      verification_status: profile.verification_status || 'PENDING'
    }));
    await loadEligibleDeliveryRiders();
    renderAdminRiderStatus();
    renderRiderVerificationQueue();
    refreshAdminRiderAssignmentFields();
  } catch (error) {
    console.error("Registered rider listener error:", error);
  }
}

async function loadEligibleDeliveryRiders() {
  try {
    const result = await adminRiderApiRequest('/api/admin/deliveries/riders');
    ADMIN_DELIVERY_RIDERS = Array.isArray(result?.data) ? result.data : [];
  } catch (error) {
    ADMIN_DELIVERY_RIDERS = [];
    console.error('Eligible delivery rider lookup failed:', error);
  }
}

function renderRiderVerificationQueue() {
  const container = document.getElementById("riderVerificationQueue");
  if (!container) return;
  const pending = ADMIN_RIDER_PROFILES.filter(profile => ["PENDING", "SUBMITTED"].includes(String(profile.verification_status || "PENDING").toUpperCase()));
  if (!pending.length) {
    container.innerHTML = '<p class="text-xs font-bold text-emerald-700">No pending rider verification requests.</p>';
    return;
  }
  container.innerHTML = pending.map(profile => `
    <article class="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div><h3 class="text-base font-black text-slate-900">${escapeAdminHtml(profile.name || "Unnamed rider")}</h3><p class="text-xs text-slate-500">${escapeAdminHtml(profile.mobile || "-")} · ${escapeAdminHtml(profile.email || "-")}</p></div>
        <span class="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">${escapeAdminHtml(profile.verification_status || "PENDING")}</span>
      </div>
      <div class="mt-2 grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-600">
        <span>Aadhaar: ****${escapeAdminHtml(profile.aadhaar_last4 || "----")}</span>
        <span>PAN: ****${escapeAdminHtml(profile.pan_last4 || "----")}</span>
      </div>
      <div class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${renderRiderVerificationDocument(profile, "Selfie", "selfie_path", "selfie_file")}
        ${renderRiderVerificationDocument(profile, "Aadhaar", "aadhaar_path", "aadhaar_file")}
        ${renderRiderVerificationDocument(profile, "PAN", "pan_path", "pan_file")}
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <button ${profile.selfie_path && profile.aadhaar_path && profile.pan_path ? "" : "disabled"} onclick="reviewRiderVerification('${encodeURIComponent(profile.id)}', 'APPROVED')" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">Accept rider</button>
        <button onclick="reviewRiderVerification('${encodeURIComponent(profile.id)}', 'REJECTED')" class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">Reject rider</button>
      </div>
    </article>
  `).join("");
  loadRiderVerificationPreviews(container);
}

function renderRiderVerificationDocument(profile, label, pathField, fileField) {
  const path = profile[pathField];
  if (!path) {
    return `<div class="overflow-hidden rounded-xl border border-rose-200 bg-rose-50"><div class="flex aspect-[4/3] items-center justify-center px-2 text-center text-xs font-bold text-rose-700">${label} not uploaded</div></div>`;
  }
  const encodedPath = encodeURIComponent(path);
  const fileName = profile[fileField] || "Uploaded document";
  return `<div class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <button type="button" onclick="openRiderVerificationDocument('${encodedPath}')" class="block w-full text-left" aria-label="Open ${label} document for ${escapeAdminHtml(profile.name || "rider")}">
      <div class="relative flex aspect-[4/3] items-center justify-center bg-slate-100">
        <img data-rider-document-preview="${encodedPath}" alt="${label} document for ${escapeAdminHtml(profile.name || "rider")}" class="hidden h-full w-full object-contain">
        <span data-rider-document-status class="px-2 text-center text-xs font-bold text-slate-500">Loading ${label} preview...</span>
      </div>
      <div class="p-2"><span class="block text-xs font-black text-slate-800">${label} photo · Open full size</span><span class="block truncate text-[10px] text-slate-500" title="${escapeAdminHtml(fileName)}">${escapeAdminHtml(fileName)}</span></div>
    </button>
  </div>`;
}

async function loadRiderVerificationPreviews(container) {
  const images = container.querySelectorAll("[data-rider-document-preview]");
  await Promise.all(Array.from(images, async image => {
    const status = image.parentElement.querySelector("[data-rider-document-status]");
    try {
      const path = decodeURIComponent(image.dataset.riderDocumentPreview);
      image.src = await firebase.storage().ref(path).getDownloadURL();
      image.onload = () => {
        image.classList.remove("hidden");
        status?.remove();
      };
      image.onerror = () => {
        if (status) status.textContent = "Preview unavailable. Open to retry.";
      };
    } catch (error) {
      if (status) status.textContent = "Preview unavailable. Check Storage access.";
    }
  }));
}

function escapeAdminHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

async function openRiderVerificationDocument(encodedPath) {
  const documentWindow = window.open("about:blank", "_blank");
  if (!documentWindow) {
    alert("Allow pop-ups to open the full-size document. The preview is available in the rider card.");
    return;
  }
  try {
    const path = decodeURIComponent(encodedPath);
    const url = await firebase.storage().ref(path).getDownloadURL();
    documentWindow.location.href = url;
  } catch (error) {
    documentWindow.close();
    alert("Unable to open document. Check Firebase Storage rules.");
  }
}

async function reviewRiderVerification(encodedId, status) {
  const riderId = decodeURIComponent(encodedId);
  const reason = status === "REJECTED" ? prompt("Reason for rejecting this rider:") : "";
  if (status === "REJECTED" && !reason) return;
  try {
    await adminRiderApiRequest(`/api/admin/riders/${riderId}/verification`, {
      method: 'PATCH',
      body: JSON.stringify({ verification_status: status, ...(reason ? { review_reason: reason } : {}) })
    });
    await startRegisteredRiderListener();
  } catch (error) {
    alert(`Rider review failed: ${error.message}`);
  }
}

function renderAdminRiderStatus() {
  const container = document.getElementById("adminRiderStatusList");
  if (!container) return;
  container.innerHTML = ADMIN_DELIVERY_RIDERS.map(rider => `
    <span class="text-[10px] font-bold text-slate-800 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
      🛵 ${escapeAdminHtml(rider.name)}: <strong class="text-emerald-600">Available</strong>
    </span>
  `).join("");
}

function renderRiderAssignment(order) {
  const assignmentIsActive = ['OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(order.assignment_status);
  if (order.assignment_id && assignmentIsActive) {
    const status = order.assignment_status;
    const assignedName = order.assigned_rider || 'Rider response pending';
    return `
      <div class="flex flex-wrap items-center gap-2 mt-2">
        <span class="text-[11px] font-bold text-slate-700">${escapeAdminHtml(assignedName)} · ${escapeAdminHtml(status)}</span>
        <button onclick="openAdminRiderTracker('${escapeAdminHtml(order.assignment_id)}')" class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold">Track rider</button>
      </div>`;
  }

  const eligible = order.order_type === 'PARCEL'
    ? order.status === 'PLACED'
    : order.status === 'READY_FOR_PICKUP'
      && Array.isArray(order.fulfillments)
      && order.fulfillments.length > 0
      && order.fulfillments.every(fulfillment => fulfillment.status === 'READY_FOR_PICKUP');
  if (!eligible) {
    return order.assignment_status
      ? `<p class="mt-2 text-[10px] font-bold text-slate-500">Last assignment: ${escapeAdminHtml(order.assigned_rider || 'Rider')} · ${escapeAdminHtml(order.assignment_status)}</p>`
      : '<p class="mt-2 text-[10px] font-bold text-slate-500">Assignment opens when the order is ready for pickup.</p>';
  }

  return `
    <div class="flex flex-wrap items-center gap-2 mt-2">
      ${order.assignment_status ? `<span class="text-[10px] font-bold text-slate-500">Previous: ${escapeAdminHtml(order.assignment_status)}</span>` : ''}
      <select data-admin-rider-select="true" data-order-id="${escapeAdminHtml(order.id)}" onchange="assignOrderToRider('${escapeAdminHtml(order.id)}', this.value)" class="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-700">
        <option value="">Assign rider...</option>
        ${renderAdminRiderOptions()}
      </select>
    </div>
  `;
}

function renderAdminRiderOptions(selectedRiderId = "") {
  return ADMIN_DELIVERY_RIDERS.map(rider => {
    return `<option value="${rider.id}" ${selectedRiderId === rider.id ? "selected" : ""}>${escapeAdminHtml(rider.name)} - Available</option>`;
  }).join("");
}

function refreshAdminRiderAssignmentFields() {
  document.querySelectorAll("[data-admin-rider-select]").forEach(select => {
    const selectedRider = select.value;
    select.innerHTML = `<option value="">Assign rider...</option>${renderAdminRiderOptions(selectedRider)}`;
    select.value = selectedRider;
  });
}

async function assignOrderToRider(orderId, riderId) {
  if (!riderId) return;
  try {
    await adminRiderApiRequest('/api/admin/deliveries/assignments', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, rider_id: riderId })
    });
    await loadEligibleDeliveryRiders();
    await startLiveOrderQueue();
  } catch (error) {
    console.error("Rider assignment failed:", error);
    alert("Unable to assign rider: " + error.message);
  }
}

async function verifyAdminAccess() {
  const identifierInput = document.getElementById('adminLoginIdentifier');
  const passwordInput = document.getElementById('adminLoginPassword');
  const errorMessage = document.getElementById('adminLoginError');
  const button = document.getElementById('adminLoginButton');
  const identifier = identifierInput?.value.trim() || '';
  const password = passwordInput?.value || '';
  if (!identifier || !password || !errorMessage || !button) return;

  errorMessage.classList.add('hidden');
  button.disabled = true;
  button.textContent = 'Signing In...';
  try {
    const response = await fetch(`${ADMIN_RIDER_API_BASE_URL}/api/admin/auth/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || typeof payload?.access_token !== 'string') {
      throw new Error(payload?.message || 'Unable to sign in.');
    }
    sessionStorage.setItem('admin_access_token', payload.access_token);
    sessionStorage.setItem('hub_session_unlocked', 'true');
    passwordInput.value = '';
    document.getElementById('adminAuthLock')?.classList.add('hidden');
    switchView('orders');
  } catch (error) {
    errorMessage.textContent = error.message || 'Unable to sign in.';
    errorMessage.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign In';
  }
}

// 4-TAB SWITCHER
function switchView(tab) {
  const selectedTab = String(tab || 'home');
  const homeSec = document.getElementById('homeViewSection');
  const ordersSec = document.getElementById('ordersViewSection');
  const analyticsSec = document.getElementById('analyticsViewSection');
  const riderSec = document.getElementById('riderVerificationViewSection');
  const expensesSec = document.getElementById('expensesViewSection');
  const pricingSec = document.getElementById('deliveryPricingViewSection');
  const invSec = document.getElementById('inventoryViewSection');
  const partnersSec = document.getElementById('partnersViewSection');
  const banSec = document.getElementById('bannersViewSection');
  const categoriesSec = document.getElementById('categoriesViewSection');

  const navbarButtons = Array.from(document.querySelectorAll('.nav-item'));
  [homeSec, ordersSec, analyticsSec, riderSec, expensesSec, pricingSec, invSec, partnersSec, banSec, categoriesSec].forEach(el => el && el.classList.add('hidden'));
  navbarButtons.forEach((item) => {
    const itemTab = String(item.dataset.tab || '');
    const active = itemTab === selectedTab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });

  if (selectedTab === 'home') {
    if (homeSec) homeSec.classList.remove('hidden');
  } else if (selectedTab === 'orders') {
    if (ordersSec) ordersSec.classList.remove('hidden');
    renderRiderVerificationQueue();
    const container = document.getElementById('adminQueueContainer');
    if (container) {
      container.innerHTML = '<p class="text-sm font-bold text-slate-500">Loading dispatch queue...</p>';
    }
  } else if (selectedTab === 'analytics') {
    if (analyticsSec) analyticsSec.classList.remove('hidden');
    initSalesDatePicker();
    calculateAndRenderAnalytics();
  } else if (selectedTab === 'riderVerification') {
    if (riderSec) riderSec.classList.remove('hidden');
    renderRiderVerificationQueue();
  } else if (selectedTab === 'expenses') {
    if (expensesSec) expensesSec.classList.remove('hidden');
  } else if (selectedTab === 'deliveryPricing') {
    if (pricingSec) pricingSec.classList.remove('hidden');
    loadAdminRiderEarningConfig();
  } else if (selectedTab === 'inventory') {
    if (invSec) invSec.classList.remove('hidden');
    loadAdminInventory();
    loadAdminPostgresCatalog();
  } else if (selectedTab === 'partners') {
    if (partnersSec) partnersSec.classList.remove('hidden');
  } else if (selectedTab === 'banners') {
    if (banSec) banSec.classList.remove('hidden');
    loadAdminBanners();
    loadAdminDailyOffer();
  } else if (selectedTab === 'categories') {
    if (categoriesSec) categoriesSec.classList.remove('hidden');
    loadCategoryManager();
  }
}

// AUTO COMPRESSOR (400x400 - 25KB WebP)
function compressImageFile(file, maxWidth = 400, maxHeight = 400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedBase64 = canvas.toDataURL('image/webp', quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

let selectedProductBase64 = "";
let adminRestaurants = [];
let adminPartnerAccounts = [];
let adminPartnerRecords = [];
let adminBackendCategories = [];

function toggleRestaurantProductFields() {
  const category = getSelectedProductCategorySlug();
  const source = document.getElementById('pPickupSource')?.value;
  const fields = document.getElementById('restaurantProductFields');
  const partnerFields = document.getElementById('partnerProductFields');
  const legacyRestaurant = source === 'restaurant' || (source === 'auto' && category === 'restaurants');
  const postgresMeat = source === 'meat_partner' || (source === 'auto' && category === 'meat');
  const postgresVegetables = source === 'vegetable_partner' || (source === 'auto' && category === 'veggies');
  if (fields) fields.classList.toggle('hidden', !legacyRestaurant);
  if (partnerFields) partnerFields.classList.toggle('hidden', !(postgresMeat || postgresVegetables || ['store_partner', 'restaurant_partner'].includes(source)));
  refreshAdminPartnerProductOptions();
}

function refreshAdminPartnerProductOptions() {
  const select = document.getElementById('pPartner');
  if (!select) return;
  const source = document.getElementById('pPickupSource')?.value;
  const category = getSelectedProductCategorySlug();
  const type = source === 'meat_partner' || (source === 'auto' && category === 'meat')
    ? 'meat' : source === 'restaurant_partner' ? 'restaurant' : 'store';
  const selectedId = select.value;
  const accounts = adminPartnerAccounts.filter(account => account.type === type && account.enabled);
  select.innerHTML = accounts.length
    ? accounts.map(account => `<option value="${escapeAdminHtml(account.id)}">${escapeAdminHtml(account.name || 'Unnamed shop')}</option>`).join('')
    : '<option value="">Create an active partner shop first</option>';
  if (accounts.some(account => account.id === selectedId)) select.value = selectedId;
}

function getSelectedProductCategorySlug() {
  const value = document.getElementById('pCategory')?.value || '';
  return adminBackendCategories.find(category => category.id === value || category.slug === value)?.slug || value;
}

function loadAdminRestaurants() {
  const select = document.getElementById('pRestaurant');
  const list = document.getElementById('adminRestaurantsList');
  if (!select && !list) return;

  db.collection('restaurants').onSnapshot(snapshot => {
    adminRestaurants = [];
    snapshot.forEach(doc => adminRestaurants.push({ id: doc.id, ...doc.data() }));

    if (select) {
      select.innerHTML = adminRestaurants.length
        ? '<option value="">Select restaurant...</option>'
        : '<option value="">Add a restaurant first</option>';
      adminRestaurants.forEach(restaurant => {
        select.innerHTML += `<option value="${restaurant.id}">${restaurant.name}</option>`;
      });
    }
    if (list) {
      list.innerHTML = adminRestaurants.length ? adminRestaurants.map(restaurant => `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
          <strong class="text-slate-900">${restaurant.name}</strong>
          <span class="block text-slate-500 mt-1">${restaurant.cuisine || 'Restaurant'} · ${restaurant.distance_km} km</span>
          <span class="block text-slate-400 mt-1">${restaurant.address || 'Mandapeta'}</span>
        </div>
      `).join('') : '<p class="text-xs text-slate-400">No restaurants added yet.</p>';
    }
  }, error => console.error('Restaurant listener error:', error));
}

async function createAdminPartnerAccount(event) {
  event.preventDefault();
  try {
    const result = await adminPartnerApiRequest('', {
      method: 'POST',
      body: JSON.stringify({
        legal_name: document.getElementById('partnerLegalName').value.trim(),
        display_name: document.getElementById('partnerDisplayName').value.trim(),
        business_type: document.getElementById('partnerBusinessType').value,
        tax_identifier: document.getElementById('partnerTaxIdentifier').value.trim() || null
      })
    });
    event.target.reset();
    await loadAdminPartnerAccounts();
    alert(`Partner created with status ${result.status}. Add its shop and member from the partner list.`);
  } catch (error) {
    alert(`Unable to create partner: ${error.message}`);
  }
}

function getAdminPartnerConsoleUrl(partnerId) {
  const url = new URL('../partner/partner.html', window.location.href);
  url.searchParams.set('partnerId', partnerId);
  return url.href;
}

async function copyAdminPartnerConsoleLink(partnerId) {
  const url = getAdminPartnerConsoleUrl(decodeURIComponent(partnerId));
  try {
    await navigator.clipboard.writeText(url);
    alert('Partner console link copied.');
  } catch (error) {
    window.prompt('Copy this partner console link:', url);
  }
}

function renderAdminPartnerCard(partner) {
  const shops = Array.isArray(partner.shops) ? partner.shops : [];
  const members = Array.isArray(partner.members) ? partner.members : [];
  const id = escapeAdminHtml(partner.id);
  const typeOptions = ['RESTAURANT', 'GROCERY', 'MEAT', 'OTHER'].map(type =>
    `<option value="${type}" ${partner.business_type === type ? 'selected' : ''}>${type}</option>`
  ).join('');
  return `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
    <form onsubmit="saveAdminPartner(event,'${id}')" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <input name="legal_name" aria-label="Legal name" value="${escapeAdminHtml(partner.legal_name)}" required maxlength="200" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs">
      <input name="display_name" aria-label="Display name" value="${escapeAdminHtml(partner.display_name)}" required maxlength="200" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs">
      <select name="business_type" aria-label="Business type" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs">${typeOptions}</select>
      <input name="tax_identifier" aria-label="Tax identifier" value="${escapeAdminHtml(partner.tax_identifier || '')}" maxlength="100" class="px-2.5 py-2 border border-slate-200 rounded-lg text-xs" placeholder="Tax identifier">
      <div class="flex flex-wrap items-center gap-2 sm:col-span-2"><strong class="text-sm text-slate-900">${escapeAdminHtml(partner.display_name)}</strong><span class="rounded-full px-2 py-1 text-[10px] font-black ${partner.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${escapeAdminHtml(partner.status)}</span><span class="text-[10px] text-slate-500">${shops.length} shops · ${partner.product_count} products · ${partner.active_product_count} active · ${partner.member_count} members</span></div>
      <button type="submit" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-black">Save partner</button>
      <button type="button" onclick="setAdminPartnerStatus('${id}','${partner.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}')" class="px-3 py-2 rounded-lg bg-amber-50 text-amber-900 text-[10px] font-black">${partner.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button>
    </form>
    <div class="flex items-center justify-between border-t border-slate-200 pt-2"><strong class="text-xs text-slate-800">Shops</strong><button type="button" onclick="toggleAdminPartnerShopForm('${id}')" class="px-2.5 py-1.5 rounded-lg bg-cyan-50 text-cyan-900 text-[10px] font-black">Add shop</button></div>
    <form id="adminPartnerShopForm_${id}" onsubmit="createAdminPartnerShop(event,'${id}')" class="hidden grid grid-cols-2 gap-2 rounded-xl bg-white p-3">
      <input name="name" required maxlength="200" placeholder="Shop name" class="col-span-2 px-2.5 py-2 border rounded-lg text-xs"><input name="address_line1" required maxlength="500" placeholder="Address" class="col-span-2 px-2.5 py-2 border rounded-lg text-xs"><input name="city" required placeholder="City" class="px-2.5 py-2 border rounded-lg text-xs"><input name="state" required placeholder="State" class="px-2.5 py-2 border rounded-lg text-xs"><input name="postal_code" required maxlength="16" placeholder="Postal code" class="px-2.5 py-2 border rounded-lg text-xs"><input name="phone_e164" placeholder="+91 phone" class="px-2.5 py-2 border rounded-lg text-xs"><button class="col-span-2 px-3 py-2 rounded-lg bg-[#0B132B] text-white text-[10px] font-black">Create shop</button>
    </form>
    <div class="space-y-2">${shops.map(shop => renderAdminPartnerShop(partner, shop)).join('') || '<p class="text-[11px] text-slate-500">No shops yet.</p>'}</div>
    <div class="border-t border-slate-200 pt-2"><strong class="text-xs text-slate-800">Members</strong><form onsubmit="addAdminPartnerMember(event,'${id}')" class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2"><input name="user_id" required placeholder="Existing user UUID" class="px-2.5 py-2 border border-slate-200 rounded-lg text-[10px]"><select name="member_role" class="px-2.5 py-2 border border-slate-200 rounded-lg text-[10px]"><option>STAFF</option><option>MANAGER</option><option>OWNER</option></select><button class="px-3 py-2 rounded-lg bg-slate-800 text-white text-[10px] font-black">Add member</button></form><div class="mt-2 space-y-1">${members.map(member => `<form onsubmit="updateAdminPartnerMember(event,'${id}','${escapeAdminHtml(member.user_id)}')" class="grid grid-cols-1 sm:grid-cols-4 items-center gap-2 text-[10px]"><span class="truncate">${escapeAdminHtml(member.display_name || member.user_id)}</span><select name="member_role" class="px-2 py-1 border rounded"><option ${member.member_role === 'OWNER' ? 'selected' : ''}>OWNER</option><option ${member.member_role === 'MANAGER' ? 'selected' : ''}>MANAGER</option><option ${member.member_role === 'STAFF' ? 'selected' : ''}>STAFF</option></select><select name="status" class="px-2 py-1 border rounded"><option ${member.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option ${member.status === 'SUSPENDED' ? 'selected' : ''}>SUSPENDED</option><option ${member.status === 'REMOVED' ? 'selected' : ''}>REMOVED</option></select><button class="px-2 py-1 rounded bg-slate-100 font-bold">Save</button></form>`).join('')}</div></div>
  </article>`;
}

function renderAdminPartnerShop(partner, shop) {
  const partnerId = escapeAdminHtml(partner.id);
  const shopId = escapeAdminHtml(shop.id);
  return `<details class="rounded-xl border border-slate-200 bg-white p-3"><summary class="flex cursor-pointer list-none items-center justify-between gap-2"><span class="text-xs font-bold text-slate-800">${escapeAdminHtml(shop.name)}</span><span class="text-[10px] text-slate-500">${escapeAdminHtml(shop.status)} · ${shop.active_product_count}/${shop.product_count} active · ${Number(shop.stock_quantity || 0)} stock</span></summary>
    <form onsubmit="saveAdminPartnerShop(event,'${partnerId}','${shopId}')" class="mt-3 grid grid-cols-2 gap-2">
      <input name="name" required value="${escapeAdminHtml(shop.name)}" placeholder="Shop name" class="col-span-2 px-2 py-1.5 border rounded text-[10px]"><textarea name="description" placeholder="Description" class="col-span-2 px-2 py-1.5 border rounded text-[10px]">${escapeAdminHtml(shop.description || '')}</textarea><input name="phone_e164" value="${escapeAdminHtml(shop.phone_e164 || '')}" placeholder="Phone" class="px-2 py-1.5 border rounded text-[10px]"><input name="email" type="email" value="${escapeAdminHtml(shop.email || '')}" placeholder="Email" class="px-2 py-1.5 border rounded text-[10px]"><input name="address_line1" required value="${escapeAdminHtml(shop.address_line1)}" placeholder="Address" class="col-span-2 px-2 py-1.5 border rounded text-[10px]"><input name="address_line2" value="${escapeAdminHtml(shop.address_line2 || '')}" placeholder="Address line 2" class="px-2 py-1.5 border rounded text-[10px]"><input name="locality" value="${escapeAdminHtml(shop.locality || '')}" placeholder="Locality" class="px-2 py-1.5 border rounded text-[10px]"><input name="city" required value="${escapeAdminHtml(shop.city)}" placeholder="City" class="px-2 py-1.5 border rounded text-[10px]"><input name="state" required value="${escapeAdminHtml(shop.state)}" placeholder="State" class="px-2 py-1.5 border rounded text-[10px]"><input name="postal_code" required value="${escapeAdminHtml(shop.postal_code)}" placeholder="Postal code" class="px-2 py-1.5 border rounded text-[10px]"><button class="px-2 py-1.5 rounded bg-slate-900 text-white text-[10px] font-bold">Save shop</button><button type="button" onclick="setAdminShopStatus('${partnerId}','${shopId}','${shop.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}')" class="px-2 py-1.5 rounded bg-amber-50 text-amber-900 text-[10px] font-bold">${shop.status === 'ACTIVE' ? 'Pause shop' : 'Activate shop'}</button>
    </form><div class="mt-2 flex gap-2"><button type="button" onclick="loadAdminShopCatalog('${partnerId}','${shopId}')" class="px-2 py-1 rounded bg-cyan-50 text-cyan-900 text-[10px] font-bold">View products and inventory</button></div><div id="adminShopCatalog_${shopId}" class="mt-2"></div></details>`;
}

async function loadAdminPartnerAccounts() {
  const container = document.getElementById('adminPartnerAccountsList');
  if (!container) return;
  container.textContent = 'Loading partners...';
  try {
    const [partners, categoryResponse] = await Promise.all([
      adminPartnerApiRequest(''),
      fetch(`${ADMIN_CATEGORY_API_BASE_URL}/api/categories`, { headers: { Accept: 'application/json' } })
        .then(async response => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.message || 'Unable to load product categories.');
          return payload?.data || [];
        })
    ]);
    adminBackendCategories = Array.isArray(categoryResponse) ? categoryResponse : [];
    const details = await Promise.all((Array.isArray(partners) ? partners : []).map(partner =>
      adminPartnerApiRequest(`/${encodeURIComponent(partner.id)}`)
    ));
    const partnerDetails = details.sort((left, right) => String(left.display_name).localeCompare(String(right.display_name)));
    adminPartnerRecords = partnerDetails;
    adminPartnerAccounts = partnerDetails.flatMap(partner => partner.shops.map(shop => ({
      id: shop.id,
      partner_id: partner.id,
      name: `${partner.display_name} · ${shop.name}`,
      type: partner.business_type === 'MEAT' ? 'meat' : partner.business_type === 'RESTAURANT' ? 'restaurant' : 'store',
      enabled: partner.status === 'ACTIVE' && shop.status !== 'CLOSED'
    })));
    refreshAdminPartnerProductOptions();
    populateAdminCatalogFilters();
    container.innerHTML = partnerDetails.length
      ? partnerDetails.map(renderAdminPartnerCard).join('')
      : '<p class="text-xs text-slate-500">No partners configured yet.</p>';
    if (!document.getElementById('inventoryViewSection')?.classList.contains('hidden')) loadAdminPostgresCatalog();
  } catch (error) {
    console.error('PostgreSQL partner list failed:', error);
    container.innerHTML = `<p class="text-xs font-bold text-rose-600">Unable to load partners: ${escapeAdminHtml(error.message)}</p>`;
  }
}

async function saveAdminPartner(event, partnerId) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ legal_name: data.get('legal_name'), display_name: data.get('display_name'), business_type: data.get('business_type'), tax_identifier: data.get('tax_identifier') || null })
    });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to save partner: ${error.message}`); }
}

async function setAdminPartnerStatus(partnerId, status) {
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to update partner status: ${error.message}`); }
}

function toggleAdminPartnerShopForm(partnerId) {
  document.getElementById(`adminPartnerShopForm_${partnerId}`)?.classList.toggle('hidden');
}

async function createAdminPartnerShop(event, partnerId) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/shops`, { method: 'POST', body: JSON.stringify(data) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to create shop: ${error.message}`); }
}

async function saveAdminPartnerShop(event, partnerId, shopId) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/shops/${encodeURIComponent(shopId)}`, { method: 'PATCH', body: JSON.stringify(data) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to save shop: ${error.message}`); }
}

async function setAdminShopStatus(partnerId, shopId, status) {
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/shops/${encodeURIComponent(shopId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to update shop status: ${error.message}`); }
}

async function addAdminPartnerMember(event, partnerId) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/members`, { method: 'POST', body: JSON.stringify(data) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to add partner member: ${error.message}`); }
}

async function updateAdminPartnerMember(event, partnerId, userId) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(data) });
    await loadAdminPartnerAccounts();
  } catch (error) { alert(`Unable to update partner member: ${error.message}`); }
}

async function loadAdminShopCatalog(partnerId, shopId) {
  const container = document.getElementById(`adminShopCatalog_${shopId}`);
  if (!container) return;
  container.textContent = 'Loading products and inventory...';
  try {
    const [products, inventory] = await Promise.all([
      adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/shops/${encodeURIComponent(shopId)}/products`),
      adminPartnerApiRequest(`/${encodeURIComponent(partnerId)}/shops/${encodeURIComponent(shopId)}/inventory`)
    ]);
    container.innerHTML = products.length ? `<div class="space-y-2">${products.map(product => `<div class="rounded-lg border border-slate-100 p-2"><strong class="text-[11px]">${escapeAdminHtml(product.name)}</strong><span class="ml-2 text-[10px] text-slate-500">${escapeAdminHtml(product.status)}</span><div class="mt-1 flex flex-wrap gap-2 text-[10px]">${product.variants.map(variant => `<span>${escapeAdminHtml(variant.name)} · ₹${Number(variant.price).toFixed(2)} · stock ${Number(variant.quantity_on_hand)}</span>`).join('')}</div></div>`).join('')}<p class="text-[10px] text-slate-500">${inventory.length} inventory variants</p></div>` : '<p class="text-[10px] text-slate-500">No products.</p>';
  } catch (error) { container.textContent = `Unable to load shop catalog: ${error.message}`; }
}

function populateAdminCatalogFilters() {
  const partnerSelect = document.getElementById('adminPgPartnerFilter');
  const shopSelect = document.getElementById('adminPgShopFilter');
  const categorySelect = document.getElementById('adminPgCategoryFilter');
  if (!partnerSelect || !shopSelect || !categorySelect) return;
  const previousPartner = partnerSelect.value;
  const previousCategory = categorySelect.value;
  partnerSelect.innerHTML = '<option value="">All partners</option>' + adminPartnerRecords.map(partner =>
    `<option value="${escapeAdminHtml(partner.id)}">${escapeAdminHtml(partner.display_name)}</option>`
  ).join('');
  if (adminPartnerRecords.some(partner => partner.id === previousPartner)) partnerSelect.value = previousPartner;
  categorySelect.innerHTML = '<option value="">All categories</option>' + adminBackendCategories
    .filter(category => category.is_active !== false)
    .map(category => `<option value="${escapeAdminHtml(category.id)}">${escapeAdminHtml(category.name)}</option>`).join('');
  if (adminBackendCategories.some(category => category.id === previousCategory && category.is_active !== false)) categorySelect.value = previousCategory;
  populateAdminCatalogShopFilter();
}

function populateAdminCatalogShopFilter() {
  const partnerId = document.getElementById('adminPgPartnerFilter')?.value || '';
  const select = document.getElementById('adminPgShopFilter');
  if (!select) return;
  const current = select.value;
  const shops = adminPartnerRecords
    .filter(partner => !partnerId || partner.id === partnerId)
    .flatMap(partner => (partner.shops || []).map(shop => ({ ...shop, partner_name: partner.display_name })))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  select.innerHTML = '<option value="">All shops</option>' + shops.map(shop =>
    `<option value="${escapeAdminHtml(shop.id)}">${escapeAdminHtml(shop.partner_name)} · ${escapeAdminHtml(shop.name)}</option>`
  ).join('');
  if (shops.some(shop => shop.id === current)) select.value = current;
}

async function loadAdminPostgresCatalog() {
  const container = document.getElementById('adminPostgresCatalogList');
  if (!container) return;
  const query = new URLSearchParams();
  const partnerId = document.getElementById('adminPgPartnerFilter')?.value;
  const shopId = document.getElementById('adminPgShopFilter')?.value;
  const categoryId = document.getElementById('adminPgCategoryFilter')?.value;
  const status = document.getElementById('adminPgStatusFilter')?.value;
  if (partnerId) query.set('partner_id', partnerId);
  if (shopId) query.set('shop_id', shopId);
  if (categoryId) query.set('category_id', categoryId);
  if (status && status !== 'ALL') query.set('status', status);
  container.textContent = 'Loading PostgreSQL partner catalog...';
  try {
    const products = await adminPartnerApiRequest(`/products${query.size ? `?${query.toString()}` : ''}`);
    container.innerHTML = products.length
      ? products.map(renderAdminPostgresProduct).join('')
      : '<p class="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">No PostgreSQL partner products match these filters.</p>';
  } catch (error) {
    container.textContent = `Unable to load PostgreSQL partner catalog: ${error.message}`;
  }
}

function renderAdminPostgresProduct(product) {
  const productId = escapeAdminHtml(product.id);
  const categoryOptions = ['<option value="">No category</option>', ...adminBackendCategories
    .filter(category => category.is_active !== false)
    .map(category => `<option value="${escapeAdminHtml(category.id)}" ${category.id === product.category_id ? 'selected' : ''}>${escapeAdminHtml(category.name)}</option>`)].join('');
  const statusOptions = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].map(status =>
    `<option ${product.status === status ? 'selected' : ''}>${status}</option>`
  ).join('');
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><h4 class="text-sm font-black text-slate-900">${escapeAdminHtml(product.name)}</h4><p class="text-[10px] text-slate-500">${escapeAdminHtml(product.partner_name)} · ${escapeAdminHtml(product.shop_name)} · ${escapeAdminHtml(product.status)}</p></div><span class="text-[10px] text-slate-500">${variants.length} variants</span></div>
    <form onsubmit="saveAdminPostgresProduct(event,'${productId}')" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <input name="name" required maxlength="300" value="${escapeAdminHtml(product.name)}" aria-label="Product name" class="px-2 py-1.5 border border-slate-200 rounded-lg text-[10px]"><input name="brand" maxlength="200" value="${escapeAdminHtml(product.brand || '')}" aria-label="Brand" placeholder="Brand" class="px-2 py-1.5 border border-slate-200 rounded-lg text-[10px]"><select name="category_id" aria-label="Category" class="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-[10px]">${categoryOptions}</select><select name="status" aria-label="Product status" class="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-[10px]">${statusOptions}</select>
      <textarea name="description" maxlength="5000" aria-label="Description" class="sm:col-span-2 lg:col-span-3 px-2 py-1.5 border border-slate-200 rounded-lg text-[10px]">${escapeAdminHtml(product.description || '')}</textarea><div class="flex gap-1"><input name="image_url" maxlength="80000" placeholder="Optional image URL" aria-label="New image URL" class="min-w-0 flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-[10px]"><button class="rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-white">Save product</button></div>
    </form>
    <div class="space-y-2">${variants.map(variant => renderAdminPostgresVariant(variant)).join('')}</div>
    <details class="rounded-xl border border-slate-200 bg-white p-3"><summary class="cursor-pointer text-[10px] font-black text-slate-700">Add variant</summary><form onsubmit="createAdminPostgresVariant(event,'${productId}')" class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2"><input name="name" required maxlength="200" placeholder="Variant name" class="px-2 py-1.5 border rounded text-[10px]"><input name="sku" maxlength="200" placeholder="SKU" class="px-2 py-1.5 border rounded text-[10px]"><input name="unit_label" required maxlength="100" placeholder="Unit" class="px-2 py-1.5 border rounded text-[10px]"><input name="unit_quantity" type="number" min="0.001" step="0.001" value="1" required placeholder="Unit quantity" class="px-2 py-1.5 border rounded text-[10px]"><input name="price" type="number" min="0" step="0.01" required placeholder="Price" class="px-2 py-1.5 border rounded text-[10px]"><input name="compare_at_price" type="number" min="0" step="0.01" placeholder="Compare price" class="px-2 py-1.5 border rounded text-[10px]"><label class="flex items-center gap-1 text-[10px]"><input name="is_active" type="checkbox" checked>Available</label><button class="rounded-lg bg-cyan-800 px-2 py-1 text-[10px] font-bold text-white">Create variant</button></form></details>
  </article>`;
}

function renderAdminPostgresVariant(variant) {
  const variantId = escapeAdminHtml(variant.id);
  return `<div class="rounded-xl border border-slate-200 bg-white p-3 space-y-2"><form onsubmit="saveAdminPostgresVariant(event,'${variantId}')" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-center"><input name="name" required maxlength="200" value="${escapeAdminHtml(variant.name)}" aria-label="Variant name" class="px-2 py-1.5 border rounded text-[10px]"><input name="sku" maxlength="200" value="${escapeAdminHtml(variant.sku || '')}" aria-label="SKU" placeholder="SKU" class="px-2 py-1.5 border rounded text-[10px]"><input name="unit_label" required maxlength="100" value="${escapeAdminHtml(variant.unit_label)}" aria-label="Unit label" class="px-2 py-1.5 border rounded text-[10px]"><input name="unit_quantity" type="number" min="0.001" step="0.001" value="${Number(variant.unit_quantity)}" aria-label="Unit quantity" class="px-2 py-1.5 border rounded text-[10px]"><input name="price" type="number" min="0" step="0.01" value="${Number(variant.price)}" aria-label="Price" class="px-2 py-1.5 border rounded text-[10px]"><input name="compare_at_price" type="number" min="0" step="0.01" value="${variant.compare_at_price == null ? '' : Number(variant.compare_at_price)}" aria-label="Compare-at price" placeholder="Compare" class="px-2 py-1.5 border rounded text-[10px]"><label class="flex items-center gap-1 text-[10px]"><input name="is_active" type="checkbox" ${variant.is_active ? 'checked' : ''}>Active</label><button class="sm:col-span-4 lg:col-span-7 justify-self-end rounded-lg bg-slate-800 px-3 py-1.5 text-[10px] font-bold text-white">Save variant</button></form><form onsubmit="saveAdminPostgresInventory(event,'${variantId}')" class="flex flex-wrap items-center gap-2 text-[10px]"><span class="text-slate-500">Reserved: ${Number(variant.quantity_reserved || 0)}</span><label>On hand <input name="quantity_on_hand" type="number" min="0" step="0.001" required value="${Number(variant.quantity_on_hand || 0)}" class="ml-1 w-24 px-2 py-1 border rounded"></label><label>Low stock <input name="low_stock_threshold" type="number" min="0" step="0.001" required value="${Number(variant.low_stock_threshold || 0)}" class="ml-1 w-24 px-2 py-1 border rounded"></label><button class="rounded-lg bg-emerald-700 px-3 py-1.5 font-bold text-white">Save stock</button></form></div>`;
}

async function saveAdminPostgresProduct(event, productId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    name: form.get('name'), brand: form.get('brand') || null,
    category_id: form.get('category_id') || null,
    description: form.get('description') || null, status: form.get('status')
  };
  const imageUrl = String(form.get('image_url') || '').trim();
  if (imageUrl) body.image_url = imageUrl;
  try {
    await adminPartnerApiRequest(`/products/${encodeURIComponent(productId)}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadAdminPostgresCatalog();
  } catch (error) { alert(`Unable to save PostgreSQL product: ${error.message}`); }
}

async function saveAdminPostgresVariant(event, variantId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await adminPartnerApiRequest(`/variants/${encodeURIComponent(variantId)}`, {
      method: 'PATCH', body: JSON.stringify({
        name: form.get('name'), sku: form.get('sku') || null, unit_label: form.get('unit_label'),
        unit_quantity: Number(form.get('unit_quantity')), price: Number(form.get('price')),
        compare_at_price: form.get('compare_at_price') === '' ? null : Number(form.get('compare_at_price')),
        is_active: form.get('is_active') === 'on'
      })
    });
    await loadAdminPostgresCatalog();
  } catch (error) { alert(`Unable to save variant: ${error.message}`); }
}

async function createAdminPostgresVariant(event, productId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await adminPartnerApiRequest(`/products/${encodeURIComponent(productId)}/variants`, {
      method: 'POST', body: JSON.stringify({
        name: form.get('name'), sku: form.get('sku') || null, unit_label: form.get('unit_label'),
        unit_quantity: Number(form.get('unit_quantity')), price: Number(form.get('price')),
        compare_at_price: form.get('compare_at_price') === '' ? null : Number(form.get('compare_at_price')),
        is_active: form.get('is_active') === 'on'
      })
    });
    await loadAdminPostgresCatalog();
  } catch (error) { alert(`Unable to create variant: ${error.message}`); }
}

async function saveAdminPostgresInventory(event, variantId) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await adminPartnerApiRequest(`/variants/${encodeURIComponent(variantId)}/inventory`, {
      method: 'PATCH', body: JSON.stringify({
        quantity_on_hand: Number(form.get('quantity_on_hand')),
        low_stock_threshold: Number(form.get('low_stock_threshold'))
      })
    });
    await loadAdminPostgresCatalog();
  } catch (error) { alert(`Unable to update inventory: ${error.message}`); }
}

async function handleAddRestaurant(event) {
  event.preventDefault();
  const name = document.getElementById('restaurantName').value.trim();
  const distance = Number(document.getElementById('restaurantDistance').value);
  if (!name || !Number.isFinite(distance) || distance > 25) return alert('Enter a restaurant name and distance up to 25 KM.');

  const button = document.getElementById('saveRestaurantBtn');
  if (button) button.disabled = true;
  try {
    await db.collection('restaurants').add({
      name,
      cuisine: document.getElementById('restaurantCuisine').value.trim(),
      distance_km: distance,
      image_url: document.getElementById('restaurantImage').value.trim(),
      address: document.getElementById('restaurantAddress').value.trim(),
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    event.target.reset();
    alert('Restaurant added. You can now add its food from Restaurant Menus.');
  } catch (error) {
    alert('Restaurant save failed: ' + error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleDirectFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    selectedProductBase64 = await compressImageFile(file);
    const previewBox = document.getElementById('addPreviewBox');
    const previewImg = document.getElementById('addPreviewImg');
    const badge = document.getElementById('fileUploadStatusBadge');

    if (previewImg) previewImg.src = selectedProductBase64;
    if (previewBox) { previewBox.classList.remove('hidden'); previewBox.classList.add('flex'); }
    if (badge) badge.classList.remove('hidden');
  } catch(err) {
    alert("Image load failed: " + err.message);
  }
}

// --- ADD PRODUCT WITH QUANTITY + UNIT SYSTEM ---
async function handleAddNewProduct(e) {
  e.preventDefault();

  const hostedImageUrl = document.getElementById('pImageUrlInput')?.value.trim() || '';
  if (!selectedProductBase64 && !hostedImageUrl) {
    alert("Choose a product photo or enter a hosted image URL.");
    return;
  }

  const name = document.getElementById('pName').value.trim();
  const categoryValue = document.getElementById('pCategory').value;
  const categoryRecord = adminBackendCategories.find(item => item.id === categoryValue || item.slug === categoryValue);
  const category = categoryRecord?.slug || categoryValue;
  const price = Number(document.getElementById('pPrice').value);
  const old_price = Number(document.getElementById('pOldPrice')?.value) || price;
  
  const qtyValue = Number(document.getElementById('pQtyValue')?.value) || 1;
  const qtyUnit = document.getElementById('pQtyUnit')?.value || 'pcs';
  const selectedSource = document.getElementById('pPickupSource')?.value || 'auto';
  const categorySource = category === 'restaurants'
    ? 'restaurant'
    : category === 'veggies'
      ? 'vegetable_partner'
      : category === 'meat'
        ? 'meat_partner'
        : 'store';
  const pickupSource = selectedSource === 'auto' ? categorySource : selectedSource;
  const restaurantId = document.getElementById('pRestaurant')?.value || '';
  const restaurant = adminRestaurants.find(item => item.id === restaurantId);
  const partnerId = document.getElementById('pPartner')?.value || '';
  const partnerName = document.getElementById('pPartner')?.selectedOptions[0]?.textContent || '';

  if (pickupSource === 'restaurant' && !restaurant) {
    alert('Select a restaurant before adding menu food.');
    return;
  }
  const partnerType = pickupSource === 'meat_partner' ? 'meat'
    : pickupSource === 'restaurant_partner' ? 'restaurant'
      : ['store_partner', 'vegetable_partner'].includes(pickupSource) ? 'store' : '';
  if (partnerType && !adminPartnerAccounts.some(account => account.id === partnerId && account.type === partnerType && account.enabled !== false)) {
    alert('Create or select an active account for this partner type first.');
    return;
  }

  const btn = document.getElementById('saveProdBtn');
  if (btn) { btn.innerText = "Saving to Storefront..."; btn.disabled = true; }

  const isPartnerProduct = ['meat_partner', 'store_partner', 'restaurant_partner', 'vegetable_partner'].includes(pickupSource);
  const resolvedPartnerId = pickupSource === 'restaurant' ? restaurantId : isPartnerProduct ? partnerId : null;
  const resolvedPartnerName = pickupSource === 'restaurant'
    ? restaurant?.name || null
    : isPartnerProduct
      ? partnerName
      : null;

  if (isPartnerProduct) {
    const shop = adminPartnerAccounts.find(account => account.id === partnerId && account.enabled);
    if (!shop) {
      if (btn) btn.disabled = false;
      return alert('Select an active PostgreSQL partner shop first.');
    }
    if (category && !categoryRecord) {
      if (btn) btn.disabled = false;
      return alert('This category is not available in the PostgreSQL catalog.');
    }
    if (selectedProductBase64 && !hostedImageUrl) {
      if (btn) btn.disabled = false;
      return alert('PostgreSQL partner products require a hosted image URL. Local image binaries are not stored in PostgreSQL.');
    }
    try {
      await adminPartnerApiRequest(`/${encodeURIComponent(shop.partner_id)}/shops/${encodeURIComponent(shop.id)}/products`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: document.getElementById('pDesc')?.value.trim() || null,
          category_id: categoryRecord?.id || null,
          image_url: hostedImageUrl || null,
          variant: {
            name,
            price,
            compare_at_price: old_price > price ? old_price : null,
            unit_label: `${qtyValue} ${qtyUnit}`,
            unit_quantity: qtyValue,
            is_active: true
          }
        })
      });
      document.getElementById('addProductForm').reset();
      document.getElementById('addPreviewBox')?.classList.add('hidden');
      document.getElementById('fileUploadStatusBadge')?.classList.add('hidden');
      selectedProductBase64 = '';
      if (btn) { btn.innerText = '+ Add Product to Storefront'; btn.disabled = false; }
      alert('Partner product added to PostgreSQL.');
      await loadAdminPartnerAccounts();
    } catch (error) {
      alert(`Unable to create partner product: ${error.message}`);
      if (btn) btn.disabled = false;
    }
    return;
  }

  const newProd = {
    name: name,
    category: category,
    qty_value: qtyValue,
    qty_unit: qtyUnit,
    pickup_source: pickupSource,
    pickup_source_name: resolvedPartnerName || (pickupSource === 'vegetable_partner' ? 'Local Vegetable Partner' : pickupSource === 'meat_partner' ? 'Fresh Meat Partner' : 'MyShopzy Store'),
    pickup_source_address: restaurant?.address || (isPartnerProduct ? `${resolvedPartnerName} pickup desk` : pickupSource === 'vegetable_partner' ? 'Assigned vegetable market partner' : 'Mandapeta Dark Store'),
    partner_id: resolvedPartnerId,
    partner_name: resolvedPartnerName,
    restaurant_id: restaurantId || null,
    restaurant_name: restaurant?.name || null,
    restaurant_address: restaurant?.address || null,
    price: price,
    old_price: old_price,
    image_url: selectedProductBase64 || hostedImageUrl,
    desc: document.getElementById('pDesc')?.value.trim() || '100% Genuine product directly fulfilled from Mandapeta dark store.',
    created_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("products").add(newProd);
    document.getElementById('addProductForm').reset();
    const previewBox = document.getElementById('addPreviewBox');
    if (previewBox) previewBox.classList.add('hidden');
    const badge = document.getElementById('fileUploadStatusBadge');
    if (badge) badge.classList.add('hidden');
    selectedProductBase64 = "";

    if (btn) { btn.innerText = "+ Add Product to Storefront"; btn.disabled = false; }
    alert("Product added successfully with Quantity + Unit system!");
    loadAdminInventory();
  } catch(err) {
    alert("Upload failed: " + err.message);
    if (btn) btn.disabled = false;
  }
}

function loadAdminInventory() {
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;

  db.collection("products").onSnapshot((snapshot) => {
    let prods = [];
    snapshot.forEach(doc => prods.push({ id: doc.id, ...doc.data() }));

    tbody.innerHTML = '';
    if (prods.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">No products in database yet. Add your products above!</td></tr>`;
      return;
    }

    prods.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-slate-50";

      const displayQtyUnit = p.qty_unit ? `${p.qty_value || 1} ${p.qty_unit}` : (p.unit || "1 pc");

      tr.innerHTML = `
        <td class="py-2.5 px-3 flex items-center gap-2">
          <img src="${p.image_url}" class="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white">
          <span class="font-bold text-slate-800">${p.name}</span>
        </td>
        <td class="py-2.5 px-3 uppercase text-[10px] font-bold text-slate-500">${p.category}</td>
        <td class="py-2.5 px-3 font-semibold text-slate-700 text-xs">${displayQtyUnit}</td>
        <td class="py-2.5 px-3 font-black text-[#0B132B]">₹${p.price}</td>
        <td class="py-2.5 px-3 text-right space-x-1">
          <button onclick="openEditProductImageModal('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${p.image_url}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold rounded-lg text-xs transition">
            Photo
          </button>
          <button onclick="deleteProductItem('${p.id}')" class="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-lg text-xs transition">
            Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

async function deleteProductItem(id) {
  if (!confirm("Are you sure you want to delete this product?")) return;
  try {
    await db.collection("products").doc(id).delete();
  } catch(e) {
    alert(e.message);
  }
}

// PRODUCT PHOTO REPLACEMENT
let editingProductId = null;
let editModalNewBase64 = "";

function openEditProductImageModal(prodId, currentName, currentImg) {
  editingProductId = prodId;
  editModalNewBase64 = currentImg;
  const nameEl = document.getElementById('editProdName');
  const prevEl = document.getElementById('editProdPreview');
  const fileEl = document.getElementById('editModalFileInput');
  const modEl = document.getElementById('editProductModal');

  if (nameEl) nameEl.innerText = currentName;
  if (prevEl) prevEl.src = currentImg;
  if (fileEl) fileEl.value = '';
  if (modEl) modEl.classList.remove('hidden');
}

function closeEditProductModal() {
  const modEl = document.getElementById('editProductModal');
  if (modEl) modEl.classList.add('hidden');
  editingProductId = null;
  editModalNewBase64 = "";
}

async function handleEditModalFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    editModalNewBase64 = await compressImageFile(file);
    const prevEl = document.getElementById('editProdPreview');
    if (prevEl) prevEl.src = editModalNewBase64;
  } catch(err) {
    alert("Image load failed: " + err.message);
  }
}

async function submitProductImageUpdate() {
  if (!editModalNewBase64 || !editingProductId) return alert("Please select a new photo!");

  const btn = document.getElementById('btnSaveProdImg');
  if (btn) btn.innerText = "Updating...";

  try {
    await db.collection("products").doc(editingProductId).update({
      image_url: editModalNewBase64,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    alert("Product photo updated successfully!");
    closeEditProductModal();
  } catch(err) {
    alert("Update failed: " + err.message);
  } finally {
    if (btn) btn.innerText = "Save & Replace Image";
  }
}

let adminHomepageBanners = [];

// HERO BANNER MANAGER
async function handleBannerDirectFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const compressedBanner = await compressImageFile(file, 800, 500, 0.85);
    const inputEl = document.getElementById('bannerImgInput');
    if (inputEl) inputEl.value = compressedBanner;
  } catch(err) {
    alert("Banner image load failed: " + err.message);
  }
}

async function handleSaveHeroBanner(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveBanner');
  if (btn) { btn.disabled = true; btn.innerText = "Saving..."; }

  const bannerData = {
    title: document.getElementById('bannerTitleInput').value.trim(),
    subtitle: document.getElementById('bannerSubInput').value.trim(),
    image_url: document.getElementById('bannerImgInput').value.trim(),
    status: document.getElementById('bannerStatusInput').value,
    sort_order: Number(document.getElementById('bannerOrderInput').value),
    starts_at: adminDateTimeValue('bannerStartsAtInput'),
    ends_at: adminDateTimeValue('bannerEndsAtInput')
  };

  try {
    const bannerId = document.getElementById('bannerDocumentId').value;
    await adminContentApiRequest(bannerId ? `/api/admin/banners/${encodeURIComponent(bannerId)}` : '/api/admin/banners', {
      method: bannerId ? 'PATCH' : 'POST',
      body: JSON.stringify(bannerData)
    });
    resetHomepageBannerForm();
    await loadAdminBanners();
    alert('Homepage banner saved.');
  } catch (error) {
    alert(`Unable to save banner: ${error.message}`);
  } finally {
    if (btn) btn.disabled = false;
    updateHomepageBannerSubmitLabel();
  }
}

async function loadActiveHeroBanner() {
  return loadAdminBanners();
}

async function handleResetDefaultBanner() {
  alert("The default storefront hero is separate from managed PostgreSQL banners.");
}

function updateHomepageBannerSubmitLabel() {
  const button = document.getElementById('btnSaveBanner');
  if (button) button.innerText = document.getElementById('bannerDocumentId')?.value ? 'Update banner' : 'Add banner';
}

function resetHomepageBannerForm() {
  document.getElementById('homepageBannerForm')?.reset();
  document.getElementById('bannerDocumentId').value = '';
  updateHomepageBannerSubmitLabel();
}

async function loadAdminBanners() {
  const container = document.getElementById('homepageBannersList');
  try {
    const payload = await adminContentApiRequest('/api/admin/banners');
    adminHomepageBanners = Array.isArray(payload?.data) ? payload.data : [];
    renderAdminBanners();
  } catch (error) {
    console.error('Homepage banner load failed:', error);
    if (container) container.innerHTML = `<p class="text-xs font-bold text-rose-600">Unable to load banners: ${escapeAdminHtml(error.message)}</p>`;
  }
}

function renderAdminBanners() {
  const container = document.getElementById('homepageBannersList');
  if (!container) return;
  container.innerHTML = adminHomepageBanners.length ? adminHomepageBanners.map(banner => `
    <article class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <img src="${escapeAdminHtml(banner.image_url || '')}" alt="${escapeAdminHtml(banner.title || 'Homepage banner')}" class="h-32 w-full bg-slate-100 object-cover" onerror="this.classList.add('hidden')">
      <div class="p-3"><h3 class="text-sm font-black text-slate-900">${escapeAdminHtml(banner.title || 'Untitled banner')}</h3><p class="mt-1 text-[11px] text-slate-500">${escapeAdminHtml(banner.subtitle || '')}</p>
        <p class="mt-1 text-[10px] font-bold text-slate-500">${escapeAdminHtml(banner.status)} · Order ${Number(banner.sort_order) || 0}${banner.starts_at ? ` · Starts ${escapeAdminHtml(new Date(banner.starts_at).toLocaleString())}` : ''}${banner.ends_at ? ` · Ends ${escapeAdminHtml(new Date(banner.ends_at).toLocaleString())}` : ''}</p>
        <div class="mt-3 flex gap-2"><button type="button" onclick="editHomepageBanner('${encodeURIComponent(banner.id)}')" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black text-slate-700">Edit</button><button type="button" onclick="toggleHomepageBanner('${encodeURIComponent(banner.id)}')" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-700">${banner.status === 'PAUSED' ? 'Activate' : 'Deactivate'}</button></div>
      </div>
    </article>
  `).join('') : '<p class="text-xs text-slate-500">No homepage banners yet.</p>';
}

function editHomepageBanner(encodedId) {
  const banner = adminHomepageBanners.find(item => item.id === decodeURIComponent(encodedId));
  if (!banner) return;
  document.getElementById('bannerDocumentId').value = banner.id;
  document.getElementById('bannerTitleInput').value = banner.title || '';
  document.getElementById('bannerSubInput').value = banner.subtitle || '';
  document.getElementById('bannerImgInput').value = banner.image_url || '';
  document.getElementById('bannerStatusInput').value = banner.status || 'DRAFT';
  document.getElementById('bannerOrderInput').value = Number(banner.sort_order) || 0;
  document.getElementById('bannerStartsAtInput').value = adminDateTimeInput(banner.starts_at);
  document.getElementById('bannerEndsAtInput').value = adminDateTimeInput(banner.ends_at);
  updateHomepageBannerSubmitLabel();
  document.getElementById('homepageBannerForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteHomepageBanner(encodedId) {
  const bannerId = decodeURIComponent(encodedId);
  if (!confirm('Deactivate this homepage banner? The record will be retained.')) return;
  try {
    await adminContentApiRequest(`/api/admin/banners/${encodeURIComponent(bannerId)}`, { method: 'DELETE' });
    await loadAdminBanners();
    if (document.getElementById('bannerDocumentId').value === bannerId) resetHomepageBannerForm();
  } catch (error) {
    alert(`Unable to delete banner: ${error.message}`);
  }
}

async function toggleHomepageBanner(encodedId) {
  const banner = adminHomepageBanners.find(item => item.id === decodeURIComponent(encodedId));
  if (!banner) return;
  const status = banner.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED';
  try {
    await adminContentApiRequest(`/api/admin/banners/${encodeURIComponent(banner.id)}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    });
    await loadAdminBanners();
  } catch (error) {
    alert(`Unable to update banner status: ${error.message}`);
  }
}

async function handleDailyOfferDirectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    document.getElementById('dailyOfferImageInput').value = await compressImageFile(file, 800, 600, 0.85);
    event.target.value = '';
  } catch (error) {
    alert(`Popup image load failed: ${error.message}`);
  }
}

async function loadAdminDailyOffer() {
  try {
    const payload = await adminContentApiRequest('/api/admin/settings/daily-offer');
    const offer = payload?.data || {};
    document.getElementById('dailyOfferEnabledInput').checked = offer.is_active === true;
    document.getElementById('dailyOfferTitleInput').value = offer.title || '';
    document.getElementById('dailyOfferCodeInput').value = offer.code || '';
    document.getElementById('dailyOfferDescriptionInput').value = offer.description || '';
    document.getElementById('dailyOfferBodyInput').value = offer.body || '';
    document.getElementById('dailyOfferImageInput').value = offer.image_url || '';
    document.getElementById('dailyOfferStartsAtInput').value = adminDateTimeInput(offer.starts_at);
    document.getElementById('dailyOfferEndsAtInput').value = adminDateTimeInput(offer.ends_at);
  } catch (error) {
    console.error('Offer popup load failed:', error);
  }
}

async function handleSaveDailyOffer(event) {
  event.preventDefault();
  const offer = {
    is_active: document.getElementById('dailyOfferEnabledInput').checked,
    title: document.getElementById('dailyOfferTitleInput').value.trim(),
    code: document.getElementById('dailyOfferCodeInput').value.trim(),
    description: document.getElementById('dailyOfferDescriptionInput').value.trim(),
    body: document.getElementById('dailyOfferBodyInput').value.trim(),
    image_url: document.getElementById('dailyOfferImageInput').value.trim(),
    starts_at: adminDateTimeValue('dailyOfferStartsAtInput'),
    ends_at: adminDateTimeValue('dailyOfferEndsAtInput')
  };
  try {
    await adminContentApiRequest('/api/admin/settings/daily-offer', { method: 'PUT', body: JSON.stringify(offer) });
    alert(offer.is_active ? 'Offer popup saved.' : 'Offer popup disabled.');
  } catch (error) {
    alert(`Unable to save popup: ${error.message}`);
  }
}

async function handleDeleteDailyOffer() {
  if (!confirm('Disable the daily offer popup? Its configuration will be retained.')) return;
  document.getElementById('dailyOfferEnabledInput').checked = false;
  await handleSaveDailyOffer({ preventDefault() {} });
}

// --- ALL 20 BLINKIT CATEGORIES RESTORED ---
const adminCategoryDefaults = [
  { id: "paan", name: "Paan Corner & Refreshers", img: "https://images.pexels.com/photos/103124/pexels-photo-103124.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "dairy", name: "Dairy, Bread & Eggs", img: "https://images.pexels.com/photos/248412/pexels-photo-248412.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "veggies", name: "Fruits & Fresh Vegetables", img: "https://images.pexels.com/photos/144248/potatoes-vegetables-erdfrucht-bio-144248.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "drinks", name: "Cold Drinks & Juices", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Coca-Cola_can_-_2020.jpg/220px-Coca-Cola_can_-_2020.jpg" },
  { id: "snacks", name: "Snacks & Munchies", img: "https://images.pexels.com/photos/568805/pexels-photo-568805.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "breakfast", name: "Breakfast & Instant Food", img: "https://images.pexels.com/photos/884600/pexels-photo-884600.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "sweets", name: "Sweet Tooth & Chocolates", img: "https://images.pexels.com/photos/65882/chocolate-dark-coffee-confiserie-65882.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "bakery", name: "Bakery & Biscuits", img: "https://images.pexels.com/photos/1395319/pexels-photo-1395319.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "tea", name: "Tea, Coffee & Milk Drinks", img: "https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "staples", name: "Atta, Rice & Dal", img: "https://images.pexels.com/photos/6287295/pexels-photo-6287295.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "masala", name: "Masala, Cooking Oil & Ghee", img: "https://images.pexels.com/photos/33783/olive-oil-salad-dressing-cooking-olive.jpg?auto=compress&cs=tinysrgb&w=150" },
  { id: "sauces", name: "Sauces & Spreads", img: "https://images.pexels.com/photos/1435735/pexels-photo-1435735.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "meat", name: "Chicken, Meat & Fresh Fish", img: "https://images.pexels.com/photos/618775/pexels-photo-618775.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "organic", name: "Organic & Healthy Living", img: "https://images.pexels.com/photos/7421213/pexels-photo-7421213.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "baby", name: "Baby Care Essentials", img: "https://images.pexels.com/photos/3845492/pexels-photo-3845492.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "pharma", name: "Pharma & Wellness", img: "https://images.pexels.com/photos/593451/pexels-photo-593451.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "cleaning", name: "Cleaning Essentials", img: "https://images.pexels.com/photos/5202925/pexels-photo-5202925.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "home", name: "Home & Office Needs", img: "https://images.pexels.com/photos/4198024/pexels-photo-4198024.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "personal", name: "Personal Care & Hygiene", img: "https://images.pexels.com/photos/6621376/pexels-photo-6621376.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "pet", name: "Pet Care Supplies", img: "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "restaurants", name: "Restaurant Menus", img: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80" }
];

let adminCategoryItems = [];
let adminCategoryImages = {};

const ADMIN_CATEGORY_API_BASE_URL = 'http://localhost:5000';

function getAdminAccessToken() {
  return sessionStorage.getItem('admin_access_token')
    || localStorage.getItem('admin_access_token')
    || sessionStorage.getItem('myshopzy_admin_access_token')
    || localStorage.getItem('myshopzy_admin_access_token')
    || '';
}

function buildAdminApiHeaders(additionalHeaders = {}) {
  const headers = { ...additionalHeaders };
  const token = getAdminAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function adminCategoryApiRequest(path, options = {}) {
  const response = await fetch(`${ADMIN_CATEGORY_API_BASE_URL}${path}`, {
    headers: buildAdminApiHeaders({
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }),
    ...options
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function adminContentApiRequest(path, options = {}) {
  const response = await fetch(`${ADMIN_CATEGORY_API_BASE_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: buildAdminApiHeaders({
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Content request failed (${response.status}).`);
  return payload;
}

function adminDateTimeValue(inputId) {
  const value = document.getElementById(inputId)?.value || '';
  return value ? new Date(value).toISOString() : null;
}

function adminDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

async function adminNotificationsApiRequest(path, options = {}) {
  const response = await fetch(`${ADMIN_CATEGORY_API_BASE_URL}/api/admin/notifications${path}`, {
    ...options,
    cache: 'no-store',
    headers: buildAdminApiHeaders({ Accept: 'application/json', ...(options.headers || {}) })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Notification request failed (${response.status}).`);
  return payload?.data;
}

async function adminPartnerApiRequest(path, options = {}) {
  const response = await fetch(`${ADMIN_CATEGORY_API_BASE_URL}/api/admin/partners${path}`, {
    ...options,
    cache: 'no-store',
    headers: buildAdminApiHeaders({
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Partner request failed (${response.status}).`);
  return payload?.data;
}

function renderAdminNotifications(panel, notifications) {
  panel.replaceChildren();
  const heading = document.createElement('strong');
  heading.className = 'block border-b border-slate-200 px-3 py-2 text-xs text-slate-800';
  heading.textContent = 'Notifications';
  panel.appendChild(heading);
  if (!notifications.length) {
    const empty = document.createElement('p');
    empty.className = 'px-3 py-4 text-center text-xs text-slate-500';
    empty.textContent = 'No notifications yet.';
    panel.appendChild(empty);
    return;
  }
  notifications.forEach(notification => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'block w-full border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50';
    if (!notification.read_at) item.classList.add('bg-blue-50');
    const title = document.createElement('strong');
    title.className = 'block text-xs text-slate-800';
    title.textContent = notification.title || 'Notification';
    const body = document.createElement('span');
    body.className = 'mt-1 block text-[11px] text-slate-600';
    body.textContent = notification.body || '';
    item.append(title, body);
    item.addEventListener('click', async () => {
      if (notification.read_at) return;
      try {
        await adminNotificationsApiRequest(`/${encodeURIComponent(notification.id)}/read`, { method: 'PATCH' });
        notification.read_at = new Date().toISOString();
        renderAdminNotifications(panel, notifications);
      } catch (error) {
        console.error('Unable to mark admin notification as read:', error.message);
      }
    });
    panel.appendChild(item);
  });
}

function initializeAdminNotifications() {
  const button = document.getElementById('adminNotificationButton');
  if (!button) return;
  const panel = document.createElement('div');
  panel.className = 'hidden absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl';
  panel.style.maxHeight = '20rem';
  button.parentElement.classList.add('relative');
  button.parentElement.appendChild(panel);
  button.addEventListener('click', async () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    button.setAttribute('aria-expanded', String(opening));
    if (!opening) return;
    panel.textContent = 'Loading notifications...';
    try {
      const notifications = await adminNotificationsApiRequest('');
      renderAdminNotifications(panel, Array.isArray(notifications) ? notifications : []);
    } catch (error) {
      panel.textContent = error.message;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAdminNotifications, { once: true });
} else {
  initializeAdminNotifications();
}

function normalizeCategoryList(rows) {
  return rows
    .filter(category => category && category.id && category.name)
    .map(category => ({
      id: category.id,
      name: category.name,
      slug: category.slug || '',
      description: category.description || null,
      parent_id: category.parent_id || null,
      sort_order: Number.isFinite(Number(category.sort_order)) ? Number(category.sort_order) : 0,
      is_active: category.is_active !== false,
      deleted_at: category.deleted_at || null,
      image_url: category.image_url || null
    }))
    .sort((left, right) => left.sort_order - right.sort_order || String(left.name).localeCompare(String(right.name)));
}

async function loadCategoryManager() {
  const container = document.getElementById('categoryManagerGrid');
  if (!container) return;
  try {
    let imageConfigured = false;
    try {
      const imagePayload = await adminContentApiRequest('/api/category-images');
      adminCategoryImages = imagePayload?.data || {};
      imageConfigured = imagePayload?.configured === true;
    } catch (error) {
      console.warn('PostgreSQL category images are unavailable:', error.message);
      adminCategoryImages = {};
    }
    if (!imageConfigured && typeof db !== 'undefined') {
      try {
        const legacySnapshot = await db.collection('settings').doc('category_images').get();
        if (legacySnapshot.exists) adminCategoryImages = legacySnapshot.data();
      } catch (error) {
        console.warn('Legacy category images unavailable:', error.message);
      }
    }

    const apiResponse = await adminCategoryApiRequest('/api/admin/categories');
    adminCategoryItems = normalizeCategoryList(apiResponse?.data || []);

    renderCategoryManager();
    renderAdminProductCategoryOptions();
  } catch (error) {
    console.error('Category manager load failed:', error);
    container.innerHTML = '<p class="text-xs font-bold text-rose-600">Unable to load categories.</p>';
  }
}

async function handleCategoryDirectFile(event, catId) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    catId = decodeURIComponent(catId);
    const compressedCatBase64 = await compressImageFile(file, 200, 200, 0.85);
    await adminContentApiRequest(`/api/admin/settings/category-images/${encodeURIComponent(catId)}`, {
      method: 'PUT', body: JSON.stringify({ image_url: compressedCatBase64 })
    });
    adminCategoryImages[catId] = compressedCatBase64;
    renderCategoryManager();
    alert('Category photo updated.');
  } catch (error) {
    alert(`Unable to update category photo: ${error.message}`);
  }
}

function renderCategoryManager() {
  const container = document.getElementById('categoryManagerGrid');
  if (!container) return;
  container.innerHTML = adminCategoryItems.length ? adminCategoryItems.map(category => {
    const defaultCategory = adminCategoryDefaults.find(item => item.id === category.id);
    const imageUrl = adminCategoryImages[category.id] || category.image_url || defaultCategory?.img || '';
    const encodedId = encodeURIComponent(category.id);
    return `<article class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <img id="cat_preview_${escapeAdminHtml(category.id)}" src="${escapeAdminHtml(imageUrl)}" alt="${escapeAdminHtml(category.name)}" class="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" onerror="this.classList.add('hidden')">
      <div class="min-w-0 flex-1"><form onsubmit="handleUpdateAdminCategory(event, '${encodedId}')" class="grid grid-cols-1 sm:grid-cols-2 gap-1.5"><input name="name" required maxlength="60" value="${escapeAdminHtml(category.name)}" aria-label="Category name" class="min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold"><input name="slug" required maxlength="120" value="${escapeAdminHtml(category.slug)}" aria-label="Category slug" class="min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"><input name="description" maxlength="2000" value="${escapeAdminHtml(category.description || '')}" aria-label="Category description" placeholder="Description" class="min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"><input name="sort_order" type="number" step="1" value="${category.sort_order}" aria-label="Category display order" class="min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[10px]"><button class="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold text-white">Save category</button><span class="text-[10px] ${category.is_active && !category.deleted_at ? 'text-emerald-700' : 'text-slate-500'}">${category.deleted_at ? 'Deactivated' : category.is_active ? 'Active' : 'Inactive'}</span></form><p class="mt-1 truncate text-[9px] text-slate-400">${escapeAdminHtml(category.id)}</p><input type="file" accept="image/*" aria-label="Change ${escapeAdminHtml(category.name)} photo" onchange="handleCategoryDirectFile(event, '${encodedId}')" class="mt-1 w-full cursor-pointer rounded border border-slate-200 bg-white p-0.5 text-[9px] file:mr-1 file:rounded file:border-0 file:bg-[#1C2541] file:px-2 file:py-1 file:text-[9px] file:text-white"></div>
      <button type="button" onclick="deleteAdminCategory('${encodedId}')" aria-label="${category.is_active && !category.deleted_at ? 'Deactivate' : 'Activate'} ${escapeAdminHtml(category.name)} category" class="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] font-black text-rose-700">${category.is_active && !category.deleted_at ? 'Deactivate' : 'Activate'}</button>
    </article>`;
  }).join('') : '<p class="text-xs text-slate-500">No storefront categories configured.</p>';
}

function renderAdminProductCategoryOptions() {
  const select = document.getElementById('pCategory');
  if (!select || !adminCategoryItems.length) return;
  const selectedId = select.value;
  const activeCategories = adminCategoryItems.filter(category => category.is_active && !category.deleted_at);
  select.innerHTML = activeCategories.map(category => `<option value="${escapeAdminHtml(category.id)}">${escapeAdminHtml(category.name)}</option>`).join('');
  if (activeCategories.some(category => category.id === selectedId)) select.value = selectedId;
  toggleRestaurantProductFields();
}

async function handleUpdateAdminCategory(event, encodedId) {
  event.preventDefault();
  const categoryId = decodeURIComponent(encodedId);
  const form = new FormData(event.currentTarget);
  const sortOrder = Number(form.get('sort_order'));
  if (!Number.isInteger(sortOrder)) return alert('Display order must be a whole number.');
  try {
    await adminCategoryApiRequest(`/api/categories/${encodeURIComponent(categoryId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: String(form.get('name') || '').trim(),
        slug: String(form.get('slug') || '').trim(),
        description: String(form.get('description') || '').trim() || null,
        sort_order: sortOrder
      })
    });
    await loadCategoryManager();
  } catch (error) {
    alert(`Unable to update category: ${error.message}`);
  }
}

async function persistAdminCategoryState() {
  return true;
}

function slugifyAdminCategoryName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `category-${Date.now()}`;
}

async function handleNewCategoryDirectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    document.getElementById('newCategoryImageInput').value = await compressImageFile(file, 200, 200, 0.85);
    event.target.value = '';
  } catch (error) {
    alert(`Category image load failed: ${error.message}`);
  }
}

async function handleAddCategory(event) {
  event.preventDefault();
  const name = document.getElementById('newCategoryNameInput').value.trim();
  const imageUrl = document.getElementById('newCategoryImageInput').value.trim();
  if (!name || !imageUrl) return alert('Enter a category name and choose or paste an image.');

  try {
    const payload = {
      name,
      slug: slugifyAdminCategoryName(name),
      description: null,
      parent_id: null,
      sort_order: adminCategoryItems.length,
      is_active: true
    };

    const response = await adminCategoryApiRequest('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const createdCategory = response?.data || { id: '', name, slug: payload.slug };
    adminCategoryItems = normalizeCategoryList([...adminCategoryItems, createdCategory]);
    if (createdCategory.id) {
      await adminContentApiRequest(`/api/admin/settings/category-images/${encodeURIComponent(createdCategory.id)}`, {
        method: 'PUT', body: JSON.stringify({ image_url: imageUrl })
      });
      adminCategoryImages[createdCategory.id] = imageUrl;
    }

    event.target.reset();
    renderCategoryManager();
    renderAdminProductCategoryOptions();
    alert('Category added to the storefront.');
  } catch (error) {
    alert(`Unable to add category: ${error.message}`);
  }
}

async function deleteAdminCategory(encodedId) {
  const categoryId = decodeURIComponent(encodedId);
  const category = adminCategoryItems.find(item => item.id === categoryId);
  if (!category) return;
  const isActive = category.is_active && !category.deleted_at;
  const nextAction = isActive ? 'deactivate' : 'activate';
  if (!confirm(`${isActive ? 'Deactivate' : 'Reactivate'} ${category.name}? Product and order history will remain unchanged.`)) return;

  try {
    await adminCategoryApiRequest(`/api/categories/${encodeURIComponent(categoryId)}`, isActive
      ? { method: 'DELETE' }
      : { method: 'PATCH', body: JSON.stringify({ is_active: true }) });
    await loadCategoryManager();
    alert(`Category ${nextAction}d.`);
  } catch (error) {
    alert(`Unable to delete category: ${error.message}`);
  }
}

// --- ORDER STATUS PIPELINE ---
function renderStatusPills(orderId, currentStatus) {
  const statuses = [
    { key: "PLACED", label: "Placed" },
    { key: "ACCEPTED", label: "Accepted" },
    { key: "PREPARING", label: "Preparing" },
    { key: "PICKING_UP", label: "Picking Up" },
    { key: "READY_FOR_PICKUP", label: "Ready" },
    { key: "OUT_FOR_DELIVERY", label: "Out for delivery" },
    { key: "DELIVERED", label: "Delivered" },
    { key: "CANCELLED", label: "Cancelled" },
    { key: "REJECTED", label: "Rejected" },
    { key: "DELIVERY_FAILED", label: "Delivery failed" }
  ];

  return `
    <div class="flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">
      ${statuses.map(s => {
        const isCurrent = String(currentStatus || "PLACED").toUpperCase() === s.key;
        return `
          <span class="px-2 py-1 rounded-lg text-xs font-bold border shrink-0 ${isCurrent ? 'bg-[#0B132B] text-white font-black' : 'bg-slate-50 text-slate-400'}">
            ${isCurrent ? '✓ ' : ''}${s.label}
          </span>
        `;
      }).join('')}
    </div>
  `;
}

function renderAdminPickupSummary(order) {
  if (!Array.isArray(order.fulfillments) || !order.fulfillments.length) return '';
  return `
    <div class="mt-2 flex flex-wrap gap-1">
      ${order.fulfillments.map(fulfillment => `
        <span class="text-[10px] font-bold px-2 py-1 rounded-lg ${fulfillment.status === 'READY_FOR_PICKUP' || fulfillment.status === 'PICKING_UP' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">
          ${escapeAdminHtml(fulfillment.shop_name || 'Pickup')} · ${escapeAdminHtml(fulfillment.status || 'PLACED')}
        </span>
      `).join('')}
    </div>
  `;
}

async function quickSetStatus(orderId, newStatus) {
  try {
    // 1. Firebase Firestore లో అప్‌డేట్ చేయడం

    // 2. LocalStorage లో కూడా సేవ్ అయి ఉంటే అక్కడ కూడా అప్‌డేట్ చేయడం (ഡెమో కోసం ఇన్‌స్టంట్ సింక్)

  } catch (error) {
    console.warn(`Status ${newStatus} is owned by the partner or rider workflow for order ${orderId}.`, error);
  }
}

function renderAdminOrders(orders) {
  const container = document.getElementById('adminQueueContainer');
  if (!container) return;
  const today = getAdminLocalDateKey(new Date());
  orders = orders.filter(order => getAdminOrderDateKey(order) === today);

  const activeCount = orders.filter(order => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(String(order.status || '').toUpperCase())).length;
  const deliveredCount = orders.filter(order => String(order.status || '').toUpperCase() === 'DELIVERED').length;
  const activeMetric = document.getElementById('metricActiveOrders');
  const deliveredMetric = document.getElementById('metricDelivered');
  if (activeMetric) activeMetric.innerText = activeCount;
  if (deliveredMetric) deliveredMetric.innerText = deliveredCount;

  if (!orders.length) {
    container.innerHTML = '<p class="text-center text-slate-400 py-10">No orders received yet.</p>';
    return;
  }

  container.innerHTML = '';
  orders.forEach(o => {
    const row = document.createElement('div');
    row.className = "p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-3 shadow-sm";
      
    let itemsSummary = "";
    if (Array.isArray(o.items)) {
      itemsSummary = o.items.map(i => `${i.quantity}x ${i.name} (${i.unit || ''})`).join(", ");
    }

    row.innerHTML = `
        <div class="space-y-1 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-extrabold text-[#0B132B] text-sm">${escapeAdminHtml(o.id)}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">${escapeAdminHtml(o.status || 'PLACED')}</span>
          </div>
          <p class="text-[11px] text-slate-500 font-semibold">🕒 ${formatOrderDateTime(o)}</p>
          <p class="text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 inline-flex gap-1.5">
            <span>Dedicated delivery:</span>
            <span data-admin-delivery-deadline="${getAdminOrderDeadlineMs(o) || ""}" data-order-id="${escapeAdminHtml(o.id)}">${formatAdminCountdown(o)}</span>
          </p>
          <p class="text-xs text-slate-800 font-bold">${escapeAdminHtml(o.delivery_address || '')} · ${escapeAdminHtml(o.customer_phone || '')}</p>
          ${o.order_type === 'PARCEL' ? `<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 inline-block font-bold">Parcel pickup: ${escapeAdminHtml(o.parcel_pickup_address || 'Pickup address pending')} → Drop: ${escapeAdminHtml(o.parcel_drop_address || o.delivery_address || '')}</p>` : ''}
          ${itemsSummary ? `<p class="text-[11px] text-slate-600 bg-white p-1.5 rounded-xl border border-slate-200 inline-block font-semibold">📦 ${escapeAdminHtml(itemsSummary)}</p>` : ''}
          ${renderAdminPickupSummary(o)}
          ${renderRiderAssignment(o)}
        </div>

        <div class="flex items-center justify-between xl:justify-end gap-3 shrink-0">
          <span class="text-sm font-black text-emerald-600">₹${o.total_amount || o.total}</span>
          ${renderStatusPills(o.id, o.status)}
        </div>
    `;
    container.appendChild(row);
  });

  const analyticsSec = document.getElementById('analyticsViewSection');
  if (analyticsSec && !analyticsSec.classList.contains('hidden')) calculateAndRenderAnalytics();
}

function startLiveOrderQueue() {
  const container = document.getElementById('adminQueueContainer');
  if (!container) return;
  if (adminOrderPollTimer) clearInterval(adminOrderPollTimer);
  const refresh = async () => {
    try {
      const result = await adminRiderApiRequest('/api/admin/deliveries/orders?bucket=all');
      const orders = Array.isArray(result?.data) ? result.data : [];
      const currentIds = new Set(orders.map(order => order.id));
      const newOrders = adminOrderIdsInitialized
        ? orders.filter(order => !adminKnownOrderIds.has(order.id) && order.status === 'PLACED')
        : [];
      adminKnownOrderIds = currentIds;
      allFetchedOrders = orders;
      const activeOrderIds = new Set(orders.filter(order => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(String(order.status || '').toUpperCase())).map(order => order.id));
      pendingAdminOrderAlerts = pendingAdminOrderAlerts.filter(order => activeOrderIds.has(order.id));
      newOrders.forEach(order => pendingAdminOrderAlerts.push(order));
      if (newOrders.length) adminAlertSoundStopped = false;
      const today = getAdminLocalDateKey(new Date());
      renderAdminOrders(orders.filter(order => getAdminOrderDateKey(order) === today));
      showNextAdminOrderAlert();
      if (!pendingAdminOrderAlerts.length) stopAdminOrderSound();
      adminOrderIdsInitialized = true;
    } catch (error) {
      console.error('Admin order API failed:', error);
      container.innerHTML = `<p class="text-center text-rose-500 py-10">Unable to load orders: ${escapeAdminHtml(error.message)}</p>`;
    }
  };
  refresh();
  adminOrderPollTimer = setInterval(refresh, 5000);
}

// --- SALES & REPORTS ENGINE ---
function initSalesDatePicker() {
  const fromInput = document.getElementById('salesFilterFrom');
  const toInput = document.getElementById('salesFilterTo');
  if (!fromInput || !toInput) return;
  const today = getAdminReportDateKey();
  if (!fromInput.value) fromInput.value = today;
  if (!toInput.value) toInput.value = today;
  selectedFilterDate = fromInput.value;
  selectedFilterToDate = toInput.value;
  [fromInput, toInput].forEach(input => {
    if (input.dataset.reportListenerAttached === 'true') return;
    input.dataset.reportListenerAttached = 'true';
    input.addEventListener('change', () => {
      selectedFilterDate = fromInput.value;
      selectedFilterToDate = toInput.value;
      salesShopPage = 0;
      salesOrderPage = 0;
      calculateAndRenderAnalytics();
    });
  });
}

function setSalesReportFeedback(message, type = 'loading') {
  const feedback = document.getElementById('salesReportFeedback');
  if (!feedback) return;
  feedback.textContent = message || '';
  feedback.classList.toggle('hidden', !message);
  feedback.className = `rounded-xl border px-4 py-3 text-sm font-bold ${message ? '' : 'hidden'} ${type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`;
}

function formatSalesCurrency(value) {
  const amount = Number(value || 0);
  return `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0)}`;
}

function getSalesReportQuery(offset = 0) {
  const params = new URLSearchParams({
    from: selectedFilterDate,
    to: selectedFilterToDate,
    limit: String(SALES_REPORT_PAGE_SIZE),
    offset: String(offset)
  });
  return params.toString();
}

function renderSalesReportSummary(report) {
  const summary = report.summary || {};
  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  setText('statTodayRevenue', formatSalesCurrency(summary.gross_order_value));
  setText('statOnlinePaid', formatSalesCurrency(summary.successful_paid_amount));
  setText('statCodPaid', formatSalesCurrency(summary.refunds_amount));
  setText('statNetAmount', formatSalesCurrency(summary.net_amount));
  setText('statCompletedOrders', String(summary.completed_orders || 0));
  setText('statTotalOrders', `${summary.cancelled_orders || 0} / ${summary.total_orders || 0}`);

  const breakdown = document.getElementById('salesStatusBreakdown');
  if (!breakdown) return;
  const statuses = Array.isArray(report.status_breakdown) ? report.status_breakdown : [];
  if (!statuses.length) {
    breakdown.innerHTML = '<p class="text-center text-slate-500">No orders found for this date range.</p>';
    return;
  }
  breakdown.innerHTML = `<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">${statuses.map(item => `
    <div class="flex items-center justify-between gap-2 border-b border-slate-100 py-2">
      <span class="font-bold text-slate-700">${escapeAdminHtml(item.status)}</span>
      <span class="font-black text-slate-900">${Number(item.order_count) || 0}</span>
    </div>`).join('')}</div>`;
}

function renderSalesShopRows(result) {
  const body = document.getElementById('salesShopTableBody');
  const rows = Array.isArray(result.data) ? result.data : [];
  const pagination = result.pagination || { total: 0, limit: SALES_REPORT_PAGE_SIZE, offset: 0 };
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">No shop sales found for this date range.</td></tr>';
  } else {
    body.innerHTML = rows.map(row => `<tr class="border-b border-slate-50">
      <td class="px-4 py-3 font-bold text-slate-900">${escapeAdminHtml(row.shop_name || 'Shop unavailable')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeAdminHtml(row.partner_name || 'Unknown partner')}</td>
      <td class="px-4 py-3">${Number(row.order_count) || 0}</td>
      <td class="px-4 py-3">${Number(row.completed_count) || 0}</td>
      <td class="px-4 py-3">${Number(row.cancelled_count) || 0}</td>
      <td class="px-4 py-3 text-right font-black">${formatSalesCurrency(row.sales_amount)}</td>
    </tr>`).join('');
  }
  updateSalesReportPager('shops', pagination);
}

function renderSalesOrderRows(result) {
  const tbody = document.getElementById('settlementTableBody');
  const rows = Array.isArray(result.data) ? result.data : [];
  const pagination = result.pagination || { total: 0, limit: SALES_REPORT_PAGE_SIZE, offset: 0 };
  salesReportOrders = rows;
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">No orders found for this date range.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(order => `<tr class="border-b border-slate-50">
      <td class="px-4 py-3 font-bold text-slate-900">${escapeAdminHtml(order.order_number)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeAdminHtml(new Date(order.placed_at).toLocaleString())}</td>
      <td class="px-4 py-3 text-slate-600">${escapeAdminHtml(order.shop_names || 'N/A')}</td>
      <td class="px-4 py-3 font-bold">${escapeAdminHtml(order.status)}</td>
      <td class="px-4 py-3 text-right">${formatSalesCurrency(order.gross_order_value)}</td>
      <td class="px-4 py-3 text-right">${formatSalesCurrency(order.successful_paid_amount)}</td>
      <td class="px-4 py-3 text-right">${formatSalesCurrency(order.refunds_amount)}</td>
    </tr>`).join('');
  }
  updateSalesReportPager('orders', pagination);
}

function updateSalesReportPager(type, pagination) {
  const isShop = type === 'shops';
  const page = isShop ? salesShopPage : salesOrderPage;
  const total = Number(pagination.total) || 0;
  const start = total ? page * SALES_REPORT_PAGE_SIZE + 1 : 0;
  const end = Math.min((page + 1) * SALES_REPORT_PAGE_SIZE, total);
  const label = document.getElementById(isShop ? 'salesShopPageLabel' : 'salesOrderPageLabel');
  const previous = document.getElementById(isShop ? 'salesShopPrevious' : 'salesOrderPrevious');
  const next = document.getElementById(isShop ? 'salesShopNext' : 'salesOrderNext');
  if (label) label.textContent = `Showing ${start}-${end} of ${total} ${isShop ? 'shops' : 'orders'}`;
  if (previous) previous.disabled = page === 0;
  if (next) next.disabled = (page + 1) * SALES_REPORT_PAGE_SIZE >= total;
}

async function fetchSalesReport(path) {
  const payload = await adminRiderApiRequest(path, { cache: 'no-store' });
  return payload;
}

async function loadSalesReports() {
  const requestId = ++salesReportRequestId;
  if (!selectedFilterDate || !selectedFilterToDate || selectedFilterDate > selectedFilterToDate) {
    setSalesReportFeedback('Choose a valid date range. The start date must not be after the end date.', 'error');
    return;
  }
  const summary = document.getElementById('salesStatusBreakdown');
  const shopBody = document.getElementById('salesShopTableBody');
  const orderBody = document.getElementById('settlementTableBody');
  salesReportOrders = [];
  ['statTodayRevenue', 'statOnlinePaid', 'statCodPaid', 'statNetAmount', 'statCompletedOrders', 'statTotalOrders']
    .forEach(id => {
      const element = document.getElementById(id);
      if (element) element.textContent = '...';
    });
  setSalesReportFeedback('Loading report data...');
  if (summary) summary.innerHTML = '<p class="text-center">Loading report...</p>';
  if (shopBody) shopBody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-500">Loading report...</td></tr>';
  if (orderBody) orderBody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-slate-500">Loading report...</td></tr>';

  const query = getSalesReportQuery();
  try {
    const [summaryResult, shopsResult, ordersResult] = await Promise.all([
      fetchSalesReport(`/api/admin/reports/summary?${query}`),
      fetchSalesReport(`/api/admin/reports/shops?${getSalesReportQuery(salesShopPage * SALES_REPORT_PAGE_SIZE)}`),
      fetchSalesReport(`/api/admin/reports/orders?${getSalesReportQuery(salesOrderPage * SALES_REPORT_PAGE_SIZE)}`)
    ]);
    if (requestId !== salesReportRequestId) return;
    renderSalesReportSummary(summaryResult?.data || {});
    renderSalesShopRows(shopsResult || {});
    renderSalesOrderRows(ordersResult || {});
    const rangeLabel = selectedFilterDate === selectedFilterToDate
      ? selectedFilterDate
      : `${selectedFilterDate} to ${selectedFilterToDate}`;
    const dateLabel = document.getElementById('activeDateLabel');
    if (dateLabel) dateLabel.textContent = rangeLabel;
    setSalesReportFeedback('');
  } catch (error) {
    if (requestId !== salesReportRequestId) return;
    ['statTodayRevenue', 'statOnlinePaid', 'statCodPaid', 'statNetAmount', 'statCompletedOrders', 'statTotalOrders']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = 'N/A';
      });
    setSalesReportFeedback(error.message || 'Unable to load report data.', 'error');
    if (summary) summary.innerHTML = '<p class="text-center text-rose-600">Unable to load status breakdown.</p>';
    if (shopBody) shopBody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-rose-600">Unable to load shop report.</td></tr>';
    if (orderBody) orderBody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-rose-600">Unable to load order report.</td></tr>';
  }
}

function filterSalesByDate(val) {
  selectedFilterDate = val;
  selectedFilterToDate = val;
  calculateAndRenderAnalytics();
}

function resetSalesToToday() {
  const today = getAdminReportDateKey();
  const fromInput = document.getElementById('salesFilterFrom');
  const toInput = document.getElementById('salesFilterTo');
  if (fromInput) fromInput.value = today;
  if (toInput) toInput.value = today;
  selectedFilterDate = today;
  selectedFilterToDate = today;
  salesShopPage = 0;
  salesOrderPage = 0;
  calculateAndRenderAnalytics();
}

function calculateAndRenderAnalytics() {
  return loadSalesReports();
}

function changeSalesReportPage(type, direction) {
  if (type === 'shops') salesShopPage = Math.max(0, salesShopPage + direction);
  else salesOrderPage = Math.max(0, salesOrderPage + direction);
  loadSalesReports();
}

function exportDailyOrdersCSV() {
  if (salesReportOrders.length === 0) return alert("No orders on the current report page to export.");
  const headers = ["Order Number", "Date", "Shops", "Status", "Gross Order Value", "Successful Payments", "Refunds"];
  const escapeCsv = value => {
    const text = String(value ?? '');
    const safeText = /^[\t\r=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
  };
  const rows = salesReportOrders.map(order => [
    order.order_number,
    new Date(order.placed_at).toISOString(),
    order.shop_names || '',
    order.status,
    order.gross_order_value,
    order.successful_paid_amount,
    order.refunds_amount
  ].map(escapeCsv));
  const csvContent = [headers.map(escapeCsv).join(","), ...rows.map(row => row.join(","))].join("\n");
  const csvUrl = URL.createObjectURL(new Blob([csvContent], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.setAttribute("href", csvUrl);
  link.setAttribute("download", `MyShopzy_Orders_${selectedFilterDate}_${selectedFilterToDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(csvUrl);
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    if (event.target.closest('button, [onclick]')) {
      ADMIN_TAB_SOUND.currentTime = 0;
      ADMIN_TAB_SOUND.play().catch(() => {});
    }
  });
  adminCountdownTimer = setInterval(updateAdminCountdowns, 1000);
  if (sessionStorage.getItem('hub_session_unlocked') === 'true' && getAdminAccessToken()) {
    const lock = document.getElementById('adminAuthLock');
    if (lock) lock.classList.add('hidden');
    switchView('orders');
  } else {
    sessionStorage.removeItem('hub_session_unlocked');
  }
  startLiveOrderQueue();
  startRegisteredRiderListener();
  loadAdminRestaurants();
  loadAdminPartnerAccounts();
  toggleRestaurantProductFields();
  loadAdminInventory();
  loadCategoryManager();
  // ==========================================
// 🗺️ LIVE RIDER TRACKING (Admin Side)
// ==========================================

let adminMap = null;
let riderLiveMarker = null;

function openAdminRiderTracker(assignmentId) {
  const mapModal = document.getElementById('adminMapModal');
  if (mapModal) {
    mapModal.classList.remove('hidden');
  } else {
    alert("Map modal HTML element missing in admin.html!");
    return;
  }

  if (!adminMap) {
    adminMap = L.map('adminMapContainer').setView([16.7483, 81.8488], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(adminMap);
  } else {
    setTimeout(() => { adminMap.invalidateSize(); }, 200);
  }

  if (adminTrackingPollTimer) clearInterval(adminTrackingPollTimer);
  if (riderLiveMarker) {
    adminMap.removeLayer(riderLiveMarker);
    riderLiveMarker = null;
  }
  const refresh = async () => {
    try {
      const result = await adminRiderApiRequest(`/api/admin/deliveries/assignments/${encodeURIComponent(assignmentId)}/tracking`);
      const location = result?.data?.location;
      if (!location) return;
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      if (riderLiveMarker) {
        riderLiveMarker.setLatLng([latitude, longitude]);
      } else {
        riderLiveMarker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className: 'custom-rider-icon',
            html: '<div style="font-size: 24px;">🛵</div>',
            iconSize: [30, 30]
          })
        }).addTo(adminMap).bindPopup(`<b>${escapeAdminHtml(result.data.rider_name || 'Rider')}</b> (${escapeAdminHtml(result.data.assignment_status)})`).openPopup();
      }
      adminMap.setView([latitude, longitude], 16);
    } catch (error) {
      console.error('Admin delivery tracking failed:', error);
    }
  };
  refresh();
  adminTrackingPollTimer = setInterval(refresh, 4000);
}

function closeAdminRiderTracker() {
  const mapModal = document.getElementById('adminMapModal');
  if (mapModal) mapModal.classList.add('hidden');
  if (adminTrackingPollTimer) clearInterval(adminTrackingPollTimer);
  adminTrackingPollTimer = null;
}

window.openAdminRiderTracker = openAdminRiderTracker;
window.closeAdminRiderTracker = closeAdminRiderTracker;
});