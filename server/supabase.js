// PASTE AS: server/supabase.js  (new file)
// One shared connection to Supabase. Used from the SERVER only. The secret key must never be sent to the browser.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Supabase is not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your .env file, then restart.');
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// Small helper: returns the data, or throws a readable error.
function check(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

module.exports = { supabase, check };
