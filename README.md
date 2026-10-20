# Acortador de URL & Motor Shlink Compatible 🚀

Plataforma en la nube de acortamiento de URLs, redirección dinámica (302) y generador de códigos QR vectoriales (SVG) y en alta resolución (PNG 1024px) optimizados para impresión física y tarjetas de presentación digitales (estilo Linktree).

---

## ⚡ Características Principales

1. **Autenticación Superadministrador**:
   - Acceso con clave maestra directa (`Agro1280@`).
   - Sesión segura con cookies HTTP-Only y token HMAC SHA256.

2. **Códigos QR Dinámicos para Impresión**:
   - Generación instantánea en dos formatos:
     - **PNG HD (1024x1024 px)** con corrección de errores nivel H.
     - **SVG Vectorial** para imprentas, corte láser y señalética sin pixelación.
   - **Edición en Caliente:** Si imprimes 500 tarjetas con un código QR y luego cambias la URL de destino, puedes cambiar el destino en el panel con 1 clic sin volver a imprimir el material físico.

3. **Compatibilidad con Shlink API v3**:
   - Endpoint: `POST /rest/v3/short-urls`
   - Permite que tu aplicación `LINKTREE COPIA` o cualquier otra herramienta cree enlaces cortos enviando la clave en la cabecera `X-Api-Key`.

4. **Endpoint Nativo de QR**:
   - Formato PNG: `https://urlshort.agrolara.dedyn.io/:slug/qr?size=1024&format=png`
   - Formato SVG: `https://urlshort.agrolara.dedyn.io/:slug/qr?format=svg`

5. **Base de Datos SQLite Persistente**:
   - Utiliza el motor nativo `node:sqlite` de alto rendimiento sin dependencias externas.
   - Persistencia en volumen `/app/data`.

6. **Analíticas en Tiempo Real**:
   - Contador de clics y escaneos físicos.
   - Detección de dispositivo (Móvil, Tablet, Desktop) y sistema operativo (iOS, Android, Windows, etc.).
