// ==========================================
// 🛵 DELIVERY PARTNER ENGINE (rider.js)
// ==========================================

let riderProfile = null;
let currentActiveRider = '';
let currentTab = 'pending';
let allRiderOrders = [];
let currentVerifyingOrderId = null;
let gpsWatchId = null;
let activeGpsAssignmentId = null;
let riderIsAvailable = false;
let knownAssignedOrderIds = new Set();
let riderOrdersInitialized = false;
let riderOrdersUnsubscribe = null;
let pendingRiderRegistration = null;
let riderNotifications = [];
let riderEarnings = null;
let riderAuthMode = 'login';
let riderOtpPurpose = '';
let riderOtpPhone = '';
let riderOtpCountdownTimer = null;
let riderOtpSecondsRemaining = 45;
let riderSelectedVehicleType = 'BIKE';
const RIDER_ORDER_SOUND = new Audio("../assets/audio/admin-rider-order.mpeg");
const RIDER_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
const RIDER_API_BASE_URL = 'http://localhost:5000';
const RIDER_REQUIRED_DOCUMENT_TYPES = ['SELFIE', 'AADHAAR', 'PAN'];
const RIDER_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const RIDER_DOCUMENT_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const RIDER_DOCUMENT_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
RIDER_ORDER_SOUND.loop = true;

function getRiderAccessToken() {
  return sessionStorage.getItem('user_access_token')
    || localStorage.getItem('user_access_token')
    || sessionStorage.getItem('myshopzy_user_access_token')
    || localStorage.getItem('myshopzy_user_access_token')
    || '';
}

function buildRiderApiHeaders(additionalHeaders = {}, tokenOverride = '') {
  const headers = { ...additionalHeaders };
  const token = tokenOverride || getRiderAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function normalizeRiderPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\+\d{10,15}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && digits.startsWith('91')) return `+${digits}`;
  return '';
}

function persistRiderAccessToken(token) {
  if (!token) return;
  for (const key of ['user_access_token', 'myshopzy_user_access_token']) {
    sessionStorage.setItem(key, token);
    localStorage.setItem(key, token);
  }
}

function clearRiderAuthState() {
  riderProfile = null;
  currentActiveRider = '';
  riderIsAvailable = false;
  riderAuthMode = 'login';
  pendingRiderRegistration = null;
  riderOtpPurpose = '';
  window.clearInterval(riderOtpCountdownTimer);
  riderOtpCountdownTimer = null;
  knownAssignedOrderIds = new Set();
  riderOrdersInitialized = false;
  riderOrdersUnsubscribe?.();
  riderOrdersUnsubscribe = null;
  allRiderOrders = [];
  riderNotifications = [];
  riderEarnings = null;
  stopRiderGpsBroadcast();
  localStorage.removeItem('rider_profile');
  localStorage.removeItem('active_rider_name');
  localStorage.removeItem('rider_available');
  localStorage.removeItem('rider_registration_pending');
  for (const key of ['user_access_token', 'myshopzy_user_access_token']) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
  renderPickupQueue();
  renderRiderOrders();
  renderRiderNotifications();
  renderRiderEarnings();
  updateRiderIdentity();
}

async function riderApiRequest(path, options = {}) {
  const { authToken = '', preserveAuthOn401 = false, headers: extraHeaders = {}, ...requestOptions } = options;
  const hasSessionToken = Boolean(authToken || getRiderAccessToken());
  const response = await fetch(`${RIDER_API_BASE_URL}${path}`, {
    ...requestOptions,
    headers: buildRiderApiHeaders({
      Accept: 'application/json',
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders
    }, authToken)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && hasSessionToken && !preserveAuthOn401) clearRiderAuthState();
    const message = payload?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
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
    let riderProfileResult;
    try {
      riderProfileResult = await riderApiRequest('/api/rider/me');
    } catch (error) {
      if (error.status === 404 && localStorage.getItem('rider_registration_pending')) {
        const user = authUser?.user || null;
        pendingRiderRegistration = {
          name: user?.display_name || '',
          mobile: user?.phone_e164 || '',
          email: user?.email || '',
          vehicle_type: localStorage.getItem('rider_registration_pending') || 'BIKE'
        };
        return { needsApplication: true };
      }
      throw error;
    }
    const rider = riderProfileResult?.data?.rider || null;
    const user = authUser?.user || riderProfileResult?.data?.user || null;
    if (!rider || !user || String(rider.user_id) !== String(user.id)) return null;

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
    riderAuthMode = mergedProfile.verification_status === 'APPROVED' ? 'dashboard' : 'pending';
    localStorage.setItem('rider_profile', JSON.stringify(mergedProfile));
    localStorage.setItem('active_rider_name', mergedProfile.name);
    localStorage.removeItem('rider_registration_pending');
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

function formatRiderCurrency(amount) {
  const numericValue = Number(amount || 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(numericValue);
}

function formatRiderNotificationTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
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
  if (section === 'account') {
    syncRiderAccount();
    loadRiderNotifications();
    loadRiderEarnings();
  }
}

function showRiderAuthScreen(screenName) {
  riderAuthMode = screenName;
  if (screenName === 'register') setRiderAuthError('riderRegisterError', '');
  const isApplicationResume = screenName === 'register'
    && Boolean(getRiderAccessToken() && localStorage.getItem('rider_registration_pending'));
  document.querySelector('.rider-register-form')?.classList.toggle('hidden', isApplicationResume);
  document.getElementById('riderApplicationRetry')?.classList.toggle('hidden', !isApplicationResume);
  document.querySelectorAll('.rider-auth-screen').forEach((screen) => {
    const active = screen.id === `rider${screenName[0].toUpperCase()}${screenName.slice(1)}Screen`
      || (screenName === 'loading' && screen.id === 'riderAuthLoading');
    screen.hidden = !active;
    screen.classList.toggle('is-active', active);
  });
  if (window.lucide) window.lucide.createIcons();
  if (screenName === 'login') document.getElementById('riderLoginIdentityInput')?.focus({ preventScroll: true });
  if (screenName === 'register') document.getElementById('riderNameInput')?.focus({ preventScroll: true });
  if (screenName === 'otp') document.querySelector('.rider-otp-digit')?.focus({ preventScroll: true });
}

function setRiderAuthError(elementId, message) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('hidden', !message);
}

function setRiderDevelopmentOtp(payload) {
  const element = document.getElementById('riderDevelopmentOtp');
  if (!element) return;
  const code = typeof payload?.development_otp === 'string' && /^\d{6}$/.test(payload.development_otp)
    ? payload.development_otp
    : '';
  element.textContent = code ? `Development OTP: ${code}` : '';
  element.classList.toggle('hidden', !code);
}

function startRiderOtpCountdown() {
  window.clearInterval(riderOtpCountdownTimer);
  riderOtpSecondsRemaining = 45;
  const countdown = document.getElementById('riderOtpCountdown');
  const resend = document.getElementById('riderOtpResend');
  const renderCountdown = () => {
    if (countdown) {
      const minutes = String(Math.floor(riderOtpSecondsRemaining / 60)).padStart(2, '0');
      const seconds = String(riderOtpSecondsRemaining % 60).padStart(2, '0');
      countdown.innerHTML = `Resend OTP in <strong>${minutes}:${seconds}</strong>`;
    }
    const finished = riderOtpSecondsRemaining <= 0;
    countdown?.classList.toggle('hidden', finished);
    resend?.classList.toggle('hidden', !finished);
    if (finished) {
      window.clearInterval(riderOtpCountdownTimer);
      riderOtpCountdownTimer = null;
    }
  };
  renderCountdown();
  riderOtpCountdownTimer = window.setInterval(() => {
    riderOtpSecondsRemaining -= 1;
    renderCountdown();
  }, 1000);
}

function maskRiderPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `+91 ${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function clearRiderOtpInputs() {
  document.querySelectorAll('.rider-otp-digit').forEach((input) => { input.value = ''; });
  setRiderAuthError('riderOtpError', '');
  document.querySelector('.rider-otp-digit')?.focus({ preventScroll: true });
}

async function requestRiderLoginOtp() {
  const phone = normalizeRiderPhone(document.getElementById('riderLoginIdentityInput')?.value);
  setRiderAuthError('riderLoginError', '');
  setRiderDevelopmentOtp(null);
  if (!phone) {
    setRiderAuthError('riderLoginError', 'Enter a valid 10-digit mobile number.');
    return;
  }
  try {
    const result = await riderApiRequest('/api/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone_e164: phone })
    });
    setRiderDevelopmentOtp(result);
    riderOtpPurpose = 'LOGIN';
    riderOtpPhone = phone;
    document.getElementById('riderOtpPhone').textContent = maskRiderPhone(phone);
    clearRiderOtpInputs();
    showRiderAuthScreen('otp');
    startRiderOtpCountdown();
  } catch (error) {
    setRiderAuthError('riderLoginError', error.message || 'Unable to request a verification code.');
  }
}

async function requestRiderRegistrationOtp() {
  const name = document.getElementById('riderNameInput')?.value.trim();
  const phone = normalizeRiderPhone(document.getElementById('riderMobileInput')?.value);
  const email = document.getElementById('riderEmailInput')?.value.trim().toLowerCase();
  const password = document.getElementById('riderPasswordInput')?.value || '';
  const referral = document.getElementById('riderReferralInput')?.value.trim();
  setRiderAuthError('riderRegisterError', '');
  if (!name || !phone || !email || password.length < 6) {
    setRiderAuthError('riderRegisterError', 'Enter your name, a valid mobile number, email, and a password of at least 6 characters.');
    return;
  }
  if (referral) {
    setRiderAuthError('riderRegisterError', 'Referral codes are not supported by the current account API. Clear this field to continue.');
    return;
  }
  setRiderDevelopmentOtp(null);

  const registration = {
    name,
    phone,
    email,
    password,
    vehicle_type: riderSelectedVehicleType
  };
  try {
    const result = await riderApiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        display_name: registration.name,
        phone_e164: registration.phone,
        email: registration.email,
        password: registration.password
      })
    });
    setRiderDevelopmentOtp(result);
    pendingRiderRegistration = registration;
    riderOtpPurpose = 'REGISTER';
    riderOtpPhone = phone;
    document.getElementById('riderOtpPhone').textContent = maskRiderPhone(phone);
    clearRiderOtpInputs();
    showRiderAuthScreen('otp');
    startRiderOtpCountdown();
  } catch (error) {
    setRiderAuthError('riderRegisterError', error.message || 'Unable to request a verification code.');
  }
}

async function resendRiderOtp() {
  setRiderDevelopmentOtp(null);
  try {
    let result;
    if (riderOtpPurpose === 'REGISTER') {
      if (!pendingRiderRegistration?.password) throw new Error('Please return to account creation and request a new code.');
      result = await riderApiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          display_name: pendingRiderRegistration.name,
          phone_e164: pendingRiderRegistration.phone,
          email: pendingRiderRegistration.email,
          password: pendingRiderRegistration.password
        })
      });
    } else {
      result = await riderApiRequest('/api/auth/otp/request', {
        method: 'POST',
        body: JSON.stringify({ phone_e164: riderOtpPhone })
      });
    }
    setRiderDevelopmentOtp(result);
    clearRiderOtpInputs();
    startRiderOtpCountdown();
  } catch (error) {
    setRiderAuthError('riderOtpError', error.message || 'Unable to resend the verification code.');
  }
}

function backFromRiderOtp() {
  window.clearInterval(riderOtpCountdownTimer);
  riderOtpCountdownTimer = null;
  setRiderDevelopmentOtp(null);
  showRiderAuthScreen(riderOtpPurpose === 'REGISTER' ? 'register' : 'login');
}

async function submitRiderApplication(accessToken) {
  const vehicleType = pendingRiderRegistration?.vehicle_type
    || localStorage.getItem('rider_registration_pending')
    || riderSelectedVehicleType;
  try {
    await riderApiRequest('/api/rider/applications', {
      method: 'POST',
      body: JSON.stringify({ vehicle_type: vehicleType }),
      authToken: accessToken
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    await riderApiRequest('/api/rider/me', { authToken: accessToken });
  }
  const profile = await hydrateRiderSession();
  if (!profile || profile.needsApplication) throw new Error('The rider application could not be confirmed.');
  pendingRiderRegistration = null;
  await routeAuthenticatedRider(profile);
}

async function loadRiderDocumentState() {
  try {
    const result = await riderApiRequest('/api/rider/documents');
    const documents = Array.isArray(result?.data) ? result.data : [];
    const submittedTypes = new Set(documents
      .filter(document => document.object_key && document.verification_status !== 'REJECTED')
      .map(document => document.document_type));
    return {
      complete: RIDER_REQUIRED_DOCUMENT_TYPES.every(documentType => submittedTypes.has(documentType)),
      documents,
      error: ''
    };
  } catch (error) {
    return { complete: false, documents: [], error: error.message || 'Unable to check document status.' };
  }
}

function updateRiderDocumentSelection(input) {
  const file = input.files?.[0] || null;
  const status = document.getElementById(input.dataset.statusTarget);
  const uploadButton = document.getElementById('riderUploadDocumentsButton');
  if (!status) return;

  status.textContent = '';
  status.classList.remove('is-ready', 'is-error');
  if (!file) {
    status.textContent = 'No file selected';
    if (uploadButton) uploadButton.disabled = true;
    return;
  }

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const mimeType = String(file.type || '').toLowerCase();
  const supportedType = RIDER_DOCUMENT_EXTENSIONS.has(extension)
    && (!mimeType || RIDER_DOCUMENT_MIME_TYPES.has(mimeType));
  let error = '';
  if (!supportedType) error = 'Choose a JPG, PNG, or WEBP image.';
  else if (file.size > RIDER_DOCUMENT_MAX_BYTES) error = 'File must be 10 MB or smaller.';

  if (error) {
    input.value = '';
    status.textContent = error;
    status.classList.add('is-error');
    if (uploadButton) uploadButton.disabled = true;
    return;
  }

  status.textContent = `Selected: ${file.name}`;
  status.classList.add('is-ready');
  const readyForUpload = Array.from(document.querySelectorAll('.rider-document-input')).every((element) => {
    const selectedFile = element.files?.[0];
    if (!selectedFile) return false;
    const selectedExtension = selectedFile.name.split('.').pop()?.toLowerCase() || '';
    const selectedMime = String(selectedFile.type || '').toLowerCase();
    return RIDER_DOCUMENT_EXTENSIONS.has(selectedExtension)
      && (!selectedMime || RIDER_DOCUMENT_MIME_TYPES.has(selectedMime))
      && selectedFile.size <= RIDER_DOCUMENT_MAX_BYTES;
  });
  if (uploadButton) uploadButton.disabled = !readyForUpload;
}

function setRiderDocumentStorageMessage(message, isError = false) {
  const note = document.getElementById('riderDocumentStorageNote');
  if (!note) return;
  note.textContent = message;
  note.classList.toggle('is-error', isError);
  note.classList.toggle('is-success', !isError);
}

async function uploadRiderDocuments() {
  const documentInputs = {
    SELFIE: document.getElementById('riderSelfieFile'),
    AADHAAR: document.getElementById('riderAadhaarFile'),
    PAN: document.getElementById('riderPanFile')
  };
  const uploadButton = document.getElementById('riderUploadDocumentsButton');
  if (!uploadButton) return;

  const missingDocs = Object.entries(documentInputs)
    .filter(([type, input]) => !input?.files?.[0] && type)
    .map(([type]) => type);

  if (missingDocs.length) {
    setRiderDocumentStorageMessage('Please select files for all required documents before uploading.', true);
    return;
  }

  uploadButton.disabled = true;
  uploadButton.textContent = 'Uploading...';
  setRiderDocumentStorageMessage('Uploading your verification documents securely...');

  const orderedTypes = ['SELFIE', 'AADHAAR', 'PAN'];
  let allUploaded = true;

  for (const documentType of orderedTypes) {
    const input = documentInputs[documentType];
    const file = input?.files?.[0];
    if (!file) {
      allUploaded = false;
      continue;
    }

    const status = document.getElementById(`rider${documentType === 'SELFIE' ? 'Selfie' : documentType === 'AADHAAR' ? 'Aadhaar' : 'Pan'}Status`);
    if (status) {
      status.textContent = 'Uploading...';
      status.classList.remove('is-ready', 'is-error');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('document_type', documentType);

    try {
      const response = await fetch(`${RIDER_API_BASE_URL}/api/rider/documents/upload`, {
        method: 'POST',
        headers: buildRiderApiHeaders({ Accept: 'application/json' }),
        body: formData
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.message || 'The backend rejected this upload.';
        if (status) {
          status.textContent = payload?.code === 'OBJECT_STORAGE_NOT_CONFIGURED' ? 'Storage unavailable' : message;
          status.classList.add('is-error');
        }
        setRiderDocumentStorageMessage(payload?.code === 'OBJECT_STORAGE_NOT_CONFIGURED' ? 'Secure document storage is not configured yet.' : message, true);
        allUploaded = false;
        break;
      }

      if (status) {
        status.textContent = 'Uploaded';
        status.classList.add('is-ready');
      }
    } catch (error) {
      if (status) {
        status.textContent = error.message || 'Upload failed';
        status.classList.add('is-error');
      }
      setRiderDocumentStorageMessage(error.message || 'Could not upload the verification document.', true);
      allUploaded = false;
      break;
    }
  }

  if (allUploaded) {
    setRiderDocumentStorageMessage('Documents uploaded securely. We are refreshing your application status.');
    await refreshRiderApplicationStatus();
  }

  uploadButton.disabled = false;
  uploadButton.textContent = 'Upload documents';
}

async function routeAuthenticatedRider(profile) {
  if (profile.verification_status === 'APPROVED') {
    riderAuthMode = 'dashboard';
    updateRiderIdentity();
    showRiderSection('home');
    startRiderOrdersListener();
    return;
  }
  const canSubmitDocuments = ['PENDING', 'SUBMITTED'].includes(profile.verification_status);
  const documentState = canSubmitDocuments
    ? await loadRiderDocumentState()
    : { complete: false, documents: [], error: '' };
  if (!getRiderAccessToken()) {
    clearRiderAuthState();
    showRiderAuthScreen('login');
    return;
  }

  const statusMessages = {
    REJECTED: ['Application Needs Attention', 'Your rider application was not approved. Contact MyShopzy support for next steps.'],
    SUSPENDED: ['Rider Access Paused', 'Your rider access is currently paused. Contact MyShopzy support for assistance.'],
    EXPIRED: ['Verification Expired', 'Your rider verification has expired. Contact MyShopzy support to renew it.']
  };
  const [heading, message] = !canSubmitDocuments
    ? statusMessages[profile.verification_status] || statusMessages.PENDING
    : documentState.error
      ? ['Complete Your Verification', 'We could not check your saved documents. Select Check status to try again.']
      : documentState.complete
        ? ['Application Received', 'Your rider application is under review. We’ll open your delivery console as soon as it’s approved.']
        : ['Complete Your Verification', 'Your rider account has been created. Please upload your verification documents to complete your application.'];
  const headingElement = document.getElementById('riderPendingHeading');
  const messageElement = document.getElementById('riderPendingMessage');
  const documentSection = document.getElementById('riderDocumentSection');
  const documentStorageNote = document.getElementById('riderDocumentStorageNote');
  if (headingElement) headingElement.textContent = heading;
  if (messageElement) messageElement.textContent = message;
  if (documentSection) documentSection.hidden = !canSubmitDocuments || documentState.complete;
  if (documentStorageNote && documentState.error) documentStorageNote.textContent = documentState.error;
  riderAuthMode = 'pending';
  updateRiderIdentity();
  showRiderAuthScreen('pending');
}

async function verifyRiderOtp() {
  const code = Array.from(document.querySelectorAll('.rider-otp-digit')).map((input) => input.value).join('');
  setRiderAuthError('riderOtpError', '');
  if (!/^\d{6}$/.test(code)) {
    setRiderAuthError('riderOtpError', 'Enter the complete 6-digit verification code.');
    return;
  }
  try {
    const authResult = await riderApiRequest('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ phone_e164: riderOtpPhone, purpose: riderOtpPurpose, otp: code })
    });
    if (!authResult?.access_token) throw new Error('Authentication response did not include an access token.');
    setRiderDevelopmentOtp(null);
    window.clearInterval(riderOtpCountdownTimer);
    riderOtpCountdownTimer = null;

    if (riderOtpPurpose === 'REGISTER') {
      localStorage.setItem('rider_registration_pending', pendingRiderRegistration?.vehicle_type || 'BIKE');
      persistRiderAccessToken(authResult.access_token);
      if (pendingRiderRegistration) pendingRiderRegistration.password = '';
      await submitRiderApplication(authResult.access_token);
      return;
    }
    await completeRiderAuthentication(authResult.access_token);
  } catch (error) {
    if (riderOtpPurpose === 'REGISTER' && getRiderAccessToken() && localStorage.getItem('rider_registration_pending')) {
      showRiderAuthScreen('register');
      setRiderAuthError('riderRegisterError', `Your number is verified, but the application could not be submitted. ${error.message || 'Try again.'}`);
    } else {
      setRiderAuthError('riderOtpError', error.message || 'Unable to verify the code. Please try again.');
    }
  }
}

async function completeRiderAuthentication(accessToken) {
  persistRiderAccessToken(accessToken);
  const profile = await hydrateRiderSession();
  if (profile?.needsApplication) {
    showRiderAuthScreen('register');
    setRiderAuthError('riderRegisterError', 'Your number is verified. Finish the rider application to continue.');
    return;
  }
  if (!profile) {
    await riderApiRequest('/api/auth/logout', {
      method: 'POST',
      authToken: accessToken,
      preserveAuthOn401: true
    }).catch(() => {});
    clearRiderAuthState();
    throw new Error('This account does not have a rider profile.');
  }
  await routeAuthenticatedRider(profile);
}

async function loginRider() {
  const phone = normalizeRiderPhone(document.getElementById('riderLoginIdentityInput')?.value);
  const password = document.getElementById('riderLoginPasswordInput')?.value || '';
  setRiderAuthError('riderLoginError', '');
  if (!phone || !password) {
    setRiderAuthError('riderLoginError', 'Enter a valid mobile number and password.');
    return;
  }
  try {
    const result = await riderApiRequest('/api/auth/password/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });
    if (!result?.access_token) throw new Error('Authentication response did not include an access token.');
    await completeRiderAuthentication(result.access_token);
  } catch (error) {
    setRiderAuthError('riderLoginError', error.message || 'Unable to sign in.');
  }
}

async function retryRiderApplication() {
  const token = getRiderAccessToken();
  if (!token) {
    setRiderAuthError('riderRegisterError', 'Your session expired. Sign in and continue your rider application.');
    return;
  }
  try {
    await submitRiderApplication(token);
  } catch (error) {
    setRiderAuthError('riderRegisterError', error.message || 'Unable to submit the rider application.');
  }
}

async function refreshRiderApplicationStatus() {
  const profile = await hydrateRiderSession();
  if (profile?.needsApplication) {
    showRiderAuthScreen('register');
    setRiderAuthError('riderRegisterError', 'Finish your rider application to continue.');
    return;
  }
  if (!profile) {
    clearRiderAuthState();
    setRiderAuthError('riderLoginError', 'Your session has expired. Please sign in again.');
    return;
  }
  await routeAuthenticatedRider(profile);
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

function renderRiderEarnings() {
  const summaryEl = document.getElementById('riderEarningsSummary');
  const listEl = document.getElementById('riderEarningsList');
  if (!summaryEl || !listEl) return;

  if (!getRiderAccessToken()) {
    summaryEl.innerHTML = '<p class="text-amber-700 font-bold">Sign in to view rider earnings.</p>';
    listEl.innerHTML = '';
    return;
  }

  if (!riderEarnings) {
    summaryEl.innerHTML = '<p class="text-slate-500">Loading earnings…</p>';
    listEl.innerHTML = '';
    return;
  }

  const deliveries = Array.isArray(riderEarnings.deliveries) ? riderEarnings.deliveries : [];
  const total = Number(riderEarnings.total_earnings_inr || 0);
  const count = Number(riderEarnings.completed_count || deliveries.length || 0);
  const currency = riderEarnings.currency || 'INR';

  summaryEl.innerHTML = `
    <div class="space-y-1">
      <p class="text-[10px] uppercase tracking-wider font-black text-slate-400">Total earnings</p>
      <p class="text-2xl font-black text-slate-900">${formatRiderCurrency(total)}</p>
      <p class="text-[10px] text-slate-500">${count} completed delivery${count === 1 ? '' : 'ies'} · ${currency}</p>
    </div>
  `;

  if (!deliveries.length) {
    listEl.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 text-center">No completed deliveries yet.</div>';
    return;
  }

  listEl.innerHTML = deliveries.map((delivery) => `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-black uppercase text-slate-500">${escapeRiderHtml(delivery.order_number || 'Order')}</span>
        <span class="text-[10px] font-black text-emerald-700">${formatRiderCurrency(delivery.total_earning_inr || 0)}</span>
      </div>
      <div class="mt-1 text-[10px] text-slate-500">
        <p>Base: ${formatRiderCurrency(delivery.base_earning_inr || 0)}</p>
        <p>Surge: ${formatRiderCurrency(delivery.rain_surge_inr || 0)}</p>
        <p>Distance: ${formatRiderCurrency(delivery.distance_bonus_inr || 0)}</p>
        <p>Completed: ${formatRiderNotificationTime(delivery.completed_at)}</p>
      </div>
    </div>
  `).join('');
}

async function loadRiderEarnings() {
  if (!getRiderAccessToken()) {
    riderEarnings = null;
    renderRiderEarnings();
    return;
  }

  try {
    const result = await riderApiRequest('/api/rider/earnings');
    riderEarnings = result?.data || { currency: 'INR', completed_count: 0, total_earnings_inr: 0, deliveries: [] };
    renderRiderEarnings();
  } catch (error) {
    riderEarnings = null;
    const summaryEl = document.getElementById('riderEarningsSummary');
    const listEl = document.getElementById('riderEarningsList');
    if (summaryEl) summaryEl.innerHTML = `<p class="text-rose-600 font-bold">${escapeRiderHtml(error.message)}</p>`;
    if (listEl) listEl.innerHTML = '';
  }
}

function getRiderUnreadNotificationCount() {
  return riderNotifications.filter((notification) => {
    const isRead = notification.status === 'READ' || Boolean(notification.read_at);
    return !isRead;
  }).length;
}

function renderRiderNotifications() {
  const container = document.getElementById('riderNotificationsContainer');
  const unreadBadge = document.getElementById('riderNotificationsUnreadCount');
  const markAllButton = document.getElementById('riderMarkAllNotificationsReadBtn');
  if (!container || !unreadBadge || !markAllButton) return;

  const unreadCount = getRiderUnreadNotificationCount();
  unreadBadge.textContent = String(unreadCount);
  markAllButton.disabled = unreadCount === 0 || !getRiderAccessToken();
  markAllButton.classList.toggle('opacity-50', markAllButton.disabled);

  if (!getRiderAccessToken()) {
    container.innerHTML = '<p class="text-[11px] text-slate-500">Sign in to view notifications.</p>';
    return;
  }

  if (riderNotifications.length === 0) {
    container.innerHTML = '<div class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 text-center">No notifications yet.</div>';
    return;
  }

  container.innerHTML = riderNotifications.map((notification) => {
    const isRead = notification.status === 'READ' || Boolean(notification.read_at);
    return `
      <div class="rounded-xl border ${isRead ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'} p-2.5">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-[11px] font-black text-slate-900">${escapeRiderHtml(notification.title || 'Notification')}</p>
            <p class="mt-1 text-[10px] text-slate-600">${escapeRiderHtml(notification.body || '')}</p>
            <p class="mt-1 text-[10px] text-slate-400">${formatRiderNotificationTime(notification.created_at)}</p>
          </div>
          ${!isRead ? '<button onclick="markRiderNotificationRead(\'' + escapeRiderHtml(notification.id || '') + '\')" class="shrink-0 text-[10px] font-black text-brand-accent">Mark read</button>' : '<span class="text-[10px] font-black text-slate-400">Read</span>'}
        </div>
      </div>
    `;
  }).join('');
}

async function loadRiderNotifications() {
  if (!getRiderAccessToken()) {
    riderNotifications = [];
    renderRiderNotifications();
    return;
  }

  const container = document.getElementById('riderNotificationsContainer');
  if (container) {
    container.innerHTML = '<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 text-center">Loading notifications…</div>';
  }

  try {
    const result = await riderApiRequest('/api/rider/notifications');
    riderNotifications = Array.isArray(result?.data) ? result.data : [];
    renderRiderNotifications();
  } catch (error) {
    if (container) {
      container.innerHTML = `<div class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] font-bold text-rose-700 text-center">${escapeRiderHtml(error.message)}</div>`;
    }
  }
}

async function markRiderNotificationRead(notificationId) {
  if (!notificationId || !getRiderAccessToken()) return;
  try {
    await riderApiRequest(`/api/rider/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' });
    riderNotifications = riderNotifications.map((notification) => notification.id === notificationId
      ? { ...notification, status: 'READ', read_at: new Date().toISOString() }
      : notification);
    renderRiderNotifications();
  } catch (error) {
    console.warn('Unable to mark rider notification as read:', error.message);
  }
}

async function markAllRiderNotificationsRead() {
  if (!getRiderAccessToken()) return;
  try {
    await riderApiRequest('/api/rider/notifications/read-all', { method: 'PATCH' });
    riderNotifications = riderNotifications.map((notification) => ({ ...notification, status: 'READ', read_at: notification.read_at || new Date().toISOString() }));
    renderRiderNotifications();
  } catch (error) {
    console.warn('Unable to mark all rider notifications as read:', error.message);
  }
}

function updateRiderIdentity() {
  const titleEl = document.getElementById('currentRiderTitle');
  if (titleEl) titleEl.innerText = currentActiveRider || 'Not registered';
  const authShell = document.getElementById('riderAuthShell');
  const dashboardHeader = document.getElementById('riderDashboardHeader');
  const appShell = document.getElementById('riderAppShell');
  const bottomNav = document.getElementById('riderBottomNav');
  const isAuthenticated = Boolean(
    getRiderAccessToken()
    && riderProfile?.id
    && riderProfile?.user_id
    && currentActiveRider
    && riderProfile.verification_status === 'APPROVED'
  );
  authShell?.classList.toggle('hidden', isAuthenticated);
  dashboardHeader?.classList.toggle('hidden', !isAuthenticated);
  appShell?.classList.toggle('hidden', !isAuthenticated);
  bottomNav?.classList.toggle('hidden', !isAuthenticated);
  if (!isAuthenticated) {
    const screenId = riderAuthMode === 'loading'
      ? 'riderAuthLoading'
      : `rider${riderAuthMode[0].toUpperCase()}${riderAuthMode.slice(1)}Screen`;
    document.querySelectorAll('.rider-auth-screen').forEach((screen) => {
      const active = screen.id === screenId;
      screen.hidden = !active;
      screen.classList.toggle('is-active', active);
    });
  }
  syncRiderAccount();
  updateAvailabilityUi();
  renderRiderNotifications();
  renderRiderEarnings();
}

async function logoutRider() {
  const token = getRiderAccessToken();
  if (!token) {
    clearRiderAuthState();
    showRiderAuthScreen('login');
    return;
  }
  try {
    try {
      await riderApiRequest('/api/rider/availability', {
        method: 'PUT',
        body: JSON.stringify({ is_available: false }),
        preserveAuthOn401: true
      });
      riderIsAvailable = false;
      localStorage.setItem('rider_available', 'false');
      stopRiderGpsBroadcast();
    } catch (error) {
      console.warn('Rider availability update during logout failed:', error.message);
    }
    await riderApiRequest('/api/auth/logout', { method: 'POST', preserveAuthOn401: true });
    clearRiderAuthState();
    showRiderAuthScreen('login');
  } catch (error) {
    alert(error.message || 'Unable to sign out. Your session is still active.');
  }
}

function updateAvailabilityUi() {
  const button = document.getElementById('riderAvailabilityToggle');
  const status = document.getElementById('riderDutyStatus');
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
          <span class="text-[11px] font-bold ${o.payment_mode === 'COD' ? 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded' : o.payment_status === 'SUCCESSFUL' ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded' : 'text-amber-700 bg-amber-50 px-2 py-0.5 rounded'}">
            ${o.payment_mode === 'COD' ? 'Collect Cash at Door' : o.payment_status === 'SUCCESSFUL' ? 'Paid Online' : 'Online payment pending'}
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

  const otpDigits = Array.from(document.querySelectorAll('.rider-otp-digit'));
  otpDigits.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value) otpDigits[Math.min(index + 1, otpDigits.length - 1)]?.focus();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value) otpDigits[index - 1]?.focus();
      if (event.key === 'ArrowLeft') otpDigits[index - 1]?.focus();
      if (event.key === 'ArrowRight') otpDigits[index + 1]?.focus();
    });
    input.addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || '';
      if (!pasted) return;
      event.preventDefault();
      pasted.split('').forEach((digit, digitIndex) => {
        if (otpDigits[digitIndex]) otpDigits[digitIndex].value = digit;
      });
      otpDigits[Math.min(pasted.length, otpDigits.length - 1)]?.focus();
    });
  });

  document.querySelectorAll('.rider-vehicle-option').forEach((button) => {
    button.addEventListener('click', () => {
      riderSelectedVehicleType = button.dataset.vehicleType || 'BIKE';
      document.querySelectorAll('.rider-vehicle-option').forEach((option) => {
        const selected = option === button;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
    });
  });
  document.querySelectorAll('.rider-document-input').forEach((input) => {
    input.addEventListener('change', () => updateRiderDocumentSelection(input));
  });

  const uploadButton = document.getElementById('riderUploadDocumentsButton');
  if (uploadButton) {
    uploadButton.addEventListener('click', uploadRiderDocuments);
  }

  const token = getRiderAccessToken();
  if (token) {
    riderAuthMode = 'loading';
    updateRiderIdentity();
    const profile = await hydrateRiderSession();
    if (profile?.needsApplication) {
      showRiderAuthScreen('register');
      setRiderAuthError('riderRegisterError', 'Your number is verified. Finish the rider application to continue.');
    } else if (profile) {
      await routeAuthenticatedRider(profile);
    } else {
      if (getRiderAccessToken()) {
        await riderApiRequest('/api/auth/logout', {
          method: 'POST',
          authToken: token,
          preserveAuthOn401: true
        }).catch(() => {});
      }
      clearRiderAuthState();
      showRiderAuthScreen('login');
      setRiderAuthError('riderLoginError', 'This session is invalid or is not linked to a rider profile. Sign in with a rider account.');
    }
  } else {
    clearRiderAuthState();
    showRiderAuthScreen('login');
  }
  updateAvailabilityUi();
  if (window.lucide) lucide.createIcons();
});