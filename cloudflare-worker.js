export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (request.method === 'POST' && url.pathname === '/health') {
      return json({ ok: true }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/upload-url') {
      const body = await request.json();
      if (!body || !body.key || !body.contentType) {
        return json({ error: 'Missing key or contentType' }, 400, origin);
      }

      const mediaUrl = env.R2_PUBLIC_HOST
        ? `https://${env.R2_PUBLIC_HOST}/${body.key}`
        : `${url.origin}/media/${body.key}`;

      return json({
        ok: true,
        key: body.key,
        uploadUrl: `${url.origin}/upload/${body.key}`,
        mediaUrl: mediaUrl
      }, 200, origin);
    }

    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const key = decodeURIComponent(url.pathname.replace('/upload/', ''));
      if (!key) return json({ error: 'Missing upload key' }, 400, origin);

      await env.LUMINARY_BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get('content-type') || 'application/octet-stream'
        }
      });

      const mediaUrl = env.R2_PUBLIC_HOST
        ? `https://${env.R2_PUBLIC_HOST}/${key}`
        : `${url.origin}/media/${key}`;

      return json({ ok: true, key: key, mediaUrl: mediaUrl }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
      const key = decodeURIComponent(url.pathname.replace('/media/', ''));
      if (!key) return json({ error: 'Missing media key' }, 400, origin);

      const object = await env.LUMINARY_BUCKET.get(key);
      if (!object) return json({ error: 'Not found' }, 404, origin);

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      applyCors(headers, origin);

      return new Response(object.body, {
        headers: headers
      });
    }

    return json({ error: 'Not found' }, 404, origin);
  }
};

function json(data, status = 200, origin = '*') {
  const headers = new Headers(corsHeaders(origin));
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), {
    status,
    headers: headers
  });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

function applyCors(headers, origin) {
  var extra = corsHeaders(origin);
  Object.keys(extra).forEach(function (key) {
    headers.set(key, extra[key]);
  });
}
