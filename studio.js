const locales='en-ZA en-US en-GB af-ZA ar-SA bg-BG ca-ES zh-CN zh-TW hr-HR cs-CZ da-DK nl-NL et-EE fi-FI fr-FR de-DE el-GR he-IL hi-IN hu-HU id-ID it-IT ja-JP ko-KR lv-LV lt-LT ms-MY no-NO fa-IR pl-PL pt-BR pt-PT ro-RO ru-RU sk-SK sl-SI es-ES es-MX sw-KE sv-SE ta-IN te-IN th-TH tr-TR uk-UA ur-PK vi-VN'.split(' ');
const names=new Intl.DisplayNames(['en'],{type:'language'});
const regions=new Intl.DisplayNames(['en'],{type:'region'});
for(const code of locales){
  const [language,region]=code.split('-');
  const option=new Option(names.of(language)+' ('+regions.of(region)+')',code);
  option.dataset.language=language;
  lang.add(option);
}
const guide=el('guide');
el('guideOpen').onclick=()=>guide.showModal();
const recordedDurations=new WeakMap();
const pickerUI=el('recording'), zone=el('uploadZone');
function selectFile(file){
  if(!file||pickerUI.disabled||session)return;
  const transfer=new DataTransfer();transfer.items.add(file);pickerUI.files=transfer.files;
  pickerUI.dispatchEvent(new Event('change'));
}
zone.onclick=e=>{if(e.target!==pickerUI)pickerUI.click()};
zone.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();pickerUI.click()}};
zone.ondragover=e=>{e.preventDefault();zone.classList.add('over')};
zone.ondragleave=()=>zone.classList.remove('over');
zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');selectFile(e.dataTransfer.files[0])};
let duration=0,segments=0,startTime=0,timeHandle=0,metadataURL='';
function fmt(t){return Number.isFinite(t)?Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0'):'—'}
pickerUI.addEventListener('change',()=>{
 const file=pickerUI.files[0];if(!file)return;
 el('selectedAudioCard').classList.add('show');el('selectedAudioName').textContent=file.name;
 el('selectedAudioMeta').textContent=(file.size/1048576).toFixed(2)+' MB';duration=0;
 el('statDuration').textContent=el('timerDisplay').textContent='—';
 URL.revokeObjectURL(metadataURL);const url=metadataURL=URL.createObjectURL(file);
 const audio=new Audio();audio.preload='metadata';audio.onloadedmetadata=()=>{
   if(url!==metadataURL)return;duration=Number.isFinite(audio.duration)?audio.duration:recordedDurations.get(file)||0;
   el('statDuration').textContent=el('timerDisplay').textContent=duration?fmt(duration):'—';
 };audio.src=url;
});
let recorder,recordTimer,capturing=false;
function syncAudioControls(){
 const processing=pickerUI.disabled;
 el('recordBtn').disabled=processing||!!session||capturing;
 el('runFile').disabled=processing||!!session||capturing||!pickerUI.files.length;
 if(!session)go.disabled=!Recognition||processing||capturing;
 lang.disabled=processing||!!session;
 for(const radio of document.querySelectorAll('[name=quality]'))radio.disabled=processing||el('method').value!=='local';
 zone.inert=processing||capturing||!!session;
}
el('method').addEventListener('change',syncAudioControls);
window.addEventListener('audio-mode',syncAudioControls);
el('recordBtn').onclick=async()=>{
 const btn=el('recordBtn');capturing=true;syncAudioControls();let stream;
 try{
  if(pickerUI.disabled)throw Error('Finish or cancel the current transcription first.');
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  recorder=new MediaRecorder(stream);const parts=[];const began=performance.now();
  recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
  recorder.onstop=()=>{clearTimeout(recordTimer);stream.getTracks().forEach(t=>t.stop());
   const type=recorder.mimeType;const file=new File(parts,['Recording.',type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm'].join(''),{type});recordedDurations.set(file,Math.min(9000,(performance.now()-began)/1000));capturing=false;selectFile(file);
   btn.classList.remove('hidden');el('stopBtn').classList.add('hidden');syncAudioControls();
  };
  recorder.start(1000);btn.classList.add('hidden');el('stopBtn').classList.remove('hidden');
  el('fileStatus').textContent='Recording. Press Stop Recording when finished.';
  recordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},9000000);
 }catch(e){capturing=false;stream?.getTracks().forEach(t=>t.stop());syncAudioControls();el('fileStatus').textContent=e.message}
};
el('stopBtn').onclick=()=>{if(recorder?.state==='recording')recorder.stop()};
let saveTimer;
function saveDraft(){
 clearTimeout(saveTimer);
 try{localStorage.setItem('voicepad.draft',draft.value);el('saveStateText').textContent='Saved in this browser'}catch{el('saveStateText').textContent='Browser storage unavailable'}
}
function refreshStats(){
 const words=el('count').textContent.split(' ')[0];
 el('statWords').textContent=words;el('statChars').textContent=draft.value.length.toLocaleString();
 for(const b of document.querySelectorAll('[data-action]:not([data-action=back])'))b.disabled=!draft.value.trim();
 clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,600);
}
try{draft.value=localStorage.getItem('voicepad.draft')||''}catch{}
window.addEventListener('pagehide',saveDraft);
draft.addEventListener('input',refreshStats);update();refreshStats();
window.addEventListener('voice-segment',()=>{segments++;requestAnimationFrame(()=>{el('statSegments').textContent=segments;refreshStats()})});
function renderProgress(){
 const p=el('progress'),ratio=p.hidden?0:p.value,elapsed=(Date.now()-startTime)/1000;
 el('progressPercentBadge').textContent=Math.round(ratio*100)+'%';
 el('statProcessed').textContent=fmt(duration*ratio);el('statElapsed').textContent=fmt(elapsed);
 el('statRemaining').textContent=ratio>0?fmt(elapsed*(1-ratio)/ratio):'—';
 el('statChunks').textContent=el('method').value==='local'&&duration?Math.ceil(duration*ratio/25)+' / '+Math.ceil(duration/25):'—';
}
new MutationObserver(()=>{
 const busy=pickerUI.disabled;
 el('statusBadge').textContent=busy?'Processing':'Ready';
 if(busy&&!timeHandle){startTime=Date.now();timeHandle=setInterval(renderProgress,500)}
 if(!busy&&timeHandle){clearInterval(timeHandle);timeHandle=0;renderProgress()}
 syncAudioControls();
}).observe(pickerUI,{attributes:true,attributeFilter:['disabled']});
el('deviceSummary').textContent=[navigator.hardwareConcurrency&&navigator.hardwareConcurrency+' CPU threads',navigator.deviceMemory&&navigator.deviceMemory+' GB device memory'].filter(Boolean).join(' · ')||'Device details unavailable';
for(const r of document.querySelectorAll('[name=quality]'))r.onchange=()=>el('qualityWarning').classList.toggle('show',r.value==='small');
el('theme-toggle').onclick=()=>{document.documentElement.classList.toggle('dark')};
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
 const action=b.dataset.action;
 if(action==='clear'){if(confirm('Clear the transcript saved in this browser?')){draft.value='';segments=0;el('statSegments').textContent=0;draft.dispatchEvent(new Event('input'))}return}
 if(action==='back'){location.href='https://dropletweb.xyz/';return}
 if(b.id!==action){el(action)?.click();return}
 if(action==='pdf'||action==='word'){
  try{const {exportFile}=await import('./exports.js');await exportFile(action,draft.value)}
  catch(err){el('saveStateText').textContent='Download failed. '+err.message}
 }
});

function setTranscriptEditing(editing) {
 draft.readOnly = !editing;
 el('editTranscript').textContent = editing ? '✓ Done' : '✎ Edit';
 el('editTranscript').setAttribute('aria-pressed', String(editing));
 if (editing) draft.focus();
}
el('editTranscript').onclick = () => setTranscriptEditing(draft.readOnly);
function beginTranscript() {
 setTranscriptEditing(false);
 draft.value = '';
 el('live').textContent = '';
 segments = 0;
 el('statSegments').textContent = '0';
 draft.dispatchEvent(new Event('input'));
 saveDraft();
}

el('formatParagraphs').onclick = () => {
 draft.value = formatTranscriptParagraphs(draft.value);
 draft.dispatchEvent(new Event('input'));
 saveDraft();
};
