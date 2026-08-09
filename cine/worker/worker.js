/* Cine IRIS — API del catálogo y de subidas al bucket R2 "cine".
   ---------------------------------------------------------------------------
   Público:
     GET /catalogo                 -> biblioteca.json guardado en el bucket
   Con token (Authorization: Bearer <CINE_TOKEN>, secret de wrangler):
     GET  /api/check               -> comprueba el token
     PUT  /api/catalogo            -> reemplaza biblioteca.json (valida JSON)
     PUT  /api/objeto?key=...      -> sube un objeto pequeño (póster, subs)
     DELETE /api/objeto?key=...    -> borra un objeto
     POST /api/multipart/create    -> {key, contentType} -> {uploadId}
     PUT  /api/multipart/part?key&uploadId&part          -> {etag, part}
     POST /api/multipart/complete  -> {key, uploadId, parts:[{part,etag}]}
     POST /api/multipart/abort     -> {key, uploadId}

   Las películas se suben por partes porque cada request a un Worker admite
   ~100 MB de cuerpo; el backoffice trocea el archivo y las une R2.
   Los archivos se sirven por la URL pública del bucket (pub-….r2.dev), que
   ya entrega rangos (206) para el streaming.

   Desplegar:  npx wrangler deploy      (desde cine/worker/)
   Token:      npx wrangler secret put CINE_TOKEN
*/
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Max-Age': '86400'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, s) => new Response(JSON.stringify(o), {
      status: s || 200, headers: { ...cors, 'Content-Type': 'application/json' }
    });

    if (url.pathname === '/health') return new Response('ok', { headers: cors });

    if (url.pathname === '/catalogo' && req.method === 'GET') {
      const obj = await env.CINE.get('biblioteca.json');
      if (!obj) return json({ titulos: [] });
      return new Response(obj.body, {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    /* ---- de aquí en adelante hace falta el token ----
       trim(): al poner el secret por stdin en Windows se cuela un \r final. */
    const auth = (req.headers.get('Authorization') || '').trim();
    const secreto = (env.CINE_TOKEN || '').trim();
    if (!secreto || auth !== 'Bearer ' + secreto) {
      return json({ error: 'no autorizado' }, 401);
    }

    if (url.pathname === '/api/check') return json({ ok: true });

    if (url.pathname === '/api/catalogo' && req.method === 'PUT') {
      const body = await req.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { return json({ error: 'JSON invalido' }, 400); }
      if (!parsed || !Array.isArray(parsed.titulos)) return json({ error: 'falta titulos[]' }, 400);
      await env.CINE.put('biblioteca.json', body, {
        httpMetadata: { contentType: 'application/json' }
      });
      return json({ ok: true, n: parsed.titulos.length });
    }

    if (url.pathname === '/api/objeto') {
      const key = url.searchParams.get('key') || '';
      if (!key || key === 'biblioteca.json' || key.indexOf('..') !== -1) return json({ error: 'key invalida' }, 400);
      if (req.method === 'PUT') {
        await env.CINE.put(key, req.body, {
          httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' }
        });
        return json({ ok: true, key });
      }
      if (req.method === 'DELETE') {
        await env.CINE.delete(key);
        return json({ ok: true });
      }
      return json({ error: 'metodo' }, 405);
    }

    if (url.pathname === '/api/multipart/create' && req.method === 'POST') {
      const { key, contentType } = await req.json();
      if (!key || key === 'biblioteca.json') return json({ error: 'key invalida' }, 400);
      const up = await env.CINE.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || 'video/mp4' }
      });
      return json({ uploadId: up.uploadId });
    }

    if (url.pathname === '/api/multipart/part' && req.method === 'PUT') {
      const key = url.searchParams.get('key');
      const uploadId = url.searchParams.get('uploadId');
      const part = parseInt(url.searchParams.get('part'), 10);
      if (!key || !uploadId || !(part >= 1)) return json({ error: 'parametros' }, 400);
      const up = env.CINE.resumeMultipartUpload(key, uploadId);
      try {
        const p = await up.uploadPart(part, req.body);
        return json({ etag: p.etag, part });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/complete' && req.method === 'POST') {
      const { key, uploadId, parts } = await req.json();
      const up = env.CINE.resumeMultipartUpload(key, uploadId);
      try {
        await up.complete((parts || []).map((p) => ({ partNumber: p.part, etag: p.etag })));
        return json({ ok: true, key });
      } catch (e) {
        return json({ error: String(e.message || e) }, 400);
      }
    }

    if (url.pathname === '/api/multipart/abort' && req.method === 'POST') {
      const { key, uploadId } = await req.json();
      try { await env.CINE.resumeMultipartUpload(key, uploadId).abort(); } catch (e) { /* ya no existe */ }
      return json({ ok: true });
    }

    return json({ error: 'ruta desconocida' }, 404);
  }
};
