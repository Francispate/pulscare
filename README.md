# Pulscare Tele-Health: 30% prototype (local only)

## 1. Install (once per laptop)
1. Install **Node.js 22 LTS or 24** from https://nodejs.org (no Python needed).
2. Check: open a terminal and run `node -v` (should show v22.x.x or v24.x.x).

If you have an older copy: delete `node_modules` and `package-lock.json`, then run `npm install`. Do not run `npm audit fix --force`.

## 2. Start
- **Windows:** double-click `start.bat`
- **Mac/Linux:** `bash start.sh`
- Or manually: `npm install` then `npm start`

Open **Chrome** at **http://localhost:3000**

## 3. Demo accounts
- Patient: `demo@pulscare.test` / `patient123` (or register a new patient)
- Doctor: pick any doctor in the dropdown / `doctor123`

## 4. Two people on one laptop
Use two browser windows (for example a normal window and an Incognito window, or two Chrome profiles).
Each window keeps its own login. Use headphones to avoid echo.

## 5. Two laptops
Camera, microphone and chat encryption need a secure origin.
- **Option A (same Wi-Fi):** on the second laptop open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
  add `http://<server-laptop-IP>:3000`, enable, relaunch Chrome, then open that address.
- **Option B (any network):** install ngrok, run `ngrok http 3000`, open the https URL on both laptops.

## 6. Reset data
Stop the app, delete the `data/` and `storage/` folders, start again.

Full plan, demo script and troubleshooting: `docs/Pulscare_30_Percent_Plan.md`
