(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const theme = () => document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F9FAFB' : '#09090B');
    try { localStorage.setItem('devameer-theme', t === 'light' ? 'light' : 'dark'); } catch {}
  }
  $$('[data-theme-toggle]').forEach((b) => { b.onclick = () => setTheme(theme() === 'dark' ? 'light' : 'dark'); });

  function showLogin() {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');
    if (window.DevameerFlow) DevameerFlow.close();
  }
  function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (window.DevameerFlow) DevameerFlow.open();
  }

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { $('#loginErr').textContent = d.error || 'login failed'; return; }
      showApp();
    } catch { $('#loginErr').textContent = 'network error'; }
  };
  $('#logoutBtn')?.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    showLogin();
  });

  (async () => {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.dashboardUrl) {
          window.DEVAMEER_FLOW_OPTS = { ...(window.DEVAMEER_FLOW_OPTS || {}), dashboardUrl: d.dashboardUrl, standalone: true };
          const a = $('#flowDash'); if (a) a.href = d.dashboardUrl;
        }
        showApp();
      } else showLogin();
    } catch { showLogin(); }
  })();
})();
