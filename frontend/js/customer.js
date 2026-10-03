// ==========================================
// 🛒 MYSHOPZY CUSTOMER STOREFRONT ENGINE
// ==========================================
// Features:
// ✅ Customer-wise login/session
// ✅ Customer-wise saved addresses
// ✅ Customer-wise orders
// ✅ Exact browser GPS location
// ✅ Reverse geocoded address
// ✅ Leaflet map
// ✅ Distance calculation
// ✅ UPI Apps / QR / COD selection
// ✅ Order address snapshot
// ==========================================


// ==========================================
// 1. STORE / LOCATION CONFIG
// ==========================================

const DARK_STORE_COORDS = {
  lat: 16.8625,
  lng: 82.0570,
  name: "Mandapeta Dark Store"
};

let currentCustomerCoords = {
  lat: DARK_STORE_COORDS.lat,
  lng: DARK_STORE_COORDS.lng,
  address: "Mandapeta, Andhra Pradesh",
  accuracy: null
};
let selectedMapLocation = null;

let leafletMap = null;
let customerMarker = null;
let riderTrackingMap = null;
let riderTrackingMarker = null;
let riderTrackingPollTimer = null;
let suppressCategoryScrollOnInit = false;
let customerCountdownTimer = null;
const FALLBACK_CUSTOMER_DELIVERY_PROMISE_MINUTES = 30;
const delaySupportShownFor = new Set();
let editingAddressIndex = null;
const LEGACY_CUSTOMER_ADDRESS_IMPORT_LIMIT = 100;
let customerAddressesCloudReadFor = null;
let customerAddressSyncPhone = null;
let customerAddressSyncPromise = null;

const CUSTOMER_ORDER_PLACED_SOUND = new Audio("../assets/audio/order-placed-user.mpeg");
const CUSTOMER_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");
const CUSTOMER_ORDER_API_BASE_URL = `http://${window.location.hostname || "localhost"}:5000/api/orders`;
const CUSTOMER_ADDRESS_API_BASE_URL = `http://${window.location.hostname || "localhost"}:5000/api/addresses`;
const CUSTOMER_AUTH_API_BASE_URL = `http://${window.location.hostname || "localhost"}:5000/api/auth`;
const CUSTOMER_NOTIFICATIONS_API_BASE_URL = `http://${window.location.hostname || "localhost"}:5000/api/notifications`;
const legacyCustomerDb = globalThis.db || null;

function getCustomerAccessToken() {
  return sessionStorage.getItem("user_access_token")
    || localStorage.getItem("user_access_token")
    || sessionStorage.getItem("myshopzy_user_access_token")
    || localStorage.getItem("myshopzy_user_access_token")
    || "";
}

async function customerOrderApiRequest(path, options = {}) {
  const token = getCustomerAccessToken();
  if (!token) throw new Error("A secure customer session is required for orders.");
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${CUSTOMER_ORDER_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Order request failed (${response.status}).`);
  return payload?.data;
}

async function customerAddressApiRequest(path = "", options = {}) {
  const token = getCustomerAccessToken();
  if (!token) throw new Error("A secure customer session is required to manage addresses.");
  const response = await fetch(`${CUSTOMER_ADDRESS_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Address request failed (${response.status}).`);
  return payload?.data;
}

function mapPostgresCustomerAddress(address) {
  return {
    id: address.id,
    postgresAddress: true,
    label: address.label,
    fullName: address.recipient_name,
    mobile: normalizePhone(address.recipient_phone_e164),
    house: address.address_line1,
    street: address.address_line2 || "",
    city: address.city,
    district: address.locality || "",
    locality: address.locality || null,
    state: address.state,
    pincode: address.postal_code,
    postal_code: address.postal_code,
    country_code: address.country_code,
    address_line1: address.address_line1,
    address_line2: address.address_line2,
    landmark: address.landmark || "",
    latitude: address.latitude == null ? null : Number(address.latitude),
    longitude: address.longitude == null ? null : Number(address.longitude),
    isDefault: Boolean(address.is_default),
    createdAt: address.created_at
  };
}

function buildCustomerAddressPayload(address, isDefault = Boolean(address.isDefault)) {
  return {
    label: address.label || "Home",
    recipient_name: address.fullName || address.recipient_name,
    recipient_phone_e164: address.mobile || address.recipient_phone_e164,
    address_line1: address.house || address.address_line1 || [address.house, address.street].filter(Boolean).join(", "),
    address_line2: address.address_line2 ?? (address.street || null),
    landmark: address.landmark || null,
    locality: address.locality || address.district || null,
    city: address.city,
    state: address.state,
    postal_code: address.postal_code || address.pincode,
    country_code: address.country_code || "IN",
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    is_default: isDefault
  };
}

function normalizeCustomerAddressValue(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function customerAddressIdentity(address, accountPhone) {
  const payload = buildCustomerAddressPayload(address);
  const addressLines = [
    address.address_line1,
    address.house,
    payload.address_line1,
    [address.house, address.street].filter(Boolean).join(", "),
    [payload.address_line1, payload.address_line2].filter(Boolean).join(", ")
  ].map(normalizeCustomerAddressValue).filter(Boolean);
  const latitude = address.latitude == null || address.latitude === "" ? null : Number(address.latitude);
  const longitude = address.longitude == null || address.longitude === "" ? null : Number(address.longitude);
  return {
    recipient: normalizeCustomerAddressValue(address.recipient_name || address.fullName),
    phone: normalizePhone(address.recipient_phone_e164 || address.mobile || accountPhone),
    city: normalizeCustomerAddressValue(address.city),
    state: normalizeCustomerAddressValue(address.state),
    postalCode: normalizeCustomerAddressValue(address.postal_code || address.pincode),
    addressLines: new Set(addressLines),
    latitude: Number.isFinite(latitude) ? latitude.toFixed(6) : null,
    longitude: Number.isFinite(longitude) ? longitude.toFixed(6) : null
  };
}

function customerAddressesMatch(left, right, accountPhone) {
  const first = customerAddressIdentity(left, accountPhone);
  const second = customerAddressIdentity(right, accountPhone);
  if (!first.recipient || first.recipient !== second.recipient
      || !first.phone || first.phone !== second.phone
      || !first.city || first.city !== second.city
      || first.state !== second.state
      || !first.postalCode || first.postalCode !== second.postalCode
      || ![...first.addressLines].some(line => second.addressLines.has(line))) {
    return false;
  }
  return first.latitude == null || second.latitude == null
    || (first.latitude === second.latitude && first.longitude === second.longitude);
}

function uniqueLegacyCustomerAddresses(...sources) {
  const unique = [];
  for (const address of sources.flat()) {
    if (!address || typeof address !== "object" || address.postgresAddress) continue;
    if (!unique.some(existing => customerAddressesMatch(existing, address, getCurrentCustomerPhone()))) {
      unique.push(address);
    }
  }
  return unique;
}

function mergeCustomerAddressCopies(...sources) {
  const postgresCopies = [];
  const postgresIds = new Set();
  for (const address of sources.flat()) {
    if (address?.postgresAddress && address.id && !postgresIds.has(address.id)) {
      postgresIds.add(address.id);
      postgresCopies.push(address);
    }
  }
  return [...postgresCopies, ...uniqueLegacyCustomerAddresses(...sources)];
}

function buildCustomerOrderAddress(address) {
  if (!address) return null;
  const mapPin = address.isMapPin === true;
  return {
    recipient_name: address.fullName || getCustomerDisplayName(),
    recipient_phone_e164: address.mobile || getCurrentCustomerPhone(),
    address_line1: mapPin
      ? address.street
      : address.address_line1 || [address.house, address.street].filter(Boolean).join(", "),
    address_line2: mapPin ? null : address.address_line2 ?? (address.address_line1 ? null : address.street || null),
    landmark: address.landmark || null,
    locality: address.locality || address.district || null,
    city: address.city || "Mandapeta",
    state: address.state || "Andhra Pradesh",
    postal_code: address.postal_code || address.pincode || "533238",
    country_code: address.country_code || "IN",
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null
  };
}

async function customerAuthApiRequest(path, options = {}) {
  const token = getCustomerAccessToken();
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${CUSTOMER_AUTH_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Authentication request failed (${response.status}).`);
  return payload;
}

async function customerNotificationsApiRequest(path, options = {}) {
  const token = getCustomerAccessToken();
  if (!token) throw new Error("A secure customer session is required for notifications.");
  const response = await fetch(`${CUSTOMER_NOTIFICATIONS_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Notification request failed (${response.status}).`);
  return payload?.data;
}

function renderCustomerNotifications(notifications) {
  const list = document.getElementById("customerNotificationsList");
  if (!list) return;
  list.replaceChildren();
  if (!notifications.length) {
    const empty = document.createElement("p");
    empty.className = "px-2 py-4 text-center text-xs text-slate-500";
    empty.textContent = "No notifications yet.";
    list.appendChild(empty);
    return;
  }
  notifications.forEach(notification => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "block w-full border-b border-slate-100 px-2 py-2 text-left last:border-0 hover:bg-slate-50";
    const title = document.createElement("strong");
    title.className = "block text-xs text-slate-800";
    title.textContent = notification.title || "Notification";
    const body = document.createElement("span");
    body.className = "mt-1 block text-[11px] text-slate-600";
    body.textContent = notification.body || "";
    row.append(title, body);
    if (!notification.read_at) row.classList.add("bg-emerald-50/50");
    row.addEventListener("click", async () => {
      if (notification.read_at) return;
      try {
        await customerNotificationsApiRequest(`/${encodeURIComponent(notification.id)}/read`, { method: "PATCH" });
        notification.read_at = new Date().toISOString();
        renderCustomerNotifications(notifications);
      } catch (error) {
        console.error("Unable to mark notification as read:", error.message);
      }
    });
    list.appendChild(row);
  });
}

async function loadCustomerNotifications() {
  const list = document.getElementById("customerNotificationsList");
  if (!list) return;
  try {
    const notifications = await customerNotificationsApiRequest("");
    renderCustomerNotifications(Array.isArray(notifications) ? notifications : []);
  } catch (error) {
    list.textContent = error.message;
  }
}

function toggleCustomerNotifications() {
  const panel = document.getElementById("customerNotificationsPanel");
  const button = document.getElementById("customerNotificationButton");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  button?.setAttribute("aria-expanded", String(opening));
  if (opening) loadCustomerNotifications();
}

async function markAllCustomerNotificationsRead() {
  try {
    await customerNotificationsApiRequest("/read-all", { method: "PATCH" });
    await loadCustomerNotifications();
  } catch (error) {
    const list = document.getElementById("customerNotificationsList");
    if (list) list.textContent = error.message;
  }
}

function readSafeEtaPayload(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getCustomerDeliveryPromiseMinutes() {
  const fromResponse = Number(window.__customerDeliveryPromiseMinutes);
  if (Number.isInteger(fromResponse) && fromResponse > 0) {
    return fromResponse;
  }
  return FALLBACK_CUSTOMER_DELIVERY_PROMISE_MINUTES;
}

function getCustomerDeliveryPromiseText() {
  return `Delivery within ${getCustomerDeliveryPromiseMinutes()} minutes`;
}

function formatDynamicEtaText(eta) {
  const minimum = Number(eta?.eta_min_minutes);
  const maximum = Number(eta?.eta_max_minutes);
  if (!eta?.available || !Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
    return "Delivery time will be updated shortly";
  }
  const distance = Number(eta.distance_km);
  const distanceText = Number.isFinite(distance) ? ` (${distance.toFixed(1)} km)` : "";
  return `Estimated delivery: ${minimum}-${maximum} min${distanceText}`;
}

function updateCustomerCountdowns() {
  document.querySelectorAll("[data-order-countdown]").forEach(element => {
    const status = String(element.dataset.orderStatus || "").toUpperCase();
    if (status === "DELIVERED") {
      element.innerText = "Delivered";
      return;
    }
    if (["CANCELLED", "REJECTED"].includes(status)) {
      element.innerText = status === "CANCELLED" ? "Order cancelled" : "Order rejected";
      return;
    }
    const deadline = Number(element.dataset.deliveryDeadlineMs);
    const minimum = Number(element.dataset.promiseMinMinutes);
    const maximum = Number(element.dataset.promiseMaxMinutes);
    if (!Number.isFinite(deadline) || !Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum <= 0) {
      element.innerText = "ETA updates after pickup location is confirmed";
      return;
    }
    const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = String(remainingSeconds % 60).padStart(2, "0");
    const promise = minimum === maximum ? `${maximum} min` : `${minimum}-${maximum} min`;
    element.innerText = remainingSeconds ? `${promise} · ${minutes}:${seconds} left` : "Delivery is taking longer than expected";
  });
}

function openCustomerSupport(orderId = "") {
  const modal = document.getElementById("customerSupportModal");
  const message = document.getElementById("customerSupportMessage");
  if (message) message.innerText = orderId && orderId !== "unknown"
    ? `Order ${orderId} has crossed the promised 30-minute window. Our support team can help right away.`
    : "Your delivery has crossed the promised 30-minute window. Our support team can help right away.";
  if (modal) modal.classList.remove("hidden");
}

function closeCustomerSupport() {
  const modal = document.getElementById("customerSupportModal");
  if (modal) modal.classList.add("hidden");
}

function startCustomerCountdowns() {
  updateCustomerCountdowns();
  if (!customerCountdownTimer) customerCountdownTimer = setInterval(updateCustomerCountdowns, 1000);
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

function openCustomerRiderTracker(orderId) {
  const modal = document.getElementById("customerRiderTrackingModal");
  const status = document.getElementById("customerRiderTrackingStatus");
  if (!modal) return;

  modal.classList.remove("hidden");
  if (status) status.innerText = "Connecting to delivery tracking...";

  if (riderTrackingPollTimer) clearInterval(riderTrackingPollTimer);
  if (riderTrackingMarker) {
    riderTrackingMarker.remove();
    riderTrackingMarker = null;
  }
  if (!riderTrackingMap) {
    riderTrackingMap = L.map("customerRiderTrackingMap").setView([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(riderTrackingMap);
  } else {
    setTimeout(() => riderTrackingMap.invalidateSize(), 200);
  }

  const refresh = async () => {
    try {
      const tracking = await customerOrderApiRequest(`/${encodeURIComponent(orderId)}/tracking`);
      const configuredPromise = Number(tracking?.customer_delivery_promise_minutes);
      if (Number.isInteger(configuredPromise) && configuredPromise > 0) {
        window.__customerDeliveryPromiseMinutes = configuredPromise;
      }
      if (!tracking?.available) {
        const etaMessage = tracking?.eta?.available
          ? `Estimated delivery: ${formatCustomerEta(tracking.eta)}.`
          : getCustomerDeliveryPromiseText() + ".";
        if (status) status.innerText = `Live tracking becomes available after the rider accepts the delivery. ${etaMessage}`;
        return;
      }
      if (!tracking.location) {
        const etaText = tracking?.eta?.available ? formatCustomerEta(tracking.eta) : getCustomerDeliveryPromiseText();
        if (status) status.innerText = `${tracking.rider_name || 'Your rider'} is assigned; waiting for a location update. ${etaText}.`;
        return;
      }

      const location = tracking.location;
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const position = [latitude, longitude];
      if (riderTrackingMarker) {
        riderTrackingMarker.setLatLng(position);
      } else {
        riderTrackingMarker = L.marker(position, {
          icon: L.divIcon({ className: "customer-rider-icon", html: "<div style=\"font-size: 28px\">🛵</div>", iconSize: [32, 32] })
        }).addTo(riderTrackingMap).bindPopup(`<b>${escapeHtml(tracking.rider_name || 'Delivery partner')}</b><br>Live delivery partner`).openPopup();
      }
      riderTrackingMap.setView(position, 16);
      const etaText = tracking?.eta?.available ? formatCustomerEta(tracking.eta) : getCustomerDeliveryPromiseText();
      if (status) status.innerText = `${tracking.rider_name || 'Your rider'} is live. Updated ${new Date(location.recorded_at).toLocaleTimeString()} · ${etaText}.`;
    } catch (error) {
      console.error("Customer rider tracking request failed:", error);
      if (status) status.innerText = error.message || "Live location is temporarily unavailable.";
    }
  };
  refresh();
  riderTrackingPollTimer = setInterval(refresh, 4000);
}

function formatCustomerEta(eta) {
  const minimum = Number(eta?.eta_min_minutes);
  const maximum = Number(eta?.eta_max_minutes);
  if (!eta?.available || !Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
    return "ETA unavailable";
  }
  const distance = Number(eta.distance_km);
  const distanceText = Number.isFinite(distance) ? ` (${distance.toFixed(1)} km)` : "";
  return `ETA ${minimum}-${maximum} min${distanceText}`;
}

function closeCustomerRiderTracker() {
  const modal = document.getElementById("customerRiderTrackingModal");
  if (modal) modal.classList.add("hidden");
  if (riderTrackingPollTimer) clearInterval(riderTrackingPollTimer);
  riderTrackingPollTimer = null;
}


// ==========================================
// 2. CUSTOMER SESSION
// ==========================================

const storedCustomerSession = sessionStorage.getItem("quickdash_customer") || localStorage.getItem("quickdash_customer");
let activeCustomerSession = null;

if (storedCustomerSession) {
  try {
    const parsedSession = JSON.parse(storedCustomerSession);
    if (parsedSession && parsedSession.phone && getCustomerAccessToken()) {
      activeCustomerSession = parsedSession;
    } else {
      sessionStorage.removeItem("quickdash_customer");
      localStorage.removeItem("quickdash_customer");
    }
  } catch (error) {
    console.warn("Customer session restore failed:", error);
    sessionStorage.removeItem("quickdash_customer");
    localStorage.removeItem("quickdash_customer");
  }
}

let customerAuthState = "LOGIN";
let pendingCustomerPhone = "";
let pendingCustomerProfile = null;
let customerAuthRequestPending = false;
let customerLogoutPending = false;
let customerOtpCountdownTimer = null;
let customerOtpSecondsRemaining = 0;


// ==========================================
// 3. CUSTOMER STORAGE HELPERS
// ==========================================

function normalizePhone(phone) {

  return String(phone || "")
    .replace(/\D/g, "")
    .slice(-10);
}


function getCurrentCustomerPhone() {

  if (
    activeCustomerSession &&
    activeCustomerSession.phone
  ) {

    return normalizePhone(
      activeCustomerSession.phone
    );
  }

  return "";
}


function getCustomerStorageKey(phone = null) {

  const currentPhone =
    normalizePhone(
      phone || getCurrentCustomerPhone()
    );

  if (!currentPhone) {

    return "my_saved_addresses_guest";
  }

  return `my_saved_addresses_${currentPhone}`;
}


// ==========================================
// 4. LOAD CUSTOMER ADDRESSES
// ==========================================

function loadCustomerAddresses() {

  const phone =
    getCurrentCustomerPhone();

  if (!phone) {

    return [];
  }

  const customerKey =
    getCustomerStorageKey(phone);

  const customerData =
    localStorage.getItem(customerKey);

  if (customerData) {

    try {

      const parsed =
        JSON.parse(customerData);

      if (Array.isArray(parsed)) {

        return parsed;
      }

    } catch (error) {

      console.error(
        "Customer address data error:",
        error
      );
    }
  }


  // ------------------------------------------
  // Legacy migration
  // ------------------------------------------
  // Old version used:
  // my_saved_addresses
  //
  // We only migrate addresses that actually
  // belong to this logged-in customer.
  // ------------------------------------------

  const oldData =
    localStorage.getItem(
      "my_saved_addresses"
    );

  if (oldData) {

    try {

      const oldAddresses =
        JSON.parse(oldData);

      if (Array.isArray(oldAddresses)) {

        const matchingAddresses =
          oldAddresses.filter(
            address =>
              normalizePhone(address.mobile) === phone
          );

        if (
          matchingAddresses.length > 0
        ) {

          localStorage.setItem(
            customerKey,
            JSON.stringify(
              matchingAddresses
            )
          );

          return matchingAddresses;
        }
      }

    } catch (error) {

      console.error(
        "Legacy address migration failed:",
        error
      );
    }
  }

  return [];
}


let savedAddresses =
  loadCustomerAddresses();


// ==========================================
// 5. SAVE CUSTOMER ADDRESSES
// ==========================================

function persistCustomerAddresses() {

  const phone =
    getCurrentCustomerPhone();

  if (!phone) {

    console.warn(
      "Cannot save addresses without customer login."
    );

    return;
  }

  localStorage.setItem(
    getCustomerStorageKey(phone),
    JSON.stringify(savedAddresses)
  );

  if (customerAddressesCloudReadFor !== phone) return;
  if (!legacyCustomerDb?.collection) return;
  try {
    legacyCustomerDb.collection("customer_profiles").doc(phone).set({
      phone,
      addresses: savedAddresses,
      updated_at_ms: Date.now()
    }, { merge: true }).catch(error => {
      console.warn("Cloud address sync failed:", error);
    });
  } catch (error) {
    console.warn("Cloud address sync failed:", error);
  }
}

async function syncCustomerAddressesFromCloud() {
  const phone = getCurrentCustomerPhone();
  if (!phone) return;

  if (customerAddressSyncPromise && customerAddressSyncPhone === phone) {
    return customerAddressSyncPromise;
  }
  customerAddressSyncPhone = phone;
  const syncPromise = syncCustomerAddressesForPhone(phone);
  customerAddressSyncPromise = syncPromise;
  try {
    await syncPromise;
  } finally {
    if (customerAddressSyncPromise === syncPromise) {
      customerAddressSyncPhone = null;
      customerAddressSyncPromise = null;
    }
  }
}

async function syncCustomerAddressesForPhone(phone) {
  const localAddresses = savedAddresses.slice();
  customerAddressesCloudReadFor = null;
  let cloudAddresses = [];

  try {
    if (!legacyCustomerDb?.collection) {
      throw new Error("Legacy customer profile storage is not available.");
    }
    const profileDoc = await legacyCustomerDb.collection("customer_profiles").doc(phone).get();
    const storedAddresses = profileDoc.exists ? profileDoc.data()?.addresses : null;
    cloudAddresses = Array.isArray(storedAddresses) ? storedAddresses : [];
    if (getCurrentCustomerPhone() === phone) customerAddressesCloudReadFor = phone;
  } catch (error) {
    console.warn("Legacy cloud address load failed; preserving local copies:", error);
  }

  try {
    const postgresRows = await customerAddressApiRequest("");
    if (!Array.isArray(postgresRows)) throw new Error("Address list response is invalid.");

    const legacyAddresses = uniqueLegacyCustomerAddresses(localAddresses, cloudAddresses);
    const unresolvedAddresses = [];
    let importCount = 0;
    for (const legacyAddress of legacyAddresses) {
      if (getCurrentCustomerPhone() !== phone) return;
      if (postgresRows.some(row => customerAddressesMatch(legacyAddress, row, phone))) continue;
      if (importCount >= LEGACY_CUSTOMER_ADDRESS_IMPORT_LIMIT) {
        unresolvedAddresses.push(legacyAddress);
        continue;
      }

      importCount += 1;
      try {
        const keepCurrentDefault = postgresRows.some(row => row.is_default);
        const saved = await customerAddressApiRequest("", {
          method: "POST",
          body: JSON.stringify(buildCustomerAddressPayload(legacyAddress, Boolean(legacyAddress.isDefault) && !keepCurrentDefault))
        });
        if (!saved?.id) throw new Error("The saved address response is invalid.");
        postgresRows.push(saved);
      } catch (error) {
        console.warn("Legacy address import failed; preserving its compatibility copy:", error.message);
        unresolvedAddresses.push(legacyAddress);
      }
    }

    if (getCurrentCustomerPhone() !== phone) return;
    savedAddresses = [...postgresRows.map(mapPostgresCustomerAddress), ...unresolvedAddresses];
    renderSavedAddressesList();
    populateCheckoutAddressDropdown();
  } catch (error) {
    console.warn("PostgreSQL address load failed; preserving legacy addresses:", error.message);
    if (getCurrentCustomerPhone() !== phone) return;
    savedAddresses = mergeCustomerAddressCopies(localAddresses, cloudAddresses);
    renderSavedAddressesList();
    populateCheckoutAddressDropdown();
  }
}


// ==========================================
// 6. BUSINESS WORKING HOURS
// ==========================================

function checkStoreWorkingHours() {

  const now = new Date();

  const istString =
    now.toLocaleString(
      "en-US",
      {
        timeZone: "Asia/Kolkata"
      }
    );

  const hours =
    new Date(istString).getHours();

  const isClosed =
    hours < 7 || hours >= 22;

  const banner =
    document.getElementById(
      "storeStatusBanner"
    );

  if (banner) {

    if (isClosed) {

      banner.classList.remove(
        "hidden"
      );

    } else {

      banner.classList.add(
        "hidden"
      );
    }
  }

  return !isClosed;
}


// ==========================================
// 7. MAP INITIALIZATION
// ==========================================

function initLeafletMap() {

  if (leafletMap) {

    setTimeout(() => {

      leafletMap.invalidateSize();

    }, 200);

    return;
  }

  setTimeout(() => {

    try {

      const mapElement =
        document.getElementById(
          "deliveryMap"
        );

      if (!mapElement) {

        console.warn(
          "deliveryMap element not found."
        );

        return;
      }

      leafletMap =
        L.map(
          "deliveryMap"
        ).setView(
          [
            currentCustomerCoords.lat,
            currentCustomerCoords.lng
          ],
          14
        );


      // OpenStreetMap tiles
      L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; OpenStreetMap contributors'
        }
      ).addTo(
        leafletMap
      );


      // Service radius
      L.circle(
        [
          DARK_STORE_COORDS.lat,
          DARK_STORE_COORDS.lng
        ],
        {
          color: "#0B132B",
          fillColor: "#3A86FF",
          fillOpacity: 0.12,
          radius: 6000
        }
      ).addTo(
        leafletMap
      );


      // Dark store marker
      L.marker(
        [
          DARK_STORE_COORDS.lat,
          DARK_STORE_COORDS.lng
        ]
      )
        .addTo(leafletMap)
        .bindPopup(
          "<b>⚡ Mandapeta Dark Store</b>"
        );


      // Customer marker
      customerMarker =
        L.marker(
          [
            currentCustomerCoords.lat,
            currentCustomerCoords.lng
          ],
          {
            draggable: true
          }
        )
          .addTo(leafletMap)
          .bindPopup(
            "<b>📍 Deliver Here</b>"
          );


      // Drag marker
      customerMarker.on(
        "dragend",
        async function (e) {

          const pos =
            e.target.getLatLng();

          await handleLocationUpdate(
            pos.lat,
            pos.lng,
            "Pinned Map Location"
          );
        }
      );


      // Click map
      leafletMap.on(
        "click",
        async function (e) {

          customerMarker.setLatLng(
            e.latlng
          );

          await handleLocationUpdate(
            e.latlng.lat,
            e.latlng.lng,
            "Selected Map Location"
          );
        }
      );


      updateDeliveryDistance(
        currentCustomerCoords.lat,
        currentCustomerCoords.lng
      );


    } catch (error) {

      console.error(
        "Leaflet initialization error:",
        error
      );
    }

  }, 250);
}


// ==========================================
// 8. HANDLE MAP LOCATION
// ==========================================

async function handleLocationUpdate(
  lat,
  lng,
  addressName = "Selected Location"
) {

  currentCustomerCoords = {
    lat: Number(lat),
    lng: Number(lng),
    address: addressName,
    accuracy: null
  };


  if (
    customerMarker &&
    leafletMap
  ) {

    customerMarker.setLatLng([
      lat,
      lng
    ]);

    leafletMap.panTo([
      lat,
      lng
    ]);
  }


  updateDeliveryDistance(
    lat,
    lng
  );


  // Try readable address
  try {

    const readableAddress =
      await reverseGeocode(
        lat,
        lng
      );

    if (
      readableAddress &&
      readableAddress.trim()
    ) {

      currentCustomerCoords.address =
        readableAddress;
    }

  } catch (error) {

    console.warn(
      "Reverse geocoding failed:",
      error
    );
  }


  updateLocationUI();
}


// ==========================================
// 9. PRESET LOCATION
// ==========================================

async function selectPresetLoc(
  name,
  lat,
  lng
) {

  currentCustomerCoords = {
    lat: Number(lat),
    lng: Number(lng),
    address: name,
    accuracy: null
  };


  if (
    customerMarker &&
    leafletMap
  ) {

    customerMarker.setLatLng([
      lat,
      lng
    ]);

    leafletMap.panTo([
      lat,
      lng
    ]);
  }


  updateDeliveryDistance(
    lat,
    lng
  );


  updateLocationUI();
}


// ==========================================
// 10. EXACT GPS LOCATION
// ==========================================

function detectDeviceLocation() {

  if (!navigator.geolocation) {

    alert(
      "❌ Your browser does not support GPS location."
    );

    return;
  }


  const statusBox =
    document.getElementById(
      "serviceStatusBox"
    );


  if (statusBox) {

    statusBox.innerHTML = `
      <span>
        🎯 Detecting exact location...
      </span>

      <span class="font-black animate-pulse">
        GPS...
      </span>
    `;
  }


  navigator.geolocation.getCurrentPosition(

    async function(position) {

      const lat =
        position.coords.latitude;

      const lng =
        position.coords.longitude;

      const accuracy =
        position.coords.accuracy;


      console.log(
        "GPS latitude:",
        lat
      );

      console.log(
        "GPS longitude:",
        lng
      );

      console.log(
        "GPS accuracy:",
        accuracy,
        "meters"
      );


      currentCustomerCoords = {
        lat: lat,
        lng: lng,
        address:
          "Detecting exact address...",
        accuracy: accuracy
      };


      // Move marker
      if (
        customerMarker &&
        leafletMap
      ) {

        customerMarker.setLatLng([
          lat,
          lng
        ]);

        leafletMap.setView(
          [
            lat,
            lng
          ],
          17
        );
      }


      updateDeliveryDistance(
        lat,
        lng
      );


      // Reverse geocode
      try {

        const readableAddress =
          await reverseGeocode(
            lat,
            lng
          );

        currentCustomerCoords.address =
          readableAddress ||
          `GPS Location (${lat.toFixed(6)}, ${lng.toFixed(6)})`;

      } catch (error) {

        console.error(
          "Reverse geocode error:",
          error
        );

        currentCustomerCoords.address =
          `GPS Location (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
      }


      updateLocationUI();


      if (statusBox) {

        statusBox.innerHTML = `
          <span>
            📍 Exact location detected
          </span>

          <span class="font-black">
            ±${Math.round(accuracy)}m
          </span>
        `;
      }


      alert(
        `📍 Location detected!\n\n${currentCustomerCoords.address}\n\nGPS accuracy: approximately ${Math.round(accuracy)} meters.`
      );
    },


    function(error) {

      console.error(
        "GPS error:",
        error
      );


      if (statusBox) {

        statusBox.innerHTML = `
          <span class="text-rose-600">
            ⚠️ GPS permission required
          </span>

          <span>
            Try Again
          </span>
        `;
      }


      // IMPORTANT:
      // No fake RTC fallback.
      // User must manually select location
      // if GPS is unavailable.

      if (
        error.code ===
        error.PERMISSION_DENIED
      ) {

        alert(
          "📍 Location permission was denied.\n\nPlease allow location permission in your browser and click the GPS button again."
        );

      } else if (
        error.code ===
        error.POSITION_UNAVAILABLE
      ) {

        alert(
          "📍 Your device could not determine the location.\n\nPlease turn ON GPS/Location and try again."
        );

      } else if (
        error.code ===
        error.TIMEOUT
      ) {

        alert(
          "📍 GPS took too long.\n\nPlease try again near a window or outdoors."
        );

      } else {

        alert(
          "❌ Unable to detect your location.\n\nPlease try again."
        );
      }

    },


    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    }
  );
}


// ==========================================
// 11. REVERSE GEOCODING
// ==========================================

async function reverseGeocode(
  lat,
  lng
) {

  try {

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;


    const response =
      await fetch(
        url,
        {
          headers: {
            "Accept":
              "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Reverse geocode HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    const address =
      data.address || {};


    const house =
      address.house_number || "";

    const road =
      address.road ||
      address.neighbourhood ||
      address.suburb ||
      "";

    const village =
      address.village ||
      address.town ||
      address.city ||
      "";

    const district =
      address.county ||
      address.district ||
      "";

    const state =
      address.state ||
      "";

    const postcode =
      address.postcode ||
      "";


    const parts = [
      house,
      road,
      village,
      district,
      state,
      postcode
    ].filter(Boolean);


    if (parts.length > 0) {

      return parts.join(", ");
    }


    return `GPS Location (${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)})`;

  } catch (error) {

    console.error(
      "Reverse geocode failed:",
      error
    );

    return `GPS Location (${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)})`;
  }
}


// ==========================================
// 12. UPDATE LOCATION UI
// ==========================================

function updateLocationUI() {

  const header =
    document.getElementById(
      "currentAddressHeader"
    );

  if (header) {

    header.innerText =
      currentCustomerCoords.address;
  }


  const distanceBadge =
    document.getElementById(
      "distanceBadge"
    );

  if (distanceBadge) {

    const distance =
      calculateDistanceKm(
        DARK_STORE_COORDS.lat,
        DARK_STORE_COORDS.lng,
        currentCustomerCoords.lat,
        currentCustomerCoords.lng
      );

    distanceBadge.innerText =
      `${distance.toFixed(2)} KM`;
  }
}


// ==========================================
// 13. HAVERSINE DISTANCE
// ==========================================

function calculateDistanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {

  const R = 6371;

  const dLat =
    (lat2 - lat1) *
    Math.PI / 180;

  const dLon =
    (lon2 - lon1) *
    Math.PI / 180;


  const a =
    Math.sin(dLat / 2) *
    Math.sin(dLat / 2) +

    Math.cos(
      lat1 * Math.PI / 180
    ) *
    Math.cos(
      lat2 * Math.PI / 180
    ) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);


  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );


  return R * c;
}


// ==========================================
// 14. DELIVERY DISTANCE UI
// ==========================================

function updateDeliveryDistance(
  lat,
  lng
) {

  const distance =
    calculateDistanceKm(
      DARK_STORE_COORDS.lat,
      DARK_STORE_COORDS.lng,
      Number(lat),
      Number(lng)
    );


  const badge =
    document.getElementById(
      "distanceBadge"
    );

  if (badge) {

    badge.innerText =
      `${distance.toFixed(2)} KM`;
  }


  const status =
    document.getElementById(
      "serviceStatusBox"
    );

  if (!status) return;


  if (distance <= 6) {

    status.className =
      "p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between font-bold";

  } else {

    status.className =
      "p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between font-bold";
  }
}


// ==========================================
// 15. LOCATION MODAL
// ==========================================

function openLocationModal() {

  closeAllModals();

  const modal =
    document.getElementById(
      "locationModal"
    );

  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }


  initLeafletMap();


  setTimeout(() => {

    if (leafletMap) {

      leafletMap.invalidateSize();

      leafletMap.setView(
        [
          currentCustomerCoords.lat,
          currentCustomerCoords.lng
        ],
        16
      );
    }

  }, 400);
}


function closeLocationModal() {

  const modal =
    document.getElementById(
      "locationModal"
    );

  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }
}


// ==========================================
// 16. CONFIRM LOCATION
// ==========================================

function confirmLocationSelection() {

  const lat = Number(currentCustomerCoords?.lat);
  const lng = Number(currentCustomerCoords?.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 || lat > 90 ||
    lng < -180 || lng > 180
  ) {

    alert(
      "Please select a delivery location first."
    );

    return;
  }


  selectedMapLocation = {
    lat,
    lng,
    address: currentCustomerCoords.address || `GPS Location (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
    accuracy: currentCustomerCoords.accuracy ?? null
  };

  updateLocationUI();
  closeLocationModal();
  populateCheckoutAddressDropdown();
}


function getSelectedMapDeliveryAddress() {
  if (!selectedMapLocation) return null;

  return {
    id: "selected-map-location",
    isMapPin: true,
    fullName: getCustomerDisplayName(),
    mobile: getCurrentCustomerPhone(),
    street: selectedMapLocation.address,
    latitude: selectedMapLocation.lat,
    longitude: selectedMapLocation.lng,
    accuracy: selectedMapLocation.accuracy
  };
}


// ==========================================
// 17. GENERAL MODAL HELPERS
// ==========================================

function closeAllModals() {

  [
    "checkoutModal",
    "ordersModal",
    "locationModal",
    "paymentOverlay",
    "productDetailModal",
    "customerLoginModal",
    "orderDetailReceiptModal",
    "accountModal",
    "addressManagerModal"
  ].forEach(
    id => {

      const el =
        document.getElementById(id);

      if (el) {

        el.classList.add(
          "hidden"
        );
      }
    }
  );
}


function closeOrdersView() {

  const modal =
    document.getElementById(
      "ordersModal"
    );

  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }
}


function openCustomerAccountAccess() {
  if (getCustomerAccessToken()) openAccountModal();
  else openLoginModal();
}


function openAccountModal() {

  closeAllModals();

  cancelCustomerLogout();
  syncAccountDashboard();

  const modal =
    document.getElementById(
      "accountModal"
    );

  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }

  document.body.classList.add("customer-profile-view");
  document.getElementById("homeNavigationButton")?.classList.replace("text-emerald-600", "text-slate-500");
  document.getElementById("profileNavigationButton")?.classList.replace("text-slate-500", "text-emerald-600");
  window.scrollTo({ top: 0, behavior: "instant" });
}


function closeAccountModal() {

  const modal =
    document.getElementById(
      "accountModal"
    );

  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }

  document.body.classList.remove("customer-profile-view");
  document.getElementById("homeNavigationButton")?.classList.replace("text-slate-500", "text-emerald-600");
  document.getElementById("profileNavigationButton")?.classList.replace("text-emerald-600", "text-slate-500");
}


function openAddressManager() {

  const modal =
    document.getElementById(
      "addressManagerModal"
    );

  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }

  renderSavedAddressesList();
}

function resetManualAddressForm() {
  const form = document.getElementById("manualAddressForm");
  form?.reset();
  editingAddressIndex = null;
  const title = document.getElementById("manualAddressFormTitle");
  const submit = document.getElementById("manualAddressSubmitButton");
  const cancel = document.getElementById("cancelAddressEditButton");
  if (title) title.textContent = "Add New Address (Family / Other Location)";
  if (submit) submit.textContent = "Save Address & Use for Delivery";
  cancel?.classList.add("hidden");
}

function startEditAddress(idx) {
  const address = savedAddresses[idx];
  if (!address) return;
  editingAddressIndex = idx;
  document.getElementById("manualFullName").value = address.fullName || "";
  document.getElementById("manualMobile").value = address.mobile || "";
  document.getElementById("manualHouse").value = address.house || address.address_line1 || "";
  document.getElementById("manualStreet").value = address.street || "";
  document.getElementById("manualCity").value = address.city || "";
  document.getElementById("manualDistrict").value = address.locality || address.district || "";
  document.getElementById("manualState").value = address.state || "";
  document.getElementById("manualPincode").value = address.postal_code || address.pincode || "";
  document.getElementById("manualLandmark").value = address.landmark || "";
  const title = document.getElementById("manualAddressFormTitle");
  const submit = document.getElementById("manualAddressSubmitButton");
  const cancel = document.getElementById("cancelAddressEditButton");
  if (title) title.textContent = "Edit Saved Address";
  if (submit) submit.textContent = "Save Address Changes";
  cancel?.classList.remove("hidden");
  document.getElementById("manualAddressForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}


function closeAddressManager() {

  const modal =
    document.getElementById(
      "addressManagerModal"
    );

  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }
}


function scrollToCategories() {
  const target = document.getElementById("exploreCategories");
  if (!target) return;

  const headerHeight = document.querySelector(".myshopzy-header")?.getBoundingClientRect().height || 0;
  const targetTop = window.scrollY + target.getBoundingClientRect().top - headerHeight - 12;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}


// ==========================================
// 18. ADDRESS MANAGEMENT
// ==========================================

function renderSavedAddressesList() {

  const container =
    document.getElementById(
      "savedAddressesContainer"
    );

  if (!container) return;


  container.innerHTML = "";


  if (!getCurrentCustomerPhone()) {

    container.innerHTML = `
      <div class="text-center py-5">
        <p class="text-xs text-slate-500 font-bold">
          Please login to manage your addresses.
        </p>
      </div>
    `;

    return;
  }


  if (savedAddresses.length === 0) {

    container.innerHTML = `
      <p class="text-xs text-slate-400 text-center py-4">
        No saved addresses yet. Add one below!
      </p>
    `;

    return;
  }


  savedAddresses.forEach(
    (addr, idx) => {

      container.innerHTML += `
        <div
          class="p-2.5 rounded-xl border ${
            addr.isDefault
              ? "border-emerald-600 bg-emerald-50/40"
              : "border-slate-200"
          } text-xs space-y-1"
        >

          <div class="flex justify-between font-bold gap-2">

            <span>
              ${escapeHtml(addr.fullName)}
              (${escapeHtml(addr.mobile)})
            </span>

            <div class="shrink-0">

              ${
                addr.isDefault
                  ? `
                    <span
                      class="text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded"
                    >
                      DEFAULT
                    </span>
                  `
                  : `
                    <button
                      onclick="setDefaultAddress(${idx})"
                      class="text-[9px] text-blue-600 underline"
                    >
                      Set Default
                    </button>
                  `
              }

              <button
                onclick="startEditAddress(${idx})"
                class="text-[9px] text-blue-600 underline mr-2"
              >
                Edit
              </button>

              <button
                onclick="deleteAddress(${idx})"
                class="text-[9px] text-rose-600 ml-2"
              >
                Delete
              </button>

            </div>

          </div>

          <p class="text-slate-600">
            ${escapeHtml(addr.house)},
            ${escapeHtml(addr.street)},
            ${escapeHtml(addr.city)},
            ${escapeHtml(addr.state)}
            -
            ${escapeHtml(addr.pincode)}
          </p>

          ${
            addr.landmark
              ? `
                <p class="text-[10px] text-slate-400">
                  Landmark:
                  ${escapeHtml(addr.landmark)}
                </p>
              `
              : ""
          }

          ${
            addr.latitude && addr.longitude
              ? `
                <p class="text-[10px] text-emerald-600 font-bold">
                  📍 GPS location saved
                </p>
              `
              : ""
          }

        </div>
      `;
    }
  );
}


// ==========================================
// 19. SAVE MANUAL ADDRESS
// ==========================================

async function saveNewManualAddress(e) {

  e.preventDefault();


  const currentPhone =
    getCurrentCustomerPhone();


  if (!currentPhone) {

    alert(
      "Please login before saving an address."
    );

    return;
  }


  const fullName =
    document
      .getElementById(
        "manualFullName"
      )
      .value
      .trim();


  const mobile =
    document
      .getElementById(
        "manualMobile"
      )
      .value
      .trim();


  const house =
    document
      .getElementById(
        "manualHouse"
      )
      .value
      .trim();


  const street =
    document
      .getElementById(
        "manualStreet"
      )
      .value
      .trim();


  const city =
    document
      .getElementById(
        "manualCity"
      )
      .value
      .trim();


  const district =
    document
      .getElementById(
        "manualDistrict"
      )
      .value
      .trim();


  const state =
    document
      .getElementById(
        "manualState"
      )
      .value
      .trim();


  const pincode =
    document
      .getElementById(
        "manualPincode"
      )
      .value
      .trim();


  const landmark =
    document
      .getElementById(
        "manualLandmark"
      )
      .value
      .trim();


  const cleanMobile =
    normalizePhone(mobile);


  if (
    !fullName ||
    cleanMobile.length !== 10 ||
    !house ||
    !city ||
    !state ||
    !pincode
  ) {

    alert(
      "Please fill all required address fields correctly!"
    );

    return;
  }


  const addressIndex = editingAddressIndex;
  const currentAddress = addressIndex == null ? null : savedAddresses[addressIndex];
  const newAddr = {
    label: currentAddress?.label || "Home",
    latitude: currentAddress?.latitude ?? null,
    longitude: currentAddress?.longitude ?? null,

    fullName:
      fullName,

    mobile:
      cleanMobile,

    house:
      house,

    street:
      street,

    city:
      city,

    district:
      district,

    state:
      state,

    pincode:
      pincode,

    landmark:
      landmark,

    isDefault:
      savedAddresses.length === 0,

    latitude:
      null,

    longitude:
      null,

    createdAt:
      Date.now()
  };


  // If this address is the logged-in
  // customer's own phone, keep it useful
  // for account profile.
  if (
    cleanMobile === currentPhone &&
    savedAddresses.length === 0
  ) {

    newAddr.isDefault = true;
  }


  try {
    const saved = currentAddress?.postgresAddress
      ? await customerAddressApiRequest(`/${encodeURIComponent(currentAddress.id)}`, {
        method: "PATCH",
        body: JSON.stringify(buildCustomerAddressPayload(newAddr, currentAddress.isDefault))
      })
      : await customerAddressApiRequest("", {
        method: "POST",
        body: JSON.stringify(buildCustomerAddressPayload(newAddr, currentAddress?.isDefault ?? newAddr.isDefault))
      });
    const mappedAddress = mapPostgresCustomerAddress(saved);
    if (addressIndex == null) savedAddresses.push(mappedAddress);
    else savedAddresses[addressIndex] = mappedAddress;
    resetManualAddressForm();
    persistCustomerAddresses();
  } catch (error) {
    alert(`Unable to save address: ${error.message}`);
    return;
  }


  renderSavedAddressesList();

  populateCheckoutAddressDropdown();

  syncAccountDashboard();

  closeAddressManager();


  alert(
    "✅ Address saved successfully!"
  );
}


// ==========================================
// 20. SAVE CURRENT GPS AS ADDRESS
// ==========================================

async function saveCurrentGpsAddress() {

  const phone =
    getCurrentCustomerPhone();


  if (!phone) {

    alert(
      "Please login first."
    );

    return;
  }


  if (
    !currentCustomerCoords ||
    currentCustomerCoords.lat == null ||
    currentCustomerCoords.lng == null
  ) {

    alert(
      "Please detect your current GPS location first."
    );

    return;
  }


  const addressText =
    currentCustomerCoords.address ||
    "Current GPS Location";


  const parts =
    addressText
      .split(",")
      .map(
        x => x.trim()
      )
      .filter(Boolean);


  const gpsAddress = {

    fullName:
      "Current Location",

    mobile:
      phone,

    house:
      parts[0] || "GPS Location",

    street:
      parts[1] || "Current Location",

    city:
      parts[2] || "Mandapeta",

    district:
      parts[3] || "East Godavari",

    state:
      parts[4] || "Andhra Pradesh",

    pincode:
      parts.find(
        part => /^\d{6}$/.test(part)
      ) || "533238",

    landmark:
      "Exact GPS location",

    isDefault:
      savedAddresses.length === 0,

    latitude:
      currentCustomerCoords.lat,

    longitude:
      currentCustomerCoords.lng,

    accuracy:
      currentCustomerCoords.accuracy,

    createdAt:
      Date.now()
  };


  try {
    const saved = await customerAddressApiRequest("", {
      method: "POST",
      body: JSON.stringify(buildCustomerAddressPayload(gpsAddress, savedAddresses.length === 0))
    });
    savedAddresses.push(mapPostgresCustomerAddress(saved));
    persistCustomerAddresses();
  } catch (error) {
    alert(`Unable to save GPS address: ${error.message}`);
    return;
  }

  renderSavedAddressesList();

  populateCheckoutAddressDropdown();

  syncAccountDashboard();


  alert(
    "📍 Current GPS location saved for this customer!"
  );
}


// ==========================================
// 21. DEFAULT ADDRESS
// ==========================================

async function setDefaultAddress(idx) {

  if (
    !savedAddresses[idx]
  ) return;


  try {
    const currentAddress = savedAddresses[idx];
    const saved = currentAddress.postgresAddress
      ? await customerAddressApiRequest(`/${encodeURIComponent(currentAddress.id)}/default`, { method: "PATCH" })
      : await customerAddressApiRequest("", {
        method: "POST",
        body: JSON.stringify(buildCustomerAddressPayload(currentAddress, true))
      });
    const mappedAddress = mapPostgresCustomerAddress(saved);
    savedAddresses = savedAddresses.map((address, index) => index === idx
      ? mappedAddress
      : { ...address, isDefault: false });
    persistCustomerAddresses();
  } catch (error) {
    alert(`Unable to set default address: ${error.message}`);
    return;
  }

  renderSavedAddressesList();

  populateCheckoutAddressDropdown();
}


// ==========================================
// 22. DELETE ADDRESS
// ==========================================

async function deleteAddress(idx) {

  if (
    !savedAddresses[idx]
  ) return;


  if (
    !confirm(
      "Delete this saved address?"
    )
  ) {

    return;
  }


  const deletingDefault =
    savedAddresses[idx].isDefault;

  try {
    const address = savedAddresses[idx];
    if (address.postgresAddress) {
      await customerAddressApiRequest(`/${encodeURIComponent(address.id)}`, { method: "DELETE" });
    }
    savedAddresses.splice(idx, 1);
    if (deletingDefault && savedAddresses.length > 0) {
      await setDefaultAddress(0);
    }
  } catch (error) {
    alert(`Unable to delete address: ${error.message}`);
    return;
  }


  persistCustomerAddresses();

  renderSavedAddressesList();

  populateCheckoutAddressDropdown();
}


// ==========================================
// 23. CHECKOUT ADDRESS DROPDOWN
// ==========================================

function populateCheckoutAddressDropdown() {

  const select =
    document.getElementById(
      "checkoutAddressSelect"
    );

  if (!select) return;


  select.innerHTML =
    `
      <option value="">
        -- Select Saved Address --
      </option>
    `;


  savedAddresses.forEach(
    (addr, idx) => {

      select.innerHTML += `
        <option
          value="${idx}"
          ${
            addr.isDefault && !selectedMapLocation
              ? "selected"
              : ""
          }
        >
          ${escapeHtml(addr.fullName)}
          -
          ${escapeHtml(addr.house)},
          ${escapeHtml(addr.city)}
          (${escapeHtml(addr.pincode)})
        </option>
      `;
    }
  );

  if (selectedMapLocation) {
    const mapPinOption = document.createElement("option");
    mapPinOption.value = "map-pin";
    mapPinOption.textContent = `📍 Exact map pin - ${selectedMapLocation.address}`;
    mapPinOption.selected = true;
    select.append(mapPinOption);
  }

  select.onchange = () => {
    if (select.value !== "map-pin") selectedMapLocation = null;
  };
}


// ==========================================
// 24. CATEGORIES
// ==========================================

const categories = [

  {
    id: "paan",
    name: "Paan Corner & Refreshers"
  },

  {
    id: "dairy",
    name: "Dairy, Bread & Eggs"
  },

  {
    id: "veggies",
    name: "Fruits & Fresh Vegetables"
  },

  {
    id: "drinks",
    name: "Cold Drinks & Juices"
  },

  {
    id: "snacks",
    name: "Snacks & Munchies"
  },

  {
    id: "breakfast",
    name: "Breakfast & Instant Food"
  },

  {
    id: "sweets",
    name: "Sweet Tooth & Chocolates"
  },

  {
    id: "bakery",
    name: "Bakery & Biscuits"
  },

  {
    id: "tea",
    name: "Tea, Coffee & Milk Drinks"
  },

  {
    id: "staples",
    name: "Atta, Rice & Dal"
  },

  {
    id: "masala",
    name: "Masala, Cooking Oil & Ghee"
  },

  {
    id: "sauces",
    name: "Sauces & Spreads"
  },

  {
    id: "meat",
    name: "Chicken, Meat & Fresh Fish"
  },

  {
    id: "organic",
    name: "Organic & Healthy Living"
  },

  {
    id: "baby",
    name: "Baby Care Essentials"
  },

  {
    id: "pharma",
    name: "Pharma & Wellness"
  },

  {
    id: "cleaning",
    name: "Cleaning Essentials"
  },

  {
    id: "home",
    name: "Home & Office Needs"
  },

  {
    id: "personal",
    name: "Personal Care & Hygiene"
  },

  {
    id: "pet",
    name: "Pet Care Supplies"
  },

  {
    id: "restaurants",
    name: "Restaurants Around Mandapeta"
  }

];

const customerApiBaseUrl = window.MYSHOPZY_API_BASE_URL || (
  window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? `http://${window.location.hostname || "localhost"}:5000/api`
    : `${window.location.origin}/api`
);
let customerDatabaseCategories = null;

async function fetchCustomerContent(path) {
  const response = await fetch(`${customerApiBaseUrl}${path}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || `Content request failed (${response.status}).`);
  return payload;
}

const categoryDefaultImages = {
  paan: "https://images.pexels.com/photos/103124/pexels-photo-103124.jpeg?auto=compress&cs=tinysrgb&w=150",
  dairy: "https://images.pexels.com/photos/248412/pexels-photo-248412.jpeg?auto=compress&cs=tinysrgb&w=150",
  veggies: "https://images.pexels.com/photos/144248/potatoes-vegetables-erdfrucht-bio-144248.jpeg?auto=compress&cs=tinysrgb&w=150",
  drinks: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=300&q=80",
  snacks: "https://images.pexels.com/photos/568805/pexels-photo-568805.jpeg?auto=compress&cs=tinysrgb&w=150",
  breakfast: "https://images.pexels.com/photos/884600/pexels-photo-884600.jpeg?auto=compress&cs=tinysrgb&w=150",
  sweets: "https://images.pexels.com/photos/65882/chocolate-dark-coffee-confiserie-65882.jpeg?auto=compress&cs=tinysrgb&w=150",
  bakery: "https://images.pexels.com/photos/1395319/pexels-photo-1395319.jpeg?auto=compress&cs=tinysrgb&w=150",
  tea: "https://images.pexels.com/photos/312418/pexels-photo-312418.jpeg?auto=compress&cs=tinysrgb&w=150",
  staples: "https://images.pexels.com/photos/6287295/pexels-photo-6287295.jpeg?auto=compress&cs=tinysrgb&w=150",
  masala: "https://images.pexels.com/photos/33783/olive-oil-salad-dressing-cooking-olive.jpg?auto=compress&cs=tinysrgb&w=150",
  sauces: "https://images.pexels.com/photos/1435735/pexels-photo-1435735.jpeg?auto=compress&cs=tinysrgb&w=150",
  meat: "https://images.pexels.com/photos/618775/pexels-photo-618775.jpeg?auto=compress&cs=tinysrgb&w=150",
  organic: "https://images.pexels.com/photos/7421213/pexels-photo-7421213.jpeg?auto=compress&cs=tinysrgb&w=150",
  baby: "https://images.pexels.com/photos/3845492/pexels-photo-3845492.jpeg?auto=compress&cs=tinysrgb&w=150",
  pharma: "https://images.pexels.com/photos/593451/pexels-photo-593451.jpeg?auto=compress&cs=tinysrgb&w=150",
  cleaning: "https://images.pexels.com/photos/5202925/pexels-photo-5202925.jpeg?auto=compress&cs=tinysrgb&w=150",
  home: "https://images.pexels.com/photos/4198024/pexels-photo-4198024.jpeg?auto=compress&cs=tinysrgb&w=150",
  personal: "https://images.pexels.com/photos/6621376/pexels-photo-6621376.jpeg?auto=compress&cs=tinysrgb&w=150",
  pet: "https://images.pexels.com/photos/1108099/pexels-photo-1108099.jpeg?auto=compress&cs=tinysrgb&w=150",
  restaurants: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80"
};

let customerCategoryImages = {};
let customerHomepageBanners = [];
let customerLegacyHomepageBanner = null;
let customerHomepageBannerIndex = 0;
let customerHomepageBannerTimer = null;
let customerDailyOffer = null;
let customerHeroFeatureIndex = 0;
let customerHeroFeatureTimer = null;
let customerHeroFeatureSlides = [];
const defaultHeroFeatureSlides = [
  {
    eyebrow: 'Daily essentials',
    title: 'Shop MyShopzy Store',
    subtitle: 'Groceries and essentials, delivered fast',
    image_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=800&q=80',
    href: '#customerCategoryGrid'
  },
  {
    eyebrow: 'Meals nearby',
    title: 'Restaurants Around You',
    subtitle: 'Meals, tiffins & more',
    image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
    href: 'service.html?type=restaurant'
  },
  {
    eyebrow: 'Across Mandapeta',
    title: 'Parcel Delivery',
    subtitle: 'Send a parcel across town',
    image_url: 'https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=800&q=80',
    href: 'service.html?type=parcel'
  }
];

let selectedCategoryPreviewId = "";

function openCategoryPage(categoryId, categoryName = "", trigger = null) {
  const category = customerDatabaseCategories?.find(item => item.id === categoryId || item.slug === categoryId)
    || categories.find(item => item.id === categoryId);
  if (categoryId === "food-delivery" || category?.slug === "food-delivery") {
    openServiceCategory("food-delivery", trigger);
    return;
  }
  if (categoryId === "restaurants" || category?.slug === "restaurants") {
    window.location.href = customerServicePageUrl({ type: "restaurant" });
    return;
  }
  const categorySlug = category?.slug || categoryId;
  const query = new URLSearchParams({ type: "category", categorySlug });
  const name = category?.name || categoryName;
  if (name) query.set("categoryName", name);
  if (trigger instanceof HTMLElement) {
    trigger.classList.add("category-navigation-pending");
    trigger.setAttribute("aria-busy", "true");
  }
  window.location.href = `service.html?${query.toString()}`;
}

function selectCategoryPreview(productId) {
  selectedCategoryPreviewId = productId;
  document.querySelectorAll("#customerCategoryPreviews [data-category-product-id]").forEach(card => {
    const selected = card.dataset.categoryProductId === String(productId);
    card.classList.toggle("is-selected", selected);
    card.querySelectorAll("[data-preview-select]").forEach(button => button.setAttribute("aria-pressed", String(selected)));
  });
}

function refreshCategoryPreviewProduct(productId) {
  const card = [...document.querySelectorAll("#customerCategoryPreviews [data-category-product-id]")]
    .find(item => item.dataset.categoryProductId === String(productId));
  const product = liveCatalog.find(item => String(item.id) === String(productId));
  if (card && product) card.outerHTML = renderCategoryPreviewProduct(product);
}

function renderCategoryPreviewProduct(product) {
  const quantity = cartState[product.id] || 0;
  const productId = escapeAttribute(product.id);
  const unit = product.qty_value ? `${product.qty_value} ${product.qty_unit || "g"}` : product.qty_unit || product.unit || "1 pc";
  const price = getProductPrice(product, getSelectedProductWeight(product));
  const selected = selectedCategoryPreviewId === product.id;
  const selectedClass = selected ? "is-selected" : "";

  return `<article data-category-product-id="${productId}" class="min-w-0 category-product-card rounded-xl bg-white p-2 shadow-sm transition ${selectedClass}">
    <button type="button" data-preview-select onclick="selectCategoryPreview('${productId}')" aria-pressed="${selected}" class="block w-full text-left">
      <div class="relative flex h-24 items-center justify-center rounded-lg bg-slate-50 p-2"><img src="${escapeAttribute(product.image_url || "")}" alt="${escapeAttribute(product.name || "Product")}" loading="lazy" class="max-h-full max-w-full object-contain" onerror="this.classList.add('hidden')"></div>
      <p class="mt-2 truncate text-[10px] font-semibold text-slate-500">${escapeHtml(unit)}</p>
      <h4 class="mt-1 line-clamp-2 min-h-8 text-[11px] font-bold text-slate-900">${escapeHtml(product.name || "Product")}</h4>
    </button>
    <div class="mt-2 flex items-center justify-between gap-1"><strong class="text-xs font-black text-slate-900">₹${price}</strong>
      ${quantity === 0
        ? `<button type="button" onclick="modifyCart('${productId}', 1)" class="rounded-lg border-2 border-emerald-700 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-800">ADD</button>`
        : `<div class="flex items-center gap-2 rounded-lg bg-emerald-700 px-2 py-1 text-[10px] font-black text-white"><button type="button" aria-label="Remove one" onclick="modifyCart('${productId}', -1)">-</button><span>${quantity}</span><button type="button" aria-label="Add one" onclick="modifyCart('${productId}', 1)">+</button></div>`}
    </div>
  </article>`;
}

function renderCustomerCategoryPreviews() {
  const container = document.getElementById("customerCategoryPreviews");
  if (!container) return;

  container.innerHTML = categories.map(category => {
    const products = liveCatalog.filter(product => product.category === category.id).slice(0, 6);

    return `<section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <button type="button" onclick="openCategoryPage('${escapeAttribute(category.id)}', '${escapeAttribute(category.name)}', this)" class="min-w-0 truncate text-left text-sm font-black text-slate-900">${escapeHtml(category.name)}</button>
        <button type="button" onclick="openCategoryPage('${escapeAttribute(category.id)}', '${escapeAttribute(category.name)}', this)" class="shrink-0 text-[10px] font-black text-emerald-700">View all →</button>
      </div>
      ${products.length
        ? `<div class="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-3">${products.map(renderCategoryPreviewProduct).join("")}</div>`
        : '<p class="rounded-xl border border-slate-200 bg-white px-3 py-5 text-center text-xs text-slate-500">No products available in this category yet.</p>'}
    </section>`;
  }).join("");
}

function renderCustomerCategoryTiles() {
  const container = document.getElementById('customerCategoryGrid');
  if (!container) return;
  const tileCategories = customerDatabaseCategories === null ? categories : customerDatabaseCategories;
  if (tileCategories.length === 0) {
    container.innerHTML = '<p class="col-span-full py-6 text-center text-xs text-slate-500">No categories available yet.</p>';
    return;
  }
  container.innerHTML = tileCategories.map(category => {
    const categorySlug = category.slug || category.id;
    const imageUrl = customerCategoryImages[category.id] || customerCategoryImages[categorySlug] || category.image_url || categoryDefaultImages[category.id] || categoryDefaultImages[categorySlug] || '';
    return `<button type="button" onclick="openCategoryPage('${escapeAttribute(categorySlug)}', '${escapeAttribute(category.name)}', this)" class="cat-card group flex min-h-[125px] flex-col items-center justify-between rounded-2xl border border-slate-200 bg-white p-2 text-center transition hover:border-emerald-500 hover:shadow-md">
      <span class="flex h-16 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50 p-1"><img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(category.name)}" class="max-h-full object-contain transition group-hover:scale-105" onerror="this.classList.add('hidden')"></span>
      <span class="mt-1 text-[11px] font-bold leading-tight text-slate-800">${escapeHtml(category.name)}</span>
    </button>`;
  }).join('');
}

async function loadCustomerCategorySettings() {
  try {
    const imagePayload = await fetchCustomerContent('/category-images');
    customerCategoryImages = imagePayload?.data || {};
  } catch (error) {
    console.warn('PostgreSQL category images are unavailable:', error.message);
    customerCategoryImages = {};
  }
  try {
    const result = await fetchCustomerContent('/categories');
    if (!Array.isArray(result.data)) throw new Error('Unable to retrieve categories.');
    customerDatabaseCategories = result.data;
  } catch (error) {
    console.error('PostgreSQL category catalog request failed:', error);
    customerDatabaseCategories = null;
  }
  renderCustomerCategoryTiles();
}

function isParcelPromotion(item) {
  const content = [item?.title, item?.subtitle, item?.description, item?.body, item?.eyebrow]
    .filter(value => typeof value === "string")
    .join(" ");
  return /\bparcels?\b/i.test(content)
    && (/\d+(?:\.\d+)?\s*%/.test(content)
      || /\b\d+(?:\.\d+)?\s*percent\b/i.test(content)
      || /\b(?:discount|offer|deal|promo|save|off)\b/i.test(content));
}

function isParcelPanelOpen() {
  const panel = document.getElementById("serviceParcelPanel");
  return Boolean(panel && !panel.classList.contains("hidden"));
}

function renderHomepageBanner(banner) {
  const homeHero = document.getElementById("customerHomeHero");
  if (isParcelPanelOpen()) {
    homeHero?.classList.add("hidden");
    return;
  }
  if (isParcelPromotion(banner)) {
    homeHero?.classList.add("hidden");
    return;
  }
  homeHero?.classList.remove("hidden");
  if (!banner) return;
  const title = document.getElementById('bannerTitleDisplay');
  const subtitle = document.getElementById('bannerSubDisplay');
  if (title) title.innerText = banner.title || '';
  if (subtitle) subtitle.innerText = banner.subtitle || '';
}

function renderHeroFeatureCarousel() {
  const carousel = document.getElementById('heroFeatureCarousel');
  if (!carousel) return;
  const managedSlides = customerHomepageBanners
    .filter(banner => banner.image_url && !isParcelPromotion(banner))
    .map(banner => ({
      eyebrow: 'Store highlight',
      title: banner.title || 'Shop the latest',
      subtitle: banner.subtitle || 'Explore what is fresh today',
      image_url: banner.image_url,
      href: '#productsGrid'
    }));
  if (!customerHomepageBanners.length && customerLegacyHomepageBanner?.image_url
      && !isParcelPromotion(customerLegacyHomepageBanner)) {
    managedSlides.push({
      eyebrow: 'Store highlight',
      title: customerLegacyHomepageBanner.title || 'Shop today',
      subtitle: customerLegacyHomepageBanner.subtitle || 'Explore what is fresh today',
      image_url: customerLegacyHomepageBanner.image_url,
      href: '#productsGrid'
    });
  }
  customerHeroFeatureSlides = [...defaultHeroFeatureSlides, ...managedSlides];
  customerHeroFeatureIndex %= customerHeroFeatureSlides.length;
  const slide = customerHeroFeatureSlides[customerHeroFeatureIndex];
  const link = document.getElementById('heroFeatureLink');
  const image = document.getElementById('heroFeatureImage');
  if (link) link.href = slide.href;
  if (image) {
    image.src = slide.image_url;
    image.alt = slide.title;
  }
  document.getElementById('heroFeatureEyebrow').innerText = slide.eyebrow;
  document.getElementById('heroFeatureTitle').innerText = slide.title;
  document.getElementById('heroFeatureSubtitle').innerText = slide.subtitle;
  const indicators = document.getElementById('heroFeatureIndicators');
  if (indicators) indicators.innerHTML = customerHeroFeatureSlides.map((item, index) => `
    <button type="button" onclick="selectHeroFeature(${index})" aria-label="Show ${escapeAttribute(item.title)}" aria-current="${index === customerHeroFeatureIndex}" class="h-2 w-2 rounded-full border border-white/70 ${index === customerHeroFeatureIndex ? 'bg-amber-400' : 'bg-white/40'}"></button>
  `).join('');
}

function selectHeroFeature(index) {
  if (!customerHeroFeatureSlides.length) return;
  customerHeroFeatureIndex = (index + customerHeroFeatureSlides.length) % customerHeroFeatureSlides.length;
  renderHeroFeatureCarousel();
}

function stepHeroFeature(direction) {
  selectHeroFeature(customerHeroFeatureIndex + direction);
}

let customerServicePromoIndex = 0;
let customerServicePromoTimer = null;

function selectCustomerServicePromo(index) {
  const track = document.getElementById("servicePromoTrack");
  const indicators = document.getElementById("servicePromoIndicators");
  if (!track) return;
  const slides = [...track.children];
  if (!slides.length) return;
  customerServicePromoIndex = (index + slides.length) % slides.length;
  track.style.transform = `translateX(-${customerServicePromoIndex * 100}%)`;
  slides.forEach((slide, slideIndex) => {
    slide.inert = slideIndex !== customerServicePromoIndex;
    slide.setAttribute("aria-hidden", String(slideIndex !== customerServicePromoIndex));
  });
  indicators?.querySelectorAll("button").forEach((button, buttonIndex) => {
    button.setAttribute("aria-current", String(buttonIndex === customerServicePromoIndex));
  });
}

function startCustomerServicePromoCarousel() {
  const carousel = document.getElementById("servicePromoCarousel");
  const track = document.getElementById("servicePromoTrack");
  const indicators = document.getElementById("servicePromoIndicators");
  if (!carousel || !track || !indicators) return;
  indicators.innerHTML = [...track.children].map((slide, index) =>
    `<button type="button" onclick="selectCustomerServicePromo(${index})" aria-label="Show ${index + 1} featured service" aria-current="false"></button>`
  ).join("");
  selectCustomerServicePromo(0);
  if (carousel.dataset.swipeReady !== "true") {
    carousel.dataset.swipeReady = "true";
    let touchStartX = null;
    carousel.addEventListener("touchstart", event => {
      touchStartX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    carousel.addEventListener("touchend", event => {
      if (touchStartX === null) return;
      const swipeDistance = event.changedTouches[0].clientX - touchStartX;
      if (Math.abs(swipeDistance) > 40) {
        selectCustomerServicePromo(customerServicePromoIndex + (swipeDistance < 0 ? 1 : -1));
      }
      touchStartX = null;
    }, { passive: true });
  }
  if (!customerServicePromoTimer) {
    customerServicePromoTimer = setInterval(() => {
      selectCustomerServicePromo(customerServicePromoIndex + 1);
    }, 5000);
  }
}

function startHeroFeatureCarousel() {
  renderHeroFeatureCarousel();
  const carousel = document.getElementById('heroFeatureCarousel');
  if (carousel && carousel.dataset.swipeReady !== 'true') {
    carousel.dataset.swipeReady = 'true';
    let touchStartX = null;
    carousel.addEventListener('touchstart', event => {
      touchStartX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    carousel.addEventListener('touchend', event => {
      if (touchStartX === null) return;
      const swipeDistance = event.changedTouches[0].clientX - touchStartX;
      if (Math.abs(swipeDistance) > 40) stepHeroFeature(swipeDistance < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });
  }
  if (!customerHeroFeatureTimer) {
    customerHeroFeatureTimer = setInterval(() => stepHeroFeature(1), 5200);
  }
}

function selectHomepageBanner(index) {
  if (!customerHomepageBanners.length) return;
  customerHomepageBannerIndex = (index + customerHomepageBanners.length) % customerHomepageBanners.length;
  renderHomepageBanner(customerHomepageBanners[customerHomepageBannerIndex]);
  const indicators = document.getElementById('homepageBannerIndicators');
  if (indicators) indicators.querySelectorAll('button').forEach((button, buttonIndex) => {
    button.classList.toggle('bg-amber-500', buttonIndex === customerHomepageBannerIndex);
    button.classList.toggle('bg-slate-300', buttonIndex !== customerHomepageBannerIndex);
    button.setAttribute('aria-current', String(buttonIndex === customerHomepageBannerIndex));
  });
}

function renderHomepageBannerIndicators() {
  const container = document.getElementById('homepageBannerIndicators');
  if (!container) return;
  container.innerHTML = customerHomepageBanners.length > 1 ? customerHomepageBanners.map((banner, index) => `
    <button type="button" onclick="selectHomepageBanner(${index})" aria-label="Show banner ${index + 1}: ${escapeAttribute(banner.title || '')}" class="h-2.5 w-2.5 rounded-full ${index === customerHomepageBannerIndex ? 'bg-amber-500' : 'bg-slate-300'}"></button>
  `).join('') : '';
}

function loadLegacyCustomerHomepageBanners() {
  if (!legacyCustomerDb?.collection) {
    return;
  }

  legacyCustomerDb.collection('settings').doc('hero_banner').onSnapshot(snapshot => {
    customerLegacyHomepageBanner = snapshot.exists ? snapshot.data() : null;
    if (!customerHomepageBanners.length && customerLegacyHomepageBanner) renderHomepageBanner(customerLegacyHomepageBanner);
    renderHeroFeatureCarousel();
  }, error => console.error('Legacy homepage banner listener error:', error));

  legacyCustomerDb.collection('homepage_banners').onSnapshot(snapshot => {
    customerHomepageBanners = [];
    snapshot.forEach(doc => {
      const banner = { id: doc.id, ...doc.data() };
      if (banner.is_active !== false && !isParcelPromotion(banner)) customerHomepageBanners.push(banner);
    });
    customerHomepageBanners.sort((left, right) => Number(right.created_at_ms || 0) - Number(left.created_at_ms || 0));
    customerHomepageBannerIndex = Math.min(customerHomepageBannerIndex, Math.max(0, customerHomepageBanners.length - 1));
    renderHomepageBannerIndicators();
    renderHeroFeatureCarousel();
    if (customerHomepageBanners.length) selectHomepageBanner(customerHomepageBannerIndex);
    else if (customerLegacyHomepageBanner) renderHomepageBanner(customerLegacyHomepageBanner);
  }, error => console.error('Homepage banner listener error:', error));

  if (!customerHomepageBannerTimer) {
    customerHomepageBannerTimer = setInterval(() => {
      if (customerHomepageBanners.length > 1) selectHomepageBanner(customerHomepageBannerIndex + 1);
    }, 6000);
  }
}

async function loadCustomerHomepageBanners() {
  startHeroFeatureCarousel();
  try {
    const result = await fetchCustomerContent('/banners');
    if (result.configured) {
      const banners = Array.isArray(result.data) ? result.data : [];
      customerHomepageBanners = banners.filter(banner => !isParcelPromotion(banner));
      customerLegacyHomepageBanner = null;
      if (isParcelPanelOpen() || (banners.length && !customerHomepageBanners.length)) {
        document.getElementById("customerHomeHero")?.classList.add("hidden");
      } else if (customerHomepageBanners.length) {
        document.getElementById("customerHomeHero")?.classList.remove("hidden");
      }
      customerHomepageBanners.sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
      customerHomepageBannerIndex = Math.min(customerHomepageBannerIndex, Math.max(0, customerHomepageBanners.length - 1));
      renderHomepageBannerIndicators();
      renderHeroFeatureCarousel();
      if (customerHomepageBanners.length) selectHomepageBanner(customerHomepageBannerIndex);
      if (!customerHomepageBannerTimer) {
        customerHomepageBannerTimer = setInterval(() => {
          if (customerHomepageBanners.length > 1) selectHomepageBanner(customerHomepageBannerIndex + 1);
        }, 6000);
      }
      return;
    }
  } catch (error) {
    console.warn('PostgreSQL homepage banners are unavailable; using legacy banners:', error.message);
  }
  loadLegacyCustomerHomepageBanners();
}

function renderCustomerDailyOffer(offer) {
  const modal = document.getElementById('dailyOfferModal');
  const title = document.getElementById('dailyOfferTitle');
  const description = document.getElementById('dailyOfferDescription');
  const body = document.getElementById('dailyOfferBody');
  const code = document.getElementById('dailyOfferCode');
  const codeWrap = document.getElementById('dailyOfferCodeWrap');
  const image = document.getElementById('dailyOfferImage');
  const eyebrow = document.getElementById('dailyOfferEyebrow');
  if (!offer || offer.is_active !== true || isParcelPromotion(offer)) {
    closeDailyOffer();
    return;
  }
  if (title) title.innerText = offer.title || '';
  if (description) description.innerText = offer.description || '';
  if (body) body.innerText = offer.body || '';
  if (eyebrow) eyebrow.innerText = offer.eyebrow || "Today's Mandapeta Offer";
  if (code) code.innerText = offer.code || '';
  if (codeWrap) codeWrap.classList.toggle('hidden', !offer.code);
  if (image) {
    image.classList.toggle('hidden', !offer.image_url);
    if (offer.image_url) image.src = offer.image_url;
  }
  if (modal) showDailyOfferOnce();
}

function loadLegacyCustomerDailyOffer() {
  if (!legacyCustomerDb?.collection) {
    return;
  }

  const offerRef = legacyCustomerDb.collection('settings').doc('daily_offer');
  offerRef.get().then(snapshot => {
    customerDailyOffer = snapshot.exists ? snapshot.data() : null;
    renderCustomerDailyOffer(customerDailyOffer);
  }).catch(error => {
    console.warn('Legacy daily offer load failed:', error);
    customerDailyOffer = null;
    renderCustomerDailyOffer(customerDailyOffer);
  });
  offerRef.onSnapshot(snapshot => {
    customerDailyOffer = snapshot.exists ? snapshot.data() : null;
    renderCustomerDailyOffer(customerDailyOffer);
  }, error => console.error('Daily offer listener error:', error));
}

async function loadCustomerDailyOffer() {
  try {
    const result = await fetchCustomerContent('/daily-offer');
    if (result.configured) {
      customerDailyOffer = result.data;
      renderCustomerDailyOffer(customerDailyOffer);
      return;
    }
  } catch (error) {
    console.warn('PostgreSQL daily offer is unavailable; checking legacy offer:', error.message);
  }
  loadLegacyCustomerDailyOffer();
}


let liveCatalog = [];
let backendCatalogProducts = [];
let legacyCatalogProducts = [];
let serviceCheckoutProducts = [];

const shopServiceCategories = [
  { id: "staples", name: "Groceries", icon: "🌾" },
  { id: "veggies", name: "Vegetables", icon: "🥦" },
  { id: "organic", name: "Fruits", icon: "🍎" },
  { id: "dairy", name: "Dairy & Eggs", icon: "🥛" },
  { id: "cleaning", name: "Household", icon: "🧽" },
  { id: "personal", name: "Personal Care", icon: "🧴" }
];

let serviceRestaurants = [];

let cartState = {};
const selectedProductWeights = {};
const WEIGHT_OPTION_CATEGORIES = new Set(["meat", "veggies", "bakery", "organic"]);
let riderTipAmount = 0;

let activeCategory =
  "veggies";

let activeRestaurantId = "";

let currentSearch =
  "";

function supportsWeightOptions(product) {
  return WEIGHT_OPTION_CATEGORIES.has(String(product?.category || "").toLowerCase());
}

function getProductBaseWeightGrams(product) {
  const value = Number(product?.qty_value);
  const unit = String(product?.qty_unit || product?.unit || "").toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return 500;
  if (unit.includes("kg") || unit.includes("kilo")) return value * 1000;
  if (unit.includes("g") || unit.includes("gram")) return value;
  return 500;
}

function getSelectedProductWeight(product) {
  return selectedProductWeights[product.id] || getProductBaseWeightGrams(product);
}

function getProductPrice(product, weightGrams = getSelectedProductWeight(product)) {
  const baseWeight = getProductBaseWeightGrams(product);
  const basePrice = Number(product?.price || 0);
  return supportsWeightOptions(product) ? Math.round(basePrice * (weightGrams / baseWeight)) : basePrice;
}

function formatWeight(grams) {
  return grams >= 1000 ? `${grams / 1000} kg` : `${grams} g`;
}

function selectProductWeight(productId, weightGrams) {
  selectedProductWeights[productId] = Number(weightGrams);
  filterAndRender();
  syncCartBar();
}

function renderWeightOptions(product) {
  if (!supportsWeightOptions(product)) return "";
  const selectedWeight = getSelectedProductWeight(product);
  return `<div class="mt-2 flex flex-wrap gap-1" onclick="event.stopPropagation()">
    ${[500, 1000, 2000].map(weight => `<button type="button" onclick="selectProductWeight('${escapeAttribute(product.id)}', ${weight})" class="weight-option ${selectedWeight === weight ? "weight-option-selected" : ""}">${formatWeight(weight)}</button>`).join("")}
  </div>`;
}

const CUSTOMER_RESTAURANT_FALLBACK_IMAGE = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80";

function resolveRestaurantAvailabilityLabel(restaurant) {
  const candidates = [
    restaurant?.status,
    restaurant?.shop_status,
    restaurant?.availability_status,
    restaurant?.current_status,
    restaurant?.is_open,
    restaurant?.is_open_now,
    restaurant?.is_active,
    restaurant?.is_enabled,
    restaurant?.is_closed,
    restaurant?.closed,
    restaurant?.availability?.status,
    restaurant?.hours?.status
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return { label: candidate ? "Open" : "Closed", tone: candidate ? "open" : "closed" };
    }

    if (typeof candidate === "string") {
      const normalized = candidate.trim().toUpperCase();
      if (["OPEN", "AVAILABLE", "ACTIVE", "ONLINE", "ENABLED", "READY"].includes(normalized)) {
        return { label: "Open", tone: "open" };
      }
      if (["CLOSED", "UNAVAILABLE", "INACTIVE", "OFFLINE", "PAUSED", "SUSPENDED", "DISABLED"].includes(normalized)) {
        return { label: "Closed", tone: "closed" };
      }
    }
  }

  return { label: "Availability not provided", tone: "unknown" };
}

function renderRestaurantAvailabilityPill(restaurant) {
  const availability = resolveRestaurantAvailabilityLabel(restaurant);
  const toneClasses = availability.tone === "open"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : availability.tone === "closed"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-slate-50 text-slate-500";

  return `<span class="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${toneClasses}">${escapeHtml(availability.label)}</span>`;
}

function openRestaurantListing() {
  window.location.href = customerServicePageUrl({ type: "restaurant" });
}

function openRestaurantMenu(shopId) {
  if (!shopId) return;
  window.location.href = customerServicePageUrl({ type: "restaurant", shopId });
}

function customerServicePageUrl(params = {}) {
  const customerScript = [...document.scripts].find(script => new URL(script.src, window.location.href).pathname.endsWith("/js/customer.js"));
  const serviceUrl = customerScript
    ? new URL("../service.html", customerScript.src)
    : new URL("service.html", window.location.href);
  Object.entries(params).forEach(([key, value]) => serviceUrl.searchParams.set(key, value));
  return serviceUrl.href;
}

function renderCustomerRestaurantCard(restaurant) {
  const description = restaurant.cuisine || restaurant.description || "Restaurant menu";
  return `<button type="button" onclick="openRestaurantMenu('${escapeAttribute(restaurant.id)}')" class="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-amber-400">
    <img src="${CUSTOMER_RESTAURANT_FALLBACK_IMAGE}" alt="" class="h-16 w-16 shrink-0 rounded-xl object-cover">
    <span class="min-w-0 flex-1"><strong class="block truncate text-sm font-black text-slate-900">${escapeHtml(restaurant.name || "Restaurant")}</strong><span class="mt-1 block truncate text-[11px] text-slate-500">${escapeHtml(description)}</span>${renderRestaurantAvailabilityPill(restaurant)}</span>
    <span class="shrink-0 text-[10px] font-black text-emerald-700">View menu ↗</span>
  </button>`;
}

async function loadCustomerRestaurants() {
  const directory = document.getElementById('restaurantDirectory');
  if (!directory) return;
  directory.setAttribute("aria-busy", "true");
  try {
    const result = await fetchCustomerContent("/shops");
    serviceRestaurants = Array.isArray(result.data)
      ? result.data.filter(shop => String(shop.business_type || "").toUpperCase() === "RESTAURANT")
      : [];
    directory.removeAttribute("aria-busy");
    renderServiceRestaurantList();
    directory.innerHTML = serviceRestaurants.length
      ? serviceRestaurants.map(renderCustomerRestaurantCard).join("")
      : '<p class="col-span-full rounded-xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">No restaurants available yet.</p>';
  } catch (error) {
    console.error("Customer restaurant listing failed:", error);
    directory.removeAttribute("aria-busy");
    directory.innerHTML = '<p class="col-span-full rounded-xl border border-rose-200 bg-white p-4 text-xs text-rose-600">Unable to load restaurants right now.</p>';
  }
}

function showServiceSection(section) {
  if (section === "meat") {
    window.location.href = `service.html?type=${encodeURIComponent(section)}`;
    return;
  }
  hideServiceSections();
  const panel = document.getElementById(`service${section.charAt(0).toUpperCase()}${section.slice(1)}Panel`);
  if (!panel) return;
  if (section === "parcel") {
    const hero = document.getElementById("customerHomeHero");
    if (hero) {
      hero.dataset.visibleBeforeParcelPanel = String(!hero.classList.contains("hidden"));
      hero.classList.add("hidden");
    }
  }
  panel.classList.remove("hidden");
  if (section === "shop") renderServiceShopCategories();
  if (section === "restaurant") renderServiceRestaurantList();
  document.getElementById("serviceDirectory")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideServiceSections() {
  document.querySelectorAll("#serviceDirectory > div[id$='Panel']").forEach(panel => panel.classList.add("hidden"));
  const hero = document.getElementById("customerHomeHero");
  const shouldRestoreHero = hero?.dataset.visibleBeforeParcelPanel === "true";
  if (hero) delete hero.dataset.visibleBeforeParcelPanel;
  if (shouldRestoreHero) {
    renderHomepageBanner(customerHomepageBanners[customerHomepageBannerIndex] || customerLegacyHomepageBanner);
  }
}

function renderServiceShopCategories() {
  const container = document.getElementById("serviceShopCategories");
  if (!container) return;
  container.innerHTML = shopServiceCategories.map(category => `
    <button type="button" onclick="selectCategory('${escapeAttribute(category.id)}', this)" class="min-w-[104px] p-3 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 text-center transition">
      <span class="block text-xl">${category.icon}</span>
      <span class="block mt-1 text-[10px] font-black text-slate-800">${escapeHtml(category.name)}</span>
    </button>
  `).join("");
}

function renderServiceRestaurantList() {
  const container = document.getElementById("serviceRestaurantList");
  if (!container) return;
  if (!serviceRestaurants.length) {
    container.innerHTML = '<p class="p-4 bg-white rounded-xl border border-slate-200 text-xs text-slate-500">Restaurant menus will appear here when available.</p>';
    return;
  }

  container.innerHTML = serviceRestaurants.map(restaurant => {
    const dishMarkup = '<p class="text-[11px] text-slate-400 py-3">Menu items are being updated.</p>';
    const availability = resolveRestaurantAvailabilityLabel(restaurant);
    const statusClass = availability.tone === "open"
      ? "text-emerald-700"
      : availability.tone === "closed"
        ? "text-rose-700"
        : "text-slate-500";
    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-3">
        <button type="button" onclick="selectRestaurant('${escapeAttribute(restaurant.id)}', '${escapeAttribute(restaurant.name || "Restaurant")}')" class="flex items-center gap-3 text-left">
          <img src="${escapeAttribute(restaurant.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80")}" alt="${escapeAttribute(restaurant.name || "Restaurant")}" class="w-16 h-16 rounded-xl object-cover">
          <span><strong class="block text-sm font-black text-slate-900">${escapeHtml(restaurant.name || "Restaurant")}</strong><span class="block text-[11px] text-slate-500 mt-1">${escapeHtml(restaurant.cuisine || "Restaurant menu")}</span><span class="mt-1 block text-[10px] font-black ${statusClass}">${escapeHtml(availability.label)}</span><span class="block text-[10px] font-black text-slate-700 mt-1">${Number(restaurant.distance_km || 0).toFixed(1)} km · 25-45 min</span></span>
        </button>
        <div class="relative mt-3">
          <button type="button" onclick="scrollServiceDishes(this, -1)" aria-label="Previous dishes" class="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-[#0B132B] text-white text-xs font-black">‹</button>
          <div class="service-dish-slider flex gap-2 overflow-x-auto no-scrollbar px-8 pb-1">${dishMarkup}</div>
          <button type="button" onclick="scrollServiceDishes(this, 1)" aria-label="Next dishes" class="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-[#0B132B] text-white text-xs font-black">›</button>
        </div>
      </article>
    `;
  }).join("");
}

function scrollServiceDishes(button, direction) {
  button.parentElement.querySelector(".service-dish-slider")?.scrollBy({ left: direction * 190, behavior: "smooth" });
}

function openServiceDish(productId) {
  const product = liveCatalog.find(item => item.id === productId);
  if (product) openProductDetailModal(product);
}

async function submitParcelRequest(event) {
  event.preventDefault();
  if (!getCustomerAccessToken()) return alert("A secure customer session is required to request a parcel delivery.");
  const pickup = document.getElementById("parcelPickupInput")?.value.trim();
  const drop = document.getElementById("parcelDropInput")?.value.trim();
  const description = document.getElementById("parcelDescriptionInput")?.value.trim();
  const [pickupLocation, dropLocation] = await Promise.all([
    geocodeParcelAddress(pickup),
    geocodeParcelAddress(drop)
  ]);
  const pickupLatitude = pickupLocation?.lat ?? null;
  const pickupLongitude = pickupLocation?.lng ?? null;
  const dropLatitude = dropLocation?.lat ?? currentCustomerCoords.lat;
  const dropLongitude = dropLocation?.lng ?? currentCustomerCoords.lng;
  let order;
  try {
    order = await customerOrderApiRequest("", {
      method: "POST",
      body: JSON.stringify({
        order_type: "PARCEL",
        payment_method: "COD",
        address: {
          recipient_name: getCustomerDisplayName(),
          recipient_phone_e164: getCurrentCustomerPhone(),
          address_line1: drop,
          city: "Mandapeta",
          state: "Andhra Pradesh",
          postal_code: "533238",
          country_code: "IN",
          latitude: dropLatitude,
          longitude: dropLongitude
        },
        parcel: {
          pickup_address: pickup,
          pickup_latitude: pickupLatitude,
          pickup_longitude: pickupLongitude,
          drop_address: drop,
          drop_latitude: dropLatitude,
          drop_longitude: dropLongitude,
          description
        }
      })
    });
  } catch (error) {
    console.error("Parcel order creation failed:", error);
    alert(`Parcel request was not placed: ${error.message}`);
    return;
  }

  const status = document.getElementById("parcelRequestStatus");
  if (status) {
    status.innerText = `Parcel ${order.order_number || order.id} created. A rider will be assigned shortly.`;
    status.dataset.orderCountdown = "true";
    status.dataset.orderStatus = order.status || "PLACED";
    status.dataset.deliveryDeadlineMs = String(order.delivery_deadline_ms || "");
    status.dataset.promiseMinMinutes = String(order.delivery_promise_min_minutes || "");
    status.dataset.promiseMaxMinutes = String(order.delivery_promise_max_minutes || "");
    status.classList.remove("hidden");
    startCustomerCountdowns();
  }
  event.target.reset();
}

async function geocodeParcelAddress(address) {
  if (!address) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(`${address}, Mandapeta`)}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const results = await response.json();
    if (!results[0]) return null;
    return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
  } catch (error) {
    console.warn("Parcel address geocoding failed:", error);
    return null;
  }
}


// ==========================================
// 25. FIREBASE PRODUCTS
// ==========================================

function publishCustomerCatalog() {
  const productsById = new Map();
  [...backendCatalogProducts, ...legacyCatalogProducts, ...serviceCheckoutProducts].forEach(product => {
    if (product?.id != null) productsById.set(String(product.id), product);
  });
  liveCatalog = [...productsById.values()];
  restorePendingServiceCart();
  renderCustomerCategoryPreviews();
  renderServiceRestaurantList();
  filterAndRender();
}

async function fetchBackendProducts() {
  try {
    const result = await fetchCustomerContent("/products");
    if (!Array.isArray(result.data)) throw new Error("Product catalog response is invalid.");
    backendCatalogProducts = result.data.map(product => ({
      ...product,
      category: product.category_slug || product.category_name || "",
      desc: product.description || "",
      qty_unit: product.unit_label || "",
      qty_value: Number(product.unit_quantity) || 1,
      restaurant_name: product.category_slug === "food-delivery" ? product.shop_name : ""
    }));
    publishCustomerCatalog();
  } catch (error) {
    console.error("Backend product catalog request failed:", error.message || error);
  }
}

function fetchProducts() {
  fetchBackendProducts();

  if (!legacyCustomerDb?.collection) {
    console.warn("Legacy product store is unavailable; using the backend catalog when available.");
    return;
  }

  legacyCustomerDb.collection("products")
    .orderBy("created_at", "desc")
    .onSnapshot(snapshot => {
      legacyCatalogProducts = [];
      snapshot.forEach(doc => legacyCatalogProducts.push({ id: doc.id, ...doc.data() }));
      publishCustomerCatalog();
    }, error => {
      console.error("Products listener error:", error);
    });
}

function restorePendingServiceCart() {
  const pendingCart = localStorage.getItem("myshopzy_pending_cart");
  if (!pendingCart) return;
  try {
    const parsedCart = JSON.parse(pendingCart);
    if (!parsedCart || typeof parsedCart !== "object") return;
    const pendingItems = parsedCart.items && typeof parsedCart.items === "object" ? parsedCart.items : parsedCart;
    const pendingProducts = Array.isArray(parsedCart.products) ? parsedCart.products : [];
    serviceCheckoutProducts = pendingProducts.filter(product => Object.hasOwn(pendingItems, product.id));
    serviceCheckoutProducts.forEach(product => {
      if (!liveCatalog.some(item => String(item.id) === String(product.id))) liveCatalog.push(product);
    });
    Object.entries(pendingItems).forEach(([productId, quantity]) => {
      if (liveCatalog.some(product => String(product.id) === String(productId))) cartState[productId] = Number(quantity) || 0;
    });
    localStorage.removeItem("myshopzy_pending_cart");
    syncCartBar();
    const pageAction = new URLSearchParams(window.location.search);
    if (Object.keys(cartState).length && pageAction.get("cart") === "1") {
      setTimeout(openCart, 250);
    } else if (Object.keys(cartState).length && pageAction.get("checkout") === "1") {
      setTimeout(openCheckout, 250);
    }
  } catch (error) {
    console.warn("Pending service cart restore failed:", error);
    localStorage.removeItem("myshopzy_pending_cart");
  }
}


// ==========================================
// 26. FILTER PRODUCTS
// ==========================================

function filterAndRender() {

  let filtered =
    liveCatalog.filter(
      item =>
        item.category ===
        activeCategory
    );

  if (activeCategory === "restaurants" && activeRestaurantId) {
    filtered = filtered.filter(item => item.restaurant_id === activeRestaurantId);
  }


  if (currentSearch) {
    const normalized = currentSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    filtered = liveCatalog.filter(item => {
      const matchesRestaurant = activeCategory !== "restaurants" || !activeRestaurantId || item.restaurant_id === activeRestaurantId;
      const haystack = `${item.name || ""} ${item.category || ""} ${item.category_name || ""} ${item.brand || ""} ${item.restaurant_name || ""} ${item.shop_name || ""} ${item.desc || ""} ${item.qty_unit || ""}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return matchesRestaurant && haystack.includes(normalized);
    });
  }


  const grid =
    document.getElementById(
      "productsGrid"
    );

  if (!grid) return;


  grid.innerHTML =
    "";


  if (
    filtered.length === 0
  ) {

    grid.innerHTML = `
      <div class="col-span-full py-10 text-center bg-white rounded-2xl border">

        <h4 class="text-xs font-bold text-slate-600">
          ${currentSearch ? `No products found for “${escapeHtml(currentSearch)}”` : "No products in this category"}
        </h4>

      </div>
    `;


    const badge =
      document.getElementById(
        "itemCountBadge"
      );

    if (badge) {

      badge.innerText =
        "0 Items";
    }

    return;
  }


  filtered.forEach(
    p => {

      const qtyVal =
        p.qty_value !== undefined
          ? p.qty_value
          : 1;


      const qtyUnit =
        p.qty_unit ||
        p.unit ||
        "pc";

      const selectedWeight = getSelectedProductWeight(p);
      const displayPrice = getProductPrice(p, selectedWeight);

      const qty =
        cartState[p.id] ||
        0;


      grid.innerHTML += `
        <div class="category-product-card bg-white p-2.5 rounded-2xl shadow-sm flex flex-col justify-between">

          <div>

            <div class="h-28 w-full rounded-xl bg-slate-50 relative mb-2 flex items-center justify-center p-2">

              <img
                src="${escapeAttribute(
                  p.image_url || ""
                )}"
                class="max-h-full max-w-full object-contain"
                onerror="this.style.display='none'"
              >

              <span class="absolute bottom-1 left-1 bg-slate-900 text-amber-300 text-[8px] font-black px-1 rounded">
                ⚡ 30 MINS
              </span>

            </div>

            ${p.restaurant_name ? `<span class="text-[9px] font-black uppercase text-amber-700">${escapeHtml(p.restaurant_name)}</span>` : ''}
            <button type="button" onclick="openProductDetailModal(${JSON.stringify(p)})" class="text-left w-full">
              <h4 class="text-xs font-bold text-slate-900 line-clamp-2">
                ${escapeHtml(
                  p.name || "Product"
                )}
              </h4>
            </button>

            <span class="text-[10px] text-slate-500 font-bold">
              ${supportsWeightOptions(p) ? formatWeight(selectedWeight) : `${qtyVal} ${escapeHtml(qtyUnit)}`}
            </span>

            ${renderWeightOptions(p)}

          </div>


          <div class="mt-2 flex items-center justify-between pt-2 border-t">

            <span class="text-xs font-black">
              ₹${displayPrice}
            </span>


            <div>

              ${
                qty === 0

                  ? `

                    <button
                      onclick="modifyCart('${escapeAttribute(p.id)}', 1)"
                      class="px-3 py-1 rounded-lg border-2 border-emerald-700 bg-emerald-50 text-emerald-800 text-xs font-black"
                    >
                      ADD
                    </button>

                  `

                  : `

                    <div class="flex items-center bg-emerald-700 text-white rounded-lg px-2 py-1 text-xs gap-2">

                      <button
                        onclick="modifyCart('${escapeAttribute(p.id)}', -1)"
                      >
                        -
                      </button>

                      <span>
                        ${qty}
                      </span>

                      <button
                        onclick="modifyCart('${escapeAttribute(p.id)}', 1)"
                      >
                        +
                      </button>

                    </div>

                  `
              }

            </div>

          </div>

        </div>
      `;
    }
  );


  const badge =
    document.getElementById(
      "itemCountBadge"
    );

  if (badge) {

    badge.innerText =
      `${filtered.length} Items`;
  }
}


// ==========================================
// 27. CATEGORY SELECTION
// ==========================================

function selectCategory(
  catId,
  targetEl = null
) {

  if (targetEl?.closest("#customerCategoryGrid")) {
    const category = categories.find(item => item.id === catId);
    openCategoryPage(catId, category?.name || "Products");
    return;
  }

  if (catId === "meat") {
    window.location.href = "service.html?type=meat";
    return;
  }

  if (!suppressCategoryScrollOnInit) {
    document.getElementById("homeProductFeed")?.classList.remove("hidden");
  }

  activeCategory =
    catId;
  activeRestaurantId = "";


  const obj =
    categories.find(
      c => c.id === catId
    );


  const heading =
    document.getElementById(
      "categoryHeading"
    );


  if (heading) {

    heading.innerText =
      obj
        ? obj.name
        : "Products";
  }


  filterAndRender();

  if (suppressCategoryScrollOnInit) return;

  const productsGrid = document.getElementById("productsGrid");
  if (productsGrid && targetEl !== null && targetEl !== undefined) {
    scrollToProducts(productsGrid);
  }
}

const CUSTOMER_SERVICE_ROUTES = {
  groceries: { category: "staples", name: "Fresh Groceries" },
  "fruits-vegetables": { category: "veggies", name: "Fruits & Vegetables" },
  "food-delivery": { destination: customerServicePageUrl({ type: "restaurant" }) },
  "meat-chicken": { destination: "service.html?type=meat" },
  "parcel-delivery": { destination: customerServicePageUrl({ type: "parcel" }) },
  "local-stores": { destination: customerServicePageUrl({ type: "local-stores" }) }
};

function openServiceCategory(serviceKey, targetEl = null) {
  const route = CUSTOMER_SERVICE_ROUTES[serviceKey];
  if (!route) return;

  if (route.destination) {
    window.location.href = route.destination;
    return;
  }

  if (route.panel) {
    showServiceSection(route.panel);
    return;
  }

  if (route.scrollTarget) {
    hideServiceSections();
    document.getElementById(route.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  openCategoryPage(route.category, route.name);
}

function scrollToProducts(productsGrid) {
  const productSection = productsGrid.parentElement || productsGrid;
  const headerOffset = (document.querySelector("header")?.getBoundingClientRect().height || 0) + 16;
  const startPosition = window.scrollY;
  const targetPosition = Math.max(0, startPosition + productSection.getBoundingClientRect().top - headerOffset);
  const distance = targetPosition - startPosition;
  const duration = 900;
  const startTime = performance.now();

  function animateScroll(currentTime) {
    const progress = Math.min((currentTime - startTime) / duration, 1);
    const easedProgress = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    window.scrollTo(0, startPosition + distance * easedProgress);
    if (progress < 1) requestAnimationFrame(animateScroll);
  }

  requestAnimationFrame(animateScroll);
}

function selectRestaurant(restaurantId) {
  openRestaurantMenu(restaurantId);
}


// ==========================================
// 28. CART
// ==========================================

function modifyCart(
  prodId,
  delta
) {

  selectedCategoryPreviewId = prodId;

  const next =
    (cartState[prodId] || 0) +
    delta;


  if (next <= 0) {

    delete cartState[prodId];

  } else {

    cartState[prodId] =
      next;
  }


  filterAndRender();
  refreshCategoryPreviewProduct(prodId);

  syncCartBar();
  if (!document.getElementById("cartScreenModal")?.classList.contains("hidden")) renderCartScreen();

  if (delta > 0) showCartAddToast();
}

let cartToastTimer = null;

function showCartAddToast() {
  const toast = document.getElementById("cartAddToast");
  if (!toast) return;
  toast.innerText = "Added to cart - keep shopping";
  toast.classList.remove("hidden");
  clearTimeout(cartToastTimer);
  cartToastTimer = setTimeout(() => toast.classList.add("hidden"), 1800);
}


function syncCartBar() {

  const bar =
    document.getElementById(
      "bottomCartBar"
    );


  if (!bar) return;


  let count = 0;

  let sum = 0;


  Object.keys(
    cartState
  ).forEach(
    id => {

      const item =
        liveCatalog.find(
          p => p.id == id
        );


      if (item) {

        count +=
          cartState[id];

        sum +=
          getProductPrice(item) *
          cartState[id];
      }
    }
  );


  if (count > 0) {

    bar.classList.remove(
      "hidden"
    );


    const countElement =
      document.getElementById(
        "barItemCount"
      );

    if (countElement) {

      countElement.innerText =
        `${count} items added`;
    }


    const priceElement =
      document.getElementById(
        "barGrandPrice"
      );

    if (priceElement) {

      priceElement.innerText =
        `₹${sum}`;
    }

  } else {

    bar.classList.add(
      "hidden"
    );
  }
}


function handleSearch(
  val
) {

  currentSearch =
    String(val || "")
      .toLowerCase()
      .trim();


  filterAndRender();
}

function submitProductSearch(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const input = document.getElementById("searchInputMobile");
  handleSearch(input?.value || "");
  document.getElementById("productsGrid")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startVoiceSearch(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice search is not supported in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.start();
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById("searchInputMobile");
    if (input) input.value = transcript;
    handleSearch(transcript);
  };
  recognition.onerror = () => {
    alert("Voice search could not capture audio. Please type your search.");
  };
}

const accountTranslations = {
  en: {
    myAccount: "My Account", savedAddress: "Saved Address", manageLocations: "Manage family / other locations",
    paymentModes: "Payment Modes", paymentDescription: "UPI, QR & Cash on Delivery", preferences: "Preferences",
    language: "Language", pastOrders: "Past Orders & Tracking", accountSecurity: "Account Security",
    securityDescription: "Secure OTP-based passwordless authentication active.", searchPlaceholder: "Search groceries & essentials...",
    orders: "Orders", account: "Account", deliveryLocation: "Delivery Location", exploreCategories: "Explore Categories",
    cartOrders: "Cart/Orders"
  },
  hi: {
    myAccount: "मेरा खाता", savedAddress: "सहेजा हुआ पता", manageLocations: "परिवार या अन्य स्थान प्रबंधित करें",
    paymentModes: "भुगतान के तरीके", paymentDescription: "UPI, QR और कैश ऑन डिलीवरी", preferences: "प्राथमिकताएं",
    language: "भाषा", pastOrders: "पिछले ऑर्डर और ट्रैकिंग", accountSecurity: "खाता सुरक्षा",
    securityDescription: "सुरक्षित OTP पासवर्ड-रहित प्रमाणीकरण सक्रिय है।", searchPlaceholder: "किराना और जरूरी सामान खोजें...",
    orders: "ऑर्डर", account: "खाता", deliveryLocation: "डिलीवरी स्थान", exploreCategories: "श्रेणियां देखें", cartOrders: "कार्ट/ऑर्डर"
  },
  te: {
    myAccount: "నా ఖాతా", savedAddress: "సేవ్ చేసిన చిరునామా", manageLocations: "కుటుంబం / ఇతర ప్రదేశాలను నిర్వహించండి",
    paymentModes: "చెల్లింపు విధానాలు", paymentDescription: "UPI, QR మరియు క్యాష్ ఆన్ డెలివరీ", preferences: "ప్రాధాన్యతలు",
    language: "భాష", pastOrders: "గత ఆర్డర్లు & ట్రాకింగ్", accountSecurity: "ఖాతా భద్రత",
    securityDescription: "సురక్షిత OTP పాస్‌వర్డ్ రహిత ధృవీకరణ యాక్టివ్‌గా ఉంది.", searchPlaceholder: "కిరాణా మరియు అవసరమైన వస్తువులను వెతకండి...",
    orders: "ఆర్డర్లు", account: "ఖాతా", deliveryLocation: "డెలివరీ స్థలం", exploreCategories: "వర్గాలను చూడండి", cartOrders: "కార్ట్/ఆర్డర్లు"
  }
};

function applyThemeMode(isDark) {
  const root = document.body;
  const btn = document.getElementById("themeToggleBtn");
  root.classList.toggle("theme-dark", isDark);
  root.classList.toggle("bg-slate-900", isDark);
  root.classList.toggle("text-white", isDark);
  root.classList.toggle("text-slate-900", !isDark);
  if (btn) btn.textContent = isDark ? "☀️ Light" : "🌙 Dark";
}

function toggleThemeMode() {
  const isDark = !document.body.classList.contains("theme-dark");
  localStorage.setItem("myshopzy_theme", isDark ? "dark" : "light");
  applyThemeMode(isDark);
}

function setUserLanguage(value) {
  const language = accountTranslations[value] ? value : "en";
  localStorage.setItem("myshopzy_language", language);
  const translations = accountTranslations[language];
  document.querySelectorAll("[data-i18n]").forEach(element => {
    const key = element.dataset.i18n;
    if (translations[key]) element.textContent = translations[key];
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(element => {
    const key = element.dataset.i18nPlaceholder;
    if (translations[key]) element.placeholder = translations[key];
  });
  document.documentElement.lang = language;
  const select = document.getElementById("accountLanguageSelect");
  if (select) select.value = language;
}

function openProductDetailModal(product) {
  const modal = document.getElementById("productDetailModal");
  if (!modal || !product) return;

  const detailImg = document.getElementById("detailImg");
  const detailCategory = document.getElementById("detailCategory");
  const detailName = document.getElementById("detailName");
  const detailUnit = document.getElementById("detailUnit");
  const detailDesc = document.getElementById("detailDesc");
  const detailPrice = document.getElementById("detailPrice");
  const detailActionBtn = document.getElementById("detailActionBtn");

  if (detailImg) detailImg.src = product.image_url || "";
  if (detailCategory) detailCategory.innerText = product.category || "Product";
  if (detailName) detailName.innerText = product.name || "Product";
  if (detailUnit) detailUnit.innerText = `${product.qty_value || 1} ${product.qty_unit || "pc"}`;
  if (detailDesc) detailDesc.innerText = product.desc || "Fresh product delivered by MyShopzy.";
  if (detailPrice) detailPrice.innerText = `₹${Number(product.price || 0)}`;
  if (detailActionBtn) {
    detailActionBtn.innerHTML = `
      <button onclick="modifyCart('${escapeAttribute(product.id)}', 1); closeProductDetailModal();" class="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase">Add to cart</button>
    `;
  }

  modal.classList.remove("hidden");
}

function closeProductDetailModal() {
  const modal = document.getElementById("productDetailModal");
  if (modal) modal.classList.add("hidden");
}


// ==========================================
// 29. CART TOTALS
// ==========================================

function calculateCartTotals() {

  let sub = 0;


  Object.keys(
    cartState
  ).forEach(
    id => {

      const item =
        liveCatalog.find(
          p => p.id == id
        );


      if (item) {

        sub +=
          getProductPrice(item) *
          cartState[id];
      }
    }
  );


  const deliveryFee =
    sub >= 199
      ? 0
      : 25;

  const offerDiscount = sub >= 499 ? 50 : 0;

  const grandTotal =
    sub > 0
      ? Math.max(0, sub + deliveryFee + 4 + riderTipAmount - offerDiscount)
      : 0;


  return {
    sub,
    deliveryFee,
    offerDiscount,
    riderTip: riderTipAmount,
    grandTotal
  };
}

function setRiderTip(amount) {
  riderTipAmount = Math.max(0, Number(amount) || 0);
  updateRiderTipButtons();
  renderCheckoutSummary();
}

function updateRiderTipButtons() {
  document.querySelectorAll(".rider-tip-option").forEach(button => {
    const selected = Number(button.dataset.tip) === riderTipAmount;
    button.classList.toggle("border-2", selected);
    button.classList.toggle("border-emerald-600", selected);
    button.classList.toggle("bg-emerald-50", selected);
    button.classList.toggle("text-emerald-700", selected);
    button.classList.toggle("border", !selected);
    button.classList.toggle("border-slate-200", !selected);
    button.classList.toggle("bg-white", !selected);
    button.classList.toggle("text-slate-700", !selected);
  });
}


// ==========================================
// 30. OPEN CHECKOUT
// ==========================================

function openCart() {
  if (!Object.keys(cartState).some(id => liveCatalog.some(product => String(product.id) === String(id)))) return;
  renderCartScreen();
  document.getElementById("bottomCartBar")?.classList.add("hidden");
  document.getElementById("cartScreenModal")?.classList.remove("hidden");
}

function closeCartScreen() {
  document.getElementById("cartScreenModal")?.classList.add("hidden");
  syncCartBar();
}

function clearCartScreen() {
  cartState = {};
  filterAndRender();
  syncCartBar();
  renderCartScreen();
}

function renderCartScreen() {
  const container = document.getElementById("cartScreenItems");
  if (!container) return;
  const entries = Object.entries(cartState).filter(([id, quantity]) => quantity > 0
    && liveCatalog.some(product => String(product.id) === String(id)));
  const itemCount = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  const count = document.getElementById("cartScreenCount");
  if (count) count.textContent = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const hasRestaurantItems = entries.some(([id]) => {
    const product = liveCatalog.find(item => String(item.id) === String(id));
    return product?.is_restaurant_product || String(product?.category || "").toLowerCase() === "restaurants";
  });
  const deliveryPromise = document.getElementById("cartScreenDeliveryPromise");
  if (deliveryPromise) deliveryPromise.textContent = hasRestaurantItems
    ? "Estimated delivery: 30–45 minutes"
    : "Delivery within 30 minutes";
  container.innerHTML = entries.length ? entries.map(([id, quantity]) => {
    const product = liveCatalog.find(item => String(item.id) === String(id));
    const unit = product.qty_value ? `${product.qty_value} ${product.qty_unit || "g"}` : product.qty_unit || product.unit_label || product.unit || "1 pc";
    const image = product.image_url || product.image || "../assets/audio/categories/logo.png";
    const lineTotal = getProductPrice(product) * quantity;
    return `<article class="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name || "Product")}" class="h-20 w-20 shrink-0 rounded-lg bg-slate-50 object-contain p-1" onerror="this.onerror=null;this.src='../assets/audio/categories/logo.png';this.classList.add('p-3')">
      <div class="min-w-0 flex-1"><h3 class="truncate text-sm font-extrabold text-slate-900">${escapeHtml(product.name || "Product")}</h3>
        <p class="mt-1 text-[11px] text-slate-500">${escapeHtml(unit)}</p><strong class="mt-1 block text-sm font-black text-slate-900">₹${lineTotal.toLocaleString("en-IN")}</strong>
      </div>
      <div class="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 text-sm font-black text-emerald-800">
        <button type="button" onclick="modifyCart('${escapeAttribute(id)}', -1)" class="grid h-7 w-7 place-items-center rounded-md hover:bg-white" aria-label="Remove one ${escapeAttribute(product.name || "product")}">−</button>
        <span class="min-w-3 text-center">${quantity}</span>
        <button type="button" onclick="modifyCart('${escapeAttribute(id)}', 1)" class="grid h-7 w-7 place-items-center rounded-md hover:bg-white" aria-label="Add one ${escapeAttribute(product.name || "product")}">+</button>
      </div>
    </article>`;
  }).join("") : '<p class="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm font-semibold text-slate-500">Your cart is empty.</p>';

  const totals = calculateCartTotals();
  const subtotal = document.getElementById("cartScreenSubtotal");
  const delivery = document.getElementById("cartScreenDelivery");
  const total = document.getElementById("cartScreenTotal");
  const offerRow = document.getElementById("cartScreenOfferRow");
  const offerDiscount = document.getElementById("cartScreenOfferDiscount");
  if (subtotal) subtotal.textContent = `₹${totals.sub.toLocaleString("en-IN")}`;
  if (delivery) delivery.textContent = totals.deliveryFee ? `₹${totals.deliveryFee}` : "FREE";
  if (total) total.textContent = `₹${totals.grandTotal.toLocaleString("en-IN")}`;
  if (offerRow) offerRow.classList.toggle("hidden", totals.offerDiscount === 0);
  if (offerRow) offerRow.classList.toggle("flex", totals.offerDiscount > 0);
  if (offerDiscount) offerDiscount.textContent = `-₹${totals.offerDiscount}`;
  const proceed = document.getElementById("cartScreenProceedButton");
  if (proceed) proceed.disabled = entries.length === 0;
}

function openCheckout() {

  if (
    !checkStoreWorkingHours()
  ) {

    alert(
      "Store is closed (7 AM - 10 PM IST)"
    );

    return;
  }


  // Must be logged in
  if (
    !getCurrentCustomerPhone()
  ) {

    alert(
      "Please login before placing an order."
    );

    openLoginModal();

    return;
  }


  closeAllModals();
  document.getElementById("cartScreenModal")?.classList.add("hidden");


  const bottomBar =
    document.getElementById(
      "bottomCartBar"
    );

  if (bottomBar) {

    bottomBar.classList.add(
      "hidden"
    );
  }


  const modal =
    document.getElementById(
      "checkoutModal"
    );

  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }


  populateCheckoutAddressDropdown();

  renderCheckoutSummary();


  // Keep current HTML default as QR
  // unless customer previously selected
  // something.
  setPaymentMethod(
    selectedPaymentMode
  );
}


// ==========================================
// 31. CLOSE CHECKOUT
// ==========================================

function closeCheckout() {

  const modal =
    document.getElementById(
      "checkoutModal"
    );

  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }


  syncCartBar();
}


// ==========================================
// 32. CHECKOUT SUMMARY
// ==========================================

function renderCheckoutSummary() {

  const container =
    document.getElementById(
      "cartItemsContainer"
    );


  if (!container) return;


  container.innerHTML =
    "";


  Object.keys(
    cartState
  ).forEach(
    id => {

      const item =
        liveCatalog.find(
          p => p.id == id
        );


      if (item) {

        const qty =
          cartState[id];


        container.innerHTML += `
          <div class="flex justify-between text-xs">

            <span>
              ${qty}x
              ${escapeHtml(item.name)}
            </span>

            <span class="font-bold">
              ₹${getProductPrice(item) * qty}
            </span>

          </div>
        `;
      }
    }
  );


  const {
    sub,
    deliveryFee,
    offerDiscount,
    riderTip,
    grandTotal
  } =
    calculateCartTotals();


  const banner =
    document.getElementById(
      "freeDeliveryBanner"
    );


  if (banner) {

    if (sub >= 199) {

      banner.innerText =
        "🎉 You unlocked FREE DELIVERY!";

      banner.className =
        "p-2 bg-emerald-50 text-emerald-800 rounded-xl font-black text-center text-[11px]";

    } else {

      const diff =
        199 - sub;

      banner.innerText =
        `Add ₹${diff} more to get FREE DELIVERY`;

      banner.className =
        "p-2 bg-amber-50 text-amber-800 rounded-xl font-black text-center text-[11px]";
    }
  }


  const subtotalElement =
    document.getElementById(
      "billSubtotal"
    );

  if (subtotalElement) {

    subtotalElement.innerText =
      `₹${sub}`;
  }


  const deliveryElement =
    document.getElementById(
      "billDeliveryFee"
    );

  if (deliveryElement) {

    deliveryElement.innerText =
      deliveryFee === 0
        ? "FREE"
        : `₹${deliveryFee}`;
  }


  const finalElement =
    document.getElementById(
      "billFinal"
    );

  if (finalElement) {

    finalElement.innerText =
      `₹${grandTotal}`;
  }

  const riderTipElement = document.getElementById("billRiderTip");
  if (riderTipElement) riderTipElement.innerText = `₹${riderTip}`;
  const offerDiscountElement = document.getElementById("billOfferDiscount");
  if (offerDiscountElement) offerDiscountElement.innerText = `-₹${offerDiscount}`;

  updateRiderTipButtons();
}


// ==========================================
// 33. PAYMENT METHOD
// ==========================================

let selectedPaymentMode =
  "UPI_QR";


function setPaymentMethod(
  mode
) {

  selectedPaymentMode =
    mode;


  // Actual IDs from index.html
  const upiAppsButton =
    document.getElementById(
      "btnMethodApps"
    );

  const qrButton =
    document.getElementById(
      "btnMethodQR"
    );

  const codButton =
    document.getElementById(
      "btnMethodCOD"
    );


  const buttons = [
    upiAppsButton,
    qrButton,
    codButton
  ];


  // Reset
  buttons.forEach(
    button => {

      if (!button) return;


      button.classList.remove(
        "border-emerald-600",
        "border-2",
        "bg-emerald-50/50",
        "bg-emerald-50/30",
        "ring-2",
        "ring-emerald-500",
        "text-emerald-700"
      );


      button.classList.add(
        "border",
        "border-slate-200",
        "bg-white"
      );
    }
  );


  let selectedButton =
    null;


  if (
    mode === "UPI_APPS"
  ) {

    selectedButton =
      upiAppsButton;

  } else if (
    mode === "UPI_QR"
  ) {

    selectedButton =
      qrButton;

  } else if (
    mode === "COD"
  ) {

    selectedButton =
      codButton;
  }


  if (selectedButton) {

    selectedButton.classList.remove(
      "border-slate-200",
      "bg-white"
    );


    selectedButton.classList.add(
      "border-2",
      "border-emerald-600",
      "bg-emerald-50/50",
      "ring-2",
      "ring-emerald-500",
      "text-emerald-700"
    );
  }


  // Payment boxes
  const appsBox =
    document.getElementById(
      "upiAppsBox"
    );

  const qrBox =
    document.getElementById(
      "upiQrBox"
    );

  const codBox =
    document.getElementById(
      "codNoticeBox"
    );


  if (appsBox) {

    appsBox.classList.add(
      "hidden"
    );
  }


  if (qrBox) {

    qrBox.classList.add(
      "hidden"
    );
  }


  if (codBox) {

    codBox.classList.add(
      "hidden"
    );
  }


  // UPI Apps
  if (
    mode === "UPI_APPS"
  ) {

    if (appsBox) {

      appsBox.classList.remove(
        "hidden"
      );
    }
  }


  // QR
  if (
    mode === "UPI_QR"
  ) {

    if (qrBox) {

      qrBox.classList.remove(
        "hidden"
      );
    }

    renderPaymentQR();
  }


  // COD
  if (
    mode === "COD"
  ) {

    if (codBox) {

      codBox.classList.remove(
        "hidden"
      );
    }
  }
}


// ==========================================
// 34. UPI QR
// ==========================================

function renderPaymentQR() {
  const canvas =
    document.getElementById(
      "qrcodeCanvas"
    );


  if (!canvas) return;


  canvas.innerHTML =
    "";
  const message = document.createElement("p");
  message.className = "max-w-40 py-5 text-center text-[10px] font-bold text-slate-500";
  message.textContent = "Online QR payment is not available until gateway setup.";
  canvas.appendChild(message);
}


// ==========================================
// 35. DIRECT UPI PAYMENT
// ==========================================

function triggerDirectUpiPay(
  appName
) {
  alert(
    `Online payments are not available yet. ${appName} payments will remain pending until gateway confirmation.`
  );
}


// ==========================================
// 36. PROCESS PAYMENT / ORDER
// ==========================================

async function processPaymentFlow() {

  // Must be logged in
  const customerPhone =
    getCurrentCustomerPhone();


  if (!customerPhone) {

    alert(
      "Please login before placing an order."
    );

    openLoginModal();

    return;
  }

  if (!getCustomerAccessToken()) {
    alert("A secure customer session is required to place orders.");
    return;
  }


  const select =
    document.getElementById(
      "checkoutAddressSelect"
    );


  if (!select) {

    alert(
      "Address selector not found."
    );

    return;
  }


  const selectIdx =
    select.value;


  if (
    selectIdx === ""
  ) {

    alert(
      "Please select a delivery address!"
    );

    return;
  }


  const chosenAddr =
    selectIdx === "map-pin"
      ? getSelectedMapDeliveryAddress()
      : savedAddresses[Number(selectIdx)];


  if (!chosenAddr) {

    alert(
      "Selected address not found."
    );

    return;
  }


  // Show loading
  const overlay =
    document.getElementById(
      "paymentOverlay"
    );


  if (overlay) {

    overlay.classList.remove(
      "hidden"
    );
  }


  setTimeout(
    () => {

      finalizeOrderAndLaunch(
        chosenAddr
      );

    },
    600
  );
}


// ==========================================
// 37. FINALIZE ORDER
// ==========================================

async function finalizeOrderAndLaunch(
  chosenAddr
) {

  const overlay =
    document.getElementById(
      "paymentOverlay"
    );


  if (overlay) {

    overlay.classList.add(
      "hidden"
    );
  }


  const customerPhone =
    getCurrentCustomerPhone();


  if (!customerPhone) {

    alert(
      "Customer session expired. Please login again."
    );

    openLoginModal();

    return;
  }


  const riderTip = riderTipAmount;
  let orderItems = [];


  Object.keys(
    cartState
  ).forEach(
    id => {

      const item =
        liveCatalog.find(
          p => p.id == id
        );


      if (!item) return;


      orderItems.push({ id: item.id, quantity: cartState[id] });
    }
  );


  if (
    orderItems.length === 0
  ) {

    alert(
      "No valid products in cart."
    );

    return;
  }


  const submittedPaymentMethod = selectedPaymentMode;
  let orderId;
  let paymentStatus = "PENDING";
  try {
    const result = await customerOrderApiRequest("", {
      method: "POST",
      body: JSON.stringify({
        items: orderItems.map(item => {
          const product = liveCatalog.find(entry => String(entry.id) === String(item.id));
          return {
            product_id: item.id,
            variant_id: item.variant_id || product?.variant_id || product?.default_variant_id || null,
            quantity: item.quantity,
            selected_weight: product && supportsWeightOptions(product) ? getSelectedProductWeight(product) : null
          };
        }),
        ...(chosenAddr.postgresAddress ? { address_id: chosenAddr.id } : {}),
        address: buildCustomerOrderAddress(chosenAddr),
        payment_method: submittedPaymentMethod,
        rider_tip: riderTip
      })
    });
    orderId = result.id || result.order_number;
    if (submittedPaymentMethod !== "COD" && result.id) {
      try {
        const payment = await customerOrderApiRequest(`/${encodeURIComponent(result.id)}/payment/initialize`, { method: "POST" });
        paymentStatus = payment.status || "PENDING";
      } catch (error) {
        console.error("Backend payment initialization is unavailable:", error.message);
      }
    }
  } catch (error) {
    console.error("PostgreSQL order creation failed:", error);
    alert(`Order was not placed: ${error.message}`);
    return;
  }


  // IMPORTANT:
  // Do NOT change customer account to
  // chosenAddr.mobile.
  //
  activeCustomerSession = {
    phone:
      customerPhone
  };


  localStorage.setItem(
    "quickdash_customer",
    JSON.stringify(
      activeCustomerSession
    )
  );


  // Reload this customer's addresses
  savedAddresses =
    loadCustomerAddresses();


  syncCustomerAuthUI();

  syncAccountDashboard();


  // Clear cart
  cartState = {};
  riderTipAmount = 0;
  updateRiderTipButtons();


  filterAndRender();

  syncCartBar();


  const checkoutModal =
    document.getElementById(
      "checkoutModal"
    );


  if (checkoutModal) {

    checkoutModal.classList.add(
      "hidden"
    );
  }


  const paymentMessage = submittedPaymentMethod === "COD"
    ? "Pay on delivery."
    : ["SUCCESS", "SUCCESSFUL"].includes(paymentStatus)
      ? "Payment confirmed by the backend."
      : "Online payment is pending gateway confirmation; no payment is confirmed.";
  alert(`Order placed (${orderId}). ${paymentMessage}`);

  try {
    CUSTOMER_ORDER_PLACED_SOUND.currentTime = 0;
    CUSTOMER_ORDER_PLACED_SOUND.play().catch(() => {});
  } catch (error) {
    console.warn("Order placed sound could not play:", error);
  }


  toggleOrdersView();
}


// ==========================================
// 38. CUSTOMER ACCOUNT
// ==========================================

function getCustomerDisplayName() {

  const phone =
    getCurrentCustomerPhone();


  if (!phone) {

    return "MyShopzy Customer";
  }


  const matched =
    savedAddresses.find(
      address =>
        normalizePhone(
          address.mobile
        ) === phone
    );


  if (
    matched &&
    matched.fullName
  ) {

    return matched.fullName;
  }


  return "MyShopzy Customer";
}


function customerProfilePhotoKey(phone) {
  return `myshopzy_profile_photo_${normalizePhone(phone)}`;
}

function renderCustomerProfilePhoto(photoUrl, displayName = "") {
  const image = document.getElementById("accountAvatarImage");
  const fallback = document.getElementById("accountAvatarFallback");
  if (!image || !fallback) return;

  fallback.textContent = displayName.trim().charAt(0).toUpperCase() || "👤";
  image.onerror = () => {
    image.classList.add("hidden");
    image.removeAttribute("src");
    fallback.classList.remove("hidden");
  };
  if (photoUrl) {
    image.src = photoUrl;
    image.classList.remove("hidden");
    fallback.classList.add("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    fallback.classList.remove("hidden");
  }
}

function saveCustomerProfilePhoto(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Choose an image file for your profile photo.");
    input.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert("Choose an image smaller than 10 MB.");
    input.value = "";
    return;
  }

  const phone = getCurrentCustomerPhone();
  if (!phone) {
    alert("Log in before adding a profile photo.");
    input.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => alert("Unable to read that image. Please choose another one.");
  reader.onload = () => {
    const sourceImage = new Image();
    sourceImage.onerror = () => alert("That image format is not supported. Please choose another one.");
    sourceImage.onload = () => {
      const scale = Math.min(1, 512 / Math.max(sourceImage.width, sourceImage.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceImage.width * scale));
      canvas.height = Math.max(1, Math.round(sourceImage.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        alert("Unable to prepare that image. Please try another one.");
        input.value = "";
        return;
      }

      context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
      const photoUrl = canvas.toDataURL("image/jpeg", 0.82);
      try {
        localStorage.setItem(customerProfilePhotoKey(phone), photoUrl);
        renderCustomerProfilePhoto(photoUrl, document.getElementById("accNameDisplay")?.textContent || "");
      } catch (error) {
        alert("Unable to save the photo on this device. Try a smaller image.");
      }
      input.value = "";
    };
    sourceImage.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

async function syncAccountDashboard() {

  const phone = getCurrentCustomerPhone();
  const token = getCustomerAccessToken();

  const phoneDisp = document.getElementById("accPhoneDisplay");
  const nameDisp = document.getElementById("accNameDisplay");
  const emailDisp = document.getElementById("accEmailDisplay");
  const photoUrl = phone ? localStorage.getItem(customerProfilePhotoKey(phone)) || "" : "";
  if (phoneDisp) phoneDisp.innerText = "Not logged in";
  if (nameDisp) nameDisp.innerText = "Not logged in";
  if (emailDisp) emailDisp.innerText = "Not logged in";
  renderCustomerProfilePhoto("");

  if (!phone || !token) {
    return;
  }

  let name = "Not logged in";
  let email = "Not logged in";

  try {
    const result = await customerAuthApiRequest("/me");
    const authenticatedPhone = normalizePhone(result.user?.phone_e164);
    if (authenticatedPhone === phone) {
      const actualName = getSafeCustomerName(result.user?.display_name);
      const actualEmail = typeof result.user?.email === "string" ? result.user.email.trim() : "";
      name = actualName || "Not logged in";
      email = actualEmail || "Not logged in";
      if (phoneDisp) phoneDisp.innerText = `+91 ${authenticatedPhone}`;

      const storage = localStorage.getItem("myshopzy_user_access_token") ? localStorage : sessionStorage;
      storage.setItem(`myshopzy_customer_${phone}`, JSON.stringify({
        name,
        email: actualEmail
      }));
      renderCustomerProfilePhoto(photoUrl, name);
    } else {
      name = "Not logged in";
      email = "Not logged in";
    }
  } catch (error) {
    console.warn("Customer account profile refresh failed:", error.message || error);
    name = "Not logged in";
    email = "Not logged in";
  }

  if (nameDisp) nameDisp.innerText = name;
  if (emailDisp) emailDisp.innerText = email;
  if (name === "Not logged in" && phoneDisp) phoneDisp.innerText = "Not logged in";
}


// ==========================================
// 39. AUTH UI
// ==========================================

function syncCustomerAuthUI() {

  const loginBtn =
    document.getElementById(
      "loginBtn"
    );


  const userChip =
    document.getElementById(
      "userChip"
    );
  const logoutSection = document.getElementById("customerLogoutSection");


  const phoneDisplay =
    document.getElementById(
      "userPhoneDisplay"
    );


  const phone =
    getCurrentCustomerPhone();
  const authenticated = Boolean(phone && getCustomerAccessToken());

  if (logoutSection) logoutSection.classList.toggle("hidden", !authenticated);


  if (phone) {

    if (loginBtn) {

      loginBtn.classList.add(
        "hidden"
      );
    }


    if (userChip) {

      userChip.classList.remove(
        "hidden"
      );
    }


    if (phoneDisplay) {

      phoneDisplay.innerText =
        phone.slice(-4);
    }

  } else {

    if (loginBtn) {

      loginBtn.classList.remove(
        "hidden"
      );
    }


    if (userChip) {

      userChip.classList.add(
        "hidden"
      );
    }
  }
}

async function syncCustomerGreetingUI() {
  const greetingName = document.getElementById("customerGreetingName");
  if (!greetingName) return;

  const phone = getCurrentCustomerPhone();
  let displayName = "there";
  if (phone && getCustomerAccessToken()) {
    try {
      const result = await customerAuthApiRequest("/me");
      if (normalizePhone(result.user?.phone_e164) === phone) {
        const authName = getSafeCustomerName(result.user?.display_name);
        if (authName) {
          displayName = authName;
        }
      }
    } catch {}
  }
  greetingName.innerText = displayName;
}

function getSafeCustomerName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || /^(?:user|customer|guest|myshopzy customer|unknown)$/i.test(name)) return "";
  if (/\b(?:restaurant|restro|hotel|cafe|shop|store|partner|mart|supermarket)\b/i.test(name)) return "";
  return name;
}

async function refreshAuthenticatedCustomerProfile() {
  const phone = getCurrentCustomerPhone();
  if (!phone || !getCustomerAccessToken()) return;
  try {
    const result = await customerAuthApiRequest("/me");
    if (normalizePhone(result.user?.phone_e164) !== phone) return;
    const storage = localStorage.getItem("myshopzy_user_access_token") ? localStorage : sessionStorage;
    const nextName = getSafeCustomerName(result.user?.display_name) || "MyShopzy Customer";
    const nextEmail = typeof result.user?.email === "string" ? result.user.email.trim() : "";
    storage.setItem(`myshopzy_customer_${phone}`, JSON.stringify({
      name: nextName,
      email: nextEmail
    }));
    syncCustomerGreetingUI();
    syncAccountDashboard();
  } catch {}
}


// ==========================================
// 40. LOGIN
// ==========================================

function openLoginModal() {
  closeAllModals();
  const modal = document.getElementById("customerLoginModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("customer-auth-active");
  setCustomerAuthState("LOGIN");
  setCustomerAuthError("customerLoginError", "");
  setCustomerAuthError("customerSignupError", "");
  document.getElementById("loginMobileInput")?.focus();
}

function closeLoginModal() {
  document.getElementById("customerLoginModal")?.classList.add("hidden");
  document.body.classList.remove("customer-auth-active");
  setCustomerDevelopmentOtp(null);
  clearInterval(customerOtpCountdownTimer);
  customerOtpCountdownTimer = null;
  pendingCustomerPhone = "";
  customerAuthState = "AUTHENTICATED";
}

function updateCustomerPhoneValidation() {
  ["loginMobileInput", "signupMobileInput"].forEach(inputId => {
    const input = document.getElementById(inputId);
    if (!input) return;
    const phone = normalizePhone(input.value);
    if (input.value !== phone) input.value = phone;
    const valid = /^[6-9]\d{9}$/.test(phone);
    if (inputId === "loginMobileInput") {
      const button = document.getElementById("customerLoginOtpButton");
      if (button) button.disabled = !valid || customerAuthRequestPending;
      const error = document.getElementById("customerPhoneError");
      if (error) error.textContent = phone.length === 10 && !valid
        ? "Enter a valid 10-digit Indian mobile number."
        : "";
    } else {
      const button = document.getElementById("customerSignupSubmitButton");
      if (button) button.disabled = !valid || customerAuthRequestPending;
      if (phone.length === 10 && !valid) {
        setCustomerAuthError("customerSignupError", "Enter a valid 10-digit Indian mobile number.");
      }
    }
  });
}

function setCustomerAuthState(state) {
  const visibleScreen = {
    LOGIN: "loginStepPhone",
    SIGNUP: "signupStep",
    OTP_LOGIN: "loginStepOtp",
    OTP_SIGNUP: "loginStepOtp"
  };
  customerAuthState = state;
  ["loginStepPhone", "signupStep", "loginStepOtp"].forEach(screenId => {
    const screen = document.getElementById(screenId);
    if (screen) screen.classList.toggle("hidden", screenId !== visibleScreen[state]);
  });
  if (state === "AUTHENTICATED") closeLoginModal();
}

function openCustomerSignup() {
  setCustomerAuthError("customerLoginError", "");
  setCustomerAuthError("customerSignupError", "");
  pendingCustomerProfile = null;
  pendingCustomerPhone = "";
  document.getElementById("customerSignupForm")?.reset();
  setCustomerAuthState("SIGNUP");
  document.getElementById("signupNameInput")?.focus();
}

function toggleCustomerPasswordVisibility() {
  const password = document.getElementById("customerLoginPassword");
  const toggle = document.getElementById("customerPasswordVisibility");
  if (!password || !toggle) return;
  const shouldShow = password.type === "password";
  password.type = shouldShow ? "text" : "password";
  toggle.textContent = shouldShow ? "Hide" : "Show";
  toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
  toggle.setAttribute("aria-pressed", String(shouldShow));
}

function setCustomerAuthError(elementId, message) {
  const error = document.getElementById(elementId);
  if (error) error.textContent = message || "";
}

function setCustomerDevelopmentOtp(response) {
  const container = document.getElementById("customerDevelopmentOtp");
  const code = typeof response?.development_otp === "string" && /^\d{6}$/.test(response.development_otp)
    ? response.development_otp
    : "";
  if (!container) return;
  container.textContent = code ? `Development OTP: ${code}` : "";
  container.classList.toggle("hidden", !code);
}

function customerAuthErrorMessage(error, fallback) {
  if (error instanceof TypeError || error?.message === "Failed to fetch") {
    return "Unable to reach MyShopzy authentication. Check your connection and try again.";
  }
  return error?.message || fallback;
}

function completeCustomerAuthentication(result, phone, profile = {}) {
  if (typeof result.access_token !== "string" || !result.access_token || !result.user?.id) {
    throw new Error("The authentication service did not return a customer session.");
  }

  const rememberLogin = document.getElementById("rememberCustomerLogin")?.checked !== false;
  const tokenStorage = rememberLogin ? localStorage : sessionStorage;
  const otherStorage = rememberLogin ? sessionStorage : localStorage;
  localStorage.removeItem("user_access_token");
  sessionStorage.removeItem("user_access_token");
  tokenStorage.setItem("myshopzy_user_access_token", result.access_token);
  otherStorage.removeItem("myshopzy_user_access_token");
  activeCustomerSession = { phone, userId: result.user.id };
  tokenStorage.setItem("quickdash_customer", JSON.stringify(activeCustomerSession));
  otherStorage.removeItem("quickdash_customer");
  tokenStorage.setItem(`myshopzy_customer_${phone}`, JSON.stringify({
    name: getSafeCustomerName(result.user.display_name) || getSafeCustomerName(profile.name),
    email: result.user.email || profile.email || "",
    defaultLocation: profile.location || ""
  }));
  pendingCustomerProfile = null;
  document.getElementById("signupPasswordInput").value = "";
  document.getElementById("signupConfirmPasswordInput").value = "";

  savedAddresses = loadCustomerAddresses();
  syncCustomerAddressesFromCloud();
  closeLoginModal();
  syncCustomerAuthUI();
  syncCustomerGreetingUI();
  syncAccountDashboard();
  populateCheckoutAddressDropdown();
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  clearInterval(customerOtpCountdownTimer);
  customerOtpCountdownTimer = null;
}

async function loginCustomerWithPassword() {
  if (customerAuthState !== "LOGIN") return;
  if (customerAuthRequestPending) return;
  const phone = normalizePhone(document.getElementById("loginMobileInput")?.value);
  const passwordInput = document.getElementById("customerLoginPassword");
  const password = passwordInput?.value || "";
  if (!/^[6-9]\d{9}$/.test(phone)) {
    setCustomerAuthError("customerLoginError", "Enter a valid 10-digit Indian mobile number.");
    return;
  }
  if (!password) {
    setCustomerAuthError("customerLoginError", "Enter your password.");
    return;
  }

  customerAuthRequestPending = true;
  const loginButton = document.getElementById("customerPasswordLoginButton");
  if (loginButton) {
    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
  }
  updateCustomerPhoneValidation();
  setCustomerAuthError("customerLoginError", "");
  try {
    const result = await customerAuthApiRequest("/password/login", {
      method: "POST",
      body: JSON.stringify({ phone: `+91${phone}`, password })
    });
    completeCustomerAuthentication(result, phone);
  } catch (error) {
    setCustomerAuthError("customerLoginError", customerAuthErrorMessage(error, "Unable to sign in. Please try again."));
  } finally {
    if (passwordInput) passwordInput.value = "";
    customerAuthRequestPending = false;
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Login";
    }
    updateCustomerPhoneValidation();
  }
}

function getCustomerOtpValue() {
  return Array.from(document.querySelectorAll(".customer-otp-input"))
    .map(input => input.value)
    .join("");
}

function clearCustomerOtpFields() {
  document.querySelectorAll(".customer-otp-input").forEach(input => { input.value = ""; });
  const verifyButton = document.getElementById("customerVerifyButton");
  if (verifyButton) verifyButton.disabled = true;
}

function startCustomerOtpCountdown() {
  clearInterval(customerOtpCountdownTimer);
  customerOtpSecondsRemaining = 30;
  const resendButton = document.getElementById("customerResendButton");
  if (resendButton) resendButton.disabled = true;
  const updateCountdown = () => {
    const countdown = document.getElementById("customerResendCountdown");
    if (countdown) countdown.textContent = `${customerOtpSecondsRemaining}s`;
    if (customerOtpSecondsRemaining <= 0) {
      clearInterval(customerOtpCountdownTimer);
      customerOtpCountdownTimer = null;
      if (resendButton) {
        resendButton.disabled = false;
        resendButton.innerHTML = "Resend SMS";
      }
      return;
    }
    customerOtpSecondsRemaining -= 1;
  };
  if (resendButton) resendButton.innerHTML = 'Resend SMS in <span id="customerResendCountdown">30s</span>';
  updateCountdown();
  customerOtpCountdownTimer = setInterval(updateCountdown, 1000);
}

function backToCustomerLogin() {
  clearInterval(customerOtpCountdownTimer);
  customerOtpCountdownTimer = null;
  setCustomerAuthError("customerOtpError", "");
  setCustomerDevelopmentOtp(null);
  if (customerAuthState === "OTP_SIGNUP") {
    setCustomerAuthState("SIGNUP");
    document.getElementById("signupMobileInput").value = pendingCustomerPhone.slice(-10);
    document.getElementById("signupNameInput")?.focus();
    return;
  }
  if (customerAuthState === "SIGNUP") {
    pendingCustomerProfile = null;
    document.getElementById("signupPasswordInput").value = "";
    document.getElementById("signupConfirmPasswordInput").value = "";
  }
  setCustomerAuthState("LOGIN");
  document.getElementById("loginMobileInput").value = pendingCustomerPhone.slice(-10);
  document.getElementById("loginMobileInput")?.focus();
}

function setupCustomerOtpInputs() {
  const inputs = Array.from(document.querySelectorAll(".customer-otp-input"));
  inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "");
      if (digits.length > 1) {
        Array.from(digits.slice(0, inputs.length - index)).forEach((digit, offset) => {
          inputs[index + offset].value = digit;
        });
        inputs[Math.min(index + digits.length, inputs.length - 1)].focus();
      } else {
        input.value = digits.slice(-1);
        if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
      }
      const verifyButton = document.getElementById("customerVerifyButton");
      if (verifyButton) verifyButton.disabled = getCustomerOtpValue().length !== 6;
      setCustomerAuthError("customerOtpError", "");
    });
    input.addEventListener("keydown", event => {
      if (event.key === "Backspace" && !input.value && index > 0) {
        inputs[index - 1].value = "";
        inputs[index - 1].focus();
        const verifyButton = document.getElementById("customerVerifyButton");
        if (verifyButton) verifyButton.disabled = true;
      }
      if (event.key === "ArrowLeft" && index > 0) inputs[index - 1].focus();
      if (event.key === "ArrowRight" && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener("paste", event => {
      const pastedDigits = event.clipboardData?.getData("text").replace(/\D/g, "").slice(0, 6);
      if (!pastedDigits) return;
      event.preventDefault();
      inputs.forEach((field, fieldIndex) => { field.value = pastedDigits[fieldIndex] || ""; });
      const focusIndex = Math.min(pastedDigits.length, inputs.length - 1);
      inputs[focusIndex].focus();
      const verifyButton = document.getElementById("customerVerifyButton");
      if (verifyButton) verifyButton.disabled = pastedDigits.length !== 6;
      setCustomerAuthError("customerOtpError", "");
    });
  });
}

async function requestCustomerOtp(phoneValue, purpose, registration = null) {
  if (customerAuthRequestPending) return false;
  const phone = normalizePhone(phoneValue);
  const errorId = purpose === "REGISTER" ? "customerSignupError" : "customerLoginError";
  if (!/^[6-9]\d{9}$/.test(phone)) {
    updateCustomerPhoneValidation();
    setCustomerAuthError(errorId, "Enter a valid 10-digit Indian mobile number.");
    return false;
  }
  if (purpose === "REGISTER" && (!registration?.display_name || !registration.email || !registration.password)) {
    setCustomerAuthError(errorId, "Complete all sign-up fields before continuing.");
    return false;
  }
  if (purpose !== "REGISTER") {
    pendingCustomerProfile = null;
  }
  const requestPath = purpose === "REGISTER" ? "/register" : "/otp/request";
  const requestBody = purpose === "REGISTER"
    ? { phone_e164: `+91${phone}`, ...registration }
    : { phone_e164: `+91${phone}` };
  const requestButton = document.getElementById(
    purpose === "REGISTER" ? "customerSignupSubmitButton" : "customerLoginOtpButton"
  );
  customerAuthRequestPending = true;
  pendingCustomerPhone = phone;
  if (requestButton) {
    requestButton.disabled = true;
    requestButton.textContent = "Requesting code...";
  }
  setCustomerAuthError(errorId, "");
  try {
    const result = await customerAuthApiRequest(requestPath, { method: "POST", body: JSON.stringify(requestBody) });
    if (purpose === "REGISTER") pendingCustomerProfile = { ...registration, location: "" };
    setCustomerAuthState(purpose === "REGISTER" ? "OTP_SIGNUP" : "OTP_LOGIN");
    setCustomerDevelopmentOtp(result);
    document.getElementById("customerOtpPhone").textContent = `+91 ${"•".repeat(6)}${phone.slice(-4)}`;
    setCustomerAuthError("customerOtpError", "");
    clearCustomerOtpFields();
    startCustomerOtpCountdown();
    document.querySelector(".customer-otp-input")?.focus();
    return true;
  } catch (error) {
    setCustomerAuthError(errorId, customerAuthErrorMessage(error, "Unable to request a verification code. Try again."));
    return false;
  } finally {
    customerAuthRequestPending = false;
    if (requestButton) {
      requestButton.textContent = purpose === "REGISTER" ? "Create Account" : "Login with OTP";
    }
    updateCustomerPhoneValidation();
  }
}

// ==========================================
// 41. SEND OTP
// ==========================================

async function sendCustomerLoginOtp() {
  if (customerAuthState !== "LOGIN" || customerAuthRequestPending) return;
  await requestCustomerOtp(document.getElementById("loginMobileInput")?.value, "LOGIN");
}

async function createCustomerAccount(event) {
  event?.preventDefault();
  if (customerAuthState !== "SIGNUP" || customerAuthRequestPending) return;
  const phone = normalizePhone(document.getElementById("signupMobileInput")?.value);
  const name = document.getElementById("signupNameInput")?.value.trim();
  const email = document.getElementById("signupEmailInput")?.value.trim();
  const password = document.getElementById("signupPasswordInput")?.value || "";
  const confirmPassword = document.getElementById("signupConfirmPasswordInput")?.value || "";
  if (!name || !email || !password || !confirmPassword) {
    setCustomerAuthError("customerSignupError", "Complete all sign-up fields before continuing.");
    return;
  }
  if (password.length < 6 || password !== confirmPassword) {
    setCustomerAuthError("customerSignupError", "Passwords must be at least 6 characters and match.");
    return;
  }
  await requestCustomerOtp(phone, "REGISTER", { display_name: name, email, password });
}

async function resendCustomerLoginOtp() {
  if (!new Set(["OTP_LOGIN", "OTP_SIGNUP"]).has(customerAuthState)
      || customerAuthRequestPending || customerOtpSecondsRemaining > 0) return;
  setCustomerAuthError("customerOtpError", "");
  customerAuthRequestPending = true;
  const resendButton = document.getElementById("customerResendButton");
  if (resendButton) {
    resendButton.disabled = true;
    resendButton.textContent = "Requesting...";
  }
  try {
    const phone = pendingCustomerPhone;
    const registrationFlow = customerAuthState === "OTP_SIGNUP";
    const path = registrationFlow ? "/register" : "/otp/request";
    let body = { phone_e164: `+91${phone}` };
    if (registrationFlow) {
      body = {
        ...body,
        display_name: pendingCustomerProfile?.name,
        email: pendingCustomerProfile?.email,
        password: pendingCustomerProfile?.password
      };
    }
    const result = await customerAuthApiRequest(path, { method: "POST", body: JSON.stringify(body) });
    setCustomerDevelopmentOtp(result);
    clearCustomerOtpFields();
    startCustomerOtpCountdown();
  } catch (error) {
    setCustomerAuthError("customerOtpError", customerAuthErrorMessage(error, "Unable to resend the verification code."));
    if (resendButton) {
      resendButton.disabled = false;
      resendButton.textContent = "Resend SMS";
    }
  } finally {
    customerAuthRequestPending = false;
  }
}


// ==========================================
// 42. VERIFY OTP
// ==========================================

async function verifyCustomerLoginOtp() {
  if (customerAuthRequestPending) return;
  if (!new Set(["OTP_LOGIN", "OTP_SIGNUP"]).has(customerAuthState)) return;
  const phone = pendingCustomerPhone;
  const purpose = customerAuthState === "OTP_SIGNUP" ? "REGISTER" : "LOGIN";
  const otp = getCustomerOtpValue();
  if (!/^[6-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(otp)) {
    setCustomerAuthError("customerOtpError", "Enter the complete 6-digit verification code.");
    return;
  }
  customerAuthRequestPending = true;
  const verifyButton = document.getElementById("customerVerifyButton");
  if (verifyButton) {
    verifyButton.disabled = true;
    verifyButton.textContent = "Verifying...";
  }
  setCustomerAuthError("customerOtpError", "");
  try {
    const result = await customerAuthApiRequest("/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone_e164: `+91${phone}`, purpose, otp })
    });
    completeCustomerAuthentication(result, phone, pendingCustomerProfile || {});
  } catch (error) {
    setCustomerAuthError("customerOtpError", customerAuthErrorMessage(error, "Unable to verify the code. Try again."));
    clearCustomerOtpFields();
    document.querySelector(".customer-otp-input")?.focus();
  } finally {
    customerAuthRequestPending = false;
    if (verifyButton) verifyButton.textContent = "Verify";
  }
}


// ==========================================
// 43. LOGOUT
// ==========================================

async function logoutCustomer() {
  if (customerLogoutPending) return;
  const token = getCustomerAccessToken();
  if (!token) {
    const phone = getCurrentCustomerPhone();
    localStorage.removeItem("myshopzy_user_access_token");
    sessionStorage.removeItem("myshopzy_user_access_token");
    localStorage.removeItem("quickdash_customer");
    sessionStorage.removeItem("quickdash_customer");
    sessionStorage.removeItem("user_access_token");
    localStorage.removeItem("user_access_token");
    if (phone) {
      localStorage.removeItem(`myshopzy_customer_${phone}`);
      sessionStorage.removeItem(`myshopzy_customer_${phone}`);
    }
    activeCustomerSession = null;
    savedAddresses = [];
    syncCustomerAuthUI();
    syncAccountDashboard();
    closeOrdersView();
    closeAccountModal();
    populateCheckoutAddressDropdown();
    window.location.replace("index.html");
    return;
  }

  customerLogoutPending = true;
  const confirmButton = document.getElementById("customerLogoutConfirmButton");
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = "Logging out...";
  }

  try {
    await customerAuthApiRequest("/logout", { method: "POST" });
  } catch (error) {
    console.warn("Customer logout request failed; clearing local session anyway.", error?.message || error);
  } finally {
    customerLogoutPending = false;
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = "Logout";
    }
  }

  const phone = getCurrentCustomerPhone();
  localStorage.removeItem("myshopzy_user_access_token");
  sessionStorage.removeItem("myshopzy_user_access_token");
  localStorage.removeItem("quickdash_customer");
  sessionStorage.removeItem("quickdash_customer");
  sessionStorage.removeItem("user_access_token");
  localStorage.removeItem("user_access_token");
  if (phone) {
    localStorage.removeItem(`myshopzy_customer_${phone}`);
    sessionStorage.removeItem(`myshopzy_customer_${phone}`);
  }

  activeCustomerSession = null;
  savedAddresses = [];

  setCustomerLogoutError("");
  syncCustomerAuthUI();
  syncAccountDashboard();
  closeOrdersView();
  closeAccountModal();
  populateCheckoutAddressDropdown();
  window.location.replace("index.html");
}

function showCustomerLogoutConfirmation(event) {
  event?.preventDefault();
  event?.stopPropagation();
  setCustomerLogoutError("");
  document.getElementById("customerLogoutStartButton")?.classList.add("hidden");
  document.getElementById("customerLogoutConfirmation")?.classList.remove("hidden");
  document.getElementById("customerLogoutConfirmButton")?.focus();
}

function cancelCustomerLogout(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const confirmation = document.getElementById("customerLogoutConfirmation");
  const startButton = document.getElementById("customerLogoutStartButton");
  if (!confirmation || !startButton) return;
  confirmation.classList.add("hidden");
  startButton.classList.remove("hidden");
  setCustomerLogoutError("");
  const confirmButton = document.getElementById("customerLogoutConfirmButton");
  if (confirmButton) {
    confirmButton.disabled = false;
    confirmButton.textContent = "Logout";
  }
}

function setCustomerLogoutError(message) {
  const error = document.getElementById("customerLogoutError");
  if (!error) return;
  error.textContent = message;
  error.classList.toggle("hidden", !message);
}


// ==========================================
// 44. CUSTOMER ORDERS
// ==========================================

async function toggleOrdersView(preserveProfile = false) {

  const keepProfileOpen = preserveProfile && document.body.classList.contains("customer-profile-view");

  closeAllModals();

  if (keepProfileOpen) document.getElementById("accountModal")?.classList.remove("hidden");


  const modal =
    document.getElementById(
      "ordersModal"
    );


  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }


  const feed =
    document.getElementById(
      "ordersFeed"
    );


  if (!feed) return;


  const currentLoginPhone =
    getCurrentCustomerPhone();


  if (!currentLoginPhone) {

    feed.innerHTML = `
      <div class="text-center py-10 space-y-3">

        <p class="text-slate-500 font-bold text-xs">
          Please login with your mobile number to view your orders!
        </p>

        <button
          onclick="closeOrdersView(); openLoginModal();"
          class="px-4 py-2 bg-[#0B132B] text-white rounded-xl text-xs font-black uppercase"
        >
          Login Now 👤
        </button>

      </div>
    `;

    return;
  }


  feed.innerHTML = `
    <div class="text-center py-6 text-slate-400 font-bold">
      Loading orders for ${escapeHtml(currentLoginPhone)}...
    </div>
  `;


  try {

    const userCloudOrders = await customerOrderApiRequest("?bucket=all");


    userCloudOrders.sort(
      (a, b) =>
        (b.created_at_ms || 0) -
        (a.created_at_ms || 0)
    );


    if (
      userCloudOrders.length === 0
    ) {

      feed.innerHTML = `
        <div class="text-center py-10 text-slate-400 font-bold">

          No orders found for
          ${escapeHtml(currentLoginPhone)}!

          <br>

          Place a new order.

        </div>
      `;

      return;
    }


    feed.innerHTML =
      "";


    userCloudOrders.forEach(
      order => {

        const statusColor =
          order.status ===
          "DELIVERED"

            ? "text-emerald-600"

            : "text-amber-600";


        const orderDate = formatOrderDateTime(order);

        feed.innerHTML += `
          <div
            onclick="openOrderDetailReceipt('${escapeAttribute(order.id)}')"
            class="p-3 ${order.status === 'PLACED' || order.status === 'DELIVERED' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'} hover:bg-emerald-100 border rounded-2xl space-y-2 cursor-pointer transition shadow-sm"
          >

            <div class="flex justify-between font-black text-slate-900">

              <span>
                ${escapeHtml(order.id)}
              </span>

              <span class="text-emerald-600">
                ₹${Number(
                  order.total_amount ||
                  order.total ||
                  0
                )}
              </span>

            </div>

            <div class="flex items-center justify-between text-[10px] text-slate-500">
              <span>${escapeHtml(orderDate)}</span>
              <span class="px-1.5 py-0.5 rounded-full ${order.status === 'DELIVERED' ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'} font-bold">
                ${escapeHtml(order.status || 'PLACED')}
              </span>
            </div>

            <div class="flex items-center justify-between text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1">
              <span>Delivery promise</span>
              <span data-order-countdown data-order-id="${escapeAttribute(order.id)}" data-order-status="${escapeAttribute(order.status || 'PLACED')}" data-delivery-deadline-ms="${Number(order.delivery_deadline_ms) || ""}" data-promise-min-minutes="${Number(order.delivery_promise_min_minutes) || ""}" data-promise-max-minutes="${Number(order.delivery_promise_max_minutes) || ""}">${getCustomerDeliveryPromiseText()}</span>
            </div>

            <p class="text-[11px] text-slate-500">

              OTP:

              <strong class="text-amber-600">
                ${escapeHtml(
                  order.delivery_otp ||
                  "----"
                )}
              </strong>

            </p>

            <p class="text-[10px] text-slate-400 truncate">

              📍
              ${escapeHtml(
                order.delivery_address ||
                "Address unavailable"
              )}

            </p>

            ${renderCustomerRiderContact(order)}

          </div>
        `;
      }
    );


  } catch (error) {
    console.error("Customer order API failed:", error);
    feed.innerHTML = `<div class="text-center py-6 text-rose-500 font-bold">${escapeHtml(error.message)}</div>`;
  }

  startCustomerCountdowns();
}

function renderCustomerRiderContact(order) {
  const status = String(order.status || "").toUpperCase();
  const riderPhone = String(order.rider_phone || "").replace(/\D/g, "");
  if (!riderPhone || !["PICKING_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) return "";
  const riderName = escapeHtml(order.rider_name || order.assigned_rider || "Delivery partner");
  const whatsapp = `https://wa.me/${riderPhone}?text=${encodeURIComponent(`Hi ${order.rider_name || "rider"}, I am contacting you about order ${order.id}.`)}`;
  return `<div class="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-2.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-black text-emerald-900">🛵 ${riderName} is handling your order</span>
      <span class="text-[10px] font-bold text-emerald-700">Rider assigned</span>
    </div>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <a href="tel:${riderPhone}" onclick="event.stopPropagation()" class="rounded-xl bg-white px-2 py-2 text-center text-[10px] font-black text-slate-800 border border-emerald-200">📞 Call rider</a>
      <a href="${whatsapp}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="rounded-xl bg-emerald-600 px-2 py-2 text-center text-[10px] font-black text-white">💬 Chat</a>
    </div>
  </div>`;
}


// ==========================================
// 45. ORDER DETAIL / RECEIPT
// ==========================================

async function openOrderDetailReceipt(
  orderId
) {

  closeAllModals();


  const modal =
    document.getElementById(
      "orderDetailReceiptModal"
    );


  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }


  try {
    const targetOrder = await customerOrderApiRequest(`/${encodeURIComponent(orderId)}`);
    renderReceipt(targetOrder.order_number || orderId, targetOrder);
  } catch (error) {
    console.error("Customer order detail API failed:", error);
    alert(`Unable to load order details: ${error.message}`);
  }
}


// ==========================================
// 46. RENDER RECEIPT
// ==========================================

async function requestCustomerEtaForOrder(orderId) {
  try {
    const tracking = await customerOrderApiRequest(`/${encodeURIComponent(orderId)}/tracking`);
    return tracking?.eta || null;
  } catch {
    return null;
  }
}

function renderReceipt(
  orderId,
  targetOrder
) {

  const receiptOrderId =
    document.getElementById(
      "receiptOrderId"
    );


  if (receiptOrderId) {

    receiptOrderId.innerText =
      orderId;
  }


  const receiptStatus =
    document.getElementById(
      "receiptStatus"
    );


  if (receiptStatus) {

    receiptStatus.innerText =
      targetOrder.status ||
      "PLACED";
  }


  const receiptAddress =
    document.getElementById(
      "receiptAddress"
    );


  if (receiptAddress) {

    receiptAddress.innerText =
      targetOrder.delivery_address ||
      "Mandapeta";
  }


  const receiptPayment =
    document.getElementById(
      "receiptPayment"
    );


  if (receiptPayment) {
    const method = targetOrder.payment_mode || "COD";
    const status = String(targetOrder.payment_status || "").toUpperCase();
    const statusLabel = {
      SUCCESSFUL: "Confirmed",
      SUCCESS: "Confirmed",
      PENDING: "Payment pending",
      INITIATED: "Pending gateway confirmation",
      FAILED: "Failed",
      CANCELLED: "Cancelled",
      REFUNDED: "Refunded"
    }[status];
    receiptPayment.innerText = method === "COD"
      ? "COD (Pay on delivery)"
      : `${method}${statusLabel ? ` (${statusLabel})` : " (Payment status unavailable)"}`;
  }


  const receiptRider =
    document.getElementById(
      "receiptRider"
    );


  if (receiptRider) {
    receiptRider.innerText =
      targetOrder.assigned_rider || "Waiting for rider assignment";
  }

  const receiptCountdown = document.getElementById("receiptDeliveryCountdown");
  if (receiptCountdown) {
    receiptCountdown.dataset.orderStatus = targetOrder.status || "PLACED";
    receiptCountdown.dataset.deliveryEta = "";
    requestCustomerEtaForOrder(orderId)
      .then(eta => {
        const safeEta = eta && typeof eta === "object" ? eta : null;
        if (!safeEta || !safeEta.available) {
          receiptCountdown.innerText = getCustomerDeliveryPromiseText();
          return;
        }
        receiptCountdown.dataset.deliveryEta = JSON.stringify(safeEta);
        receiptCountdown.innerText = formatDynamicEtaText(safeEta);
      })
      .catch(() => {
        receiptCountdown.innerText = "Delivery time will be updated shortly";
      });
  }

  const trackingBox = document.getElementById("customerRiderTrackingBox");
  if (trackingBox) {
    const currentStatus = String(targetOrder.status || '').toUpperCase();
    if (targetOrder.assignment_id && !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(currentStatus)) {
      trackingBox.innerHTML = `
        <div class="space-y-2">
          <button onclick="openCustomerRiderTracker('${escapeAttribute(orderId)}')" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2">
            <span>🛵</span> Track ${escapeHtml(targetOrder.assigned_rider || 'rider')} live
          </button>
          ${currentStatus === 'OUT_FOR_DELIVERY' ? `<button onclick="requestCustomerDeliveryOtp('${escapeAttribute(orderId)}')" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black">Send delivery code</button>` : ''}
        </div>
      `;
    } else {
      trackingBox.innerHTML = currentStatus === "DELIVERED"
        ? `<p class="text-[11px] text-emerald-700 font-bold text-center">Delivery completed</p>`
        : `<p class="text-[11px] text-slate-500 font-bold text-center">A rider will be assigned soon.</p>`;
    }
  }


  const itemsContainer =
    document.getElementById(
      "receiptItemsContainer"
    );


  if (itemsContainer) {

    itemsContainer.innerHTML =
      "";


    if (
      Array.isArray(
        targetOrder.items
      )
    ) {

      targetOrder.items.forEach(
        item => {

          itemsContainer.innerHTML += `
            <div class="flex justify-between text-xs py-1 border-b border-slate-100">

              <span>

                ${Number(
                  item.quantity || 0
                )}x

                ${escapeHtml(
                  item.name || ""
                )}

                <span class="text-[10px] text-slate-400">

                  (
                  ${escapeHtml(
                    item.unit || ""
                  )}
                  )

                </span>

              </span>


              <span class="font-bold">

                ₹${Number(
                  item.price || 0
                ) *
                Number(
                  item.quantity || 0
                )}

              </span>

            </div>
          `;
        }
      );
    }
  }


  const total =
    Number(
      targetOrder.total_amount ||
      targetOrder.total ||
      0
    );


  const sub =
    Number(
      targetOrder.subtotal ||
      0
    );


  const deliveryFee =
    Number(
      targetOrder.delivery_fee ||
      0
    );


  const receiptSubtotal =
    document.getElementById(
      "receiptSubtotal"
    );


  if (receiptSubtotal) {

    receiptSubtotal.innerText =
      `₹${sub}`;
  }


  const receiptDelivery =
    document.getElementById(
      "receiptDeliveryFee"
    );


  if (receiptDelivery) {

    receiptDelivery.innerText =
      deliveryFee === 0
        ? "FREE"
        : `₹${deliveryFee}`;
  }


  const receiptGrand =
    document.getElementById(
      "receiptGrandTotal"
    );


  if (receiptGrand) {

    receiptGrand.innerText =
      `₹${total}`;
  }


  const printBtn =
    document.getElementById(
      "receiptPrintPdfBtn"
    );


  if (printBtn) {

    printBtn.onclick =
      () => window.print();
  }
}

async function requestCustomerDeliveryOtp(orderId) {
  try {
    await customerOrderApiRequest(`/${encodeURIComponent(orderId)}/delivery-otp`, {
      method: "POST",
      body: JSON.stringify({})
    });
    alert("Delivery code sent to the phone number on this order.");
  } catch (error) {
    alert(error.message || "Unable to send the delivery code.");
  }
}


// ==========================================
// 47. CLOSE RECEIPT
// ==========================================

function closeOrderDetailReceipt() {

  const modal =
    document.getElementById(
      "orderDetailReceiptModal"
    );


  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }
}


// ==========================================
// 48. HTML ESCAPING
// ==========================================

function escapeHtml(value) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}


function escapeAttribute(value) {

  return escapeHtml(
    value
  );
}

function openDailyOffer() {
  const modal = document.getElementById("dailyOfferModal");
  if (modal) modal.classList.remove("hidden");
}

function closeDailyOffer() {
  const modal = document.getElementById("dailyOfferModal");
  if (modal) modal.classList.add("hidden");
}

function showDailyOfferOnce() {
  const today = new Date().toISOString().slice(0, 10);
  const seenKey = `myshopzy_offer_seen_v2_${today}`;
  if (localStorage.getItem(seenKey) === 'true') return;
  localStorage.setItem(seenKey, 'true');
  setTimeout(openDailyOffer, 700);
}


// ==========================================
// 49. INITIALIZATION
// ==========================================

document.addEventListener(
  "DOMContentLoaded",
  () => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    document.addEventListener("click", event => {
      if (event.target.closest("button, [onclick], .cat-card")) {
        CUSTOMER_TAB_SOUND.currentTime = 0;
        CUSTOMER_TAB_SOUND.play().catch(() => {});
      }
    });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });

    applyThemeMode(localStorage.getItem("myshopzy_theme") === "dark");
    setUserLanguage(localStorage.getItem("myshopzy_language") || "en");

    renderCustomerCategoryTiles();
    renderCustomerCategoryPreviews();
    startCustomerServicePromoCarousel();
    setupCustomerOtpInputs();
    updateCustomerPhoneValidation();

    checkStoreWorkingHours();
    loadCustomerCategorySettings();
    loadCustomerHomepageBanners();
    loadCustomerDailyOffer();


    // Load addresses for current
    // logged-in customer only.
    savedAddresses =
      loadCustomerAddresses();
    syncCustomerAddressesFromCloud();


    restorePendingServiceCart();
    fetchProducts();
    loadCustomerRestaurants();


    syncCustomerAuthUI();
    syncCustomerGreetingUI();

    if (!getCustomerAccessToken()) openLoginModal();
    else refreshAuthenticatedCustomerProfile();


    syncAccountDashboard();


    suppressCategoryScrollOnInit = true;


    const initialCategory = categories.find(category => category.id === 'veggies') || categories[0];
    if (initialCategory) selectCategory(initialCategory.id, null);


    suppressCategoryScrollOnInit = false;


    populateCheckoutAddressDropdown();


    // Default payment method
    // matches the HTML screenshot:
    // Scan QR
    setPaymentMethod(
      "UPI_QR"
    );


    console.log(
      "✅ MyShopzy customer engine loaded."
    );


    console.log("Customer session:", getCustomerAccessToken() ? "active" : "guest");

  }
);