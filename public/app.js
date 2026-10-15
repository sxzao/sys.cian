const inventoryBody = document.querySelector('#inventory-body');
const lowStockList = document.querySelector('#low-stock-list');
const transactionProduct = document.querySelector('#transaction-product');
const notice = document.querySelector('#notice');
const searchInput = document.querySelector('#search-input');
let products = [];
let currentUser = null;
let noticeTimer;
let historyOffset = 0;
const historyPageSize = 100;

const pageContent = {
  inventory: {
    title: 'Inventory',
    intro: 'A little check-in on everything that keeps the waffles coming.'
  },
  activity: {
    title: 'Stock activity',
    intro: 'Record deliveries, daily use, and other stock changes.'
  },
  alerts: {
    title: 'Low stock',
    intro: 'See which items are at or below their minimum stock level.'
  },
  history: {
    title: 'Inventory history',
    intro: 'Review stock movements and the people who recorded them.'
  },
  reports: {
    title: 'Inventory reports',
    intro: 'A helpful summary of current stock and recent activity.'
  },
  users: {
    title: 'Team access',
    intro: 'Manage who can access your inventory and what they can do.'
  }
};

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

function showPage(page, updateHistory = false) {
  const pageName = Object.hasOwn(pageContent, page) ? page : 'inventory';
  if (!isAdmin() && ['reports', 'users'].includes(pageName)) return showPage('inventory');
  document.querySelectorAll('[data-page-view]').forEach((view) => {
    view.hidden = view.dataset.pageView !== pageName;
  });
  document.querySelectorAll('.nav-item[data-page]').forEach((link) => {
    const isActive = link.dataset.page === pageName;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#page-title').textContent = pageContent[pageName].title;
  document.querySelector('#page-intro').textContent = pageContent[pageName].intro;
  document.querySelector('#open-product-form').hidden = pageName !== 'inventory' || !isAdmin();

  if (updateHistory && window.location.hash !== `#${pageName}`) {
    window.history.pushState(null, '', `#${pageName}`);
  }
  if (pageName === 'history') loadHistory();
  if (pageName === 'reports' && isAdmin()) loadReports();
  if (pageName === 'users' && isAdmin()) loadUsers();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function showNotice(message, kind = 'success') {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

function showLogin(message = '') {
  currentUser = null;
  document.querySelector('#app-shell').hidden = true;
  document.querySelector('#login-screen').hidden = false;
  const error = document.querySelector('#login-error');
  error.textContent = message;
  error.hidden = !message;
}

function showApplication(user) {
  currentUser = user;
  document.querySelector('#login-screen').hidden = true;
  document.querySelector('#app-shell').hidden = false;
  document.querySelectorAll('.admin-only').forEach((element) => {
    element.hidden = !isAdmin();
  });
  document.querySelector('#user-label').textContent = `${user.name} · ${user.role === 'admin' ? 'Administrator' : 'Staff'}`;
  document.querySelector('#user-avatar').textContent = user.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelector('#user-avatar').setAttribute('aria-label', user.role === 'admin' ? 'Administrator' : 'Staff');
  showPage(window.location.hash.slice(1));
}

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) }
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    if (response.status === 401 && currentUser) showLogin('Your session has expired. Please sign in again.');
    throw error;
  }
  return data;
}

function formatQuantity(quantity) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(quantity));
}

function renderInventory() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = products.filter((product) =>
    `${product.name} ${product.category} ${product.unit}`.toLowerCase().includes(query)
  );

  inventoryBody.innerHTML = filtered.length
    ? filtered.map((product) => {
      const isLow = Number(product.quantity) <= Number(product.min_stock);
      const actions = isAdmin()
        ? `<button class="text-button product-edit" data-id="${product.id}" type="button">Edit</button>
           <button class="text-button product-toggle" data-id="${product.id}" data-active="${product.is_active ? 'true' : 'false'}" type="button">${product.is_active ? 'Deactivate' : 'Reactivate'}</button>`
        : '';
      return `<tr class="${product.is_active ? '' : 'inactive-row'}">
        <td>${escapeHTML(product.name)}${product.is_active ? '' : '<span class="unit-label">Deactivated</span>'}</td>
        <td>${escapeHTML(product.category)}</td>
        <td><span class="stock-number">${formatQuantity(product.quantity)}</span><span class="unit-label">${escapeHTML(product.unit)}</span></td>
        <td>${formatQuantity(product.min_stock)}<span class="unit-label">${escapeHTML(product.unit)}</span></td>
        <td><span class="badge ${isLow ? 'badge-low' : 'badge-good'}">${isLow ? 'Running low' : 'In good shape'}</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="6" class="empty-state">${products.length ? 'No items match your search.' : 'No items yet. Add your first pantry item to get started.'}</td></tr>`;

  const activeProducts = products.filter((product) => product.is_active);
  const lowItems = activeProducts.filter((product) => Number(product.quantity) <= Number(product.min_stock));
  document.querySelector('#stat-items').textContent = activeProducts.length;
  document.querySelector('#stat-healthy').textContent = activeProducts.length - lowItems.length;
  document.querySelector('#stat-low').textContent = lowItems.length;
  document.querySelector('#nav-low-count').textContent = lowItems.length;
  document.querySelector('#item-count').textContent = `${filtered.length} of ${products.length} ${products.length === 1 ? 'item' : 'items'}`;

  lowStockList.innerHTML = lowItems.length
    ? lowItems.map((product) => `<li class="low-stock-item">
        <span class="low-stock-name">${escapeHTML(product.name)}<span class="low-stock-category">${escapeHTML(product.category)}</span></span>
        <span class="low-stock-quantity">${formatQuantity(product.quantity)} / ${formatQuantity(product.min_stock)} ${escapeHTML(product.unit)}</span>
      </li>`).join('')
    : '<li class="empty-list">All stocked up — lovely!</li>';

  const currentSelection = transactionProduct.value;
  transactionProduct.innerHTML = '<option value="">Choose an item</option>' + activeProducts.map((product) =>
    `<option value="${product.id}">${escapeHTML(product.name)} (${formatQuantity(product.quantity)} ${escapeHTML(product.unit)})</option>`
  ).join('');
  if (activeProducts.some((product) => String(product.id) === currentSelection)) {
    transactionProduct.value = currentSelection;
  }
}

async function loadInventory() {
  inventoryBody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading your inventory...</td></tr>';
  try {
    const includeInactive = isAdmin() && document.querySelector('#show-inactive').checked;
    products = await request(`/api/products${includeInactive ? '?include_inactive=true' : ''}`);
    renderInventory();
  } catch (error) {
    inventoryBody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
    document.querySelector('#item-count').textContent = 'Could not load items';
    if (error.status !== 401) showNotice(error.message, 'error');
  }
}

async function loadHistory() {
  const body = document.querySelector('#history-body');
  body.innerHTML = '<tr><td colspan="7" class="empty-state">Loading history...</td></tr>';
  try {
    const rows = await request(`/api/history?limit=${historyPageSize}&offset=${historyOffset}`);
    document.querySelector('#history-previous').disabled = historyOffset === 0;
    document.querySelector('#history-next').disabled = rows.length < historyPageSize;
    body.innerHTML = rows.length ? rows.map((item) => `<tr>
      <td>${escapeHTML(new Date(item.created_at).toLocaleString())}</td>
      <td>${escapeHTML(item.product_name)}</td>
      <td>${escapeHTML(({ stock_in: 'Stock in', stock_out: 'Stock out', adjustment: 'Adjustment' })[item.type])}</td>
      <td>${item.type === 'adjustment' && item.quantity_before !== null
        ? `${formatQuantity(item.quantity_before)} → ${formatQuantity(item.quantity_after)} ${escapeHTML(item.unit)}`
        : `${formatQuantity(item.quantity)} ${escapeHTML(item.unit)}`}</td>
      <td>${formatQuantity(item.quantity_after)} ${escapeHTML(item.unit)}</td>
      <td>${escapeHTML(item.user_name || 'System')}</td>
      <td>${escapeHTML(item.notes || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty-state">No stock activity recorded yet.</td></tr>';
  } catch (error) {
    body.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
  }
}

async function loadReports() {
  try {
    const [summary, lowStock] = await Promise.all([
      request('/api/reports/summary'),
      request('/api/reports/low-stock')
    ]);
    document.querySelector('#report-summary').innerHTML = [
      ['Active products', summary.active_products],
      ['Low-stock products', summary.low_stock_products || 0],
      ['Stock-in records', summary.stock_in_count || 0],
      ['Stock-out records', summary.stock_out_count || 0],
      ['Adjustments', summary.adjustment_count || 0],
      ['All movements', summary.transaction_count || 0]
    ].map(([label, value]) => `<article class="report-stat"><span>${escapeHTML(label)}</span><strong>${formatQuantity(value || 0)}</strong></article>`).join('');
    document.querySelector('#report-low-stock').innerHTML = lowStock.length
      ? lowStock.map((product) => `<tr><td>${escapeHTML(product.name)}</td><td>${escapeHTML(product.category)}</td><td>${formatQuantity(product.quantity)} ${escapeHTML(product.unit)}</td><td>${formatQuantity(product.min_stock)} ${escapeHTML(product.unit)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty-state">No active items are at or below their minimum stock.</td></tr>';
  } catch (error) {
    document.querySelector('#report-summary').innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

async function loadUsers() {
  const body = document.querySelector('#users-body');
  body.innerHTML = '<tr><td colspan="3" class="empty-state">Loading team...</td></tr>';
  try {
    const users = await request('/api/users');
    body.innerHTML = users.map((user) => `<tr><td>${escapeHTML(user.name)}</td><td>${escapeHTML(user.email)}</td><td>${user.role === 'admin' ? 'Administrator' : 'Staff'}</td></tr>`).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="3" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
  }
}

async function exportHistory() {
  try {
    const rows = await request('/api/history?limit=500');
    const columns = ['created_at', 'product_name', 'type', 'quantity', 'unit', 'quantity_before', 'quantity_after', 'user_name', 'notes'];
    const csv = [columns.join(','), ...rows.map((row) => columns.map((key) =>
      `"${String(row[key] ?? '').replace(/"/g, '""')}"`
    ).join(','))].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'inventory-movements.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

document.querySelector('#today-label').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
}).format(new Date());

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const formData = new FormData(form);
  try {
    const user = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
    });
    form.reset();
    showApplication(user);
    await loadInventory();
  } catch (error) {
    document.querySelector('#login-error').textContent = error.message;
    document.querySelector('#login-error').hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    showLogin();
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

document.querySelectorAll('.nav-item[data-page]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.page, true);
  });
});
window.addEventListener('popstate', () => showPage(window.location.hash.slice(1)));

searchInput.addEventListener('input', renderInventory);
document.querySelector('#refresh-button').addEventListener('click', loadInventory);
document.querySelector('#refresh-history').addEventListener('click', loadHistory);
document.querySelector('#history-previous').addEventListener('click', () => {
  historyOffset = Math.max(0, historyOffset - historyPageSize);
  loadHistory();
});
document.querySelector('#history-next').addEventListener('click', () => {
  historyOffset += historyPageSize;
  loadHistory();
});
document.querySelector('#export-history').addEventListener('click', exportHistory);
document.querySelector('#show-inactive').addEventListener('change', loadInventory);
document.querySelector('#open-product-form').addEventListener('click', () => {
  const form = document.querySelector('#product-form');
  form.reset();
  form.dataset.productId = '';
  document.querySelector('#product-dialog-title').textContent = 'Add an item';
  document.querySelector('#starting-quantity-field').hidden = false;
  form.querySelector('[name="quantity"]').required = true;
  document.querySelector('#product-dialog').showModal();
});
document.querySelectorAll('.close-button, .close-dialog').forEach((button) => {
  button.addEventListener('click', () => document.querySelector('#product-dialog').close());
});

inventoryBody.addEventListener('click', async (event) => {
  const editButton = event.target.closest('.product-edit');
  const toggleButton = event.target.closest('.product-toggle');
  if (editButton) {
    const product = products.find((item) => String(item.id) === editButton.dataset.id);
    if (!product) return;
    const form = document.querySelector('#product-form');
    form.reset();
    form.dataset.productId = product.id;
    form.elements.name.value = product.name;
    form.elements.category.value = product.category;
    form.elements.unit.value = product.unit;
    form.elements.min_stock.value = product.min_stock;
    document.querySelector('#product-dialog-title').textContent = 'Edit item';
    document.querySelector('#starting-quantity-field').hidden = true;
    form.elements.quantity.required = false;
    document.querySelector('#product-dialog').showModal();
  }
  if (toggleButton) {
    const active = toggleButton.dataset.active === 'true';
    if (!window.confirm(`${active ? 'Deactivate' : 'Reactivate'} this inventory item?`)) return;
    try {
      await request(`/api/products/${toggleButton.dataset.id}`, {
        method: 'PATCH', body: JSON.stringify({ is_active: !active })
      });
      showNotice(`Item ${active ? 'deactivated' : 'reactivated'}.`);
      await loadInventory();
    } catch (error) {
      showNotice(error.message, 'error');
    }
  }
});

document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const formData = new FormData(form);
  const isEditing = Boolean(form.dataset.productId);
  const payload = {
    name: formData.get('name'),
    category: formData.get('category'),
    unit: formData.get('unit'),
    min_stock: Number(formData.get('min_stock'))
  };
  if (!isEditing) payload.quantity = Number(formData.get('quantity'));
  try {
    await request(isEditing ? `/api/products/${form.dataset.productId}` : '/api/products', {
      method: isEditing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    document.querySelector('#product-dialog').close();
    showNotice(isEditing ? 'Item details updated.' : 'Your new item has been added.');
    await loadInventory();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#transaction-type').addEventListener('change', (event) => {
  const isAdjustment = event.target.value === 'adjustment';
  document.querySelector('#quantity-label').textContent = isAdjustment ? 'COUNTED QUANTITY' : 'QUANTITY';
  document.querySelector('#transaction-form [name="quantity"]').min = isAdjustment ? '0' : '0.01';
});

document.querySelector('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const type = formData.get('type');
  const selectedProduct = products.find((product) => String(product.id) === formData.get('product_id'));
  if (!selectedProduct) {
    showNotice('Choose an active item before recording stock activity.', 'error');
    return;
  }
  const enteredQuantity = Number(formData.get('quantity'));
  const actionDescription = type === 'adjustment'
    ? `set ${selectedProduct.name} from ${formatQuantity(selectedProduct.quantity)} to ${formatQuantity(enteredQuantity)} ${selectedProduct.unit}`
    : `record ${type === 'stock_in' ? 'stock-in' : 'stock-out'} of ${formatQuantity(enteredQuantity)} ${selectedProduct.unit} for ${selectedProduct.name}`;
  if (!window.confirm(`Please confirm: ${actionDescription}?`)) return;
  submitButton.disabled = true;
  try {
    await request('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        product_id: Number(formData.get('product_id')),
        type,
        quantity: Number(formData.get('quantity')),
        notes: formData.get('notes')
      })
    });
    form.reset();
    document.querySelector('#quantity-label').textContent = 'QUANTITY';
    document.querySelector('#transaction-form [name="quantity"]').min = '0.01';
    showNotice('Stock activity saved and inventory updated.');
    await loadInventory();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const formData = new FormData(form);
  try {
    await request('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
        role: formData.get('role')
      })
    });
    form.reset();
    showNotice('Team account created.');
    await loadUsers();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

async function initialize() {
  try {
    const user = await request('/api/auth/me');
    showApplication(user);
    await loadInventory();
  } catch (error) {
    showLogin(error.status === 401 ? '' : error.message);
  }
}

initialize();
window.setInterval(() => {
  if (currentUser) loadInventory();
}, 30000);
