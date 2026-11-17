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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function responder(datos, estado, origen) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json", ...cabecerasCORS(origen) },
  });
}

// ============================================================
// LA NUBE (archivero KV de Cloudflare, conectado como HERBARIO).
// Guarda dos colecciones, cada una con su prefijo de llave:
//   /herbario → "flor:<id>"   (flores escaneadas)
//   /ramos    → "ramo:<id>"   (ramos guardados)
// Lo eliminado deja una "lápida" (borrada: true) para que los otros
// dispositivos también lo borren. "actualizado" marca la última revisión.
//   GET    /<coleccion>       → { items: [{ id, fecha, actualizado, borrada }] }
//   GET    /<coleccion>/<id>  → el elemento completo
//   PUT    /<coleccion>/<id>  → guarda un elemento
//   DELETE /<coleccion>/<id>  → elimina un elemento
// ============================================================
const COLECCIONES = { herbario: "flor:", ramos: "ramo:" };

async function manejarColeccion(request, env, origen, ruta) {
  if (!env.HERBARIO) {
    return responder({ error: "El archivero de la nube no está configurado." }, 500, origen);
  }

  const [, coleccion, id = ""] = ruta.split("/");
  const prefijo = COLECCIONES[coleccion];
  if (id && !/^[0-9]{1,20}$/.test(id)) return responder({ error: "Flor inválida" }, 400, origen);

  // Lista de flores (sin fotos, para que sea rápida).
  if (request.method === "GET" && !id) {
    const flores = [];
    let cursor;
    do {
      const pagina = await env.HERBARIO.list({ prefix: prefijo, cursor });
      for (const llave of pagina.keys) {
        flores.push({ id: llave.name.slice(prefijo.length), ...(llave.metadata || {}) });
      }
      cursor = pagina.list_complete ? undefined : pagina.cursor;
    } while (cursor);
    return responder({ items: flores, flores }, 200, origen); // "flores": compatibilidad con la app anterior
  }

  if (request.method === "GET") {
    const flor = await env.HERBARIO.get(prefijo + id, "json");
    return flor ? responder(flor, 200, origen) : responder({ error: "No existe" }, 404, origen);
  }

  if (request.method === "PUT") {
    const texto = await request.text();
    if (texto.length > 2_000_000) return responder({ error: "Flor demasiado grande" }, 400, origen);
    let flor;
    try { flor = JSON.parse(texto); } catch { return responder({ error: "Datos inválidos" }, 400, origen); }
    if (flor.id !== id || typeof flor.fecha !== "string") return responder({ error: "Datos inválidos" }, 400, origen);
    await env.HERBARIO.put(prefijo + id, texto, { metadata: { fecha: flor.fecha, actualizado: flor.actualizado || flor.fecha } });
    return responder({ ok: true }, 200, origen);
  }

  if (request.method === "DELETE") {
    await env.HERBARIO.put(prefijo + id, "{}", { metadata: { borrada: true } });
    return responder({ ok: true }, 200, origen);
  }

  return responder({ error: "Operación no válida" }, 405, origen);
}

// ============================================================
// ASISTENTE DE RAMOS: Claude diseña un ramo según la ocasión.
// ============================================================
const RAMO = {
  type: "object",
  additionalProperties: false,
  required: ["nombre", "concepto", "paleta", "flores", "follaje", "pasos", "significado", "consejos", "costo"],
  properties: {
    nombre:   { type: "string", description: "Nombre corto y evocador para el ramo" },
    concepto: { type: "string", description: "La idea del ramo en 1 o 2 frases" },
    paleta: {
      type: "array", description: "3 a 5 colores principales",
      items: {
        type: "object", additionalProperties: false, required: ["color", "hex"],
        properties: { color: { type: "string" }, hex: { type: "string", description: "Color en formato #RRGGBB" } },
      },
    },
    flores: {
      type: "array", description: "3 a 6 flores",
      items: {
        type: "object", additionalProperties: false,
        required: ["nombre", "cantidad", "funcion", "por_que", "en_herbario"],
        properties: {
          nombre:      { type: "string" },
          cantidad:    { type: "string", description: "Ej. '5 tallos'" },
          funcion:     { type: "string", enum: ["protagonista", "secundaria", "relleno"] },
          por_que:     { type: "string", description: "Por qué encaja, en una frase" },
          en_herbario: { type: "boolean", description: "true si es una de las flores del herbario de la usuaria" },
        },
      },
    },
    follaje:     { type: "array", items: { type: "string" }, description: "1 a 3 follajes o verdes" },
    pasos:       { type: "array", items: { type: "string" }, description: "4 a 6 pasos para armarlo" },
    significado: { type: "string", description: "Qué transmite el conjunto según el lenguaje de las flores" },
    consejos:    { type: "array", items: { type: "string" }, description: "2 a 3 consejos prácticos (conservación, entrega, alternativas)" },
    costo:       { type: "string", description: "Rango de costo aproximado en flores, en palabras sencillas" },
  },
};

const INSTRUCCIONES_RAMO = `Eres una florista experta que enseña a una estudiante de floristería.
Diseña un ramo realista para el pedido, con flores que se consigan en florerías comunes.
Si te dan flores de su herbario, úsalas cuando encajen (marca en_herbario: true) para que aprenda con las que ya conoce,
pero no fuerces flores que no combinan. Explica con lenguaje claro y práctico, en español.`;

const OCASIONES = ["boda", "cumpleaños", "aniversario", "condolencias", "graduación", "romántico", "otra"];
const MEDIDAS = ["pequeño", "mediano", "grande"];
const PRESUPUESTOS = ["bajo", "medio", "alto"];
const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

async function disenarRamo(request, env, origen) {
  let p;
  try { p = await request.json(); } catch { return responder({ error: "Datos inválidos" }, 400, origen); }
  const ocasion = OCASIONES.includes(p.ocasion) ? p.ocasion : "otra";
  const tamano = MEDIDAS.includes(p.tamano) ? p.tamano : "mediano";
  const presupuesto = PRESUPUESTOS.includes(p.presupuesto) ? p.presupuesto : "medio";
  const herbario = Array.isArray(p.herbario) ? p.herbario.slice(0, 80).map((n) => texto(n, 60)).filter(Boolean) : [];

  const pedido = `Ocasión: ${ocasion}
Colores o estilo: ${texto(p.estilo, 200) || "libre"}
Tamaño: ${tamano}
Presupuesto: ${presupuesto}
Notas: ${texto(p.notas, 500) || "ninguna"}
Flores de su herbario: ${herbario.length ? herbario.join(", ") : "no usar herbario"}`;

  return preguntarAClaude(env, origen, INSTRUCCIONES_RAMO, RAMO, [{ type: "text", text: pedido }],
    "No se pudo diseñar este ramo. Prueba cambiando el pedido.");
}

// ============================================================
// PREGUNTARLE A CLAUDE (lo usan "identificar" y "ramo").
// ============================================================
async function preguntarAClaude(env, origen, instrucciones, esquema, contenido, mensajeRechazo) {
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
      output_config: { effort: "medium", format: { type: "json_schema", schema: esquema } },
      system: instrucciones,
      messages: [{ role: "user", content: contenido }],
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    console.log("Error de Claude", respuesta.status, detalle);
    return responder({ error: "Claude no pudo responder ahora. Intenta de nuevo en un momento." }, 502, origen);
  }

  const mensaje = await respuesta.json();
  if (mensaje.stop_reason === "refusal") return responder({ error: mensajeRechazo }, 422, origen);
  const bloque = (mensaje.content || []).find((b) => b.type === "text");
  try {
    return responder(JSON.parse(bloque.text), 200, origen);
  } catch {
    return responder({ error: "La respuesta llegó incompleta. Intenta de nuevo." }, 502, origen);
  }
}

export default {
  async fetch(request, env) {
    const origen = request.headers.get("Origin") || "";
    const ruta = new URL(request.url).pathname;

    // El navegador pregunta primero "¿puedo enviarte datos?" (preflight).
    if (request.method === "OPTIONS") return new Response(null, { headers: cabecerasCORS(origen) });

    // La nube: herbario y ramos guardados.
    const coleccion = ruta.split("/")[1];
    if (COLECCIONES[coleccion]) {
      if (origen !== ORIGEN_PERMITIDO) return responder({ error: "Origen no permitido" }, 403, origen);
      return manejarColeccion(request, env, origen, ruta);
    }

    if (request.method !== "POST") return responder({ error: "Usa POST" }, 405, origen);
    if (origen !== ORIGEN_PERMITIDO) return responder({ error: "Origen no permitido" }, 403, origen);

    // Asistente de ramos.
    if (ruta === "/ramo") return disenarRamo(request, env, origen);

    // Identificar una flor.
    let cuerpo;
    try { cuerpo = await request.json(); } catch { return responder({ error: "Datos inválidos" }, 400, origen); }
    const imagen = cuerpo && cuerpo.imagen;
    if (typeof imagen !== "string" || imagen.length > 4_000_000) {
      return responder({ error: "Falta la foto o es demasiado grande" }, 400, origen);
    }
    return preguntarAClaude(env, origen, INSTRUCCIONES, FICHA, [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imagen } },
      { type: "text", text: "¿Qué flor es? Llena la ficha." },
    ], "No se pudo analizar esta foto. Prueba con otra.");
  },
};
