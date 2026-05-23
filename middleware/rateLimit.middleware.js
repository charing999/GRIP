const { supabaseAdmin } = require('../lib/supabase');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;

// in-memory sliding window: ip -> [timestamp, ...]
const store = new Map();

async function logBruteForce(ip, count) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('security_events').insert({
    event_type: 'BRUTE_FORCE',
    ip,
    detail: { message: `로그인 ${count}회 차단`, count },
  });
}

module.exports = async (req, res, next) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (store.get(ip) || []).filter(t => t > windowStart);
  timestamps.push(now);
  store.set(ip, timestamps);

  const count = timestamps.length;
  if (count > MAX_REQUESTS) {
    await logBruteForce(ip, count);
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMITED', message: '요청 한도를 초과하였습니다. 잠시 후 다시 시도하세요.' },
    });
  }

  next();
};
