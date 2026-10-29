const el = id => document.getElementById(id);
function message(text, isError = false) {
  el('status').textContent = text;
  el('status').classList.toggle('error', isError);
}
async function request(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Request failed');
  return result;
}
async function refresh() {
  el('refresh').disabled = true;
  try {
    const result = await request('/api/preview');
    const policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">";
    el('html-preview').srcdoc = policy + result.html;
    el('text-preview').textContent = result.text;
    el('profile-key').textContent = result.key;
    message('PASS · Preview for ' + result.accountName + ', key ' + result.key + '. No files written.');
  } catch (e) { message('Preview failed: ' + e.message, true); }
  finally { el('refresh').disabled = false; }
}
async function generate() {
  el('generate').disabled = true;
  el('downloads').hidden = true;
  message('Generating with real LibreOffice…');
  try {
    const result = await request('/api/generate', { method: 'POST' });
    el('snapshot').textContent = result.snapshot;
    for (const link of el('downloads').querySelectorAll('a[download]')) {
      const extension = link.getAttribute('href').split('/').at(-1);
      link.setAttribute('download', result.key + '.' + extension);
    }
    el('downloads').hidden = false;
    message('PASS · Complete HTML / TXT / RTF snapshot published.');
  } catch (e) { message('Generation failed: ' + e.message, true); }
  finally { el('generate').disabled = false; }
}
el('refresh').addEventListener('click', refresh);
el('generate').addEventListener('click', generate);
void refresh();
