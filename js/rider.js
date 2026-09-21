// ==========================================
// 🛵 DELIVERY PARTNER ENGINE (rider.js)
// ==========================================

let riderProfile = JSON.parse(localStorage.getItem('rider_profile') || 'null');
let currentActiveRider = riderProfile?.name || localStorage.getItem('active_rider_name') || '';
let currentTab = 'pending';
let allRiderOrders = [];
let currentVerifyingOrderId = null;
let gpsWatchId = null;
let riderIsAvailable = localStorage.getItem('rider_available') === 'true' && isWithinWorkingHours();
let knownAssignedOrderIds = new Set();
let riderOrdersInitialized = false;
let riderOtpSent = false;
const RIDER_ORDER_SOUND = new Audio("assets/audio/admin-rider-order.mpeg");
const RIDER_TAB_SOUND = new Audio("assets/audio/tab-click.wav");
RIDER_ORDER_SOUND.loop = true;

function formatOrderDateTime(order) {
  let date = null;
  if (Number.isFinite(Number(order?.created_at_ms))) {
    date = new Date(Number(order.created_at_ms));
  } else if (order?.created_at?.toDate) {
    date = order.created_at.toDate();
  } else if (order?.created_at?.seconds) {
    date = new Date(Number(order.created_at.seconds) * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function isWithinWorkingHours() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 22;
}

function showRiderSection(section) {
  const sections = {
    home: document.getElementById('riderHomeSection'),
    orders: document.getElementById('riderOrdersSection'),
    account: document.getElementById('riderAccountSection')
  };
  Object.entries(sections).forEach(([name, element]) => {
    if (element) element.classList.toggle('hidden', name !== section);
  });
  if (section === 'orders') renderRiderOrders();
  if (section === 'account') syncRiderAccount();
}

function openRiderRegistrationModal() {
  document.getElementById('riderRegistrationModal')?.classList.remove('hidden');
  syncRiderAccount();
}

function closeRiderRegistrationModal() {
  document.getElementById('riderRegistrationModal')?.classList.add('hidden');
}

function openRiderLoginModal() {
  document.getElementById('riderLoginModal')?.classList.remove('hidden');
  document.getElementById('riderLoginIdentityInput')?.focus();
}

function closeRiderLoginModal() {
  document.getElementById('riderLoginModal')?.classList.add('hidden');
}

function sendRiderRegistrationOtp() {
  const mobile = document.getElementById('riderMobileInput')?.value.replace(/\D/g, '');
  if (mobile.length !== 10) {
    alert('Enter a valid 10-digit mobile number.');
    return;
  }
  riderOtpSent = true;
  alert('Demo OTP: 4821');
}

async function hashRiderPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function completeRiderRegistration() {
  const name = document.getElementById('riderNameInput')?.value.trim();
  const mobile = document.getElementById('riderMobileInput')?.value.replace(/\D/g, '');
  const email = document.getElementById('riderEmailInput')?.value.trim().toLowerCase();
  const aadhaar = document.getElementById('riderAadhaarInput')?.value.replace(/\D/g, '');
  const password = document.getElementById('riderPasswordInput')?.value;
  const otp = document.getElementById('riderOtpInput')?.value.trim();

  if (!name || mobile.length !== 10 || !email || aadhaar.length !== 12 || !password || password.length < 6) {
    alert('Complete name, mobile, email, 12-digit Aadhaar, and a 6-character password.');
    return;
  }
  if (!riderOtpSent || otp !== '4821') {
    alert('Send the OTP first and enter the demo OTP: 4821');
    return;
  }

  const passwordHash = await hashRiderPassword(password);
  const profile = { name, mobile, email, aadhaar_last4: aadhaar.slice(-4), password_hash: passwordHash, registered_at_ms: Date.now() };
  riderProfile = profile;
  currentActiveRider = name;
  localStorage.setItem('rider_profile', JSON.stringify(profile));
  localStorage.setItem('active_rider_name', name);
  try {
    await db.collection('rider_profiles').doc(mobile).set(profile, { merge: true });
  } catch (error) {
    console.error('Rider profile save failed:', error);
    alert('Profile saved on this device. Firebase profile sync failed.');
  }
  closeRiderRegistrationModal();
  updateRiderIdentity();
  alert(`Welcome ${name}. Rider registration completed.`);
}

async function loginRider() {
  const identity = document.getElementById('riderLoginIdentityInput')?.value.trim();
  const password = document.getElementById('riderLoginPasswordInput')?.value || '';
  const errorElement = document.getElementById('riderLoginError');
  if (!identity || !password) {
    if (errorElement) {
      errorElement.innerText = 'Enter your mobile/email and password.';
      errorElement.classList.remove('hidden');
    }
    return;
  }

  try {
    const normalizedMobile = identity.replace(/\D/g, '');
    let profileDoc = normalizedMobile.length === 10
      ? await db.collection('rider_profiles').doc(normalizedMobile).get()
      : null;
    if (!profileDoc?.exists) {
      const snapshot = await db.collection('rider_profiles').where('email', '==', identity.toLowerCase()).limit(1).get();
      profileDoc = snapshot.docs[0] || null;
    }
    const profile = profileDoc?.exists ? profileDoc.data() : null;
    const passwordHash = await hashRiderPassword(password);
    if (!profile || profile.password_hash !== passwordHash) throw new Error('Invalid rider credentials.');

    riderProfile = profile;
    currentActiveRider = profile.name;
    localStorage.setItem('rider_profile', JSON.stringify(profile));
    localStorage.setItem('active_rider_name', profile.name);
    closeRiderLoginModal();
    updateRiderIdentity();
    alert(`Welcome back, ${profile.name}.`);
  } catch (error) {
    console.error('Rider login failed:', error);
    if (errorElement) {
      errorElement.innerText = error.message || 'Unable to sign in.';
      errorElement.classList.remove('hidden');
    }
  }
}

function syncRiderAccount() {
  const fields = {
    riderAccountName: riderProfile?.name || currentActiveRider,
    riderAccountMobile: riderProfile?.mobile || '-',
    riderAccountEmail: riderProfile?.email || '-',
    riderAccountAadhaar: riderProfile?.aadhaar_last4 ? `•••• ${riderProfile.aadhaar_last4}` : '-'
  };
  Object.entries(fields).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function updateRiderIdentity() {
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider || 'Not registered';
  syncRiderAccount();
  updateAvailabilityUi();
}

async function logoutRider() {
  const riderName = currentActiveRider;
  stopRiderGpsBroadcast();
  riderIsAvailable = false;
  if (riderName) {
    try {
      await db.collection('riders_location').doc(riderName).set({
        rider_name: riderName,
        available: false,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.warn('Rider offline status sync failed:', error);
    }
  }
  riderProfile = null;
  currentActiveRider = '';
  localStorage.removeItem('rider_profile');
  localStorage.removeItem('active_rider_name');
  localStorage.removeItem('rider_available');
  updateRiderIdentity();
  allRiderOrders = [];
  renderPickupQueue();
  renderRiderOrders();
  showRiderSection('account');
}

function updateAvailabilityUi() {
  const button = document.getElementById('riderAvailabilityToggle');
  const loginButton = document.getElementById('riderLoginButton');
  const registerButton = document.getElementById('riderRegisterButton');
  const status = document.getElementById('riderDutyStatus');
  if (loginButton) loginButton.classList.toggle('hidden', Boolean(riderProfile?.name));
  if (registerButton) registerButton.classList.toggle('hidden', Boolean(riderProfile?.name));
  if (button) {
    button.innerText = riderIsAvailable ? 'Go offline' : 'Go online';
    button.className = riderIsAvailable
      ? 'px-3 py-1.5 rounded-xl bg-rose-100 text-rose-700 text-[10px] font-black'
      : 'px-3 py-1.5 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black';
  }
  if (status) {
    status.innerHTML = riderIsAvailable
      ? '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> On-duty (7 AM - 10 PM)'
      : '<span class="w-2 h-2 rounded-full bg-slate-400"></span> Off-duty';
    status.className = riderIsAvailable
      ? 'text-[11px] text-emerald-600 font-bold flex items-center gap-1.5 mt-0.5'
      : 'text-[11px] text-slate-500 font-bold flex items-center gap-1.5 mt-0.5';
  }
}

async function toggleRiderAvailability() {
  if (!riderProfile?.name || !currentActiveRider) {
    alert('Register your rider profile before going online.');
    return;
  }
  if (!riderIsAvailable && !isWithinWorkingHours()) {
    alert('Rider availability is open only from 7:00 AM to 10:00 PM.');
    return;
  }
  riderIsAvailable = !riderIsAvailable;
  localStorage.setItem('rider_available', String(riderIsAvailable));
  if (riderIsAvailable) startRiderGpsBroadcast();
  else stopRiderGpsBroadcast();
  updateAvailabilityUi();
  try {
    await db.collection('riders_location').doc(currentActiveRider).set({
      rider_name: currentActiveRider,
      available: riderIsAvailable,
      working_hours: '07:00-22:00',
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.error('Rider availability update failed:', error);
  }
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
    const assignedNow = orders.filter(order => order.assigned_rider === currentActiveRider && String(order.status || '').toUpperCase() !== 'DELIVERED');
    const newlyAssigned = assignedNow.filter(order => !knownAssignedOrderIds.has(order.id));
    if (riderOrdersInitialized && newlyAssigned.length > 0) {
      notifyNewAssignment(newlyAssigned[0]);
    }
    knownAssignedOrderIds = new Set(assignedNow.map(order => order.id));
    riderOrdersInitialized = true;
    allRiderOrders = orders;
    renderPickupQueue();
    renderRiderOrders();
  });
}

function notifyNewAssignment(order) {
  RIDER_ORDER_SOUND.currentTime = 0;
  RIDER_ORDER_SOUND.play().catch(() => {});
  const banner = document.getElementById('riderAlertBanner');
  if (banner) {
    banner.innerHTML = `
      <div>New delivery assigned: <strong>${order.id}</strong>. <button type="button" onclick="openRiderOrderAlert()" class="underline font-black">Open orders</button></div>
      <div class="flex flex-wrap gap-2 mt-2">
        <button type="button" onclick="acceptRiderOrder('${order.id}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-black">Accept</button>
        <button type="button" onclick="rejectRiderOrder('${order.id}')" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-800 font-black">Reject</button>
        <button type="button" onclick="stopRiderOrderAlertSound()" class="px-3 py-1.5 rounded-lg bg-amber-200 text-amber-950">Stop sound</button>
      </div>`;
    banner.classList.remove('hidden');
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('New MyShopzy delivery', { body: `Order ${order.id} is ready in your queue.` });
  }
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function openRiderOrderAlert() {
  stopRiderOrderAlertSound();
  showRiderSection('orders');
}

function stopRiderOrderAlertSound() {
  RIDER_ORDER_SOUND.pause();
  RIDER_ORDER_SOUND.currentTime = 0;
}

async function acceptRiderOrder(orderId) {
  try {
    await db.collection("orders").doc(orderId).update({
      status: "ACCEPTED_BY_RIDER",
      rider_accepted_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    stopRiderOrderAlertSound();
    const banner = document.getElementById('riderAlertBanner');
    if (banner) banner.classList.add('hidden');
  } catch (error) {
    alert(`Unable to accept delivery: ${error.message}`);
  }
}

async function rejectRiderOrder(orderId) {
  try {
    await db.collection("orders").doc(orderId).update({
      status: "REJECTED_BY_RIDER",
      assigned_rider: firebase.firestore.FieldValue.delete(),
      rejected_by_rider: currentActiveRider,
      rider_rejected_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    stopRiderOrderAlertSound();
    const banner = document.getElementById('riderAlertBanner');
    if (banner) banner.classList.add('hidden');
  } catch (error) {
    alert(`Unable to reject delivery: ${error.message}`);
  }
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
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.address)}" target="_blank" class="block text-[10px] text-blue-600 font-bold text-right -mt-1">Open pickup location ↗</a>
      `).join('')}
      ${!allPicked ? '<p class="text-[10px] font-bold text-amber-800">Complete every pickup before starting delivery.</p>' : ''}
    </div>
  `;
}

function renderPickupQueue() {
  const container = document.getElementById('pickupQueueContainer');
  if (!container) return;
  const activeOrders = allRiderOrders
    .filter(order => order.assigned_rider === currentActiveRider && String(order.status || '').toUpperCase() !== 'DELIVERED')
    .sort((a, b) => (a.created_at_ms || 0) - (b.created_at_ms || 0));

  if (!activeOrders.length) {
    container.innerHTML = '<p class="text-center text-slate-400 py-8 text-xs">No active pickups. Stay online for new assignments.</p>';
    return;
  }

  container.innerHTML = activeOrders.map((order, index) => {
    const groups = getPickupGroups(order);
    const completed = order.pickup_progress || {};
    const next = groups.find(group => !completed[group.key]);
    return `<button onclick="showRiderSection('orders')" class="w-full text-left bg-white rounded-2xl p-3 border border-brand-border shadow-sm flex items-center gap-3">
      <span class="w-7 h-7 rounded-full bg-brand-navy text-white flex items-center justify-center text-xs font-black">${index + 1}</span>
      <span class="min-w-0 flex-1"><strong class="block text-xs text-slate-900">${order.id}</strong><span class="block text-[10px] text-slate-500 truncate">Next: ${next ? next.name : 'Ready for delivery'}</span><span class="block text-[10px] text-slate-400">${groups.filter(group => completed[group.key]).length}/${groups.length} pickup points complete</span></span>
      <span class="text-[10px] font-black ${next ? 'text-amber-700' : 'text-emerald-600'}">${next ? 'Pickup' : 'Ready'}</span>
    </button>`;
  }).join('');
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
    const customerMapUrl = Number.isFinite(Number(o.delivery_latitude)) && Number.isFinite(Number(o.delivery_longitude))
      ? `https://www.google.com/maps/search/?api=1&query=${o.delivery_latitude},${o.delivery_longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-100 pb-2">
        <div><span class="block text-xs font-black text-brand-navy">${o.id}</span><span class="block text-[10px] text-slate-500 font-semibold">🕒 ${formatOrderDateTime(o)}</span></div>
          <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full ${String(o.status || '').toUpperCase() === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
          ${o.status}
        </span>
      </div>

      <div>
        <p class="text-xs font-bold text-slate-900">${o.delivery_address}</p>
        ${itemsText ? `<p class="text-[11px] text-slate-500 mt-1">📦 ${itemsText}</p>` : ''}
        ${String(o.status || '').toUpperCase() === 'ACCEPTED'
          ? '<div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-800">Accept this delivery before starting pickup.</div>'
          : renderPickupChecklist(o)}
        <div class="flex items-center justify-between mt-2 text-xs">
          <span class="font-extrabold text-slate-900">Total: ₹${o.total_amount || o.total}</span>
          <span class="text-[11px] font-bold ${o.payment_mode === 'COD' ? 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded' : 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded'}">
            ${o.payment_mode === 'COD' ? 'Collect Cash at Door' : 'Paid Online'}
          </span>
        </div>
        ${Number(o.rider_tip || 0) > 0 ? `<p class="text-[11px] font-black text-amber-700 mt-1">🎁 Rider tip: ₹${Number(o.rider_tip)}</p>` : ''}
      </div>

      <div class="grid grid-cols-2 gap-2 pt-1">
        <a href="tel:${o.customer_phone}" class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="phone" class="w-3.5 h-3.5 text-brand-accent"></i> Call
        </a>
        <a href="${customerMapUrl}" target="_blank" class="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-brand-accent rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="navigation" class="w-3.5 h-3.5"></i> Maps
        </a>
      </div>

      ${String(o.status || '').toUpperCase() !== 'DELIVERED' ? `
        <div class="pt-1 flex gap-2">
          ${!['ACCEPTED_BY_RIDER', 'OUT FOR DELIVERY', 'DELIVERED'].includes(String(o.status || '').toUpperCase()) ? `
            <button onclick="acceptRiderOrder('${o.id}')" class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black transition">Accept delivery</button>
          ` : String(o.status || '').toUpperCase() === 'ACCEPTED_BY_RIDER' && canStartDelivery(o) ? `
            <button onclick="setOutForDelivery('${o.id}')" class="flex-1 py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5">
              <span>Start Delivery (Broadcast GPS)</span>
            </button>
          ` : o.status !== 'Out for Delivery' && canStartDelivery(o) ? `
            <button onclick="setOutForDelivery('${o.id}')" class="flex-1 py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5">
              <span>Start Delivery (Broadcast GPS)</span>
            </button>
          ` : o.status === 'Out for Delivery' ? `
            <div class="flex-1 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] font-bold text-emerald-700 flex items-center justify-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Live GPS Streaming
            </div>
          ` : `<div class="flex-1 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500 text-center">Accept delivery first</div>`}
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
  document.addEventListener('click', event => {
    if (event.target.closest('button, [onclick]')) {
      RIDER_TAB_SOUND.currentTime = 0;
      RIDER_TAB_SOUND.play().catch(() => {});
    }
  });
  if (!riderProfile?.name) currentActiveRider = '';
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider;

  updateRiderIdentity();
  updateAvailabilityUi();
  showRiderSection('home');
  startRiderOrdersListener();
  if (riderIsAvailable && isWithinWorkingHours()) startRiderGpsBroadcast();
  if (window.lucide) lucide.createIcons();
});