/* Render generated documents in an isolated white document, never off-screen tool UI. */
(() => {
 'use strict';
 const loading=new Map();
 function script(src){if(!loading.has(src))loading.set(src,new Promise((resolve,reject)=>{const element=document.createElement('script');element.src=src;element.onload=resolve;element.onerror=()=>reject(new Error('The PDF export library could not load. Refresh and retry.'));document.head.append(element);}));return loading.get(src);}
 async function libraries(){if(!window.PDFLib)await script('/assets/vendor/13891e810b-pdf-lib.min.js');}
 const unitScale=unit=>unit==='mm'?72/25.4:unit==='cm'?72/2.54:unit==='px'?0.75:1;
 function settings(options={}){
  const opts=options.jsPDF||{},factor=unitScale(opts.unit||'mm');
  const formats={a4:[595.276,841.89],letter:[612,792],legal:[612,1008],a3:[841.89,1190.55],a5:[419.53,595.276]};
  let size=Array.isArray(opts.format)?opts.format.map(number=>number*factor):(formats[String(opts.format||'a4').toLowerCase()]||formats.a4).slice();
  if(opts.orientation==='landscape'&&size[0]<size[1])size.reverse();
  if(opts.orientation==='portrait'&&size[0]>size[1])size.reverse();
  let margins=options.margin??0;if(!Array.isArray(margins))margins=[margins,margins,margins,margins];
  if(margins.length===2)margins=[margins[0],margins[1],margins[0],margins[1]];
  margins=margins.map(value=>Math.max(0,Number(value)||0)*factor);
  return {size,margins,quality:Math.max(.5,Math.min(1,options.image?.quality||.94))};
 }
 async function imageElement(src){const image=new Image();image.src=src;await image.decode().catch(()=>{throw new Error('An image in the document could not be read. Embed the image in your file and retry.');});return image;}
 async function imagePages(sources,options={}){
  await libraries();const {size,margins,quality}=settings(options);const output=await PDFLib.PDFDocument.create();
  for(const src of sources){
   const image=await imageElement(src);const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
   const jpeg=await output.embedJpg(canvas.toDataURL('image/jpeg',quality));const page=output.addPage(size);
   const width=Math.max(1,size[0]-margins[1]-margins[3]),height=Math.max(1,size[1]-margins[0]-margins[2]);
   const ratio=Math.min(width/jpeg.width,height/jpeg.height);const w=jpeg.width*ratio,h=jpeg.height*ratio;
   page.drawImage(jpeg,{x:margins[3]+(width-w)/2,y:margins[2]+(height-h)/2,width:w,height:h});canvas.width=canvas.height=1;
  }
  return new Blob([await output.save()],{type:'application/pdf'});
 }
 function sanitized(markup){
  const parsed=new DOMParser().parseFromString(markup,'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,base,link[rel=stylesheet],meta[http-equiv]').forEach(node=>node.remove());
  parsed.querySelectorAll('*').forEach(node=>{
   for(const attribute of Array.from(node.attributes))if(/^on/i.test(attribute.name))node.removeAttribute(attribute.name);
   for(const name of ['src','srcset','poster'])if(node.hasAttribute(name)&&!/^data:|^blob:/i.test(node.getAttribute(name)))node.removeAttribute(name);
   if(node.hasAttribute('style'))node.setAttribute('style',node.getAttribute('style').replace(/url\([^)]*\)/gi,''));
  });
  parsed.querySelectorAll('style').forEach(style=>{style.textContent=style.textContent.replace(/@import[^;]+;/gi,'').replace(/url\([^)]*\)/gi,'');});
  return parsed;
 }
 async function htmlPDF(markup,options={}){
  await libraries();const parsed=sanitized(markup);const probe=parsed.body.cloneNode(true);probe.querySelectorAll('style').forEach(node=>node.remove());
  const images=Array.from(parsed.body.querySelectorAll('img'));
  if(images.length&&!(probe.textContent||'').trim())return imagePages(images.map(image=>image.getAttribute('src')).filter(Boolean),options);
  const {size,margins,quality}=settings(options);const width=size[0]-margins[1]-margins[3],height=size[1]-margins[0]-margins[2];
  if(width<=0||height<=0)throw new Error('Margins leave no space for the document. Choose smaller margins.');
  const cssWidth=width*96/72,cssHeight=height*96/72;
  const frame=document.createElement('iframe');frame.title='Preparing your PDF';frame.setAttribute('aria-hidden','true');frame.sandbox='allow-same-origin';
  Object.assign(frame.style,{position:'fixed',left:'0',top:'0',width:cssWidth+'px',height:cssHeight+'px',border:'0',zIndex:'-2147483647',pointerEvents:'none'});
  const reset=`*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;background:#fff!important;color:#111827!important;width:${cssWidth}px!important;min-height:0!important;height:auto!important;overflow:visible!important}body{display:flow-root!important;font-family:Arial,Helvetica,sans-serif}img,svg{max-width:100%}img{object-fit:contain}table{max-width:100%;border-collapse:collapse}iframe,script{display:none}`;
  const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=()=>reject(new Error('The document could not be prepared.'));});
  frame.srcdoc='<!doctype html><html><head><meta charset="utf-8">'+parsed.head.innerHTML+'<style>'+reset+'</style></head><body>'+parsed.body.innerHTML+'</body></html>';
  document.body.append(frame);
  try{
   await loaded;
   const doc=frame.contentDocument;
   await doc.fonts.ready;await Promise.all(Array.from(doc.images).map(image=>image.decode().catch(()=>{throw new Error('A document image could not be read.');})));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const fixedPages=Number.isInteger(options.fixedPages)&&options.fixedPages>0?options.fixedPages:0;
   const totalHeight=fixedPages?fixedPages*cssHeight:Math.ceil(Math.max(1,doc.body.scrollHeight,doc.body.getBoundingClientRect().height));
   if(totalHeight>2000000)throw new Error('This document is too long for one conversion. Split it into smaller sections.');
   const forcedBreaks=Array.from(doc.body.querySelectorAll('*')).filter(element=>['always','page'].includes(doc.defaultView.getComputedStyle(element).pageBreakAfter)).map(element=>element.getBoundingClientRect().bottom).filter(value=>value>1&&value<totalHeight-5);
   const boundaries=[];const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode())){
    if(!node.textContent.trim()||node.parentElement.closest('style,script'))continue;
    const range=doc.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())boundaries.push(rect.bottom);
   }
   doc.querySelectorAll('tr,img,h1,h2,h3').forEach(element=>boundaries.push(element.getBoundingClientRect().bottom));
   boundaries.sort((a,b)=>a-b);
   const output=await PDFLib.PDFDocument.create();
   for(let top=0;top<totalHeight-1;){
    let bottom=Math.min(totalHeight,top+cssHeight);
    const forced=!fixedPages&&forcedBreaks.find(value=>value>top+2&&value<=bottom+2);if(forced)bottom=forced;
    if(!fixedPages&&bottom<totalHeight&&!forced){const candidates=boundaries.filter(value=>value>top+cssHeight*.65&&value<=bottom-2);if(candidates.length)bottom=candidates[candidates.length-1]+1;}
    const serialized=new XMLSerializer().serializeToString(doc.documentElement);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+cssWidth+'" height="'+Math.ceil(bottom-top)+'"><foreignObject x="0" y="'+(-top)+'" width="'+cssWidth+'" height="'+totalHeight+'">'+serialized+'</foreignObject></svg>';
    const rendered=await imageElement('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));
    const canvas=document.createElement('canvas');const scale=Math.min(2,options.html2canvas?.scale||2);canvas.width=Math.ceil(cssWidth*scale);canvas.height=Math.ceil((bottom-top)*scale);
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(rendered,0,0,canvas.width,canvas.height);
    const image=await output.embedJpg(canvas.toDataURL('image/jpeg',quality));const page=output.addPage(size);
    const drawnHeight=(bottom-top)*72/96;
    page.drawImage(image,{x:margins[3],y:size[1]-margins[0]-drawnHeight,width,height:drawnHeight});
    canvas.width=canvas.height=1;top=bottom;
   }
   return new Blob([await output.save()],{type:'application/pdf'});
  }finally{frame.remove();}
 }
 function html2pdf(){
  let options={},markup='';
  const api={set(value){options={...options,...value};return api;},from(element){if(typeof element==='string')markup=element;else{const copy=element.cloneNode(true);for(const property of ['position','left','top','right','bottom','transform','height','min-height'])copy.style.removeProperty(property);copy.style.width='100%';copy.style.maxWidth='100%';markup=copy.outerHTML;}return api;},async outputPdf(type){const blob=await htmlPDF(markup,options);if(type==='blob')return blob;if(type==='arraybuffer')return blob.arrayBuffer();throw new Error('Unsupported PDF output format.');},async save(name){const blob=await htmlPDF(markup,options);const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name||options.filename||'droplet.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return api;}};
  return api;
 }
 window.DropletPDF=Object.freeze({html:htmlPDF,images:imagePages});
 window.html2pdf=html2pdf;
})();
