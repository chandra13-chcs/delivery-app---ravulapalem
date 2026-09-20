// ==========================================
// 🛵 DELIVERY PARTNER ENGINE (rider.js)
// ==========================================

const RIDER_NAMES = ["Chandu", "Pranith", "Dinesh", "Sunil", "Raju", "Dhoni", "Sachin", "Virat", "Rohit", "Gambhie"];
let currentActiveRider = localStorage.getItem('active_rider_name') || RIDER_NAMES[0];
let currentTab = 'pending';
let allRiderOrders = [];
let currentVerifyingOrderId = null;
let gpsWatchId = null;

function populateRiderSelector() {
  const select = document.getElementById('riderSelect');
  if (!select) return;
  select.innerHTML = RIDER_NAMES.map(name => `<option value="${name}">Rider: ${name}</option>`).join('');
}

function switchRider(name) {
  currentActiveRider = name;
  localStorage.setItem('active_rider_name', name);
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = name;
  renderRiderOrders();
}

function toggleRiderTab(tab) {
  currentTab = tab;
  const btnPending = document.getElementById('tabPendingBtn');
  const btnCompleted = document.getElementById('tabCompletedBtn');

  if (tab === 'pending') {
    btnPending.className = "flex-1 py-2 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-sm transition";
    btnCompleted.className = "flex-1 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 transition";
  } else {
    btnPending.className = "flex-1 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-900 transition";
    btnCompleted.className = "flex-1 py-2 rounded-lg text-xs font-bold bg-white text-slate-900 shadow-sm transition";
  }
  renderRiderOrders();
}

function startRiderOrdersListener() {
  db.collection("orders").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    allRiderOrders = orders;
    renderRiderOrders();
  });
}

// --- REAL-TIME GPS STREAMING TO FIRESTORE ---
function startRiderGpsBroadcast() {
  if (!navigator.geolocation) return;
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

  gpsWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      try {
        await db.collection("riders_location").doc(currentActiveRider).set({
          rider_name: currentActiveRider,
          lat: latitude,
          lng: longitude,
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } catch (err) {
        console.error("GPS Broadcast Error:", err);
      }
    },
    (err) => console.warn("GPS Warning:", err.message),
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
  );
}

function stopRiderGpsBroadcast() {
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
}

function getPickupGroups(order) {
  const groups = {};
  const items = Array.isArray(order.items) ? order.items : [];
  items.forEach(item => {
    const key = item.pickup_source || "store";
    if (!groups[key]) {
      groups[key] = {
        key,
        name: item.pickup_source_name || "MyShopzy Store",
        address: item.pickup_source_address || "Ravulapalem RTC Dark Store",
        items: []
      };
    }
    groups[key].items.push(item);
  });

  if (!Object.keys(groups).length) {
    groups.store = {
      key: "store",
      name: "MyShopzy Store",
      address: "Ravulapalem RTC Dark Store",
      items: []
    };
  }
  return Object.values(groups);
}

function renderPickupChecklist(order) {
  const priority = { store: 1, vegetable_partner: 2, meat_partner: 3, restaurant: 4 };
  const groups = getPickupGroups(order).sort((a, b) => (priority[a.key] || 9) - (priority[b.key] || 9));
  const completed = order.pickup_progress || {};
  const allPicked = groups.every(group => completed[group.key]);
  const nextGroup = groups.find(group => !completed[group.key]);
  const hasSourceMetadata = Array.isArray(order.items) && order.items.some(item => item.pickup_source);

  return `
    <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-black uppercase text-amber-900">Pickup plan · ${groups.length} source${groups.length === 1 ? '' : 's'}</span>
        <span class="text-[10px] font-bold text-amber-700">${groups.filter(group => completed[group.key]).length}/${groups.length} ready</span>
      </div>
      ${!hasSourceMetadata ? '<p class="text-[10px] font-bold text-rose-700">Older order: source details were not saved. Recreate the order after assigning product pickup sources in Admin.</p>' : ''}
      ${groups.map(group => `
        <button ${!completed[group.key] && nextGroup?.key !== group.key ? 'disabled' : ''} onclick="markPickupComplete('${order.id}', '${group.key}')" class="w-full text-left p-2 bg-white border ${completed[group.key] ? 'border-emerald-300' : 'border-amber-200'} rounded-lg flex items-center gap-2 ${!completed[group.key] && nextGroup?.key !== group.key ? 'opacity-50 cursor-not-allowed' : ''}">
          <span class="w-5 h-5 rounded-full ${completed[group.key] ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'} flex items-center justify-center text-[10px] font-black">${completed[group.key] ? '✓' : '○'}</span>
          <span class="min-w-0 flex-1"><strong class="block text-[11px] text-slate-900">${group.name}</strong><span class="block text-[10px] text-slate-500 truncate">${group.address}</span><span class="block text-[10px] text-slate-500">${group.items.map(item => `${item.quantity}x ${item.name}`).join(', ') || 'Legacy order items'}</span></span>
          <span class="text-[10px] font-black ${completed[group.key] ? 'text-emerald-600' : 'text-amber-700'}">${completed[group.key] ? 'Picked' : nextGroup?.key === group.key ? 'Mark picked' : 'Next'}</span>
        </button>
      `).join('')}
      ${!allPicked ? '<p class="text-[10px] font-bold text-amber-800">Complete every pickup before starting delivery.</p>' : ''}
    </div>
  `;
}

async function markPickupComplete(orderId, sourceKey) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order) return;
  const pickupProgress = { ...(order.pickup_progress || {}), [sourceKey]: true };
  try {
    await db.collection("orders").doc(orderId).update({
      pickup_progress: pickupProgress,
      status: "PICKING_UP",
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    alert("Pickup update failed: " + error.message);
  }
}

function canStartDelivery(order) {
  return getPickupGroups(order).every(group => order.pickup_progress?.[group.key]);
}

function renderRiderOrders() {
  const container = document.getElementById('riderOrdersContainer');
  if (!container) return;
  
  const riderOrders = allRiderOrders.filter(o => o.assigned_rider === currentActiveRider);
  const pendingList = riderOrders.filter(o => String(o.status || "").toUpperCase() !== "DELIVERED");
  const completedList = riderOrders.filter(o => String(o.status || "").toUpperCase() === "DELIVERED");

  const pendingBadge = document.getElementById('pendingCount');
  if (pendingBadge) pendingBadge.innerText = pendingList.length;

  const activeDisplayList = currentTab === 'pending' ? pendingList : completedList;

  if (activeDisplayList.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-white rounded-2xl border border-brand-border space-y-2">
        <p class="text-2xl">📦</p>
        <p class="text-xs font-bold text-slate-600">No ${currentTab} orders found for ${currentActiveRider}</p>
        <p class="text-[10px] text-slate-400">Hub orders will appear here automatically</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  activeDisplayList.forEach(o => {
    const card = document.createElement('div');
    card.className = "p-4 bg-white rounded-2xl border border-brand-border shadow-sm space-y-3";

    let itemsText = "";
    if (Array.isArray(o.items)) itemsText = o.items.map(i => `${i.quantity}x ${i.name}`).join(", ");

    const encodedAddress = encodeURIComponent(o.delivery_address || 'Ravulapalem');

    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-100 pb-2">
        <span class="text-xs font-black text-brand-navy">${o.id}</span>
          <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full ${String(o.status || '').toUpperCase() === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
          ${o.status}
        </span>
      </div>

      <div>
        <p class="text-xs font-bold text-slate-900">${o.delivery_address}</p>
        ${itemsText ? `<p class="text-[11px] text-slate-500 mt-1">📦 ${itemsText}</p>` : ''}
        ${renderPickupChecklist(o)}
        <div class="flex items-center justify-between mt-2 text-xs">
          <span class="font-extrabold text-slate-900">Total: ₹${o.total_amount || o.total}</span>
          <span class="text-[11px] font-bold ${o.payment_mode === 'COD' ? 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded' : 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded'}">
            ${o.payment_mode === 'COD' ? 'Collect Cash at Door' : 'Paid Online'}
          </span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 pt-1">
        <a href="tel:${o.customer_phone}" class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="phone" class="w-3.5 h-3.5 text-brand-accent"></i> Call
        </a>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodedAddress}" target="_blank" class="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-brand-accent rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="navigation" class="w-3.5 h-3.5"></i> Maps
        </a>
      </div>

      ${String(o.status || '').toUpperCase() !== 'DELIVERED' ? `
        <div class="pt-1 flex gap-2">
          ${o.status !== 'Out for Delivery' && canStartDelivery(o) ? `
            <button onclick="setOutForDelivery('${o.id}')" class="flex-1 py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5">
              <span>Start Delivery (Broadcast GPS)</span>
            </button>
          ` : o.status === 'Out for Delivery' ? `
            <div class="flex-1 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] font-bold text-emerald-700 flex items-center justify-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Live GPS Streaming
            </div>
          ` : `<div class="flex-1 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500 text-center">Finish all pickups first</div>`}
          <button onclick="openOtpModal('${o.id}')" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition">
            Verify OTP
          </button>
        </div>
      ` : ''}
    `;
    container.appendChild(card);
  });
  if (window.lucide) lucide.createIcons();
}

async function setOutForDelivery(orderId) {
  try {
    const order = allRiderOrders.find(item => item.id === orderId);
    if (!order || !canStartDelivery(order)) {
      alert("Complete every pickup before starting delivery.");
      return;
    }
    startRiderGpsBroadcast();
    await db.collection("orders").doc(orderId).update({ 
      status: "Out for Delivery",
      dispatched_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch(e) {
    alert("Error: " + e.message);
  }
}

// DIRECT DATASET-BASED SAFE OTP MODAL
function openOtpModal(orderId) {
  currentVerifyingOrderId = orderId;
  const foundOrder = allRiderOrders.find(o => o.id === orderId);
  if (!foundOrder) return;

  const inputEl = document.getElementById('inputDeliveryOtp');
  inputEl.value = '';
  inputEl.dataset.expectedOtp = foundOrder.delivery_otp;
  
  document.getElementById('otpErrorMessage').classList.add('hidden');
  document.getElementById('otpModal').classList.remove('hidden');
  inputEl.focus();
}

function closeOtpModal() {
  document.getElementById('otpModal').classList.add('hidden');
  currentVerifyingOrderId = null;
}

async function confirmOtpAndDeliver() {
  const inputEl = document.getElementById('inputDeliveryOtp');
  const enteredOtp = inputEl.value.trim();
  const expectedOtp = inputEl.dataset.expectedOtp;

  if (!currentVerifyingOrderId) {
    alert("Session expired. Please click 'Verify OTP' again.");
    return;
  }

  if (enteredOtp === expectedOtp) {
    try {
      await db.collection("orders").doc(currentVerifyingOrderId).update({
        status: "Delivered",
        payment_status: "COMPLETED",
        delivered_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      const deliveredId = currentVerifyingOrderId;
      closeOtpModal();
      stopRiderGpsBroadcast();
      alert(`Order ${deliveredId} verified & Delivered successfully!`);
    } catch(e) {
      alert("Update failed: " + e.message);
    }
  } else {
    document.getElementById('otpErrorMessage').classList.remove('hidden');
  }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
  populateRiderSelector();
  const selectEl = document.getElementById('riderSelect');
  if (!RIDER_NAMES.includes(currentActiveRider)) currentActiveRider = RIDER_NAMES[0];
  if (selectEl) selectEl.value = currentActiveRider;
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider;

  startRiderOrdersListener();
  startRiderGpsBroadcast();
  if (window.lucide) lucide.createIcons();
});