#!/usr/bin/env python3
"""Generate Droplet's accessible directory and apply the reviewed site repairs."""
from pathlib import Path
from html import escape, unescape
import json, re, shutil

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
BASE = 'https://dropletweb.xyz'
TODAY = '2026-11-25'

DESCRIPTIONS = {
 'pdf-to-word':'Extract PDF content into an editable Word document.',
 'word-to-pdf':'Turn a Word document into a shareable PDF.',
 'pdf-to-txt':'Extract selectable text or use OCR for scanned pages.',
 'epub-to-pdf':'Read an EPUB ebook as a PDF document.',
 'txt-to-pdf':'Create a PDF from a plain text file.',
 'pdf-to-pdfa':'Prepare a PDF for supported archival settings.',
 'pdf-to-powerpoint':'Turn PDF pages into presentation slides.',
 'pdf-to-excel':'Extract PDF tables into a spreadsheet.',
 'powerpoint-to-pdf':'Create a PDF from a PowerPoint presentation.',
 'excel-to-pdf':'Turn spreadsheet sheets into PDF pages.',
 'html-to-pdf':'Create a PDF from HTML content.',
 'heic-to-jpg':'Convert HEIC and HEIF photos to high-quality JPG.',
 'webp-to-jpg':'Convert WebP images to JPG.',
 'webp-to-png':'Convert WebP images to PNG.',
 'avif-to-png':'Convert AVIF images to PNG.',
 'gif-to-png':'Extract still images from a GIF.',
 'psd-to-png':'Export a Photoshop image as PNG.',
 'raw-to-jpg':'Convert supported camera RAW images to JPG.',
 'tiff-to-pdf':'Create a PDF from TIFF images.',
 'jpg-to-pdf':'Combine JPG or PNG images into a PDF.',
 'pdf-to-jpg':'Export PDF pages as JPG images.',
 'svg-to-png':'Render an SVG as a PNG image.',
 'eps-to-svg':'Convert supported EPS graphics to SVG.',
 'json-to-csv':'Turn JSON records into spreadsheet-ready CSV.',
 'csv-to-json':'Convert CSV rows into structured JSON.',
 'xml-to-json':'Convert XML elements and attributes into JSON.',
 'voice-to-text':'Transcribe audio on your device after a model download.',
 'ai-summarizer':'Create an extractive summary of document text.',
 'translate-pdf':'Translate extracted text using an online service.',
 'pdf-to-markdown':'Extract PDF content into Markdown text.',
 'merge-pdf':'Combine multiple PDF files into one document.',
 'split-pdf':'Separate a PDF into smaller documents.',
 'remove-pages':'Delete selected pages from a PDF.',
 'extract-pages':'Save a selected group of PDF pages.',
 'organize-pdf':'Reorder and organize PDF pages.',
 'scan-to-pdf':'Create a PDF from camera captures or images.',
 'rotate-pdf':'Change the rotation of PDF pages.',
 'add-page-numbers':'Add page numbers to a PDF.',
 'add-watermark':'Place text or image watermarks on files.',
 'crop-pdf':'Adjust the visible boundaries of PDF pages.',
 'edit-pdf':'Add text, images and annotations to a PDF.',
 'pdf-forms':'Fill or add supported PDF form content.'
}
INPUTS = {
 'word-to-pdf':['docx'], 'epub-to-pdf':['epub'], 'txt-to-pdf':['txt'],
 'powerpoint-to-pdf':['pptx'], 'excel-to-pdf':['xlsx','xls','csv'],
 'html-to-pdf':['html','htm'], 'heic-to-jpg':['heic','heif'],
 'webp-to-jpg':['webp'], 'webp-to-png':['webp'], 'avif-to-png':['avif'],
 'gif-to-png':['gif'], 'psd-to-png':['psd'], 'raw-to-jpg':['cr2','nef','arw','dng','raw'],
 'tiff-to-pdf':['tif','tiff'], 'jpg-to-pdf':['jpg','jpeg','png','webp'],
 'svg-to-png':['svg'], 'eps-to-svg':['eps'], 'json-to-csv':['json'],
 'csv-to-json':['csv'], 'xml-to-json':['xml'],
 'voice-to-text':['mp3','wav','m4a','flac','ogg','webm','aac'],
 'ai-summarizer':['pdf','txt'], 'scan-to-pdf':['jpg','jpeg','png','webp'],
 'add-watermark':['pdf','jpg','jpeg','png','webp'], 'crop-pdf':['pdf','jpg','jpeg','png']
}
MIMES = {'pdf':'application/pdf','json':'application/json','csv':'text/csv','xml':'application/xml','txt':'text/plain','html':'text/html','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','heic':'image/heic','heif':'image/heif','jpg':'image/jpeg','png':'image/png','webp':'image/webp','svg':'image/svg+xml','eps':'application/postscript','epub':'application/epub+zip'}
GROUPS = [('doc-tools','Documents'),('image-tools','Images'),('pdf-organize','PDF organization & editing'),('ai-tools','Audio & AI'),('data-tools','Data & Markdown')]

FAQ = [
 ('How do I convert a file?', 'Select a file on the homepage, choose a matching tool, and follow the conversion options on that tool’s page. You can also open a tool first and select a file there.'),
 ('Are my files uploaded?', 'Most conversion tools process files in your browser. PDF translation sends extracted text to MyMemory only after you enable online translation. Voice transcription offers an on-device model; the optional browser speech service may send audio to its provider.'),
 ('What are the file-size limits?', 'Limits vary by tool and your device’s memory. JSON to CSV accepts up to 10 MB, for example. Matching tools show their limits before a homepage transfer, which is limited to 100 MB in total.'),
 ('Can I convert HEIC to JPG without losing quality?', 'Droplet can create high-quality JPG images from HEIC photos. JPG uses lossy compression, so a conversion cannot guarantee identical image data. Choose a higher quality setting when detail matters.'),
 ('Do I need an account or a subscription?', 'No account or subscription is required to use the tools. Some online features depend on external services and their availability or usage limits.'),
 ('Can I use Droplet offline?', 'Many tools work offline after their page and required resources have loaded. Speech models, OCR language data and online translation may need an internet connection. Test the specific tool before relying on it offline.'),
 ('Does Droplet store my files?', 'A homepage transfer briefly stores a copy on your device, deletes it after the destination tool receives it, and expires unused transfers after two minutes. Expired copies are removed while Droplet is open or on your next visit. Voice drafts, preferences and downloaded models can remain in browser storage until you clear them.'),
 ('How do I report a problem?', 'Open Contact, include the tool name and what happened, and avoid sending the document itself unless the site owner specifically needs it. The contact page links to the existing privacy email and Droplet’s public profiles.')
]

def load_tools():
 path = ASSETS / 'tools.json'
 if path.exists(): return json.loads(path.read_text())
 source = (ROOT/'index.html').read_text()
 a=source.index('const allTools ='); b=source.index('];',a)
 tools=[]; seen=set()
 pattern=r"\{ name: '([^']+)', page: '([^']+)', category: '([^']+)', emoji: '([^']+)', keywords: \[([^\]]+)\] \}"
 for name,page,category,emoji,keys in re.findall(pattern,source[a:b]):
  if page in seen: continue
  seen.add(page); slug=page.removesuffix('.html').lstrip('/')
  original=(ROOT/(slug+'.html')).read_text()
  limit=re.search(r'file\.size\s*>\s*(\d+)\s*\*\s*1024\s*\*\s*1024',original)
  max_mb=int(limit.group(1)) if limit else None
  if slug=='heic-to-jpg': max_mb=50
  if slug=='voice-to-text': max_mb=100
  if category in ('Core Documents','Convert to PDF'): group='doc-tools'
  elif category=='Image Converters': group='image-tools'
  elif category in ('PDF Organize','PDF Editing & Security'): group='pdf-organize'
  elif category=='AI Tools': group='ai-tools'
  else: group='data-tools'
  extensions=INPUTS.get(slug,['pdf'])
  tools.append({'name':name.replace('POWERPOINT','PowerPoint').replace('EXCEL','Excel'), 'page':'/'+slug,'category':dict(GROUPS)[group],'group':group,'emoji':emoji,'keywords':re.findall("'([^']+)'",keys),'description':DESCRIPTIONS[slug],'extensions':['.'+e for e in extensions],'mimeTypes':list({MIMES[e] for e in extensions if e in MIMES})+(['audio/'] if slug=='voice-to-text' else []),'maxMB':max_mb})
 assert len(tools)==42, len(tools)
 path.write_text(json.dumps(tools,indent=2,ensure_ascii=False)+'\n')
 return tools

def head(title, description, route='/', extra=''):
 canonical=BASE+route
 return f'''<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title><meta name="description" content="{escape(description,quote=True)}">
<meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="{canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Droplet"><meta property="og:title" content="{escape(title,quote=True)}"><meta property="og:description" content="{escape(description,quote=True)}"><meta property="og:url" content="{canonical}"><meta property="og:image" content="{BASE}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Droplet — free file tools">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{escape(title,quote=True)}"><meta name="twitter:description" content="{escape(description,quote=True)}"><meta name="twitter:image" content="{BASE}/og-image.png">
<link rel="icon" href="/favicon-96x96.png" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#2563eb">
<script src="/assets/theme.js"></script><link rel="stylesheet" href="/assets/home.css"><link rel="stylesheet" href="/assets/droplet-fixes.css"><script defer src="/assets/droplet-runtime.js"></script>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4006702663328202" crossorigin="anonymous"></script>{extra}</head><body>'''

def brand(): return '<a class="brand" href="/"><img src="/favicon-96x96.png" width="36" height="36" alt=""><span>Droplet</span></a>'

def header(home=False):
 prefix='' if home else '/'
 links=f'<a href="{prefix}#all-tools">All tools</a><a href="{prefix}#image-tools">Images</a><a href="{prefix}#doc-tools">Documents</a><a href="{prefix}#pdf-organize">PDF tools</a><a href="/faq">Help</a>'
 return f'''<a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="wrap header-row">{brand()}<nav class="desktop-nav" aria-label="Main navigation">{links}</nav><div class="header-actions"><button type="button" class="quiet-button" data-droplet-theme aria-label="Toggle dark mode">Dark mode</button><button class="quiet-button mobile-toggle" id="mobile-menu-button" type="button" aria-haspopup="dialog" aria-controls="mobile-menu" aria-expanded="false">Menu</button></div></div></header><dialog id="mobile-menu" class="file-dialog mobile-dialog" aria-labelledby="menu-title"><div class="dialog-header"><h2 id="menu-title">Browse Droplet</h2><button class="dialog-close" id="mobile-menu-close" type="button" aria-label="Close navigation">×</button></div><nav class="mobile-links" aria-label="Mobile navigation">{links}<a href="{prefix}#ai-tools">Audio & AI</a><a href="{prefix}#data-tools">Data tools</a><a href="/contact">Contact</a></nav></dialog>'''

def footer():
 return f'''<footer class="site-footer"><div class="wrap"><div class="footer-grid"><div>{brand()}<p>Free tools for PDFs, images, documents and data. Processing details and limits are shown by each tool.</p></div><div><h2>Browse tools</h2><ul><li><a href="/#image-tools">Images</a></li><li><a href="/#doc-tools">Documents</a></li><li><a href="/#pdf-organize">PDF tools</a></li><li><a href="/#ai-tools">Audio & AI</a></li><li><a href="/#data-tools">Data tools</a></li></ul></div><div><h2>Help</h2><ul><li><a href="/faq">Questions & answers</a></li><li><a href="/contact">Contact</a></li><li><a href="/about">About</a></li><li><a href="/sitemap.xml">Sitemap</a></li></ul></div><div><h2>Information</h2><ul><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li><li><a href="https://www.reddit.com/user/Dropletweb/" rel="noopener" target="_blank">Reddit</a></li><li><a href="https://www.linkedin.com/company/dropletweb/" rel="noopener" target="_blank">LinkedIn</a></li></ul></div></div><div class="footer-bottom">© <span data-current-year>2026</span> Droplet. Free browser tools.</div></div></footer>'''

def menu_script():
 return '''<script>const menu=document.getElementById('mobile-menu'),toggle=document.getElementById('mobile-menu-button');toggle.addEventListener('click',()=>{menu.showModal();toggle.setAttribute('aria-expanded','true')});document.getElementById('mobile-menu-close').addEventListener('click',()=>menu.close());menu.addEventListener('close',()=>toggle.setAttribute('aria-expanded','false'));for(const link of menu.querySelectorAll('a'))link.addEventListener('click',()=>menu.close());</script>'''

def faq_markup(): return '<div class="faq-list">'+''.join(f'<details><summary>{escape(q)}</summary><p>{escape(a)}</p></details>' for q,a in FAQ)+'</div>'

def card(tool, tag='h3'):
 limit=f'Up to {tool["maxMB"]} MB per file' if tool['maxMB'] else 'See the tool for processing limits'
 return f'''<a class="tool-card" href="{tool['page']}"><span class="tool-icon" aria-hidden="true">{tool['emoji']}</span><div><{tag}>{escape(tool['name'])}</{tag}><p>{escape(tool['description'])}</p><small>{limit}</small></div></a>'''

def render_home(tools):
 description='Convert PDFs, images, documents and data with 42 free Droplet tools. Browse clear file limits and processing details, with no account required.'
 assert 120<=len(description)<=160
 graph={'@context':'https://schema.org','@graph':[{'@type':'WebSite','name':'Droplet','url':BASE+'/'},{'@type':'WebApplication','name':'Droplet file tools','url':BASE+'/','description':description,'applicationCategory':'UtilitiesApplication','operatingSystem':'Web','offers':{'@type':'Offer','price':'0','priceCurrency':'USD'}},{'@type':'BreadcrumbList','itemListElement':[{'@type':'ListItem','position':1,'name':'Home','item':BASE+'/'}]},{'@type':'FAQPage','mainEntity':[{'@type':'Question','name':q,'acceptedAnswer':{'@type':'Answer','text':a}} for q,a in FAQ]}]}
 extra='<script type="application/ld+json">'+json.dumps(graph,ensure_ascii=False)+'</script><script defer src="/assets/home.js"></script>'
 popular=['heic-to-jpg','pdf-to-word','word-to-pdf','merge-pdf','json-to-csv','voice-to-text']
 selected=[next(t for t in tools if t['page']=='/'+slug) for slug in popular]
 directory=''.join(f'<section class="category-section" id="{group}" aria-labelledby="title-{group}"><h3 class="category-title" id="title-{group}">{escape(name)}</h3><div class="card-grid">'+''.join(card(t,'h4') for t in tools if t['group']==group)+'</div></section>' for group,name in GROUPS)
 nav=''.join(f'<a href="#{group}">{escape(name)}</a>' for group,name in GROUPS)
 body=f'''{header(True)}<main id="main">
<section class="hero"><div class="wrap"><div class="eyebrow">Free tools. No account required.</div><h1>File conversion,<br><span class="gradient-text">right in your browser.</span></h1><p class="hero-copy">Convert PDFs, images, documents and data. Choose a tool to see its file limits and processing details.</p>
<div class="search-block" id="search-block"><label class="sr-only" for="tool-search">Search all 42 tools</label><div class="search-box"><span class="search-icon" aria-hidden="true">⌕</span><input id="tool-search" type="search" placeholder="Search tools — PDF, HEIC, Word, JSON…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" aria-describedby="search-status"><button class="clear-search" id="clear-search" type="button" aria-label="Clear search" hidden>×</button><kbd class="shortcut" id="search-shortcut">Ctrl K</kbd></div><div id="search-results" class="search-results" role="listbox" aria-label="Matching tools" hidden></div><div class="sr-only" id="search-status" role="status" aria-live="polite"></div></div>
<div class="dropzone" id="dropzone"><h2>Drop your file here</h2><p>Choose a matching tool, with your file ready to use.</p><input id="file-picker" type="file" class="sr-only" tabindex="-1" aria-label="Select a file to convert"><button type="button" class="primary-button" id="select-file">Select file</button><div class="file-types">PDF · HEIC · DOCX · JPG · XLSX · PPTX · JSON · AUDIO</div></div>
<div class="stats" aria-label="Tool information"><div><strong>42 tools</strong><span>One complete directory</span></div><div><strong>No account</strong><span>Open a tool and start</span></div><div><strong>Local conversions</strong><span>Online features are labelled</span></div><div><strong>Clear limits</strong><span>Shown for each tool</span></div></div></div></section>
<section class="section"><div class="wrap"><h2>Popular tools</h2><p class="section-lead">Start with a frequently used converter or browse the complete directory.</p><div class="card-grid">{''.join(card(t) for t in selected)}</div></div></section>
<section class="section" id="all-tools"><div class="wrap"><div class="catalog-header"><div><h2>All 42 tools</h2><p class="section-lead">Browse by category. Each tool explains its supported files, limits and output options.</p></div></div><nav class="catalog-nav" aria-label="Tool categories">{nav}</nav>{directory}</div></section>
<section class="section"><div class="wrap"><h2>From file to finished</h2><p class="section-lead">A simple workflow, with processing details before you start.</p><div class="steps"><div class="step"><h3>Choose your file</h3><p>Select a file above, or open a tool from the directory.</p></div><div class="step"><h3>Pick the right tool</h3><p>Check the supported formats, file limits and conversion options.</p></div><div class="step"><h3>Convert and download</h3><p>Run the conversion, review the result and save it to your device.</p></div></div></div></section>
<section class="section" id="faq"><div class="wrap"><h2>Questions & answers</h2><p class="section-lead">Privacy, file limits and offline use, explained.</p>{faq_markup()}</div></section></main>
<dialog id="file-dialog" class="file-dialog" aria-labelledby="file-dialog-title" aria-describedby="selected-file"><div class="dialog-header"><h2 id="file-dialog-title">Choose a tool</h2><button class="dialog-close" id="file-dialog-close" type="button" aria-label="Close file options">×</button></div><p id="selected-file" class="selected-file"></p><div class="conversion-list" id="conversion-list"></div><p id="transfer-status" class="status" role="status" aria-live="polite"></p><button id="open-directly" class="quiet-button" type="button" hidden>Open tool without transferring</button><p class="selected-file">The transfer briefly stores your file on this device and deletes it when the tool receives it.</p></dialog>
{footer()}<script type="application/json" id="tool-data">{json.dumps(tools,ensure_ascii=False).replace('<','\\u003c')}</script></body></html>'''
 (ROOT/'index.html').write_text(head('Droplet — Free PDF, Image & Document Tools',description,extra=extra)+body)

def render_help():
 (ROOT/'faq.html').write_text(head('Droplet Help — File Limits, Privacy & Conversions','Find answers about Droplet file conversions, privacy, supported formats, file-size limits, offline tools and troubleshooting. No account is required.','/faq')+header()+f'<main id="main" class="prose-page"><h1>How can we help?</h1><p>These answers apply across the tool directory. Check each tool’s page for its specific limits and options.</p>{faq_markup()}<h2>A file did not appear in the tool</h2><p>Keep the transfer tab open and allow browser storage. Temporary transfers expire after two minutes. If storage is unavailable, open the tool directly and select your file there.</p><p><a href="/contact">Contact Droplet</a> for a problem that is not covered here.</p></main>'+footer()+menu_script()+'</body></html>')
 (ROOT/'contact.html').write_text(head('Contact Droplet — Help & Privacy','Contact Droplet about file tools, privacy questions or a problem with the website. Include the tool name, browser and steps that caused the issue.','/contact')+header()+'''<main id="main" class="prose-page"><h1>Contact Droplet</h1><p>Start with the <a href="/faq">help page</a> for file limits, browser storage and conversion questions.</p><h2>Privacy questions</h2><p>The privacy contact published in Droplet’s existing policy is <a href="mailto:privacy@dropletweb.xyz">privacy@dropletweb.xyz</a>.</p><h2>Public profiles</h2><div class="contact-links"><a class="quiet-button" href="https://www.reddit.com/user/Dropletweb/" target="_blank" rel="noopener">Droplet on Reddit</a><a class="quiet-button" href="https://www.linkedin.com/company/dropletweb/" target="_blank" rel="noopener">Droplet on LinkedIn</a></div><h2>Reporting a problem</h2><p>Include the tool name, your browser, the file format, and the steps that caused the problem. Describe any error message. You do not need to send your document to explain a website problem.</p></main>'''+footer()+menu_script()+'</body></html>')

def shorten(text, maximum=155):
 text=' '.join(unescape(re.sub('<[^>]+>','',text)).split())
 if len(text)<=maximum:return text
 return text[:maximum-1].rsplit(' ',1)[0].rstrip(' ,;:—-')+'.'

def replace_h1s(source):
 matches=list(re.finditer(r'<h1\b([^>]*)>(.*?)</h1>',source,re.I|re.S))
 if not matches:
  if 'id="headerTitle"' in source:
   return re.sub(r'<span([^>]*id="headerTitle"[^>]*)>(.*?)</span>',r'<h1\1>\2</h1>',source,count=1,flags=re.S)
  if 'edit-pdf' in source:
   return source.replace('<div class="app-header">','<div class="app-header"><h1 class="sr-only">PDF editor</h1>',1)
  return source
 keep=next((m for m in matches if re.sub('<[^>]+>','',m.group(2)).strip()!='Droplet'),matches[0])
 for m in reversed(matches):
  if m is keep:continue
  text=re.sub('<[^>]+>','',m.group(2)).strip();tag='span' if text=='Droplet' else 'h2'
  source=source[:m.start()]+f'<{tag}{m.group(1)}>{m.group(2)}</{tag}>'+source[m.end():]
 return source

def patch_pages(tools):
 vendors=json.loads((ROOT/'vendor-sources.json').read_text())
 mappings={x['url']:x['local'] for x in vendors if 'local' in x}
 docx=next(v for k,v in mappings.items() if 'unpkg.com/docx@8.5.0' in k)
 mappings['https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.js']=docx
 mappings['https://cdnjs.cloudflare.com/ajax/libs/xml2js/0.6.2/xml2js.min.js']='/assets/vendor/xml2js-0.6.2.js'
 for path in ROOT.glob('*.html'):
  if path.name in ('index.html','faq.html','contact.html'):continue
  source=path.read_text()
  source=re.sub(r'<script\b[^>]*src=["\']https://static\.cloudflareinsights\.com/[^>]*></script>','',source,flags=re.I)
  source=re.sub(r'<script\b[^>]*src=["\']https://cdn\.tailwindcss\.com["\'][^>]*></script>','<link rel="stylesheet" href="/assets/toolkit.css">',source,flags=re.I)
  for old,new in mappings.items():source=source.replace(old,new)
  source=re.sub(r'((?:src|href)=["\'])(?:/)?(?:Gemini_Generated_Image_sdu6v7sdu6v7sdu6\.jpg|Glossy Blue Droplet Arrow Icon\.png|favicon\.svg)(["\'])',r'\1/favicon-96x96.png\2',source)
  source=source.replace(BASE+'/Gemini_Generated_Image_sdu6v7sdu6v7sdu6.jpg',BASE+'/og-image.png').replace(BASE+'/og-image.jpg',BASE+'/og-image.png')
  source=re.sub(r'(["\'])(/[^"\'\s#?]+)\.html(["\'])',r'\1\2\3',source)
  source=re.sub(r'href=["\']https://dropletweb\.xyz/["\']','href="/"',source)
  source=replace_h1s(source)
  slug=path.stem
  title_match=re.search(r'<title>(.*?)</title>',source,re.S)
  old_title=unescape(title_match.group(1)) if title_match else slug.replace('-',' ').title()+' | Droplet'
  title=old_title
  if slug=='voice-to-text':title='Voice to Text — Audio Transcription | Droplet'
  elif len(title)>64:
   tool=next((t for t in tools if t['page']=='/'+slug),None)
   title=(tool['name']+' — Free Online Tool | Droplet') if tool else shorten(title,62)
  source=re.sub(r'<title>.*?</title>','<title>'+escape(title)+'</title>',source,count=1,flags=re.S)
  if slug=='voice-to-text':
   source=source.replace('Voicepad','Droplet Voice').replace('href="layout.css"','href="/layout.css"')
   source=source.replace('<h1 class="title"','<h1 style="font-size:13px;line-height:1.4;margin:0" class="title"')
   source=source.replace('<div class="action-note" id="state"','<div class="action-note">Live dictation uses your browser’s speech service, which may send audio to its provider.</div><div class="action-note" id="state"')
  description=next((t['description'] for t in tools if t['page']=='/'+slug),'Read about Droplet file tools, browser processing, privacy and support.')
  description=shorten(description+' Free to use, with no account required. Open the tool to check supported formats, size limits and processing details.')
  pattern=r'<meta\b(?=[^>]*\bname\s*=\s*["\']description["\'])[^>]*>'
  desc_tag='<meta name="description" content="'+escape(description,quote=True)+'">'
  if re.search(pattern,source,re.I):source=re.sub(pattern,desc_tag,source,count=1,flags=re.I)
  else:source=source.replace('</head>',desc_tag+'</head>',1)
  # Replace unsupported or stale rating markup without inventing reviews.
  def clean_json(match):
   try:
    data=json.loads(match.group(1))
    def clean(value):
     if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('aggregateRating','review')}
     if isinstance(value,list):return [clean(v) for v in value]
     return value
    return '<script type="application/ld+json">'+json.dumps(clean(data),ensure_ascii=False)+'</script>'
   except (ValueError,TypeError):return match.group(0)
  source=re.sub(r'<script\s+type="application/ld\+json"[^>]*>(.*?)</script>',clean_json,source,flags=re.S)
  if '<link rel="canonical"' not in source:source=source.replace('</head>',f'<link rel="canonical" href="{BASE}/{slug}"></head>',1)
  extra='<script src="/assets/theme.js"></script><link rel="stylesheet" href="/assets/droplet-fixes.css"><script defer src="/assets/droplet-runtime.js"></script>'
  if '/assets/droplet-runtime.js' not in source:source=source.replace('</head>',extra+'</head>',1)
  source=re.sub(r'©\s*2025', '© <span data-current-year>2026</span>',source)
  source=source.replace('max 2GB','tool-specific limits').replace('up to 2GB without issues','within each tool’s stated file limit')
  path.write_text(source)

def main():
 ASSETS.mkdir(exist_ok=True)
 tools=load_tools()
 patch_pages(tools)
 render_home(tools)
 render_help()
 (ROOT/'ads.txt').write_text('google.com, pub-4006702663328202, DIRECT, f08c47fec0942fa0\n')
 urls=['/']+[t['page'] for t in tools]+['/about','/privacy','/terms','/faq','/contact']
 sitemap='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{BASE}{route}</loc><lastmod>{TODAY}</lastmod></url>\n' for route in urls)+'</urlset>\n'
 (ROOT/'sitemap.xml').write_text(sitemap)
 # Keep deliberate crawler restrictions, while removing nonstandard content directives from the repository file.
 robots=(ROOT/'robots.txt').read_text() if (ROOT/'robots.txt').exists() else 'User-agent: *\nAllow: /\n'
 robots='\n'.join(line for line in robots.splitlines() if not line.startswith(('Content-Signal:','Sitemap:'))).rstrip()+'\nSitemap: '+BASE+'/sitemap.xml\n'
 (ROOT/'robots.txt').write_text(robots)
 manifest={'id':'/','name':'Droplet — Free File Tools','short_name':'Droplet','description':'42 free tools for PDFs, images, documents and data.','start_url':'/','scope':'/','display':'standalone','orientation':'any','theme_color':'#2563eb','background_color':'#f8fafc','lang':'en','icons':[{'src':f'/web-app-manifest-{size}x{size}.png','sizes':f'{size}x{size}','type':'image/png','purpose':'any maskable'} for size in (192,512)],'screenshots':[{'src':'/og-image.png','sizes':'1200x630','type':'image/png','form_factor':'wide','label':'Droplet file tools'}]}
 (ROOT/'site.webmanifest').write_text(json.dumps(manifest,indent=2)+'\n')
 (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(f'Updated homepage, help, contact, metadata and {len(tools)} tool entries.')

if __name__=='__main__':main()
