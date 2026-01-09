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

let selectedImage = null;

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function selectImage(card, imagePath, encodedPath) {
    // UI selection update
    document.querySelectorAll('.image-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    selectedImage = { path: encodedPath };

    // Show details pane
    noSelection.classList.add('hidden');
    detailsContent.classList.remove('hidden');

    // Update basic info
    const fileName = imagePath.split(/[\\/]/).pop();
    detailFilename.textContent = fileName;

    // Update preview
    detailPreview.src = `local-image://load?path=${encodedPath}`;

    // Get file details from main process
    try {
        const details = await window.electronAPI.getFileDetails(imagePath);
        if (details) {
            detailFilesize.textContent = formatBytes(details.size);
        }
    } catch (e) {
        console.error(e);
        detailFilesize.textContent = 'Unknown';
    }

    // Get resolution from the loaded image in the grid or preview
    // We add a oneshot listener to the preview image
    if (detailPreview.complete) {
        detailResolution.textContent = `${detailPreview.naturalWidth} x ${detailPreview.naturalHeight}`;
    } else {
        detailPreview.onload = () => {
            detailResolution.textContent = `${detailPreview.naturalWidth} x ${detailPreview.naturalHeight}`;
        };
    }
}

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

    // Reset selection
    selectedImage = null;
    noSelection.classList.remove('hidden');
    detailsContent.classList.add('hidden');

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
            images.forEach(imagePath => {
                const fileName = imagePath.split(/[\\/]/).pop();
                const card = document.createElement('div');
                card.className = 'image-card';
                card.setAttribute('data-name', fileName);

                const img = document.createElement('img');
                // ローカルパスをクエリパラメータとして渡す（最も確実な形式）
                const encodedPath = encodeURIComponent(imagePath);
                img.src = `local-image://load?path=${encodedPath}`;
                img.loading = 'lazy';

                card.appendChild(img);

                // Click to select
                card.addEventListener('click', () => {
                    selectImage(card, imagePath, encodedPath);
                });

                // Double click to view (optional, but requested behavior is via button)
                card.addEventListener('dblclick', () => {
                    lightboxImg.src = `local-image://load?path=${encodedPath}`;
                    lightbox.classList.remove('hidden');
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

// View Button Action
viewBtn.addEventListener('click', () => {
    if (selectedImage) {
        lightboxImg.src = `local-image://load?path=${selectedImage.path}`;
        lightbox.classList.remove('hidden');
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
    if (e.target === lightbox) {
        lightbox.classList.add('hidden');
    }
});

// ESC key to close lightbox
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
