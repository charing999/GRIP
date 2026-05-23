require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../../lib/supabase');

const BASE_URL = 'http://localhost:3000';

let consumerToken = '';
let adminToken = '';

let consumerId = '';
let adminId = '';

const testConsumer = { email: `admin-consumer-${randomUUID()}@grip.local`, password: 'password123', role: 'consumer' };
const testAdmin = { email: `admin-admin-${randomUUID()}@grip.local`, password: 'password123', role: 'admin' };

describe('6. 관리자 API 테스트', () => {

  before(async () => {
    // 1. 테스트 사용자 등록 및 로그인
    const regCon = await request(BASE_URL).post('/api/auth/register').send(testConsumer);
    assert.strictEqual(regCon.status, 201);
    consumerId = regCon.body.data.user.id;

    const regAdm = await request(BASE_URL).post('/api/auth/register').send(testAdmin);
    assert.strictEqual(regAdm.status, 201);
    adminId = regAdm.body.data.user.id;

    // 로그인
    const loginCon = await request(BASE_URL).post('/api/auth/login').send({ email: testConsumer.email, password: testConsumer.password });
    assert.strictEqual(loginCon.status, 200);
    consumerToken = loginCon.body.data.token;

    const loginAdm = await request(BASE_URL).post('/api/auth/login').send({ email: testAdmin.email, password: testAdmin.password });
    assert.strictEqual(loginAdm.status, 200);
    adminToken = loginAdm.body.data.token;
  });

  describe('6-1. POST /api/admin/users/:id/block (admin only)', () => {
    test('TC-BK01 정상 차단', async () => {
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '테스트 차단' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.message, '사용자가 차단되었습니다.');

      // DB 확인
      const { data: user } = await supabaseAdmin.from('users').select('is_blocked, block_reason, blocked_at').eq('id', consumerId).single();
      assert.strictEqual(user.is_blocked, true);
      assert.strictEqual(user.block_reason, '테스트 차단');
      assert.ok(user.blocked_at);
    });

    test('TC-BK03 이미 차단된 user 재차단', async () => {
      // 선행 조건: TC-BK01에 의해 이미 차단된 상태
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '중복 차단 시도' });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
    });

    test('TC-BK01 정상 차단 해제 후 TC-BK02 확인 (reason 없이 차단)', async () => {
      // 1. 먼저 정상 차단 해제
      await supabaseAdmin.from('users').update({ is_blocked: false, block_reason: null, blocked_at: null }).eq('id', consumerId);

      // 2. reason 없이 차단 시도
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // DB 확인
      const { data: user } = await supabaseAdmin.from('users').select('is_blocked, block_reason').eq('id', consumerId).single();
      assert.strictEqual(user.is_blocked, true);
      assert.ok(user.block_reason.includes('차단')); // 기본 문구가 정상 포함되어 있는지 확인
    });

    test('TC-BK04 존재하지 않는 user_id', async () => {
      const fakeUUID = '00000000-0000-0000-0000-000000000000';
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${fakeUUID}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '없는 회원 차단' });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });

    test('TC-BK05 consumer 토큰으로 접근', async () => {
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .set('Authorization', `Bearer ${consumerToken}`)
        .send({ reason: '일반 사용자가 차단 시도' });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });

    test('TC-BK06 인증 없이 접근', async () => {
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .send({ reason: '비로그인 사용자 차단 시도' });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
    });
  });

  describe('6-2. POST /api/admin/users/:id/unblock (admin only)', () => {
    test('TC-UB01 정상 차단 해제', async () => {
      // 선행 조건: 현재 차단 상태 (앞서 TC-BK02 테스트로 인해 차단된 상태임)
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/unblock`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.message, '차단이 해제되었습니다.');

      // DB 확인
      const { data: user } = await supabaseAdmin.from('users').select('is_blocked, block_reason, blocked_at').eq('id', consumerId).single();
      assert.strictEqual(user.is_blocked, false);
      assert.strictEqual(user.block_reason, null);
      assert.strictEqual(user.blocked_at, null);
    });

    test('TC-UB02 차단되지 않은 user 해제 시도', async () => {
      // 선행 조건: 차단되지 않은 상태
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/unblock`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_INPUT');
    });

    test('TC-UB03 존재하지 않는 user_id', async () => {
      const fakeUUID = '00000000-0000-0000-0000-000000000000';
      const res = await request(BASE_URL)
        .post(`/api/admin/users/${fakeUUID}/unblock`)
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'NOT_FOUND');
    });
  });

});
