const { supabaseAdmin } = require('../lib/supabase');

const SQLI_PATTERN = /('|"|;|--|#|\/\*|\*\/|UNION|SELECT|DROP|INSERT|UPDATE)/i;

async function logSqliEvent(ip, field, payload) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from('security_events').insert({
    event_type: 'SQLI_BLOCKED',
    ip,
    detail: { field, payload },
  });
}

module.exports = async (req, res, next) => {
  const { email, password } = req.body || {};
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  for (const [field, value] of [['email', email], ['password', password]]) {
    if (typeof value === 'string' && SQLI_PATTERN.test(value)) {
      await logSqliEvent(ip, field, value);
      return res.status(401).json({
        success: false,
        error: { code: 'SQLI_DETECTED', message: 'SQL Injection 패턴이 감지되었습니다.' },
      });
    }
  }

  next();
};
