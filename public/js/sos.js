// Emergency SOS: shows call buttons, finds the nearest hospitals from the phone/laptop location,
// and opens Google Maps with directions. Location stays in the browser (not saved by Pulscare).
(function () {
  if (window.PCSOS) return;

  const T = {
    en: { sos: 'Emergency', title: 'Emergency help', call: 'If someone is in danger, call now. Do not wait for the app.',
      c112: 'Call 112 (emergency)', c108: 'Call 108 (ambulance)', finding: 'Finding your location...', search: 'Finding hospitals near you...',
      near: 'Nearest', dir: 'Directions', open: 'Open directions to the nearest hospital', all: 'See all hospitals on Google Maps',
      denied: 'Location is blocked. Allow location (lock icon in the address bar) and press Try again, or open Google Maps below.',
      retry: 'Try again', fail: 'Could not load the hospital list. Open Google Maps to see hospitals near you.', close: 'Close', away: 'away',
      note: 'Your location is used only to find hospitals. Pulscare does not save it.', live: 'Live location is on', turnon: 'Turn on location', map: 'Hospitals near you',
      howto: 'To turn location on: 1) Press the lock icon in the address bar, set Location to Allow, then press Try again. 2) On a phone, also switch on Location (GPS) in the quick settings at the top of the screen. 3) On iPhone: Settings > Privacy > Location Services > On, and allow it for your browser.' },
    hi: { sos: 'आपातकाल', title: 'आपातकालीन मदद', call: 'अगर किसी की जान को ख़तरा है तो अभी कॉल करें। ऐप का इंतज़ार न करें।',
      c112: '112 पर कॉल करें', c108: '108 पर कॉल करें (एम्बुलेंस)', finding: 'आपकी लोकेशन खोज रहे हैं...', search: 'पास के अस्पताल खोज रहे हैं...',
      near: 'सबसे नज़दीक', dir: 'रास्ता', open: 'सबसे नज़दीकी अस्पताल का रास्ता खोलें', all: 'Google Maps पर सभी अस्पताल देखें',
      denied: 'लोकेशन बंद है। लोकेशन की अनुमति दें और फिर कोशिश करें, या नीचे Google Maps खोलें।',
      retry: 'फिर कोशिश करें', fail: 'अस्पतालों की सूची नहीं मिली। पास के अस्पताल देखने के लिए Google Maps खोलें।', close: 'बंद करें', away: 'दूर',
      note: 'आपकी लोकेशन सिर्फ़ अस्पताल खोजने के लिए इस्तेमाल होती है। Pulscare इसे सेव नहीं करता।', live: 'लाइव लोकेशन चालू है', turnon: 'लोकेशन चालू करें', map: 'आपके पास के अस्पताल',
      howto: 'लोकेशन चालू करने के लिए: 1) एड्रेस बार में ताले के निशान पर दबाएँ, Location को Allow करें, फिर "फिर कोशिश करें" दबाएँ। 2) फ़ोन में ऊपर की क्विक सेटिंग्स से Location (GPS) भी चालू करें। 3) iPhone: Settings > Privacy > Location Services चालू करें और अपने ब्राउज़र को अनुमति दें।' },
    kn: { sos: 'ತುರ್ತು', title: 'ತುರ್ತು ಸಹಾಯ', call: 'ಯಾರಾದರೂ ಅಪಾಯದಲ್ಲಿದ್ದರೆ ಈಗಲೇ ಕರೆ ಮಾಡಿ. ಆ್ಯಪ್‌ಗಾಗಿ ಕಾಯಬೇಡಿ.',
      c112: '112 ಗೆ ಕರೆ ಮಾಡಿ', c108: '108 ಗೆ ಕರೆ ಮಾಡಿ (ಆಂಬ್ಯುಲೆನ್ಸ್)', finding: 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ...', search: 'ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗಳನ್ನು ಹುಡುಕಲಾಗುತ್ತಿದೆ...',
      near: 'ಅತ್ಯಂತ ಹತ್ತಿರ', dir: 'ದಾರಿ', open: 'ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗೆ ದಾರಿ ತೆರೆಯಿರಿ', all: 'Google Maps ನಲ್ಲಿ ಎಲ್ಲಾ ಆಸ್ಪತ್ರೆಗಳನ್ನು ನೋಡಿ',
      denied: 'ಸ್ಥಳ ನಿರ್ಬಂಧಿಸಲಾಗಿದೆ. ಸ್ಥಳದ ಅನುಮತಿ ನೀಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಕೆಳಗಿನ Google Maps ತೆರೆಯಿರಿ.',
      retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ', fail: 'ಆಸ್ಪತ್ರೆ ಪಟ್ಟಿ ಸಿಗಲಿಲ್ಲ. ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗಳಿಗೆ Google Maps ತೆರೆಯಿರಿ.', close: 'ಮುಚ್ಚಿ', away: 'ದೂರ',
      note: 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಆಸ್ಪತ್ರೆ ಹುಡುಕಲು ಮಾತ್ರ ಬಳಸಲಾಗುತ್ತದೆ. Pulscare ಅದನ್ನು ಉಳಿಸುವುದಿಲ್ಲ.', live: 'ಲೈವ್ ಸ್ಥಳ ಆನ್ ಆಗಿದೆ', turnon: 'ಸ್ಥಳ ಆನ್ ಮಾಡಿ', map: 'ನಿಮ್ಮ ಹತ್ತಿರದ ಆಸ್ಪತ್ರೆಗಳು',
      howto: 'ಸ್ಥಳ ಆನ್ ಮಾಡಲು: 1) ವಿಳಾಸ ಪಟ್ಟಿಯಲ್ಲಿರುವ ಬೀಗದ ಚಿಹ್ನೆ ಒತ್ತಿ, Location ಅನ್ನು Allow ಮಾಡಿ, ನಂತರ "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ" ಒತ್ತಿ. 2) ಫೋನ್‌ನಲ್ಲಿ ಮೇಲಿನ ಕ್ವಿಕ್ ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಿಂದ Location (GPS) ಕೂಡ ಆನ್ ಮಾಡಿ. 3) iPhone: Settings > Privacy > Location Services ಆನ್ ಮಾಡಿ.' }
  };
  const L = () => T[sessionStorage.getItem('pc_lang')] || T.en;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = document.createElement('style');
  css.textContent = `
  .sos-btn{background:#D93D45;color:#fff;border:0;border-radius:999px;padding:.42rem .95rem;font-weight:700;display:inline-flex;align-items:center;gap:.4rem;box-shadow:0 2px 10px rgba(217,61,69,.35)}
  .sos-btn:hover{background:#B8303A}
  .sos-btn.float{position:fixed;top:12px;right:12px;z-index:90}
  .sos-modal{position:fixed;inset:0;z-index:300;background:rgba(8,18,28,.7);display:grid;place-items:center;padding:1rem;overflow:auto}
  .sos-card{background:#fff;border-radius:16px;width:min(520px,100%);max-height:94vh;overflow:auto;border-top:6px solid #D93D45;padding:1.2rem 1.3rem 1.3rem}
  .sos-card h2{color:#B8303A;margin-bottom:.3rem}
  .sos-call{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin:.9rem 0}
  .sos-call a{text-align:center;padding:.85rem .5rem;border-radius:10px;font-weight:700;text-decoration:none;font-size:1rem}
  .sos-call .c112{background:#D93D45;color:#fff}.sos-call .c108{background:#12263A;color:#fff}
  .sos-status{font-size:.9rem;color:var(--ink-soft);background:var(--paper);border-radius:8px;padding:.6rem .8rem;margin-bottom:.7rem}
  .sos-status.err{background:var(--coral-wash);color:#8E2128}
  .sos-list{list-style:none;display:grid;gap:.5rem;margin:.6rem 0}
  .sos-hosp{display:grid;grid-template-columns:1fr auto;gap:.6rem;align-items:center;border:1px solid var(--line);border-radius:10px;padding:.65rem .75rem}
  .sos-hosp.first{border-color:#D93D45;background:#FFF7F7}
  .sos-hosp b{display:block;word-break:break-word}
  .sos-tag{display:inline-block;background:#D93D45;color:#fff;font-size:.72rem;font-weight:700;border-radius:99px;padding:.05rem .5rem;margin-left:.3rem;vertical-align:middle}
  .sos-big{display:flex;width:100%;margin-top:.4rem}
  .sos-status.live{background:#E8F7F1;color:#0B6B55;font-weight:600}
  .sos-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#16A34A;margin-right:.35rem;animation:sosPulse 1.2s infinite}
  @keyframes sosPulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.6)}100%{box-shadow:0 0 0 10px rgba(22,163,74,0)}}
  .sos-map{width:100%;height:220px;border:0;border-radius:10px;margin:.4rem 0;background:#EEF2F4}
  .sos-how{font-size:.85rem;background:#FFF4D6;border-radius:8px;padding:.6rem .8rem;margin:.5rem 0}
  @media(max-width:520px){.sos-call{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  function haversine(a, b, c, d) {
    const R = 6371, r = (x) => (x * Math.PI) / 180;
    const dLat = r(c - a), dLon = r(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // No fixed origin on purpose: Google Maps then starts from the phone's live location.
  const dirUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const allUrl = (o) => (o ? `https://www.google.com/maps/search/hospital/@${o.lat},${o.lon},14z` : 'https://www.google.com/maps/search/?api=1&query=hospital+near+me');

  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  async function overpass(lat, lon, radius) {
    const q = `[out:json][timeout:20];(node["amenity"="hospital"](around:${radius},${lat},${lon});way["amenity"="hospital"](around:${radius},${lat},${lon}););out center 40;`;
    let lastErr;
    for (const s of SERVERS) {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const r = await fetch(s, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl.signal });
        if (!r.ok) throw new Error('bad status');
        const d = await r.json();
        return d.elements || [];
      } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
    }
    throw lastErr;
  }
  async function nearest(lat, lon) {
    let els = [];
    for (const radius of [5000, 15000, 40000]) {
      els = await overpass(lat, lon, radius);
      if (els.length) break;
    }
    return els.map((e) => {
      const la = e.lat != null ? e.lat : e.center && e.center.lat, lo = e.lon != null ? e.lon : e.center && e.center.lon;
      if (la == null || lo == null) return null;
      const t = e.tags || {};
      return { name: t.name || t['name:en'] || 'Hospital (name not listed)', lat: la, lon: lo, km: haversine(lat, lon, la, lo), emergency: t.emergency === 'yes', phone: t.phone || t['contact:phone'] || '' };
    }).filter(Boolean).sort((a, b) => a.km - b.km).slice(0, 8);
  }

  let modal = null;
  function close() { stopWatch(); if (modal) { modal.remove(); modal = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open() {
    if (modal) return;
    const t = L();
    modal = document.createElement('div');
    modal.className = 'sos-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', t.title);
    modal.innerHTML = `<div class="sos-card">
      <div class="row spread"><h2>${esc(t.title)}</h2><button class="btn btn-ghost btn-sm" id="sos-x">${esc(t.close)}</button></div>
      <p><b>${esc(t.call)}</b></p>
      <div class="sos-call"><a class="c112" href="tel:112">${esc(t.c112)}</a><a class="c108" href="tel:108">${esc(t.c108)}</a></div>
      <div class="sos-status" id="sos-status" role="status">${esc(t.finding)}</div>
      <div id="sos-body"></div>
      <p class="small muted" style="margin-top:.8rem">${esc(t.note)}</p></div>`;
    document.body.appendChild(modal);
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#sos-x').onclick = close;
    locate();
  }

  /* ---------- Live location ---------- */
  let watchId = null, me = null, hospitals = [], lastFetch = null, lastDraw = 0, fetching = false;
  function stopWatch() { if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId); watchId = null; }
  const $ = (id) => document.getElementById(id);

  function problem(msg, showHow) {
    const t = L(); stopWatch();
    const st = $('sos-status'); st.className = 'sos-status err'; st.style.display = ''; st.textContent = msg;
    $('sos-body').innerHTML = `${showHow ? `<div class="sos-how">${esc(t.howto || T.en.howto)}</div>` : ''}
      <button class="btn btn-danger sos-big" id="sos-retry">${esc(t.turnon)} / ${esc(t.retry)}</button>
      <a class="btn btn-ghost sos-big" target="_blank" rel="noopener" href="${allUrl(null)}">${esc(t.all)}</a>`;
    $('sos-retry').onclick = locate;
  }

  function setMap() {
    const m = $('sos-map'); if (!m || !me) return;
    // Google map of hospitals around the live position (no API key needed for this embed)
    m.src = `https://maps.google.com/maps?q=hospital&ll=${me.lat},${me.lon}&z=14&output=embed`;
    lastFetch = { lat: me.lat, lon: me.lon };
  }

  function drawList() {
    const t = L(), box = $('sos-list'); if (!box || !me) return;
    const st = $('sos-status'); st.className = 'sos-status live'; st.style.display = '';
    st.innerHTML = `<span class="sos-dot"></span>${esc(t.live)} · ±${Math.round(me.acc)} m`;
    const list = hospitals.map((h) => Object.assign({}, h, { km: haversine(me.lat, me.lon, h.lat, h.lon) })).sort((a, b) => a.km - b.km).slice(0, 4);
    if (!list.length) {
      box.innerHTML = fetching ? `<div class="sos-status">${esc(t.search)}</div>` : '';
      box.innerHTML += `<a class="btn btn-danger sos-big" target="_blank" rel="noopener" href="${allUrl(me)}">${esc(t.all)}</a>`;
      return;
    }
    box.innerHTML = `<a class="btn btn-danger sos-big" target="_blank" rel="noopener" href="${dirUrl(list[0].lat, list[0].lon)}">${esc(t.open)}: ${esc(list[0].name)}</a>
      <ul class="sos-list">${list.map((h, i) => `<li class="sos-hosp ${i === 0 ? 'first' : ''}">
        <div><b>${esc(h.name)}${i === 0 ? `<span class="sos-tag">${esc(t.near)}</span>` : ''}</b>
          <span class="small muted">${h.km < 1 ? Math.round(h.km * 1000) + ' m' : h.km.toFixed(1) + ' km'} ${esc(t.away)}${h.emergency ? ' · Emergency care' : ''}</span>
          ${h.phone ? `<div class="small"><a href="tel:${esc(h.phone.replace(/[^+\d]/g, ''))}">${esc(h.phone)}</a></div>` : ''}</div>
        <a class="btn ${i === 0 ? 'btn-danger' : 'btn-ghost'} btn-sm" target="_blank" rel="noopener" href="${dirUrl(h.lat, h.lon)}">${esc(t.dir)}</a></li>`).join('')}</ul>
      <a class="btn btn-ghost sos-big" target="_blank" rel="noopener" href="${allUrl(me)}">${esc(t.all)}</a>`;
  }

  async function refreshHospitals() {
    if (fetching || !me) return;
    fetching = true; drawList();
    try { hospitals = await nearest(me.lat, me.lon); } catch (e) { hospitals = []; }
    fetching = false; if (modal) drawList();
  }

  function onPosition(pos) {
    if (!modal) return;
    const first = !me;
    me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy || 0 };
    if (first) {
      $('sos-body').innerHTML = `<div style="font-weight:700;margin-top:.2rem">${esc(L().map)}</div><iframe class="sos-map" id="sos-map" title="${esc(L().map)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><div id="sos-list"></div>`;
      setMap(); refreshHospitals(); return;
    }
    // Moved more than 1 km: reload the hospital list and map for the new area
    if (lastFetch && haversine(me.lat, me.lon, lastFetch.lat, lastFetch.lon) > 1) { setMap(); refreshHospitals(); return; }
    if (Date.now() - lastDraw > 4000) { lastDraw = Date.now(); drawList(); } // update distances as you move
  }

  function onError(err) {
    const t = L();
    if (err && err.code === 1) problem(t.denied, true);
    else if (err && err.code === 2) problem(t.denied, true);
    else problem(t.fail, false);
  }

  function locate() {
    const t = L(), st = $('sos-status');
    stopWatch(); me = null; hospitals = []; lastFetch = null;
    st.className = 'sos-status'; st.style.display = ''; st.textContent = t.finding; $('sos-body').innerHTML = '';
    if (!window.isSecureContext) return problem('Location only works on a secure (https) link or on localhost. Open the https link.', false);
    if (!navigator.geolocation) return problem(t.denied, true);
    // Asks the browser to switch on the device location, then keeps following it (live).
    watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }

  function addButton() {
    if (document.getElementById('sos-btn')) return;
    const b = document.createElement('button');
    b.id = 'sos-btn'; b.className = 'sos-btn'; b.type = 'button';
    b.setAttribute('aria-label', 'Emergency SOS');
    b.innerHTML = `<span aria-hidden="true">&#9888;</span> SOS · ${esc(L().sos)}`;
    b.onclick = open;
    const slot = document.querySelector('.nav-right');
    if (slot) slot.insertBefore(b, slot.firstChild); else { b.classList.add('float'); document.body.appendChild(b); }
  }
  addButton();
  window.PCSOS = { open, close };
})();