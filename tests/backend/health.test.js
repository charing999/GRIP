require('dotenv').config();
const { test, describe } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const BASE_URL = 'http://localhost:3000';

describe('7. 헬스체크 API 테스트', () => {

  test('TC-HC01 & TC-HC02 서버 및 DB 정상 상태 및 인증 불필요 확인', async () => {
    const res = await request(BASE_URL).get('/api/health');

    // Supabase 설정 완료 상태인 경우 200 OK를 반환합니다.
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.server, 'ok');
    assert.strictEqual(res.body.data.db, 'ok');
  });

});
