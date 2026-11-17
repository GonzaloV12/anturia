# 🌸 Anturia
App web para identificar flores con la cámara del celular: nombre, significado, cuidados y uso en arreglos.

- `index.html` → estructura (las pantallas)
- `estilos.css` → acabados (colores, tipografía)
- `app.js` → lógica (cámara/galería, ficha, herbario en el teléfono con IndexedDB y asistente de ramos)
- `worker/worker.js` → intermediario en Cloudflare: consulta a Claude (guarda la llave secreta) y guarda el herbario en la nube (archivero KV `HERBARIO`, protegido con `HERBARIO_CLAVE`)

Versión en línea: https://gonzalov12.github.io/anturia/
