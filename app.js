// LÓGICA de la app: qué pasa cuando ella toca algo.

// 0. DIRECCIÓN DEL INTERMEDIARIO (Cloudflare Worker).
//    Mientras esté vacía, la app muestra la ficha de ejemplo.
const URL_INTERMEDIARIO = "https://anturia.gonzalovargasbco.workers.dev";

// 1. DATOS DE EJEMPLO (inventados). Se usan si todavía no hay intermediario.
const florEjemplo = {
  es_flor: true,
  nombre: "Rosa de jardín",
  cientifico: "Rosa × hybrida",
  confianza: "alta",
  temporada: "Primavera – Otoño",
  colores: ["Rojo", "Rosa", "Blanco", "Amarillo"],
  significado:
    "Símbolo clásico del amor. La roja expresa pasión, la blanca pureza y la amarilla amistad.",
  cuidados: [
    "Cortar el tallo en diagonal antes de ponerla en agua.",
    "Cambiar el agua cada 2 días.",
    "Quitar las hojas que queden bajo el agua.",
    "Evitar sol directo y cercanía con frutas.",
  ],
  arreglos: [
    "Flor protagonista en ramos de novia.",
    "Combina bien con eucalipto y gypsophila.",
    "Ideal para centros de mesa redondos y compactos.",
  ],
  mensaje: "",
};

// 2. Buscamos en el HTML los elementos que vamos a usar (por su id).
const pantallas = {
  inicio: document.getElementById("pantalla-inicio"),
  ficha: document.getElementById("pantalla-ficha"),
  herbario: document.getElementById("pantalla-herbario"),
};
const entradaCamara = document.getElementById("entrada-camara");
const botonVolver = document.getElementById("boton-volver");
const botonHerbario = document.getElementById("boton-herbario");
const botonVolverHerbario = document.getElementById("boton-volver-herbario");
const contadorHerbario = document.getElementById("contador-herbario");
const resumenHerbario = document.getElementById("resumen-herbario");
const herbarioVacio = document.getElementById("herbario-vacio");
const listaHerbario = document.getElementById("lista-herbario");
const cajaNube = document.getElementById("caja-nube");
const fotoFlor = document.getElementById("foto-flor");
const ficha = document.getElementById("ficha");
const accionesFicha = document.getElementById("acciones-ficha");

// Desde dónde se abrió la ficha, para que "Volver" regrese al lugar correcto.
let volverA = "inicio";

// Protección: el texto que llega de afuera se muestra como texto, nunca como código.
function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// Muestra una pantalla y oculta las demás (como abrir una sola puerta a la vez).
function irA(nombre) {
  for (const [clave, elemento] of Object.entries(pantallas)) elemento.hidden = clave !== nombre;
  window.scrollTo(0, 0);
}

// ============================================================
// 3. EL HERBARIO: la "bodega" del navegador (IndexedDB).
//    Cada flor se guarda como: { id, fecha, foto, ficha }.
// ============================================================
let bodega = null;

function abrirBodega() {
  if (bodega) return bodega;
  bodega = new Promise((ok, falla) => {
    const pedido = indexedDB.open("anturia", 1);
    // La primera vez se crea el "estante" donde van las flores.
    pedido.onupgradeneeded = () => pedido.result.createObjectStore("flores", { keyPath: "id" });
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falla(pedido.error);
  });
  return bodega;
}

// Hace una operación en el estante de flores y espera a que termine.
async function enBodega(modo, operacion) {
  const db = await abrirBodega();
  return new Promise((ok, falla) => {
    const estante = db.transaction("flores", modo).objectStore("flores");
    const pedido = operacion(estante);
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falla(pedido.error);
  });
}

const herbario = {
  todas: async () => (await enBodega("readonly", (e) => e.getAll())).sort((a, b) => b.fecha.localeCompare(a.fecha)),
  una: (id) => enBodega("readonly", (e) => e.get(id)),
  guardar: (flor) => enBodega("readwrite", (e) => e.put(flor)),
  eliminar: (id) => enBodega("readwrite", (e) => e.delete(id)),
};

// ============================================================
// 3b. LA NUBE: copia del herbario en el archivero de Cloudflare.
//     La clave del herbario se recuerda en este dispositivo.
// ============================================================
const LLAVE_CLAVE = "anturia-clave-herbario";
const LLAVE_PENDIENTES = "anturia-borrar-pendiente";

function leer(llave, porDefecto) {
  try { return JSON.parse(localStorage.getItem(llave)) ?? porDefecto; } catch { return porDefecto; }
}
function escribir(llave, valor) {
  try { valor == null ? localStorage.removeItem(llave) : localStorage.setItem(llave, JSON.stringify(valor)); } catch {}
}

// Hace un pedido al archivero, a través del intermediario.
async function nube(metodo, id, flor) {
  const respuesta = await fetch(URL_INTERMEDIARIO + "/herbario" + (id ? "/" + id : ""), {
    method: metodo,
    headers: { "X-Clave-Herbario": leer(LLAVE_CLAVE, ""), ...(flor ? { "Content-Type": "application/json" } : {}) },
    body: flor ? JSON.stringify(flor) : undefined,
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    const error = new Error(datos.error || "Error de la nube");
    error.estado = respuesta.status;
    throw error;
  }
  return datos;
}

// Cuadra los dos inventarios: lo que falte en el teléfono se baja,
// lo que falte en la nube se sube, y lo borrado se borra en ambos.
async function sincronizar() {
  if (!URL_INTERMEDIARIO || !leer(LLAVE_CLAVE, "")) return false;

  // Primero, borrados que quedaron pendientes (por ejemplo, sin internet).
  for (const id of leer(LLAVE_PENDIENTES, [])) await nube("DELETE", id);
  escribir(LLAVE_PENDIENTES, null);

  const { flores: enNube } = await nube("GET");
  const locales = await herbario.todas();
  const idsLocales = new Set(locales.map((f) => f.id));
  const idsNube = new Set(enNube.map((f) => f.id));
  let cambios = false;

  for (const f of enNube) {
    if (f.borrada && idsLocales.has(f.id)) { await herbario.eliminar(f.id); cambios = true; }
    if (!f.borrada && !idsLocales.has(f.id)) { await herbario.guardar(await nube("GET", f.id)); cambios = true; }
  }
  for (const f of locales) {
    if (!idsNube.has(f.id)) await nube("PUT", f.id, f);
  }
  return cambios;
}

// Muestra en el herbario el estado de la nube.
function dibujarNube(estado, detalle) {
  if (estado === "sin-clave") {
    cajaNube.innerHTML = `
      <p><strong>☁️ Guarda tu herbario en la nube</strong><br>
      Así no se pierde si cambias de celular o borras el navegador.</p>
      ${detalle ? `<p class="aviso-error-texto">${escapar(detalle)}</p>` : ""}
      <form id="form-clave" class="form-clave">
        <input id="entrada-clave" type="password" placeholder="Clave del herbario" autocomplete="current-password" required>
        <button type="submit">Conectar</button>
      </form>`;
    document.getElementById("form-clave").addEventListener("submit", async (evento) => {
      evento.preventDefault();
      escribir(LLAVE_CLAVE, document.getElementById("entrada-clave").value.trim());
      mostrarHerbario({ conNube: true });
    });
    return;
  }
  const textos = {
    sincronizando: "☁️ Sincronizando con la nube…",
    ok: "☁️ Tu herbario está guardado en la nube",
    error: "☁️ No se pudo conectar con la nube. Tus flores siguen guardadas en este teléfono.",
  };
  cajaNube.innerHTML = `<p class="estado-nube">${textos[estado]}</p>`;
}

function fechaBonita(iso) {
  return new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

// Actualiza el contador del botón "Herbario" en el inicio.
async function actualizarContador() {
  try {
    const n = (await herbario.todas()).length;
    contadorHerbario.textContent = n === 0 ? "Sin flores aún" : n === 1 ? "1 flor" : `${n} flores`;
  } catch {
    contadorHerbario.textContent = "No disponible";
  }
}

// Dibuja la cuadrícula del herbario (y, si se pide, sincroniza con la nube).
async function mostrarHerbario({ conNube = false } = {}) {
  irA("herbario");
  if (conNube) sincronizarYRedibujar();
  let flores = [];
  try {
    flores = await herbario.todas();
  } catch {
    resumenHerbario.textContent = "Este navegador no permite guardar flores (¿modo incógnito?).";
  }
  herbarioVacio.hidden = flores.length > 0;
  if (flores.length) {
    resumenHerbario.textContent = flores.length === 1 ? "1 flor coleccionada" : `${flores.length} flores coleccionadas`;
  } else if (!resumenHerbario.textContent.startsWith("Este navegador")) {
    resumenHerbario.textContent = "";
  }
  listaHerbario.innerHTML = flores.map((f) => `
    <button class="tarjeta-flor" data-id="${escapar(f.id)}">
      <img src="${f.foto}" alt="">
      <span class="tarjeta-flor-nombre">${escapar(f.ficha.nombre)}</span>
      <small>${fechaBonita(f.fecha)}</small>
    </button>`).join("");
}

async function sincronizarYRedibujar() {
  if (!URL_INTERMEDIARIO) { cajaNube.innerHTML = ""; return; }
  if (!leer(LLAVE_CLAVE, "")) return dibujarNube("sin-clave");
  dibujarNube("sincronizando");
  try {
    const cambios = await sincronizar();
    dibujarNube("ok");
    if (cambios && !pantallas.herbario.hidden) mostrarHerbario();
    actualizarContador();
  } catch (error) {
    if (error.estado === 401) {
      escribir(LLAVE_CLAVE, null);
      dibujarNube("sin-clave", "Esa clave no es correcta. Intenta de nuevo.");
    } else {
      dibujarNube("error");
    }
  }
}

// Abre una flor guardada (no gasta saldo: la ficha ya está guardada).
async function abrirDelHerbario(id) {
  const flor = await herbario.una(id);
  if (!flor) return mostrarHerbario();
  fotoFlor.src = flor.foto;
  mostrarFicha(flor.ficha);
  volverA = "herbario";
  irA("ficha");

  // Botón de eliminar con doble toque, para evitar accidentes.
  accionesFicha.innerHTML = `
    <p class="nota-guardada">📖 Guardada el ${fechaBonita(flor.fecha)}</p>
    <button id="boton-eliminar" class="boton-eliminar">Eliminar del herbario</button>`;
  const botonEliminar = document.getElementById("boton-eliminar");
  botonEliminar.addEventListener("click", async () => {
    if (!botonEliminar.classList.contains("confirmar")) {
      botonEliminar.classList.add("confirmar");
      botonEliminar.textContent = "¿Segura? Toca otra vez para eliminar";
      return;
    }
    await herbario.eliminar(id);
    if (leer(LLAVE_CLAVE, "")) {
      // Si no hay internet, se anota para borrarla en la nube más tarde.
      nube("DELETE", id).catch(() => escribir(LLAVE_PENDIENTES, [...leer(LLAVE_PENDIENTES, []), id]));
    }
    await actualizarContador();
    mostrarHerbario();
  });
}

// ============================================================
// 4. LA FICHA: cargando, error, y la ficha completa.
// ============================================================
function mostrarCargando() {
  ficha.innerHTML = `
    <div class="cargando">
      <div class="girando" aria-hidden="true">🌸</div>
      <p>Analizando tu flor…</p>
    </div>`;
}

function mostrarError(texto) {
  ficha.innerHTML = `<div class="aviso aviso-error">⚠️ ${escapar(texto)}</div>`;
}

function mostrarFicha(flor, nota) {
  accionesFicha.innerHTML = "";
  if (!flor.es_flor) {
    ficha.innerHTML = `<div class="aviso">🌱 ${escapar(flor.mensaje || "No encontré una flor en la foto. Intenta acercarte más.")}</div>`;
    return;
  }
  const lista = (items) => (items || []).map((x) => `<li>${escapar(x)}</li>`).join("");

  ficha.innerHTML = `
    ${nota ? `<div class="aviso">🌱 ${escapar(nota)}</div>` : ""}
    ${flor.mensaje ? `<div class="aviso">💬 ${escapar(flor.mensaje)}</div>` : ""}
    <h2>${escapar(flor.nombre)}</h2>
    <p class="nombre-cientifico">${escapar(flor.cientifico)}</p>
    <div class="etiquetas">
      ${flor.temporada ? `<span class="etiqueta">🗓 ${escapar(flor.temporada)}</span>` : ""}
      ${(flor.colores || []).map((c) => `<span class="etiqueta">${escapar(c)}</span>`).join("")}
      ${flor.confianza && flor.confianza !== "alta" ? `<span class="etiqueta etiqueta-duda">Confianza ${escapar(flor.confianza)}</span>` : ""}
    </div>

    <div class="seccion">
      <h3>💗 Significado</h3>
      <p>${escapar(flor.significado)}</p>
    </div>
    <div class="seccion">
      <h3>💧 Cuidados</h3>
      <ul>${lista(flor.cuidados)}</ul>
    </div>
    <div class="seccion">
      <h3>💐 En arreglos</h3>
      <ul>${lista(flor.arreglos)}</ul>
    </div>
  `;
}

// ============================================================
// 5. LA FOTO: achicarla y enviarla al intermediario.
// ============================================================
// Achica la foto al tamaño indicado y la devuelve como texto (dataURL).
async function achicarFoto(archivo, ladoMaximo, calidad) {
  const url = URL.createObjectURL(archivo);
  const img = new Image();
  await new Promise((ok, falla) => { img.onload = ok; img.onerror = falla; img.src = url; });
  const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
  URL.revokeObjectURL(url);
  return lienzo.toDataURL("image/jpeg", calidad);
}

// Pregunta al intermediario qué flor es (a ~1000 px basta y cuesta menos).
async function identificar(fotoParaClaude) {
  const respuesta = await fetch(URL_INTERMEDIARIO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagen: fotoParaClaude.split(",")[1] }),
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || "No se pudo analizar la foto.");
  return datos;
}

// ============================================================
// 6. BOTONES
// ============================================================
// Cuando ella toma una foto con la cámara...
entradaCamara.addEventListener("change", async () => {
  const archivo = entradaCamara.files[0];
  if (!archivo) return; // si canceló, no hacemos nada
  entradaCamara.value = ""; // permite tomar otra foto después
  fotoFlor.src = URL.createObjectURL(archivo);
  volverA = "inicio";
  accionesFicha.innerHTML = "";
  irA("ficha");

  if (!URL_INTERMEDIARIO) {
    mostrarFicha(florEjemplo, "Aún no reconocemos flores reales: esta es una ficha de ejemplo.");
    return;
  }

  mostrarCargando();
  try {
    const fotoParaClaude = await achicarFoto(archivo, 1092, 0.85);
    const datos = await identificar(fotoParaClaude);
    mostrarFicha(datos);

    // Si es una flor, se guarda sola en el herbario.
    if (datos.es_flor) {
      try {
        const flor = {
          id: String(Date.now()),
          fecha: new Date().toISOString(),
          foto: await achicarFoto(archivo, 800, 0.8), // una copia más liviana para guardar
          ficha: datos,
        };
        await herbario.guardar(flor);
        accionesFicha.innerHTML = `<p class="nota-guardada">✓ Guardada en tu herbario</p>`;
        actualizarContador();
        // Copia en la nube (si falla, se sube en la próxima sincronización).
        if (leer(LLAVE_CLAVE, "")) {
          nube("PUT", flor.id, flor)
            .then(() => { accionesFicha.innerHTML = `<p class="nota-guardada">✓ Guardada en tu herbario ☁️</p>`; })
            .catch(() => {});
        }
      } catch {
        accionesFicha.innerHTML = `<p class="nota-guardada">No se pudo guardar en el herbario (¿modo incógnito o memoria llena?).</p>`;
      }
    }
  } catch (error) {
    mostrarError(error.message || "Revisa tu conexión a internet e intenta de nuevo.");
  }
});

// "Volver" desde la ficha: regresa al inicio o al herbario, según de dónde vino.
botonVolver.addEventListener("click", () => {
  if (volverA === "herbario") mostrarHerbario();
  else irA("inicio");
});

botonHerbario.addEventListener("click", () => mostrarHerbario({ conNube: true }));
botonVolverHerbario.addEventListener("click", () => irA("inicio"));

// Tocar una tarjeta del herbario abre su ficha.
listaHerbario.addEventListener("click", (evento) => {
  const tarjeta = evento.target.closest(".tarjeta-flor");
  if (tarjeta) abrirDelHerbario(tarjeta.dataset.id);
});

// Al abrir la app, mostramos cuántas flores hay y sincronizamos en silencio.
actualizarContador();
sincronizar().then((cambios) => cambios && actualizarContador()).catch(() => {});
