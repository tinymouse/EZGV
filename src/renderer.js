const selectFolderBtn = document.getElementById('select-folder-btn');
const folderPathDisplay = document.getElementById('folder-path');
const imageGrid = document.getElementById('image-grid');
const loadingOverlay = document.getElementById('loading');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const closeLightbox = document.querySelector('.close-lightbox');

const detailsContent = document.getElementById('details-content');
const noSelection = document.getElementById('no-selection');
const detailPreview = document.getElementById('detail-preview');
const detailFilename = document.getElementById('detail-filename');
const detailResolution = document.getElementById('detail-resolution');
const detailFilesize = document.getElementById('detail-filesize');
const viewBtn = document.getElementById('view-btn');
const deleteSelectionBtn = document.getElementById('delete-selection-btn');
const moveSelectionBtn = document.getElementById('move-selection-btn');

// State
let allImagesData = []; // Store raw data from main process
let allImageCards = []; // Store references for Shift+Click
let selectedImages = new Set(); // Store paths
let lastSelectedCardIndex = -1; // For Shift+Click range
let masterLabels = []; // Loaded from settings
let aiSuggestedLabels = new Set(); // Labels suggested by AI but not yet saved
let pendingAiSuggestions = new Map(); // path -> Set of suggested labels

let currentSort = 'folder'; // 'folder', 'name', 'date'
let currentOrder = 'asc'; // 'asc', 'desc'

const saveLabelsBtn = document.getElementById('save-labels-btn');
const filterBtn = document.getElementById('filter-btn');
const openSettingsBtn = document.getElementById('open-settings-btn');
const labelModal = document.getElementById('label-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const masterLabelList = document.getElementById('master-label-list');
const addMasterLabelBtn = document.getElementById('add-master-label-btn');
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const geminiModelInput = document.getElementById('gemini-model');
const aiAllowNewLabelsCheckbox = document.getElementById('ai-allow-new-labels');
const immediateFilterCheckbox = document.getElementById('immediate-filter-checkbox');
const immediateLabelSaveCheckbox = document.getElementById('immediate-label-save-checkbox');

const autoLabelBtn = document.getElementById('auto-label-btn');

const filterContainer = document.getElementById('filter-checkboxes');
const detailLabelContainer = document.getElementById('label-container');

const renamePrefixInput = document.getElementById('rename-prefix');
const renameSeparatorInput = document.getElementById('rename-separator');
const renameDateCheckbox = document.getElementById('rename-date');
const renameTimeCheckbox = document.getElementById('rename-time');
const renameSecondsCheckbox = document.getElementById('rename-seconds');
const renameLabelsCheckbox = document.getElementById('rename-labels');
const renameLabelsAfterCheckbox = document.getElementById('rename-labels-after');
const renameSequenceCheckbox = document.getElementById('rename-sequence');
const renameAutoSequenceCheckbox = document.getElementById('rename-auto-sequence');
const renameSequenceDigits = document.getElementById('rename-sequence-digits');
const renamePreview = document.getElementById('rename-preview');
const renameBtn = document.getElementById('rename-btn');

const splitRowsInput = document.getElementById('split-rows');
const splitColsInput = document.getElementById('split-cols');
const splitBtn = document.getElementById('split-btn');

async function loadMasterLabels() {
    masterLabels = await window.electronAPI.getMasterLabels();
    const apiKey = await window.electronAPI.getGeminiApiKey();
    if (geminiApiKeyInput) geminiApiKeyInput.value = apiKey;

    const model = await window.electronAPI.getGeminiModel();
    if (geminiModelInput) geminiModelInput.value = model || 'gemini-1.5-flash';

    const allowNew = await window.electronAPI.getAiAllowNewLabels();
    if (aiAllowNewLabelsCheckbox) aiAllowNewLabelsCheckbox.checked = allowNew !== false;

    // Load Immediate Filter Setting
    const immediateFilter = await window.electronAPI.getImmediateFilter();
    if (immediateFilterCheckbox) {
        immediateFilterCheckbox.checked = immediateFilter;
        updateFilterBtnVisibility(immediateFilter);
    }

    // Load Immediate Label Save Setting
    const immediateLabelSave = await window.electronAPI.getImmediateLabelSave();
    if (immediateLabelSaveCheckbox) {
        immediateLabelSaveCheckbox.checked = immediateLabelSave;
        updateSaveLabelsBtnVisibility(immediateLabelSave);
    }

    // Load Sort Settings
    const sortSettings = await window.electronAPI.getSortSettings();
    if (sortSettings) {
        currentSort = sortSettings.type || 'folder';
        currentOrder = sortSettings.order || 'asc';
        updateSortUI();
    }

    // Load Rename Settings
    const renameSettings = await window.electronAPI.getRenameSettings();
    if (renameSettings) {
        if (renamePrefixInput) renamePrefixInput.value = renameSettings.prefix || '';
        if (renameSeparatorInput) renameSeparatorInput.value = renameSettings.separator || '_';
        if (renameDateCheckbox) renameDateCheckbox.checked = !!renameSettings.date;
        if (renameTimeCheckbox) renameTimeCheckbox.checked = !!renameSettings.time;
        if (renameSecondsCheckbox) renameSecondsCheckbox.checked = !!renameSettings.seconds;
        if (renameLabelsCheckbox) renameLabelsCheckbox.checked = !!renameSettings.labels;
        if (renameLabelsAfterCheckbox) renameLabelsAfterCheckbox.checked = !!renameSettings.labelsAfter;
        if (renameSequenceCheckbox) renameSequenceCheckbox.checked = !!renameSettings.sequence;
        if (renameAutoSequenceCheckbox) renameAutoSequenceCheckbox.checked = !!renameSettings.autoSequence;
        if (renameSequenceDigits) renameSequenceDigits.value = renameSettings.digits || 2;
    }

    updateRenameUIState();
    renderDynamicLabels();
}

function updateRenameUIState() {
    if (renameSequenceCheckbox && renameAutoSequenceCheckbox) {
        const isSequenceManual = renameSequenceCheckbox.checked;
        renameAutoSequenceCheckbox.disabled = isSequenceManual;
        const wrapper = document.getElementById('rename-auto-sequence-wrapper');
        if (wrapper) {
            wrapper.style.opacity = isSequenceManual ? '0.5' : '1';
        }
    }
}

function updateSortUI() {
    document.querySelectorAll('.sort-btn').forEach(btn => {
        const type = btn.getAttribute('data-sort');
        btn.classList.remove('active');

        let label = btn.textContent.replace(/[↑↓]/, '').trim();
        btn.textContent = label;

        if (type === currentSort) {
            btn.classList.add('active');
            const arrow = currentOrder === 'asc' ? '↑' : '↓';
            btn.textContent = `${label} ${arrow}`;
        }
    });
}

function renderDynamicLabels() {
    // Collect all labels currently present in the loaded images data
    // Map: LabelName -> GroupName
    const labelGroupMap = new Map();

    // 1. Initialize with Master Labels (Highest Priority)
    masterLabels.forEach(l => {
        labelGroupMap.set(l.name, l.group);
    });

    // 2. Scan images for labels
    allImagesData.forEach(img => {
        if (img.labels) {
            img.labels.forEach(l => {
                // If already defined by master label, skip (master wins)
                if (labelGroupMap.has(l)) return;

                // Check if image metadata has specific group for this label
                // We need to ensure getImages returns labelGroups now?
                // Actually, main.js getImages implementation needs check.
                // Assuming allImagesData items now might have labelGroups property if we updated getImages?
                // Wait, getImages in main.js calls getMetadataForFile but does it return labelGroups?
                // Let's check main.js getImages/readdir logic. 
                // Since I modified getMetadataForFile in main.js, I need to make sure 'get-images' returns it.
                // Assuming it does (or I will fix it next), let's use it.

                let adhocGroup = '未分類';
                if (img.labelGroups && img.labelGroups[l]) {
                    adhocGroup = img.labelGroups[l];
                }

                // If multiple images have same label but different groups, 
                // we treat the first one encountered as the ad-hoc definition, 
                // or maybe "未分類" if inconsistent? 
                // For simplicity, first writer wins for ad-hoc, or prefer existing if not '未分類'.

                if (!labelGroupMap.has(l)) {
                    labelGroupMap.set(l, adhocGroup);
                }
            });
        }
    });

    // Also include labels currently suggested by AI
    aiSuggestedLabels.forEach(l => {
        if (!labelGroupMap.has(l)) {
            labelGroupMap.set(l, '未分類');
        }
    });

    // Grouping structure: { groupName: [labelName, ...] }
    const groups = {};

    labelGroupMap.forEach((group, name) => {
        if (!groups[group]) groups[group] = [];
        groups[group].push(name);
    });

    // Sort labels within groups
    Object.keys(groups).forEach(g => {
        groups[g].sort();
    });

    // Save current filter state to restore after re-render
    const currentFilters = getFilterCheckboxes();
    const previouslyChecked = Object.keys(currentFilters).filter(label => currentFilters[label].checked);

    // Helper to create a group container
    function createGroupUI(groupName, labelNames, isFilterView) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'label-group';

        const title = document.createElement('div');
        title.className = 'group-title';
        title.textContent = groupName;
        groupDiv.appendChild(title);

        const listDiv = document.createElement('div');
        listDiv.className = isFilterView ? 'filter-checkboxes' : 'label-container';

        labelNames.forEach(label => {
            const row = document.createElement('div');
            row.className = 'label-row';
            const prefix = isFilterView ? 'filter' : 'detail';
            const id = `${prefix}-label-${label}`;

            if (isFilterView) {
                const isChecked = previouslyChecked.includes(label);
                row.innerHTML = `
                    <input type="checkbox" id="${id}" data-label="${label}" ${isChecked ? 'checked' : ''}>
                    <label for="${id}">${label}</label>
                `;
            } else {
                row.innerHTML = `
                    <input type="checkbox" id="${id}" data-label="${label}">
                    <label for="${id}">${label}</label>
                `;
            }
            listDiv.appendChild(row);
        });

        groupDiv.appendChild(listDiv);
        return groupDiv;
    }

    // 1. Search Pane
    filterContainer.innerHTML = '';
    const searchGroupRoot = document.createElement('div');
    searchGroupRoot.className = 'label-groups';
    Object.entries(groups).forEach(([groupName, labels]) => {
        searchGroupRoot.appendChild(createGroupUI(groupName, labels, true));
    });
    filterContainer.appendChild(searchGroupRoot);

    // 2. Details Pane
    detailLabelContainer.innerHTML = '';
    const detailGroupRoot = document.createElement('div');
    detailGroupRoot.className = 'label-groups';
    // Small optimization for side pane: might want single column if groups are many? 
    // But user asked for box styling, so let's stick to consistent flex.
    Object.entries(groups).forEach(([groupName, labels]) => {
        detailGroupRoot.appendChild(createGroupUI(groupName, labels, false));
    });
    detailLabelContainer.appendChild(detailGroupRoot);

    // Re-sync UI state if images are selected
    updateDetailsPane();
}

function getFilterCheckboxes() {
    return Array.from(filterContainer.querySelectorAll('input[type="checkbox"]'))
        .reduce((acc, input) => {
            acc[input.getAttribute('data-label')] = input;
            return acc;
        }, {});
}

function getDetailCheckboxes() {
    return Array.from(detailLabelContainer.querySelectorAll('input[type="checkbox"]'))
        .reduce((acc, input) => {
            acc[input.getAttribute('data-label')] = input;
            return acc;
        }, {});
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function updateDetailsPane() {
    const count = selectedImages.size;

    if (count === 0) {
        noSelection.classList.remove('hidden');
        detailsContent.classList.add('hidden');
        return;
    }

    noSelection.classList.add('hidden');
    detailsContent.classList.remove('hidden');

    if (count === 1) {
        // Single File View
        const imagePath = Array.from(selectedImages)[0];
        const encodedPath = encodeURIComponent(imagePath);
        const fileName = imagePath.split(/[\\/]/).pop();

        detailFilename.textContent = fileName;
        detailPreview.src = `local-image://load?path=${encodedPath}`;

        // Reset/Wait resolution
        detailResolution.textContent = '...';

        try {
            const details = await window.electronAPI.getFileDetails(imagePath);
            if (details) detailFilesize.textContent = formatBytes(details.size);
        } catch (e) {
            detailFilesize.textContent = '-';
        }

        if (detailPreview.complete) {
            detailResolution.textContent = `${detailPreview.naturalWidth} x ${detailPreview.naturalHeight}`;
        } else {
            detailPreview.onload = () => {
                detailResolution.textContent = `${detailPreview.naturalWidth} x ${detailPreview.naturalHeight}`;
            };
        }
        viewBtn.disabled = false;

    } else {
        // Multiple Files View
        detailFilename.textContent = `${count} files selected`;
        detailPreview.src = '';
        detailResolution.textContent = '-';
        detailFilesize.textContent = '-';
        viewBtn.disabled = false;
    }

    // Update Labels
    const currentDetailCheckboxes = getDetailCheckboxes();
    Object.values(currentDetailCheckboxes).forEach(checkbox => {
        checkbox.checked = false;
        checkbox.indeterminate = false;
    });

    if (count > 0) {
        Object.keys(currentDetailCheckboxes).forEach(labelName => {
            const checkbox = currentDetailCheckboxes[labelName];
            let matchCount = 0;

            selectedImages.forEach(path => {
                const card = allImageCards.find(c => c.path === path);
                if (card && card.labels && card.labels.includes(labelName)) {
                    matchCount++;
                }
            });

            if (matchCount === count) {
                checkbox.checked = true;
                checkbox.indeterminate = false;
            } else if (matchCount === 0) {
                checkbox.checked = false;
                checkbox.indeterminate = false;
            } else {
                checkbox.checked = false;
                checkbox.indeterminate = true;
            }
        });
    }

    updateRenamePreview();
}

function generateNewName(index, total, imagePath, labels) {
    const prefix = renamePrefixInput.value.trim();
    const separator = renameSeparatorInput.value;
    const parts = [];

    if (prefix) parts.push(prefix);

    const now = new Date();

    if (renameLabelsCheckbox.checked && labels && labels.length > 0 && !renameLabelsAfterCheckbox.checked) {
        parts.push(labels.join(separator));
    }

    if (renameDateCheckbox.checked) {
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        parts.push(`${y}${m}${d}`);
    }

    if (renameTimeCheckbox.checked) {
        const h = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        let timeStr = `${h}${mi}`;
        if (renameSecondsCheckbox.checked) {
            timeStr += String(now.getSeconds()).padStart(2, '0');
        }
        parts.push(timeStr);
    }

    if (renameLabelsCheckbox.checked && labels && labels.length > 0 && renameLabelsAfterCheckbox.checked) {
        parts.push(labels.join(separator));
    }

    if (renameSequenceCheckbox.checked) {
        const digits = parseInt(renameSequenceDigits.value);
        parts.push(String(index + 1).padStart(digits, '0'));
    }

    return parts.join(separator);
}

function updateRenamePreview() {
    if (!renamePreview) return;
    if (selectedImages.size === 0) {
        renamePreview.textContent = '-';
        return;
    }
    // Sort selected images by the current grid order (allImagesData)
    const imagesArray = allImagesData
        .filter(img => selectedImages.has(img.path));

    if (imagesArray.length === 0) {
        renamePreview.textContent = '-';
        return;
    }

    const firstItem = imagesArray[0];
    const labels = firstItem.labels || [];

    const newNameBase = generateNewName(0, imagesArray.length, firstItem.path, labels);
    if (!newNameBase) {
        renamePreview.textContent = '-';
        return;
    }

    const ext = firstItem.path.split('.').pop();
    renamePreview.textContent = `${newNameBase}.${ext}`;
}

// Rename Listeners
[
    renamePrefixInput, renameSeparatorInput, renameDateCheckbox, renameTimeCheckbox,
    renameSecondsCheckbox, renameLabelsCheckbox, renameLabelsAfterCheckbox,
    renameSequenceCheckbox, renameAutoSequenceCheckbox, renameSequenceDigits
].forEach(el => {
    if (el) {
        const handler = () => {
            if (el === renameSequenceCheckbox) {
                updateRenameUIState();
            }
            updateRenamePreview();
            // Save settings whenever something changes
            const settings = {
                prefix: renamePrefixInput.value,
                separator: renameSeparatorInput.value,
                date: renameDateCheckbox.checked,
                time: renameTimeCheckbox.checked,
                seconds: renameSecondsCheckbox.checked,
                labels: renameLabelsCheckbox.checked,
                labelsAfter: renameLabelsAfterCheckbox.checked,
                sequence: renameSequenceCheckbox.checked,
                autoSequence: renameAutoSequenceCheckbox.checked,
                digits: parseInt(renameSequenceDigits.value)
            };
            window.electronAPI.saveRenameSettings(settings);
        };
        el.addEventListener('input', handler);
        el.addEventListener('change', handler);
    }
});

renameBtn.addEventListener('click', async () => {
    // Sort selected images by the current grid order (allImagesData)
    const imagesArray = allImagesData
        .filter(img => selectedImages.has(img.path));

    if (imagesArray.length === 0) return;

    if (!confirm(`${imagesArray.length}件のファイルをリネームしますか？`)) return;

    renameBtn.disabled = true;
    const originalText = renameBtn.innerHTML;
    renameBtn.innerHTML = '実行中...';

    try {
        const results = [];
        for (let i = 0; i < imagesArray.length; i++) {
            const oldItem = imagesArray[i];
            const oldPath = oldItem.path;
            const labels = oldItem.labels || [];
            const newBaseName = generateNewName(i, imagesArray.length, oldPath, labels);

            if (!newBaseName) continue;

            const res = await window.electronAPI.renameFile(
                oldPath,
                newBaseName,
                renameAutoSequenceCheckbox.checked && !renameSequenceCheckbox.checked,
                renameSeparatorInput.value
            );
            if (res.success) {
                // Update local state
                const idx = allImagesData.findIndex(d => d.path === oldPath);
                if (idx !== -1) {
                    allImagesData[idx].path = res.newPath;
                }

                // Update selection set
                selectedImages.delete(oldPath);
                selectedImages.add(res.newPath);
            } else {
                console.error(`Rename failed for ${oldPath}:`, res.error);
            }
            results.push(res);
        }

        const successCount = results.filter(r => r.success).length;
        if (successCount > 0) {
            alert(`${successCount}件のリネームが完了しました。`);
            applyFilters(true);
        } else {
            alert('リネームに失敗しました。');
        }
    } catch (e) {
        console.error(e);
        alert('エラーが発生しました');
    } finally {
        renameBtn.disabled = false;
        renameBtn.innerHTML = originalText;
    }
});

splitBtn.addEventListener('click', async () => {
    const imagesArray = Array.from(selectedImages);
    if (imagesArray.length === 0) return;

    const rows = parseInt(splitRowsInput.value);
    const cols = parseInt(splitColsInput.value);

    if (isNaN(rows) || rows < 1 || isNaN(cols) || cols < 1) {
        alert('正当な分割数を入力してください。');
        return;
    }

    if (rows === 1 && cols === 1) {
        alert('分割数が1x1です。');
        return;
    }

    if (!confirm(`${imagesArray.length}件のファイルを ${rows}x${cols} に分割しますか？\n(分割後のファイルは同じフォルダに保存されます)`)) return;

    splitBtn.disabled = true;
    const originalText = splitBtn.innerHTML;
    splitBtn.innerHTML = '分割中...';

    try {
        let totalCreated = 0;
        for (const filePath of imagesArray) {
            const res = await window.electronAPI.splitImage(filePath, rows, cols);
            if (res.success) {
                totalCreated += res.count;
            } else {
                console.error(`Split failed for ${filePath}:`, res.error);
                alert(`${path.basename(filePath)} の分割に失敗しました: ${res.error}`);
            }
        }

        if (totalCreated > 0) {
            alert(`${totalCreated}枚の画像を作成しました。`);
            // Refresh folder to show new images
            const pathTxt = folderPathDisplay.textContent;
            if (pathTxt && pathTxt !== '未選択') {
                loadImages(pathTxt);
            }
        }
    } catch (e) {
        console.error(e);
        alert('エラーが発生しました');
    } finally {
        splitBtn.disabled = false;
        splitBtn.innerHTML = originalText;
    }
});

// ... helper ...

async function saveCurrentLabels() {
    const count = selectedImages.size;
    if (count === 0) return;

    if (saveLabelsBtn) {
        saveLabelsBtn.disabled = true;
        saveLabelsBtn.textContent = '保存中...';
    }

    try {
        const updates = {};
        const currentDetailCheckboxes = getDetailCheckboxes();
        Object.entries(currentDetailCheckboxes).forEach(([label, box]) => {
            if (box.indeterminate) updates[label] = 'ignore';
            else if (box.checked) updates[label] = 'add';
            else updates[label] = 'remove';
        });

        const promises = [];

        selectedImages.forEach(path => {
            const cardRef = allImageCards.find(c => c.path === path);
            if (!cardRef) return;

            let newLabels = new Set(cardRef.labels || []);

            Object.entries(updates).forEach(([label, action]) => {
                if (action === 'add') {
                    newLabels.add(label);
                } else if (action === 'remove') {
                    newLabels.delete(label);
                } else if (action === 'ignore') {
                    // Check if there was a pending AI suggestion for this specific image
                    const suggestions = pendingAiSuggestions.get(path);
                    if (suggestions && suggestions.has(label)) {
                        newLabels.add(label);
                    }
                }
            });

            const finalLabels = Array.from(newLabels);
            promises.push(window.electronAPI.saveFileLabels(path, finalLabels).then(res => {
                if (res.success) {
                    cardRef.labels = finalLabels;
                    // Also update data source
                    const dataItem = allImagesData.find(d => d.path === path);
                    if (dataItem) dataItem.labels = finalLabels;
                }
                return res;
            }));
        });

        await Promise.all(promises);

        // Remove processed AI suggestions
        selectedImages.forEach(path => {
            pendingAiSuggestions.delete(path);
        });

        // Refresh UI
        renderDynamicLabels();
        // Note: renderDynamicLabels calls updateDetailsPane, which syncs checkboxes

    } catch (e) {
        console.error(e);
        alert('ラベル保存中にエラーが発生しました');
    } finally {
        if (saveLabelsBtn) {
            saveLabelsBtn.disabled = false;
            saveLabelsBtn.textContent = '登録 (Save)';
        }
    }
}

saveLabelsBtn.addEventListener('click', async () => {
    await saveCurrentLabels();
});

filterBtn.addEventListener('click', () => {
    applyFilters();
});

function applyFilters(keepSelection = false) {
    const currentFilterCheckboxes = getFilterCheckboxes();
    const activeFilters = Object.entries(currentFilterCheckboxes)
        .filter(([label, box]) => box.checked)
        .map(([label, box]) => label);

    let filtered = [...allImagesData];
    if (activeFilters.length > 0) {
        filtered = filtered.filter(img =>
            activeFilters.every(f => img.labels && img.labels.includes(f))
        );
    }

    // Sort the results
    filtered.sort((a, b) => {
        let valA, valB;
        if (currentSort === 'manual') {
            valA = a.order !== undefined ? a.order : 1000000;
            valB = b.order !== undefined ? b.order : 1000000;
        } else if (currentSort === 'folder') {
            valA = a.path.toLowerCase();
            valB = b.path.toLowerCase();
        } else if (currentSort === 'name') {
            valA = a.path.split(/[\\/]/).pop().toLowerCase();
            valB = b.path.split(/[\\/]/).pop().toLowerCase();
        } else if (currentSort === 'date') {
            valA = a.mtime || 0;
            valB = b.mtime || 0;
        }

        if (valA < valB) return currentOrder === 'asc' ? -1 : 1;
        if (valA > valB) return currentOrder === 'asc' ? 1 : -1;
        return 0;
    });

    renderGrid(filtered, keepSelection);
}

// Sort Button Listeners
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const sortType = btn.getAttribute('data-sort');

        if (currentSort === sortType) {
            // Toggle order if same criteria
            currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
        } else {
            // Change criteria, default order based on type
            currentSort = sortType;
            currentOrder = sortType === 'date' ? 'desc' : 'asc';
        }

        // Save settings
        window.electronAPI.saveSortSettings({ type: currentSort, order: currentOrder });

        // Update UI
        updateSortUI();

        applyFilters(true);
    });
});


function handleSelection(card, index, imagePath, event) {
    const isCtrl = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;
    const isCheckbox = event.target.classList.contains('checkbox-overlay');

    if (isCheckbox) {
        // Toggle specific item via checkbox
        if (selectedImages.has(imagePath)) {
            selectedImages.delete(imagePath);
            card.classList.remove('selected');
        } else {
            selectedImages.add(imagePath);
            card.classList.add('selected');
            lastSelectedCardIndex = index;
        }
    } else if (isShift && lastSelectedCardIndex !== -1) {
        // Range selection
        if (!isCtrl) {
            // Clear others if Ctrl is not held
            selectedImages.clear();
            allImageCards.forEach(c => c.element.classList.remove('selected'));
        }

        const start = Math.min(lastSelectedCardIndex, index);
        const end = Math.max(lastSelectedCardIndex, index);

        for (let i = start; i <= end; i++) {
            const item = allImageCards[i];
            selectedImages.add(item.path);
            item.element.classList.add('selected');
        }
    } else if (isCtrl) {
        // Toggle selection via Ctrl+Click
        if (selectedImages.has(imagePath)) {
            selectedImages.delete(imagePath);
            card.classList.remove('selected');
        } else {
            selectedImages.add(imagePath);
            card.classList.add('selected');
            lastSelectedCardIndex = index;
        }
    } else {
        // Single selection (reset others)
        selectedImages.clear();
        allImageCards.forEach(c => c.element.classList.remove('selected'));

        selectedImages.add(imagePath);
        card.classList.add('selected');
        lastSelectedCardIndex = index;
    }

    updateDetailsPane();
}

function renderGrid(data, keepSelection = false) {
    if (!keepSelection) {
        selectedImages.clear();
        lastSelectedCardIndex = -1;
    } else {
        // Only keep selected images that are still in the data (not filtered out)
        const dataPaths = new Set(data.map(d => d.path));
        selectedImages.forEach(path => {
            if (!dataPaths.has(path)) {
                selectedImages.delete(path);
            }
        });
        // We don't reset lastSelectedCardIndex here to maintain anchor if possible,
        // though it might point to a stale index in the new grid layout.
    }

    allImageCards = [];
    imageGrid.innerHTML = '';

    if (data.length === 0) {
        imageGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🏜️</div>
                <h2>画像が見つかりませんでした</h2>
                <p>条件に一致する画像がありません</p>
            </div>`;
    } else {
        data.forEach((imgObj, index) => {
            const imagePath = imgObj.path;
            const labels = imgObj.labels || [];

            const fileName = imagePath.split(/[\\/]/).pop();
            const card = document.createElement('div');
            card.className = 'image-card';
            card.draggable = (currentSort === 'manual'); // Only draggable in manual mode

            if (selectedImages.has(imagePath)) {
                card.classList.add('selected');
                // Update lastSelectedCardIndex if it's the only one selected or logically needs restoration
            }
            card.setAttribute('data-name', fileName);
            card.setAttribute('data-path', imagePath);
            card.setAttribute('data-index', index);

            const checkbox = document.createElement('div');
            checkbox.className = 'checkbox-overlay';
            card.appendChild(checkbox);

            const img = document.createElement('img');
            const encodedPath = encodeURIComponent(imagePath);
            img.src = `local-image://load?path=${encodedPath}`;
            img.loading = 'lazy';

            card.appendChild(img);

            // Store reference
            allImageCards.push({ element: card, path: imagePath, labels: labels });

            // Click to select
            card.addEventListener('click', (e) => {
                handleSelection(card, index, imagePath, e);
            });

            // Double click to view
            card.addEventListener('dblclick', () => {
                openLightbox([imagePath], 0, false);
            });

            // Drag and Drop listeners
            if (currentSort === 'manual') {
                card.addEventListener('dragstart', handleDragStart);
                card.addEventListener('dragover', handleDragOver);
                card.addEventListener('dragleave', handleDragLeave);
                card.addEventListener('drop', handleDrop);
            }

            imageGrid.appendChild(card);
        });
    }

    // Refresh the details pane to reflect the new grid state (and restore selection check states)
    updateDetailsPane();
}

let draggedItemPath = null;

function handleDragStart(e) {
    draggedItemPath = e.target.closest('.image-card').getAttribute('data-path');
    e.target.closest('.image-card').classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    const targetCard = e.target.closest('.image-card');
    const draggingCard = document.querySelector('.image-card.dragging');

    if (targetCard && draggingCard && targetCard !== draggingCard) {
        const children = Array.from(imageGrid.children);
        const draggingIdx = children.indexOf(draggingCard);
        const targetIdx = children.indexOf(targetCard);

        if (draggingIdx < targetIdx) {
            imageGrid.insertBefore(draggingCard, targetCard.nextSibling);
        } else {
            imageGrid.insertBefore(draggingCard, targetCard);
        }
    }
}

function handleDragLeave(e) {
    const card = e.target.closest('.image-card');
    if (card) {
        card.classList.remove('drag-over');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    const draggedCard = document.querySelector('.image-card.dragging');
    if (draggedCard) draggedCard.classList.remove('dragging');

    // Clear any lingering drag-over classes
    document.querySelectorAll('.image-card.drag-over').forEach(c => c.classList.remove('drag-over'));

    // Sync allImagesData with the new DOM order
    const newPathOrder = Array.from(imageGrid.querySelectorAll('.image-card'))
        .map(card => card.getAttribute('data-path'));

    if (newPathOrder.length > 0) {
        // Rebuild allImagesData in the new order
        const dataMap = new Map(allImagesData.map(img => [img.path, img]));
        const sortedData = newPathOrder.map(path => dataMap.get(path)).filter(Boolean);

        // Merge with items not currently visible in the grid (e.g. filtered out)
        const updatedPaths = new Set(newPathOrder);
        const remainingData = allImagesData.filter(img => !updatedPaths.has(img.path));

        allImagesData = [...sortedData, ...remainingData];

        // Update orders and persist
        await saveManualOrder();

        // Final re-render to ensure everything (indices, etc.) is perfectly synced
        applyFilters(true);
    }
}

async function saveManualOrder() {
    // Generate simple sequential orders based on current list
    const promises = allImagesData.map((img, idx) => {
        img.order = (idx + 1) * 10; // Use interval of 10 for easier insertions if needed later, starting from 10
        return window.electronAPI.saveFileOrder(img.path, img.order);
    });
    return Promise.all(promises);
}

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

    try {
        const imagesData = await window.electronAPI.getImages(folderPath); // Returns objects now
        allImagesData = imagesData; // Save to state
        renderDynamicLabels();
        applyFilters(); // Use applyFilters to ensure initial sorting
    } catch (error) {
        console.error('Failed to load images:', error);
        imageGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">❌</div>
                <h2>エラーが発生しました</h2>
                <p>${error.message}</p>
            </div>`;
    } finally {
        loadingOverlay.classList.add('hidden');
    }
}

// Lightbox State
const lightboxContent = document.getElementById('lightbox-content');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

let lightboxImages = []; // Array of paths to show
let currentLightboxIndex = 0; // Current start index
let isSplitView = false; // 1 or 2 images


// Internal helper to remove file from all UI components and state
function removeFileFromUI(path) {
    // State
    allImagesData = allImagesData.filter(d => d.path !== path);
    selectedImages.delete(path);
    lightboxImages = lightboxImages.filter(p => p !== path);
    renderDynamicLabels(); // Refresh in case an ad-hoc label is no longer used

    // Grid Element
    const cardRefIndex = allImageCards.findIndex(c => c.path === path);
    if (cardRefIndex !== -1) {
        allImageCards[cardRefIndex].element.remove();
        allImageCards.splice(cardRefIndex, 1);
    }
}

// Internal helper to update UI after one or more deletions
function finalizeDeletionUpdates() {
    // Update Lightbox
    if (!lightbox.classList.contains('hidden')) {
        if (lightboxImages.length === 0) {
            lightbox.classList.add('hidden');
        } else {
            const maxIndex = lightboxImages.length - (isSplitView ? 2 : 1);
            if (currentLightboxIndex > maxIndex) {
                currentLightboxIndex = Math.max(0, maxIndex);
            }
            updateLightboxView();
        }
    }

    // Update Side Pane
    updateDetailsPane();
}

// Delete Logic for Lightbox (single file)
async function deleteImage(path) {
    if (!confirm('本当に削除しますか？\nこの操作は元に戻せる場合があります（ゴミ箱へ移動）。')) return;

    try {
        const result = await window.electronAPI.deleteFile(path);
        if (result.success) {
            removeFileFromUI(path);
            finalizeDeletionUpdates();
        } else {
            console.error(result.error);
            alert('削除に失敗しました。');
        }
    } catch (e) {
        console.error(e);
        alert('削除中にエラーが発生しました。');
    }
}

// Move Logic for Lightbox
async function moveImage(path) {
    try {
        const destDir = await window.electronAPI.selectMoveDestination();
        if (!destDir) return; // Canceled

        const result = await window.electronAPI.moveFile(path, destDir);

        if (result.success) {
            removeFileFromUI(path);
            finalizeDeletionUpdates();
        } else {
            console.error(result.error);
            alert(`移動に失敗しました: ${result.error}`);
        }
    } catch (e) {
        console.error(e);
        alert('移動中にエラーが発生しました。');
    }
}

function updateLightboxView() {
    // Clear content
    lightboxContent.innerHTML = '';

    // Determine how many to show
    const count = isSplitView ? 2 : 1;
    const end = Math.min(currentLightboxIndex + count, lightboxImages.length);

    // Add images
    for (let i = currentLightboxIndex; i < end; i++) {
        const path = lightboxImages[i];
        const encodedPath = encodeURIComponent(path);

        // Wrap in item container
        const container = document.createElement('div');
        container.className = 'lightbox-item';

        // Image
        const img = document.createElement('img');
        img.src = `local-image://load?path=${encodedPath}`;
        img.className = 'lightbox-img';

        // Delete Button
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
        delBtn.title = 'ゴミ箱へ移動';

        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteImage(path);
        });

        // Move Button
        const moveBtn = document.createElement('button');
        moveBtn.className = 'move-btn';
        moveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;
        moveBtn.title = 'フォルダを移動';

        moveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moveImage(path);
        });

        container.appendChild(img);
        container.appendChild(delBtn);
        container.appendChild(moveBtn);
        lightboxContent.appendChild(container);
    }

    // Toggle split view class
    if (isSplitView) {
        lightboxContent.classList.add('split-view');
    } else {
        lightboxContent.classList.remove('split-view');
    }

    // Update Buttons
    if (lightboxImages.length <= 1) {
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
        nextBtn.classList.remove('hidden');

        prevBtn.disabled = currentLightboxIndex === 0;

        // Next button disabled logic
        // Split view (2 images): Stop when current index is at length - 2 (showing [len-2, len-1])
        // Single view (1 image): Stop when current index is at length - 1 (showing [len-1])
        const maxIndex = lightboxImages.length - (isSplitView ? 2 : 1);
        nextBtn.disabled = currentLightboxIndex >= maxIndex;
    }
}

function openLightbox(images, startIndex = 0, split = false) {
    lightboxImages = images;
    // Ensure start index is valid
    const maxIndex = images.length - (split ? 2 : 1);
    currentLightboxIndex = Math.min(startIndex, Math.max(0, maxIndex));

    isSplitView = split;

    updateLightboxView();
    lightbox.classList.remove('hidden');
}

// Navigation Actions
function navigateLightbox(direction) {
    const step = 1;
    const maxIndex = lightboxImages.length - (isSplitView ? 2 : 1);

    if (direction === 'next') {
        if (currentLightboxIndex < maxIndex) {
            currentLightboxIndex += step;
            updateLightboxView();
        }
    } else {
        if (currentLightboxIndex - step >= 0) {
            currentLightboxIndex -= step;
            updateLightboxView();
        }
    }
}

prevBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateLightbox('prev');
});

nextBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateLightbox('next');
});

// Key Navigation
document.addEventListener('keydown', (e) => {
    if (lightbox.classList.contains('hidden')) return;

    if (e.key === 'Escape') {
        lightbox.classList.add('hidden');
    } else if (e.key === 'ArrowRight') {
        navigateLightbox('next');
    } else if (e.key === 'ArrowLeft') {
        navigateLightbox('prev');
    }
});

// View Button Action
viewBtn.addEventListener('click', () => {
    const count = selectedImages.size;
    if (count > 0) {
        // Convert Set to Array
        const images = Array.from(selectedImages);
        // If multiple selected, open in split view (2 images per page)
        // If single selected, open in single view
        openLightbox(images, 0, count > 1);
    }
});

deleteSelectionBtn.addEventListener('click', async () => {
    const imagesToDelete = Array.from(selectedImages);
    if (imagesToDelete.length === 0) return;

    const confirmMsg = imagesToDelete.length === 1
        ? '本当にこのファイルを削除しますか？\n(ゴミ箱へ移動します)'
        : `本当に選択中の ${imagesToDelete.length} 件のファイルを削除しますか？\n(ゴミ箱へ移動します)`;

    if (!confirm(confirmMsg)) return;

    for (const path of imagesToDelete) {
        try {
            const result = await window.electronAPI.deleteFile(path);
            if (result.success) {
                removeFileFromUI(path);
            }
        } catch (e) {
            console.error(`Failed to delete ${path}:`, e);
        }
    }

    finalizeDeletionUpdates();
});

moveSelectionBtn.addEventListener('click', async () => {
    const imagesToMove = Array.from(selectedImages);
    if (imagesToMove.length === 0) return;

    const destDir = await window.electronAPI.selectMoveDestination();
    if (!destDir) return;

    for (const path of imagesToMove) {
        try {
            const result = await window.electronAPI.moveFile(path, destDir);
            if (result.success) {
                removeFileFromUI(path);
            } else {
                console.error(`Failed to move ${path}:`, result.error);
            }
        } catch (e) {
            console.error(`Error moving ${path}:`, e);
        }
    }

    finalizeDeletionUpdates();
});

selectFolderBtn.addEventListener('click', async () => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
        loadImages(folderPath);
    }
});

// Lightbox close
closeLightbox.addEventListener('click', () => {
    lightbox.classList.add('hidden');
});

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox || e.target === lightboxContent) {
        lightbox.classList.add('hidden');
    }
});

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    await loadMasterLabels();
    const lastFolder = await window.electronAPI.getLastFolder();
    if (lastFolder) {
        loadImages(lastFolder);
    }
});

// Label Management Modal Logic
openSettingsBtn.addEventListener('click', () => {
    renderMasterLabelList();
    labelModal.classList.remove('hidden');
});

closeModalBtn.addEventListener('click', async () => {
    const items = masterLabelList.querySelectorAll('.master-label-item');
    const newLabels = Array.from(items).map(item => {
        const name = item.querySelector('.master-label-name').value.trim();
        const group = item.querySelector('.master-label-group').value.trim() || '未分類';
        return { name, group };
    }).filter(l => l.name);

    await window.electronAPI.saveMasterLabels(newLabels);
    masterLabels = newLabels;

    if (geminiApiKeyInput) {
        await window.electronAPI.saveGeminiApiKey(geminiApiKeyInput.value.trim());
    }
    if (geminiModelInput) {
        await window.electronAPI.saveGeminiModel(geminiModelInput.value.trim() || 'gemini-1.5-flash');
    }
    if (aiAllowNewLabelsCheckbox) {
        await window.electronAPI.saveAiAllowNewLabels(aiAllowNewLabelsCheckbox.checked);
    }
    if (immediateFilterCheckbox) {
        await window.electronAPI.saveImmediateFilter(immediateFilterCheckbox.checked);
        updateFilterBtnVisibility(immediateFilterCheckbox.checked);
    }
    if (immediateLabelSaveCheckbox) {
        await window.electronAPI.saveImmediateLabelSave(immediateLabelSaveCheckbox.checked);
        updateSaveLabelsBtnVisibility(immediateLabelSaveCheckbox.checked);
    }

    renderDynamicLabels();

    labelModal.classList.add('hidden');
});

function updateFilterBtnVisibility(isImmediate) {
    if (filterBtn) {
        if (isImmediate) {
            filterBtn.style.display = 'none';
        } else {
            filterBtn.style.display = 'block'; // or 'flex' depending on CSS, but 'block' is safe usually or null
            filterBtn.style.display = ''; // revert to CSS default
        }
    }
}

// Event Delegation for Filter Checkboxes
filterContainer.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]') && immediateFilterCheckbox && immediateFilterCheckbox.checked) {
        applyFilters();
    }
});

function updateSaveLabelsBtnVisibility(isImmediate) {
    if (saveLabelsBtn) {
        if (isImmediate) {
            saveLabelsBtn.style.display = 'none';
        } else {
            saveLabelsBtn.style.display = 'block'; // Or flex, sticking to block for now unless flex is needed
            saveLabelsBtn.style.display = '';
        }
    }
}

// Event Delegation for Detail Checkboxes (Immediate Save)
detailLabelContainer.addEventListener('change', async (e) => {
    // Only if immediate save is enabled
    if (e.target.matches('input[type="checkbox"]') && immediateLabelSaveCheckbox && immediateLabelSaveCheckbox.checked) {
        // We need to wait a tiny bit for the indeterminate state logic or other UI updates if any?
        // Actually, the change event happens after the check state changes.
        // But our indeterminate logic happens in updateDetailsPane which is called on selection or render.
        // User clicking a checkbox manually changes it from indeterminate/checked/unchecked.

        // If a box was indeterminate, clicking it makes it checked (usually).
        // Since we are creating a custom tri-state logic in updateDetailsPane, standard click behavior applies here.
        // We just save the current state of *all* checkboxes to the selected images.
        await saveCurrentLabels();
    }
});

autoLabelBtn.addEventListener('click', async () => {
    const imagesToProcess = Array.from(selectedImages);
    if (imagesToProcess.length === 0) return;

    autoLabelBtn.disabled = true;
    const originalContent = autoLabelBtn.innerHTML;
    autoLabelBtn.innerHTML = '解析中...';

    try {
        const aiResultMap = new Map(); // path -> Set of suggested labels

        for (const path of imagesToProcess) {
            const result = await window.electronAPI.autoLabelImage(path, masterLabels);
            if (result.success) {
                const suggestionSet = new Set(result.labels);
                pendingAiSuggestions.set(path, suggestionSet);
                result.labels.forEach(label => aiSuggestedLabels.add(label));
            } else {
                alert(`AI解析エラー (${path.split(/[\\/]/).pop()}): ${result.error}`);
                break;
            }
        }

        renderDynamicLabels();
        // Note: renderDynamicLabels() calls updateDetailsPane(), which resets checkboxes to 'real' labels.

        // Apply AI suggestions visually to the checkboxes
        const checkboxes = getDetailCheckboxes();
        const totalCount = imagesToProcess.length;

        Object.keys(checkboxes).forEach(labelName => {
            const cb = checkboxes[labelName];

            // Calculate aggregate state for this label across AI suggestions + Existing labels
            let countWithLabel = 0;
            imagesToProcess.forEach(path => {
                const card = allImageCards.find(c => c.path === path);
                const hasReal = card && card.labels && card.labels.includes(labelName);
                const hasAi = pendingAiSuggestions.has(path) && pendingAiSuggestions.get(path).has(labelName);
                if (hasReal || hasAi) countWithLabel++;
            });

            if (countWithLabel === totalCount) {
                cb.checked = true;
                cb.indeterminate = false;
            } else if (countWithLabel > 0) {
                cb.checked = false;
                cb.indeterminate = true;
            } else {
                cb.checked = false;
                cb.indeterminate = false;
            }
        });

        autoLabelBtn.innerHTML = '完了!';
        setTimeout(() => {
            autoLabelBtn.disabled = false;
            autoLabelBtn.innerHTML = originalContent;
        }, 1500);

    } catch (e) {
        console.error(e);
        alert('解析中にエラーが発生しました');
        autoLabelBtn.disabled = false;
        autoLabelBtn.innerHTML = originalContent;
    }
});

addMasterLabelBtn.addEventListener('click', () => {
    const row = createMasterLabelRow({ name: '新しいラベル', group: '基本' }, true);
    masterLabelList.appendChild(row);
    const input = row.querySelector('.master-label-name');
    input.focus();
    input.select();
});

function createMasterLabelRow(labelObj, editable = false) {
    const div = document.createElement('div');
    div.className = 'master-label-item';
    if (!editable) div.classList.add('readonly');

    div.innerHTML = `
        <input type="text" class="master-label-name" value="${labelObj.name}" placeholder="ラベル名" ${editable ? '' : 'readonly'}>
        <input type="text" class="master-label-group" value="${labelObj.group}" placeholder="グループ">
        <span class="delete-label-btn" title="削除">&times;</span>
    `;

    div.querySelector('.delete-label-btn').addEventListener('click', () => {
        div.remove();
    });

    return div;
}

function renderMasterLabelList() {
    masterLabelList.innerHTML = '';
    masterLabels.forEach(labelObj => {
        masterLabelList.appendChild(createMasterLabelRow(labelObj, false));
    });
}

labelModal.addEventListener('click', (e) => {
    if (e.target === labelModal) {
        closeModalBtn.click();
    }
});
