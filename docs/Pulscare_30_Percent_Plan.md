# Pulscare Tele-Health: 30% Version (Client Prototype, Local Only)

**Stack:** Node.js + Express + Socket.io + SQLite · plain HTML/CSS/JS frontend · runs only on `localhost`
**Audience:** the client. They should be able to *see* the pipeline working, and *read* what the final product adds.
**Next files:** `Pulscare_70_Percent_Plan.md` → `Pulscare_100_Percent_Plan.md`

---

## 1. What the 30% build is for

The client already has a frontend made with Antigravity. Its backend is not connected: pages read `localStorage`, and several JS files (`style.css`, `script.js`, `crypto-engine.js`, `mongo-store.js`, `webrtc-consult.js`) were never supplied. The 30% build keeps the same look and page names, then connects every page to a **real local backend** so the client can confirm the pipeline works:

```
Triage → Login → Doctor online → Request → Accept → Video call (+ encrypted chat + live translation)
      → Doctor ends call → Payment → Prescription PDF  +  Invoice PDF (separate, signed)
```

Two things make this a *client* prototype rather than a plain demo:

| Feature | What it shows the client |
|---|---|
| **Pipeline strip** (top of every page) | Where the user is in the flow, and which steps are **Live now** vs **Coming in final version** |
| **Backend Activity drawer** (bottom right) | Every real backend event as it happens ("payment verified → invoice INV-2026-1001 created") |
| **Roadmap page** (`/roadmap.html`) | 30% vs 70% vs 100%, in plain language, with the final result |

---

## 2. What is real vs simulated in 30%

| Area | 30% (this build) | Final version (70% / 100%) |
|---|---|---|
| Database | SQLite file, real tables | Supabase Postgres + RLS |
| Login | Real. bcrypt hashes + JWT, role checks | Supabase Auth, rate limiting, audit log |
| Online/offline, request/accept | Real, via Socket.io | Same, plus slot-based booking |
| Video | Real WebRTC, peer-to-peer | Signed-token rooms (Daily/LiveKit) |
| Chat | Real E2EE: ECDH + AES-GCM, server stores ciphertext only | Long-term keys, fingerprint check, key backup |
| Live translation | Real. Browser speech-to-text, server translates, subtitles appear for the other person | Managed translation service, consent log |
| **Payment** | **Simulated gateway** (test card / UPI), real server-side verification logic | Razorpay + webhook, UPI reconciliation |
| **Prescription + invoice** | **Real PDFs**, generated on the server after payment, separate files | Stored in cloud, tamper-proof |
| **Signature** | **Our prototype signature** + SHA-256 hash + QR verify page | Doctor's licensed digital signature |
| Notifications, scheduling, admin panel, medical-record upload | Not built (shown on the Roadmap page) | 70% / 100% |

> The prescription is a **prototype**: it is clearly watermarked "Prototype, not a valid medical prescription".

---

## 3. Versions and installs (do this on every laptop)

| Item | Version | Notes |
|---|---|---|
| **Node.js** | **22 LTS or 24** (tested on 22.22 and 24.21) | Download from nodejs.org. Includes `npm`. **This is the only install.** Do not use Node 20 or older |
| **Python** | **Not needed** | Nothing in this project uses Python |
| **Browser** | **Chrome or Edge, latest** | Live captions use the Web Speech API (not in Firefox) |
| Internet | Needed once for `npm install`; needed during the demo only for live captions and translation | Everything else works offline on localhost |

Pinned libraries (exact versions in `package.json`; `package-lock.json` is shipped so installs are identical):

| Package | Version | Why |
|---|---|---|
| express | 4.22.3 | HTTP server and API |
| socket.io | 4.8.1 | Realtime presence, signaling, chat, captions |
| better-sqlite3 | 12.11.1 | Database. Has ready-made Windows, Mac and Linux binaries for Node 22 and 24, so no compiler is needed. Do not upgrade it to 13.x or downgrade to 11.x |
| bcryptjs | 2.4.3 | Password hashing |
| jsonwebtoken | 9.0.2 | Login tokens |
| pdfkit | 0.16.0 | Prescription and invoice PDFs |
| qrcode | 1.5.4 | QR codes on PDFs and UPI payment |
| dotenv | 16.4.7 | Settings file |

Check your install:
```bash
node -v      # should print v22.x.x or v24.x.x
npm -v
```

---

## 4. Folder structure

```
pulscare-prototype/
├── README.md                 quick start
├── package.json / package-lock.json
├── .env.example              copy to .env
├── start.bat  /  start.sh    one-click start (installs, then runs)
├── server/
│   ├── index.js              Express + Socket.io bootstrap
│   ├── db.js                 SQLite schema + seed data
│   ├── routes.js             REST API
│   ├── sockets.js            realtime events
│   ├── pdf.js                prescription + invoice generator
│   └── activity.js           backend activity feed
├── public/
│   ├── index.html            landing, triage, login
│   ├── patient.html          patient dashboard
│   ├── doctor.html           doctor dashboard
│   ├── consult.html          video + chat + captions + prescription panel
│   ├── payment.html          payment after the call
│   ├── verify.html           public signature check
│   ├── roadmap.html          30 / 70 / 100 explainer
│   ├── css/style.css
│   └── js/  api.js  i18n.js  pipeline.js  crypto.js
├── storage/                  generated PDFs (created at runtime)
└── data/                     SQLite file (created at runtime)
```

---

## 5. Sessions: build order, step by step

### Session 1: Database (SQLite)
- [ ] Create `server/db.js`, opening `data/pulscare.db` with WAL mode
- [ ] Tables: `users`, `doctors`, `consult_requests`, `appointments`, `appointment_keys`, `messages`, `prescriptions`, `payments`, `invoices`, `activity_log`
- [ ] `messages` stores only `ciphertext` and `iv`, never plain text
- [ ] Invoice numbers `INV-2026-1001…` from a counter query inside a transaction
- [ ] Seed 6 doctors (from the client's `doctors.html`) with password `doctor123`, plus a demo patient
- [ ] Prices are in INR; each doctor has a `fee`

**Done when:** `node -e "require('./server/db')"` creates the file with 6 doctors.

### Session 2: Backend core (auth, doctors, requests)
- [ ] `POST /api/auth/register`, `/login` (patients), `/doctor-login` (doctor id + password)
- [ ] JWT middleware + role guard (`patient` / `doctor`)
- [ ] `GET /api/doctors` with live online status
- [ ] `POST /api/requests` (patient) creates a pending request; `POST /api/requests/:id/respond` (doctor) accepts or rejects
- [ ] Accept creates the appointment with a random 24-hex `room_id`
- [ ] Requests auto-expire after 2 minutes

**Done when:** with `curl`/the UI, a patient request is accepted and an appointment exists.

### Session 3: Backend realtime (Socket.io)
- [ ] JWT-checked socket handshake
- [ ] Presence: doctor online/offline, mark offline on disconnect, broadcast to patients
- [ ] Push `request:new` to the doctor and `request:update` to the patient
- [ ] Room events: `join`, WebRTC `signal` relay (offer, answer, ICE) between the two participants only
- [ ] Chat: relay public keys, relay and store ciphertext messages
- [ ] Captions: `caption` event (original text + translated text) relayed to the other participant
- [ ] `call:end` from the doctor moves the appointment to `awaiting_payment` and redirects both users

**Done when:** two browsers join one room and see each other's video and encrypted chat.

### Session 4: Payment, prescription, invoice, signature
- [ ] `PUT /api/appointments/:id/prescription` (doctor): save medicines and notes during the call
- [ ] `POST /api/payments/pay`: validates a test card (Luhn check, `4111 1111 1111 1111` succeeds, `4000 0000 0000 0002` is declined) or a UPI reference
- [ ] The fee is read **from the database**, never from the browser
- [ ] On success, in one transaction: payment `paid` → invoice number allocated → appointment `completed`
- [ ] `server/pdf.js`: two **separate** PDFs
  - `RX-XXXXXX.pdf`: doctor, patient, medicines, notes, signature block, hash, QR
  - `INV-2026-XXXX.pdf`: invoice no., date, patient, doctor, fee, method, transaction ID
- [ ] Prototype signature: Pulscare signing authority (script-style signature), SHA-256 digest of the prescription JSON, QR to `/verify.html?h=<hash>`
- [ ] `GET /api/documents/:id/:type` downloads the PDFs (owner only); `GET /api/verify/:hash` is public

**Done when:** a paid test payment produces two different PDFs and the verify page shows "Valid".

### Session 5: Frontend pages
- [ ] `index.html`: language pills, triage survey (EN/HI/KN) → suggested doctor, patient login/register, doctor login dropdown
- [ ] `patient.html`: doctors with live badges, Consult now, waiting state, tabs: Appointments · Documents
- [ ] `doctor.html`: Go Online/Offline toggle, live request queue, history
- [ ] `consult.html`: video tiles, encrypted chat, live captions with language pick, doctor-only prescription panel, End call button
- [ ] `payment.html`: summary, card / UPI tabs, success screen with the two download buttons
- [ ] `verify.html`: shows signature status for a scanned QR

### Session 6: Client explainer layer
- [ ] `js/pipeline.js`: the pipeline strip on every page. Each step is tagged **Live now** or **Final version**, and the current step is highlighted
- [ ] Backend Activity drawer: every REST/socket event is written by the server (`activity.js`) and streamed into the drawer
- [ ] Small "In the final version" notes on payment, video, chat, prescription and signature
- [ ] `roadmap.html`: 30 → 70 → 100 table in plain language and the final result

### Session 7: Test and rehearse
- [ ] Run `npm start`, open the app, register a patient
- [ ] Run the demo script (section 7)
- [ ] Test the declined-card path and the verify page
- [ ] Rehearse on **both** laptops (section 6)

---

## 6. How to run it

### On your laptop and on the client's (same steps)
1. Install **Node.js 22 LTS or 24** from nodejs.org. Restart the terminal. Check `node -v`.
2. Unzip `pulscare-prototype.zip` somewhere simple (for example `C:\pulscare-prototype` or `~/pulscare-prototype`).
3. Start it:
   - **Windows:** double-click `start.bat`
   - **Mac / Linux:** open a terminal in the folder and run `bash start.sh`
   - or manually: `npm install` then `npm start`
4. Open **Chrome** and go to **http://localhost:3000**

### Demo on ONE laptop (easiest, no setup)
- Window 1: normal Chrome → **patient**
- Window 2: Chrome → profile menu → **Add profile** (or an Incognito window) → **doctor**
- Camera and microphone work on `localhost` without HTTPS. Allow both when prompted.
- Use headphones, otherwise the two windows echo each other.

### Demo on TWO laptops (same Wi-Fi)
Camera, microphone and encryption need a "secure origin". Pick one:

**Option A: Chrome flag (no account needed).** On the laptop that is **not** running the server:
1. Find the server laptop's IP (Windows: `ipconfig`, Mac: `ipconfig getifaddr en0`), e.g. `192.168.1.20`.
2. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
3. Enable it, type `http://192.168.1.20:3000`, relaunch Chrome.
4. Open `http://192.168.1.20:3000` on that laptop.
5. If it does not load, allow Node.js through the firewall (Windows prompts the first time; click **Allow**).

**Option B: ngrok (works over any network).**
1. Create a free ngrok account and install ngrok, then `ngrok config add-authtoken <token>`.
2. With the app running: `ngrok http 3000`
3. Open the `https://….ngrok-free.app` URL on both laptops (tap **Visit Site** on the first visit).

---

## 7. Demo script (what the client sees)

Test accounts (created automatically):

| Role | Login | Password |
|---|---|---|
| Patient | `demo@pulscare.test` | `patient123` |
| Doctor | pick **Dr. Ramesh Ravindra Deshpande** in the dropdown | `doctor123` |

1. **Landing:** point at the pipeline strip and say, "Green steps are working in this prototype. Amber ones are in the final version."
2. **Triage:** switch to Kannada, pick symptoms, see the suggested specialist.
3. **Doctor window:** log in, press **Go Online**.
4. **Patient window:** the doctor's badge turns green. Press **Consult now**.
5. **Doctor:** the request appears instantly. Press **Accept**.
6. **Both:** join the call. Show video, then encrypted chat. Open the Backend Activity drawer and show that the stored message is ciphertext.
7. **Live translation:** the doctor speaks in English, the patient chooses Kannada or Hindi and sees subtitles. If the room is noisy, use the "Type instead of speaking" box.
8. **Doctor:** fill in the prescription panel, press **End call**.
9. **Patient:** payment page opens. First pay with the declined card `4000 0000 0000 0002` to show the failure state, then with `4111 1111 1111 1111`.
10. **Result:** two buttons appear: **Download Prescription** and **Download Invoice**. Open both. Scan the prescription QR or open the verify page to show "Signature valid".
11. **Roadmap page:** walk through what the final version adds.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `node` is not recognized | Reinstall Node 22 LTS and reopen the terminal |
| `npm install` fails on `better-sqlite3`, or the server crashes with `Assertion failed ... env != nullptr` | You have an old copy of the project. Delete the `node_modules` folder and `package-lock.json`, make sure `package.json` says `"better-sqlite3": "12.11.1"`, then run `npm install` again. Do **not** run `npm audit fix --force` |
| Port 3000 in use | Edit `PORT=3001` in `.env` |
| Camera/mic blocked | Click the lock icon in the address bar → Allow. On two laptops use Option A or B above |
| No video from the other side | Read the **Connection check** box under the video: it says in plain words whether the camera, the connection, or the other person's picture is the problem. If it says the devices cannot connect, put both on the same Wi-Fi. For different networks, set the optional `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL` lines in `.env` (free relay credentials from a TURN provider), then restart |
| Phone shows a black video box | Tap the **Tap to start the video** button that appears on the video |
| No live captions | Use Chrome or Edge, allow the microphone, check internet. Use the typed fallback box |
| Translation shows "(offline)" | Translation needs internet. The original text still appears |
| Lost all data / want a clean demo | Stop the app, delete the `data/` folder, start again |

---

## 9. Known limits (state them to the client)

- Payment is a simulation. The server logic is real, but no money moves.
- Prototype signature is ours, not a doctor's licensed signature. Not valid as a real prescription.
- Chat keys live only in the browser tab. Reloading mid-call re-creates them, so earlier messages cannot be decrypted. Fixed in the final version.
- Video is peer-to-peer. It works on a normal home Wi-Fi, but strict networks may need a TURN server (final version).
- Translation sends plain text to a third-party service and therefore is never strictly E2EE. The final version adds a consent log.
- Everything runs locally. No data leaves the laptop except translation text and captions' speech recognition (Chrome).
