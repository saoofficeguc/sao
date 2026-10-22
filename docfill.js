/* Fills the SAO's own Word templates (templates/*.docx). Nothing is generated: values are written into
 * the existing boxes, ☐ becomes ☒ for chosen options, and e-signature images go into the signature cells.
 * Needs JSZip.
 */
window.DocFill = (() => {
'use strict';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const NS_DECL = `xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const BOX_ON = '☒', BOX_OFF = '☐';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const kids = (el, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.namespaceURI === W && n.localName === name);
const all = (el, name) => [...el.getElementsByTagNameNS(W, name)];
const textOf = el => all(el, 't').map(t => t.textContent).join('');

// ---------- low-level XML editing ----------
function runProps(p) {
  const r = all(p, 'r')[0];
  let rpr = r && kids(r, 'rPr')[0];
  if (!rpr) { const ppr = kids(p, 'pPr')[0]; rpr = ppr && kids(ppr, 'rPr')[0]; }
  if (!rpr) return null;
  const c = rpr.cloneNode(true);
  ['color', 'i', 'iCs', 'u'].forEach(n => all(c, n).forEach(e => e.remove())); // placeholder styling is not kept
  return c;
}
function makeRun(doc, text, rpr) {
  const r = doc.createElementNS(W, 'w:r');
  if (rpr) r.appendChild(rpr.cloneNode(true));
  String(text).split('\n').forEach((line, i) => {
    if (i) r.appendChild(doc.createElementNS(W, 'w:br'));
    const t = doc.createElementNS(W, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = line;
    r.appendChild(t);
  });
  return r;
}
function clearRuns(p) { [...p.childNodes].forEach(n => { if (n.nodeType === 1 && !(n.namespaceURI === W && n.localName === 'pPr')) n.remove(); }); }
function setCellText(doc, tc, text) {
  const ps = kids(tc, 'p');
  const p = ps[0] || tc.appendChild(doc.createElementNS(W, 'w:p'));
  const rpr = runProps(p);
  ps.slice(1).forEach(x => x.remove());
  clearRuns(p);
  if (text) p.appendChild(makeRun(doc, text, rpr));
  return { p, rpr };
}
function appendCellLine(doc, tc, text) {
  const first = kids(tc, 'p')[0];
  const p = doc.createElementNS(W, 'w:p');
  const ppr = first && kids(first, 'pPr')[0];
  if (ppr) p.appendChild(ppr.cloneNode(true));
  p.appendChild(makeRun(doc, text, first ? runProps(first) : null));
  tc.appendChild(p);
}
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
function setBox(doc, tc, on) {
  // Word checkbox content control: flip its "checked" state as well as the symbol shown
  let sdt = tc.parentNode && tc.parentNode.parentNode;
  if (!(sdt && sdt.localName === 'sdt')) sdt = all(tc, 'sdt')[0];
  const cb = sdt && sdt.getElementsByTagNameNS(W14, 'checkbox')[0];
  if (cb) {
    const st = cb.getElementsByTagNameNS(W14, 'checked')[0];
    if (st) st.setAttributeNS(W14, 'w14:val', on ? '1' : '0');
  }
  const t = all(tc, 't').find(x => /[☐☒]/.test(x.textContent));
  if (t) {
    t.textContent = t.textContent.replace(/[☐☒]/, on ? BOX_ON : BOX_OFF);
    // Some template boxes carry a black highlight that hides the tick - remove it from the box only
    all(t.parentNode, 'highlight').forEach(h => h.remove());
  }
  else {
    const { p } = setCellText(doc, tc, '');
    const rpr = doc.createElementNS(W, 'w:rPr');
    const f = doc.createElementNS(W, 'w:rFonts');
    ['ascii', 'eastAsia', 'hAnsi'].forEach(a => f.setAttributeNS(W, 'w:' + a, 'MS Gothic'));
    rpr.appendChild(f);
    p.appendChild(makeRun(doc, on ? BOX_ON : BOX_OFF, rpr));
  }
}

// ---------- images (signatures) ----------
function pngSize(b64) {
  const bin = atob(b64.slice(0, 64));
  const u = i => bin.charCodeAt(i);
  return { w: (u(16) << 24 | u(17) << 16 | u(18) << 8 | u(19)) >>> 0, h: (u(20) << 24 | u(21) << 16 | u(22) << 8 | u(23)) >>> 0 };
}
function makeImages(zip) {
  const list = [];
  return {
    // returns a <w:r> with the picture; height in cm
    run(doc, dataUrl, heightCm = 1.1, maxWidthCm = 4.2) {
      if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return null;
      const b64 = dataUrl.split(',')[1];
      const { w, h } = pngSize(b64);
      if (!w || !h) return null;
      const n = list.length + 1, rid = 'rIdSaoSig' + n, id = 9000 + n;
      list.push({ rid, path: `media/sao_sig_${n}.png`, b64 });
      const EMU = 360000; // per cm
      let cy = heightCm * EMU, cx = cy * w / h;
      if (cx > maxWidthCm * EMU) { cx = maxWidthCm * EMU; cy = cx * h / w; }
      const xml = `<w:r ${NS_DECL}><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/><wp:docPr id="${id}" name="Signature ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="signature${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      return doc.importNode(new DOMParser().parseFromString(xml, 'application/xml').documentElement, true);
    },
    async save() {
      if (!list.length) return;
      const relPath = 'word/_rels/document.xml.rels';
      let rels = await zip.file(relPath).async('string');
      const add = list.map(i => `<Relationship Id="${i.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${i.path}"/>`).join('');
      rels = rels.replace('</Relationships>', add + '</Relationships>');
      zip.file(relPath, rels);
      list.forEach(i => zip.file('word/' + i.path, i.b64, { base64: true }));
      let ct = await zip.file('[Content_Types].xml').async('string');
      if (!/Extension="png"/i.test(ct)) ct = ct.replace('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">', m => m + '<Default Extension="png" ContentType="image/png"/>');
      zip.file('[Content_Types].xml', ct);
    },
  };
}

// ---------- table templates (event approvals, sponsorship) ----------
// Cells can sit directly in the row, or inside a content control (<w:sdt>) - Word checkboxes are built that way.
const rowCells = tr => [...tr.childNodes].flatMap(n => {
  if (n.nodeType !== 1 || n.namespaceURI !== W) return [];
  if (n.localName === 'tc') return [n];
  if (n.localName === 'sdt') { const c = kids(n, 'sdtContent')[0]; return c ? kids(c, 'tc') : []; }
  return [];
});
function grid(tbl) {
  return kids(tbl, 'tr').map(tr => {
    let col = 0;
    const cells = rowCells(tr).map(tc => {
      const gs = all(tc, 'gridSpan')[0];
      const span = gs ? Number(gs.getAttributeNS(W, 'val')) || 1 : 1;
      const tx = textOf(tc);
      const c = { tc, col, span, text: tx, n: norm(tx) };
      col += span;
      return c;
    });
    return { tr, cells };
  });
}

/* spec = {
 *   fields: [{label, value}], radios: [{options, value}], speakers: [..],
 *   appends: [{label, text}], groups: [{label, items, checked, other}],
 *   signatures: {advisor:{name, image}, sao:{...}, vp:{...}}, officeReview, comments }
 * Returns a list of labels that were not found (for testing). */
function fillTable(doc, spec, images) {
  const tbl = all(doc, 'tbl')[0];
  const rows = grid(tbl);
  const missing = [];
  const findRow = n => rows.findIndex(r => r.cells.some(c => c.n === n));
  const svcRow = findRow('neededservices'), sigRow = findRow('signatures');
  const fieldEnd = svcRow >= 0 ? svcRow : sigRow >= 0 ? sigRow : rows.length;
  const below = (ri, col) => rows[ri + 1]?.cells.find(c => c.col <= col && col < c.col + c.span);
  const findIn = (from, to, pred) => { for (let ri = from; ri < to; ri++) { const ci = rows[ri].cells.findIndex(pred); if (ci >= 0) return { ri, ci, cell: rows[ri].cells[ci] }; } return null; };

  // Text fields: value goes in the cell to the right, or below when the label is the last cell in the row.
  (spec.fields || []).forEach(({ label, value }) => {
    const L = norm(label);
    const hit = findIn(0, fieldEnd, c => c.n === L);
    if (!hit) { missing.push(label); return; }
    const next = rows[hit.ri].cells[hit.ci + 1];
    const target = next ? next.tc : below(hit.ri, hit.cell.col)?.tc;
    if (target) setCellText(doc, target, value || ''); else missing.push(label);
  });
  // Radio rows like "Event Slot  ☐ Normal Hours  ☐ After Hours": the box is just before the option.
  (spec.radios || []).forEach(({ options, value }) => {
    options.forEach(o => {
      const hit = findIn(0, fieldEnd, c => c.n === norm(o));
      const box = hit && rows[hit.ri].cells[hit.ci - 1];
      if (box && /[☐☒]/.test(box.text)) setBox(doc, box.tc, o === value); else missing.push(o);
    });
  });
  // Speakers "1-", "2-", "3-"
  (spec.speakers || []).forEach((name, i) => {
    const hit = findIn(0, fieldEnd, c => c.text.trim() === `${i + 1}-`);
    if (hit) setCellText(doc, hit.cell.tc, `${i + 1}- ${name || ''}`);
  });
  // Notes added under a label, e.g. "SCAD Approval must be attached" -> "Attached: file.pdf"
  (spec.appends || []).forEach(({ label, text }) => {
    const hit = findIn(0, sigRow >= 0 ? sigRow : rows.length, c => c.n.startsWith(norm(label)));
    if (hit) appendCellLine(doc, hit.cell.tc, text); else missing.push(label);
  });

  // A signature placed inside a labelled box, e.g. the Clinic signing in "Clinic Approval"
  (spec.boxSignatures || []).forEach(({ label, name, image, date }) => {
    const hit = findIn(0, sigRow >= 0 ? sigRow : rows.length, c => c.n.startsWith(norm(label)));
    if (!hit) { missing.push(label); return; }
    const tc = hit.cell.tc;
    const run = images.run(doc, image, 0.8, 3.2);
    if (run) {
      const first = kids(tc, 'p')[0];
      const p = doc.createElementNS(W, 'w:p');
      const ppr = first && kids(first, 'pPr')[0];
      if (ppr) p.appendChild(ppr.cloneNode(true));
      p.appendChild(run);
      tc.appendChild(p);
    }
    appendCellLine(doc, tc, `${name} - ${date}`);
  });

  // Service checklists: each item belongs to the closest group header above it in the same column.
  if (svcRow >= 0) {
    const end = sigRow >= 0 ? sigRow : rows.length;
    const groupNorms = new Set((spec.groups || []).map(g => norm(g.label)));
    const headers = [];
    for (let ri = svcRow; ri < end; ri++) rows[ri].cells.forEach(c => { if (groupNorms.has(c.n) || KNOWN_HEADERS.has(c.n)) headers.push({ ri, col: c.col, span: c.span, n: c.n }); });
    const owner = (ri, col) => headers.filter(h => h.ri < ri && h.col <= col && col < h.col + h.span).sort((a, b) => b.ri - a.ri)[0];
    (spec.groups || []).forEach(g => {
      const G = norm(g.label);
      const inGroup = (ri, c) => owner(ri, c.col)?.n === G;
      const items = [...g.items, 'Others'];
      items.forEach(item => {
        const on = item === 'Others' ? !!g.other || g.checked.includes('Others') : g.checked.includes(item);
        for (let ri = svcRow; ri < end; ri++) {
          const cells = rows[ri].cells;
          const ci = cells.findIndex(c => c.n === norm(item) && inGroup(ri, c));
          if (ci < 0) continue;
          const box = cells[ci + 1];
          if (box) setBox(doc, box.tc, on);
          return;
        }
        if (item !== 'Others') missing.push(`${g.label}: ${item}`);
      });
      if (g.other) {
        const hit = findIn(svcRow, end, c => c.n === 'specify');
        let spec2 = null;
        for (let ri = svcRow; ri < end && !spec2; ri++) rows[ri].cells.forEach(c => { if (!spec2 && c.n === 'specify' && inGroup(ri, c)) spec2 = c; });
        if (spec2) setCellText(doc, spec2.tc, 'Specify: ' + g.other); else if (!hit) missing.push(`${g.label}: Specify`);
      }
    });
  }

  // Signatures: [name] [role] [signature]
  if (sigRow >= 0) {
    const roles = { advisor: 'academicadvisor', sao: 'youthwelfaredirector', vp: 'gucvicepresident' };
    Object.entries(roles).forEach(([stage, roleN]) => {
      const hit = findIn(sigRow, rows.length, c => c.n === roleN);
      if (!hit) { missing.push('signature ' + stage); return; }
      const s = spec.signatures?.[stage];
      const nameCell = rows[hit.ri].cells[hit.ci - 1], sigCell = rows[hit.ri].cells[hit.ci + 1];
      if (nameCell) setCellText(doc, nameCell.tc, s?.name || '');
      if (sigCell) {
        const { p } = setCellText(doc, sigCell.tc, '');
        const run = s?.image && images.run(doc, s.image);
        if (run) p.appendChild(run);
      }
    });
    // Office Review / Comments are narrow columns: small text so the form stays on its page
    const put = (label, text) => {
      const hit = findIn(sigRow, rows.length, c => c.n === label);
      const cell = hit && below(hit.ri, hit.cell.col);
      if (!cell) return;
      setCellText(doc, cell.tc, text || '');
      all(cell.tc, 'r').forEach(r => {
        let rpr = kids(r, 'rPr')[0];
        if (!rpr) { rpr = doc.createElementNS(W, 'w:rPr'); r.insertBefore(rpr, r.firstChild); }
        ['sz', 'szCs'].forEach(n => { all(rpr, n).forEach(e => e.remove()); const e = doc.createElementNS(W, 'w:' + n); e.setAttributeNS(W, 'w:val', '12'); rpr.appendChild(e); });
      });
    };
    put('officereview', spec.officeReview);
    put('comments', spec.comments);
  }
  return missing;
}
const KNOWN_HEADERS = new Set(['itservice', 'marketingservice', 'printingservice', 'technicalservice', 'furnitureservice', 'logisticsbytheawg',
  'agreedservice', 'marketingmaterials', 'logisticsbythesponsors', 'eventtype']);

// ---------- Expense Approval (underscore lines) ----------
// Each blank "_____" is filled in order. A value can be text, null (leave the blank) or a list of parts (text / {image}).
function fillParagraph(doc, p, values, images, opts = {}) {
  const text = textOf(p);
  const rpr = runProps(p);
  let parts = text.split(/_{3,}/);
  // Lines that get names + signatures need the template's long run of spaces shortened to stay on one line
  if (opts.tight) parts = parts.map(x => x.replace(/ {3,}/g, '   '));
  clearRuns(p);
  parts.forEach((part, i) => {
    if (part) p.appendChild(makeRun(doc, part, rpr));
    if (i < parts.length - 1) {
      const v = values[i];
      if (v == null) { p.appendChild(makeRun(doc, '________________', rpr)); return; }
      (Array.isArray(v) ? v : [v]).forEach(seg => {
        if (seg && seg.image) { const r = images.run(doc, seg.image, 0.42, 2.6); if (r) p.appendChild(r); }
        else if (seg) p.appendChild(makeRun(doc, ' ' + seg + ' ', rpr));
      });
    }
  });
}
function setParagraph(doc, p, text) { const rpr = runProps(p); clearRuns(p); if (text) p.appendChild(makeRun(doc, text, rpr)); }

/* spec = { serial, requestedDate, groupName, requestedBy, advisor:{name,image}, sao:{...}, vp:{...}, amount,
 *          justification, available, requested, remaining, account, analysis, attachments:[4] } */
function fillExpense(doc, spec, images) {
  const sig = s => s ? [s.name, s.image ? { image: s.image } : null] : null;
  let justif = 0, authorized = 0;
  const missing = new Set(['serial', 'date', 'group', 'requestedBy', 'advisor', 'authorized', 'amount', 'justification', 'available', 'requested', 'remaining', 'account', 'analysis']);
  all(doc, 'p').forEach(p => {
    const t = textOf(p).trim();
    const done = k => missing.delete(k);
    if (justif === 1 && /^_{3,}$/.test(t)) { setParagraph(doc, p, spec.justification); justif = 2; done('justification'); return; }
    // second blank justification line is not needed once the text is filled in (keeps the form on one page)
    if (justif === 2 && /^_{3,}$/.test(t)) { p.remove(); justif = 3; return; }
    if (/^Serial:/.test(t)) { setParagraph(doc, p, 'Serial: ' + spec.serial); done('serial'); }
    else if (/^Requested Date:/.test(t)) { fillParagraph(doc, p, [spec.requestedDate], images); done('date'); }
    else if (/^Group Name:/.test(t)) { fillParagraph(doc, p, [spec.groupName], images); done('group'); }
    else if (/^Requested by:/.test(t)) { fillParagraph(doc, p, [spec.requestedBy, spec.repSignature ? [{ image: spec.repSignature }] : null], images); done('requestedBy'); }
    else if (/^Academic Advisor:/.test(t)) { fillParagraph(doc, p, [spec.advisor?.name || null, spec.advisor?.image ? [{ image: spec.advisor.image }] : null], images); done('advisor'); }
    else if (/^Authorized by:/.test(t) && authorized++ === 0) { fillParagraph(doc, p, [sig(spec.sao), sig(spec.vp)], images, { tight: !!(spec.sao || spec.vp) }); done('authorized'); }
    else if (/^Request Amount:/.test(t)) { fillParagraph(doc, p, [spec.amount], images); done('amount'); }
    else if (/^Justification/.test(t)) { justif = 1; }
    // Financial Data is filled in by hand by the Finance Department - only touched when a value is given
    else if (/^Available Balance:/.test(t)) { if (spec.available != null) fillParagraph(doc, p, [spec.available], images); done('available'); }
    else if (/^Requested Amount:/.test(t)) { if (spec.requested != null) fillParagraph(doc, p, [spec.requested], images); done('requested'); }
    else if (/^Remaining Balance:/.test(t)) { if (spec.remaining != null) fillParagraph(doc, p, [spec.remaining], images); done('remaining'); }
    else if (/^Account Number:/.test(t)) { if (spec.account != null) fillParagraph(doc, p, [spec.account], images); done('account'); }
    else if (/^Analysis:/.test(t)) { if (spec.analysis) fillParagraph(doc, p, [String(spec.analysis).replace(/\s*\n\s*/g, '; ')], images); done('analysis'); }
    else if (/^[1-4]:$/.test(t)) { const v = spec.attachments?.[Number(t[0]) - 1]; if (v) setParagraph(doc, p, `${t} ${v}`); }
  });
  // The blank template already reaches the bottom of the page; make the empty last paragraph tiny so it
  // does not spill onto an empty second page.
  const body = all(doc, 'body')[0];
  const lastP = body && kids(body, 'p').pop();
  if (lastP && !textOf(lastP).trim() && !all(lastP, 'drawing').length) {
    let ppr = kids(lastP, 'pPr')[0];
    if (!ppr) { ppr = doc.createElementNS(W, 'w:pPr'); lastP.insertBefore(ppr, lastP.firstChild); }
    all(ppr, 'spacing').forEach(e => e.remove());
    const sp = doc.createElementNS(W, 'w:spacing');
    sp.setAttributeNS(W, 'w:before', '0'); sp.setAttributeNS(W, 'w:after', '0'); sp.setAttributeNS(W, 'w:line', '20'); sp.setAttributeNS(W, 'w:lineRule', 'exact');
    ppr.insertBefore(sp, ppr.firstChild ? [...ppr.childNodes].find(n => n.localName === 'ind' || n.localName === 'jc' || n.localName === 'rPr') || null : null);
  }
  return [...missing];
}

// ---------- Memo template ({{TOKEN}} placeholders) ----------
// values: { NAME: 'text' | { image: dataUrl } | '' }. Text may contain blank lines between paragraphs.
function fillTokens(doc, values, images) {
  const used = new Set();
  all(doc, 'p').forEach(p => {
    const text = textOf(p);
    if (!/\{\{[A-Z_]+\}\}/.test(text)) return;
    const rpr = runProps(p);
    // A placeholder alone in its paragraph with multi-paragraph text (the memo body) becomes real paragraphs,
    // so justified text is not stretched by line breaks.
    const solo = text.trim().match(/^\{\{([A-Z_]+)\}\}$/);
    const val = solo && values[solo[1]];
    if (typeof val === 'string' && /\n\s*\n/.test(val)) {
      used.add(solo[1]);
      const paras = val.replace(/\r/g, '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
      const ppr = kids(p, 'pPr')[0];
      paras.forEach((txt, i) => {
        const np = i === 0 ? p : doc.createElementNS(W, 'w:p');
        if (i === 0) clearRuns(p);
        else if (ppr) np.appendChild(ppr.cloneNode(true));
        // keep the template's space above the first paragraph and below the last; 8pt between paragraphs
        const pp = kids(np, 'pPr')[0];
        if (pp) {
          let sp = kids(pp, 'spacing')[0];
          if (!sp) { sp = doc.createElementNS(W, 'w:spacing'); pp.insertBefore(sp, pp.firstChild); }
          if (i > 0) sp.setAttributeNS(W, 'w:before', '0');
          if (i < paras.length - 1) sp.setAttributeNS(W, 'w:after', '160');
        }
        np.appendChild(makeRun(doc, txt, rpr));
        if (i > 0) { const prev = i === 1 ? p : p.__last; prev.parentNode.insertBefore(np, prev.nextSibling); p.__last = np; }
      });
      return;
    }
    clearRuns(p);
    text.split(/(\{\{[A-Z_]+\}\})/).forEach(part => {
      const m = part.match(/^\{\{([A-Z_]+)\}\}$/);
      if (!m) { if (part) p.appendChild(makeRun(doc, part, rpr)); return; }
      used.add(m[1]);
      const v = values[m[1]];
      if (v && v.image) { const run = images.run(doc, v.image, 1.3, 4.6); if (run) p.appendChild(run); }
      else if (v) p.appendChild(makeRun(doc, String(v).replace(/\r/g, ''), rpr));
    });
  });
  return Object.keys(values).filter(k => !used.has(k));
}

// ---------- entry point ----------
async function fill(templateUrl, kind, spec) {
  if (!window.JSZip) throw new Error('JSZip did not load (needs internet).');
  const res = await fetch(templateUrl);
  if (!res.ok) throw new Error('Template not found: ' + templateUrl);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const images = makeImages(zip);
  const missing = kind === 'expense' ? fillExpense(doc, spec, images) : kind === 'memo' ? fillTokens(doc, spec, images) : fillTable(doc, spec, images);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc));
  await images.save();
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  return { blob, missing };
}
return { fill };
})();
