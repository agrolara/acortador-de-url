// Estado Global
let allUrls = [];
let activeUrl = null;

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) lucide.createIcons();
  await checkAuth();
  setupEventListeners();
});

function refreshIcons() {
  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 50);
  }
}

// -------------------------------------------------------------
// AUTENTICACIÓN
// -------------------------------------------------------------
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (data.authenticated) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (err) {
    console.error('Error al verificar sesión:', err);
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('mainDashboard').classList.add('hidden');
  document.getElementById('passwordInput').focus();
  refreshIcons();
}

function showDashboard() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('mainDashboard').classList.remove('hidden');
  document.getElementById('domainBadge').textContent = window.location.host;
  loadUrls();
  loadStats();
  refreshIcons();
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------
function setupEventListeners() {
  // Login
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('passwordInput').value;
    const errorEl = document.getElementById('loginError');
    errorEl.classList.add('hidden');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('¡Bienvenido Superadministrador!', 'success');
        showDashboard();
      } else {
        errorEl.textContent = data.error || 'Clave incorrecta.';
        errorEl.classList.remove('hidden');
      }
    } catch {
      errorEl.textContent = 'Error de conexión con el servidor.';
      errorEl.classList.remove('hidden');
    }
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    showToast('Sesión finalizada', 'info');
    showLogin();
  });

  // Slug Aleatorio
  document.getElementById('randomSlugBtn').addEventListener('click', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let rand = '';
    for (let i = 0; i < 5; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('slugInput').value = rand;
  });

  // Toggle Opciones Avanzadas
  const toggleBtn = document.getElementById('toggleAdvancedBtn');
  const container = document.getElementById('advancedContainer');
  const icon = document.getElementById('advancedIcon');

  toggleBtn.addEventListener('click', () => {
    container.classList.toggle('hidden');
    icon.classList.toggle('rotate-180');
  });

  // Crear Enlace
  document.getElementById('createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      long_url: document.getElementById('longUrlInput').value.trim(),
      slug: document.getElementById('slugInput').value.trim(),
      title: document.getElementById('titleInput').value.trim(),
      // Opciones avanzadas opcionales
      ios_url: document.getElementById('iosUrlInput').value.trim(),
      android_url: document.getElementById('androidUrlInput').value.trim(),
      expires_at: document.getElementById('expiresAtInput').value || null,
      max_visits: document.getElementById('maxVisitsInput').value || null,
      fallback_url: document.getElementById('fallbackUrlInput').value.trim(),
      link_password: document.getElementById('linkPasswordInput').value.trim(),
      webhook_url: document.getElementById('webhookUrlInput').value.trim(),
      utm_source: document.getElementById('utmSourceInput').value.trim(),
      utm_medium: document.getElementById('utmMediumInput').value.trim(),
      utm_campaign: document.getElementById('utmCampaignInput').value.trim(),
      qr_color_dark: document.getElementById('qrColorDarkInput').value,
      qr_color_light: document.getElementById('qrColorLightInput').value
    };

    try {
      const res = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok) {
        showToast(`Enlace /${data.slug} creado con éxito`, 'success');
        document.getElementById('createForm').reset();
        container.classList.add('hidden');
        icon.classList.remove('rotate-180');
        await loadUrls();
        await loadStats();
        selectActiveUrl(data);
      } else {
        showToast(data.error || 'Error al crear enlace', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error de red al crear enlace', 'error');
    }
  });

  // Copiar Enlace
  document.getElementById('copyUrlBtn').addEventListener('click', () => {
    if (!activeUrl) return;
    navigator.clipboard.writeText(activeUrl.short_url);
    showToast('¡Enlace corto copiado al portapapeles!', 'success');
  });

  // Buscador
  document.getElementById('searchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allUrls.filter(u => 
      u.slug.toLowerCase().includes(term) || 
      (u.title && u.title.toLowerCase().includes(term)) ||
      u.long_url.toLowerCase().includes(term)
    );
    renderTable(filtered);
  });

  // Modal Editar
  document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('cancelEditModalBtn').addEventListener('click', closeEditModal);
  document.getElementById('editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editIdInput').value;
    const payload = {
      title: document.getElementById('editTitleInput').value.trim(),
      long_url: document.getElementById('editLongUrlInput').value.trim(),
      ios_url: document.getElementById('editIosUrlInput').value.trim(),
      android_url: document.getElementById('editAndroidUrlInput').value.trim(),
      expires_at: document.getElementById('editExpiresAtInput').value || null,
      max_visits: document.getElementById('editMaxVisitsInput').value || null,
      fallback_url: document.getElementById('editFallbackUrlInput').value.trim(),
      link_password: document.getElementById('editLinkPasswordInput').value.trim(),
      webhook_url: document.getElementById('editWebhookUrlInput').value.trim()
    };

    try {
      const res = await fetch(`/api/urls/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('¡Destino y reglas actualizados!', 'success');
        closeEditModal();
        await loadUrls();
        if (activeUrl && activeUrl.id == id) {
          selectActiveUrl(data);
        }
      } else {
        showToast(data.error || 'Error al actualizar', 'error');
      }
    } catch {
      showToast('Error al conectar con el servidor', 'error');
    }
  });

  // Modal Ajustes Globales
  document.getElementById('openSettingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('closeSettingsModalBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('cancelSettingsModalBtn').addEventListener('click', closeSettingsModal);
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const globalWebhook = document.getElementById('globalWebhookInput').value.trim();
    const filterBots = document.getElementById('filterBotsCheckbox').checked;

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ globalWebhook, filterBots })
      });
      if (res.ok) {
        showToast('Ajustes globales guardados', 'success');
        closeSettingsModal();
      } else {
        showToast('Error guardando ajustes', 'error');
      }
    } catch {
      showToast('Error de conexión', 'error');
    }
  });

  // Inicializar Estudio de Cartel para Mostrador
  setupStandeeDesigner();
}

// -------------------------------------------------------------
// CARGA DE DATOS
// -------------------------------------------------------------
async function loadUrls() {
  try {
    const res = await fetch('/api/urls');
    if (res.status === 401) return showLogin();
    allUrls = await res.json();
    renderTable(allUrls);

    if (!activeUrl && allUrls.length > 0) {
      selectActiveUrl(allUrls[0]);
    } else if (allUrls.length === 0) {
      renderEmptyQr();
    }
  } catch (err) {
    console.error('Error cargando URLs:', err);
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('statTotalUrls').textContent = data.totalUrls || 0;
    document.getElementById('statTotalVisits').textContent = data.totalVisits || 0;
    
    if (data.topUrl) {
      document.getElementById('statTopSlug').textContent = `/${data.topUrl.slug} (${data.topUrl.visits_count})`;
    } else {
      document.getElementById('statTopSlug').textContent = '--';
    }

    if (data.deviceStats && data.deviceStats.length > 0) {
      const topDev = data.deviceStats[0];
      document.getElementById('statTopDevice').textContent = `${topDev.device_type} (${topDev.count})`;
    } else {
      document.getElementById('statTopDevice').textContent = 'Esperando escaneos';
    }
  } catch (err) {
    console.error('Error cargando stats:', err);
  }
}

// -------------------------------------------------------------
// RENDERIZADO DE TABLA Y QR
// -------------------------------------------------------------
function renderTable(urls) {
  const tbody = document.getElementById('urlsTableBody');
  if (urls.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="py-8 text-center text-slate-500">
          No hay enlaces creados todavía. ¡Crea el primero arriba!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = urls.map(u => {
    // Badges de características avanzadas activas
    let badges = [];
    if (u.is_expired) {
      badges.push('<span class="bg-rose-950 text-rose-400 border border-rose-800 px-1.5 py-0.5 rounded text-[10px]">Caducado</span>');
    } else if (u.is_limit_reached) {
      badges.push('<span class="bg-rose-950 text-rose-400 border border-rose-800 px-1.5 py-0.5 rounded text-[10px]">Límite Lleno</span>');
    }

    if (u.ios_url || u.android_url) {
      badges.push('<span class="bg-cyan-950 text-cyan-400 border border-cyan-800 px-1.5 py-0.5 rounded text-[10px]">📱 Smart OS</span>');
    }
    if (u.has_password) {
      badges.push('<span class="bg-amber-950 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded text-[10px]">🔒 Con Clave</span>');
    }
    if (u.webhook_url) {
      badges.push('<span class="bg-purple-950 text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded text-[10px]">🔔 Webhook</span>');
    }
    if (u.expires_at && !u.is_expired) {
      badges.push('<span class="bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded text-[10px]">⏳ Temporal</span>');
    }

    return `
      <tr class="hover:bg-slate-900/50 transition">
        <td class="py-3 px-4 mono text-cyan-300 font-semibold">
          <a href="${u.short_url}" target="_blank" class="hover:underline flex items-center gap-1">
            /${u.slug}
            <i data-lucide="external-link" class="w-3 h-3 text-slate-500"></i>
          </a>
        </td>
        <td class="py-3 px-4">
          <div class="text-white font-medium">${escapeHtml(u.title || u.slug)}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">${badges.join(' ')}</div>
        </td>
        <td class="py-3 px-4 max-w-xs truncate text-slate-400 mono">
          <span title="${escapeHtml(u.long_url)}">${escapeHtml(u.long_url)}</span>
        </td>
        <td class="py-3 px-4 text-center mono font-bold text-emerald-400">
          ${u.visits_count}
        </td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="selectUrlById(${u.id})" title="Ver QR Dinámico" class="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-950/60 rounded-lg border border-cyan-800/40 transition">
              <i data-lucide="qr-code" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="openEditModal(${u.id})" title="Configuración y Destino" class="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-950/60 rounded-lg border border-amber-800/40 transition">
              <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="deleteUrl(${u.id})" title="Eliminar" class="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/60 rounded-lg border border-rose-800/40 transition">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  refreshIcons();
}

function selectActiveUrl(url) {
  activeUrl = url;
  const qrImg = document.getElementById('qrPreviewImg');
  const shortText = document.getElementById('qrShortUrlText');
  const pngBtn = document.getElementById('downloadPngBtn');
  const svgBtn = document.getElementById('downloadSvgBtn');
  const testLink = document.getElementById('testUrlLink');
  const wrapper = document.getElementById('qrPreviewWrapper');

  // Aplicar colores personalizados si existen
  const lightColor = url.qr_color_light || '#ffffff';
  wrapper.style.backgroundColor = lightColor;

  qrImg.src = url.qr_png_url;
  shortText.textContent = url.short_url;
  testLink.href = url.short_url;

  pngBtn.href = url.qr_png_url;
  pngBtn.download = `qr-${url.slug}.png`;

  svgBtn.href = url.qr_svg_url;
  svgBtn.download = `qr-${url.slug}.svg`;

  // Actualizar también inmediatamente el código QR en el Cartel de Mostrador (Standee)
  const standeeQr = document.getElementById('standeeQrImg');
  const standeeSlugBadge = document.getElementById('standeeSelectedSlugBadge');
  if (standeeQr) standeeQr.src = url.qr_png_url;
  if (standeeSlugBadge) standeeSlugBadge.textContent = `/${url.slug}`;

  refreshIcons();
}

function renderEmptyQr() {
  document.getElementById('qrShortUrlText').textContent = 'Crea un enlace para generar el QR';
  const placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M17 7h.01M17 12h.01M17 17h.01"/></svg>';
  const qrImg = document.getElementById('qrPreviewImg');
  const standeeQr = document.getElementById('standeeQrImg');
  if (qrImg) qrImg.src = placeholder;
  if (standeeQr) standeeQr.src = placeholder;
}

window.selectUrlById = function(id) {
  const found = allUrls.find(u => u.id === id);
  if (found) {
    selectActiveUrl(found);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`Mostrando QR de /${found.slug}`, 'info');
  }
};

// -------------------------------------------------------------
// EDICIÓN EN CALIENTE
// -------------------------------------------------------------
window.openEditModal = function(id) {
  const found = allUrls.find(u => u.id === id);
  if (!found) return;

  document.getElementById('editIdInput').value = found.id;
  document.getElementById('editTitleInput').value = found.title || found.slug;
  document.getElementById('editLongUrlInput').value = found.long_url;
  document.getElementById('editIosUrlInput').value = found.ios_url || '';
  document.getElementById('editAndroidUrlInput').value = found.android_url || '';
  document.getElementById('editExpiresAtInput').value = found.expires_at || '';
  document.getElementById('editMaxVisitsInput').value = found.max_visits || '';
  document.getElementById('editFallbackUrlInput').value = found.fallback_url || '';
  document.getElementById('editLinkPasswordInput').value = found.link_password || '';
  document.getElementById('editWebhookUrlInput').value = found.webhook_url || '';

  document.getElementById('editModal').classList.remove('hidden');
  refreshIcons();
};

function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
}

// -------------------------------------------------------------
// AJUSTES GLOBALES
// -------------------------------------------------------------
async function openSettingsModal() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('globalWebhookInput').value = data.globalWebhook || '';
    document.getElementById('filterBotsCheckbox').checked = data.filterBots !== false;
    document.getElementById('settingsModal').classList.remove('hidden');
    refreshIcons();
  } catch (err) {
    console.error('Error cargando ajustes:', err);
  }
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
}

// -------------------------------------------------------------
// ELIMINACIÓN
// -------------------------------------------------------------
window.deleteUrl = async function(id) {
  const found = allUrls.find(u => u.id === id);
  if (!confirm(`¿Estás seguro de eliminar el enlace /${found?.slug}? Los códigos QR impresos dejarán de funcionar.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/urls/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Enlace eliminado', 'info');
      if (activeUrl && activeUrl.id === id) activeUrl = null;
      await loadUrls();
      await loadStats();
    } else {
      showToast('Error al eliminar', 'error');
    }
  } catch {
    showToast('Error al conectar con el servidor', 'error');
  }
};

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMsg');

  text.textContent = msg;

  if (type === 'success') {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold bg-emerald-950 border border-emerald-500/40 text-emerald-300 transition-all duration-300';
    icon.innerHTML = '✓';
  } else if (type === 'error') {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold bg-rose-950 border border-rose-500/40 text-rose-300 transition-all duration-300';
    icon.innerHTML = '✕';
  } else {
    toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold bg-slate-900 border border-slate-700 text-slate-200 transition-all duration-300';
    icon.innerHTML = 'ℹ';
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

function escapeHtml(string) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };
  return String(string).replace(/[&<>"'\/]/g, (s) => entityMap[s]);
}

// -------------------------------------------------------------
// ESTUDIO DISEÑADOR DE CARTEL PARA MOSTRADOR & PLACA NFC / QR
// -------------------------------------------------------------
let currentStandeeShape = 'vertical';
let currentNfcIcon = 'waves';

function setupStandeeDesigner() {
  // Título Línea 1 y Línea 2
  const t1 = document.getElementById('standeeTitleL1');
  const t2 = document.getElementById('standeeTitleL2');
  const p1 = document.getElementById('previewTitleL1');
  const p2 = document.getElementById('previewTitleL2');
  if (t1 && p1) t1.addEventListener('input', () => p1.textContent = t1.value.trim() || 'CONÉCTATE');
  if (t2 && p2) t2.addEventListener('input', () => p2.textContent = t2.value.trim() || 'CON NOSOTROS');

  // Subtítulo / Módulo Catálogo & Servicios
  const catText = document.getElementById('standeeCatalogText');
  const catToggle = document.getElementById('showCatalogToggle');
  const pCatText = document.getElementById('previewCatalogText');
  const pCatWrap = document.getElementById('previewCatalogContainer');
  if (catText && pCatText) catText.addEventListener('input', () => pCatText.textContent = catText.value.trim() || 'Catálogo & Servicios');
  if (catToggle && pCatWrap) catToggle.addEventListener('change', () => pCatWrap.classList.toggle('hidden', !catToggle.checked));

  // Texto bajo el QR
  const qrLbl = document.getElementById('standeeQrLabel');
  const pQrLbl = document.getElementById('previewQrLabel');
  if (qrLbl && pQrLbl) qrLbl.addEventListener('input', () => pQrLbl.textContent = qrLbl.value.trim() || 'Escanea aquí');

  // Módulo NFC
  const nfcToggle = document.getElementById('showNfcToggle');
  const nfcLbl = document.getElementById('standeeNfcLabel');
  const pNfcWrap = document.getElementById('previewNfcContainer');
  const pNfcLbl = document.getElementById('previewNfcLabel');
  if (nfcToggle && pNfcWrap) nfcToggle.addEventListener('change', () => pNfcWrap.classList.toggle('hidden', !nfcToggle.checked));
  if (nfcLbl && pNfcLbl) nfcLbl.addEventListener('input', () => pNfcLbl.textContent = nfcLbl.value.trim() || 'Toca con tu móvil (NFC)');

  // Módulo Google Reviews
  const gToggle = document.getElementById('showGoogleToggle');
  const gLbl = document.getElementById('standeeGoogleText');
  const pGWrap = document.getElementById('previewGoogleBlock');
  const pGLbl = document.getElementById('previewGoogleText');
  if (gToggle && pGWrap) gToggle.addEventListener('change', () => pGWrap.classList.toggle('hidden', !gToggle.checked));
  if (gLbl && pGLbl) gLbl.addEventListener('input', () => pGLbl.textContent = gLbl.value.trim() || 'Valóranos en Google');

  // Canales Sociales y Web (Instagram, TikTok, WhatsApp, Web, Facebook, LinkedIn)
  const socials = [
    { toggle: 'showInstagram', input: 'textInstagram', wrap: 'iconWrapInstagram', label: 'labelInstagram' },
    { toggle: 'showTiktok', input: 'textTiktok', wrap: 'iconWrapTiktok', label: 'labelTiktok' },
    { toggle: 'showWhatsapp', input: 'textWhatsapp', wrap: 'iconWrapWhatsapp', label: 'labelWhatsapp' },
    { toggle: 'showWebsite', input: 'textWebsite', wrap: 'iconWrapWebsite', label: 'labelWebsite' },
    { toggle: 'showFacebook', input: 'textFacebook', wrap: 'iconWrapFacebook', label: 'labelFacebook' },
    { toggle: 'showLinkedin', input: 'textLinkedin', wrap: 'iconWrapLinkedin', label: 'labelLinkedin' }
  ];

  socials.forEach(s => {
    const tog = document.getElementById(s.toggle);
    const inp = document.getElementById(s.input);
    const wrap = document.getElementById(s.wrap);
    const lbl = document.getElementById(s.label);

    if (tog && wrap) tog.addEventListener('change', () => wrap.classList.toggle('hidden', !tog.checked));
    if (inp && lbl) inp.addEventListener('input', () => lbl.textContent = inp.value.trim() || 'Síguenos');
  });

  // Selector Libre de Color de Fondo
  const customBg = document.getElementById('standeeBgCustom');
  if (customBg) {
    customBg.addEventListener('input', () => {
      const standee = document.getElementById('printableStandee');
      if (standee) standee.style.background = customBg.value;
    });
  }

  // Aura de Resplandor Neón
  const auraSelect = document.getElementById('standeeAuraColor');
  if (auraSelect) {
    auraSelect.addEventListener('change', () => {
      const standee = document.getElementById('printableStandee');
      if (!standee) return;
      const val = auraSelect.value;
      if (val === 'emerald-cyan') {
        standee.style.borderColor = 'rgba(52, 211, 153, 0.6)';
        standee.style.boxShadow = '0 0 35px rgba(52, 211, 153, 0.3), inset 0 0 25px rgba(6, 182, 212, 0.2)';
      } else if (val === 'amber-orange') {
        standee.style.borderColor = 'rgba(251, 191, 36, 0.6)';
        standee.style.boxShadow = '0 0 35px rgba(251, 191, 36, 0.3), inset 0 0 25px rgba(249, 115, 22, 0.2)';
      } else if (val === 'purple-pink') {
        standee.style.borderColor = 'rgba(168, 85, 247, 0.6)';
        standee.style.boxShadow = '0 0 35px rgba(168, 85, 247, 0.3), inset 0 0 25px rgba(236, 72, 153, 0.2)';
      } else {
        standee.style.borderColor = 'rgba(0, 240, 255, 0.4)';
        standee.style.boxShadow = '0 0 35px rgba(0, 240, 255, 0.25), inset 0 0 25px rgba(217, 70, 239, 0.15)';
      }
    });
  }

  // Control de Dimensiones en Centímetros (cm)
  const wInput = document.getElementById('standeeWidthCm');
  const hInput = document.getElementById('standeeHeightCm');
  if (wInput) wInput.addEventListener('input', updateStandeeDimensions);
  if (hInput) hInput.addEventListener('input', updateStandeeDimensions);

  // Sliders de Ajuste Fino (Escala del QR y Tipografía)
  const qrSlider = document.getElementById('qrScaleSlider');
  const qrLabel = document.getElementById('qrScaleLabel');
  if (qrSlider) {
    qrSlider.addEventListener('input', () => {
      const val = qrSlider.value;
      qrLabel.textContent = `${val}%`;
      const qrImg = document.getElementById('standeeQrImg');
      if (qrImg) {
        const baseSize = 8; // rem base (128px)
        qrImg.style.width = `${(baseSize * val) / 100}rem`;
        qrImg.style.height = `${(baseSize * val) / 100}rem`;
      }
    });
  }

  const fontSlider = document.getElementById('fontScaleSlider');
  const fontLabel = document.getElementById('fontScaleLabel');
  if (fontSlider) {
    fontSlider.addEventListener('input', () => {
      const val = fontSlider.value;
      fontLabel.textContent = `${val}%`;
      const p1 = document.getElementById('previewTitleL1');
      const p2 = document.getElementById('previewTitleL2');
      if (p1) p1.style.fontSize = `${(1.875 * val) / 100}rem`;
      if (p2) p2.style.fontSize = `${(1.5 * val) / 100}rem`;
    });
  }

  // Descarga en Alta Resolución (PNG 300 DPI con html2canvas)
  const downloadPngBtn = document.getElementById('downloadStandeePngBtn');
  if (downloadPngBtn) {
    downloadPngBtn.addEventListener('click', async () => {
      const standee = document.getElementById('printableStandee');
      if (!standee) return;

      const wCm = parseFloat(document.getElementById('standeeWidthCm').value) || 10;
      const hCm = parseFloat(document.getElementById('standeeHeightCm').value) || 15;

      showToast(`Generando tarjeta para imprenta (${wCm} x ${hCm} cm a 300 DPI)...`, 'info');

      try {
        const canvas = await html2canvas(standee, {
          scale: 3, // Multiplicador 3x para calidad óptima de imprenta profesional
          useCORS: true,
          backgroundColor: null,
          logging: false
        });

        const slug = activeUrl ? activeUrl.slug : 'mostrador';
        const link = document.createElement('a');
        link.download = `tarjeta-${slug}-${currentStandeeShape}-${wCm}x${hCm}cm.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('¡Tarjeta HD descargada con éxito!', 'success');
      } catch (err) {
        console.error('Error al generar imagen de tarjeta:', err);
        showToast('Error al exportar tarjeta en imagen', 'error');
      }
    });
  }

  // Imprimir Directamente / Guardar en PDF
  const printBtn = document.getElementById('printStandeeBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }
}

// -------------------------------------------------------------
// CONTROLADOR DE FORMA (VERTICAL, CUADRADO, CIRCULAR, HORIZONTAL)
// -------------------------------------------------------------
window.setStandeeShape = function(shape, wCm, hCm) {
  currentStandeeShape = shape;
  const wInput = document.getElementById('standeeWidthCm');
  const hInput = document.getElementById('standeeHeightCm');
  if (wInput) wInput.value = wCm;
  if (hInput) hInput.value = hCm;

  // Actualizar botones activos de forma
  const shapes = ['vertical', 'square', 'circle', 'horizontal'];
  shapes.forEach(s => {
    const btn = document.getElementById(`shapeBtn${s.charAt(0).toUpperCase() + s.slice(1)}`);
    if (btn) {
      if (s === shape) {
        btn.className = 'p-2.5 rounded-xl border border-cyan-500 bg-cyan-950/60 text-cyan-300 text-xs font-bold flex flex-col items-center gap-1 transition shadow-md shadow-cyan-950';
      } else {
        btn.className = 'p-2.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold flex flex-col items-center gap-1 transition';
      }
    }
  });

  updateStandeeDimensions();
};

function updateStandeeDimensions() {
  const standee = document.getElementById('printableStandee');
  if (!standee) return;

  const wCm = parseFloat(document.getElementById('standeeWidthCm').value) || 10;
  const hCm = parseFloat(document.getElementById('standeeHeightCm').value) || 15;

  const centerArea = document.getElementById('previewCenterArea');
  const bottomArea = document.getElementById('previewBottomArea');
  const headerArea = document.getElementById('previewHeaderArea');

  if (currentStandeeShape === 'circle') {
    standee.style.borderRadius = '9999px';
    standee.style.aspectRatio = '1 / 1';
    standee.style.maxWidth = '380px';
    standee.style.minHeight = '380px';
    standee.style.padding = '2.5rem 1.75rem';
    if (centerArea) centerArea.className = 'relative z-10 py-1 flex items-center justify-around gap-2 my-auto';
  } else if (currentStandeeShape === 'square') {
    standee.style.borderRadius = '2rem';
    standee.style.aspectRatio = '1 / 1';
    standee.style.maxWidth = '380px';
    standee.style.minHeight = '380px';
    standee.style.padding = '1.75rem 1.5rem';
    if (centerArea) centerArea.className = 'relative z-10 py-1 flex items-center justify-between gap-3 my-auto';
  } else if (currentStandeeShape === 'horizontal') {
    standee.style.borderRadius = '1.75rem';
    standee.style.aspectRatio = '9 / 5';
    standee.style.maxWidth = '440px';
    standee.style.minHeight = 'auto';
    standee.style.padding = '1.5rem';
    if (centerArea) centerArea.className = 'relative z-10 py-1 flex items-center justify-around gap-3 my-auto';
  } else {
    // Vertical Estándar
    standee.style.borderRadius = '2.5rem';
    standee.style.aspectRatio = `${wCm} / ${hCm}`;
    standee.style.maxWidth = '390px';
    standee.style.minHeight = 'auto';
    standee.style.padding = '1.75rem';
    if (centerArea) centerArea.className = 'relative z-10 py-2 flex items-center justify-between gap-3 my-auto';
  }
}

// -------------------------------------------------------------
// CONTROLADOR DE ICONOS NFC (WAVES, PHONE, LOGO, CHIP)
// -------------------------------------------------------------
window.setNfcIcon = function(type) {
  currentNfcIcon = type;
  const icons = ['waves', 'phone', 'logo', 'chip'];

  icons.forEach(i => {
    const el = document.getElementById(`nfcSvg_${i}`);
    const btn = document.getElementById(`nfcIconBtn_${i}`);
    if (el) {
      el.classList.toggle('hidden', i !== type);
    }
    if (btn) {
      if (i === type) {
        btn.className = 'p-2 rounded-xl border border-cyan-500 bg-cyan-950/60 text-cyan-300 flex flex-col items-center gap-1 transition shadow-md shadow-cyan-950';
      } else {
        btn.className = 'p-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 flex flex-col items-center gap-1 transition';
      }
    }
  });
};

// -------------------------------------------------------------
// CONTROLADOR DE TEMAS DE COLOR DEL CARTEL
// -------------------------------------------------------------
window.setStandeeTheme = function(theme) {
  const standee = document.getElementById('printableStandee');
  const t1 = document.getElementById('previewTitleL1');
  const t2 = document.getElementById('previewTitleL2');
  if (!standee) return;

  if (theme === 'oled') {
    standee.style.background = '#000000';
    standee.style.borderColor = 'rgba(255, 255, 255, 0.25)';
    standee.style.boxShadow = '0 0 30px rgba(255, 255, 255, 0.1)';
    if (t1) { t1.classList.remove('standee-neon-text'); t1.style.color = '#ffffff'; }
    if (t2) { t2.classList.remove('standee-neon-text'); t2.style.color = '#ffffff'; }
  } else if (theme === 'midnight') {
    standee.style.background = 'linear-gradient(180deg, #070e24 0%, #0c1a40 50%, #08122d 100%)';
    standee.style.borderColor = 'rgba(56, 189, 248, 0.5)';
    standee.style.boxShadow = '0 0 35px rgba(56, 189, 248, 0.3)';
    if (t1) { t1.classList.add('standee-neon-text'); t1.style.color = '#ffffff'; }
    if (t2) { t2.classList.add('standee-neon-text'); t2.style.color = '#ffffff'; }
  } else if (theme === 'white') {
    standee.style.background = '#ffffff';
    standee.style.borderColor = 'rgba(6, 182, 212, 0.6)';
    standee.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.12)';
    if (t1) { t1.classList.remove('standee-neon-text'); t1.style.color = '#0f172a'; }
    if (t2) { t2.classList.remove('standee-neon-text'); t2.style.color = '#0f172a'; }
  } else {
    // Cyberpunk Neon Original
    standee.style.background = 'linear-gradient(180deg, #090518 0%, #0d0c2b 55%, #160729 100%)';
    standee.style.borderColor = 'rgba(0, 240, 255, 0.4)';
    standee.style.boxShadow = '0 0 35px rgba(0, 240, 255, 0.25), inset 0 0 25px rgba(217, 70, 239, 0.15)';
    if (t1) { t1.classList.add('standee-neon-text'); t1.style.color = '#ffffff'; }
    if (t2) { t2.classList.add('standee-neon-text'); t2.style.color = '#ffffff'; }
  }
};


