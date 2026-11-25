#!/usr/bin/env python3
"""Check deploy files, canonical routes, metadata, file maps and JavaScript syntax."""
from pathlib import Path
from urllib.parse import urlsplit, unquote
from lxml import html
import json, subprocess, concurrent.futures, sys, re
ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'dist' if '--dist' in sys.argv else ROOT
issues=[]; scripts=[]; documents={}
for path in SITE.glob('*.html'):
 source=path.read_text(); doc=html.fromstring(source); documents[path.name]=doc
 if any(token in source for token in ['adsbygoogle','googlesyndication','data-ad-slot']):issues.append(f'{path.name}: advertising code or commented advertising code remains')
 if len(doc.xpath('//h1'))!=1:issues.append(f'{path.name}: expected one H1')
 descriptions=doc.xpath('//meta[@name="description"]/@content')
 if len(descriptions)!=1 or not 25<=len(descriptions[0])<=160:issues.append(f'{path.name}: invalid meta description')
 canonical=doc.xpath('//link[@rel="canonical"]/@href')
 if len(canonical)!=1 or not canonical[0].startswith('https://dropletweb.xyz/'):issues.append(f'{path.name}: invalid canonical')
 for node in doc.xpath('//script'):
  if node.get('src'):continue
  if node.get('type') in ('application/ld+json','application/json','importmap'):
   try:
    data=json.loads(node.text or '')
    if node.get('type')=='application/ld+json' and 'aggregateRating' in json.dumps(data):issues.append(f'{path.name}: unverified rating markup')
   except ValueError:issues.append(f'{path.name}: invalid JSON metadata')
  elif node.text and node.text.strip():scripts.append((path.name,node.text,node.get('type')=='module'))
 for node in doc.xpath('//a[@href]|//script[@src]|//img[@src]|//link[@href]'):
  value=node.get('href') or node.get('src')
  parsed=urlsplit(value)
  if parsed.scheme in ('mailto','tel','javascript','data','blob') or parsed.netloc and parsed.netloc!='dropletweb.xyz':continue
  route=unquote(parsed.path)
  if not route:target=path
  else:
   target=SITE/route.lstrip('/')
   if route=='/':target=SITE/'index.html'
   elif target.is_dir():target=target/'index.html'
   elif not target.exists() and not target.suffix:target=target.with_suffix('.html')
  if not target.exists():issues.append(f'{path.name}: missing local resource {value}')
  elif parsed.fragment and target.suffix=='.html':
   target_doc=documents.get(target.name)
   if target_doc is None:target_doc=html.fromstring(target.read_text())
   if not target_doc.xpath('//*[@id=$target]',target=parsed.fragment):issues.append(f'{path.name}: missing fragment {value}')

def check_js(entry):
 name,source,module=entry
 result=subprocess.run(['node','--check','--input-type='+('module' if module else 'commonjs')],input=source,text=True,capture_output=True)
 return (name,result.stderr[:1800]) if result.returncode else None
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
 for result in pool.map(check_js,scripts):
  if result:issues.append('JavaScript syntax: '+str(result))
for name in ('home.js','droplet-runtime.js','theme.js','summarizer-import.js','site-ui.js','pdf-output.js','pdf-fonts.js','pdf-editor-engine.js','editor-upgrade.js','psd-merged.js'):
 result=subprocess.run(['node','--check',str(SITE/'assets'/name)],capture_output=True,text=True)
 if result.returncode:issues.append(name+': '+result.stderr)
tools=json.loads((SITE/'assets/tools.json').read_text())
assert len(tools)==len({x['page'] for x in tools})==42
assert all(x['extensions'] for x in tools)
embedded=documents['index.html'].xpath('//script[@id="tool-data"]/text()')
if not documents['index.html'].xpath('//input[@id="file-picker"][@multiple]'):issues.append('Homepage file picker must support multiple files')
if len(embedded)!=1 or json.loads(embedded[0])!=tools:issues.append('Homepage tool data differs from assets/tools.json')
for tool in tools:
 name=tool['page'].lstrip('/')+'.html'
 doc=documents.get(name)
 if doc is None:issues.append(f'{name}: missing tool page');continue
 if len([node for node in doc.xpath('//script[@src]') if urlsplit(node.get('src')).path=='/assets/droplet-runtime.js'])!=1:issues.append(f'{name}: missing shared handoff script')
 inputs=doc.xpath('//input[@type="file"][@data-droplet-handoff]')
 if len(inputs)!=1:issues.append(f'{name}: expected one explicit handoff receiver');continue
 receiver=inputs[0]
 if not isinstance(tool.get('multiple'),bool) or tool['multiple']!=(receiver.get('multiple') is not None):issues.append(f'{name}: multiple-file routing differs from receiver')
 accepted=[value.strip().lower() for value in (receiver.get('accept') or '').split(',') if value.strip()]
 for extension in tool['extensions']:
  if extension.lower() not in accepted:issues.append(f'{name}: advertised extension {extension} missing from receiver accept list')
assert {'/excel-to-pdf','/powerpoint-to-pdf','/html-to-pdf','/eps-to-svg'}<={x['page'] for x in tools}
assert (SITE/'og-image.png').exists()
assert 'google.com' not in (SITE/'ads.txt').read_text()
for name,doc in documents.items():
 if doc.xpath('//script[contains(@src,"googlesyndication") or contains(text(),"adsbygoogle")] | //ins[contains(@class,"adsbygoogle")]'):issues.append(f'{name}: advertising code remains')
assert 'cdn.tailwindcss.com' not in ''.join(p.read_text() for p in SITE.glob('*.html'))
if issues:
 print(json.dumps(issues,indent=2));sys.exit(1)
print(f'PASS: {len(documents)} pages, 42 handoff receivers, matching homepage file maps, local resources, fragments, metadata, schema and {len(scripts)} inline scripts checked.')
