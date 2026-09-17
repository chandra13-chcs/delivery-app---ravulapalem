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
  const hours = new Date(istString).getHours();
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
  closeLocationModal();
  openAddressManager();
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
function openAddressManager() { const m = document.getElementById('addressManagerModal'); if(m) m.classList.remove('hidden'); renderSavedAddressesList(); }
function closeAddressManager() { const m = document.getElementById('addressManagerModal'); if(m) m.classList.add('hidden'); }
function scrollToCategories() { window.scrollTo({ top: 400, behavior: 'smooth' }); }

// --- 🌟 MULTI-ADDRESS MANAGEMENT ENGINE ---
let savedAddresses = JSON.parse(localStorage.getItem('my_saved_addresses') || JSON.stringify([
  { id: "addr_1", fullName: "Chelluri Chandu", mobile: "8897798251", house: "Door 1-23", street: "RTC Complex", city: "Ravulapalem", district: "East Godavari", state: "Andhra Pradesh", pincode: "533238", landmark: "Near Bus Stand", isDefault: true }
]));

function renderSavedAddressesList() {
  const container = document.getElementById('savedAddressesContainer');
  if (!container) return;
  container.innerHTML = '';

  if (savedAddresses.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">No saved addresses yet. Add one below!</p>`;
    return;
  }

  savedAddresses.forEach((addr, idx) => {
    container.innerHTML += `
      <div class="p-2.5 rounded-xl border ${addr.isDefault ? 'border-emerald-600 bg-emerald-50/40' : 'border-slate-200'} text-xs space-y-1">
        <div class="flex justify-between font-bold">
          <span>${addr.fullName} (${addr.mobile})</span>
          <div>
            ${addr.isDefault ? '<span class="text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">DEFAULT</span>' : `<button onclick="setDefaultAddress(${idx})" class="text-[9px] text-blue-600 underline">Set Default</button>`}
            <button onclick="deleteAddress(${idx})" class="text-[9px] text-rose-600 ml-2">Delete</button>
          </div>
        </div>
        <p class="text-slate-600">${addr.house}, ${addr.street}, ${addr.city}, ${addr.state} - ${addr.pincode}</p>
        ${addr.landmark ? `<p class="text-[10px] text-slate-400">Landmark: ${addr.landmark}</p>` : ''}
      </div>
    `;
  });
}

function saveNewManualAddress(e) {
  e.preventDefault();
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
  closeAddressManager();
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
    if (savedAddresses.length > 0 && !savedAddresses.some(a => a.isDefault)) savedAddresses[0].isDefault = true;
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
  { id: "paan", name: "Paan Corner & Refreshers" }, { id: "dairy", name: "Dairy, Bread & Eggs" },
  { id: "veggies", name: "Fruits & Fresh Vegetables" }, { id: "drinks", name: "Cold Drinks & Juices" },
  { id: "snacks", name: "Snacks & Munchies" }, { id: "breakfast", name: "Breakfast & Instant Food" },
  { id: "sweets", name: "Sweet Tooth & Chocolates" }, { id: "bakery", name: "Bakery & Biscuits" },
  { id: "tea", name: "Tea, Coffee & Milk Drinks" }, { id: "staples", name: "Atta, Rice & Dal" },
  { id: "masala", name: "Masala, Cooking Oil & Ghee" }, { id: "sauces", name: "Sauces & Spreads" },
  { id: "meat", name: "Chicken, Meat & Fresh Fish" }, { id: "organic", name: "Organic & Healthy Living" },
  { id: "baby", name: "Baby Care Essentials" }, { id: "pharma", name: "Pharma & Wellness" },
  { id: "cleaning", name: "Cleaning Essentials" }, { id: "home", name: "Home & Office Needs" },
  { id: "personal", name: "Personal Care & Hygiene" }, { id: "pet", name: "Pet Care Supplies" }
];

let liveCatalog = [];
let cartState = {};
let activeCategory = "veggies";
let currentSearch = "";

async function fetchProducts() {
  db.collection("products").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let cloudProducts = [];
    snapshot.forEach(doc => cloudProducts.push({ id: doc.id, ...doc.data() }));
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
    grid.innerHTML = `<div class="col-span-full py-10 text-center bg-white rounded-2xl border"><h4 class="text-xs font-bold text-slate-600">No products in this category</h4></div>`;
    document.getElementById('itemCountBadge').innerText = "0 Items";
    return;
  }

  filtered.forEach(p => {
    const qtyVal = p.qty_value !== undefined ? p.qty_value : 1;
    const qtyUnit = p.qty_unit || p.unit || 'pc';
    const qty = cartState[p.id] || 0;

    grid.innerHTML += `
      <div class="bg-white p-2.5 rounded-2xl border shadow-sm flex flex-col justify-between">
        <div>
          <div class="h-28 w-full rounded-xl bg-slate-50 relative mb-2 flex items-center justify-center p-2">
            <img src="${p.image_url}" class="max-h-full max-w-full object-contain">
            <span class="absolute bottom-1 left-1 bg-slate-900 text-amber-300 text-[8px] font-black px-1 rounded">⚡ 10 MINS</span>
          </div>
          <h4 class="text-xs font-bold text-slate-900 line-clamp-2">${p.name}</h4>
          <span class="text-[10px] text-slate-500 font-bold">${qtyVal} ${qtyUnit}</span>
        </div>
        <div class="mt-2 flex items-center justify-between pt-2 border-t">
          <span class="text-xs font-black">₹${p.price}</span>
          <div>
            ${qty === 0 ? `<button onclick="modifyCart('${p.id}', 1)" class="px-3 py-1 rounded-lg border-2 border-emerald-600 text-emerald-700 text-xs font-black">ADD</button>` : 
            `<div class="flex items-center bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs gap-2"><button onclick="modifyCart('${p.id}', -1)">-</button><span>${qty}</span><button onclick="modifyCart('${p.id}', 1)">+</button></div>`}
          </div>
        </div>
      </div>
    `;
  });
  document.getElementById('itemCountBadge').innerText = `${filtered.length} Items`;
}

function selectCategory(catId, targetEl = null) {
  activeCategory = catId;
  const obj = categories.find(c => c.id === catId);
  const h = document.getElementById('categoryHeading');
  if (h) h.innerText = obj ? obj.name : "Products";
  filterAndRender();
}

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

// --- 4. FREE DELIVERY RULE (>= ₹199) ---
function calculateCartTotals() {
  let sub = 0;
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) sub += item.price * cartState[id];
  });
  const deliveryFee = sub >= 199 ? 0 : 25;
  const grandTotal = sub > 0 ? sub + deliveryFee + 4 : 0;
  return { sub, deliveryFee, grandTotal };
}

function openCheckout() {
  if (!checkStoreWorkingHours()) { alert("Store is closed (7 AM - 10 PM IST)"); return; }
  closeAllModals();
  document.getElementById('bottomCartBar').classList.add('hidden');
  document.getElementById('checkoutModal').classList.remove('hidden');
  populateCheckoutAddressDropdown();
  renderCheckoutSummary();
}

function closeCheckout() { document.getElementById('checkoutModal').classList.add('hidden'); syncCartBar(); }

function renderCheckoutSummary() {
  const container = document.getElementById('cartItemsContainer');
  if (!container) return;
  container.innerHTML = '';
  
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    if (item) {
      const qty = cartState[id];
      container.innerHTML += `<div class="flex justify-between text-xs"><span>${qty}x ${item.name}</span><span class="font-bold">₹${item.price * qty}</span></div>`;
    }
  });

  const { sub, deliveryFee, grandTotal } = calculateCartTotals();

  const banner = document.getElementById('freeDeliveryBanner');
  if (sub >= 199) {
    banner.innerText = "🎉 You unlocked FREE DELIVERY!";
    banner.className = "p-2 bg-emerald-50 text-emerald-800 rounded-xl font-black text-center text-[11px]";
  } else {
    const diff = 199 - sub;
    banner.innerText = `Add ₹${diff} more to get FREE DELIVERY`;
    banner.className = "p-2 bg-amber-50 text-amber-800 rounded-xl font-black text-center text-[11px]";
  }

  document.getElementById('billSubtotal').innerText = `₹${sub}`;
  document.getElementById('billDeliveryFee').innerText = deliveryFee === 0 ? "FREE" : `₹${deliveryFee}`;
  document.getElementById('billFinal').innerText = `₹${grandTotal}`;
}

let selectedPaymentMode = 'COD';
function setPaymentMethod(mode) {
  selectedPaymentMode = mode;
  document.getElementById('upiQrBox').classList.add('hidden');
  document.getElementById('codNoticeBox').classList.add('hidden');
  if (mode === 'UPI_QR') { document.getElementById('upiQrBox').classList.remove('hidden'); renderPaymentQR(); }
  else if (mode === 'COD') { document.getElementById('codNoticeBox').classList.remove('hidden'); }
}

function renderPaymentQR() {
  const { grandTotal } = calculateCartTotals();
  const canvas = document.getElementById('qrcodeCanvas');
  if (canvas) { canvas.innerHTML = ''; new QRCode(canvas, { text: `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${grandTotal}&cu=INR`, width: 110, height: 110 }); }
}

// --- 5. ORDER PLACEMENT & IMMUTABLE ADDRESS SNAPSHOT ---
async function processPaymentFlow() {
  const selectIdx = document.getElementById('checkoutAddressSelect').value;
  if (selectIdx === "") return alert("Please select a delivery address!");
  const chosenAddr = savedAddresses[Number(selectIdx)];

  document.getElementById('paymentOverlay').classList.remove('hidden');
  setTimeout(() => finalizeOrderAndLaunch(chosenAddr), 600);
}

async function finalizeOrderAndLaunch(chosenAddr) {
  document.getElementById('paymentOverlay').classList.add('hidden');
  const { sub, deliveryFee, grandTotal } = calculateCartTotals();
  
  let orderItems = [];
  Object.keys(cartState).forEach(id => {
    const item = liveCatalog.find(p => p.id == id);
    orderItems.push({ id: item.id, name: item.name, unit: `${item.qty_value || 1} ${item.qty_unit || 'pc'}`, quantity: cartState[id], price: item.price });
  });

  const orderId = "QD-" + Math.floor(100000 + Math.random() * 900000);
  const fullAddressString = `${chosenAddr.fullName} (${chosenAddr.mobile}), ${chosenAddr.house}, ${chosenAddr.street}, ${chosenAddr.city}, ${chosenAddr.state} - ${chosenAddr.pincode}`;

  const orderPayload = {
    id: orderId,
    customer_phone: chosenAddr.mobile,
    delivery_address: fullAddressString, // Immutable Snapshot
    items: orderItems,
    total_amount: grandTotal,
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
  document.getElementById('checkoutModal').classList.add('hidden');
  alert(`🎉 Order Placed Successfully (${orderId})!`);
  toggleOrdersView();
}

// --- 6. MY ACCOUNT DASHBOARD SYNC ---
function syncAccountDashboard() {
  const phone = activeCustomerSession ? activeCustomerSession.phone : "8897798251";
  document.getElementById('accPhoneDisplay').innerText = phone;
  
  const ordersFeed = document.getElementById('accountOrdersFeed');
  if (ordersFeed) {
    const local = JSON.parse(localStorage.getItem(`orders_${phone}`) || '[]');
    ordersFeed.innerHTML = local.length === 0 ? '<p class="text-slate-400">No past orders yet.</p>' : local.map(o => `
      <div class="p-2 border rounded-xl flex justify-between items-center bg-slate-50">
        <div><strong>${o.id}</strong> • ₹${o.total_amount}<br><span class="text-[10px] text-emerald-600 font-bold">${o.status}</span></div>
      </div>
    `).join('');
  }
}

// --- 7. AUTH & ORDERS VIEW ---
let activeCustomerSession = JSON.parse(localStorage.getItem('quickdash_customer') || 'null');
function syncCustomerAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userChip = document.getElementById('userChip');
  if (activeCustomerSession && activeCustomerSession.phone) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userChip) userChip.classList.remove('hidden');
    document.getElementById('userPhoneDisplay').innerText = activeCustomerSession.phone.slice(-4);
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userChip) userChip.classList.add('hidden');
  }
}
function openLoginModal() { closeAllModals(); document.getElementById('customerLoginModal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('customerLoginModal').classList.add('hidden'); }
function sendCustomerLoginOtp() { document.getElementById('loginStepPhone').classList.add('hidden'); document.getElementById('loginStepOtp').classList.remove('hidden'); document.getElementById('loginOtpInput').value = "4821"; }
function verifyCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim() || "8897798251";
  activeCustomerSession = { phone };
  localStorage.setItem('quickdash_customer', JSON.stringify(activeCustomerSession));
  closeLoginModal(); syncCustomerAuthUI(); alert("Logged in successfully!");
}
function logoutCustomer() { localStorage.removeItem('quickdash_customer'); activeCustomerSession = null; syncCustomerAuthUI(); alert("Logged out."); }
function toggleOrdersView() { closeAllModals(); document.getElementById('ordersModal').classList.remove('hidden'); }

document.addEventListener('DOMContentLoaded', () => {
  checkStoreWorkingHours();
  fetchProducts();
  syncCustomerAuthUI();
  selectCategory('veggies', null);
  populateCheckoutAddressDropdown();
});