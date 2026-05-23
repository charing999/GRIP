-- GRIP 스키마 — Supabase SQL Editor에서 실행
-- 실행 순서: 함수 → 테이블 → 트리거 → RLS

-- ────────────────────────────────────────────────────────────────────────────
-- 함수: grant_signup_bonus (users BEFORE INSERT 트리거용)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_signup_bonus()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 테이블 생성
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  role               text        NOT NULL,
  email              text        NOT NULL,
  password_hash      text        NOT NULL,
  balance            integer     NOT NULL DEFAULT 0,
  failed_login_count integer     NOT NULL DEFAULT 0,
  locked_until       timestamptz NULL,
  is_blocked         boolean     NOT NULL DEFAULT false,
  block_reason       text        NULL,
  blocked_at         timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey         PRIMARY KEY (id),
  CONSTRAINT users_email_key    UNIQUE (email),
  CONSTRAINT users_balance_check CHECK (balance >= 0),
  CONSTRAINT users_role_check   CHECK (role = ANY (ARRAY['merchant','consumer','admin']))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON public.users USING btree (role);

CREATE OR REPLACE TRIGGER trg_signup_bonus
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.grant_signup_bonus();

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.merchants (
  user_id      uuid             NOT NULL,
  market_name  text             NOT NULL,
  store_name   text             NOT NULL,
  category     text             NULL,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  secret_key   text             NOT NULL,
  phone        text             NULL,
  created_at   timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT merchants_pkey       PRIMARY KEY (user_id),
  CONSTRAINT merchants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT merchants_lat_check  CHECK (lat  BETWEEN -90  AND  90),
  CONSTRAINT merchants_lng_check  CHECK (lng  BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS idx_merchants_market   ON public.merchants USING btree (market_name);
CREATE INDEX IF NOT EXISTS idx_merchants_category ON public.merchants USING btree (category);
CREATE INDEX IF NOT EXISTS idx_merchants_location ON public.merchants USING btree (lat, lng);

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.transactions (
  id                 bigserial   NOT NULL,
  payment_request_id uuid        NOT NULL,
  consumer_id        uuid        NOT NULL,
  merchant_id        uuid        NOT NULL,
  amount             integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_pkey             PRIMARY KEY (id),
  CONSTRAINT transactions_consumer_id_fkey FOREIGN KEY (consumer_id) REFERENCES public.users (id),
  CONSTRAINT transactions_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.users (id)
);

CREATE INDEX IF NOT EXISTS idx_tx_merchant ON public.transactions USING btree (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_consumer ON public.transactions USING btree (consumer_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_events (
  id         bigserial   NOT NULL,
  event_type text        NOT NULL,
  ip         text        NULL,
  user_id    uuid        NULL,
  detail     jsonb       NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_events_pkey            PRIMARY KEY (id),
  CONSTRAINT security_events_user_id_fkey    FOREIGN KEY (user_id) REFERENCES public.users (id),
  CONSTRAINT security_events_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'SQLI_BLOCKED','BRUTE_FORCE','INVALID_QR','REPLAY_QR',
      'LOCATION_MISMATCH','CHAIN_BROKEN','PAYMENT_OK','AI_ALERT',
      'QR_REVOKED_USED','QR_EXPIRED_USED'
    ])
  )
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON public.security_events USING btree (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time      ON public.security_events USING btree (created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.merchant_qr_codes (
  qr_id          uuid             NOT NULL DEFAULT gen_random_uuid(),
  merchant_id    uuid             NOT NULL,
  merchant_lat   double precision NOT NULL,
  merchant_lng   double precision NOT NULL,
  hmac_signature text             NOT NULL,
  issued_at      timestamptz      NOT NULL DEFAULT now(),
  expires_at     timestamptz      NOT NULL,
  status         text             NOT NULL DEFAULT 'active',
  revoked_at     timestamptz      NULL,
  revoked_reason text             NULL,
  print_batch_id text             NULL,
  created_at     timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT merchant_qr_codes_pkey           PRIMARY KEY (qr_id),
  CONSTRAINT merchant_qr_codes_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.users (id),
  CONSTRAINT merchant_qr_codes_status_check   CHECK (status = ANY (ARRAY['active','revoked','expired']))
);

CREATE INDEX IF NOT EXISTS idx_qr_merchant_status ON public.merchant_qr_codes USING btree (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_qr_batch           ON public.merchant_qr_codes USING btree (print_batch_id);

-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_sessions (
  session_id   uuid             NOT NULL DEFAULT gen_random_uuid(),
  qr_id        uuid             NOT NULL,
  merchant_id  uuid             NOT NULL,
  consumer_id  uuid             NOT NULL,
  amount       integer          NOT NULL,
  nonce        text             NOT NULL,
  consumer_lat double precision NOT NULL,
  consumer_lng double precision NOT NULL,
  distance_m   double precision NULL,
  status       text             NOT NULL DEFAULT 'pending',
  expires_at   timestamptz      NOT NULL,
  created_at   timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT payment_sessions_pkey            PRIMARY KEY (session_id),
  CONSTRAINT payment_sessions_nonce_key       UNIQUE (nonce),
  CONSTRAINT payment_sessions_qr_id_fkey      FOREIGN KEY (qr_id)       REFERENCES public.merchant_qr_codes (qr_id),
  CONSTRAINT payment_sessions_merchant_id_fkey FOREIGN KEY (merchant_id) REFERENCES public.users (id),
  CONSTRAINT payment_sessions_consumer_id_fkey FOREIGN KEY (consumer_id) REFERENCES public.users (id),
  CONSTRAINT payment_sessions_amount_check    CHECK (amount > 0),
  CONSTRAINT payment_sessions_status_check    CHECK (
    status = ANY (ARRAY['pending','completed','rejected','expired'])
  )
);

CREATE INDEX IF NOT EXISTS idx_session_qr       ON public.payment_sessions USING btree (qr_id, status);
CREATE INDEX IF NOT EXISTS idx_session_consumer ON public.payment_sessions USING btree (consumer_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS (Row Level Security)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_qr_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_sessions   ENABLE ROW LEVEL SECURITY;

-- 인증된 사용자: 자신의 행만 조회
CREATE POLICY "users_select_own"
  ON public.users FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- merchants: 자신의 가게 행만 조회/수정
CREATE POLICY "merchants_select_own"
  ON public.merchants FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "merchants_insert_own"
  ON public.merchants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "merchants_update_own"
  ON public.merchants FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- transactions: 자신이 관여한 거래만 조회
CREATE POLICY "transactions_select_own"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = consumer_id OR auth.uid() = merchant_id);

-- security_events: 자신과 관련된 이벤트만 조회
CREATE POLICY "security_events_select_own"
  ON public.security_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- merchant_qr_codes: 자신의 QR만 조회/수정
CREATE POLICY "qr_codes_select_own"
  ON public.merchant_qr_codes FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);

CREATE POLICY "qr_codes_insert_own"
  ON public.merchant_qr_codes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = merchant_id);

CREATE POLICY "qr_codes_update_own"
  ON public.merchant_qr_codes FOR UPDATE TO authenticated
  USING (auth.uid() = merchant_id);

-- payment_sessions: 자신이 관여한 세션만 조회
CREATE POLICY "sessions_select_own"
  ON public.payment_sessions FOR SELECT TO authenticated
  USING (auth.uid() = consumer_id OR auth.uid() = merchant_id);
