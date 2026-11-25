"""Reopen browser downloads and flag empty/black PDF pages or invalid files."""
from pathlib import Path
import argparse,json,io,zipfile
import fitz
fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)
from PIL import Image
from pypdf import PdfReader
parser=argparse.ArgumentParser();parser.add_argument('path');parser.add_argument('--tool',required=True);parser.add_argument('--pages',type=int);parser.add_argument('--record',default='upgrade/output-checks.json');args=parser.parse_args();path=Path(args.path)
def inspect(data,name):
 result={'name':name,'bytes':len(data)}
 if data.startswith(b'%PDF'):
  pdf=fitz.open(stream=data,filetype='pdf');result['pages']=len(pdf);result['text']=[page.get_text().strip()[:240] for page in pdf];result['sizes']=[list(page.rect) for page in pdf];result['ink']=[];result['black']=[]
  for page in pdf:
   pix=page.get_pixmap(matrix=fitz.Matrix(.3,.3),alpha=False);pixels=Image.frombytes('RGB',(pix.width,pix.height),pix.samples);values=list(pixels.getdata());result['ink'].append(round(sum(min(p)<240 for p in values)/len(values),5));result['black'].append(round(sum(max(p)<25 for p in values)/len(values),5))
  result['blankPages']=[i+1 for i,value in enumerate(result['ink']) if value<.0001];result['blackPages']=[i+1 for i,value in enumerate(result['black']) if value>.75]
  reader=PdfReader(io.BytesIO(data));result['fields']=list((reader.get_fields() or {}).keys());result['danglingAnnotations']=[]
  for number,page in enumerate(reader.pages,1):
   for reference in page.get('/Annots',[]):
    try:
     if reference.get_object() is None:result['danglingAnnotations'].append(number)
    except Exception:result['danglingAnnotations'].append(number)
  result['valid']=bool(result['pages']) and not result['blackPages'] and not result['danglingAnnotations']
 elif data.startswith(b'PK'):
  with zipfile.ZipFile(io.BytesIO(data)) as archive:
   names=archive.namelist()
   if 'word/document.xml' in names:
    from docx import Document
    document=Document(io.BytesIO(data));result['paragraphs']=[p.text for p in document.paragraphs if p.text][:8];result['valid']=bool(result['paragraphs'])
   elif 'xl/workbook.xml' in names:
    from openpyxl import load_workbook
    workbook=load_workbook(io.BytesIO(data),data_only=True);result['sheets']=workbook.sheetnames;result['rows']={sheet.title:list(sheet.values)[:5] for sheet in workbook};result['valid']=bool(result['sheets'])
   elif 'ppt/presentation.xml' in names:
    from pptx import Presentation
    deck=Presentation(io.BytesIO(data));result['slides']=len(deck.slides);result['valid']=bool(result['slides'])
   else:result['files']=[inspect(archive.read(name),name) for name in names if not name.endswith('/')];result['valid']=bool(result['files']) and all(item.get('valid',True) for item in result['files'])
 else:
  try:
   image=Image.open(io.BytesIO(data));result['size']=list(image.size);result['format']=image.format;result['valid']=image.width>0 and image.height>0
  except Exception:
   text=data.decode('utf-8');result['preview']=text[:250];result['valid']=bool(text.strip())
 return result
record={'tool':args.tool,'path':str(path),**inspect(path.read_bytes(),path.name)}
if args.pages is not None:record['expectedPages']=args.pages;record['valid']=record['valid'] and record.get('pages')==args.pages
p=Path(args.record);rows=json.loads(p.read_text()) if p.exists() else [];rows.append(record);p.write_text(json.dumps(rows,ensure_ascii=False,indent=2,default=str)+'\n');print(json.dumps(record,ensure_ascii=False,default=str))
raise SystemExit(0 if record['valid'] else 1)
