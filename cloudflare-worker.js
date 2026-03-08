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
      const auth = await requireFirebaseUser(request, env);
      if (!auth.ok) return json({ error: auth.error }, auth.status, origin);
      const body = await request.json();
      if (!body || !body.key || !body.contentType) {
        return json({ error: 'Missing key or contentType' }, 400, origin);
      }

      const mediaUrl = env.R2_PUBLIC_HOST
        ? `https://${env.R2_PUBLIC_HOST}/${body.key}`
        : `${url.origin}/media/${body.key}`;

      return json({
        ok: true,
        uid: auth.uid,
        key: body.key,
        uploadUrl: `${url.origin}/upload/${body.key}`,
        mediaUrl: mediaUrl
      }, 200, origin);
    }

    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const auth = await requireFirebaseUser(request, env);
      if (!auth.ok) return json({ error: auth.error }, auth.status, origin);
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

    if (request.method === 'DELETE' && url.pathname.startsWith('/media/')) {
      const auth = await requireFirebaseUser(request, env);
      if (!auth.ok) return json({ error: auth.error }, auth.status, origin);

      const key = decodeURIComponent(url.pathname.replace('/media/', ''));
      if (!key) return json({ error: 'Missing media key' }, 400, origin);

      await env.LUMINARY_BUCKET.delete(key);
      return json({ ok: true, key: key }, 200, origin);
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

async function requireFirebaseUser(request, env) {
  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: 'Missing Firebase ID token' };
  if (!env.FIREBASE_PROJECT_ID) return { ok: false, status: 500, error: 'FIREBASE_PROJECT_ID is not configured' };

  try {
    const payload = await verifyFirebaseToken(match[1], env.FIREBASE_PROJECT_ID);
    return { ok: true, uid: payload.user_id || payload.sub, payload: payload };
  } catch (err) {
    return { ok: false, status: 401, error: err.message || 'Invalid Firebase ID token' };
  }
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const header = JSON.parse(decodeBase64Url(parts[0]));
  const payload = JSON.parse(decodeBase64Url(parts[1]));
  const signature = base64UrlToUint8Array(parts[2]);

  if (header.alg !== 'RS256') throw new Error('Unsupported token algorithm');
  if (!header.kid) throw new Error('Token missing key id');

  const now = Math.floor(Date.now() / 1000);
  const issuer = 'https://securetoken.google.com/' + projectId;
  if (payload.aud !== projectId) throw new Error('Token audience mismatch');
  if (payload.iss !== issuer) throw new Error('Token issuer mismatch');
  if (!payload.sub) throw new Error('Token subject missing');
  if (payload.exp && payload.exp < now) throw new Error('Token expired');
  if (payload.iat && payload.iat > now + 300) throw new Error('Token issued in the future');

  const certs = await getFirebaseCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('Unknown token signing key');

  const key = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  if (!valid) throw new Error('Token signature invalid');

  return payload;
}

let firebaseCertCache = { expiresAt: 0, certs: null };

async function getFirebaseCerts() {
  const now = Date.now();
  if (firebaseCertCache.certs && firebaseCertCache.expiresAt > now) return firebaseCertCache.certs;

  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('Unable to fetch Firebase certs');
  const certs = await res.json();

  const cacheControl = res.headers.get('cache-control') || '';
  const match = cacheControl.match(/max-age=(\d+)/);
  const maxAgeMs = match ? parseInt(match[1], 10) * 1000 : 3600000;
  firebaseCertCache = {
    certs: certs,
    expiresAt: now + maxAgeMs
  };
  return certs;
}

function decodeBase64Url(value) {
  return atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
}

function base64UrlToUint8Array(value) {
  const decoded = decodeBase64Url(value);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
