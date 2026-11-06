const byId = id => document.getElementById(id);
const picker = byId('recording'), start = byId('runFile'), cancel = byId('stopFile');
const status = byId('fileStatus'), progress = byId('progress');
let active;
const method=byId('method'), hint=byId('methodHint');
const chromeVersion=Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || 0);
const browserSpeech=window.SpeechRecognition || window.webkitSpeechRecognition;
const nativeAvailable=Boolean(browserSpeech && window.AudioContext && chromeVersion>=135 && !/Android/.test(navigator.userAgent));
method.options[1].disabled=!nativeAvailable;
method.value='local';
method.onchange=()=>{hint.textContent=method.value==='browser'
  ? 'Uses your browser’s speech service, which may send audio to its provider. Processes at playback speed. No model download.'
  : 'Audio stays on this device. First use needs internet to download the decoder and speech model.';};
method.dispatchEvent(new Event('change'));

const clock = seconds => new Date(Math.floor(seconds) * 1000).toISOString().slice(11,19);
function finish(job, message) {
  if (!job || active !== job) return;
  active = null;
  job.cleanup?.();
  method.disabled=false;
  job.worker?.terminate();
  job.reject?.(new Error('Cancelled'));
  job.input?.dispose?.();
  picker.disabled = false;
  start.disabled = !picker.files.length;
  cancel.hidden = true;
  status.textContent = message;
}
picker.onchange = () => {
  start.disabled = !picker.files.length;
  progress.hidden = true;
  status.textContent = start.disabled ? 'Choose an audio file.' : 'Ready. Starting transcription replaces the previous transcript.';
};
cancel.onclick = () => finish(active, 'Cancelled. Completed text is still in the editor.');
start.onclick = async () => {
  if (active || session || capturing || !picker.files[0]) return;
  beginTranscript();
  const job = active = {};
  picker.disabled = start.disabled = true;
  cancel.hidden = progress.hidden = false;
  progress.removeAttribute('value');
  status.textContent = 'Opening recording…';
  method.disabled=true;
  try {
    if(method.value==='browser'){
      await transcribeWithBrowser(job,picker.files[0]);
      return;
    }
    const {Input, BlobSource, ALL_FORMATS, AudioBufferSink} = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.30.0/+esm');
    if (active !== job) return;
    const input = job.input = new Input({source:new BlobSource(picker.files[0]), formats:ALL_FORMATS});
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw Error('No audio track found.');
    const duration = await track.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw Error('Could not determine audio duration.');
    if (duration > 9000) throw Error('This recording exceeds two hours 30 minutes. Split it into shorter files.');
    if (!await track.canDecode()) throw Error('This browser cannot decode the file. Try a WAV copy.');
    if (active !== job) return;
    const worker = job.worker = new Worker('transcribe.js',{type:'module'});
    function request(message, transfer=[]) {
      return new Promise((resolve,reject) => {
        job.reject = reject;
        worker.onerror = () => reject(Error('Speech engine could not start. Check your connection and retry.'));
        worker.onmessage = ({data}) => { if(data.loading){status.textContent=data.loading;return;} data.error ? reject(Error(data.error)) : resolve(data); };
        worker.postMessage(message,transfer);
      });
    }
    status.textContent = 'Loading speech model for '+clock(duration)+' of audio…';
    await request({init:true,language:byId('lang').selectedOptions[0].dataset.language,model:document.querySelector('[name=quality]:checked').value});
    const sink = new AudioBufferSink(track);
    const rate = 16000;
    let chunk = new Float32Array(25*rate), used=0, processed=0, hasText=false;
    async function flush() {
      const samples = chunk.subarray(0,used);
      const {text} = await request({samples},[chunk.buffer]);
      if (active !== job) return;
      if (text.trim()) {
        const editor=byId('draft');
        appendTranscriptText(text, processed);
        editor.dispatchEvent(new Event('input'));
        hasText=true;window.dispatchEvent(new Event('voice-segment'));
      }
      processed+=used/rate;
      progress.value=Math.min(processed/duration,1);
      status.textContent='Transcribed '+clock(Math.min(processed,duration))+' of '+clock(duration);
      chunk=new Float32Array(25*rate); used=0;
    }
    status.textContent='Transcribing the first segment…'; progress.value=0;
    let decoded=0, emitted=0;
    for await (const {buffer} of sink.buffers()) {
      if (active !== job) return;
      const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
      const end=decoded+buffer.duration;
      if(end>9000.001) throw Error('Decoded audio exceeds two hours 30 minutes.');
      while(emitted < Math.round(end*rate)){
        const i=Math.min(buffer.length-1,Math.max(0,Math.floor((emitted/rate-decoded)*buffer.sampleRate)));
        let sum=0;
        for(const channel of channels) sum+=channel[i];
        chunk[used++]=sum/channels.length; emitted++;
        if(used===chunk.length) await flush();
      }
      decoded=end;
    }
    if(used) await flush();
    progress.value=1;
    finish(job,hasText?'Complete. Your transcript is ready below.':'Complete. No speech was recognised.');
  } catch(error) {
    if(active===job){progress.hidden=true;finish(job,'Transcription stopped. '+error.message+(nativeAvailable ? ' You can switch transcription methods and retry.' : '')+' Completed text is kept.');}
  }
};

async function transcribeWithBrowser(job,file){
  const audio=new Audio();
  const context=new AudioContext();
  const source=context.createMediaElementSource(audio);
  const destination=context.createMediaStreamDestination();
  source.connect(destination);
  const track=destination.stream.getAudioTracks()[0];
  const recognition=new browserSpeech();
  const url=URL.createObjectURL(file);
  let words=0, timer, duration;
  function armTimeout(message){
    clearTimeout(timer);
    timer=setTimeout(()=>fail(message),20000);
  }
  function fail(reason){
    if(active!==job)return;
    progress.hidden=true;
    finish(job,reason+' Completed text is kept. Try the on-device model if needed.');
  }
  job.cleanup=()=>{
    clearTimeout(timer);
    recognition.onend=recognition.onresult=recognition.onerror=recognition.onstart=null;
    audio.onloadedmetadata=audio.onerror=audio.ontimeupdate=audio.onended=null;
    audio.pause(); recognition.abort(); track.stop(); source.disconnect();
    context.close().catch(()=>{}); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
  };
  // A suspended context must be resumed while the button gesture is still active.
  const resumed=context.resume();
  recognition.continuous=true;
  recognition.lang=byId('lang').value;
  recognition.onresult=event=>{
    if(active!==job)return;
    for(let i=event.resultIndex;i<event.results.length;i++){
      const result=event.results[i], text=result[0].transcript.trim();
      if(!result.isFinal || !text)continue;
      const editor=byId('draft');
      appendTranscriptText(text, audio.currentTime);
      editor.dispatchEvent(new Event('input')); words++;window.dispatchEvent(new Event('voice-segment'));
    }
  };
  recognition.onerror=e=>{
    if(e.error!=='no-speech')fail('Browser speech service reported '+e.error+'.');
  };
  function listen(){
    try{armTimeout('The browser speech service did not respond.');recognition.start(track);}
    catch(e){fail(e.message);}
  }
  recognition.onstart=()=>{
    clearTimeout(timer);
    audio.play().catch(e=>fail(e.message));
  };
  recognition.onend=()=>{
    if(active!==job)return;
    if(audio.ended){
      progress.value=1;
      finish(job,words?'Complete. Your transcript is ready below.':'Complete. No speech was recognised.');
    }else{audio.pause();listen();}
  };
  audio.onloadedmetadata=()=>{
    duration=Number.isFinite(audio.duration)?audio.duration:recordedDurations.get(file);
    if(!Number.isFinite(duration)||duration<=0)return fail('Could not read recording duration.');
    if(duration>9000)return fail('This recording exceeds the two-hour-30-minute limit.');
    status.textContent='Connecting to the browser speech service…';listen();
  };
  audio.ontimeupdate=()=>{
    if(active!==job||!Number.isFinite(duration))return;
    progress.value=Math.min(1,audio.currentTime/duration);
    status.textContent='Processing '+clock(audio.currentTime)+' of '+clock(duration);
  };
  audio.onended=()=>{armTimeout('The speech service did not return its final result.');recognition.stop();};
  audio.onerror=()=>fail('The browser could not play this recording.');
  armTimeout('Could not open this recording.');
  audio.preload='auto';audio.src=url;
  await resumed;
}
