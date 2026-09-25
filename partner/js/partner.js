const partnerState = {
  type: "restaurant",
  id: "",
  name: "",
  label: "",
  orders: [],
  unsubscribe: null,
  productUnsubscribe: null,
  profileAddress: ""
};

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
  db.collection("restaurants").onSnapshot(snapshot => {
    const select = document.getElementById("partnerRestaurantSelect");
    if (!select) return;
    const restaurants = [];
    snapshot.forEach(doc => restaurants.push({ id: doc.id, ...doc.data() }));
    select.innerHTML = restaurants.length
      ? restaurants.map((restaurant, index) => `<option value="${escapePartnerHtml(restaurant.id)}" data-partner-name="${escapePartnerHtml(restaurant.name)}">Restaurant ${index + 1} - ${escapePartnerHtml(restaurant.name)}${restaurant.address ? ` · ${escapePartnerHtml(restaurant.address)}` : ""}</option>`).join("")
      : '<option value="">No restaurants configured</option>';
    openRequestedPartnerFromUrl();
  }, error => console.error("Partner restaurant listener error:", error));
}

function openRequestedPartnerFromUrl() {
  const requestedId = new URLSearchParams(window.location.search).get("partnerId");
  if (!requestedId || document.getElementById("partnerDesk")?.classList.contains("hidden") === false) return;
  if (requestedId.startsWith("meat_partner_")) {
    setPartnerType("meat");
    const field = document.getElementById("meatPartnerName");
    if (field) field.value = requestedId;
  } else if (requestedId.startsWith("store_partner_")) {
    setPartnerType("store");
    const field = document.getElementById("storePartnerName");
    if (field) field.value = requestedId;
  } else {
    setPartnerType("restaurant");
    const field = document.getElementById("partnerRestaurantSelect");
    if (!field || !Array.from(field.options).some(option => option.value === requestedId)) return;
    field.value = requestedId;
  }
  openPartnerDesk();
}

function openPartnerDesk() {
  if (partnerState.type === "restaurant") {
    const select = document.getElementById("partnerRestaurantSelect");
    partnerState.id = select?.value || "";
    partnerState.name = select?.selectedOptions[0]?.dataset.partnerName || "Restaurant Partner";
    partnerState.label = select?.selectedOptions[0]?.textContent || partnerState.name;
    if (!partnerState.id) return alert("Select a restaurant first.");
  } else if (partnerState.type === "meat") {
    partnerState.id = document.getElementById("meatPartnerName")?.value || "meat_partner_1";
    partnerState.name = document.getElementById("meatPartnerName")?.selectedOptions[0]?.textContent || "Meat Partner";
    partnerState.label = partnerState.name;
  } else {
    partnerState.id = document.getElementById("storePartnerName")?.value || "store_partner_1";
    partnerState.name = document.getElementById("storePartnerName")?.selectedOptions[0]?.textContent || "Extra Store";
    partnerState.label = partnerState.name;
  }

  document.getElementById("partnerSetup")?.classList.add("hidden");
  document.getElementById("partnerDesk")?.classList.remove("hidden");
  document.getElementById("partnerDeskTitle").innerText = `${partnerState.label || partnerState.name} orders`;
  document.getElementById("partnerHeaderSubtitle").innerText = `${partnerState.label || partnerState.name} · live order desk`;
  document.getElementById("partnerProfileName").value = partnerState.name;
  startPartnerOrderListener();
  startPartnerProductListener();
  loadPartnerProfile();
}

function closePartnerDesk() {
  partnerState.unsubscribe?.();
  partnerState.unsubscribe = null;
  partnerState.productUnsubscribe?.();
  partnerState.productUnsubscribe = null;
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

function getPartnerProductQuery(product) {
  if (product.partner_id === partnerState.id || product.restaurant_id === partnerState.id) return true;
  if (partnerState.type === "restaurant") return product.pickup_source === "restaurant" && product.pickup_source_name === partnerState.name;
  if (partnerState.type === "meat") return product.pickup_source === "meat_partner" && !product.partner_id;
  return false;
}

function startPartnerProductListener() {
  partnerState.productUnsubscribe?.();
  partnerState.productUnsubscribe = db.collection("products").onSnapshot(snapshot => {
    const products = [];
    snapshot.forEach(doc => {
      const product = { id: doc.id, ...doc.data() };
      if (getPartnerProductQuery(product)) products.push(product);
    });
    renderPartnerProducts(products);
  }, error => console.error("Partner products listener error:", error));
}

function renderPartnerProducts(products) {
  const container = document.getElementById("partnerProductsContainer");
  if (!container) return;
  container.innerHTML = products.length ? products.map(product => `
    <article class="bg-white rounded-2xl p-3 border border-slate-200 shadow-sm flex gap-3">
      <img src="${escapePartnerHtml(product.image_url || "")}" class="w-16 h-16 rounded-xl object-contain bg-slate-50" onerror="this.style.display='none'" alt="">
      <div class="flex-1 min-w-0"><h3 class="text-xs font-black text-slate-900 truncate">${escapePartnerHtml(product.name)}</h3><p class="text-[11px] text-slate-500 mt-1">${escapePartnerHtml(product.qty_unit || "Unit")}</p><strong class="block text-sm text-emerald-700 mt-1">₹${Number(product.price || 0)}</strong><div class="flex gap-1 mt-2"><button type="button" onclick="editPartnerProduct('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black">Edit</button><button type="button" onclick="deletePartnerProduct('${escapePartnerHtml(product.id)}')" class="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 text-[10px] font-black">Delete</button></div></div>
    </article>
  `).join("") : '<p class="col-span-full text-center text-slate-400 py-8 text-xs">No products assigned to this partner.</p>';
}

function resetPartnerProductForm() {
  document.getElementById("partnerProductId").value = "";
  document.getElementById("partnerProductName").value = "";
  document.getElementById("partnerProductPrice").value = "";
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
      const dataUrl = canvas.toDataURL("image/webp", 0.82);
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
  const existing = productId ? await db.collection("products").doc(productId).get() : null;
  const oldProduct = existing?.exists ? existing.data() : {};
  const profileAddress = document.getElementById("partnerProfileAddress").value.trim();
  const product = {
    name: document.getElementById("partnerProductName").value.trim(),
    price: Number(document.getElementById("partnerProductPrice").value),
    qty_unit: document.getElementById("partnerProductUnit").value.trim() || "1 pc",
    image_url: document.getElementById("partnerProductImage").value.trim() || oldProduct.image_url || "",
    partner_id: partnerState.id,
    partner_name: partnerState.name,
    pickup_source: partnerState.type === "restaurant" ? "restaurant" : partnerState.type === "meat" ? "meat_partner" : "store_partner",
    pickup_source_name: partnerState.name,
    pickup_source_address: profileAddress || partnerState.profileAddress || `${partnerState.name} pickup desk`,
    category: oldProduct.category || (partnerState.type === "restaurant" ? "restaurants" : partnerState.type === "meat" ? "meat" : "home"),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  };
  try {
    if (productId) await db.collection("products").doc(productId).update(product);
    else await db.collection("products").add({ ...product, created_at: firebase.firestore.FieldValue.serverTimestamp() });
    resetPartnerProductForm();
    alert("Product saved.");
  } catch (error) {
    console.error("Partner product save failed:", error);
    alert(`Unable to save product: ${error.message}`);
  }
}

async function editPartnerProduct(productId) {
  const snapshot = await db.collection("products").doc(productId).get();
  if (!snapshot.exists) return;
  const product = snapshot.data();
  document.getElementById("partnerProductId").value = productId;
  document.getElementById("partnerProductName").value = product.name || "";
  document.getElementById("partnerProductPrice").value = product.price || "";
  document.getElementById("partnerProductUnit").value = product.qty_unit || "";
  document.getElementById("partnerProductImage").value = product.image_url || "";
  switchPartnerView("products");
  document.getElementById("partnerProductName").focus();
}

async function deletePartnerProduct(productId) {
  if (!confirm("Delete this product from your partner catalog?")) return;
  try {
    await db.collection("products").doc(productId).delete();
  } catch (error) {
    console.error("Partner product delete failed:", error);
    alert(`Unable to delete product: ${error.message}`);
  }
}

async function loadPartnerProfile() {
  try {
    const snapshot = await db.collection("partner_accounts").doc(partnerState.id).get();
    const data = snapshot.exists ? snapshot.data() : {};
    const address = data.address || "";
    partnerState.profileAddress = address;
    document.getElementById("partnerProfileAddress").value = address;
  } catch (error) {
    console.warn("Partner profile load failed:", error);
  }
}

async function savePartnerProfile(event) {
  event.preventDefault();
  const name = document.getElementById("partnerProfileName").value.trim() || partnerState.name;
  const address = document.getElementById("partnerProfileAddress").value.trim();
  try {
    await db.collection("partner_accounts").doc(partnerState.id).set({
      partner_id: partnerState.id,
      type: partnerState.type,
      name,
      address,
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    partnerState.name = name;
    partnerState.profileAddress = address;
    document.getElementById("partnerDeskTitle").innerText = `${name} orders`;
    alert("Location details saved.");
  } catch (error) {
    console.error("Partner profile save failed:", error);
    alert(`Unable to save location: ${error.message}`);
  }
}

function getPartnerItems(order) {
  if (!Array.isArray(order.items)) return [];
  return order.items.filter(item => {
    if (partnerState.type === "meat") return item.pickup_source === "meat_partner" && (item.partner_id === partnerState.id || !item.partner_id);
    if (partnerState.type === "store") return item.pickup_source === "store_partner" && item.partner_id === partnerState.id;
    return item.pickup_source === "restaurant" && (
      item.restaurant_id === partnerState.id ||
      item.restaurant_name === partnerState.name ||
      (!item.restaurant_id && item.pickup_source_name === partnerState.name)
    );
  });
}

function getPartnerStatus(order) {
  const key = partnerState.id;
  return order.partner_statuses?.[key] || order.status || "PLACED";
}

function renderPartnerStatus(order) {
  const status = getPartnerStatus(order);
  const statuses = [
    ["ACCEPTED", "Accept"],
    ["PREPARING", "Preparing"],
    ["PACKED", "Ready for pickup"]
  ];
  return `<div class="flex gap-1 overflow-x-auto pt-2">${statuses.map(([key, label]) => `<button type="button" onclick="setPartnerStatus('${escapePartnerHtml(order.id)}', '${key}')" class="px-2.5 py-1.5 rounded-lg border text-[10px] font-black shrink-0 ${status === key ? "bg-[#0B132B] text-white" : "bg-white text-slate-700"}">${status === key ? "✓ " : ""}${label}</button>`).join("")}</div>`;
}

function renderPartnerOrders() {
  const container = document.getElementById("partnerOrdersContainer");
  if (!container) return;
  const partnerOrders = partnerState.orders.map(order => ({ ...order, partnerItems: getPartnerItems(order) })).filter(order => order.partnerItems.length);
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
    const items = order.partnerItems.map(item => `${item.quantity}x ${escapePartnerHtml(item.name)} · ₹${Number(item.price || 0)}`).join("<br>");
    return `<article class="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
      <div class="flex items-start justify-between gap-3"><div><h3 class="text-sm font-black text-slate-900">${escapePartnerHtml(order.id)}</h3><p class="text-[11px] text-slate-500 mt-1">${escapePartnerHtml(order.customer_name || order.customer_phone || "Customer")}</p></div><span class="px-2 py-1 rounded-lg bg-blue-50 text-blue-700 text-[10px] font-black">${escapePartnerHtml(getPartnerStatus(order))}</span></div>
      <p class="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-2 mt-3">${items}</p>
      <p class="text-[11px] text-slate-500 mt-2">Pickup: ${escapePartnerHtml(order.delivery_address || "Customer delivery address")}</p>
      ${renderPartnerStatus(order)}
    </article>`;
  }).join("");
}

function startPartnerOrderListener() {
  partnerState.unsubscribe?.();
  partnerState.unsubscribe = db.collection("orders").onSnapshot(snapshot => {
    partnerState.orders = [];
    snapshot.forEach(doc => partnerState.orders.push({ id: doc.id, ...doc.data() }));
    partnerState.orders.sort((a, b) => Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0));
    renderPartnerOrders();
  }, error => {
    console.error("Partner orders listener error:", error);
    document.getElementById("partnerOrdersContainer").innerHTML = '<p class="text-center text-rose-500 py-10 text-xs">Unable to load partner orders. Check Firestore permissions.</p>';
  });
}

async function setPartnerStatus(orderId, status) {
  const key = partnerState.id;
  const order = partnerState.orders.find(item => item.id === orderId);
  const partnerStatuses = { ...(order?.partner_statuses || {}), [key]: status };
  try {
    await db.collection("orders").doc(orderId).update({
      status,
      partner_statuses: partnerStatuses,
      partner_updated_at_ms: Date.now(),
      updated_at: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Partner status update failed:", error);
    alert(`Unable to update order: ${error.message}`);
  }
}

document.addEventListener("DOMContentLoaded", loadPartnerRestaurants);
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
