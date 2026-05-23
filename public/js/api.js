const TOKEN_KEY = 'grip_token';
const USER_KEY  = 'grip_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser()  { const u = localStorage.getItem(USER_KEY); return u ? JSON.parse(u) : null; }

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  return { ok: res.ok, status: res.status, data: json };
}

function renderNav(user) {
  const nav = document.getElementById('navActions');
  if (!nav) return;
  if (user) {
    nav.innerHTML = `
      <span class="nav-user">${user.email} (${user.role})</span>
      <button class="btn btn-outline" onclick="API.handleLogout()">로그아웃</button>
    `;
  } else {
    nav.innerHTML = '';
  }
}

async function handleLogout() {
  await api('POST', '/auth/logout', {});
  clearSession();
  location.href = '/';
}

window.API = { api, getToken, getUser, saveSession, clearSession, renderNav, handleLogout };
