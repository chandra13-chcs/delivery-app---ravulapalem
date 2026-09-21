// ==========================================
// 🛡️ ADMIN OPERATIONS HUB ENGINE (admin.js)
// ==========================================

const STORE_TERMINAL_PIN = "748801";
let allFetchedOrders = [];
let selectedFilterDate = ""; // Empty means today
let ADMIN_RIDER_NAMES = [];
const adminRiderLocations = {};
const adminRiderLocationUnsubscribers = [];
let adminOrderIdsInitialized = false;
let adminCountdownTimer = null;
let pendingAdminOrderAlerts = [];
let adminAlertSoundStopped = false;
const ADMIN_ORDER_SOUND = new Audio("assets/audio/admin-rider-order.mpeg");
const ADMIN_TAB_SOUND = new Audio("assets/audio/tab-click.wav");
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
  const nearestRider = getNearestRider(order);
    try {
    const acceptanceUpdate = {
        status: "ACCEPTED",
        accepted_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (nearestRider) acceptanceUpdate.assigned_rider = nearestRider.name;
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
    if (allFetchedOrders.length) renderAdminOrders(allFetchedOrders);
  }, error => console.error(`Rider location listener error (${riderName}):`, error));
  adminRiderLocations[`${riderName}_listener`] = unsubscribe;
  adminRiderLocationUnsubscribers.push(unsubscribe);
}

function startRegisteredRiderListener() {
  db.collection("rider_profiles").onSnapshot(snapshot => {
    const registeredNames = [];
    snapshot.forEach(doc => {
      const name = doc.data()?.name;
      if (name) registeredNames.push(name);
    });
    ADMIN_RIDER_NAMES = [...new Set(registeredNames)];
    ADMIN_RIDER_NAMES.forEach(subscribeToAdminRiderLocation);
    renderAdminRiderStatus();
    if (allFetchedOrders.length) renderAdminOrders(allFetchedOrders);
  }, error => console.error("Registered rider listener error:", error));
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

function getNearestRider(order) {
  const orderLat = Number(order.delivery_latitude);
  const orderLng = Number(order.delivery_longitude);
  const riders = ADMIN_RIDER_NAMES
    .map(name => {
      const location = adminRiderLocations[name]?.available === true ? adminRiderLocations[name] : null;
      if (!location || !Number.isFinite(orderLat) || !Number.isFinite(orderLng)) return null;
      const distance = calculateDistanceKm(orderLat, orderLng, Number(location.lat), Number(location.lng));
      return Number.isFinite(distance) ? { name, distance } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
  return riders[0] || null;
}

function renderRiderAssignment(order) {
  const nearest = getNearestRider(order);
  const selectedRider = order.assigned_rider || "";
  const options = ADMIN_RIDER_NAMES.map(name => {
    const location = adminRiderLocations[name]?.available === true ? adminRiderLocations[name] : null;
    const distance = nearest && nearest.name === name ? ` (${nearest.distance.toFixed(1)} km)` : "";
    const online = location ? "Online" : "GPS offline";
    return `<option value="${name}" ${selectedRider === name ? "selected" : ""}>${name} - ${online}${distance}</option>`;
  }).join("");

  return `
    <div class="flex flex-wrap items-center gap-2 mt-2">
      <select onchange="assignOrderToRider('${order.id}', this.value)" class="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-bold text-slate-700">
        <option value="">Assign rider...</option>
        ${options}
      </select>
      ${nearest && !selectedRider ? `<button onclick="autoAssignOrderToRider('${order.id}')" class="px-2.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg text-[11px] font-black">Use nearest (${nearest.name})</button>` : ""}
      ${selectedRider ? `<button onclick="openAdminRiderTracker('${selectedRider}')" class="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold">Track ${selectedRider}</button>` : ""}
    </div>
  `;
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

async function autoAssignOrderToRider(orderId) {
  const order = allFetchedOrders.find(item => item.id === orderId);
  const nearest = order && getNearestRider(order);
  if (!nearest) {
    alert("No rider GPS location is available yet. Ask a rider to open the Rider Hub and start GPS.");
    return;
  }
  await assignOrderToRider(orderId, nearest.name);
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
  const banSec = document.getElementById('bannersViewSection');

  const btnOrders = document.getElementById('tabBtnOrders');
  const btnAnalytics = document.getElementById('tabBtnAnalytics');
  const btnInv = document.getElementById('tabBtnInventory');
  const btnBan = document.getElementById('tabBtnBanners');

  [ordersSec, analyticsSec, invSec, banSec].forEach(el => el && el.classList.add('hidden'));
  [btnOrders, btnAnalytics, btnInv, btnBan].forEach(b => b && (b.className = "px-3 py-1.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5 transition"));

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
  } else if (tab === 'banners') {
    if (banSec) banSec.classList.remove('hidden');
    if (btnBan) btnBan.className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center gap-1.5 transition shadow";
    loadActiveHeroBanner();
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

function toggleRestaurantProductFields() {
  const category = document.getElementById('pCategory')?.value;
  const source = document.getElementById('pPickupSource')?.value;
  const fields = document.getElementById('restaurantProductFields');
  if (fields) fields.classList.toggle('hidden', category !== 'restaurants' && source !== 'restaurant');
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
          <span class="block text-slate-400 mt-1">${restaurant.address || 'Ravulapalem'}</span>
        </div>
      `).join('') : '<p class="text-xs text-slate-400">No restaurants added yet.</p>';
    }
  }, error => console.error('Restaurant listener error:', error));
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

  if (pickupSource === 'restaurant' && !restaurant) {
    alert('Select a restaurant before adding menu food.');
    return;
  }

  const btn = document.getElementById('saveProdBtn');
  if (btn) { btn.innerText = "Saving to Storefront..."; btn.disabled = true; }

  const newProd = {
    name: name,
    category: category,
    qty_value: qtyValue,
    qty_unit: qtyUnit,
    pickup_source: pickupSource,
    pickup_source_name: restaurant?.name || (pickupSource === 'vegetable_partner' ? 'Local Vegetable Partner' : pickupSource === 'meat_partner' ? 'Fresh Meat Partner' : 'MyShopzy Store'),
    pickup_source_address: restaurant?.address || (pickupSource === 'vegetable_partner' ? 'Assigned vegetable market partner' : pickupSource === 'meat_partner' ? 'Assigned meat partner' : 'Ravulapalem RTC Dark Store'),
    restaurant_id: restaurantId || null,
    restaurant_name: restaurant?.name || null,
    restaurant_address: restaurant?.address || null,
    price: price,
    old_price: old_price,
    image_url: selectedProductBase64,
    desc: document.getElementById('pDesc')?.value.trim() || '100% Genuine product directly fulfilled from Ravulapalem dark store.',
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
  if (btn) btn.innerText = "Publishing...";

  const bannerData = {
    title: document.getElementById('bannerTitleInput').value.trim(),
    subtitle: document.getElementById('bannerSubInput').value.trim(),
    image_url: document.getElementById('bannerImgInput').value.trim(),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("settings").doc("hero_banner").set(bannerData);
    alert("Homepage Banner Updated!");
    if (btn) btn.innerText = "Save & Publish Banner";
  } catch(err) {
    alert("Error: " + err.message);
    if (btn) btn.innerText = "Save & Publish Banner";
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

async function loadCategoryManager() {
  const container = document.getElementById('categoryManagerGrid');
  if (!container) return;

  let customMap = {};
  try {
    const doc = await db.collection("settings").doc("category_images").get();
    if (doc.exists) customMap = doc.data();
  } catch(e) {}

  container.innerHTML = '';
  adminCategoryDefaults.forEach(cat => {
    const activeUrl = customMap[cat.id] || cat.img;
    const card = document.createElement('div');
    card.className = "p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3";
    card.innerHTML = `
      <img id="cat_preview_${cat.id}" src="${activeUrl}" class="w-12 h-12 rounded-xl object-contain bg-white border p-1 shrink-0">
      <div class="flex-1 min-w-0">
        <p class="text-xs font-bold text-slate-800 truncate">${cat.name}</p>
        <div class="mt-1 flex items-center gap-1">
          <input type="file" accept="image/*" onchange="handleCategoryDirectFile(event, '${cat.id}')" class="text-[9px] file:mr-1 file:py-1 file:px-2 file:rounded file:border-0 file:text-[9px] file:bg-[#1C2541] file:text-white border border-slate-200 rounded p-0.5 bg-white cursor-pointer w-full">
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

async function handleCategoryDirectFile(event, catId) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const compressedCatBase64 = await compressImageFile(file, 200, 200, 0.85);
    await db.collection("settings").doc("category_images").set({
      [catId]: compressedCatBase64
    }, { merge: true });

    const prev = document.getElementById(`cat_preview_${catId}`);
    if (prev) prev.src = compressedCatBase64;
    alert("Category photo updated!");
  } catch(err) {
    alert("Error: " + err.message);
  }
}

// --- ORDER STATUS PIPELINE ---
function renderStatusPills(orderId, currentStatus) {
  const statuses = [
    { key: "PLACED", label: "Placed" },
    { key: "ACCEPTED", label: "Accepted" },
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
        <td class="py-2.5 px-3 truncate max-w-[150px]">${o.delivery_address || 'Ravulapalem'}</td>
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
  link.setAttribute("download", `Ravulapalem_Orders_${selectedFilterDate || 'All'}.csv`);
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
  toggleRestaurantProductFields();
  loadAdminInventory();
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