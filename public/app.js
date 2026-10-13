const inventoryBody = document.querySelector('#inventory-body');
const lowStockList = document.querySelector('#low-stock-list');
const transactionProduct = document.querySelector('#transaction-product');
const notice = document.querySelector('#notice');
const searchInput = document.querySelector('#search-input');
let products = [];
let noticeTimer;

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
  }
};

function showPage(page, updateHistory = false) {
  const pageName = Object.hasOwn(pageContent, page) ? page : 'inventory';
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
  document.querySelector('#open-product-form').hidden = pageName !== 'inventory';

  if (updateHistory && window.location.hash !== `#${pageName}`) {
    window.history.pushState(null, '', `#${pageName}`);
  }
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

async function request(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
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
      return `<tr>
        <td>${escapeHTML(product.name)}</td>
        <td>${escapeHTML(product.category)}</td>
        <td><span class="stock-number">${formatQuantity(product.quantity)}</span><span class="unit-label">${escapeHTML(product.unit)}</span></td>
        <td>${formatQuantity(product.min_stock)}<span class="unit-label">${escapeHTML(product.unit)}</span></td>
        <td><span class="badge ${isLow ? 'badge-low' : 'badge-good'}">${isLow ? 'Running low' : 'In good shape'}</span></td>
        <td></td>
      </tr>`;
    }).join('')
    : `<tr><td colspan="6" class="empty-state">${products.length ? 'No items match your search.' : 'No items yet. Add your first pantry item to get started.'}</td></tr>`;

  const lowItems = products.filter((product) => Number(product.quantity) <= Number(product.min_stock));
  document.querySelector('#stat-items').textContent = products.length;
  document.querySelector('#stat-healthy').textContent = products.length - lowItems.length;
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
  transactionProduct.innerHTML = '<option value="">Choose an item</option>' + products.map((product) =>
    `<option value="${product.id}">${escapeHTML(product.name)} (${formatQuantity(product.quantity)} ${escapeHTML(product.unit)})</option>`
  ).join('');
  if (products.some((product) => String(product.id) === currentSelection)) {
    transactionProduct.value = currentSelection;
  }
}

async function loadInventory() {
  inventoryBody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading your inventory...</td></tr>';
  try {
    products = await request('/api/products');
    renderInventory();
  } catch (error) {
    inventoryBody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHTML(error.message)}</td></tr>`;
    document.querySelector('#item-count').textContent = 'Could not load items';
    showNotice(error.message, 'error');
  }
}

document.querySelector('#today-label').textContent = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
}).format(new Date());

document.querySelectorAll('.nav-item[data-page]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showPage(link.dataset.page, true);
  });
});
window.addEventListener('popstate', () => showPage(window.location.hash.slice(1)));
showPage(window.location.hash.slice(1));

searchInput.addEventListener('input', renderInventory);
document.querySelector('#refresh-button').addEventListener('click', loadInventory);
document.querySelector('#open-product-form').addEventListener('click', () => {
  document.querySelector('#product-dialog').showModal();
});
document.querySelectorAll('.close-button, .close-dialog').forEach((button) => {
  button.addEventListener('click', () => document.querySelector('#product-dialog').close());
});

document.querySelector('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const formData = new FormData(form);
  try {
    await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        category: formData.get('category'),
        unit: formData.get('unit'),
        quantity: Number(formData.get('quantity')),
        min_stock: Number(formData.get('min_stock'))
      })
    });
    form.reset();
    document.querySelector('#product-dialog').close();
    showNotice('Your new item has been added.');
    await loadInventory();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const formData = new FormData(form);
  try {
    await request('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        product_id: Number(formData.get('product_id')),
        type: formData.get('type'),
        quantity: Number(formData.get('quantity')),
        notes: formData.get('notes')
      })
    });
    form.reset();
    showNotice('Stock activity saved and inventory updated.');
    await loadInventory();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadInventory();
