// Globaler Anwendungsstatus
let currentUser = null;
let activeTheme = 'dark';

// DOM-Elemente
const themeToggleBtn = document.getElementById('theme-toggle');
const authSection = document.getElementById('auth-section');
const tilesContainer = document.getElementById('tiles-container');

// Admin DOM-Elemente
const mainView = document.getElementById('main-view');
const adminView = document.getElementById('admin-view');

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Theme initialisieren
  initTheme();

  // 2. Auth-Status & Benutzer abfragen
  await checkAuthStatus();

  // 3. Kacheln laden und rendern
  await loadTiles();

  // 4. URL auf Passwort-Reset-Tokens prüfen
  checkPasswordResetToken();

  // 5. URL auf OAuth-Redirects prüfen
  checkOauthRedirect();

  // Tooltip initialisieren
  initTooltips();
});

/* ==========================================================================
   1. Theme Management (Dark / Light Mode)
   ========================================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);

  themeToggleBtn.addEventListener('click', () => {
    const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  });
}

function setTheme(theme) {
  activeTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  // Icon anpassen
  if (theme === 'dark') {
    themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
  } else {
    themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
  }
}

/* ==========================================================================
   2. Auth Status & Session Handling
   ========================================================================== */
async function checkAuthStatus() {
  try {
    const res = await fetch('api/auth/me');
    const data = await res.json();

    if (data.logged_in) {
      currentUser = data.user;
      renderAuthenticatedHeader();
    } else {
      currentUser = null;
      renderAnonymousHeader();
    }
  } catch (err) {
    console.error('Fehler bei der Authentifizierungsprüfung:', err);
    renderAnonymousHeader();
  }
}

function renderAuthenticatedHeader() {
  const isAdmin = currentUser.role === 'admin';
  const adminBtnHtml = isAdmin 
    ? `<button class="btn btn-secondary" onclick="openAdminView()"><i class="fa-solid fa-screwdriver-wrench"></i> Admin-Bereich</button>`
    : '';

  authSection.innerHTML = `
    <div style="display:flex; align-items:center; gap:15px;">
      <div class="user-badge">
        <i class="fa-solid fa-user-circle"></i>
        <span>Eingeloggt als <strong>${currentUser.username}</strong></span>
      </div>
      ${adminBtnHtml}
      <button class="btn btn-danger" onclick="handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> Abmelden</button>
    </div>
  `;
}

function renderAnonymousHeader() {
  authSection.innerHTML = `
    <button class="btn btn-primary" onclick="openModal('login-modal')">
      <i class="fa-solid fa-right-to-bracket"></i> Anmelden
    </button>
  `;
}

async function handleLogin(e) {
  e.preventDefault();
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value;
  const alertBox = document.getElementById('login-alert');

  alertBox.style.display = 'none';

  try {
    const res = await fetch('api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    const data = await res.json();

    if (res.ok) {
      closeModal('login-modal');
      // Login-Formular leeren
      document.getElementById('login-form').reset();
      
      if (data.oauth_redirect) {
        window.location.href = 'api/oauth/authorize';
        return;
      }
      
      await checkAuthStatus();
      await loadTiles();
    } else {
      throw new Error(data.error || 'Fehler beim Anmelden.');
    }
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.style.display = 'block';
  }
}

async function handleLogout() {
  try {
    const res = await fetch('api/auth/logout', { method: 'POST' });
    if (res.ok) {
      currentUser = null;
      renderAnonymousHeader();
      closeAdminView();
      await loadTiles();
    }
  } catch (err) {
    console.error('Logout fehlgeschlagen:', err);
  }
}

/* ==========================================================================
   3. Kacheln laden & rendern
   ========================================================================== */
async function loadTiles() {
  tilesContainer.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
      <i class="fa-solid fa-spinner fa-spin fa-2xl" style="color: var(--accent-color);"></i>
      <p style="margin-top: 15px;">Lade Dienste...</p>
    </div>
  `;

  try {
    const res = await fetch('api/tiles');
    const tiles = await res.json();

    if (tiles.length === 0) {
      tilesContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
          <i class="fa-solid fa-circle-question fa-2xl"></i>
          <p style="margin-top: 15px;">Keine Kacheln verfügbar oder freigegeben.</p>
        </div>
      `;
      return;
    }

    tilesContainer.innerHTML = '';
    
    // Kacheln rendern
    tiles.forEach(tile => {
      const tileCard = document.createElement('a');
      tileCard.className = 'tile-card glass-panel';
      tileCard.id = `tile-card-${tile.id}`;
      // SSO-Gateway Link als Href nutzen
      tileCard.href = `api/tiles/sso/${tile.id}`;
      
      tileCard.innerHTML = `
        <div class="tile-header">
          <div class="tile-icon-wrapper">
            ${tile.icon && tile.icon.startsWith('bi-') ? `<i class="bi ${tile.icon}"></i>` : `<i class="fa-solid ${tile.icon || 'fa-cubes'}"></i>`}
          </div>
          <div class="status-dot" id="status-dot-${tile.id}" data-toggle="tooltip" title="Wird geprüft..."></div>
        </div>
        <div class="tile-body">
          <h4 class="tile-title">${tile.title}</h4>
          <p class="tile-description">${tile.description || ''}</p>
          <div class="unavailable-label"><i class="fa-solid fa-circle-exclamation"></i> Dienst momentan nicht verfügbar.</div>
        </div>
        <div class="tile-bg-glow"></div>
      `;

      tilesContainer.appendChild(tileCard);

      // Statusprüfung asynchron starten (CORS-gesichert über MSO-Cloud Checker)
      checkTileStatus(tile.id, tile.link);
    });

  } catch (err) {
    tilesContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--error-color);">
        <i class="fa-solid fa-triangle-exclamation fa-2xl"></i>
        <p style="margin-top: 15px;">Fehler beim Laden der Kacheln: ${err.message}</p>
      </div>
    `;
  }
}

/**
 * Prüft die Erreichbarkeit einer Kachel asynchron über das MSO Cloud Prüfskript.
 */
function checkTileStatus(tileId, link) {
  const dot = document.getElementById(`status-dot-${tileId}`);
  const card = document.getElementById(`tile-card-${tileId}`);
  let requestCompleted = false;

  // Verwende dieselbe API wie im Original, aber mit vollem Pfad gegen CORS (oder Proxy)
  const checkerUrl = `https://cloud.mso-hef.de/launcher/check_links.php?link=${encodeURIComponent(link)}`;

  // AJAX-Request zur Statusprüfung
  const xhr = new XMLHttpRequest();
  xhr.open('GET', checkerUrl, true);
  xhr.timeout = 10000; // 10s Timeout

  xhr.onload = function() {
    requestCompleted = true;
    if (xhr.status === 200) {
      try {
        const result = JSON.parse(xhr.responseText);
        dot.className = 'status-dot';
        
        if (result.color === 'a3e77f') {
          // Online
          dot.classList.add('online');
          dot.setAttribute('title', result.reason);
        } else {
          // Offline (e77f7f)
          dot.classList.add('offline');
          dot.setAttribute('title', result.reason);
          disableTileCard(card);
        }
      } catch (e) {
        // Fallback bei JSON Parsefehler
        dot.className = 'status-dot online';
        dot.setAttribute('title', 'Erreichbar');
      }
    } else {
      dot.className = 'status-dot offline';
      dot.setAttribute('title', 'Prüfung fehlgeschlagen');
      disableTileCard(card);
    }
  };

  xhr.onerror = function() {
    requestCompleted = true;
    dot.className = 'status-dot offline';
    dot.setAttribute('title', 'Netzwerkfehler bei Prüfung');
    disableTileCard(card);
  };

  xhr.ontimeout = function() {
    requestCompleted = true;
    dot.className = 'status-dot timeout';
    dot.setAttribute('title', 'Timeout: Keine Antwort nach 10s');
    disableTileCard(card);
  };

  xhr.send();
}

function disableTileCard(card) {
  card.classList.add('disabled');
  card.removeAttribute('href'); // Klick blockieren
  card.onclick = function(e) { e.preventDefault(); return false; };
}

/* ==========================================================================
   4. Passwort-Vergessen & Reset Flow
   ========================================================================== */
function checkPasswordResetToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  const token = urlParams.get('token');

  if (action === 'reset' && token) {
    document.getElementById('reset-token-field').value = token;
    openModal('reset-password-modal');
    
    // Query-Parameter sauber aus der URL entfernen, ohne die Seite neu zu laden!
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function checkOauthRedirect() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('login_redirect') === 'oauth') {
    if (!currentUser) {
      openModal('login-modal');
    }
  }
}

function openPasswordResetRequest() {
  closeModal('login-modal');
  openModal('reset-request-modal');
}

async function handleResetRequest(e) {
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  const alertBox = document.getElementById('reset-request-alert');

  alertBox.style.display = 'none';
  alertBox.className = 'alert';

  try {
    const res = await fetch('api/auth/reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (res.ok) {
      alertBox.innerText = data.message;
      alertBox.classList.add('alert-success');
      alertBox.style.display = 'flex';
      document.getElementById('reset-request-form').reset();
    } else {
      throw new Error(data.error || 'Fehler beim Versenden.');
    }
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
  }
}

async function handlePasswordResetExecute(e) {
  e.preventDefault();
  const token = document.getElementById('reset-token-field').value;
  const pass = document.getElementById('reset-new-password').value;
  const passConf = document.getElementById('reset-new-password-confirm').value;
  const alertBox = document.getElementById('reset-password-alert');

  alertBox.style.display = 'none';
  alertBox.className = 'alert';

  if (pass !== passConf) {
    alertBox.innerText = 'Die Passwörter stimmen nicht überein.';
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
    return;
  }

  try {
    const res = await fetch('api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pass })
    });

    const data = await res.json();

    if (res.ok) {
      alertBox.innerText = data.message;
      alertBox.classList.add('alert-success');
      alertBox.style.display = 'flex';
      document.getElementById('reset-password-form').reset();
      
      setTimeout(() => {
        closeModal('reset-password-modal');
        openModal('login-modal');
      }, 3000);
    } else {
      throw new Error(data.error || 'Fehler beim Ändern des Passworts.');
    }
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
  }
}

/* ==========================================================================
   5. Modals Helper
   ========================================================================== */
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  // Alerts im Modal verstecken
  const alert = document.querySelector(`#${id} .alert`);
  if (alert) alert.style.display = 'none';
}

// Schließen per Klick außerhalb des Modals
window.onclick = function(event) {
  if (event.target.classList.contains('modal')) {
    event.target.style.display = 'none';
  }
};

/* ==========================================================================
   6. Admin Control Panel Logik
   ========================================================================== */
function openAdminView() {
  mainView.style.display = 'none';
  adminView.style.display = 'block';
  loadAdminTabContent('tab-tiles');
}

function closeAdminView() {
  adminView.style.display = 'none';
  mainView.style.display = 'block';
  loadTiles(); // Kacheln aktualisieren
}

function switchTab(tabId, element) {
  // Aktiven Menüpunkt umschalten
  document.querySelectorAll('.admin-nav-item').forEach(item => item.classList.remove('active'));
  element.classList.add('active');

  // Tab-Inhalte umschalten
  document.querySelectorAll('.admin-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');

  // Daten für den ausgewählten Tab laden
  loadAdminTabContent(tabId);
}

function loadAdminTabContent(tabId) {
  // Alert ausblenden
  document.getElementById('admin-alert').style.display = 'none';

  if (tabId === 'tab-tiles') {
    loadAdminTiles();
  } else if (tabId === 'tab-ldap' || tabId === 'tab-smtp') {
    loadAdminConfig();
  } else if (tabId === 'tab-oauth') {
    loadOauthClientConfig();
  } else if (tabId === 'tab-mapping') {
    loadAdminLdapMappings();
  } else if (tabId === 'tab-users') {
    loadAdminUsers();
  } else if (tabId === 'tab-system') {
    loadSystemInfo();
  }
}

function showAdminAlert(message, type = 'success') {
  const alert = document.getElementById('admin-alert');
  alert.innerText = message;
  alert.className = `alert alert-${type}`;
  alert.style.display = 'flex';
  
  // Nach 5 Sekunden automatisch ausblenden
  setTimeout(() => {
    alert.style.display = 'none';
  }, 5000);
}

/* --- TAB: Kacheln --- */
const POPULAR_ICONS = [
  'bi-graduation-cap-fill', 'bi-book-half', 'bi-calendar-event', 'bi-chat-dots-fill',
  'bi-cloud-fill', 'bi-envelope-fill', 'bi-file-earmark-text-fill', 'bi-gear-fill',
  'bi-graph-up-arrow', 'bi-house-door-fill', 'bi-info-circle-fill', 'bi-journal-bookmark-fill',
  'bi-link-45deg', 'bi-lock-fill', 'bi-people-fill', 'bi-person-badge-fill',
  'bi-shield-lock-fill', 'bi-speedometer2', 'bi-tools', 'bi-wifi',
  'bi-globe', 'bi-music-note-list', 'bi-play-btn-fill', 'bi-terminal-fill',
  'bi-folder-fill', 'bi-hdd-network-fill', 'bi-kanban-fill', 'bi-list-check',
  'bi-printer-fill', 'bi-server', 'bi-telephone-fill', 'bi-trophy-fill',
  'bi-vector-pen', 'bi-wrench-adjustable-circle-fill', 'bi-pc-display-horizontal', 'bi-activity'
];

function initIconPicker(selectedIcon = 'bi-link-45deg') {
  const grid = document.getElementById('tile-icon-picker-grid');
  grid.innerHTML = '';
  
  POPULAR_ICONS.forEach(icon => {
    const item = document.createElement('div');
    item.className = `icon-picker-item ${icon === selectedIcon ? 'active' : ''}`;
    item.innerHTML = `<i class="bi ${icon}"></i>`;
    item.title = icon;
    item.onclick = () => {
      document.querySelectorAll('#tile-icon-picker-grid .icon-picker-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('tile_icon').value = icon;
      document.getElementById('tile-icon-preview').innerHTML = `<i class="bi ${icon}"></i>`;
    };
    grid.appendChild(item);
  });

  document.getElementById('tile_icon').value = selectedIcon;
  if (selectedIcon.startsWith('bi-')) {
    document.getElementById('tile-icon-preview').innerHTML = `<i class="bi ${selectedIcon}"></i>`;
  } else {
    document.getElementById('tile-icon-preview').innerHTML = `<i class="fa-solid ${selectedIcon}"></i>`;
  }
}

async function loadGroupCheckboxes(selectedGroups = []) {
  const container = document.getElementById('tile_groups_container');
  container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Lade Gruppen...</span>';
  
  try {
    const res = await fetch('api/admin/groups');
    const groups = await res.json();
    
    if (groups.length === 0) {
      container.innerHTML = '<span style="font-size:0.8rem; color:var(--text-secondary); font-style:italic;">Keine Gruppen in der Datenbank gefunden.</span>';
      return;
    }
    
    container.innerHTML = '';
    groups.forEach(group => {
      const isChecked = selectedGroups.includes(group) ? 'checked' : '';
      const div = document.createElement('div');
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '8px';
      div.innerHTML = `
        <input type="checkbox" id="grp_chk_${group}" value="${group}" ${isChecked} style="width:16px; height:16px; cursor:pointer;">
        <label for="grp_chk_${group}" style="margin:0; font-size:0.9rem; cursor:pointer; user-select:none;">${group}</label>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    container.innerHTML = `<span style="font-size:0.8rem; color:var(--error-color);">Fehler beim Laden: ${err.message}</span>`;
  }
}

async function loadAdminTiles() {
  const tbody = document.getElementById('admin-tiles-table-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Lade Dienste...</td></tr>';

  try {
    const res = await fetch('api/admin/tiles');
    const tiles = await res.json();
    
    tbody.innerHTML = '';
    tiles.forEach(tile => {
      const allowedGroups = JSON.parse(tile.allowed_groups || '[]');
      const groupsLabel = tile.visibility === 'groups' ? ` (${allowedGroups.join(', ')})` : '';
      
      const tr = document.createElement('tr');
      const isBi = tile.icon && tile.icon.startsWith('bi-');
      tr.innerHTML = `
        <td><strong>${tile.title}</strong></td>
        <td style="font-size:0.8rem; color:var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tile.description || ''}</td>
        <td>${isBi ? `<i class="bi ${tile.icon}"></i>` : `<i class="fa-solid ${tile.icon || 'fa-cubes'}"></i>`} <code>${tile.icon}</code></td>
        <td><span class="user-badge" style="font-size:0.75rem;">${tile.visibility}${groupsLabel}</span></td>
        <td><code>${tile.sso_type}</code></td>
        <td>${tile.sort_order}</td>
        <td class="actions-cell">
          <button class="btn btn-secondary btn-icon" onclick="openTileForm(${JSON.stringify(tile).replace(/"/g, '&quot;')})" title="Bearbeiten"><i class="fa-solid fa-pen-to-square"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteTile(${tile.id})" title="Löschen"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--error-color);">Fehler beim Laden: ${err.message}</td></tr>`;
  }
}

function openTileForm(tile = null) {
  document.getElementById('tile-form').reset();
  document.getElementById('tile-id-field').value = '';
  document.getElementById('tile-modal-title').innerText = 'Neuer Dienst';
  
  let selectedIcon = 'bi-link-45deg';
  let allowedGroups = [];

  if (tile) {
    document.getElementById('tile-id-field').value = tile.id;
    document.getElementById('tile-modal-title').innerText = 'Dienst bearbeiten';
    
    document.getElementById('tile_title').value = tile.title;
    document.getElementById('tile_description').value = tile.description || '';
    document.getElementById('tile_link').value = tile.link;
    document.getElementById('tile_sort_order').value = tile.sort_order;
    document.getElementById('tile_visibility').value = tile.visibility;
    
    selectedIcon = tile.icon || 'bi-link-45deg';
    allowedGroups = JSON.parse(tile.allowed_groups || '[]');
    
    document.getElementById('tile_sso_type').value = tile.sso_type;
    document.getElementById('tile_sso_key').value = tile.sso_key || '';
  }

  // Initialisiere die premium icon & group Selectors
  initIconPicker(selectedIcon);
  loadGroupCheckboxes(allowedGroups);

  toggleTileGroupsSelect();
  toggleTileSsoFields();
  openModal('tile-modal');
}

function toggleTileGroupsSelect() {
  const vis = document.getElementById('tile_visibility').value;
  const wrapper = document.getElementById('tile-groups-wrapper');
  wrapper.style.display = vis === 'groups' ? 'block' : 'none';
}

function toggleTileSsoFields() {
  const sso = document.getElementById('tile_sso_type').value;
  const wrapper = document.getElementById('tile-sso-key-wrapper');
  wrapper.style.display = sso !== 'none' ? 'block' : 'none';
}

async function saveTileForm(e) {
  e.preventDefault();
  const id = document.getElementById('tile-id-field').value;
  
  const checkboxes = document.querySelectorAll('#tile_groups_container input[type="checkbox"]:checked');
  const allowedGroups = Array.from(checkboxes).map(chk => chk.value);

  const body = {
    title: document.getElementById('tile_title').value.trim(),
    description: document.getElementById('tile_description').value.trim(),
    icon: document.getElementById('tile_icon').value.trim(),
    link: document.getElementById('tile_link').value.trim(),
    sort_order: document.getElementById('tile_sort_order').value,
    visibility: document.getElementById('tile_visibility').value,
    allowed_groups: allowedGroups,
    sso_type: document.getElementById('tile_sso_type').value,
    sso_key: document.getElementById('tile_sso_key').value.trim()
  };

  const url = id ? `api/admin/tiles/${id}` : 'api/admin/tiles';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (res.ok) {
      closeModal('tile-modal');
      showAdminAlert(id ? 'Dienst erfolgreich aktualisiert.' : 'Dienst erfolgreich hinzugefügt.');
      loadAdminTiles();
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

function generateSsoKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  if (window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(32);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < 32; i++) {
      key += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  document.getElementById('tile_sso_key').value = key;
}

async function deleteTile(id) {
  if (!confirm('Möchten Sie diesen Dienst wirklich unwiderruflich löschen?')) return;
  try {
    const res = await fetch(`api/admin/tiles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showAdminAlert('Dienst gelöscht.');
      loadAdminTiles();
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

/* --- TABS: Config (LDAP & SMTP) --- */
async function loadAdminConfig() {
  try {
    const res = await fetch('api/admin/config');
    const cfg = await res.json();

    // LDAP Felder
    document.getElementById('ldap_enabled').checked = cfg.ldap_enabled === '1';
    document.getElementById('ldap_url').value = cfg.ldap_url || '';
    document.getElementById('ldap_port').value = cfg.ldap_port || '389';
    document.getElementById('ldap_secure').checked = cfg.ldap_secure === '1';
    document.getElementById('ldap_tls_verify').checked = cfg.ldap_tls_verify === '1';
    document.getElementById('ldap_base_dn').value = cfg.ldap_base_dn || '';
    document.getElementById('ldap_bind_dn').value = cfg.ldap_bind_dn || '';
    document.getElementById('ldap_bind_password').value = cfg.ldap_bind_password || '';
    document.getElementById('ldap_user_attribute').value = cfg.ldap_user_attribute || 'sAMAccountName';
    document.getElementById('ldap_mail_attribute').value = cfg.ldap_mail_attribute || 'mail';
    document.getElementById('ldap_name_attribute').value = cfg.ldap_name_attribute || 'displayName';
    document.getElementById('ldap_upn_suffix').value = cfg.ldap_upn_suffix || '';

    // SMTP Felder
    document.getElementById('smtp_host').value = cfg.smtp_host || '';
    document.getElementById('smtp_port').value = cfg.smtp_port || '587';
    document.getElementById('smtp_secure').checked = cfg.smtp_secure === '1';
    document.getElementById('smtp_user').value = cfg.smtp_user || '';
    document.getElementById('smtp_password').value = cfg.smtp_password || '';
    document.getElementById('smtp_from').value = cfg.smtp_from || 'no-reply@mso-hef.de';

  } catch (err) {
    showAdminAlert('Konfiguration konnte nicht geladen werden.', 'danger');
  }
}

async function saveLdapConfig(e) {
  e.preventDefault();
  const body = {
    ldap_enabled: document.getElementById('ldap_enabled').checked ? '1' : '0',
    ldap_url: document.getElementById('ldap_url').value.trim(),
    ldap_port: document.getElementById('ldap_port').value,
    ldap_secure: document.getElementById('ldap_secure').checked ? '1' : '0',
    ldap_tls_verify: document.getElementById('ldap_tls_verify').checked ? '1' : '0',
    ldap_base_dn: document.getElementById('ldap_base_dn').value.trim(),
    ldap_bind_dn: document.getElementById('ldap_bind_dn').value.trim(),
    ldap_bind_password: document.getElementById('ldap_bind_password').value,
    ldap_user_attribute: document.getElementById('ldap_user_attribute').value.trim(),
    ldap_mail_attribute: document.getElementById('ldap_mail_attribute').value.trim(),
    ldap_name_attribute: document.getElementById('ldap_name_attribute').value.trim(),
    ldap_upn_suffix: document.getElementById('ldap_upn_suffix').value.trim()
  };

  try {
    const res = await fetch('api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showAdminAlert('LDAP-Konfiguration erfolgreich gespeichert.');
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

async function testLdapConnection() {
  const body = {
    ldap_url: document.getElementById('ldap_url').value.trim(),
    ldap_port: document.getElementById('ldap_port').value,
    ldap_secure: document.getElementById('ldap_secure').checked ? '1' : '0',
    ldap_tls_verify: document.getElementById('ldap_tls_verify').checked ? '1' : '0',
    ldap_base_dn: document.getElementById('ldap_base_dn').value.trim(),
    ldap_bind_dn: document.getElementById('ldap_bind_dn').value.trim(),
    ldap_bind_password: document.getElementById('ldap_bind_password').value
  };

  showAdminAlert('Teste LDAP-Verbindung...', 'warning');

  try {
    const res = await fetch('api/admin/config/test-ldap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showAdminAlert(data.message, 'success');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

async function saveSmtpConfig(e) {
  e.preventDefault();
  const body = {
    smtp_host: document.getElementById('smtp_host').value.trim(),
    smtp_port: document.getElementById('smtp_port').value,
    smtp_secure: document.getElementById('smtp_secure').checked ? '1' : '0',
    smtp_user: document.getElementById('smtp_user').value.trim(),
    smtp_password: document.getElementById('smtp_password').value,
    smtp_from: document.getElementById('smtp_from').value.trim()
  };

  try {
    const res = await fetch('api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showAdminAlert('SMTP-Konfiguration erfolgreich gespeichert.');
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

async function testSmtpConnection() {
  const body = {
    smtp_host: document.getElementById('smtp_host').value.trim(),
    smtp_port: document.getElementById('smtp_port').value,
    smtp_secure: document.getElementById('smtp_secure').checked ? '1' : '0',
    smtp_user: document.getElementById('smtp_user').value.trim(),
    smtp_password: document.getElementById('smtp_password').value
  };

  showAdminAlert('Teste SMTP-Verbindung...', 'warning');

  try {
    const res = await fetch('api/admin/config/test-smtp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showAdminAlert(data.message, 'success');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

/* --- TAB: OAuth 2.0 SSO --- */
async function loadOauthClientConfig() {
  try {
    // 1. Dynamische Endpunkt-URLs im Hinweis-Bereich anzeigen
    const protocol = window.location.protocol;
    const host = window.location.host;
    const basePath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    const fullBaseUrl = `${protocol}//${host}${basePath}`;

    document.getElementById('moodle-oauth-auth-url').innerText = `${fullBaseUrl}/api/oauth/authorize`;
    document.getElementById('moodle-oauth-token-url').innerText = `${fullBaseUrl}/api/oauth/token`;
    document.getElementById('moodle-oauth-user-url').innerText = `${fullBaseUrl}/api/oauth/userinfo`;

    // 2. Client-Konfiguration vom Server abfragen
    const res = await fetch('api/admin/oauth-client');
    const client = await res.json();

    if (client) {
      document.getElementById('oauth_client_id').value = client.client_id || '';
      document.getElementById('oauth_client_secret').value = client.client_secret || '';
      document.getElementById('oauth_redirect_uri').value = client.redirect_uri || '';
    }
  } catch (err) {
    showAdminAlert('OAuth 2.0-Konfiguration konnte nicht geladen werden: ' + err.message, 'danger');
  }
}

async function saveOauthClientConfig(e) {
  e.preventDefault();
  const body = {
    client_id: document.getElementById('oauth_client_id').value.trim(),
    client_secret: document.getElementById('oauth_client_secret').value.trim(),
    redirect_uri: document.getElementById('oauth_redirect_uri').value.trim()
  };

  try {
    const res = await fetch('api/admin/oauth-client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      showAdminAlert(data.message, 'success');
      loadOauthClientConfig();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

function generateOauthClientId() {
  document.getElementById('oauth_client_id').value = 'moodle_' + Math.random().toString(36).substring(2, 10);
}

function generateOauthClientSecret() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  if (window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(32);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < 32; i++) {
      key += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  document.getElementById('oauth_client_secret').value = key;
}

/* --- TAB: LDAP Mappings --- */
async function loadAdminLdapMappings() {
  const tbody = document.getElementById('admin-mappings-table-body');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Lade Mappings...</td></tr>';

  try {
    const res = await fetch('api/admin/ldap-mappings');
    const mappings = await res.json();

    tbody.innerHTML = '';
    mappings.forEach(map => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:monospace; font-size:0.8rem;">${map.ldap_group_dn}</td>
        <td><span class="user-badge" style="font-size:0.8rem; background:var(--accent-glow); color:var(--accent-color);">${map.local_group}</span></td>
        <td class="actions-cell">
          <button class="btn btn-danger btn-icon" onclick="deleteLdapMapping(${map.id})" title="Löschen"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--error-color);">Fehler beim Laden: ${err.message}</td></tr>`;
  }
}

function openMappingForm() {
  document.getElementById('mapping-form').reset();
  openModal('mapping-modal');
}

async function saveMappingForm(e) {
  e.preventDefault();
  const body = {
    ldap_group_dn: document.getElementById('map_ldap_dn').value.trim(),
    local_group: document.getElementById('map_local_group').value.trim()
  };

  try {
    const res = await fetch('api/admin/ldap-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal('mapping-modal');
      showAdminAlert('Gruppen-Mapping hinzugefügt.');
      loadAdminLdapMappings();
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function deleteLdapMapping(id) {
  if (!confirm('Mapping löschen?')) return;
  try {
    const res = await fetch(`api/admin/ldap-mappings/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showAdminAlert('Mapping gelöscht.');
      loadAdminLdapMappings();
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

/* --- TAB: Benutzerverwaltung --- */
async function loadAdminUsers() {
  const tbody = document.getElementById('admin-users-table-body');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Lade Benutzer...</td></tr>';

  try {
    const res = await fetch('api/admin/users');
    const users = await res.json();

    tbody.innerHTML = '';
    users.forEach(user => {
      const typeLabel = user.is_ldap === 1 
        ? '<span class="user-badge" style="font-size:0.75rem; background:rgba(251,191,36,0.1); color:var(--warn-color);"><i class="fa-solid fa-network-wired"></i> LDAP</span>' 
        : '<span class="user-badge" style="font-size:0.75rem; background:rgba(74,222,128,0.1); color:var(--success-color);"><i class="fa-solid fa-database"></i> Lokal</span>';
      
      const roleLabel = user.role === 'admin' 
        ? '<strong style="color:var(--error-color);">Admin</strong>' 
        : 'Benutzer';

      const groupsStr = (user.groups || []).join(', ');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${user.username}</strong></td>
        <td>${user.email || ''}</td>
        <td>${typeLabel}</td>
        <td>${roleLabel}</td>
        <td><span style="font-size:0.8rem; color:var(--text-secondary);">${groupsStr}</span></td>
        <td style="font-size:0.8rem; color:var(--text-secondary);">${new Date(user.created_at).toLocaleDateString('de-DE')}</td>
        <td class="actions-cell">
          <button class="btn btn-secondary btn-icon" onclick="openUserForm(${JSON.stringify(user).replace(/"/g, '&quot;')})" title="Bearbeiten"><i class="fa-solid fa-user-pen"></i></button>
          ${user.is_ldap === 1 ? `<button class="btn btn-secondary btn-icon" onclick="syncLdapGroups(${user.id})" title="LDAP-Gruppen neu laden" style="color: var(--warn-color);"><i class="fa-solid fa-arrows-rotate"></i></button>` : ''}
          <button class="btn btn-danger btn-icon" onclick="deleteUser(${user.id})" title="Löschen" ${currentUser.id === user.id ? 'disabled' : ''}><i class="fa-solid fa-user-xmark"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--error-color);">Fehler beim Laden: ${err.message}</td></tr>`;
  }
}

function openUserForm(user = null) {
  document.getElementById('user-form').reset();
  document.getElementById('user-id-field').value = '';
  document.getElementById('user-modal-title').innerText = 'Neuer Benutzer';
  
  // Standardmäßig alle Felder aktivieren
  document.getElementById('user_username').disabled = false;
  document.getElementById('user_email').disabled = false;
  document.getElementById('user_password').disabled = false;
  document.getElementById('user_groups').disabled = false;
  
  document.getElementById('user_password').required = true;
  document.getElementById('user-pass-hint').style.display = 'none';
  document.getElementById('user-pass-hint').innerText = 'Leer lassen, um das Passwort nicht zu ändern.';

  if (user) {
    document.getElementById('user-id-field').value = user.id;
    document.getElementById('user-modal-title').innerText = 'Benutzer bearbeiten';
    
    document.getElementById('user_username').value = user.username;
    document.getElementById('user_username').disabled = true;
    document.getElementById('user_email').value = user.email || '';
    document.getElementById('user_role').value = user.role;
    document.getElementById('user_groups').value = (user.groups || []).join(', ');
    
    document.getElementById('user_password').required = false;
    document.getElementById('user-pass-hint').style.display = 'block';

    if (user.is_ldap === 1) {
      // LDAP-Benutzer: Nur Rolle ist editierbar!
      document.getElementById('user_email').disabled = true;
      document.getElementById('user_password').disabled = true;
      document.getElementById('user_groups').disabled = true;
      document.getElementById('user-pass-hint').innerText = 'LDAP-Benutzer: E-Mail, Passwort und Gruppen werden vom LDAP-Server bezogen.';
    }
  }

  openModal('user-modal');
}

async function saveUserForm(e) {
  e.preventDefault();
  const id = document.getElementById('user-id-field').value;
  
  const groupsRaw = document.getElementById('user_groups').value;
  const groups = groupsRaw ? groupsRaw.split(',').map(g => g.trim()).filter(g => g) : [];

  const body = {
    username: document.getElementById('user_username').value.trim(),
    email: document.getElementById('user_email').value.trim(),
    role: document.getElementById('user_role').value,
    groups: groups,
    password: document.getElementById('user_password').value
  };

  const url = id ? `api/admin/users/${id}` : 'api/admin/users';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    if (res.ok) {
      closeModal('user-modal');
      showAdminAlert(id ? 'Benutzer aktualisiert.' : 'Benutzer erfolgreich angelegt.');
      loadAdminUsers();
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function syncLdapGroups(userId) {
  try {
    const btn = document.querySelector(`button[onclick="syncLdapGroups(${userId})"]`);
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      btn.disabled = true;
    }

    const res = await fetch(`api/admin/users/${userId}/sync-ldap`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      showAdminAlert('LDAP-Sicherheitsgruppen erfolgreich aktualisiert.');
      loadAdminUsers();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Synchronisieren: ' + err.message);
    loadAdminUsers();
  }
}

async function deleteUser(id) {
  if (!confirm('Diesen Benutzer wirklich löschen?')) return;
  try {
    const res = await fetch(`api/admin/users/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showAdminAlert('Benutzer gelöscht.');
      loadAdminUsers();
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

/* --- TAB: System & Updater --- */
function loadSystemInfo() {
  document.getElementById('info-node-version').innerText = 'v22.20.0'; // Statisch oder von API
}

async function triggerSystemUpdate() {
  if (!confirm('WARNUNG: Das System lädt das neueste Update direkt von GitHub, installiert Pakete, migriert die Datenbank und startet sich neu. Sind Sie sicher?')) return;

  const btn = document.getElementById('update-system-btn');
  const loader = document.getElementById('update-loader');

  btn.disabled = true;
  loader.style.display = 'flex';

  try {
    const res = await fetch('api/admin/system/update', { method: 'POST' });
    const data = await res.json();
    
    if (res.ok) {
      showAdminAlert(data.message, 'success');
      
      // Nach 10 Sekunden die Seite neu laden, um die neue Instanz zu prüfen
      setTimeout(() => {
        window.location.reload();
      }, 15000);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
    btn.disabled = false;
    loader.style.display = 'none';
  }
}

/* ==========================================================================
   7. Tooltips (Custom)
   ========================================================================== */
function initTooltips() {
  const tooltip = document.getElementById('tooltip');
  
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-toggle="tooltip"]');
    if (!target) return;

    const title = target.getAttribute('title');
    if (!title) return;

    tooltip.innerText = title;
    tooltip.style.opacity = '1';
    
    // Position berechnen
    const rect = target.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8 + window.scrollY}px`;
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-toggle="tooltip"]');
    if (target) {
      tooltip.style.opacity = '0';
    }
  });
}
