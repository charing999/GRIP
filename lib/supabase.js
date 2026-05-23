const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('[Supabase] SUPABASE_URL / SUPABASE_ANON_KEY 미설정 — .env 파일을 확인하세요.');
}

// 클라이언트용 (anon key — RLS 적용)
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

// 서버 전용 (service role key — RLS 우회, 클라이언트에 절대 노출 금지)
const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

module.exports = { supabase, supabaseAdmin };
