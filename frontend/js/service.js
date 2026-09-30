const serviceType = new URLSearchParams(window.location.search).get("type") || "restaurant";
const serviceQuery = new URLSearchParams(window.location.search);
const selectedShopId = serviceQuery.get("shopId") || serviceQuery.get("restaurantId") || "";
const categoryId = new URLSearchParams(window.location.search).get("categorySlug")
  || new URLSearchParams(window.location.search).get("categoryId")
  || "";
const requestedCategoryName = new URLSearchParams(window.location.search).get("categoryName") || "";
const isLocalServiceHost = window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
const serviceApiBaseUrl = window.MYSHOPZY_API_BASE_URL || (isLocalServiceHost
  ? `http://${window.location.hostname || "localhost"}:5000/api`
  : `${window.location.origin}/api`);
let serviceRestaurants = [];
let serviceProducts = [];
let restaurantCart = {};
let restaurantMenuProducts = [];
let restaurantSearchTerm = "";
let restaurantRequestToken = 0;
let activeRestaurant = null;

function serviceEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function resolveRestaurantAvailability(restaurant) {
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

function renderRestaurantAvailabilityBadge(restaurant) {
  const availability = resolveRestaurantAvailability(restaurant);
  const toneClasses = availability.tone === "open"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : availability.tone === "closed"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-slate-200 bg-slate-50 text-slate-500";

  return `<span class="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black ${toneClasses}">${serviceEscape(availability.label)}</span>`;
}

async function getServiceApiData(path) {
  const response = await fetch(`${serviceApiBaseUrl}${path}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || "The service is temporarily unavailable.");
  }
  return result.data;
}

function normalizeServiceProduct(product) {
  const variant = product.variants?.find(item => item.is_default) || product.variants?.[0] || {};
  const image = product.images?.[0] || {};
  return {
    ...product,
    price: Number(product.price ?? variant.price ?? 0),
    image_url: product.image_url || image.public_url || "",
    qty_unit: product.unit_label || variant.unit_label || product.qty_unit || product.unit || "",
    restaurant_id: product.shop_id || product.restaurant_id || ""
  };
}

function serviceProductCard(product) {
  const quantity = restaurantCart[product.id] || 0;
  const selectedClass = quantity ? "is-selected" : "";
  return `<article class="category-product-card bg-white p-2.5 rounded-2xl shadow-sm flex flex-col justify-between ${selectedClass}">
    <div>
      <div class="h-28 rounded-xl bg-slate-50 flex items-center justify-center p-2"><img src="${serviceEscape(product.image_url || "")}" alt="${serviceEscape(product.name)}" class="max-h-full max-w-full object-contain" onerror="this.style.display='none'"></div>
      <h3 class="text-xs font-bold text-slate-900 mt-2 line-clamp-2">${serviceEscape(product.name || "Product")}</h3>
      <p class="text-[10px] text-slate-500 mt-1">${serviceEscape(product.qty_value ? `${product.qty_value} ${product.qty_unit || "g"}` : product.qty_unit || product.unit || "1 pc")}</p>
      <strong class="block text-xs text-emerald-700 mt-1">₹${Number(product.price || 0)}</strong>
    </div>
    <div class="mt-2">${quantity
      ? `<div class="flex items-center justify-between rounded-lg bg-emerald-700 px-2 py-1 text-xs font-black text-white"><button type="button" onclick="modifyServiceCart('${serviceEscape(product.id)}', -1)">-</button><span>${quantity}</span><button type="button" onclick="modifyServiceCart('${serviceEscape(product.id)}', 1)">+</button></div>`
      : `<button type="button" onclick="modifyServiceCart('${serviceEscape(product.id)}', 1)" class="w-full rounded-lg border-2 border-emerald-600 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-50">ADD</button>`}</div>
  </article>`;
}

function setupServicePage() {
  const settings = {
    restaurant: ["Restaurants", selectedShopId ? "Loading restaurant..." : "Restaurants near Mandapeta", selectedShopId ? "Loading restaurant menu..." : "Browse available restaurant menus."],
    meat: ["Fresh Meat", "Chicken, meat & fish", "Fresh meat products available from partner stores."],
    category: ["Shop by Category", requestedCategoryName || categoryId || "Products", "Products in this category."],
    parcel: ["Parcel Delivery", "Send a parcel across Mandapeta", "Add pickup and drop details to request a delivery rider."]
  }[serviceType] || [];
  document.getElementById("serviceEyebrow").innerText = settings[0] || "MyShopzy Service";
  document.getElementById("serviceTitle").innerText = settings[1] || "Service";
  document.getElementById("serviceDescription").innerText = settings[2] || "";
  if (serviceType === "restaurant") {
    const view = document.getElementById(selectedShopId ? "restaurantMenuView" : "restaurantServiceView");
    view?.classList.remove("hidden");
    if (selectedShopId) loadRestaurantMenu();
    else loadRestaurants();
  } else {
    document.getElementById(`${serviceType}ServiceView`)?.classList.remove("hidden");
  }
  if (serviceType === "meat") loadMeatProducts();
  if (serviceType === "category") loadCategoryProducts();
  if (serviceType === "parcel") document.getElementById("serviceParcelForm")?.addEventListener("submit", submitServiceParcel);
}

function loadCategoryProducts() {
  const container = document.getElementById("serviceCategoryProducts");
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  if (!categoryId) {
    container.removeAttribute("aria-busy");
    container.innerHTML = '<p class="col-span-full py-8 text-center text-xs text-slate-500">Category not found.</p>';
    return;
  }

  getServiceApiData(`/products?category=${encodeURIComponent(categoryId)}`).then(products => {
    serviceProducts = products.map(normalizeServiceProduct);
    container.removeAttribute("aria-busy");
    container.removeAttribute("role");
    container.removeAttribute("aria-label");
    container.innerHTML = serviceProducts.length
      ? serviceProducts.map(serviceProductCard).join("")
      : '<p class="col-span-full py-8 text-center text-xs text-slate-500">No products in this category yet.</p>';
  }).catch(error => {
    console.error("Category products listener error:", error);
    container.removeAttribute("aria-busy");
    container.removeAttribute("role");
    container.removeAttribute("aria-label");
    container.innerHTML = '<p class="col-span-full py-8 text-center text-xs text-rose-600">Unable to load products.</p>';
  });
}

async function loadRestaurants() {
  const container = document.getElementById("serviceRestaurantList");
  if (!container) return;
  container.setAttribute("aria-busy", "true");
  try {
    const shops = await getServiceApiData("/shops");
    serviceRestaurants = shops.filter(shop => String(shop.business_type || "").toUpperCase() === "RESTAURANT");
    container.removeAttribute("aria-busy");
    renderRestaurants();
  } catch (error) {
    console.error("Service restaurant loading failed:", error);
    container.removeAttribute("aria-busy");
    container.innerHTML = '<p class="col-span-full rounded-xl border border-rose-200 bg-white p-4 text-xs text-rose-600">Unable to load restaurants right now.</p>';
  }
}

function renderRestaurants() {
  const container = document.getElementById("serviceRestaurantList");
  if (!container) return;
  container.innerHTML = serviceRestaurants.length ? serviceRestaurants.map(restaurant => `
    <button type="button" onclick="openRestaurantMenu('${serviceEscape(restaurant.id)}')" class="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-amber-400 hover:shadow-md sm:p-4">
      <img src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=300&q=80" alt="" class="h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20">
      <span class="min-w-0 flex-1"><strong class="block truncate text-sm font-black text-slate-900">${serviceEscape(restaurant.name || "Restaurant")}</strong>
        ${restaurant.cuisine ? `<span class="mt-1 block truncate text-[11px] text-slate-600">${serviceEscape(restaurant.cuisine)}</span>` : ""}
        ${restaurant.description ? `<span class="mt-1 line-clamp-2 block text-[11px] text-slate-500">${serviceEscape(restaurant.description)}</span>` : ""}
        ${renderRestaurantAvailabilityBadge(restaurant)}</span>
      <span class="shrink-0 rounded-xl bg-[#0B132B] px-3 py-2 text-[10px] font-black text-white">View menu ↗</span>
    </button>`).join("") : '<p class="col-span-full rounded-xl border border-slate-200 bg-white p-4 text-center text-xs text-slate-500">No restaurants available yet.</p>';
}

function openRestaurantMenu(id) {
  window.location.href = `service.html?type=restaurant&shopId=${encodeURIComponent(id)}`;
}

async function loadRestaurantMenu() {
  const container = document.getElementById("restaurantMenuProducts");
  if (!container) return;
  const requestToken = ++restaurantRequestToken;
  restaurantMenuProducts = [];
  serviceProducts = [];
  restaurantCart = {};
  restaurantSearchTerm = "";
  activeRestaurant = null;
  const search = document.getElementById("restaurantMenuSearch");
  if (search) search.value = "";
  container.setAttribute("aria-busy", "true");

  try {
    const shops = await getServiceApiData("/shops");
    const restaurant = shops.find(shop => String(shop.id) === selectedShopId
      && String(shop.business_type || "").toUpperCase() === "RESTAURANT");
    if (!restaurant) throw new Error("Restaurant is unavailable.");
    const products = await getServiceApiData(`/shops/${encodeURIComponent(selectedShopId)}/products`);
    if (requestToken !== restaurantRequestToken) return;
    activeRestaurant = restaurant;
    restaurantMenuProducts = products.map(normalizeServiceProduct);
    renderRestaurantMenu(restaurant);
  } catch (error) {
    if (requestToken !== restaurantRequestToken) return;
    console.error("Restaurant menu loading failed:", error);
    document.getElementById("serviceTitle").innerText = "Restaurant menu";
    document.getElementById("serviceDescription").innerText = "The restaurant menu is temporarily unavailable.";
    container.removeAttribute("aria-busy");
    container.removeAttribute("role");
    container.removeAttribute("aria-label");
    container.innerHTML = `<p class="col-span-full rounded-xl border border-rose-200 bg-white py-8 text-center text-xs text-rose-600">${serviceEscape(error.message === "Restaurant is unavailable." ? error.message : "Unable to load this restaurant menu right now.")}</p>`;
  }
}

function renderRestaurantMenu(restaurant) {
  const availability = resolveRestaurantAvailability(restaurant);
  document.getElementById("serviceTitle").innerText = restaurant.name || "Restaurant menu";
  document.getElementById("serviceDescription").innerText = restaurant.description || restaurant.cuisine || "Browse this restaurant's menu.";
  document.getElementById("restaurantMenuTitle").innerText = restaurant.name || "Restaurant";
  document.getElementById("restaurantMenuMeta").innerText = [restaurant.cuisine, availability.label].filter(Boolean).join(" · ");
  const description = document.getElementById("restaurantMenuDescription");
  if (description) description.innerText = restaurant.description || "";
  renderRestaurantMenuProducts();
}

function searchRestaurantProducts(value) {
  restaurantSearchTerm = String(value || "").trim().toLocaleLowerCase();
  renderRestaurantMenuProducts();
}

function renderRestaurantMenuProducts() {
  const container = document.getElementById("restaurantMenuProducts");
  if (!container) return;
  const searchTerm = restaurantSearchTerm.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const products = restaurantMenuProducts.filter(product => {
    const categoryName = typeof product.category === "object" ? product.category?.name : product.category;
    const haystack = `${product.name || ""} ${product.description || ""} ${product.brand || ""} ${categoryName || ""}`
      .toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return haystack.includes(searchTerm);
  });
  container.removeAttribute("aria-busy");
  container.removeAttribute("role");
  container.removeAttribute("aria-label");
  container.innerHTML = products.length
    ? products.map(serviceProductCard).join("")
    : restaurantMenuProducts.length && searchTerm
      ? '<p class="col-span-full py-8 text-center text-xs text-slate-500">No products match your search.</p>'
      : '<p class="col-span-full py-8 text-center text-xs text-slate-500">No products available.</p>';
}

function modifyRestaurantCart(productId, delta) {
  restaurantCart[productId] = Math.max(0, (restaurantCart[productId] || 0) + delta);
  if (!restaurantCart[productId]) delete restaurantCart[productId];
  const totalItems = Object.values(restaurantCart).reduce((sum, quantity) => sum + quantity, 0);
  const total = Object.entries(restaurantCart).reduce((sum, [id, quantity]) => sum + (Number(restaurantMenuProducts.find(item => item.id === id)?.price || 0) * quantity), 0);
  document.getElementById("serviceCartBar")?.classList.toggle("hidden", totalItems === 0);
  document.getElementById("serviceCartCount").innerText = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  document.getElementById("serviceCartTotal").innerText = `₹${total}`;
}

function continueServiceCart() {
  localStorage.setItem("myshopzy_pending_cart", JSON.stringify(restaurantCart));
  window.location.href = "index.html?checkout=1";
}

function loadMeatProducts() {
  const container = document.getElementById("serviceMeatProducts");
  getServiceApiData("/products?category=meat").then(products => {
    serviceProducts = products.map(normalizeServiceProduct);
    container.innerHTML = serviceProducts.length
      ? serviceProducts.map(serviceProductCard).join("")
      : '<p class="col-span-full text-xs text-slate-500">No fresh meat products available yet.</p>';
  }).catch(error => {
    console.error("Meat products loading failed:", error);
    container.innerHTML = '<p class="col-span-full text-xs text-rose-600">Unable to load meat products.</p>';
  });
}

function modifyServiceCart(productId, delta) {
  restaurantCart[productId] = Math.max(0, (restaurantCart[productId] || 0) + delta);
  if (!restaurantCart[productId]) delete restaurantCart[productId];
  const totalItems = Object.values(restaurantCart).reduce((sum, quantity) => sum + quantity, 0);
  const total = Object.entries(restaurantCart).reduce((sum, [id, quantity]) => sum + (Number(serviceProducts.find(item => item.id === id)?.price || 0) * quantity), 0);
  const container = document.getElementById(serviceType === "category" ? "serviceCategoryProducts" : "serviceMeatProducts");
  if (container) container.innerHTML = serviceProducts.map(serviceProductCard).join("");
  document.getElementById("serviceCartBar")?.classList.toggle("hidden", totalItems === 0);
  document.getElementById("serviceCartCount").innerText = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  document.getElementById("serviceCartTotal").innerText = `₹${total}`;
}

async function submitServiceParcel(event) {
  event.preventDefault();
  const status = document.getElementById("serviceParcelStatus");
  status.innerText = "Parcel requests are not connected to the PostgreSQL backend yet.";
  status.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", setupServicePage);
