// ==========================================
// 🛵 DELIVERY PARTNER ENGINE (rider.js)
// ==========================================

let riderProfile = JSON.parse(localStorage.getItem('rider_profile') || 'null');
let currentActiveRider = riderProfile?.name || localStorage.getItem('active_rider_name') || '';
let currentTab = 'pending';
let allRiderOrders = [];
let currentVerifyingOrderId = null;
let gpsWatchId = null;
let activeGpsAssignmentId = null;
let riderIsAvailable = localStorage.getItem('rider_available') === 'true' && isWithinWorkingHours();
let knownAssignedOrderIds = new Set();
let riderOrdersInitialized = false;
let riderOrdersUnsubscribe = null;
let riderOtpSent = false;
let pendingRiderRegistration = null;
const RIDER_ORDER_SOUND = new Audio("../assets/audio/admin-rider-order.mpeg");
const RIDER_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
const RIDER_API_BASE_URL = 'http://localhost:5000';
RIDER_ORDER_SOUND.loop = true;

function getRiderAccessToken() {
  return sessionStorage.getItem('user_access_token')
    || localStorage.getItem('user_access_token')
    || sessionStorage.getItem('myshopzy_user_access_token')
    || localStorage.getItem('myshopzy_user_access_token')
    || '';
}

function buildRiderApiHeaders(additionalHeaders = {}) {
  const headers = { ...additionalHeaders };
  const token = getRiderAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function riderApiRequest(path, options = {}) {
  const response = await fetch(`${RIDER_API_BASE_URL}${path}`, {
    headers: buildRiderApiHeaders({
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }),
    ...options
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function escapeRiderHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
}

async function hydrateRiderSession() {
  const token = getRiderAccessToken();
  if (!token) return null;
  try {
    const authUser = await riderApiRequest('/api/auth/me');
    const riderProfileResult = await riderApiRequest('/api/rider/me');
    const rider = riderProfileResult?.data?.rider || null;
    const user = authUser?.user || riderProfileResult?.data?.user || null;
    if (!rider || !user) return null;

    const mergedProfile = {
      id: rider.id,
      user_id: user.id,
      name: user.display_name || user.name || 'Rider',
      mobile: user.phone_e164 || '',
      email: user.email || '',
      verification_status: rider.verification_status || 'PENDING',
      is_available: Boolean(rider.is_available),
      vehicle_type: rider.vehicle_type || '',
      vehicle_registration: rider.vehicle_registration || '',
      license_number_last4: rider.license_number_last4 || ''
    };

    riderProfile = mergedProfile;
    currentActiveRider = mergedProfile.name;
    riderIsAvailable = mergedProfile.is_available;
    localStorage.setItem('rider_profile', JSON.stringify(mergedProfile));
    localStorage.setItem('active_rider_name', mergedProfile.name);
    updateRiderIdentity();
    return mergedProfile;
  } catch (error) {
    console.warn('Unable to hydrate rider session from backend:', error.message);
    return null;
  }
}

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

function openRiderVerificationModal() {
  document.getElementById('riderVerificationModal')?.classList.remove('hidden');
}

function closeRiderVerificationModal() {
  document.getElementById('riderVerificationModal')?.classList.add('hidden');
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
  const confirmPassword = document.getElementById('riderConfirmPasswordInput')?.value;
  const otp = document.getElementById('riderOtpInput')?.value.trim();

  if (!name || mobile.length !== 10 || !email || aadhaar.length !== 12 || !password || password.length < 6 || password !== confirmPassword) {
    alert('Complete all details and make sure both passwords match.');
    return;
  }
  if (!riderOtpSent || otp !== '4821') {
    alert('Send the OTP first and enter the demo OTP: 4821');
    return;
  }

  const profile = { name, mobile, email, aadhaar_last4: aadhaar.slice(-4), password_hash: await hashRiderPassword(password), verification_status: 'PENDING', registered_at_ms: Date.now() };
  pendingRiderRegistration = profile;
  try {
    const token = getRiderAccessToken();
    if (token) {
      const payload = {
        vehicle_type: 'BIKE',
        vehicle_registration: mobile,
        license_last4: aadhaar.slice(-4)
      };
      const result = await riderApiRequest('/api/rider/applications', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      riderProfile = { ...profile, ...result.data, id: result.data?.id || profile.id };
      currentActiveRider = profile.name;
      localStorage.setItem('rider_profile', JSON.stringify(riderProfile));
      localStorage.setItem('active_rider_name', profile.name);
    } else {
      await db.collection('rider_profiles').doc(mobile).set(profile, { merge: true });
    }
  } catch (error) {
    console.error('Rider profile save failed:', error);
    alert('Profile saved on this device. Backend rider registration failed.');
  }
  closeRiderRegistrationModal();
  document.getElementById('riderPanInput').value = '';
  document.getElementById('riderSelfieFile').value = '';
  document.getElementById('riderAadhaarFile').value = '';
  document.getElementById('riderPanFile').value = '';
  openRiderVerificationModal();
}

async function uploadRiderVerificationFile(file, mobile, type) {
  if (!file || !firebase.storage) return null;
  const storageRef = firebase.storage().ref(`rider_verification/${mobile}/${type}_${Date.now()}_${file.name}`);
  await storageRef.put(file);
  return storageRef.fullPath;
}

async function submitRiderVerification() {
  if (!pendingRiderRegistration) {
    alert('Please complete registration first.');
    return;
  }
  const panNumber = document.getElementById('riderPanInput')?.value.trim().toUpperCase();
  const selfie = document.getElementById('riderSelfieFile')?.files?.[0];
  const aadhaarPhoto = document.getElementById('riderAadhaarFile')?.files?.[0];
  const panPhoto = document.getElementById('riderPanFile')?.files?.[0];
  const status = document.getElementById('riderVerificationStatus');
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panNumber || '') || !selfie || !aadhaarPhoto || !panPhoto) {
    if (status) { status.innerText = 'Enter a valid PAN and choose all three original photos.'; status.classList.remove('hidden'); }
    return;
  }
  try {
    const { mobile } = pendingRiderRegistration;
    const [selfiePath, aadhaarPath, panPath] = await Promise.all([
      uploadRiderVerificationFile(selfie, mobile, 'selfie'),
      uploadRiderVerificationFile(aadhaarPhoto, mobile, 'aadhaar'),
      uploadRiderVerificationFile(panPhoto, mobile, 'pan')
    ]);

    const token = getRiderAccessToken();
    if (token) {
      await Promise.all([
        riderApiRequest('/api/rider/documents', { method: 'POST', body: JSON.stringify({ document_type: 'SELFIE', object_key: selfiePath, original_filename: selfie.name, content_type: selfie.type || 'image/jpeg' }) }),
        riderApiRequest('/api/rider/documents', { method: 'POST', body: JSON.stringify({ document_type: 'AADHAAR', object_key: aadhaarPath, original_filename: aadhaarPhoto.name, content_type: aadhaarPhoto.type || 'image/jpeg' }) }),
        riderApiRequest('/api/rider/documents', { method: 'POST', body: JSON.stringify({ document_type: 'PAN', object_key: panPath, original_filename: panPhoto.name, content_type: panPhoto.type || 'image/jpeg' }) })
      ]);
    }

    const verification = {
      pan_last4: panNumber.slice(-4),
      selfie_file: selfie.name,
      aadhaar_file: aadhaarPhoto.name,
      pan_file: panPhoto.name,
      selfie_path: selfiePath,
      aadhaar_path: aadhaarPath,
      pan_path: panPath,
      verification_status: 'SUBMITTED',
      verification_submitted_at_ms: Date.now()
    };
    if (!token) {
      await db.collection('rider_profiles').doc(mobile).set(verification, { merge: true });
    }
    closeRiderVerificationModal();
    document.getElementById('riderLoginIdentityInput').value = mobile;
    openRiderLoginModal();
    alert('Verification submitted. Login with your registered details after admin approval.');
    pendingRiderRegistration = null;
  } catch (error) {
    console.error('Rider verification upload failed:', error);
    if (status) { status.innerText = 'Upload failed. Check Firebase Storage rules and try again.'; status.classList.remove('hidden'); }
  }
}

async function loginRider() {
  const errorElement = document.getElementById('riderLoginError');
  if (!getRiderAccessToken()) {
    if (errorElement) {
      errorElement.innerText = 'Sign in to your MyShopzy account before opening the rider app.';
      errorElement.classList.remove('hidden');
    }
    return;
  }
  try {
    const profile = await hydrateRiderSession();
    if (!profile) throw new Error('Authenticated rider profile not found.');
    closeRiderLoginModal();
    updateRiderIdentity();
    startRiderOrdersListener();
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
  const welcomeScreen = document.getElementById('riderWelcomeScreen');
  const appShell = document.getElementById('riderAppShell');
  const bottomNav = document.getElementById('riderBottomNav');
  const isAuthenticated = Boolean(getRiderAccessToken() && riderProfile?.id && riderProfile?.user_id && currentActiveRider);
  welcomeScreen?.classList.toggle('hidden', isAuthenticated);
  appShell?.classList.toggle('hidden', !isAuthenticated);
  bottomNav?.classList.toggle('hidden', !isAuthenticated);
  syncRiderAccount();
  updateAvailabilityUi();
}

async function logoutRider() {
  stopRiderGpsBroadcast();
  if (getRiderAccessToken()) {
    try {
      await riderApiRequest('/api/rider/availability', { method: 'PUT', body: JSON.stringify({ is_available: false }) });
    } catch (error) {
      alert(error.message);
      return;
    }
    try {
      await riderApiRequest('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Rider session revocation failed:', error.message);
    }
  }
  riderIsAvailable = false;
  riderProfile = null;
  currentActiveRider = '';
  riderOrdersUnsubscribe?.();
  riderOrdersUnsubscribe = null;
  localStorage.removeItem('rider_profile');
  localStorage.removeItem('active_rider_name');
  localStorage.removeItem('rider_available');
  for (const key of ['user_access_token', 'myshopzy_user_access_token']) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
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

  if (!getRiderAccessToken()) {
    alert('Sign in with your authenticated rider account before changing availability.');
    return;
  }

  const token = getRiderAccessToken();
  if (token) {
    try {
      const nextState = !riderIsAvailable;
      const result = await riderApiRequest('/api/rider/availability', {
        method: 'PUT',
        body: JSON.stringify({ is_available: nextState })
      });
      riderIsAvailable = Boolean(result?.data?.is_available);
      localStorage.setItem('rider_available', String(riderIsAvailable));
      updateAvailabilityUi();
      if (riderIsAvailable) startRiderOrdersListener();
      else stopRiderGpsBroadcast();
      return;
    } catch (error) {
      alert(error.message);
      return;
    }
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
  riderOrdersUnsubscribe?.();
  if (!getRiderAccessToken() || !riderProfile?.id) {
    allRiderOrders = [];
    renderPickupQueue();
    renderRiderOrders();
    return;
  }
  const refresh = async () => {
    try {
      const result = await riderApiRequest('/api/rider/deliveries?bucket=all');
      const orders = Array.isArray(result?.data) ? result.data : [];
      const activeOrders = orders.filter(order => ['OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(order.assignment_status));
      const newlyAssigned = activeOrders.filter(order => order.assignment_status === 'OFFERED' && !knownAssignedOrderIds.has(order.assignment_id));
      if (riderOrdersInitialized && newlyAssigned.length) notifyNewAssignment(newlyAssigned[0]);
      knownAssignedOrderIds = new Set(activeOrders.map(order => order.assignment_id));
      riderOrdersInitialized = true;
      allRiderOrders = orders;
      const inTransitOrder = activeOrders.find(order => order.assignment_status === 'OUT_FOR_DELIVERY');
      if (inTransitOrder && activeGpsAssignmentId !== inTransitOrder.assignment_id) {
        startRiderGpsBroadcast(inTransitOrder.assignment_id);
      } else if (!inTransitOrder && gpsWatchId) {
        stopRiderGpsBroadcast();
      }
      renderPickupQueue();
      renderRiderOrders();
    } catch (error) {
      console.error('Rider delivery queue failed:', error);
    }
  };
  refresh();
  const timer = setInterval(refresh, 5000);
  riderOrdersUnsubscribe = () => clearInterval(timer);
}

function notifyNewAssignment(order, nearby = false) {
  RIDER_ORDER_SOUND.currentTime = 0;
  RIDER_ORDER_SOUND.play().catch(() => {});
  const banner = document.getElementById('riderAlertBanner');
  if (banner) {
    banner.innerHTML = `
      <div>${nearby ? 'Nearby order available' : 'New delivery assigned'}: <strong>${escapeRiderHtml(order.id)}</strong>. <button type="button" onclick="openRiderOrderAlert()" class="underline font-black">Open orders</button></div>
      <div class="flex flex-wrap gap-2 mt-2">
        <button type="button" onclick="acceptRiderOrder('${escapeRiderHtml(order.id)}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-black">Accept</button>
        <button type="button" onclick="rejectRiderOrder('${escapeRiderHtml(order.id)}')" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-800 font-black">Reject</button>
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
  const order = allRiderOrders.find(item => item.id === orderId || item.assignment_id === orderId);
  if (!order) return;
  try {
    await riderApiRequest(`/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/accept`, {
      method: 'POST', body: JSON.stringify({})
    });
    stopRiderOrderAlertSound();
    const banner = document.getElementById('riderAlertBanner');
    if (banner) banner.classList.add('hidden');
    startRiderOrdersListener();
  } catch (error) {
    alert(`Unable to accept delivery: ${error.message}`);
  }
}

async function rejectRiderOrder(orderId) {
  const order = allRiderOrders.find(item => item.id === orderId || item.assignment_id === orderId);
  if (!order) return;
  const reason = prompt('Why can you not accept this delivery?')?.trim();
  if (!reason) return;
  try {
    await riderApiRequest(`/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/reject`, {
      method: 'POST', body: JSON.stringify({ reason })
    });
    stopRiderOrderAlertSound();
    const banner = document.getElementById('riderAlertBanner');
    if (banner) banner.classList.add('hidden');
    startRiderOrdersListener();
  } catch (error) {
    alert(`Unable to reject delivery: ${error.message}`);
  }
}

function startRiderGpsBroadcast(assignmentId) {
  if (!navigator.geolocation) return;
  if (!assignmentId) return;
  if (gpsWatchId && activeGpsAssignmentId === assignmentId) return;
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  activeGpsAssignmentId = assignmentId;

  gpsWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      window.currentRiderLocation = { lat: latitude, lng: longitude };
      try {
        await riderApiRequest('/api/rider/locations', {
          method: 'POST',
          body: JSON.stringify({
            assignment_id: assignmentId,
            latitude,
            longitude,
            accuracy_m: position.coords.accuracy,
            heading_degrees: position.coords.heading,
            speed_mps: position.coords.speed
          })
        });
      } catch (err) {
        if (!/too recently/i.test(err.message)) console.error("GPS update failed:", err.message);
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
  activeGpsAssignmentId = null;
}

function getPickupGroups(order) {
  if (order.order_type === 'PARCEL') {
    return [{
      key: 'parcel',
      name: 'Parcel pickup',
      address: order.parcel_pickup_address || 'Pickup address pending',
      items: [],
      isParcel: true
    }];
  }
  return (Array.isArray(order.fulfillments) ? order.fulfillments : []).map(fulfillment => ({
    key: fulfillment.id,
    name: fulfillment.shop_name || 'Pickup location',
    address: fulfillment.pickup_address || 'Pickup address pending',
    items: Array.isArray(fulfillment.items) ? fulfillment.items : [],
    isParcel: false
  }));
}

function renderPickupChecklist(order) {
  const priority = { store: 1, vegetable_partner: 2, meat_partner: 3, restaurant: 4 };
  const groups = getPickupGroups(order).sort((a, b) => (priority[a.key] || 9) - (priority[b.key] || 9));
  const completed = order.pickup_progress || {};
  const allPicked = groups.every(group => completed[group.key]);
  const nextGroup = groups.find(group => !completed[group.key]);
  const hasSourceMetadata = order.order_type === 'PARCEL' || groups.length > 0;

  return `
    <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-black uppercase text-amber-900">Pickup plan · ${groups.length} source${groups.length === 1 ? '' : 's'}</span>
        <span class="text-[10px] font-bold text-amber-700">${groups.filter(group => completed[group.key]).length}/${groups.length} ready</span>
      </div>
      ${!hasSourceMetadata ? '<p class="text-[10px] font-bold text-rose-700">Older order: source details were not saved. Recreate the order after assigning product pickup sources in Admin.</p>' : ''}
      ${groups.map(group => `
        <button ${!completed[group.key] && nextGroup?.key !== group.key ? 'disabled' : ''} onclick="${completed[group.key] ? '' : order.pickup_reached?.[group.key] ? `markPickupComplete('${escapeRiderHtml(order.id)}', '${escapeRiderHtml(group.key)}')` : `markPickupReached('${escapeRiderHtml(order.id)}', '${escapeRiderHtml(group.key)}')`}" class="w-full text-left p-2 bg-white border ${completed[group.key] ? 'border-emerald-300' : 'border-amber-200'} rounded-lg flex items-center gap-2 ${!completed[group.key] && nextGroup?.key !== group.key ? 'opacity-50 cursor-not-allowed' : ''}">
          <span class="w-5 h-5 rounded-full ${completed[group.key] ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'} flex items-center justify-center text-[10px] font-black">${completed[group.key] ? '✓' : '○'}</span>
          <span class="min-w-0 flex-1"><strong class="block text-[11px] text-slate-900">${escapeRiderHtml(group.name)}</strong><span class="block text-[10px] text-slate-500 truncate">${escapeRiderHtml(group.address)}</span><span class="block text-[10px] text-slate-500">${group.items.map(item => `${escapeRiderHtml(item.quantity)}x ${escapeRiderHtml(item.name)}`).join(', ') || 'Legacy order items'}</span></span>
          <span class="text-[10px] font-black ${completed[group.key] ? 'text-emerald-600' : 'text-amber-700'}">${completed[group.key] ? 'Picked' : nextGroup?.key !== group.key ? 'Next' : order.pickup_reached?.[group.key] ? (group.isParcel ? 'Pickup recorded' : 'Confirm pickup') : 'Arrive'}</span>
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
    .filter(order => ['OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(order.assignment_status))
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
      <span class="min-w-0 flex-1"><strong class="block text-xs text-slate-900">${escapeRiderHtml(order.id)}</strong><span class="block text-[10px] text-slate-500 truncate">Next: ${escapeRiderHtml(next ? next.name : 'Ready for delivery')}</span><span class="block text-[10px] text-slate-400">${groups.filter(group => completed[group.key]).length}/${groups.length} pickup points complete</span></span>
      <span class="text-[10px] font-black ${next ? 'text-amber-700' : 'text-emerald-600'}">${next ? 'Pickup' : 'Ready'}</span>
    </button>`;
  }).join('');
}

async function markPickupReached(orderId, sourceKey) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order) return;
  try {
    const path = order.order_type === 'PARCEL'
      ? `/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/parcel-pickup/arrive`
      : `/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/pickups/${encodeURIComponent(sourceKey)}/arrive`;
    await riderApiRequest(path, { method: 'POST', body: JSON.stringify({}) });
    startRiderOrdersListener();
  } catch (error) {
    alert("Reached update failed: " + error.message);
  }
}

async function markPickupComplete(orderId, sourceKey) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order) return;
  if (order.order_type === 'PARCEL') return;
  if (!order.pickup_reached?.[sourceKey]) {
    alert("Tap Reached after arriving at the pickup location first.");
    return;
  }
  const pickupOtp = prompt("Enter the pickup code provided by the pickup location:")?.trim();
  if (!pickupOtp) return;
  try {
    await riderApiRequest(`/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/pickups/${encodeURIComponent(sourceKey)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ otp: pickupOtp })
    });
    startRiderOrdersListener();
  } catch (error) {
    alert("Pickup confirmation failed: " + error.message);
  }
}

function canStartDelivery(order) {
  if (order.order_type === 'PARCEL') return order.assignment_status === 'PICKING_UP';
  return getPickupGroups(order).length > 0
    && getPickupGroups(order).every(group => order.pickup_progress?.[group.key]);
}

function renderRiderOrders() {
  const container = document.getElementById('riderOrdersContainer');
  if (!container) return;
  
  const pendingList = allRiderOrders.filter(order => ['OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(order.assignment_status));
  const completedList = allRiderOrders.filter(order => ['REJECTED', 'COMPLETED', 'CANCELLED'].includes(order.assignment_status));

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
    if (Array.isArray(o.items)) itemsText = o.items.map(i => `${escapeRiderHtml(i.quantity)}x ${escapeRiderHtml(i.name)}`).join(", ");

    const encodedAddress = encodeURIComponent(o.delivery_address || 'Mandapeta');
    const normalizedStatus = String(o.status || '').toUpperCase();
    const customerDetailsUnlocked = ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(normalizedStatus);
    const customerPhone = String(o.customer_phone || '').replace(/[^0-9+]/g, '');
    const customerMapUrl = Number.isFinite(Number(o.delivery_latitude)) && Number.isFinite(Number(o.delivery_longitude))
      ? `https://www.google.com/maps/search/?api=1&query=${o.delivery_latitude},${o.delivery_longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-100 pb-2">
        <div><span class="block text-xs font-black text-brand-navy">${escapeRiderHtml(o.id)}</span><span class="block text-[10px] text-slate-500 font-semibold">🕒 ${formatOrderDateTime(o)}</span></div>
          <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full ${String(o.status || '').toUpperCase() === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
          ${escapeRiderHtml(o.status)}
        </span>
      </div>

      <div>
        ${customerDetailsUnlocked ? `<p class="text-xs font-bold text-slate-900">${escapeRiderHtml(o.delivery_address)}</p>` : '<p class="rounded-xl bg-amber-50 border border-amber-200 px-2 py-2 text-[11px] font-bold text-amber-800">Customer delivery details unlock after pickup is complete.</p>'}
        ${o.order_type === 'PARCEL' ? `<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 mt-1 font-bold">Pickup: ${escapeRiderHtml(o.parcel_pickup_address || 'Pickup address pending')} → Drop: ${escapeRiderHtml(o.parcel_drop_address || o.delivery_address || '')}</p>` : ''}
        ${itemsText ? `<p class="text-[11px] text-slate-500 mt-1">📦 ${itemsText}</p>` : ''}
        ${o.assignment_status === 'OFFERED'
          ? '<div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] font-bold text-amber-800">Accept this delivery before starting pickup.</div>'
          : renderPickupChecklist(o)}
        <div class="flex items-center justify-between mt-2 text-xs">
          <span class="font-extrabold text-slate-900">Total: ₹${Number(o.total_amount || o.total || 0)}</span>
          <span class="text-[11px] font-bold ${o.payment_mode === 'COD' ? 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded' : 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded'}">
            ${o.payment_mode === 'COD' ? 'Collect Cash at Door' : 'Paid Online'}
          </span>
        </div>
        ${Number(o.rider_tip || 0) > 0 ? `<p class="text-[11px] font-black text-amber-700 mt-1">Rider tip: ₹${Number(o.rider_tip)}</p>` : ''}
      </div>

      ${customerDetailsUnlocked ? `<div class="grid grid-cols-2 gap-2 pt-1">
        <a href="tel:${escapeRiderHtml(customerPhone)}" class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="phone" class="w-3.5 h-3.5 text-brand-accent"></i> Call customer
        </a>
        <a href="${customerMapUrl}" target="_blank" class="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-brand-accent rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="navigation" class="w-3.5 h-3.5"></i> Start route
        </a>
      </div>` : ''}

      ${o.assignment_status !== 'COMPLETED' ? `
        <div class="pt-1 flex gap-2">
          ${o.assignment_status === 'OFFERED' ? `
            <button onclick="acceptRiderOrder('${escapeRiderHtml(o.id)}')" class="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black transition">Accept delivery</button>
            <button onclick="rejectRiderOrder('${escapeRiderHtml(o.id)}')" class="flex-1 py-2.5 bg-rose-100 text-rose-800 rounded-xl text-xs font-black transition">Reject</button>
          ` : o.assignment_status !== 'OUT_FOR_DELIVERY' && canStartDelivery(o) ? `
            <button onclick="setOutForDelivery('${escapeRiderHtml(o.id)}')" class="flex-1 py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5">
              <span>Start Delivery (Broadcast GPS)</span>
            </button>
          ` : o.assignment_status === 'OUT_FOR_DELIVERY' ? `
            <div class="flex-1 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] font-bold text-emerald-700 flex items-center justify-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Live GPS Streaming
            </div>
          ` : `<div class="flex-1 py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500 text-center">Accept delivery first</div>`}
          ${o.assignment_status === 'OUT_FOR_DELIVERY' ? `<button onclick="openOtpModal('${escapeRiderHtml(o.id)}')" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition">Verify OTP</button>` : ''}
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
    await riderApiRequest(`/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/out-for-delivery`, {
      method: 'POST', body: JSON.stringify({})
    });
    startRiderGpsBroadcast(order.assignment_id);
    startRiderOrdersListener();
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
  delete inputEl.dataset.expectedOtp;
  
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

  if (!currentVerifyingOrderId) {
    alert("Session expired. Please click 'Verify OTP' again.");
    return;
  }

  if (!/^\d{6}$/.test(enteredOtp)) {
    document.getElementById('otpErrorMessage').classList.remove('hidden');
    return;
  }
  try {
    const order = allRiderOrders.find(item => item.id === currentVerifyingOrderId);
    if (!order) throw new Error('Delivery assignment is no longer available.');
    await riderApiRequest(`/api/rider/deliveries/${encodeURIComponent(order.assignment_id)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ otp: enteredOtp })
    });
    const deliveredId = currentVerifyingOrderId;
    closeOtpModal();
    stopRiderGpsBroadcast();
    startRiderOrdersListener();
    alert(`Order ${deliveredId} verified & delivered successfully!`);
  } catch (error) {
    document.getElementById('otpErrorMessage').classList.remove('hidden');
    document.getElementById('otpErrorMessage').innerText = error.message;
  }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', async () => {
  document.addEventListener('click', event => {
    if (event.target.closest('button, [onclick]')) {
      RIDER_TAB_SOUND.currentTime = 0;
      RIDER_TAB_SOUND.play().catch(() => {});
    }
  });
  const backendProfile = await hydrateRiderSession();
  if (!backendProfile) {
    riderProfile = null;
    currentActiveRider = '';
    riderIsAvailable = false;
  }
  updateRiderIdentity();
  updateAvailabilityUi();
  showRiderSection('home');
  if (backendProfile) startRiderOrdersListener();
  if (window.lucide) lucide.createIcons();
});