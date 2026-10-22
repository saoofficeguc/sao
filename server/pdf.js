// Converts a filled Word form to PDF: LibreOffice if installed (recommended on a server), otherwise Microsoft Word on Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const workDir = path.join(os.tmpdir(), 'sao-portal-pdf');
fs.mkdirSync(workDir, { recursive: true });

function findSoffice() {
  if (process.env.SAO_SOFFICE && fs.existsSync(process.env.SAO_SOFFICE)) return process.env.SAO_SOFFICE;
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
    : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/bin/libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return candidates.find(p => fs.existsSync(p)) || null;
}
const run = (cmd, args) => new Promise((resolve, reject) =>
  execFile(cmd, args, { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout)));

async function convertWithSoffice(soffice, docx) {
  await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', path.dirname(docx), docx]);
  return docx.replace(/\.docx$/i, '.pdf');
}
async function convertWithWord(docx) {
  const pdf = docx.replace(/\.docx$/i, '.pdf');
  // Paths are passed as arguments, never pasted into the script text.
  const script = `
    param($in, $out)
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false; $word.DisplayAlerts = 0
    try { $d = $word.Documents.Open($in, $false, $true, $false); $d.SaveAs([ref]$out, [ref]17); $d.Close([ref]0) }
    finally { $word.Quit() }`;
  const ps1 = path.join(workDir, 'convert.ps1');
  if (!fs.existsSync(ps1)) fs.writeFileSync(ps1, script);
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, docx, pdf]);
  return pdf;
}
let queue = Promise.resolve(); // one conversion at a time
function toPdf(buffer) {
  const job = queue.then(async () => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const docx = path.join(workDir, id + '.docx');
    fs.writeFileSync(docx, buffer);
    try {
      const soffice = findSoffice();
      let pdf;
      if (soffice) pdf = await convertWithSoffice(soffice, docx);
      else if (process.platform === 'win32') pdf = await convertWithWord(docx);
      else throw new Error('No PDF converter found. Install LibreOffice.');
      const out = fs.readFileSync(pdf);
      fs.rmSync(pdf, { force: true });
      return out;
    } finally { fs.rmSync(docx, { force: true }); }
  });
  queue = job.catch(() => {});
  return job;
}
const converterName = () => findSoffice() ? 'LibreOffice' : process.platform === 'win32' ? 'Microsoft Word' : 'not available';

module.exports = { toPdf, converterName };
