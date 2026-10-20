import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import QRCode from 'qrcode';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Agro1280@';
const BASE_URL = process.env.BASE_URL || 'https://urlshort.agrolara.dedyn.io';
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Asegurar directorio de datos para persistencia
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicializar SQLite nativo persistente
const DB_PATH = path.join(DATA_DIR, 'shlink.db');
const db = new DatabaseSync(DB_PATH);

// Configuración de tablas e índices
db.exec(`
  PRAGMA journal_mode = WAL;
  
  CREATE TABLE IF NOT EXISTS short_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    long_url TEXT NOT NULL,
    title TEXT,
    tags TEXT DEFAULT '[]',
    visits_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    device_type TEXT,
    os TEXT,
    browser TEXT,
    referer TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_short_urls_slug ON short_urls(slug);
  CREATE INDEX IF NOT EXISTS idx_visits_slug ON visits(slug);
`);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers de Token y Sesión Segura
function generateAuthToken() {
  const payload = `superadmin:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
}

function verifyAuthToken(token) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const [user, timestamp, signature] = parts;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${user}:${timestamp}`).digest('hex');
    // Válido por 30 días
    const isNotExpired = Date.now() - parseInt(timestamp, 10) < 30 * 24 * 60 * 60 * 1000;
    return signature === expected && isNotExpired;
  } catch {
    return false;
  }
}

// Middleware de Autenticación
function requireAdmin(req, res, next) {
  // Verificar token en cookie
  const cookieToken = req.cookies.admin_session;
  if (verifyAuthToken(cookieToken)) {
    return next();
  }

  // Verificar Authorization Bearer o X-Api-Key (compatible con Shlink API)
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  if (apiKey === ADMIN_PASSWORD) {
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerKey = authHeader.replace('Bearer ', '').trim();
    if (bearerKey === ADMIN_PASSWORD || verifyAuthToken(bearerKey)) {
      return next();
    }
  }

  return res.status(401).json({ error: 'No autorizado. Se requiere clave de superadministrador.' });
}

// Detector de Dispositivo y SO
function parseUserAgent(ua = '') {
  ua = ua.toLowerCase();
  let deviceType = 'Desktop';
  let os = 'Desconocido';
  let browser = 'Navegador Web';

  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua)) {
    deviceType = 'Móvil';
  } else if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) {
    deviceType = 'Tablet';
  }

  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return { deviceType, os, browser };
}

// -------------------------------------------------------------
// RUTAS DE AUTENTICACIÓN
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = generateAuthToken();
    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
      sameSite: 'lax',
    });
    return res.json({ success: true, message: 'Autenticación exitosa como Superadministrador' });
  }
  return res.status(401).json({ success: false, error: 'Clave incorrecta.' });
});

app.get('/api/auth/check', (req, res) => {
  const isAuth = verifyAuthToken(req.cookies.admin_session);
  res.json({ authenticated: isAuth });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Sesión cerrada' });
});

// -------------------------------------------------------------
// ENDPOINTS DE GESTIÓN DE ENLACES (SUPERADMIN)
// -------------------------------------------------------------

// Listar todas las URLs con estadísticas
app.get('/api/urls', requireAdmin, (req, res) => {
  try {
    const urls = db.prepare('SELECT * FROM short_urls ORDER BY created_at DESC').all();
    const formatted = urls.map(u => ({
      ...u,
      short_url: `${BASE_URL}/${u.slug}`,
      qr_png_url: `${BASE_URL}/${u.slug}/qr?format=png&size=1024`,
      qr_svg_url: `${BASE_URL}/${u.slug}/qr?format=svg`,
      tags: JSON.parse(u.tags || '[]')
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Error al listar URLs:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Resumen de analíticas globales
app.get('/api/stats', requireAdmin, (req, res) => {
  try {
    const totalUrls = db.prepare('SELECT COUNT(*) as count FROM short_urls').get().count;
    const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visits').get().count;
    const topUrl = db.prepare('SELECT slug, title, visits_count FROM short_urls ORDER BY visits_count DESC LIMIT 1').get();
    
    const deviceStats = db.prepare(`
      SELECT device_type, COUNT(*) as count FROM visits GROUP BY device_type ORDER BY count DESC
    `).all();

    const osStats = db.prepare(`
      SELECT os, COUNT(*) as count FROM visits GROUP BY os ORDER BY count DESC LIMIT 5
    `).all();

    res.json({
      totalUrls,
      totalVisits,
      topUrl: topUrl || null,
      deviceStats,
      osStats
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Crear nueva URL acortada
app.post('/api/urls', requireAdmin, async (req, res) => {
  try {
    let { long_url, slug, title, tags } = req.body;

    if (!long_url) {
      return res.status(400).json({ error: 'La URL larga es obligatoria.' });
    }

    if (!long_url.startsWith('http://') && !long_url.startsWith('https://')) {
      long_url = 'https://' + long_url;
    }

    // Si no se proporcionó slug, generar uno aleatorio y limpio (5 caracteres)
    if (!slug || slug.trim() === '') {
      slug = crypto.randomBytes(3).toString('hex');
    } else {
      slug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/--+/g, '-');
    }

    // Verificar si ya existe
    const existing = db.prepare('SELECT id FROM short_urls WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: `El slug '${slug}' ya está en uso. Elige otro.` });
    }

    const titleValue = title ? title.trim() : slug;
    const tagsValue = JSON.stringify(Array.isArray(tags) ? tags : []);

    const insert = db.prepare(`
      INSERT INTO short_urls (slug, long_url, title, tags, visits_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const info = insert.run(slug, long_url, titleValue, tagsValue);

    const created = db.prepare('SELECT * FROM short_urls WHERE id = ?').get(info.lastInsertRowid);

    res.status(201).json({
      ...created,
      short_url: `${BASE_URL}/${slug}`,
      qr_png_url: `${BASE_URL}/${slug}/qr?format=png&size=1024`,
      qr_svg_url: `${BASE_URL}/${slug}/qr?format=svg`,
      tags: JSON.parse(created.tags || '[]')
    });
  } catch (error) {
    console.error('Error al crear URL:', error);
    res.status(500).json({ error: 'Error al acortar la URL.' });
  }
});

// Actualizar URL de destino (¡Edición en caliente para QR dinámicos!)
app.put('/api/urls/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    let { long_url, title } = req.body;

    if (!long_url) {
      return res.status(400).json({ error: 'La nueva URL es obligatoria.' });
    }

    if (!long_url.startsWith('http://') && !long_url.startsWith('https://')) {
      long_url = 'https://' + long_url;
    }

    const update = db.prepare(`
      UPDATE short_urls 
      SET long_url = ?, title = COALESCE(?, title), updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    const result = update.run(long_url, title || null, id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Enlace no encontrado.' });
    }

    const updated = db.prepare('SELECT * FROM short_urls WHERE id = ?').get(id);
    res.json({
      ...updated,
      short_url: `${BASE_URL}/${updated.slug}`,
      qr_png_url: `${BASE_URL}/${updated.slug}/qr?format=png&size=1024`,
      qr_svg_url: `${BASE_URL}/${updated.slug}/qr?format=svg`
    });
  } catch (error) {
    console.error('Error al actualizar enlace:', error);
    res.status(500).json({ error: 'Error al actualizar.' });
  }
});

// Eliminar URL
app.delete('/api/urls/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const url = db.prepare('SELECT slug FROM short_urls WHERE id = ?').get(id);
    if (!url) {
      return res.status(404).json({ error: 'Enlace no encontrado.' });
    }

    db.prepare('DELETE FROM visits WHERE slug = ?').run(url.slug);
    db.prepare('DELETE FROM short_urls WHERE id = ?').run(id);

    res.json({ success: true, message: 'Enlace eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar:', error);
    res.status(500).json({ error: 'Error al eliminar.' });
  }
});

// -------------------------------------------------------------
// COMPATIBILIDAD API REST DE SHLINK (/rest/v3/short-urls)
// Permite que Linktree copia u otras herramientas llamen a la API
// -------------------------------------------------------------
app.post('/rest/v3/short-urls', requireAdmin, async (req, res) => {
  try {
    let { longUrl, customSlug, tags, title } = req.body;
    if (!longUrl) return res.status(400).json({ error: 'longUrl es requerido' });

    let slug = customSlug;
    if (!slug || slug.trim() === '') {
      slug = crypto.randomBytes(3).toString('hex');
    } else {
      slug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/--+/g, '-');
    }

    // Si ya existe devolver el existente o error
    const existing = db.prepare('SELECT * FROM short_urls WHERE slug = ?').get(slug);
    if (existing) {
      return res.json({
        shortUrl: `${BASE_URL}/${slug}`,
        shortCode: slug,
        longUrl: existing.long_url
      });
    }

    db.prepare(`
      INSERT INTO short_urls (slug, long_url, title, tags, visits_count)
      VALUES (?, ?, ?, ?, 0)
    `).run(slug, longUrl, title || slug, JSON.stringify(tags || []));

    res.status(200).json({
      shortUrl: `${BASE_URL}/${slug}`,
      shortCode: slug,
      longUrl: longUrl,
      qrCode: `${BASE_URL}/${slug}/qr?format=png&size=1024`
    });
  } catch (err) {
    console.error('Error en API Shlink:', err);
    res.status(500).json({ error: 'Error al procesar solicitud' });
  }
});

// -------------------------------------------------------------
// GENERADOR NATIVO DE QR (FORMATOS PNG HD Y SVG VECTORIAL)
// Idéntico al endpoint oficial de Shlink: /:slug/qr
// -------------------------------------------------------------
app.get('/:slug/qr', async (req, res) => {
  try {
    const { slug } = req.params;
    const format = (req.query.format || 'png').toLowerCase();
    const size = parseInt(req.query.size, 10) || 600;
    const margin = parseInt(req.query.margin, 10) || 2;

    const shortUrl = `${BASE_URL}/${slug}`;

    if (format === 'svg') {
      const svg = await QRCode.toString(shortUrl, {
        type: 'svg',
        margin: margin,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `inline; filename="qr-${slug}.svg"`);
      return res.send(svg);
    }

    // Formato PNG (Por defecto en alta resolución)
    const pngBuffer = await QRCode.toBuffer(shortUrl, {
      type: 'png',
      width: size,
      margin: margin,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${slug}.png"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(pngBuffer);
  } catch (error) {
    console.error('Error al generar código QR:', error);
    res.status(500).send('Error al generar código QR');
  }
});

// -------------------------------------------------------------
// REDIRECCIÓN DINÁMICA ULTRA-RÁPIDA (GET /:slug)
// -------------------------------------------------------------
app.get('/:slug', (req, res, next) => {
  const { slug } = req.params;

  // Evitar interceptar archivos del sistema
  if (slug === 'favicon.ico' || slug === 'robots.txt' || slug === 'health') {
    return next();
  }

  try {
    const record = db.prepare('SELECT id, long_url, visits_count FROM short_urls WHERE slug = ?').get(slug);

    if (!record) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }

    // Registrar analítica de visita en segundo plano (asíncrono, no bloquea redirección)
    const ua = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    const { deviceType, os, browser } = parseUserAgent(ua);

    try {
      db.prepare(`
        INSERT INTO visits (slug, user_agent, device_type, os, browser, referer)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(slug, ua, deviceType, os, browser, referer);

      db.prepare('UPDATE short_urls SET visits_count = visits_count + 1 WHERE id = ?').run(record.id);
    } catch (e) {
      console.error('Error guardando visita:', e);
    }

    // Redirección inmediata 302 Found
    res.redirect(302, record.long_url);
  } catch (error) {
    console.error('Error en redirección:', error);
    res.redirect('/');
  }
});

// Healthcheck para Coolify / Docker
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Iniciar Servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Acortador de URL y Servidor Shlink activo en puerto ${PORT}`);
  console.log(`🌐 Dominio configurado: ${BASE_URL}`);
  console.log(`📁 Base de Datos SQLite: ${DB_PATH}`);
});
