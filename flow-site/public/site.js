(() => {
  const $ = (s) => document.querySelector(s);
  function showLogin() {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');
    if (window.DevameerPipeline) DevameerPipeline.close();
  }
  function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (window.DevameerPipeline) DevameerPipeline.open();
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
  (async () => {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      if (r.ok) showApp();
      else showLogin();
    } catch { showLogin(); }
  })();
})();
