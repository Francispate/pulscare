// Support: a "Need help?" button on every page. It lists the next steps for the page the user is on,
// and "Show me" scrolls to the right button and highlights it.
(function () {
  if (window.PCSupport) return;
  const SUPPORT_EMAIL = 'support@pulscare.test'; // change this to your real support address
  const SUPPORT_PHONE = '';                       // optional, for example '+91 80000 00000'

  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  const user = window.PC && PC.user;
  const role = user && user.role;

  // Each step: t = title, d = what to do, sel = element to highlight (optional).
  const GUIDE = {
    index: () => role
      ? { title: 'You are signed in', steps: [
          { t: 'Go to your page', d: role === 'doctor' ? 'Press "Continue to your doctor page" in the green box at the top.' : 'Press "Continue to your patient page" in the green box at the top.', sel: '#signed-in' },
          { t: 'Or switch account', d: 'Use "Log out" at the top right, then sign in again.', sel: '#logout-btn' } ],
        problems: [] }
      : { title: 'Getting started', steps: [
          { t: 'Choose your language', d: 'Tap English, हिन्दी or ಕನ್ನಡ.', sel: '#lang-pills' },
          { t: 'Select your symptoms', d: 'Tap every symptom you have. A suggested doctor appears under the buttons.', sel: '#symptoms' },
          { t: 'Press "Continue to sign in"', d: 'This takes you to the login boxes.', sel: '#triage .btn-primary' },
          { t: 'Log in or create an account', d: 'Already registered? Use Patient log in. New? Open the "New patient" tab and fill the form.', sel: '#signin .tabs' },
          { t: 'Are you a doctor?', d: 'Use the Doctor log in box on the right. Pick your name and enter your password.', sel: '#d-select' } ],
        problems: [['I forgot my password', 'For the demo, use demo@pulscare.test with patient123, or create a new account.']] },
    patient: () => ({ title: 'Your care page', steps: [
      { t: 'Tell us your languages', d: 'Pick English, Hindi, Kannada, or a mix, or type your own. Doctors who speak your way are shown first.', sel: '#lang-card' },
      { t: 'Check who is online', d: 'Doctors with a green "Online" badge can answer now. Doctors who speak your languages show a green "Speaks your languages" tag.', sel: '#doctor-grid' },
      { t: 'Press "Consult now"', d: 'This sends your request. The button is grey if the doctor is offline.', sel: '#doctor-grid [data-doc]:not([disabled])' },
      { t: 'Wait for the doctor to accept', d: 'A yellow box shows a 2 minute countdown. Keep this page open.', sel: '#banner' },
      { t: 'Press "Join call"', d: 'When the box turns green, press Join call. You can also find it under My consultations.', sel: '#banner .btn, #tab-appts' },
      { t: 'Find old visits and documents', d: 'Open "My consultations" to download a prescription or invoice.', sel: '#tab-appts' } ],
      problems: [['All doctors are offline', 'Doctors must press Go Online on their own screen. Try again in a minute, or open the doctor page in a second window.'],
        ['My request expired', 'Requests last 2 minutes. Press Consult now again.']] }),
    doctor: () => ({ title: 'Doctor page', steps: [
      { t: 'Turn on "Go online"', d: 'Patients can only send you a request while this switch is on.', sel: '#online-switch' },
      { t: 'Wait for a request', d: 'New requests appear in this box instantly. You do not need to refresh.', sel: '#queue' },
      { t: 'Press "Accept"', d: 'This opens the private consultation room.', sel: '#queue [data-act="accept"]' },
      { t: 'Reopen a room later', d: 'If you left the room, press "Open room" in the list below.', sel: '#appts' } ],
      problems: [['Patient cannot see me online', 'Check the switch is on. Keep this page open; closing it marks you offline after a few seconds.']] }),
    consult: () => role === 'doctor'
      ? { title: 'Consultation room (doctor)', steps: [
          { t: 'Check the patient\'s files', d: 'The Medical files box shows reports and X-rays. Select a name to preview, or press Download.', sel: '#att-mount' },
          { t: 'Talk with the patient', d: 'The patient\'s video is on the right tile. Use the chat if the sound is poor.', sel: '#tile-remote' },
          { t: 'Fill in the prescription', d: 'Add each medicine with dose, how often, and days.', sel: '#rx-card' },
          { t: 'Press "Save prescription"', d: 'The patient gets the signed PDF only after payment.', sel: '#rx-save' },
          { t: 'Press "End call"', d: 'This sends the patient to payment. Save the prescription first.', sel: '#btn-end' } ],
        problems: [['I cannot see the patient', 'Read the Connection check box under the video. If it says the devices cannot connect, the TURN relay in the .env file must be set, then restart the server.'],
          ['No sound', 'Press the lock icon in the address bar and allow the microphone. Use headphones to avoid echo.']] }
      : { title: 'Consultation room (patient)', steps: [
          { t: 'Allow camera and microphone', d: 'When the browser asks, press Allow. If you blocked it, press the lock icon in the address bar and allow both, then reload.', sel: '#diag' },
          { t: 'Wait for your doctor', d: 'The video appears on the left tile when the doctor joins.', sel: '#tile-remote' },
          { t: 'Share your reports', d: 'Press "Add a file" in Medical files to upload an X-ray, a photo, or a report. The doctor can open it right away.', sel: '#att-mount' },
          { t: 'Type to your doctor', d: 'The chat is private. It unlocks when both of you are in the room.', sel: '.chat-box' },
          { t: 'Want to read what is being said?', d: 'In Live captions, choose the language you speak and press "Start my live captions". Your words appear for the other person as you talk.', sel: '#btn-speech' },
          { t: 'See everything that was said', d: 'Press the "Captions" tab on the right edge of the screen. The list stays there after captions fade. Press Close to hide it.', sel: '#cap-tab, #btn-cap-panel' },
          { t: 'Wait for the doctor to end the call', d: 'You will move to the payment page on your own.' } ],
        problems: [['I cannot see the doctor\'s face', 'Read the Connection check box under the video. Ask the doctor to allow the camera. If you are on different networks, the TURN relay must be set on the server.'],
          ['The upload failed', 'Use JPG, PNG, PDF, DOC or TXT under 10 MB. Photos from a phone are fine.']] },
    payment: () => ({ title: 'Payment', steps: [
      { t: 'Check the amount', d: 'The summary shows the doctor and the fee.', sel: '#content' },
      { t: 'Choose Card or UPI', d: 'Use the two tabs above the form.', sel: '#m-card' },
      { t: 'Use a test payment', d: 'This is test mode. Press "Use the success card" to fill the form for you.', sel: '#fill-ok' },
      { t: 'Press Pay', d: 'The server checks the payment, then creates your documents.', sel: '#pay-btn' },
      { t: 'Open your documents', d: 'After success, open the prescription and the invoice. They are two separate PDFs.', sel: '#dl-rx' } ],
      problems: [['My payment was declined', 'The card 4000 0000 0000 0002 is meant to fail. Use 4111 1111 1111 1111 to see a success.'],
        ['Nothing happens when I press Pay', 'Check the red message under the button. It says which field needs fixing.']] }),
    verify: () => ({ title: 'Signature check', steps: [
      { t: 'Read the result', d: 'A green "Valid" means the prescription has not been changed since it was signed.', sel: '#result' },
      { t: 'Check another prescription', d: 'Scan the QR code printed on the prescription PDF.' } ], problems: [] }),
    roadmap: () => ({ title: 'Roadmap', steps: [
      { t: 'Read the table', d: 'Each row is a feature. The columns show what the prototype does now and what the final version adds.', sel: '#steps-body' },
      { t: 'Go back to the demo', d: 'Press "Home" in the top menu.' } ], problems: [] })
  };
  const guide = (GUIDE[page] || (() => ({ title: 'Help', steps: [{ t: 'Use the top menu', d: 'Home takes you to the start. Your care or My patients is your main page.' }], problems: [] })))();

  const css = document.createElement('style');
  css.textContent = `
  .hlp-fab{position:fixed;left:18px;bottom:18px;z-index:60;background:var(--teal);color:#fff;border:0;border-radius:999px;padding:.65rem 1.1rem;font-weight:700;box-shadow:0 6px 20px rgba(15,139,125,.4);display:flex;align-items:center;gap:.5rem}
  .hlp-fab:hover{background:var(--teal-dark)}
  .hlp-fab i{font-style:normal;background:#fff;color:var(--teal-dark);width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:.8rem}
  .hlp-panel{position:fixed;left:18px;bottom:70px;z-index:60;width:min(380px,calc(100vw - 36px));max-height:min(620px,78vh);background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 40px rgba(14,30,45,.28);display:none;flex-direction:column;overflow:hidden}
  .hlp-panel.open{display:flex}
  .hlp-head{padding:.85rem 1rem;background:var(--teal-wash);border-bottom:1px solid #B7DED8}
  .hlp-head b{font-family:var(--font-display);font-size:1.05rem}
  .hlp-head p{font-size:.82rem;color:var(--ink-soft)}
  .hlp-body{overflow-y:auto;padding:.5rem 1rem 1rem}
  .hlp-steps{list-style:none;counter-reset:s;display:grid;gap:.15rem;margin:.4rem 0 .6rem}
  .hlp-steps li{counter-increment:s;display:grid;grid-template-columns:26px 1fr;gap:.2rem .6rem;padding:.55rem 0;border-bottom:1px solid #EDF2F4}
  .hlp-steps li::before{content:counter(s);grid-row:1 / span 3;width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;font-size:.78rem;font-weight:700;display:grid;place-items:center}
  .hlp-steps b{font-size:.92rem}
  .hlp-steps p{font-size:.85rem;color:var(--ink-soft)}
  .hlp-show{justify-self:start;margin-top:.15rem}
  .hlp-sub{font-size:.8rem;font-weight:700;color:var(--muted);margin:.8rem 0 .2rem}
  .hlp-panel details{border-bottom:1px solid #EDF2F4;padding:.4rem 0;font-size:.86rem}
  .hlp-panel summary{cursor:pointer;font-weight:600}
  .hlp-panel details p{color:var(--ink-soft);margin-top:.25rem}
  .hlp-contact{background:var(--paper);border-radius:10px;padding:.7rem .8rem;font-size:.86rem;margin-top:.6rem}
  .hlp-sos{margin-top:.6rem;width:100%}
  .pc-spot{outline:4px solid #F0B35A !important;outline-offset:4px;border-radius:8px;animation:pcSpot 1s ease-in-out 4;position:relative;z-index:5}
  @keyframes pcSpot{0%,100%{outline-color:#F0B35A}50%{outline-color:#D93D45}}
  @media (prefers-reduced-motion:reduce){.pc-spot{animation:none}}
  .hlp-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:70;background:var(--night);color:#fff;border-radius:10px;padding:.6rem .9rem;font-size:.88rem;max-width:min(420px,90vw)}
  `;
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const visible = (el) => el && el.getClientRects().length > 0;
  const find = (sel) => { if (!sel) return null; return [...document.querySelectorAll(sel)].find(visible) || null; };

  function toast(text) {
    const t = document.createElement('div'); t.className = 'hlp-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t); setTimeout(() => t.remove(), 4500);
  }
  function showMe(sel, title) {
    const el = find(sel);
    if (window.innerWidth < 760) toggle(false);
    if (!el) return toast(`"${title}" is not on the screen yet. Finish the step before it, then press Show me again.`);
    document.querySelectorAll('.pc-spot').forEach((x) => x.classList.remove('pc-spot'));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('pc-spot');
    setTimeout(() => el.classList.remove('pc-spot'), 4200);
  }

  const fab = document.createElement('button');
  fab.className = 'hlp-fab'; fab.id = 'hlp-fab'; fab.type = 'button'; fab.setAttribute('aria-expanded', 'false'); fab.setAttribute('aria-controls', 'hlp-panel');
  fab.innerHTML = '<i aria-hidden="true">?</i>Need help?';
  const panel = document.createElement('aside');
  panel.className = 'hlp-panel'; panel.id = 'hlp-panel'; panel.setAttribute('aria-label', 'Help');
  panel.innerHTML = `<div class="hlp-head"><b>${esc(guide.title)}</b><p>Follow these steps in order. Press "Show me" and we will point to the button.</p></div>
    <div class="hlp-body">
      <ol class="hlp-steps">${guide.steps.map((s, i) => `<li><b>${esc(s.t)}</b><p>${esc(s.d)}</p>${s.sel ? `<button class="btn btn-ghost btn-sm hlp-show" data-i="${i}">Show me</button>` : ''}</li>`).join('')}</ol>
      ${guide.problems.length ? `<div class="hlp-sub">Common problems</div>${guide.problems.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}` : ''}
      <div class="hlp-contact"><b>Still stuck?</b><br>Email <a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>${SUPPORT_PHONE ? ` or call <a href="tel:${esc(SUPPORT_PHONE.replace(/\s/g, ''))}">${esc(SUPPORT_PHONE)}</a>` : ''}.<br>
        <span class="small muted">Mention the page name: ${esc(page)}.</span></div>
      <button class="btn btn-danger btn-sm hlp-sos" id="hlp-sos">Medical emergency? Open SOS</button>
    </div>`;
  document.body.appendChild(panel); document.body.appendChild(fab);

  function toggle(force) {
    const open = force == null ? !panel.classList.contains('open') : force;
    panel.classList.toggle('open', open); fab.setAttribute('aria-expanded', open);
  }
  fab.onclick = () => toggle();
  panel.querySelectorAll('.hlp-show').forEach((b) => (b.onclick = () => { const s = guide.steps[Number(b.dataset.i)]; showMe(s.sel, s.t); }));
  panel.querySelector('#hlp-sos').onclick = () => { toggle(false); if (window.PCSOS) PCSOS.open(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  document.addEventListener('click', (e) => { const o = e.target.closest('[data-open-help]'); if (o) { e.preventDefault(); toggle(true); fab.scrollIntoView({ block: 'nearest' }); } });

  window.PCSupport = { open: () => toggle(true), close: () => toggle(false) };
})();
