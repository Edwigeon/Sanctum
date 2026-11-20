/**
 * Sprite Bank Tree/Category List, Folder Manager, Move/Recolor Modals & Disk Persistence
 */

import { PALETTE } from '../../../shared/Constants.js';
import { PAL_NAMES, HEX_CHARS } from './PaletteAndDigitizer.js';

export function syncFolderControls(studio) {
  const folders = new Set(studio.allKnownFolders);
  const countsByFolder = {};
  for (const f of folders) countsByFolder[f] = 0;

  for (const cat of ['tiles', 'entities', 'objects', 'items']) {
    for (const id of Object.keys(studio.bank[cat] || {})) {
      const f = id.includes('/') ? id.split('/')[0] : 'common';
      folders.add(f);
      countsByFolder[f] = (countsByFolder[f] || 0) + 1;
    }
  }
  const sortedFolders = Array.from(folders).sort();

  const filterEl = document.getElementById('sp-folder-filter');
  if (filterEl) {
    const cur = studio.selectedFolder;
    filterEl.innerHTML = '<option value="ALL">📁 All Folders</option>';
    for (const f of sortedFolders) {
      const opt = document.createElement('option');
      opt.value = f;
      const count = countsByFolder[f] || 0;
      opt.textContent = `📁 ${f} (${count})`;
      if (f === cur) opt.selected = true;
      filterEl.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__NEW__';
    newOpt.textContent = '+ New Folder / Biome...';
    filterEl.appendChild(newOpt);
  }

  const newFolderEl = document.getElementById('sp-new-folder');
  if (newFolderEl) {
    const cur = newFolderEl.value || (studio.selectedFolder === 'ALL' ? 'common' : studio.selectedFolder);
    newFolderEl.innerHTML = '';
    for (const f of sortedFolders) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = `📁 ${f}`;
      if (f === cur) opt.selected = true;
      newFolderEl.appendChild(opt);
    }
    const newOpt = document.createElement('option');
    newOpt.value = '__NEW__';
    newOpt.textContent = '+ New Folder...';
    newFolderEl.appendChild(newOpt);
  }

  const destLbl = document.getElementById('lbl-create-dest');
  if (destLbl) {
    const targetF = newFolderEl ? newFolderEl.value : (studio.selectedFolder === 'ALL' ? 'common' : studio.selectedFolder);
    destLbl.textContent = `in ${targetF}/`;
  }

  const moveFolderEl = document.getElementById('move-folder-select');
  if (moveFolderEl) {
    const cur = moveFolderEl.value;
    moveFolderEl.innerHTML = '';
    for (const f of sortedFolders) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = `📁 ${f}`;
      if (f === cur) opt.selected = true;
      moveFolderEl.appendChild(opt);
    }
  }
}

export function renderBankList(studio) {
  const list = document.getElementById('sp-bank-list');
  if (!list) return;
  list.innerHTML = '';
  studio.syncFolderControls();

  const folderFilter = studio.selectedFolder;

  if (studio.bankViewMode === 'folder') {
    const folders = new Set(studio.allKnownFolders);
    for (const cat of ['tiles', 'entities', 'objects', 'items']) {
      for (const id of Object.keys(studio.bank[cat] || {})) {
        const f = id.includes('/') ? id.split('/')[0] : 'common';
        folders.add(f);
      }
    }

    const activeFolders = Array.from(folders).sort().filter(f => {
      if (folderFilter === 'ALL') return true;
      return f === folderFilter;
    });

    for (const folder of activeFolders) {
      const items = [];
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        for (const id of Object.keys(studio.bank[cat] || {})) {
          const f = id.includes('/') ? id.split('/')[0] : 'common';
          if (f === folder) {
            items.push({ cat, id, sp: studio.bank[cat][id] });
          }
        }
      }

      const isCollapsed = studio.collapsedFolders.has(folder);

      const folderHeader = document.createElement('div');
      folderHeader.className = 'flex items-center justify-between px-2 py-1 bg-slate-950/80 border border-slate-800 rounded cursor-pointer hover:border-slate-700 select-none text-[11px] font-bold text-amber-300';
      folderHeader.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="text-slate-500 text-[10px]">${isCollapsed ? '▶' : '▼'}</span>
          <span>📁 ${folder}</span>
        </div>
        <span class="text-[10px] text-slate-400 font-mono">${items.length}</span>
      `;
      folderHeader.addEventListener('click', () => {
        if (studio.collapsedFolders.has(folder)) {
          studio.collapsedFolders.delete(folder);
        } else {
          studio.collapsedFolders.add(folder);
        }
        studio.renderBankList();
      });
      list.appendChild(folderHeader);

      if (!isCollapsed) {
        if (items.length === 0) {
          const emptyEl = document.createElement('div');
          emptyEl.className = 'text-[10px] text-slate-500 italic px-3 py-1';
          emptyEl.textContent = '(empty folder)';
          list.appendChild(emptyEl);
        } else {
          items.sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id));
          for (const { cat, id, sp } of items) {
            const isSel = cat === studio.activeCat && id === studio.activeId;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `w-full flex items-center justify-between px-2 py-1 rounded border text-left transition ${
              isSel
                ? 'border-amber-500 bg-amber-950/30 text-amber-200 font-bold'
                : 'border-slate-800/80 bg-slate-950/40 hover:border-slate-700 text-slate-300'
            }`;

            const isTile = cat === 'tiles';
            const stCount = sp.states ? Object.keys(sp.states).length : 0;
            const count = isTile
              ? (sp.variants?.length || sp.frames?.length || 1)
              : (sp.frames?.length || 1);
            const meta = isTile
              ? `${count}v`
              : (stCount > 0 ? `${stCount}st` : `${count}f`);

            const cleanName = id.includes('/') ? id.split('/')[1] : id;
            const catBadge = cat === 'tiles' ? 'tile' : (cat === 'entities' ? 'ent' : (cat === 'objects' ? 'obj' : 'item'));
            const catBadgeColor = cat === 'tiles' ? 'bg-cyan-950 text-cyan-400 border-cyan-800' : (cat === 'entities' ? 'bg-amber-950 text-amber-400 border-amber-800' : 'bg-slate-800 text-slate-300 border-slate-700');

            row.innerHTML = `
              <div class="flex items-center gap-1.5 truncate">
                <span class="text-[9px] uppercase px-1 py-0.2 rounded border ${catBadgeColor} font-mono">${catBadge}</span>
                <span class="truncate ${isSel ? 'text-amber-200 font-bold' : 'text-slate-100'}">${cleanName}</span>
              </div>
              <span class="text-[10px] text-amber-300 font-mono ml-1 shrink-0">${sp.w}×${sp.h} (${meta})</span>
            `;
            row.addEventListener('click', () => studio.selectSprite(cat, id));
            list.appendChild(row);
          }
        }
      }
    }
  } else {
    for (const cat of ['tiles', 'entities', 'objects', 'items']) {
      const allKeys = Object.keys(studio.bank[cat] || {});
      const matchedKeys = allKeys.filter(id => {
        if (folderFilter === 'ALL') return true;
        if (!id.includes('/')) return folderFilter === 'common';
        return id.startsWith(`${folderFilter}/`);
      });
      if (matchedKeys.length === 0) continue;

      const header = document.createElement('div');
      header.className = 'text-[11px] uppercase tracking-wider text-amber-400 font-bold pt-2 pb-1 border-b border-slate-800 flex justify-between';
      header.innerHTML = `<span>${cat}</span><span class="text-slate-400">${matchedKeys.length}</span>`;
      list.appendChild(header);

      for (const id of matchedKeys) {
        const sp = studio.bank[cat][id];
        const isSel = cat === studio.activeCat && id === studio.activeId;
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `w-full flex items-center justify-between px-2 py-1.5 rounded border text-left transition ${
          isSel
            ? 'border-amber-500 bg-amber-950/30 text-amber-200 font-bold'
            : 'border-slate-800 bg-slate-950/60 hover:border-slate-600 text-slate-300'
        }`;
        const isTile = cat === 'tiles';
        const stCount = sp.states ? Object.keys(sp.states).length : 0;
        const count = isTile
          ? (sp.variants?.length || sp.frames?.length || 1)
          : (sp.frames?.length || 1);
        const meta = isTile
          ? `${count}v`
          : (stCount > 0 ? `${stCount}st` : `${count}f`);

        let displayName = '';
        if (folderFilter === 'ALL' && id.includes('/')) {
          const [f, base] = id.split('/');
          displayName = `<span class="text-amber-400 font-normal">${f}/</span><span class="text-slate-100 font-semibold">${base}</span>`;
        } else {
          const base = id.includes('/') ? id.split('/')[1] : id;
          displayName = `<span class="text-slate-100 font-semibold">${base}</span>`;
        }

        row.innerHTML = `<span class="truncate">${displayName}</span><span class="text-[10px] text-amber-300 font-mono ml-1 shrink-0">${sp.w}×${sp.h} (${meta})</span>`;
        row.addEventListener('click', () => studio.selectSprite(cat, id));
        list.appendChild(row);
      }
    }
  }
}

export function bindBankAndModalEvents(studio) {
  document.getElementById('sp-folder-filter')?.addEventListener('change', (e) => {
    if (e.target.value === '__NEW__') {
      const name = prompt('Enter new folder / biome name (e.g. cathedral, town):');
      const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
      if (clean) {
        studio.allKnownFolders.add(clean);
        studio.selectedFolder = clean;
      } else {
        e.target.value = studio.selectedFolder;
        return;
      }
    } else {
      studio.selectedFolder = e.target.value;
    }

    const activeMatch = studio.selectedFolder === 'ALL' ||
      (studio.activeId.includes('/') ? studio.activeId.startsWith(`${studio.selectedFolder}/`) : studio.selectedFolder === 'common');
    if (!activeMatch) {
      let found = false;
      for (const cat of ['tiles', 'entities', 'objects', 'items']) {
        for (const id of Object.keys(studio.bank[cat] || {})) {
          const matches = studio.selectedFolder === 'ALL' ||
            (id.includes('/') ? id.startsWith(`${studio.selectedFolder}/`) : studio.selectedFolder === 'common');
          if (matches) {
            studio.selectSprite(cat, id);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }

    studio.syncFolderControls();
    studio.renderBankList();
  });

  document.getElementById('btn-sp-add-folder')?.addEventListener('click', () => {
    const name = prompt('Enter new folder / biome name (e.g. cathedral, town):');
    const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
    if (clean) {
      studio.allKnownFolders.add(clean);
      studio.selectedFolder = clean;
      studio.syncFolderControls();
      studio.renderBankList();
      studio.showToast(`Folder "📁 ${clean}" ready!`);
    }
  });

  const btnViewCat = document.getElementById('btn-view-by-category');
  const btnViewFold = document.getElementById('btn-view-by-folder');
  btnViewCat?.addEventListener('click', () => {
    studio.bankViewMode = 'category';
    btnViewCat.className = 'px-2 py-0.5 rounded bg-amber-600 text-slate-950 font-bold';
    btnViewFold.className = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700';
    studio.renderBankList();
  });
  btnViewFold?.addEventListener('click', () => {
    studio.bankViewMode = 'folder';
    btnViewFold.className = 'px-2 py-0.5 rounded bg-amber-600 text-slate-950 font-bold';
    btnViewCat.className = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700';
    studio.renderBankList();
  });

  document.getElementById('sp-new-folder')?.addEventListener('change', (e) => {
    if (e.target.value === '__NEW__') {
      const name = prompt('Enter new folder name:');
      const clean = name ? name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null;
      if (clean) {
        studio.allKnownFolders.add(clean);
        studio.syncFolderControls();
        document.getElementById('sp-new-folder').value = clean;
      }
    }
    const lbl = document.getElementById('lbl-create-dest');
    if (lbl) lbl.textContent = `in ${document.getElementById('sp-new-folder').value}/`;
  });

  // Move / Rename Modal
  const moveModal = document.getElementById('dev-move-modal');
  const moveCategory = document.getElementById('move-category');
  const moveFolderSelect = document.getElementById('move-folder-select');
  const moveFolderCustom = document.getElementById('move-folder-custom');
  const moveNewId = document.getElementById('move-new-id');
  const moveTargetName = document.getElementById('move-target-name');

  const openMoveModal = () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    moveTargetName.textContent = `${studio.activeCat}/${studio.activeId}`;
    moveCategory.value = studio.activeCat;
    const [currentFolder, baseId] = studio.activeId.includes('/')
      ? studio.activeId.split('/')
      : ['common', studio.activeId];
    studio.syncFolderControls();
    moveFolderSelect.value = currentFolder;
    moveFolderCustom.value = '';
    moveNewId.value = baseId;
    moveModal.classList.remove('hidden');
    moveNewId.focus();
  };

  document.getElementById('btn-sp-move-folder')?.addEventListener('click', openMoveModal);
  document.getElementById('btn-move-close')?.addEventListener('click', () => moveModal.classList.add('hidden'));
  document.getElementById('btn-move-cancel')?.addEventListener('click', () => moveModal.classList.add('hidden'));

  document.getElementById('btn-move-apply')?.addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    const targetCat = moveCategory.value;
    const customF = moveFolderCustom.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const targetFolder = customF || moveFolderSelect.value || 'common';
    const cleanBase = moveNewId.value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanBase) return studio.showToast('Sprite ID cannot be empty', true);

    const targetPath = `${targetFolder}/${cleanBase}`;
    if (targetCat === studio.activeCat && targetPath === studio.activeId) {
      moveModal.classList.add('hidden');
      return;
    }
    if (studio.bank[targetCat]?.[targetPath]) {
      return studio.showToast(`"${targetPath}" already exists in ${targetCat}`, true);
    }

    delete studio.bank[studio.activeCat][studio.activeId];
    studio.bank[targetCat][targetPath] = sp;
    studio.allKnownFolders.add(targetFolder);
    if (studio.selectedFolder !== 'ALL') {
      studio.selectedFolder = targetFolder;
    }
    moveModal.classList.add('hidden');
    studio.syncFolderControls();
    studio.selectSprite(targetCat, targetPath);
    studio.showToast(`Moved to "${targetCat}/${targetPath}"`);
  });

  // Palette Recolor / Biome Clone Modal
  const recolorModal = document.getElementById('dev-recolor-modal');
  const recolorSrc = document.getElementById('recolor-src');
  const recolorDst = document.getElementById('recolor-dst');
  const recolorTargetName = document.getElementById('recolor-target-name');
  const recolorNewId = document.getElementById('recolor-new-id');
  const recolorCloneSuffix = document.getElementById('recolor-clone-suffix');
  const recolorSaveAsCopy = document.getElementById('recolor-save-as-copy');

  const openRecolorModal = () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    recolorTargetName.textContent = `${studio.activeCat}/${studio.activeId}`;
    recolorSrc.innerHTML = '';
    recolorDst.innerHTML = '';

    const usedIndices = new Set();
    const checkGrid = (grid) => {
      if (!Array.isArray(grid)) return;
      for (const row of grid) {
        for (let i = 0; i < row.length; i++) {
          const ch = row[i];
          if (ch && ch !== '.') {
            const val = parseInt(ch, 16);
            if (!Number.isNaN(val)) usedIndices.add(val);
          }
        }
      }
    };

    if (sp.states) {
      for (const st of Object.values(sp.states)) {
        for (const f of st.frames || []) checkGrid(f);
      }
    } else {
      for (const f of (sp.variants || sp.frames || [])) checkGrid(f);
    }

    for (let i = 0; i < 16; i++) {
      const optDst = document.createElement('option');
      optDst.value = String(i);
      optDst.textContent = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
      recolorDst.appendChild(optDst);

      if (usedIndices.has(i)) {
        const optSrc = document.createElement('option');
        optSrc.value = String(i);
        optSrc.textContent = `${i}: ${PAL_NAMES[i]} (${PALETTE[i]})`;
        recolorSrc.appendChild(optSrc);
      }
    }

    const baseName = studio.activeId.includes('/') ? studio.activeId.split('/')[1] : studio.activeId;
    recolorCloneSuffix.textContent = `cavern/${baseName}`;
    recolorNewId.value = `cavern/${baseName}`;
    recolorModal.classList.remove('hidden');
  };

  document.getElementById('btn-sp-recolor')?.addEventListener('click', openRecolorModal);
  document.getElementById('btn-recolor-close')?.addEventListener('click', () => recolorModal.classList.add('hidden'));
  document.getElementById('btn-recolor-cancel')?.addEventListener('click', () => recolorModal.classList.add('hidden'));

  document.getElementById('btn-recolor-apply')?.addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    const srcIdx = Number(recolorSrc.value);
    const dstIdx = Number(recolorDst.value);
    if (Number.isNaN(srcIdx) || Number.isNaN(dstIdx)) return;
    const srcHex = HEX_CHARS[srcIdx];
    const dstHex = HEX_CHARS[dstIdx];

    const swapGrid = (grid) => {
      if (!Array.isArray(grid)) return grid;
      return grid.map(row => {
        let s = '';
        for (let i = 0; i < row.length; i++) {
          s += (row[i] === srcHex ? dstHex : row[i]);
        }
        return s;
      });
    };

    const clone = JSON.parse(JSON.stringify(sp));
    if (clone.states) {
      for (const st of Object.values(clone.states)) {
        st.frames = (st.frames || []).map(swapGrid);
      }
    } else if (clone.variants) {
      clone.variants = clone.variants.map(swapGrid);
    } else if (clone.frames) {
      clone.frames = clone.frames.map(swapGrid);
    }

    const saveAsCopy = recolorSaveAsCopy.checked;
    if (saveAsCopy) {
      const newId = recolorNewId.value.trim().replace(/[^a-zA-Z0-9_\/-]/g, '');
      if (!newId) return studio.showToast('Enter a valid new ID/path', true);
      studio.bank[studio.activeCat][newId] = clone;
      if (newId.includes('/')) {
        studio.selectedFolder = newId.split('/')[0];
      }
      recolorModal.classList.add('hidden');
      studio.selectSprite(studio.activeCat, newId);
      studio.showToast(`Created biome recolor "${newId}"!`);
    } else {
      studio.pushUndo();
      studio.bank[studio.activeCat][studio.activeId] = clone;
      recolorModal.classList.add('hidden');
      studio.refreshAll();
      studio.showToast(`Swapped color ${srcIdx} → ${dstIdx}!`);
    }
  });

  // Bank CRUD & Save
  document.getElementById('btn-sp-new').addEventListener('click', () => {
    const cat = document.getElementById('sp-new-cat').value;
    const rawId = document.getElementById('sp-new-id').value.trim().replace(/[^a-zA-Z0-9_\-\/]/g, '');
    const folderVal = document.getElementById('sp-new-folder')?.value || (studio.selectedFolder === 'ALL' ? 'common' : studio.selectedFolder);

    if (!rawId) return studio.showToast('Enter a sprite ID first.', true);

    let fullId = rawId;
    if (!fullId.includes('/')) {
      fullId = `${folderVal}/${rawId}`;
    }
    const folder = fullId.split('/')[0];
    studio.allKnownFolders.add(folder);

    const sizeVal = String(document.getElementById('sp-new-size').value || '12');
    let w = 12;
    let h = 12;
    if (sizeVal.includes('x')) {
      const parts = sizeVal.split('x').map(Number);
      w = parts[0] || 12;
      h = parts[1] || w;
    } else {
      w = h = Number(sizeVal) || 12;
    }
    if (studio.bank[cat][fullId]) return studio.showToast(`"${fullId}" already exists in ${cat}.`, true);
    const isHighRes = w >= 32 || h >= 32;
    const isTile = cat === 'tiles';
    const blank = Array.from({ length: h }, () => '.'.repeat(w));
    studio.bank[cat][fullId] = {
      w,
      h,
      anchorX: Math.floor(w / 2),
      anchorY: Math.floor(h * 0.75),
      allowRotate: isTile,
      allowFlip: isTile,
      renderScale: isHighRes ? 0.5 : 1,
      frames: [blank],
      variants: isTile ? [blank] : undefined
    };
    document.getElementById('sp-new-id').value = '';
    if (studio.selectedFolder !== 'ALL' && studio.selectedFolder !== folder) {
      studio.selectedFolder = folder;
    }
    studio.syncFolderControls();
    studio.selectSprite(cat, fullId);
    studio.showToast(`Created ${cat}/${fullId}`);
  });

  document.getElementById('btn-sp-dup').addEventListener('click', () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    const newId = `${studio.activeId}_copy`;
    studio.bank[studio.activeCat][newId] = JSON.parse(JSON.stringify(sp));
    studio.selectSprite(studio.activeCat, newId);
  });

  document.getElementById('btn-sp-del').addEventListener('click', () => {
    if (!confirm(`Delete "${studio.activeCat}/${studio.activeId}"?`)) return;
    delete studio.bank[studio.activeCat][studio.activeId];
    for (const cat of ['tiles', 'entities', 'objects', 'items']) {
      const keys = Object.keys(studio.bank[cat]);
      if (keys.length > 0) {
        studio.selectSprite(cat, keys[0]);
        return;
      }
    }
    studio.renderBankList();
  });

  document.getElementById('btn-sp-copy-json').addEventListener('click', async () => {
    const sp = studio.getActiveSprite();
    if (!sp) return;
    await navigator.clipboard?.writeText(JSON.stringify({ [studio.activeId]: sp }, null, 2)).catch(() => {});
    studio.showToast('Copied sprite JSON to clipboard!');
  });

  document.getElementById('btn-sp-save-disk').addEventListener('click', async () => {
    for (const [, sp] of Object.entries(studio.bank.tiles || {})) {
      const frames = sp.frames || sp.variants;
      if (frames) {
        sp.variants = frames;
      }
    }
    try {
      const res = await fetch('/api/dev/sprites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...studio.getAuthHeaders() },
        body: JSON.stringify(studio.bank)
      });
      const data = await res.json();
      if (!res.ok) return studio.showToast(data.error || 'Save failed', true);
      studio.showToast('Saved data/sprites.json!');
    } catch {
      studio.showToast('Network error saving sprites.json', true);
    }
  });
}
