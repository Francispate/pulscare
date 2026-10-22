// PASTE AS: public/js/ui.js  Day 11: admin link; no bell for admins. Day 10: "My record" link for patients. (replaces the old file)  Day 9: notification bell in the header (live alerts, unread count, mark as read).
// Shared chrome: navigation, the pipeline strip (explains the backend to the client), and the Backend Activity drawer.
(function () {
  const STEPS = [
    { name: 'Triage', proto: 'A short survey in English, Hindi or Kannada maps symptoms to a specialist using simple rules.',
      final: 'Survey answers are saved and shown to the doctor before the call.', result: 'The patient reaches the right doctor first time.' },
    { name: 'Sign in', proto: 'Passwords are stored as bcrypt hashes. The server issues a signed login token (JWT) and checks the role on every request.',
      final: 'Email verification, login rate limits, and an audit log of who did what.', result: 'Only the right person sees the right medical data.' },
    { name: 'Doctor online', proto: 'Doctors switch online or offline. Every patient sees the change instantly. Closing the browser marks the doctor offline.',
      final: 'Doctor schedules, booking slots, and an admin panel.', result: 'Patients only see doctors who can answer now, or book a time.' },
    { name: 'Request', proto: 'A request appears on the doctor’s screen the moment it is sent. It expires after 2 minutes. Accepting creates a private room.',
      final: 'Email and SMS notifications, plus appointment reminders.', result: 'No missed requests, fewer no-shows.' },
    { name: 'Video and chat', proto: 'Live video goes directly between the two browsers. Chat is encrypted in the browser; the database holds only unreadable ciphertext.',
      final: 'Token-secured video rooms, long-term encryption keys, and key fingerprint checks.', result: 'Private consultations that even the server operator cannot read.' },
    { name: 'Live captions', proto: 'Speech becomes text in the speaker’s browser and appears on the other person’s screen as they speak. Everything said is kept in a captions panel. Patients are matched to doctors who speak their language.',
      final: 'A managed speech service with a medical word list, and captions saved to the patient record with consent.', result: 'A Kannada-speaking patient is matched with a Kannada-speaking doctor and can follow along with live captions.' },
    { name: 'Payment', proto: 'After the call ends, the patient pays. The server reads the fee from the database and verifies the payment. The gateway itself is simulated.',
      final: 'Razorpay with a backup webhook, UPI QR, and payment reconciliation.', result: 'Real payments that still confirm if the patient closes the tab.' },
    { name: 'Documents', proto: 'Two separate PDFs are created on the server after payment: the prescription (signed, with QR) and the invoice. Our prototype signature is used.',
      final: 'The doctor’s licensed digital signature, cloud storage, and tamper-proof records.', result: 'A prescription a pharmacy can verify, and an invoice for accounts.' }
  ];
  window.PC_STEPS = STEPS;

  const LOGO = '<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#0F8B7D"/><path d="M3 17h7l3-7 5 13 3-6h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------- Notification bell (Day 9) ----------
  const BELL_HTML = `<div class="bell-wrap">
      <button class="bell-btn" id="bell-btn" aria-label="Notifications" aria-expanded="false" aria-haspopup="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="bell-badge" id="bell-badge" hidden>0</span>
      </button>
      <div class="bell-panel" id="bell-panel" hidden role="dialog" aria-label="Notifications">
        <div class="bell-head"><b>Notifications</b><button class="btn btn-ghost btn-sm" id="bell-readall">Mark all read</button></div>
        <div class="bell-list" id="bell-list"></div>
      </div>
    </div>`;
  const BELL_CSS = `
    .bell-wrap{position:relative}
    .bell-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);cursor:pointer}
    .bell-btn:hover{background:var(--teal-wash);color:var(--teal-dark)}
    .bell-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--coral);color:#fff;font-size:.7rem;font-weight:700;line-height:18px;text-align:center}
    .bell-panel{position:absolute;right:0;top:46px;width:min(360px,92vw);max-height:70vh;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 34px rgba(18,38,58,.18);z-index:60;overflow:hidden}
    .bell-panel[hidden],.bell-badge[hidden]{display:none}
    .bell-head{display:flex;align-items:center;justify-content:space-between;padding:.6rem .8rem;border-bottom:1px solid var(--line)}
    .bell-list{overflow-y:auto}
    .bell-empty{padding:1.4rem 1rem;text-align:center;color:var(--muted);font-size:.9rem}
    .bell-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:var(--card);padding:.65rem .8rem .65rem 1.4rem;cursor:pointer;position:relative;font:inherit;color:var(--ink)}
    .bell-item:hover{background:var(--paper)}
    .bell-item.unread{background:var(--teal-wash)}
    .bell-item.unread::before{content:'';position:absolute;left:.6rem;top:1rem;width:8px;height:8px;border-radius:50%;background:var(--teal)}
    .bell-item .t{font-weight:700;font-size:.9rem}
    .bell-item .b{font-size:.84rem;color:var(--ink-soft);margin-top:.1rem}
    .bell-item .w{font-size:.74rem;color:var(--muted);margin-top:.2rem}
    .bell-toast{position:fixed;right:16px;bottom:70px;max-width:340px;z-index:80;background:var(--ink);color:#fff;border-radius:12px;padding:.7rem .9rem;box-shadow:0 10px 30px rgba(0,0,0,.28);cursor:pointer;font-size:.88rem}
    .bell-toast b{display:block;margin-bottom:.1rem}`;

  function bell() {
    const btn = document.getElementById('bell-btn');
    if (!btn || !window.PC || !PC.user) return;
    const st = document.createElement('style'); st.textContent = BELL_CSS; document.head.appendChild(st);
    const badge = document.getElementById('bell-badge'), panel = document.getElementById('bell-panel'), list = document.getElementById('bell-list');
    let items = [], unread = 0;

    const ago = (iso) => {
      const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + ' h ago';
      return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };
    const render = () => {
      badge.hidden = unread <= 0; badge.textContent = unread > 99 ? '99+' : unread;
      btn.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
      list.innerHTML = items.length ? items.map((n) => `<button class="bell-item ${n.read ? '' : 'unread'}" data-id="${PC.esc(n.id)}">
          <div class="t">${PC.esc(n.title)}</div>${n.body ? `<div class="b">${PC.esc(n.body)}</div>` : ''}<div class="w">${ago(n.createdAt)}</div></button>`).join('')
        : '<div class="bell-empty">No notifications yet.</div>';
    };
    const load = async () => { try { const r = await PC.api('GET', '/notifications'); items = r.items; unread = r.unread; render(); } catch (e) { /* the bell stays quiet if the server is busy */ } };
    const here = (link) => { try { const u = new URL(link, location.origin); return u.pathname === location.pathname && u.search === location.search; } catch { return false; } };

    const toast = (n) => {
      const t = document.createElement('div'); t.className = 'bell-toast'; t.setAttribute('role', 'status');
      t.innerHTML = `<b>${PC.esc(n.title)}</b>${PC.esc(n.body || '')}`;
      t.onclick = () => { t.remove(); open(n); };
      document.body.appendChild(t); setTimeout(() => t.remove(), 7000);
    };
    async function open(n) {
      if (!n.read) { n.read = true; unread = Math.max(0, unread - 1); render(); try { await PC.api('POST', '/notifications/' + encodeURIComponent(n.id) + '/read'); } catch (e) {} }
      panel.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (n.link && !here(n.link)) location.href = n.link;
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { render(); load(); } });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    list.addEventListener('click', (e) => { const el = e.target.closest('.bell-item'); if (!el) return; const n = items.find((x) => x.id === el.dataset.id); if (n) open(n); });
    document.getElementById('bell-readall').addEventListener('click', async () => {
      items.forEach((n) => { n.read = true; }); unread = 0; render();
      try { await PC.api('POST', '/notifications/read-all'); } catch (e) {}
    });

    const s = PC.socket();
    if (s) {
      s.on('notify:new', (n) => { items.unshift(n); items = items.slice(0, 50); unread++; render(); toast(n); });
      s.on('connect', load); // catches anything that arrived while the connection was down
    }
    load();
    setInterval(render, 60000); // keeps "5 min ago" fresh
  }

  function nav(active) {
    const u = window.PC && PC.user;
    const links = [['/index.html', 'Home', 'home']];
    if (u && u.role === 'patient') { links.push(['/patient.html', 'My care', 'dash']); links.push(['/record.html', 'My record', 'record']); }
    if (u && u.role === 'doctor') links.push(['/doctor.html', 'My patients', 'dash']);
    if (u && u.role === 'admin') links.push(['/admin.html', 'Admin', 'admin']);
    links.push(['/roadmap.html', 'Roadmap', 'roadmap']);
    return `<header class="nav">
      <a class="logo" href="/index.html">${LOGO}<span>Puls<em>care</em></span></a>
      <ul class="nav-links">${links.map(([h, t, k]) => `<li><a href="${h}" class="${active === k ? 'active' : ''}">${t}</a></li>`).join('')}</ul>
      <div class="nav-right">${u ? `${u.role === 'admin' ? '' : BELL_HTML}<span class="who">${PC.esc(u.name)}</span><button class="btn btn-ghost btn-sm" id="logout-btn">Log out</button>` : ''}</div>
    </header>`;
  }

  function pipeline(current) {
    const items = STEPS.map((s, i) => `<li class="${i + 1 === current ? 'current' : ''}">
      <button class="step-btn" data-i="${i}" aria-expanded="false"><span class="dot"></span><span class="label">${s.name}</span></button></li>`).join('');
    return `<section class="pipeline" aria-label="Pulscare pipeline">
      <div class="pipeline-head">
        <span><b>How this prototype works.</b> Select any step to see what runs in the backend, and what the final version adds.</span>
        <span class="legend"><span><i class="live"></i>Working now</span><span><i class="final"></i>Added in final version</span></span>
      </div>
      <ul class="steps">${items}</ul>
      <div class="step-panel" id="step-panel"></div>
    </section>`;
  }

  function wirePipeline() {
    const panel = document.getElementById('step-panel');
    let openIdx = -1;
    document.querySelectorAll('.step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        const open = openIdx !== i;
        document.querySelectorAll('.step-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        if (!open) { panel.classList.remove('open'); openIdx = -1; return; }
        const s = STEPS[i];
        panel.innerHTML = `<div class="title">${s.name}</div>
          <div><h4 class="tag-live">Working in this prototype</h4><p>${s.proto}</p></div>
          <div><h4 class="tag-final">Added in the final version</h4><p>${s.final}</p></div>
          <div><h4>What the user gets</h4><p>${s.result}</p></div>`;
        panel.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); openIdx = i;
      });
    });
  }

  function drawer() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<button class="act-toggle" id="act-toggle" aria-expanded="false">Backend activity <span class="count" id="act-count">0</span></button>
      <aside class="act-drawer" id="act-drawer" aria-label="Backend activity">
        <div class="act-head"><b>What the backend is doing</b><p>Live feed of real server events. Demo view: shows both the patient’s and the doctor’s actions.</p></div>
        <div class="act-list" id="act-list"><p class="muted small" style="padding:.8rem 0;color:#8DA5B6">Waiting for activity. Sign in or press a button to see the server respond.</p></div>
      </aside>`;
    document.body.appendChild(wrap);
    const list = document.getElementById('act-list');
    const toggle = document.getElementById('act-toggle');
    const box = document.getElementById('act-drawer');
    const count = document.getElementById('act-count');
    let n = 0, seen = new Set();
    toggle.addEventListener('click', () => { const o = box.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });

    const add = (e) => {
      const key = e.t + e.message;
      if (seen.has(key)) return; seen.add(key);
      if (n === 0) list.innerHTML = '';
      n++; count.textContent = n;
      const d = document.createElement('div');
      d.className = 'act-item';
      d.innerHTML = `<span class="time">${new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        <span class="actor">${PC.esc(e.actor)}</span><span class="text">${PC.esc(e.message)}</span><span class="stage s-${PC.esc(e.stage)}">${PC.esc(e.stage)}</span>`;
      list.prepend(d);
    };
    fetch('/api/activity').then((r) => r.json()).then((rows) => rows.forEach(add)).catch(() => {});
    const s = window.PC && PC.socket();
    if (s) s.on('activity', add);
    else setInterval(() => fetch('/api/activity').then((r) => r.json()).then((rows) => rows.forEach(add)).catch(() => {}), 2000);
  }

  window.PCUI = {
    mount({ step, active } = {}) {
      const slot = document.getElementById('chrome');
      slot.innerHTML = nav(active) + pipeline(step || 0);
      wirePipeline();
      const lo = document.getElementById('logout-btn');
      if (lo) lo.addEventListener('click', () => PC.logout());
      drawer();
      bell();
      // Emergency SOS button + Need help? widget on every page
      ['/js/sos.js', '/js/support.js'].forEach((src) => {
        if (document.querySelector('script[src="' + src + '"]')) return;
        const sc = document.createElement('script'); sc.src = src; document.body.appendChild(sc);
      });
    }
  };
})();
