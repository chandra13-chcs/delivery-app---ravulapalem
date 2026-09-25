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

let leafletMap = null;
let customerMarker = null;
let riderTrackingMap = null;
let riderTrackingMarker = null;
let riderTrackingUnsubscribe = null;
let riderTrackingDestination = null;
let suppressCategoryScrollOnInit = false;
let customerCountdownTimer = null;
const delaySupportShownFor = new Set();

const CUSTOMER_ORDER_PLACED_SOUND = new Audio("../assets/audio/order-placed-user.mpeg");
const CUSTOMER_TAB_SOUND = new Audio("../assets/audio/tab-click.wav");

function getOrderDeadlineMs(order) {
  const explicitDeadline = Number(order?.delivery_deadline_ms);
  if (Number.isFinite(explicitDeadline)) return explicitDeadline;
  const createdAt = Number(order?.created_at_ms);
  return Number.isFinite(createdAt) ? createdAt + (25 * 60 * 1000) : null;
}

function formatDeliveryCountdown(deadlineMs, status) {
  if (String(status || "").toUpperCase() === "DELIVERED") return "Delivered";
  if (!Number.isFinite(Number(deadlineMs))) return "25 min delivery";
  const remaining = Math.max(0, Number(deadlineMs) - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, "0");
  return remaining > 0 ? `${minutes}:${seconds} left` : "Arriving now";
}

function updateCustomerCountdowns() {
  document.querySelectorAll("[data-delivery-deadline]").forEach(element => {
    element.innerText = formatDeliveryCountdown(element.dataset.deliveryDeadline, element.dataset.orderStatus);
    const deadline = Number(element.dataset.deliveryDeadline);
    if (deadline > 0 && deadline <= Date.now() && element.dataset.orderStatus !== "DELIVERED") {
      const orderId = element.dataset.orderId || "unknown";
      if (!delaySupportShownFor.has(orderId)) {
        delaySupportShownFor.add(orderId);
        openCustomerSupport(orderId);
      }
    }
  });
}

function openCustomerSupport(orderId = "") {
  const modal = document.getElementById("customerSupportModal");
  const message = document.getElementById("customerSupportMessage");
  if (message) message.innerText = orderId && orderId !== "unknown"
    ? `Order ${orderId} has crossed the promised 25-minute window. Our support team can help right away.`
    : "Your delivery has crossed the promised 25-minute window. Our support team can help right away.";
  if (modal) modal.classList.remove("hidden");
}

function closeCustomerSupport() {
  const modal = document.getElementById("customerSupportModal");
  if (modal) modal.classList.add("hidden");
}

function startCustomerCountdowns() {
  if (customerCountdownTimer) clearInterval(customerCountdownTimer);
  updateCustomerCountdowns();
  customerCountdownTimer = setInterval(updateCustomerCountdowns, 1000);
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

function openCustomerRiderTracker(orderId, riderName) {
  const modal = document.getElementById("customerRiderTrackingModal");
  const status = document.getElementById("customerRiderTrackingStatus");
  if (!modal || !riderName) return;

  modal.classList.remove("hidden");
  if (status) status.innerText = `Connecting to ${riderName}'s live location...`;

  if (riderTrackingUnsubscribe) riderTrackingUnsubscribe();
  riderTrackingDestination = null;
  db.collection("orders").doc(orderId).get().then(orderDoc => {
    if (orderDoc.exists) {
      const order = orderDoc.data();
      if (Number.isFinite(Number(order.delivery_latitude)) && Number.isFinite(Number(order.delivery_longitude))) {
        riderTrackingDestination = {
          lat: Number(order.delivery_latitude),
          lng: Number(order.delivery_longitude)
        };
      }
    }
  }).catch(error => console.warn("Tracking destination load failed:", error));
  if (!riderTrackingMap) {
    riderTrackingMap = L.map("customerRiderTrackingMap").setView([DARK_STORE_COORDS.lat, DARK_STORE_COORDS.lng], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(riderTrackingMap);
  } else {
    setTimeout(() => riderTrackingMap.invalidateSize(), 200);
  }

  riderTrackingUnsubscribe = db.collection("riders_location").doc(riderName).onSnapshot(doc => {
    if (!doc.exists || !Number.isFinite(Number(doc.data().lat)) || !Number.isFinite(Number(doc.data().lng))) {
      if (status) status.innerText = `${riderName} has not started live GPS yet.`;
      return;
    }

    const location = doc.data();
    const position = [Number(location.lat), Number(location.lng)];
    if (riderTrackingMarker) {
      riderTrackingMarker.setLatLng(position);
    } else {
      riderTrackingMarker = L.marker(position, {
        icon: L.divIcon({ className: "customer-rider-icon", html: "<div style=\"font-size: 28px\">🛵</div>", iconSize: [32, 32] })
      }).addTo(riderTrackingMap).bindPopup(`<b>${escapeHtml(riderName)}</b><br>Live delivery partner`).openPopup();
    }
    riderTrackingMap.setView(position, 16);
    let etaText = "";
    if (riderTrackingDestination) {
      const distance = calculateDistanceKm(position[0], position[1], riderTrackingDestination.lat, riderTrackingDestination.lng);
      const etaMinutes = Math.max(1, Math.ceil((distance / 25) * 60));
      etaText = ` · Approx. ${etaMinutes} min (${distance.toFixed(1)} km)`;
    }
    if (status) status.innerText = `${riderName} is live. Last update: ${location.updated_at ? "just now" : "location received"}${etaText}`;
  }, error => {
    console.error("Customer rider tracking error:", error);
    if (status) status.innerText = "Live location is temporarily unavailable.";
  });
}

function closeCustomerRiderTracker() {
  const modal = document.getElementById("customerRiderTrackingModal");
  if (modal) modal.classList.add("hidden");
  if (riderTrackingUnsubscribe) {
    riderTrackingUnsubscribe();
    riderTrackingUnsubscribe = null;
  }
}


// ==========================================
// 2. CUSTOMER SESSION
// ==========================================

let activeCustomerSession = JSON.parse(
  localStorage.getItem("quickdash_customer") || "null"
);


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

  db.collection("customer_profiles").doc(phone).set({
    phone,
    addresses: savedAddresses,
    updated_at_ms: Date.now()
  }, { merge: true }).catch(error => {
    console.warn("Cloud address sync failed:", error);
  });
}

async function syncCustomerAddressesFromCloud() {
  const phone = getCurrentCustomerPhone();
  if (!phone) return;

  try {
    const profileDoc = await db.collection("customer_profiles").doc(phone).get();
    const cloudAddresses = profileDoc.exists ? profileDoc.data()?.addresses : null;
    if (Array.isArray(cloudAddresses)) {
      savedAddresses = cloudAddresses;
      localStorage.setItem(getCustomerStorageKey(phone), JSON.stringify(savedAddresses));
      renderSavedAddressesList();
      populateCheckoutAddressDropdown();
      return;
    }

    if (savedAddresses.length) persistCustomerAddresses();
  } catch (error) {
    console.warn("Cloud address load failed; using local addresses:", error);
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

  if (
    !currentCustomerCoords ||
    !currentCustomerCoords.lat ||
    !currentCustomerCoords.lng
  ) {

    alert(
      "Please select a delivery location first."
    );

    return;
  }


  const headerAddr =
    document.getElementById(
      "currentAddressHeader"
    );

  if (headerAddr) {

    headerAddr.innerText =
      currentCustomerCoords.address;
  }


  closeLocationModal();


  // Open address manager so customer can
  // add/save the GPS location manually.
  openAddressManager();
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


function openAccountModal() {

  closeAllModals();

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

  window.scrollTo({
    top: 400,
    behavior: "smooth"
  });
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

function saveNewManualAddress(e) {

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
    !street ||
    !city ||
    !state ||
    !pincode
  ) {

    alert(
      "Please fill all required address fields correctly!"
    );

    return;
  }


  const newAddr = {

    id:
      "addr_" +
      Date.now(),

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


  savedAddresses.push(
    newAddr
  );


  persistCustomerAddresses();


  const form =
    document.getElementById(
      "manualAddressForm"
    );

  if (form) {

    form.reset();
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

function saveCurrentGpsAddress() {

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
    !currentCustomerCoords.lat ||
    !currentCustomerCoords.lng
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

    id:
      "gps_" +
      Date.now(),

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


  savedAddresses.push(
    gpsAddress
  );


  persistCustomerAddresses();

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

function setDefaultAddress(idx) {

  if (
    !savedAddresses[idx]
  ) return;


  savedAddresses.forEach(
    (address, index) => {

      address.isDefault =
        index === idx;
    }
  );


  persistCustomerAddresses();

  renderSavedAddressesList();

  populateCheckoutAddressDropdown();
}


// ==========================================
// 22. DELETE ADDRESS
// ==========================================

function deleteAddress(idx) {

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


  savedAddresses.splice(
    idx,
    1
  );


  if (
    deletingDefault &&
    savedAddresses.length > 0
  ) {

    savedAddresses[0].isDefault =
      true;
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
            addr.isDefault
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


let liveCatalog = [];

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

function loadCustomerRestaurants() {
  const directory = document.getElementById('restaurantDirectory');
  if (!directory) return;
  db.collection('restaurants').onSnapshot(snapshot => {
    const restaurants = [];
    snapshot.forEach(doc => restaurants.push({ id: doc.id, ...doc.data() }));
    const nearby = restaurants.filter(item => Number(item.distance_km) <= 25);
    serviceRestaurants = nearby;
    renderServiceRestaurantList();
    if (!nearby.length) return;
    directory.innerHTML = nearby.map(item => `
      <button onclick="selectRestaurant('${escapeAttribute(item.id)}', '${escapeAttribute(item.name)}')" class="text-left p-3 bg-white border border-slate-200 rounded-2xl shadow-sm hover:border-amber-400 transition flex gap-3">
        <img src="${escapeAttribute(item.image_url || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80')}" alt="${escapeAttribute(item.name)}" class="w-20 h-20 rounded-xl object-cover">
        <span><strong class="block text-sm font-black text-slate-900">${escapeHtml(item.name)}</strong><span class="block text-[11px] text-slate-500 mt-1">${escapeHtml(item.cuisine || 'Restaurant menu')}</span><span class="inline-block mt-2 text-[10px] font-black text-emerald-700">${Number(item.distance_km).toFixed(1)} km · 25-45 min</span></span>
      </button>
    `).join('');
  }, error => console.error('Restaurant directory error:', error));
}

function showServiceSection(section) {
  if (["restaurant", "meat", "parcel"].includes(section)) {
    window.location.href = `service.html?type=${encodeURIComponent(section)}`;
    return;
  }
  hideServiceSections();
  const panel = document.getElementById(`service${section.charAt(0).toUpperCase()}${section.slice(1)}Panel`);
  if (!panel) return;
  panel.classList.remove("hidden");
  if (section === "shop") renderServiceShopCategories();
  if (section === "restaurant") renderServiceRestaurantList();
  document.getElementById("serviceDirectory")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideServiceSections() {
  document.querySelectorAll("#serviceDirectory > div[id$='Panel']").forEach(panel => panel.classList.add("hidden"));
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
    const dishes = liveCatalog.filter(product => product.category === "restaurants" && product.restaurant_id === restaurant.id);
    const dishMarkup = dishes.length ? dishes.map(dish => `
      <button type="button" onclick="openServiceDish('${escapeAttribute(dish.id)}')" class="min-w-[138px] text-left bg-white border border-slate-200 rounded-xl p-2 shadow-sm">
        <img src="${escapeAttribute(dish.image_url || "")}" alt="${escapeAttribute(dish.name || "Dish")}" class="w-full h-20 rounded-lg object-contain bg-slate-50" onerror="this.style.display='none'">
        <span class="block mt-1 text-[10px] font-bold text-slate-800 line-clamp-2">${escapeHtml(dish.name || "Dish")}</span>
        <span class="block mt-1 text-[10px] font-black text-slate-900">₹${Number(dish.price || 0)}</span>
      </button>
    `).join("") : '<p class="text-[11px] text-slate-400 py-3">Menu items are being updated.</p>';
    return `
      <article class="bg-white border border-slate-200 rounded-2xl p-3">
        <button type="button" onclick="selectRestaurant('${escapeAttribute(restaurant.id)}', '${escapeAttribute(restaurant.name || "Restaurant")}')" class="flex items-center gap-3 text-left">
          <img src="${escapeAttribute(restaurant.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80")}" alt="${escapeAttribute(restaurant.name || "Restaurant")}" class="w-16 h-16 rounded-xl object-cover">
          <span><strong class="block text-sm font-black text-slate-900">${escapeHtml(restaurant.name || "Restaurant")}</strong><span class="block text-[11px] text-slate-500 mt-1">${escapeHtml(restaurant.cuisine || "Restaurant menu")}</span><span class="block text-[10px] font-black text-emerald-700 mt-1">${Number(restaurant.distance_km || 0).toFixed(1)} km · 25-45 min</span></span>
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
  const pickup = document.getElementById("parcelPickupInput")?.value.trim();
  const drop = document.getElementById("parcelDropInput")?.value.trim();
  const description = document.getElementById("parcelDescriptionInput")?.value.trim();
  const orderId = `PX-${Math.floor(100000 + Math.random() * 900000)}`;
  const [pickupLocation, dropLocation] = await Promise.all([geocodeParcelAddress(pickup), geocodeParcelAddress(drop)]);
  const dropLatitude = dropLocation?.lat ?? currentCustomerCoords.lat;
  const dropLongitude = dropLocation?.lng ?? currentCustomerCoords.lng;
  const parcelFee = 50;
  const order = {
    id: orderId,
    order_type: "PARCEL",
    customer_phone: getCurrentCustomerPhone() || "guest",
    customer_name: getCustomerDisplayName(),
    delivery_address: drop,
    parcel_pickup_address: pickup,
    parcel_drop_address: drop,
    parcel_description: description,
    pickup_latitude: pickupLocation?.lat || null,
    pickup_longitude: pickupLocation?.lng || null,
    delivery_latitude: dropLatitude,
    delivery_longitude: dropLongitude,
    items: [{
      id: `parcel-item-${orderId}`,
      name: `Parcel: ${description}`,
      unit: "1 parcel",
      quantity: 1,
      price: parcelFee,
      pickup_source: "parcel",
      pickup_source_name: "Parcel Pickup",
      pickup_source_address: pickup
    }],
    subtotal: parcelFee,
    delivery_fee: 0,
    total_amount: parcelFee,
    status: "PLACED",
    delivery_deadline_ms: Date.now() + (60 * 60 * 1000),
    payment_mode: "COD",
    delivery_otp: Math.floor(1000 + Math.random() * 9000).toString(),
    created_at_ms: Date.now()
  };

  try {
    await db.collection("orders").doc(orderId).set({
      ...order,
      created_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Parcel order creation failed:", error);
    localStorage.setItem("myshopzy_last_parcel_request", JSON.stringify(order));
    alert("Parcel request could not sync online. It was saved on this device for retry.");
    return;
  }

  const status = document.getElementById("parcelRequestStatus");
  if (status) {
    status.innerText = `Parcel ${orderId} created. A rider will be assigned shortly.`;
    status.classList.remove("hidden");
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

async function fetchProducts() {

  db.collection(
    "products"
  )
    .orderBy(
      "created_at",
      "desc"
    )
    .onSnapshot(

      snapshot => {

        let cloudProducts =
          [];

        snapshot.forEach(
          doc => {

            cloudProducts.push(
              {
                id: doc.id,
                ...doc.data()
              }
            );
          }
        );


        liveCatalog =
          cloudProducts;

        restorePendingServiceCart();
        renderServiceRestaurantList();
        filterAndRender();
      },

      error => {

        console.error(
          "Products listener error:",
          error
        );
      }
    );
}

function restorePendingServiceCart() {
  const pendingCart = localStorage.getItem("myshopzy_pending_cart");
  if (!pendingCart) return;
  try {
    const parsedCart = JSON.parse(pendingCart);
    if (!parsedCart || typeof parsedCart !== "object") return;
    Object.entries(parsedCart).forEach(([productId, quantity]) => {
      if (liveCatalog.some(product => product.id === productId)) cartState[productId] = Number(quantity) || 0;
    });
    localStorage.removeItem("myshopzy_pending_cart");
    syncCartBar();
    if (new URLSearchParams(window.location.search).get("checkout") === "1" && Object.keys(cartState).length) {
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
      const haystack = `${item.name || ""} ${item.category || ""} ${item.restaurant_name || ""} ${item.desc || ""} ${item.qty_unit || ""}`
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
          No products in this category
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
        <div class="bg-white p-2.5 rounded-2xl border shadow-sm flex flex-col justify-between">

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
                ⚡ 25 MINS
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
                      class="px-3 py-1 rounded-lg border-2 border-emerald-600 text-emerald-700 text-xs font-black"
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

  if (catId === "meat") {
    window.location.href = "service.html?type=meat";
    return;
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

function selectRestaurant(restaurantId, restaurantName) {
  activeCategory = "restaurants";
  activeRestaurantId = restaurantId;
  const heading = document.getElementById("categoryHeading");
  if (heading) heading.innerText = `${restaurantName} Menu`;
  filterAndRender();
  const productsGrid = document.getElementById("productsGrid");
  if (productsGrid) scrollToProducts(productsGrid);
}


// ==========================================
// 28. CART
// ==========================================

function modifyCart(
  prodId,
  delta
) {

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

  syncCartBar();

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

function setAuthMode(mode) {
  const signupFields = document.getElementById("signupExtraFields");
  const loginBtn = document.getElementById("authModeLoginBtn");
  const signupBtn = document.getElementById("authModeSignupBtn");

  const isSignup = mode === "signup";
  if (signupFields) signupFields.classList.toggle("hidden", !isSignup);
  if (loginBtn) {
    loginBtn.className = `flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${isSignup ? "text-slate-600" : "bg-[#0B132B] text-white"}`;
  }
  if (signupBtn) {
    signupBtn.className = `flex-1 py-2 rounded-lg text-[10px] font-black uppercase ${isSignup ? "bg-[#0B132B] text-white" : "text-slate-600"}`;
  }
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

  const {
    grandTotal
  } =
    calculateCartTotals();


  const canvas =
    document.getElementById(
      "qrcodeCanvas"
    );


  if (!canvas) return;


  canvas.innerHTML =
    "";


  try {

    new QRCode(
      canvas,
      {
        text:
          `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${grandTotal}&cu=INR`,

        width: 110,

        height: 110
      }
    );

  } catch (error) {

    console.error(
      "QR generation error:",
      error
    );

    canvas.innerHTML = `
      <p class="text-[10px] text-rose-500 font-bold">
        QR unavailable
      </p>
    `;
  }
}


// ==========================================
// 35. DIRECT UPI PAYMENT
// ==========================================

function triggerDirectUpiPay(
  appName
) {

  const {
    grandTotal
  } =
    calculateCartTotals();


  if (
    grandTotal <= 0
  ) {

    alert(
      "Cart is empty."
    );

    return;
  }


  const upiUrl =
    `upi://pay?pa=ravulapalemhub@okaxis&pn=MyShopzy&am=${grandTotal}&cu=INR`;


  alert(
    `Opening ${appName}...\n\nIf the app does not open, use the Scan QR option.`
  );


  window.open(upiUrl, "_blank", "noopener");
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
    savedAddresses[
      Number(selectIdx)
    ];


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


  const {
    sub,
    deliveryFee,
    offerDiscount,
    riderTip,
    grandTotal
  } =
    calculateCartTotals();


  if (
    grandTotal <= 0
  ) {

    alert(
      "Your cart is empty."
    );

    return;
  }


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


      orderItems.push({

        id:
          item.id,

        name:
          item.name,

        unit:
          `${item.qty_value || 1} ${item.qty_unit || "pc"}`,

        quantity:
          cartState[id],

        price:
          getProductPrice(item),

        selected_weight:
          supportsWeightOptions(item) ? formatWeight(getSelectedProductWeight(item)) : null,

        pickup_source:
          item.pickup_source ||
          (item.category === "restaurants"
            ? "restaurant"
            : item.category === "veggies"
              ? "vegetable_partner"
              : item.category === "meat"
                ? "meat_partner"
                : "store"),

        pickup_source_name:
          item.pickup_source_name ||
          item.restaurant_name ||
          (item.category === "veggies"
            ? "Local Vegetable Partner"
            : item.category === "meat"
              ? "Fresh Meat Partner"
              : "MyShopzy Store"),

        pickup_source_address:
          item.pickup_source_address ||
          item.restaurant_address ||
          (item.category === "restaurants"
            ? "Restaurant partner address"
            : item.category === "veggies"
              ? "Assigned vegetable market partner"
              : item.category === "meat"
                ? "Assigned meat partner"
                : "Mandapeta Dark Store"),

        restaurant_id:
          item.restaurant_id || null,

        restaurant_name:
          item.restaurant_name || null,

        partner_id:
          item.partner_id || item.restaurant_id || null,

        partner_name:
          item.partner_name || item.restaurant_name || item.pickup_source_name || null
      });
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


  const orderId =
    "QD-" +
    Math.floor(
      100000 +
      Math.random() *
      900000
    );


  const fullAddressString =
    `${chosenAddr.fullName} (${chosenAddr.mobile}), ${chosenAddr.house}, ${chosenAddr.street}, ${chosenAddr.city}, ${chosenAddr.state} - ${chosenAddr.pincode}`;


  // IMPORTANT:
  // Order ownership is ALWAYS the
  // logged-in customer phone.
  //
  // NOT chosenAddr.mobile.
  //
  // This allows:
  // Customer A -> delivers to mother/father
  // without changing account ownership.
  //
  const orderPayload = {

    id:
      orderId,

    customer_phone:
      customerPhone,

    customer_name:
      getCustomerDisplayName(),

    delivery_address:
      fullAddressString,

    delivery_latitude:
      chosenAddr.latitude ||
      currentCustomerCoords.lat ||
      null,

    delivery_longitude:
      chosenAddr.longitude ||
      currentCustomerCoords.lng ||
      null,

    delivery_accuracy:
      chosenAddr.accuracy ||
      currentCustomerCoords.accuracy ||
      null,

    items:
      orderItems,

    subtotal:
      sub,

    delivery_fee:
      deliveryFee,

    rider_tip:
      riderTip,

    offer_discount:
      offerDiscount,

    total_amount:
      grandTotal,

    status:
      "PLACED",

    delivery_deadline_ms:
      Date.now() + (25 * 60 * 1000),

    payment_mode:
      selectedPaymentMode,

    delivery_otp:
      Math.floor(
        1000 +
        Math.random() *
        9000
      ).toString(),

    created_at_ms:
      Date.now()
  };


  try {

    await db
      .collection(
        "orders"
      )
      .doc(orderId)
      .set(
        {
          ...orderPayload,

          created_at:
            firebase.firestore.FieldValue.serverTimestamp()
        }
      );


    // Local backup for this customer
    const localOrderKey =
      `orders_${customerPhone}`;


    const localOrders =
      JSON.parse(
        localStorage.getItem(
          localOrderKey
        ) || "[]"
      );


    localOrders.push(
      orderPayload
    );


    localStorage.setItem(
      localOrderKey,
      JSON.stringify(
        localOrders
      )
    );


  } catch (error) {

    console.error(
      "Firebase order save failed:",
      error
    );


    // Local backup even if Firebase fails
    const localOrderKey =
      `orders_${customerPhone}`;


    const localOrders =
      JSON.parse(
        localStorage.getItem(
          localOrderKey
        ) || "[]"
      );


    localOrders.push(
      orderPayload
    );


   localStorage.setItem(
    localOrderKey,
    JSON.stringify(localOrders)
);

alert(
    "⚠️ Internet/Firebase issue.\n\nOrder saved locally on this device."
);


    alert(
      "⚠️ Internet/Firebase issue.\n\nOrder saved locally on this device."
    );
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


  alert(
    `🎉 Order Placed Successfully (${orderId})!`
  );

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


function syncAccountDashboard() {

  const phone =
    getCurrentCustomerPhone();


  const phoneDisp =
    document.getElementById(
      "accPhoneDisplay"
    );


  if (phoneDisp) {

    phoneDisp.innerText =
      phone || "Not logged in";
  }


  const name =
    phone
      ? getCustomerDisplayName()
      : "MyShopzy Customer";


  const savedCustomer = phone
    ? JSON.parse(localStorage.getItem(`myshopzy_customer_${phone}`) || "null")
    : null;
  const email = phone
    ? (savedCustomer?.email || "Not provided")
    : "Not logged in";


  const nameDisp =
    document.getElementById(
      "accNameDisplay"
    );


  if (nameDisp) {

    nameDisp.innerText =
      name;
  }


  const emailDisp =
    document.getElementById(
      "accEmailDisplay"
    );


  if (emailDisp) {

    emailDisp.innerText =
      email;
  }
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


  const phoneDisplay =
    document.getElementById(
      "userPhoneDisplay"
    );


  const phone =
    getCurrentCustomerPhone();


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


// ==========================================
// 40. LOGIN
// ==========================================

function openLoginModal() {

  closeAllModals();


  const modal =
    document.getElementById(
      "customerLoginModal"
    );


  if (modal) {

    modal.classList.remove(
      "hidden"
    );
  }
}


function closeLoginModal() {

  const modal =
    document.getElementById(
      "customerLoginModal"
    );


  if (modal) {

    modal.classList.add(
      "hidden"
    );
  }
}


// ==========================================
// 41. SEND OTP
// ==========================================

function sendCustomerLoginOtp() {

  const input = document.getElementById("loginMobileInput");
  const phone = normalizePhone(input ? input.value : "");

  if (phone.length !== 10) {
    alert("Please enter a valid 10-digit mobile number.");
    return;
  }

  const signupMode = document.getElementById("signupExtraFields") && !document.getElementById("signupExtraFields").classList.contains("hidden");
  if (signupMode) {
    const name = document.getElementById("signupNameInput")?.value.trim();
    const email = document.getElementById("signupEmailInput")?.value.trim();
    const location = document.getElementById("signupLocationInput")?.value.trim();
    const password = document.getElementById("signupPasswordInput")?.value;
    const confirm = document.getElementById("signupConfirmPasswordInput")?.value;

    if (!name || !email || !location || !password || !confirm) {
      alert("Please complete all sign-up fields before continuing.");
      return;
    }

    if (password.length < 6 || password !== confirm) {
      alert("Password must be at least 6 characters and match the confirmation field.");
      return;
    }

    const userData = { name, email, location, password };
    localStorage.setItem(`myshopzy_signup_${phone}`, JSON.stringify(userData));
  }

  const phoneStep = document.getElementById("loginStepPhone");
  const otpStep = document.getElementById("loginStepOtp");

  if (phoneStep) phoneStep.classList.add("hidden");
  if (otpStep) otpStep.classList.remove("hidden");

  const otpInput = document.getElementById("loginOtpInput");
  if (otpInput) otpInput.value = "4821";

  console.log("Demo OTP: 4821");
}


// ==========================================
// 42. VERIFY OTP
// ==========================================

function verifyCustomerLoginOtp() {

  const phoneInput = document.getElementById("loginMobileInput");
  const otpInput = document.getElementById("loginOtpInput");
  const phone = normalizePhone(phoneInput ? phoneInput.value : "");
  const otp = otpInput ? otpInput.value.trim() : "";

  if (phone.length !== 10) {
    alert("Please enter a valid 10-digit mobile number.");
    return;
  }

  if (otp !== "4821") {
    alert("Invalid OTP.\n\nFor this demo use: 4821");
    return;
  }

  const signupMode = document.getElementById("signupExtraFields") && !document.getElementById("signupExtraFields").classList.contains("hidden");
  const signupDetails = JSON.parse(localStorage.getItem(`myshopzy_signup_${phone}`) || "null");

  if (signupMode && signupDetails) {
    localStorage.setItem(`myshopzy_customer_${phone}`, JSON.stringify({
      name: signupDetails.name,
      email: signupDetails.email,
      defaultLocation: signupDetails.location,
      password: signupDetails.password
    }));
  }

  activeCustomerSession = { phone };
  localStorage.setItem("quickdash_customer", JSON.stringify(activeCustomerSession));

  savedAddresses = loadCustomerAddresses();
  syncCustomerAddressesFromCloud();

  closeLoginModal();
  syncCustomerAuthUI();
  syncAccountDashboard();
  populateCheckoutAddressDropdown();

  window.scrollTo({ top: 0, left: 0, behavior: "instant" });

  alert(`✅ Logged in successfully as ${phone}!`);
}


// ==========================================
// 43. LOGOUT
// ==========================================

function logoutCustomer() {

  localStorage.removeItem(
    "quickdash_customer"
  );


  activeCustomerSession =
    null;


  savedAddresses =
    [];


  syncCustomerAuthUI();

  syncAccountDashboard();

  closeOrdersView();
  closeAccountModal();
  populateCheckoutAddressDropdown();

  window.location.href = "index.html";

  alert(
    "Logged out successfully."
  );
}


// ==========================================
// 44. CUSTOMER ORDERS
// ==========================================

async function toggleOrdersView() {

  closeAllModals();


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

    const snapshot =
      await db
        .collection(
          "orders"
        )
        .where(
          "customer_phone",
          "==",
          currentLoginPhone
        )
        .get();


    let userCloudOrders =
      [];


    snapshot.forEach(
      doc => {

        userCloudOrders.push(
          {
            id:
              doc.id,

            ...doc.data()
          }
        );
      }
    );


    // Local backup
    if (
      userCloudOrders.length === 0
    ) {

      const localKey =
        `orders_${currentLoginPhone}`;


      userCloudOrders =
        JSON.parse(
          localStorage.getItem(
            localKey
          ) || "[]"
        );
    }


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
              <span>Dedicated delivery time</span>
              <span data-delivery-deadline="${getOrderDeadlineMs(order) || ""}" data-order-id="${escapeAttribute(order.id)}" data-order-status="${escapeAttribute(order.status || 'PLACED')}">${formatDeliveryCountdown(getOrderDeadlineMs(order), order.status)}</span>
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

    console.error(
      "Error fetching orders:",
      error
    );


    // Local fallback
    const localKey =
      `orders_${currentLoginPhone}`;


    const localOrders =
      JSON.parse(
        localStorage.getItem(
          localKey
        ) || "[]"
      );


    if (
      localOrders.length > 0
    ) {

      feed.innerHTML =
        "";


      localOrders
        .sort(
          (a, b) =>
            (b.created_at_ms || 0) -
            (a.created_at_ms || 0)
        )
        .forEach(
          order => {

            feed.innerHTML += `
              <div
                onclick="openOrderDetailReceipt('${escapeAttribute(order.id)}')"
                class="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1 cursor-pointer"
              >

                <div class="flex justify-between font-black">

                  <span>
                    ${escapeHtml(order.id)}
                  </span>

                  <span>
                    ₹${Number(
                      order.total_amount || 0
                    )}
                  </span>

                </div>

                <div class="flex items-center justify-between text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-2 py-1">
                  <span>Dedicated delivery time</span>
                  <span data-delivery-deadline="${getOrderDeadlineMs(order) || ""}" data-order-status="${escapeAttribute(order.status || 'PLACED')}">${formatDeliveryCountdown(getOrderDeadlineMs(order), order.status)}</span>
                </div>

                <p class="text-[10px] text-slate-400">
                  📍
                  ${escapeHtml(
                    order.delivery_address ||
                    ""
                  )}
                </p>

              </div>
            `;
          }
        );

    } else {

      feed.innerHTML = `
        <div class="text-center py-6 text-rose-500 font-bold">
          Failed to load orders.
        </div>
      `;
    }

  }

  startCustomerCountdowns();
}

function renderCustomerRiderContact(order) {
  const status = String(order.status || "").toUpperCase();
  const riderPhone = String(order.rider_phone || "").replace(/\D/g, "");
  if (!riderPhone || !["PICKING_UP", "OUT FOR DELIVERY", "DELIVERED"].includes(status)) return "";
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

    const doc =
      await db
        .collection(
          "orders"
        )
        .doc(orderId)
        .get();


    if (!doc.exists) {

      // Try local order
      const phone =
        getCurrentCustomerPhone();


      const localOrders =
        JSON.parse(
          localStorage.getItem(
            `orders_${phone}`
          ) || "[]"
        );


      const localOrder =
        localOrders.find(
          order =>
            order.id === orderId
        );


      if (!localOrder) {

        alert(
          "Order details not found!"
        );

        return;
      }


      renderReceipt(
        orderId,
        localOrder
      );


      return;
    }


    const targetOrder =
      doc.data();


    renderReceipt(
      orderId,
      targetOrder
    );


  } catch (error) {

    console.error(
      "Error loading receipt:",
      error
    );


    alert(
      "Unable to load order details."
    );
  }
}


// ==========================================
// 46. RENDER RECEIPT
// ==========================================

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

    receiptPayment.innerText =
      targetOrder.payment_mode ||
      "COD";
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
    receiptCountdown.dataset.deliveryDeadline = getOrderDeadlineMs(targetOrder) || "";
    receiptCountdown.dataset.orderStatus = targetOrder.status || "PLACED";
    receiptCountdown.innerText = formatDeliveryCountdown(getOrderDeadlineMs(targetOrder), targetOrder.status);
  }

  const trackingBox = document.getElementById("customerRiderTrackingBox");
  if (trackingBox) {
    if (targetOrder.assigned_rider && targetOrder.status !== "DELIVERED" && targetOrder.status !== "Delivered") {
      trackingBox.innerHTML = `
        <button onclick="openCustomerRiderTracker('${escapeAttribute(orderId)}', '${escapeAttribute(targetOrder.assigned_rider)}')" class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2">
          <span>🛵</span> Track ${escapeHtml(targetOrder.assigned_rider)} live
        </button>
      `;
    } else {
      trackingBox.innerHTML = targetOrder.status === "DELIVERED" || targetOrder.status === "Delivered"
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
  if (localStorage.getItem("myshopzy_offer_seen") === today) return;
  localStorage.setItem("myshopzy_offer_seen", today);
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

    checkStoreWorkingHours();
    showDailyOfferOnce();


    // Load addresses for current
    // logged-in customer only.
    savedAddresses =
      loadCustomerAddresses();
    syncCustomerAddressesFromCloud();


    fetchProducts();
    loadCustomerRestaurants();


    syncCustomerAuthUI();


    syncAccountDashboard();


    suppressCategoryScrollOnInit = true;


    selectCategory(
      "veggies",
      null
    );


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


    console.log(
      "👤 Active customer:",
      getCurrentCustomerPhone() ||
      "Guest"
    );

  }
);