const serviceType = new URLSearchParams(window.location.search).get("type") || "restaurant";
const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || "";
let serviceRestaurants = [];
let serviceProducts = [];
let restaurantCart = {};

function serviceEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function serviceProductCard(product) {
  return `<article class="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm"><div class="h-28 rounded-xl bg-slate-50 flex items-center justify-center p-2"><img src="${serviceEscape(product.image_url || "")}" alt="${serviceEscape(product.name)}" class="max-h-full max-w-full object-contain" onerror="this.style.display='none'"></div><h3 class="text-xs font-bold text-slate-900 mt-2 line-clamp-2">${serviceEscape(product.name || "Product")}</h3><p class="text-[10px] text-slate-500 mt-1">${serviceEscape(product.qty_unit || product.unit || "1 pc")}</p><strong class="block text-xs text-emerald-700 mt-1">₹${Number(product.price || 0)}</strong></article>`;
}

function setupServicePage() {
  const settings = {
    restaurant: ["Restaurants", "Restaurant menus near Mandapeta", "Choose a restaurant and browse its available dishes."],
    meat: ["Fresh Meat", "Chicken, meat & fish", "Fresh meat products available from partner stores."],
    parcel: ["Parcel Delivery", "Send a parcel across Mandapeta", "Add pickup and drop details to request a delivery rider."]
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
  if (restaurantId) {
    renderRestaurantMenu();
    return;
  }
  container.innerHTML = serviceRestaurants.length ? serviceRestaurants.map(restaurant => `<button type="button" onclick="openRestaurantMenu('${serviceEscape(restaurant.id)}')" class="w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-4 text-left flex items-center justify-between hover:border-amber-400 hover:shadow-md transition"><span><strong class="block text-sm font-black text-slate-900">${serviceEscape(restaurant.name)}</strong><span class="block text-[11px] text-slate-500 mt-1">${serviceEscape(restaurant.cuisine || "Restaurant menu")} · ${Number(restaurant.distance_km || 0).toFixed(1)} km</span></span><span class="px-3 py-1.5 rounded-xl bg-[#0B132B] text-white text-[10px] font-black">View menu ↗</span></button>`).join("") : '<p class="text-xs text-slate-500">No restaurants available yet.</p>';
}

function openRestaurantMenu(id) {
  window.location.href = `service.html?type=restaurant&restaurantId=${encodeURIComponent(id)}`;
}

function renderRestaurantMenu() {
  const restaurant = serviceRestaurants.find(item => item.id === restaurantId);
  if (!restaurant) return;
  document.getElementById("restaurantServiceView")?.classList.add("hidden");
  document.getElementById("restaurantMenuView")?.classList.remove("hidden");
  document.getElementById("serviceTitle").innerText = `${restaurant.name} Menu`;
  document.getElementById("serviceDescription").innerText = "Choose dishes and add them to your cart.";
  document.getElementById("restaurantMenuTitle").innerText = restaurant.name;
  document.getElementById("restaurantMenuMeta").innerText = `${restaurant.cuisine || "Restaurant menu"} · ${Number(restaurant.distance_km || 0).toFixed(1)} km · 25-45 min`;
  const products = serviceProducts.filter(product => product.restaurant_id === restaurantId);
  const container = document.getElementById("restaurantMenuProducts");
  container.innerHTML = products.length ? products.map(product => `<article class="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between"><div class="h-28 rounded-xl bg-slate-50 flex items-center justify-center p-2"><img src="${serviceEscape(product.image_url || "")}" alt="${serviceEscape(product.name)}" class="max-h-full max-w-full object-contain" onerror="this.style.display='none'"></div><h3 class="text-xs font-bold text-slate-900 mt-2 line-clamp-2">${serviceEscape(product.name)}</h3><p class="text-[10px] text-slate-500 mt-1">${serviceEscape(product.qty_unit || "1 plate")}</p><div class="flex items-center justify-between mt-2"><strong class="text-xs">₹${Number(product.price || 0)}</strong><button type="button" onclick="modifyRestaurantCart('${serviceEscape(product.id)}', 1)" class="px-3 py-1 rounded-lg border-2 border-emerald-600 text-emerald-700 text-xs font-black">ADD</button></div></article>`).join("") : '<p class="col-span-full text-xs text-slate-400 py-8 text-center">Menu is being updated.</p>';
}

function modifyRestaurantCart(productId, delta) {
  restaurantCart[productId] = Math.max(0, (restaurantCart[productId] || 0) + delta);
  if (!restaurantCart[productId]) delete restaurantCart[productId];
  const totalItems = Object.values(restaurantCart).reduce((sum, quantity) => sum + quantity, 0);
  const total = Object.entries(restaurantCart).reduce((sum, [id, quantity]) => sum + (Number(serviceProducts.find(item => item.id === id)?.price || 0) * quantity), 0);
  document.getElementById("serviceCartBar")?.classList.toggle("hidden", totalItems === 0);
  document.getElementById("serviceCartCount").innerText = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  document.getElementById("serviceCartTotal").innerText = `₹${total}`;
}

function continueServiceCart() {
  localStorage.setItem("myshopzy_pending_cart", JSON.stringify(restaurantCart));
  window.location.href = "index.html?checkout=1";
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
