require('dotenv').config();
const { test, describe } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const hmac = require('../../lib/hmac');
const haversine = require('../../lib/haversine');

describe('8-1. HMAC 서명 및 Haversine 거리 계산 단위 테스트', () => {

  describe('HMAC 서명 검증', () => {
    const qrId = '11111111-1111-1111-1111-111111111111';
    const merchantId = '22222222-2222-2222-2222-222222222222';
    const lat = 36.35044;
    const lng = 127.38454;

    test('TC-HM01 서명 메시지 구성 정확성', () => {
      // sign 함수 내부에서 구성되는 메시지가 "${qrId}:${merchantId}:36.3504:127.3845" 인지 검증
      // 똑같은 비밀키와 메시지 구조로 로컬에서 직접 생성한 HMAC 서명과 hmac.sign()의 결과가 일치하는지 대조
      const expectedMessage = `${qrId}:${merchantId}:36.3504:127.3845`;
      const secret = process.env.HMAC_SECRET || '';
      const localSignature = crypto.createHmac('sha256', secret).update(expectedMessage).digest('hex');

      const serverSignature = hmac.sign(qrId, merchantId, lat, lng);
      assert.strictEqual(serverSignature, localSignature);
    });

    test('TC-HM02 verify — 정상 케이스', () => {
      const signature = hmac.sign(qrId, merchantId, lat, lng);
      const isVerified = hmac.verify(qrId, merchantId, lat, lng, signature);
      assert.strictEqual(isVerified, true);
    });

    test('TC-HM03 verify — 서명 1자 변경', () => {
      const signature = hmac.sign(qrId, merchantId, lat, lng);
      // 서명 마지막 글자를 다른 글자로 변조
      const lastChar = signature[signature.length - 1];
      const alteredChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedSignature = signature.slice(0, -1) + alteredChar;

      const isVerified = hmac.verify(qrId, merchantId, lat, lng, tamperedSignature);
      assert.strictEqual(isVerified, false);
    });

    test('TC-HM04 verify — 빈 서명', () => {
      const isVerified = hmac.verify(qrId, merchantId, lat, lng, '');
      assert.strictEqual(isVerified, false);
    });
  });

  describe('Haversine 거리 계산', () => {
    test('TC-HM05 Haversine 거리 계산 정확성', () => {
      // 1. 동일 좌표간의 거리 -> 0m
      const zeroDist = haversine.distance(36.3504, 127.3845, 36.3504, 127.3845);
      assert.strictEqual(zeroDist, 0);

      // 2. 대전(36.3504, 127.3845) <-> 서울(37.5665, 126.9780) -> 직선거리 약 140km (Haversine 정밀값 대략 140,004m)
      const deajeonSeoulDist = haversine.distance(36.3504, 127.3845, 37.5665, 126.9780);
      assert.ok(Math.abs(deajeonSeoulDist - 140004) < 500, `Expected around 140004m, got ${deajeonSeoulDist}m`);

      // 3. 100m 간격 좌표 간의 거리 -> 약 100m
      // 위도 100m 차이는 대략 위도 변동 0.00089928 도
      const borderLat = 36.3504 + (100 / 6371000) * (180 / Math.PI);
      const exact100mDist = haversine.distance(36.3504, 127.3845, borderLat, 127.3845);
      assert.ok(Math.abs(exact100mDist - 100) < 1, `Expected around 100m, got ${exact100mDist}m`);
    });
  });

});
