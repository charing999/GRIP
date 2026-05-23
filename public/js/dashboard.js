const EVENT_TYPES = [
  'SQLI_BLOCKED', 'BRUTE_FORCE',
  'INVALID_QR', 'REPLAY_QR', 'LOCATION_MISMATCH',
  'PAYMENT_OK', 'AI_ALERT',
];

const CHART_COLORS = {
  SQLI_BLOCKED:      '#dc2626',
  BRUTE_FORCE:       '#ea580c',
  INVALID_QR:        '#7c3aed',
  REPLAY_QR:         '#6d28d9',
  LOCATION_MISMATCH: '#d97706',
  PAYMENT_OK:        '#16a34a',
  AI_ALERT:          '#0891b2',
};

const DOT_CLASS_MAP = {
  SQLI_BLOCKED:      'sqli',
  BRUTE_FORCE:       'brute',
  INVALID_QR:        'qr',
  REPLAY_QR:         'qr',
  LOCATION_MISMATCH: 'qr',
  CHAIN_BROKEN:      'qr',
  QR_REVOKED_USED:   'qr',
  QR_EXPIRED_USED:   'qr',
  PAYMENT_OK:        'ok',
  AI_ALERT:          'ai',
};

let chart = null;
let activeFilter = 'all';

// ================================================================
// 초기화
// ================================================================

async function init() {
  const user = API.getUser();
  if (!user || user.role !== 'admin') { location.href = '/'; return; }

  API.renderNav(user);
  initFilters();
  initSSE();
  await loadAiAlerts();
  await loadStatsAndRenderChart();
  setInterval(loadStatsAndRenderChart, 10000);
}

// ================================================================
// SSE
// ================================================================

function initSSE() {
  const token = API.getToken();
  const es = new EventSource(`/api/security/stream?token=${encodeURIComponent(token)}`);

  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      prependFeedItem(event);
      if (event.event_type === 'AI_ALERT') prependAiAlert(event);
    } catch {}
  };

  es.onerror = () => {};
}

// ================================================================
// 이벤트 피드
// ================================================================

function getDotClass(event_type) {
  return DOT_CLASS_MAP[event_type] || 'other';
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function prependFeedItem(event) {
  const feedList = document.getElementById('feedList');
  const dotClass = getDotClass(event.event_type);
  const msg = event.detail?.message || '';

  const li = document.createElement('li');
  li.className = 'feed-item';
  li.dataset.type = dotClass;
  li.innerHTML =
    `[${formatTime(event.created_at)}] ` +
    `<span class="feed-dot feed-dot--${dotClass}"></span> ` +
    `${event.event_type}&nbsp;&nbsp;${event.ip || ''}&nbsp;&nbsp;&rarr;&nbsp;&nbsp;${msg}`;

  if (activeFilter !== 'all' && activeFilter !== dotClass) {
    li.classList.add('hidden');
  }

  feedList.prepend(li);

  while (feedList.children.length > 100) {
    feedList.removeChild(feedList.lastChild);
  }
}

// ================================================================
// 이벤트 필터
// ================================================================

function initFilters() {
  const controls = document.querySelector('.feed-controls');
  if (!controls) return;

  controls.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    controls.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;

    document.querySelectorAll('#feedList .feed-item').forEach((item) => {
      const visible = activeFilter === 'all' || item.dataset.type === activeFilter;
      item.classList.toggle('hidden', !visible);
    });
  });
}

// ================================================================
// 차트
// ================================================================

function formatMinute(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadStatsAndRenderChart() {
  const { ok, data } = await API.api('GET', '/dashboard/stats?minutes=10');
  if (!ok) return;

  const { buckets } = data.data;
  const labels = buckets.map((b) => formatMinute(b.minute));

  const datasets = EVENT_TYPES.map((type) => ({
    label: type,
    data: buckets.map((b) => b.counts[type] || 0),
    backgroundColor: CHART_COLORS[type] || '#64748b',
    stack: 'events',
  }));

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
    return;
  }

  const ctx = document.getElementById('barChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

// ================================================================
// AI 권고
// ================================================================

async function loadAiAlerts() {
  const { ok, data } = await API.api('GET', '/dashboard/ai-alerts');
  if (!ok) return;

  const alerts = data.data?.alerts || [];
  const list   = document.getElementById('alertsList');

  list.innerHTML = '';
  alerts.forEach((alert) => list.appendChild(buildAlertCard(alert)));
  evaluateEmpty();
}

function buildAlertCard(alert) {
  const risk     = alert.detail?.risk_level || 'low';
  const email    = alert.user?.email || '(알 수 없음)';
  const patterns = (alert.detail?.patterns || []).join(', ');
  const reason   = alert.detail?.reason || '';

  const article = document.createElement('article');
  article.className = `alert-card alert-card--${risk}`;

  article.innerHTML = `
    <header class="alert-card-header">
      <span class="alert-badge">⚠ AI 차단 권고</span>
      <span class="alert-risk">위험도: ${risk.toUpperCase()}</span>
    </header>
    <p class="alert-user">사용자: ${email}</p>
    ${patterns ? `<p class="alert-patterns">감지 패턴: ${patterns}</p>` : ''}
    ${reason   ? `<p class="alert-reason">사유: ${reason}</p>`          : ''}
    <footer class="alert-actions">
      <button class="btn btn-danger" data-user-id="${alert.user_id}">차단</button>
      <button class="btn btn-ghost"  data-alert-id="${alert.id}">무시</button>
    </footer>
  `;

  article.querySelector('.btn-danger').addEventListener('click', handleBlockUser);
  article.querySelector('.btn-ghost').addEventListener('click', handleDismissAlert);

  return article;
}

function prependAiAlert(event) {
  const list = document.getElementById('alertsList');
  list.prepend(buildAlertCard(event));
  evaluateEmpty();
}

function evaluateEmpty() {
  const list  = document.getElementById('alertsList');
  const empty = document.getElementById('alertsEmpty');
  empty.classList.toggle('hidden', list.children.length > 0);
}

// ================================================================
// 사용자 차단
// ================================================================

async function handleBlockUser(e) {
  const userId = e.currentTarget.dataset.userId;
  const card   = e.currentTarget.closest('.alert-card');

  const { ok, data } = await API.api('POST', `/admin/users/${userId}/block`, {});
  if (!ok) {
    alert(data.error?.message || '차단에 실패하였습니다.');
    return;
  }

  card?.remove();
  evaluateEmpty();
  alert('사용자가 차단되었습니다.');
}

// ================================================================
// 알림 무시
// ================================================================

function handleDismissAlert(e) {
  e.currentTarget.closest('.alert-card')?.remove();
  evaluateEmpty();
}

// ================================================================
// 즉시 AI 분석
// ================================================================

async function handleAiAnalyze() {
  const btn = document.getElementById('aiAnalyzeBtn');
  btn.disabled    = true;
  btn.textContent = '분석 중...';

  await API.api('POST', '/security/ai-analyze', {});

  btn.disabled    = false;
  btn.textContent = '즉시 분석 실행';
  await loadAiAlerts();
}

document.getElementById('aiAnalyzeBtn').addEventListener('click', handleAiAnalyze);

init();
