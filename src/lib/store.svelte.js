import { getNotes, getFolders, getNote, updateNote, createNote, deleteNote, moveNote, copyNote, renameNote, createFolder, renameFolder, moveFolder, deleteFolder } from './api.js';
import { themes, themeOrder, darkThemeOrder, lightThemeOrder, applyTheme, resolveTheme, loadThemeSettings, saveThemeSettings, watchSystemTheme } from './themes.js';
import { renderMarkdown } from './markdown.js';
import { createEditor, destroyEditor, updateTheme as updateEditorTheme, updateLineNumbers as updateEditorLineNumbers, getVimMode, getCursorPosition } from './editor.js';

// ── Core data ───────────────────────────────────────────────────
let allNotes = $state([]);
let allFolders = $state([]);
let displayItems = $state([]);
let currentDirNotes = $state([]);

// ── Navigation ──────────────────────────────────────────────────
let viewMode = $state('home');
let cursor = $state(0);
let currentDir = $state('/');
let selectedNote = $state(null);
let editMode = $state(false);
let content = $state('');
let title = $state('');

// ── Search ──────────────────────────────────────────────────────
let showSearch = $state(false);
let searchQuery = $state('');
let searchType = $state('filename');
let searchResults = $state([]);
let searchCursor = $state(0);

// ── Theme ───────────────────────────────────────────────────────
let themeMode = $state('dark');
let darkThemeName = $state('tokyo-night');
let lightThemeName = $state('tokyo-day');
let currentThemeName = $state('tokyo-night');
let cleanupSystemWatch = $state(null);

// ── Editor ──────────────────────────────────────────────────────
let editorView = $state(null);
let editorContainer = $state(null);
let vimMode = $state(null);
let cursorLine = $state(1);
let cursorCol = $state(1);
let vimPollInterval = $state(null);
let vimEnabled = $state(true);
let jjEscape = $state(false);
let relativeNumbers = $state(false);

// ── Config ──────────────────────────────────────────────────────
let configCursor = $state(1);
let previousView = $state('home');

// ── Folder preview ──────────────────────────────────────────────
let folderPreviewCache = $state({});
let folderPreviewNotes = $state([]);

// ── Command modal ───────────────────────────────────────────────
let cmdModal = $state(null);
let cmdInputValue = $state('');
let cmdSelectCursor = $state(0);

// ── Status ──────────────────────────────────────────────────────
let error = $state(null);
let saving = $state(false);

// ── Animation ───────────────────────────────────────────────────
let animProgress = $state(0);
let animDone = $state(false);

// ── Live preview toggle ─────────────────────────────────────────
let showPreview = $state(true);

// ── Logo ────────────────────────────────────────────────────────
const logoLines = [
  '  \u2588\u2588\u2557     \u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2557   \u2588\u2588\u2588\u2557\u2588\u2588\u2557',
  '  \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551',
  '  \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2588\u2588\u2588\u2588\u2554\u2588\u2588\u2551\u2588\u2588\u2551',
  '  \u2588\u2588\u2551     \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u255a\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2551',
  '  \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551 \u255a\u2550\u255d \u2588\u2588\u2551\u2588\u2588\u2551',
  '  \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d     \u255a\u2550\u255d\u255a\u2550\u255d',
];

const sampleMarkdown = [
  '# Heading 1',
  '## Heading 2',
  '### Heading 3',
  '',
  'Normal text with **bold** and *italic*.',
  'A `code span` and a [link](url).',
  '',
  '- List item one',
  '- Another with [[wikilink]]',
  '',
  '> Blockquote text here',
  '',
  '```',
  'code block line',
  '```',
  '',
  '---',
].join('\n');

// ── Shared logic functions ──────────────────────────────────────

function titleToId(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildItems() {
  const items = [];
  if (currentDir === '/') {
    // Show only top-level folders (no "/" in path)
    allFolders.filter(f => !f.path.includes('/')).forEach(f => {
      items.push({ type: 'folder', name: f.name, path: f.path, data: f });
    });
    allNotes.forEach(n => {
      items.push({ type: 'note', name: n.title || n.id, id: n.id, data: n });
    });
  } else {
    // Show direct child subfolders of currentDir
    const dirPath = currentDir.slice(1); // remove leading "/"
    allFolders.filter(f => {
      if (!f.path.startsWith(dirPath + '/')) return false;
      const rest = f.path.slice(dirPath.length + 1);
      return !rest.includes('/'); // direct child only
    }).forEach(f => {
      items.push({ type: 'folder', name: f.name, path: f.path, data: f });
    });
    currentDirNotes.forEach(n => {
      items.push({ type: 'note', name: n.title || n.id, id: n.id, data: n });
    });
  }
  displayItems = items;
  cursor = Math.min(cursor, Math.max(0, displayItems.length - 1));
}

function performSearch() {
  if (searchQuery === '') {
    searchResults = allNotes.map(n => ({
      type: 'note', name: n.title || n.id, id: n.id, data: n
    }));
  } else {
    const query = searchQuery.toLowerCase();
    searchResults = allNotes.filter(n => {
      if (searchType === 'filename') {
        return (n.title || n.id).toLowerCase().includes(query);
      } else {
        return (n.content || '').toLowerCase().includes(query);
      }
    }).map(n => ({
      type: 'note', name: n.title || n.id, id: n.id, data: n
    }));
  }
  searchCursor = 0;
}

function buildConfigItems() {
  return [
    { label: 'Theme', kind: 'header' },
    { label: 'Mode', kind: 'cycle', key: 'theme_mode', value: themeMode, options: ['dark', 'light', 'auto'] },
    { label: 'Dark theme', kind: 'cycle', key: 'dark_theme', value: darkThemeName, options: darkThemeOrder },
    { label: 'Light theme', kind: 'cycle', key: 'light_theme', value: lightThemeName, options: lightThemeOrder },
    { label: 'Editor', kind: 'header' },
    { label: 'Vim mode', kind: 'cycle', key: 'vim_mode', value: vimEnabled ? 'on' : 'off', options: ['on', 'off'] },
    { label: 'jj to esc', kind: 'cycle', key: 'jj_escape', value: jjEscape ? 'on' : 'off', options: ['on', 'off'] },
    { label: 'Relative number', kind: 'cycle', key: 'relative_numbers', value: relativeNumbers ? 'on' : 'off', options: ['on', 'off'] },
    { label: 'Display', kind: 'header' },
    { label: 'Search', kind: 'cycle', key: 'search_type', value: searchType, options: ['filename', 'content'] },
    { label: 'Live preview', kind: 'cycle', key: 'show_preview', value: showPreview ? 'on' : 'off', options: ['on', 'off'] },
  ];
}

function configCycleOption(direction) {
  const items = buildConfigItems();
  const item = items[configCursor];
  if (!item || item.kind !== 'cycle') return;
  const opts = item.options;
  let idx = opts.indexOf(item.value);
  if (idx === -1) idx = 0;
  idx += direction;
  if (idx < 0) idx = opts.length - 1;
  if (idx >= opts.length) idx = 0;
  const newValue = opts[idx];

  if (item.key === 'theme_mode') {
    themeMode = newValue;
    applyResolvedTheme();
    setupSystemWatch();
  } else if (item.key === 'dark_theme') {
    darkThemeName = newValue;
    applyResolvedTheme();
  } else if (item.key === 'light_theme') {
    lightThemeName = newValue;
    applyResolvedTheme();
  } else if (item.key === 'vim_mode') {
    vimEnabled = newValue === 'on';
    saveEditorSettings();
  } else if (item.key === 'jj_escape') {
    jjEscape = newValue === 'on';
    saveEditorSettings();
  } else if (item.key === 'relative_numbers') {
    relativeNumbers = newValue === 'on';
    saveEditorSettings();
    if (editorView) updateEditorLineNumbers(editorView, relativeNumbers);
  } else if (item.key === 'search_type') {
    searchType = newValue;
  } else if (item.key === 'show_preview') {
    showPreview = newValue === 'on';
    savePreviewSetting();
  }
}

function loadEditorSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('lumi-editor-settings'));
    if (s) {
      if (typeof s.vimEnabled === 'boolean') vimEnabled = s.vimEnabled;
      if (typeof s.jjEscape === 'boolean') jjEscape = s.jjEscape;
      if (typeof s.relativeNumbers === 'boolean') relativeNumbers = s.relativeNumbers;
    }
  } catch {}
}

function saveEditorSettings() {
  localStorage.setItem('lumi-editor-settings', JSON.stringify({ vimEnabled, jjEscape, relativeNumbers }));
}

function loadPreviewSetting() {
  try {
    const v = localStorage.getItem('lumi-show-preview');
    if (v !== null) showPreview = v !== 'off';
  } catch {}
}

function savePreviewSetting() {
  localStorage.setItem('lumi-show-preview', showPreview ? 'on' : 'off');
}

function loadThemeFromStorage() {
  const settings = loadThemeSettings();
  themeMode = settings.mode;
  darkThemeName = settings.darkName;
  lightThemeName = settings.lightName;
}

function applyResolvedTheme() {
  currentThemeName = resolveTheme(themeMode, darkThemeName, lightThemeName);
  applyTheme(currentThemeName);
  saveThemeSettings(themeMode, darkThemeName, lightThemeName);
  if (editorView) updateEditorTheme(editorView);
}

function setupSystemWatch() {
  if (cleanupSystemWatch) cleanupSystemWatch();
  if (themeMode === 'auto') {
    cleanupSystemWatch = watchSystemTheme(() => applyResolvedTheme());
  } else {
    cleanupSystemWatch = null;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

async function loadAll() {
  try {
    error = null;
    allNotes = await getNotes('');
    allFolders = await getFolders();
    buildItems();
  } catch (err) {
    error = 'Failed to load: ' + err.message;
  }
}

async function openNote(item) {
  try {
    error = null;
    const note = await getNote(item.id);
    selectedNote = note;
    title = note.title || '';
    content = note.content || '';
    viewMode = 'note';
    editMode = false;
  } catch (err) {
    error = `Failed to open: ${err.message}`;
  }
}

async function enterFolder(folder) {
  const path = folder.path || folder.name;
  try {
    currentDirNotes = await getNotes(path) || [];
    currentDir = '/' + path;
    buildItems();
    cursor = 0;
  } catch (err) {
    error = `Failed to open folder: ${err.message}`;
  }
}

async function goBackDir() {
  if (currentDir === '/') return;
  const parts = currentDir.slice(1).split('/');
  parts.pop();
  if (parts.length === 0) {
    currentDir = '/';
    currentDirNotes = [];
  } else {
    const parentPath = parts.join('/');
    currentDir = '/' + parentPath;
    try {
      currentDirNotes = await getNotes(parentPath) || [];
    } catch {
      currentDirNotes = [];
    }
  }
  buildItems();
  cursor = 0;
}

async function loadFolderPreview(folderPath) {
  if (folderPreviewCache[folderPath]) {
    folderPreviewNotes = folderPreviewCache[folderPath];
    return;
  }
  try {
    const notes = await getNotes(folderPath) || [];
    folderPreviewCache[folderPath] = notes;
    const item = displayItems[cursor];
    if ((item?.path || item?.name) === folderPath) {
      folderPreviewNotes = notes;
    }
  } catch {
    folderPreviewNotes = [];
  }
}

async function handleNoteClick(e) {
  const link = e.target.closest('.md-wikilink');
  if (!link) return;
  e.preventDefault();
  const ref = link.dataset.note;
  if (!ref) return;

  const lower = ref.toLowerCase();
  const localMatch = allNotes.find(n =>
    n.id === ref || n.id === lower ||
    n.id === lower.replace(/\s+/g, '-') ||
    (n.title && n.title.toLowerCase() === lower)
  );

  if (localMatch) {
    await openNote({ id: localMatch.id });
  } else {
    try {
      await openNote({ id: ref });
    } catch {
      error = `Note not found: ${ref}`;
    }
  }
}

async function save() {
  if (!selectedNote) return;
  try {
    saving = true;
    error = null;
    await updateNote(selectedNote.id, { title, content });
  } catch (err) {
    error = `Save failed: ${err.message}`;
  } finally {
    saving = false;
  }
}

function enterConfig() {
  previousView = viewMode;
  configCursor = 1;
  viewMode = 'config';
}

function configMoveDown() {
  const items = buildConfigItems();
  for (let i = configCursor + 1; i < items.length; i++) {
    if (items[i].kind !== 'header') { configCursor = i; return; }
  }
}

function configMoveUp() {
  const items = buildConfigItems();
  for (let i = configCursor - 1; i >= 0; i--) {
    if (items[i].kind !== 'header') { configCursor = i; return; }
  }
}

function cleanupEditor() {
  if (editorView) {
    destroyEditor(editorView);
    editorView = null;
  }
  if (vimPollInterval) {
    clearInterval(vimPollInterval);
    vimPollInterval = null;
  }
  vimMode = null;
}

function setupEditor(container) {
  if (!container || editorView) return;
  editorView = createEditor(container, content, {
    onChange: (newContent) => { content = newContent; },
    onSave: () => save(),
    onQuit: () => { editMode = false; },
    vimEnabled,
    jjEscape,
    relativeLineNumbers: relativeNumbers,
  });
  editorView.focus();
  vimPollInterval = setInterval(() => {
    if (editorView) {
      vimMode = getVimMode(editorView);
      const pos = getCursorPosition(editorView);
      cursorLine = pos.line;
      cursorCol = pos.col;
    }
  }, 100);
}

async function submitCmd() {
  if (!cmdModal || cmdModal.kind !== 'input') return;
  const val = cmdInputValue.trim();
  if (!val) return;
  const fn = cmdModal.onSubmit;
  cmdModal = null;
  cmdInputValue = '';
  await fn(val);
}

function cmdNewNote() {
  cmdInputValue = '';
  cmdModal = {
    kind: 'input',
    title: 'New Note',
    placeholder: 'Note title...',
    async onSubmit(value) {
      const id = titleToId(value);
      const folder = currentDir === '/' ? '' : currentDir.slice(1);
      try {
        const note = await createNote({ id, title: value, content: `# ${value}\n\n`, tags: [], folder });
        allNotes = [...allNotes, note];
        buildItems();
        await openNote({ id: note.id });
        editMode = true;
      } catch (err) {
        error = `Create failed: ${err.message}`;
      }
    }
  };
}

function cmdNewFolder() {
  cmdInputValue = '';
  cmdModal = {
    kind: 'input',
    title: 'New Folder',
    placeholder: 'Folder name...',
    async onSubmit(value) {
      try {
        await createFolder(value);
        allFolders = await getFolders();
        buildItems();
      } catch (err) {
        error = `Create folder failed: ${err.message}`;
      }
    }
  };
}

function cmdRenameItem() {
  const item = displayItems[cursor];
  if (!item) return;
  if (item.type === 'folder') {
    cmdRenameFolder();
    return;
  }
  if (item.type !== 'note') return;
  cmdInputValue = item.name;
  cmdModal = {
    kind: 'input',
    title: 'Rename Note',
    placeholder: 'New title...',
    async onSubmit(value) {
      const newId = titleToId(value);
      try {
        const note = await renameNote(item.id, newId, value);
        await loadAll();
        if (currentDir !== '/') {
          const path = currentDir.slice(1);
          currentDirNotes = await getNotes(path) || [];
          buildItems();
        }
        if (selectedNote && selectedNote.id === item.id) {
          selectedNote = note;
          title = note.title || '';
        }
      } catch (err) {
        error = `Rename failed: ${err.message}`;
      }
    }
  };
}

function cmdRenameFolder() {
  const item = displayItems[cursor];
  if (!item || item.type !== 'folder') return;
  cmdInputValue = item.name;
  cmdModal = {
    kind: 'input',
    title: 'Rename Folder',
    placeholder: 'New name...',
    async onSubmit(value) {
      try {
        await renameFolder(item.name, value);
        allFolders = await getFolders();
        folderPreviewCache = {};
        buildItems();
      } catch (err) {
        error = `Rename folder failed: ${err.message}`;
      }
    }
  };
}

function cmdMoveNote() {
  const item = displayItems[cursor];
  if (!item || item.type !== 'note') return;
  const items = [
    { label: '/ (root)', value: '' },
    ...allFolders.map(f => ({ label: f.path + '/', value: f.path }))
  ];
  cmdSelectCursor = 0;
  cmdModal = {
    kind: 'select',
    title: `Move "${item.name}"`,
    items,
    async onSubmit(folder) {
      try {
        await moveNote(item.id, folder);
        await loadAll();
        if (currentDir !== '/') {
          const path = currentDir.slice(1);
          currentDirNotes = await getNotes(path) || [];
          buildItems();
        }
      } catch (err) {
        error = `Move failed: ${err.message}`;
      }
    }
  };
}

function cmdMoveFolder() {
  const item = displayItems[cursor];
  if (!item || item.type !== 'folder') return;
  const folderPath = item.path || item.name;
  const items = [
    { label: '/ (root)', value: '' },
    ...allFolders
      .filter(f => f.path !== folderPath && !f.path.startsWith(folderPath + '/'))
      .map(f => ({ label: f.path + '/', value: f.path }))
  ];
  cmdSelectCursor = 0;
  cmdModal = {
    kind: 'select',
    title: `Move "${item.name}/"`,
    items,
    async onSubmit(dest) {
      try {
        await moveFolder(folderPath, dest);
        await loadAll();
        buildItems();
      } catch (err) {
        error = `Move failed: ${err.message}`;
      }
    }
  };
}

function cmdMoveItem() {
  const item = displayItems[cursor];
  if (!item) return;
  if (item.type === 'folder') { cmdMoveFolder(); return; }
  if (item.type === 'note') { cmdMoveNote(); return; }
}

function cmdCopyNote() {
  const item = displayItems[cursor];
  if (!item || item.type !== 'note') return;
  cmdInputValue = item.name + ' (copy)';
  cmdModal = {
    kind: 'input',
    title: 'Copy Note',
    placeholder: 'Title for copy...',
    async onSubmit(value) {
      const newId = titleToId(value);
      try {
        const note = await copyNote(item.id, newId, value);
        allNotes = [...allNotes, note];
        buildItems();
      } catch (err) {
        error = `Copy failed: ${err.message}`;
      }
    }
  };
}

function cmdDeleteItem() {
  const item = displayItems[cursor];
  if (!item) return;
  if (item.type === 'folder') {
    cmdDeleteFolder();
    return;
  }
  if (item.type !== 'note') return;
  cmdModal = {
    kind: 'confirm',
    title: 'Delete Note',
    message: `Delete "${item.name}"?`,
    async onSubmit() {
      try {
        await deleteNote(item.id);
        allNotes = allNotes.filter(n => n.id !== item.id);
        buildItems();
        if (selectedNote && selectedNote.id === item.id) {
          selectedNote = null;
          content = '';
          title = '';
        }
      } catch (err) {
        error = `Delete failed: ${err.message}`;
      }
    }
  };
}

function cmdDeleteFolder() {
  const item = displayItems[cursor];
  if (!item || item.type !== 'folder') return;
  cmdModal = {
    kind: 'confirm',
    title: 'Delete Folder',
    message: `Delete folder "${item.name}" and all its contents?`,
    async onSubmit() {
      try {
        await deleteFolder(item.name);
        allFolders = await getFolders();
        folderPreviewCache = {};
        buildItems();
      } catch (err) {
        error = `Delete folder failed: ${err.message}`;
      }
    }
  };
}

function cmdDeleteCurrentNote() {
  if (!selectedNote) return;
  const note = selectedNote;
  cmdModal = {
    kind: 'confirm',
    title: 'Delete Note',
    message: `Delete "${note.title || note.id}"?`,
    async onSubmit() {
      try {
        await deleteNote(note.id);
        allNotes = allNotes.filter(n => n.id !== note.id);
        selectedNote = null;
        content = '';
        title = '';
        viewMode = 'tree';
        buildItems();
      } catch (err) {
        error = `Delete failed: ${err.message}`;
      }
    }
  };
}

async function handleWsMessage(msg) {
  if (!msg || !msg.type || !msg.note) return;

  folderPreviewCache = {};

  if (msg.type === 'note_updated') {
    if (editMode && selectedNote && msg.note.id === selectedNote.id) return;
    const idx = allNotes.findIndex(n => n.id === msg.note.id);
    if (idx !== -1) {
      allNotes[idx] = msg.note;
      allNotes = [...allNotes];
    }
    if (selectedNote && msg.note.id === selectedNote.id) {
      selectedNote = msg.note;
      title = msg.note.title || '';
      content = msg.note.content || '';
    }
  } else if (msg.type === 'note_created') {
    if (!allNotes.find(n => n.id === msg.note.id)) {
      allNotes = [...allNotes, msg.note];
    }
  } else if (msg.type === 'note_deleted') {
    allNotes = allNotes.filter(n => n.id !== msg.note.id);
    if (selectedNote && msg.note.id === selectedNote.id) {
      selectedNote = null;
      content = '';
      title = '';
      if (viewMode === 'note') viewMode = 'tree';
    }
  }

  try {
    allFolders = await getFolders();
  } catch {}
  if (currentDir !== '/') {
    try {
      const path = currentDir.slice(1);
      currentDirNotes = await getNotes(path) || [];
    } catch {}
  }

  buildItems();
}

// ── Export store as getters/setters ─────────────────────────────

export const store = {
  // Core data
  get allNotes() { return allNotes; },
  set allNotes(v) { allNotes = v; },
  get allFolders() { return allFolders; },
  set allFolders(v) { allFolders = v; },
  get displayItems() { return displayItems; },
  get currentDirNotes() { return currentDirNotes; },

  // Navigation
  get viewMode() { return viewMode; },
  set viewMode(v) { viewMode = v; },
  get cursor() { return cursor; },
  set cursor(v) { cursor = v; },
  get currentDir() { return currentDir; },
  set currentDir(v) { currentDir = v; },
  get selectedNote() { return selectedNote; },
  set selectedNote(v) { selectedNote = v; },
  get editMode() { return editMode; },
  set editMode(v) { editMode = v; },
  get content() { return content; },
  set content(v) { content = v; },
  get title() { return title; },
  set title(v) { title = v; },

  // Search
  get showSearch() { return showSearch; },
  set showSearch(v) { showSearch = v; },
  get searchQuery() { return searchQuery; },
  set searchQuery(v) { searchQuery = v; },
  get searchType() { return searchType; },
  get searchResults() { return searchResults; },
  get searchCursor() { return searchCursor; },
  set searchCursor(v) { searchCursor = v; },

  // Theme
  get themeMode() { return themeMode; },
  get darkThemeName() { return darkThemeName; },
  get lightThemeName() { return lightThemeName; },
  get currentThemeName() { return currentThemeName; },
  get currentTheme() { return themes[currentThemeName]; },

  // Editor
  get editorView() { return editorView; },
  set editorView(v) { editorView = v; },
  get editorContainer() { return editorContainer; },
  set editorContainer(v) { editorContainer = v; },
  get vimMode() { return vimMode; },
  get cursorLine() { return cursorLine; },
  get cursorCol() { return cursorCol; },
  get vimEnabled() { return vimEnabled; },
  get jjEscape() { return jjEscape; },
  get relativeNumbers() { return relativeNumbers; },

  // Config
  get configCursor() { return configCursor; },
  set configCursor(v) { configCursor = v; },
  get previousView() { return previousView; },

  // Folder preview
  get folderPreviewNotes() { return folderPreviewNotes; },
  set folderPreviewNotes(v) { folderPreviewNotes = v; },
  get folderPreviewCache() { return folderPreviewCache; },

  // Command modal
  get cmdModal() { return cmdModal; },
  set cmdModal(v) { cmdModal = v; },
  get cmdInputValue() { return cmdInputValue; },
  set cmdInputValue(v) { cmdInputValue = v; },
  get cmdSelectCursor() { return cmdSelectCursor; },
  set cmdSelectCursor(v) { cmdSelectCursor = v; },

  // Status
  get error() { return error; },
  set error(v) { error = v; },
  get saving() { return saving; },

  // Animation
  get animProgress() { return animProgress; },
  set animProgress(v) { animProgress = v; },
  get animDone() { return animDone; },
  set animDone(v) { animDone = v; },

  // Preview toggle
  get showPreview() { return showPreview; },
  set showPreview(v) { showPreview = v; },

  // Constants
  logoLines,
  sampleMarkdown,

  // Functions
  titleToId,
  buildItems,
  performSearch,
  buildConfigItems,
  configCycleOption,
  loadEditorSettings,
  saveEditorSettings,
  loadPreviewSetting,
  loadThemeFromStorage,
  applyResolvedTheme,
  setupSystemWatch,
  formatDate,
  loadAll,
  openNote,
  enterFolder,
  goBackDir,
  loadFolderPreview,
  handleNoteClick,
  save,
  enterConfig,
  configMoveDown,
  configMoveUp,
  cleanupEditor,
  setupEditor,
  submitCmd,
  cmdNewNote,
  cmdNewFolder,
  cmdRenameItem,
  cmdRenameFolder,
  cmdMoveNote,
  cmdMoveFolder,
  cmdMoveItem,
  cmdCopyNote,
  cmdDeleteItem,
  cmdDeleteFolder,
  cmdDeleteCurrentNote,
  handleWsMessage,
  renderMarkdown,
};
