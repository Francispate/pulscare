// PASTE AS: server/pdf.js  (replaces the old file)
// Day 8: files are fingerprinted (SHA-256 of the PDF itself), paths are kept inside storage/, and integrity checks are shared with the routes.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORAGE = path.join(__dirname, '..', 'storage');
fs.mkdirSync(STORAGE, { recursive: true });

const NAVY = '#12263A';
const TEAL = '#0F8B7D';
const MUTED = '#5B6B78';
const LINE = '#DCE4E8';

// The exact fields that are signed. Verification recomputes this from the database.
function canonicalRx({ rxId, doctorName, licenseId, patientName, patientId, items, notes, diagnosis, issuedAt }) {
  return JSON.stringify({ rxId, doctorName, licenseId, patientName, patientId, items, notes, diagnosis, issuedAt });
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha256Buf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Day 8: safe file handling and integrity checks ----------------------------------------------------------
// Files are always read from inside storage/, whatever path was saved earlier. Old absolute paths (from before the project
// folder was moved or renamed) still work, and a tampered path such as "../../secret" can never leave the folder.
function resolveStored(stored) {
  const name = path.basename(String(stored || '').replace(/\\/g, '/'));
  return name && name !== '.' && name !== '..' ? path.join(STORAGE, name) : null;
}
// Compares two hex hashes without leaking timing information.
function sameHash(a, b) {
  try {
    const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex');
    return x.length === 32 && y.length === 32 && crypto.timingSafeEqual(x, y);
  } catch { return false; }
}
// Layer 1 (the data): recompute the signed fingerprint from what is in the database NOW and compare it with the one signed at issue time.
function checkRx(rx, doctor, patient) {
  try {
    const recomputed = sha256(canonicalRx({
      rxId: rx.id, doctorName: doctor.full_name, licenseId: doctor.license_id, patientName: patient.full_name,
      patientId: patient.id, items: JSON.parse(rx.items), notes: rx.notes, diagnosis: rx.diagnosis, issuedAt: rx.issued_at
    }));
    return sameHash(recomputed, rx.sha256);
  } catch { return false; }
}

function watermark(doc) {
  doc.save();
  doc.rotate(-35, { origin: [297, 420] });
  doc.fillColor('#EEF2F4').font('Helvetica-Bold').fontSize(64).text('PROTOTYPE', 90, 390, { width: 420, align: 'center' });
  doc.restore();
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, 595, 6).fill(TEAL);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text('Pulscare', 50, 34, { continued: true });
  doc.fillColor(TEAL).text(' Tele-Health');
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Licensed physician consultations, delivered securely', 50, 62);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(title, 300, 36, { width: 245, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(subtitle, 300, 58, { width: 245, align: 'right' });
  doc.moveTo(50, 86).lineTo(545, 86).lineWidth(1).strokeColor(LINE).stroke();
}

// Our prototype signature: a hand-drawn style stroke + signing authority name.
function drawSignature(doc, x, y) {
  doc.save();
  doc.lineWidth(1.6).strokeColor('#1B4F8A');
  doc.moveTo(x, y + 28)
    .bezierCurveTo(x + 14, y - 6, x + 22, y + 44, x + 38, y + 14)
    .bezierCurveTo(x + 48, y - 6, x + 58, y + 38, x + 74, y + 10)
    .bezierCurveTo(x + 84, y - 4, x + 98, y + 30, x + 120, y + 18)
    .stroke();
  doc.moveTo(x + 6, y + 36).lineTo(x + 124, y + 34).lineWidth(0.8).stroke();
  doc.restore();
  doc.fillColor('#1B4F8A').font('Times-Italic').fontSize(13).text('Pulscare Signing Authority', x, y + 42);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Prototype digital signature', x, y + 58);
}

function finish(doc, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
    doc.end();
  });
}

async function generatePrescription(data, baseUrl) {
  const canonical = canonicalRx(data);
  const hash = sha256(canonical);
  const verifyUrl = `${baseUrl}/verify.html?h=${hash}`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 150 });

  const filePath = path.join(STORAGE, `${data.rxId}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  watermark(doc);
  header(doc, 'Electronic Prescription', `${data.rxId}  |  ${data.issuedAt}`);

  // Parties
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('PRESCRIBING PHYSICIAN', 50, 102);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(data.doctorName, 50, 114);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`${data.department}  |  Licence ${data.licenseId}`, 50, 132);

  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('PATIENT', 320, 102);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(data.patientName, 320, 114);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Patient ID ${data.patientId}`, 320, 132);

  if (data.diagnosis) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('DIAGNOSIS / REASON FOR VISIT', 50, 166);
    doc.fillColor(NAVY).font('Helvetica').fontSize(11).text(data.diagnosis, 50, 178, { width: 495 });
  }

  // Medicines table
  let y = 220;
  doc.fillColor(TEAL).font('Times-Bold').fontSize(30).text('Rx', 50, y - 8);
  y += 36;
  const cols = [50, 215, 290, 390, 470];
  const heads = ['Medicine', 'Dose', 'Frequency', 'Timing', 'Days'];
  doc.rect(50, y, 495, 22).fill('#EAF5F3');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9);
  heads.forEach((h, i) => doc.text(h, cols[i] + 6, y + 7));
  y += 22;
  doc.font('Helvetica').fontSize(10);
  for (const it of data.items) {
    doc.fillColor(NAVY).text(it.medicine || '-', cols[0] + 6, y + 8, { width: 155 });
    doc.text(it.dose || '-', cols[1] + 6, y + 8, { width: 70 });
    doc.text(it.frequency || '-', cols[2] + 6, y + 8, { width: 95 });
    doc.text(it.timing || '-', cols[3] + 6, y + 8, { width: 75 });
    doc.text(String(it.days || '-'), cols[4] + 6, y + 8, { width: 60 });
    y += 30;
    doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }

  // Notes
  y += 16;
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('PHYSICIAN NOTES AND INSTRUCTIONS', 50, y);
  doc.fillColor(NAVY).font('Helvetica').fontSize(10.5).text(data.notes || 'No additional instructions.', 50, y + 12, { width: 495 });

  // Signature + QR block
  const by = 640;
  doc.moveTo(50, by - 14).lineTo(545, by - 14).lineWidth(1).strokeColor(LINE).stroke();
  doc.image(qr, 50, by, { width: 86 });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9).text('SHA-256 signed', 148, by + 4);
  doc.fillColor(MUTED).font('Courier').fontSize(7).text(hash.slice(0, 32) + '\n' + hash.slice(32), 148, by + 18);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Scan the QR code to verify this prescription is unaltered.', 148, by + 44, { width: 190 });
  drawSignature(doc, 380, by + 6);

  doc.fillColor('#9A3412').font('Helvetica-Oblique').fontSize(8)
    .text('Prototype only. Not a valid medical prescription. Generated for a client demonstration.', 50, 762, { width: 495, align: "center" });

  await finish(doc, filePath);
  return { filePath, fileName: path.basename(filePath), fileSha256: sha256Buf(fs.readFileSync(filePath)), hash, canonical };
}

async function generateInvoice(d) {
  const filePath = path.join(STORAGE, `${d.invoiceNo}.pdf`);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  watermark(doc);
  header(doc, 'Tax Invoice', `${d.invoiceNo}  |  ${d.date}`);

  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('BILLED TO', 50, 102);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(d.patientName, 50, 114);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Patient ID ${d.patientId}`, 50, 132);

  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('PAYMENT', 320, 102);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text('Paid', 320, 114);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`${d.method}  |  Ref ${d.txnRef}`, 320, 132);

  let y = 190;
  doc.rect(50, y, 495, 22).fill('#EAF5F3');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9);
  doc.text('Description', 56, y + 7);
  doc.text('Amount (INR)', 440, y + 7, { width: 100, align: 'right' });
  y += 22;
  doc.font('Helvetica').fontSize(10.5).fillColor(NAVY);
  doc.text(`Video consultation with ${d.doctorName}`, 56, y + 10, { width: 340 });
  doc.fillColor(MUTED).fontSize(9).text(`${d.department}  |  Appointment ${d.appointmentId}`, 56, y + 26, { width: 340 });
  doc.fillColor(NAVY).fontSize(10.5).text(d.amount.toFixed(2), 440, y + 10, { width: 100, align: 'right' });
  y += 52;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(LINE).stroke();

  y += 14;
  const row = (label, value, bold) => {
    doc.fillColor(bold ? NAVY : MUTED).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10)
      .text(label, 330, y, { width: 100 });
    doc.text(value, 440, y, { width: 100, align: 'right' });
    y += bold ? 22 : 18;
  };
  row('Subtotal', d.amount.toFixed(2));
  row('Tax (0%)', '0.00');
  doc.moveTo(330, y - 2).lineTo(545, y - 2).lineWidth(0.8).strokeColor(NAVY).stroke();
  y += 6;
  row('Total paid', 'Rs ' + d.amount.toFixed(2), true);

  doc.fillColor(MUTED).font('Helvetica').fontSize(9)
    .text('This invoice is generated automatically by the server after the payment is verified. The prescription is issued as a separate document.', 50, 400, { width: 300 });

  doc.fillColor('#9A3412').font('Helvetica-Oblique').fontSize(8)
    .text('Prototype only. Simulated payment, no money was charged. Generated for a client demonstration.', 50, 762, { width: 495, align: "center" });

  await finish(doc, filePath);
  return { filePath, fileName: path.basename(filePath), fileSha256: sha256Buf(fs.readFileSync(filePath)) };
}

module.exports = { generatePrescription, generateInvoice, canonicalRx, sha256, sha256Buf, sameHash, checkRx, resolveStored, STORAGE };
