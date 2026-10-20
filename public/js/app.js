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

  refreshIcons();
}

function renderEmptyQr() {
  document.getElementById('qrShortUrlText').textContent = 'Crea un enlace para generar el QR';
  document.getElementById('qrPreviewImg').src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="%2394a3b8" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01M7 12h.01M7 17h.01M12 7h.01M12 12h.01M17 7h.01M17 12h.01M17 17h.01"/></svg>';
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
