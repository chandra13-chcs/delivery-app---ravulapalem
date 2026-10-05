function resolvePreviewApiBaseUrl() {
  const config = typeof window !== 'undefined' ? (
    window.__APP_CONFIG__
    || window.__MYSHOPZY_CONFIG__
    || window.RIDER_APP_CONFIG
    || {}
  ) : {};
  const configuredBaseUrl = (
    config.apiBaseUrl
    || config.backendApiBaseUrl
    || config.riderApiBaseUrl
    || ''
  );

  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, '');
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) return 'http://localhost:5000';
  return '';
}

const PREVIEW_API_BASE_URL = resolvePreviewApiBaseUrl();
const previewState = {
  online: false,
  activeScreen: 'home',
  rider: null,
  availability: null,
  notifications: [],
  earnings: null,
  deliveries: [],
  loading: true,
  authError: '',
  gpsWatchId: null,
  completionMessage: ''
};

function getPreviewAccessToken() {
  return sessionStorage.getItem('user_access_token')
    || localStorage.getItem('user_access_token')
    || sessionStorage.getItem('myshopzy_user_access_token')
    || localStorage.getItem('myshopzy_user_access_token')
    || '';
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatOrderStatus(status) {
  switch (status) {
    case 'OFFERED': return 'Offer';
    case 'ACCEPTED': return 'Accepted';
    case 'PICKING_UP': return 'Picking up';
    case 'OUT_FOR_DELIVERY': return 'Out for delivery';
    case 'COMPLETED': return 'Completed';
    case 'REJECTED': return 'Rejected';
    case 'CANCELLED': return 'Cancelled';
    default: return status || 'Active';
  }
}

function formatRelativeTime(dateValue) {
  if (!dateValue) return 'Recently';
  const diffMs = Date.now() - new Date(dateValue).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function buildPreviewHeaders(extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  const token = getPreviewAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function stopGpsTracking() {
  if (previewState.gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(previewState.gpsWatchId);
  }
  previewState.gpsWatchId = null;
}

async function previewApiRequest(path, { method = 'GET', body = null, headers = {} } = {}) {
  const response = await fetch(`${PREVIEW_API_BASE_URL}${path}`, {
    method,
    headers: buildPreviewHeaders({
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    }),
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    if (response.status === 401) {
      clearPreviewSession();
    }
    throw error;
  }
  return payload;
}

function clearPreviewSession() {
  stopGpsTracking();
  previewState.rider = null;
  previewState.availability = null;
  previewState.notifications = [];
  previewState.earnings = null;
  previewState.deliveries = [];
  previewState.online = false;
  previewState.authError = 'Session expired';
  for (const key of ['user_access_token', 'myshopzy_user_access_token']) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  }
  renderSignedOutState();
}

function setPreviewAvailabilityUI() {
  const button = document.getElementById('toggleAvailabilityBtn');
  const statusText = document.getElementById('homeAvailabilityText');
  if (!button || !statusText) return;

  const isOnline = Boolean(previewState.online);
  button.classList.toggle('toggle-button--online', isOnline);
  button.classList.toggle('toggle-button--offline', !isOnline);
  button.querySelector('.toggle-button__label').textContent = isOnline ? 'Go Offline' : 'Go Online';
  statusText.textContent = isOnline ? 'Online' : 'Offline';
}

function renderSignedOutState() {
  const headerName = document.getElementById('previewHeaderName');
  if (headerName) headerName.textContent = 'Rider Dashboard';

  const earningsEl = document.getElementById('homeTodayEarnings');
  const deltaEl = document.getElementById('homeEarningsDelta');
  if (earningsEl) earningsEl.textContent = '₹0';
  if (deltaEl) deltaEl.textContent = 'Sign in to load live data';

  const deliveryContainer = document.getElementById('deliveryActivityContainer');
  if (deliveryContainer) {
    deliveryContainer.innerHTML = `
      <div class="offer-card offer-card--priority">
        <div class="offer-card__topline">
          <span class="pill pill--muted">Signed out</span>
          <span class="time-badge">No session</span>
        </div>
        <div class="offer-card__body">
          <div class="address-stack">
            <div>
              <span class="address-label">Status</span>
              <strong>Log in with the real rider account</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const ordersList = document.getElementById('ordersList');
  if (ordersList) {
    ordersList.innerHTML = '<article class="order-card"><div class="order-card__top"><strong>No orders</strong></div><div class="order-card__meta"><span>Session required</span></div></article>';
  }

  const earningsSummary = document.getElementById('earningsSummary');
  if (earningsSummary) {
    earningsSummary.innerHTML = `
      <div><span>Today</span><strong>₹0</strong></div>
      <div><span>Deliveries</span><strong>0</strong></div>
    `;
  }

  const notificationsList = document.getElementById('notificationsList');
  if (notificationsList) {
    notificationsList.innerHTML = '<article class="notification-item"><div class="notification-icon notification-icon--slate"><i data-lucide="info"></i></div><div><strong>Ready</strong><p>Live rider data will appear after sign-in.</p><small>Session required</small></div></article>';
  }

  const nameEl = document.getElementById('accountProfileName');
  const phoneEl = document.getElementById('accountProfilePhone');
  const emailEl = document.getElementById('accountProfileEmail');
  if (nameEl) nameEl.textContent = 'Rider';
  if (phoneEl) phoneEl.textContent = '+91 ---';
  if (emailEl) emailEl.textContent = 'rider@myshopzy.dev';

  setPreviewAvailabilityUI();
  if (window.lucide) lucide.createIcons();
}

function getActiveDelivery() {
  return previewState.deliveries.find((delivery) => ['ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(delivery.assignment_status)) || null;
}

function getOfferedDelivery() {
  return previewState.deliveries.find((delivery) => delivery.assignment_status === 'OFFERED') || null;
}

function getPickupFulfillment(delivery) {
  if (!delivery) return null;
  if (delivery.order_type === 'PARCEL') return { type: 'PARCEL', fulfillmentId: null };
  const fulfillments = Array.isArray(delivery.fulfillments) ? delivery.fulfillments : [];
  return fulfillments.find((fulfillment) => fulfillment && fulfillment.id) || null;
}

function renderHomeCard() {
  const container = document.getElementById('deliveryActivityContainer');
  if (!container) return;

  const offered = getOfferedDelivery();

  if (!offered) {
    container.innerHTML = `
      <div class="offer-card">
        <div class="offer-card__topline">
          <span class="pill pill--muted">No new deliveries</span>
          <span class="time-badge">Waiting</span>
        </div>
        <div class="offer-card__body">
          <div class="address-stack">
            <div><span class="address-label">Status</span><strong>No new deliveries</strong></div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const pickupAddress = offered.parcel_pickup_address || offered.fulfillments?.[0]?.pickup_address || 'Pickup location';
  const dropAddress = offered.delivery_address || offered.parcel_drop_address || 'Delivery location';
  const amount = Number(offered.total_amount || offered.rider_tip || 0);
  const orderType = offered.order_type || 'Delivery';
  const paymentLabel = offered.payment_mode || 'Cash on delivery';

  container.innerHTML = `
    <div class="offer-card offer-card--priority">
      <div class="offer-card__topline">
        <span class="pill pill--success">New delivery</span>
        <span class="time-badge">Live offer</span>
      </div>
      <div class="offer-card__body">
        <div class="address-stack">
          <div>
            <span class="address-label">Order</span>
            <strong>${offered.order_number || 'Order'}</strong>
          </div>
          <div>
            <span class="address-label">Pickup</span>
            <strong>${pickupAddress}</strong>
          </div>
          <div>
            <span class="address-label">Drop</span>
            <strong>${dropAddress}</strong>
          </div>
        </div>
        <div class="offer-card__meta">
          <div>
            <span>Distance</span>
            <strong>${offered.distance_km || offered.delivery_distance_km || '—'}</strong>
          </div>
          <div>
            <span>Earn</span>
            <strong>${formatMoney(amount)}</strong>
          </div>
          <div>
            <span>Payment</span>
            <strong>${paymentLabel}</strong>
          </div>
          <div>
            <span>Type</span>
            <strong>${orderType}</strong>
          </div>
        </div>
      </div>
      <div class="action-row action-row--split">
        <button class="secondary-button" type="button" data-action="reject-delivery" data-assignment-id="${offered.assignment_id}">Reject</button>
        <button class="primary-button" type="button" data-action="accept-delivery" data-assignment-id="${offered.assignment_id}">Accept</button>
      </div>
    </div>
  `;
}

function renderOrdersList() {
  const ordersList = document.getElementById('ordersList');
  if (!ordersList) return;

  const activeOrders = previewState.deliveries.filter((delivery) => ['OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'].includes(delivery.assignment_status));
  if (!activeOrders.length) {
    ordersList.innerHTML = '<article class="order-card"><div class="order-card__top"><strong>No active deliveries</strong></div><div class="order-card__meta"><span>No active deliveries</span></div></article>';
    return;
  }

  ordersList.innerHTML = activeOrders.slice(0, 6).map((delivery) => {
    const orderNumber = delivery.order_number || 'Order';
    const status = formatOrderStatus(delivery.assignment_status);
    const pickup = delivery.parcel_pickup_address || delivery.fulfillments?.[0]?.pickup_address || 'Pickup';
    const amount = Number(delivery.total_amount || 0);
    const badgeClass = delivery.assignment_status === 'OUT_FOR_DELIVERY' ? 'pill pill--success' : 'pill pill--warning';

    return `
      <article class="order-card">
        <div class="order-card__top">
          <strong>${orderNumber}</strong>
          <span class="${badgeClass}">${status}</span>
        </div>
        <div class="order-card__meta">
          <span>${delivery.assigned_at ? new Date(delivery.assigned_at).toLocaleString('en-IN', { hour: 'numeric', minute:'2-digit' }) : 'Live'}</span>
          <span>${pickup}</span>
        </div>
        <div class="order-card__footer">
          <small>${delivery.assignment_status === 'OUT_FOR_DELIVERY' ? 'On route' : 'Active delivery'}</small>
          <strong>${formatMoney(amount)}</strong>
        </div>
      </article>
    `;
  }).join('');
}

function renderEarnings() {
  const summary = document.getElementById('earningsSummary');
  const chart = document.getElementById('earningsChart');
  const breakdown = document.getElementById('earningsBreakdown');
  if (!summary || !chart || !breakdown) return;

  const data = previewState.earnings || { total_earnings_inr: 0, completed_count: 0, deliveries: [] };
  const total = Number(data.total_earnings_inr || 0);
  const deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];
  const latestValue = deliveries[0] ? Number(deliveries[0].total_earning_inr || 0) : 0;
  const maxValue = deliveries.reduce((max, item) => Math.max(max, Number(item.total_earning_inr || 0)), 1);

  summary.innerHTML = `
    <div><span>Today</span><strong>${formatMoney(total)}</strong></div>
    <div><span>Deliveries</span><strong>${deliveries.length || data.completed_count || 0}</strong></div>
  `;

  const bars = Array.from({ length: 7 }, (_, index) => {
    const value = deliveries[index] ? Number(deliveries[index].total_earning_inr || 0) : 0;
    const height = value ? Math.max(18, (value / maxValue) * 100) : 12;
    return `<span style="--bar-height: ${height}%;"></span>`;
  }).join('');
  chart.innerHTML = bars;

  const rowData = [
    { label: 'Completed', value: deliveries.length },
    { label: 'Gross', value: formatMoney(total) },
    { label: 'Latest', value: formatMoney(latestValue) }
  ];

  breakdown.innerHTML = rowData.map((item) => `<div><span>${item.label}</span><strong>${item.value}</strong></div>`).join('');
}

function renderNotifications() {
  const notificationsList = document.getElementById('notificationsList');
  if (!notificationsList) return;

  const notifications = Array.isArray(previewState.notifications) ? previewState.notifications : [];
  if (!notifications.length) {
    notificationsList.innerHTML = '<article class="notification-item"><div class="notification-icon notification-icon--slate"><i data-lucide="info"></i></div><div><strong>No notifications</strong><p>There are no rider notifications yet.</p><small>Live feed</small></div></article>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  notificationsList.innerHTML = notifications.slice(0, 6).map((notification) => {
    const title = notification.title || 'Rider update';
    const body = notification.body || 'Live rider activity update';
    const unread = notification.status !== 'READ';
    return `
      <article class="notification-item ${unread ? 'notification-item--unread' : ''}">
        <div class="notification-icon notification-icon--green"><i data-lucide="bell-ring"></i></div>
        <div>
          <strong>${title}</strong>
          <p>${body}</p>
          <small>${formatRelativeTime(notification.created_at)}</small>
        </div>
      </article>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function renderAccountCard() {
  const profileName = document.getElementById('accountProfileName');
  const phoneEl = document.getElementById('accountProfilePhone');
  const emailEl = document.getElementById('accountProfileEmail');
  const avatar = document.getElementById('accountProfileAvatar');

  const rider = previewState.rider || {};
  const user = rider.user || {};

  if (profileName) profileName.textContent = user.display_name || 'Rider';
  if (phoneEl) phoneEl.textContent = user.phone_e164 || '+91 ---';
  if (emailEl) emailEl.textContent = user.email || 'rider@myshopzy.dev';
  if (avatar) avatar.textContent = (user.display_name || 'R').charAt(0).toUpperCase();
}

function renderProgressState(delivery) {
  if (!delivery) return [];
  const status = delivery.assignment_status;
  const states = [
    { label: 'Accepted', active: ['ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY', 'COMPLETED'].includes(status) },
    { label: 'Pickup', active: ['PICKING_UP', 'OUT_FOR_DELIVERY', 'COMPLETED'].includes(status) },
    { label: 'Picked Up', active: ['OUT_FOR_DELIVERY', 'COMPLETED'].includes(status) },
    { label: 'Out for Delivery', active: ['OUT_FOR_DELIVERY', 'COMPLETED'].includes(status) },
    { label: 'Delivered', active: status === 'COMPLETED' }
  ];
  return states;
}

function renderDeliveryScreenFromState() {
  const active = getActiveDelivery();
  const deliveryScreen = document.querySelector('.screen[data-screen="active-delivery"] .full-card');
  if (!deliveryScreen) return;

  if (!active) {
    deliveryScreen.innerHTML = `
      <div class="empty-state">No active deliveries</div>
    `;
    return;
  }

  const progress = renderProgressState(active);
  const pickupAddress = active.parcel_pickup_address || active.fulfillments?.[0]?.pickup_address || 'Pickup location';
  const dropAddress = active.delivery_address || active.parcel_drop_address || 'Delivery location';
  const statusLabel = formatOrderStatus(active.assignment_status);

  const progressHtml = progress.map((step, index) => {
    const classes = ['progress-item'];
    if (step.active) classes.push('is-complete');
    if (index === progress.findIndex((item) => item.active && !progress[index - 1]?.active)) classes.push('is-current');
    return `<div class="${classes.join(' ')}"><span>${step.label}</span></div>`;
  }).join('');

  deliveryScreen.innerHTML = `
    <div class="full-card__header">
      <div>
        <span class="eyebrow">Order</span>
        <strong>${active.order_number || 'Order'}</strong>
      </div>
      <span class="pill pill--soft">${formatMoney(Number(active.total_amount || 0))}</span>
    </div>
    <div class="route-summary">
      <div>
        <span>Pickup</span>
        <strong>${pickupAddress}</strong>
      </div>
      <div>
        <span>Customer</span>
        <strong>${dropAddress}</strong>
      </div>
    </div>
    <div class="progress-track">${progressHtml}</div>
    <div class="detail-grid detail-grid--compact">
      <div><span>Status</span><strong>${statusLabel}</strong></div>
      <div><span>Type</span><strong>${active.order_type || 'Delivery'}</strong></div>
    </div>
    <button class="primary-button" type="button" data-action="show-screen" data-screen="pickup">Proceed to Pickup</button>
  `;
}

function renderPickupScreen() {
  const pickupScreen = document.querySelector('.screen[data-screen="pickup"] .full-card');
  if (!pickupScreen) return;

  const active = getActiveDelivery();
  if (!active) {
    pickupScreen.innerHTML = '<div class="empty-state">No active deliveries</div>';
    return;
  }

  const fulfillment = getPickupFulfillment(active);
  const isParcel = active.order_type === 'PARCEL';
  const pickupAddress = active.parcel_pickup_address || active.fulfillments?.[0]?.pickup_address || 'Pickup location';
  const orderSummary = active.items?.map((item) => item.name).slice(0, 2).join(', ') || active.parcel_description || 'Order items';

  pickupScreen.innerHTML = `
    <div class="pickup-card__header">
      <div class="shop-badge">${(active.order_number || 'O').charAt(0).toUpperCase()}</div>
      <div>
        <strong>${isParcel ? 'Parcel pickup' : (active.fulfillments?.[0]?.shop_name || 'Pickup location')}</strong>
        <small>${pickupAddress}</small>
      </div>
    </div>

    <div class="pickup-details">
      <div class="pickup-row">
        <span>Order</span>
        <strong>${orderSummary}</strong>
      </div>
      <div class="pickup-row">
        <span>Location</span>
        <strong>${pickupAddress}</strong>
      </div>
    </div>

    <div class="otp-preview-box">
      <span>Pickup code</span>
      <strong>Enter the partner-provided code</strong>
    </div>

    ${!isParcel ? `
      <div class="otp-field-wrap">
        <label for="pickupOtpInput" class="eyebrow">Pickup OTP</label>
        <input id="pickupOtpInput" class="pickup-otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code" />
      </div>
    ` : ''}

    <div class="action-row action-row--stacked">
      <button class="secondary-button" type="button" data-action="arrive-pickup" data-assignment-id="${active.assignment_id}" data-fulfillment-id="${fulfillment && fulfillment.id ? fulfillment.id : ''}">${isParcel ? 'Arrive at Parcel Pickup' : 'Arrived at Pickup'}</button>
      <button class="primary-button" type="button" data-action="confirm-pickup" data-assignment-id="${active.assignment_id}" data-fulfillment-id="${fulfillment && fulfillment.id ? fulfillment.id : ''}">${isParcel ? 'Continue to delivery' : 'Confirm Pickup'}</button>
    </div>
  `;
}

function renderOutForDeliveryScreen() {
  const screen = document.querySelector('.screen[data-screen="out-for-delivery"] .full-card');
  if (!screen) return;

  const active = getActiveDelivery();
  if (!active) {
    screen.innerHTML = '<div class="empty-state">No active deliveries</div>';
    return;
  }

  const dropAddress = active.delivery_address || active.parcel_drop_address || 'Delivery address';
  const customerName = active.recipient_name || 'Customer';

  screen.innerHTML = `
    <div class="customer-strip">
      <div class="avatar avatar--large">${customerName.charAt(0).toUpperCase()}</div>
      <div>
        <strong>${customerName}</strong>
        <small>${dropAddress}</small>
      </div>
    </div>

    <div class="map-placeholder">
      <div class="map-placeholder__badge">Route map</div>
      <div class="map-line map-line--one"></div>
      <div class="map-line map-line--two"></div>
      <div class="map-pin map-pin--pickup"></div>
      <div class="map-pin map-pin--drop"></div>
    </div>

    <div class="detail-grid detail-grid--compact">
      <div><span>ETA</span><strong>Live estimated</strong></div>
      <div><span>Distance</span><strong>${active.distance_km || active.delivery_distance_km || '—'}</strong></div>
    </div>

    <button class="primary-button" type="button" data-action="start-out-for-delivery" data-assignment-id="${active.assignment_id}">Start Delivery</button>
  `;
}

function renderDeliveryOtpScreen() {
  const screen = document.querySelector('.screen[data-screen="delivery-otp"] .full-card');
  if (!screen) return;

  const active = getActiveDelivery();
  if (!active) {
    screen.innerHTML = '<div class="empty-state">No active delivery</div>';
    return;
  }

  screen.innerHTML = `
    <div class="otp-heading">
      <span class="eyebrow">Enter delivery OTP</span>
      <h3>Confirm delivery</h3>
    </div>
    <div class="otp-inputs" aria-label="Six digit OTP">
      <input type="text" maxlength="1" inputmode="numeric" />
      <input type="text" maxlength="1" inputmode="numeric" />
      <input type="text" maxlength="1" inputmode="numeric" />
      <input type="text" maxlength="1" inputmode="numeric" />
      <input type="text" maxlength="1" inputmode="numeric" />
      <input type="text" maxlength="1" inputmode="numeric" />
    </div>
    <button class="primary-button" type="button" data-action="complete-delivery" data-assignment-id="${active.assignment_id}">Verify &amp; Complete Delivery</button>
  `;

  const otpInputs = screen.querySelectorAll('.otp-inputs input');
  otpInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 1);
      if (input.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !input.value && index > 0) {
        otpInputs[index - 1].focus();
      }
    });
  });
}

function renderCompletionScreen() {
  const screen = document.querySelector('.screen[data-screen="delivery-completed"] .success-card');
  if (!screen) return;

  const active = getActiveDelivery();
  const orderNumber = active?.order_number || 'Order';
  const amount = formatMoney(Number(active?.total_amount || 0));

  screen.innerHTML = `
    <div class="success-icon"><i data-lucide="check"></i></div>
    <h3>Delivery Completed</h3>
    <p>Your order was delivered successfully.</p>

    <div class="summary-box">
      <div><span>Earnings</span><strong>${amount}</strong></div>
      <div><span>Completed</span><strong>Now</strong></div>
      <div><span>Order</span><strong>${orderNumber}</strong></div>
    </div>

    <button class="primary-button" type="button" data-action="show-screen" data-screen="home">Back to Home</button>
  `;
  if (window.lucide) lucide.createIcons();
}

async function refreshPreviewData() {
  const token = getPreviewAccessToken();
  if (!token) {
    clearPreviewSession();
    return;
  }

  try {
    const [dashboard, availability, earnings, deliveries, notifications] = await Promise.all([
      previewApiRequest('/api/rider/dashboard'),
      previewApiRequest('/api/rider/availability'),
      previewApiRequest('/api/rider/earnings'),
      previewApiRequest('/api/rider/deliveries?bucket=all'),
      previewApiRequest('/api/rider/notifications')
    ]);

    previewState.rider = dashboard?.data || null;
    previewState.availability = availability?.data || null;
    previewState.earnings = earnings?.data || null;
    previewState.deliveries = Array.isArray(deliveries?.data) ? deliveries.data : [];
    previewState.notifications = Array.isArray(notifications?.data) ? notifications.data : [];
    previewState.online = Boolean(previewState.availability?.is_available ?? previewState.rider?.rider?.is_available ?? false);

    renderPreviewFromLiveData();
    renderDeliveryScreenFromState();
    renderPickupScreen();
    renderOutForDeliveryScreen();
    renderDeliveryOtpScreen();
    renderCompletionScreen();
    startGpsTrackingForActiveDelivery();
  } catch (error) {
    previewState.authError = error.message;
    if (error.status === 401) {
      clearPreviewSession();
      return;
    }
    renderSignedOutState();
  }
}

function renderPreviewFromLiveData() {
  const user = previewState.rider?.user || {};
  const headerName = document.getElementById('previewHeaderName');
  if (headerName && user.display_name) {
    headerName.textContent = user.display_name;
  }

  const earningsEl = document.getElementById('homeTodayEarnings');
  const deltaEl = document.getElementById('homeEarningsDelta');
  const countEl = document.getElementById('homeTodayDeliveries');
  const todayValue = Number(previewState.earnings?.total_earnings_inr || 0);
  if (earningsEl) earningsEl.textContent = formatMoney(todayValue);
  if (deltaEl) deltaEl.textContent = `${previewState.earnings?.completed_count || 0} deliveries tracked`;
  if (countEl) countEl.textContent = String(previewState.earnings?.completed_count || previewState.deliveries.length || 0);

  renderHomeCard();
  renderOrdersList();
  renderEarnings();
  renderNotifications();
  renderAccountCard();
  setPreviewAvailabilityUI();
}

function readOtpFromInputs() {
  const inputs = document.querySelectorAll('.otp-inputs input');
  return Array.from(inputs).map((input) => input.value || '').join('').trim();
}

function getActiveDeliveryScreenByStatus(status) {
  if (status === 'PICKING_UP') return 'pickup';
  if (status === 'OUT_FOR_DELIVERY') return 'out-for-delivery';
  return 'active-delivery';
}

async function handleAcceptDelivery(assignmentId) {
  try {
    await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/accept`, { method: 'POST' });
    await refreshPreviewData();
    const active = getActiveDelivery();
    if (active) {
      showScreen(getActiveDeliveryScreenByStatus(active.assignment_status));
    } else {
      showScreen('home');
    }
  } catch (error) {
    window.alert(error.message || 'Unable to accept delivery.');
  }
}

async function handleRejectDelivery(assignmentId) {
  const reason = 'Rider unavailable at the moment.';
  try {
    await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/reject`, {
      method: 'POST',
      body: { reason }
    });
    await refreshPreviewData();
    showScreen('home');
  } catch (error) {
    window.alert(error.message || 'Unable to reject delivery.');
  }
}

async function handleArrivePickup(assignmentId, fulfillmentId) {
  try {
    if (!assignmentId) throw new Error('Assignment is unavailable.');
    const active = getActiveDelivery();
    if (active?.order_type === 'PARCEL') {
      await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/parcel-pickup/arrive`, { method: 'POST' });
    } else if (fulfillmentId) {
      await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/pickups/${encodeURIComponent(fulfillmentId)}/arrive`, { method: 'POST' });
    }
    await refreshPreviewData();
    showScreen('pickup');
  } catch (error) {
    window.alert(error.message || 'Unable to record pickup arrival.');
  }
}

async function handleConfirmPickup(assignmentId, fulfillmentId) {
  try {
    const active = getActiveDelivery();
    if (!assignmentId || !fulfillmentId) {
      if (active?.order_type === 'PARCEL') {
        await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/out-for-delivery`, { method: 'POST' });
        await refreshPreviewData();
        showScreen('out-for-delivery');
        return;
      }
      throw new Error('Pickup fulfillment is unavailable.');
    }

    const pickupOtpInput = document.getElementById('pickupOtpInput');
    const otp = (pickupOtpInput?.value || '').trim();
    if (!/^\d{6}$/.test(otp)) {
      window.alert('Enter the real six-digit pickup code from the partner.');
      return;
    }

    await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/pickups/${encodeURIComponent(fulfillmentId)}/confirm`, {
      method: 'POST',
      body: { otp }
    });
    await refreshPreviewData();
    showScreen('out-for-delivery');
  } catch (error) {
    window.alert(error.message || 'Unable to confirm pickup.');
  }
}

async function handleStartOutForDelivery(assignmentId) {
  try {
    await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/out-for-delivery`, { method: 'POST' });
    await refreshPreviewData();
    showScreen('out-for-delivery');
  } catch (error) {
    window.alert(error.message || 'Unable to start delivery.');
  }
}

async function handleCompleteDelivery(assignmentId) {
  const otp = readOtpFromInputs();
  if (!/^\d{6}$/.test(otp)) {
    window.alert('Enter a valid six-digit OTP.');
    return;
  }

  try {
    await previewApiRequest(`/api/rider/deliveries/${encodeURIComponent(assignmentId)}/complete`, {
      method: 'POST',
      body: { otp }
    });
    await refreshPreviewData();
    previewState.completionMessage = 'Delivery Completed';
    showScreen('delivery-completed');
    renderCompletionScreen();
  } catch (error) {
    window.alert(error.message || 'Unable to complete delivery.');
  }
}

function startGpsTrackingForActiveDelivery() {
  stopGpsTracking();
  const active = getActiveDelivery();
  if (!active || !navigator.geolocation) return;

  const statusesToTrack = ['ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY'];
  if (!statusesToTrack.includes(active.assignment_status)) return;

  const onSuccess = (position) => {
    const payload = {
      assignment_id: active.assignment_id,
      latitude: Number(position.coords.latitude),
      longitude: Number(position.coords.longitude),
      accuracy_m: Number(position.coords.accuracy || 0),
      heading_degrees: Number(position.coords.heading || 0),
      speed_mps: Number(position.coords.speed || 0)
    };

    previewApiRequest('/api/rider/locations', {
      method: 'POST',
      body: payload
    }).catch((error) => {
      if (error.status === 401) clearPreviewSession();
      else console.warn('Location update failed:', error.message);
    });
  };

  const onError = (error) => {
    console.warn('Geolocation unavailable:', error.message);
    if (error.code === 1) {
      window.alert('Location permission is required to share live rider GPS updates.');
    }
    stopGpsTracking();
  };

  previewState.gpsWatchId = navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 30000
  });
}

async function toggleAvailability() {
  const token = getPreviewAccessToken();
  if (!token) {
    renderSignedOutState();
    return;
  }

  const nextValue = !previewState.online;

  try {
    const result = await previewApiRequest('/api/rider/availability', {
      method: 'PUT',
      body: { is_available: nextValue }
    });
    previewState.online = Boolean(result?.data?.is_available ?? nextValue);
    setPreviewAvailabilityUI();
  } catch (error) {
    previewState.authError = error.message;
    if (error.status === 401) {
      clearPreviewSession();
      return;
    }
    window.alert(error.message || 'Unable to update rider availability.');
  }
}

function showScreen(screenName) {
  const screenMap = document.querySelectorAll('.screen');
  screenMap.forEach((screen) => {
    const isActive = screen.dataset.screen === screenName;
    screen.classList.toggle('is-active', isActive);
  });

  previewState.activeScreen = screenName;

  const navButtons = document.querySelectorAll('.bottom-nav__item');
  navButtons.forEach((button) => {
    const isActive = button.dataset.screen === screenName && ['home', 'orders', 'earnings', 'account'].includes(screenName);
    button.classList.toggle('is-active', isActive);
  });

  const statusHeader = document.querySelector('.top-bar');
  if (statusHeader) {
    statusHeader.classList.toggle('top-bar--home', screenName === 'home');
  }

  if (!['home', 'orders', 'earnings', 'account'].includes(screenName)) {
    document.querySelectorAll('.bottom-nav__item').forEach((button) => {
      button.classList.remove('is-active');
    });
  }
}

function bindPreviewActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const assignmentId = target.dataset.assignmentId;
    const fulfillmentId = target.dataset.fulfillmentId;

    if (action === 'show-screen') {
      const screenName = target.dataset.screen;
      if (screenName) showScreen(screenName);
      return;
    }

    if (action === 'accept-delivery' && assignmentId) {
      await handleAcceptDelivery(assignmentId);
      return;
    }

    if (action === 'reject-delivery' && assignmentId) {
      await handleRejectDelivery(assignmentId);
      return;
    }

    if (action === 'arrive-pickup') {
      await handleArrivePickup(assignmentId, fulfillmentId);
      return;
    }

    if (action === 'confirm-pickup') {
      await handleConfirmPickup(assignmentId, fulfillmentId);
      return;
    }

    if (action === 'start-out-for-delivery' && assignmentId) {
      await handleStartOutForDelivery(assignmentId);
      return;
    }

    if (action === 'complete-delivery' && assignmentId) {
      await handleCompleteDelivery(assignmentId);
    }
  });

  document.getElementById('toggleAvailabilityBtn')?.addEventListener('click', toggleAvailability);

  document.querySelectorAll('.bottom-nav__item').forEach((button) => {
    button.addEventListener('click', () => {
      const screenName = button.dataset.screen;
      if (screenName) showScreen(screenName);
    });
  });

  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.remove('is-active'));
      button.classList.add('is-active');
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  bindPreviewActions();
  showScreen('home');
  await refreshPreviewData();
});
