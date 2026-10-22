// Backend activity feed: every important server event is recorded and streamed to the UI drawer.
let io = null;
const recent = [];

function attach(socketServer) { io = socketServer; }

function log(actor, message, stage = 'info') {
  const entry = { t: new Date().toISOString(), actor, message, stage };
  recent.push(entry);
  if (recent.length > 200) recent.shift();
  console.log(`[${stage}] ${actor}: ${message}`);
  if (io) io.to('activity').emit('activity', entry);
}

function getRecent() { return recent.slice(-60); }

module.exports = { attach, log, getRecent };
