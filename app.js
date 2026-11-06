// LÓGICA de la app: qué pasa cuando ella toca algo.

// 0. DIRECCIÓN DEL INTERMEDIARIO (Cloudflare Worker).
//    Mientras esté vacía, la app muestra la ficha de ejemplo.
const URL_INTERMEDIARIO = "";

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
const pantallaInicio = document.getElementById("pantalla-inicio");
const pantallaFicha = document.getElementById("pantalla-ficha");
const entradaCamara = document.getElementById("entrada-camara");
const botonVolver = document.getElementById("boton-volver");
const fotoFlor = document.getElementById("foto-flor");
const ficha = document.getElementById("ficha");

// Protección: el texto que llega de afuera se muestra como texto, nunca como código.
function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function irAFicha() {
  pantallaInicio.hidden = true;
  pantallaFicha.hidden = false;
  window.scrollTo(0, 0);
}

// 3. Estados de la ficha: cargando, error, y la ficha completa.
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

// 4. Achicar la foto: las del celular pesan mucho; a ~1000 px basta y cuesta menos.
async function achicarFoto(archivo) {
  const url = URL.createObjectURL(archivo);
  const img = new Image();
  await new Promise((ok, falla) => { img.onload = ok; img.onerror = falla; img.src = url; });
  const escala = Math.min(1, 1092 / Math.max(img.width, img.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
  URL.revokeObjectURL(url);
  // Devuelve la foto como texto (base64), que es como la recibe Claude.
  return lienzo.toDataURL("image/jpeg", 0.85).split(",")[1];
}

// 5. Preguntarle al intermediario qué flor es.
async function identificar(archivo) {
  const imagen = await achicarFoto(archivo);
  const respuesta = await fetch(URL_INTERMEDIARIO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagen }),
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.error || "No se pudo analizar la foto.");
  return datos;
}

// 6. Cuando ella toma una foto con la cámara...
entradaCamara.addEventListener("change", async () => {
  const archivo = entradaCamara.files[0];
  if (!archivo) return; // si canceló, no hacemos nada
  entradaCamara.value = ""; // permite tomar otra foto después
  fotoFlor.src = URL.createObjectURL(archivo);
  irAFicha();

  if (!URL_INTERMEDIARIO) {
    mostrarFicha(florEjemplo, "Aún no reconocemos flores reales: esta es una ficha de ejemplo.");
    return;
  }

  mostrarCargando();
  try {
    mostrarFicha(await identificar(archivo));
  } catch (error) {
    mostrarError(error.message || "Revisa tu conexión a internet e intenta de nuevo.");
  }
});

// 7. Botón "Volver"
botonVolver.addEventListener("click", () => {
  pantallaFicha.hidden = true;
  pantallaInicio.hidden = false;
});
