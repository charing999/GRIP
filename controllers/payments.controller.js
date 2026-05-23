const crypto = require('crypto');
const { supabaseAdmin } = require('../lib/supabase');
const hmac = require('../lib/hmac');
const haversine = require('../lib/haversine');

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// fire-and-forget: 실패해도 결제 흐름 중단 없음
function logEvent(event_type, ip, user_id, detail) {
  supabaseAdmin
    .from('security_events')
    .insert({ event_type, ip: ip || null, user_id: user_id || null, detail: detail || null })
    .then(() => {})
    .catch(() => {});
}

// POST /api/payments/request  (merchant only)
async function requestQR(req, res) {
  if (req.user.role !== 'merchant')
    return fail(res, 403, 'FORBIDDEN', '상인만 QR을 발급할 수 있습니다.');

  const { amount, merchant_lat, merchant_lng } = req.body || {};

  if (merchant_lat == null || merchant_lng == null)
    return fail(res, 400, 'LOCATION_REQUIRED', '위치 정보(merchant_lat, merchant_lng)가 필요합니다.');

  const amt = parseInt(amount, 10);
  if (!amt || amt <= 0)
    return fail(res, 400, 'INVALID_INPUT', '결제 금액은 1 이상의 정수이어야 합니다.');

  const merchantId = req.user.id;

  // 기존 active QR 일괄 만료 (상인이 명시적으로 갱신할 때만 무효화)
  await supabaseAdmin
    .from('merchant_qr_codes')
    .update({
      status: 'expired',
      revoked_at: new Date().toISOString(),
      revoked_reason: '상인 QR 갱신',
    })
    .eq('merchant_id', merchantId)
    .eq('status', 'active');

  const qrId = crypto.randomUUID();
  const signature = hmac.sign(qrId, merchantId, merchant_lat, merchant_lng);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin.from('merchant_qr_codes').insert({
    qr_id: qrId,
    merchant_id: merchantId,
    merchant_lat: Number(merchant_lat),
    merchant_lng: Number(merchant_lng),
    hmac_signature: signature,
    expires_at: expiresAt,
    status: 'active',
  });

  if (error) return fail(res, 500, 'SERVER_ERROR', 'QR 발급에 실패하였습니다.');

  return res.status(201).json({
    success: true,
    data: {
      qr_id: qrId,
      hmac_signature: signature,
      qr_payload: `${qrId}:${signature}`,
      expires_at: expiresAt,
    },
  });
}

// POST /api/payments/verify  (consumer only)
async function verifyQR(req, res) {
  if (req.user.role !== 'consumer')
    return fail(res, 403, 'FORBIDDEN', '소비자만 결제를 진행할 수 있습니다.');

  const { qr_payload, consumer_lat, consumer_lng, amount } = req.body || {};

  if (!qr_payload)
    return fail(res, 400, 'INVALID_INPUT', 'QR 페이로드가 필요합니다.');
  if (consumer_lat == null || consumer_lng == null)
    return fail(res, 400, 'LOCATION_REQUIRED', '위치 정보(consumer_lat, consumer_lng)가 필요합니다.');

  const amt = parseInt(amount, 10);
  if (!amt || amt <= 0)
    return fail(res, 400, 'INVALID_INPUT', '결제 금액은 1 이상의 정수이어야 합니다.');

  const consumerId = req.user.id;

  // qr_payload 파싱: "<qr_id>:<hmac_signature>"
  const colonIdx = qr_payload.indexOf(':');
  if (colonIdx === -1) {
    logEvent('INVALID_QR', req.ip, consumerId, { message: 'QR 페이로드 형식 오류' });
    return fail(res, 400, 'INVALID_QR', '유효하지 않은 QR입니다.');
  }
  const qrId = qr_payload.slice(0, colonIdx);
  const sig   = qr_payload.slice(colonIdx + 1);

  // QR 레코드 조회
  const { data: qr } = await supabaseAdmin
    .from('merchant_qr_codes')
    .select('*')
    .eq('qr_id', qrId)
    .maybeSingle();

  if (!qr) {
    logEvent('INVALID_QR', req.ip, consumerId, { payment_id: qrId, message: 'QR을 찾을 수 없습니다.' });
    return fail(res, 400, 'INVALID_QR', '유효하지 않은 QR입니다.');
  }

  // status 확인: revoked = 결제 완료 후 처리 → REPLAY_QR / 그 외 비활성 → INVALID_QR
  if (qr.status === 'revoked') {
    logEvent('REPLAY_QR', req.ip, consumerId, { payment_id: qrId, message: '이미 사용된 QR입니다.' });
    return fail(res, 400, 'REPLAY_QR', '이미 사용된 QR입니다.');
  }
  if (qr.status !== 'active') {
    logEvent('INVALID_QR', req.ip, consumerId, { payment_id: qrId, message: '만료된 QR입니다.' });
    return fail(res, 400, 'INVALID_QR', '만료되었거나 유효하지 않은 QR입니다.');
  }

  // HMAC 서명 검증
  if (!hmac.verify(qrId, qr.merchant_id, qr.merchant_lat, qr.merchant_lng, sig)) {
    logEvent('INVALID_QR', req.ip, consumerId, { payment_id: qrId, message: 'QR 서명 불일치' });
    return fail(res, 400, 'INVALID_QR', 'QR 서명이 유효하지 않습니다.');
  }

  // 위치 검증 (Haversine)
  const distM   = haversine.distance(qr.merchant_lat, qr.merchant_lng, Number(consumer_lat), Number(consumer_lng));
  const maxDist = Number(process.env.MAX_DISTANCE_METERS || 100);

  if (distM > maxDist) {
    logEvent('LOCATION_MISMATCH', req.ip, consumerId, {
      payment_id: qrId,
      merchant_lat: qr.merchant_lat,
      merchant_lng: qr.merchant_lng,
      consumer_lat: Number(consumer_lat),
      consumer_lng: Number(consumer_lng),
      distance_m: distM,
      max_allowed_m: maxDist,
      message: `결제 위치가 상점과 너무 멀리 떨어져 있습니다 (${Math.round(distM)}m)`,
    });
    return fail(res, 400, 'LOCATION_MISMATCH', `결제 위치가 상점과 너무 멀리 떨어져 있습니다. (${Math.round(distM)}m)`);
  }

  // 소비자 정보 확인 (차단 여부 + 잔액)
  const { data: consumer } = await supabaseAdmin
    .from('users')
    .select('balance, is_blocked, block_reason')
    .eq('id', consumerId)
    .single();

  if (!consumer) return fail(res, 500, 'SERVER_ERROR', '사용자 정보를 불러올 수 없습니다.');
  if (consumer.is_blocked)
    return fail(res, 403, 'USER_BLOCKED', consumer.block_reason || '계정이 차단되었습니다.');
  if (consumer.balance < amt)
    return fail(res, 400, 'INSUFFICIENT_BALANCE', '잔액이 부족합니다.');

  // 결제 처리: 소비자 차감 → 상인 적립 → QR 소비 처리 → 거래 기록
  // Optimistic Locking: .eq('balance', consumer.balance)로 읽은 시점의 잔액이
  // 동시 요청에 의해 변경되지 않았을 때만 UPDATE가 적용된다 (Double Spending 방어).
  const { data: deducted, error: deductErr } = await supabaseAdmin
    .from('users')
    .update({ balance: consumer.balance - amt })
    .eq('id', consumerId)
    .eq('balance', consumer.balance)
    .select('id');

  if (deductErr) return fail(res, 500, 'SERVER_ERROR', '결제 처리에 실패하였습니다.');
  if (!deducted || deducted.length === 0)
    return fail(res, 409, 'CONFLICT', '동시 결제 요청이 감지되었습니다. 다시 시도해 주세요.');

  const { data: merchant } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', qr.merchant_id)
    .single();

  const merchantBalance = merchant?.balance || 0;
  await supabaseAdmin
    .from('users')
    .update({ balance: merchantBalance + amt })
    .eq('id', qr.merchant_id)
    .eq('balance', merchantBalance);

  await supabaseAdmin
    .from('merchant_qr_codes')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: '결제 완료' })
    .eq('qr_id', qrId);

  await supabaseAdmin.from('transactions').insert({
    payment_request_id: qrId,
    consumer_id: consumerId,
    merchant_id: qr.merchant_id,
    amount: amt,
  });

  logEvent('PAYMENT_OK', req.ip, consumerId, {
    merchant_id: qr.merchant_id,
    amount: amt,
    distance_m: distM,
  });

  return res.status(200).json({
    success: true,
    data: { message: '결제가 완료되었습니다.', amount: amt, merchant_id: qr.merchant_id },
  });
}

// GET /api/payments/history
async function getHistory(req, res) {
  const userId = req.user.id;

  const { data: transactions, error } = await supabaseAdmin
    .from('transactions')
    .select('*, merchant:merchant_id(email), consumer:consumer_id(email)')
    .or(`consumer_id.eq.${userId},merchant_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return fail(res, 500, 'SERVER_ERROR', '거래 내역을 불러올 수 없습니다.');

  return res.status(200).json({ success: true, data: { transactions: transactions || [] } });
}

module.exports = { requestQR, verifyQR, getHistory };
