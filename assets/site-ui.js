(() => {
  'use strict';
  const menu=document.getElementById('mobile-menu');
  const opener=document.getElementById('mobile-menu-button');
  if(menu&&opener){
    opener.addEventListener('click',()=>{menu.showModal();opener.setAttribute('aria-expanded','true');});
    document.getElementById('mobile-menu-close').addEventListener('click',()=>menu.close());
    menu.addEventListener('close',()=>opener.setAttribute('aria-expanded','false'));
    menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>menu.close()));
  }
  document.querySelectorAll('main>article[aria-label^="About "],body[data-tool-route="/translate-pdf"] main>article,main>section[aria-label^="About "],main>section[aria-label="Frequently asked questions"]').forEach(section=>{
    if(section.closest('.tool-guide'))return;const wrapper=document.createElement('details');wrapper.className='tool-guide';const summary=document.createElement('summary');summary.textContent=(section.getAttribute('aria-label')||'').includes('questions')?'Questions & answers':'How this tool works';section.before(wrapper);wrapper.append(summary,section);
  });
  // Preserve the old controls for each tool's existing handlers; navigation uses the shared header.
  document.querySelectorAll('.droplet-legacy-header,#theme-toggle').forEach(node=>{
    if(!node.closest('.site-header'))node.classList.add('droplet-legacy-theme');
  });
  document.querySelectorAll('.menu-btn').forEach(menu=>{
    menu.tabIndex=0;menu.setAttribute('role','button');menu.setAttribute('aria-haspopup','true');
    menu.addEventListener('keydown',event=>{
      if(event.key==='Escape'){menu.classList.remove('menu-open');menu.blur();}
      if(event.key==='Enter'||event.key===' '){event.preventDefault();menu.classList.toggle('menu-open');}
    });
  });
  document.querySelectorAll('button').forEach(button=>{
    if(!button.hasAttribute('type'))button.type='button';
    if(!button.hasAttribute('aria-label')&&button.title)button.setAttribute('aria-label',button.title);
  });
})();
