// LÓGICA de la app: qué pasa cuando ella toca algo.

// 1. DATOS DE EJEMPLO (inventados). Más adelante vendrán de una inteligencia artificial.
//    Es como una ficha técnica: cada dato tiene un nombre (clave) y un valor.
const florEjemplo = {
  nombre: "Rosa de jardín",
  cientifico: "Rosa × hybrida",
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
  foto: "rosa-ejemplo.svg", // ilustración propia, guardada en la carpeta
};

// 2. Buscamos en el HTML los elementos que vamos a usar (por su id).
const pantallaInicio = document.getElementById("pantalla-inicio");
const pantallaFicha = document.getElementById("pantalla-ficha");
const entradaCamara = document.getElementById("entrada-camara");
const botonVolver = document.getElementById("boton-volver");
const fotoFlor = document.getElementById("foto-flor");
const ficha = document.getElementById("ficha");

// 3. Función que "dibuja" la ficha con los datos de una flor.
function mostrarFicha(flor, urlFoto, esFotoPropia) {
  fotoFlor.src = urlFoto;

  ficha.innerHTML = `
    ${esFotoPropia ? `<div class="aviso">🌱 Aún no reconocemos flores reales: esta es una ficha de ejemplo.</div>` : ""}
    <h2>${flor.nombre}</h2>
    <p class="nombre-cientifico">${flor.cientifico}</p>
    <div class="etiquetas">
      <span class="etiqueta">🗓 ${flor.temporada}</span>
      ${flor.colores.map((c) => `<span class="etiqueta">${c}</span>`).join("")}
    </div>

    <div class="seccion">
      <h3>💗 Significado</h3>
      <p>${flor.significado}</p>
    </div>
    <div class="seccion">
      <h3>💧 Cuidados</h3>
      <ul>${flor.cuidados.map((c) => `<li>${c}</li>`).join("")}</ul>
    </div>
    <div class="seccion">
      <h3>💐 En arreglos</h3>
      <ul>${flor.arreglos.map((a) => `<li>${a}</li>`).join("")}</ul>
    </div>
  `;

  // Cambiamos de pantalla: ocultamos inicio, mostramos ficha.
  pantallaInicio.hidden = true;
  pantallaFicha.hidden = false;
  window.scrollTo(0, 0);
}

// 4. Cuando ella toma una foto con la cámara...
entradaCamara.addEventListener("change", () => {
  const archivo = entradaCamara.files[0];
  if (!archivo) return; // si canceló, no hacemos nada
  const urlFoto = URL.createObjectURL(archivo); // convierte la foto en algo que <img> puede mostrar
  mostrarFicha(florEjemplo, urlFoto, true);
  entradaCamara.value = ""; // permite tomar otra foto después
});

// 5. Botón "Volver"
botonVolver.addEventListener("click", () => {
  pantallaFicha.hidden = true;
  pantallaInicio.hidden = false;
});
