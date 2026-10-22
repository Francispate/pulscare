#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is not installed. Install Node 22 LTS from https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Installing libraries, please wait..."; npm install || exit 1; }
[ -f .env ] || cp .env.example .env
echo "Starting Pulscare... open http://localhost:3000 in Chrome"
npm start
