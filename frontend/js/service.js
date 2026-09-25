const serviceType = new URLSearchParams(window.location.search).get("type") || "restaurant";
let serviceRestaurants = [];
let serviceProducts = [];

function serviceEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function serviceProductCard(product) {
  return `<article class="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm"><div class="h-28 rounded-xl bg-slate-50 flex items-center justify-center p-2"><img src="${serviceEscape(product.image_url || "")}" alt="${serviceEscape(product.name)}" class="max-h-full max-w-full object-contain" onerror="this.style.display='none'"></div><h3 class="text-xs font-bold text-slate-900 mt-2 line-clamp-2">${serviceEscape(product.name || "Product")}</h3><p class="text-[10px] text-slate-500 mt-1">${serviceEscape(product.qty_unit || product.unit || "1 pc")}</p><strong class="block text-xs text-emerald-700 mt-1">₹${Number(product.price || 0)}</strong></article>`;
}

function setupServicePage() {
  const settings = {
    restaurant: ["Restaurants", "Restaurant menus near Ravulapalem", "Choose a restaurant and browse its available dishes."],
    meat: ["Fresh Meat", "Chicken, meat & fish", "Fresh meat products available from partner stores."],
    parcel: ["Parcel Delivery", "Send a parcel across Ravulapalem", "Add pickup and drop details to request a delivery rider."]
  }[serviceType] || [];
  document.getElementById("serviceEyebrow").innerText = settings[0] || "MyShopzy Service";
  document.getElementById("serviceTitle").innerText = settings[1] || "Service";
  document.getElementById("serviceDescription").innerText = settings[2] || "";
  document.getElementById(`${serviceType}ServiceView`)?.classList.remove("hidden");
  if (serviceType === "restaurant") loadRestaurants();
  if (serviceType === "meat") loadMeatProducts();
  if (serviceType === "parcel") document.getElementById("serviceParcelForm")?.addEventListener("submit", submitServiceParcel);
}

function loadRestaurants() {
  db.collection("restaurants").onSnapshot(snapshot => {
    serviceRestaurants = [];
    snapshot.forEach(doc => serviceRestaurants.push({ id: doc.id, ...doc.data() }));
    renderRestaurants();
  }, error => console.error("Service restaurant listener error:", error));
  db.collection("products").where("category", "==", "restaurants").onSnapshot(snapshot => {
    serviceProducts = [];
    snapshot.forEach(doc => serviceProducts.push({ id: doc.id, ...doc.data() }));
    renderRestaurants();
  }, error => console.error("Service restaurant menu listener error:", error));
}

function renderRestaurants() {
  const container = document.getElementById("serviceRestaurantList");
  if (!container) return;
  container.innerHTML = serviceRestaurants.length ? serviceRestaurants.map(restaurant => {
    const dishes = serviceProducts.filter(product => product.restaurant_id === restaurant.id);
    return `<article class="bg-white rounded-2xl border border-slate-200 shadow-sm p-3"><div class="flex gap-3"><img src="${serviceEscape(restaurant.image_url || "")}" class="w-20 h-20 rounded-xl object-cover bg-slate-50" alt="${serviceEscape(restaurant.name)}"><div><h2 class="text-sm font-black text-slate-900">${serviceEscape(restaurant.name)}</h2><p class="text-[11px] text-slate-500 mt-1">${serviceEscape(restaurant.cuisine || "Restaurant menu")}</p><p class="text-[10px] text-emerald-700 font-black mt-1">${Number(restaurant.distance_km || 0).toFixed(1)} km · 25-45 min</p></div></div><div class="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">${dishes.length ? dishes.map(serviceProductCard).join("") : '<p class="text-xs text-slate-400 py-3">Menu is being updated.</p>'}</div></article>`;
  }).join("") : '<p class="text-xs text-slate-500">No restaurants available yet.</p>';
}

function loadMeatProducts() {
  db.collection("products").where("category", "==", "meat").onSnapshot(snapshot => {
    const container = document.getElementById("serviceMeatProducts");
    const products = [];
    snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    container.innerHTML = products.length ? products.map(serviceProductCard).join("") : '<p class="col-span-full text-xs text-slate-500">No fresh meat products available yet.</p>';
  }, error => console.error("Service meat listener error:", error));
}

async function submitServiceParcel(event) {
  event.preventDefault();
  const orderId = `PX-${Math.floor(100000 + Math.random() * 900000)}`;
  const pickup = document.getElementById("serviceParcelPickup").value.trim();
  const drop = document.getElementById("serviceParcelDrop").value.trim();
  const description = document.getElementById("serviceParcelDescription").value.trim();
  const order = {
    id: orderId,
    order_type: "PARCEL",
    customer_phone: JSON.parse(localStorage.getItem("quickdash_customer") || "null")?.phone || "guest",
    delivery_address: drop,
    parcel_pickup_address: pickup,
    parcel_drop_address: drop,
    parcel_description: description,
    items: [{ name: `Parcel: ${description}`, quantity: 1, price: 50, pickup_source: "parcel", pickup_source_name: "Parcel Pickup", pickup_source_address: pickup }],
    subtotal: 50,
    total_amount: 50,
    status: "PLACED",
    delivery_deadline_ms: Date.now() + 60 * 60 * 1000,
    payment_mode: "COD",
    delivery_otp: String(Math.floor(1000 + Math.random() * 9000)),
    created_at_ms: Date.now()
  };
  try {
    await db.collection("orders").doc(orderId).set({ ...order, created_at: firebase.firestore.FieldValue.serverTimestamp() });
    const status = document.getElementById("serviceParcelStatus");
    status.innerText = `Parcel ${orderId} created. A rider will be assigned shortly.`;
    status.classList.remove("hidden");
    event.target.reset();
  } catch (error) {
    console.error("Service parcel creation failed:", error);
    alert(`Unable to create parcel request: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", setupServicePage);
