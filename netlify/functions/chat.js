// Netlify Function: Proxy to Hermes API Server
// Handles CORS and forwards requests to the user's Hermes gateway

exports.handler = async (event) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Hermes-Url, X-Hermes-Key',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: corsHeaders, body: '' };
    }

    // Get Hermes server URL from header or env var
    const hermesUrl = event.headers['x-hermes-url']
        || process.env.HERMES_API_URL
        || 'http://localhost:8642';

    const hermesKey = event.headers['x-hermes-key']
        || process.env.HERMES_API_KEY
        || '';

    // Build the target URL — strip the /api prefix
    let path = event.path.replace(/^\/api/, '') || '/';
    const targetUrl = `${hermesUrl}${path}${event.rawQuery ? '?' + event.rawQuery : ''}`;

    try {
        const fetchHeaders = {
            'Content-Type': event.headers['content-type'] || 'application/json',
        };

        if (hermesKey) {
            fetchHeaders['Authorization'] = `Bearer ${hermesKey}`;
        }

        const fetchOptions = {
            method: event.httpMethod,
            headers: fetchHeaders,
        };

        if (event.body && ['POST', 'PUT', 'PATCH'].includes(event.httpMethod)) {
            fetchOptions.body = event.isBase64Encoded
                ? Buffer.from(event.body, 'base64')
                : event.body;
        }

        const resp = await fetch(targetUrl, fetchOptions);
        const contentType = resp.headers.get('content-type') || '';

        // Check if response is streaming (SSE)
        if (contentType.includes('text/event-stream')) {
            const reader = resp.body.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }

            const body = Buffer.concat(chunks).toString('utf-8');

            return {
                statusCode: resp.status,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                },
                body,
            };
        }

        // Regular JSON/text response
        const body = await resp.text();

        return {
            statusCode: resp.status,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType || 'application/json',
            },
            body,
        };

    } catch (err) {
        console.error('Proxy error:', err.message);

        return {
            statusCode: 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: {
                    message: `Cannot reach Hermes API server at ${hermesUrl}. Is the gateway running?`,
                    type: 'proxy_error',
                    details: err.message,
                },
            }),
        };
    }
};
