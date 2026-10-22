// PASTE AS: public/js/record.js  (new file)
// Day 10: the medical record view, shared by record.html (the patient, editable) and the consult room (the doctor, read-only).
//   PCRecord.mount(element, { patientId, editable, compact })   loads and shows the record; returns the data, or null if it could not be opened.
(function () {
  const esc = PC.esc;
  const css = document.createElement('style');
  css.textContent = `
  .rec-sec{margin-bottom:1rem}
  .rec-flat{border-top:1px solid var(--line);padding-top:.8rem;margin-bottom:.8rem}
  .rec-sec h3{font-size:1.05rem;margin-bottom:.5rem}
  .rec-cols{display:grid;gap:1rem;grid-template-columns:1fr 1fr}
  .rec-compact .rec-cols{grid-template-columns:1fr}
  @media (max-width:700px){.rec-cols{grid-template-columns:1fr}}
  .rec-alert{border-radius:12px;padding:.7rem .9rem;margin-bottom:1rem;background:var(--coral-wash);color:#8A1F26;border:1px solid #F0B9BD}
  .rec-alert.calm{background:#EEF2F4;color:var(--ink-soft);border-color:var(--line)}
  .rec-note{border-radius:12px;padding:.6rem .9rem;margin-bottom:1rem;background:var(--teal-wash);color:var(--teal-dark);font-size:.88rem}
  .chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:.4rem 0 .7rem}
  .chip{display:inline-flex;align-items:center;gap:.35rem;border-radius:999px;padding:.2rem .3rem .2rem .7rem;font-size:.84rem;font-weight:600;background:var(--amber-wash);color:var(--amber)}
  .chip.allergy{background:var(--coral-wash);color:#8A1F26}
  .chip.read{padding-right:.7rem}
  .chip button{border:0;background:rgba(0,0,0,.08);color:inherit;width:20px;height:20px;border-radius:50%;cursor:pointer;line-height:1;font-size:.8rem}
  .rec-form{display:grid;gap:.5rem}
  .rec-form .row{gap:.4rem}
  .rec-list{list-style:none;display:grid;gap:.5rem;margin-bottom:.8rem}
  .rec-file{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;background:var(--card)}
  .rec-file b{font-size:.9rem;word-break:break-word}
  .tl{list-style:none;position:relative;display:grid;gap:.7rem;padding-left:1.2rem;border-left:2px solid var(--line);margin-left:.4rem}
  .tl li{position:relative;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem}
  .tl li::before{content:'';position:absolute;left:-1.62rem;top:.9rem;width:10px;height:10px;border-radius:50%;background:var(--teal);border:2px solid var(--paper)}
  .tl li.t-allergy::before{background:var(--coral)} .tl li.t-condition::before{background:var(--amber)} .tl li.t-prescription::before{background:var(--blue)} .tl li.t-report::before{background:#6A5ACD}
  .tl-tag{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;border-radius:6px;padding:.05rem .4rem;background:#EEF2F4;color:var(--ink-soft);margin-right:.4rem}
  .tl-meta{font-size:.78rem;color:var(--muted)}
  .tl ul{margin:.3rem 0 0 1.1rem;font-size:.86rem}
  `;
  document.head.appendChild(css);

  const date = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const TAG = { consult: 'Consultation', prescription: 'Prescription', report: 'Report', allergy: 'Allergy', condition: 'Condition' };

  const load = (opts) => PC.api('GET', opts && opts.patientId ? '/records/patient/' + encodeURIComponent(opts.patientId) : '/records/me');

  // Opens a file with the login sent in a header (so the token never sits in the address bar). Falls back to a download if popups are blocked.
  async function openFile(url, name, download, say) {
    const w = download ? null : window.open('', '_blank');
    try {
      const res = await fetch(url + (download && url.includes('/records/') ? '?download=1' : ''), { headers: { Authorization: 'Bearer ' + PC.token } });
      if (!res.ok) { let m = 'Could not open the file.'; try { m = (await res.json()).error || m; } catch {} throw new Error(m); }
      const obj = URL.createObjectURL(await res.blob());
      if (download || !w) { const a = document.createElement('a'); a.href = obj; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove(); }
      else w.location.href = obj;
      setTimeout(() => URL.revokeObjectURL(obj), 60000);
    } catch (e) { if (w) w.close(); say(e.message); }
  }

  function render(el, data, opts) {
    opts = opts || {};
    const editable = !!opts.editable, wrap = (inner, title) => (opts.compact ? `<section class="rec-sec rec-flat"><h3>${title}</h3>${inner}</section>` : `<section class="card rec-sec"><h3>${title}</h3>${inner}</section>`);
    const { allergies, conditions } = data.profile;
    const chip = (x, kind) => `<span class="chip ${kind} ${editable ? '' : 'read'}" title="${esc(x.note || '')}">${esc(x.name)}${x.severity ? ' · ' + esc(x.severity) : ''}${editable ? `<button data-act="del-hist" data-id="${esc(x.id)}" aria-label="Remove ${esc(x.name)}">✕</button>` : ''}</span>`;

    let html = '';
    if (!editable) {
      html += `<div class="rec-note">Read-only. You can see this record because of your consultation with ${esc(data.patient.name)}. Opening it is logged and the patient is told. Allergies and conditions are entered by the patient and are not verified.</div>`;
      html += allergies.length
        ? `<div class="rec-alert" role="alert"><b>Allergies:</b> ${allergies.map((a) => esc(a.name) + (a.severity ? ' (' + esc(a.severity) + ')' : '')).join(', ')}</div>`
        : '<div class="rec-alert calm">No allergies recorded by the patient.</div>';
    }

    const histForm = (kind) => `<div class="rec-form" data-kind="${kind}">
        <input data-f="name" maxlength="80" placeholder="${kind === 'allergy' ? 'e.g. Penicillin' : 'e.g. Type 2 diabetes'}" aria-label="${kind} name">
        <div class="row">${kind === 'allergy' ? `<select data-f="severity" aria-label="Severity"><option value="">Severity</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option></select>` : ''}
        <input data-f="note" maxlength="200" placeholder="Note (optional)" aria-label="Note" style="flex:1;min-width:120px"></div>
        <button class="btn btn-ghost btn-sm" data-act="add-hist" data-kind="${kind}">Add ${kind}</button></div>`;
    const profile = `<div class="rec-cols">
        <div><b>Allergies</b><div class="chips">${allergies.length ? allergies.map((x) => chip(x, 'allergy')).join('') : '<span class="small muted">None added</span>'}</div>${editable ? histForm('allergy') : ''}</div>
        <div><b>Conditions</b><div class="chips">${conditions.length ? conditions.map((x) => chip(x, 'condition')).join('') : '<span class="small muted">None added</span>'}</div>${editable ? histForm('condition') : ''}</div>
      </div>${editable ? '<p class="small muted" style="margin-top:.6rem">Only you can change this. Doctors you consult can read it, and you are told each time one opens it.</p>' : ''}`;
    html += wrap(profile, 'Health profile');

    const reps = data.reports.length ? `<ul class="rec-list">${data.reports.map((r) => `<li class="rec-file"><div><b>${esc(r.title)}</b><div class="small muted">${esc(r.filename)} · ${size(r.size)}${r.reportDate ? ' · ' + esc(date(r.reportDate)) : ''}</div></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-act="open" data-url="${esc(r.url)}" data-name="${esc(r.filename)}">Open</button><button class="btn btn-ghost btn-sm" data-act="dl" data-url="${esc(r.url)}" data-name="${esc(r.filename)}">Download</button>${editable ? `<button class="btn btn-ghost btn-sm" data-act="del-rep" data-id="${esc(r.id)}">Remove</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="small muted" style="margin-bottom:.7rem">No reports added.</p>';
    const upForm = editable ? `<div class="rec-form" id="rep-form">
        <input data-f="title" maxlength="80" placeholder="Report name, e.g. Blood test" aria-label="Report name">
        <div class="row"><input type="date" data-f="date" aria-label="Report date" max="${new Date().toISOString().slice(0, 10)}"><input type="file" data-f="file" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.doc,.docx" aria-label="Report file" style="flex:1;min-width:140px"></div>
        <button class="btn btn-ghost btn-sm" data-act="add-rep">Upload report</button><span class="small muted">JPG, PNG, PDF, DOC. Up to 10 MB.</span></div>` : '';
    html += wrap(reps + upForm, 'Reports');

    const tl = data.timeline.length ? `<ul class="tl">${data.timeline.map((t) => {
      const meds = t.medicines && t.medicines.length ? `<ul>${t.medicines.map((m) => `<li>${esc(m.medicine)}${m.dose ? ' ' + esc(m.dose) : ''}${m.frequency ? ', ' + esc(m.frequency) : ''}${m.days ? ' for ' + esc(m.days) + ' days' : ''}</li>`).join('')}</ul>` : '';
      const act = t.open ? `<div class="row" style="margin-top:.4rem"><button class="btn btn-ghost btn-sm" data-act="open" data-url="${esc(t.open.url)}" data-name="${esc(t.open.name)}">Open</button></div>` : '';
      return `<li class="t-${t.type}"><div><span class="tl-tag">${TAG[t.type] || esc(t.type)}</span><b>${esc(t.title)}</b></div>
        <div class="tl-meta">${esc(date(t.at))}${t.sub ? ' · ' + esc(t.sub) : ''}</div>${t.detail ? `<div class="small" style="margin-top:.2rem">${esc(t.detail)}</div>` : ''}${meds}${act}</li>`;
    }).join('')}</ul>` : '<p class="small muted">Nothing here yet. Completed consultations, prescriptions and reports will appear on this timeline.</p>';
    html += wrap(tl, 'Timeline');
    html += '<div class="msg" id="rec-msg" role="alert"></div>';

    el.className = (el.className || '').replace(/\brec-compact\b/g, '') + (opts.compact ? ' rec-compact' : '');
    el.innerHTML = html;

    const say = (t, good) => { const m = el.querySelector('#rec-msg'); if (!m) return; m.className = 'msg ' + (good ? 'ok' : 'err'); m.textContent = t; };
    const reload = () => (opts.reload ? opts.reload() : null);
    el.onclick = async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      try {
        if (act === 'open') return openFile(b.dataset.url, b.dataset.name, false, say);
        if (act === 'dl') return openFile(b.dataset.url, b.dataset.name, true, say);
        if (!editable) return;
        if (act === 'del-hist') { await PC.api('DELETE', '/records/history/' + encodeURIComponent(b.dataset.id)); return reload(); }
        if (act === 'del-rep') { if (!confirm('Remove this report from your record?')) return; await PC.api('DELETE', '/records/reports/' + encodeURIComponent(b.dataset.id)); return reload(); }
        if (act === 'add-hist') {
          const f = b.closest('.rec-form'), v = (k) => { const x = f.querySelector(`[data-f="${k}"]`); return x ? x.value : ''; };
          if (v('name').trim().length < 2) { say('Type a name first.'); return; }
          b.disabled = true;
          await PC.api('POST', '/records/history', { kind: b.dataset.kind, name: v('name'), severity: v('severity'), note: v('note') });
          return reload();
        }
        if (act === 'add-rep') {
          const f = el.querySelector('#rep-form'), file = f.querySelector('[data-f="file"]').files[0];
          if (!file) { say('Choose a file first.'); return; }
          if (file.size > 10 * 1024 * 1024) { say('That file is over 10 MB.'); return; }
          b.disabled = true; say('Uploading...', true);
          const res = await fetch('/api/records/reports', { method: 'POST', body: file, headers: {
            Authorization: 'Bearer ' + PC.token, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name),
            'X-Report-Title': encodeURIComponent(f.querySelector('[data-f="title"]').value.trim()), 'X-Report-Date': f.querySelector('[data-f="date"]').value } });
          if (res.status === 401) return PC.logout();
          if (!res.ok) { let m = 'Upload failed.'; try { m = (await res.json()).error || m; } catch {} b.disabled = false; say(m); return; }
          return reload();
        }
      } catch (err) { b.disabled = false; say(err.message); }
    };
  }

  async function mount(el, opts) {
    opts = opts || {};
    el.innerHTML = '<p class="muted small">Loading record...</p>';
    let data;
    try { data = await load(opts); }
    catch (e) { el.innerHTML = `<div class="rec-alert calm" role="alert">${esc(e.message)}</div>`; return null; }
    render(el, data, { ...opts, reload: () => mount(el, opts) });
    return data;
  }

  window.PCRecord = { load, render, mount };
})();
