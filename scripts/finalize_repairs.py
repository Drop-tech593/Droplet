#!/usr/bin/env python3
from pathlib import Path
from lxml import html
import json, re, base64

ROOT=Path(__file__).resolve().parents[1]
vendors=json.loads((ROOT/'vendor-sources.json').read_text())
vendor={x['url']:x['local'] for x in vendors if 'local' in x}

# Restore the voice export dependencies from the same pinned local bundles as other tools.
p=ROOT/'exports.js';s=p.read_text()
for name, needle in [('jszip.min.js','/jszip/'),('jspdf.umd.min.js','/jspdf/')]:
 local=next(v for k,v in vendor.items() if needle in k)
 s=s.replace('vendor/'+name,local)
p.write_text(s)
p=ROOT/'app.js';s=p.read_text().replace('Voicepad','Droplet Voice').replace('voicepad-transcript.txt','droplet-transcript.txt');p.write_text(s)
p=ROOT/'studio.js';s=p.read_text().replace("location.href='https://dropletweb.xyz/'","location.href='/'")
s=s.replace("el('theme-toggle').onclick=()=>{document.documentElement.classList.toggle('dark')};", "el('theme-toggle').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');try{localStorage.setItem('theme',dark?'dark':'light')}catch{}};")
p.write_text(s)
p=ROOT/'transcribe.js';p.write_text(p.read_text().replace('@3.7.2/','@3.8.1/'))

# The editor's title is part of a custom app header; expose one equivalent heading.
p=ROOT/'edit-pdf.html';s=p.read_text()
if not re.search(r'<h1\b',s):s=s.replace('<body', '<body',1).replace('<!-- APP -->','<!-- APP -->',1);s=s.replace('<body>', '<body><h1 class="sr-only">PDF editor</h1>',1) if '<body>' in s else re.sub(r'(<body\b[^>]*>)',r'\1<h1 class="sr-only">PDF editor</h1>',s,count=1)
p.write_text(s)

# Online translation requires an explicit choice and must not silently truncate paragraphs.
p=ROOT/'translate-pdf.html';s=p.read_text()
tree=html.fromstring(s)
target=tree.xpath('//select[@id="targetLang"]')[0]
options='<option value="en">English</option>'+''.join(html.tostring(x,encoding='unicode') for x in target.xpath('./option') if x.get('value')!='en')
consent=f'''<div class="droplet-notice" id="online-translation-choice"><label for="sourceLang">Source language</label><select id="sourceLang" style="margin:8px;padding:8px;max-width:100%">{options}</select><p>Online translation sends extracted document text to MyMemory. The PDF file itself stays in your browser. The service may have usage limits.</p><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="translation-consent" style="margin-top:6px"><span>Send this document’s extracted text to MyMemory for translation.</span></label></div>'''
if 'id="translation-consent"' not in s:s=s.replace('<button id="translateBtn"',consent+'<button id="translateBtn"',1)
guard="""translateBtn.addEventListener('click', async () => {
      if (!document.getElementById('translation-consent').checked) {
        showToast('Enable online translation to send extracted text to MyMemory.', 'error');
        document.getElementById('translation-consent').focus();
        return;
      }
      if (document.getElementById('sourceLang').value === targetLang.value) {
        showToast('Choose different source and target languages.', 'error');
        return;
      }
"""
s=s.replace("translateBtn.addEventListener('click', async () => {",guard,1)
start=s.index('    async function translateWithMyMemory(')
end=s.index('    // ============================================================\n    // FILE LOADING',start)
replacement='''    async function translateWithMyMemory(text, targetLangCode) {
      const sourceLang = document.getElementById('sourceLang').value;
      const chunks = [];
      let current = '';
      const encoder = new TextEncoder();
      for (const character of text) {
        if (encoder.encode(current + character).length > 400) {
          const split = current.lastIndexOf(' ');
          if (split > 100) { chunks.push(current.slice(0, split)); current = current.slice(split + 1); }
          else { chunks.push(current); current = ''; }
        }
        current += character;
      }
      if (current.trim()) chunks.push(current);
      const output = [];
      for (const chunk of chunks) {
        if (State.stopRequested) throw new Error('Translation cancelled.');
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', chunk);
        url.searchParams.set('langpair', sourceLang + '|' + targetLangCode);
        const response = await fetch(url);
        if (response.status === 429) throw new Error('RATE_LIMIT');
        if (!response.ok) throw new Error('Translation service returned HTTP ' + response.status);
        const data = await response.json();
        if (Number(data.responseStatus) === 429) throw new Error('RATE_LIMIT');
        if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) throw new Error(data.responseDetails || 'No translation returned.');
        const translated = data.responseData.translatedText;
        if (translated.includes('MYMEMORY WARNING') || translated.includes('QUERY LENGTH LIMIT')) throw new Error('RATE_LIMIT');
        output.push(translated);
      }
      return output.join(' ');
    }

'''
s=s[:start]+replacement+s[end:]
s=s.replace('100% Client-Side Privacy First File Utility.','Browser PDF tools. Online translation uses MyMemory.')
p.write_text(s)

# Explain on-device retention and optional external services in the existing policy.
p=ROOT/'privacy.html';s=p.read_text()
specific='''<section class="policy-content" id="tool-processing-details"><h2>Tool processing and browser storage</h2><p>Most file conversion takes place on your device. A homepage transfer briefly stores a file in IndexedDB and removes it after the destination tool receives it. Unused transfers expire after two minutes and are removed while Droplet is open or on the next visit.</p><p>Voice transcript drafts are saved in this browser so you can continue later. Clear the transcript in the voice tool, or clear this site’s browser data, to remove them. Downloaded speech models and tool resources can remain cached on your device.</p><p>PDF translation sends extracted text to MyMemory only after you enable online translation. Browser speech recognition may send audio to the browser’s speech provider. On-device voice transcription instead downloads a model and processes the recording locally.</p><p>Loading the site, advertising resources, libraries and speech models still involves normal network requests. Local file processing does not mean the entire website makes no network requests.</p></section>'''
if 'id="tool-processing-details"' not in s:s=s.replace('</main>',specific+'</main>',1)
p.write_text(s)

# The small existing icon preserves branding without downloading the original megapixel logo.
icon=base64.b64encode((ROOT/'favicon-96x96.png').read_bytes()).decode()
(ROOT/'favicon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><image width="96" height="96" href="data:image/png;base64,{icon}"/></svg>')
social=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f8fbff"/><stop offset="1" stop-color="#e0e7ff"/></linearGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><circle cx="1100" cy="90" r="290" fill="#dbeafe" opacity=".7"/><rect x="54" y="54" width="1092" height="522" rx="36" fill="#fff"/><image x="98" y="96" width="66" height="66" href="data:image/png;base64,{icon}"/><text x="184" y="143" font-family="DejaVu Sans,sans-serif" font-size="46" font-weight="700" fill="#0f172a">Droplet</text><text x="100" y="280" font-family="DejaVu Sans,sans-serif" font-size="66" font-weight="700" fill="#0f172a">Free file tools.</text><text x="100" y="360" font-family="DejaVu Sans,sans-serif" font-size="66" font-weight="700" fill="#2563eb">Right in your browser.</text><text x="104" y="432" font-family="DejaVu Sans,sans-serif" font-size="29" fill="#475569">PDFs · Images · Documents · Data · Audio</text><rect x="100" y="473" width="280" height="56" rx="15" fill="#2563eb"/><text x="129" y="510" font-family="DejaVu Sans,sans-serif" font-size="24" font-weight="700" fill="#fff">42 free tools</text><text x="874" y="513" font-family="DejaVu Sans,sans-serif" font-size="24" fill="#475569">dropletweb.xyz</text></svg>'''
(ROOT/'assets/og-image.svg').write_text(social)
for p in ROOT.glob('*.html'):
 s=p.read_text().replace('href="/index"','href="/"')
 s=re.sub(r'(<link[^>]+href="/favicon-96x96\.png"[^>]*type=")image/(?:jpeg|svg\+xml)',r'\1image/png',s)
 p.write_text(s)
print('Restored voice exports, repaired editor heading, added translation consent and accurate retention details.')
