// PASTE AS: server/index.js  Day 11: mounts the admin routes and loads the disabled-doctor list at start. Day 10: mounts the medical record routes. Day 9: mounts the notification routes and starts the reminder sweeper. (replaces the old file)
// Day 7: mounts the key backup routes. Day 6: mounts the queue routes and starts the queue sweeper. Day 5: mounts the slot routes. Day 4: security.js loads first, so the server refuses to start with a weak JWT secret. Also tells Express to trust the tunnel for real IPs.
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
require('./security'); // must stay first: stops the server right here if JWT_SECRET is weak or default
const activity = require('./activity');
const { supabase } = require('./supabase');
const { buildRouter } = require('./routes');
const { setupSockets } = require('./sockets');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
activity.attach(io);

// Only trust the forwarded-IP header when it comes from this laptop (for example the Cloudflare tunnel). Keeps rate limits honest.
app.set('trust proxy', 'loopback');

process.on('unhandledRejection', (e) => console.error('Unhandled error:', e && e.message ? e.message : e));

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/api/health', async (req, res) => {
  const r = await supabase.from('doctors').select('id', { count: 'exact', head: true });
  res.json({ status: r.error ? 'database-error' : 'ok', database: 'supabase', doctors: r.count || 0, app: 'Pulscare prototype' });
});
app.use('/api', require('./attachments').buildAttachmentRouter(io));
app.use('/api', require('./languages').router);
app.use('/api', require('./keys').router);
app.use('/api', require('./notify').buildNotifyRouter(io));
app.use('/api', require('./records').buildRecordsRouter());
app.use('/api', require('./slots').buildSlotRouter(io));
app.use('/api', require('./queue').buildQueueRouter(io));
app.use('/api', require('./admin').buildAdminRouter(io));
app.use('/api', buildRouter(io));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

setupSockets(io);
require('./queue').start(io);
require('./notify').start(io);

(async () => {
  // Fail early with a clear message instead of failing on the first login.
  const ping = await supabase.from('doctors').select('id', { count: 'exact', head: true });
  if (ping.error) {
    console.error('\nCannot reach Supabase: ' + ping.error.message);
    console.error('Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, and that you ran supabase/schema.sql and supabase/day3.sql.\n');
    process.exit(1);
  }
  try { await require('./db').refreshDisabled(); }
  catch (e) { console.error('\nCould not read the doctors\' disabled flag: ' + e.message + '\nDid you run supabase/day11.sql in the Supabase SQL Editor?\n'); process.exit(1); }
  const recheck = setInterval(() => require('./db').refreshDisabled().catch(() => {}), 30000); // also notices a change made by hand in Supabase
  if (recheck.unref) recheck.unref();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n==============================================');
    console.log(' Pulscare Tele-Health prototype is running');
    console.log(' Database      : Supabase (' + ping.count + ' doctors found)');
    console.log(` Open in Chrome: http://localhost:${PORT}`);
    console.log(' Demo patient  : demo@pulscare.test / patient123');
    console.log(' Doctors       : pick any in the dropdown / doctor123');
    console.log('==============================================\n');
  });
})();
