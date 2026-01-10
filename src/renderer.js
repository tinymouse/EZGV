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

// State
let allImageCards = []; // Store references for Shift+Click
let selectedImages = new Set(); // Store paths
let lastSelectedCardIndex = -1; // For Shift+Click range

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
        viewBtn.disabled = false; // 複数選択でもComparison Viewとして有効化
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

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

    // Reset state
    selectedImages.clear();
    allImageCards = [];
    lastSelectedCardIndex = -1;
    updateDetailsPane();

    try {
        const images = await window.electronAPI.getImages(folderPath);

        if (images.length === 0) {
            imageGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🏜️</div>
                    <h2>画像が見つかりませんでした</h2>
                    <p>このフォルダー内には対応する形式の画像がありません</p>
                </div>`;
        } else {
            imageGrid.innerHTML = '';
            images.forEach((imagePath, index) => {
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
                allImageCards.push({ element: card, path: imagePath });

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
        const img = document.createElement('img');
        img.src = `local-image://load?path=${encodedPath}`;
        img.className = 'lightbox-img';
        lightboxContent.appendChild(img);
    }

    // Toggle split view class
    if (isSplitView) {
        lightboxContent.classList.add('split-view');
    } else {
        lightboxContent.classList.remove('split-view');
    }

    // Update Buttons
    if (lightboxImages.length <= count) {
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    } else {
        prevBtn.classList.remove('hidden');
        nextBtn.classList.remove('hidden');

        prevBtn.disabled = currentLightboxIndex === 0;
        nextBtn.disabled = currentLightboxIndex + count >= lightboxImages.length;
    }
}

function openLightbox(images, startIndex = 0, split = false) {
    lightboxImages = images;
    currentLightboxIndex = startIndex;
    isSplitView = split;

    updateLightboxView();
    lightbox.classList.remove('hidden');
}

// Navigation Actions
function navigateLightbox(direction) {
    const step = isSplitView ? 2 : 1;
    if (direction === 'next') {
        if (currentLightboxIndex + step < lightboxImages.length) {
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
