const $ = selector => document.querySelector(selector);
const stageNames = { sprout: '嫩芽', bud: '花苞', bloom: '已开花' };
const sheetNames = { sprout: 'sprouts', bud: 'buds', bloom: 'blooms' };
const spots = [13, 32, 50, 68, 87].flatMap(x => [16, 38, 61, 84].map(y => ({ x, y })));
const TAG_KEY = 'inspiration-garden-tags-v2';
let ideas = [], tags = ['生活', '学习', '情感'], view = 'garden', filter = '全部', selectedId = null, editingId = null, freshId = null;
let category = '生活', photo = null, audio = null, recorder = null, stream = null, recordTimer = null;
let placing = false, spot = null, detailURLs = [], menuOpen = null;

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('inspiration-garden-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('ideas', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function storeRequest(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('ideas', mode);
    const request = action(transaction.objectStore('ideas'));
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}
const readAll = () => storeRequest('readonly', store => store.getAll());
const writeIdea = idea => storeRequest('readwrite', store => store.put(idea));
const removeIdea = id => storeRequest('readwrite', store => store.delete(id));
const isWilted = idea => idea.stage !== 'bloom' && Date.now() - Date.parse(idea.lastTendedAt) >= 10 * 86400000;
const dateLabel = iso => new Date(iso).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
const validTag = value => value.trim().length > 0 && value.trim().length <= 12 && !/[\r\n\t]/.test(value);
function saveTags() { localStorage.setItem(TAG_KEY, JSON.stringify(tags)); }
function loadTags() {
  try { const saved = JSON.parse(localStorage.getItem(TAG_KEY)); if (Array.isArray(saved)) tags = saved.filter(t => typeof t === 'string' && validTag(t)); }
  catch { /* keep defaults */ }
  for (const idea of ideas) if (validTag(idea.category) && !tags.includes(idea.category)) tags.push(idea.category);
  saveTags(); category = tags[0] || '';
}
function sprite(idea, extraClass = '') {
  const art = document.createElement('span');
  const positions = [['0%', '0%'], ['100%', '0%'], ['0%', '100%'], ['100%', '100%']];
  const [x, y] = positions[idea.flower % 4];
  art.className = `plant-art ${isWilted(idea) ? 'wilted' : ''} ${extraClass}`;
  art.style.backgroundImage = `url('./assets/flowers/${sheetNames[idea.stage]}.png')`;
  art.style.backgroundPosition = `${x} ${y}`;
  art.setAttribute('aria-hidden', 'true'); return art;
}
function hash(value) { let result = 2166136261; for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619); return (result >>> 0) / 4294967295; }
function arrange(items) {
  const available = [...spots], placed = items.filter(i => Number.isInteger(i.x) && Number.isInteger(i.y)).map(i => ({ x: i.x, y: i.y })), positions = new Map();
  for (const item of [...items].reverse()) {
    if (Number.isInteger(item.x) && Number.isInteger(item.y)) { positions.set(item.id, { x: item.x, y: item.y }); continue; }
    let best = 0, score = -Infinity;
    available.forEach((candidate, index) => {
      const distance = placed.length ? Math.min(...placed.map(p => Math.hypot(candidate.x - p.x, (candidate.y - p.y) * .8))) : 0;
      const rating = distance + hash(item.id + ':' + index) * .15;
      if (rating > score) { score = rating; best = index; }
    });
    const next = available.splice(best, 1)[0]; if (!next) break;
    placed.push(next); positions.set(item.id, next);
  }
  return positions;
}
async function refresh() { ideas = (await readAll()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); render(); }
function render() {
  $('#count-label').textContent = ideas.length ? `${ideas.length} 株灵感` : '一方小花园';
  $('#garden-screen').hidden = view !== 'garden'; $('#list-screen').hidden = view !== 'list';
  $('#nav-garden').classList.toggle('active', view === 'garden'); $('#nav-list').classList.toggle('active', view === 'list');
  $('#nav-garden').setAttribute('aria-current', view === 'garden' ? 'page' : 'false');
  $('#nav-list').setAttribute('aria-current', view === 'list' ? 'page' : 'false');
  renderGarden(); renderList();
}
function renderGarden() {
  const field = $('#flower-field'); field.replaceChildren();
  $('#garden-empty').hidden = ideas.length > 0 || placing;
  $('#garden-hint').textContent = placing ? '轻点草地选择位置，避开已有的小花' : ideas.length > 20 ? '草地展示最近 20 株，更多在灵感手记。' : '跟进会长成花苞，行动会让它开花。';
  $('#plant-open').hidden = placing; $('#placement-actions').hidden = !placing; $('#placement-surface').hidden = !placing;
  $('#placement-marker').hidden = !placing || !spot; $('#placement-confirm').disabled = !spot;
  if (spot) { $('#placement-marker').style.left = spot.x + '%'; $('#placement-marker').style.top = spot.y + '%'; }
  const visible = ideas.slice(0, 20), layout = arrange(visible);
  visible.forEach((idea, index) => {
    const position = layout.get(idea.id); if (!position) return;
    const plant = document.createElement('button'); plant.type = 'button';
    plant.className = `garden-plant ${idea.stage} ${freshId === idea.id ? 'plant-grow' : ''}`;
    plant.style.left = position.x + '%'; plant.style.top = position.y + '%'; plant.style.zIndex = position.y;
    plant.setAttribute('aria-label', `查看${idea.category}${stageNames[idea.stage]}：${idea.text || '语音或照片'}`);
    const sway = document.createElement('span'); sway.className = 'plant-sway'; sway.style.animationDelay = `${(index % 7) * -.42}s`;
    sway.append(sprite(idea)); plant.append(sway);
    plant.addEventListener('click', () => openDetail(idea.id)); field.append(plant);
  });
}
function renderList() {
  const filters = $('#filters'); filters.replaceChildren();
  for (const label of ['全部', ...tags]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.classList.toggle('active', filter === label);
    button.addEventListener('click', () => { filter = label; renderList(); }); filters.append(button);
  }
  const list = $('#list-scroll'); list.replaceChildren();
  const filtered = ideas.filter(idea => filter === '全部' || idea.category === filter);
  if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'list-empty'; empty.textContent = '这里还没有灵感，去种下一颗嫩芽吧。'; list.append(empty); return; }
  for (const idea of filtered) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'entry-card';
    const content = document.createElement('span'); content.className = 'entry-copy';
    const meta = document.createElement('span'); meta.className = 'entry-meta';
    meta.textContent = `${idea.category} · ${stageNames[idea.stage]}${isWilted(idea) ? ' · 待唤醒' : ''} · ${dateLabel(idea.createdAt)}`;
    const title = document.createElement('strong'); title.textContent = idea.text || (idea.audio ? '一段声音的灵感' : '一张照片的灵感');
    const attachment = document.createElement('small'); attachment.textContent = [idea.audio && '♫ 语音', idea.photo && '▧ 照片'].filter(Boolean).join(' · ');
    content.append(meta, title, attachment); card.append(sprite(idea), content);
    card.addEventListener('click', () => openDetail(idea.id)); list.append(card);
  }
}
function tagError(message = '') { $('#tag-error').textContent = message; }
function renderTags() {
  $('#tag-current').textContent = category || '添加标签';
  const list = $('#tag-options'); list.replaceChildren();
  for (const label of tags) {
    const row = document.createElement('div'); row.className = 'tag-row';
    const remove = document.createElement('button'); remove.className = 'tag-delete'; remove.type = 'button'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除标签${label}`);
    remove.addEventListener('click', () => deleteTag(label));
    const choose = document.createElement('button'); choose.className = 'tag-choice'; choose.type = 'button'; choose.textContent = label + (category === label ? ' ✓' : '');
    choose.addEventListener('click', () => { category = label; $('#tag-popover').hidden = true; renderTags(); });
    const rename = document.createElement('button'); rename.className = 'tag-rename'; rename.type = 'button'; rename.textContent = '✎'; rename.setAttribute('aria-label', `修改标签${label}`);
    rename.addEventListener('click', () => editTag(row, label));
    let start = null;
    row.addEventListener('touchstart', e => { start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    row.addEventListener('touchend', e => { if (!start) return; const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y; if (dx > 45 && Math.abs(dy) < 35) row.classList.add('revealed'); else if (dx < -35) row.classList.remove('revealed'); start = null; });
    row.append(remove, choose, rename); list.append(row);
  }
}
function editTag(row, oldName) {
  row.replaceChildren(); row.classList.remove('revealed');
  const input = document.createElement('input'); input.value = oldName; input.maxLength = 12; input.setAttribute('aria-label', '修改标签名称');
  const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存';
  const apply = async () => {
    const name = input.value.trim(); if (!validTag(name)) { tagError('标签名称需为 1–12 个字。'); return; }
    if (name !== oldName && tags.includes(name)) { tagError('这个标签已经存在。'); return; }
    try {
      for (const idea of ideas.filter(i => i.category === oldName)) await writeIdea({ ...idea, category: name });
      tags = tags.map(t => t === oldName ? name : t); saveTags();
      if (category === oldName) category = name; if (filter === oldName) filter = name;
      tagError(); await refresh(); renderTags();
    } catch { tagError('修改失败，请检查浏览器存储空间。'); }
  };
  save.addEventListener('click', apply); input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') renderTags(); });
  row.append(input, save); input.focus();
}
async function deleteTag(label) {
  if (!confirm(`删除标签“${label}”？使用它的灵感会移到其他标签，灵感本身保留。`)) return;
  const fallback = label === '未分类' ? '生活' : '未分类';
  try {
    const affected = ideas.filter(i => i.category === label);
    for (const idea of affected) await writeIdea({ ...idea, category: fallback });
    tags = tags.filter(t => t !== label);
    if (affected.length && !tags.includes(fallback)) tags.push(fallback);
    saveTags(); if (category === label) category = tags[0] || ''; if (filter === label) filter = '全部';
    tagError(); await refresh(); renderTags();
  } catch { tagError('删除失败，请检查浏览器存储空间。'); }
}
function addTag() {
  const name = $('#tag-new').value.trim();
  if (!validTag(name)) { tagError('标签名称需为 1–12 个字。'); return; }
  if (tags.includes(name)) { tagError('这个标签已经存在。'); return; }
  try { tags.push(name); saveTags(); category = name; $('#tag-new').value = ''; tagError(); renderTags(); renderList(); }
  catch { tagError('新建失败，浏览器存储不可用。'); }
}
function resetComposer() {
  editingId = null; category = tags[0] || ''; photo = null; audio = null; spot = null;
  $('#idea-text').value = ''; $('#composer-error').textContent = ''; $('#tag-popover').hidden = true;
  $('#photo-input').value = ''; $('#camera-input').value = ''; $('#composer-title').textContent = '种下一颗灵感';
  $('#save-idea').textContent = '下一步 · 选择种植位置'; updateAttachments(); renderTags();
}
function openComposer() { placing = false; resetComposer(); renderGarden(); $('#composer').showModal(); }
function closeComposer() { stopRecording(true); if ($('#composer').open) $('#composer').close(); }
function updateAttachments() {
  const status = $('#attachment-status'); status.replaceChildren();
  for (const [kind, blob, label] of [['photo', photo, '▧ 照片已选择'], ['audio', audio, '♫ 语音已录好']]) {
    if (!blob) continue;
    const chip = document.createElement('span'); chip.textContent = label + ' ';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `移除${kind === 'photo' ? '照片' : '语音'}`);
    remove.addEventListener('click', () => { if (kind === 'photo') photo = null; else audio = null; updateAttachments(); });
    chip.append(remove); status.append(chip);
  }
}
function choosePhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/') || file.size > 10000000) { $('#composer-error').textContent = '请选择不超过 10 MB 的图片。'; return; }
  photo = file; $('#composer-error').textContent = ''; updateAttachments();
}
async function startRecording() {
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('unsupported');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = [];
    const currentRecorder = new MediaRecorder(stream); recorder = currentRecorder;
    currentRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    currentRecorder.onstop = () => {
      if (!$('#composer').open) return;
      audio = new Blob(chunks, { type: currentRecorder.mimeType || 'audio/mp4' });
      stream?.getTracks().forEach(track => track.stop()); stream = null; updateAttachments();
      $('#record-audio').classList.remove('recording'); $('#record-audio span').textContent = '录语音';
    };
    recorder.start(); recordTimer = setTimeout(stopRecording, 60000);
    $('#record-audio').classList.add('recording'); $('#record-audio span').textContent = '结束录音'; $('#composer-error').textContent = '';
  } catch { stream?.getTracks().forEach(track => track.stop()); stream = null; $('#composer-error').textContent = '无法使用麦克风，请允许权限或改用文字。'; }
}
function stopRecording(discard = false) {
  clearTimeout(recordTimer); recordTimer = null;
  if (discard && recorder) recorder.onstop = null;
  if (recorder?.state === 'recording') recorder.stop(); else stream?.getTracks().forEach(track => track.stop());
  if (discard) { stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null; }
  $('#record-audio').classList.remove('recording'); $('#record-audio span').textContent = '录语音';
}
function startPlanting() {
  if (!category || (!$('#idea-text').value.trim() && !photo && !audio)) { $('#composer-error').textContent = '请选标签，并写一句话、录一段声音或添加照片。'; return; }
  placing = true; spot = null; view = 'garden'; closeComposer(); render();
}
function selectSpot(event) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = Math.round((event.clientX - box.left) / box.width * 100), y = Math.round((event.clientY - box.top) / box.height * 100);
  if (x < 9 || x > 91 || y < 12 || y > 88) { $('#garden-hint').textContent = '请点草地中间一点的位置。'; return; }
  const layout = arrange(ideas.slice(0, 20));
  if ([...layout.values()].some(p => Math.hypot(p.x - x, (p.y - y) * .8) < 14)) { $('#garden-hint').textContent = '这里离另一株太近了，换个位置吧。'; return; }
  spot = { x, y }; renderGarden();
}
async function saveIdea() {
  const text = $('#idea-text').value.trim(), id = editingId;
  if (!category || (!text && !photo && !audio)) { $('#composer-error').textContent = '请选标签，并至少保留文字、照片或语音。'; return; }
  if (!id && !spot) { $('#garden-hint').textContent = '请先点选草地上的位置。'; return; }
  const button = id ? $('#save-idea') : $('#placement-confirm'); button.disabled = true;
  try {
    const now = new Date().toISOString();
    const original = id ? ideas.find(i => i.id === id) : null;
    const idea = original ? { ...original, text, category, photo, audio } : { id: crypto.randomUUID(), text, category, stage: 'sprout', flower: Math.floor(Math.random() * 4), createdAt: now, lastTendedAt: now, notes: [], photo, audio, x: spot.x, y: spot.y };
    await writeIdea(idea); placing = false; spot = null; closeComposer(); resetComposer(); await refresh();
    if (id) await openDetail(id);
    else { freshId = idea.id; renderGarden(); setTimeout(() => { freshId = null; renderGarden(); }, 1800); }
  } catch { const message = '保存失败，请检查存储空间；你写的内容仍会保留。'; if (id) $('#composer-error').textContent = message; else $('#garden-hint').textContent = message; }
  finally { button.disabled = false; }
}
function releaseMediaURLs() { detailURLs.forEach(URL.revokeObjectURL); detailURLs = []; }
async function openDetail(id) {
  selectedId = id; const original = ideas.find(i => i.id === id); if (!original) return;
  $('#detail-error').textContent = '';
  let idea = original;
  if (isWilted(idea)) {
    try { idea = { ...idea, lastTendedAt: new Date().toISOString() }; await writeIdea(idea); await refresh(); }
    catch { $('#detail-error').textContent = '唤醒失败，请检查存储空间。'; }
  }
  $('#progress-text').value = ''; renderDetail(idea); if (!$('#detail').open) $('#detail').showModal();
}
function toggleMenu(target) {
  for (const menu of document.querySelectorAll('.more-menu')) if (menu !== target) menu.hidden = true;
  target.hidden = !target.hidden; menuOpen = target.hidden ? null : target;
}
function renderDetail(idea) {
  releaseMediaURLs(); $('#detail-art').replaceChildren(sprite(idea));
  $('#detail-meta').textContent = `${idea.category} · ${stageNames[idea.stage]} · ${dateLabel(idea.createdAt)}`;
  $('#detail-text').textContent = idea.text; $('#idea-menu').hidden = true;
  const media = $('#detail-media'); media.replaceChildren();
  if (idea.photo) { const image = document.createElement('img'); image.className = 'detail-photo'; image.alt = '灵感照片'; const url = URL.createObjectURL(idea.photo); detailURLs.push(url); image.src = url; media.append(image); }
  if (idea.audio) { const player = document.createElement('audio'); player.className = 'detail-audio'; player.controls = true; const url = URL.createObjectURL(idea.audio); detailURLs.push(url); player.src = url; media.append(player); }
  const history = $('#detail-history'); history.replaceChildren();
  for (const note of idea.notes) {
    const entry = document.createElement('div'); entry.className = 'progress-entry';
    const top = document.createElement('div'); top.className = 'progress-entry-top';
    const meta = document.createElement('small'); meta.textContent = `${note.kind === 'outcome' ? '执行与成果' : '跟进'} · ${dateLabel(note.createdAt)}`;
    const menuWrap = document.createElement('div'); menuWrap.className = 'more-wrap';
    const trigger = document.createElement('button'); trigger.className = 'more-button'; trigger.type = 'button'; trigger.textContent = '⋯'; trigger.setAttribute('aria-label', '记录更多操作');
    const menu = document.createElement('div'); menu.className = 'more-menu'; menu.hidden = true;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '修改记录'; edit.addEventListener('click', () => { menu.hidden = true; showNoteEditor(entry, idea, note); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除记录'; remove.addEventListener('click', () => deleteNote(idea, note));
    trigger.addEventListener('click', () => toggleMenu(menu)); menu.append(edit, remove); menuWrap.append(trigger, menu); top.append(meta, menuWrap);
    const content = document.createElement('p'); content.textContent = note.text; entry.append(top, content); history.append(entry);
  }
  $('#progress-form').hidden = idea.stage === 'bloom';
  $('#progress-prompt').textContent = idea.stage === 'sprout' ? '有新想法或进展了吗？' : '付诸行动了吗？记下执行或成果。';
  $('#save-progress').textContent = idea.stage === 'sprout' ? '记录跟进 · 长成花苞' : '记录成果';
  $('#extra-followup').hidden = idea.stage !== 'bud';
  $('#progress-hint').textContent = idea.stage === 'bloom' ? '这份灵感已经开花了 ✿' : '10 天没有互动会稍微枯萎；点开就能唤醒。';
}
function showNoteEditor(entry, idea, note) {
  const editor = document.createElement('div'); editor.className = 'note-editor';
  const input = document.createElement('textarea'); input.value = note.text; input.maxLength = 3000; input.setAttribute('aria-label', '修改生长记录');
  const buttons = document.createElement('div');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.addEventListener('click', () => renderDetail(idea));
  const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存';
  save.addEventListener('click', async () => {
    const text = input.value.trim(); if (!text) { $('#detail-error').textContent = '记录不能为空。'; return; }
    const updated = { ...idea, notes: idea.notes.map(n => n.id === note.id ? { ...n, text } : n) };
    try { await writeIdea(updated); await refresh(); renderDetail(updated); $('#detail-error').textContent = ''; }
    catch { $('#detail-error').textContent = '修改失败，请稍后重试。'; }
  });
  buttons.append(cancel, save); editor.append(input, buttons); entry.querySelector('p').replaceWith(editor); input.focus();
}
async function deleteNote(idea, note) {
  if (!confirm('删除这条生长记录？删除后花朵可能回到前一阶段，记录无法恢复。')) return;
  const notes = idea.notes.filter(n => n.id !== note.id);
  const stage = notes.some(n => n.kind === 'outcome') ? 'bloom' : notes.some(n => n.kind === 'followup') ? 'bud' : 'sprout';
  const updated = { ...idea, notes, stage };
  try { await writeIdea(updated); await refresh(); renderDetail(updated); }
  catch { $('#detail-error').textContent = '删除失败，请稍后重试。'; }
}
function openEditor() {
  const idea = ideas.find(i => i.id === selectedId); if (!idea) return;
  editingId = idea.id; category = idea.category; photo = idea.photo || null; audio = idea.audio || null;
  $('#detail').close(); $('#idea-text').value = idea.text; $('#composer-error').textContent = '';
  $('#composer-title').textContent = '修改这条灵感'; $('#save-idea').textContent = '保存修改';
  renderTags(); updateAttachments(); $('#composer').showModal();
}
async function deleteSelected() {
  const id = selectedId; if (!id || !confirm('要移除这株灵感吗？文字、照片、语音和跟进记录都会删除，无法恢复。')) return;
  try { await removeIdea(id); $('#detail').close(); selectedId = null; await refresh(); }
  catch { $('#detail-error').textContent = '删除失败，请稍后重试。'; }
}
async function saveProgress(kind) {
  const original = ideas.find(item => item.id === selectedId), text = $('#progress-text').value.trim();
  if (!original || !text) { $('#detail-error').textContent = '请先写下这次进展。'; return; }
  if (original.stage === 'sprout' && kind !== 'followup' || original.stage === 'bloom') return;
  const now = new Date().toISOString();
  const idea = { ...original, notes: [...original.notes, { id: crypto.randomUUID(), kind, text, createdAt: now }], stage: kind === 'outcome' ? 'bloom' : 'bud', lastTendedAt: now };
  try { await writeIdea(idea); freshId = idea.id; $('#detail').close(); await refresh(); setTimeout(() => { freshId = null; renderGarden(); }, 1800); }
  catch { $('#detail-error').textContent = '保存失败，请稍后重试。'; }
}
function readDataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
async function exportBackup() {
  try {
    const records = await Promise.all(ideas.map(async idea => ({ ...idea, photo: idea.photo ? await readDataURL(idea.photo) : null, audio: idea.audio ? await readDataURL(idea.audio) : null })));
    const blob = new Blob([JSON.stringify({ format: 'inspiration-garden-v2', exportedAt: new Date().toISOString(), tags, records })], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `灵感花园备份-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { alert('导出失败，请稍后再试。'); }
}
async function restoreBackup(file) {
  if (!file) return;
  try {
    if (file.size > 200_000_000) throw new Error('too-large');
    const backup = JSON.parse(await file.text());
    if (!['inspiration-garden-v1', 'inspiration-garden-v2'].includes(backup.format) || !Array.isArray(backup.records) || backup.records.length > 1000) throw new Error('format');
    for (const entry of backup.records) {
      if (typeof entry.id !== 'string' || typeof entry.text !== 'string' || typeof entry.category !== 'string' || !validTag(entry.category) || !stageNames[entry.stage] || !Array.isArray(entry.notes)) throw new Error('record');
    }
    const restored = [];
    for (const entry of backup.records) {
      const photoBlob = entry.photo ? await (await fetch(entry.photo)).blob() : null;
      const audioBlob = entry.audio ? await (await fetch(entry.audio)).blob() : null;
      restored.push({ ...entry, photo: photoBlob, audio: audioBlob });
    }
    for (const entry of restored) await writeIdea(entry);
    const backupTags = Array.isArray(backup.tags) ? backup.tags.filter(t => typeof t === 'string' && validTag(t)) : [];
    tags = [...new Set([...tags, ...backupTags, ...restored.map(i => i.category)])]; saveTags();
    await refresh(); renderTags(); alert('备份已导入。相同灵感会更新，不会重复添加。');
  } catch { alert('无法导入。请选择灵感花园导出的 JSON 备份。'); }
}
function installBackupControls() {
  const row = document.createElement('div'); row.className = 'backup-row';
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = '导出备份'; exportButton.addEventListener('click', exportBackup);
  const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = '导入备份';
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json'; input.hidden = true;
  importButton.addEventListener('click', () => input.click()); input.addEventListener('change', () => { restoreBackup(input.files?.[0]); input.value = ''; });
  row.append(exportButton, importButton, input); $('#list-screen').insertBefore(row, $('#list-scroll'));
}
async function init() {
  $('#year').textContent = new Date().getFullYear(); installBackupControls();
  $('#nav-garden').addEventListener('click', () => { view = 'garden'; placing = false; render(); });
  $('#nav-list').addEventListener('click', () => { view = 'list'; placing = false; render(); });
  document.querySelectorAll('.open-composer').forEach(button => button.addEventListener('click', openComposer));
  document.querySelectorAll('.close-composer').forEach(button => button.addEventListener('click', closeComposer));
  document.querySelectorAll('.close-detail').forEach(button => button.addEventListener('click', () => $('#detail').close()));
  $('#composer').addEventListener('close', () => stopRecording(true));
  $('#detail').addEventListener('close', () => { selectedId = null; releaseMediaURLs(); });
  $('#pick-photo').addEventListener('click', () => $('#photo-input').click()); $('#take-photo').addEventListener('click', () => $('#camera-input').click());
  $('#photo-input').addEventListener('change', event => choosePhoto(event.target.files?.[0]));
  $('#camera-input').addEventListener('change', event => choosePhoto(event.target.files?.[0]));
  $('#record-audio').addEventListener('click', () => recorder?.state === 'recording' ? stopRecording() : startRecording());
  $('#save-idea').addEventListener('click', () => editingId ? saveIdea() : startPlanting());
  $('#placement-surface').addEventListener('click', selectSpot);
  $('#placement-back').addEventListener('click', () => { placing = false; renderGarden(); $('#composer').showModal(); });
  $('#placement-confirm').addEventListener('click', saveIdea);
  $('#save-progress').addEventListener('click', () => saveProgress(ideas.find(item => item.id === selectedId)?.stage === 'sprout' ? 'followup' : 'outcome'));
  $('#extra-followup').addEventListener('click', () => saveProgress('followup'));
  $('#idea-more').addEventListener('click', () => toggleMenu($('#idea-menu')));
  $('#idea-edit').addEventListener('click', openEditor); $('#idea-delete').addEventListener('click', deleteSelected);
  $('#tag-trigger').addEventListener('click', () => { $('#tag-popover').hidden = !$('#tag-popover').hidden; tagError(); });
  $('#tag-add').addEventListener('click', addTag); $('#tag-new').addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });
  document.addEventListener('click', e => { if (!e.target.closest('.more-wrap')) { document.querySelectorAll('.more-menu').forEach(menu => { menu.hidden = true; }); } if (!e.target.closest('#category-row')) $('#tag-popover').hidden = true; });
  try { ideas = (await readAll()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); loadTags(); renderTags(); render(); }
  catch { $('#garden-empty').lastElementChild.textContent = '浏览器存储不可用，请关闭无痕模式后重试。'; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();
