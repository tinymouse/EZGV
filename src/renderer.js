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

const autoLabelBtn = document.getElementById('auto-label-btn');

const filterContainer = document.getElementById('filter-checkboxes');
const detailLabelContainer = document.getElementById('label-container');

async function loadMasterLabels() {
    masterLabels = await window.electronAPI.getMasterLabels();
    const apiKey = await window.electronAPI.getGeminiApiKey();
    if (geminiApiKeyInput) geminiApiKeyInput.value = apiKey;

    const model = await window.electronAPI.getGeminiModel();
    if (geminiModelInput) geminiModelInput.value = model || 'gemini-1.5-flash';

    const allowNew = await window.electronAPI.getAiAllowNewLabels();
    if (aiAllowNewLabelsCheckbox) aiAllowNewLabelsCheckbox.checked = allowNew !== false;

    renderDynamicLabels();
}

function renderDynamicLabels() {
    // Collect all labels currently present in the loaded images data
    const adhocLabels = new Set();
    allImagesData.forEach(img => {
        if (img.labels) {
            img.labels.forEach(l => adhocLabels.add(l));
        }
    });

    // Also include labels currently suggested by AI
    aiSuggestedLabels.forEach(l => adhocLabels.add(l));

    // Grouping structure: { groupName: [labelName, ...] }
    const groups = {};

    // First, initialize with master labels
    masterLabels.forEach(l => {
        if (!groups[l.group]) groups[l.group] = [];
        groups[l.group].push(l.name);
    });

    // Then, add adhoc labels that aren't in master labels
    const masterNames = new Set(masterLabels.map(l => l.name));
    Array.from(adhocLabels).sort().forEach(label => {
        if (!masterNames.has(label)) {
            if (!groups['未分類']) groups['未分類'] = [];
            groups['未分類'].push(label);
        }
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
}

// ... helper ...

saveLabelsBtn.addEventListener('click', async () => {
    const count = selectedImages.size;
    if (count === 0) return;

    saveLabelsBtn.disabled = true;
    saveLabelsBtn.textContent = '保存中...';

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
                if (action === 'add') newLabels.add(label);
                else if (action === 'remove') newLabels.delete(label);
            });

            const finalLabels = Array.from(newLabels);
            promises.push(window.electronAPI.saveFileLabels(path, finalLabels).then(res => {
                if (res.success) {
                    cardRef.labels = finalLabels;
                    // Also update allImagesData
                    const dataItem = allImagesData.find(d => d.path === path);
                    if (dataItem) dataItem.labels = finalLabels;
                }
                return res;
            }));
        });

        await Promise.all(promises);

        aiSuggestedLabels.clear(); // Clear AI suggestions once saved

        // Visual feedback
        const originalText = saveLabelsBtn.textContent;
        saveLabelsBtn.textContent = '保存完了!';
        setTimeout(() => {
            saveLabelsBtn.disabled = false;
            saveLabelsBtn.textContent = '登録 (Save)';
        }, 1000);

        renderDynamicLabels(); // Refresh label list (adds new ad-hoc labels)
        updateDetailsPane();
        applyFilters(true); // Re-apply filter and keep selection unchanged if images still match
    } catch (e) {
        console.error(e);
        alert('エラーが発生しました');
        saveLabelsBtn.disabled = false;
        saveLabelsBtn.textContent = '登録 (Save)';
    }
});

filterBtn.addEventListener('click', () => {
    applyFilters();
});

function applyFilters(keepSelection = false) {
    const currentFilterCheckboxes = getFilterCheckboxes();
    const activeFilters = Object.entries(currentFilterCheckboxes)
        .filter(([label, box]) => box.checked)
        .map(([label, box]) => label);

    if (activeFilters.length === 0) {
        renderGrid(allImagesData, keepSelection);
    } else {
        const filtered = allImagesData.filter(img =>
            activeFilters.every(f => img.labels && img.labels.includes(f))
        );
        renderGrid(filtered, keepSelection);
    }
}


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
            if (selectedImages.has(imagePath)) {
                card.classList.add('selected');
                // Update lastSelectedCardIndex if it's the only one selected or logically needs restoration
            }
            card.setAttribute('data-name', fileName);

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

            imageGrid.appendChild(card);
        });
    }

    // Refresh the details pane to reflect the new grid state (and restore selection check states)
    updateDetailsPane();
}

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

    try {
        const imagesData = await window.electronAPI.getImages(folderPath); // Returns objects now
        allImagesData = imagesData; // Save to state
        renderDynamicLabels();
        renderGrid(allImagesData);
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

    renderDynamicLabels();

    labelModal.classList.add('hidden');
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
                aiResultMap.set(path, new Set(result.labels));
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
                const hasAi = aiResultMap.has(path) && aiResultMap.get(path).has(labelName);
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
