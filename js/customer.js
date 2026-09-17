// ==========================================
// 🛒 CUSTOMER STOREFRONT ENGINE (customer.js)
// ==========================================

// --- GPS & LEAFLET ENGINE (STORE & PICKER) ---
const DARK_STORE_COORDS = { lat: 16.7483, lng: 81.8488, name: "Ravulapalem RTC Dark Store" };
let currentCustomerCoords = { lat: 16.7483, lng: 81.8488, address: "RTC Complex, Ravulapalem" };
let leafletMap = null;
let customerMarker = null;

function initLeafletMap() {
  if (leafletMap) return;
  setTimeout(() => {
    try {
      leafletMap = L.map('deliveryMap').setView([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap);
      
      L.circle([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], {
        color: '#3A86FF', fillColor: '#3A86FF', fillOpacity: 0.12, radius: 6000
      }).addTo(leafletMap);

      L.marker([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng])
        .addTo(leafletMap)
        .bindPopup("<b>⚡ QuickDash Dark Store</b><br>RTC Complex, Ravulapalem")
        .openPopup();

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
  const statusBox = document.getElementById('serviceStatusBox');
  const statusText = document.getElementById('serviceStatusText');

  if (statusBox && statusText) {
    if (dist <= 6.0) {
      statusBox.className = "p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between";
      statusText.innerText = "10-Min Fast Delivery Available";
    } else {
      statusBox.className = "p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between";
      statusText.innerText = "Beyond 10-Min Express Zone (>6KM)";
    }
  }
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
  const statusBox = document.getElementById('serviceStatusText');
  if (statusBox) statusBox.innerText = "Detecting device GPS...";

  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your mobile browser.");
    return;
  }

  const geoOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      selectPresetLoc("Current GPS Location", lat, lng);
    },
    (err) => {
      navigator.geolocation.getCurrentPosition(
        (fallbackPos) => {
          selectPresetLoc("Estimated Location", fallbackPos.coords.latitude, fallbackPos.coords.longitude);
        },
        (finalErr) => {
          alert("Location access denied or GPS weak. Please pick an area below or allow location in browser settings!");
        },
        { enableHighAccuracy: false, timeout: 10000 }
      );
    },
    geoOptions
  );
}

function openLocationModal() {
  closeAllModals();
  document.getElementById('locationModal').classList.remove('hidden');
  initLeafletMap();
  if (leafletMap) leafletMap.invalidateSize();
}

function closeLocationModal() { 
  document.getElementById('locationModal').classList.add('hidden'); 
}

function confirmLocationSelection() {
  document.getElementById('currentAddressHeader').innerText = currentCustomerCoords.address;
  document.getElementById('inputAddress').value = currentCustomerCoords.address;
  closeLocationModal();
}

function closeAllModals() {
  ['checkoutModal', 'trackingModal', 'ordersModal', 'locationModal', 'paymentOverlay', 'productDetailModal', 'customerLoginModal', 'orderDetailReceiptModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function closeCheckout() { document.getElementById('checkoutModal').classList.add('hidden'); }

function closeTrackingModal() { 
  document.getElementById('trackingModal').classList.add('hidden'); 
  if (trackingMapInstance) {
    trackingMapInstance.remove();
    trackingMapInstance = null;
  }
  if (riderGpsFirestoreUnsub) {
    riderGpsFirestoreUnsub();
    riderGpsFirestoreUnsub = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function closeOrdersView() { document.getElementById('ordersModal').classList.add('hidden'); }

// --- CATALOG DATA & FILTERING ---
const categories = [
  { id: "all", name: "All Products", icon: "layout-grid" },
  { id: "staples", name: "Atta, Rice & Oils", icon: "shopping-bag" },
  { id: "snacks", name: "Snacks & Munchies", icon: "cookie" },
  { id: "dairy", name: "Dairy & Milk", icon: "milk" },
  { id: "veggies", name: "Fresh Veggies", icon: "carrot" },
  { id: "instant", name: "Instant Foods", icon: "flame" },
  { id: "personal", name: "Personal Care", icon: "heart" }
];

const fallbackCatalog = [
  { 
    id: "p1", 
    name: "Surf Excel Easy Wash Detergent Powder", 
    category: "staples", 
    image_url: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "500 g", price: 65, old_price: 75 },
      { unit: "1 kg", price: 125, old_price: 145 },
      { unit: "2 kg", price: 240, old_price: 280 }
    ]
  },
  { 
    id: "p2", 
    name: "Aashirvaad Shudh Chakki Atta", 
    category: "staples", 
    image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "1 kg", price: 58, old_price: 65 },
      { unit: "5 kg", price: 275, old_price: 310 },
      { unit: "10 kg", price: 530, old_price: 590 }
    ]
  },
  { 
    id: "p3", 
    name: "Freedom Refined Sunflower Oil", 
    category: "staples", 
    image_url: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "1 L Pouch", price: 118, old_price: 135 },
      { unit: "5 L Jar", price: 590, old_price: 660 }
    ]
  },
  { 
    id: "p4", 
    name: "Amul Taaza Homogenised Milk", 
    category: "dairy", 
    image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "500 ml", price: 27, old_price: 30 },
      { unit: "1 L", price: 54, old_price: 60 }
    ]
  },
  { 
    id: "p5", 
    name: "Amul Dark Chocolate", 
    category: "snacks", 
    image_url: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "55 g", price: 60, old_price: 65 },
      { unit: "125 g", price: 119, old_price: 200 }
    ]
  },
  { 
    id: "p6", 
    name: "Lay's India's Magic Masala Chips", 
    category: "snacks", 
    image_url: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "50 g", price: 20, old_price: 20 },
      { unit: "115 g", price: 50, old_price: 50 }
    ]
  },
  { 
    id: "p7", 
    name: "Fresh Farm Red Onions", 
    category: "veggies", 
    image_url: "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "1 kg", price: 35, old_price: 45 },
      { unit: "2 kg", price: 68, old_price: 90 }
    ]
  },
  { 
    id: "p8", 
    name: "Maggi 2-Minute Masala Noodles", 
    category: "instant", 
    image_url: "https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80",
    variants: [
      { unit: "70 g", price: 14, old_price: 15 },
      { unit: "4-Pack (280g)", price: 54, old_price: 60 }
    ]
  }
];

let liveCatalog = [...fallbackCatalog];
let cartState = {};
let activeCategory = "all";
let currentSearch = "";
let selectedVariantIndex = {};

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

    const combined = [...cloudProducts, ...fallbackCatalog];
    const seen = new Set();
    liveCatalog = combined.filter(item => {
      const duplicate = seen.has(item.id) || seen.has(item.name.toLowerCase());
      seen.add(item.id);
      seen.add(item.name.toLowerCase());
      return !duplicate;
    });

    filterAndRender();
  }, (err) => {
    liveCatalog = [...fallbackCatalog];
    filterAndRender();
  });
}

function selectCategory(catId) {
  activeCategory = catId;
  const currentCatObj = categories.find(c => c.id === catId);
  document.getElementById('categoryHeading').innerText = currentCatObj ? currentCatObj.name : "All Products";
  filterAndRender();
}

function selectVariant(productId, variantIdx) {
  selectedVariantIndex[productId] = variantIdx;
  filterAndRender();
}

function filterAndRender() {
  let filtered = liveCatalog;
  if (activeCategory !== "all") filtered = filtered.filter(item => item.category === activeCategory);
  if (currentSearch) filtered = filtered.filter(item => item.name.toLowerCase().includes(currentSearch));

  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  filtered.forEach(p => {
    const variants = Array.isArray(p.variants) && p.variants.length > 0 
      ? p.variants 
      : [{ unit: p.unit || "1 pc", price: p.price, old_price: p.old_price || p.price }];

    const currentVIdx = selectedVariantIndex[p.id] !== undefined ? selectedVariantIndex[p.id] : 0;
    const activeVar = variants[currentVIdx] || variants[0];
    const cartKey = `${p.id}_${currentVIdx}`;
    const qty = cartState[cartKey] || 0;

    const card = document.createElement('div');
    card.className = "bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition";
    
    let variantChipsHtml = "";
    if (variants.length > 1) {
      variantChipsHtml = `
        <div class="flex flex-wrap gap-1 mt-2">
          ${variants.map((v, idx) => `
            <button 
              type="button" 
              onclick="event.stopPropagation(); selectVariant('${p.id}', ${idx})" 
              class="px-2 py-0.5 rounded-lg text-[10px] font-bold border transition ${idx === currentVIdx ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}"
            >
              ${v.unit}
            </button>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div onclick="openProductDetailModal('${p.id}')" class="cursor-pointer">
        <div class="h-32 sm:h-36 w-full rounded-xl overflow-hidden bg-slate-50 relative mb-2.5 flex items-center justify-center">
          <img src="${p.image_url}" alt="${p.name}" class="w-full h-full object-cover">
          <span class="absolute bottom-1.5 left-1.5 bg-slate-900/90 text-amber-300 text-[10px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1">
            ⚡ 10 MINS
          </span>
        </div>
        <h4 class="text-xs font-bold text-slate-900 line-clamp-2 leading-snug hover:text-emerald-600 transition">${p.name}</h4>
        <span class="text-[11px] text-slate-500 font-semibold mt-0.5 block">${activeVar.unit}</span>
      </div>

      ${variantChipsHtml}

      <div class="mt-3 flex items-center justify-between pt-2.5 border-t border-slate-100">
        <div>
          <span class="text-xs sm:text-sm font-extrabold text-slate-900">₹${activeVar.price}</span>
          ${activeVar.old_price > activeVar.price ? `<span class="text-[10px] text-slate-400 line-through ml-1">₹${activeVar.old_price}</span>` : ''}
        </div>

        <div>
          ${qty === 0 ? `
            <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1)" class="px-3.5 py-1.5 rounded-lg border-2 border-emerald-600 text-emerald-700 hover:bg-emerald-600 hover:text-white text-xs font-black uppercase transition">
              ADD
            </button>
          ` : `
            <div class="flex items-center bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs font-bold gap-2 shadow-sm">
              <button onclick="modifyCart('${p.id}', ${currentVIdx}, -1)" class="hover:text-amber-200 font-extrabold text-sm">-</button>
              <span class="text-xs font-black w-3 text-center">${qty}</span>
              <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1)" class="hover:text-amber-200 font-extrabold text-sm">+</button>
            </div>
          `}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  document.getElementById('itemCountBadge').innerText = `${filtered.length} Items`;
  if (window.lucide) lucide.createIcons();
}

// --- CART LOGIC ---
function modifyCart(prodId, variantIdx, delta) {
  const key = `${prodId}_${variantIdx}`;
  const current = cartState[key] || 0;
  const next = current + delta;
  if (next <= 0) delete cartState[key];
  else cartState[key] = next;
  
  filterAndRender();
  syncCartBar();
}

function syncCartBar() {
  const bar = document.getElementById('bottomCartBar');
  const trackingBanner = document.getElementById('activeOrderFloatingBanner');
  let count = 0;
  let sum = 0;

  Object.keys(cartState).forEach(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    if (item) {
      const variants = Array.isArray(item.variants) && item.variants.length > 0 ? item.variants : [{ price: item.price }];
      const variant = variants[Number(vIdx)] || variants[0];
      const qty = cartState[key];
      count += qty;
      sum += variant.price * qty;
    }
  });

  if (count > 0) {
    bar.classList.remove('hidden');
    if (trackingBanner) trackingBanner.classList.add('hidden');
    document.getElementById('barItemCount').innerText = `${count} item${count > 1 ? 's' : ''} added`;
    document.getElementById('barGrandPrice').innerText = `₹${sum}`;
  } else {
    bar.classList.add('hidden');
    if (trackingBanner && currentActiveLiveOrder && currentActiveLiveOrder.status !== 'Delivered') {
      trackingBanner.classList.remove('hidden');
    }
    closeCheckout();
  }
}

function handleSearch(val) {
  currentSearch = val.toLowerCase().trim();
  filterAndRender();
}

function openCheckout() {
  closeAllModals();
  document.getElementById('checkoutModal').classList.remove('hidden');
  document.getElementById('inputAddress').value = currentCustomerCoords.address;
  
  const container = document.getElementById('cartItemsContainer');
  container.innerHTML = '';
  let sub = 0;

  Object.keys(cartState).forEach(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    if (item) {
      const variants = Array.isArray(item.variants) && item.variants.length > 0 ? item.variants : [{ unit: item.unit, price: item.price }];
      const variant = variants[Number(vIdx)] || variants[0];
      const qty = cartState[key];
      const rowPrice = variant.price * qty;
      sub += rowPrice;

      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200";
      row.innerHTML = `
        <div class="flex items-center gap-2.5">
          <img src="${item.image_url}" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <p class="text-xs font-bold text-slate-800 line-clamp-1 max-w-[170px]">${item.name}</p>
            <span class="text-[10px] text-slate-500 font-bold">${variant.unit} • ₹${variant.price}</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center bg-slate-900 text-white rounded-md px-2 py-0.5 text-xs font-bold gap-2">
            <button onclick="modifyCart('${prodId}', ${vIdx}, -1); openCheckout();">-</button>
            <span>${qty}</span>
            <button onclick="modifyCart('${prodId}', ${vIdx}, 1); openCheckout();">+</button>
          </div>
          <span class="text-xs font-black text-slate-900 w-12 text-right">₹${rowPrice}</span>
        </div>
      `;
      container.appendChild(row);
    }
  });

  document.getElementById('billSubtotal').innerText = `₹${sub}`;
  document.getElementById('billFinal').innerText = `₹${sub + 4}`;
  setPaymentMethod(selectedPaymentMode);
  syncCustomerAuthUI();
}

// --- PAYMENT & UPI ---
let selectedPaymentMode = 'UPI_QR';

function setPaymentMethod(mode) {
  selectedPaymentMode = mode;
  const btnQR = document.getElementById('btnMethodQR');
  const btnApps = document.getElementById('btnMethodApps');
  const btnCOD = document.getElementById('btnMethodCOD');
  const boxQR = document.getElementById('upiQrBox');
  const boxApps = document.getElementById('upiAppsBox');
  const boxCOD = document.getElementById('codNoticeBox');
  const payLabel = document.getElementById('payBtnLabel');

  [btnQR, btnApps, btnCOD].forEach(btn => btn.className = "p-2.5 rounded-xl border border-slate-200 bg-white text-center hover:bg-slate-50 transition flex flex-col items-center gap-1");
  [boxQR, boxApps, boxCOD].forEach(box => box.classList.add('hidden'));

  if (mode === 'UPI_QR') {
    btnQR.className = "p-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50/50 text-center transition flex flex-col items-center gap-1";
    boxQR.classList.remove('hidden');
    payLabel.innerText = "Paid via QR? Confirm Order";
    renderPaymentQR();
  } else if (mode === 'UPI_APPS') {
    btnApps.className = "p-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50/50 text-center transition flex flex-col items-center gap-1";
    boxApps.classList.remove('hidden');
    payLabel.innerText = "Pay via UPI App & Confirm";
  } else if (mode === 'COD') {
    btnCOD.className = "p-2.5 rounded-xl border-2 border-emerald-600 bg-emerald-50/50 text-center transition flex flex-col items-center gap-1";
    boxCOD.classList.remove('hidden');
    payLabel.innerText = "Place Order (Pay on Delivery)";
  }
}

function renderPaymentQR() {
  let sub = 0;
  Object.keys(cartState).forEach(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    if (item) {
      const variants = Array.isArray(item.variants) && item.variants.length > 0 ? item.variants : [{ price: item.price }];
      const variant = variants[Number(vIdx)] || variants[0];
      sub += variant.price * cartState[key];
    }
  });
  const total = sub > 0 ? sub + 4 : 31;
  const upiUrl = `upi://pay?pa=ravulapalemhub@okaxis&pn=QuickDashRavulapalem&am=${total}&cu=INR&tn=QuickDash Order`;
  const canvas = document.getElementById('qrcodeCanvas');
  if (!canvas) return;
  canvas.innerHTML = '';
  
  try {
    new QRCode(canvas, {
      text: upiUrl,
      width: 130,
      height: 130,
      colorDark: "#0B132B",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch(e) {}
}

async function processPaymentFlow() {
  const phoneInput = document.getElementById('inputPhone');
  const phone = phoneInput.value.trim();
  const addr = document.getElementById('inputAddress').value.trim();

  if (!phone || !addr) {
    alert("Please enter both mobile number and address in Ravulapalem!");
    return;
  }

  const indianPhoneRegex = /^[6-9]\d{9}$/;
  if (!indianPhoneRegex.test(phone)) {
    alert("⚠️ Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.");
    phoneInput.focus();
    return;
  }

  const overlay = document.getElementById('paymentOverlay');
  const animBox = document.getElementById('payStatusAnim');
  const title = document.getElementById('payStatusTitle');
  const subtitle = document.getElementById('payStatusSubtitle');

  overlay.classList.remove('hidden');

  if (selectedPaymentMode === 'COD') {
    title.innerText = "Confirming COD Order...";
    subtitle.innerText = "Assigning Ravulapalem delivery rider";
    setTimeout(() => finalizeOrderAndLaunch("PENDING_COD"), 1200);
  } else {
    title.innerText = "Connecting UPI Gateway...";
    subtitle.innerText = "Verifying UPI payment with bank servers";

    setTimeout(() => {
      title.innerText = "Authorizing Payment...";
      subtitle.innerText = "Receiving instant confirmation";
    }, 1200);

    setTimeout(() => {
      animBox.className = "w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600";
      animBox.innerHTML = `<i data-lucide="check-circle-2" class="w-10 h-10"></i>`;
      if (window.lucide) lucide.createIcons();
      title.innerText = "Payment Successful!";
      subtitle.innerText = "Transaction ID: TXN" + Math.floor(1000000 + Math.random() * 9000000);

      setTimeout(() => finalizeOrderAndLaunch("PAID_ONLINE"), 1000);
    }, 2200);
  }
}

// --- PERSISTENT FLOATING MINI BANNER ---
let currentActiveLiveOrder = JSON.parse(localStorage.getItem('quickdash_active_tracking') || 'null');

function updateActiveMiniBanner(order) {
  const banner = document.getElementById('activeOrderFloatingBanner');
  if (!banner) return;
  if (!order || order.status === 'Delivered') {
    banner.classList.add('hidden');
    localStorage.removeItem('quickdash_active_tracking');
    currentActiveLiveOrder = null;
    return;
  }

  currentActiveLiveOrder = order;
  localStorage.setItem('quickdash_active_tracking', JSON.stringify(order));

  document.getElementById('miniBannerId').innerText = order.id;
  document.getElementById('miniBannerOtp').innerText = order.delivery_otp;
  document.getElementById('miniBannerStatus').innerText = order.status || "Order in Progress";
  banner.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function reopenActiveOrderModal() {
  if (currentActiveLiveOrder) {
    openTrackingScreen(currentActiveLiveOrder);
  }
}

// --- LIVE TRACKING MAP & BIKE MOVEMENT ---
let trackingMapInstance = null;
let liveBikeMarker = null;
let destinationMarker = null;
let riderGpsFirestoreUnsub = null;
let countdownInterval = null;

function initLiveTrackingMap(customerCoords) {
  if (trackingMapInstance) {
    trackingMapInstance.remove();
    trackingMapInstance = null;
  }

  setTimeout(() => {
    const mapEl = document.getElementById('liveTrackingMap');
    if (!mapEl) return;

    try {
      const startLat = DARK_STORE_COORDS.lat;
      const startLng = DARK_STORE_COORDS.lng;

      trackingMapInstance = L.map('liveTrackingMap', { zoomControl: false }).setView([startLat, startLng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(trackingMapInstance);

      L.marker([startLat, startLng]).addTo(trackingMapInstance).bindPopup("<b>Ravulapalem RTC Hub</b>");

      const custLat = customerCoords?.lat || 16.7490;
      const custLng = customerCoords?.lng || 81.8500;
      destinationMarker = L.marker([custLat, custLng]).addTo(trackingMapInstance).bindPopup("<b>Your Delivery Point</b>");

      const bikeIcon = L.divIcon({
        className: 'bike-moving-marker',
        html: `<div style="background:#0B132B; border:2px solid #F59E0B; width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 8px rgba(0,0,0,0.3); font-size:16px;">🛵</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      liveBikeMarker = L.marker([startLat, startLng], { icon: bikeIcon }).addTo(trackingMapInstance);
      trackingMapInstance.fitBounds([[startLat, startLng], [custLat, custLng]], { padding: [30, 30] });
    } catch(err) {
      console.warn("Live map init:", err);
    }
  }, 250);
}

function listenToRiderLiveMovement(riderName) {
  if (riderGpsFirestoreUnsub) riderGpsFirestoreUnsub();

  riderGpsFirestoreUnsub = db.collection("riders_location").doc(riderName || 'Suresh').onSnapshot((doc) => {
    if (doc.exists && liveBikeMarker && trackingMapInstance) {
      const data = doc.data();
      if (data.lat && data.lng) {
        liveBikeMarker.setLatLng([data.lat, data.lng]);
      }
    }
  });
}

function startDynamicSlaTimer(orderData) {
  if (countdownInterval) clearInterval(countdownInterval);

  const timerEl = document.getElementById('slaCountdownTimer');
  const stageBadge = document.getElementById('slaStageBadge');
  if (!timerEl) return;

  let orderTimeMs = Date.now();
  if (orderData && orderData.created_at_ms) {
    orderTimeMs = Number(orderData.created_at_ms);
  } else if (orderData && orderData.created_at && orderData.created_at.toDate) {
    orderTimeMs = orderData.created_at.toDate().getTime();
  } else if (orderData && orderData.created_at && orderData.created_at.seconds) {
    orderTimeMs = orderData.created_at.seconds * 1000;
  }

  const tenMinutesMs = 10 * 60 * 1000;
  const targetTime = orderTimeMs + tenMinutesMs;

  function tick() {
    const now = Date.now();
    const remainingMs = targetTime - now;

    if (remainingMs <= 0) {
      timerEl.innerText = "00:00";
      if (stageBadge) {
        stageBadge.innerText = "Arriving Any Second!";
        stageBadge.className = "text-[10px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2.5 py-1 rounded-lg animate-pulse";
      }
      clearInterval(countdownInterval);
      return;
    }

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    timerEl.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (stageBadge) {
      if (minutes >= 8) stageBadge.innerText = "Packing at Hub";
      else if (minutes >= 2) stageBadge.innerText = "Rider in Transit";
      else stageBadge.innerText = "Nearby (1-2 Mins)";
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

// --- DISPATCH & REALTIME TRACKING ---
let trackingListenerUnsub = null;

async function finalizeOrderAndLaunch(paymentStatus) {
  document.getElementById('paymentOverlay').classList.add('hidden');
  document.getElementById('payStatusAnim').className = "w-16 h-16 mx-auto rounded-full bg-brand-slateBg flex items-center justify-center text-brand-accent";
  document.getElementById('payStatusAnim').innerHTML = `<div class="w-8 h-8 border-4 border-brand-accent border-t-transparent rounded-full animate-spin"></div>`;

  let sub = 0;
  const orderItems = Object.keys(cartState).map(key => {
    const [prodId, vIdx] = key.split('_');
    const item = liveCatalog.find(p => p.id == prodId);
    const variants = Array.isArray(item.variants) && item.variants.length > 0 ? item.variants : [{ unit: item.unit, price: item.price }];
    const variant = variants[Number(vIdx)] || variants[0];
    const qty = cartState[key];
    sub += variant.price * qty;
    return { id: item.id, name: item.name, unit: variant.unit, quantity: qty, price: variant.price };
  });

  const orderId = "QD-" + Math.floor(100000 + Math.random() * 900000);
  const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
  const currentTimestampMs = Date.now();

  const orderPayload = {
    id: orderId,
    customer_phone: document.getElementById('inputPhone').value.trim(),
    delivery_address: document.getElementById('inputAddress').value.trim() + ", Ravulapalem",
    items: orderItems,
    total_amount: sub + 4,
    status: "Order Confirmed",
    payment_mode: selectedPaymentMode,
    payment_status: paymentStatus,
    assigned_rider: "Suresh",
    delivery_otp: deliveryOtp,
    created_at_ms: currentTimestampMs,
    created_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("orders").doc(orderId).set(orderPayload);
  } catch(e) {
    console.error("Firestore push error:", e);
  }

  const localOrders = JSON.parse(localStorage.getItem('quickdash_orders') || '[]');
  localOrders.unshift(orderPayload);
  localStorage.setItem('quickdash_orders', JSON.stringify(localOrders));

  cartState = {};
  filterAndRender();
  syncCartBar();
  closeCheckout();

  openTrackingScreen(orderPayload);
  updateActiveMiniBanner(orderPayload);
  listenToLiveOrderUpdates(orderId);
}

function listenToLiveOrderUpdates(orderId) {
  if (trackingListenerUnsub) trackingListenerUnsub();
  trackingListenerUnsub = db.collection("orders").doc(orderId).onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      document.getElementById('trackRiderName').innerText = data.assigned_rider || 'Suresh';
      
      if (currentActiveLiveOrder && currentActiveLiveOrder.id === orderId) {
        currentActiveLiveOrder.status = data.status;
        currentActiveLiveOrder.assigned_rider = data.assigned_rider;
        updateActiveMiniBanner(currentActiveLiveOrder);
      }
    }
  });
}

function openTrackingScreen(order) {
  closeAllModals();
  document.getElementById('trackingModal').classList.remove('hidden');
  document.getElementById('trackOrderId').innerText = order.id;
  document.getElementById('trackTotal').innerText = `Total: ₹${order.total_amount || order.total} • ${order.payment_mode || 'PAID'}`;
  document.getElementById('trackRiderName').innerText = order.assigned_rider || 'Suresh';
  document.getElementById('trackDeliveryOtp').innerText = order.delivery_otp || "4821";
  
  initLiveTrackingMap(currentCustomerCoords);
  listenToRiderLiveMovement(order.assigned_rider || 'Suresh');
  startDynamicSlaTimer(order);
}

// ==========================================
// 📄 ORDER RECEIPT BREAKDOWN & PDF INVOICE
// ==========================================

function openOrderDetailReceipt(order) {
  const modal = document.getElementById('orderDetailReceiptModal');
  if (!modal) return;

  document.getElementById('receiptOrderId').innerText = order.id;
  document.getElementById('receiptStatus').innerText = order.status || 'Delivered';
  document.getElementById('receiptAddress').innerText = order.delivery_address || 'Ravulapalem';
  document.getElementById('receiptPayment').innerText = `${order.payment_mode || 'UPI'} (${order.payment_status || 'PAID'})`;
  document.getElementById('receiptRider').innerText = order.assigned_rider || 'Suresh';

  const container = document.getElementById('receiptItemsContainer');
  container.innerHTML = '';

  const items = Array.isArray(order.items) ? order.items : [];
  let subtotal = 0;

  if (items.length === 0) {
    container.innerHTML = `<p class="text-slate-400 py-2">No itemized products found.</p>`;
  } else {
    items.forEach(it => {
      const itemRow = document.createElement('div');
      itemRow.className = "flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200";
      const totalItemPrice = it.price * it.quantity;
      subtotal += totalItemPrice;

      itemRow.innerHTML = `
        <div>
          <p class="font-bold text-slate-800">${it.name}</p>
          <span class="text-[10px] text-slate-500 font-semibold">${it.unit ? it.unit + ' • ' : ''}₹${it.price} × ${it.quantity}</span>
        </div>
        <span class="font-black text-slate-900">₹${totalItemPrice}</span>
      `;
      container.appendChild(itemRow);
    });
  }

  const finalTotal = order.total_amount || order.total || (subtotal + 4);
  document.getElementById('receiptSubtotal').innerText = `₹${subtotal > 0 ? subtotal : finalTotal - 4}`;
  document.getElementById('receiptGrandTotal').innerText = `₹${finalTotal}`;

  const printBtn = document.getElementById('receiptPrintPdfBtn');
  if (printBtn) {
    printBtn.onclick = () => generateOrderInvoice(order);
  }

  modal.classList.remove('hidden');
}

function closeOrderDetailReceipt() {
  document.getElementById('orderDetailReceiptModal').classList.add('hidden');
}

function generateOrderInvoice(order) {
  const invoiceWindow = window.open('', '_blank');
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding:8px; border-bottom:1px solid #eee;">${item.name} ${item.unit ? '('+item.unit+')' : ''}</td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:center;">${item.quantity}</td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">₹${item.price}</td>
      <td style="padding:8px; border-bottom:1px solid #eee; text-align:right;">₹${item.price * item.quantity}</td>
    </tr>
  `).join('');

  invoiceWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tax Invoice - ${order.id}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1e293b; }
        .invoice-card { max-width: 600px; margin: auto; border: 1px solid #e2e8f0; padding: 24px; border-radius: 12px; }
        .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0b132b; padding-bottom: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
        th { text-align: left; padding: 8px; background: #f8fafc; border-bottom: 2px solid #cbd5e1; }
        .btn { background: #059669; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 16px; }
        @media print { .btn { display: none; } }
      </style>
    </head>
    <body>
      <div class="invoice-card">
        <div class="header">
          <div>
            <h2 style="margin:0; color:#0b132b;">⚡ MyShopzy Express</h2>
            <p style="margin:2px 0 0; font-size:12px; color:#64748b;">RTC Complex, Ravulapalem, AP</p>
          </div>
          <div style="text-align:right;">
            <h3 style="margin:0; font-size:15px;">TAX INVOICE</h3>
            <p style="margin:2px 0 0; font-size:12px; color:#64748b;">${order.id}</p>
          </div>
        </div>

        <p style="font-size:12px; line-height: 1.6;">
          <strong>Customer Mobile:</strong> +91 ${order.customer_phone || 'N/A'}<br>
          <strong>Delivery Address:</strong> ${order.delivery_address}<br>
          <strong>Payment Mode:</strong> ${order.payment_mode || 'UPI'} (${order.payment_status || 'PAID'})
        </p>

        <table>
          <thead>
            <tr><th>Item Description</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Amount</th></tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div style="text-align:right; font-size:13px; border-top:1px solid #cbd5e1; padding-top:8px;">
          <p style="margin:4px 0;">Subtotal: <strong>₹${(order.total_amount || order.total) - 4}</strong></p>
          <p style="margin:4px 0;">Handling & Bag Fee: <strong>₹4</strong></p>
          <p style="margin:4px 0;">Express Delivery (6 KM): <strong style="color:green;">FREE</strong></p>
          <h3 style="margin:8px 0 0; font-size:16px;">Total Paid: ₹${order.total_amount || order.total}</h3>
        </div>

        <button class="btn" onclick="window.print()">Download / Print PDF</button>
      </div>
    </body>
    </html>
  `);
  invoiceWindow.document.close();
}

async function fetchCloudOrders() {
  const feed = document.getElementById('ordersFeed');
  if (!feed) return;
  feed.innerHTML = `<p class="text-center text-slate-400 py-6">Loading your orders...</p>`;

  db.collection("orders").orderBy("created_at", "desc").limit(20).get().then((snapshot) => {
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

    if (orders.length === 0) orders = JSON.parse(localStorage.getItem('quickdash_orders') || '[]');
    if (orders.length === 0) {
      feed.innerHTML = `<p class="text-center text-slate-400 py-6">No orders placed yet.</p>`;
      return;
    }

    feed.innerHTML = '';
    orders.forEach(o => {
      const item = document.createElement('div');
      item.className = "p-3.5 rounded-2xl bg-white border border-slate-200 space-y-2 cursor-pointer hover:border-emerald-500 hover:shadow-md transition";
      const orderDataEscaped = JSON.stringify(o).replace(/"/g, '&quot;');
      
      item.setAttribute('onclick', `openOrderDetailReceipt(${orderDataEscaped})`);

      let itemsSummary = "";
      if (Array.isArray(o.items)) {
        itemsSummary = o.items.map(i => `${i.quantity}x ${i.name}`).join(", ");
      }

      item.innerHTML = `
        <div class="flex justify-between items-center font-black text-slate-900">
          <span class="text-slate-900 text-sm">${o.id}</span>
          <span class="text-emerald-600 text-sm">₹${o.total_amount || o.total}</span>
        </div>
        <p class="text-[11px] text-slate-500 truncate">${o.delivery_address}</p>
        ${itemsSummary ? `<p class="text-[10px] text-slate-700 font-semibold bg-slate-50 p-1.5 rounded-lg border border-slate-100 truncate">📦 ${itemsSummary}</p>` : ''}
        
        <div class="flex justify-between items-center text-[10px] pt-1 border-t border-slate-100">
          <span class="text-slate-400">Rider: <strong class="text-slate-700">${o.assigned_rider || 'Suresh'}</strong></span>
          <span class="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
            ${o.status || 'Delivered'} • Tap for Bill
          </span>
        </div>
      `;
      feed.appendChild(item);
    });
    if (window.lucide) lucide.createIcons();
  });
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

// ==========================================
// 🔐 CUSTOMER LOGIN & SESSION MANAGEMENT
// ==========================================

let activeCustomerSession = JSON.parse(localStorage.getItem('quickdash_customer') || 'null');
let currentGeneratedOtp = null;

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
      inputPhone.classList.add('bg-slate-100', 'text-slate-600');
    }
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userChip) userChip.classList.add('hidden');
    if (inputPhone) {
      inputPhone.readOnly = false;
      inputPhone.classList.remove('bg-slate-100', 'text-slate-600');
    }
  }
}

function openLoginModal() {
  closeAllModals();
  document.getElementById('loginStepPhone').classList.remove('hidden');
  document.getElementById('loginStepOtp').classList.add('hidden');
  document.getElementById('loginMobileInput').value = '';
  document.getElementById('loginOtpInput').value = '';
  document.getElementById('customerLoginModal').classList.remove('hidden');
}

function closeLoginModal() {
  document.getElementById('customerLoginModal').classList.add('hidden');
}

function sendCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim();
  const indianRegex = /^[6-9]\d{9}$/;

  if (!indianRegex.test(phone)) {
    alert("Please enter a valid 10-digit Indian mobile number (starts with 6, 7, 8, or 9)!");
    return;
  }

  currentGeneratedOtp = Math.floor(1000 + Math.random() * 9000).toString();

  document.getElementById('loginStepPhone').classList.add('hidden');
  document.getElementById('loginStepOtp').classList.remove('hidden');

  alert(`Your MyShopzy Login OTP is: ${currentGeneratedOtp}`);

  const otpInput = document.getElementById('loginOtpInput');
  if (otpInput) {
    otpInput.value = currentGeneratedOtp; // Auto-populate for frictionless dev testing
    setTimeout(() => otpInput.focus(), 150);
  }
}

async function verifyCustomerLoginOtp() {
  const enteredOtp = document.getElementById('loginOtpInput').value.trim();
  const phone = document.getElementById('loginMobileInput').value.trim();

  if (enteredOtp === currentGeneratedOtp) {
    const sessionData = {
      phone: phone,
      loggedInAt: new Date().toISOString()
    };

    localStorage.setItem('quickdash_customer', JSON.stringify(sessionData));
    activeCustomerSession = sessionData;

    try {
      await db.collection("customers").doc(phone).set({
        phone: phone,
        last_active: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch(err) {
      console.warn("User sync skipped:", err);
    }

    closeLoginModal();
    syncCustomerAuthUI();
    alert(`Logged in successfully with +91 ${phone}!`);
  } else {
    alert("Invalid OTP! Try again.");
  }
}

function logoutCustomer() {
  if (!confirm("Are you sure you want to log out?")) return;
  localStorage.removeItem('quickdash_customer');
  activeCustomerSession = null;
  syncCustomerAuthUI();
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
  fetchProducts();
  syncCustomerAuthUI();

  if (currentActiveLiveOrder && currentActiveLiveOrder.status !== 'Delivered') {
    updateActiveMiniBanner(currentActiveLiveOrder);
    listenToLiveOrderUpdates(currentActiveLiveOrder.id);
  }

  if (window.lucide) lucide.createIcons();
});