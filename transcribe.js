let recognizer,language;
self.onmessage=async ({data})=>{
  try{
    if(data.init){
      const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/dist/transformers.min.js');
      env.allowLocalModels=false;
      env.backends.onnx.wasm.numThreads=1;
      language=data.language;
      recognizer=await pipeline('automatic-speech-recognition','Xenova/whisper-'+data.model,{device:'wasm',dtype:'q8',progress_callback:p=>{
        if(p.status==='progress' && Number.isFinite(p.progress)) self.postMessage({loading:'Downloading '+p.file+' · '+Math.round(p.progress)+'%'});
      }});
      self.postMessage({ready:true});
    }else{
      const result=await recognizer(data.samples,{language,task:'transcribe'});
      self.postMessage({text:result.text});
    }
  }catch(error){self.postMessage({error:error.message});}
};
