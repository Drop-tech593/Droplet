const el=id=>document.getElementById(id);
const draft=el('draft'),go=el('go'),lang=el('lang'),state=el('state');
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let session,failed;
function update(){const words=draft.value.trim().split(/\s+/).filter(Boolean).length;el('count').textContent=words+' '+(words===1?'word':'words');el('copy').disabled=el('save').disabled=!words}
draft.oninput=update;update();
if(!Recognition){go.disabled=true;state.textContent='Speech recognition is unavailable here. Try opening Voicepad in Chrome.'}
let liveStartedAt = 0;
let keepListening = false;
let restartTimer;
let sessionStarted = 0;
let shortSessions = 0;
let networkFailures = 0;
function finishListening() {
 clearTimeout(restartTimer);
 restartTimer = null;
 keepListening = false;
 session = null;
 go.disabled = lang.disabled = false;
 go.textContent = '●  Start listening';
 el('live').textContent = '';
 if (!failed) state.textContent = 'Microphone idle';
 window.dispatchEvent(new Event('audio-mode'));
}
function startSpeechSession() {
 if (!keepListening) return;
 const r = new Recognition();
 let networkError = false;
 session = r;
 sessionStarted = Date.now();
 r.lang = lang.value;
 r.continuous = true;
 r.interimResults = true;
 window.dispatchEvent(new Event('audio-mode'));
 r.onstart = () => {
  if (session !== r) return;
  go.disabled = false;
  go.textContent = '■  Stop listening';
  state.textContent = 'Listening…';
 };
 r.onresult=e=>{if(session!==r)return;networkFailures=0;let partial='';for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i];if(result.isFinal){appendTranscriptText(result[0].transcript,(Date.now()-liveStartedAt)/1000);update();window.dispatchEvent(new Event("voice-segment"))}else partial+=result[0].transcript}el('live').textContent=partial};
 r.onerror = event => {
  if (session !== r) return;
  if (event.error === 'no-speech' && keepListening) return;
  if (event.error === 'network' && keepListening) {
   networkError = true;
   networkFailures++;
   if (networkFailures <= 3) {
    state.textContent = 'Speech service disconnected. Reconnecting…';
    return;
   }
  }
  failed = true;
  keepListening = false;
  state.textContent = ({
   'not-allowed': 'Microphone access was denied. Allow microphone access in your browser and try again.',
   'audio-capture': 'No microphone available. Connect one and try again.',
   'network': 'The browser speech service could not reconnect after three retries. Your transcript is kept. Try recording the audio and using the on-device model.'
  })[event.error] || 'Recognition stopped: ' + event.error;
 };
 r.onend = () => {
  if (session !== r) return;
  el('live').textContent = '';
  if (!keepListening) { finishListening(); return; }
  shortSessions = Date.now() - sessionStarted < 3000 ? shortSessions + 1 : 0;
  if (!networkError && shortSessions >= 3) {
   failed = true;
   state.textContent = 'The speech service keeps disconnecting. Start listening to retry.';
   finishListening();
   return;
  }
  const delay = networkError ? 1000 * 2 ** (networkFailures - 1) : 300;
  go.disabled = false;
  go.textContent = '■  Stop listening';
  state.textContent = networkError ? 'Speech service disconnected. Retry '+networkFailures+' of 3 in '+delay/1000+' seconds. Audio during this gap is not captured.' : 'Reconnecting microphone…';
  restartTimer = setTimeout(() => {
   restartTimer = null;
   startSpeechSession();
  }, delay);
 };
 try { r.start(); }
 catch {
  failed = true;
  state.textContent = 'Could not start the microphone. Check browser permissions.';
  finishListening();
 }
}
go.onclick = () => {
 if (session) {
  keepListening = false;
  if (restartTimer) { finishListening(); return; }
  go.disabled = true;
  state.textContent = 'Finishing the last phrase…';
  session.stop();
  return;
 }
 beginTranscript();
 liveStartedAt = Date.now();
 keepListening = true;
 failed = false;
 shortSessions = 0;
 networkFailures = 0;
 lang.disabled = true;
 go.disabled = true;
 state.textContent = 'Waiting for microphone access…';
 startSpeechSession();
};
window.addEventListener('pagehide', () => {
 keepListening = false;
 clearTimeout(restartTimer);
 if (session) session.abort();
});
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(draft.value);el('copy').textContent='Copied';setTimeout(()=>el('copy').textContent='Copy text',1400)}catch{draft.focus();draft.select();state.textContent='Transcript selected. Use your browser’s Copy command.'}};
el('save').onclick=()=>{const url=URL.createObjectURL(new Blob([draft.value],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='voicepad-transcript.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)};
