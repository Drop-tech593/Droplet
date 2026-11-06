const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function word(text){
 if(!window.JSZip)await new Promise((ok,fail)=>{const s=document.createElement('script');s.src='vendor/jszip.min.js';s.onload=ok;s.onerror=fail;document.head.append(s)});
 const zip=new JSZip(),ns='http://schemas.openxmlformats.org/';
 zip.file('[Content_Types].xml','<Types xmlns="'+ns+'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="'+ns+'package/2006/relationships"><Relationship Id="rId1" Type="'+ns+'officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 const escape=t=>t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 zip.file('word/document.xml','<w:document xmlns:w="'+ns+'wordprocessingml/2006/main"><w:body>'+text.split(/\r?\n/).map(t=>'<w:p><w:r><w:t xml:space="preserve">'+escape(t)+'</w:t></w:r></w:p>').join('')+'<w:sectPr/></w:body></w:document>');
 return zip.generateAsync({type:'blob',mimeType:mime,compression:'DEFLATE'});
}
async function pdf(text){
 const {PDFDocument}=await import('./vendor/pdf.mjs'),doc=await PDFDocument.create();
 const canvas=document.createElement('canvas');canvas.width=1240;canvas.height=1754;
 const ctx=canvas.getContext('2d');let y;
 function reset(){ctx.fillStyle='white';ctx.fillRect(0,0,1240,1754);ctx.fillStyle='#152235';ctx.font='25px sans-serif';y=100}
 async function page(){const png=await doc.embedPng(canvas.toDataURL());doc.addPage([595.28,841.89]).drawImage(png,{x:0,y:0,width:595.28,height:841.89});reset()}
 async function line(t){if(y>1650)await page();ctx.fillText(t,85,y);y+=38}
 reset();
 for(const p of text.split(/\r?\n/)){
  let row='';
  for(const token of p.match(/\s+|\S+/gu)||[]){
   if(row&&ctx.measureText(row+token).width>1070){await line(row.trimEnd());row=''}
   if(ctx.measureText(token).width>1070){
    for(const ch of token){if(ctx.measureText(row+ch).width>1070){await line(row);row=''}row+=ch}
   }else row+=token;
  }
  await line(row);
 }
 await page();return new Blob([await doc.save()],{type:'application/pdf'});
}
export async function exportFile(kind,text){
 const blob=kind==='word'?await word(text):await pdf(text);
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='voicepad-transcript.'+(kind==='word'?'docx':'pdf');link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
