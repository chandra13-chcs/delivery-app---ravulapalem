// ==========================================
// 🛡️ ADMIN OPERATIONS HUB ENGINE (admin.js)
// ==========================================

const STORE_TERMINAL_PIN = "748801";
let allFetchedOrders = [];
let selectedFilterDate = ""; // Empty means today

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

function addVariantRowInput() {
  const container = document.getElementById('variantsContainer');
  const row = document.createElement('div');
  row.className = "variant-row grid grid-cols-3 gap-2";
  row.innerHTML = `
    <input type="text" placeholder="Pack (e.g. 2 L)" class="var-unit px-3 py-1.5 text-xs border rounded-xl font-bold bg-white outline-none">
    <input type="number" placeholder="Price (₹)" class="var-price px-3 py-1.5 text-xs border rounded-xl font-bold bg-white outline-none">
    <input type="number" placeholder="MRP (₹)" class="var-oldprice px-3 py-1.5 text-xs border rounded-xl bg-white outline-none">
  `;
  container.appendChild(row);
}

let selectedProductBase64 = "";

async function handleDirectFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    selectedProductBase64 = await compressImageFile(file);
    const previewBox = document.getElementById('addPreviewBox');
    const previewImg = document.getElementById('addPreviewImg');
    const badge = document.getElementById('fileUploadStatusBadge');

    previewImg.src = selectedProductBase64;
    previewBox.classList.remove('hidden');
    previewBox.classList.add('flex');
    badge.classList.remove('hidden');
  } catch(err) {
    alert("Image load failed: " + err.message);
  }
}

async function handleAddNewProduct(e) {
  e.preventDefault();

  if (!selectedProductBase64) {
    alert("Please choose a product photo from your laptop folder or gallery!");
    return;
  }

  const variantRows = document.querySelectorAll('.variant-row');
  let variants = [];

  variantRows.forEach(row => {
    const unit = row.querySelector('.var-unit').value.trim();
    const price = Number(row.querySelector('.var-price').value);
    const old_price = Number(row.querySelector('.var-oldprice').value) || price;

    if (unit && price > 0) {
      variants.push({ unit, price, old_price });
    }
  });

  if (variants.length === 0) {
    alert("Please enter at least one pack size and price!");
    return;
  }

  const btn = document.getElementById('saveProdBtn');
  btn.innerText = "Saving to Storefront...";
  btn.disabled = true;

  const newProd = {
    name: document.getElementById('pName').value.trim(),
    category: document.getElementById('pCategory').value,
    variants: variants,
    price: variants[0].price,
    unit: variants[0].unit,
    image_url: selectedProductBase64,
    desc: document.getElementById('pDesc').value.trim() || '100% Genuine product directly fulfilled from Ravulapalem dark store.',
    created_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("products").add(newProd);
    document.getElementById('addProductForm').reset();
    document.getElementById('addPreviewBox').classList.add('hidden');
    document.getElementById('fileUploadStatusBadge').classList.add('hidden');
    selectedProductBase64 = "";

    btn.innerText = "+ Add Product to Storefront";
    btn.disabled = false;
    alert("Product added successfully with all pack sizes!");
  } catch(err) {
    alert("Upload failed: " + err.message);
    btn.disabled = false;
  }
}

function loadAdminInventory() {
  const tbody = document.getElementById('inventoryTableBody');
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

      let variantsDisplay = p.unit || "1 pc";
      if (Array.isArray(p.variants) && p.variants.length > 0) {
        variantsDisplay = p.variants.map(v => `${v.unit} (₹${v.price})`).join(", ");
      }

      tr.innerHTML = `
        <td class="py-2.5 px-3 flex items-center gap-2">
          <img src="${p.image_url}" class="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white">
          <span class="font-bold text-slate-800">${p.name}</span>
        </td>
        <td class="py-2.5 px-3 uppercase text-[10px] font-bold text-slate-500">${p.category}</td>
        <td class="py-2.5 px-3 font-semibold text-slate-700 text-xs">${variantsDisplay}</td>
        <td class="py-2.5 px-3 font-black text-[#0B132B]">₹${p.price}</td>
        <td class="py-2.5 px-3 text-right space-x-1">
          <button onclick="openEditProductImageModal('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${p.image_url}')" class="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold rounded-lg text-xs transition">
            Change Photo
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
  document.getElementById('editProdName').innerText = currentName;
  document.getElementById('editProdPreview').src = currentImg;
  document.getElementById('editModalFileInput').value = '';
  document.getElementById('editProductModal').classList.remove('hidden');
}

function closeEditProductModal() {
  document.getElementById('editProductModal').classList.add('hidden');
  editingProductId = null;
  editModalNewBase64 = "";
}

async function handleEditModalFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    editModalNewBase64 = await compressImageFile(file);
    document.getElementById('editProdPreview').src = editModalNewBase64;
  } catch(err) {
    alert("Image load failed: " + err.message);
  }
}

async function submitProductImageUpdate() {
  if (!editModalNewBase64 || !editingProductId) return alert("Please select a new photo!");

  const btn = document.getElementById('btnSaveProdImg');
  btn.innerText = "Updating...";

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
    btn.innerText = "Save & Replace Image";
  }
}

// HERO BANNER MANAGER
async function handleBannerDirectFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const compressedBanner = await compressImageFile(file, 800, 500, 0.85);
    document.getElementById('bannerImgInput').value = compressedBanner;
  } catch(err) {
    alert("Banner image load failed: " + err.message);
  }
}

async function handleSaveHeroBanner(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveBanner');
  btn.innerText = "Publishing...";

  const bannerData = {
    title: document.getElementById('bannerTitleInput').value.trim(),
    subtitle: document.getElementById('bannerSubInput').value.trim(),
    image_url: document.getElementById('bannerImgInput').value.trim(),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("settings").doc("hero_banner").set(bannerData);
    alert("Homepage Banner Updated!");
    btn.innerText = "Save & Publish Banner";
  } catch(err) {
    alert("Error: " + err.message);
    btn.innerText = "Save & Publish Banner";
  }
}

async function loadActiveHeroBanner() {
  try {
    const doc = await db.collection("settings").doc("hero_banner").get();
    if (doc.exists) {
      const d = doc.data();
      document.getElementById('bannerTitleInput').value = d.title || '';
      document.getElementById('bannerSubInput').value = d.subtitle || '';
      document.getElementById('bannerImgInput').value = d.image_url || '';
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

// 20 CATEGORY IMAGES REPLACER
const adminCategoryDefaults = [
  { id: "paan", name: "Paan Corner", img: "https://images.pexels.com/photos/103124/pexels-photo-103124.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "dairy", name: "Dairy, Bread & Eggs", img: "https://images.pexels.com/photos/248412/pexels-photo-248412.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "veggies", name: "Fruits & Vegetables", img: "https://images.pexels.com/photos/144248/potatoes-vegetables-erdfrucht-bio-144248.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "drinks", name: "Cold Drinks & Juices", img: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Coca-Cola_can_-_2020.jpg/220px-Coca-Cola_can_-_2020.jpg" },
  { id: "snacks", name: "Snacks & Munchies", img: "https://images.pexels.com/photos/568805/pexels-photo-568805.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "breakfast", name: "Breakfast & Instant Food", img: "https://images.pexels.com/photos/884600/pexels-photo-884600.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "sweets", name: "Sweet Tooth", img: "https://images.pexels.com/photos/65882/chocolate-dark-coffee-confiserie-65882.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "bakery", name: "Bakery & Biscuits", img: "https://images.pexels.com/photos/1395319/pexels-photo-1395319.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "tea", name: "Tea, Coffee & Milk Drinks", img: "https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "staples", name: "Atta, Rice & Dal", img: "https://images.pexels.com/photos/6287295/pexels-photo-6287295.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "masala", name: "Masala, Oil & More", img: "https://images.pexels.com/photos/33783/olive-oil-salad-dressing-cooking-olive.jpg?auto=compress&cs=tinysrgb&w=150" },
  { id: "sauces", name: "Sauces & Spreads", img: "https://images.pexels.com/photos/1435735/pexels-photo-1435735.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "meat", name: "Chicken, Meat & Fish", img: "https://images.pexels.com/photos/618775/pexels-photo-618775.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "organic", name: "Organic & Healthy", img: "https://images.pexels.com/photos/7421213/pexels-photo-7421213.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "baby", name: "Baby Care", img: "https://images.pexels.com/photos/3845492/pexels-photo-3845492.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "pharma", name: "Pharma & Wellness", img: "https://images.pexels.com/photos/593451/pexels-photo-593451.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "cleaning", name: "Cleaning Essentials", img: "https://images.pexels.com/photos/5202925/pexels-photo-5202925.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "home", name: "Home & Office", img: "https://images.pexels.com/photos/4198024/pexels-photo-4198024.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "personal", name: "Personal Care", img: "https://images.pexels.com/photos/6621376/pexels-photo-6621376.jpeg?auto=compress&cs=tinysrgb&w=150" },
  { id: "pet", name: "Pet Care", img: "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=150" }
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
          <input 
            type="file" 
            accept="image/*" 
            onchange="handleCategoryDirectFile(event, '${cat.id}')"
            class="text-[9px] file:mr-1 file:py-1 file:px-2 file:rounded file:border-0 file:text-[9px] file:bg-[#1C2541] file:text-white border border-slate-200 rounded p-0.5 bg-white cursor-pointer w-full"
          >
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

    document.getElementById(`cat_preview_${catId}`).src = compressedCatBase64;
    alert("Category photo updated!");
  } catch(err) {
    alert("Error: " + err.message);
  }
}

// 1-TAP COLOR STATUS BUTTONS
function renderStatusPills(orderId, currentStatus) {
  const statuses = [
    { key: "Order Confirmed", label: "Confirmed", active: "bg-amber-500 text-white font-black scale-105 shadow", inactive: "bg-amber-50 text-amber-900 border-amber-200" },
    { key: "Packing", label: "Packing", active: "bg-orange-500 text-white font-black scale-105 shadow", inactive: "bg-orange-50 text-orange-900 border-orange-200" },
    { key: "Out for Delivery", label: "Dispatched", active: "bg-blue-600 text-white font-black scale-105 shadow", inactive: "bg-blue-50 text-blue-900 border-blue-200" },
    { key: "Delivered", label: "Delivered", active: "bg-emerald-600 text-white font-black scale-105 shadow", inactive: "bg-emerald-50 text-emerald-900 border-emerald-200" }
  ];

  return `
    <div class="flex items-center gap-1 p-1 bg-white rounded-xl border border-slate-200">
      ${statuses.map(s => {
        const isCurrent = currentStatus === s.key;
        return `
          <button 
            type="button"
            onclick="quickSetStatus('${orderId}', '${s.key}')" 
            class="px-2 py-1 rounded-lg text-xs font-bold border transition ${isCurrent ? s.active : s.inactive + ' opacity-70'}"
          >
            ${isCurrent ? '✓ ' : ''}${s.label}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

async function quickSetStatus(orderId, newStatus) {
  try {
    await db.collection("orders").doc(orderId).update({
      status: newStatus,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {
    console.error(e);
  }
}

function startLiveOrderQueue() {
  const container = document.getElementById('adminQueueContainer');

  db.collection("orders").onSnapshot((snapshot) => {
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    
    // Sort descending
    orders.sort((a, b) => (b.created_at_ms || 0) - (a.created_at_ms || 0));
    allFetchedOrders = orders;

    const activeCount = orders.filter(o => o.status !== "Delivered").length;
    const deliveredCount = orders.filter(o => o.status === "Delivered").length;
    document.getElementById('metricActiveOrders').innerText = activeCount;
    document.getElementById('metricDelivered').innerText = deliveredCount;

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
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-[#0B132B] text-sm">${o.id}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">${o.status}</span>
            <span class="text-[11px] font-black text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">OTP: ${o.delivery_otp || '4821'}</span>
          </div>
          <p class="text-xs text-slate-800 font-bold">${o.delivery_address} • 📞 ${o.customer_phone}</p>
          ${itemsSummary ? `<p class="text-[11px] text-slate-600 bg-white p-1.5 rounded-xl border border-slate-200 inline-block font-semibold">📦 ${itemsSummary}</p>` : ''}
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <span class="text-sm font-black text-emerald-600">₹${o.total_amount || o.total}</span>
          ${renderStatusPills(o.id, o.status)}
        </div>
      `;
      container.appendChild(row);
    });

    if (!document.getElementById('analyticsViewSection').classList.contains('hidden')) {
      calculateAndRenderAnalytics();
    }
  });
}

// --- DATE-WISE SALES & REPORTS ENGINE ---
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
        <td class="py-2.5 px-3 font-bold text-emerald-600">${o.status || 'Delivered'}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('statTodayRevenue').innerText = `₹${revenue}`;
  document.getElementById('statOnlinePaid').innerText = `₹${online}`;
  document.getElementById('statCodPaid').innerText = `₹${cod}`;
  document.getElementById('statTotalOrders').innerText = filtered.length;
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
  if (sessionStorage.getItem('hub_session_unlocked') === 'true') {
    const lock = document.getElementById('adminAuthLock');
    if (lock) lock.classList.add('hidden');
    switchView('orders');
  }
  startLiveOrderQueue();
  loadAdminInventory();
});