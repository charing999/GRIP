const { supabase, supabaseAdmin } = require('../lib/supabase');

module.exports = async (req, res, next) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '인증 토큰이 필요합니다.' },
    });
  }

  const client = supabaseAdmin || supabase;
  if (!client) {
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: '서버 설정 오류입니다.' },
    });
  }

  const { data: { user }, error } = await client.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '유효하지 않은 인증 토큰입니다.' },
    });
  }

  // public.users에서 추가 정보 조회
  const { data: profile } = await client
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  req.user = profile || { id: user.id, email: user.email };
  req.token = token;
  next();
};
