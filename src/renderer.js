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

const saveLabelsBtn = document.getElementById('save-labels-btn');
const filterBtn = document.getElementById('filter-btn');

const labelCheckboxes = {
    '人物': document.getElementById('label-person'),
    '風景': document.getElementById('label-landscape'),
    '一人': document.getElementById('label-single'),
    '複数': document.getElementById('label-multiple')
};

const filterCheckboxes = {
    '人物': document.getElementById('filter-person'),
    '風景': document.getElementById('filter-landscape'),
    '一人': document.getElementById('filter-single'),
    '複数': document.getElementById('filter-multiple')
};

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
    Object.keys(labelCheckboxes).forEach(key => {
        const checkbox = labelCheckboxes[key];
        checkbox.checked = false;
        checkbox.indeterminate = false;
    });

    if (count > 0) {
        Object.keys(labelCheckboxes).forEach(labelName => {
            const checkbox = labelCheckboxes[labelName];
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
        Object.entries(labelCheckboxes).forEach(([label, box]) => {
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

        // Visual feedback
        const originalText = saveLabelsBtn.textContent;
        saveLabelsBtn.textContent = '保存完了!';
        setTimeout(() => {
            saveLabelsBtn.disabled = false;
            saveLabelsBtn.textContent = '登録 (Save)';
        }, 1000);

        updateDetailsPane();
        applyFilters(); // Re-apply filter in case labels changed
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

function applyFilters() {
    const activeFilters = Object.entries(filterCheckboxes)
        .filter(([label, box]) => box.checked)
        .map(([label, box]) => label);

    if (activeFilters.length === 0) {
        renderGrid(allImagesData);
    } else {
        const filtered = allImagesData.filter(img =>
            activeFilters.every(f => img.labels && img.labels.includes(f))
        );
        renderGrid(filtered);
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

function renderGrid(data) {
    // Reset selection state when re-rendering filtered list?
    // Usually better to keep it if possible, but simpler to clear if indices change.
    selectedImages.clear();
    allImageCards = [];
    lastSelectedCardIndex = -1;
    imageGrid.innerHTML = '';
    updateDetailsPane();

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
}

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

    try {
        const imagesData = await window.electronAPI.getImages(folderPath); // Returns objects now
        allImagesData = imagesData; // Save to state
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
    const lastFolder = await window.electronAPI.getLastFolder();
    if (lastFolder) {
        loadImages(lastFolder);
    }
});
