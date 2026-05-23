/**
 * PHASE 1_SCHEMA_TEST — Supabase DB 스키마 검증
 *
 * 검증 항목:
 *   1. 모든 테이블 존재 확인
 *   2. 필수 컬럼 및 타입 확인
 *   3. NOT NULL 제약 조건 위반 시 에러
 *   4. CHECK 제약 조건 동작 확인
 *   5. FK 제약 조건 동작 확인
 *   6. RLS 정책 확인 (anon 차단, 본인 데이터만 수정)
 *
 * 실행: npm run test:schema
 */
require('dotenv').config();
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// service role 클라이언트 (RLS 우회)
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// anon 클라이언트 (RLS 적용)
const anon = createClient(SUPABASE_URL, ANON_KEY);

// ─── 헬퍼: information_schema 쿼리를 위한 RPC 호출 ────────────────────────────
// Supabase JS SDK로는 information_schema에 직접 접근할 수 없으므로
// admin 클라이언트의 rpc 또는 직접 테이블 접근으로 검증한다.
// 아래에서는 실제 CRUD 시도를 통해 스키마를 "행동 기반"으로 검증한다.

// ─── 테스트용 데이터 정리 ──────────────────────────────────────────────────────
const TEST_PREFIX = '__schema_test__';
const testEmails = [];
const testUserIds = [];

async function cleanupTestData() {
  // 테스트에서 만든 데이터 정리 (역순으로 FK 존중)
  for (const id of testUserIds) {
    await admin.from('payment_sessions').delete().eq('consumer_id', id);
    await admin.from('payment_sessions').delete().eq('merchant_id', id);
    await admin.from('merchant_qr_codes').delete().eq('merchant_id', id);
    await admin.from('transactions').delete().eq('consumer_id', id);
    await admin.from('transactions').delete().eq('merchant_id', id);
    await admin.from('security_events').delete().eq('user_id', id);
    await admin.from('merchants').delete().eq('user_id', id);
  }
  for (const email of testEmails) {
    const { data } = await admin.from('users').select('id').eq('email', email).maybeSingle();
    if (data) {
      await admin.from('users').delete().eq('id', data.id);
      await admin.auth.admin.deleteUser(data.id).catch(() => {});
    }
  }
}

async function createTestUser(role = 'consumer', suffix = '') {
  const email = `${TEST_PREFIX}${role}${suffix}@test.com`;
  testEmails.push(email);

  // 이미 존재하면 삭제
  const { data: existing } = await admin.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) {
    await admin.from('merchants').delete().eq('user_id', existing.id);
    await admin.from('users').delete().eq('id', existing.id);
    await admin.auth.admin.deleteUser(existing.id).catch(() => {});
  }

  const { data: authData } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!@',
    email_confirm: true,
  });

  const userId = authData.user.id;
  testUserIds.push(userId);

  await admin.from('users').insert({
    id: userId,
    role,
    email,
    password_hash: 'test_hash_' + Date.now(),
    balance: 100000,
  });

  return { id: userId, email, role };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. 테이블 존재 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('1. 테이블 존재 확인', () => {
  const requiredTables = [
    'users',
    'merchants',
    'transactions',
    'security_events',
    'merchant_qr_codes',
    'payment_sessions',
  ];

  for (const table of requiredTables) {
    test(`테이블 "${table}" 이 존재한다`, async () => {
      const { error } = await admin.from(table).select('*').limit(0);
      assert.equal(error, null, `테이블 "${table}" 접근 실패: ${error?.message}`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. 필수 컬럼 및 타입 확인 (행 삽입/조회로 간접 검증)
// ═══════════════════════════════════════════════════════════════════════════════
describe('2. 필수 컬럼 확인', () => {
  test('users 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('users')
      .select('id, role, email, password_hash, balance, failed_login_count, locked_until, is_blocked, block_reason, blocked_at, created_at')
      .limit(1);
    assert.equal(error, null, `users 컬럼 조회 실패: ${error?.message}`);
  });

  test('merchants 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('merchants')
      .select('user_id, market_name, store_name, category, lat, lng, secret_key, phone, created_at')
      .limit(1);
    assert.equal(error, null, `merchants 컬럼 조회 실패: ${error?.message}`);
  });

  test('transactions 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('transactions')
      .select('id, payment_request_id, consumer_id, merchant_id, amount, created_at')
      .limit(1);
    assert.equal(error, null, `transactions 컬럼 조회 실패: ${error?.message}`);
  });

  test('security_events 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('security_events')
      .select('id, event_type, ip, user_id, detail, created_at')
      .limit(1);
    assert.equal(error, null, `security_events 컬럼 조회 실패: ${error?.message}`);
  });

  test('merchant_qr_codes 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('merchant_qr_codes')
      .select('qr_id, merchant_id, merchant_lat, merchant_lng, hmac_signature, issued_at, expires_at, status, revoked_at, revoked_reason, print_batch_id, created_at')
      .limit(1);
    assert.equal(error, null, `merchant_qr_codes 컬럼 조회 실패: ${error?.message}`);
  });

  test('payment_sessions 테이블 — 필수 컬럼 존재', async () => {
    const { data, error } = await admin
      .from('payment_sessions')
      .select('session_id, qr_id, merchant_id, consumer_id, amount, nonce, consumer_lat, consumer_lng, distance_m, status, expires_at, created_at')
      .limit(1);
    assert.equal(error, null, `payment_sessions 컬럼 조회 실패: ${error?.message}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CHECK 제약 조건 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('3. CHECK 제약 조건', () => {
  let testUser;

  before(async () => {
    testUser = await createTestUser('consumer', '_check');
  });

  test('users.role — 유효하지 않은 역할 거부', async () => {
    const email = `${TEST_PREFIX}badrole@test.com`;
    testEmails.push(email);
    const { error } = await admin.from('users').insert({
      role: 'hacker',
      email,
      password_hash: 'hash',
    });
    assert.notEqual(error, null, 'invalid role이 허용되어서는 안 된다');
  });

  test('users.balance — 음수 balance 거부 (CHECK balance >= 0)', async () => {
    const { error } = await admin
      .from('users')
      .update({ balance: -1 })
      .eq('id', testUser.id);
    assert.notEqual(error, null, '음수 balance가 허용되어서는 안 된다');
  });

  test('security_events.event_type — 유효하지 않은 event_type 거부', async () => {
    const { error } = await admin.from('security_events').insert({
      event_type: 'INVALID_TYPE',
      ip: '127.0.0.1',
    });
    assert.notEqual(error, null, 'invalid event_type이 허용되어서는 안 된다');
  });

  test('security_events.event_type — 유효한 타입 허용', async () => {
    const validTypes = [
      'SQLI_BLOCKED', 'BRUTE_FORCE', 'INVALID_QR', 'REPLAY_QR',
      'LOCATION_MISMATCH', 'CHAIN_BROKEN', 'PAYMENT_OK', 'AI_ALERT',
      'QR_REVOKED_USED', 'QR_EXPIRED_USED',
    ];
    for (const eventType of validTypes) {
      const { data, error } = await admin.from('security_events').insert({
        event_type: eventType,
        ip: '127.0.0.1',
        user_id: testUser.id,
      }).select('id').single();
      assert.equal(error, null, `유효한 event_type "${eventType}" 삽입 실패: ${error?.message}`);
      // 정리
      if (data) await admin.from('security_events').delete().eq('id', data.id);
    }
  });

  test('merchant_qr_codes.status — 유효하지 않은 status 거부', async () => {
    const merchant = await createTestUser('merchant', '_qrcheck');
    const { error } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'test_sig',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'invalid_status',
    });
    assert.notEqual(error, null, 'invalid QR status가 허용되어서는 안 된다');
  });

  test('payment_sessions.status — 유효하지 않은 status 거부', async () => {
    // 먼저 유효한 QR 생성
    const merchant = await createTestUser('merchant', '_pscheck');
    const consumer = await createTestUser('consumer', '_pscheck');

    const { data: qr } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'test_sig',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
    }).select('qr_id').single();

    if (qr) {
      const { error } = await admin.from('payment_sessions').insert({
        qr_id: qr.qr_id,
        merchant_id: merchant.id,
        consumer_id: consumer.id,
        amount: 1000,
        nonce: `test_nonce_${Date.now()}`,
        consumer_lat: 36.3504,
        consumer_lng: 127.3845,
        status: 'unknown_status',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
      assert.notEqual(error, null, 'invalid session status가 허용되어서는 안 된다');
      // 정리
      await admin.from('merchant_qr_codes').delete().eq('qr_id', qr.qr_id);
    }
  });

  test('payment_sessions.amount — 0 이하 금액 거부 (CHECK amount > 0)', async () => {
    const merchant = await createTestUser('merchant', '_amtcheck');
    const consumer = await createTestUser('consumer', '_amtcheck');

    const { data: qr } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'test_sig',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
    }).select('qr_id').single();

    if (qr) {
      const { error } = await admin.from('payment_sessions').insert({
        qr_id: qr.qr_id,
        merchant_id: merchant.id,
        consumer_id: consumer.id,
        amount: 0,
        nonce: `test_nonce_zero_${Date.now()}`,
        consumer_lat: 36.3504,
        consumer_lng: 127.3845,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
      assert.notEqual(error, null, '금액 0이 허용되어서는 안 된다');
      // 정리
      await admin.from('merchant_qr_codes').delete().eq('qr_id', qr.qr_id);
    }
  });

  test('merchants.lat — 범위 밖 위도 거부 (CHECK -90 <= lat <= 90)', async () => {
    const user = await createTestUser('merchant', '_latcheck');
    const { error } = await admin.from('merchants').insert({
      user_id: user.id,
      market_name: '테스트시장',
      store_name: '테스트가게',
      lat: 91,       // 범위 밖
      lng: 127.0,
      secret_key: 'test_key',
    });
    assert.notEqual(error, null, '위도 91이 허용되어서는 안 된다');
  });

  test('merchants.lng — 범위 밖 경도 거부 (CHECK -180 <= lng <= 180)', async () => {
    const user = await createTestUser('merchant', '_lngcheck');
    const { error } = await admin.from('merchants').insert({
      user_id: user.id,
      market_name: '테스트시장',
      store_name: '테스트가게',
      lat: 36.0,
      lng: 181,       // 범위 밖
      secret_key: 'test_key',
    });
    assert.notEqual(error, null, '경도 181이 허용되어서는 안 된다');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NOT NULL 제약 조건 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('4. NOT NULL 제약 조건', () => {
  test('users — role 없이 삽입 시 에러', async () => {
    const email = `${TEST_PREFIX}nonull@test.com`;
    testEmails.push(email);
    const { error } = await admin.from('users').insert({
      email,
      password_hash: 'hash',
      // role 누락
    });
    assert.notEqual(error, null, 'role 없이 users 삽입이 허용되어서는 안 된다');
  });

  test('users — email 없이 삽입 시 에러', async () => {
    const { error } = await admin.from('users').insert({
      role: 'consumer',
      password_hash: 'hash',
      // email 누락
    });
    assert.notEqual(error, null, 'email 없이 users 삽입이 허용되어서는 안 된다');
  });

  test('users — password_hash 없이 삽입 시 에러', async () => {
    const email = `${TEST_PREFIX}nopw@test.com`;
    testEmails.push(email);
    const { error } = await admin.from('users').insert({
      role: 'consumer',
      email,
      // password_hash 누락
    });
    assert.notEqual(error, null, 'password_hash 없이 users 삽입이 허용되어서는 안 된다');
  });

  test('merchants — market_name 없이 삽입 시 에러', async () => {
    const user = await createTestUser('merchant', '_nomarket');
    const { error } = await admin.from('merchants').insert({
      user_id: user.id,
      // market_name 누락
      store_name: '가게',
      lat: 36.0,
      lng: 127.0,
      secret_key: 'key',
    });
    assert.notEqual(error, null, 'market_name 없이 merchants 삽입이 허용되어서는 안 된다');
  });

  test('security_events — event_type 없이 삽입 시 에러', async () => {
    const { error } = await admin.from('security_events').insert({
      ip: '127.0.0.1',
      // event_type 누락
    });
    assert.notEqual(error, null, 'event_type 없이 security_events 삽입이 허용되어서는 안 된다');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FK 제약 조건 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('5. FK 제약 조건', () => {
  const fakeUUID = '00000000-0000-0000-0000-000000000000';

  test('merchants.user_id — 존재하지 않는 user 참조 시 에러', async () => {
    const { error } = await admin.from('merchants').insert({
      user_id: fakeUUID,
      market_name: '테스트',
      store_name: '가게',
      lat: 36.0,
      lng: 127.0,
      secret_key: 'key',
    });
    assert.notEqual(error, null, '존재하지 않는 user_id가 허용되어서는 안 된다');
  });

  test('transactions.consumer_id — 존재하지 않는 user 참조 시 에러', async () => {
    const { error } = await admin.from('transactions').insert({
      payment_request_id: fakeUUID,
      consumer_id: fakeUUID,
      merchant_id: fakeUUID,
      amount: 1000,
    });
    assert.notEqual(error, null, '존재하지 않는 consumer_id가 허용되어서는 안 된다');
  });

  test('merchant_qr_codes.merchant_id — 존재하지 않는 user 참조 시 에러', async () => {
    const { error } = await admin.from('merchant_qr_codes').insert({
      merchant_id: fakeUUID,
      merchant_lat: 36.0,
      merchant_lng: 127.0,
      hmac_signature: 'sig',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.notEqual(error, null, '존재하지 않는 merchant_id가 허용되어서는 안 된다');
  });

  test('payment_sessions.qr_id — 존재하지 않는 QR 참조 시 에러', async () => {
    const merchant = await createTestUser('merchant', '_fkqr');
    const consumer = await createTestUser('consumer', '_fkqr');

    const { error } = await admin.from('payment_sessions').insert({
      qr_id: fakeUUID,
      merchant_id: merchant.id,
      consumer_id: consumer.id,
      amount: 1000,
      nonce: `fk_test_${Date.now()}`,
      consumer_lat: 36.0,
      consumer_lng: 127.0,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    assert.notEqual(error, null, '존재하지 않는 qr_id가 허용되어서는 안 된다');
  });

  test('security_events.user_id — 존재하지 않는 user 참조 시 에러', async () => {
    const { error } = await admin.from('security_events').insert({
      event_type: 'BRUTE_FORCE',
      ip: '127.0.0.1',
      user_id: fakeUUID,
    });
    assert.notEqual(error, null, '존재하지 않는 user_id가 허용되어서는 안 된다');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. UNIQUE 제약 조건 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('6. UNIQUE 제약 조건', () => {
  test('users.email — 중복 이메일 거부', async () => {
    const user = await createTestUser('consumer', '_dup1');
    const { error } = await admin.from('users').insert({
      role: 'consumer',
      email: user.email,   // 중복
      password_hash: 'hash',
    });
    assert.notEqual(error, null, '중복 이메일이 허용되어서는 안 된다');
  });

  test('payment_sessions.nonce — 중복 nonce 거부', async () => {
    const merchant = await createTestUser('merchant', '_nonce');
    const consumer = await createTestUser('consumer', '_nonce');

    const { data: qr } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'sig',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'active',
    }).select('qr_id').single();

    if (qr) {
      const nonce = `unique_nonce_test_${Date.now()}`;

      // 첫 번째 삽입 성공
      const { error: err1 } = await admin.from('payment_sessions').insert({
        qr_id: qr.qr_id,
        merchant_id: merchant.id,
        consumer_id: consumer.id,
        amount: 1000,
        nonce,
        consumer_lat: 36.3504,
        consumer_lng: 127.3845,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
      assert.equal(err1, null, `첫 번째 nonce 삽입 실패: ${err1?.message}`);

      // 동일 nonce로 두 번째 삽입 → 에러
      const { error: err2 } = await admin.from('payment_sessions').insert({
        qr_id: qr.qr_id,
        merchant_id: merchant.id,
        consumer_id: consumer.id,
        amount: 2000,
        nonce,   // 중복
        consumer_lat: 36.3504,
        consumer_lng: 127.3845,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
      assert.notEqual(err2, null, '중복 nonce가 허용되어서는 안 된다');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. RLS 정책 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('7. RLS 정책', () => {
  test('anon 클라이언트 — users 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('users').select('*').limit(1);
    // RLS가 설정되어 있으면 data가 빈 배열이거나 error가 반환됨
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 users 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — security_events 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('security_events').select('*').limit(1);
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 security_events 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — merchants 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('merchants').select('*').limit(1);
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 merchants 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — transactions 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('transactions').select('*').limit(1);
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 transactions 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — merchant_qr_codes 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('merchant_qr_codes').select('*').limit(1);
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 merchant_qr_codes 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — payment_sessions 테이블 직접 조회 차단', async () => {
    const { data, error } = await anon.from('payment_sessions').select('*').limit(1);
    const blocked = error !== null || (data && data.length === 0);
    assert.ok(blocked, 'anon으로 payment_sessions 테이블에 접근할 수 있어서는 안 된다');
  });

  test('anon 클라이언트 — users 테이블 삽입 차단', async () => {
    const { error } = await anon.from('users').insert({
      role: 'consumer',
      email: `${TEST_PREFIX}anon_insert@test.com`,
      password_hash: 'hash',
    });
    assert.notEqual(error, null, 'anon으로 users 삽입이 허용되어서는 안 된다');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. 기본값 확인
// ═══════════════════════════════════════════════════════════════════════════════
describe('8. 기본값(DEFAULT) 확인', () => {
  test('users — balance 기본값 0 (또는 트리거에 의한 보너스)', async () => {
    const email = `${TEST_PREFIX}default_balance@test.com`;
    testEmails.push(email);

    const { data: authData } = await admin.auth.admin.createUser({
      email,
      password: 'Test1234!@',
      email_confirm: true,
    });
    const userId = authData.user.id;
    testUserIds.push(userId);

    const { error } = await admin.from('users').insert({
      id: userId,
      role: 'consumer',
      email,
      password_hash: 'default_hash',
      // balance 생략 — 기본값 적용
    });
    assert.equal(error, null, `기본값 삽입 실패: ${error?.message}`);

    const { data } = await admin.from('users').select('balance, failed_login_count, is_blocked').eq('id', userId).single();
    // balance는 0 또는 트리거에 의한 보너스 값
    assert.ok(data.balance >= 0, `balance 기본값이 0 이상이어야 한다 (실제: ${data.balance})`);
    assert.equal(data.failed_login_count, 0, 'failed_login_count 기본값은 0이어야 한다');
    assert.equal(data.is_blocked, false, 'is_blocked 기본값은 false이어야 한다');
  });

  test('merchant_qr_codes — status 기본값 active', async () => {
    const merchant = await createTestUser('merchant', '_default_qr');

    const { data, error } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'sig_default',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      // status 생략
    }).select('qr_id, status').single();

    assert.equal(error, null, `기본값 삽입 실패: ${error?.message}`);
    assert.equal(data.status, 'active', 'QR status 기본값은 active이어야 한다');

    // 정리
    if (data) await admin.from('merchant_qr_codes').delete().eq('qr_id', data.qr_id);
  });

  test('payment_sessions — status 기본값 pending', async () => {
    const merchant = await createTestUser('merchant', '_default_ps');
    const consumer = await createTestUser('consumer', '_default_ps');

    const { data: qr } = await admin.from('merchant_qr_codes').insert({
      merchant_id: merchant.id,
      merchant_lat: 36.3504,
      merchant_lng: 127.3845,
      hmac_signature: 'sig_ps_default',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }).select('qr_id').single();

    if (qr) {
      const { data, error } = await admin.from('payment_sessions').insert({
        qr_id: qr.qr_id,
        merchant_id: merchant.id,
        consumer_id: consumer.id,
        amount: 5000,
        nonce: `default_status_${Date.now()}`,
        consumer_lat: 36.3504,
        consumer_lng: 127.3845,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        // status 생략
      }).select('session_id, status').single();

      assert.equal(error, null, `기본값 삽입 실패: ${error?.message}`);
      assert.equal(data.status, 'pending', 'session status 기본값은 pending이어야 한다');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 정리
// ═══════════════════════════════════════════════════════════════════════════════
describe('cleanup', () => {
  test('테스트 데이터 정리', async () => {
    await cleanupTestData();
  });
});
