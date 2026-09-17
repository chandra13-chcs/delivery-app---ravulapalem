// ==========================================
// 🛒 CUSTOMER STOREFRONT ENGINE (customer.js)
// ==========================================

const DARK_STORE_COORDS = { lat: 16.7483, lng: 81.8488, name: "Ravulapalem RTC Dark Store" };
let currentCustomerCoords = { lat: 16.7483, lng: 81.8488, address: "RTC Complex, Ravulapalem" };
let leafletMap = null;
let customerMarker = null;

// --- 1. BUSINESS WORKING HOURS (7 AM - 10 PM IST) ---
function checkStoreWorkingHours() {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const hours = istDate.getHours();
  
  const isClosed = hours < 7 || hours >= 22;
  const banner = document.getElementById('storeStatusBanner');
  if (banner) {
    if (isClosed) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  }
  return !isClosed;
}

// --- 2. GPS & LEAFLET MAP ENGINE ---
function initLeafletMap() {
  if (leafletMap) return;
  setTimeout(() => {
    try {
      leafletMap = L.map('deliveryMap').setView([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(leafletMap);
      
      L.circle([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], { color: '#0B132B', fillColor: '#3A86FF', fillOpacity: 0.12, radius: 6000 }).addTo(leafletMap);
      L.marker([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng]).addTo(leafletMap).bindPopup("<b>⚡ Ravulapalem RTC Dark Store</b>");

      customerMarker = L.marker([currentCustomerCoords.lat, currentCustomerCoords.lng], { draggable: true }).addTo(leafletMap).bindPopup("<b>📍 Deliver Here</b>");
      customerMarker.on('dragend', function (e) {
        const pos = e.target.getLatLng();
        handleLocationUpdate(pos.lat, pos.lng, "Pinned Map Location, Ravulapalem");
      });
      leafletMap.on('click', function(e) {
        customerMarker.setLatLng(e.latlng);
        handleLocationUpdate(e.latlng.lat, e.latlng.lng, "Selected Map Location, Ravulapalem");
      });
    } catch(err) {}
  }, 200);
}

function handleLocationUpdate(lat, lng, addressName) {
  currentCustomerCoords = { lat, lng, address: addressName };
}

function selectPresetLoc(name, lat, lng) {
  currentCustomerCoords = { lat, lng, address: name };
  if (customerMarker && leafletMap) {
    customerMarker.setLatLng([lat, lng]);
    leafletMap.panTo([lat, lng]);
  }
}

function detectDeviceLocation() {
  if (!navigator.geolocation) return alert("Geolocation not supported!");
  navigator.geolocation.getCurrentPosition(
    (pos) => selectPresetLoc("Current GPS Location", pos.coords.latitude, pos.coords.longitude),
    () => selectPresetLoc("RTC Complex, Ravulapalem", 16.7483, 81.8488),
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function openLocationModal() {
  closeAllModals();
  const modal = document.getElementById('locationModal');
  if (modal) modal.classList.remove('hidden');
  initLeafletMap();
}
function closeLocationModal() { 
  const modal = document.getElementById('locationModal');
  if (modal) modal.classList.add('hidden'); 
}

function confirmLocationSelection() {
  const headerAddr = document.getElementById('currentAddressHeader');
  if (headerAddr) headerAddr.innerText = currentCustomerCoords.address;
  
  // Also push map selection into manual form fields if needed
  const streetInput = document.getElementById('manualStreet');
  if (streetInput) streetInput.value = currentCustomerCoords.address;
  
  closeLocationModal();
}

function closeAllModals() {
  ['checkoutModal', 'ordersModal', 'locationModal', 'paymentOverlay', 'productDetailModal', 'customerLoginModal', 'orderDetailReceiptModal', 'accountModal', 'addressManagerModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}
function closeOrdersView() { const m = document.getElementById('ordersModal'); if(m) m.classList.add('hidden'); }
function openAccountModal() { closeAllModals(); syncAccountDashboard(); const m = document.getElementById('accountModal'); if(m) m.classList.remove('hidden'); }
function closeAccountModal() { const m = document.getElementById('accountModal'); if(m) m.classList.add('hidden'); }

// --- MULTI-ADDRESS MANAGEMENT ENGINE ---
let savedAddresses = JSON.parse(localStorage.getItem('my_saved_addresses') || JSON.stringify([
  { id: "addr_1", fullName: "Chandra Shekar", mobile: "9876543210", house: "Door 1-23", street: "RTC Complex", city: "Ravulapalem", district: "East Godavari", state: "Andhra Pradesh", pincode: "533238", landmark: "Near Bus Stand", isDefault: true }
]));

function openAddressManager() {
  const m = document.getElementById('addressManagerModal');
  if (m) m.classList.remove('hidden');
  renderSavedAddressesList();
}
function closeAddressManager() { 
  const m = document.getElementById('addressManagerModal');
  if(m) m.classList.add('hidden'); 
}

function renderSavedAddressesList() {
  const container = document.getElementById('savedAddressesContainer');
  if (!container) return;
  container.innerHTML = '';

  if (savedAddresses.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">No saved addresses yet. Add one below!</p>`;
    return;
  }

  savedAddresses.forEach((addr, idx) => {
    const card = document.createElement('div');
    card.className = `p-3 rounded-2xl border ${addr.isDefault ? 'border-emerald-600 bg-emerald-50/40' : 'border-slate-200 bg-white'} space-y-1 text-xs`;
    card.innerHTML = `
      <div class="flex justify-between items-center font-bold">
        <span>${addr.fullName} (${addr.mobile})</span>
        <div class="space-x-1">
          ${addr.isDefault ? '<span class="text-[9px] bg-emerald-600 text-white px-2 py-0.5 rounded font-black">DEFAULT</span>' : `<button onclick="setDefaultAddress(${idx})" class="text-[9px] text-blue-600 underline">Set Default</button>`}
          <button onclick="deleteAddress(${idx})" class="text-[9px] text-rose-600 font-bold ml-2">Delete</button>
        </div>
      </div>
      <p class="text-slate-600 text-[11px]">${addr.house}, ${addr.street}, ${addr.city}, ${addr.district}, ${addr.state} - ${addr.pincode}</p>
      ${addr.landmark ? `<p class="text-[10px] text-slate-400">Landmark: ${addr.landmark}</p>` : ''}
    `;
    container.appendChild(card);
  });
}

function saveNewManualAddress(e) {
  if (e) e.preventDefault();
  
  const newAddr = {
    id: "addr_" + Date.now(),
    fullName: document.getElementById('manualFullName').value.trim(),
    mobile: document.getElementById('manualMobile').value.trim(),
    house: document.getElementById('manualHouse').value.trim(),
    street: document.getElementById('manualStreet').value.trim(),
    city: document.getElementById('manualCity').value.trim(),
    district: document.getElementById('manualDistrict').value.trim(),
    state: document.getElementById('manualState').value.trim(),
    pincode: document.getElementById('manualPincode').value.trim(),
    landmark: document.getElementById('manualLandmark').value.trim(),
    isDefault: savedAddresses.length === 0
  };

  if (!newAddr.fullName || !newAddr.mobile || !newAddr.house || !newAddr.pincode) {
    alert("Please fill all required address fields!");
    return;
  }

  savedAddresses.push(newAddr);
  localStorage.setItem('my_saved_addresses', JSON.stringify(savedAddresses));
  
  document.getElementById('manualAddressForm').reset();
  renderSavedAddressesList();
  populateCheckoutAddressDropdown();
  alert("Address saved successfully!");
}

function setDefaultAddress(idx) {
  savedAddresses.forEach((a, i) => a.isDefault = (i === idx));
  localStorage.setItem('my_saved_addresses', JSON.stringify(savedAddresses));
  renderSavedAddressesList();
  populateCheckoutAddressDropdown();
}

function deleteAddress(idx) {
  if (confirm("Delete this saved address?")) {
    savedAddresses.splice(idx, 1);
    if (savedAddresses.length > 0 && !savedAddresses.some(a => a.isDefault)) {
      savedAddresses[0].isDefault = true;
    }
    localStorage.setItem('my_saved_addresses', JSON.stringify(savedAddresses));
    renderSavedAddressesList();
    populateCheckoutAddressDropdown();
  }
}

function populateCheckoutAddressDropdown() {
  const select = document.getElementById('checkoutAddressSelect');
  if (!select) return;
  select.innerHTML = '<option value="">-- Select Saved Address --</option>';
  savedAddresses.forEach((addr, idx) => {
    select.innerHTML += `<option value="${idx}" ${addr.isDefault ? 'selected' : ''}>${addr.fullName} - ${addr.house}, ${addr.city} (${addr.pincode})</option>`;
  });
}

// --- 3. CATEGORIES & CATALOG ---
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
let activeCategory = "veggies";
let currentSearch = "";

function selectCategory(catId, targetEl = null) {
  activeCategory = catId;
  const currentCatObj = categories.find(c => c.id === catId);
  const headingEl = document.getElementById('categoryHeading');
  if (headingEl) headingEl.innerText = currentCatObj ? currentCatObj.name : "Products";

  document.querySelectorAll('.cat-card').forEach(card => card.classList.remove('border-emerald-600', 'bg-emerald-50/50'));
  if (targetEl) targetEl.classList.add('border-emerald-600', 'bg-emerald-50/50');
  filterAndRender();
}

async function fetchProducts() {
  db.collection("products").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let cloudProducts = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      cloudProducts.push({ id: doc.id, ...d });
    });
    liveCatalog = cloudProducts;
    filterAndRender();
  });
}

function filterAndRender() {
  let filtered = liveCatalog.filter(item => item.category === activeCategory);
  if (currentSearch) filtered = liveCatalog.filter(item => item.name.toLowerCase().includes(currentSearch));

  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full py-12 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-6"><h4 class="text-sm font-extrabold text-slate-800">No products in this category yet</h4><p class="text-xs text-slate-400 mt-0.5">Add products from Admin Panel</p></div>`;
    document.getElementById('itemCountBadge').innerText = "0 Items";
    return;
  }

  filtered.forEach(p => {
    const qtyValue = p.qty_value !== undefined ? p.qty_value : 1;
    const qtyUnit = p.qty_unit || p.unit || 'pc';
    const displayUnit = `${qtyValue} ${qtyUnit}`;
    const qty = cartState[p.id] || 0;

    const card = document.createElement('div');
    card.className = "bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition";
    card.innerHTML = `
      <div onclick="openProductDetailModal('${p.id}')" class="cursor-pointer group">
        <div class="h-28 sm:h-36 w-full rounded-xl overflow-hidden bg-slate-50 relative mb-2 flex items-center justify-center p-2">
          <img src="${p.image_url}" class="max-h-full max-w-full object-contain">
          <span class="absolute bottom-1 left-1 bg-slate-900/90 text-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded">⚡ 10 MINS</span>
        </div>
        <h4 class="text-xs font-bold text-slate-900 line-clamp-2">${p.name}</h4>
        <span class="text-[10px] text-slate-500 font-bold mt-0.5 block">${displayUnit}</span>
      </div>
      <div class="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-100">
        <span class="text-xs sm:text-sm font-extrabold text-slate-900">₹${p.price}</span>
        <div>
          ${qty === 0 ? `<button onclick="modifyCart('${p.id}', 1)" class="px-3 py-1 rounded-lg border-2 border-emerald-600 text-emerald-700 text-xs font-black uppercase">ADD</button>` : 
          `<div class="flex items-center bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs font-bold gap-2"><button onclick="modifyCart('${p.id}', -1)">-</button><span>${qty}</span><button onclick="modifyCart('${p.id}', 1)">+</button></div>`}
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
  document.getElementById('detailImg').src = p.image_url;
  document.getElementById('detailName').innerText = p.name;
  document.getElementById('detailUnit').innerText = `${p.qty_value || 1} ${p.qty_unit || p.unit || 'pc'}`;
  document.getElementById('detailPrice').innerText = `₹${p.price}`;
  document.getElementById('detailActionBtn').innerHTML = `<button onclick="modifyCart('${p.id}', 1); closeProductDetailModal();" class="px-5 py-2 bg-[#0B132B] text-white font-bold text-xs uppercase rounded-xl">Add to Cart</button>`;
  document.getElementById('productDetailModal').classList.remove('hidden');
}
function closeProductDetailModal() { document.getElementById('productDetailModal').classList.add('hidden'); }

function modifyCart(prodId, delta) {
  const next = (cartState[prodId] || 0) + delta;
  if (next <= 0) delete cartState[prodId];
  else cartState[prodId] = next;
  filterAndRender();
  syncCartBar();
}

function syncCartBar() {
  const bar = document.getElementById('bottomCartBar');
  let count = 0, sum = 0;
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) { count += cartState[id]; sum += item.price * cartState[id]; }
  });
  if (count > 0) {
    bar.classList.remove('hidden');
    document.getElementById('barItemCount').innerText = `${count} items added`;
    document.getElementById('barGrandPrice').innerText = `₹${sum}`;
  } else { bar.classList.add('hidden'); }
}

function handleSearch(val) { currentSearch = val.toLowerCase().trim(); filterAndRender(); }

// --- 4. CHECKOUT & FREE DELIVERY RULE (>= ₹199) ---
function openCheckout() {
  const now = new Date();
  const istTimeStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istHours = new Date(istTimeStr).getHours();
  if (istHours < 7 || istHours >= 22) {
    alert("⚠️ Orders are available only from 7:00 AM to 10:00 PM IST.");
    return;
  }

  closeAllModals();
  const bar = document.getElementById('bottomCartBar');
  if (bar) bar.classList.add('hidden');

  const modal = document.getElementById('checkoutModal');
  if (modal) modal.classList.remove('hidden');

  populateCheckoutAddressDropdown();
  renderCheckoutSummary();
  setPaymentMethod(selectedPaymentMode);
  syncCustomerAuthUI();
}

function closeCheckout() { document.getElementById('checkoutModal').classList.add('hidden'); syncCartBar(); }

function renderCheckoutSummary() {
  const container = document.getElementById('cartItemsContainer');
  if (!container) return;
  container.innerHTML = '';
  let sub = 0;

  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) {
      const qty = cartState[id];
      const rowPrice = item.price * qty;
      sub += rowPrice;
      const unitLabel = `${item.qty_value || 1} ${item.qty_unit || item.unit || 'pc'}`;
      container.innerHTML += `<div class="flex items-center justify-between p-2 rounded-xl bg-white border"><div class="flex items-center gap-2"><img src="${item.image_url}" class="w-8 h-8 object-contain"><div><p class="text-xs font-bold">${item.name}</p><span class="text-[10px] text-slate-500">${unitLabel} • ₹${item.price} x ${qty}</span></div></div><span class="text-xs font-black">₹${rowPrice}</span></div>`;
    }
  });

  let deliveryFee = 25;
  const banner = document.getElementById('freeDeliveryBanner');
  if (sub >= 199) {
    deliveryFee = 0;
    if (banner) {
      banner.innerText = "🎉 You unlocked FREE DELIVERY!";
      banner.className = "p-2 bg-emerald-50 text-emerald-800 rounded-xl font-black text-center text-[11px] mb-1";
    }
  } else {
    const diff = 199 - sub;
    if (banner) {
      banner.innerText = `Add ₹${diff} more to get FREE DELIVERY`;
      banner.className = "p-2 bg-amber-50 text-amber-800 rounded-xl font-black text-center text-[11px] mb-1";
    }
  }

  const subEl = document.getElementById('billSubtotal');
  const delEl = document.getElementById('billDeliveryFee');
  const finEl = document.getElementById('billFinal');

  if (subEl) subEl.innerText = `₹${sub}`;
  if (delEl) delEl.innerText = deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`;
  if (finEl) finEl.innerText = `₹${sub + deliveryFee + 4}`;
}

let selectedPaymentMode = 'COD';
function setPaymentMethod(mode) {
  selectedPaymentMode = mode;
  ['upiAppsBox', 'upiQrBox', 'codNoticeBox'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  if (mode === 'UPI_QR') { 
    const qrBox = document.getElementById('upiQrBox');
    if (qrBox) qrBox.classList.remove('hidden'); 
    renderPaymentQR(); 
  }
  else if (mode === 'UPI_APPS') { 
    const appBox = document.getElementById('upiAppsBox');
    if (appBox) appBox.classList.remove('hidden'); 
  }
  else if (mode === 'COD') { 
    const codBox = document.getElementById('codNoticeBox');
    if (codBox) codBox.classList.remove('hidden'); 
  }
}

function triggerDirectUpiPay(appName) {
  let sub = 0;
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) sub += item.price * cartState[id];
  });
  const deliveryFee = sub >= 199 ? 0 : 25;
  window.location.href = `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${sub + deliveryFee + 4}&cu=INR`;
}

function renderPaymentQR() {
  let sub = 0;
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) sub += item.price * cartState[id];
  });
  const deliveryFee = sub >= 199 ? 0 : 25;
  const canvas = document.getElementById('qrcodeCanvas');
  if (canvas) { canvas.innerHTML = ''; new QRCode(canvas, { text: `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${sub + deliveryFee + 4}&cu=INR`, width: 120, height: 120 }); }
}

// --- 5. ORDER PLACEMENT & SNAPSHOT ADDRESS ---
async function processPaymentFlow() {
  const now = new Date();
  const istTimeStr = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istHours = new Date(istTimeStr).getHours();
  if (istHours < 7 || istHours >= 22) {
    alert("⚠️ Orders are available only from 7:00 AM to 10:00 PM IST.");
    return;
  }

  const selectIdx = document.getElementById('checkoutAddressSelect').value;
  if (selectIdx === "") return alert("Please select a delivery address!");

  const chosenAddr = savedAddresses[Number(selectIdx)];

  const overlay = document.getElementById('paymentOverlay');
  if (overlay) overlay.classList.remove('hidden');
  setTimeout(() => finalizeOrderAndLaunch(chosenAddr), 800);
}

async function finalizeOrderAndLaunch(chosenAddr) {
  const overlay = document.getElementById('paymentOverlay');
  if (overlay) overlay.classList.add('hidden');

  let sub = 0;
  const orderItems = Object.keys(cartState).map(id => {
    const item = liveCatalog.find(p => p.id == id);
    const qty = cartState[id];
    sub += item.price * qty;
    return { id: item.id, name: item.name, unit: `${item.qty_value || 1} ${item.qty_unit || item.unit || 'pc'}`, quantity: qty, price: item.price };
  });

  const deliveryFee = sub >= 199 ? 0 : 25;
  const orderId = "QD-" + Math.floor(100000 + Math.random() * 900000);
  
  // Format snapshot full address string
  const fullAddressString = `${chosenAddr.fullName} (${chosenAddr.mobile}), ${chosenAddr.house}, ${chosenAddr.street}, ${chosenAddr.city}, ${chosenAddr.district}, ${chosenAddr.state} - ${chosenAddr.pincode} ${chosenAddr.landmark ? '[Landmark: ' + chosenAddr.landmark + ']' : ''}`;

  const orderPayload = {
    id: orderId,
    customer_phone: chosenAddr.mobile,
    delivery_address: fullAddressString, // Immutable snapshot
    address_details: chosenAddr,         // Stored as snapshot object
    items: orderItems,
    total_amount: sub + deliveryFee + 4,
    status: "PLACED",
    payment_mode: selectedPaymentMode,
    delivery_otp: Math.floor(1000 + Math.random() * 9000).toString(),
    created_at_ms: Date.now()
  };

  try {
    await db.collection("orders").doc(orderId).set({ ...orderPayload, created_at: firebase.firestore.FieldValue.serverTimestamp() });
  } catch(e) {}

  const userKey = `orders_${chosenAddr.mobile}`;
  const local = JSON.parse(localStorage.getItem(userKey) || '[]');
  local.unshift(orderPayload);
  localStorage.setItem(userKey, JSON.stringify(local));

  activeCustomerSession = { phone: chosenAddr.mobile };
  localStorage.setItem('quickdash_customer', JSON.stringify(activeCustomerSession));
  syncCustomerAuthUI();

  cartState = {};
  filterAndRender();
  syncCartBar();
  const checkoutModal = document.getElementById('checkoutModal');
  if (checkoutModal) checkoutModal.classList.add('hidden');
  
  alert(`🎉 Order Placed Successfully (${orderId})!`);
  toggleOrdersView();
}

function syncAccountDashboard() {
  const phoneDisplay = document.getElementById('accPhoneDisplay');
  if (phoneDisplay) phoneDisplay.innerText = activeCustomerSession ? activeCustomerSession.phone : "Not Logged In";
}

// --- 7. STRICT USER-SPECIFIC ORDERS & TIMELINE TRACKING ---
let currentFetchedOrdersCache = [];

async function fetchCloudOrders() {
  const feed = document.getElementById('ordersFeed');
  if (!feed) return;
  const phone = activeCustomerSession ? activeCustomerSession.phone : null;
  if (!phone) { feed.innerHTML = `<div class="text-center py-6"><button onclick="openLoginModal()" class="px-4 py-2 bg-[#0B132B] text-white rounded-xl">Login to View Orders</button></div>`; return; }

  let orders = [];
  try {
    const snap = await db.collection("orders").where("customer_phone", "==", phone).get();
    snap.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
  } catch(e) {}
  
  const local = JSON.parse(localStorage.getItem(`orders_${phone}`) || '[]');
  local.forEach(lo => { if (!orders.some(o => o.id === lo.id)) orders.push(lo); });
  orders.sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
  currentFetchedOrdersCache = orders;

  if (orders.length === 0) { feed.innerHTML = `<p class="text-center py-6 text-slate-400">No orders found for +91 ${phone}.</p>`; return; }

  feed.innerHTML = '';
  orders.forEach((o, index) => {
    feed.innerHTML += `
      <div onclick="openReceiptByIndex(${index})" class="p-3 bg-white border rounded-2xl cursor-pointer hover:border-emerald-500 transition space-y-1">
        <div class="flex justify-between font-bold"><span>${o.id}</span><span class="text-emerald-600">₹${o.total_amount}</span></div>
        <p class="text-[10px] text-slate-500 truncate">${o.delivery_address}</p>
        <div class="flex justify-between items-center pt-1"><span class="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Status: ${o.status || 'PLACED'}</span><span class="text-[10px] font-black text-amber-600">OTP: ${o.delivery_otp}</span></div>
      </div>
    `;
  });
}

function openReceiptByIndex(index) {
  const order = currentFetchedOrdersCache[index];
  if (!order) return;
  const ordersModal = document.getElementById('ordersModal');
  if (ordersModal) ordersModal.classList.add('hidden');

  const rId = document.getElementById('receiptOrderId');
  const rAddr = document.getElementById('receiptAddress');
  const rPay = document.getElementById('receiptPayment');

  if (rId) rId.innerText = order.id;
  if (rAddr) rAddr.innerText = order.delivery_address; // Immutable snapshot address
  if (rPay) rPay.innerText = order.payment_mode;

  const statusFlow = ["PLACED", "PACKED", "DISPATCHED", "DELIVERED"];
  const currentStatus = order.status || "PLACED";
  const currentIndex = statusFlow.indexOf(currentStatus);

  const timelineBox = document.getElementById('orderTimelineBox');
  if (timelineBox) {
    timelineBox.innerHTML = statusFlow.map((st, i) => {
      const isDone = i <= currentIndex;
      let labelText = st;
      if (st === 'PLACED') labelText = 'Order Placed';
      else if (st === 'PACKED') labelText = 'Packed';
      else if (st === 'DISPATCHED') labelText = 'Out for Delivery / Dispatched';
      else if (st === 'DELIVERED') labelText = 'Delivered';

      return `<div class="flex items-center gap-2 text-xs font-bold ${isDone ? 'text-emerald-600' : 'text-slate-300'}"><span>${isDone ? '✓' : '○'}</span><span>${labelText}</span></div>`;
    }).join('');
  }

  const container = document.getElementById('receiptItemsContainer');
  if (container) {
    container.innerHTML = (order.items || []).map(it => `<div class="flex justify-between"><span>${it.quantity}x ${it.name} (${it.unit})</span><span>₹${it.price * it.quantity}</span></div>`).join('');
  }

  const deliveryFee = order.total_amount >= 199 ? 0 : 25;
  const subTotEl = document.getElementById('receiptSubtotal');
  const delFeeEl = document.getElementById('receiptDeliveryFee');
  const grandTotEl = document.getElementById('receiptGrandTotal');

  if (subTotEl) subTotEl.innerText = `₹${order.total_amount - deliveryFee - 4}`;
  if (delFeeEl) delFeeEl.innerText = deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`;
  if (grandTotEl) grandTotEl.innerText = `₹${order.total_amount}`;
  
  const modal = document.getElementById('orderDetailReceiptModal');
  if (modal) modal.classList.remove('hidden');
}

function closeOrderDetailReceipt() {
  const receiptModal = document.getElementById('orderDetailReceiptModal');
  const ordersModal = document.getElementById('ordersModal');
  if (receiptModal) receiptModal.classList.add('hidden');
  if (ordersModal) ordersModal.classList.remove('hidden');
}

function toggleOrdersView() { 
  closeAllModals(); 
  const ordersModal = document.getElementById('ordersModal');
  if (ordersModal) ordersModal.classList.remove('hidden'); 
  fetchCloudOrders(); 
}

// --- 8. AUTH ---
let activeCustomerSession = JSON.parse(localStorage.getItem('quickdash_customer') || 'null');
function syncCustomerAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userChip = document.getElementById('userChip');
  if (activeCustomerSession && activeCustomerSession.phone) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userChip) userChip.classList.remove('hidden');
    const disp = document.getElementById('userPhoneDisplay');
    if (disp) disp.innerText = activeCustomerSession.phone.slice(-4);
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userChip) userChip.classList.add('hidden');
  }
}
function openLoginModal() { closeAllModals(); document.getElementById('customerLoginModal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('customerLoginModal').classList.add('hidden'); }
function sendCustomerLoginOtp() { document.getElementById('loginStepPhone').classList.add('hidden'); document.getElementById('loginStepOtp').classList.remove('hidden'); document.getElementById('loginOtpInput').value = "4821"; }
function verifyCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim() || "9876543210";
  activeCustomerSession = { phone };
  localStorage.setItem('quickdash_customer', JSON.stringify(activeCustomerSession));
  closeLoginModal(); syncCustomerAuthUI(); alert("Logged in successfully!");
}
function logoutCustomer() { localStorage.removeItem('quickdash_customer'); activeCustomerSession = null; syncCustomerAuthUI(); alert("Logged out."); }

document.addEventListener('DOMContentLoaded', () => {
  checkStoreWorkingHours();
  fetchProducts();
  syncCustomerAuthUI();
  selectCategory('veggies', null);
});