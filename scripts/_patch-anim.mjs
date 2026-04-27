import { readFileSync, writeFileSync } from 'fs';

const path = 'public/dashboard/dashboard.js';
let code = readFileSync(path, 'utf8');

// ── 1. Replace renderClipList block ─────────────────────────────────────────

const OLD_CLIP_LIST = `\tlet listEl, presetGridEl;

\tfunction renderClipList() {
\t\tlistEl.innerHTML = '';
\t\tif (!animations.length) {
\t\t\tlistEl.innerHTML =
\t\t\t\t'<div class="muted" style="padding:12px 0">No clips attached yet.</div>';
\t\t\treturn;
\t\t}
\t\tfor (const clip of animations) {
\t\t\tconst row = document.createElement('div');
\t\t\trow.className = 'clip-row';
\t\t\trow.innerHTML = \`
\t\t\t\t<span class="clip-name">\${esc(clip.name)}</span>
\t\t\t\t<span class="clip-source">\${esc(clip.source || 'custom')}</span>
\t\t\t\t<label class="loop-toggle" title="Toggle loop">
\t\t\t\t\t<input type="checkbox" \${clip.loop !== false ? 'checked' : ''}>
\t\t\t\t\t<span>Loop</span>
\t\t\t\t</label>
\t\t\t\t<div class="clip-actions">
\t\t\t\t\t<button class="preview-btn">Preview</button>
\t\t\t\t\t<button class="danger detach-btn">Remove</button>
\t\t\t\t</div>
\t\t\t\`;
\t\t\trow.querySelector('.loop-toggle input').addEventListener('change', (e) => {
\t\t\t\tclip.loop = e.target.checked;
\t\t\t\tdebounceSync();
\t\t\t});
\t\t\trow.querySelector('.detach-btn').addEventListener('click', () => {
\t\t\t\tconst idx = animations.indexOf(clip);
\t\t\t\tif (idx === -1) return;
\t\t\t\tanimations.splice(idx, 1);
\t\t\t\trenderClipList();
\t\t\t\trenderPresetGrid();
\t\t\t\tdebounceSync();
\t\t\t\ttoastUndo(\`Removed "\${clip.name}"\`, () => {
\t\t\t\t\tanimations.splice(idx, 0, clip);
\t\t\t\t\trenderClipList();
\t\t\t\t\trenderPresetGrid();
\t\t\t\t\tdebounceSync();
\t\t\t\t});
\t\t\t});
\t\t\trow.querySelector('.preview-btn').addEventListener('click', () =>
\t\t\t\topenAnimPreview(clip, avatarUrl),
\t\t\t);
\t\t\tlistEl.appendChild(row);
\t\t}
\t}`;

const NEW_CLIP_LIST = `\tlet listEl, presetGridEl;
\tlet _dragClip = null;

\tfunction renderClipList() {
\t\tlistEl.innerHTML = '';
\t\tif (!animations.length) {
\t\t\tlistEl.innerHTML =
\t\t\t\t'<div class="muted" style="padding:12px 0">No clips attached yet.</div>';
\t\t\treturn;
\t\t}
\t\tfor (const clip of animations) {
\t\t\tconst row = document.createElement('div');
\t\t\trow.className = 'clip-row';
\t\t\trow.draggable = true;
\t\t\trow.innerHTML = \`
\t\t\t\t<span class="drag-handle" aria-hidden="true" title="Drag to reorder">&#x2807;</span>
\t\t\t\t<span class="clip-name" tabindex="0" title="Click to rename">\${esc(clip.name)}</span>
\t\t\t\t<span class="clip-source">\${esc(clip.source || 'custom')}</span>
\t\t\t\t<label class="loop-toggle" title="Toggle loop">
\t\t\t\t\t<input type="checkbox" \${clip.loop !== false ? 'checked' : ''}>
\t\t\t\t\t<span>Loop</span>
\t\t\t\t</label>
\t\t\t\t<div class="clip-actions">
\t\t\t\t\t<button class="preview-btn">Preview</button>
\t\t\t\t\t<button class="danger detach-btn">Remove</button>
\t\t\t\t</div>
\t\t\t\`;
\t\t\tconst nameEl = row.querySelector('.clip-name');
\t\t\tnameEl.addEventListener('click', () => beginRename(clip, nameEl));
\t\t\tnameEl.addEventListener('keydown', (e) => {
\t\t\t\tif (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); beginRename(clip, nameEl); }
\t\t\t});
\t\t\trow.querySelector('.loop-toggle input').addEventListener('change', (e) => {
\t\t\t\tclip.loop = e.target.checked;
\t\t\t\tdebounceSync();
\t\t\t});
\t\t\trow.querySelector('.detach-btn').addEventListener('click', () => {
\t\t\t\tconst idx = animations.indexOf(clip);
\t\t\t\tif (idx === -1) return;
\t\t\t\tanimations.splice(idx, 1);
\t\t\t\trenderClipList();
\t\t\t\trenderPresetGrid();
\t\t\t\tdebounceSync();
\t\t\t\ttoastUndo(\`Removed "\${clip.name}"\`, () => {
\t\t\t\t\tanimations.splice(idx, 0, clip);
\t\t\t\t\trenderClipList();
\t\t\t\t\trenderPresetGrid();
\t\t\t\t\tdebounceSync();
\t\t\t\t});
\t\t\t});
\t\t\trow.querySelector('.preview-btn').addEventListener('click', () =>
\t\t\t\topenAnimPreview(clip, avatarUrl),
\t\t\t);
\t\t\t// drag-to-reorder
\t\t\trow.addEventListener('dragstart', (e) => {
\t\t\t\trow.classList.add('dragging');
\t\t\t\te.dataTransfer.effectAllowed = 'move';
\t\t\t\te.dataTransfer.setData('text/plain', clip.name);
\t\t\t\t_dragClip = clip;
\t\t\t});
\t\t\trow.addEventListener('dragend', () => {
\t\t\t\trow.classList.remove('dragging');
\t\t\t\t_dragClip = null;
\t\t\t\tlistEl.querySelectorAll('.drop-above,.drop-below').forEach((r) =>
\t\t\t\t\tr.classList.remove('drop-above', 'drop-below'),
\t\t\t\t);
\t\t\t});
\t\t\trow.addEventListener('dragover', (e) => {
\t\t\t\tif (!_dragClip || _dragClip === clip) return;
\t\t\t\te.preventDefault();
\t\t\t\te.dataTransfer.dropEffect = 'move';
\t\t\t\tconst { top, height } = row.getBoundingClientRect();
\t\t\t\tconst after = e.clientY - top > height / 2;
\t\t\t\trow.classList.toggle('drop-above', !after);
\t\t\t\trow.classList.toggle('drop-below', after);
\t\t\t});
\t\t\trow.addEventListener('dragleave', () =>
\t\t\t\trow.classList.remove('drop-above', 'drop-below'),
\t\t\t);
\t\t\trow.addEventListener('drop', (e) => {
\t\t\t\te.preventDefault();
\t\t\t\trow.classList.remove('drop-above', 'drop-below');
\t\t\t\tif (!_dragClip || _dragClip === clip) return;
\t\t\t\tconst from = animations.indexOf(_dragClip);
\t\t\t\tif (from === -1) return;
\t\t\t\tconst { top, height } = row.getBoundingClientRect();
\t\t\t\tconst after = e.clientY - top > height / 2;
\t\t\t\tconst moved = _dragClip;
\t\t\t\tanimations.splice(from, 1);
\t\t\t\tlet to = animations.indexOf(clip);
\t\t\t\tif (after) to += 1;
\t\t\t\tanimations.splice(to, 0, moved);
\t\t\t\trenderClipList();
\t\t\t\tdebounceSync();
\t\t\t});
\t\t\tlistEl.appendChild(row);
\t\t}
\t}

\tfunction beginRename(clip, nameEl) {
\t\tif (nameEl.querySelector('input')) return;
\t\tconst original = clip.name;
\t\tconst input = document.createElement('input');
\t\tinput.type = 'text';
\t\tinput.value = original;
\t\tinput.maxLength = 60;
\t\tinput.className = 'clip-name-input';
\t\tnameEl.replaceChildren(input);
\t\tinput.focus();
\t\tinput.select();
\t\tlet committed = false;
\t\tconst finish = (save) => {
\t\t\tif (committed) return;
\t\t\tcommitted = true;
\t\t\tif (save) {
\t\t\t\tconst next = input.value.trim();
\t\t\t\tif (!next) { toast('Name required', true); nameEl.textContent = original; return; }
\t\t\t\tif (next.length > 60) { toast('Name too long (max 60)', true); nameEl.textContent = original; return; }
\t\t\t\tif (next !== original && nameTaken(next, clip)) {
\t\t\t\t\ttoast(\`"\${next}" already exists\`, true);
\t\t\t\t\tnameEl.textContent = original;
\t\t\t\t\treturn;
\t\t\t\t}
\t\t\t\tif (next !== original) { clip.name = next; debounceSync(); renderPresetGrid(); }
\t\t\t\tnameEl.textContent = clip.name;
\t\t\t} else {
\t\t\t\tnameEl.textContent = original;
\t\t\t}
\t\t};
\t\tinput.addEventListener('blur', () => finish(true));
\t\tinput.addEventListener('keydown', (e) => {
\t\t\tif (e.key === 'Enter') { e.preventDefault(); finish(true); input.blur(); }
\t\t\telse if (e.key === 'Escape') { e.preventDefault(); finish(false); input.blur(); }
\t\t});
\t}`;

// ── 2. Add "Add all" bulk button to renderPresetGrid ────────────────────────

const OLD_PRESET_GRID_END = `\t\t\tpresetGridEl.appendChild(tile);
\t\t}
\t}`;

const NEW_PRESET_GRID_END = `\t\t\tpresetGridEl.appendChild(tile);
\t\t}
\t}

\tfunction addAllPresets() {
\t\tconst toAdd = presets.filter((p) => !isAttached(p.name));
\t\tif (!toAdd.length) { toast('All presets already attached'); return; }
\t\tfor (const p of toAdd) {
\t\t\tanimations.push({
\t\t\t\tname: p.name,
\t\t\t\turl: p.url,
\t\t\t\tloop: p.loop !== false,
\t\t\t\tclipName: p.clipName || undefined,
\t\t\t\tsource: 'preset',
\t\t\t\taddedAt: new Date().toISOString(),
\t\t\t});
\t\t}
\t\trenderClipList();
\t\trenderPresetGrid();
\t\tdebounceSync();
\t\ttoast(\`Added \${toAdd.length} preset\${toAdd.length === 1 ? '' : 's'}\`);
\t}`;

let replaced = 0;

if (code.includes(OLD_CLIP_LIST)) {
	code = code.replace(OLD_CLIP_LIST, NEW_CLIP_LIST);
	replaced++;
	console.log('✓ renderClipList replaced');
} else {
	console.error('✗ OLD_CLIP_LIST not found');
}

if (code.includes(OLD_PRESET_GRID_END)) {
	code = code.replace(OLD_PRESET_GRID_END, NEW_PRESET_GRID_END);
	replaced++;
	console.log('✓ addAllPresets added');
} else {
	console.error('✗ OLD_PRESET_GRID_END not found');
}

writeFileSync(path, code);
console.log(`Done (${replaced}/2 replacements applied)`);
