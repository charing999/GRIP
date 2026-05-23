// 공통 유틸리티

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
    );
  });
}

function setLocationStatus(el, state, msg) {
  if (!el) return;
  el.className = `location-status ${state}`;
  const icons = { granted: '✓', denied: '✗', pending: '…' };
  el.textContent = `${icons[state] || ''} ${msg}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ================================================================
// Merchant 페이지
// ================================================================

async function initMerchant() {
  const user = API.getUser();
  if (!user || user.role !== 'merchant') { location.href = '/'; return; }

  API.renderNav(user);
  document.getElementById('merchantEmail').textContent   = user.email;
  document.getElementById('merchantBalance').textContent = (user.balance ?? 0).toLocaleString();

  await requestMerchantLocation();
  await loadMerchantTxHistory();

  document.getElementById('qrForm').addEventListener('submit', handleQrGenerate);
  document.getElementById('qrRefreshBtn').addEventListener('click', handleQrRefresh);
}

let merchantLat = null;
let merchantLng = null;

async function requestMerchantLocation() {
  const statusEl  = document.getElementById('locationStatus');
  const qrBtn     = document.getElementById('qrGenerateBtn');
  const retryBtn  = document.getElementById('locationRetryBtn');

  setLocationStatus(statusEl, 'pending', '위치 정보를 가져오는 중...');
  qrBtn.disabled = true;
  if (retryBtn) retryBtn.style.display = 'none';

  try {
    const { lat, lng } = await getCurrentPosition();
    merchantLat = lat;
    merchantLng = lng;
    setLocationStatus(statusEl, 'granted', '위치 정보 허용됨');
    qrBtn.disabled = false;
  } catch {
    setLocationStatus(statusEl, 'denied', '위치 정보 거부됨 — QR 발급을 사용하려면 위치 권한을 허용하세요.');
    qrBtn.disabled = true;
    if (retryBtn) {
      retryBtn.style.display = '';
      retryBtn.onclick = () => requestMerchantLocation();
    }
  }
}

async function handleQrGenerate(e) {
  e.preventDefault();

  const errorEl = document.getElementById('qrError');
  errorEl.textContent = '';

  const amount = parseInt(document.getElementById('qrAmount').value, 10);
  if (!amount || amount <= 0) {
    errorEl.textContent = '금액은 1원 이상이어야 합니다.';
    return;
  }

  if (merchantLat === null || merchantLng === null) {
    errorEl.textContent = '위치 정보가 없습니다. 위치 권한을 허용해 주세요.';
    return;
  }

  const btn = document.getElementById('qrGenerateBtn');
  btn.disabled = true;
  btn.textContent = '발급 중...';

  const { ok, data } = await API.api('POST', '/payments/request', {
    amount,
    merchant_lat: merchantLat,
    merchant_lng: merchantLng,
  });

  btn.disabled = false;
  btn.textContent = 'QR 생성';

  if (!ok) {
    errorEl.textContent = data.error?.message || 'QR 발급에 실패하였습니다.';
    return;
  }

  const { qr_id, qr_payload } = data.data;
  document.getElementById('qrId').textContent = qr_id;

  const paymentUrl = `https://grip-production-3249.up.railway.app/payment.html?payload=${encodeURIComponent(qr_payload)}&amount=${amount}`;

  const qrEl = document.getElementById('qrDisplay');
  qrEl.innerHTML = '';
  new QRCode(qrEl, {
    text: paymentUrl,
    width: 256,
    height: 256,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });

  document.getElementById('qrResult').classList.remove('hidden');
}

function handleQrRefresh() {
  document.getElementById('qrResult').classList.add('hidden');
  document.getElementById('qrDisplay').innerHTML = '';
  document.getElementById('qrAmount').value = '';
  document.getElementById('qrError').textContent = '';
  document.getElementById('qrAmount').focus();
}

async function loadMerchantTxHistory() {
  const tbody = document.getElementById('txTableBody');
  const { ok, data } = await API.api('GET', '/payments/history');
  if (!ok) return;

  const txs = data.data?.transactions || [];
  if (txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">거래 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = txs.map((tx) => `
    <tr>
      <td>${formatDate(tx.created_at)}</td>
      <td>${tx.consumer?.email ?? '-'}</td>
      <td>${Number(tx.amount).toLocaleString()} 원</td>
    </tr>
  `).join('');
}

// ================================================================
// Consumer 페이지
// ================================================================

async function initConsumer() {
  const user = API.getUser();
  if (!user || user.role !== 'consumer') { location.href = '/'; return; }

  API.renderNav(user);
  document.getElementById('consumerEmail').textContent   = user.email;
  document.getElementById('consumerBalance').textContent = (user.balance ?? 0).toLocaleString();

  const params = new URLSearchParams(window.location.search);
  const payloadParam = params.get('payload');
  const amountParam  = params.get('amount');
  if (payloadParam) document.getElementById('qrPayload').value = payloadParam;
  if (amountParam)  document.getElementById('payAmount').value  = amountParam;

  await requestConsumerLocation();
  await loadConsumerTxHistory();

  document.getElementById('paymentForm').addEventListener('submit', handlePayment);
}

let consumerLat = null;
let consumerLng = null;

async function requestConsumerLocation() {
  const statusEl = document.getElementById('locationStatus');
  const payBtn   = document.getElementById('payBtn');
  const retryBtn = document.getElementById('locationRetryBtn');

  setLocationStatus(statusEl, 'pending', '위치 정보를 가져오는 중...');
  payBtn.disabled = true;
  if (retryBtn) retryBtn.style.display = 'none';

  try {
    const { lat, lng } = await getCurrentPosition();
    consumerLat = lat;
    consumerLng = lng;
    setLocationStatus(statusEl, 'granted', '위치 정보 허용됨');
    payBtn.disabled = false;
  } catch {
    setLocationStatus(statusEl, 'denied', '위치 정보 거부됨 — 결제를 진행하려면 위치 권한을 허용하세요.');
    payBtn.disabled = true;
    if (retryBtn) {
      retryBtn.style.display = '';
      retryBtn.onclick = () => requestConsumerLocation();
    }
  }
}

const ERROR_MESSAGES = {
  INVALID_QR:           'QR이 유효하지 않습니다.',
  REPLAY_QR:            '이미 사용된 QR입니다.',
  LOCATION_MISMATCH:    '결제 위치가 상점과 너무 멀리 떨어져 있습니다.',
  INSUFFICIENT_BALANCE: '잔액이 부족합니다.',
  USER_BLOCKED:         '계정이 차단되었습니다.',
};

async function handlePayment(e) {
  e.preventDefault();

  const resultEl = document.getElementById('paymentResult');
  const errorEl  = document.getElementById('paymentError');
  resultEl.className  = 'payment-result hidden';
  resultEl.textContent = '';
  errorEl.textContent  = '';

  const qr_payload = document.getElementById('qrPayload').value.trim();
  const amount     = parseInt(document.getElementById('payAmount').value, 10);

  if (!qr_payload) { errorEl.textContent = 'QR 페이로드를 입력해 주세요.'; return; }
  if (!amount || amount <= 0) { errorEl.textContent = '금액은 1원 이상이어야 합니다.'; return; }

  const btn = document.getElementById('payBtn');
  btn.disabled    = true;
  btn.textContent = '처리 중...';

  let lat = consumerLat;
  let lng = consumerLng;

  try {
    const pos = await getCurrentPosition();
    lat = pos.lat;
    lng = pos.lng;
  } catch {
    // 이미 저장된 위치 사용
  }

  if (lat === null || lng === null) {
    errorEl.textContent = '위치 정보가 없습니다. 위치 권한을 허용해 주세요.';
    btn.disabled    = false;
    btn.textContent = '결제하기';
    return;
  }

  const { ok, data } = await API.api('POST', '/payments/verify', {
    qr_payload,
    consumer_lat: lat,
    consumer_lng: lng,
    amount,
  });

  btn.disabled    = false;
  btn.textContent = '결제하기';

  if (ok) {
    resultEl.className   = 'payment-result success';
    resultEl.textContent = `결제 완료! ${Number(data.data.amount).toLocaleString()}원이 차감되었습니다.`;

    const user = API.getUser();
    if (user) {
      user.balance = (user.balance ?? 0) - amount;
      API.saveSession(API.getToken(), user);
      document.getElementById('consumerBalance').textContent = user.balance.toLocaleString();
    }

    document.getElementById('qrPayload').value = '';
    document.getElementById('payAmount').value  = '';
    await loadConsumerTxHistory();
  } else {
    const code = data.error?.code;
    resultEl.className   = 'payment-result failure';
    resultEl.textContent = ERROR_MESSAGES[code] || data.error?.message || '결제에 실패하였습니다.';
  }

  resultEl.classList.remove('hidden');
}

async function loadConsumerTxHistory() {
  const tbody = document.getElementById('txTableBody');
  const { ok, data } = await API.api('GET', '/payments/history');
  if (!ok) return;

  const txs = data.data?.transactions || [];
  if (txs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">결제 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = txs.map((tx) => `
    <tr>
      <td>${formatDate(tx.created_at)}</td>
      <td>${tx.merchant?.email ?? '-'}</td>
      <td>${Number(tx.amount).toLocaleString()} 원</td>
    </tr>
  `).join('');
}

// ================================================================
// 페이지 판별 후 초기화
// ================================================================
if (location.pathname.includes('merchant')) {
  initMerchant();
} else {
  initConsumer();
}
