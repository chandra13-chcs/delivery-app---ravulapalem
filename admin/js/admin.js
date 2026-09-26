// ==========================================
// 🛡️ ADMIN OPERATIONS HUB ENGINE (admin.js)
// ==========================================

const STORE_TERMINAL_PIN = "748801";
let allFetchedOrders = [];
let selectedFilterDate = ""; // Empty means today
let ADMIN_RIDER_NAMES = [];
let ADMIN_RIDER_PROFILES = [];
const adminRiderLocations = {};
const adminRiderLocationUnsubscribers = [];
let adminOrderIdsInitialized = false;
let adminCountdownTimer = null;
let pendingAdminOrderAlerts = [];
let adminAlertSoundStopped = false;
const ADMIN_ORDER_SOUND = new Audio("../assets/audio/admin-rider-order.mpeg");
const ADMIN_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
ADMIN_ORDER_SOUND.loop = true;

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
  const order = pendingAdminOrderAlerts[0];
  if (!order) return;
  try {
    const acceptanceUpdate = {
        status: "ACCEPTED",
        accepted_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("orders").doc(order.id).update(acceptanceUpdate);
      pendingAdminOrderAlerts.shift();
      adminAlertSoundStopped = false;
      stopAdminOrderSound();
      showNextAdminOrderAlert();
    } catch (error) {
      alert(`Unable to accept order: ${error.message}`);
  }
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

function getAdminOrderDateKey(order) {
  if (Number.isFinite(Number(order?.created_at_ms))) {
    return getAdminLocalDateKey(new Date(Number(order.created_at_ms)));
  }
  if (order?.created_at?.toDate) return getAdminLocalDateKey(order.created_at.toDate());
  if (order?.created_at?.seconds) return getAdminLocalDateKey(new Date(Number(order.created_at.seconds) * 1000));
  return "";
}

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startAdminRiderLocationListeners() {
  renderAdminRiderStatus();
  ADMIN_RIDER_NAMES.forEach(riderName => {
    subscribeToAdminRiderLocation(riderName);
  });
}

function subscribeToAdminRiderLocation(riderName) {
  if (adminRiderLocations[`${riderName}_listener`]) return;
  const unsubscribe = db.collection("riders_location").doc(riderName).onSnapshot(doc => {
    if (doc.exists) adminRiderLocations[riderName] = doc.data();
    else delete adminRiderLocations[riderName];
    renderAdminRiderStatus();
    refreshAdminRiderAssignmentFields();
  }, error => console.error(`Rider location listener error (${riderName}):`, error));
  adminRiderLocations[`${riderName}_listener`] = unsubscribe;
  adminRiderLocationUnsubscribers.push(unsubscribe);
}

function startRegisteredRiderListener() {
  db.collection("rider_profiles").onSnapshot(snapshot => {
    const registeredNames = [];
    ADMIN_RIDER_PROFILES = [];
    snapshot.forEach(doc => {
      const profile = { id: doc.id, ...doc.data() };
      ADMIN_RIDER_PROFILES.push(profile);
      const name = profile.name;
      if (name) registeredNames.push(name);
    });
    ADMIN_RIDER_NAMES = [...new Set(registeredNames)];
    ADMIN_RIDER_NAMES.forEach(subscribeToAdminRiderLocation);
    renderAdminRiderStatus();
    renderRiderVerificationQueue();
    refreshAdminRiderAssignmentFields();
  }, error => console.error("Registered rider listener error:", error));
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
    await db.collection("rider_profiles").doc(riderId).set({
      verification_status: status,
      verification_review_reason: reason,
      reviewed_at_ms: Date.now()
    }, { merge: true });
  } catch (error) {
    alert(`Rider review failed: ${error.message}`);
  }
}

function renderAdminRiderStatus() {
  const container = document.getElementById("adminRiderStatusList");
  if (!container) return;
  container.innerHTML = ADMIN_RIDER_NAMES.map(name => `
    <span class="text-[10px] font-bold text-slate-800 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
      🛵 ${name}: <strong class="${adminRiderLocations[name]?.available === true ? "text-emerald-600" : "text-slate-400"}">${adminRiderLocations[name]?.available === true ? "Online" : "Offline"}</strong>
    </span>
  `).join("");
}

function renderRiderAssignment(order) {
  const selectedRider = order.assigned_rider || "";

  return `
    <div class="flex flex-wrap items-center gap-2 mt-2">
      <select data-admin-rider-select="true" data-order-id="${order.id}" onchange="assignOrderToRider('${order.id}', this.value)" class="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-700">
        <option value="">Assign rider...</option>
        ${renderAdminRiderOptions(selectedRider)}
      </select>
      ${selectedRider ? `<button onclick="openAdminRiderTracker('${selectedRider}')" class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold">Track ${selectedRider}</button>` : ""}
    </div>
  `;
}

function renderAdminRiderOptions(selectedRider = "") {
  return ADMIN_RIDER_NAMES.map(name => {
    const online = adminRiderLocations[name]?.available === true ? "Online" : "GPS offline";
    return `<option value="${name}" ${selectedRider === name ? "selected" : ""}>${name} - ${online}</option>`;
  }).join("");
}

function refreshAdminRiderAssignmentFields() {
  document.querySelectorAll("[data-admin-rider-select]").forEach(select => {
    const selectedRider = select.value;
    select.innerHTML = `<option value="">Assign rider...</option>${renderAdminRiderOptions(selectedRider)}`;
    select.value = selectedRider;
  });
}

async function assignOrderToRider(orderId, riderName) {
  if (!riderName) return;
  try {
    await db.collection("orders").doc(orderId).update({
      assigned_rider: riderName,
      assigned_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Rider assignment failed:", error);
    alert("Unable to assign rider: " + error.message);
  }
}

function verifyAdminAccess() {
  const entered = document.getElementById('adminPinInput').value;
  if (entered === STORE_TERMINAL_PIN) {
    sessionStorage.setItem('hub_session_unlocked', 'true');
    const lock = document.getElementById('adminAuthLock');
    if (lock) lock.classList.add('hidden');
    switchView('orders');
  } else {
    document.getElementById('pinErrorMsg').classList.remove('hidden');
  }
}

// 4-TAB SWITCHER
function switchView(tab) {
  const ordersSec = document.getElementById('ordersViewSection');
  const analyticsSec = document.getElementById('analyticsViewSection');
  const invSec = document.getElementById('inventoryViewSection');
  const partnersSec = document.getElementById('partnersViewSection');
  const banSec = document.getElementById('bannersViewSection');

  const btnOrders = document.getElementById('tabBtnOrders');
  const btnAnalytics = document.getElementById('tabBtnAnalytics');
  const btnInv = document.getElementById('tabBtnInventory');
  const btnPartners = document.getElementById('tabBtnPartners');
  const btnBan = document.getElementById('tabBtnBanners');

  [ordersSec, analyticsSec, invSec, partnersSec, banSec].forEach(el => el && el.classList.add('hidden'));
  [btnOrders, btnAnalytics, btnInv, btnPartners, btnBan].forEach(b => b && (b.className = "px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5 transition"));

  if (tab === 'orders') {
    if (ordersSec) ordersSec.classList.remove('hidden');
    if (btnOrders) btnOrders.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
  } else if (tab === 'analytics') {
    if (analyticsSec) analyticsSec.classList.remove('hidden');
    if (btnAnalytics) btnAnalytics.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
    initSalesDatePicker();
    calculateAndRenderAnalytics();
  } else if (tab === 'inventory') {
    if (invSec) invSec.classList.remove('hidden');
    if (btnInv) btnInv.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
    loadAdminInventory();
  } else if (tab === 'partners') {
    if (partnersSec) partnersSec.classList.remove('hidden');
    if (btnPartners) btnPartners.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
  } else if (tab === 'banners') {
    if (banSec) banSec.classList.remove('hidden');
    if (btnBan) btnBan.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
    loadAdminBanners();
    loadAdminDailyOffer();
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

function toggleRestaurantProductFields() {
  const category = document.getElementById('pCategory')?.value;
  const source = document.getElementById('pPickupSource')?.value;
  const fields = document.getElementById('restaurantProductFields');
  const partnerFields = document.getElementById('partnerProductFields');
  if (fields) fields.classList.toggle('hidden', category !== 'restaurants' && source !== 'restaurant');
  if (partnerFields) partnerFields.classList.toggle('hidden', source !== 'meat_partner' && source !== 'store_partner');
  refreshAdminPartnerProductOptions();
}

function refreshAdminPartnerProductOptions() {
  const select = document.getElementById('pPartner');
  if (!select) return;
  const type = document.getElementById('pPickupSource')?.value === 'meat_partner' ? 'meat' : 'store';
  const selectedId = select.value;
  const accounts = adminPartnerAccounts.filter(account => account.type === type && account.enabled !== false);
  select.innerHTML = accounts.length
    ? accounts.map(account => `<option value="${escapeAdminHtml(account.id)}">${escapeAdminHtml(account.name || 'Unnamed partner')}</option>`).join('')
    : '<option value="">Create an active partner account first</option>';
  if (accounts.some(account => account.id === selectedId)) select.value = selectedId;
}

function loadAdminRestaurants() {
  const select = document.getElementById('pRestaurant');
  const list = document.getElementById('adminRestaurantsList');
  const accountRestaurantSelect = document.getElementById('partnerAccountRestaurant');
  if (!select && !list && !accountRestaurantSelect) return;

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
    if (accountRestaurantSelect) {
      const selectedId = accountRestaurantSelect.value;
      accountRestaurantSelect.innerHTML = adminRestaurants.length
        ? '<option value="">Select a restaurant...</option>'
        : '<option value="">Add a restaurant in Inventory first</option>';
      adminRestaurants.forEach(restaurant => {
        accountRestaurantSelect.innerHTML += `<option value="${escapeAdminHtml(restaurant.id)}">${escapeAdminHtml(restaurant.name || 'Unnamed restaurant')}</option>`;
      });
      accountRestaurantSelect.value = selectedId;
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

function toggleAdminPartnerAccountFields() {
  const type = document.getElementById('partnerAccountType')?.value;
  document.getElementById('partnerAccountNameField')?.classList.toggle('hidden', type === 'restaurant');
  document.getElementById('partnerAccountRestaurantField')?.classList.toggle('hidden', type !== 'restaurant');
  const nameInput = document.getElementById('partnerAccountName');
  const restaurantSelect = document.getElementById('partnerAccountRestaurant');
  if (nameInput) nameInput.required = type !== 'restaurant';
  if (restaurantSelect) restaurantSelect.required = type === 'restaurant';
}

async function createAdminPartnerAccount(event) {
  event.preventDefault();
  const type = document.getElementById('partnerAccountType')?.value;
  let partnerId;
  let name;
  if (type === 'restaurant') {
    partnerId = document.getElementById('partnerAccountRestaurant')?.value;
    const restaurant = adminRestaurants.find(item => item.id === partnerId);
    if (!restaurant) return alert('Select an existing restaurant first.');
    name = restaurant.name || 'Restaurant Partner';
  } else {
    name = document.getElementById('partnerAccountName')?.value.trim();
    if (!name) return alert('Enter a partner name.');
    partnerId = db.collection('partner_accounts').doc().id;
  }

  try {
    await db.collection('partner_accounts').doc(partnerId).set({
      partner_id: partnerId,
      type,
      name,
      enabled: true,
      created_at_ms: Date.now(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    document.getElementById('partnerAccountName').value = '';
    alert(`Partner account created for ${name}. Use its console link below.`);
  } catch (error) {
    alert(`Unable to create partner account: ${error.message}`);
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

function loadAdminPartnerAccounts() {
  db.collection('partner_accounts').onSnapshot(snapshot => {
    const container = document.getElementById('adminPartnerAccountsList');
    if (!container) return;
    const accounts = [];
    snapshot.forEach(doc => accounts.push({ id: doc.id, ...doc.data() }));
    adminPartnerAccounts = accounts;
    accounts.sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
    refreshAdminPartnerProductOptions();
    container.innerHTML = accounts.length ? accounts.map(account => {
      const typeLabels = { meat: 'Meat partner', store: 'Extra store', restaurant: 'Restaurant' };
      const consoleUrl = getAdminPartnerConsoleUrl(account.id);
      return `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex items-start justify-between gap-3"><div><h3 class="text-sm font-black text-slate-900">${escapeAdminHtml(account.name || 'Unnamed partner')}</h3><p class="text-[10px] font-bold uppercase text-slate-500 mt-1">${escapeAdminHtml(typeLabels[account.type] || account.type || 'Partner')} · ${escapeAdminHtml(account.id)}</p></div><span class="rounded-full px-2 py-1 text-[10px] font-black ${account.enabled === false ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}">${account.enabled === false ? 'Disabled' : 'Active'}</span></div>
        <div class="mt-3 flex flex-wrap gap-2"><a href="${escapeAdminHtml(consoleUrl)}" target="_blank" rel="noopener" class="rounded-lg bg-[#0B132B] px-3 py-2 text-[10px] font-black text-white">Open console</a><button type="button" onclick="copyAdminPartnerConsoleLink('${encodeURIComponent(account.id)}')" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black text-slate-700">Copy partner link</button></div>
      </article>`;
    }).join('') : '<p class="text-xs text-slate-500">No partner accounts configured yet.</p>';
  }, error => {
    console.error('Partner account listener error:', error);
    const container = document.getElementById('adminPartnerAccountsList');
    if (container) container.innerHTML = '<p class="text-xs font-bold text-rose-600">Unable to load partner accounts. Check Firestore access.</p>';
  });
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

  if (!selectedProductBase64) {
    alert("Please choose a product photo from your laptop folder or gallery!");
    return;
  }

  const name = document.getElementById('pName').value.trim();
  const category = document.getElementById('pCategory').value;
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
  const partnerType = pickupSource === 'meat_partner' ? 'meat' : pickupSource === 'store_partner' ? 'store' : '';
  if (partnerType && !adminPartnerAccounts.some(account => account.id === partnerId && account.type === partnerType && account.enabled !== false)) {
    alert('Create or select an active account for this partner type first.');
    return;
  }

  const btn = document.getElementById('saveProdBtn');
  if (btn) { btn.innerText = "Saving to Storefront..."; btn.disabled = true; }

  const isPartnerProduct = pickupSource === 'meat_partner' || pickupSource === 'store_partner';
  const resolvedPartnerId = pickupSource === 'restaurant' ? restaurantId : isPartnerProduct ? partnerId : null;
  const resolvedPartnerName = pickupSource === 'restaurant'
    ? restaurant?.name || null
    : isPartnerProduct
      ? partnerName
      : null;

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
    image_url: selectedProductBase64,
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
let adminHomepageBannersUnsubscribe = null;

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
    updated_at: firebase.firestore.FieldValue.serverTimestamp(),
    is_active: true
  };

  try {
    const bannerId = document.getElementById('bannerDocumentId').value;
    if (bannerId === 'legacy') {
      await db.collection('settings').doc('hero_banner').set(bannerData, { merge: true });
    } else if (bannerId) {
      bannerData.created_at_ms = adminHomepageBanners.find(item => item.id === bannerId)?.created_at_ms || Date.now();
      await db.collection('homepage_banners').doc(bannerId).set(bannerData, { merge: true });
    } else {
      bannerData.created_at_ms = Date.now();
      await db.collection('homepage_banners').add(bannerData);
      await db.collection('settings').doc('hero_banner').delete();
    }
    resetHomepageBannerForm();
    alert('Homepage banner saved.');
  } catch (error) {
    alert(`Unable to save banner: ${error.message}`);
  } finally {
    if (btn) btn.disabled = false;
    updateHomepageBannerSubmitLabel();
  }
}

async function loadActiveHeroBanner() {
  try {
    const doc = await db.collection("settings").doc("hero_banner").get();
    if (doc.exists) {
      const d = doc.data();
      const tIn = document.getElementById('bannerTitleInput');
      const sIn = document.getElementById('bannerSubInput');
      const iIn = document.getElementById('bannerImgInput');
      if (tIn) tIn.value = d.title || '';
      if (sIn) sIn.value = d.subtitle || '';
      if (iIn) iIn.value = d.image_url || '';
    }
  } catch(e) {}
}

async function handleResetDefaultBanner() {
  if (!confirm("Reset banner back to default?")) return;
  try {
    await db.collection("settings").doc("hero_banner").delete();
    loadActiveHeroBanner();
    alert("Banner reset to default!");
  } catch(e) {
    alert(e.message);
  }
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

function loadAdminBanners() {
  if (adminHomepageBannersUnsubscribe) return;
  renderAdminBanners();
  db.collection('homepage_banners').get().then(applyAdminBannerSnapshot).catch(error => {
    console.error('Homepage banner load failed:', error);
  });
  adminHomepageBannersUnsubscribe = db.collection('homepage_banners').onSnapshot(snapshot => {
    applyAdminBannerSnapshot(snapshot);
  }, error => {
    console.error('Homepage banner listener error:', error);
  });
}

function applyAdminBannerSnapshot(snapshot) {
  adminHomepageBanners = [];
  snapshot.forEach(doc => adminHomepageBanners.push({ id: doc.id, ...doc.data() }));
  adminHomepageBanners.sort((left, right) => Number(right.created_at_ms || 0) - Number(left.created_at_ms || 0));
  if (adminHomepageBanners.length) {
    renderAdminBanners();
    return;
  }
  db.collection('settings').doc('hero_banner').get().then(legacySnapshot => {
    if (!legacySnapshot.exists || adminHomepageBanners.length) return renderAdminBanners();
    adminHomepageBanners = [{ id: 'legacy', ...legacySnapshot.data() }];
    renderAdminBanners();
  }).catch(error => {
    console.error('Legacy homepage banner load failed:', error);
    renderAdminBanners();
  });
}

function renderAdminBanners() {
  const container = document.getElementById('homepageBannersList');
  if (!container) return;
  container.innerHTML = adminHomepageBanners.length ? adminHomepageBanners.map(banner => `
    <article class="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <img src="${escapeAdminHtml(banner.image_url || '')}" alt="${escapeAdminHtml(banner.title || 'Homepage banner')}" class="h-32 w-full bg-slate-100 object-cover" onerror="this.classList.add('hidden')">
      <div class="p-3"><h3 class="text-sm font-black text-slate-900">${escapeAdminHtml(banner.title || 'Untitled banner')}</h3><p class="mt-1 text-[11px] text-slate-500">${escapeAdminHtml(banner.subtitle || '')}</p>
        <div class="mt-3 flex gap-2"><button type="button" onclick="editHomepageBanner('${encodeURIComponent(banner.id)}')" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[10px] font-black text-slate-700">Edit</button><button type="button" onclick="deleteHomepageBanner('${encodeURIComponent(banner.id)}')" class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-700">Delete</button></div>
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
  updateHomepageBannerSubmitLabel();
  document.getElementById('homepageBannerForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteHomepageBanner(encodedId) {
  const bannerId = decodeURIComponent(encodedId);
  if (!confirm('Delete this homepage banner?')) return;
  try {
    if (bannerId === 'legacy') {
      await db.collection('settings').doc('hero_banner').delete();
      adminHomepageBanners = adminHomepageBanners.filter(banner => banner.id !== 'legacy');
      renderAdminBanners();
    } else {
      await db.collection('homepage_banners').doc(bannerId).delete();
    }
    if (document.getElementById('bannerDocumentId').value === bannerId) resetHomepageBannerForm();
  } catch (error) {
    alert(`Unable to delete banner: ${error.message}`);
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
    const snapshot = await db.collection('settings').doc('daily_offer').get();
    const offer = snapshot.exists ? snapshot.data() : {};
    document.getElementById('dailyOfferEnabledInput').checked = offer.is_active === true;
    document.getElementById('dailyOfferTitleInput').value = offer.title || '';
    document.getElementById('dailyOfferCodeInput').value = offer.code || '';
    document.getElementById('dailyOfferDescriptionInput').value = offer.description || '';
    document.getElementById('dailyOfferBodyInput').value = offer.body || '';
    document.getElementById('dailyOfferImageInput').value = offer.image_url || '';
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
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    await db.collection('settings').doc('daily_offer').set(offer);
    alert('Offer popup saved.');
  } catch (error) {
    alert(`Unable to save popup: ${error.message}`);
  }
}

async function handleDeleteDailyOffer() {
  if (!confirm('Delete the offer popup from the storefront?')) return;
  try {
    await db.collection('settings').doc('daily_offer').delete();
    document.getElementById('dailyOfferEnabledInput').checked = false;
    document.getElementById('dailyOfferTitleInput').value = '';
    document.getElementById('dailyOfferCodeInput').value = '';
    document.getElementById('dailyOfferDescriptionInput').value = '';
    document.getElementById('dailyOfferBodyInput').value = '';
    document.getElementById('dailyOfferImageInput').value = '';
    alert('Offer popup deleted.');
  } catch (error) {
    alert(`Unable to delete popup: ${error.message}`);
  }
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

async function loadCategoryManager() {
  const container = document.getElementById('categoryManagerGrid');
  if (!container) return;
  try {
    const [catalogSnapshot, imageSnapshot] = await Promise.all([
      db.collection('settings').doc('category_catalog').get(),
      db.collection('settings').doc('category_images').get()
    ]);
    adminCategoryItems = catalogSnapshot.exists && Array.isArray(catalogSnapshot.data().categories)
      ? catalogSnapshot.data().categories.filter(category => category?.id && category?.name)
      : adminCategoryDefaults.map(({ id, name }) => ({ id, name }));
    adminCategoryImages = imageSnapshot.exists ? imageSnapshot.data() : {};
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
    await db.collection("settings").doc("category_images").set({
      [catId]: compressedCatBase64
    }, { merge: true });
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
    return `<article class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <img id="cat_preview_${escapeAdminHtml(category.id)}" src="${escapeAdminHtml(imageUrl)}" alt="${escapeAdminHtml(category.name)}" class="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" onerror="this.classList.add('hidden')">
      <div class="min-w-0 flex-1"><p class="truncate text-xs font-bold text-slate-800">${escapeAdminHtml(category.name)}</p><p class="mt-0.5 truncate text-[10px] text-slate-500">${escapeAdminHtml(category.id)}</p><input type="file" accept="image/*" aria-label="Change ${escapeAdminHtml(category.name)} photo" onchange="handleCategoryDirectFile(event, '${encodedId}')" class="mt-1 w-full cursor-pointer rounded border border-slate-200 bg-white p-0.5 text-[9px] file:mr-1 file:rounded file:border-0 file:bg-[#1C2541] file:px-2 file:py-1 file:text-[9px] file:text-white"></div>
      <button type="button" onclick="deleteAdminCategory('${encodedId}')" aria-label="Delete ${escapeAdminHtml(category.name)} category" class="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] font-black text-rose-700">Delete</button>
    </article>`;
  }).join('') : '<p class="text-xs text-slate-500">No storefront categories configured.</p>';
}

function renderAdminProductCategoryOptions() {
  const select = document.getElementById('pCategory');
  if (!select || !adminCategoryItems.length) return;
  const selectedId = select.value;
  select.innerHTML = adminCategoryItems.map(category => `<option value="${escapeAdminHtml(category.id)}">${escapeAdminHtml(category.name)}</option>`).join('');
  if (adminCategoryItems.some(category => category.id === selectedId)) select.value = selectedId;
  toggleRestaurantProductFields();
}

async function persistAdminCategoryState() {
  const batch = db.batch();
  batch.set(db.collection('settings').doc('category_catalog'), {
    categories: adminCategoryItems.map(({ id, name }) => ({ id, name })),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(db.collection('settings').doc('category_images'), adminCategoryImages);
  await batch.commit();
  renderCategoryManager();
  renderAdminProductCategoryOptions();
}

function createCategoryId(name) {
  const baseId = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `category-${Date.now()}`;
  let id = baseId;
  let suffix = 2;
  while (adminCategoryItems.some(category => category.id === id)) id = `${baseId}-${suffix++}`;
  return id;
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
  const id = createCategoryId(name);
  const previousImages = adminCategoryImages;
  adminCategoryItems = [...adminCategoryItems, { id, name }];
  adminCategoryImages = { ...adminCategoryImages, [id]: imageUrl };
  try {
    await persistAdminCategoryState();
    event.target.reset();
    alert('Category added to the storefront.');
  } catch (error) {
    adminCategoryItems = adminCategoryItems.filter(category => category.id !== id);
    adminCategoryImages = previousImages;
    renderCategoryManager();
    renderAdminProductCategoryOptions();
    alert(`Unable to add category: ${error.message}`);
  }
}

async function deleteAdminCategory(encodedId) {
  const categoryId = decodeURIComponent(encodedId);
  const category = adminCategoryItems.find(item => item.id === categoryId);
  if (!category || !confirm(`Remove ${category.name} from the storefront? Its products will remain in inventory.`)) return;
  const previousCategories = adminCategoryItems;
  const previousImages = adminCategoryImages;
  adminCategoryItems = adminCategoryItems.filter(item => item.id !== categoryId);
  adminCategoryImages = { ...adminCategoryImages };
  delete adminCategoryImages[categoryId];
  try {
    await persistAdminCategoryState();
  } catch (error) {
    adminCategoryItems = previousCategories;
    adminCategoryImages = previousImages;
    renderCategoryManager();
    renderAdminProductCategoryOptions();
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
    { key: "PACKED", label: "Packed" },
    { key: "DISPATCHED", label: "Dispatched" },
    { key: "DELIVERED", label: "Delivered" }
  ];

  return `
    <div class="flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">
      ${statuses.map(s => {
        const isCurrent = (currentStatus || "PLACED") === s.key;
        return `
          <button 
            type="button"
            onclick="quickSetStatus('${orderId}', '${s.key}')" 
            class="px-2 py-1 rounded-lg text-xs font-bold border transition shrink-0 ${isCurrent ? 'bg-[#0B132B] text-white font-black scale-105 shadow' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}"
          >
            ${isCurrent ? '✓ ' : ''}${s.label}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderAdminPickupSummary(order) {
  if (!Array.isArray(order.items)) return '';
  const sources = {};
  order.items.forEach(item => {
    const key = item.pickup_source || 'store';
    if (!sources[key]) sources[key] = { name: item.pickup_source_name || 'MyShopzy Store', count: 0 };
    sources[key].count += Number(item.quantity || 0);
  });
  const progress = order.pickup_progress || {};
  return `
    <div class="mt-2 flex flex-wrap gap-1">
      ${Object.entries(sources).map(([key, source]) => `
        <span class="text-[10px] font-bold px-2 py-1 rounded-lg ${progress[key] ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">
          ${progress[key] ? '✓' : '○'} ${source.name} · ${source.count} item${source.count === 1 ? '' : 's'}
        </span>
      `).join('')}
    </div>
  `;
}

async function quickSetStatus(orderId, newStatus) {
  try {
    // 1. Firebase Firestore లో అప్‌డేట్ చేయడం
    await db.collection("orders").doc(orderId).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. LocalStorage లో కూడా సేవ్ అయి ఉంటే అక్కడ కూడా అప్‌డేట్ చేయడం (ഡెమో కోసం ఇన్‌స్టంట్ సింక్)
    for (let i = 0; i < localStorage.length; i++) {
      let key = localStorage.key(i);
      if (key && key.startsWith('orders_')) {
        let ords = JSON.parse(localStorage.getItem(key) || '[]');
        let index = ords.findIndex(o => o.id === orderId);
        if (index !== -1) {
          ords[index].status = newStatus;
          localStorage.setItem(key, JSON.stringify(ords));
          break;
        }
      }
    }

    console.log(`Order ${orderId} status updated to ${newStatus}`);
  } catch(e) {
    console.error("Error updating status: ", e);
    alert("Failed to update status. Check console.");
  }
}

function renderAdminOrders(orders) {
  const container = document.getElementById('adminQueueContainer');
  if (!container) return;

  const today = getAdminLocalDateKey(new Date());
  orders = orders.filter(order => getAdminOrderDateKey(order) === today);

  const activeCount = orders.filter(o => String(o.status || '').toUpperCase() !== "DELIVERED").length;
  const deliveredCount = orders.filter(o => String(o.status || '').toUpperCase() === "DELIVERED").length;
    
  const mActive = document.getElementById('metricActiveOrders');
  const mDel = document.getElementById('metricDelivered');
  if (mActive) mActive.innerText = activeCount;
  if (mDel) mDel.innerText = deliveredCount;

  if (orders.length === 0) {
    container.innerHTML = `<p class="text-center text-slate-400 py-10">No orders received yet.</p>`;
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
            <span class="font-extrabold text-[#0B132B] text-sm">${o.id}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">${o.status || 'PLACED'}</span>
            <span class="text-[11px] font-black text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">OTP: ${o.delivery_otp || '4821'}</span>
          </div>
          <p class="text-[11px] text-slate-500 font-semibold">🕒 ${formatOrderDateTime(o)}</p>
          <p class="text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 inline-flex gap-1.5">
            <span>Dedicated delivery:</span>
            <span data-admin-delivery-deadline="${getAdminOrderDeadlineMs(o) || ""}" data-order-id="${String(o.id)}">${formatAdminCountdown(o)}</span>
          </p>
          <p class="text-xs text-slate-800 font-bold">${o.delivery_address} • 📞 ${o.customer_phone}</p>
          ${o.order_type === 'PARCEL' ? `<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 inline-block font-bold">📍 Parcel pickup: ${o.parcel_pickup_address || 'Pickup address pending'} → Drop: ${o.parcel_drop_address || o.delivery_address}</p>` : ''}
          ${itemsSummary ? `<p class="text-[11px] text-slate-600 bg-white p-1.5 rounded-xl border border-slate-200 inline-block font-semibold">📦 ${itemsSummary}</p>` : ''}
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

  db.collection("orders").onSnapshot((snapshot) => {
    const orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    orders.sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    const activeOrderIds = new Set(orders
      .filter(order => !["ACCEPTED", "DELIVERED"].includes(String(order.status || "").toUpperCase()))
      .map(order => order.id));
    pendingAdminOrderAlerts = pendingAdminOrderAlerts.filter(order => activeOrderIds.has(order.id));
    const hasNewOrder = adminOrderIdsInitialized && snapshot.docChanges().some(change => change.type === "added");
    allFetchedOrders = orders;
    const today = getAdminLocalDateKey(new Date());
    renderAdminOrders(orders.filter(order => getAdminOrderDateKey(order) === today));
    if (hasNewOrder) {
      snapshot.docChanges()
        .filter(change => change.type === "added")
        .forEach(change => {
          if (!pendingAdminOrderAlerts.some(order => order.id === change.doc.id)) {
            pendingAdminOrderAlerts.push({ id: change.doc.id, ...change.doc.data() });
            adminAlertSoundStopped = false;
          }
        });
      showNextAdminOrderAlert();
    }
    if (!pendingAdminOrderAlerts.length) stopAdminOrderSound();
    showNextAdminOrderAlert();
    adminOrderIdsInitialized = true;
  }, error => {
    console.error("Admin orders listener error:", error);
    container.innerHTML = `<p class="text-center text-rose-500 py-10">Unable to load orders. Check Firestore permissions.</p>`;
  });
}

// --- SALES & REPORTS ENGINE ---
function initSalesDatePicker() {
  const dateInput = document.getElementById('salesFilterDate');
  if (dateInput && !dateInput.value) {
    const todayStr = new Date().toISOString().slice(0, 10);
    dateInput.value = todayStr;
    selectedFilterDate = todayStr;
  }
}

function filterSalesByDate(val) {
  selectedFilterDate = val;
  calculateAndRenderAnalytics();
}

function resetSalesToToday() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById('salesFilterDate');
  if (dateInput) dateInput.value = todayStr;
  selectedFilterDate = todayStr;
  calculateAndRenderAnalytics();
}

function calculateAndRenderAnalytics() {
  const dateLabel = document.getElementById('activeDateLabel');
  if (dateLabel) dateLabel.innerText = selectedFilterDate || "All Time";

  let filtered = allFetchedOrders;

  if (selectedFilterDate) {
    filtered = allFetchedOrders.filter(o => {
      if (o.created_at_ms) {
        const orderDateStr = new Date(o.created_at_ms).toISOString().slice(0, 10);
        return orderDateStr === selectedFilterDate;
      }
      return false;
    });
  }

  let revenue = 0, online = 0, cod = 0;
  const tbody = document.getElementById('settlementTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">No orders found for the selected date (${selectedFilterDate}).</td></tr>`;
  } else {
    filtered.forEach(o => {
      const amt = Number(o.total_amount || o.total || 0);
      revenue += amt;
      if (o.payment_mode === 'COD') cod += amt;
      else online += amt;

      const timeStr = o.created_at_ms ? new Date(o.created_at_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="py-2.5 px-3 font-bold text-slate-900">${o.id}</td>
        <td class="py-2.5 px-3 text-slate-500">${selectedFilterDate} ${timeStr}</td>
        <td class="py-2.5 px-3">${o.customer_phone || 'N/A'}</td>
        <td class="py-2.5 px-3 truncate max-w-[150px]">${o.delivery_address || 'Mandapeta'}</td>
        <td class="py-2.5 px-3 font-black text-slate-900">₹${amt}</td>
        <td class="py-2.5 px-3 font-bold ${o.payment_mode === 'COD' ? 'text-amber-600' : 'text-blue-600'}">${o.payment_mode || 'UPI'}</td>
        <td class="py-2.5 px-3 font-bold text-emerald-600">${o.status || 'PLACED'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  const sRev = document.getElementById('statTodayRevenue');
  const sOn = document.getElementById('statOnlinePaid');
  const sCod = document.getElementById('statCodPaid');
  const sTot = document.getElementById('statTotalOrders');

  if (sRev) sRev.innerText = `₹${revenue}`;
  if (sOn) sOn.innerText = `₹${online}`;
  if (sCod) sCod.innerText = `₹${cod}`;
  if (sTot) sTot.innerText = filtered.length;
}

function exportDailyOrdersCSV() {
  if (allFetchedOrders.length === 0) return alert("No orders to export!");
  const headers = ["Order ID", "Date", "Phone", "Address", "Amount", "Payment Mode", "Status"];
  const rows = allFetchedOrders.map(o => [
    `"${o.id}"`,
    `"${o.created_at_ms ? new Date(o.created_at_ms).toISOString().slice(0, 10) : ''}"`,
    `"${o.customer_phone||''}"`,
    `"${(o.delivery_address||'').replace(/"/g,'""')}"`,
    `"${o.total_amount||o.total}"`,
    `"${o.payment_mode||'UPI'}"`,
    `"${o.status}"`
  ]);
  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", `Mandapeta_Orders_${selectedFilterDate || 'All'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    if (event.target.closest('button, [onclick]')) {
      ADMIN_TAB_SOUND.currentTime = 0;
      ADMIN_TAB_SOUND.play().catch(() => {});
    }
  });
  adminCountdownTimer = setInterval(updateAdminCountdowns, 1000);
  if (sessionStorage.getItem('hub_session_unlocked') === 'true') {
    const lock = document.getElementById('adminAuthLock');
    if (lock) lock.classList.add('hidden');
    switchView('orders');
  }
  startLiveOrderQueue();
  startAdminRiderLocationListeners();
  startRegisteredRiderListener();
  loadAdminRestaurants();
  loadAdminPartnerAccounts();
  toggleAdminPartnerAccountFields();
  toggleRestaurantProductFields();
  loadAdminInventory();
  loadCategoryManager();
  // ==========================================
// 🗺️ LIVE RIDER TRACKING (Admin Side)
// ==========================================

let adminMap = null;
let riderLiveMarker = null;

function openAdminRiderTracker(riderName) {
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

  db.collection("riders_location").doc(riderName).onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      const lat = data.lat;
      const lng = data.lng;

      if (lat && lng) {
        if (riderLiveMarker) {
          riderLiveMarker.setLatLng([lat, lng]);
        } else {
          riderLiveMarker = L.marker([lat, lng], {
            icon: L.divIcon({ 
              className: 'custom-rider-icon', 
              html: '<div style="font-size: 24px;">🛵</div>', 
              iconSize: [30, 30] 
            })
          }).addTo(adminMap).bindPopup(`<b>${riderName}</b> (On the way)`).openPopup();
        }
        adminMap.setView([lat, lng], 16);
      }
    }
  });
}

function closeAdminRiderTracker() {
  const mapModal = document.getElementById('adminMapModal');
  if (mapModal) mapModal.classList.add('hidden');
}

window.openAdminRiderTracker = openAdminRiderTracker;
window.closeAdminRiderTracker = closeAdminRiderTracker;
});