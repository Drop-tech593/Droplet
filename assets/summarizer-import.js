/* Import document text locally before the user chooses a summary. */
(() => {
  'use strict';
  const picker = document.getElementById('fileInput');
  const button = document.getElementById('import-file');
  const status = document.getElementById('import-status');
  const text = document.getElementById('inputText');
  const controls = [picker, button, text, document.getElementById('summarizeBtn'), document.getElementById('clearBtn')];
  let importing = false;
  button.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file || importing) return;
    const pdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const plain = /\.txt$/i.test(file.name) || file.type === 'text/plain';
    if (!pdf && !plain) { status.textContent = 'Choose a TXT or PDF file.'; return; }
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'Choose a file up to 10 MB.'; return; }
    importing = true;
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    let pdfDocument;
    try {
      status.textContent = `Reading ${file.name} on this device…`;
      let imported;
      if (pdf) {
        if (!window.pdfjsLib) throw new Error('The PDF reader could not load. Refresh the page and try again.');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/c0a5848ab2-pdf.worker.min.js';
        pdfDocument = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages = [];
        for (let number = 1; number <= pdfDocument.numPages; number++) {
          status.textContent = `Reading ${file.name}: page ${number} of ${pdfDocument.numPages}…`;
          const page = await pdfDocument.getPage(number);
          const content = await page.getTextContent();
          pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim());
          page.cleanup();
        }
        imported = pages.join('\n\n');
        if (!imported.trim()) throw new Error('This PDF has no selectable text. Use PDF to TXT with OCR, then import the TXT file here.');
      } else imported = await file.text();
      text.value = imported.replace(/^\uFEFF/, '');
      text.dispatchEvent(new Event('input', { bubbles: true }));
      status.textContent = `Imported ${file.name}. Review the text, then choose Summarize.`;
    } catch (error) {
      status.textContent = `Could not import ${file.name}. ${error.message || 'Try another TXT or PDF file.'}`;
    } finally {
      if (pdfDocument) await pdfDocument.destroy().catch(() => {});
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      importing = false;
    }
  });
  document.getElementById('clearBtn').addEventListener('click', () => { picker.value = ''; status.textContent = ''; });
})();
