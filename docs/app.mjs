// Front-end dashboard. Reads static JSON, renders everything.

const LAYER_NAMES = {
  financial_lead: 'Financial Leading',
  labor: 'Labor',
  inflation: 'Inflation',
  real_economy: 'Real Economy',
  micro: 'Micro / Business'
};

const LAYER_COLORS = {
  financial_lead: '#66b3ff',
  labor: '#ff9966',
  inflation: '#f1c84a',
  real_economy: '#2ddc8c',
  micro: '#c084fc'
};

let currentSnapshot = null;
let historyData = [];

async function loadData() {
  const [currentRes, historyRes] = await Promise.all([
    fetch('./data/current.json'),
    fetch('./data/history.json')
  ]);

  if (!currentRes.ok) throw new Error('No snapshot found. Run the GitHub Action once to generate data.');

  currentSnapshot = await currentRes.json();
  historyData = historyRes.ok ? await historyRes.json() : [];

  render();
}

function render() {
  renderHeader();
  renderComposite();
  renderLayers();
  renderHistoryChart();
  renderIndicators();
  wireFilters();
  setRepoLink();
}

function renderHeader() {
  document.getElementById('asOf').textContent = currentSnapshot.as_of;
  document.getElementById('generatedAt').textContent = new Date(currentSnapshot.generated_at).toLocaleString();
}

function renderComposite() {
  document.getElementById('compositeScore').textContent = currentSnapshot.composite.score.toFixed(1);
  const badge = document.getElementById('compositeAlert');
  badge.textContent = currentSnapshot.composite.alert;
  badge.className = `badge ${currentSnapshot.composite.alert}`;
}

function renderLayers() {
  const container = document.getElementById('layerCards');
  container.innerHTML = Object.entries(currentSnapshot.layers)
    .map(([layer, data]) => `
      <div class="layer-card">
        <h3>${LAYER_NAMES[layer] || layer}</h3>
        <div class="layer-score">${data.score.toFixed(1)}</div>
        <div><span class="badge ${data.alert}">${data.alert}</span></div>
        <div class="layer-weight">Weight: ${(data.weight * 100).toFixed(0)}%</div>
      </div>
    `).join('');
}

function renderHistoryChart() {
  const ctx = document.getElementById('historyChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: historyData.map(x => x.date),
      datasets: [
        {
          label: 'Composite',
          data: historyData.map(x => x.composite),
          borderColor: '#66b3ff',
          backgroundColor: 'rgba(102, 179, 255, 0.1)',
          borderWidth: 2.5,
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#eef2ff' } }
      },
      scales: {
        x: { ticks: { color: '#8b95b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          min: 0, max: 100,
          ticks: { color: '#8b95b8' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function renderIndicators() {
  const layerFilter = document.getElementById('layerFilter').value;
  const categoryFilter = document.getElementById('categoryFilter').value;

  const filtered = currentSnapshot.indicators.filter(x =>
    (!layerFilter || x.layer === layerFilter) &&
    (!categoryFilter || x.category === categoryFilter)
  );

  const body = document.getElementById('indicatorTableBody');
  body.innerHTML = filtered.map(x => `
    <tr>
      <td><strong>${x.name}</strong><div class="muted" style="font-size:11px">${x.fred_id}</div></td>
      <td>${LAYER_NAMES[x.layer] || x.layer}</td>
      <td>${x.category}</td>
      <td>${formatValue(x.latest_value)}</td>
      <td>${x.latest_date || '-'}</td>
      <td>${x.threshold !== null ? x.threshold : 'z-score'}</td>
      <td>${x.score.toFixed(1)}</td>
      <td><span class="badge ${x.alert}">${x.alert}</span></td>
    </tr>
  `).join('');
}

function formatValue(v) {
  if (v === null || v === undefined) return '-';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}

function wireFilters() {
  const layerSelect = document.getElementById('layerFilter');
  Object.entries(LAYER_NAMES).forEach(([k, v]) => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = v;
    layerSelect.appendChild(opt);
  });
  layerSelect.addEventListener('change', renderIndicators);
  document.getElementById('categoryFilter').addEventListener('change', renderIndicators);
}

function setRepoLink() {
  // Replace with actual repo URL after first commit
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const [user] = host.split('.');
    const repo = window.location.pathname.split('/')[1];
    document.getElementById('repoLink').href = `https://github.com/${user}/${repo}`;
  }
}

loadData().catch(err => {
  document.querySelector('.wrap').innerHTML = `
    <div class="panel">
      <h2>No data yet</h2>
      <p>${err.message}</p>
      <p class="muted">Run the GitHub Action manually (Actions tab → Refresh FRED Data → Run workflow) to generate the first snapshot.</p>
    </div>`;
});
