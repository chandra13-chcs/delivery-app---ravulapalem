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
let riderNearbyOrderIds = new Set();
let riderOrdersUnsubscribe = null;
let currentSupportRange = 'day';
let currentPhotoOrderId = null;
let currentPhotoType = null;
let currentReturnOrderId = null;
let riderActivityTimer = null;
let riderProfileDbPromise = null;
let riderProfilePhotoObjectUrl = null;
let riderOnlineStartedAt = riderIsAvailable ? Date.now() : null;
let riderDrivingStartedAt = null;
let lastRiderGpsPoint = null;
const RIDER_DISPATCH_RADIUS_KM = 3;
const RIDER_DEFAULT_PICKUP = { lat: 16.8625, lng: 82.0570 };
const RIDER_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RIDER_MAX_LOGIN_ATTEMPTS = 5;
const RIDER_LOCKOUT_MS = 15 * 60 * 1000;
const RIDER_PAN_PATTERN = /^\d{14}[A-Z]{2}$/;
const RIDER_PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RIDER_DOCUMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RIDER_DOCUMENT_MAX_SIZE = 10 * 1024 * 1024;

function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
let riderOtpSent = false;
let pendingRiderRegistration = null;
const RIDER_ORDER_SOUND = new Audio("../assets/audio/admin-rider-order.mpeg");
const RIDER_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
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
    account: document.getElementById('riderAccountSection'),
    support: document.getElementById('riderSupportSection')
  };
  Object.entries(sections).forEach(([name, element]) => {
    if (element) element.classList.toggle('hidden', name !== section);
  });
  if (section === 'orders') renderRiderOrders();
  if (section === 'account') syncRiderAccount();
  if (section === 'support') loadRiderSupportMetrics();
}

function openRiderAccount() {
  if (!riderProfile?.name) {
    openRiderLoginModal();
    return;
  }
  showRiderSection('account');
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

  if (!name || mobile.length !== 10 || !email || aadhaar.length !== 12 || !password || password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || password !== confirmPassword) {
    alert('Complete all details. Use a password of at least 10 characters with uppercase, lowercase, and a number.');
    return;
  }
  if (!riderOtpSent || otp !== '4821') {
    alert('Send the OTP first and enter the demo OTP: 4821');
    return;
  }

  const passwordHash = await hashRiderPassword(password);
  const profile = { name, mobile, email, aadhaar_last4: aadhaar.slice(-4), password_hash: passwordHash, verification_status: 'PENDING', registered_at_ms: Date.now() };
  pendingRiderRegistration = profile;
  try {
    await db.collection('rider_profiles').doc(mobile).set(profile, { merge: true });
  } catch (error) {
    console.error('Rider profile save failed:', error);
    alert('Profile saved on this device. Firebase profile sync failed.');
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
  if (!RIDER_PAN_PATTERN.test(panNumber || '') || !selfie || !aadhaarPhoto || !panPhoto) {
    if (status) { status.innerText = 'Enter exactly 14 numbers followed by 2 letters and choose all three original photos.'; status.classList.remove('hidden'); }
    return;
  }
  try {
    const { mobile } = pendingRiderRegistration;
    const panHash = await hashRiderPassword(`rider-pan:${panNumber}`);
    const existingPan = await db.collection('rider_profiles').where('pan_hash', '==', panHash).limit(1).get();
    if (!existingPan.empty && existingPan.docs[0].id !== mobile) {
      if (status) { status.innerText = 'This unique PAN ID is already registered to another rider.'; status.classList.remove('hidden'); }
      return;
    }
    const [selfiePath, aadhaarPath, panPath] = await Promise.all([
      uploadRiderVerificationFile(selfie, mobile, 'selfie'),
      uploadRiderVerificationFile(aadhaarPhoto, mobile, 'aadhaar'),
      uploadRiderVerificationFile(panPhoto, mobile, 'pan')
    ]);
    const verification = {
      pan_last4: panNumber.slice(-4),
      pan_hash: panHash,
      pan_format: '14_DIGITS_2_LETTERS',
      selfie_file: selfie.name,
      aadhaar_file: aadhaarPhoto.name,
      pan_file: panPhoto.name,
      selfie_path: selfiePath,
      aadhaar_path: aadhaarPath,
      pan_path: panPath,
      verification_status: 'SUBMITTED',
      verification_submitted_at_ms: Date.now()
    };
    await db.collection('rider_profiles').doc(mobile).set(verification, { merge: true });
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
    const lockout = JSON.parse(localStorage.getItem('rider_login_lockout') || 'null');
    if (lockout?.until > Date.now()) {
      throw new Error(`Too many failed attempts. Try again in ${Math.ceil((lockout.until - Date.now()) / 60000)} minutes.`);
    }
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
    if (!profile || profile.password_hash !== passwordHash) {
      const attempts = Number(localStorage.getItem('rider_login_attempts') || 0) + 1;
      localStorage.setItem('rider_login_attempts', String(attempts));
      if (attempts >= RIDER_MAX_LOGIN_ATTEMPTS) {
        localStorage.setItem('rider_login_lockout', JSON.stringify({ until: Date.now() + RIDER_LOCKOUT_MS }));
        localStorage.removeItem('rider_login_attempts');
      }
      throw new Error('Invalid rider credentials.');
    }
    localStorage.removeItem('rider_login_attempts');
    localStorage.removeItem('rider_login_lockout');
    const verificationStatus = profile.verification_status || 'PENDING';
    if (!['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(verificationStatus)) throw new Error('Rider profile verification data is incomplete.');

    const pendingProfileSave = JSON.parse(localStorage.getItem('rider_profile_pending_sync') || 'null');
    riderProfile = pendingProfileSave?.mobile === profile.mobile
      ? { ...profile, ...pendingProfileSave.updates }
      : profile;
    currentActiveRider = profile.name;
    const safeProfile = { ...profile };
    if (pendingProfileSave?.mobile === profile.mobile) Object.assign(safeProfile, pendingProfileSave.updates);
    delete safeProfile.password_hash;
    localStorage.setItem('rider_profile', JSON.stringify(safeProfile));
    localStorage.setItem('active_rider_name', profile.name);
    localStorage.setItem('rider_session_started_at', String(Date.now()));
    closeRiderLoginModal();
    updateRiderIdentity();
    startRiderOrdersListener();
    if (riderProfile.profile_sync_pending || riderProfile.photo_local_pending || riderProfile.bike_license_local_pending || riderProfile.bike_rc_local_pending || riderProfile.bike_document_local_pending) {
      retryRiderProfileSync();
    }
    if (verificationStatus !== 'APPROVED') {
      pendingRiderRegistration = profile;
      openRiderVerificationModal();
    }
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
  const homeName = document.getElementById('riderHomeName');
  if (homeName) homeName.innerText = riderProfile?.name || currentActiveRider || 'Delivery partner';
  const fields = {
    riderAccountName: riderProfile?.name || currentActiveRider,
    riderAccountMobile: riderProfile?.mobile || '-',
    riderAccountEmail: riderProfile?.email || '-',
    riderAccountAadhaar: riderProfile?.aadhaar_last4 ? `•••• ${riderProfile.aadhaar_last4}` : '-',
    riderAccountBike: riderProfile?.bike_number ? `${riderProfile.bike_number} · ${riderProfile.bike_model || 'Model not set'}` : 'Not added',
    riderAccountBikeColor: riderProfile?.bike_color || '-',
    riderAccountBikeLicense: riderProfile?.bike_license_path ? 'Uploaded' : riderProfile?.bike_license_local_pending ? 'Saved on device · sync pending' : 'Not uploaded',
    riderAccountBikeRc: riderProfile?.bike_rc_path || riderProfile?.bike_document_path
      ? 'Uploaded'
      : riderProfile?.bike_rc_local_pending || riderProfile?.bike_document_local_pending
        ? 'Saved on device · sync pending'
        : 'Not uploaded',
    riderAccountOnlineTime: formatDuration(riderProfile?.online_minutes || 0),
    riderAccountDrivingTime: formatDuration(riderProfile?.driving_minutes || 0)
  };
  Object.entries(fields).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
  const syncStatus = document.getElementById('riderAccountSyncStatus');
  if (syncStatus) {
    const pending = Boolean(
      riderProfile?.profile_sync_pending ||
      riderProfile?.photo_local_pending ||
      riderProfile?.bike_license_local_pending ||
      riderProfile?.bike_rc_local_pending ||
      riderProfile?.bike_document_local_pending
    );
    syncStatus.innerText = pending
      ? riderProfile?.profile_sync_error || 'Some profile changes are saved on this device and waiting to sync.'
      : '';
    syncStatus.classList.toggle('hidden', !pending);
  }
  document.getElementById('riderProfileRetryButton')?.classList.toggle(
    'hidden',
    !(riderProfile?.profile_sync_pending || riderProfile?.photo_local_pending || riderProfile?.bike_license_local_pending || riderProfile?.bike_rc_local_pending || riderProfile?.bike_document_local_pending)
  );
  const photo = document.getElementById('riderAccountPhoto');
  const photoUrl = riderProfile?.photo_url || '';
  if (photo) setRiderPhotoSource(photo, photoUrl, 'riderAccountPhotoPlaceholder');
  const homePhoto = document.getElementById('riderHomePhoto');
  if (homePhoto) setRiderPhotoSource(homePhoto, photoUrl, 'riderHomePhotoPlaceholder');
  if (!photoUrl && riderProfile?.photo_path && !riderProfile?.photo_local_pending) loadRiderProfilePhotoFromStorage();
  else if (!photoUrl && riderProfile?.mobile) loadLocalRiderPhoto(riderProfile.mobile);
}

function setRiderPhotoSource(image, source, placeholderId) {
  const placeholder = document.getElementById(placeholderId);
  if (!source) {
    image.hidden = true;
    if (placeholder) placeholder.hidden = false;
    return;
  }
  image.onload = () => {
    image.hidden = false;
    if (placeholder) placeholder.hidden = true;
  };
  image.onerror = () => {
    image.hidden = true;
    if (placeholder) placeholder.hidden = false;
    if (riderProfile?.photo_local_pending && riderProfile.mobile) loadLocalRiderPhoto(riderProfile.mobile);
  };
  image.src = source;
}

async function loadRiderProfilePhotoFromStorage() {
  if (!riderProfile?.photo_path || !firebase.storage || !riderProfile.mobile) return;
  try {
    const url = await firebase.storage().ref(riderProfile.photo_path).getDownloadURL();
    riderProfile = { ...riderProfile, photo_url: url };
    const safeProfile = { ...riderProfile };
    delete safeProfile.password_hash;
    localStorage.setItem('rider_profile', JSON.stringify(safeProfile));
    const accountPhoto = document.getElementById('riderAccountPhoto');
    if (accountPhoto) setRiderPhotoSource(accountPhoto, url, 'riderAccountPhotoPlaceholder');
    const homePhoto = document.getElementById('riderHomePhoto');
    if (homePhoto) setRiderPhotoSource(homePhoto, url, 'riderHomePhotoPlaceholder');
  } catch (error) {
    console.error('Rider profile photo could not be loaded:', error);
    if (riderProfile?.mobile) loadLocalRiderPhoto(riderProfile.mobile);
  }
}

function openRiderProfileDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser cannot securely save profile photos offline.'));
  if (!riderProfileDbPromise) {
    riderProfileDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('myshopzy-rider-profile', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local profile storage.'));
    });
  }
  return riderProfileDbPromise;
}

async function saveLocalRiderFile(riderId, kind, file) {
  const database = await openRiderProfileDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite');
    transaction.objectStore('files').put(file, `${riderId}:${kind}`);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the file on this device.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local file save was cancelled.'));
  });
}

async function getLocalRiderFile(riderId, kind) {
  const database = await openRiderProfileDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', 'readonly');
    const request = transaction.objectStore('files').get(`${riderId}:${kind}`);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not read the locally saved file.'));
  });
}

async function deleteLocalRiderFile(riderId, kind) {
  const database = await openRiderProfileDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite');
    transaction.objectStore('files').delete(`${riderId}:${kind}`);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not clear the local file after sync.'));
  });
}

async function loadLocalRiderPhoto(riderId) {
  try {
    const file = await getLocalRiderFile(riderId, 'profile-photo');
    if (!file || riderProfile?.mobile !== riderId) return;
    if (riderProfilePhotoObjectUrl) URL.revokeObjectURL(riderProfilePhotoObjectUrl);
    riderProfilePhotoObjectUrl = URL.createObjectURL(file);
    for (const [imageId, placeholderId] of [
      ['riderAccountPhoto', 'riderAccountPhotoPlaceholder'],
      ['riderHomePhoto', 'riderHomePhotoPlaceholder']
    ]) {
      const image = document.getElementById(imageId);
      if (image) setRiderPhotoSource(image, riderProfilePhotoObjectUrl, placeholderId);
    }
  } catch (error) {
    console.error('Locally saved rider photo could not be loaded:', error);
  }
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (total < 60) return `${total}m`;
  return `${Math.floor(total / 60)}h ${total % 60}m`;
}

function openRiderProfileModal() {
  document.getElementById('riderProfileModal')?.classList.remove('hidden');
  document.getElementById('riderBikeNumberInput').value = riderProfile?.bike_number || '';
  document.getElementById('riderBikeModelInput').value = riderProfile?.bike_model || '';
  document.getElementById('riderBikeColorInput').value = riderProfile?.bike_color || '';
  const status = document.getElementById('riderProfileStatus');
  if (status) status.classList.add('hidden');
  const preview = document.getElementById('riderProfilePhotoPreview');
  const placeholder = document.getElementById('riderProfilePhotoPlaceholder');
  if (preview) {
    preview.classList.toggle('hidden', !riderProfile?.photo_url);
    if (riderProfile?.photo_url) preview.src = riderProfile.photo_url;
  }
  if (placeholder) placeholder.classList.toggle('hidden', Boolean(riderProfile?.photo_url));
}

function closeRiderProfileModal() {
  document.getElementById('riderProfileModal')?.classList.add('hidden');
}

function previewRiderProfilePhoto(event) {
  const file = event.target.files?.[0];
  const preview = document.getElementById('riderProfilePhotoPreview');
  if (!file || !preview) return;
  if (!RIDER_PROFILE_IMAGE_TYPES.includes(file.type)) {
    event.target.value = '';
    alert('Choose a JPG, PNG, or WebP image for the rider photo.');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    event.target.value = '';
    alert('Choose a rider photo smaller than 8 MB.');
    return;
  }
  if (window.riderProfilePreviewUrl) URL.revokeObjectURL(window.riderProfilePreviewUrl);
  window.riderProfilePreviewUrl = URL.createObjectURL(file);
  preview.src = window.riderProfilePreviewUrl;
  preview.classList.remove('hidden');
  document.getElementById('riderProfilePhotoPlaceholder')?.classList.add('hidden');
  const accountPhoto = document.getElementById('riderAccountPhoto');
  if (accountPhoto) setRiderPhotoSource(accountPhoto, window.riderProfilePreviewUrl, 'riderAccountPhotoPlaceholder');
  const homePhoto = document.getElementById('riderHomePhoto');
  if (homePhoto) setRiderPhotoSource(homePhoto, window.riderProfilePreviewUrl, 'riderHomePhotoPlaceholder');
  preview.onerror = () => {
    preview.classList.add('hidden');
    document.getElementById('riderProfilePhotoPlaceholder')?.classList.remove('hidden');
    alert('This photo could not be previewed. Please choose another image.');
  };
  preview.onload = () => {
    preview.classList.remove('hidden');
    document.getElementById('riderProfilePhotoPlaceholder')?.classList.add('hidden');
  };
}

async function saveRiderProfileDetails() {
  const status = document.getElementById('riderProfileStatus');
  const saveButton = document.getElementById('riderProfileSaveButton');
  const selectedPhoto = document.getElementById('riderProfilePhotoInput')?.files?.[0] || null;
  const selectedLicense = document.getElementById('riderBikeLicenseInput')?.files?.[0] || null;
  const selectedRc = document.getElementById('riderBikeRcInput')?.files?.[0] || null;
  const showStatus = (message, success = false) => {
    if (!status) return;
    status.innerText = message;
    status.className = success
      ? 'rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-bold text-emerald-800'
      : 'rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] font-bold text-amber-800';
  };
  if (!riderProfile?.mobile) {
    showStatus('Your rider session is missing. Sign in again before saving profile details.');
    return;
  }
  if (saveButton?.disabled) return;
  const bikeNumber = document.getElementById('riderBikeNumberInput')?.value.trim().toUpperCase() || '';
  const bikeModel = document.getElementById('riderBikeModelInput')?.value.trim() || '';
  const bikeColor = document.getElementById('riderBikeColorInput')?.value.trim() || '';
  const normalizedBikeNumber = bikeNumber.replace(/[\s-]/g, '');
  if ((bikeNumber && !/^(?:[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(normalizedBikeNumber)) ||
      (bikeNumber && (!bikeModel || !bikeColor))) {
    showStatus('Enter a valid bike registration number. If adding a bike number, also provide its model and colour.');
    return;
  }
  if (selectedPhoto && (!RIDER_PROFILE_IMAGE_TYPES.includes(selectedPhoto.type) || selectedPhoto.size > 8 * 1024 * 1024)) {
    showStatus('Profile photo must be a JPG, PNG, or WebP image smaller than 8 MB.');
    return;
  }
  if (selectedLicense && (!RIDER_DOCUMENT_TYPES.includes(selectedLicense.type) || selectedLicense.size > RIDER_DOCUMENT_MAX_SIZE)) {
    showStatus('Driving licence photo must be a JPG, PNG, or WebP image smaller than 10 MB.');
    return;
  }
  if (selectedRc && (!RIDER_DOCUMENT_TYPES.includes(selectedRc.type) || selectedRc.size > RIDER_DOCUMENT_MAX_SIZE)) {
    showStatus('Bike RC photo must be a JPG, PNG, or WebP image smaller than 10 MB.');
    return;
  }
  const updates = {
    bike_number: bikeNumber,
    bike_model: bikeModel,
    bike_color: bikeColor,
    bike_updated_at_ms: Date.now(),
    profile_sync_pending: true
  };
  const persistPendingSync = () => localStorage.setItem('rider_profile_pending_sync', JSON.stringify({
    mobile: riderProfile.mobile,
    updates: {
      ...updates,
      photo_local_pending: Boolean(updates.photo_local_pending || riderProfile.photo_local_pending),
      bike_license_local_pending: Boolean(updates.bike_license_local_pending || riderProfile.bike_license_local_pending),
      bike_rc_local_pending: Boolean(updates.bike_rc_local_pending || riderProfile.bike_rc_local_pending || riderProfile.bike_document_local_pending),
      bike_document_local_pending: Boolean(updates.bike_document_local_pending || riderProfile.bike_document_local_pending)
    }
  }));
  const cloudUpdates = { ...updates };
  delete cloudUpdates.profile_sync_pending;
  let localProfileSaved = false;
  try {
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.innerText = 'Saving...';
    }
    if (status) status.classList.add('hidden');

    if (selectedPhoto) {
      await saveLocalRiderFile(riderProfile.mobile, 'profile-photo', selectedPhoto);
      updates.photo_local_pending = true;
      updates.photo_url = '';
      updates.photo_path = '';
    }
    if (selectedLicense) {
      await saveLocalRiderFile(riderProfile.mobile, 'bike-license', selectedLicense);
      updates.bike_license_local_pending = true;
      updates.bike_license_path = '';
    }
    if (selectedRc) {
      await saveLocalRiderFile(riderProfile.mobile, 'bike-rc', selectedRc);
      updates.bike_rc_local_pending = true;
      updates.bike_rc_path = '';
      updates.bike_document_path = '';
    }

    riderProfile = { ...riderProfile, ...updates };
    const safeProfile = { ...riderProfile };
    delete safeProfile.password_hash;
    localStorage.setItem('rider_profile', JSON.stringify(safeProfile));
    localStorage.setItem('active_rider_name', riderProfile.name);
    persistPendingSync();
    localProfileSaved = true;
    syncRiderAccount();

    const photoToUpload = selectedPhoto || (riderProfile.photo_local_pending
      ? await getLocalRiderFile(riderProfile.mobile, 'profile-photo')
      : null);
    const licenseToUpload = selectedLicense || (riderProfile.bike_license_local_pending
      ? await getLocalRiderFile(riderProfile.mobile, 'bike-license')
      : null);
    const rcToUpload = selectedRc || ((riderProfile.bike_rc_local_pending || riderProfile.bike_document_local_pending)
      ? await getLocalRiderFile(riderProfile.mobile, riderProfile.bike_rc_local_pending ? 'bike-rc' : 'bike-document')
      : null);
    if (riderProfile.photo_local_pending && !photoToUpload) {
      throw new Error('The previously selected photo is missing from local storage. Select it again and save.');
    }
    if (riderProfile.bike_license_local_pending && !licenseToUpload) {
      throw new Error('The previously selected driving licence is missing from local storage. Select it again and save.');
    }
    if ((riderProfile.bike_rc_local_pending || riderProfile.bike_document_local_pending) && !rcToUpload) {
      throw new Error('The previously selected bike RC is missing from local storage. Select it again and save.');
    }
    if (photoToUpload || licenseToUpload || rcToUpload) {
      if (!firebase.storage) throw new Error('Firebase Storage is unavailable. Check the Firebase Storage SDK and configuration.');
    }
    if (photoToUpload) {
      const extension = photoToUpload.type.split('/')[1] || 'jpg';
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/profile_${Date.now()}.${extension}`);
      await storageRef.put(photoToUpload, { contentType: photoToUpload.type });
      cloudUpdates.photo_url = await storageRef.getDownloadURL();
      cloudUpdates.photo_path = storageRef.fullPath;
      cloudUpdates.photo_local_pending = false;
    }
    if (licenseToUpload) {
      const extension = licenseToUpload.type.split('/')[1];
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/bike_license_${Date.now()}.${extension}`);
      await storageRef.put(licenseToUpload, { contentType: licenseToUpload.type });
      cloudUpdates.bike_license_path = storageRef.fullPath;
      cloudUpdates.bike_license_local_pending = false;
    }
    if (rcToUpload) {
      const extension = rcToUpload.type.split('/')[1];
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/bike_rc_${Date.now()}.${extension}`);
      await storageRef.put(rcToUpload, { contentType: rcToUpload.type });
      cloudUpdates.bike_rc_path = storageRef.fullPath;
      cloudUpdates.bike_rc_local_pending = false;
      cloudUpdates.bike_document_local_pending = false;
    }
    await db.collection('rider_profiles').doc(riderProfile.mobile).set(cloudUpdates, { merge: true });

    riderProfile = {
      ...riderProfile,
      ...cloudUpdates,
      profile_sync_pending: false,
      profile_sync_error: '',
      photo_local_pending: false,
      bike_license_local_pending: false,
      bike_rc_local_pending: false,
      bike_document_local_pending: false
    };
    const syncedProfile = { ...riderProfile };
    delete syncedProfile.password_hash;
    localStorage.setItem('rider_profile', JSON.stringify(syncedProfile));
    localStorage.removeItem('rider_profile_pending_sync');
    if (photoToUpload) await deleteLocalRiderFile(riderProfile.mobile, 'profile-photo');
    if (licenseToUpload) await deleteLocalRiderFile(riderProfile.mobile, 'bike-license');
    if (rcToUpload) {
      await deleteLocalRiderFile(riderProfile.mobile, 'bike-rc');
      await deleteLocalRiderFile(riderProfile.mobile, 'bike-document');
    }
    syncRiderAccount();
    closeRiderProfileModal();
    showStatus('Profile and bike details saved successfully.', true);
  } catch (error) {
    console.error('Rider profile update failed:', error);
    if (localProfileSaved) {
      riderProfile = {
        ...riderProfile,
        profile_sync_error: `Saved on this device. Cloud sync pending: ${error.message || 'Check connection and Firebase permissions.'}`
      };
      const safeProfile = { ...riderProfile };
      delete safeProfile.password_hash;
      localStorage.setItem('rider_profile', JSON.stringify(safeProfile));
      const queued = JSON.parse(localStorage.getItem('rider_profile_pending_sync') || 'null');
      if (queued?.mobile === riderProfile.mobile) {
        queued.updates.profile_sync_error = riderProfile.profile_sync_error;
        localStorage.setItem('rider_profile_pending_sync', JSON.stringify(queued));
      }
      syncRiderAccount();
      showStatus(`Saved on this device and visible in your profile. Cloud sync is pending: ${error.message || 'Check connection and Firebase permissions.'}`);
      closeRiderProfileModal();
    } else {
      showStatus(`Profile could not be saved: ${error.message || 'Check browser storage and try again.'}`);
    }

  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.innerText = 'Save details';
    }
  }
}

async function retryRiderProfileSync() {
  if (!riderProfile?.mobile) return;
  const pendingProfileSave = JSON.parse(localStorage.getItem('rider_profile_pending_sync') || 'null');
  if (pendingProfileSave?.mobile === riderProfile.mobile) {
    riderProfile = { ...riderProfile, ...pendingProfileSave.updates };
  }
  if (!riderProfile.profile_sync_pending && !riderProfile.photo_local_pending && !riderProfile.bike_license_local_pending && !riderProfile.bike_rc_local_pending && !riderProfile.bike_document_local_pending) return;
  const button = document.getElementById('riderProfileRetryButton');
  const status = document.getElementById('riderAccountSyncStatus');
  if (button) {
    button.disabled = true;
    button.innerText = 'Syncing...';
  }
  try {
    const updates = {
      bike_number: riderProfile.bike_number || '',
      bike_model: riderProfile.bike_model || '',
      bike_color: riderProfile.bike_color || '',
      bike_updated_at_ms: riderProfile.bike_updated_at_ms || Date.now()
    };
    if (riderProfile.photo_local_pending) {
      const photo = await getLocalRiderFile(riderProfile.mobile, 'profile-photo');
      if (!photo) throw new Error('The saved profile image is missing. Select it again and save.');
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/profile_${Date.now()}.${photo.type.split('/')[1] || 'jpg'}`);
      await storageRef.put(photo, { contentType: photo.type });
      updates.photo_url = await storageRef.getDownloadURL();
      updates.photo_path = storageRef.fullPath;
    }
    if (riderProfile.bike_license_local_pending) {
      const licenseFile = await getLocalRiderFile(riderProfile.mobile, 'bike-license');
      if (!licenseFile) throw new Error('The saved driving licence is missing. Select it again and save.');
      const extension = licenseFile.type.split('/')[1];
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/bike_license_${Date.now()}.${extension}`);
      await storageRef.put(licenseFile, { contentType: licenseFile.type });
      updates.bike_license_path = storageRef.fullPath;
    }
    if (riderProfile.bike_rc_local_pending || riderProfile.bike_document_local_pending) {
      const rcFile = await getLocalRiderFile(riderProfile.mobile, riderProfile.bike_rc_local_pending ? 'bike-rc' : 'bike-document');
      if (!rcFile) throw new Error('The saved bike RC photo is missing. Select it again and save.');
      const extension = rcFile.type.split('/')[1];
      const storageRef = firebase.storage().ref(`rider_verification/${riderProfile.mobile}/bike_rc_${Date.now()}.${extension}`);
      await storageRef.put(rcFile, { contentType: rcFile.type });
      updates.bike_rc_path = storageRef.fullPath;
    }
    await db.collection('rider_profiles').doc(riderProfile.mobile).set(updates, { merge: true });
    riderProfile = {
      ...riderProfile,
      ...updates,
      profile_sync_pending: false,
      profile_sync_error: '',
      photo_local_pending: false,
      bike_license_local_pending: false,
      bike_rc_local_pending: false,
      bike_document_local_pending: false
    };
    const safeProfile = { ...riderProfile };
    delete safeProfile.password_hash;
    localStorage.setItem('rider_profile', JSON.stringify(safeProfile));
    localStorage.removeItem('rider_profile_pending_sync');
    if (updates.photo_url) await deleteLocalRiderFile(riderProfile.mobile, 'profile-photo');
    if (updates.bike_license_path) await deleteLocalRiderFile(riderProfile.mobile, 'bike-license');
    if (updates.bike_rc_path) {
      await deleteLocalRiderFile(riderProfile.mobile, 'bike-rc');
      await deleteLocalRiderFile(riderProfile.mobile, 'bike-document');
    }
    syncRiderAccount();
    if (status) {
      status.innerText = 'Profile changes synced successfully.';
      status.className = 'rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-[10px] font-bold text-emerald-800';
    }
  } catch (error) {
    console.error('Rider profile sync retry failed:', error);
    if (status) {
      status.innerText = `Still waiting to sync: ${error.message || 'Check connection and Firebase permissions.'}`;
      status.classList.remove('hidden');
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.innerText = 'Retry profile sync';
    }
  }
}

function openRiderPhotoModal(orderId, type) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order) return;
  const normalizedStatus = String(order.status || '').toUpperCase();
  if (type === 'pickup' && !Object.values(order.pickup_progress || {}).some(Boolean) && !['PICKING_UP', 'OUT FOR DELIVERY'].includes(normalizedStatus)) {
    alert('Mark the pickup location as reached and complete pickup before uploading pickup proof.');
    return;
  }
  if (type === 'delivery' && normalizedStatus !== 'OUT FOR DELIVERY') {
    alert('Delivery proof is available only after starting the delivery route.');
    return;
  }
  currentPhotoOrderId = orderId;
  currentPhotoType = type;
  document.getElementById('riderPhotoTitle').innerText = type === 'pickup' ? 'Upload pickup proof' : 'Upload delivery proof';
  document.getElementById('riderPhotoHelp').innerText = type === 'pickup'
    ? 'Take a clear photo after collecting the order from the hotel/store.'
    : 'Take a clear delivery handover photo before confirming the customer OTP.';
  document.getElementById('riderPhotoModal')?.classList.remove('hidden');
}

function closeRiderPhotoModal() {
  document.getElementById('riderPhotoModal')?.classList.add('hidden');
  currentPhotoOrderId = null;
  currentPhotoType = null;
}

async function uploadRiderOrderPhoto() {
  const file = document.getElementById('riderOrderPhotoInput')?.files?.[0];
  const status = document.getElementById('riderPhotoStatus');
  if (!file || !currentPhotoOrderId || !currentPhotoType) {
    if (status) { status.innerText = 'Choose a photo first.'; status.classList.remove('hidden'); }
    return;
  }
  try {
    const path = await uploadRiderVerificationFile(file, currentActiveRider, `order_${currentPhotoOrderId}_${currentPhotoType}`);
    const field = currentPhotoType === 'pickup' ? 'pickup_proof' : 'delivery_proof';
    await db.collection('orders').doc(currentPhotoOrderId).update({
      [field]: { path, file_name: file.name, uploaded_at_ms: Date.now(), rider_name: currentActiveRider },
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeRiderPhotoModal();
  } catch (error) {
    console.error('Order proof upload failed:', error);
    if (status) { status.innerText = 'Upload failed. Check Firebase Storage rules.'; status.classList.remove('hidden'); }
  }
}

function openRiderReturnModal(orderId) {
  currentReturnOrderId = orderId;
  document.getElementById('riderReturnModal')?.classList.remove('hidden');
}

function closeRiderReturnModal() {
  document.getElementById('riderReturnModal')?.classList.add('hidden');
  currentReturnOrderId = null;
}

async function submitRiderReturn() {
  const reason = document.getElementById('riderCancelReasonInput')?.value.trim();
  const file = document.getElementById('riderReturnPhotoInput')?.files?.[0];
  const status = document.getElementById('riderReturnStatus');
  if (!reason || !file || !currentReturnOrderId) {
    if (status) { status.innerText = 'Reason and hotel return pickup proof are required.'; status.classList.remove('hidden'); }
    return;
  }
  try {
    const order = allRiderOrders.find(item => item.id === currentReturnOrderId);
    if (!order?.pickup_proof && !Object.values(order?.pickup_progress || {}).some(Boolean)) {
      if (status) { status.innerText = 'Complete pickup and upload pickup proof before returning an order.'; status.classList.remove('hidden'); }
      return;
    }
    const path = await uploadRiderVerificationFile(file, currentActiveRider, `return_${currentReturnOrderId}`);
    const orderRef = db.collection('orders').doc(currentReturnOrderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data().assigned_rider !== currentActiveRider) {
        throw new Error('This order is no longer assigned to you.');
      }
      const statusNow = String(snapshot.data().status || '').toUpperCase();
      if (statusNow !== 'OUT FOR DELIVERY' && statusNow !== 'PICKING_UP') {
        throw new Error('Only an active picked-up order can be returned.');
      }
      transaction.update(orderRef, {
        status: 'RETURN_TO_HOTEL',
        cancellation_reason: reason,
        cancelled_by: currentActiveRider,
        cancelled_at_ms: Date.now(),
        return_to_hotel: true,
        return_pickup_proof: { path, file_name: file.name, uploaded_at_ms: Date.now() },
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    closeRiderReturnModal();
  } catch (error) {
    console.error('Rider return update failed:', error);
    if (status) { status.innerText = 'Return update failed. Try again.'; status.classList.remove('hidden'); }
  }
}

function updateRiderIdentity() {
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider || 'Not registered';
  const welcomeScreen = document.getElementById('riderWelcomeScreen');
  const appShell = document.getElementById('riderAppShell');
  const bottomNav = document.getElementById('riderBottomNav');
  const isAuthenticated = Boolean(riderProfile?.name && currentActiveRider);
  welcomeScreen?.classList.toggle('hidden', isAuthenticated);
  appShell?.classList.toggle('hidden', !isAuthenticated);
  bottomNav?.classList.toggle('hidden', !isAuthenticated);
  syncRiderAccount();
  updateAvailabilityUi();
}

function isRiderSessionExpired() {
  const startedAt = Number(localStorage.getItem('rider_session_started_at') || 0);
  return Boolean(!startedAt || Date.now() - startedAt > RIDER_SESSION_TTL_MS);
}

function deliveryStatusSteps(order) {
  const status = String(order.status || 'PLACED').toUpperCase();
  if (status.includes('CANCEL')) return '<div class="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[10px] font-black text-rose-700">Cancelled · Return to hotel required</div>';
  if (status === 'RETURN_TO_HOTEL') return '<div class="rounded-xl bg-orange-50 border border-orange-200 px-3 py-2 text-[10px] font-black text-orange-700">Cancelled · Returning order to hotel</div>';
  const steps = [
    ['ACCEPTED_BY_RIDER', 'Accepted'],
    ['PICKING_UP', 'Picking up'],
    ['OUT FOR DELIVERY', 'Out for delivery'],
    ['DELIVERED', 'Delivered']
  ];
  const aliases = { ACCEPTED: 'ACCEPTED_BY_RIDER', 'OUT_FOR_DELIVERY': 'OUT FOR DELIVERY' };
  const current = aliases[status] || status;
  const currentIndex = steps.findIndex(([key]) => key === current);
  return `<div class="grid grid-cols-4 gap-1 pt-2" aria-label="Delivery status">
    ${steps.map(([key, label], index) => `<div class="text-center">
      <span class="mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${index <= currentIndex ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}">${index < currentIndex ? '✓' : index + 1}</span>
      <span class="mt-1 block text-[9px] font-bold ${index <= currentIndex ? 'text-emerald-700' : 'text-slate-400'}">${label}</span>
    </div>`).join('')}
  </div>`;
}

function setSupportRange(range) {
  currentSupportRange = range;
  document.querySelectorAll('.support-range-btn').forEach(button => {
    button.classList.toggle('bg-slate-900', button.innerText.toLowerCase() === range);
    button.classList.toggle('text-white', button.innerText.toLowerCase() === range);
    button.classList.toggle('bg-slate-100', button.innerText.toLowerCase() !== range);
  });
  loadRiderSupportMetrics();
}

function supportRangeStart(range) {
  const now = Date.now();
  const duration = range === 'hours' ? 60 * 60 * 1000 : range === 'day' ? 24 * 60 * 60 * 1000 : range === 'week' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
  return now - duration;
}

async function loadRiderSupportMetrics() {
  const container = document.getElementById('riderSupportMetrics');
  if (!container || !currentActiveRider) return;
  const start = supportRangeStart(currentSupportRange);
  const orders = allRiderOrders.filter(order => {
    const time = Number(order.created_at_ms || order.cancelled_at_ms || 0);
    return time >= start && order.assigned_rider === currentActiveRider;
  });
  let distanceKm = 0;
  let onlineMinutes = 0;
  let drivingMinutes = 0;
  try {
    const snapshot = await db.collection('riders_activity').where('rider_name', '==', currentActiveRider).get();
    const events = snapshot.docs.map(doc => doc.data()).filter(event => Number(event.created_at_ms || 0) >= start);
    onlineMinutes = events.filter(event => event.type === 'online').reduce((sum, event) => sum + Number(event.minutes || 0), 0);
    drivingMinutes = events.filter(event => event.type === 'driving').reduce((sum, event) => sum + Number(event.minutes || 0), 0);
  } catch (error) {
    console.warn('Rider activity metrics unavailable:', error);
  }
  try {
    const snapshot = await db.collection('riders_distance_logs').where('rider_name', '==', currentActiveRider).get();
    const logs = snapshot.docs.map(doc => doc.data()).filter(log => Number(log.created_at_ms || 0) >= start);
    distanceKm = logs.reduce((sum, log) => sum + Number(log.distance_km || 0), 0);
  } catch (error) {
    console.warn('Rider distance metrics unavailable:', error);
  }
  const cancelled = orders.filter(order => ['CANCELLED', 'RETURN_TO_HOTEL', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RIDER'].includes(String(order.status || '').toUpperCase())).length;
  container.innerHTML = [
    ['Cancelled orders', cancelled],
    ['Distance travelled', `${distanceKm.toFixed(1)} km`],
    ['Online time', formatDuration(onlineMinutes)],
    ['Driving time', formatDuration(drivingMinutes)]
  ].map(([label, value]) => `<div class="rounded-xl bg-slate-50 p-3"><span class="block text-[10px] font-bold text-slate-500">${label}</span><strong class="block text-base font-black text-slate-900 mt-1">${value}</strong></div>`).join('');
}

async function logRiderActivity(type, minutes = 0) {
  if (!currentActiveRider) return;
  try {
    await db.collection('riders_activity').add({ rider_name: currentActiveRider, type, minutes, created_at_ms: Date.now() });
  } catch (error) {
    console.warn('Rider activity logging failed:', error);
  }
}

async function logoutRider() {
  const riderName = currentActiveRider;
  if (riderOnlineStartedAt) {
    await logRiderActivity('online', (Date.now() - riderOnlineStartedAt) / 60000);
    riderOnlineStartedAt = null;
  }
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
  riderOrdersUnsubscribe?.();
  riderOrdersUnsubscribe = null;
  localStorage.removeItem('rider_profile');
  localStorage.removeItem('active_rider_name');
  localStorage.removeItem('rider_available');
  localStorage.removeItem('rider_session_started_at');
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
  if (riderProfile.verification_status !== 'APPROVED') {
    pendingRiderRegistration = riderProfile;
    openRiderVerificationModal();
    alert('Complete document verification and wait for Admin approval before going online.');
    return;
  }
  if (!riderIsAvailable && !isWithinWorkingHours()) {
    alert('Rider availability is open only from 7:00 AM to 10:00 PM.');
    return;
  }
  riderIsAvailable = !riderIsAvailable;
  localStorage.setItem('rider_available', String(riderIsAvailable));
  if (riderIsAvailable) {
    riderOnlineStartedAt = Date.now();
    startRiderGpsBroadcast();
    riderNearbyOrderIds = new Set();
    startRiderOrdersListener();
  } else {
    if (riderOnlineStartedAt) {
      await logRiderActivity('online', (Date.now() - riderOnlineStartedAt) / 60000);
      riderOnlineStartedAt = null;
    }
    stopRiderGpsBroadcast();
  }
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
  riderOrdersUnsubscribe?.();
  if (!currentActiveRider) {
    allRiderOrders = [];
    renderPickupQueue();
    renderRiderOrders();
    return;
  }
  riderOrdersUnsubscribe = db.collection("orders").orderBy("created_at", "desc").onSnapshot((snapshot) => {
    let orders = [];
    snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
    const assignedNow = orders.filter(order => order.assigned_rider === currentActiveRider && String(order.status || '').toUpperCase() !== 'DELIVERED');
    const nearbyNow = riderIsAvailable
      ? orders.filter(order => isNearbyUnassignedOrder(order))
      : [];
    const newlyAssigned = assignedNow.filter(order => !knownAssignedOrderIds.has(order.id));
    const newlyNearby = nearbyNow.filter(order => !riderNearbyOrderIds.has(`${order.id}:${String(order.status || "PLACED").toUpperCase()}`));
    if (riderOrdersInitialized && newlyAssigned.length > 0) {
      notifyNewAssignment(newlyAssigned[0]);
    }
    if (riderOrdersInitialized && newlyNearby.length > 0) notifyNewAssignment(newlyNearby[0], true);
    knownAssignedOrderIds = new Set(assignedNow.map(order => order.id));
    riderNearbyOrderIds = new Set(nearbyNow.map(order => `${order.id}:${String(order.status || "PLACED").toUpperCase()}`));
    riderOrdersInitialized = true;
    allRiderOrders = orders;
    renderPickupQueue();
    renderRiderOrders();
  }, error => {
    console.error('Rider order stream failed:', error);
    const banner = document.getElementById('riderAlertBanner');
    if (banner) {
      banner.innerText = 'Orders could not be refreshed. Check your connection and reload the rider app.';
      banner.classList.remove('hidden');
    }
  });
}

function getOrderPickupPoint(order) {
  if (Number.isFinite(Number(order.pickup_latitude)) && Number.isFinite(Number(order.pickup_longitude))) {
    return { lat: Number(order.pickup_latitude), lng: Number(order.pickup_longitude) };
  }
  return RIDER_DEFAULT_PICKUP;
}

function isNearbyUnassignedOrder(order) {
  const status = String(order.status || "PLACED").toUpperCase();
  if (!currentActiveRider || !riderIsAvailable || order.assigned_rider || !["PLACED", "REJECTED_BY_RIDER"].includes(status)) return false;
  const riderLocation = window.currentRiderLocation;
  if (!riderLocation) return false;
  const pickup = getOrderPickupPoint(order);
  return calculateDistanceKm(riderLocation.lat, riderLocation.lng, pickup.lat, pickup.lng) <= RIDER_DISPATCH_RADIUS_KM;
}

function notifyNewAssignment(order, nearby = false) {
  RIDER_ORDER_SOUND.currentTime = 0;
  RIDER_ORDER_SOUND.play().catch(() => {});
  const banner = document.getElementById('riderAlertBanner');
  if (banner) {
    banner.innerHTML = `
      <div>${nearby ? 'Nearby order available' : 'New delivery assigned'}: <strong>${order.id}</strong>. <button type="button" onclick="openRiderOrderAlert()" class="underline font-black">Open orders</button></div>
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
    if (!currentActiveRider || !riderProfile?.name) throw new Error('Sign in before accepting an order.');
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async transaction => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error("Order is no longer available.");
      const order = orderSnapshot.data();
      if (order.assigned_rider && order.assigned_rider !== currentActiveRider) throw new Error("Another rider already accepted this order.");
      if (!["PLACED", "REJECTED_BY_RIDER", "ACCEPTED"].includes(String(order.status || "PLACED").toUpperCase())) throw new Error("This order is no longer available for acceptance.");
      transaction.update(orderRef, {
        assigned_rider: currentActiveRider,
        rider_name: riderProfile?.name || currentActiveRider,
        rider_phone: riderProfile?.mobile || "",
        pickup_otp: order.pickup_otp || String(Math.floor(1000 + Math.random() * 9000)),
        status: "ACCEPTED_BY_RIDER",
        rider_accepted_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
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
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists) throw new Error('Order is no longer available.');
      const order = snapshot.data();
      if (order.assigned_rider !== currentActiveRider || String(order.status || '').toUpperCase() !== 'ACCEPTED_BY_RIDER') {
        throw new Error('Only an order assigned to you and not yet picked up can be released.');
      }
      transaction.update(orderRef, {
        status: "REJECTED_BY_RIDER",
        assigned_rider: firebase.firestore.FieldValue.delete(),
        rejected_by_rider: currentActiveRider,
        rider_rejected_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    riderNearbyOrderIds = new Set([...riderNearbyOrderIds].filter(key => !key.startsWith(`${orderId}:`)));
    stopRiderOrderAlertSound();
    const banner = document.getElementById('riderAlertBanner');
    if (banner) banner.classList.add('hidden');
  } catch (error) {
    alert(`Unable to release delivery: ${error.message}`);
  }
}

// --- REAL-TIME GPS STREAMING TO FIRESTORE ---
function startRiderGpsBroadcast() {
  if (!navigator.geolocation) return;
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);

  gpsWatchId = navigator.geolocation.watchPosition(
    async (position) => {
      const { latitude, longitude } = position.coords;
      if (!riderDrivingStartedAt) riderDrivingStartedAt = Date.now();
      if (lastRiderGpsPoint) {
        const distanceKm = calculateDistanceKm(lastRiderGpsPoint.lat, lastRiderGpsPoint.lng, latitude, longitude);
        if (distanceKm > 0.01 && distanceKm < 2) {
          db.collection('riders_distance_logs').add({ rider_name: currentActiveRider, distance_km: distanceKm, created_at_ms: Date.now() }).catch(error => console.warn('Distance log failed:', error));
        }
      }
      lastRiderGpsPoint = { lat: latitude, lng: longitude };
      window.currentRiderLocation = { lat: latitude, lng: longitude };
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
  if (riderDrivingStartedAt) {
    logRiderActivity('driving', (Date.now() - riderDrivingStartedAt) / 60000);
    riderDrivingStartedAt = null;
  }
  if (gpsWatchId) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  lastRiderGpsPoint = null;
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
        address: item.pickup_source_address || "Mandapeta Dark Store",
        items: []
      };
    }
    groups[key].items.push(item);
  });

  if (!Object.keys(groups).length) {
    groups.store = {
      key: "store",
      name: "MyShopzy Store",
      address: "Mandapeta Dark Store",
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
        <button ${!completed[group.key] && nextGroup?.key !== group.key ? 'disabled' : ''} onclick="${completed[group.key] ? '' : order.pickup_reached?.[group.key] ? `markPickupComplete('${order.id}', '${group.key}')` : `markPickupReached('${order.id}', '${group.key}')`}" class="w-full text-left p-2 bg-white border ${completed[group.key] ? 'border-emerald-300' : 'border-amber-200'} rounded-lg flex items-center gap-2 ${!completed[group.key] && nextGroup?.key !== group.key ? 'opacity-50 cursor-not-allowed' : ''}">
          <span class="w-5 h-5 rounded-full ${completed[group.key] ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'} flex items-center justify-center text-[10px] font-black">${completed[group.key] ? '✓' : '○'}</span>
          <span class="min-w-0 flex-1"><strong class="block text-[11px] text-slate-900">${group.name}</strong><span class="block text-[10px] text-slate-500 truncate">${group.address}</span><span class="block text-[10px] text-slate-500">${group.items.map(item => `${item.quantity}x ${item.name}`).join(', ') || 'Legacy order items'}</span></span>
          <span class="text-[10px] font-black ${completed[group.key] ? 'text-emerald-600' : 'text-amber-700'}">${completed[group.key] ? 'Picked' : nextGroup?.key !== group.key ? 'Next' : order.pickup_reached?.[group.key] ? 'Pickup OTP' : 'Reached'}</span>
        </button>
        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(group.address)}" target="_blank" class="block text-[10px] text-blue-600 font-bold text-right -mt-1">Open pickup location ↗</a>
      `).join('')}
      ${order.pickup_otp && nextGroup ? `<p class="rounded-lg bg-slate-900 px-2 py-1.5 text-[10px] font-black text-amber-300">Pickup OTP: ${order.pickup_otp} · Tell the store after reaching</p>` : ''}
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

async function markPickupReached(orderId, sourceKey) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order || order.assigned_rider !== currentActiveRider) return;
  try {
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data().assigned_rider !== currentActiveRider) {
        throw new Error('This order is no longer assigned to you.');
      }
      const current = snapshot.data();
      transaction.update(orderRef, {
        pickup_reached: { ...(current.pickup_reached || {}), [sourceKey]: true },
        status: "PICKING_UP",
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    alert("Reached update failed: " + error.message);
  }
}

async function markPickupComplete(orderId, sourceKey) {
  const order = allRiderOrders.find(item => item.id === orderId);
  if (!order) return;
  if (!order.pickup_reached?.[sourceKey]) {
    alert("Tap Reached after arriving at the pickup location first.");
    return;
  }
  const pickupOtp = prompt("Enter the pickup OTP shown in the order card:");
  if (pickupOtp !== order.pickup_otp) {
    alert("Pickup OTP mismatch. Ask the store for the correct code.");
    return;
  }
  try {
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data().assigned_rider !== currentActiveRider) {
        throw new Error('This order is no longer assigned to you.');
      }
      const current = snapshot.data();
      if (!current.pickup_reached?.[sourceKey] || current.pickup_otp !== pickupOtp) {
        throw new Error('Pickup arrival or OTP is no longer valid. Refresh and try again.');
      }
      transaction.update(orderRef, {
        pickup_progress: { ...(current.pickup_progress || {}), [sourceKey]: true },
        status: "PICKING_UP",
        rider_name: riderProfile?.name || currentActiveRider,
        rider_phone: riderProfile?.mobile || "",
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
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
  renderRiderStatusSummary(riderOrders);

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

    const encodedAddress = encodeURIComponent(o.delivery_address || 'Mandapeta');
    const normalizedStatus = String(o.status || '').toUpperCase();
    const customerDetailsUnlocked = ['OUT FOR DELIVERY', 'DELIVERED'].includes(normalizedStatus);
    const terminalStatus = ['DELIVERED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RIDER', 'RETURN_TO_HOTEL'].includes(normalizedStatus);
    const fullyPicked = canStartDelivery(o);
    const canReleaseBeforePickup = normalizedStatus === 'ACCEPTED_BY_RIDER' && !Object.values(o.pickup_progress || {}).some(Boolean);
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
      ${deliveryStatusSteps(o)}

      <div>
        ${customerDetailsUnlocked ? `<p class="text-xs font-bold text-slate-900">${o.delivery_address}</p>` : '<p class="rounded-xl bg-amber-50 border border-amber-200 px-2 py-2 text-[11px] font-bold text-amber-800">Customer delivery details unlock after pickup is complete.</p>'}
        ${o.order_type === 'PARCEL' ? `<p class="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1 mt-1 font-bold">📍 Pickup: ${o.parcel_pickup_address || 'Pickup address pending'} → Drop: ${o.parcel_drop_address || o.delivery_address}</p>` : ''}
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

      ${customerDetailsUnlocked ? `<div class="grid grid-cols-2 gap-2 pt-1">
        <a href="tel:${o.customer_phone}" class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="phone" class="w-3.5 h-3.5 text-brand-accent"></i> Call customer
        </a>
        <a href="${customerMapUrl}" target="_blank" class="py-2 px-3 bg-blue-50 hover:bg-blue-100 text-brand-accent rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition">
          <i data-lucide="navigation" class="w-3.5 h-3.5"></i> Start route
        </a>
      </div>` : ''}

      ${!terminalStatus ? `
        <div class="grid grid-cols-2 gap-2 pt-1">
          ${fullyPicked ? (o.pickup_proof
            ? '<span class="py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[10px] font-black text-emerald-700 text-center">Pickup proof saved</span>'
            : `<button onclick="openRiderPhotoModal('${o.id}', 'pickup')" class="py-2 bg-amber-50 border border-amber-200 rounded-xl text-[10px] font-black text-amber-800">Upload pickup photo</button>`)
            : '<span class="py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500 text-center">Finish all pickups first</span>'}
          ${normalizedStatus === 'OUT FOR DELIVERY' ? (o.delivery_proof
            ? '<span class="py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[10px] font-black text-emerald-700 text-center">Delivery proof saved</span>'
            : `<button onclick="openRiderPhotoModal('${o.id}', 'delivery')" class="py-2 bg-blue-50 border border-blue-200 rounded-xl text-[10px] font-black text-blue-700">Upload delivery photo</button>`)
            : ''}
          ${!['ACCEPTED_BY_RIDER', 'OUT FOR DELIVERY', 'DELIVERED'].includes(String(o.status || '').toUpperCase()) ? `
            <button onclick="acceptRiderOrder('${o.id}')" class="py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-black transition">Accept delivery</button>
          ` : normalizedStatus !== 'OUT FOR DELIVERY' && fullyPicked && o.pickup_proof ? `
            <button onclick="setOutForDelivery('${o.id}')" class="py-2.5 bg-brand-navy hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition">
              Start delivery
            </button>
          ` : normalizedStatus === 'OUT FOR DELIVERY' ? `
            <div class="py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] font-bold text-emerald-700 text-center">
              Live GPS streaming
            </div>
          ` : fullyPicked && !o.pickup_proof ? '<span class="py-2 bg-slate-100 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-500 text-center">Add pickup proof to start</span>' : ''}
          ${normalizedStatus === 'OUT FOR DELIVERY' && o.delivery_proof ? `
            <button onclick="openOtpModal('${o.id}')" class="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition">Verify customer OTP</button>
          ` : normalizedStatus === 'OUT FOR DELIVERY' ? `
            <button type="button" disabled class="py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black">Upload proof before OTP</button>
          ` : ''}
          ${canReleaseBeforePickup ? `<button onclick="rejectRiderOrder('${o.id}')" class="py-2 bg-rose-50 border border-rose-200 rounded-xl text-[10px] font-black text-rose-700">Release order</button>` : fullyPicked ? `<button onclick="openRiderReturnModal('${o.id}')" class="py-2 bg-rose-50 border border-rose-200 rounded-xl text-[10px] font-black text-rose-700">Cancel / return</button>` : ''}
        </div>
      ` : ''}
    `;
    container.appendChild(card);
  });
  if (window.lucide) lucide.createIcons();
}

function renderRiderStatusSummary(orders = []) {
  const container = document.getElementById('riderStatusSummary');
  if (!container) return;
  const counts = orders.reduce((summary, order) => {
    const status = String(order.status || 'PLACED').toUpperCase();
    if (['CANCELLED', 'RETURN_TO_HOTEL', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RIDER'].includes(status)) summary.cancelled += 1;
    else if (status === 'DELIVERED') summary.delivered += 1;
    else if (status === 'OUT FOR DELIVERY') summary.outForDelivery += 1;
    else if (status === 'PICKING_UP') summary.pickingUp += 1;
    else summary.accepted += 1;
    return summary;
  }, { accepted: 0, pickingUp: 0, outForDelivery: 0, delivered: 0, cancelled: 0 });
  const nextOrder = orders.find(order => !['DELIVERED', 'CANCELLED', 'RETURN_TO_HOTEL'].includes(String(order.status || '').toUpperCase()));
  container.innerHTML = `
    <div class="flex items-center justify-between">
      <div><p class="text-[10px] font-black uppercase tracking-wider text-slate-400">Delivery status</p>
      <h2 class="text-sm font-black text-slate-900">${nextOrder ? `Next: ${nextOrder.id}` : 'All clear'}</h2></div>
      <span class="rounded-xl bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">${counts.outForDelivery} on route</span>
    </div>
    <div class="mt-3 grid grid-cols-5 gap-1 text-center">
      ${[['Accepted', counts.accepted], ['Pickup', counts.pickingUp], ['On route', counts.outForDelivery], ['Done', counts.delivered], ['Cancelled', counts.cancelled]].map(([label, count]) => `<div class="rounded-xl bg-slate-50 p-2"><strong class="block text-base font-black text-slate-900">${count}</strong><span class="text-[9px] font-bold text-slate-500">${label}</span></div>`).join('')}
    </div>`;
}

async function setOutForDelivery(orderId) {
  try {
    const order = allRiderOrders.find(item => item.id === orderId);
    if (!order || !canStartDelivery(order)) {
      alert("Complete every pickup before starting delivery.");
      return;
    }
    if (!order.pickup_proof) {
      alert('Upload the pickup photo before starting delivery.');
      return;
    }
    if (!['ACCEPTED', 'ACCEPTED_BY_RIDER', 'PICKING_UP'].includes(String(order.status || '').toUpperCase())) {
      alert('This order is no longer in a state that can be dispatched.');
      return;
    }
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists || snapshot.data().assigned_rider !== currentActiveRider) {
        throw new Error('This order is no longer assigned to you.');
      }
      const current = snapshot.data();
      const currentStatus = String(current.status || '').toUpperCase();
      if (!['ACCEPTED', 'ACCEPTED_BY_RIDER', 'PICKING_UP'].includes(currentStatus) || !current.pickup_proof) {
        throw new Error('Pickup completion and photo proof are required before dispatch.');
      }
      transaction.update(orderRef, {
        status: "Out for Delivery",
        rider_name: riderProfile?.name || currentActiveRider,
        rider_phone: riderProfile?.mobile || "",
        customer_details_unlocked_at: firebase.firestore.FieldValue.serverTimestamp(),
        dispatched_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    startRiderGpsBroadcast();
  } catch(e) {
    alert("Error: " + e.message);
  }
}

// DIRECT DATASET-BASED SAFE OTP MODAL
function openOtpModal(orderId) {
  const foundOrder = allRiderOrders.find(o => o.id === orderId);
  if (!foundOrder) return;
  if (String(foundOrder.status || '').toUpperCase() !== 'OUT FOR DELIVERY') {
    alert('Only an active delivery can be confirmed.');
    return;
  }
  if (!foundOrder.delivery_proof) {
    alert('Upload the customer delivery photo before verifying OTP.');
    return;
  }
  currentVerifyingOrderId = orderId;

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

  const order = allRiderOrders.find(item => item.id === currentVerifyingOrderId);
  if (!order || order.assigned_rider !== currentActiveRider || String(order.status || '').toUpperCase() !== 'OUT FOR DELIVERY') {
    alert('Start this delivery before confirming the customer OTP.');
    closeOtpModal();
    return;
  }

  if (enteredOtp === expectedOtp) {
    try {
      const orderRef = db.collection("orders").doc(currentVerifyingOrderId);
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists) throw new Error('Order no longer exists.');
        const current = snapshot.data();
        if (current.assigned_rider !== currentActiveRider || String(current.status || '').toUpperCase() !== 'OUT FOR DELIVERY' || !current.delivery_proof) {
          throw new Error('Order state or delivery proof changed. Refresh before confirming.');
        }
        transaction.update(orderRef, {
          status: "Delivered",
          payment_status: "COMPLETED",
          delivered_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp()
        });
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
  if (isRiderSessionExpired()) {
    riderProfile = null;
    currentActiveRider = '';
    localStorage.removeItem('rider_profile');
    localStorage.removeItem('active_rider_name');
    localStorage.removeItem('rider_session_started_at');
  }
  if (!riderProfile?.name) currentActiveRider = '';
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider;

  updateRiderIdentity();
  updateAvailabilityUi();
  showRiderSection('home');
  if (currentActiveRider) {
    startRiderOrdersListener();
    const pendingProfileSave = JSON.parse(localStorage.getItem('rider_profile_pending_sync') || 'null');
    if (pendingProfileSave?.mobile === riderProfile?.mobile) retryRiderProfileSync();
  }
  if (riderIsAvailable && isWithinWorkingHours()) startRiderGpsBroadcast();
  if (window.lucide) lucide.createIcons();
});