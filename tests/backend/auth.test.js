const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { randomUUID } = require('crypto');

// 테스트 타겟: 라이브 서버
const BASE_URL = 'http://localhost:3000';

const testConsumer = { email: `test-consumer-${randomUUID()}@grip.local`, password: 'password123', role: 'consumer' };
const testMerchant = { email: `test-merchant-${randomUUID()}@grip.local`, password: 'password123', role: 'merchant' };
const testAdmin = { email: `test-admin-${randomUUID()}@grip.local`, password: 'password123', role: 'admin' };

let consumerToken = '';

describe('2-1. POST /api/auth/register', () => {
  test('TC-R01 정상 회원가입 (consumer)', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send(testConsumer);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.user.role, 'consumer');
  });

  test('TC-R02 정상 회원가입 (merchant)', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send(testMerchant);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
  });

  test('TC-R03 정상 회원가입 (admin)', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send(testAdmin);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
  });

  test('TC-R04 중복 이메일', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send(testConsumer);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'EMAIL_EXISTS');
  });

  test('TC-R05 비밀번호 7자 (미달)', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send({ email: 'short@test.com', password: 'short1', role: 'consumer' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
  });

  test('TC-R06 유효하지 않은 이메일 형식', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send({ email: 'notanemail', password: 'password1', role: 'consumer' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
  });

  test('TC-R07 유효하지 않은 role', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send({ email: 'role@test.com', password: 'password1', role: 'superuser' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
  });

  test('TC-R08 필수 필드 누락 (email 없음)', async () => {
    const res = await request(BASE_URL).post('/api/auth/register').send({ password: 'password1', role: 'consumer' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
  });
});

describe('2-2. POST /api/auth/login', () => {
  test('TC-L01 정상 로그인', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({ email: testConsumer.email, password: testConsumer.password });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(typeof res.body.data.token, 'string');
    assert.strictEqual(res.body.data.user.role, 'consumer');
    consumerToken = res.body.data.token;
  });

  test('TC-L02 잘못된 비밀번호', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({ email: testConsumer.email, password: 'wrongpassword' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('TC-L03 존재하지 않는 이메일', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({ email: 'nobody@grip.local', password: 'password1' });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('TC-L04 SQLi 탐지 — email 필드', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({ email: "' OR '1'='1", password: "password1" });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'SQLI_DETECTED');
  });

  test('TC-L05 SQLi 탐지 — password 필드', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({ email: "test@test.com", password: "'; DROP TABLE users;--" });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'SQLI_DETECTED');
  });

  const sqliPatterns = ["'", '"', ';', '--', '#', '/* */', 'UNION', 'SELECT', 'DROP', 'INSERT', 'UPDATE'];
  sqliPatterns.forEach(pattern => {
    test(`TC-L06 SQLi 탐지 패턴 목록 — ${pattern}`, async () => {
      const res = await request(BASE_URL).post('/api/auth/login').send({ email: pattern, password: "password1" });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error.code, 'SQLI_DETECTED');
    });
  });

  test('TC-L08 & TC-L09 계정 잠금 및 재접근 확인', async () => {
    const dummyUser = { email: `lock-test-${randomUUID()}@grip.local`, password: 'password123', role: 'consumer' };
    await request(BASE_URL).post('/api/auth/register').send(dummyUser);

    // 5번 실패
    for (let i = 0; i < 4; i++) {
      const res = await request(BASE_URL).post('/api/auth/login').send({ email: dummyUser.email, password: 'wrong' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
    }
    // 5번째 실패 -> 잠금 발생
    const resLock = await request(BASE_URL).post('/api/auth/login').send({ email: dummyUser.email, password: 'wrong' });
    assert.strictEqual(resLock.status, 403);
    assert.strictEqual(resLock.body.error.code, 'ACCOUNT_LOCKED');
    assert.ok(resLock.body.error.unlock_at);

    // 잠긴 후 올바른 비밀번호로 로그인 시도 -> 여전히 잠금 상태
    const resRetry = await request(BASE_URL).post('/api/auth/login').send({ email: dummyUser.email, password: dummyUser.password });
    assert.strictEqual(resRetry.status, 403);
    assert.strictEqual(resRetry.body.error.code, 'ACCOUNT_LOCKED');
  });

  test('TC-L10 필수 필드 누락', async () => {
    const res = await request(BASE_URL).post('/api/auth/login').send({});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
  });
});

describe('2-3. POST /api/auth/logout', () => {
  test('TC-O01 정상 로그아웃', async () => {
    const res = await request(BASE_URL).post('/api/auth/logout').set('Authorization', `Bearer ${consumerToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  test('TC-O02 토큰 없이 로그아웃', async () => {
    const res = await request(BASE_URL).post('/api/auth/logout');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
  });
});
