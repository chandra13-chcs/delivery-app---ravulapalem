// ==========================================
// 🛡️ ADMIN OPERATIONS HUB ENGINE (admin.js)
// ==========================================

// --- TERMINAL ACCESS LOCK ---
const STORE_TERMINAL_PIN = "748801"; // Default PIN

function verifyAdminAccess() {
  const entered = document.getElementById('adminPinInput').value;
  if (entered === STORE_TERMINAL_PIN) {
    sessionStorage.setItem('hub_session_unlocked', 'true');
    document.getElementById('adminAuthLock').classList.add('hidden');
  } else {
    document.getElementById('pinErrorMsg').classList.remove('hidden');
  }
}

if (sessionStorage.getItem('hub_session_unlocked') === 'true') {
  const lock = document.getElementById('adminAuthLock');
  if (lock) lock.classList.add('hidden');
}

// --- TAB SWITCHER ---
function switchView(tab) {
  const ordersSec = document.getElementById('ordersViewSection');
  const invSec = document.getElementById('inventoryViewSection');
  const btnOrders = document.getElementById('tabBtnOrders');
  const btnInv = document.getElementById('tabBtnInventory');

  if (tab === 'orders') {
    ordersSec.classList.remove('hidden');
    invSec.classList.add('hidden');
    btnOrders.className = "px-4 py-2 rounded-xl text-xs font-bold bg-brand-accent text-white flex items-center gap-1.5 transition shadow-sm";
    btnInv.className = "px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5 transition";
  } else {
    ordersSec.classList.add('hidden');
    invSec.classList.remove('hidden');
    btnInv.className = "px-4 py-2 rounded-xl text-xs font-bold bg-brand-accent text-white flex items-center gap-1.5 transition shadow-sm";
    btnOrders.className = "px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white flex items-center gap-1.5 transition";
  }
  if (window.lucide) lucide.createIcons();
}

// --- AUDIO CHIME ENGINE ---
let audioAlertsEnabled = true;
let audioCtx = null;

function initAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playOrderAlertSound() {
  if (!audioAlertsEnabled) return;
  try {
    initAudioContext();
    const now = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.45, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.7);
  } catch (err) {}
}

function toggleAudioState() {
  audioAlertsEnabled = !audioAlertsEnabled;
  const btn = document.getElementById('toggleSoundBtn');
  btn.innerText = audioAlertsEnabled ? "Alert: Active" : "Alert: Muted";
  btn.className = audioAlertsEnabled ? "px-3 py-1.5 rounded-xl bg-slate-700 text-slate-200 text-xs font-bold" : "px-3 py-1.5 rounded-xl bg-rose-900 text-rose-200 text-xs font-bold";
}

// --- LIVE ORDERS DISPATCH QUEUE ---
let previousOrderCount = 0;
let isInitialRun = true;

function startLiveOrderQueue() {
  const container = document.getElementById('adminQueueContainer');

  db.collection("orders").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

    if (!isInitialRun && orders.length > previousOrderCount) {
      playOrderAlertSound();
    }
    isInitialRun = false;
    previousOrderCount = orders.length;

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
      row.className = "p-4 rounded-2xl bg-slate-50 border border-brand-border flex flex-col md:flex-row md:items-center justify-between gap-4";
      
      let itemsSummary = "";
      if (Array.isArray(o.items)) itemsSummary = o.items.map(i => `${i.quantity}x ${i.name}`).join(", ");

      row.innerHTML = `
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-brand-navy">${o.id}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${o.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">${o.status}</span>
            <span class="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">${o.payment_mode || 'UPI'}</span>
            <span class="text-[11px] font-black text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">OTP: ${o.delivery_otp || '4821'}</span>
          </div>
          <p class="text-xs text-slate-700 font-semibold">${o.delivery_address} • Phone: ${o.customer_phone}</p>
          ${itemsSummary ? `<p class="text-[11px] text-slate-500">📦 ${itemsSummary}</p>` : ''}
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <span class="text-sm font-black text-brand-accent">₹${o.total_amount || o.total}</span>
          
          <select onchange="updateRider('${o.id}', this.value)" class="text-xs font-bold bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 outline-none">
            <option value="Suresh" ${o.assigned_rider === 'Suresh' ? 'selected' : ''}>Rider: Suresh</option>
            <option value="Ramesh" ${o.assigned_rider === 'Ramesh' ? 'selected' : ''}>Rider: Ramesh</option>
          </select>

          <select onchange="updateStatus('${o.id}', this.value)" class="text-xs font-bold bg-brand-navy text-white rounded-xl px-2.5 py-1.5 outline-none">
            <option value="Order Confirmed" ${o.status === 'Order Confirmed' ? 'selected' : ''}>Confirmed</option>
            <option value="Packing" ${o.status === 'Packing' ? 'selected' : ''}>Packing</option>
            <option value="Out for Delivery" ${o.status === 'Out for Delivery' ? 'selected' : ''}>Dispatch</option>
            <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
          </select>
        </div>
      `;
      container.appendChild(row);
    });
    if (window.lucide) lucide.createIcons();
  });
}

async function updateStatus(orderId, status) {
  try {
    await db.collection("orders").doc(orderId).update({ status: status });
  } catch(e) {
    console.error("Status update error:", e);
  }
}

async function updateRider(orderId, assigned_rider) {
  try {
    await db.collection("orders").doc(orderId).update({ assigned_rider: assigned_rider });
  } catch(e) {
    console.error("Rider update error:", e);
  }
}

// --- INVENTORY MANAGEMENT ---
let selectedBase64Image = "";

function handleImageFileSelect(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    selectedBase64Image = e.target.result;
    document.getElementById('previewImg').src = selectedBase64Image;
    document.getElementById('imagePreviewContainer').classList.remove('hidden');
    document.getElementById('pImage').value = "";
  };
  reader.readAsDataURL(file);
}

function loadAdminInventory() {
  const tbody = document.getElementById('inventoryTableBody');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Loading catalog...</td></tr>`;

  db.collection("products").onSnapshot((snapshot) => {
    let prods = [];
    snapshot.forEach(doc => prods.push({ id: doc.id, ...doc.data() }));

    document.getElementById('totalStockCount').innerText = `${prods.length} Products registered in Ravulapalem Hub`;
    tbody.innerHTML = '';

    if (prods.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">No custom products added yet. Add your first item above!</td></tr>`;
      return;
    }

    prods.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = "hover:bg-slate-50 transition";
      tr.innerHTML = `
        <td class="py-3 px-3 flex items-center gap-2.5">
          <img src="${p.image_url || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=100&q=80'}" class="w-9 h-9 rounded-lg object-cover border border-slate-200">
          <div>
            <p class="font-bold text-slate-900 line-clamp-1">${p.name}</p>
            <span class="text-[10px] text-slate-400">ID: #${p.id.substring(0, 5)}</span>
          </div>
        </td>
        <td class="py-3 px-3 uppercase text-[10px] font-bold text-slate-500">${p.category}</td>
        <td class="py-3 px-3 font-semibold text-slate-700">${p.unit}</td>
        <td class="py-3 px-3 font-black text-brand-navy">₹${p.price}</td>
        <td class="py-3 px-3 text-slate-400 line-through">₹${p.old_price || p.price}</td>
        <td class="py-3 px-3 text-right">
          <button onclick="deleteProductItem('${p.id}')" class="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-[11px] border border-rose-200 transition">
            Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();
  });
}

async function handleAddNewProduct(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('saveProdBtn');
  saveBtn.innerText = "Adding...";
  saveBtn.disabled = true;

  const finalImage = selectedBase64Image || 
                     document.getElementById('pImage').value.trim() || 
                     "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80";

  const newProd = {
    name: document.getElementById('pName').value.trim(),
    category: document.getElementById('pCategory').value,
    unit: document.getElementById('pUnit').value.trim(),
    price: Number(document.getElementById('pPrice').value),
    old_price: Number(document.getElementById('pOldPrice').value) || Number(document.getElementById('pPrice').value),
    image_url: finalImage,
    created_at: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await db.collection("products").add(newProd);
    document.getElementById('addProductForm').reset();
    selectedBase64Image = "";
    document.getElementById('imagePreviewContainer').classList.add('hidden');
    saveBtn.innerText = "Added Successfully!";
  } catch(err) {
    alert("Upload failed: " + err.message);
  }

  setTimeout(() => {
    saveBtn.innerHTML = `<i data-lucide="plus" class="w-4 h-4 text-emerald-400"></i> Add to Catalog`;
    saveBtn.disabled = false;
    if (window.lucide) lucide.createIcons();
  }, 1000);
}

async function deleteProductItem(docId) {
  if (!confirm("Are you sure you want to delete this product?")) return;
  try {
    await db.collection("products").doc(docId).delete();
  } catch(err) {
    alert("Delete failed: " + err.message);
  }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
  startLiveOrderQueue();
  loadAdminInventory();
  if (window.lucide) lucide.createIcons();
});