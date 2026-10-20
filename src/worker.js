
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

            return fetch(
                new Request(backendUrl, request)
            );
        }

        return env.ASSETS.fetch(request);
    },
};