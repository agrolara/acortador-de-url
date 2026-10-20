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
const JWT_SECRET = process.env.SESSION_SECRET || 'shlink-superadmin-secret-key-2026';

// Directorio de datos persistente para SQLite
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Inicializar SQLite nativo persistente
const DB_PATH = path.join(DATA_DIR, 'shlink.db');
const db = new DatabaseSync(DB_PATH);

// Configuración de tablas base
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
    referer TEXT,
    is_bot INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_short_urls_slug ON short_urls(slug);
  CREATE INDEX IF NOT EXISTS idx_visits_slug ON visits(slug);
`);

// Migraciones automáticas seguras para nuevas columnas avanzadas
function runMigrations() {
  const existingCols = db.prepare("PRAGMA table_info(short_urls)").all().map(c => c.name);

  const newColumns = [
    { name: 'ios_url', type: 'TEXT' },
    { name: 'android_url', type: 'TEXT' },
    { name: 'desktop_url', type: 'TEXT' },
    { name: 'expires_at', type: 'TEXT' },
    { name: 'max_visits', type: 'INTEGER' },
    { name: 'fallback_url', type: 'TEXT' },
    { name: 'link_password', type: 'TEXT' },
    { name: 'webhook_url', type: 'TEXT' },
    { name: 'utm_source', type: 'TEXT' },
    { name: 'utm_medium', type: 'TEXT' },
    { name: 'utm_campaign', type: 'TEXT' },
    { name: 'forward_query', type: 'INTEGER DEFAULT 1' },
    { name: 'qr_color_dark', type: "TEXT DEFAULT '#0f172a'" },
    { name: 'qr_color_light', type: "TEXT DEFAULT '#ffffff'" }
  ];

  for (const col of newColumns) {
    if (!existingCols.includes(col.name)) {
      try {
        db.exec(`ALTER TABLE short_urls ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ Migración ejecutada: Columna ${col.name} agregada a short_urls`);
      } catch (e) {
        console.error(`Error agregando columna ${col.name}:`, e.message);
      }
    }
  }

  // Verificar columna is_bot en visits
  const visitCols = db.prepare("PRAGMA table_info(visits)").all().map(c => c.name);
  if (!visitCols.includes('is_bot')) {
    try {
      db.exec("ALTER TABLE visits ADD COLUMN is_bot INTEGER DEFAULT 0");
    } catch {}
  }
}
runMigrations();

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
    const isNotExpired = Date.now() - parseInt(timestamp, 10) < 30 * 24 * 60 * 60 * 1000;
    return signature === expected && isNotExpired;
  } catch {
    return false;
  }
}

// Middleware de Autenticación
function requireAdmin(req, res, next) {
  const cookieToken = req.cookies.admin_session;
  if (verifyAuthToken(cookieToken)) {
    return next();
  }

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

// Detector de Dispositivo, SO y Filtro Anti-Bot
function parseUserAgent(ua = '') {
  const lower = ua.toLowerCase();
  let deviceType = 'Desktop';
  let os = 'Desconocido';
  let browser = 'Navegador Web';

  const isBot = /bot|crawler|spider|facebookexternalhit|whatsapp|telegrambot|twitterbot|slackbot|discordbot|applebot|bingbot|googlebot/i.test(lower);

  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(lower)) {
    deviceType = 'Móvil';
  } else if (/ipad|tablet|android(?!.*mobile)/i.test(lower)) {
    deviceType = 'Tablet';
  }

  if (/iphone|ipad|ipod/i.test(lower)) os = 'iOS';
  else if (/android/i.test(lower)) os = 'Android';
  else if (/windows/i.test(lower)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(lower)) os = 'macOS';
  else if (/linux/i.test(lower)) os = 'Linux';

  if (/edg\//i.test(lower)) browser = 'Edge';
  else if (/chrome|crios/i.test(lower)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(lower)) browser = 'Firefox';
  else if (/safari/i.test(lower) && !/chrome|crios/i.test(lower)) browser = 'Safari';

  return { deviceType, os, browser, isBot };
}

// Helper para disparar Webhook asíncrono
async function dispatchWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Shlink-Acortador-Webhook/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
  } catch (err) {
    console.error('Error enviando webhook a', url, err.message);
  }
}

// Helper para Settings globales
function getSetting(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
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
      maxAge: 30 * 24 * 60 * 60 * 1000,
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
// CONFIGURACIÓN GLOBAL (SETTINGS)
// -------------------------------------------------------------
app.get('/api/settings', requireAdmin, (req, res) => {
  const globalWebhook = getSetting('global_webhook_url', '');
  const filterBots = getSetting('filter_bots', '1');
  const defaultDomain = BASE_URL;
  res.json({ globalWebhook, filterBots: filterBots === '1', defaultDomain });
});

app.post('/api/settings', requireAdmin, (req, res) => {
  const { globalWebhook, filterBots } = req.body;
  if (globalWebhook !== undefined) setSetting('global_webhook_url', globalWebhook.trim());
  if (filterBots !== undefined) setSetting('filter_bots', filterBots ? '1' : '0');
  res.json({ success: true, message: 'Configuración guardada correctamente.' });
});

// -------------------------------------------------------------
// EXPORTACIÓN DE DATOS (CSV Y JSON)
// -------------------------------------------------------------
app.get('/api/export/json', requireAdmin, (req, res) => {
  const urls = db.prepare('SELECT * FROM short_urls ORDER BY created_at DESC').all();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="acortador-urls-backup.json"');
  res.json(urls);
});

app.get('/api/export/csv', requireAdmin, (req, res) => {
  const urls = db.prepare('SELECT * FROM short_urls ORDER BY created_at DESC').all();
  const headers = ['id', 'slug', 'short_url', 'long_url', 'title', 'visits_count', 'created_at', 'expires_at', 'max_visits', 'ios_url', 'android_url'];
  
  let csv = headers.join(',') + '\n';
  for (const u of urls) {
    const row = [
      u.id,
      `"${u.slug}"`,
      `"${BASE_URL}/${u.slug}"`,
      `"${(u.long_url || '').replace(/"/g, '""')}"`,
      `"${(u.title || '').replace(/"/g, '""')}"`,
      u.visits_count || 0,
      `"${u.created_at || ''}"`,
      `"${u.expires_at || ''}"`,
      u.max_visits || '',
      `"${(u.ios_url || '').replace(/"/g, '""')}"`,
      `"${(u.android_url || '').replace(/"/g, '""')}"`
    ];
    csv += row.join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="acortador-urls.csv"');
  res.send(csv);
});

// -------------------------------------------------------------
// ENDPOINTS DE GESTIÓN DE ENLACES (SUPERADMIN)
// -------------------------------------------------------------
app.get('/api/urls', requireAdmin, (req, res) => {
  try {
    const urls = db.prepare('SELECT * FROM short_urls ORDER BY created_at DESC').all();
    const formatted = urls.map(u => ({
      ...u,
      short_url: `${BASE_URL}/${u.slug}`,
      qr_png_url: `${BASE_URL}/${u.slug}/qr?format=png&size=1024`,
      qr_svg_url: `${BASE_URL}/${u.slug}/qr?format=svg`,
      tags: JSON.parse(u.tags || '[]'),
      is_expired: u.expires_at ? new Date() > new Date(u.expires_at) : false,
      is_limit_reached: u.max_visits ? u.visits_count >= u.max_visits : false,
      has_password: Boolean(u.link_password && u.link_password.trim() !== '')
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
    const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visits WHERE is_bot = 0').get().count;
    const topUrl = db.prepare('SELECT slug, title, visits_count FROM short_urls ORDER BY visits_count DESC LIMIT 1').get();

    const deviceStats = db.prepare(`
      SELECT device_type, COUNT(*) as count FROM visits WHERE is_bot = 0 GROUP BY device_type ORDER BY count DESC
    `).all();

    const osStats = db.prepare(`
      SELECT os, COUNT(*) as count FROM visits WHERE is_bot = 0 GROUP BY os ORDER BY count DESC LIMIT 5
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

// Crear nueva URL acortada con soporte para todas las opciones avanzadas opcionales
app.post('/api/urls', requireAdmin, async (req, res) => {
  try {
    let {
      long_url,
      slug,
      title,
      tags,
      // Opciones avanzadas opcionales
      ios_url,
      android_url,
      desktop_url,
      expires_at,
      max_visits,
      fallback_url,
      link_password,
      webhook_url,
      utm_source,
      utm_medium,
      utm_campaign,
      forward_query,
      qr_color_dark,
      qr_color_light
    } = req.body;

    if (!long_url) {
      return res.status(400).json({ error: 'La URL principal de destino es obligatoria.' });
    }

    if (!long_url.startsWith('http://') && !long_url.startsWith('https://')) {
      long_url = 'https://' + long_url;
    }

    if (!slug || slug.trim() === '') {
      slug = crypto.randomBytes(3).toString('hex');
    } else {
      slug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/--+/g, '-');
    }

    const existing = db.prepare('SELECT id FROM short_urls WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: `El slug '/${slug}' ya está en uso. Elige otro.` });
    }

    const titleValue = title && title.trim() ? title.trim() : slug;
    const tagsValue = JSON.stringify(Array.isArray(tags) ? tags : []);

    const insert = db.prepare(`
      INSERT INTO short_urls (
        slug, long_url, title, tags, visits_count,
        ios_url, android_url, desktop_url,
        expires_at, max_visits, fallback_url,
        link_password, webhook_url,
        utm_source, utm_medium, utm_campaign,
        forward_query, qr_color_dark, qr_color_light,
        created_at, updated_at
      )
      VALUES (
        ?, ?, ?, ?, 0,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);

    const info = insert.run(
      slug,
      long_url,
      titleValue,
      tagsValue,
      ios_url ? ios_url.trim() : null,
      android_url ? android_url.trim() : null,
      desktop_url ? desktop_url.trim() : null,
      expires_at ? expires_at : null,
      max_visits ? parseInt(max_visits, 10) : null,
      fallback_url ? fallback_url.trim() : null,
      link_password ? link_password.trim() : null,
      webhook_url ? webhook_url.trim() : null,
      utm_source ? utm_source.trim() : null,
      utm_medium ? utm_medium.trim() : null,
      utm_campaign ? utm_campaign.trim() : null,
      forward_query === false || forward_query === 0 ? 0 : 1,
      qr_color_dark ? qr_color_dark : '#0f172a',
      qr_color_light ? qr_color_light : '#ffffff'
    );

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

// Actualizar URL y cualquiera de sus configuraciones avanzadas (¡Edición dinámica total!)
app.put('/api/urls/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    let {
      long_url,
      title,
      ios_url,
      android_url,
      desktop_url,
      expires_at,
      max_visits,
      fallback_url,
      link_password,
      webhook_url,
      utm_source,
      utm_medium,
      utm_campaign,
      forward_query,
      qr_color_dark,
      qr_color_light
    } = req.body;

    if (!long_url) {
      return res.status(400).json({ error: 'La URL principal es obligatoria.' });
    }

    if (!long_url.startsWith('http://') && !long_url.startsWith('https://')) {
      long_url = 'https://' + long_url;
    }

    const update = db.prepare(`
      UPDATE short_urls 
      SET 
        long_url = ?, 
        title = COALESCE(?, title),
        ios_url = ?,
        android_url = ?,
        desktop_url = ?,
        expires_at = ?,
        max_visits = ?,
        fallback_url = ?,
        link_password = ?,
        webhook_url = ?,
        utm_source = ?,
        utm_medium = ?,
        utm_campaign = ?,
        forward_query = ?,
        qr_color_dark = COALESCE(?, qr_color_dark),
        qr_color_light = COALESCE(?, qr_color_light),
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    const result = update.run(
      long_url,
      title || null,
      ios_url ? ios_url.trim() : null,
      android_url ? android_url.trim() : null,
      desktop_url ? desktop_url.trim() : null,
      expires_at || null,
      max_visits ? parseInt(max_visits, 10) : null,
      fallback_url ? fallback_url.trim() : null,
      link_password !== undefined ? link_password.trim() : null,
      webhook_url ? webhook_url.trim() : null,
      utm_source ? utm_source.trim() : null,
      utm_medium ? utm_medium.trim() : null,
      utm_campaign ? utm_campaign.trim() : null,
      forward_query === false || forward_query === 0 ? 0 : 1,
      qr_color_dark || null,
      qr_color_light || null,
      id
    );

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
// DESBLOQUEO DE ENLACES CON CONTRASEÑA
// -------------------------------------------------------------
app.post('/unlock/:slug', (req, res) => {
  const { slug } = req.params;
  const { password } = req.body;

  const record = db.prepare('SELECT link_password, long_url FROM short_urls WHERE slug = ?').get(slug);
  if (!record || !record.link_password) {
    return res.redirect(`/${slug}`);
  }

  if (password === record.link_password) {
    // Cookie de desbloqueo temporal por 24 horas para este slug
    const unlockKey = crypto.createHmac('sha256', JWT_SECRET).update(`unlocked:${slug}`).digest('hex');
    res.cookie(`unlocked_${slug}`, unlockKey, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    return res.redirect(`/${slug}`);
  }

  // Clave incorrecta -> renderizar pantalla de error
  res.send(`
    <!DOCTYPE html>
    <html lang="es" class="dark">
    <head>
      <meta charset="UTF-8">
      <title>Clave Incorrecta</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-6 text-center shadow-2xl">
        <div class="text-rose-400 text-3xl mb-2">✕</div>
        <h2 class="text-lg font-bold text-white mb-2">Clave Incorrecta</h2>
        <p class="text-xs text-slate-400 mb-6">La contraseña ingresada no es válida para acceder a este enlace.</p>
        <a href="/${slug}" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold">Intentar de nuevo</a>
      </div>
    </body>
    </html>
  `);
});

// -------------------------------------------------------------
// GENERADOR NATIVO DE QR (FORMATOS PNG HD Y SVG VECTORIAL)
// Permite colores personalizados y tamaños
// -------------------------------------------------------------
app.get('/:slug/qr', async (req, res) => {
  try {
    const { slug } = req.params;
    const format = (req.query.format || 'png').toLowerCase();
    const size = parseInt(req.query.size, 10) || 600;
    const margin = parseInt(req.query.margin, 10) || 2;

    const record = db.prepare('SELECT qr_color_dark, qr_color_light FROM short_urls WHERE slug = ?').get(slug);
    const colorDark = req.query.dark || (record ? record.qr_color_dark : null) || '#0f172a';
    const colorLight = req.query.light || (record ? record.qr_color_light : null) || '#ffffff';

    const shortUrl = `${BASE_URL}/${slug}`;

    if (format === 'svg') {
      const svg = await QRCode.toString(shortUrl, {
        type: 'svg',
        margin: margin,
        color: {
          dark: colorDark,
          light: colorLight
        }
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `inline; filename="qr-${slug}.svg"`);
      return res.send(svg);
    }

    const pngBuffer = await QRCode.toBuffer(shortUrl, {
      type: 'png',
      width: size,
      margin: margin,
      errorCorrectionLevel: 'H',
      color: {
        dark: colorDark,
        light: colorLight
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
// Con Smart Routing: iOS/Android, Expiración, Límite, Password, UTMs y Webhooks
// -------------------------------------------------------------
app.get('/:slug', async (req, res, next) => {
  const { slug } = req.params;

  if (slug === 'favicon.ico' || slug === 'robots.txt' || slug === 'health') {
    return next();
  }

  try {
    const record = db.prepare('SELECT * FROM short_urls WHERE slug = ?').get(slug);

    if (!record) {
      return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }

    // 1. Verificación de Vencimiento por Fecha
    const now = new Date();
    if (record.expires_at && now > new Date(record.expires_at)) {
      if (record.fallback_url) {
        return res.redirect(302, record.fallback_url);
      }
      return res.send(renderMessagePage('Promoción o Enlace Expirado', 'Este enlace o código QR ya no está disponible porque ha llegado a su fecha límite.', '⏳'));
    }

    // 2. Verificación de Límite de Clics/Escaneos
    if (record.max_visits && record.visits_count >= record.max_visits) {
      if (record.fallback_url) {
        return res.redirect(302, record.fallback_url);
      }
      return res.send(renderMessagePage('Límite de Usos Alcanzado', 'Este código QR ha alcanzado el número máximo de escaneos permitidos.', '🛑'));
    }

    // 3. Verificación de Protección por Contraseña
    if (record.link_password && record.link_password.trim() !== '') {
      const expectedUnlockKey = crypto.createHmac('sha256', JWT_SECRET).update(`unlocked:${slug}`).digest('hex');
      const userUnlockCookie = req.cookies[`unlocked_${slug}`];

      if (userUnlockCookie !== expectedUnlockKey) {
        return res.send(renderPasswordPage(slug, record.title));
      }
    }

    // 4. Analítica y Filtro Anti-Bot
    const ua = req.headers['user-agent'] || '';
    const referer = req.headers['referer'] || req.headers['referrer'] || '';
    const { deviceType, os, browser, isBot } = parseUserAgent(ua);
    const filterBotsSetting = getSetting('filter_bots', '1') === '1';

    // Registrar visita solo si no es bot o si la configuración permite bots
    const countThisVisit = !isBot || !filterBotsSetting;
    if (countThisVisit) {
      try {
        db.prepare(`
          INSERT INTO visits (slug, user_agent, device_type, os, browser, referer, is_bot)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(slug, ua, deviceType, os, browser, referer, isBot ? 1 : 0);

        db.prepare('UPDATE short_urls SET visits_count = visits_count + 1 WHERE id = ?').run(record.id);
      } catch (e) {
        console.error('Error registrando analítica:', e);
      }

      // 5. Disparar Webhook en Segundo Plano (Alertas en tiempo real a WhatsApp/Telegram/Discord)
      const targetWebhook = record.webhook_url || getSetting('global_webhook_url', '');
      if (targetWebhook) {
        dispatchWebhook(targetWebhook, {
          event: 'qr_scanned',
          slug: slug,
          title: record.title || slug,
          short_url: `${BASE_URL}/${slug}`,
          destination: record.long_url,
          visited_at: new Date().toISOString(),
          device_type: deviceType,
          os: os,
          browser: browser,
          referer: referer || 'Directo (Escaneo QR)',
          total_scans: (record.visits_count || 0) + 1
        });
      }
    }

    // 6. Enrutamiento Inteligente por Dispositivo (Smart OS Routing)
    let destination = record.long_url;
    if (os === 'iOS' && record.ios_url) {
      destination = record.ios_url;
    } else if (os === 'Android' && record.android_url) {
      destination = record.android_url;
    } else if (deviceType === 'Desktop' && record.desktop_url) {
      destination = record.desktop_url;
    }

    // 7. Inyección Automática de Parámetros UTM para Marketing
    try {
      const urlObj = new URL(destination);
      if (record.utm_source) urlObj.searchParams.set('utm_source', record.utm_source);
      if (record.utm_medium) urlObj.searchParams.set('utm_medium', record.utm_medium);
      if (record.utm_campaign) urlObj.searchParams.set('utm_campaign', record.utm_campaign);

      // Reenviar parámetros entrantes si está activo
      if (record.forward_query !== 0) {
        for (const [key, val] of Object.entries(req.query)) {
          if (!urlObj.searchParams.has(key)) {
            urlObj.searchParams.set(key, val);
          }
        }
      }
      destination = urlObj.toString();
    } catch {
      // Si la URL no fuera parseable por URL(), se usa directo
    }

    // 8. Redirección HTTP 302 Inmediata
    res.redirect(302, destination);
  } catch (error) {
    console.error('Error en redirección:', error);
    res.redirect('/');
  }
});

// Renderizador de Pantalla de Contraseña para Enlaces Protegidos
function renderPasswordPage(slug, title) {
  return `
    <!DOCTYPE html>
    <html lang="es" class="dark">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Enlace Protegido | ${title || slug}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>body { font-family: 'Plus Jakarta Sans', sans-serif; }</style>
    </head>
    <body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-xl">
        <div class="w-16 h-16 mx-auto mb-6 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center text-3xl font-bold">
          🔒
        </div>
        <h1 class="text-xl font-bold text-white mb-1">Enlace Protegido</h1>
        <p class="text-xs text-slate-400 mb-6">Ingresa la contraseña para acceder al contenido de <b>${title || slug}</b></p>
        
        <form method="POST" action="/unlock/${slug}" class="space-y-4">
          <input 
            type="password" 
            name="password" 
            required 
            autofocus 
            placeholder="Introduce la contraseña"
            class="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white text-center text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <button 
            type="submit" 
            class="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 text-slate-950 font-bold rounded-xl text-xs transition"
          >
            Acceder al Enlace
          </button>
        </form>
      </div>
    </body>
    </html>
  `;
}

// Renderizador de Mensajes (Expirado o Límite)
function renderMessagePage(title, message, icon) {
  return `
    <!DOCTYPE html>
    <html lang="es" class="dark">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl">
        <div class="text-4xl mb-4">${icon}</div>
        <h1 class="text-xl font-bold text-white mb-2">${title}</h1>
        <p class="text-xs text-slate-400 mb-6 leading-relaxed">${message}</p>
        <a href="/" class="inline-flex px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl transition">
          Ir al Inicio
        </a>
      </div>
    </body>
    </html>
  `;
}

// Healthcheck
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Iniciar Servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Acortador de URL & Shlink Engine activo en puerto ${PORT}`);
  console.log(`🌐 Dominio: ${BASE_URL}`);
  console.log(`📁 Base de Datos: ${DB_PATH}`);
});
