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

    // Special case for uploads where we want progress tracking via XHR
    if (options.useXhr) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(options.method || 'GET', url);
            xhr.withCredentials = true;

            if (options.onProgress && xhr.upload) {
                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 100);
                        options.onProgress(percent);
                    }
                };
            }

            xhr.onload = () => {
                let data = {};
                try {
                    data = JSON.parse(xhr.responseText);
                } catch (e) {
                    data = {};
                }

                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || `Request failed with status ${xhr.status}`));
                }
            };

            xhr.onerror = () => reject(new Error('Network error'));

            // Only set Content-Type for non-FormData requests.
            // For FormData, the browser MUST set it automatically to include the boundary.
            if (!isFormData) {
                xhr.setRequestHeader('Content-Type', 'application/json');
            }

            // Apply custom headers
            if (options.headers) {
                Object.entries(options.headers).forEach(([key, value]) => {
                    if (value !== undefined) xhr.setRequestHeader(key, value);
                });
            }

            const body = (isFormData || typeof options.body !== 'object')
                ? options.body
                : JSON.stringify(options.body);

            xhr.send(body);
        });
    }

    const finalOptions = {
        credentials: 'include',
        ...options,
        headers: {
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
        return request(path, {
            ...options,
            method: 'POST',
            body: formData,
            useXhr: true,
        });
    }
};

export default api;
