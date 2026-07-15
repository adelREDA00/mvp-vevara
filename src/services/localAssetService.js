/**
 * Local Asset Service
 * Stores guest-uploaded files in IndexedDB for offline/guest mode usage.
 */

const DB_NAME = 'VevaraLocalAssets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Store a file in IndexedDB and return a local blob URL.
 */
export async function storeAsset(file) {
    const id = `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const arrayBuffer = await file.arrayBuffer();

    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const putRequest = store.put({
            id,
            name: file.name,
            type: file.type,
            size: file.size,
            data: arrayBuffer,
            createdAt: Date.now(),
        }, id);
        putRequest.onsuccess = () => resolve({
            id,
            name: file.name,
            type: file.type,
            size: file.size,
        });
        putRequest.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Get an asset's data and create a blob URL.
 */
export async function getAssetUrl(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const record = getRequest.result;
            if (!record) return resolve(null);
            const blob = new Blob([record.data], { type: record.type });
            const url = URL.createObjectURL(blob);
            resolve(url);
        };
        getRequest.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Get asset metadata without fetching the data.
 */
export async function getAssetMetadata(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const record = getRequest.result;
            if (!record) return resolve(null);
            resolve({
                id: record.id,
                name: record.name,
                type: record.type,
                size: record.size,
                createdAt: record.createdAt,
            });
        };
        getRequest.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Delete an asset from IndexedDB.
 */
export async function deleteAsset(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const deleteRequest = store.delete(id);
        deleteRequest.onsuccess = () => resolve(true);
        deleteRequest.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Delete all guest assets from IndexedDB and clear metadata from localStorage.
 * Called after a successful migration to clean up local storage.
 */
export async function clearAllAssets() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const clearRequest = store.clear();
            clearRequest.onsuccess = () => {
                try { localStorage.removeItem('vevara_guest_assets'); } catch {}
                try { localStorage.removeItem('vevara_local_uploaded_assets'); } catch {}
                resolve(true);
            };
            clearRequest.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('[localAssetService] Failed to clear all assets:', e);
        return false;
    }
}

/**
 * Clean up expired export snapshots (older than 1 hour) from IndexedDB and localStorage.
 */
export async function cleanupLocalExports() {
    try {
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        // 1. Clean up localStorage export keys
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('export_')) {
                const parts = key.split('_');
                if (parts.length > 1) {
                    const timestamp = parseInt(parts[1], 10);
                    if (!isNaN(timestamp) && now - timestamp > oneHour) {
                        localStorage.removeItem(key);
                        i--; // Adjust index because key was removed
                    }
                }
            }
        }

        // 2. Clean up IndexedDB snapshots
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('VevaraExportDB', 1);
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const database = e.target.result;
                if (!database.objectStoreNames.contains('exports')) {
                    database.createObjectStore('exports');
                }
            };
        });

        const tx = db.transaction('exports', 'readwrite');
        const store = tx.objectStore('exports');
        const keysReq = store.getAllKeys();

        keysReq.onsuccess = () => {
            const keys = keysReq.result || [];
            keys.forEach(key => {
                if (typeof key === 'string' && key.startsWith('export_')) {
                    const parts = key.split('_');
                    if (parts.length > 1) {
                        const timestamp = parseInt(parts[1], 10);
                        if (!isNaN(timestamp) && now - timestamp > oneHour) {
                            store.delete(key);
                        }
                    }
                }
            });
        };
    } catch (e) {
        console.warn('[localAssetService] Failed to clean up expired exports:', e);
    }
}

/**
 * Clean up orphaned guest assets that are not referenced in any project or in the uploads library metadata.
 */
export async function cleanupOrphanedAssets() {
    try {
        // 1. Get all assets currently in the guest uploads library metadata
        const guestAssetsRaw = localStorage.getItem('vevara_guest_assets') || '[]';
        const guestAssets = JSON.parse(guestAssetsRaw);
        const activeAssetIds = new Set(guestAssets.map(a => a.id || a._id));

        // 2. Get all assets referenced in any local project
        const localProjectsRaw = localStorage.getItem('vevara_local_projects') || '[]';
        const localProjectsMeta = JSON.parse(localProjectsRaw);

        for (const meta of localProjectsMeta) {
            const fullProjectRaw = localStorage.getItem(`vevara_local_project_${meta._id}`);
            if (fullProjectRaw) {
                const fullProject = JSON.parse(fullProjectRaw);
                // Find all asset IDs in layers
                if (fullProject.layers) {
                    Object.values(fullProject.layers).forEach(layer => {
                        if (layer && layer.data) {
                            if (layer.data.assetId) activeAssetIds.add(layer.data.assetId);
                            if (layer.data._localAssetId) activeAssetIds.add(layer.data._localAssetId);
                        }
                    });
                }
                // Find all asset IDs in audio tracks
                if (fullProject.audioTracks) {
                    fullProject.audioTracks.forEach(track => {
                        if (track.assetId) activeAssetIds.add(track.assetId);
                        if (track._localAssetId) activeAssetIds.add(track._localAssetId);
                    });
                }
            }
        }

        // 3. Open IndexedDB and delete any assets not in activeAssetIds
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const keysReq = store.getAllKeys();

        keysReq.onsuccess = () => {
            const keys = keysReq.result || [];
            keys.forEach(key => {
                if (!activeAssetIds.has(key)) {
                    console.log('[Cleanup] Deleting orphaned local asset:', key);
                    store.delete(key);
                }
            });
        };
    } catch (e) {
        console.error('[localAssetService] Failed to clean up orphaned assets:', e);
    }
}

/**
 * Get all local assets from IndexedDB (both metadata and data).
 */
export async function getAllLocalAssetRecords() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    } catch (e) {
        console.error('[localAssetService] Failed to get all local asset records:', e);
        return [];
    }
}