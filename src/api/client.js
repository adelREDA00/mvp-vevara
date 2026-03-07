/**
 * Central API client for Vevara Motion.
 * Uses relative paths to work with Vite proxy in dev and Vercel/Render in prod.
 * Credentials 'include' ensures HttpOnly cookies are sent.
 */

function buildApiUrl(path) {
    // Vite proxy handles the /api prefix during development
    // In production, vercel.json or similar should map /api to the backend
    return path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
}

async function request(path, options = {}) {
    const url = buildApiUrl(path);
    const isFormData = options.body instanceof FormData;

    const finalOptions = {
        credentials: 'include',
        ...options,
        headers: {
            // Only set Content-Type for non-FormData requests.
            // For FormData, the browser MUST set it automatically to include the boundary.
            ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers,
        },
    };

    // Remove any explicitly-undefined headers (safety net)
    Object.keys(finalOptions.headers).forEach(key => {
        if (finalOptions.headers[key] === undefined) {
            delete finalOptions.headers[key];
        }
    });

    // Only JSON-stringify plain objects, never FormData
    if (finalOptions.body && typeof finalOptions.body === 'object' && !isFormData) {
        finalOptions.body = JSON.stringify(finalOptions.body);
    }

    const response = await fetch(url, finalOptions);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
}

export const api = {
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
    upload: (path, formData, options) => {
        // FormData uploads: Content-Type is automatically excluded by the request function
        // so the browser sets the correct multipart/form-data boundary
        return request(path, {
            ...options,
            method: 'POST',
            body: formData,
        });
    }
};

export default api;
