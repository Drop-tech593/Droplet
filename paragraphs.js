// Group sentences without changing the recognised words or punctuation.
function formatTranscriptParagraphs(text) {
 const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(document.getElementById('lang').value || 'en', {granularity:'sentence'})
  : null;
 return text.split(/\n/).map(block => {
  const timestamp = block.match(/^\[\d{2}:\d{2}(?::\d{2})?\]\s*/)?.[0] || '';
  if (timestamp) block = block.slice(timestamp.length);
  const sentences = segmenter
   ? Array.from(segmenter.segment(block), item => item.segment.trim()).filter(Boolean)
   : (block.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) || []).map(item => item.trim());
  return sentences.map(sentence => timestamp + sentence).join('\n');
 }).join('\n');
}

function transcriptTimestamp(seconds) {
 const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
 const hours = Math.floor(total / 3600);
 const minutes = Math.floor((total % 3600) / 60);
 const parts = [minutes, total % 60].map(value => String(value).padStart(2, '0'));
 if (hours) parts.unshift(String(hours).padStart(2, '0'));
 return '[' + parts.join(':') + ']';
}
function appendTranscriptText(text, seconds) {
 const editor = document.getElementById('draft');
 if (!text.trim()) return;
 const formatted = formatTranscriptParagraphs(text);
 const timestamp = transcriptTimestamp(seconds);
 const lines = formatted.split('\n').map(line => timestamp + ' ' + line).join('\n');
 editor.value += (editor.value.trim() ? '\n' : '') + lines;
}
