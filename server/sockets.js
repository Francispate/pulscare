// PASTE AS: server/sockets.js  (replaces the old file)  Day 6: ending a call alerts the next waiting patient. Day 5: a slot room opens 10 minutes before the slot. Day 3: database calls are async (Supabase).
const db = require('./db');
const { uid } = db;
const activity = require('./activity');
const queue = require('./queue');
const { verifyToken, participant } = require('./routes');

// Every socket handler runs inside safe(): a database error is logged and the sender gets a friendly message,
// instead of crashing the whole server.
const safe = (name, fn) => async (...args) => {
  try { await fn(...args); }
  catch (e) {
    console.error(`Socket "${name}" error:`, e.message);
    const ack = args.find((x) => typeof x === 'function');
    if (ack) ack({ error: 'Server error. Please try again.' });
  }
};

function setupSockets(io) {
  const doctorSockets = new Map(); // doctorId -> Set(socket.id)

  // Fresh start: nobody is online until they connect and toggle.
  db.resetAllOffline().catch((e) => console.error('Could not reset doctor presence:', e.message));

  io.use((socket, next) => {
    const user = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const u = socket.user;
    socket.join('user:' + u.id);
    socket.join('activity');

    if (u.role === 'doctor') {
      if (!doctorSockets.has(u.id)) doctorSockets.set(u.id, new Set());
      doctorSockets.get(u.id).add(socket.id);
    }

    socket.on('room:join', safe('room:join', async ({ appointmentId }, ack) => {
      const a = await participant(appointmentId, u.id);
      if (!a) return ack && ack({ error: 'Not your appointment.' });
      if (a.payment_status === 'paid') return ack && ack({ error: 'This consultation is finished.' });
      // A visit booked from a slot opens 10 minutes before its start time (request-based visits have no slot and open at once).
      if (a.slot_id && a.status === 'booked') {
        const slot = await db.getSlot(a.slot_id);
        if (slot && Date.now() < new Date(slot.starts_at).getTime() - 10 * 60000) {
          const when = new Date(slot.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
          return ack && ack({ error: `This visit is booked for ${when} IST. The room opens 10 minutes before.` });
        }
      }
      socket.join('appt:' + a.id);
      socket.apptId = a.id;
      if (a.status === 'booked') await db.startIfBooked(a.id);
      // Send the other person's stored public key (if any) to the joiner.
      const peerKey = await db.getPeerKey(a.id, u.id);
      socket.to('appt:' + a.id).emit('peer:joined', { userId: u.id, name: u.name });
      activity.log('Room', `${u.name} joined private room ${a.room_id.slice(0, 8)}... (only the 2 participants are admitted)`, 'video');
      ack && ack({ ok: true, role: u.role, peerKey: peerKey || null, status: a.status });
    }));

    socket.on('signal', safe('signal', async ({ appointmentId, data }) => {
      if (!(await participant(appointmentId, u.id))) return;
      socket.to('appt:' + appointmentId).emit('signal', { data });
    }));

    socket.on('key:publish', safe('key:publish', async ({ appointmentId, publicKey }) => {
      if (typeof publicKey !== 'string' || !(await participant(appointmentId, u.id))) return;
      await db.upsertKey(appointmentId, u.id, publicKey);
      socket.to('appt:' + appointmentId).emit('key:peer', { publicKey });
      activity.log('Chat', `${u.name} published an ephemeral public key. The private key never leaves the browser`, 'chat');
    }));

    socket.on('chat:send', safe('chat:send', async ({ appointmentId, ciphertext, iv }, ack) => {
      if (!ciphertext || !iv || !(await participant(appointmentId, u.id))) return ack && ack({ error: 'Invalid message.' });
      const msg = { id: uid('MSG'), senderId: u.id, ciphertext: String(ciphertext).slice(0, 8000), iv: String(iv).slice(0, 64), createdAt: new Date().toISOString() };
      await db.insertMessage({ id: msg.id, appointmentId, senderId: u.id, ciphertext: msg.ciphertext, iv: msg.iv });
      io.to('appt:' + appointmentId).emit('chat:message', msg);
      activity.log('Chat', `Stored encrypted message (${msg.ciphertext.slice(0, 18)}...). The server cannot read it`, 'chat');
      ack && ack({ ok: true });
    }));

    // Live captions: the speaker's own words are relayed as they speak (not stored, not translated).
    // final=false is a quick in-progress update, final=true is the finished sentence.
    socket.on('caption', safe('caption', async ({ appointmentId, text, lang, final }) => {
      if (!text || !(await participant(appointmentId, u.id))) return;
      socket.to('appt:' + appointmentId).emit('caption', { text: String(text).slice(0, 400), lang, name: u.name, final: !!final });
    }));

    // Tells the other person whether my live captions are on, off, blocked or not supported on my device.
    socket.on('caption:state', safe('caption:state', async ({ appointmentId, state }) => {
      if (!['listening', 'off', 'unsupported', 'blocked', 'busy'].includes(state)) return;
      if (!(await participant(appointmentId, u.id))) return;
      socket.to('appt:' + appointmentId).emit('caption:state', { state });
    }));

    socket.on('call:end', safe('call:end', async ({ appointmentId }, ack) => {
      if (u.role !== 'doctor') return ack && ack({ error: 'Only the doctor can end the call.' });
      const a = await participant(appointmentId, u.id);
      if (!a) return ack && ack({ error: 'Not your appointment.' });
      const rx = await db.getRx(a.id);
      if (!rx) return ack && ack({ error: 'Save the prescription before ending the call.' });
      await db.setAppointmentStatus(a.id, 'awaiting_payment');
      io.to('appt:' + a.id).emit('call:ended', { appointmentId: a.id });
      io.to('user:' + a.patient_id).emit('call:ended', { appointmentId: a.id });
      activity.log('Appointments', `${u.name} ended the call. Appointment moved to "awaiting payment". Patient redirected to checkout`, 'appointment');
      await queue.onCallEnded(a.doctor_id);   // the doctor is free: the first waiting patient gets "Doctor is ready. Join now"
      ack && ack({ ok: true });
    }));

    socket.on('disconnect', () => {
      if (socket.apptId) socket.to('appt:' + socket.apptId).emit('peer:left', { userId: u.id });
      if (u.role === 'doctor') {
        const set = doctorSockets.get(u.id);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) {
            // Grace period: moving between pages (dashboard -> call room) briefly drops the socket. Only go offline if they stay gone.
            setTimeout(async () => {
              try {
                const again = doctorSockets.get(u.id);
                if (again && again.size > 0) return;
                doctorSockets.delete(u.id);
                if (await db.getDoctorOnline(u.id)) {
                  await db.setDoctorOnline(u.id, 0);
                  io.emit('presence:update', { doctorId: u.id, online: false });
                  await queue.clearQueue(u.id, 'The doctor went offline');
                  activity.log('Presence', `${u.name} closed the browser. Marked offline after a 6 second grace period`, 'presence');
                }
              } catch (e) { console.error('Presence cleanup error:', e.message); }
            }, 6000);
          }
        }
      }
    });
  });
}

module.exports = { setupSockets };
