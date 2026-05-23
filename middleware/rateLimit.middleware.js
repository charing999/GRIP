const { redis } = require('../lib/redis');
const { supabaseAdmin } = require('../lib/supabase');

const WINDOW_SEC = 60;
const MAX_REQUESTS = 10;

async function logBruteForce(ip, count) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('security_events').insert({
    event_type: 'BRUTE_FORCE',
    ip,
    detail: { message: `로그인 ${count}회 차단`, count },
  });
}

module.exports = async (req, res, next) => {
  if (!redis) return next();

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const key = `ratelimit:${ip}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SEC * 1000;

  try {
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(key, '-inf', windowStart);
    pipe.zadd(key, now, `${now}`);
    pipe.zcard(key);
    pipe.expire(key, WINDOW_SEC);
    const results = await pipe.exec();

    const count = results[2][1];
    if (count > MAX_REQUESTS) {
      await logBruteForce(ip, count);
      return res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: '요청 한도를 초과하였습니다. 잠시 후 다시 시도하세요.' },
      });
    }
  } catch {
    // Redis 장애 시 통과 허용
  }

  next();
};
