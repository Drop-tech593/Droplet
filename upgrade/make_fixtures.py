"""Create anonymous documents for browser conversion and output validation."""
from pathlib import Path
import argparse,sys,json,struct,zipfile,wave,textwrap,shutil
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'handoff-qa-deps'))
from PIL import Image,ImageDraw
from reportlab.pdfgen import canvas
from docx import Document
from pptx import Presentation
from openpyxl import Workbook
parser=argparse.ArgumentParser();parser.add_argument('directory',nargs='?',default='/workspace/shared/droplet-upgrade-fixtures');args=parser.parse_args();out=Path(args.directory);out.mkdir(parents=True,exist_ok=True)
paragraph='Droplet conversion verification. This document contains real text, numbers and pictures. A successful conversion keeps the content readable. The output should contain the selected pages in the requested order. Text should remain visible on a white page. These anonymous sample files are used to check downloads and prevent empty output.'
for name,color in [('one',(37,99,235)),('two',(124,58,237))]:
 image=Image.new('RGB',(320,180),'white');draw=ImageDraw.Draw(image);draw.rectangle((20,20,300,140),fill=color);draw.text((30,150),'DROPLET SAMPLE '+name,fill='black')
 for extension,format in [('jpg','JPEG'),('png','PNG'),('webp','WEBP'),('tiff','TIFF'),('avif','AVIF')]:image.save(out/(name+'.'+extension),format=format)
 image.save(out/(name+'.gif'),save_all=True,append_images=[image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=200,loop=0)
 try:
  import pillow_heif;pillow_heif.register_heif_opener();image.save(out/(name+'.heic'),format='HEIF',quality=85)
 except ImportError:pass
 w,h=4,4;psd=b'8BPS'+struct.pack('>H',1)+b'\0'*6+struct.pack('>HIIHH',3,h,w,8,3)+struct.pack('>IIIH',0,0,0,0)+bytes([37]*16+[99]*16+[235]*16);(out/(name+'.psd')).write_bytes(psd)
 assert Image.open(out/(name+'.psd')).size==(4,4)
 try:
  import tifffile,numpy as np
  tifffile.imwrite(out/(name+'.dng'),np.array([[40,100],[100,200]],dtype=np.uint8),photometric=32803,metadata=None,extratags=[(50706,'B',4,(1,4,0,0),False),(50707,'B',4,(1,1,0,0),False),(50708,'s',0,'Droplet QA',False),(33421,'H',2,(2,2),False),(33422,'B',4,(0,1,1,2),False)])
 except ImportError:pass
 (out/(name+'.txt')).write_text('\n\n'.join([paragraph]*4))
 (out/(name+'.json')).write_text(json.dumps([{'name':'Alice','amount':12.5,'city':'Pretoria'},{'name':'Bob, Jr','amount':7,'city':'Johannesburg'}]))
 (out/(name+'.csv')).write_text('name,amount,city\nAlice,12.5,Pretoria\n"Bob, Jr",7,Johannesburg\n')
 (out/(name+'.tsv')).write_text('name\tamount\tcity\nAlice\t12.5\tPretoria\nBob\t7\tJohannesburg\n')
 (out/(name+'.xml')).write_text('<root><person id="1"><name>Alice</name><active>true</active></person><person id="2"><name>Bob</name><active>false</active></person></root>')
 (out/(name+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect x="20" y="20" width="280" height="120" fill="#2563eb"/><text x="30" y="160" font-size="16">DROPLET SAMPLE</text></svg>')
 (out/(name+'.eps')).write_text('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 320 180\n0.145 0.388 0.922 setrgbcolor\nnewpath 20 20 moveto 300 20 lineto 300 140 lineto 20 140 lineto closepath fill\n0 setgray\nnewpath 20 160 moveto 300 160 lineto 3 setlinewidth stroke\nshowpage\n%%EOF\n')
 (out/(name+'.html')).write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Droplet sample</title><style>body{font:16px Arial;color:#172033}h1{color:#2563eb}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}</style></head><body><h1>Droplet sample document</h1><p>'+paragraph+'</p><img src="data:image/png;base64,'+__import__('base64').b64encode((out/(name+'.png')).read_bytes()).decode()+'" width="320"><table><tr><th>Name</th><th>Amount</th></tr><tr><td>Alice</td><td>12.50</td></tr></table></body></html>')
 c=canvas.Canvas(str(out/(name+'.pdf')))
 for number,size in [(1,(595.276,841.89)),(2,(842,595)),(3,(612,792)),(4,(595.276,841.89))]:
  c.setPageSize(size)
  if number<4:
   c.setFillColorRGB(.145,.388,.922);c.rect(35,size[1]-105,size[0]-70,62,fill=1,stroke=0);c.setFillColorRGB(1,1,1);c.setFont('Helvetica-Bold',24);c.drawString(50,size[1]-80,f'PAGE {number} - DROPLET')
   c.setFillColorRGB(.06,.09,.16);text=c.beginText(50,size[1]-140);text.setFont('Helvetica',12)
   for line in textwrap.wrap(paragraph,75):text.textLine(line)
   c.drawText(text);c.drawImage(str(out/(name+'.png')),50,120,width=240,height=135)
  c.showPage()
 c.save()
 doc=Document();doc.add_heading('Droplet sample document',0);doc.add_paragraph(paragraph);doc.add_picture(str(out/(name+'.png')),width=__import__('docx').shared.Inches(3));table=doc.add_table(rows=1,cols=2);table.rows[0].cells[0].text='Name';table.rows[0].cells[1].text='Amount';row=table.add_row();row.cells[0].text='Alice';row.cells[1].text='12.50';doc.save(out/(name+'.docx'))
 deck=Presentation()
 for i in range(2):slide=deck.slides.add_slide(deck.slide_layouts[1]);slide.shapes.title.text=f'Droplet sample slide {i+1}';slide.placeholders[1].text=paragraph
 deck.save(out/(name+'.pptx'))
 workbook=Workbook();sheet=workbook.active;sheet.title='Amounts';sheet.append(['Name','Amount']);sheet.append(['Alice',12.5]);sheet.append(['Bob',7]);second=workbook.create_sheet('Notes');second.append(['Droplet sample document']);workbook.save(out/(name+'.xlsx'))
 with zipfile.ZipFile(out/(name+'.epub'),'w') as archive:
  archive.writestr('mimetype','application/epub+zip');archive.writestr('META-INF/container.xml','<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');archive.writestr('content.opf','<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Droplet</dc:title><dc:identifier id="id">droplet-qa</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');archive.writestr('chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Droplet</title></head><body><h1>Droplet sample ebook</h1><p>'+paragraph+'</p></body></html>')
 with wave.open(str(out/(name+'.wav')),'wb') as audio:audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0\0'*16000)
(out/'unicode.txt').write_text('Venda: Ṋḓivho na vhutshilo. Café, résumé and R123,45.\n'+paragraph)
alpha=Image.new('RGBA',(120,80),(0,0,0,0));ImageDraw.Draw(alpha).rectangle((20,20,100,60),fill=(37,99,235,255));alpha.save(out/'transparent.png')
print(json.dumps({'directory':str(out),'files':len(list(out.iterdir()))}))

# Extra regression cases: tables, multi-page TIFF, long text and rotated/cropped PDF.
c=canvas.Canvas(str(out/'table.pdf'));c.setFont('Helvetica-Bold',12)
for x,text in [(50,'Description'),(300,'Quantity'),(420,'Amount')]:c.drawString(x,740,text)
c.setFont('Helvetica',12)
for y,name,qty,amount in [(712,'Concrete',3,1500),(690,'Steel',5,900)]:
 for x,text in [(50,name),(300,str(qty)),(420,str(amount))]:c.drawString(x,y,text)
c.save()
Image.open(out/'one.tiff').save(out/'multi.tiff',save_all=True,append_images=[Image.open(out/'two.tiff')])
(out/'long.txt').write_text('\n\n'.join(paragraph+' SECTION '+str(i+1) for i in range(50)))
(out/'long.html').write_text('<html><body>'+''.join('<h2>Section '+str(i+1)+'</h2><p>'+paragraph+'</p>' for i in range(30))+'</body></html>')
from pypdf import PdfReader,PdfWriter
r=PdfReader(out/'one.pdf');w=PdfWriter();page=r.pages[0];page.cropbox.lower_left=(20,40);page.rotate(90);w.add_page(page);w.write(out/'rotated.pdf')
