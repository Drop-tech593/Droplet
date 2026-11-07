// Timestamps describe sections, never individual recognition callbacks.
function transcriptTimestamp(seconds) {
 const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
 const parts = [Math.floor(total % 3600 / 60), total % 60].map(n => String(n).padStart(2, '0'));
 if (total >= 3600) parts.unshift(String(Math.floor(total / 3600)).padStart(2, '0'));
 return '[' + parts.join(':') + ']';
}
function transcriptSentences(text) {
 const clean = text.replace(/\s+/gu, ' ').trim();
 let segmenter;
 try { segmenter = new Intl.Segmenter(document.getElementById('lang').value || 'en', {granularity:'sentence'}); } catch {}
 return segmenter ? Array.from(segmenter.segment(clean), x => x.segment.trim()).filter(Boolean)
  : (clean.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) || []).map(x => x.trim());
}
// Keep raw callbacks separately from presentation, so reformatting never loses
// the timing of a question merely because earlier text shared its paragraph.
let transcriptFragments = [], lastFormattedTranscript = '';
function parseTranscriptFragments(text) {
 const pattern = /\[(\d{2,}:)?(\d{2}):(\d{2})\]\s*/g;
 const matches = Array.from(text.matchAll(pattern));
 if (!matches.length) return text.trim() ? [{time:null, text:text.trim()}] : [];
 const fragments = [];
 if (text.slice(0,matches[0].index).trim()) fragments.push({time:null,text:text.slice(0,matches[0].index).trim()});
 matches.forEach((m,i) => {
  const words=text.slice(m.index+m[0].length,matches[i+1]?.index ?? text.length).trim();
  if(words) fragments.push({time:Number((m[1]||'0').replace(':',''))*3600+Number(m[2])*60+Number(m[3]),text:words});
 });
 return fragments;
}
function renderTranscriptFragments(fragments) {
 let joined='', spans=[];
 for(const f of fragments){
  const words=f.text.replace(/\s+/gu,' ').trim();
  if(!words) continue;
  if(joined) joined+=' ';
  spans.push({start:joined.length,end:joined.length+words.length,time:f.time});
  joined+=words;
 }
 let offset=0, blocks=[], previousQuestion=false, previousShort=false;
 for(const sentence of transcriptSentences(joined)) {
  const start=joined.indexOf(sentence,offset);
  offset=start+sentence.length;
  const span=spans.find(s=>start>=s.start && start<s.end);
  const question=/[?？؟]["'”’)]*$/u.test(sentence);
  const count=sentence.split(/\s+/u).length;
  const short=count<=8;
  const last=blocks.at(-1);
  // Questions and the first answer stand apart. Consecutive brief replies
  // remain separate, while sustained explanations form readable paragraphs.
  const separate=!last || question || previousQuestion ||
   (previousShort && short) || last.words>=100 || last.sentences>=5;
  if(separate) blocks.push({time:span?.time ?? null,text:sentence,words:count,sentences:1});
  else {last.text+=' '+sentence;last.words+=count;last.sentences++;}
  previousQuestion=question;previousShort=short;
 }
 return blocks.map(b=>(b.time===null?'':transcriptTimestamp(b.time)+'\n')+b.text).join('\n\n');
}
function formatTranscriptParagraphs(text) {
 const fragments=text===lastFormattedTranscript ? transcriptFragments : parseTranscriptFragments(text);
 transcriptFragments=fragments;
 lastFormattedTranscript=renderTranscriptFragments(fragments);
 return lastFormattedTranscript;
}
function appendTranscriptText(text, seconds) {
 if(!text.trim()) return;
 const editor=document.getElementById('draft');
 if(editor.value!==lastFormattedTranscript) transcriptFragments=parseTranscriptFragments(editor.value);
 // A cleared editor always starts a new recording, even when the previous
 // session was empty or ended before a final result.
 if(!editor.value.trim()) transcriptFragments=[];
 transcriptFragments.push({time:Number.isFinite(seconds)?Math.max(0,seconds):null,text});
 lastFormattedTranscript=renderTranscriptFragments(transcriptFragments);
 editor.value=lastFormattedTranscript;
}
