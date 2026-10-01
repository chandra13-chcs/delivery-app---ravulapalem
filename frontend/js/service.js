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
let restaurantListSearchTerm = "";
let expandedRestaurantCategories = new Set();
let collapsedSearchCategories = new Set();
let bookmarkedRestaurantProducts = new Set();
let restaurantRequestToken = 0;
let activeRestaurant = null;

function serviceEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function resolveRestaurantAvailability(restaurant) {
  const openValue = restaurant?.is_open ?? restaurant?.is_open_now;
  if (typeof openValue === "boolean") {
    return { label: openValue ? "Open" : "Closed", tone: openValue ? "open" : "closed" };
  }
  const closedValue = restaurant?.is_closed ?? restaurant?.closed;
  if (typeof closedValue === "boolean") {
    return { label: closedValue ? "Closed" : "Open", tone: closedValue ? "closed" : "open" };
  }
  const candidates = [
    restaurant?.status,
    restaurant?.shop_status,
    restaurant?.availability_status,
    restaurant?.current_status,
    restaurant?.availability?.status,
    restaurant?.hours?.status
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return { label: candidate ? "Open" : "Closed", tone: candidate ? "open" : "closed" };
    }

    if (typeof candidate === "string") {
      const normalized = candidate.trim().toUpperCase();
      if (["OPEN", "AVAILABLE", "ONLINE", "READY"].includes(normalized)) {
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
    restaurant_id: product.shop_id || product.restaurant_id || "",
    category_name: product.category_name || (typeof product.category === "object" ? product.category?.name : product.category) || ""
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
  const searchTerm = normalizeServiceSearch(restaurantListSearchTerm);
  const restaurants = serviceRestaurants.filter(restaurant => {
    const haystack = normalizeServiceSearch([restaurant.name, restaurant.cuisine, restaurant.description,
      restaurant.location, restaurant.locality, restaurant.address].filter(Boolean).join(" "));
    return haystack.includes(searchTerm);
  });
  container.innerHTML = restaurants.length ? restaurants.map(restaurant => {
    const imageUrl = restaurant.image_url || restaurant.cover_image_url || restaurant.logo_url || restaurant.images?.[0]?.public_url || "";
    const location = restaurant.location || restaurant.locality || restaurant.address || "";
    const distance = restaurant.distance_km ?? restaurant.shop_distance_km;
    const rating = Number(restaurant.rating ?? restaurant.average_rating);
    const delivery = resolveRestaurantDelivery(restaurant);
    return `<button type="button" onclick="openRestaurantMenu('${serviceEscape(restaurant.id)}')" class="restaurant-card">
      <span class="restaurant-card-image">${imageUrl ? `<img src="${serviceEscape(imageUrl)}" alt="${serviceEscape(restaurant.name || "Restaurant")}" onerror="this.remove()">` : `<span class="restaurant-image-placeholder"><span>MyShopzy</span></span>`}</span>
      <span class="restaurant-card-content"><span class="restaurant-card-title-row"><strong>${serviceEscape(restaurant.name || "Restaurant")}</strong>${Number.isFinite(rating) && rating > 0 ? `<span class="restaurant-rating">★ ${rating.toFixed(1)}</span>` : ""}</span>
        ${restaurant.cuisine ? `<span class="restaurant-card-cuisine">${serviceEscape(restaurant.cuisine)}</span>` : ""}
        ${location || Number.isFinite(Number(distance)) ? `<span class="restaurant-card-meta">${location ? serviceEscape(location) : ""}${location && Number.isFinite(Number(distance)) ? " · " : ""}${Number.isFinite(Number(distance)) ? `${Number(distance).toFixed(1)} km` : ""}</span>` : ""}
        ${restaurant.description ? `<span class="restaurant-card-description">${serviceEscape(restaurant.description)}</span>` : ""}
        <span class="restaurant-card-footer">${renderRestaurantAvailabilityBadge(restaurant)}${delivery ? `<span class="restaurant-delivery-status">${serviceEscape(delivery)}</span>` : ""}<span class="restaurant-view-menu">View menu <span aria-hidden="true">↗</span></span></span>
      </span>
    </button>`;
  }).join("") : `<p class="restaurant-empty-state">${serviceRestaurants.length && searchTerm ? "No restaurants match your search." : "No restaurants available yet."}</p>`;
}

function normalizeServiceSearch(value) {
  return String(value || "").trim().toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function searchRestaurants(value) {
  restaurantListSearchTerm = value;
  renderRestaurants();
}

function resolveRestaurantDelivery(restaurant) {
  const value = restaurant?.delivery_status ?? restaurant?.delivery_availability ?? restaurant?.is_delivering;
  if (typeof value === "boolean") return value ? "Delivery available" : "Delivery unavailable";
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (["AVAILABLE", "DELIVERING", "ACTIVE", "OPEN"].includes(normalized)) return "Delivery available";
    if (["UNAVAILABLE", "NOT_DELIVERING", "CLOSED", "PAUSED"].includes(normalized)) return "Delivery unavailable";
  }
  return "";
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
  expandedRestaurantCategories = new Set();
  collapsedSearchCategories = new Set();
  try {
    const savedProductIds = JSON.parse(localStorage.getItem("myshopzy_saved_restaurant_products") || "[]");
    bookmarkedRestaurantProducts = new Set(Array.isArray(savedProductIds) ? savedProductIds.map(String) : []);
  } catch {
    bookmarkedRestaurantProducts = new Set();
  }
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
    restaurantMenuProducts = products
      .map(product => ({ ...normalizeServiceProduct(product), is_restaurant_product: true }))
      .filter(product => !product.restaurant_id || String(product.restaurant_id) === String(selectedShopId));
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
  const facts = document.getElementById("restaurantMenuFacts");
  const location = restaurant.location || restaurant.locality || restaurant.address || "";
  const distance = restaurant.distance_km ?? restaurant.shop_distance_km;
  const rating = Number(restaurant.rating ?? restaurant.average_rating);
  const factItems = [
    location ? `<span>${serviceEscape(location)}</span>` : "",
    Number.isFinite(Number(distance)) ? `<span>${Number(distance).toFixed(1)} km away</span>` : "",
    Number.isFinite(rating) && rating > 0 ? `<span class="restaurant-rating">★ ${rating.toFixed(1)}</span>` : ""
  ].filter(Boolean);
  if (facts) facts.innerHTML = factItems.join("");
  renderRestaurantMenuProducts();
}

function searchRestaurantProducts(value) {
  restaurantSearchTerm = String(value || "").trim().toLocaleLowerCase();
  collapsedSearchCategories = new Set();
  renderRestaurantMenuProducts();
}

function restaurantCategoryFor(product) {
  const category = product.category;
  if (category && typeof category === "object") return category.name || category.slug || "Uncategorized";
  return product.category_name || category || "Uncategorized";
}

function restaurantFoodType(product, categoryName) {
  const value = product.food_type ?? product.dietary_type ?? product.food_preference ?? product.is_vegetarian ?? product.is_veg;
  if (typeof value === "boolean") return value ? "veg" : "non-veg";
  const normalized = String(value || "").trim().toLowerCase();
  if (["veg", "vegetarian", "true"].includes(normalized)) return "veg";
  if (["non-veg", "non veg", "nonvegetarian", "non-vegetarian", "false"].includes(normalized)) return "non-veg";
  if (/\bnon[ -]?veg\b/i.test(categoryName)) return "non-veg";
  if (/\bveg\b/i.test(categoryName)) return "veg";
  return "";
}

function restaurantProductCard(product) {
  const quantity = restaurantCart[product.id] || 0;
  const imageUrl = product.image_url || "../assets/audio/categories/logo.png";
  const foodType = restaurantFoodType(product, restaurantCategoryFor(product));
  const indicator = foodType ? `<span class="food-type-indicator ${foodType === "veg" ? "is-veg" : "is-non-veg"}" aria-label="${foodType === "veg" ? "Vegetarian" : "Non-vegetarian"}"><i></i></span>` : "";
  const productId = String(product.id || "");
  const isBookmarked = bookmarkedRestaurantProducts.has(productId);
  return `<article class="restaurant-product" id="product-${encodeURIComponent(productId)}">
    <div class="restaurant-product-copy">${indicator}<h3>${serviceEscape(product.name || "Product")}</h3>
      ${product.description ? `<p class="restaurant-product-description">${serviceEscape(product.description)}</p>` : ""}
      <strong class="restaurant-product-price">₹${Number(product.price || 0).toLocaleString("en-IN")}</strong>
      <div class="restaurant-product-actions">
        <button type="button" class="restaurant-item-action ${isBookmarked ? "is-bookmarked" : ""}" data-product-id="${serviceEscape(productId)}" onclick="toggleRestaurantBookmark(this)" aria-label="${isBookmarked ? "Remove bookmark" : "Bookmark"} ${serviceEscape(product.name || "product")}" aria-pressed="${isBookmarked}" title="${isBookmarked ? "Remove bookmark" : "Bookmark product"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.75A1.75 1.75 0 0 1 8.25 3h7.5a1.75 1.75 0 0 1 1.75 1.75V21l-6-3.7-6 3.7z"></path></svg></button>
        <button type="button" class="restaurant-item-action" data-product-id="${serviceEscape(productId)}" onclick="shareRestaurantProduct(this)" aria-label="Share ${serviceEscape(product.name || "product")}" title="Share product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-5 5 5-5 5 5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"></path></svg></button>
      </div>
    </div>
    <div class="restaurant-product-visual"><div class="restaurant-product-image"><img class="${product.image_url ? "" : "is-fallback"}" src="${serviceEscape(imageUrl)}" alt="${serviceEscape(product.name || "Product")}" onerror="this.onerror=null;this.src='../assets/audio/categories/logo.png';this.classList.add('is-fallback')"></div>
      <div class="restaurant-product-action">${quantity
        ? `<div class="restaurant-quantity-control"><button type="button" onclick="modifyRestaurantCart('${serviceEscape(product.id)}', -1)" aria-label="Remove one ${serviceEscape(product.name || "product")}">−</button><span>${quantity}</span><button type="button" onclick="modifyRestaurantCart('${serviceEscape(product.id)}', 1)" aria-label="Add one ${serviceEscape(product.name || "product")}">+</button></div>`
        : `<button type="button" onclick="modifyRestaurantCart('${serviceEscape(product.id)}', 1)" class="restaurant-add-button">ADD <span>+</span></button>`}</div>
    </div>
  </article>`;
}

function toggleRestaurantBookmark(button) {
  const productId = button?.dataset.productId;
  if (!productId) return;
  if (bookmarkedRestaurantProducts.has(productId)) bookmarkedRestaurantProducts.delete(productId);
  else bookmarkedRestaurantProducts.add(productId);
  try {
    localStorage.setItem("myshopzy_saved_restaurant_products", JSON.stringify([...bookmarkedRestaurantProducts]));
  } catch {
    announceRestaurantAction("Bookmark changed for this visit, but could not be saved.");
  }
  const isBookmarked = bookmarkedRestaurantProducts.has(productId);
  button.classList.toggle("is-bookmarked", isBookmarked);
  button.setAttribute("aria-pressed", String(isBookmarked));
  button.setAttribute("aria-label", `${isBookmarked ? "Remove bookmark" : "Bookmark"} ${button.closest(".restaurant-product")?.querySelector("h3")?.textContent || "product"}`);
  button.title = isBookmarked ? "Remove bookmark" : "Bookmark product";
}

async function shareRestaurantProduct(button) {
  const product = restaurantMenuProducts.find(item => String(item.id) === button?.dataset.productId);
  if (!product) return;
  const shareUrl = new URL(window.location.href);
  shareUrl.hash = `product-${encodeURIComponent(product.id)}`;
  const shareData = {
    title: product.name || "MyShopzy menu item",
    text: `View ${product.name || "this item"} on MyShopzy`,
    url: shareUrl.href
  };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl.href);
      announceRestaurantAction("Product link copied.");
    } else announceRestaurantAction("Sharing is unavailable in this browser.");
  } catch (error) {
    if (error.name !== "AbortError") announceRestaurantAction("Unable to share this product right now.");
  }
}

function announceRestaurantAction(message) {
  let status = document.getElementById("restaurantActionStatus");
  if (!status) {
    status = document.createElement("span");
    status.id = "restaurantActionStatus";
    status.className = "sr-only";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.getElementById("restaurantMenuView")?.append(status);
  }
  status.textContent = message;
}

function renderRestaurantMenuProducts() {
  const container = document.getElementById("restaurantMenuProducts");
  if (!container) return;
  const searchTerm = normalizeServiceSearch(restaurantSearchTerm);
  const products = restaurantMenuProducts.filter(product => {
    const haystack = normalizeServiceSearch(`${product.name || ""} ${product.description || ""} ${product.brand || ""} ${restaurantCategoryFor(product)}`);
    return haystack.includes(searchTerm);
  });
  const groupedProducts = new Map();
  products.forEach(product => {
    const categoryName = restaurantCategoryFor(product);
    if (!groupedProducts.has(categoryName)) groupedProducts.set(categoryName, []);
    groupedProducts.get(categoryName).push(product);
  });
  const groups = [...groupedProducts.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (!searchTerm && expandedRestaurantCategories.size === 0 && groups.length) expandedRestaurantCategories.add(groups[0][0]);
  container.removeAttribute("aria-busy");
  container.removeAttribute("role");
  container.removeAttribute("aria-label");
  container.innerHTML = groups.length
    ? groups.map(([categoryName, categoryProducts]) => {
      const categoryExpanded = searchTerm ? !collapsedSearchCategories.has(categoryName) : expandedRestaurantCategories.has(categoryName);
      return `<section class="restaurant-category ${categoryExpanded ? "is-expanded" : ""}">
        <button type="button" class="restaurant-category-toggle" data-category-key="${serviceEscape(categoryName)}" onclick="toggleRestaurantCategory(this)" aria-expanded="${Boolean(categoryExpanded)}"><span>${serviceEscape(categoryName)}</span><span class="restaurant-category-count">${categoryProducts.length}</span><span class="restaurant-category-chevron" aria-hidden="true"></span></button>
        <div class="restaurant-category-panel" ${categoryExpanded ? "" : "inert"}><div class="restaurant-category-items">${categoryProducts.map(restaurantProductCard).join("")}</div></div>
      </section>`;
    }).join("")
    : restaurantMenuProducts.length && searchTerm
      ? '<p class="restaurant-empty-state">No products match your search.</p>'
      : '<p class="restaurant-empty-state">No products available.</p>';
}

function toggleRestaurantCategory(button) {
  const categoryName = button?.dataset.categoryKey;
  if (!categoryName) return;
  const category = button.closest(".restaurant-category");
  const panel = category?.querySelector(".restaurant-category-panel");
  if (!category || !panel) return;
  const isExpanded = !category.classList.contains("is-expanded");
  if (restaurantSearchTerm && collapsedSearchCategories.has(categoryName)) collapsedSearchCategories.delete(categoryName);
  else if (restaurantSearchTerm) collapsedSearchCategories.add(categoryName);
  else if (expandedRestaurantCategories.has(categoryName)) expandedRestaurantCategories.delete(categoryName);
  else expandedRestaurantCategories.add(categoryName);
  category.classList.toggle("is-expanded", isExpanded);
  button.setAttribute("aria-expanded", String(isExpanded));
  panel.toggleAttribute("inert", !isExpanded);
}

function modifyRestaurantCart(productId, delta) {
  restaurantCart[productId] = Math.max(0, (restaurantCart[productId] || 0) + delta);
  if (!restaurantCart[productId]) delete restaurantCart[productId];
  const totalItems = Object.values(restaurantCart).reduce((sum, quantity) => sum + quantity, 0);
  const total = Object.entries(restaurantCart).reduce((sum, [id, quantity]) => sum + (Number(restaurantMenuProducts.find(item => item.id === id)?.price || 0) * quantity), 0);
  renderRestaurantMenuProducts();
  document.getElementById("serviceCartBar")?.classList.toggle("hidden", totalItems === 0);
  const count = document.getElementById("serviceCartCount");
  const totalLabel = document.getElementById("serviceCartTotal");
  if (count) count.innerText = `${totalItems} item${totalItems === 1 ? "" : "s"}`;
  if (totalLabel) totalLabel.innerText = `₹${total.toLocaleString("en-IN")}`;
}

function continueServiceCart() {
  const selectedProducts = restaurantMenuProducts.filter(product => restaurantCart[product.id]);
  localStorage.setItem("myshopzy_pending_cart", JSON.stringify({ items: restaurantCart, products: selectedProducts }));
  window.location.href = "index.html?cart=1";
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
