/**
 * Nexus Files — Windows 11 Fluent Properties Dialog
 * Replicates the authentic Windows File Explorer properties window with Mica / Acrylic frosted glass.
 */
import { getFileProperties, calcFolderDetail, setFileAttributes, revealInExplorer, showOpenWithDialog } from '../utils/tauri-bridge.js';
import { formatFileSize, formatDate, fileIconEl, icon, ICONS } from '../utils/helpers.js';
import { toast } from '../utils/toast.js';
import { t } from '../i18n/index.js';

/**
 * Open the Windows 11 Fluent Properties Dialog for a file or directory.
 * @param {object} file FileEntry or { name, path, isDir, size, modified, extension }
 */
export async function showPropertiesDialog(file) {
  if (!file || !file.path) return;

  // Remove any existing properties modal
  document.querySelectorAll('.fluent-prop-backdrop').forEach(el => el.remove());

  const backdrop = document.createElement('div');
  backdrop.className = 'fluent-modal-backdrop fluent-prop-backdrop';

  const card = document.createElement('div');
  card.className = 'fluent-modal-card fluent-prop-card';

  // 1. Window Titlebar
  const titlebar = document.createElement('div');
  titlebar.className = 'prop-titlebar';

  const winTitle = document.createElement('div');
  winTitle.className = 'prop-titlebar-title';
  winTitle.textContent = t('prop.title', { name: file.name }, `${file.name} 內容`);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'prop-close-btn';
  closeBtn.appendChild(icon(ICONS.x, 'icon-xs'));
  closeBtn.title = t('common.close') || '關閉';

  titlebar.append(winTitle, closeBtn);

  // 2. Tab Bar
  const tabbar = document.createElement('div');
  tabbar.className = 'prop-tabbar';
  const generalTab = document.createElement('div');
  generalTab.className = 'prop-tab-item active';
  generalTab.textContent = t('prop.general') || '一般';
  tabbar.appendChild(generalTab);

  // 3. Content Body
  const content = document.createElement('div');
  content.className = 'prop-content';

  // Header: Large Icon + Filename
  const header = document.createElement('div');
  header.className = 'prop-header';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'prop-icon-wrap';
  const iconEl = fileIconEl(file);
  iconWrap.appendChild(iconEl);

  const nameBox = document.createElement('div');
  nameBox.className = 'prop-name-box';
  const nameEl = document.createElement('div');
  nameEl.className = 'prop-filename';
  nameEl.textContent = file.name;
  nameBox.appendChild(nameEl);

  header.append(iconWrap, nameBox);
  content.appendChild(header);

  // Section 1: Type & Opens With
  const div1 = document.createElement('div');
  div1.className = 'prop-divider';
  content.appendChild(div1);

  const sec1 = document.createElement('div');
  sec1.className = 'prop-section';

  // Type
  const typeRow = document.createElement('div');
  typeRow.className = 'prop-row';
  const typeLabel = document.createElement('div');
  typeLabel.className = 'prop-label';
  typeLabel.textContent = t('prop.type') || '檔案類型：';
  const typeVal = document.createElement('div');
  typeVal.className = 'prop-val';
  typeVal.textContent = file.isDir
    ? (t('prop.folderType') || '檔案資料夾')
    : (file.extension ? t('prop.fileType', { ext: file.extension.toUpperCase() }, `${file.extension.toUpperCase()} 檔案`) : '檔案');
  typeRow.append(typeLabel, typeVal);
  sec1.appendChild(typeRow);

  // Opens With (files only)
  let opensWithRow = null;
  let opensWithVal = null;
  if (!file.isDir) {
    opensWithRow = document.createElement('div');
    opensWithRow.className = 'prop-row';
    const owLabel = document.createElement('div');
    owLabel.className = 'prop-label';
    owLabel.textContent = t('prop.opensWith') || '開啟方式：';

    opensWithVal = document.createElement('div');
    opensWithVal.className = 'prop-val prop-val-interactive';
    const owText = document.createElement('span');
    owText.textContent = '—';

    const changeBtn = document.createElement('button');
    changeBtn.className = 'prop-inline-btn';
    changeBtn.textContent = t('prop.change') || '變更…';
    changeBtn.addEventListener('click', async () => {
      try {
        await showOpenWithDialog(file.path);
      } catch (err) {
        toast(String(err), 'error');
      }
    });

    opensWithVal.append(owText, changeBtn);
    opensWithRow.append(owLabel, opensWithVal);
    sec1.appendChild(opensWithRow);
  }
  content.appendChild(sec1);

  // Section 2: Location & Size
  const div2 = document.createElement('div');
  div2.className = 'prop-divider';
  content.appendChild(div2);

  const sec2 = document.createElement('div');
  sec2.className = 'prop-section';

  // Location
  const locRow = document.createElement('div');
  locRow.className = 'prop-row';
  const locLabel = document.createElement('div');
  locLabel.className = 'prop-label';
  locLabel.textContent = t('prop.location') || '位置：';
  const locVal = document.createElement('div');
  locVal.className = 'prop-val prop-val-interactive';
  const locText = document.createElement('span');
  const parentPath = file.path.includes('\\')
    ? file.path.substring(0, file.path.lastIndexOf('\\'))
    : file.path.substring(0, file.path.lastIndexOf('/'));
  locText.textContent = parentPath || file.path;

  const copyPathBtn = document.createElement('button');
  copyPathBtn.className = 'prop-inline-btn';
  copyPathBtn.textContent = t('prop.copyPath') || '複製路徑';
  copyPathBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(file.path);
      toast(t('context.pathCopied') || '已複製路徑', 'success');
    } catch {
      toast('複製失敗', 'error');
    }
  });

  locVal.append(locText, copyPathBtn);
  locRow.append(locLabel, locVal);
  sec2.appendChild(locRow);

  // Size
  const sizeRow = document.createElement('div');
  sizeRow.className = 'prop-row';
  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'prop-label';
  sizeLabel.textContent = t('prop.size') || '大小：';
  const sizeVal = document.createElement('div');
  sizeVal.className = 'prop-val';
  sizeVal.textContent = file.isDir
    ? (t('prop.calculating') || '計算中…')
    : `${formatFileSize(file.size || 0)} (${Number(file.size || 0).toLocaleString()} 位元組)`;
  sizeRow.append(sizeLabel, sizeVal);
  sec2.appendChild(sizeRow);

  // Contains (folder only)
  let containsRow = null;
  let containsVal = null;
  if (file.isDir) {
    containsRow = document.createElement('div');
    containsRow.className = 'prop-row';
    const cLabel = document.createElement('div');
    cLabel.className = 'prop-label';
    cLabel.textContent = t('prop.contains') || '包含：';
    containsVal = document.createElement('div');
    containsVal.className = 'prop-val';
    containsVal.textContent = t('prop.calculating') || '計算中…';
    containsRow.append(cLabel, containsVal);
    sec2.appendChild(containsRow);
  }
  content.appendChild(sec2);

  // Section 3: Timestamps
  const div3 = document.createElement('div');
  div3.className = 'prop-divider';
  content.appendChild(div3);

  const sec3 = document.createElement('div');
  sec3.className = 'prop-section';

  // Created
  const createdRow = document.createElement('div');
  createdRow.className = 'prop-row';
  const createdLabel = document.createElement('div');
  createdLabel.className = 'prop-label';
  createdLabel.textContent = t('prop.created') || '建立時間：';
  const createdVal = document.createElement('div');
  createdVal.className = 'prop-val';
  createdVal.textContent = '—';
  createdRow.append(createdLabel, createdVal);
  sec3.appendChild(createdRow);

  // Modified
  const modRow = document.createElement('div');
  modRow.className = 'prop-row';
  const modLabel = document.createElement('div');
  modLabel.className = 'prop-label';
  modLabel.textContent = t('prop.modified') || '修改時間：';
  const modVal = document.createElement('div');
  modVal.className = 'prop-val';
  modVal.textContent = formatDate(file.modified) || '—';
  modRow.append(modLabel, modVal);
  sec3.appendChild(modRow);

  // Accessed
  const accRow = document.createElement('div');
  accRow.className = 'prop-row';
  const accLabel = document.createElement('div');
  accLabel.className = 'prop-label';
  accLabel.textContent = t('prop.accessed') || '存取時間：';
  const accVal = document.createElement('div');
  accVal.className = 'prop-val';
  accVal.textContent = '—';
  accRow.append(accLabel, accVal);
  sec3.appendChild(accRow);

  content.appendChild(sec3);

  // Section 4: Attributes (Readonly & Hidden)
  const div4 = document.createElement('div');
  div4.className = 'prop-divider';
  content.appendChild(div4);

  const sec4 = document.createElement('div');
  sec4.className = 'prop-section';

  const attrRow = document.createElement('div');
  attrRow.className = 'prop-row';
  const attrLabel = document.createElement('div');
  attrLabel.className = 'prop-label';
  attrLabel.textContent = t('prop.attributes') || '屬性：';

  const attrVal = document.createElement('div');
  attrVal.className = 'prop-val prop-attrs';

  const roWrap = document.createElement('label');
  roWrap.className = 'prop-checkbox-label';
  const roCheck = document.createElement('input');
  roCheck.type = 'checkbox';
  const roText = document.createTextNode(t('prop.readOnly') || '唯讀');
  roWrap.append(roCheck, roText);

  const hWrap = document.createElement('label');
  hWrap.className = 'prop-checkbox-label';
  const hCheck = document.createElement('input');
  hCheck.type = 'checkbox';
  const hText = document.createTextNode(t('prop.hidden') || '隱藏');
  hWrap.append(hCheck, hText);

  attrVal.append(roWrap, hWrap);
  attrRow.append(attrLabel, attrVal);
  sec4.appendChild(attrRow);
  content.appendChild(sec4);

  // 4. Footer Actions
  const footer = document.createElement('div');
  footer.className = 'prop-actions';

  const revealBtn = document.createElement('button');
  revealBtn.className = 'fluent-btn fluent-btn-secondary';
  revealBtn.textContent = t('prop.openInExplorer') || '在檔案總管中開啟';
  revealBtn.addEventListener('click', async () => {
    try {
      await revealInExplorer(file.path);
    } catch (err) {
      toast(String(err), 'error');
    }
  });

  const rightBtns = document.createElement('div');
  rightBtns.className = 'prop-actions-right';

  const okBtn = document.createElement('button');
  okBtn.className = 'fluent-btn fluent-btn-primary';
  okBtn.textContent = t('common.ok') || '確定';

  rightBtns.appendChild(okBtn);
  footer.append(revealBtn, rightBtns);

  card.append(titlebar, tabbar, content, footer);
  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  requestAnimationFrame(() => {
    backdrop.classList.add('visible');
    okBtn.focus();
  });

  const cleanup = () => {
    backdrop.classList.remove('visible');
    setTimeout(() => backdrop.remove(), 150);
  };

  closeBtn.addEventListener('click', cleanup);
  okBtn.addEventListener('click', cleanup);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cleanup();
  });
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      cleanup();
    }
  });

  // Handle attribute toggle changes
  let initialAttrsLoaded = false;
  const updateAttrs = async () => {
    if (!initialAttrsLoaded) return;
    try {
      await setFileAttributes(file.path, roCheck.checked, hCheck.checked);
      toast(t('common.save') || '屬性已更新', 'success');
    } catch (err) {
      toast(String(err), 'error');
    }
  };
  roCheck.addEventListener('change', updateAttrs);
  hCheck.addEventListener('change', updateAttrs);

  // Asynchronous Loading: fetch accurate detailed file properties
  (async () => {
    try {
      const p = await getFileProperties(file.path);
      if (!p) return;

      if (p.typeDescription) typeVal.textContent = p.typeDescription;
      if (opensWithVal && p.opensWith) {
        opensWithVal.querySelector('span').textContent = p.opensWith;
      }
      if (p.created) createdVal.textContent = formatDate(p.created);
      if (p.modified) modVal.textContent = formatDate(p.modified);
      if (p.accessed) accVal.textContent = formatDate(p.accessed);

      roCheck.checked = !!p.isReadonly;
      hCheck.checked = !!p.isHidden;
      initialAttrsLoaded = true;

      if (!file.isDir && p.size != null) {
        sizeVal.textContent = `${formatFileSize(p.size)} (${Number(p.size).toLocaleString()} 位元組)`;
      }
    } catch (err) {
      console.warn('getFileProperties error:', err);
      initialAttrsLoaded = true;
    }
  })();

  // If folder: calculate folder size & item count asynchronously
  if (file.isDir) {
    (async () => {
      try {
        const detail = await calcFolderDetail(file.path);
        if (detail && sizeVal && containsVal) {
          sizeVal.textContent = `${formatFileSize(detail.size)} (${Number(detail.size).toLocaleString()} 位元組)`;
          containsVal.textContent = t('prop.containsCount', {
            files: detail.fileCount.toLocaleString(),
            folders: detail.folderCount.toLocaleString(),
          }, `${detail.fileCount} 個檔案，${detail.folderCount} 個資料夾`);
        }
      } catch (err) {
        if (sizeVal) sizeVal.textContent = '—';
        if (containsVal) containsVal.textContent = '—';
      }
    })();
  }
}
