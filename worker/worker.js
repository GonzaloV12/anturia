// INTERMEDIARIO de Anturia (Cloudflare Worker).
// Recibe la foto desde la app, le pregunta a Claude qué flor es y devuelve la ficha.
// Tu llave secreta vive aquí (como "secreto" de Cloudflare), nunca en la página pública.
//
// Se escribe con fetch directo (sin librerías) para poder pegarlo tal cual
// en el editor web de Cloudflare, sin instalar nada.

// Solo aceptamos pedidos que vengan de tu página.
const ORIGEN_PERMITIDO = "https://gonzalov12.github.io";

// Las casillas de la ficha que Claude debe llenar.
const FICHA = {
  type: "object",
  additionalProperties: false,
  required: ["es_flor", "nombre", "cientifico", "confianza", "temporada", "colores",
             "significado", "cuidados", "arreglos", "mensaje"],
  properties: {
    es_flor:     { type: "boolean", description: "true si en la foto hay una flor o planta reconocible" },
    nombre:      { type: "string", description: "Nombre común en español" },
    cientifico:  { type: "string", description: "Nombre científico" },
    confianza:   { type: "string", enum: ["alta", "media", "baja"] },
    temporada:   { type: "string", description: "Temporada en que se consigue, ej. 'Primavera – Otoño'" },
    colores:     { type: "array", items: { type: "string" }, description: "Colores en que se consigue" },
    significado: { type: "string", description: "Significado y simbolismo, 1 a 3 frases" },
    cuidados:    { type: "array", items: { type: "string" }, description: "3 a 5 cuidados como flor de corte" },
    arreglos:    { type: "array", items: { type: "string" }, description: "3 a 4 usos en arreglos florales y con qué combina" },
    mensaje:     { type: "string", description: "Si no es flor o hay duda, una nota breve para la usuaria; si no, texto vacío" },
  },
};

const INSTRUCCIONES = `Eres un experto florista que ayuda a una estudiante de floristería.
Identifica la flor de la foto y llena la ficha en español, con lenguaje claro.
Enfócate en su uso como flor de corte y en arreglos florales.
Si no hay flor en la foto, pon es_flor en false, deja los demás textos vacíos y explica en "mensaje".
Si no estás seguro de la especie, indica confianza "baja" y menciona en "mensaje" con qué otra flor se podría confundir.`;

function cabecerasCORS(origen) {
  return {
    "Access-Control-Allow-Origin": origen === ORIGEN_PERMITIDO ? origen : ORIGEN_PERMITIDO,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function responder(datos, estado, origen) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json", ...cabecerasCORS(origen) },
  });
}

export default {
  async fetch(request, env) {
    const origen = request.headers.get("Origin") || "";

    // El navegador pregunta primero "¿puedo enviarte datos?" (preflight).
    if (request.method === "OPTIONS") return new Response(null, { headers: cabecerasCORS(origen) });
    if (request.method !== "POST") return responder({ error: "Usa POST" }, 405, origen);
    if (origen !== ORIGEN_PERMITIDO) return responder({ error: "Origen no permitido" }, 403, origen);

    let cuerpo;
    try { cuerpo = await request.json(); } catch { return responder({ error: "Datos inválidos" }, 400, origen); }
    const imagen = cuerpo && cuerpo.imagen;
    if (typeof imagen !== "string" || imagen.length > 4_000_000) {
      return responder({ error: "Falta la foto o es demasiado grande" }, 400, origen);
    }

    // Le preguntamos a Claude.
    const respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5-5",
        max_tokens: 16000,
        fallbacks: "default", // si Claude rechaza la consulta, la reintenta con otro modelo
        output_config: { effort: "medium", format: { type: "json_schema", schema: FICHA } },
        system: INSTRUCCIONES,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imagen } },
            { type: "text", text: "¿Qué flor es? Llena la ficha." },
          ],
        }],
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      console.log("Error de Claude", respuesta.status, detalle);
      return responder({ error: "Claude no pudo responder ahora. Intenta de nuevo en un momento." }, 502, origen);
    }

    const mensaje = await respuesta.json();
    if (mensaje.stop_reason === "refusal") {
      return responder({ error: "No se pudo analizar esta foto. Prueba con otra." }, 422, origen);
    }
    const bloque = (mensaje.content || []).find((b) => b.type === "text");
    try {
      return responder(JSON.parse(bloque.text), 200, origen);
    } catch {
      return responder({ error: "La respuesta llegó incompleta. Intenta de nuevo." }, 502, origen);
    }
  },
};
