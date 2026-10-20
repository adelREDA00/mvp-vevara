
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (
            url.pathname.startsWith("/api/") ||
            url.pathname.startsWith("/uploads/")
        ) {
            const backendUrl = new URL(
                url.pathname + url.search,
                "https://vexly-node.onrender.com"
            );

            // Forward the original request to backend, preserving client headers and setting reverse-proxy headers
            const headers = new Headers(request.headers);
            headers.set("X-Forwarded-Host", url.host);
            headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
            headers.set("Host", "vexly-node.onrender.com");

            return fetch(
                new Request(backendUrl, {
                    method: request.method,
                    headers: headers,
                    body: request.body,
                    redirect: "manual",
                })
            );
        }

        return env.ASSETS.fetch(request);
    },
};