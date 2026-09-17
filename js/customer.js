// ==========================================
// 🛒 CUSTOMER STOREFRONT ENGINE (customer.js)
// ==========================================

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
      L.marker([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng]).addTo(leafletMap).bindPopup("<b>Ravulapalem RTC Hub</b>");
      customerMarker = L.marker([currentCustomerCoords.lat, currentCustomerCoords.lng], { draggable: true }).addTo(leafletMap);
    } catch(err) {}
  }, 200);
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
function closeCheckout() { document.getElementById('checkoutModal').classList.add('hidden'); }
function closeOrdersView() { document.getElementById('ordersModal').classList.add('hidden'); }

// ==========================================
// 📦 RELIABLE DEMO CATALOG
// ==========================================
const fallbackCatalog = [
  {
    id: "st-1",
    name: "Aashirvaad Shudh Chakki Atta",
    category: "staples",
    desc: "100% pure whole wheat flour processed with traditional chakki grinding for extra soft rotis.",
    image_url: "https://images.pexels.com/photos/6287295/pexels-photo-6287295.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "1 kg", price: 58, old_price: 65 }, { unit: "5 kg", price: 275, old_price: 310 }]
  },
  {
    id: "st-2",
    name: "Freedom Refined Sunflower Oil",
    category: "staples",
    desc: "Light and healthy refined sunflower oil enriched with Vitamins A & D, ideal for all cooking.",
    image_url: "https://images.pexels.com/photos/33783/olive-oil-salad-dressing-cooking-olive.jpg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "1 L Pouch", price: 118, old_price: 135 }, { unit: "5 L Can", price: 595, old_price: 670 }]
  },
  {
    id: "st-3",
    name: "India Gate Basmati Rice Rozzana",
    category: "staples",
    desc: "Aromatic long grain basmati rice perfect for everyday biryani, pulao and steamed rice.",
    image_url: "https://images.pexels.com/photos/4110256/pexels-photo-4110256.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "1 kg", price: 92, old_price: 115 }, { unit: "5 kg", price: 440, old_price: 520 }]
  },
  {
    id: "st-4",
    name: "Tata Sampann Toor Dal",
    category: "staples",
    desc: "Unpolished toor dal retaining its natural dietary fiber and wholesome taste without artificial color.",
    image_url: "https://images.pexels.com/photos/7421213/pexels-photo-7421213.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "500 g", price: 98, old_price: 110 }, { unit: "1 kg", price: 189, old_price: 215 }]
  },
  {
    id: "dy-1",
    name: "Amul Taaza Fresh Toned Milk",
    category: "dairy",
    desc: "Fresh, pasteurised toned milk with 3.0% fat, rich in calcium and natural proteins.",
    image_url: "https://images.pexels.com/photos/248412/pexels-photo-248412.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "500 ml", price: 27, old_price: 28 }, { unit: "1 L Tetra", price: 74, old_price: 78 }]
  },
  {
    id: "dy-2",
    name: "Amul Pasteurised Table Butter",
    category: "dairy",
    desc: "Classic salted pure butter made from fresh cream, perfect spread for hot toasts and parathas.",
    image_url: "https://images.pexels.com/photos/531334/pexels-photo-531334.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "100 g", price: 58, old_price: 60 }, { unit: "500 g", price: 275, old_price: 290 }]
  },
  {
    id: "sn-1",
    name: "Lay's Magic Masala Potato Chips",
    category: "snacks",
    desc: "Crunchy sliced potato chips seasoned with authentic Indian spicy masala blend.",
    image_url: "https://images.pexels.com/photos/568805/pexels-photo-568805.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "48 g", price: 20, old_price: 20 }, { unit: "115 g", price: 50, old_price: 50 }]
  },
  {
    id: "sn-2",
    name: "Cadbury Dairy Milk Silk Chocolate",
    category: "snacks",
    desc: "Ultra smooth and creamy milk chocolate bar melting instantly for the perfect sweet indulgence.",
    image_url: "https://images.pexels.com/photos/65882/chocolate-dark-coffee-confiserie-65882.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "60 g", price: 78, old_price: 85 }, { unit: "150 g", price: 175, old_price: 190 }]
  },
  {
    id: "vg-1",
    name: "Fresh Farm Red Onions",
    category: "veggies",
    desc: "Freshly harvested local red onions with rich pungent flavor, ideal for tadka and curries.",
    image_url: "https://images.pexels.com/photos/144248/potatoes-vegetables-erdfrucht-bio-144248.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "1 kg", price: 35, old_price: 45 }, { unit: "2 kg", price: 68, old_price: 90 }]
  },
  {
    id: "vg-2",
    name: "Country Fresh Red Tomatoes",
    category: "veggies",
    desc: "Juicy, ripe country tomatoes packed fresh from nearby Godavari farms.",
    image_url: "https://images.pexels.com/photos/1327838/pexels-photo-1327838.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "500 g", price: 18, old_price: 24 }, { unit: "1 kg", price: 34, old_price: 45 }]
  },
  {
    id: "in-1",
    name: "Maggi 2-Minute Masala Noodles",
    category: "instant",
    desc: "India's favorite instant noodles crafted with roasted spices and rich aroma in just 2 minutes.",
    image_url: "https://images.pexels.com/photos/884600/pexels-photo-884600.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "70 g Pouch", price: 14, old_price: 15 }, { unit: "4-Pack (280g)", price: 54, old_price: 60 }]
  },
  {
    id: "pc-1",
    name: "Surf Excel Easy Wash Detergent",
    category: "personal",
    desc: "Super active formula removing tough stains effortlessly with clean fresh fragrance.",
    image_url: "https://images.pexels.com/photos/5202925/pexels-photo-5202925.jpeg?auto=compress&cs=tinysrgb&w=400",
    variants: [{ unit: "500 g", price: 65, old_price: 75 }, { unit: "1 kg", price: 125, old_price: 145 }]
  }
];

let liveCatalog = [...fallbackCatalog];
let cartState = {};
let activeCategory = "staples";
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
      const dup = seen.has(item.id);
      seen.add(item.id);
      return !dup;
    });

    filterAndRender();
  }, () => {
    liveCatalog = [...fallbackCatalog];
    filterAndRender();
  });
}

const categories = [
  { id: "staples", name: "Atta, Rice & Dal" },
  { id: "dairy", name: "Milk, Bread & Dairy" },
  { id: "snacks", name: "Chips, Drinks & Sweets" },
  { id: "veggies", name: "Fresh Vegetables" },
  { id: "instant", name: "Instant Foods & Tea" },
  { id: "personal", name: "Soap, Paste & Detergent" }
];

function selectCategory(catId) {
  activeCategory = catId;
  const currentCatObj = categories.find(c => c.id === catId);
  document.getElementById('categoryHeading').innerText = currentCatObj ? currentCatObj.name : "Products";
  filterAndRender();
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
              class="px-2 py-0.5 rounded-lg text-[10px] font-bold border transition ${idx === currentVIdx ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-100 text-slate-700 border-slate-200'}"
            >
              ${v.unit}
            </button>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div onclick="openProductDetailModal('${p.id}')" class="cursor-pointer group">
        <div class="h-28 sm:h-36 w-full rounded-xl overflow-hidden bg-slate-50 relative mb-2 flex items-center justify-center">
          <img src="${p.image_url}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition">
          <span class="absolute bottom-1 left-1 bg-slate-900/90 text-amber-300 text-[9px] font-black px-1.5 py-0.5 rounded">
            ⚡ 10 MINS
          </span>
        </div>
        <h4 class="text-xs font-bold text-slate-900 line-clamp-2 leading-snug group-hover:text-brand-accent transition">${p.name}</h4>
        <span class="text-[10px] text-slate-400 font-semibold mt-0.5 block">${activeVar.unit}</span>
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
  if (window.lucide) lucide.createIcons();
}

// --- 3. PRODUCT DESCRIPTION MODAL LOGIC ---
function openProductDetailModal(id) {
  const p = liveCatalog.find(item => item.id == id);
  if (!p) return;

  const variants = Array.isArray(p.variants) && p.variants.length > 0 
    ? p.variants 
    : [{ unit: p.unit || "1 pc", price: p.price }];

  const currentVIdx = selectedVariantIndex[p.id] || 0;
  const activeVar = variants[currentVIdx] || variants[0];
  const cartKey = `${p.id}_${currentVIdx}`;
  const qty = cartState[cartKey] || 0;

  document.getElementById('detailImg').src = p.image_url;
  document.getElementById('detailName').innerText = p.name;
  document.getElementById('detailUnit').innerText = activeVar.unit;
  document.getElementById('detailCategory').innerText = (p.category || 'STAPLES').toUpperCase();
  document.getElementById('detailPrice').innerText = `₹${activeVar.price}`;
  document.getElementById('detailDesc').innerText = p.desc || "100% Genuine product directly fulfilled from Ravulapalem RTC dark store with express quality check.";

  const btnWrap = document.getElementById('detailActionBtn');
  btnWrap.innerHTML = `
    <button onclick="modifyCart('${p.id}', ${currentVIdx}, 1); closeProductDetailModal();" class="px-5 py-2 bg-brand-navy hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-md">
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
      const v = (item.variants && item.variants[Number(vIdx)]) || { unit: item.unit, price: item.price };
      const qty = cartState[key];
      const rowPrice = v.price * qty;
      sub += rowPrice;

      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200";
      row.innerHTML = `
        <div class="flex items-center gap-2">
          <img src="${item.image_url}" class="w-8 h-8 rounded-lg object-cover">
          <div>
            <p class="text-xs font-bold text-slate-800 line-clamp-1 max-w-[150px]">${item.name}</p>
            <span class="text-[10px] text-slate-500 font-bold">${v.unit} • ₹${v.price}</span>
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

let selectedPaymentMode = 'UPI_QR';
function setPaymentMethod(mode) {
  selectedPaymentMode = mode;
  document.getElementById('upiQrBox').classList.toggle('hidden', mode !== 'UPI_QR');
  if (mode === 'UPI_QR') renderPaymentQR();
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
    new QRCode(canvas, { text: upiUrl, width: 110, height: 110 });
  }
}

async function processPaymentFlow() {
  const phone = document.getElementById('inputPhone').value.trim();
  const addr = document.getElementById('inputAddress').value.trim();
  if (!phone || !addr) return alert("Please enter mobile number & address!");

  document.getElementById('paymentOverlay').classList.remove('hidden');
  setTimeout(() => finalizeOrderAndLaunch(selectedPaymentMode === 'COD' ? 'PENDING_COD' : 'PAID_ONLINE'), 1200);
}

async function finalizeOrderAndLaunch(paymentStatus) {
  document.getElementById('paymentOverlay').classList.add('hidden');

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
    delivery_otp: Math.floor(1000 + Math.random() * 9000).toString(),
    created_at_ms: Date.now()
  };

  try {
    await db.collection("orders").doc(orderId).set({
      ...orderPayload,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {}

  const localOrders = JSON.parse(localStorage.getItem('quickdash_orders') || '[]');
  localOrders.unshift(orderPayload);
  localStorage.setItem('quickdash_orders', JSON.stringify(localOrders));

  cartState = {};
  filterAndRender();
  syncCartBar();
  closeCheckout();
  alert("Order placed successfully!");
  toggleOrdersView();
}

// --- ORDER RECEIPT LOOKUP ---
let currentFetchedOrdersCache = [];

async function fetchCloudOrders() {
  const feed = document.getElementById('ordersFeed');
  if (!feed) return;
  feed.innerHTML = `<p class="text-center text-slate-400 py-4">Loading orders...</p>`;

  try {
    const snapshot = await db.collection("orders").orderBy("created_at", "desc").limit(20).get();
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

    if (orders.length === 0) orders = JSON.parse(localStorage.getItem('quickdash_orders') || '[]');
    currentFetchedOrdersCache = orders;

    if (orders.length === 0) {
      feed.innerHTML = `<p class="text-center text-slate-400 py-4">No orders placed yet.</p>`;
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
        <span class="inline-block text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
          ${o.status || 'Delivered'} • Tap for Bill
        </span>
      `;
      feed.appendChild(card);
    });
  } catch(err) {
    feed.innerHTML = `<p class="text-center text-slate-400 py-4">No orders found.</p>`;
  }
}

function openReceiptByIndex(index) {
  const order = currentFetchedOrdersCache[index];
  if (!order) return;

  document.getElementById('ordersModal').classList.add('hidden');

  document.getElementById('receiptOrderId').innerText = order.id;
  document.getElementById('receiptStatus').innerText = order.status || 'Delivered';
  document.getElementById('receiptAddress').innerText = order.delivery_address || 'Ravulapalem';
  document.getElementById('receiptPayment').innerText = `${order.payment_mode || 'UPI'}`;
  document.getElementById('receiptRider').innerText = order.assigned_rider || 'Suresh';

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

// --- CUSTOMER AUTH ---
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
  document.getElementById('customerLoginModal').classList.remove('hidden');
}
function closeLoginModal() { document.getElementById('customerLoginModal').classList.add('hidden'); }
function sendCustomerLoginOtp() {
  const phone = document.getElementById('loginMobileInput').value.trim();
  if (phone.length !== 10) return alert("Enter 10-digit phone number!");
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
}
function logoutCustomer() {
  localStorage.removeItem('quickdash_customer');
  activeCustomerSession = null;
  syncCustomerAuthUI();
}

document.addEventListener('DOMContentLoaded', () => {
  fetchProducts();
  syncCustomerAuthUI();
  selectCategory('staples');
});