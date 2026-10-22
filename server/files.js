// Uploaded files (memos, approvals, invoices, designs) are stored in data/uploads and only shown to people allowed to see them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./db');
const { canSeeRequest } = require('./access');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpeg|webp)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|application\/msword)$/;
const fileOnDisk = id => path.join(store.UPLOAD_DIR, id.replace(/[^a-z0-9-]/gi, ''));

function saveUpload(user, name, type, buffer) {
  if (!buffer.length) return { status: 400, body: { error: 'The file is empty.' } };
  if (buffer.length > MAX_BYTES) return { status: 413, body: { error: 'The file is larger than 10 MB.' } };
  if (!ALLOWED.test(type)) return { status: 415, body: { error: 'Only PDF, Word, Excel and image files can be attached.' } };
  const id = 'file-' + crypto.randomBytes(12).toString('hex');
  const safeName = String(name || 'file').replace(/[\\/:*?"<>|\r\n]+/g, '-').slice(0, 150);
  fs.writeFileSync(fileOnDisk(id), buffer);
  store.db.prepare('INSERT INTO files (id, name, type, size, uploaded_by, club_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
    .run(id, safeName, type, buffer.length, user.id, user.clubId || null, new Date().toISOString());
  return { status: 200, body: { id, name: safeName, size: buffer.length, type } };
}

// Can this person open the file? The uploader, the SAO Office, the club's own rep, or someone who can see the request it belongs to.
function canOpen(user, row) {
  if (user.role === 'sao' || row.uploaded_by === user.id) return true;
  if (user.role === 'rep' && row.club_id && row.club_id === user.clubId) return true;
  if (row.request_id) { const r = store.get('requests', row.request_id); return !!r && canSeeRequest(user, r); }
  return false;
}
function openFile(user, id) {
  const row = store.db.prepare('SELECT * FROM files WHERE id = ?').get(String(id));
  if (!row || !canOpen(user, row)) return null;   // same answer for "missing" and "not allowed"
  const p = fileOnDisk(row.id);
  if (!fs.existsSync(p)) return null;
  return { path: p, name: row.name, type: row.type, size: row.size };
}

module.exports = { saveUpload, openFile, MAX_BYTES, fileOnDisk };
