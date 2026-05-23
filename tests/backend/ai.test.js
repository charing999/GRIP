require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../../lib/supabase');
const localAI = require('../../lib/localAI');
const aiAnalyzer = require('../../services/aiAnalyzer');

const BASE_URL = 'http://localhost:3000';

// GRIP 시스템 프롬프트와 동일한 구조로 연결 확인
const SYSTEM_PROMPT_PING =
  '당신은 테스트용 AI입니다. 반드시 다음 JSON만 출력하세요: ' +
  '{"risk_level":"LOW","patterns":[],"reason_ko":"연결 확인","block_recommendation":false,"user_message_ko":"정상"}';

let ollamaReachable = false;

let adminToken = '';
let consumerId = '';
let adminId = '';

const testAdmin    = { email: `ai-admin-${randomUUID()}@grip.local`,    password: 'password123', role: 'admin' };
const testConsumer = { email: `ai-consumer-${randomUUID()}@grip.local`, password: 'password123', role: 'consumer' };

// ────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────

async function checkAiReachable() {
  if (process.env.DISABLE_AI === 'true') return false;
  const hasOllama  = !!process.env.OLLAMA_URL;
  const hasGoogle  = !!(process.env.GEMMA_API_KEY && process.env.GEMMA_API_URL);
  if (!hasOllama && !hasGoogle) return false;

  try {
    const result = await localAI.ask(SYSTEM_PROMPT_PING, '연결 테스트');
    return result !== null;
  } catch {
    return false;
  }
}

// 조건 A(5분 내 비정상 이벤트 3회 이상)를 충족하도록 이벤트 직접 삽입
async function seedAbnormalEvents(userId, count = 4) {
  const rows = Array.from({ length: count }, () => ({
    user_id: userId,
    event_type: 'INVALID_QR',
    detail: { message: 'AI 테스트 시드', test: true },
  }));
  const { error } = await supabaseAdmin.from('security_events').insert(rows);
  if (error) throw new Error(`시드 삽입 실패: ${error.message}`);
}

// AI 응답 스키마 검증
function assertAlertSchema(alert) {
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(alert.risk_level),
    `risk_level 값 오류: ${alert.risk_level}`);
  assert.ok(Array.isArray(alert.patterns),         'patterns가 배열이어야 함');
  assert.strictEqual(typeof alert.block_recommendation, 'boolean',
    'block_recommendation가 boolean이어야 함');
  assert.strictEqual(typeof alert.reason_ko, 'string',     'reason_ko가 string이어야 함');
  assert.strictEqual(typeof alert.user_message_ko, 'string', 'user_message_ko가 string이어야 함');
}

// ────────────────────────────────────────────────────
// 테스트 준비 / 정리
// ────────────────────────────────────────────────────

describe('AI 분석 테스트 (DISABLE_AI=false, AI 서버 필요)', () => {

  before(async () => {
    ollamaReachable = await checkAiReachable();

    const regAdm = await request(BASE_URL).post('/api/auth/register').send(testAdmin);
    assert.strictEqual(regAdm.status, 201);
    adminId = regAdm.body.data.user.id;

    const regCon = await request(BASE_URL).post('/api/auth/register').send(testConsumer);
    assert.strictEqual(regCon.status, 201);
    consumerId = regCon.body.data.user.id;

    const loginAdm = await request(BASE_URL).post('/api/auth/login').send({
      email: testAdmin.email, password: testAdmin.password,
    });
    assert.strictEqual(loginAdm.status, 200);
    adminToken = loginAdm.body.data.token;
  });

  after(async () => {
    if (consumerId) await supabaseAdmin.auth.admin.deleteUser(consumerId);
    if (adminId)    await supabaseAdmin.auth.admin.deleteUser(adminId);
  });

  // ────────────────────────────────────────────────────
  // A. localAI.ask() 단위 테스트
  // ────────────────────────────────────────────────────

  describe('A. localAI.ask() 단위 테스트', () => {

    test('TC-AI-L01 AI 서버 연결 시 JSON 객체 반환', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      const result = await localAI.ask(SYSTEM_PROMPT_PING, '연결 테스트');

      assert.notStrictEqual(result, null, 'null이 아닌 JSON 객체 반환 필요');
      assert.strictEqual(typeof result, 'object', '객체 타입이어야 함');
    });

    test('TC-AI-L02 DISABLE_AI=true 시 null 반환', async () => {
      const original = process.env.DISABLE_AI;
      process.env.DISABLE_AI = 'true';
      try {
        const result = await localAI.ask(SYSTEM_PROMPT_PING, '비활성화 테스트');
        assert.strictEqual(result, null, 'DISABLE_AI=true 시 null 반환 필요');
      } finally {
        process.env.DISABLE_AI = original;
      }
    });

    test('TC-AI-L03 OLLAMA_URL/GEMMA 미설정 시 null 반환', async () => {
      const origOllama  = process.env.OLLAMA_URL;
      const origKey     = process.env.GEMMA_API_KEY;
      const origUrl     = process.env.GEMMA_API_URL;
      const origDisable = process.env.DISABLE_AI;

      delete process.env.OLLAMA_URL;
      delete process.env.GEMMA_API_KEY;
      delete process.env.GEMMA_API_URL;
      process.env.DISABLE_AI = 'false';

      try {
        const result = await localAI.ask(SYSTEM_PROMPT_PING, '미설정 테스트');
        assert.strictEqual(result, null, 'AI 엔드포인트 미설정 시 null 반환 필요');
      } finally {
        if (origOllama  !== undefined) process.env.OLLAMA_URL     = origOllama;
        if (origKey     !== undefined) process.env.GEMMA_API_KEY  = origKey;
        if (origUrl     !== undefined) process.env.GEMMA_API_URL  = origUrl;
        process.env.DISABLE_AI = origDisable;
      }
    });

    test('TC-AI-L04 AI 응답이 GRIP 스키마와 호환되는지 확인', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      const systemPrompt = `당신은 결제 보안 시스템의 이상 행동 분석 AI입니다.
반드시 한국어로만 답변하세요.
다음 JSON 스키마만 출력하고 다른 텍스트는 절대 출력하지 마세요:

{
  "risk_level": "HIGH" | "MEDIUM" | "LOW",
  "patterns": ["감지된 패턴 설명 (한국어)"],
  "reason_ko": "관리자를 위한 상세 분석 (한국어, 2~3문장)",
  "block_recommendation": true | false,
  "user_message_ko": "차단 시 사용자에게 보여줄 메시지 (한국어, 1문장)"
}`;

      const result = await localAI.ask(systemPrompt,
        '분석 대상: test@example.com\n[최근 security_events]\n(없음)\n[최근 transactions]\n(없음)\n위 데이터를 바탕으로 위험도를 분석하세요.');

      assert.notStrictEqual(result, null, 'null이 아닌 결과 필요');
      assertAlertSchema(result);
    });
  });

  // ────────────────────────────────────────────────────
  // B. aiAnalyzer.runOnce() 통합 테스트
  // ────────────────────────────────────────────────────

  describe('B. aiAnalyzer.runOnce() 통합 테스트', () => {

    test('TC-AI-R01 분석 대상 조건 미충족 시 count: 0 반환', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      // 시드 없이 새로 만든 testConsumer는 비정상 이벤트가 없으므로 조건 미충족
      const result = await aiAnalyzer.runOnce(consumerId);

      assert.strictEqual(result.count, 0, '조건 미충족 user는 count: 0이어야 함');
      assert.deepStrictEqual(result.alerts, [], '빈 alerts 배열 반환 필요');
    });

    test('TC-AI-R02 조건 A 충족 user → alert 반환 + AI_ALERT DB 저장 확인', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      await seedAbnormalEvents(consumerId, 4);

      const result = await aiAnalyzer.runOnce(consumerId);

      assert.strictEqual(result.count, 1, '분석 대상 1명이어야 함');
      assert.strictEqual(result.alerts.length, 1, 'alert 1건 반환 필요');

      const alert = result.alerts[0];
      assert.strictEqual(alert.user_id, consumerId);
      assertAlertSchema(alert);

      // DB에 AI_ALERT 이벤트 저장 확인
      const { data: aiEvents } = await supabaseAdmin
        .from('security_events')
        .select('*')
        .eq('user_id', consumerId)
        .eq('event_type', 'AI_ALERT')
        .order('created_at', { ascending: false })
        .limit(1);

      assert.ok(aiEvents?.length >= 1, 'AI_ALERT 이벤트가 DB에 저장되어야 함');
      const detail = aiEvents[0].detail;
      assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(detail.risk_level));
      assert.strictEqual(typeof detail.block_recommendation, 'boolean');
      assert.ok(detail.model, 'model 필드가 기록되어야 함');
    });

    test('TC-AI-R03 존재하지 않는 user_id 지정 시 count: 0', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      const result = await aiAnalyzer.runOnce('00000000-0000-0000-0000-000000000000');

      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.alerts, []);
    });

    test('TC-AI-R04 차단된 user는 selectTargets에서 제외', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      // consumer 차단
      await supabaseAdmin
        .from('users')
        .update({ is_blocked: true, block_reason: '테스트 차단', blocked_at: new Date().toISOString() })
        .eq('id', consumerId);

      const result = await aiAnalyzer.runOnce(null);

      // 차단된 user는 분석 대상에서 제외되어야 함
      const included = result.alerts.some((a) => a.user_id === consumerId);
      assert.ok(!included, '차단된 user가 alerts에 포함되면 안 됨');

      // 복원
      await supabaseAdmin
        .from('users')
        .update({ is_blocked: false, block_reason: null, blocked_at: null })
        .eq('id', consumerId);
    });

    test('TC-AI-R05 DISABLE_AI=true 시 runOnce → { count: 0, alerts: [] }', async () => {
      const original = process.env.DISABLE_AI;
      process.env.DISABLE_AI = 'true';
      try {
        const result = await aiAnalyzer.runOnce(null);
        assert.strictEqual(result.count, 0);
        assert.deepStrictEqual(result.alerts, []);
      } finally {
        process.env.DISABLE_AI = original;
      }
    });
  });

  // ────────────────────────────────────────────────────
  // C. POST /api/security/ai-analyze API 테스트
  //    전제: 서버가 DISABLE_AI=false 로 기동 중
  // ────────────────────────────────────────────────────

  describe('C. POST /api/security/ai-analyze API 테스트 (서버 DISABLE_AI=false 전제)', () => {

    test('TC-AI-A01 분석 대상 없을 때 200 + count: 0', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      // 별도 신규 user를 대상으로 지정해 count: 0 유도
      const res = await request(BASE_URL)
        .post('/api/security/ai-analyze')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ user_id: adminId });

      if (res.status === 503) return t.skip('서버 DISABLE_AI=true 상태');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(typeof res.body.data.count, 'number');
      assert.ok(Array.isArray(res.body.data.alerts));
    });

    test('TC-AI-A02 조건 충족 user 존재 시 alerts 구조 검증', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      await seedAbnormalEvents(consumerId, 4);

      const res = await request(BASE_URL)
        .post('/api/security/ai-analyze')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ user_id: consumerId });

      if (res.status === 503) return t.skip('서버 DISABLE_AI=true 상태');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const { count, alerts } = res.body.data;
      assert.ok(count >= 1, 'count가 1 이상이어야 함');
      assert.ok(alerts.length >= 1, 'alerts 배열에 항목이 있어야 함');

      for (const alert of alerts) {
        assertAlertSchema(alert);
        assert.ok(alert.user_id, 'alert에 user_id 포함 필요');
        assert.ok(alert.email,   'alert에 email 포함 필요');
      }
    });

    test('TC-AI-A03 존재하지 않는 user_id → 200 + count: 0', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      const res = await request(BASE_URL)
        .post('/api/security/ai-analyze')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ user_id: '00000000-0000-0000-0000-000000000000' });

      if (res.status === 503) return t.skip('서버 DISABLE_AI=true 상태');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.count, 0);
      assert.deepStrictEqual(res.body.data.alerts, []);
    });

    test('TC-AI-A04 user_id 없이 호출 → 전체 자동 선정 (200 + 응답 포맷 확인)', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      const res = await request(BASE_URL)
        .post('/api/security/ai-analyze')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      if (res.status === 503) return t.skip('서버 DISABLE_AI=true 상태');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(typeof res.body.data.count, 'number');
      assert.ok(Array.isArray(res.body.data.alerts));
    });

    test('TC-AI-A05 AI_ALERT 이벤트가 security_events에 저장되어 조회 가능', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      await seedAbnormalEvents(consumerId, 4);

      const analyze = await request(BASE_URL)
        .post('/api/security/ai-analyze')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ user_id: consumerId });

      if (analyze.status === 503) return t.skip('서버 DISABLE_AI=true 상태');
      assert.strictEqual(analyze.status, 200);

      // events 목록에서 AI_ALERT 이벤트 확인
      const events = await request(BASE_URL)
        .get('/api/security/events')
        .set('Authorization', `Bearer ${adminToken}`);

      assert.strictEqual(events.status, 200);
      const aiAlerts = events.body.data.events.filter(
        (ev) => ev.event_type === 'AI_ALERT' && ev.user_id === consumerId
      );
      assert.ok(aiAlerts.length >= 1, 'AI_ALERT 이벤트가 목록에 조회되어야 함');
    });
  });

  // ────────────────────────────────────────────────────
  // D. AI 응답 한국어 검증
  // ────────────────────────────────────────────────────

  describe('D. AI 응답 언어 및 품질 검증', () => {

    test('TC-AI-Q01 reason_ko / user_message_ko 가 한국어 포함', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      await seedAbnormalEvents(consumerId, 4);
      const result = await aiAnalyzer.runOnce(consumerId);

      if (result.alerts.length === 0) return t.skip('분석 대상 없음');

      const alert = result.alerts[0];
      const koreanPattern = /[가-힣]/;
      assert.ok(koreanPattern.test(alert.reason_ko),
        `reason_ko에 한국어가 포함되어야 함: "${alert.reason_ko}"`);
      assert.ok(koreanPattern.test(alert.user_message_ko),
        `user_message_ko에 한국어가 포함되어야 함: "${alert.user_message_ko}"`);
    });

    test('TC-AI-Q02 patterns 배열이 비어있지 않음 (이상 이벤트 존재 시)', async (t) => {
      if (!ollamaReachable) return t.skip('AI 서버 미연결');

      await seedAbnormalEvents(consumerId, 4);
      const result = await aiAnalyzer.runOnce(consumerId);

      if (result.alerts.length === 0) return t.skip('분석 대상 없음');

      const alert = result.alerts[0];
      assert.ok(alert.patterns.length >= 1, 'patterns 배열에 항목이 있어야 함');
      assert.strictEqual(typeof alert.patterns[0], 'string', 'patterns 요소는 string이어야 함');
    });
  });
});
