/* Read the stored composite in ordinary 8-bit RGB/gray PSDs, including files with no layer records. */
(() => {
 'use strict';
 window.DropletPSDComposite=function(buffer){
  const view=new DataView(buffer);if(view.byteLength<38||view.getUint32(0)!==0x38425053||view.getUint16(4)!==1)return null;
  const channels=view.getUint16(12),height=view.getUint32(14),width=view.getUint32(18),depth=view.getUint16(22),mode=view.getUint16(24);
  if(depth!==8||![1,3].includes(mode)||channels<(mode===3?3:1)||channels>16)return null;
  if(!width||!height||width*height>32000000)throw new Error('Choose a PSD composite up to 32 megapixels.');
  let offset=26;for(let i=0;i<3;i++){if(offset+4>view.byteLength)return null;const length=view.getUint32(offset);offset+=4+length;}
  if(offset+2>view.byteLength)return null;const compression=view.getUint16(offset);offset+=2;
  if(compression>1)return null;
  const count=width*height,planes=new Uint8Array(count*channels);
  if(compression===0){if(offset+planes.length>view.byteLength)return null;planes.set(new Uint8Array(buffer,offset,planes.length));}
  else {
   if(offset+channels*height*2>view.byteLength)return null;
   const sizes=Array.from({length:channels*height},(_,i)=>view.getUint16(offset+i*2));offset+=sizes.length*2;
   for(let row=0;row<sizes.length;row++){
    const end=offset+sizes[row];if(end>view.byteLength)return null;let target=row*width,limit=target+width;
    while(offset<end&&target<limit){const code=view.getInt8(offset++);if(code>=0){const length=code+1;if(offset+length>end||target+length>limit)return null;planes.set(new Uint8Array(buffer,offset,length),target);target+=length;offset+=length;}else if(code!==-128){const length=1-code;if(offset>=end||target+length>limit)return null;planes.fill(view.getUint8(offset++),target,target+length);target+=length;}}
    if(target!==limit)return null;offset=end;
   }
  }
  const rgba=new Uint8ClampedArray(count*4),colors=mode===3?3:1;
  for(let i=0;i<count;i++){rgba[i*4]=planes[i];rgba[i*4+1]=planes[(mode===3?count:0)+i];rgba[i*4+2]=planes[(mode===3?2*count:0)+i];rgba[i*4+3]=channels>colors?planes[colors*count+i]:255;}
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return canvas;
 };
})();
