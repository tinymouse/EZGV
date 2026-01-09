const selectFolderBtn = document.getElementById('select-folder-btn');
const folderPathDisplay = document.getElementById('folder-path');
const imageGrid = document.getElementById('image-grid');
const loadingOverlay = document.getElementById('loading');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const closeLightbox = document.querySelector('.close-lightbox');

async function loadImages(folderPath) {
    if (!folderPath) return;

    loadingOverlay.classList.remove('hidden');
    folderPathDisplay.textContent = folderPath;

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
                card.addEventListener('click', () => {
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
