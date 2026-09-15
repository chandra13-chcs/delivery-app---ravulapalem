// ==========================================
// 🛒 CUSTOMER STOREFRONT ENGINE (customer.js)
// ==========================================

// --- GPS & LEAFLET ENGINE ---
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
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => selectPresetLoc("GPS Detected Location", pos.coords.latitude, pos.coords.longitude),
      () => alert("Location permission denied. Please pick a locality!")
    );
  }
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
  ['checkoutModal', 'trackingModal', 'ordersModal', 'locationModal', 'paymentOverlay', 'productDetailModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function closeCheckout() { document.getElementById('checkoutModal').classList.add('hidden'); }
function closeTrackingModal() { document.getElementById('trackingModal').classList.add('hidden'); }
function closeOrdersView() { document.getElementById('ordersModal').classList.add('hidden'); }

// --- CATALOG DATA & FILTERING ---
const categories = [
  { id: "all", name: "All Products", icon: "layout-grid" },
  { id: "snacks", name: "Snacks & Munchies", icon: "cookie" },
  { id: "dairy", name: "Dairy & Milk", icon: "milk" },
  { id: "veggies", name: "Fresh Veggies", icon: "carrot" },
  { id: "staples", name: "Atta, Rice & Oils", icon: "shopping-bag" },
  { id: "instant", name: "Instant Foods", icon: "flame" },
  { id: "personal", name: "Personal Care", icon: "heart" }
];

const fallbackCatalog = [
  { id: "1", name: "Amul Dark Chocolate 125g", unit: "125 g", price: 190, old_price: 200, category: "snacks", image_url: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?auto=format&fit=crop&w=400&q=80" },
  { id: "2", name: "Cadbury 5 Star Bar 33g", unit: "33 g", price: 19, old_price: 20, category: "snacks", image_url: "https://images.unsplash.com/photo-1582293041079-7814c2f12063?auto=format&fit=crop&w=400&q=80" },
  { id: "3", name: "Cadbury Bournville Rich Cocoa", unit: "80 g", price: 132, old_price: 140, category: "snacks", image_url: "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=400&q=80" },
  { id: "4", name: "Cadbury Dairy Milk Fruit & Nut", unit: "36 g", price: 52, old_price: 55, category: "snacks", image_url: "https://images.unsplash.com/photo-1548907040-4baa42d10919?auto=format&fit=crop&w=400&q=80" },
  { id: "5", name: "Lay's India's Magic Masala Chips", unit: "50 g", price: 20, old_price: 20, category: "snacks", image_url: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=400&q=80" },
  { id: "6", name: "Amul Taaza Homogenised Milk", unit: "500 ml", price: 27, old_price: 30, category: "dairy", image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80" },
  { id: "7", name: "Mother Dairy Fresh Paneer Block", unit: "200 g", price: 86, old_price: 95, category: "dairy", image_url: "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=400&q=80" },
  { id: "8", name: "Britannia Daily Fresh Sandwich Bread", unit: "400 g", price: 35, old_price: 40, category: "dairy", image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=400&q=80" },
  { id: "9", name: "Fresh Country Farm Tomatoes", unit: "1 kg", price: 32, old_price: 40, category: "veggies", image_url: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=400&q=80" },
  { id: "10", name: "Fresh Red Onions (Premium)", unit: "1 kg", price: 35, old_price: 45, category: "veggies", image_url: "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?auto=format&fit=crop&w=400&q=80" },
  { id: "11", name: "Freedom Refined Sunflower Oil Pouch", unit: "1 L", price: 118, old_price: 135, category: "staples", image_url: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=400&q=80" },
  { id: "12", name: "Maggi 2-Minute Special Masala Noodles", unit: "70 g", price: 14, old_price: 15, category: "instant", image_url: "https://images.unsplash.com/photo-1612927601601-6638404737ce?auto=format&fit=crop&w=400&q=80" }
];

let liveCatalog = [...fallbackCatalog];
let cartState = {};
let activeCategory = "all";
let currentSearch = "";

async function fetchProducts() {
  db.collection("products").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let cloudProducts = [];
    snapshot.forEach(doc => cloudProducts.push({ id: doc.id, ...doc.data() }));

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

function initCategories() {
  const desktopList = document.getElementById('desktopCategoryList');
  const mobileList = document.getElementById('mobileCategoryList');
  if (!desktopList || !mobileList) return;
  desktopList.innerHTML = '';
  mobileList.innerHTML = '';

  categories.forEach(c => {
    const dBtn = document.createElement('button');
    dBtn.onclick = () => selectCategory(c.id);
    dBtn.className = `w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition ${c.id === activeCategory ? 'bg-brand-navy text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`;
    dBtn.innerHTML = `<i data-lucide="${c.icon}" class="w-4 h-4"></i> ${c.name}`;
    desktopList.appendChild(dBtn);

    const mBtn = document.createElement('button');
    mBtn.onclick = () => selectCategory(c.id);
    mBtn.className = `px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition border ${c.id === activeCategory ? 'bg-brand-navy text-white border-brand-navy' : 'bg-white text-slate-700 border-brand-border'}`;
    mBtn.innerText = c.name;
    mobileList.appendChild(mBtn);
  });
}

function selectCategory(catId) {
  activeCategory = catId;
  initCategories();
  const currentCatObj = categories.find(c => c.id === catId);
  document.getElementById('categoryHeading').innerText = currentCatObj ? currentCatObj.name : "All Products";
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
    const qty = cartState[p.id] || 0;
    const card = document.createElement('div');
    card.className = "bg-white p-3 rounded-2xl border border-brand-border shadow-sm flex flex-col justify-between hover:shadow-md transition";
    card.innerHTML = `
      <div onclick="openProductDetailModal('${p.id}')" class="cursor-pointer">
        <div class="h-32 sm:h-36 w-full rounded-xl overflow-hidden bg-slate-100 relative mb-2.5">
          <img src="${p.image_url}" alt="${p.name}" class="w-full h-full object-cover">
          <span class="absolute bottom-1.5 left-1.5 bg-brand-navy/90 backdrop-blur-sm text-cyan-300 text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1">
            ⚡ 10 MINS
          </span>
        </div>
        <h4 class="text-xs font-bold text-slate-900 line-clamp-2 leading-snug hover:text-brand-accent transition">${p.name}</h4>
        <span class="text-[11px] text-slate-500 font-medium mt-1 block">${p.unit}</span>
      </div>

      <div class="mt-3.5 flex items-center justify-between pt-2.5 border-t border-slate-100">
        <div>
          <span class="text-xs sm:text-sm font-extrabold text-slate-900">₹${p.price}</span>
          ${p.old_price > p.price ? `<span class="text-[10px] text-slate-400 line-through ml-1">₹${p.old_price}</span>` : ''}
        </div>

        <div id="btn-wrap-${p.id}">
          ${qty === 0 ? `
            <button onclick="modifyCart('${p.id}', 1)" class="px-3.5 py-1.5 rounded-lg border-2 border-brand-accent text-brand-accent hover:bg-brand-accent hover:text-white text-xs font-black uppercase transition">
              ADD
            </button>
          ` : `
            <div class="flex items-center bg-brand-navy text-white rounded-lg px-2 py-1 text-xs font-bold gap-2 shadow-sm">
              <button onclick="modifyCart('${p.id}', -1)" class="hover:text-cyan-300 font-extrabold text-sm">-</button>
              <span class="text-xs font-black w-3 text-center">${qty}</span>
              <button onclick="modifyCart('${p.id}', 1)" class="hover:text-cyan-300 font-extrabold text-sm">+</button>
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

// --- PRODUCT DETAIL QUICK VIEW ---
function openProductDetailModal(id) {
  const product = liveCatalog.find(p => p.id == id);
  if (!product) return;

  const qty = cartState[id] || 0;
  document.getElementById('detailImg').src = product.image_url;
  document.getElementById('detailName').innerText = product.name;
  document.getElementById('detailUnit').innerText = product.unit;
  document.getElementById('detailCategory').innerText = (product.category || 'GROCERY').toUpperCase();
  document.getElementById('detailPrice').innerText = `₹${product.price}`;

  const oldPriceEl = document.getElementById('detailOldPrice');
  const discountEl = document.getElementById('detailDiscount');

  if (product.old_price && product.old_price > product.price) {
    oldPriceEl.innerText = `₹${product.old_price}`;
    oldPriceEl.classList.remove('hidden');
    const discount = Math.round(((product.old_price - product.price) / product.old_price) * 100);
    discountEl.innerText = `${discount}% OFF`;
    discountEl.classList.remove('hidden');
  } else {
    oldPriceEl.classList.add('hidden');
    discountEl.classList.add('hidden');
  }

  renderDetailActionBtn(id, qty);
  document.getElementById('productDetailModal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function renderDetailActionBtn(id, qty) {
  const btnWrap = document.getElementById('detailActionBtn');
  if (qty === 0) {
    btnWrap.innerHTML = `
      <button onclick="modifyCart('${id}', 1); renderDetailActionBtn('${id}', 1);" class="px-6 py-2.5 rounded-xl bg-brand-navy hover:bg-slate-900 text-white font-bold text-xs uppercase tracking-wider transition shadow-md">
        Add to Cart
      </button>
    `;
  } else {
    btnWrap.innerHTML = `
      <div class="flex items-center bg-brand-navy text-white rounded-xl px-3 py-1.5 text-xs font-bold gap-3 shadow-md">
        <button onclick="modifyCart('${id}', -1); renderDetailActionBtn('${id}', cartState['${id}'] || 0);" class="hover:text-cyan-300 font-extrabold text-sm">-</button>
        <span class="text-sm font-black w-4 text-center">${qty}</span>
        <button onclick="modifyCart('${id}', 1); renderDetailActionBtn('${id}', cartState['${id}'] || 0);" class="hover:text-cyan-300 font-extrabold text-sm">+</button>
      </div>
    `;
  }
}

function closeProductDetailModal() {
  document.getElementById('productDetailModal').classList.add('hidden');
}

// --- CART LOGIC ---
function modifyCart(id, delta) {
  const current = cartState[id] || 0;
  const next = current + delta;
  if (next <= 0) delete cartState[id];
  else cartState[id] = next;
  filterAndRender();
  syncCartBar();
}

function syncCartBar() {
  const bar = document.getElementById('bottomCartBar');
  let count = 0;
  let sum = 0;

  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) {
      const qty = cartState[id];
      count += qty;
      sum += item.price * qty;
    }
  });

  if (count > 0) {
    bar.classList.remove('hidden');
    document.getElementById('barItemCount').innerText = `${count} item${count > 1 ? 's' : ''} added`;
    document.getElementById('barGrandPrice').innerText = `₹${sum}`;
  } else {
    bar.classList.add('hidden');
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

  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) {
      const qty = cartState[id];
      const rowPrice = item.price * qty;
      sub += rowPrice;

      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-2.5 rounded-xl bg-white border border-brand-border";
      row.innerHTML = `
        <div class="flex items-center gap-2.5">
          <img src="${item.image_url}" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <p class="text-xs font-bold text-slate-800 line-clamp-1 max-w-[170px]">${item.name}</p>
            <span class="text-[10px] text-slate-500">₹${item.price} each</span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center bg-brand-navy text-white rounded-md px-2 py-0.5 text-xs font-bold gap-2">
            <button onclick="modifyCart('${item.id}', -1); openCheckout();">-</button>
            <span>${qty}</span>
            <button onclick="modifyCart('${item.id}', 1); openCheckout();">+</button>
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
    btnQR.className = "p-2.5 rounded-xl border-2 border-brand-accent bg-blue-50/50 text-center transition flex flex-col items-center gap-1";
    boxQR.classList.remove('hidden');
    payLabel.innerText = "Paid via QR? Confirm Order";
    renderPaymentQR();
  } else if (mode === 'UPI_APPS') {
    btnApps.className = "p-2.5 rounded-xl border-2 border-brand-accent bg-blue-50/50 text-center transition flex flex-col items-center gap-1";
    boxApps.classList.remove('hidden');
    payLabel.innerText = "Pay via UPI App & Confirm";
  } else if (mode === 'COD') {
    btnCOD.className = "p-2.5 rounded-xl border-2 border-brand-accent bg-blue-50/50 text-center transition flex flex-col items-center gap-1";
    boxCOD.classList.remove('hidden');
    payLabel.innerText = "Place Order (Pay on Delivery)";
  }
}

function renderPaymentQR() {
  let sub = 0;
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) sub += item.price * cartState[id];
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
  const phone = document.getElementById('inputPhone').value.trim();
  const addr = document.getElementById('inputAddress').value.trim();
  if (!phone || !addr) {
    alert("Please enter mobile number & address in Ravulapalem!");
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

// --- DISPATCH & REALTIME TRACKING ---
let trackingListenerUnsub = null;

async function finalizeOrderAndLaunch(paymentStatus) {
  document.getElementById('paymentOverlay').classList.add('hidden');
  document.getElementById('payStatusAnim').className = "w-16 h-16 mx-auto rounded-full bg-brand-slateBg flex items-center justify-center text-brand-accent";
  document.getElementById('payStatusAnim').innerHTML = `<div class="w-8 h-8 border-4 border-brand-accent border-t-transparent rounded-full animate-spin"></div>`;

  let sub = 0;
  const orderItems = Object.keys(cartState).map(id => {
    const item = liveCatalog.find(p => p.id == id);
    const qty = cartState[id];
    sub += item.price * qty;
    return { id: item.id, name: item.name, quantity: qty, price: item.price };
  });

  const orderId = "QD-" + Math.floor(100000 + Math.random() * 900000);
  const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();

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
      updateTrackingStages(data.status);
      document.getElementById('trackRiderName').innerText = `${data.assigned_rider || 'Suresh'} (Ravulapalem Express)`;
      
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
  document.getElementById('trackRiderName').innerText = `${order.assigned_rider || 'Suresh'} (Ravulapalem Express)`;
  document.getElementById('trackDeliveryOtp').innerText = order.delivery_otp || "4821";
  updateTrackingStages(order.status);
}

function updateTrackingStages(status) {
  const dot1 = document.getElementById('stepDot1');
  const dot2 = document.getElementById('stepDot2');
  const dot3 = document.getElementById('stepDot3');
  const dot4 = document.getElementById('stepDot4');
  const line1 = document.getElementById('stepLine1');
  const line2 = document.getElementById('stepLine2');
  const line3 = document.getElementById('stepLine3');
  const eta = document.getElementById('trackEta');

  if (!dot1) return;

  [dot1, dot2, dot3, dot4].forEach(d => d.className = "w-7 h-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold");
  [line1, line2, line3].forEach(l => l.className = "w-0.5 h-10 bg-slate-200 my-1");

  if (status === "Order Confirmed" || (status && status.includes("Placed"))) {
    dot1.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow-md";
    dot1.innerHTML = "✓";
    eta.innerText = "Estimated Arriving in 9 mins";
  } 
  else if (status === "Packing") {
    dot1.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow-md";
    line1.className = "w-0.5 h-10 bg-emerald-500 my-1";
    dot2.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow-md animate-pulse";
    dot2.innerHTML = "✓";
    eta.innerText = "Packed at Hub! Rider arriving in 6 mins";
  } 
  else if (status === "Out for Delivery") {
    dot1.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold";
    line1.className = "w-0.5 h-10 bg-emerald-500 my-1";
    dot2.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold";
    line2.className = "w-0.5 h-10 bg-emerald-500 my-1";
    dot3.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold animate-bounce";
    dot3.innerHTML = "✓";
    eta.innerText = "Rider Nearby in Ravulapalem! Arriving in 2 mins";
  } 
  else if (status === "Delivered") {
    [dot1, dot2, dot3, dot4].forEach(d => {
      d.className = "w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold";
      d.innerHTML = "✓";
    });
    [line1, line2, line3].forEach(l => l.className = "w-0.5 h-10 bg-emerald-500 my-1");
    eta.innerText = "Order Delivered to Doorstep! Enjoy your items.";
    updateActiveMiniBanner(null);
  }
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
      item.className = "p-3.5 rounded-xl bg-brand-slateBg border border-brand-border space-y-1.5 cursor-pointer hover:border-brand-accent transition";
      const orderDataEscaped = JSON.stringify(o).replace(/"/g, '&quot;');
      item.setAttribute('onclick', `openTrackingScreen(${orderDataEscaped}); listenToLiveOrderUpdates('${o.id}');`);
      item.innerHTML = `
        <div class="flex justify-between items-center font-bold text-slate-900">
          <span class="text-brand-navy font-extrabold">${o.id}</span>
          <span class="text-brand-accent font-extrabold">₹${o.total_amount || o.total}</span>
        </div>
        <p class="text-[11px] text-slate-600">${o.delivery_address}</p>
        <div class="flex justify-between items-center text-[10px] pt-1.5 border-t border-slate-200">
          <span>Rider: <strong>${o.assigned_rider || 'Suresh'}</strong></span>
          ${o.status !== 'Delivered' ? `
            <span class="font-black text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md">
              OTP: ${o.delivery_otp}
            </span>
          ` : `
            <span class="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Delivered</span>
          `}
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

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
  initCategories();
  fetchProducts();

  if (currentActiveLiveOrder && currentActiveLiveOrder.status !== 'Delivered') {
    updateActiveMiniBanner(currentActiveLiveOrder);
    listenToLiveOrderUpdates(currentActiveLiveOrder.id);
  }

  if (window.lucide) lucide.createIcons();
});