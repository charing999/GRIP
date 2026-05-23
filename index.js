require('dotenv').config();
const express = require('express');
const path = require('path');
const { supabase } = require('./lib/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes (Phase 2에서 구현)
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/payments',  require('./routes/payments'));
app.use('/api/security',  require('./routes/security'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/api/health', async (req, res) => {
  const result = { server: 'ok', db: 'unknown' };

  // Supabase 연결 확인 — SDK의 getSession()으로 API 키 유효성 검증
  if (!supabase) {
    result.db = 'not_configured';
  } else {
    try {
      const { error } = await supabase.auth.getSession();
      result.db = error ? 'error' : 'ok';
    } catch {
      result.db = 'error';
    }
  }

  const ok = result.db === 'ok';
  const status = result.db === 'error' ? 500 : 200;
  res.status(status).json({ success: ok, data: result });
});

app.listen(PORT, () => {
  console.log(`GRIP server  → http://localhost:${PORT}`);
  console.log(`Health check → http://localhost:${PORT}/api/health`);
});
