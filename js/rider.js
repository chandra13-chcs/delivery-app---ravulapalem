// ==========================================
// 🛵 DELIVERY PARTNER ENGINE (rider.js)
// ==========================================

let currentActiveRider = localStorage.getItem('active_rider_name') || 'Suresh';
let currentTab = 'pending';
let allRiderOrders = [];
let currentVerifyingOrderId = null;

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

function renderRiderOrders() {
  const container = document.getElementById('riderOrdersContainer');
  if (!container) return;
  
  const riderOrders = allRiderOrders.filter(o => o.assigned_rider === currentActiveRider);
  const pendingList = riderOrders.filter(o => o.status !== "Delivered");
  const completedList = riderOrders.filter(o => o.status === "Delivered");

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
        <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full ${o.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
          ${o.status}
        </span>
      </div>

      <div>
        <p class="text-xs font-bold text-slate-900">${o.delivery_address}</p>
        ${itemsText ? `<p class="text-[11px] text-slate-500 mt-1">📦 ${itemsText}</p>` : ''}
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

      ${o.status !== 'Delivered' ? `
        <div class="pt-1 flex gap-2">
          ${o.status !== 'Out for Delivery' ? `
            <button onclick="setOutForDelivery('${o.id}')" class="flex-1 py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition">
              Start Delivery
            </button>
          ` : ''}
          <button onclick="openOtpModal('${o.id}')" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition">
            Enter Delivery OTP
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
    await db.collection("orders").doc(orderId).update({ status: "Out for Delivery" });
  } catch(e) {
    alert("Error: " + e.message);
  }
}

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
    alert("Session expired. Please click 'Enter Delivery OTP' again.");
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
  const selectEl = document.getElementById('riderSelect');
  if (selectEl) selectEl.value = currentActiveRider;
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider;

  startRiderOrdersListener();
  if (window.lucide) lucide.createIcons();
});