const partnerState = {
  type: "restaurant",
  id: "",
  shopId: "",
  name: "",
  label: "",
  shopStatus: "",
  memberRole: "",
  shops: [],
  orders: [],
  products: [],
  orderBucket: "active",
  unsubscribe: null,
  productUnsubscribe: null,
  profileAddress: ""
};

const PARTNER_API_ROOT = `http://${window.location.hostname || "localhost"}:5000/api`;
const PARTNER_API_BASE_URL = `${PARTNER_API_ROOT}/partner`;

function getPartnerAccessToken() {
  return sessionStorage.getItem("admin_access_token")
    || localStorage.getItem("admin_access_token")
    || sessionStorage.getItem("myshopzy_admin_access_token")
    || localStorage.getItem("myshopzy_admin_access_token")
    || "";
}

async function partnerApiRequest(path, options = {}) {
  const headers = { Accept: "application/json" };
  const token = getPartnerAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${PARTNER_API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Partner API request failed (${response.status}).`);
  return payload?.data;
}

function escapePartnerHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setPartnerType(type) {
  partnerState.type = type;
  const restaurant = type === "restaurant";
  const meat = type === "meat";
  document.getElementById("restaurantPartnerField")?.classList.toggle("hidden", !restaurant);
  document.getElementById("meatPartnerField")?.classList.toggle("hidden", !meat);
  document.getElementById("storePartnerField")?.classList.toggle("hidden", type !== "store");
  document.getElementById("restaurantTypeButton")?.classList.toggle("bg-white", restaurant);
  document.getElementById("restaurantTypeButton")?.classList.toggle("text-slate-900", restaurant);
  document.getElementById("meatTypeButton")?.classList.toggle("bg-white", meat);
  document.getElementById("meatTypeButton")?.classList.toggle("text-slate-900", meat);
  document.getElementById("storeTypeButton")?.classList.toggle("bg-white", type === "store");
  document.getElementById("storeTypeButton")?.classList.toggle("text-slate-900", type === "store");
}

function loadPartnerRestaurants() {
  partnerApiRequest("/shops").then(shops => {
    partnerState.shops = Array.isArray(shops) ? shops : [];
    const selectors = [
      ["partnerRestaurantSelect", shop => shop.business_type === "RESTAURANT"],
      ["meatPartnerName", shop => shop.business_type === "MEAT"],
      ["storePartnerName", shop => ["GROCERY", "OTHER"].includes(shop.business_type)]
    ];
    selectors.forEach(([id, predicate]) => {
      const select = document.getElementById(id);
      if (!select) return;
      const matchingShops = partnerState.shops.filter(predicate);
      select.innerHTML = matchingShops.length
        ? matchingShops.map(shop => `<option value="${escapePartnerHtml(shop.id)}" data-partner-id="${escapePartnerHtml(shop.partner_id)}" data-partner-name="${escapePartnerHtml(shop.partner_name)}" data-shop-name="${escapePartnerHtml(shop.name)}" data-shop-status="${escapePartnerHtml(shop.status)}">${escapePartnerHtml(shop.name)} · ${escapePartnerHtml(shop.city)}</option>`).join("")
        : '<option value="">No authorized shops</option>';
    });
    openRequestedPartnerFromUrl();
  }).catch(error => {
    console.error("Partner shops could not be loaded:", error);
    ["partnerRestaurantSelect", "meatPartnerName", "storePartnerName"].forEach(id => {
      const select = document.getElementById(id);
      if (select) select.innerHTML = '<option value="">Sign in with an authorized partner account</option>';
    });
  });
}

async function loadPartnerProductCategories() {
  try {
    const response = await fetch(`${PARTNER_API_ROOT}/categories`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Unable to load categories.");
    const select = document.getElementById("partnerProductCategory");
    if (!select) return;
    select.innerHTML = '<option value="">No category</option>' + (payload.data || []).map(category =>
      `<option value="${escapePartnerHtml(category.id)}">${escapePartnerHtml(category.name)}</option>`
    ).join("");
  } catch (error) {
    console.error("Partner product categories could not be loaded:", error);
  }
}

async function openRequestedPartnerFromUrl() {
  const requestedId = new URLSearchParams(window.location.search).get("partnerId");
  if (!requestedId || document.getElementById("partnerDesk")?.classList.contains("hidden") === false) return;
  const shop = partnerState.shops.find(item => item.id === requestedId || item.partner_id === requestedId);
  if (!shop) return alert("This link does not match an authorized partner shop.");
  const type = shop.business_type === "RESTAURANT" ? "restaurant"
    : shop.business_type === "MEAT" ? "meat" : "store";
  setPartnerType(type);
  const selectorId = type === "restaurant" ? "partnerRestaurantSelect"
    : type === "meat" ? "meatPartnerName" : "storePartnerName";
  const select = document.getElementById(selectorId);
  if (select) select.value = shop.id;
  openPartnerDesk();
}

function openPartnerDesk() {
  const selectorId = partnerState.type === "restaurant" ? "partnerRestaurantSelect"
    : partnerState.type === "meat" ? "meatPartnerName" : "storePartnerName";
  const shopId = document.getElementById(selectorId)?.value || "";
  const shop = partnerState.shops.find(item => item.id === shopId);
  if (!shop) return alert("Select an authorized shop first.");

  partnerState.shopId = shop.id;
  partnerState.id = shop.partner_id;
  partnerState.name = shop.partner_name || "Partner";
  partnerState.label = shop.name || "Partner shop";
  partnerState.shopStatus = shop.status;

  document.getElementById("partnerSetup")?.classList.add("hidden");
  document.getElementById("partnerDesk")?.classList.remove("hidden");
  document.getElementById("partnerDeskTitle").innerText = `${partnerState.label || partnerState.name} orders`;
  document.getElementById("partnerHeaderSubtitle").innerText = `${partnerState.label || partnerState.name} · live order desk`;
  document.getElementById("partnerProfileName").value = partnerState.name;
  renderPartnerShopStatus();
  startPartnerOrderListener();
  startPartnerProductListener();
  loadPartnerProfile();
}

function closePartnerDesk() {
  partnerState.unsubscribe?.();
  partnerState.unsubscribe = null;
  partnerState.productUnsubscribe?.();
  partnerState.productUnsubscribe = null;
  partnerState.shopId = "";
  document.getElementById("partnerDesk")?.classList.add("hidden");
  document.getElementById("partnerSetup")?.classList.remove("hidden");
}

function switchPartnerView(view) {
  ["orders", "products", "profile"].forEach(name => {
    document.getElementById(`partner${name.charAt(0).toUpperCase()}${name.slice(1)}View`)?.classList.toggle("hidden", name !== view);
    const tab = document.getElementById(`partner${name.charAt(0).toUpperCase()}${name.slice(1)}Tab`);
    tab?.classList.toggle("bg-white", name === view);
    tab?.classList.toggle("text-slate-900", name === view);
    tab?.classList.toggle("shadow-sm", name === view);
  });
}

async function startPartnerProductListener() {
  try {
    const products = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products`);
    partnerState.products = Array.isArray(products) ? products : [];
    renderPartnerProducts(partnerState.products);
  } catch (error) {
    console.error("Partner product load failed:", error);
    document.getElementById("partnerProductsContainer").innerHTML = `<p class="col-span-full text-center text-rose-500 py-8 text-xs">${escapePartnerHtml(error.message)}</p>`;
  }
}

function renderPartnerProducts(products) {
  const container = document.getElementById("partnerProductsContainer");
  if (!container) return;
  container.innerHTML = products.length ? products.map(product => {
    const variant = product.variants?.find(item => item.is_default) || product.variants?.[0] || {};
    const imageUrl = product.images?.[0]?.public_url || "";
    return `
    <article class="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex gap-3">
      <img src="${escapePartnerHtml(imageUrl)}" class="w-16 h-16 rounded-xl object-contain bg-slate-50" onerror="this.style.display='none'" alt="">
      <div class="flex-1 min-w-0"><h3 class="text-xs font-black text-slate-900 truncate">${escapePartnerHtml(product.name)}</h3><p class="text-[11px] text-slate-500 mt-1">${escapePartnerHtml(variant.unit_label || "Unit")} · ${variant.is_active === false ? "Unavailable" : "Available"}</p><strong class="block text-sm text-emerald-700 mt-1">₹${Number(variant.price || 0)}</strong><div class="flex gap-1 mt-2"><button type="button" onclick="editPartnerProduct('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black">Edit</button><button type="button" onclick="deletePartnerProduct('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black">Deactivate</button></div><div class="flex items-center gap-2 mt-2"><label class="text-[10px] text-slate-500">Stock <input id="partnerStock_${escapePartnerHtml(variant.id || product.id)}" type="number" min="0" step="0.001" value="${Number(variant.quantity_on_hand || 0)}" class="w-20 ml-1 px-2 py-1 border border-slate-200 rounded-lg"></label><label class="flex items-center gap-1 text-[10px] text-slate-500"><input id="partnerAvailable_${escapePartnerHtml(variant.id || product.id)}" type="checkbox" ${variant.is_active === false ? "" : "checked"}>Available</label><button type="button" onclick="savePartnerInventory('${escapePartnerHtml(variant.id || "")}')" class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-[10px] font-black">Update</button></div></div>
    </article>
  `; }).join("") : '<p class="col-span-full text-center text-slate-400 py-8 text-xs">No products assigned to this partner.</p>';
}

async function savePartnerInventory(variantId) {
  if (!variantId) return alert("This product has no active variant to update.");
  const stockInput = document.getElementById(`partnerStock_${variantId}`);
  const availableInput = document.getElementById(`partnerAvailable_${variantId}`);
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/inventory/${encodeURIComponent(variantId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        quantity_on_hand: Number(stockInput.value),
        is_active: availableInput.checked
      })
    });
    await startPartnerProductListener();
  } catch (error) {
    console.error("Partner inventory update failed:", error);
    alert(`Unable to update inventory: ${error.message}`);
  }
}

function resetPartnerProductForm() {
  document.getElementById("partnerProductId").value = "";
  document.getElementById("partnerProductName").value = "";
  document.getElementById("partnerProductVariantName").value = "";
  document.getElementById("partnerProductCategory").value = "";
  document.getElementById("partnerProductSku").value = "";
  document.getElementById("partnerProductPrice").value = "";
  document.getElementById("partnerProductComparePrice").value = "";
  document.getElementById("partnerProductUnit").value = "";
  document.getElementById("partnerProductImage").value = "";
  document.getElementById("partnerProductFile").value = "";
  document.getElementById("partnerProductPreview").classList.add("hidden");
}

function handlePartnerImageFile(event) {
  const file = event.target.files?.[0];
  if (file) loadPartnerImageFile(file);
}

function loadPartnerImageFile(file) {
  if (!file.type.startsWith("image/")) return alert("Please choose an image file.");
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const maxSize = 800;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      let quality = 0.82;
      let dataUrl = canvas.toDataURL("image/webp", quality);
      while (dataUrl.length > 76000 && quality > 0.42) {
        quality = Math.max(0.42, quality - 0.1);
        dataUrl = canvas.toDataURL("image/webp", quality);
      }
      if (dataUrl.length > 80000) return alert("Please choose a smaller image.");
      document.getElementById("partnerProductImage").value = dataUrl;
      const preview = document.getElementById("partnerProductPreview");
      preview.src = dataUrl;
      preview.classList.remove("hidden");
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function copyPartnerConsoleLink() {
  const url = `${window.location.origin}${window.location.pathname}?partnerId=${encodeURIComponent(partnerState.id)}`;
  navigator.clipboard?.writeText(url).then(() => alert("Partner console link copied.")).catch(() => window.prompt("Copy this partner console link:", url));
}

async function savePartnerProduct(event) {
  event.preventDefault();
  const productId = document.getElementById("partnerProductId").value;
  const name = document.getElementById("partnerProductName").value.trim();
  const compareAtPrice = document.getElementById("partnerProductComparePrice").value;
  const product = {
    name,
    category_id: document.getElementById("partnerProductCategory").value || null,
    image_url: document.getElementById("partnerProductImage").value.trim() || null,
    variant: {
      name: document.getElementById("partnerProductVariantName").value.trim() || name,
      sku: document.getElementById("partnerProductSku").value.trim() || null,
      price: Number(document.getElementById("partnerProductPrice").value),
      compare_at_price: compareAtPrice === "" ? null : Number(compareAtPrice),
      unit_label: document.getElementById("partnerProductUnit").value.trim() || "1 pc",
      unit_quantity: 1,
      is_active: true
    }
  };
  try {
    const method = productId ? "PATCH" : "POST";
    const suffix = productId ? `/${encodeURIComponent(productId)}` : "";
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products${suffix}`, {
      method,
      body: JSON.stringify(product)
    });
    resetPartnerProductForm();
    await startPartnerProductListener();
    alert("Product saved.");
  } catch (error) {
    console.error("Partner product save failed:", error);
    alert(`Unable to save product: ${error.message}`);
  }
}

async function editPartnerProduct(productId) {
  const product = partnerState.products.find(item => item.id === productId);
  if (!product) return;
  const variant = product.variants?.find(item => item.is_default) || product.variants?.[0] || {};
  document.getElementById("partnerProductId").value = productId;
  document.getElementById("partnerProductName").value = product.name || "";
  document.getElementById("partnerProductCategory").value = product.category_id || "";
  document.getElementById("partnerProductVariantName").value = variant.name || "";
  document.getElementById("partnerProductSku").value = variant.sku || "";
  document.getElementById("partnerProductPrice").value = variant.price ?? "";
  document.getElementById("partnerProductComparePrice").value = variant.compare_at_price ?? "";
  document.getElementById("partnerProductUnit").value = variant.unit_label || "";
  document.getElementById("partnerProductImage").value = product.images?.[0]?.public_url || "";
  switchPartnerView("products");
  document.getElementById("partnerProductName").focus();
}

async function deletePartnerProduct(productId) {
  if (!confirm("Delete this product from your partner catalog?")) return;
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
    await startPartnerProductListener();
  } catch (error) {
    console.error("Partner product delete failed:", error);
    alert(`Unable to delete product: ${error.message}`);
  }
}

async function loadPartnerProfile() {
  try {
    const [shop, profile] = await Promise.all([
      partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}`),
      partnerApiRequest("/me")
    ]);
    partnerState.shopStatus = shop.status;
    partnerState.memberRole = profile.partners.find(item => item.partner_id === shop.partner_id)?.member_role || "";
    partnerState.profileAddress = shop.address_line1 || "";
    document.getElementById("partnerProfileName").value = shop.name || "";
    document.getElementById("partnerProfileAddress").value = partnerState.profileAddress;
    renderPartnerShopStatus();
  } catch (error) {
    console.warn("Partner shop profile load failed:", error);
  }
}

async function savePartnerProfile(event) {
  event.preventDefault();
  const name = document.getElementById("partnerProfileName").value.trim() || partnerState.label;
  const address = document.getElementById("partnerProfileAddress").value.trim();
  try {
    await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name, address_line1: address })
    });
    partnerState.label = name;
    partnerState.profileAddress = address;
    document.getElementById("partnerDeskTitle").innerText = `${name} orders`;
    document.getElementById("partnerHeaderSubtitle").innerText = `${name} · live order desk`;
    alert("Location details saved.");
  } catch (error) {
    console.error("Partner shop profile save failed:", error);
    alert(`Unable to save location: ${error.message}`);
  }
}

function renderPartnerShopStatus() {
  const button = document.getElementById("partnerShopStatusButton");
  if (!button) return;
  const canManageStatus = ["OWNER", "MANAGER"].includes(partnerState.memberRole);
  button.textContent = partnerState.shopStatus === "ACTIVE" ? "Pause shop" : "Open shop";
  button.disabled = !canManageStatus || !["ACTIVE", "PAUSED"].includes(partnerState.shopStatus);
  button.title = button.disabled ? "Only a partner owner or manager can change shop status." : `Current status: ${partnerState.shopStatus}`;
}

async function togglePartnerShopStatus() {
  const status = partnerState.shopStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    const result = await partnerApiRequest(`/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    partnerState.shopStatus = result.status;
    renderPartnerShopStatus();
  } catch (error) {
    console.error("Partner shop status update failed:", error);
    alert(`Unable to update shop status: ${error.message}`);
  }
}

function getPartnerStatus(order) {
  return order.status === "READY_FOR_PICKUP" ? "PACKED" : order.status || "PLACED";
}

function renderPartnerStatus(order) {
  const status = getPartnerStatus(order);
  const nextStatus = { PLACED: "ACCEPTED", ACCEPTED: "PREPARING", PREPARING: "PACKED" }[status];
  const statuses = [
    ["ACCEPTED", "Accept"],
    ["PREPARING", "Preparing"],
    ["PACKED", "Ready for pickup"]
  ];
  return `<div class="flex gap-1 overflow-x-auto pt-2">${statuses.map(([key, label]) => `<button type="button" ${key !== nextStatus ? "disabled" : ""} onclick="setPartnerStatus('${escapePartnerHtml(order.id)}', '${key}')" class="px-2.5 py-1.5 rounded-lg border text-[10px] font-black shrink-0 ${status === key ? "bg-[#0B132B] text-white" : "bg-white text-slate-700"} ${key !== nextStatus ? "opacity-40" : ""}">${status === key ? "✓ " : ""}${label}</button>`).join("")}</div>`;
}

function renderPartnerOrders() {
  const container = document.getElementById("partnerOrdersContainer");
  if (!container) return;
  const partnerOrders = partnerState.orders;
  const newCount = partnerOrders.filter(order => ["PLACED", "ACCEPTED"].includes(getPartnerStatus(order))).length;
  const preparingCount = partnerOrders.filter(order => getPartnerStatus(order) === "PREPARING").length;
  const readyCount = partnerOrders.filter(order => getPartnerStatus(order) === "PACKED").length;
  document.getElementById("partnerNewCount").innerText = newCount;
  document.getElementById("partnerPreparingCount").innerText = preparingCount;
  document.getElementById("partnerReadyCount").innerText = readyCount;

  if (!partnerOrders.length) {
    container.innerHTML = '<p class="text-center text-slate-400 py-10 text-xs">No partner orders yet.</p>';
    return;
  }
  container.innerHTML = partnerOrders.map(order => {
    const items = order.items.map(item => `${item.quantity}x ${escapePartnerHtml(item.name)} · ₹${Number(item.price || 0)}`).join("<br>");
    return `<article class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
      <div class="flex items-start justify-between gap-3"><div><h3 class="text-sm font-black text-slate-900">${escapePartnerHtml(order.order_number || order.id)}</h3><p class="text-[11px] text-slate-500 mt-1">${escapePartnerHtml(order.customer_name || order.customer_phone || "Customer")}</p></div><span class="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-black">${escapePartnerHtml(getPartnerStatus(order))}</span></div>
      <p class="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2 mt-3">${items}</p>
      <p class="text-[11px] text-slate-500 mt-2">Pickup: ${escapePartnerHtml(order.delivery_address || "Customer delivery address")}</p>
      ${renderPartnerStatus(order)}
    </article>`;
  }).join("");
}

async function startPartnerOrderListener(bucket = partnerState.orderBucket) {
  partnerState.orderBucket = bucket;
  try {
    const orders = await partnerApiRequest(`/orders?bucket=${encodeURIComponent(bucket)}&shop_id=${encodeURIComponent(partnerState.shopId)}`);
    partnerState.orders = Array.isArray(orders) ? orders : [];
    renderPartnerOrders();
  } catch (error) {
    console.error("Partner order API failed:", error);
    document.getElementById("partnerOrdersContainer").innerHTML = `<p class="text-center text-rose-500 py-10 text-xs">${escapePartnerHtml(error.message)}</p>`;
  }
}

async function setPartnerStatus(orderId, status) {
  try {
    await partnerApiRequest(`/orders/${encodeURIComponent(orderId)}/shops/${encodeURIComponent(partnerState.shopId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await startPartnerOrderListener();
  } catch (error) {
    console.error("Partner order status update failed:", error);
    alert(`Unable to update order: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", loadPartnerRestaurants);
document.addEventListener("DOMContentLoaded", loadPartnerProductCategories);
document.addEventListener("DOMContentLoaded", () => {
  const dropzone = document.getElementById("partnerImageDropzone");
  if (!dropzone) return;
  ["dragenter", "dragover"].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add("border-emerald-500", "bg-emerald-50");
  }));
  ["dragleave", "drop"].forEach(eventName => dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove("border-emerald-500", "bg-emerald-50");
  }));
  dropzone.addEventListener("drop", event => {
    const file = event.dataTransfer.files?.[0];
    if (file) loadPartnerImageFile(file);
  });
});
