/**
 * Local Project Storage Service
 * Manages guest projects in IndexedDB with localStorage fallback.
 * Keys: 'vevara_local_projects' for project list, 'vevara_local_project_{id}' for individual projects.
 */

const PROJECTS_KEY = 'vevara_local_projects';
const TEMPLATES_KEY = 'vevara_local_templates';

// Generate a unique local ID
function generateLocalId() {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get all local projects (metadata only).
 */
export function getProjects() {
    try {
        const raw = localStorage.getItem(PROJECTS_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.error('[localProjectService] Failed to read projects:', e);
        return [];
    }
}

/**
 * Get a single project with full data.
 */
export function getProject(id) {
    try {
        const raw = localStorage.getItem(`vevara_local_project_${id}`);
        if (!raw) {
            // Fallback: try the projects list metadata + stored data
            const projects = getProjects();
            const meta = projects.find(p => p._id === id);
            if (!meta) return null;
            return meta;
        }
        return JSON.parse(raw);
    } catch (e) {
        console.error('[localProjectService] Failed to read project:', id, e);
        return null;
    }
}

/**
 * Save a project (create or update).
 * @param {Object} projectData - Full project data with scenes, layers, sceneMotionFlows, etc.
 * @returns {Object} The saved project metadata.
 */
export function saveProject(projectData) {
    try {
        const projects = getProjects();
        const existingIndex = projects.findIndex(p => p._id === projectData._id);

        const meta = {
            _id: projectData._id || generateLocalId(),
            name: projectData.name || 'Untitled Project',
            updatedAt: new Date().toISOString(),
            createdAt: projectData.createdAt || new Date().toISOString(),
            thumbnail: projectData.thumbnail || null,
            aspectRatio: projectData.aspectRatio || '16:9',
        };

        // Store full project data separately for large payloads (IndexedDB would be better but localStorage is simpler)
        const fullProject = {
            ...meta,
            scenes: projectData.scenes || [],
            layers: projectData.layers || {},
            sceneMotionFlows: projectData.sceneMotionFlows || {},
            audioTracks: projectData.audioTracks || [],
        };

        try {
            localStorage.setItem(`vevara_local_project_${meta._id}`, JSON.stringify(fullProject));
        } catch (storageErr) {
            console.warn('[localProjectService] Full project too large for localStorage, storing metadata only:', storageErr);
            // If full data is too large, store metadata only — the full data will need a fallback
        }

        if (existingIndex >= 0) {
            projects[existingIndex] = meta;
        } else {
            projects.unshift(meta);
        }

        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        return meta;
    } catch (e) {
        console.error('[localProjectService] Failed to save project:', e);
        return null;
    }
}

/**
 * Delete a local project.
 */
export function deleteProject(id) {
    try {
        const projects = getProjects();
        const filtered = projects.filter(p => p._id !== id);
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(filtered));
        localStorage.removeItem(`vevara_local_project_${id}`);
        return true;
    } catch (e) {
        console.error('[localProjectService] Failed to delete project:', id, e);
        return false;
    }
}

/**
 * Duplicate a project (for template customization).
 */
export function duplicateProject(source) {
    try {
        // Deep clone the full project so nested data (scenes, layers, motion flows, audio tracks)
        // are fully independent from the original. Without this, both projects would share
        // references to the same nested objects, causing corruption when either is modified.
        const newId = generateLocalId();
        const deepCopy = JSON.parse(JSON.stringify(source));
        const duplicated = {
            ...deepCopy,
            _id: newId,
            name: `${source.name || 'Untitled'} (Copy)`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        saveProject(duplicated);
        return duplicated;
    } catch (e) {
        console.error('[localProjectService] Failed to duplicate project:', e);
        return null;
    }
}

/**
 * Create a blank project locally.
 */
export function createBlankProject() {
    const now = Date.now();
    const sceneId = `local-scene-${now}`;
    const bgLayerId = `local-bg-${now}`;

    const project = {
        _id: generateLocalId(),
        name: 'Untitled Project',
        aspectRatio: '16:9',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        scenes: [{
            id: sceneId,
            name: 'Scene 1',
            duration: 10.0,
            transition: 'None',
            backgroundColor: 0xffffff,
            layers: [bgLayerId]
        }],
        layers: {
            [bgLayerId]: {
                id: bgLayerId,
                sceneId: sceneId,
                type: 'background',
                name: 'Background',
                visible: true,
                locked: false,
                opacity: 1.0,
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                anchorX: 0,
                anchorY: 0,
                data: { color: 0xffffff },
                createdAt: now,
                updatedAt: now
            }
        },
        sceneMotionFlows: {}
    };

    saveProject(project);
    return project;
}

/**
 * Save a project snapshot from the editor (used for guest auto-save).
 */
export function saveProjectFromEditor(projectState) {
    const project = {
        _id: projectState.projectId || generateLocalId(),
        name: projectState.projectName || 'Untitled Project',
        aspectRatio: projectState.aspectRatio || '16:9',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        scenes: projectState.scenes || [],
        layers: projectState.layers || {},
        sceneMotionFlows: projectState.sceneMotionFlows || {},
        audioTracks: projectState.audioTracks || [],
        thumbnail: projectState.thumbnail || null,
    };
    return saveProject(project);
}

/**
 * Get all local projects with full data (for migration).
 */
export function getAllFullProjects() {
    try {
        const projects = getProjects();
        return projects.map(meta => {
            const full = getProject(meta._id);
            return full || meta;
        }).filter(Boolean);
    } catch (e) {
        console.error('[localProjectService] Failed to get all full projects:', e);
        return [];
    }
}

/**
 * Clear all local projects (after successful migration).
 */
export function clearAllProjects() {
    try {
        const projects = getProjects();
        projects.forEach(p => localStorage.removeItem(`vevara_local_project_${p._id}`));
        localStorage.removeItem(PROJECTS_KEY);
        return true;
    } catch (e) {
        console.error('[localProjectService] Failed to clear projects:', e);
        return false;
    }
}

/**
 * Check if any local projects exist.
 */
export function hasLocalProjects() {
    const projects = getProjects();
    return projects.length > 0;
}

// =============================================================================
// LOCAL TEMPLATES — Hardcoded template data for guest users who can't fetch
// from the API. Mirrors the original HERO_TEMPLATE_MAPPINGS + template data.
// =============================================================================

import { TEMPLATE_PROJECTS } from '../config/templates';

/**
 * Get local templates for guest users.
 */
export function getLocalTemplates() {
    return TEMPLATE_PROJECTS;
}

/**
 * Create a blank project from a local template.
 * For guests, this creates a new blank project with the template's name and metadata.
 * Real template duplication (from auth users) uses the API.
 */
export function createFromLocalTemplate(templateId) {
    const template = TEMPLATE_PROJECTS.find(t => t._id === templateId);
    if (!template) return null;

    const project = createBlankProject();
    project.name = template.name;
    project.category = template.category;
    saveProject(project);
    return project;
}