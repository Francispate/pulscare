// Medical files panel for the consultation room.
// Patient: upload files. Doctor and patient: preview in a viewer, or download.
(function () {
  const mount = document.getElementById('att-mount');
  if (!mount || !window.PC || !PC.token) return;
  const apptId = new URLSearchParams(location.search).get('a');
  const isDoctor = PC.user.role === 'doctor';
  const esc = PC.esc;
  let files = [];

  const css = document.createElement('style');
  css.textContent = `
  .att-drop{border:2px dashed #B7C8D1;border-radius:10px;padding:.9rem;text-align:center;background:var(--paper);cursor:pointer;transition:border-color .15s,background .15s}
  .att-drop:hover,.att-drop.over{border-color:var(--teal);background:var(--teal-wash)}
  .att-drop b{display:block;color:var(--ink)}
  .att-list{list-style:none;display:grid;gap:.5rem;margin-top:.8rem}
  .att-item{display:grid;grid-template-columns:56px 1fr auto;gap:.65rem;align-items:center;border:1px solid var(--line);border-radius:10px;padding:.45rem;background:#fff}
  .att-thumb{width:56px;height:56px;border-radius:8px;background:#EEF2F4;display:grid;place-items:center;overflow:hidden;font-weight:700;font-size:.75rem;color:var(--ink-soft);border:0;padding:0}
  .att-thumb img{width:100%;height:100%;object-fit:cover}
  .att-name{font-weight:600;font-size:.88rem;word-break:break-word;border:0;background:none;text-align:left;padding:0;color:var(--ink)}
  .att-name:hover{color:var(--teal-dark);text-decoration:underline}
  .att-new{background:#FFF4D6;border-color:#E3B96C}
  .att-bar{height:6px;border-radius:99px;background:#E3EAEE;overflow:hidden;margin-top:.5rem}
  .att-bar i{display:block;height:100%;width:0;background:var(--teal);transition:width .15s}
  .att-modal{position:fixed;inset:0;z-index:200;background:rgba(8,18,28,.82);display:flex;flex-direction:column;padding:.8rem}
  .att-modal-head{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;color:#fff;padding-bottom:.6rem}
  .att-modal-head b{flex:1;min-width:140px;word-break:break-word}
  .att-stage{flex:1;overflow:auto;display:grid;place-items:center;background:#0B1722;border-radius:12px}
  .att-stage img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in}
  .att-stage img.zoom{max-width:none;max-height:none;cursor:zoom-out}
  .att-stage iframe{width:100%;height:100%;border:0;background:#fff}
  .att-nopreview{color:#D5E2EA;text-align:center;padding:2rem}
  `;
  document.head.appendChild(css);

  mount.innerHTML = `<div class="card">
    <div class="row spread"><h3>Medical files</h3><span class="badge pending" id="att-count">0 files</span></div>
    <p class="small muted" style="margin-bottom:.7rem">${isDoctor
      ? 'Files the patient shared appear here. Select a name to preview it, or use Download.'
      : 'Share an X-ray, a photo of the problem, or an old report. Your doctor can open it right away.'}</p>
    ${isDoctor ? '' : `<div class="att-drop" id="att-drop" tabindex="0" role="button" aria-label="Add files">
      <b>Add a file</b><span class="small muted">Tap here or drop files. JPG, PNG, PDF, DOC. Up to 10 MB each.</span>
      <input type="file" id="att-input" multiple hidden accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.doc,.docx,image/*">
    </div>
    <div class="att-bar hidden" id="att-bar"><i id="att-fill"></i></div>`}
    <div class="msg" id="att-msg" role="alert"></div>
    <ul class="att-list" id="att-list"></ul>
    <div class="note-final"><b>Final version:</b> files are stored encrypted in cloud storage and added to the patient's medical record.</div>
  </div>`;

  const $ = (id) => document.getElementById(id);
  const say = (t, ok) => { const m = $('att-msg'); m.className = 'msg ' + (ok ? 'ok' : 'err'); m.textContent = t; };
  const url = (f, dl) => `/api/attachments/${f.id}/file?token=${encodeURIComponent(PC.token)}${dl ? '&download=1' : ''}`;
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const kind = (f) => (f.mime.startsWith('image/') ? 'image' : f.mime === 'application/pdf' ? 'pdf' : 'other');
  const label = (f) => (f.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);

  function paint(newId) {
    $('att-count').textContent = files.length + (files.length === 1 ? ' file' : ' files');
    $('att-list').innerHTML = files.length ? files.map((f) => `<li class="att-item ${f.id === newId ? 'att-new' : ''}">
      <button class="att-thumb" data-open="${f.id}" aria-label="Preview ${esc(f.name)}">${kind(f) === 'image' ? `<img loading="lazy" src="${url(f)}" alt="">` : esc(label(f))}</button>
      <div><button class="att-name" data-open="${f.id}">${esc(f.name)}</button><div class="small muted">${size(f.size)}${f.id === newId ? ' · just shared' : ''}</div></div>
      <div class="row" style="gap:.3rem;flex-wrap:nowrap">
        <button class="btn btn-ghost btn-sm" data-open="${f.id}">Preview</button>
        <a class="btn btn-ghost btn-sm" href="${url(f, true)}" download>Download</a>
        ${!isDoctor && f.uploaderId === PC.user.id ? `<button class="btn btn-ghost btn-sm" data-del="${f.id}" aria-label="Remove ${esc(f.name)}">Remove</button>` : ''}
      </div></li>`).join('')
      : `<li class="small muted">${isDoctor ? 'No files yet. If you need a report or scan, ask the patient in the chat to upload it here.' : 'No files added yet.'}</li>`;
    document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openViewer(b.dataset.open)));
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => remove(b.dataset.del)));
  }

  /* ---------- Viewer ---------- */
  function openViewer(id) {
    const f = files.find((x) => x.id === id); if (!f) return;
    const k = kind(f);
    const m = document.createElement('div');
    m.className = 'att-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'File preview');
    m.innerHTML = `<div class="att-modal-head"><b>${esc(f.name)}</b>
      ${k === 'image' ? '<span class="small" style="color:#9FB4C3">Select the picture to zoom</span>' : ''}
      <a class="btn btn-primary btn-sm" href="${url(f, true)}" download>Download</a>
      <button class="btn btn-ghost btn-sm" id="att-close">Close</button></div>
      <div class="att-stage">${k === 'image' ? `<img src="${url(f)}" alt="${esc(f.name)}">`
        : k === 'pdf' ? `<iframe src="${url(f)}" title="${esc(f.name)}"></iframe>`
        : `<div class="att-nopreview"><p>This file type cannot be previewed in the browser.</p><p style="margin-top:.8rem"><a class="btn btn-primary" href="${url(f, true)}" download>Download to open it</a></p></div>`}</div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    m.querySelector('#att-close').onclick = close; m.querySelector('#att-close').focus();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const img = m.querySelector('img'); if (img) img.onclick = () => img.classList.toggle('zoom');
  }

  /* ---------- Upload (patient) ---------- */
  function uploadOne(file) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/appointments/${apptId}/attachments`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + PC.token);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) $('att-fill').style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
      xhr.onload = () => {
        let d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true, f: d });
        else resolve({ ok: false, error: d.error || 'Upload failed.' });
      };
      xhr.onerror = () => resolve({ ok: false, error: 'Upload failed. Check your internet connection and try again.' });
      xhr.send(file);
    });
  }
  async function handle(list) {
    const arr = [...list]; if (!arr.length) return;
    $('att-bar').classList.remove('hidden');
    for (const file of arr) {
      if (file.size > 10 * 1024 * 1024) { say(`"${file.name}" is larger than 10 MB. Choose a smaller file.`); continue; }
      $('att-fill').style.width = '0%'; say(`Uploading ${file.name}...`, true);
      const r = await uploadOne(file);
      if (r.ok) { if (!files.find((x) => x.id === r.f.id)) files.push(r.f); paint(r.f.id); say(`"${file.name}" shared with your doctor.`, true); }
      else say(r.error);
    }
    $('att-bar').classList.add('hidden');
  }
  async function remove(id) {
    if (!confirm('Remove this file from the consultation?')) return;
    try { await PC.api('DELETE', '/attachments/' + id); files = files.filter((f) => f.id !== id); paint(); say('File removed.', true); }
    catch (e) { say(e.message); }
  }
  if (!isDoctor) {
    const drop = $('att-drop'), input = $('att-input');
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
    input.onchange = () => { handle(input.files); input.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => handle(e.dataTransfer.files));
  }

  /* ---------- Load and live updates ---------- */
  PC.api('GET', `/appointments/${apptId}/attachments`).then((rows) => { files = rows; paint(); }).catch(() => paint());
  const s = PC.socket();
  if (s) {
    s.on('attachment:new', (f) => {
      if (files.find((x) => x.id === f.id)) return;
      files.push(f); paint(f.id);
      if (isDoctor) say(`The patient shared "${f.name}".`, true);
    });
    s.on('attachment:removed', ({ id }) => { files = files.filter((f) => f.id !== id); paint(); });
  }
})();
