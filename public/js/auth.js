function showTab(tab) {
  const loginForm    = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const tabLogin     = document.getElementById('tabLogin');
  const tabRegister  = document.getElementById('tabRegister');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
  } else {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
  }
}

function setError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}


function renderDashboard(user) {
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('dashboardPanel').classList.remove('hidden');
  document.getElementById('welcomeMsg').textContent = `안녕하세요, ${user.email}님`;
  document.getElementById('userRole').textContent = user.role;
  document.getElementById('userBalance').textContent = (user.balance ?? 0).toLocaleString();

  const panels = ['merchantPanel', 'consumerPanel', 'adminPanel'];
  panels.forEach(id => document.getElementById(id)?.classList.add('hidden'));

  const roleMap = { merchant: 'merchantPanel', consumer: 'consumerPanel', admin: 'adminPanel' };
  document.getElementById(roleMap[user.role])?.classList.remove('hidden');

  API.renderNav(user);
}

function renderLoggedOut() {
  document.getElementById('authPanel').classList.remove('hidden');
  document.getElementById('dashboardPanel').classList.add('hidden');
  API.renderNav(null);
}

async function handleLogin(e) {
  e.preventDefault();
  setError('loginError', '');

  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { ok, data } = await API.api('POST', '/auth/login', { email, password });

  if (!ok) {
    const err = data.error || {};
    let msg = err.message || '로그인에 실패하였습니다.';
    if (err.unlock_at) {
      const t = new Date(err.unlock_at).toLocaleTimeString('ko-KR');
      msg += ` (${t} 이후 재시도 가능)`;
    }
    setError('loginError', msg);
    return;
  }

  API.saveSession(data.data.token, data.data.user);
  renderDashboard(data.data.user);
}

async function handleRegister(e) {
  e.preventDefault();
  setError('registerError', '');

  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const role     = document.getElementById('regRole').value;

  const { ok, data } = await API.api('POST', '/auth/register', { email, password, role });

  if (!ok) {
    setError('registerError', data.error?.message || '회원가입에 실패하였습니다.');
    return;
  }

  alert(`회원가입 완료! 이메일: ${email}\n이제 로그인하세요.`);
  showTab('login');
  document.getElementById('loginEmail').value = email;
}

async function handleLogout() {
  await API.api('POST', '/auth/logout', {});
  API.clearSession();
  renderLoggedOut();
}

API.handleLogout = handleLogout;

// 페이지 로드 시 세션 복원
(function init() {
  const user = API.getUser();
  if (user && API.getToken()) {
    renderDashboard(user);
  } else {
    renderLoggedOut();
  }
})();
