(() => {
  'use strict';
  const tools = JSON.parse(document.getElementById('tool-data').textContent);
  const search = document.getElementById('tool-search');
  const results = document.getElementById('search-results');
  const clearButton = document.getElementById('clear-search');
  const status = document.getElementById('search-status');
  const picker = document.getElementById('file-picker');
  const fileDialog = document.getElementById('file-dialog');
  const conversionList = document.getElementById('conversion-list');
  const transferStatus = document.getElementById('transfer-status');
  const dropzone = document.getElementById('dropzone');
  let matches = [];
  let active = -1;
  let selectedFiles = [];
  let selectedTool;
  let sending = false;

  function closeResults() {
    results.hidden = true;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    active = -1;
  }
  function activate(index) {
    active = Math.max(0, Math.min(matches.length - 1, index));
    for (const [i, element] of [...results.children].entries()) element.setAttribute('aria-selected', String(i === active));
    const element = results.children[active];
    if (element) { search.setAttribute('aria-activedescendant', element.id); element.scrollIntoView({ block: 'nearest' }); }
  }
  function runSearch() {
    const query = search.value.trim().toLocaleLowerCase();
    clearButton.hidden = !query;
    results.replaceChildren();
    active = -1;
    search.removeAttribute('aria-activedescendant');
    if (!query) { closeResults(); status.textContent = ''; return; }
    const words = query.split(/\s+/).filter(Boolean);
    matches = tools.map(tool => {
      const name = tool.name.toLowerCase();
      const haystack = [name, tool.description, tool.category, ...tool.keywords].join(' ').toLowerCase();
      const score = name === query ? 100 : name.startsWith(query) ? 80 : name.includes(query) ? 60 : words.every(word => haystack.includes(word)) ? 30 : 0;
      return { tool, score };
    }).filter(entry => entry.score).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, 10).map(entry => entry.tool);
    results.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = `No tools found for “${search.value.trim()}”. Try PDF, HEIC, Word, JSON or audio.`;
      results.append(empty);
      status.textContent = 'No matching tools.';
      return;
    }
    for (const [i, tool] of matches.entries()) {
      const element = document.createElement('div');
      element.id = `tool-result-${i}`;
      element.className = 'search-option';
      element.setAttribute('role', 'option');
      element.setAttribute('aria-selected', 'false');
      const name = document.createElement('strong'); name.textContent = tool.name;
      const category = document.createElement('small'); category.textContent = tool.category;
      element.append(name, category);
      element.addEventListener('mousedown', event => event.preventDefault());
      element.addEventListener('click', () => location.assign(tool.page));
      results.append(element);
    }
    status.textContent = `${matches.length} matching tools. Use the arrow keys, then Enter to open one.`;
  }
  search.addEventListener('input', runSearch);
  search.addEventListener('focus', () => { if (search.value.trim()) runSearch(); });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeResults(); return; }
    if (event.key === 'Tab') { closeResults(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!matches.length || results.hidden) return;
      event.preventDefault();
      activate(event.key === 'ArrowDown' ? active + 1 : active <= 0 ? matches.length - 1 : active - 1);
    }
    if (event.key === 'Enter' && !results.hidden && matches.length) { event.preventDefault(); location.assign(matches[Math.max(active, 0)].page); }
  });
  clearButton.addEventListener('click', () => { search.value = ''; runSearch(); search.focus(); });
  document.addEventListener('pointerdown', event => { if (!document.getElementById('search-block').contains(event.target)) closeResults(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus(); search.select(); }
  });
  document.getElementById('search-shortcut').textContent = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K';

  const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const extension = file => (file.name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  function optionsFor(files) {
    return tools.filter(tool => files.every(file => tool.extensions.includes(extension(file)) || tool.mimeTypes.some(type => type.endsWith('/') ? file.type.startsWith(type) : type === file.type)));
  }
  function chooseFiles(files) {
    selectedFiles = Array.from(files || []).slice(0, 20);
    if (!selectedFiles.length) return;
    closeResults();
    transferStatus.textContent = '';
    transferStatus.classList.remove('error');
    document.getElementById('open-directly').hidden = true;
    document.getElementById('selected-file').textContent = selectedFiles.map(file => `${file.name} (${formatSize(file.size)})`).join(', ');
    conversionList.replaceChildren();
    const options = optionsFor(selectedFiles);
    if (!options.length) {
      const message = document.createElement('p');
      message.textContent = 'No matching tool was found for this selection. Choose one file type at a time, or browse the complete tool directory below.';
      conversionList.append(message);
    }
    for (const tool of options) {
      const choice = document.createElement('button');
      choice.type = 'button'; choice.className = 'conversion-choice';
      const name = document.createElement('span'); name.textContent = tool.name;
      const description = document.createElement('small'); description.textContent = tool.maxMB ? `${tool.description} · Up to ${tool.maxMB} MB per file` : `${tool.description} · Check the tool’s size limits`;
      choice.append(name, description);
      choice.addEventListener('click', () => startTransfer(tool));
      conversionList.append(choice);
    }
    fileDialog.showModal();
  }
  async function startTransfer(tool) {
    if (sending) return;
    selectedTool = tool;
    transferStatus.classList.remove('error');
    const tooLarge = tool.maxMB && selectedFiles.some(file => file.size > tool.maxMB * 1024 * 1024);
    if (tooLarge) {
      transferStatus.textContent = `This tool accepts files up to ${tool.maxMB} MB. Choose a smaller file, or open the tool for details.`;
      transferStatus.classList.add('error');
      document.getElementById('open-directly').hidden = false;
      return;
    }
    sending = true;
    for (const choice of conversionList.querySelectorAll('button')) choice.disabled = true;
    transferStatus.textContent = 'Preparing your file on this device…';
    try {
      if (!window.DropletTransfer) throw new Error('File transfer could not start. Reload the page or open the tool directly.');
      await window.DropletTransfer.send(selectedFiles, tool.page);
    } catch (error) {
      sending = false;
      for (const choice of conversionList.querySelectorAll('button')) choice.disabled = false;
      transferStatus.textContent = error.message || 'The transfer failed. Open the tool and choose your file there.';
      transferStatus.classList.add('error');
      document.getElementById('open-directly').hidden = false;
    }
  }
  document.getElementById('open-directly').addEventListener('click', () => { if (selectedTool) location.assign(selectedTool.page); });
  document.getElementById('select-file').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => chooseFiles(picker.files));
  fileDialog.addEventListener('close', () => { picker.value = ''; sending = false; });
  document.getElementById('file-dialog-close').addEventListener('click', () => fileDialog.close());
  dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('dragging'); });
  dropzone.addEventListener('dragleave', event => { if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging'); });
  dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('dragging'); chooseFiles(event.dataTransfer.files); });
  const menu = document.getElementById('mobile-menu');
  const menuButton = document.getElementById('mobile-menu-button');
  menuButton.addEventListener('click', () => { menu.showModal(); menuButton.setAttribute('aria-expanded', 'true'); });
  document.getElementById('mobile-menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('close', () => menuButton.setAttribute('aria-expanded', 'false'));
  for (const link of menu.querySelectorAll('a')) link.addEventListener('click', () => menu.close());
})();
