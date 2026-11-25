(() => {
 'use strict';
 const documents=new WeakMap();let unicodeBytes;let fontkitLoad;
 async function unicode(doc){
  if(!window.fontkit){if(!fontkitLoad)fontkitLoad=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/assets/vendor/fontkit-1.1.1.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('The Unicode font reader could not load.'));document.head.append(s);});await fontkitLoad;}
  doc.registerFontkit(window.fontkit);
  if(!unicodeBytes)unicodeBytes=fetch('/assets/fonts/NotoSans-Regular.ttf').then(response=>{if(!response.ok)throw new Error('The Unicode font could not load.');return response.arrayBuffer();});
  return doc.embedFont(await unicodeBytes,{subset:true});
 }
 async function forText(doc,object){
  let cache=documents.get(doc);if(!cache){cache=new Map();documents.set(doc,cache);}
  const bold=object.fontWeight==='bold',italic=object.fontStyle==='italic';const family=object.fontFamily||'';
  const name=/times|georgia|cambria/i.test(family)?bold?(italic?'TimesRomanBoldItalic':'TimesRomanBold'):(italic?'TimesRomanItalic':'TimesRoman'):/courier|mono/i.test(family)?bold?(italic?'CourierBoldOblique':'CourierBold'):(italic?'CourierOblique':'Courier'):bold?(italic?'HelveticaBoldOblique':'HelveticaBold'):(italic?'HelveticaOblique':'Helvetica');
  if(!cache.has(name))cache.set(name,doc.embedFont(PDFLib.StandardFonts[name]));let font=await cache.get(name);
  try{font.encodeText(String(object.text||'').replace(/[\r\n\t]/g,' '));return font;}catch(_){
   if(!cache.has('Unicode'))cache.set('Unicode',unicode(doc));font=await cache.get('Unicode');
   const supported=new Set(font.getCharacterSet());for(const character of String(object.text||''))if(!/\s/.test(character)&&!supported.has(character.codePointAt(0)))throw new Error(`The export font does not contain “${character}”. Choose another character or export this page as PNG.`);
   return font;
  }
 }
 function lines(text,font,size,width){
  const result=[];for(const paragraph of String(text||'').split('\n')){
   if(!paragraph){result.push('');continue;}
   let line='';for(const word of paragraph.split(/\s+/)){
    const next=line?line+' '+word:word;
    if(font.widthOfTextAtSize(next,size)<=width){line=next;continue;}
    if(line){result.push(line);line='';}
    for(const character of word){if(line&&font.widthOfTextAtSize(line+character,size)>width){result.push(line);line='';}line+=character;}
   }
   if(line)result.push(line);
  }return result;
 }
 window.DropletFonts=Object.freeze({forText,lines});
})();
