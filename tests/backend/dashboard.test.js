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

const testConsumer = { email: `dash-consumer-${randomUUID()}@grip.local`, password: 'password123', role: 'consumer' };
const testAdmin = { email: `dash-admin-${randomUUID()}@grip.local`, password: 'password123', role: 'admin' };

describe('5. 대시보드 API 테스트', () => {

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

  describe('5-1. GET /api/dashboard/stats (admin only)', () => {
    test('TC-DS01 기본 통계 조회', async () => {
      const res = await request(BASE_URL)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.buckets));
      assert.strictEqual(res.body.data.buckets.length, 10);
      assert.strictEqual(res.body.data.minutes, 10);
      
      const firstBucket = res.body.data.buckets[0];
      assert.ok(firstBucket.minute);
      assert.ok(typeof firstBucket.counts === 'object');
    });

    test('TC-DS02 minutes 파라미터 적용', async () => {
      const res = await request(BASE_URL)
        .get('/api/dashboard/stats?minutes=5')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.buckets.length, 5);
      assert.strictEqual(res.body.data.minutes, 5);
    });

    test('TC-DS03 이벤트 집계 정확성', async () => {
      // 1. SQLI_BLOCKED 이벤트 2건 유도 (로그인에 SQLi 패턴 대입)
      await request(BASE_URL).post('/api/auth/login').send({ email: "' OR '1'='1", password: "wrong" });
      await request(BASE_URL).post('/api/auth/login').send({ email: "'; DROP TABLE users;--", password: "wrong" });

      // 2. 통계 조회
      const res = await request(BASE_URL)
        .get('/api/dashboard/stats?minutes=10')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      
      // 버킷들의 SQLI_BLOCKED 카운트 총합이 2 이상인지 검증
      let totalSqliCount = 0;
      for (const bucket of res.body.data.buckets) {
        if (bucket.counts && bucket.counts.SQLI_BLOCKED) {
          totalSqliCount += bucket.counts.SQLI_BLOCKED;
        }
      }
      assert.ok(totalSqliCount >= 2, `Expected SQLI_BLOCKED count >= 2, got ${totalSqliCount}`);
    });

    test('TC-DS04 consumer 토큰으로 접근', async () => {
      const res = await request(BASE_URL)
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${consumerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });
  });

  describe('5-2. GET /api/dashboard/ai-alerts (admin only)', () => {
    let alertEventId = null;

    test('TC-DA01 AI 권고 목록 조회', async () => {
      const res = await request(BASE_URL)
        .get('/api/dashboard/ai-alerts')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.alerts));
    });

    test('TC-DA02 차단된 user의 알림 필터링', async () => {
      // 1. DB에 해당 소비자를 대상(block_recommendation=true)으로 하는 AI_ALERT 이벤트 강제 인서트
      const { data: eventData, error } = await supabaseAdmin.from('security_events').insert({
        event_type: 'AI_ALERT',
        user_id: consumerId,
        detail: {
          analyzed_user_id: consumerId,
          risk_level: 'HIGH',
          block_recommendation: true,
          reason_ko: '테스트용 이상 탐지 권고'
        }
      }).select('id').single();
      
      assert.strictEqual(error, null);
      alertEventId = eventData.id;

      // 2. 조회 시 포함되어 있는지 확인
      const resBeforeBlock = await request(BASE_URL)
        .get('/api/dashboard/ai-alerts')
        .set('Authorization', `Bearer ${adminToken}`);
      
      const hasAlert = resBeforeBlock.body.data.alerts.some(al => al.id === alertEventId);
      assert.strictEqual(hasAlert, true);

      // 3. 어드민 API를 통해 해당 소비자 계정 차단 처리
      const blockRes = await request(BASE_URL)
        .post(`/api/admin/users/${consumerId}/block`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: '테스트용 자동 필터링 확인 차단' });
      assert.strictEqual(blockRes.status, 200);

      // 4. 다시 AI 권고 조회 시 필터링되어 제외되었는지 검증
      const resAfterBlock = await request(BASE_URL)
        .get('/api/dashboard/ai-alerts')
        .set('Authorization', `Bearer ${adminToken}`);
      
      const hasAlertAfter = resAfterBlock.body.data.alerts.some(al => al.id === alertEventId);
      assert.strictEqual(hasAlertAfter, false);

      // 5. 차후 테스트 영향을 방지하기 위해 사용자 차단 해제 및 이벤트 삭제
      await supabaseAdmin.from('users').update({ is_blocked: false, block_reason: null, blocked_at: null }).eq('id', consumerId);
      await supabaseAdmin.from('security_events').delete().eq('id', alertEventId);
    });

    test('TC-DA03 consumer 토큰으로 접근', async () => {
      const res = await request(BASE_URL)
        .get('/api/dashboard/ai-alerts')
        .set('Authorization', `Bearer ${consumerToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
    });
  });

});
