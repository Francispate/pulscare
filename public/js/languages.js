// Language picker (English / Hindi / Kannada, any mix, plus your own) and doctor matching.
window.PCLang = (function () {
  const BASE = [['English', 'English'], ['Hindi', 'हिन्दी'], ['Kannada', 'ಕನ್ನಡ']];
  const norm = (s) => String(s || '').toLowerCase().trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function get() {
    try { return (await PC.api('GET', '/me/languages')).languages || []; } catch (e) { return []; }
  }

  // How well does a doctor's list fit the patient's list?
  function match(mine, theirs) {
    const t = new Set((theirs || []).map(norm));
    const common = (mine || []).filter((x) => t.has(norm(x)));
    return { common, any: common.length > 0, all: (mine || []).length > 0 && common.length === (mine || []).length };
  }

  function mountEditor(el, opts) {
    const role = opts.role || 'patient';
    let current = (opts.current || []).slice();
    let open = !!opts.startOpen;

    const T = role === 'doctor'
      ? { title: 'Languages you speak with patients', hint: 'Patients see which doctors speak their language. Pick every language you are comfortable in.', other: 'Other languages you speak' }
      : { title: 'Which languages do you speak?', hint: 'Pick more than one if you mix languages, for example English + Hindi. We show doctors who speak your way first, so you can talk naturally.', other: 'Another language? Type it here' };

    function view() {
      if (!open && current.length) {
        el.innerHTML = `<div class="card row spread" style="padding:.8rem 1rem">
          <div><span class="small muted">${role === 'doctor' ? 'Languages I speak' : 'My languages'}</span><div><b>${current.map(esc).join(' + ')}</b></div></div>
          <button class="btn btn-ghost btn-sm" id="lg-change">Change</button></div>`;
        el.querySelector('#lg-change').onclick = () => { open = true; view(); };
        return;
      }
      const customs = current.filter((l) => !BASE.some(([n]) => norm(n) === norm(l)));
      el.innerHTML = `<div class="card" style="border:2px solid var(--teal)">
        <h3 style="margin-bottom:.2rem">${esc(T.title)}</h3>
        <p class="small muted" style="margin-bottom:.7rem">${esc(T.hint)}</p>
        <div class="pill-row" id="lg-pills" role="group" aria-label="Languages">
          ${BASE.map(([n, native]) => `<button type="button" class="pill ${current.some((c) => norm(c) === norm(n)) ? 'on' : ''}" data-lang="${n}" aria-pressed="${current.some((c) => norm(c) === norm(n))}">${native === n ? n : native + ' (' + n + ')'}</button>`).join('')}
        </div>
        <div class="field" style="margin-top:.8rem;max-width:420px"><label for="lg-other">${esc(T.other)}</label>
          <input id="lg-other" placeholder="For example: Marathi, Tamil" value="${esc(customs.join(', '))}" autocomplete="off"></div>
        <div class="small" id="lg-sum" style="margin:.2rem 0 .7rem;font-weight:600;color:var(--teal-dark)"></div>
        <div class="row"><button class="btn btn-primary btn-sm" id="lg-save">Save my languages</button>
          ${current.length ? '<button class="btn btn-ghost btn-sm" id="lg-cancel">Cancel</button>' : ''}</div>
        <div class="msg" id="lg-msg" role="alert"></div></div>`;

      const pills = [...el.querySelectorAll('#lg-pills .pill')];
      const other = el.querySelector('#lg-other');
      const picked = () => {
        const base = pills.filter((p) => p.classList.contains('on')).map((p) => p.dataset.lang);
        const extra = other.value.split(/[,;+\/]|\band\b/i).map((x) => x.trim()).filter(Boolean);
        return [...base, ...extra];
      };
      const sum = () => {
        const l = picked();
        el.querySelector('#lg-sum').textContent = l.length ? (role === 'doctor' ? 'You will be shown as speaking: ' : 'You will see doctors who speak: ') + l.join(' + ') : '';
      };
      pills.forEach((p) => p.onclick = () => { p.classList.toggle('on'); p.setAttribute('aria-pressed', p.classList.contains('on')); sum(); });
      other.oninput = sum; sum();

      el.querySelector('#lg-save').onclick = async () => {
        const msg = el.querySelector('#lg-msg');
        const l = picked();
        if (!l.length) { msg.className = 'msg err'; msg.textContent = 'Choose at least one language, or type your own.'; return; }
        try {
          const r = await PC.api('PUT', '/me/languages', { languages: l });
          current = r.languages; open = false; view();
          if (opts.onSaved) opts.onSaved(current);
        } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
      };
      const c = el.querySelector('#lg-cancel'); if (c) c.onclick = () => { open = false; view(); };
    }
    view();
    return { get languages() { return current; } };
  }

  return { get, match, mountEditor };
})();
