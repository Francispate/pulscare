// PASTE AS: public/js/api.js  (replaces the old file)  Day 11: an admin who logs out returns to the admin login.
// Shared client core: session, API calls, socket connection.
(function () {
  const PC = (window.PC = {});
  PC.token = sessionStorage.getItem('pc_token');
  PC.user = JSON.parse(sessionStorage.getItem('pc_user') || 'null');

  PC.setSession = (token, user) => {
    sessionStorage.setItem('pc_token', token);
    sessionStorage.setItem('pc_user', JSON.stringify(user));
    PC.token = token; PC.user = user;
  };
  PC.logout = () => {
    const lang = sessionStorage.getItem('pc_lang');
    const wasAdmin = PC.user && PC.user.role === 'admin';
    sessionStorage.clear();
    if (lang) sessionStorage.setItem('pc_lang', lang);
    location.href = wasAdmin ? '/admin.html' : '/index.html';
  };
  PC.require = (role) => {
    if (!PC.token || !PC.user || PC.user.role !== role) { location.href = '/index.html'; return false; }
    return true;
  };
  PC.api = async (method, path, body) => {
    const res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(PC.token ? { Authorization: 'Bearer ' + PC.token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401 && PC.token) { PC.logout(); }
    if (!res.ok) { const err = new Error((data && data.error) || 'Request failed.'); err.status = res.status; throw err; }
    return data;
  };
  let sock = null;
  PC.socket = () => {
    if (!sock && PC.token && window.io) {
      sock = io({ auth: { token: PC.token } });
      sock.on('connect_error', (e) => { if (e.message === 'unauthorized') PC.logout(); });
    }
    return sock;
  };
  PC.openDoc = (appointmentId, type) => window.open(`/api/documents/${appointmentId}/${type}?token=${encodeURIComponent(PC.token)}`, '_blank');
  PC.money = (n) => 'Rs ' + Number(n).toLocaleString('en-IN');
  PC.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
})();
