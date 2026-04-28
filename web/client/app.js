const API_URL = '';
let ws = null;
let priceChart = null;
let currentFilter = 'all';

document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  initEventListeners();
  initChart();
  loadStatus();
  loadConfig();
});

function initWebSocket() {
  const wsUrl = `ws://${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => log('Connected to server', 'info');

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWebSocketMessage(message);
  };

  ws.onclose = () => {
    log('Disconnected from server', 'warning');
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = () => log('WebSocket error', 'error');
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'state':
      updateStatus(message.data);
      break;
    case 'scan-started':
      setScanning(true);
      log('Scan started', 'info');
      break;
    case 'scan-completed':
      setScanning(false);
      loadItems();
      loadStats();
      log('Scan completed', 'success');
      break;
    case 'scan-error':
      setScanning(false);
      log(`Scan error: ${message.error}`, 'error');
      break;
    case 'data-cleared':
      clearItems();
      log('Data cleared', 'info');
      break;
  }
}

function initEventListeners() {
  document.getElementById('scanBtn').addEventListener('click', startScan);

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('cancelSettings').addEventListener('click', closeSettings);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });

  document.getElementById('searchBtn').addEventListener('click', performSearch);
  document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });
  document.getElementById('clearSearch').addEventListener('click', clearSearch);
  document.getElementById('brandFilter').addEventListener('change', performSearch);

  document.getElementById('testDiscord').addEventListener('click', testDiscord);

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      loadItems();
    });
  });

  document.getElementById('clearLog').addEventListener('click', () => {
    document.getElementById('activityLog').innerHTML = '';
  });

  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModals();
    });
  });
}

function initChart() {
  const ctx = document.getElementById('priceChart').getContext('2d');
  priceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['$150-300', '$300-500', '$500-750', '$750-1000', '$1000+'],
      datasets: [{
        label: 'Items',
        data: [0, 0, 0, 0, 0],
        backgroundColor: [
          'rgba(99, 102, 241, 0.8)',
          'rgba(139, 92, 246, 0.8)',
          'rgba(168, 85, 247, 0.8)',
          'rgba(192, 38, 211, 0.8)',
          'rgba(236, 72, 153, 0.8)',
        ],
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false, color: '#2a2a3a' },
          ticks: { color: '#a0a0b0', font: { size: 10 } },
        },
        y: {
          grid: { color: '#2a2a3a' },
          ticks: { color: '#a0a0b0', font: { size: 10 } },
        },
      },
    },
  });
}

async function loadStatus() {
  try {
    const response = await fetch(`${API_URL}/api/status`);
    const data = await response.json();
    updateStatus(data);
  } catch (error) {
    log('Failed to load status', 'error');
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_URL}/api/config`);
    const config = await response.json();

    document.getElementById('minPrice').value = config.minPrice || '';
    document.getElementById('maxPrice').value = config.maxPrice || '';
    document.getElementById('brands').value = (config.brands || []).join(', ');
    document.getElementById('scanInterval').value = config.scanIntervalMinutes || 15;
    document.getElementById('velocityThreshold').value = config.velocityThresholdHours || 24;
    document.getElementById('discordWebhook').value = config.discordWebhookUrl || '';

    updateDiscordStatus(config.discordConfigured);
  } catch (error) {
    log('Failed to load config', 'error');
  }
}

async function loadItems() {
  try {
    const response = await fetch(`${API_URL}/api/items?filter=${currentFilter}`);
    const items = await response.json();
    renderItems(items);
  } catch (error) {
    log('Failed to load items', 'error');
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/api/stats`);
    const stats = await response.json();
    updateStats(stats);
  } catch (error) {
    log('Failed to load stats', 'error');
  }
}

async function startScan() {
  try {
    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display: inline-block; margin-right: 0.5rem;"></span>Scanning...';

    await fetch(`${API_URL}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify: false }),
    });

    log('Scan initiated', 'success');
  } catch (error) {
    log('Scan failed', 'error');
    document.getElementById('scanBtn').disabled = false;
    document.getElementById('scanBtn').innerHTML = '<span class="btn-icon">▶</span>Start Scan';
  }
}

async function performSearch() {
  const query = document.getElementById('searchInput').value.trim();
  const brand = document.getElementById('brandFilter').value;

  if (!query && !brand) {
    currentFilter = 'all';
    loadItems();
    document.getElementById('clearSearch').style.display = 'none';
    return;
  }

  document.getElementById('clearSearch').style.display = 'inline-flex';

  if (query) {
    try {
      const response = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      renderSearchResults(data);
    } catch (error) {
      log('Search failed', 'error');
    }
  } else {
    try {
      const response = await fetch(`${API_URL}/api/items?filter=${currentFilter}&brand=${encodeURIComponent(brand)}`);
      const items = await response.json();
      renderItems(items);
    } catch (error) {
      log('Filter failed', 'error');
    }
  }
}

function renderSearchResults(data) {
  const container = document.getElementById('itemsList');

  if (!data.items || data.items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <p>No items found for "${escapeHtml(data.query)}"</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="search-summary">
      <h3>Search: "${escapeHtml(data.query)}"</h3>
      <p>${data.totalMatches} matches found</p>
    </div>
  `;

  html += '<div class="search-items">';
  for (const result of data.items.slice(0, 20)) {
    html += renderItemCard(result);
  }
  html += '</div>';

  container.innerHTML = html;

  container.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => showItemDetail(card.dataset.id));
  });
}

function renderItems(items) {
  const container = document.getElementById('itemsList');

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>No items found for this filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(renderItemCard).join('');

  container.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => showItemDetail(card.dataset.id));
  });
}

function renderItemCard(result) {
  return `
    <div class="item-card ${result.isNew ? 'new-item' : ''}" data-id="${result.item.id}">
      <img class="item-image" src="${result.item.images[0] || 'https://via.placeholder.com/80'}" alt="${result.item.title}" loading="lazy">
      <div class="item-info">
        <div class="item-title">${escapeHtml(result.item.title)}</div>
        <div class="item-meta">
          <span class="item-brand">${escapeHtml(result.item.brand)}</span>
          <span>${result.item.condition}</span>
          <span>${result.item.size || 'N/A'}</span>
        </div>
        <div class="item-badges">
          ${result.isNew ? '<span class="badge badge-new">NEW</span>' : ''}
          ${result.isSold ? '<span class="badge badge-sold">SOLD</span>' : ''}
          ${result.velocity === 'high' ? '<span class="badge badge-high">HOT</span>' : ''}
        </div>
      </div>
      <div class="item-price">
        <div class="price-value">$${result.item.price}</div>
      </div>
    </div>
  `;
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('brandFilter').value = '';
  document.getElementById('clearSearch').style.display = 'none';
  currentFilter = 'all';
  loadItems();
}

async function saveSettings() {
  const config = {
    minPrice: parseInt(document.getElementById('minPrice').value) || 150,
    maxPrice: parseInt(document.getElementById('maxPrice').value) || null,
    brands: document.getElementById('brands').value.split(',').map(s => s.trim()).filter(Boolean),
    scanIntervalMinutes: parseInt(document.getElementById('scanInterval').value) || 15,
    velocityThresholdHours: parseInt(document.getElementById('velocityThreshold').value) || 24,
    discordWebhookUrl: document.getElementById('discordWebhook').value || null,
  };

  try {
    await fetch(`${API_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    log('Settings saved', 'success');
    updateDiscordStatus(!!config.discordWebhookUrl);
    closeSettings();
  } catch (error) {
    log('Failed to save settings', 'error');
  }
}

async function testDiscord() {
  try {
    const response = await fetch(`${API_URL}/api/test-discord`, { method: 'POST' });
    const result = await response.json();

    if (result.success) {
      log('Discord test message sent', 'success');
    } else {
      log('Discord test failed', 'error');
    }
  } catch (error) {
    log('Discord test error', 'error');
  }
}

function updateStatus(data) {
  const statusIndicator = document.getElementById('statusIndicator');
  const scanBtn = document.getElementById('scanBtn');

  if (data.isScanning) {
    statusIndicator.textContent = 'Scanning...';
    statusIndicator.className = 'status-badge status-scanning';
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<span class="spinner" style="display: inline-block; margin-right: 0.5rem;"></span>Scanning...';
  } else {
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-badge status-idle';
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<span class="btn-icon">▶</span>Start Scan';
  }

  document.getElementById('lastScanTime').textContent = data.lastScan
    ? new Date(data.lastScan).toLocaleTimeString()
    : 'Never';
  document.getElementById('totalItems').textContent = data.itemCount || 0;
  document.getElementById('highVelocityCount').textContent = data.highVelocityCount || 0;

  updateDiscordStatus(data.config?.discordConfigured);
}

function setScanning(isScanning) {
  const statusIndicator = document.getElementById('statusIndicator');
  const scanBtn = document.getElementById('scanBtn');

  if (isScanning) {
    statusIndicator.textContent = 'Scanning...';
    statusIndicator.className = 'status-badge status-scanning';
    scanBtn.disabled = true;
    scanBtn.innerHTML = '<span class="spinner" style="display: inline-block; margin-right: 0.5rem;"></span>Scanning...';
  } else {
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-badge status-idle';
    scanBtn.disabled = false;
    scanBtn.innerHTML = '<span class="btn-icon">▶</span>Start Scan';
  }
}

function updateDiscordStatus(configured) {
  const discordStatus = document.getElementById('discordStatus');
  if (configured) {
    discordStatus.textContent = 'Active';
    discordStatus.className = 'status-badge status-active';
  } else {
    discordStatus.textContent = 'Not Configured';
    discordStatus.className = 'status-badge status-inactive';
  }
}

function updateStats(stats) {
  document.getElementById('newCount').textContent = stats.totalScanned || 0;
  document.getElementById('soldCount').textContent = stats.soldCount || 0;
  document.getElementById('avgPrice').textContent = `$${Math.round(stats.priceRange?.avg || 0)}`;
  document.getElementById('hotDeals').textContent = stats.highVelocityCount || 0;

  if (stats.brandStats) {
    const brands = Object.keys(stats.brandStats).sort();
    updateBrandFilter(brands);
  }

  if (stats.priceDistribution) {
    priceChart.data.datasets[0].data = [
      stats.priceDistribution['150-300'] || 0,
      stats.priceDistribution['300-500'] || 0,
      stats.priceDistribution['500-750'] || 0,
      stats.priceDistribution['750-1000'] || 0,
      stats.priceDistribution['1000+'] || 0,
    ];
    priceChart.update();
  }

  if (stats.brandStats) {
    const container = document.getElementById('brandStats');
    const sorted = Object.entries(stats.brandStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    container.innerHTML = sorted.map(([brand, stat]) => `
      <div class="brand-stat">
        <span class="brand-name">${escapeHtml(brand)}</span>
        <span class="brand-count">${stat.count} items</span>
      </div>
    `).join('');
  }
}

function updateBrandFilter(brands) {
  const select = document.getElementById('brandFilter');
  const currentValue = select.value;

  select.innerHTML = '<option value="">All Brands</option>';

  if (brands && brands.length > 0) {
    for (const brand of brands) {
      const option = document.createElement('option');
      option.value = brand.toLowerCase();
      option.textContent = brand;
      select.appendChild(option);
    }
  }

  select.value = currentValue;
}

function openSettings() {
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

function closeModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('active');
  });
}

function showItemDetail(itemId) {
  log(`Viewing item ${itemId}`, 'info');
}

function log(message, type = 'info') {
  const container = document.getElementById('activityLog');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-message">${escapeHtml(message)}</span>
  `;
  container.insertBefore(entry, container.firstChild);

  while (container.children.length > 50) {
    container.removeChild(container.lastChild);
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

setInterval(() => {
  loadStatus();
  loadItems();
}, 30000);
