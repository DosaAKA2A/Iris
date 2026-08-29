/* MOOVIN — envio de correo.
   ---------------------------------------------------------------------------
   Adaptador de un solo proveedor a la vez. Cambiar de uno a otro es cambiar el
   secreto CORREO_PROVEEDOR: no hay nada mas atado a Brevo ni a Resend.

   Secretos:
     CORREO_PROVEEDOR   brevo | resend | consola   (por defecto brevo)
     CORREO_CLAVE       la api key
     CORREO_REMITENTE   la direccion que firma (dominio verificado)
     CORREO_NOMBRE      el nombre visible          (por defecto "MOOVIN")

   Mientras no haya proveedor configurado, `hayCorreo()` devuelve false y la
   pagina lo dice sin mentir: la cuenta se crea igual y el codigo se pide desde
   el backoffice. No se inventa un "te lo hemos enviado" que no es verdad.

   Ojo con Resend: hasta que el dominio no esta verificado solo deja enviar a la
   direccion del dueno de la cuenta, y todo lo demas falla con 403. Es la causa
   mas comun de "dejo de funcionar de un dia para otro".
*/

const PROVEEDORES = {
  // Solo para `wrangler dev`: escribe el correo en la consola en vez de
  // mandarlo, que es la unica forma de probar el flujo de codigos sin gastar
  // envios. Si alguien lo dejara puesto en produccion el resultado seria que
  // nadie recibe el codigo, no una fuga: el log del worker no es publico.
  async consola(env, { para, asunto, texto }) {
    console.log('[correo:consola] para=' + para + ' asunto=' + asunto + '\n' + texto);
  },

  async brevo(env, { para, asunto, html, texto }) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.CORREO_CLAVE,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        sender: { email: env.CORREO_REMITENTE, name: env.CORREO_NOMBRE || 'MOOVIN' },
        to: [{ email: para }],
        subject: asunto,
        htmlContent: html,
        textContent: texto
      })
    });
    if (!r.ok) throw new Error('brevo ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  },

  async resend(env, { para, asunto, html, texto }) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.CORREO_CLAVE, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: (env.CORREO_NOMBRE || 'MOOVIN') + ' <' + env.CORREO_REMITENTE + '>',
        to: [para],
        subject: asunto,
        html,
        text: texto
      })
    });
    if (!r.ok) throw new Error('resend ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200));
  }
};

export function hayCorreo(env) {
  const cual = (env.CORREO_PROVEEDOR || '').toLowerCase();
  if (cual === 'consola') return true;
  return !!(env.CORREO_CLAVE && env.CORREO_REMITENTE && PROVEEDORES[cual || 'brevo']);
}

export async function envia(env, mensaje) {
  const cual = (env.CORREO_PROVEEDOR || 'brevo').toLowerCase();
  if (cual !== 'consola' && (!env.CORREO_CLAVE || !env.CORREO_REMITENTE)) {
    throw new Error('correo sin configurar');
  }
  const fn = PROVEEDORES[cual];
  if (!fn) throw new Error('proveedor de correo desconocido: ' + cual);
  await fn(env, mensaje);
}

// ---- plantillas -----------------------------------------------------------
// Sin emojis y sin imagenes remotas: los filtros de spam castigan las dos cosas
// y un correo que no llega es una cuenta que no se crea.

const marco = (titulo, cuerpo) => `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1e21">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;padding:32px">
<tr><td style="font-size:15px;font-weight:700;color:#8a8f98;padding-bottom:18px">MOOVIN</td></tr>
<tr><td style="font-size:21px;font-weight:600;padding-bottom:14px">${titulo}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3c4149">${cuerpo}</td></tr>
<tr><td style="padding-top:26px;border-top:1px solid #e6e8eb;margin-top:26px;font-size:12px;line-height:1.5;color:#8a8f98">
Si no pediste esto, ignora el mensaje: sin el código nadie entra a tu cuenta.</td></tr>
</table></td></tr></table></body></html>`;

export function plantillaCodigo(codigo, minutos) {
  return {
    asunto: codigo + ' es tu código de acceso',
    texto: 'Tu código de acceso a MOOVIN es ' + codigo + '. Vence en ' + minutos +
      ' minutos y sirve una sola vez.\n\nSi no lo pediste, ignora este mensaje.',
    html: marco('Tu código de acceso',
      `<p style="margin:0 0 18px">Escríbelo en la página para entrar. Vence en ${minutos} minutos y sirve una sola vez.</p>
       <div style="font-size:34px;font-weight:700;letter-spacing:.32em;text-align:center;padding:18px;background:#f4f5f7;border-radius:10px">${codigo}</div>`)
  };
}

export function plantillaAcceso(nombre) {
  return {
    asunto: 'Ya tienes acceso a MOOVIN',
    texto: 'Hola' + (nombre ? ' ' + nombre : '') + ', tu cuenta ya tiene acceso a la biblioteca.' +
      '\n\nEntra en https://moovin.live con tu correo y listo.',
    html: marco('Ya tienes acceso',
      `<p style="margin:0 0 18px">Hola${nombre ? ' ' + nombre : ''}. Tu cuenta ya tiene acceso a la biblioteca.</p>
       <p style="margin:0">Entra en <a href="https://moovin.live" style="color:#1c1e21">moovin.live</a> con tu correo y listo.</p>`)
  };
}
