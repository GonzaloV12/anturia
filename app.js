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
  ramos: document.getElementById("pantalla-ramos"),
};
const entradaCamara = document.getElementById("entrada-camara");
const entradaGaleria = document.getElementById("entrada-galeria");
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
const botonRamos = document.getElementById("boton-ramos");
const botonVolverRamos = document.getElementById("boton-volver-ramos");
const formRamo = document.getElementById("form-ramo");
const resultadoRamo = document.getElementById("resultado-ramo");

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
// ============================================================
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
    headers: flor ? { "Content-Type": "application/json" } : {},
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
  if (!URL_INTERMEDIARIO) return false;

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
function dibujarNube(estado) {
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
  dibujarNube("sincronizando");
  try {
    const cambios = await sincronizar();
    dibujarNube("ok");
    if (cambios && !pantallas.herbario.hidden) mostrarHerbario();
    actualizarContador();
  } catch {
    dibujarNube("error");
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
    // Si no hay internet, se anota para borrarla en la nube más tarde.
    nube("DELETE", id).catch(() => escribir(LLAVE_PENDIENTES, [...leer(LLAVE_PENDIENTES, []), id]));
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
// 5b. ASISTENTE DE RAMOS
// ============================================================
// Ramo de ejemplo para el modo demostración (cuando no hay intermediario).
const ramoEjemplo = {
  nombre: "Jardín al amanecer",
  concepto: "Un ramo suelto y romántico en tonos pastel, con movimiento natural.",
  paleta: [
    { color: "Rosa empolvado", hex: "#E8B4B8" },
    { color: "Durazno", hex: "#F6C9A8" },
    { color: "Crema", hex: "#F7EFE2" },
    { color: "Verde salvia", hex: "#9CAF88" },
  ],
  flores: [
    { nombre: "Rosa de jardín", cantidad: "5 tallos", funcion: "protagonista", por_que: "Aporta volumen y el toque romántico.", en_herbario: true },
    { nombre: "Ranúnculo", cantidad: "6 tallos", funcion: "secundaria", por_que: "Sus capas de pétalos acompañan a la rosa sin competir.", en_herbario: false },
    { nombre: "Gypsophila", cantidad: "3 tallos", funcion: "relleno", por_que: "Llena huecos y da ligereza.", en_herbario: false },
  ],
  follaje: ["Eucalipto dólar", "Ruscus"],
  pasos: [
    "Limpia los tallos: quita hojas y espinas de la parte baja.",
    "Arma la base cruzando el follaje en espiral.",
    "Coloca las rosas al centro, a distintas alturas.",
    "Agrega los ranúnculos alrededor y rellena con gypsophila.",
    "Amarra en el punto de unión y corta los tallos al mismo largo.",
  ],
  significado: "Amor tierno y alegría por un nuevo comienzo.",
  consejos: ["Mantén el ramo en agua fresca hasta la entrega.", "Si no hay ranúnculos, usa lisianthus."],
  costo: "Medio: unas 14 flores más follaje.",
};

function dibujarRamo(r) {
  const lista = (items) => (items || []).map((x) => `<li>${escapar(x)}</li>`).join("");
  const hexValido = (h) => (/^#[0-9a-f]{6}$/i.test(h) ? h : "#cccccc");
  const funciones = { protagonista: "Protagonista", secundaria: "Secundaria", relleno: "Relleno" };

  resultadoRamo.innerHTML = `
    <article class="ficha ficha-ramo">
      <p class="etiqueta-pequena">Tu ramo</p>
      <h2>${escapar(r.nombre)}</h2>
      <p class="nombre-cientifico">${escapar(r.concepto)}</p>

      <div class="paleta">
        ${(r.paleta || []).map((c) => `
          <div class="muestra">
            <span class="muestra-color" style="background:${hexValido(c.hex)}"></span>
            <small>${escapar(c.color)}</small>
          </div>`).join("")}
      </div>

      <div class="seccion">
        <h3>🌸 Flores</h3>
        <ul class="lista-flores">
          ${(r.flores || []).map((f) => `
            <li>
              <div class="flor-titulo">
                <strong>${escapar(f.nombre)}</strong>
                ${f.en_herbario ? `<span class="etiqueta etiqueta-herbario">📖 En tu herbario</span>` : ""}
              </div>
              <div class="flor-datos">${escapar(f.cantidad)} · ${escapar(funciones[f.funcion] || f.funcion)}</div>
              <div>${escapar(f.por_que)}</div>
            </li>`).join("")}
        </ul>
      </div>
      <div class="seccion">
        <h3>🌿 Follaje</h3>
        <ul>${lista(r.follaje)}</ul>
      </div>
      <div class="seccion">
        <h3>✂️ Cómo armarlo</h3>
        <ol>${lista(r.pasos)}</ol>
      </div>
      <div class="seccion">
        <h3>💗 Lo que transmite</h3>
        <p>${escapar(r.significado)}</p>
      </div>
      <div class="seccion">
        <h3>💡 Consejos</h3>
        <ul>${lista(r.consejos)}</ul>
      </div>
      <div class="seccion">
        <h3>💰 Costo aproximado</h3>
        <p>${escapar(r.costo)}</p>
      </div>
    </article>
    <button id="boton-otro-ramo" class="boton-galeria">✏️ Cambiar el pedido</button>`;

  document.getElementById("boton-otro-ramo").addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  resultadoRamo.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function pedirRamo(evento) {
  evento.preventDefault();
  const datos = new FormData(formRamo);

  // Sin intermediario (panel de demostración): ramo de ejemplo.
  if (!URL_INTERMEDIARIO) {
    dibujarRamo(ramoEjemplo);
    resultadoRamo.insertAdjacentHTML("afterbegin", `<div class="aviso">🌱 Modo demostración: este es un ramo de ejemplo.</div>`);
    return;
  }

  // Nombres de las flores del herbario (sin repetir), si ella lo pidió.
  let nombres = [];
  if (datos.get("usarHerbario")) {
    try { nombres = [...new Set((await herbario.todas()).map((f) => f.ficha.nombre))]; } catch {}
  }

  const boton = formRamo.querySelector(".boton-disenar");
  boton.disabled = true;
  resultadoRamo.innerHTML = `
    <div class="cargando">
      <div class="girando" aria-hidden="true">💐</div>
      <p>Diseñando tu ramo…</p>
    </div>`;
  resultadoRamo.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const respuesta = await fetch(URL_INTERMEDIARIO + "/ramo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ocasion: datos.get("ocasion"),
        estilo: datos.get("estilo"),
        tamano: datos.get("tamano"),
        presupuesto: datos.get("presupuesto"),
        notas: datos.get("notas"),
        herbario: nombres,
      }),
    });
    const ramo = await respuesta.json();
    if (!respuesta.ok) throw new Error(ramo.error || "No se pudo diseñar el ramo.");
    dibujarRamo(ramo);
  } catch (error) {
    resultadoRamo.innerHTML = `<div class="aviso aviso-error">⚠️ ${escapar(error.message || "Revisa tu conexión e intenta de nuevo.")}</div>`;
  } finally {
    boton.disabled = false;
  }
}

// ============================================================
// 6. BOTONES
// ============================================================
// Lo que pasa con una foto, venga de la cámara o de la galería.
async function procesarFoto(entrada) {
  const archivo = entrada.files[0];
  if (!archivo) return; // si canceló, no hacemos nada
  entrada.value = ""; // permite elegir otra foto después
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
        nube("PUT", flor.id, flor)
          .then(() => { accionesFicha.innerHTML = `<p class="nota-guardada">✓ Guardada en tu herbario ☁️</p>`; })
          .catch(() => {});
      } catch {
        accionesFicha.innerHTML = `<p class="nota-guardada">No se pudo guardar en el herbario (¿modo incógnito o memoria llena?).</p>`;
      }
    }
  } catch (error) {
    mostrarError(error.message || "Revisa tu conexión a internet e intenta de nuevo.");
  }
}

// Los dos botones usan la misma función.
entradaCamara.addEventListener("change", () => procesarFoto(entradaCamara));
entradaGaleria.addEventListener("change", () => procesarFoto(entradaGaleria));

// "Volver" desde la ficha: regresa al inicio o al herbario, según de dónde vino.
botonVolver.addEventListener("click", () => {
  if (volverA === "herbario") mostrarHerbario();
  else irA("inicio");
});

botonHerbario.addEventListener("click", () => mostrarHerbario({ conNube: true }));
botonRamos.addEventListener("click", () => irA("ramos"));
botonVolverRamos.addEventListener("click", () => irA("inicio"));
formRamo.addEventListener("submit", pedirRamo);
botonVolverHerbario.addEventListener("click", () => irA("inicio"));

// Tocar una tarjeta del herbario abre su ficha.
listaHerbario.addEventListener("click", (evento) => {
  const tarjeta = evento.target.closest(".tarjeta-flor");
  if (tarjeta) abrirDelHerbario(tarjeta.dataset.id);
});

// La clave vieja del herbario ya no se usa: la borramos del teléfono.
escribir("anturia-clave-herbario", null);

// Al abrir la app, mostramos cuántas flores hay y sincronizamos en silencio.
actualizarContador();
sincronizar().then((cambios) => cambios && actualizarContador()).catch(() => {});
