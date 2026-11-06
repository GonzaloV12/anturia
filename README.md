# 🌸 Anturia
App web para identificar flores con la cámara del celular: nombre, significado, cuidados y uso en arreglos.

- `index.html` → estructura (las pantallas)
- `estilos.css` → acabados (colores, tipografía)
- `app.js` → lógica (botones, cámara, ficha y herbario guardado en el teléfono con IndexedDB)
- `worker/worker.js` → intermediario en Cloudflare: consulta a Claude (guarda la llave secreta) y guarda el herbario en la nube (archivero KV `HERBARIO`, protegido con `HERBARIO_CLAVE`)

Versión en línea: https://gonzalov12.github.io/anturia/
