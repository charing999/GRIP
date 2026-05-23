const crypto = require('crypto');
const { supabase, supabaseAdmin } = require('../lib/supabase');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// POST /api/auth/register
async function register(req, res) {
  const { email, password, role } = req.body || {};

  if (!email || !EMAIL_REGEX.test(email))
    return fail(res, 400, 'INVALID_INPUT', '유효한 이메일 주소를 입력하세요.');

  if (!password || password.length < 8 || password.length > 128)
    return fail(res, 400, 'INVALID_INPUT', '비밀번호는 8자 이상 128자 이하이어야 합니다.');

  if (!['merchant', 'consumer', 'admin'].includes(role))
    return fail(res, 400, 'INVALID_INPUT', "역할은 'merchant', 'consumer', 'admin' 중 하나이어야 합니다.");

  if (!supabaseAdmin) return fail(res, 500, 'SERVER_ERROR', '서버 설정 오류입니다.');

  // 중복 이메일 확인
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) return fail(res, 400, 'EMAIL_EXISTS', '이미 사용 중인 이메일입니다.');

  // Supabase Auth에 사용자 생성 (service role key로 이메일 확인 건너뜀)
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    const isdup = authError.message?.toLowerCase().includes('already');
    return fail(res, 400, 'REGISTER_FAILED', isdup ? '이미 사용 중인 이메일입니다.' : '회원가입에 실패하였습니다.');
  }

  const authUser = authData?.user;
  if (!authUser) return fail(res, 500, 'REGISTER_FAILED', '회원가입 처리 중 오류가 발생하였습니다.');

  // public.users 테이블에 프로필 삽입
  const { error: dbError } = await supabaseAdmin.from('users').insert({
    id: authUser.id,
    role,
    email,
    password_hash: sha256(email + password),
    balance: 0,
  });

  if (dbError) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch(() => {});
    return fail(res, 500, 'REGISTER_FAILED', '회원 정보 저장에 실패하였습니다.');
  }

  return res.status(201).json({
    success: true,
    data: {
      message: '회원가입이 완료되었습니다.',
      user: { id: authUser.id, email, role },
    },
  });
}

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password)
    return fail(res, 400, 'INVALID_INPUT', '이메일과 비밀번호를 입력하세요.');

  if (!supabaseAdmin || !supabase) return fail(res, 500, 'SERVER_ERROR', '서버 설정 오류입니다.');

  // 계정 조회 (admin 클라이언트로 RLS 우회)
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  // 계정이 없으면 자격증명 오류 (이메일 열거 방지)
  if (!user) return fail(res, 401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');

  // AI 차단 확인
  if (user.is_blocked)
    return fail(res, 403, 'USER_BLOCKED', user.block_reason || '계정이 차단되었습니다.');

  // 계정 잠금 확인
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'ACCOUNT_LOCKED',
        message: '계정이 잠겼습니다. 잠시 후 다시 시도하세요.',
        unlock_at: user.locked_until,
      },
    });
  }

  // Supabase Auth로 로그인 (JWT 발급) — anon 클라이언트 사용
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

  if (signInError || !session?.session) {
    const newCount = (user.failed_login_count || 0) + 1;
    const updates = { failed_login_count: newCount };

    if (newCount >= 5) {
      updates.locked_until = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      updates.failed_login_count = 0;
    }

    await supabaseAdmin.from('users').update(updates).eq('id', user.id);

    if (updates.locked_until) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: '로그인 5회 실패로 계정이 30분간 잠겼습니다.',
          unlock_at: updates.locked_until,
        },
      });
    }

    return fail(res, 401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
  }

  // 성공 — 실패 카운트 초기화, 잠금 해제
  await supabaseAdmin.from('users').update({
    failed_login_count: 0,
    locked_until: null,
  }).eq('id', user.id);

  return res.status(200).json({
    success: true,
    data: {
      token: session.session.access_token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        balance: user.balance,
      },
    },
  });
}

// POST /api/auth/logout
async function logout(req, res) {
  // 클라이언트 세션 무효화는 클라이언트에서 수행.
  // 서버에서는 성공 응답만 반환 (SSE 연결 등 서버 자원 정리는 각 핸들러에서 처리).
  return res.status(200).json({
    success: true,
    data: { message: '로그아웃되었습니다.' },
  });
}

module.exports = { register, login, logout };
