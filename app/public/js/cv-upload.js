/* CALIBR — client-side CV / document upload.
   Progressive enhancement: adds a file picker + drag-drop to CV / job-ad textareas and
   extracts the TEXT in the browser (PDF via pdf.js, DOCX via JSZip, TXT/MD/CSV natively),
   then drops it into the existing textarea. No server dependency, no file ever stored —
   the app keeps working exactly as before for anyone who prefers to paste.
   PDF/DOCX parsing needs the CDN libs below; if they can't load, we fall back to "paste". */
(function () {
  'use strict';
  if (window.__calibrCvUpload) return; window.__calibrCvUpload = true;

  var PDF_JS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
  var PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
  var JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  // ---- loaders (cached) ----
  var _pdf, _zip;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function pdfLib() {
    if (_pdf) return _pdf;
    _pdf = import(PDF_JS).then(function (m) { m.GlobalWorkerOptions.workerSrc = PDF_WORKER; return m; });
    return _pdf;
  }
  function zipLib() {
    if (_zip) return _zip;
    _zip = loadScript(JSZIP).then(function () { return window.JSZip; });
    return _zip;
  }

  // ---- extractors ----
  function readAsText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result || '')); };
      r.onerror = function () { rej(new Error('read failed')); };
      r.readAsText(file);
    });
  }
  async function readPdf(file) {
    var pdfjs = await pdfLib();
    var buf = await file.arrayBuffer();
    var doc = await pdfjs.getDocument({ data: buf }).promise;
    var out = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      out.push(tc.items.map(function (i) { return i.str; }).join(' '));
    }
    return out.join('\n\n');
  }
  async function readDocx(file) {
    var JSZip = await zipLib();
    var zip = await JSZip.loadAsync(await file.arrayBuffer());
    var f = zip.file('word/document.xml');
    if (!f) throw new Error('not a docx');
    var xml = await f.async('string');
    return xml
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function extract(file) {
    var n = (file.name || '').toLowerCase();
    if (n.endsWith('.pdf') || file.type === 'application/pdf') return readPdf(file);
    if (n.endsWith('.docx')) return readDocx(file);
    if (/\.(txt|md|markdown|csv|tsv|rtf|text|json)$/.test(n) || (file.type || '').indexOf('text') === 0) return readAsText(file);
    if (n.endsWith('.doc')) return Promise.reject(new Error('Old .doc format — please save as PDF or .docx, or paste the text.'));
    return readAsText(file); // last-ditch: try as text
  }

  // ---- UI ----
  function labelFor(name) {
    if (name === 'blob') return 'Upload CV files — PDF, DOCX or TXT (you can pick several)';
    if (name === 'jd' || name === 'description') return 'Upload the job ad — PDF, DOCX or TXT';
    return 'Upload your CV — PDF, DOCX or TXT';
  }
  function mount(ta) {
    if (ta.__cvUp) return; ta.__cvUp = true;
    var multi = ta.name === 'blob';
    var box = document.createElement('div');
    box.className = 'cvup';
    box.innerHTML =
      '<label class="cvup-btn"><span class="cvup-ico">&#8682;</span> ' + labelFor(ta.name) +
      '<input type="file" accept=".pdf,.docx,.txt,.md,.csv,.rtf,.json' + (ta.name === 'cv' || multi ? ',.doc' : '') + '"' + (multi ? ' multiple' : '') + ' hidden></label>' +
      '<span class="cvup-msg"></span>';
    var input = box.querySelector('input');
    var msg = box.querySelector('.cvup-msg');
    ta.parentNode.insertBefore(box, ta);

    function setMsg(t, kind) { msg.textContent = t; msg.className = 'cvup-msg' + (kind ? ' ' + kind : ''); }

    async function handle(files) {
      files = Array.prototype.slice.call(files || []);
      if (!files.length) return;
      setMsg('Reading ' + files.map(function (f) { return f.name; }).join(', ') + '…', 'busy');
      var texts = [], failed = [];
      for (var i = 0; i < files.length; i++) {
        try {
          var t = (await extract(files[i]) || '').trim();
          if (t) texts.push(t); else failed.push(files[i].name + ' (empty)');
        } catch (e) { failed.push(files[i].name + ' — ' + (e && e.message || 'could not read')); }
      }
      if (texts.length) {
        var joined = texts.join('\n\n---\n\n');
        if (multi && ta.value.trim()) ta.value = ta.value.trim() + '\n\n---\n\n' + joined;
        else ta.value = joined;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        var chars = ta.value.length;
        setMsg('✓ Loaded ' + texts.length + ' file' + (texts.length > 1 ? 's' : '') + ' (' + chars.toLocaleString() + ' chars). Review below, then submit.' + (failed.length ? ' Skipped: ' + failed.join('; ') : ''), 'ok');
      } else {
        setMsg('Couldn’t read ' + (failed.join('; ') || 'the file') + '. Please paste the text instead.', 'err');
      }
    }

    input.addEventListener('change', function () { handle(input.files); input.value = ''; });

    // drag & drop onto the textarea
    ['dragenter', 'dragover'].forEach(function (ev) {
      ta.addEventListener(ev, function (e) { e.preventDefault(); ta.classList.add('cvup-drop'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      ta.addEventListener(ev, function (e) { e.preventDefault(); ta.classList.remove('cvup-drop'); });
    });
    ta.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handle(e.dataTransfer.files);
    });
  }

  function scan() {
    var sel = 'textarea[name="cv"], textarea[name="blob"], textarea[name="jd"], textarea[name="description"]';
    document.querySelectorAll(sel).forEach(mount);
  }

  // minimal styles (brand: pink accent, no new CSS file needed)
  var css = document.createElement('style');
  css.textContent =
    '.cvup{margin:0 0 10px;display:flex;flex-wrap:wrap;align-items:center;gap:10px}' +
    '.cvup-btn{display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:1.5px solid #FF1F70;color:#FF1F70;' +
    'font-weight:700;font-size:13px;padding:8px 14px;border-radius:8px;background:transparent;transition:.15s}' +
    '.cvup-btn:hover{background:#FF1F70;color:#fff}' +
    '.cvup-ico{font-size:15px;line-height:1}' +
    '.cvup-msg{font-size:12.5px;line-height:1.35}' +
    '.cvup-msg.busy{color:#FF1F70}.cvup-msg.ok{color:#0a8a3f;font-weight:600}.cvup-msg.err{color:#FF1F70;font-weight:600}' +
    'textarea.cvup-drop{outline:2px dashed #FF1F70;outline-offset:2px}';
  (document.head || document.documentElement).appendChild(css);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
