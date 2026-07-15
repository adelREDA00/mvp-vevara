/**
 * Project Migration Service
 * Migrates guest local projects to the server when user creates/link an account.
 */
import api from '../api/client';
import * as localProjectService from './localProjectService';

/**
 * Migrate all local projects to the authenticated user's account.
 * Uses the batch migration endpoint or individual project creation.
 */
export async function migrateLocalProjects() {
    // Migrate onboarding completion status if true in local storage
    const localOnboardingCompleted = localStorage.getItem('vevara_onboarding_completed') === 'true'
    if (localOnboardingCompleted) {
        try {
            await api.put('/auth/onboarding', { hasCompletedOnboarding: true });
            const userString = localStorage.getItem('vevara_user')
            if (userString) {
                const user = JSON.parse(userString)
                user.hasCompletedOnboarding = true
                localStorage.setItem('vevara_user', JSON.stringify(user))
            }
        } catch (error) {
            console.error('[migrationService] Failed to migrate onboarding status:', error);
        }
    }

    const localProjects = localProjectService.getAllFullProjects();
    if (localProjects.length === 0) return { migrated: 0, skipped: 0, errors: [] };

    const results = { migrated: 0, skipped: 0, errors: [] };

    for (const project of localProjects) {
        try {
            // Create project via API
            const payload = {
                name: project.name || 'Untitled Project',
                data: {
                    scenes: project.scenes || [],
                    layers: project.layers || {},
                    sceneMotionFlows: project.sceneMotionFlows || {},
                    audioTracks: project.audioTracks || [],
                    aspectRatio: project.aspectRatio || '16:9',
                },
                thumbnail: project.thumbnail || null,
            };

            await api.post('/projects', payload);
            results.migrated++;
        } catch (error) {
            console.error(`[migrationService] Failed to migrate project "${project.name}":`, error);
            results.errors.push({ project: project.name, error: error.message });
        }
    }

    // Clear local projects after successful migration
    if (results.migrated > 0) {
        localProjectService.clearAllProjects();
    }

    return results;
}

/**
 * Check if there are local projects that need migration.
 */
export function hasProjectsToMigrate() {
    return localProjectService.hasLocalProjects();
}

/**
 * Get count of local projects pending migration.
 */
export function getMigrationProjectCount() {
    return localProjectService.getProjects().length;
}