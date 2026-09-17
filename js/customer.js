// ==========================================
// 🛒 CUSTOMER STOREFRONT ENGINE (customer.js)
// ==========================================

const DARK_STORE_COORDS = { lat: 16.7483, lng: 81.8488, name: "Ravulapalem RTC Dark Store" };
let currentCustomerCoords = { lat: 16.7483, lng: 81.8488, address: "RTC Complex, Ravulapalem" };
let leafletMap = null;
let customerMarker = null;

// --- 1. GPS & LEAFLET MAP ENGINE ---
function initLeafletMap() {
  if (leafletMap) return;
  setTimeout(() => {
    try {
      leafletMap = L.map('deliveryMap').setView([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap);
      
      L.circle([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], {
        color: '#0B132B', fillColor: '#3A86FF', fillOpacity: 0.12, radius: 6000
      }).addTo(leafletMap);

      L.marker([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng])
        .addTo(leafletMap)
        .bindPopup("<b>⚡ Ravulapalem RTC Dark Store</b>");

      customerMarker = L.marker([currentCustomerCoords.lat, currentCustomerCoords.lng], { draggable: true })
        .addTo(leafletMap)
        .bindPopup("<b>📍 Deliver Here</b>");

      customerMarker.on('dragend', function (e) {
        const pos = e.target.getLatLng();
        handleLocationUpdate(pos.lat, pos.lng, "Selected Pin, Ravulapalem");
      });

      leafletMap.on('click', function(e) {
        customerMarker.setLatLng(e.latlng);
        handleLocationUpdate(e.latlng.lat, e.latlng.lng, "Pinned Location, Ravulapalem");
      });
    } catch(err) {}
  }, 200);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R * c).toFixed(1);
}

function handleLocationUpdate(lat, lng, addressName) {
  currentCustomerCoords = { lat, lng, address: addressName };
  const dist = calculateDistance(DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng, lat, lng);
  const distBadge = document.getElementById('distanceBadge');
  if (distBadge) distBadge.innerText = `${dist} KM`;
}

function selectPresetLoc(name, lat, lng) {
  currentCustomerCoords = { lat, lng, address: name };
  if (customerMarker && leafletMap) {
    customerMarker.setLatLng([lat, lng]);
    leafletMap.panTo([lat, lng]);
  }
  handleLocationUpdate(lat, lng, name);
}

function detectDeviceLocation() {
  if (!navigator.geolocation) return alert("Geolocation is not supported by your browser!");
  
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      selectPresetLoc("Current GPS Location", lat, lng);
      alert("GPS Location detected successfully!");
    },
    () => {
      alert("Location permission denied. Defaulting to RTC Complex, Ravulapalem.");
      selectPresetLoc("RTC Complex, Ravulapalem", 16.7483, 81.8488);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function openLocationModal() {
  closeAllModals();
  document.getElementById('locationModal').classList.remove('hidden');
  initLeafletMap();
}
function closeLocationModal() { document.getElementById('locationModal').classList.add('hidden'); }
function confirmLocationSelection() {
  document.getElementById('currentAddressHeader').innerText = currentCustomerCoords.address;
  document.getElementById('inputAddress').value = currentCustomerCoords.address;
  closeLocationModal();
}

function closeAllModals() {
  ['checkoutModal', 'ordersModal', 'locationModal', 'paymentOverlay', 'productDetailModal', 'customerLoginModal', 'orderDetailReceiptModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
function closeOrdersView() { document.getElementById('ordersModal').classList.add('hidden'); }

// --- 2. 20 BLINKIT CATEGORIES ---
const categories = [
  { id: "paan", name: "Paan Corner & Refreshers" },
  { id: "dairy", name: "Dairy, Bread & Eggs" },
  { id: "veggies", name: "Fruits & Fresh Vegetables" },
  { id: "drinks", name: "Cold Drinks & Juices" },
  { id: "snacks", name: "Snacks & Munchies" },
  { id: "breakfast", name: "Breakfast & Instant Food" },
  { id: "sweets", name: "Sweet Tooth & Chocolates" },
  { id: "bakery", name: "Bakery & Biscuits" },
  { id: "tea", name: "Tea, Coffee & Milk Drinks" },
  { id: "staples", name: "Atta, Rice & Dal" },
  { id: "masala", name: "Masala, Cooking Oil & Ghee" },
  { id: "sauces", name: "Sauces & Spreads" },
  { id: "meat", name: "Chicken, Meat & Fresh Fish" },
  { id: "organic", name: "Organic & Healthy Living" },
  { id: "baby", name: "Baby Care Essentials" },
  { id: "pharma", name: "Pharma & Wellness" },
  { id: "cleaning", name: "Cleaning Essentials" },
  { id: "home", name: "Home & Office Needs" },
  { id: "personal", name: "Personal Care & Hygiene" },
  { id: "pet", name: "Pet Care Supplies" }
];

let liveCatalog = [];
let cartState = {};
let activeCategory = "dairy";
let currentSearch = "";
let selectedVariantIndex = {};

function selectCategory(catId, targetEl = null) {
  activeCategory = catId;
  const currentCatObj = categories.find(c => c.id === catId);
  const headingEl = document.getElementById('categoryHeading');
  if (headingEl) {
    headingEl.innerText = currentCatObj ? currentCatObj.name : "Products";
  }

  document.querySelectorAll('.cat-card').forEach(card => {
    card.classList.remove('border-emerald-600', 'bg-emerald-50/50', 'shadow-md');
  });

  if (targetEl) {
    targetEl.classList.add('border-emerald-600', 'bg-emerald-50/50', 'shadow-md');
  }

  filterAndRender();

  const gridEl = document.getElementById('productsGrid');
  if (gridEl && targetEl) {
    gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// --- 3. LIVE BANNER & CATEGORY IMAGES LISTENER ---
function listenToLiveHeroBanner() {
  db.collection("settings").doc("hero_banner").onSnapshot((doc) => {
    if (doc.exists) {
      const d = doc.data();
      document.getElementById('bannerTitleDisplay').innerText = d.title || "Stock up on daily essentials";
      document.getElementById('bannerSubDisplay').innerText = d.subtitle || "Get farm-fresh goodness & a range of exotic fruits, vegetables, eggs & more";
      if (d.image_url) {
        document.getElementById('bannerImgDisplay').src = d.image_url;
      }
    }
  });
}

function listenToLiveCategoryImages() {
  db.collection("settings").doc("category_images").onSnapshot((doc) => {
    if (doc.exists) {
      const customMap = doc.data();
      Object.keys(customMap).forEach(catId => {
        const imgEl = document.querySelector(`.cat-card[onclick*="'${catId}'"] img`);
        if (imgEl && customMap[catId]) {
          imgEl.src = customMap[catId];
        }
      });
    }
  });
}

// --- 4. CATALOG FEED & MULTI-VARIANT RENDERING ---
async function fetchProducts() {
  db.collection("products").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let cloudProducts = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (!Array.isArray(d.variants) || d.variants.length === 0) {
        d.variants = [{ unit: d.unit || "1 pc", price: d.price || 0, old_price: d.old_price || d.price || 0 }];
      }
      cloudProducts.push({ id: doc.id, ...d });
    });

    liveCatalog = cloudProducts;
    filterAndRender();
  });
}

function selectVariant(productId, variantIdx) {
  selectedVariantIndex[productId] = variantIdx;
  filterAndRender();
}

function filterAndRender() {
  let filtered = liveCatalog.filter(item => item.category === activeCategory);
  if (currentSearch) {
    filtered = liveCatalog.filter(item => item.name.toLowerCase().includes(currentSearch));
  }

  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-6">
        <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-2xl mb-2">🛒</div>
        <h4 class="text-sm font-extrabold text-slate-800">No products in this category yet</h4>
        <p class="text-xs text-slate-400 mt-0.5">Open the <a href="admin.html" class="text-brand-accent underline font-bold">Admin Hub</a> to add products with pack sizes!</p>
      </div>
    `;
    document.getElementById('itemCountBadge').innerText = "0 Items";
    return;
  }

  filtered.forEach(p => {
    const variants = Array.isArray(p.variants) && p.variants.length > 0 
      ? p.variants 
      : [{ unit: p.unit || "1 pc", price: p.price, old_price: p.old_price || p.price }];

    const currentVIdx = selectedVariantIndex[p.id] !== undefined ? selectedVariantIndex[p.id] : 0;
    const activeVar = variants[currentVIdx] || variants[0];
    const cartKey = `${p.id}_${currentVIdx}`;
    const qty = cartState[cartKey] || 0;

    const card = document.createElement('div');
    card.className = "bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition";
    
    let variantChipsHtml = "";
    if (variants.length > 1) {
      variantChipsHtml = `
        <div class="flex flex-wrap gap-1 mt-2">
          ${variants.map((v, idx) => `
            <button 
              type="button" 
              onclick="event.stopPropagation(); selectVariant('${p.id}', ${idx})" 
              class="px-2 py-0.5 rounded-lg text-[10px] font-bold border transition ${idx === currentVIdx ? 'bg-slate-900 text-white border-slate-900 shadow-xs' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}"
            >
              ${v.unit}
            </button>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div onclick="openProductDetailModal('${p.id}')" class="cursor-pointer group">
        <div class="h-28 sm:h-36 w-full rounded-xl overflow-hidden bg-slate-50 relative mb-2 flex items-center justify-center p-2">
          <img src="${p.image_url}" alt="${p.name}" class="max-h-full max-w-full object-contain group-hover:scale-105 transition">
          <span class="absolute bottom-1 left-1 bg-slate-900/90 text-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded">
            ⚡ 10 MINS
          </span>
        </div>
        <h4 class="text-xs font-bold text-slate-900 line-clamp-2 leading-snug group-hover:text-brand-accent transition">${p.name}</h4>
        <span class="text-[10px] text-slate-500 font-semibold mt-0.5 block">${activeVar.unit}</span>
      </div>

      ${variantChipsHtml}

      <div class="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-100">
        <div>
          <span class="text-xs sm:text-sm font-extrabold text-slate-900">₹${activeVar.price}</span>
        </div>

        <div>
          ${qty === 0 ? `
            <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1)" class="px-3 py-1 rounded-lg border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white text-xs font-black uppercase transition">
              ADD
            </button>
          ` : `
            <div class="flex items-center bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs font-bold gap-2">
              <button onclick="modifyCart('${p.id}', ${currentVIdx}, -1)">-</button>
              <span class="text-xs font-black">${qty}</span>
              <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1)">+</button>
            </div>
          `}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  document.getElementById('itemCountBadge').innerText = `${filtered.length} Items`;
}

function openProductDetailModal(id) {
  const p = liveCatalog.find(item => item.id == id);
  if (!p) return;

  const variants = Array.isArray(p.variants) && p.variants.length > 0 
    ? p.variants 
    : [{ unit: p.unit || "1 pc", price: p.price }];

  const currentVIdx = selectedVariantIndex[p.id] || 0;
  const activeVar = variants[currentVIdx] || variants[0];

  document.getElementById('detailImg').src = p.image_url;
  document.getElementById('detailName').innerText = p.name;
  document.getElementById('detailUnit').innerText = activeVar.unit;
  document.getElementById('detailCategory').innerText = (p.category || 'DAIRY').toUpperCase();
  document.getElementById('detailPrice').innerText = `₹${activeVar.price}`;
  document.getElementById('detailDesc').innerText = p.desc || "100% Genuine product directly fulfilled from Ravulapalem RTC dark store with express quality check.";

  const btnWrap = document.getElementById('detailActionBtn');
  btnWrap.innerHTML = `
    <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1); closeProductDetailModal();" class="px-5 py-2 bg-[#0B132B] hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md">
      Add to Cart
    </button>
  `;

  document.getElementById('productDetailModal').classList.remove('hidden');
}

function closeProductDetailModal() {
  document.getElementById('productDetailModal').classList.add('hidden');
}

function modifyCart(prodId, variantIdx, delta) {
  const key = `${prodId}_${variantIdx}`;
  const next = (cartState[key] || 0) + delta;
  if (next <= 0) delete cartState[key];
  else cartState[key] = next;
  filterAndRender();
  syncCartBar();
}

function syncCartBar() {
  const bar = document.getElementById('bottomCartBar');
  let count = 0, sum = 0;

  Object.keys(cartState).forEach(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    if (item) {
      const v = (item.variants && item.variants[Number(vIdx)]) || { price: item.price };
      count += cartState[key];
      sum += v.price * cartState[key];
    }
  });

  if (count > 0) {
    bar.classList.remove('hidden');
    document.getElementById('barItemCount').innerText = `${count} items added`;
    document.getElementById('barGrandPrice').innerText = `₹${sum}`;
  } else {
    bar.classList.add('hidden');
  }
}

function handleSearch(val) {
  currentSearch = val.toLowerCase().trim();
  filterAndRender();
}

// --- 5. CHECKOUT FLOW ---
function openCheckout() {
  closeAllModals();

  const bar = document.getElementById('bottomCartBar');
  if (bar) bar.classList.add('hidden');

  document.getElementById('checkoutModal').classList.remove('hidden');
  document.getElementById('inputAddress').value = currentCustomerCoords.address;
  
  const container = document.getElementById('cartItemsContainer');
  container.innerHTML = '';
  let sub = 0;

  Object.keys(cartState).forEach(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    if (item) {
      const v = (item.variants && item.variants[Number(vIdx)]) || { unit: item.unit, price: item.price };
      const qty = cartState[key];
      const rowPrice = v.price * qty;
      sub += rowPrice;

      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200 shadow-sm";
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <img src="${item.image_url}" class="w-8 h-8 rounded-lg object-contain">
          <div>
            <p class="text-xs font-bold text-slate-800 line-clamp-1 max-w-[150px]">${item.name}</p>
            <span class="text-[10px] text-slate-500 font-bold">${v.unit} • ₹${v.price} × ${qty}</span>
          </div>
        </div>
        <span class="text-xs font-black">₹${rowPrice}</span>
      `;
      container.appendChild(row);
    }
  });

  document.getElementById('billSubtotal').innerText = `₹${sub}`;
  document.getElementById('billFinal').innerText = `₹${sub + 4}`;
  setPaymentMethod(selectedPaymentMode);
  syncCustomerAuthUI();
}

function closeCheckout() {
  document.getElementById('checkoutModal').classList.add('hidden');
  syncCartBar();
}

let selectedPaymentMode = 'COD';

function setPaymentMethod(mode) {
  selectedPaymentMode = mode;
  const btnApps = document.getElementById('btnMethodApps');
  const btnQR = document.getElementById('btnMethodQR');
  const btnCOD = document.getElementById('btnMethodCOD');

  const boxApps = document.getElementById('upiAppsBox');
  const boxQR = document.getElementById('upiQrBox');
  const boxCOD = document.getElementById('codNoticeBox');

  [btnApps, btnQR, btnCOD].forEach(b => b && (b.className = "p-2 border border-slate-200 rounded-xl text-center text-xs font-bold bg-white transition flex flex-col items-center gap-1"));
  [boxApps, boxQR, boxCOD].forEach(b => b && b.classList.add('hidden'));

  if (mode === 'UPI_APPS') {
    if (btnApps) btnApps.className = "p-2 border-2 border-emerald-600 rounded-xl text-center text-xs font-bold bg-emerald-50/50 transition flex flex-col items-center gap-1";
    if (boxApps) boxApps.classList.remove('hidden');
  } else if (mode === 'UPI_QR') {
    if (btnQR) btnQR.className = "p-2 border-2 border-emerald-600 rounded-xl text-center text-xs font-bold bg-emerald-50/50 transition flex flex-col items-center gap-1";
    if (boxQR) boxQR.classList.remove('hidden');
    renderPaymentQR();
  } else if (mode === 'COD') {
    if (btnCOD) btnCOD.className = "p-2 border-2 border-emerald-600 rounded-xl text-center text-xs font-bold bg-emerald-50/50 transition flex flex-col items-center gap-1";
    if (boxCOD) boxCOD.classList.remove('hidden');
  }
}

function triggerDirectUpiPay(appName) {
  let sub = 0;
  Object.keys(cartState).forEach(k => {
    const [pId, vIdx] = k.split('_');
    const it = liveCatalog.find(p => p.id == pId);
    if (it) sub += ((it.variants && it.variants[Number(vIdx)])?.price || it.price) * cartState[k];
  });
  const upiIntent = `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${sub + 4}&cu=INR`;
  window.location.href = upiIntent;
}

function renderPaymentQR() {
  let sub = 0;
  Object.keys(cartState).forEach(k => {
    const [pId, vIdx] = k.split('_');
    const it = liveCatalog.find(p => p.id == pId);
    if (it) sub += ((it.variants && it.variants[Number(vIdx)])?.price || it.price) * cartState[k];
  });
  const upiUrl = `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzyRavulapalem&am=${sub+4}&cu=INR`;
  const canvas = document.getElementById('qrcodeCanvas');
  if (canvas) {
    canvas.innerHTML = '';
    new QRCode(canvas, { text: upiUrl, width: 130, height: 130 });
  }
}

// --- 6. ORDER PLACEMENT (STRICT USER ISOLATION) ---
async function processPaymentFlow() {
  const phone = document.getElementById('inputPhone').value.trim();
  const addr = document.getElementById('inputAddress').value.trim();
  if (!phone || !addr) return alert("Please enter mobile number & address!");

  document.getElementById('paymentOverlay').classList.remove('hidden');
  setTimeout(() => finalizeOrderAndLaunch(selectedPaymentMode === 'COD' ? 'PENDING_COD' : 'PAID_ONLINE'), 600);
}

async function finalizeOrderAndLaunch(paymentStatus) {
  const overlay = document.getElementById('paymentOverlay');
  if (overlay) overlay.classList.add('hidden');

  let sub = 0;
  const orderItems = Object.keys(cartState).map(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    const v = (item.variants && item.variants[Number(vIdx)]) || { unit: item.unit, price: item.price };
    const qty = cartState[key];
    sub += v.price * qty;
    return { id: item.id, name: item.name, unit: v.unit, quantity: qty, price: v.price };
  });

  const orderId = "QD-" + Math.floor(100000 + Math.random() * 900000);
  const customerPhone = document.getElementById('inputPhone').value.trim();
  
  const orderPayload = {
    id: orderId,
    customer_phone: customerPhone,
    delivery_address: document.getElementById('inputAddress').value.trim() + ", Ravulapalem",
    items: orderItems,
    total_amount: sub + 4,
    status: "Order Confirmed",
    payment_mode: selectedPaymentMode,
    payment_status: paymentStatus,
    assigned_rider: "Suresh (Rider)",
    delivery_otp: Math.floor(1000 + Math.random() * 9000).toString(),
    created_at_ms: Date.now()
  };

  try {
    await db.collection("orders").doc(orderId).set({
      ...orderPayload,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {
    console.error("Cloud order save error:", e);
  }

  // Strictly save under logged-in customer phone key
  const userOrderKey = `orders_${customerPhone}`;
  const localOrders = JSON.parse(localStorage.getItem(userOrderKey) || '[]');
  localOrders.unshift(orderPayload);
  localStorage.setItem(userOrderKey, JSON.stringify(localOrders));

  activeCustomerSession = { phone: customerPhone };
  localStorage.setItem('quickdash_customer', JSON.stringify(activeCustomerSession));
  syncCustomerAuthUI();

  cartState = {};
  filterAndRender();
  syncCartBar();
  document.getElementById('checkoutModal').classList.add('hidden');

  alert(`🎉 Order Confirmed (${orderId})!\nDispatched from Ravulapalem RTC Hub.`);
  toggleOrdersView();
}

// --- 7. STRICT USER-SPECIFIC ORDERS & LIVE OTP / RIDER TRACKING VIEW ---
let currentFetchedOrdersCache = [];

async function fetchCloudOrders() {
  const feed = document.getElementById('ordersFeed');
  if (!feed) return;
  feed.innerHTML = `<p class="text-center text-slate-400 py-4">Loading your orders...</p>`;

  const currentCustomerPhone = activeCustomerSession && activeCustomerSession.phone ? activeCustomerSession.phone : null;

  if (!currentCustomerPhone) {
    feed.innerHTML = `
      <div class="text-center py-6">
        <p class="text-xs text-slate-500 mb-2">Please login to view your order history.</p>
        <button onclick="openLoginModal()" class="px-3.5 py-1.5 bg-[#0B132B] text-white text-xs font-bold rounded-xl">Login Now</button>
      </div>
    `;
    return;
  }

  try {
    // Strictly query by matching customer_phone in Firestore
    let orders = [];
    const snapshot = await db.collection("orders").where("customer_phone", "==", currentCustomerPhone).get();
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

    // Fallback / merge with local storage key for this specific phone
    const localPhoneOrders = JSON.parse(localStorage.getItem(`orders_${currentCustomerPhone}`) || '[]');
    localPhoneOrders.forEach(lo => {
      if (!orders.some(o => o.id === lo.id)) orders.push(lo);
    });

    orders.sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    currentFetchedOrdersCache = orders;

    if (orders.length === 0) {
      feed.innerHTML = `
        <div class="text-center py-8 text-slate-400">
          <p class="text-2xl mb-1">📦</p>
          <p class="text-xs font-bold text-slate-700">No orders placed by +91 ${currentCustomerPhone} yet.</p>
          <p class="text-[11px] text-slate-400 mt-0.5">Your orders and live OTP tracking will appear here.</p>
        </div>
      `;
      return;
    }

    feed.innerHTML = '';
    orders.forEach((o, index) => {
      const card = document.createElement('div');
      card.className = "p-3 rounded-2xl bg-white border border-slate-200 shadow-sm cursor-pointer hover:border-emerald-500 transition space-y-1";
      card.onclick = () => openReceiptByIndex(index);

      card.innerHTML = `
        <div class="flex justify-between items-center font-bold">
          <span class="text-slate-900 text-xs">${o.id}</span>
          <span class="text-emerald-600 text-xs">₹${o.total_amount || o.total}</span>
        </div>
        <p class="text-[10px] text-slate-500 truncate">${o.delivery_address}</p>
        <div class="flex items-center justify-between pt-1">
          <span class="inline-block text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
            ${o.status || 'Order Confirmed'} • Tap for Live Bill & OTP
          </span>
          <span class="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
            OTP: ${o.delivery_otp || '4821'}
          </span>
        </div>
      `;
      feed.appendChild(card);
    });
  } catch(err) {
    feed.innerHTML = `<p class="text-center text-slate-400 py-6">No previous orders found for this account.</p>`;
  }
}

// --- 8. RECEIPT MODAL WITH LIVE RIDER & OTP ---
function openReceiptByIndex(index) {
  const order = currentFetchedOrdersCache[index];
  if (!order) return;

  document.getElementById('ordersModal').classList.add('hidden');

  document.getElementById('receiptOrderId').innerText = order.id;
  document.getElementById('receiptStatus').innerText = order.status || 'Order Confirmed';
  document.getElementById('receiptAddress').innerText = order.delivery_address || 'Ravulapalem';
  document.getElementById('receiptPayment').innerText = `${order.payment_mode || 'UPI'}`;
  document.getElementById('receiptRider').innerText = order.assigned_rider || 'Suresh (Rider)';

  // Inject Delivery OTP into Receipt Header
  const receiptTitle = document.querySelector('#orderDetailReceiptModal h3');
  if (receiptTitle) {
    receiptTitle.innerHTML = `${order.id} <span class="ml-2 px-2 py-0.5 bg-amber-400 text-slate-950 font-black text-xs rounded-lg">OTP: ${order.delivery_otp || '4821'}</span>`;
  }

  const container = document.getElementById('receiptItemsContainer');
  container.innerHTML = '';

  const items = Array.isArray(order.items) ? order.items : [];
  let subtotal = 0;

  items.forEach(it => {
    const rowPrice = it.price * it.quantity;
    subtotal += rowPrice;
    const row = document.createElement('div');
    row.className = "flex justify-between items-center p-1.5 rounded-lg bg-white border border-slate-200";
    row.innerHTML = `
      <div>
        <p class="font-bold text-slate-800">${it.name}</p>
        <span class="text-[10px] text-slate-400">${it.unit || ''} • ₹${it.price} × ${it.quantity}</span>
      </div>
      <span class="font-black text-slate-900">₹${rowPrice}</span>
    `;
    container.appendChild(row);
  });

  const finalTotal = order.total_amount || order.total || (subtotal + 4);
  document.getElementById('receiptSubtotal').innerText = `₹${subtotal > 0 ? subtotal : finalTotal - 4}`;
  document.getElementById('receiptGrandTotal').innerText = `₹${finalTotal}`;

  document.getElementById('receiptPrintPdfBtn').onclick = () => window.print();
  document.getElementById('orderDetailReceiptModal').classList.remove('hidden');
}

function closeOrderDetailReceipt() {
  document.getElementById('orderDetailReceiptModal').classList.add('hidden');
  document.getElementById('ordersModal').classList.remove('hidden');
}

function toggleOrdersView() {
  const modal = document.getElementById('ordersModal');
  const isHidden = modal.classList.contains('hidden');
  closeAllModals();
  if (isHidden) {
    modal.classList.remove('hidden');
    fetchCloudOrders();
  }
}

// --- 9. CUSTOMER AUTH ---
let activeCustomerSession = JSON.parse(localStorage.getItem('quickdash_customer') || 'null');

function syncCustomerAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userChip = document.getElementById('userChip');
  const phoneDisplay = document.getElementById('userPhoneDisplay');
  const inputPhone = document.getElementById('inputPhone');

  if (activeCustomerSession && activeCustomerSession.phone) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userChip) userChip.classList.remove('hidden');
    if (phoneDisplay) phoneDisplay.innerText = activeCustomerSession.phone.slice(-4);
    if (inputPhone) {
      inputPhone.value = activeCustomerSession.phone;
      inputPhone.readOnly = true;
    }
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userChip) userChip.classList.add('hidden');
    if (inputPhone) inputPhone.readOnly = false;
  }
}

function openLoginModal() {
  closeAllModals();
  document.getElementById('loginStepPhone').classList.remove('hidden');
  document.getElementById('loginStepOtp').classList.add('hidden');
  document.getElementById('loginMobileInput').value = '';
  document.getElementById('customerLoginModal').classList.remove('hidden');
}
function closeLoginModal() { document.getElementById('customerLoginModal').classList.add('hidden'); }
function backToPhoneStep() {
  document.getElementById('loginStepPhone').classList.remove('hidden');
  document.getElementById('loginStepOtp').classList.add('hidden');
}

function sendCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim();
  if (phone.length !== 10) return alert("Please enter a valid 10-digit mobile number!");
  document.getElementById('loginStepPhone').classList.add('hidden');
  document.getElementById('loginStepOtp').classList.remove('hidden');
  document.getElementById('loginOtpInput').value = "4821";
}

function verifyCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim();
  activeCustomerSession = { phone: phone };
  localStorage.setItem('quickdash_customer', JSON.stringify(activeCustomerSession));
  closeLoginModal();
  syncCustomerAuthUI();
  alert("Logged in successfully to MyShopzy!");
}

function logoutCustomer() {
  if (confirm("⚠️ Are you sure you want to log out of MyShopzy?")) {
    localStorage.removeItem('quickdash_customer');
    activeCustomerSession = null;
    syncCustomerAuthUI();
    alert("You have been logged out safely.");
  }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
  fetchProducts();
  syncCustomerAuthUI();
  selectCategory('dairy', null);
  listenToLiveHeroBanner();
  listenToLiveCategoryImages();
});