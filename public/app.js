// Globaler Anwendungsstatus
let currentUser = null;
let activeTheme = 'dark';

/**
 * Hilfsfunktion zum sauberen Rendern von Icons (Bootstrap Icons und FontAwesome).
 */
function renderIcon(icon) {
  if (!icon) return '<i class="fa-solid fa-cubes"></i>';
  if (icon.startsWith('bi-')) {
    return `<i class="bi ${icon}"></i>`;
  }
  // Wenn bereits mehrere Klassen angegeben sind (z.B. "fa-solid fa-graduation-cap")
  if (icon.includes(' ')) {
    return `<i class="${icon}"></i>`;
  }
  // Wenn es eine Standard-FontAwesome Klasse wie fa-solid/fa-regular/fa-brands ist
  if (icon.startsWith('fa-solid') || icon.startsWith('fa-regular') || icon.startsWith('fa-brands')) {
    return `<i class="${icon}"></i>`;
  }
  // Fallback bei einfachem Namen
  if (icon.startsWith('fa-')) {
    return `<i class="fa-solid ${icon}"></i>`;
  }
  return `<i class="fa-solid ${icon}"></i>`;
}

// DOM-Elemente
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

  // News-Nachrichten laden und rendern
  await loadActiveMessages();

  // 4. URL auf Passwort-Reset-Tokens prüfen
  checkPasswordResetToken();

  // 5. URL auf OAuth-Redirects prüfen
  checkOauthRedirect();

  // 6. URL auf Schülerportal-Tokens prüfen
  checkStudentToken();

  // 7. Pico.js Gesichtserkennungs-Kaskade initialisieren
  initFaceFinder();

  // Tooltip initialisieren
  initTooltips();
});

/* ==========================================================================
   1. Theme Management (Dark / Light Mode)
   ========================================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
}

function toggleTheme() {
  const newTheme = activeTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

function setTheme(theme) {
  activeTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);

  const icon = theme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  const btnAnon = document.getElementById('theme-toggle-anon');
  const btnAuth = document.getElementById('theme-toggle-auth');
  if (btnAnon) btnAnon.innerHTML = icon;
  if (btnAuth) btnAuth.innerHTML = icon;
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
      clearStudentViewDOM();
      renderAnonymousHeader();
    }
  } catch (err) {
    console.error('Fehler bei der Authentifizierungsprüfung:', err);
    renderAnonymousHeader();
  }
}

function renderAuthenticatedHeader() {
  const isStudent = currentUser.groups && currentUser.groups.includes('Schueler');

  const headerAnon = document.getElementById('header-anonymous');
  const headerAuth = document.getElementById('header-authenticated');
  if (headerAnon) headerAnon.style.display = 'none';
  if (headerAuth) headerAuth.style.display = 'flex';

  // Fallback initial
  document.getElementById('header-full-name').innerText = currentUser.username;
  document.getElementById('header-user-avatar').src = 'media/user.png';

  // Render Admin Button right container if admin
  renderAdminButton();

  // Load student profile details
  if (isStudent) {
    loadStudentProfile();
  }
}

function renderAdminButton() {
  const container = document.getElementById('admin-btn-container');
  if (!container) return;

  const isAdmin = currentUser.role === 'admin';
  if (isAdmin) {
    container.innerHTML = `
      <button class="btn btn-secondary" onclick="openAdminView()">
        <i class="fa-solid fa-screwdriver-wrench"></i> Admin-Bereich
      </button>
    `;
  } else {
    container.innerHTML = '';
  }
}

function renderAnonymousHeader() {
  const headerAnon = document.getElementById('header-anonymous');
  const headerAuth = document.getElementById('header-authenticated');
  if (headerAnon) headerAnon.style.display = 'flex';
  if (headerAuth) headerAuth.style.display = 'none';
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
      await loadActiveMessages();
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
      clearStudentViewDOM();
      renderAnonymousHeader();
      closeAdminView();
      closeStudentView();
      closeCardView();
      await loadTiles();
      await loadActiveMessages();
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
      tileCard.id = `tile-card-${tile.id}`;
      
      const isLocked = tile.is_time_locked === 1;
      const isSph = tile.link && tile.link.includes('login.schulportal.hessen.de');
      
      if (isLocked) {
        tileCard.className = 'tile-card glass-panel time-locked';
        tileCard.onclick = function(e) { e.preventDefault(); return false; };
      } else {
        tileCard.className = 'tile-card glass-panel';
        // SSO-Gateway Link als Href nutzen
        tileCard.href = `api/tiles/sso/${tile.id}`;
        
        if (isSph) {
          tileCard.onclick = function(e) {
            handleSphClick(e, tile.id);
          };
        }
      }
      
      const keyBtnHtml = (isSph && currentUser) 
        ? `<button class="tile-key-btn" onclick="openSphCredentialsModal(event, ${tile.id})" title="Schulportal-Zugangsdaten verknüpfen"><i class="fa-solid fa-link"></i></button>`
        : '';
      
      tileCard.innerHTML = `
        <div class="tile-header">
          <div class="tile-icon-wrapper">
            ${renderIcon(tile.icon)}
          </div>
          <div style="display: flex; align-items: center; gap: 10px; z-index: 5;">
            ${keyBtnHtml}
            <div class="status-dot" id="status-dot-${tile.id}" data-toggle="tooltip" title="Wird geprüft..."></div>
          </div>
        </div>
        <div class="tile-body">
          <h4 class="tile-title">${tile.title}</h4>
          <div class="tile-bottom-content">
            <p class="tile-description">${tile.description || ''}</p>
            <div class="unavailable-label"><i class="fa-solid fa-circle-exclamation"></i> Dienst momentan nicht verfügbar.</div>
            <div class="time-locked-label"><i class="fa-solid fa-lock"></i> Aktiv von ${tile.time_limit_start || '08:00'} bis ${tile.time_limit_end || '16:00'} Uhr</div>
          </div>
        </div>
        <div class="tile-bg-glow"></div>
      `;

      tilesContainer.appendChild(tileCard);

      // Statusprüfung asynchron starten (CORS-gesichert über MSO-Cloud Checker)
      if (isLocked) {
        const dot = document.getElementById(`status-dot-${tile.id}`);
        if (dot) {
          dot.className = 'status-dot';
          dot.setAttribute('title', 'Dienst aktuell im gesperrten Zeitraum');
        }
      } else {
        checkTileStatus(tile.id, tile.link);
      }
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

  // Falls der Link ein direkter Moodle OAuth2-Login-Link ist, pinge das Moodle-Hauptverzeichnis an
  // (da der direkte Login-Link ohne Session-Kontext zu einem Redirect/Fehler im externen Checker führt)
  let pingLink = link;
  if (link && link.includes('/auth/oauth2/login.php')) {
    pingLink = link.split('/auth/oauth2/login.php')[0] + '/';
  }

  // Verwende dieselbe API wie im Original, aber mit vollem Pfad gegen CORS (oder Proxy)
  const checkerUrl = `https://cloud.mso-hef.de/launcher/check_links.php?link=${encodeURIComponent(pingLink)}`;

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

// Schließen per Klick außerhalb des Modals oder Dropdowns
window.onclick = function(event) {
  if (event.target.classList.contains('modal')) {
    event.target.style.display = 'none';
  }
  
  // User Dropdown schließen bei Klick außerhalb
  const dropdown = document.getElementById('header-user-dropdown');
  if (dropdown && dropdown.style.display === 'block') {
    const trigger = document.getElementById('header-user-display-name');
    const avatar = document.querySelector('.user-avatar-circle');
    if (trigger && avatar && !trigger.contains(event.target) && !avatar.contains(event.target)) {
      dropdown.style.display = 'none';
    }
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
  } else if (tabId === 'tab-ldap' || tabId === 'tab-smtp' || tabId === 'tab-mysql') {
    loadAdminConfig();
  } else if (tabId === 'tab-oauth') {
    loadOauthClientConfig();
  } else if (tabId === 'tab-mapping') {
    loadAdminLdapMappings();
  } else if (tabId === 'tab-users') {
    loadAdminUsers();
  } else if (tabId === 'tab-messages') {
    loadAdminMessages();
  } else if (tabId === 'tab-system') {
    loadSystemInfo();
  } else if (tabId === 'tab-logs') {
    loadAdminLogs();
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
  'bi-vector-pen', 'bi-wrench-adjustable-circle-fill', 'bi-pc-display-horizontal', 'bi-activity',
  // FontAwesome Icons aus lobby.php hinzufügen
  'fa-solid fa-graduation-cap', 'fa-solid fa-ticket', 'fa-solid fa-brain', 'fa-solid fa-calendar-check',
  'fa-regular fa-folder-open', 'fa-brands fa-windows', 'fa-regular fa-envelope', 'fa-regular fa-calendar',
  'fa-regular fa-calendar-xmark', 'fa-solid fa-calendar-days', 'fa-solid fa-person-circle-plus',
  'fa-solid fa-virus', 'fa-solid fa-school', 'fa-solid fa-chalkboard-user', 'fa-solid fa-id-badge',
  'fa-solid fa-gavel', 'fa-solid fa-phone'
];

function initIconPicker(selectedIcon = 'bi-link-45deg') {
  const grid = document.getElementById('tile-icon-picker-grid');
  grid.innerHTML = '';
  
  POPULAR_ICONS.forEach(icon => {
    const item = document.createElement('div');
    item.className = `icon-picker-item ${icon === selectedIcon ? 'active' : ''}`;
    item.innerHTML = renderIcon(icon);
    item.title = icon;
    item.onclick = () => {
      document.querySelectorAll('#tile-icon-picker-grid .icon-picker-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('tile_icon').value = icon;
      document.getElementById('tile-icon-preview').innerHTML = renderIcon(icon);
    };
    grid.appendChild(item);
  });

  document.getElementById('tile_icon').value = selectedIcon;
  document.getElementById('tile-icon-preview').innerHTML = renderIcon(selectedIcon);
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
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Lade Dienste...</td></tr>';

  try {
    const res = await fetch('api/admin/tiles');
    const tiles = await res.json();
    
    tbody.innerHTML = '';
    tiles.forEach(tile => {
      const allowedGroups = JSON.parse(tile.allowed_groups || '[]');
      const groupsLabel = tile.visibility === 'groups' ? ` (${allowedGroups.join(', ')})` : '';
      
      const timeLockBadge = tile.time_limit_enabled === 1 
        ? ` <span class="user-badge" style="font-size:0.7rem; background:rgba(245,158,11,0.1); color:var(--warn-color); display:inline-flex; align-items:center; gap:3px;" title="Zeitsperre aktiv: ${tile.time_limit_start} - ${tile.time_limit_end} Uhr"><i class="fa-solid fa-lock"></i> ${tile.time_limit_start}-${tile.time_limit_end}</span>`
        : '';

      const tr = document.createElement('tr');
      tr.setAttribute('draggable', 'true');
      tr.dataset.id = tile.id;
      tr.style.transition = 'background-color 0.2s ease';
      
      tr.innerHTML = `
        <td style="text-align:center; padding: 12px 6px;"><i class="fa-solid fa-grip-vertical drag-handle-grip" style="cursor: grab; color: var(--text-secondary); opacity: 0.5; font-size:1.1rem;" title="Reihenfolge per Drag & Drop verschieben"></i></td>
        <td><strong>${tile.title}</strong>${timeLockBadge}</td>
        <td style="font-size:0.8rem; color:var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tile.description || ''}</td>
        <td style="font-size: 1.25rem;">${renderIcon(tile.icon)}</td>
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

    // Drag & Drop Event-Listeners registrieren
    let dragEl = null;

    tbody.addEventListener('dragstart', (e) => {
      dragEl = e.target.closest('tr');
      if (dragEl) {
        dragEl.classList.add('dragging');
        dragEl.style.opacity = '0.4';
        dragEl.style.background = 'rgba(255, 255, 255, 0.08)';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragEl.dataset.id);
      }
    });

    tbody.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('tr');
      if (target && target !== dragEl && target.parentNode === tbody) {
        const bounding = target.getBoundingClientRect();
        const offset = e.clientY - bounding.top - bounding.height / 2;
        if (offset > 0) {
          tbody.insertBefore(dragEl, target.nextSibling);
        } else {
          tbody.insertBefore(dragEl, target);
        }
      }
    });

    tbody.addEventListener('dragend', async (e) => {
      if (dragEl) {
        dragEl.classList.remove('dragging');
        dragEl.style.opacity = '';
        dragEl.style.background = '';
      }
      
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const order = rows.map((tr, index) => ({
        id: parseInt(tr.dataset.id, 10),
        sort_order: index + 1
      })).filter(item => !isNaN(item.id));

      try {
        const res = await fetch('api/admin/tiles/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order })
        });
        const result = await res.json();
        if (result.success) {
          showAdminAlert('Reihenfolge erfolgreich aktualisiert.', 'success');
          // Update order number column in real time without full reloading
          rows.forEach((tr, index) => {
            const orderCell = tr.cells[6];
            if (orderCell) orderCell.innerText = index + 1;
          });
        } else {
          showAdminAlert('Fehler beim Speichern: ' + result.error, 'danger');
        }
      } catch (err) {
        showAdminAlert('Netzwerkfehler beim Speichern: ' + err.message, 'danger');
      }
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--error-color);">Fehler beim Laden: ${err.message}</td></tr>`;
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
    
    document.getElementById('tile_time_limit_enabled').checked = tile.time_limit_enabled === 1;
    document.getElementById('tile_time_limit_start').value = tile.time_limit_start || '08:00';
    document.getElementById('tile_time_limit_end').value = tile.time_limit_end || '16:00';
  } else {
    document.getElementById('tile_time_limit_enabled').checked = false;
    document.getElementById('tile_time_limit_start').value = '08:00';
    document.getElementById('tile_time_limit_end').value = '16:00';
  }

  // Initialisiere die premium icon & group Selectors
  initIconPicker(selectedIcon);
  loadGroupCheckboxes(allowedGroups);

  toggleTileGroupsSelect();
  toggleTileSsoFields();
  toggleTileTimeFields();
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

function toggleTileTimeFields() {
  const enabled = document.getElementById('tile_time_limit_enabled').checked;
  const fields = document.getElementById('tile-time-fields');
  fields.style.display = enabled ? 'flex' : 'none';
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
    sso_key: document.getElementById('tile_sso_key').value.trim(),
    time_limit_enabled: document.getElementById('tile_time_limit_enabled').checked ? 1 : 0,
    time_limit_start: document.getElementById('tile_time_limit_start').value,
    time_limit_end: document.getElementById('tile_time_limit_end').value
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

/* --- TABS: Config (LDAP, SMTP & MySQL) --- */
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

    // MySQL Felder
    document.getElementById('mysql_enabled').checked = cfg.mysql_enabled === '1';
    document.getElementById('mysql_host').value = cfg.mysql_host || '';
    document.getElementById('mysql_port').value = cfg.mysql_port || '3306';
    document.getElementById('mysql_user').value = cfg.mysql_user || 'root';
    document.getElementById('mysql_password').value = cfg.mysql_password || '';
    document.getElementById('mysql_database').value = cfg.mysql_database || 'digitale_anmeldung';

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

async function saveMysqlConfig(e) {
  e.preventDefault();
  const body = {
    mysql_enabled: document.getElementById('mysql_enabled').checked ? '1' : '0',
    mysql_host: document.getElementById('mysql_host').value.trim(),
    mysql_port: document.getElementById('mysql_port').value,
    mysql_user: document.getElementById('mysql_user').value.trim(),
    mysql_password: document.getElementById('mysql_password').value,
    mysql_database: document.getElementById('mysql_database').value.trim()
  };

  try {
    const res = await fetch('api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showAdminAlert('MySQL-Konfiguration erfolgreich gespeichert.');
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

async function testMysqlConnection() {
  const body = {
    mysql_host: document.getElementById('mysql_host').value.trim(),
    mysql_port: document.getElementById('mysql_port').value,
    mysql_user: document.getElementById('mysql_user').value.trim(),
    mysql_password: document.getElementById('mysql_password').value,
    mysql_database: document.getElementById('mysql_database').value.trim()
  };

  showAdminAlert('Teste MySQL-Verbindung...', 'warning');

  try {
    const res = await fetch('api/admin/config/test-mysql', {
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

/* --- TAB: System-Protokolle (Audit Log) --- */
let allAdminLogs = [];

async function loadAdminLogs() {
  const tableBody = document.getElementById('admin-logs-table-body');
  tableBody.innerHTML = `
    <tr>
      <td colspan="6" style="text-align:center; padding:30px; color:var(--text-secondary);">
        <i class="fa-solid fa-spinner fa-spin fa-xl" style="color:var(--accent-color); margin-bottom:10px; display:block;"></i>
        Lade Protokolle...
      </td>
    </tr>
  `;

  try {
    const res = await fetch('api/admin/logs');
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Fehler beim Laden der Protokolle');
    }
    allAdminLogs = await res.json();
    
    // Filterwerte zurücksetzen
    document.getElementById('log-filter-level').value = 'all';
    document.getElementById('log-search').value = '';
    
    renderAdminLogs(allAdminLogs);
  } catch (err) {
    showAdminAlert(err.message, 'danger');
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:30px; color:var(--danger-color);">
          <i class="fa-solid fa-triangle-exclamation fa-xl" style="margin-bottom:10px; display:block;"></i>
          Fehler beim Laden der Protokolle: ${err.message}
        </td>
      </tr>
    `;
  }
}

function renderAdminLogs(logs) {
  const tableBody = document.getElementById('admin-logs-table-body');
  
  if (!logs || logs.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:35px; color:var(--text-secondary);">
          Keine System-Protokolle vorhanden.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = logs.map(log => {
    // Level badge (ultra-robust inline styles to avoid conflicts)
    let levelBadge = '';
    if (log.level === 'error') {
      levelBadge = `
        <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(239, 68, 68, 0.12) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
          <i class="fa-solid fa-circle-xmark" style="font-size: 0.85rem !important; margin: 0 !important; color: #ef4444 !important; display: inline-block !important; line-height: 1 !important;"></i>
          <span style="color: #ef4444 !important; line-height: 1 !important; font-weight: 600 !important;">Error</span>
        </span>
      `;
    } else if (log.level === 'warn') {
      levelBadge = `
        <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(245, 158, 11, 0.12) !important; color: #f59e0b !important; border: 1px solid rgba(245, 158, 11, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
          <i class="fa-solid fa-circle-exclamation" style="font-size: 0.85rem !important; margin: 0 !important; color: #f59e0b !important; display: inline-block !important; line-height: 1 !important;"></i>
          <span style="color: #f59e0b !important; line-height: 1 !important; font-weight: 600 !important;">Warn</span>
        </span>
      `;
    } else {
      levelBadge = `
        <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(16, 185, 129, 0.12) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
          <i class="fa-solid fa-circle-info" style="font-size: 0.85rem !important; margin: 0 !important; color: #10b981 !important; display: inline-block !important; line-height: 1 !important;"></i>
          <span style="color: #10b981 !important; line-height: 1 !important; font-weight: 600 !important;">Info</span>
        </span>
      `;
    }

    // Details button is ALWAYS enabled so long messages can be read in full
    const detailBtn = `
      <button class="btn btn-secondary btn-sm" style="padding:4px 8px; display:inline-flex; align-items:center; justify-content:center;" onclick="openLogDetails(${log.id})">
        <i class="fa-solid fa-magnifying-glass"></i>
      </button>
    `;

    // Format created_at to local date/time beautifully
    let dateStr = log.created_at;
    try {
      const date = new Date(log.created_at + (log.created_at.includes('Z') ? '' : 'Z')); // Ensure UTC parsing
      dateStr = date.toLocaleString('de-DE', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
    } catch(e) {}

    return `
      <tr>
        <td style="font-size:0.9rem; font-weight:500;">${dateStr}</td>
        <td>${levelBadge}</td>
        <td><code style="color:var(--warn-color); font-weight:600; font-family:monospace; font-size:0.85rem;">${log.action}</code></td>
        <td style="font-size:0.9rem; font-weight:normal; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.message}">${log.message}</td>
        <td><code style="font-family:monospace; font-size:0.85rem;">${log.ip || '-'}</code></td>
        <td style="text-align:center;">${detailBtn}</td>
      </tr>
    `;
  }).join('');
}

function filterAdminLogs() {
  const levelFilter = document.getElementById('log-filter-level').value;
  const searchFilter = document.getElementById('log-search').value.toLowerCase().trim();

  const filtered = allAdminLogs.filter(log => {
    // Level match
    const levelMatch = (levelFilter === 'all' || log.level === levelFilter);
    
    // Search match
    const searchMatch = !searchFilter || 
      log.action.toLowerCase().includes(searchFilter) ||
      log.message.toLowerCase().includes(searchFilter) ||
      (log.ip && log.ip.toLowerCase().includes(searchFilter)) ||
      (log.details && log.details.toLowerCase().includes(searchFilter));

    return levelMatch && searchMatch;
  });

  renderAdminLogs(filtered);
}

function openLogDetails(id) {
  const log = allAdminLogs.find(l => l.id === id);
  if (!log) return;

  // Set general info
  let dateStr = log.created_at;
  try {
    const date = new Date(log.created_at + (log.created_at.includes('Z') ? '' : 'Z'));
    dateStr = date.toLocaleString('de-DE');
  } catch(e) {}

  document.getElementById('log-details-time').innerText = dateStr;
  document.getElementById('log-details-action').innerText = log.action;
  document.getElementById('log-details-ip').innerText = log.ip || '-';
  document.getElementById('log-details-message').innerText = log.message;

  // Badge in modal
  const modalBadge = document.getElementById('log-details-level-badge');
  if (log.level === 'error') {
    modalBadge.innerHTML = `
      <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(239, 68, 68, 0.12) !important; color: #ef4444 !important; border: 1px solid rgba(239, 68, 68, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
        <i class="fa-solid fa-circle-xmark" style="font-size: 0.85rem !important; margin: 0 !important; color: #ef4444 !important; display: inline-block !important; line-height: 1 !important;"></i>
        <span style="color: #ef4444 !important; line-height: 1 !important; font-weight: 600 !important;">Error</span>
      </span>
    `;
  } else if (log.level === 'warn') {
    modalBadge.innerHTML = `
      <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(245, 158, 11, 0.12) !important; color: #f59e0b !important; border: 1px solid rgba(245, 158, 11, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 0.85rem !important; margin: 0 !important; color: #f59e0b !important; display: inline-block !important; line-height: 1 !important;"></i>
        <span style="color: #f59e0b !important; line-height: 1 !important; font-weight: 600 !important;">Warn</span>
      </span>
    `;
  } else {
    modalBadge.innerHTML = `
      <span style="display: inline-flex !important; align-items: center !important; flex-direction: row !important; gap: 6px !important; background: rgba(16, 185, 129, 0.12) !important; color: #10b981 !important; border: 1px solid rgba(16, 185, 129, 0.25) !important; padding: 4px 8px !important; border-radius: 4px !important; font-weight: 600 !important; font-size: 0.75rem !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; line-height: 1 !important; height: 24px !important; white-space: nowrap !important;">
        <i class="fa-solid fa-circle-info" style="font-size: 0.85rem !important; margin: 0 !important; color: #10b981 !important; display: inline-block !important; line-height: 1 !important;"></i>
        <span style="color: #10b981 !important; line-height: 1 !important; font-weight: 600 !important;">Info</span>
      </span>
    `;
  }

  // Format and highlight JSON
  const jsonElement = document.getElementById('log-details-json');
  try {
    if (!log.details || log.details === 'null' || log.details === '{}') {
      jsonElement.innerText = JSON.stringify({ "status": "Keine zusätzlichen Details für diese Protokoll-Aktion vorhanden." }, null, 2);
    } else {
      const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      jsonElement.innerText = JSON.stringify(parsed, null, 2);
    }
  } catch (e) {
    jsonElement.innerText = log.details || '{}';
  }

  openModal('log-details-modal');
}

async function clearAdminLogs() {
  if (!confirm('Sind Sie sicher, dass Sie alle System-Protokolle unwiderruflich löschen möchten?')) return;

  try {
    const res = await fetch('api/admin/logs/clear', { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      showAdminAlert(data.message || 'Protokolle erfolgreich geleert.');
      loadAdminLogs();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
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

/* ==========================================================================
   8. SPH Autologin Zugangsdaten Management
   ========================================================================== */
let activeSphTileId = null;

async function openSphCredentialsModal(event, tileId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  activeSphTileId = tileId;
  
  // Modal anzeigen und Ladestatus setzen
  document.getElementById('sph-credentials-status-loading').style.display = 'block';
  document.getElementById('sph-credentials-existing').style.display = 'none';
  document.getElementById('sph-credentials-form').style.display = 'none';
  openModal('sph-credentials-modal');

  try {
    const res = await fetch('api/auth/sph-credentials');
    const data = await res.json();

    document.getElementById('sph-credentials-status-loading').style.display = 'none';

    if (data.exists) {
      document.getElementById('sph-credentials-username-display').innerText = data.username;
      document.getElementById('sph-credentials-existing').style.display = 'block';
    } else {
      document.getElementById('sph-credentials-form').reset();
      document.getElementById('sph-credentials-form').style.display = 'block';
    }
  } catch (err) {
    console.error('Fehler beim Laden der SPH-Zugangsdaten:', err);
    alert('Fehler beim Laden des Status.');
    closeModal('sph-credentials-modal');
  }
}

async function saveSphCredentials(e) {
  e.preventDefault();
  const username = document.getElementById('sph_user').value.trim();
  const password = document.getElementById('sph_password').value;

  try {
    const res = await fetch('api/auth/sph-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sph_username: username, sph_password: password })
    });

    if (res.ok) {
      closeModal('sph-credentials-modal');
      window.location.href = `api/tiles/sso/${activeSphTileId}`;
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

async function deleteSphCredentials() {
  if (!confirm('Möchtest du deine hinterlegten Schulportal-Zugangsdaten wirklich löschen? Der automatische Login wird damit deaktiviert.')) {
    return;
  }

  try {
    const res = await fetch('api/auth/sph-credentials', {
      method: 'DELETE'
    });

    if (res.ok) {
      alert('Zugangsdaten gelöscht.');
      // Status neu abfragen, um das leere Formular-Template anzuzeigen
      await openSphCredentialsModal(null, activeSphTileId);
    } else {
      const data = await res.json();
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Löschen: ' + err.message);
  }
}

async function handleSphClick(e, tileId) {
  // 1. Wenn nicht eingeloggt in der MSO Cloud, ganz normale Weiterleitung erlauben
  if (!currentUser) {
    return;
  }

  e.preventDefault(); // Standard-Navigation unterbrechen
  
  try {
    // 2. Prüfen, ob Zugangsdaten hinterlegt sind
    const res = await fetch('api/auth/sph-credentials');
    const data = await res.json();

    if (data.exists) {
      // Zugangsdaten vorhanden -> Direkt weiterleiten (löst den Auto-POST aus!)
      window.location.href = `api/tiles/sso/${tileId}`;
      return;
    }

    // 3. Keine Zugangsdaten vorhanden -> Prüfen, ob der Info-Popup Opt-out aktiv ist
    const alwaysShow = localStorage.getItem('sph_always_show_info') !== 'false';
    if (!alwaysShow) {
      // Benutzer hat Opt-out gewählt -> Direkt zur normalen SPH-Loginseite weiterleiten
      window.location.href = `api/tiles/sso/${tileId}`;
      return;
    }

    // 4. Info-Modal anzeigen!
    activeSphTileId = tileId;
    document.getElementById('sph-info-always-show').checked = true;
    
    // Verlinkung im Modal-Text zum Öffnen des Zugangsdaten-Eingabemodals
    document.getElementById('sph-info-link-credentials').onclick = (event) => {
      closeModal('sph-info-modal');
      openSphCredentialsModal(event, tileId);
    };

    openModal('sph-info-modal');

  } catch (err) {
    console.error('Fehler bei SPH-Weiterleitungsprüfung:', err);
    // Fallback: Direkt weiterleiten
    window.location.href = `api/tiles/sso/${tileId}`;
  }
}

function proceedToSchulportal() {
  // Opt-out Checkbox Zustand sichern
  const alwaysShow = document.getElementById('sph-info-always-show').checked;
  localStorage.setItem('sph_always_show_info', alwaysShow ? 'true' : 'false');
  
  closeModal('sph-info-modal');
  window.location.href = `api/tiles/sso/${activeSphTileId}`;
}

/* ==========================================================================
   9. Dashboard News-Karussell (Messages)
   ========================================================================== */
let activeMessages = [];
let currentMessageIndex = 0;

function toggleNewsDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('news-dropdown');
  if (dropdown) {
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
  }
}

// Schließen des Dropdowns bei Klick außerhalb
window.addEventListener('click', (e) => {
  const dropdown = document.getElementById('news-dropdown');
  const btn = document.getElementById('news-bell-btn');
  if (dropdown && dropdown.style.display === 'block') {
    if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
      dropdown.style.display = 'none';
    }
  }
});

// Tastaturnavigation (Pfeiltasten) für das News-Karussell im Modal
window.addEventListener('keydown', (e) => {
  const modal = document.getElementById('news-view-modal');
  if (modal && modal.style.display === 'flex' && activeMessages.length > 1) {
    if (e.key === 'ArrowRight') {
      nextNewsSlide();
    } else if (e.key === 'ArrowLeft') {
      prevNewsSlide();
    }
  }
});

function markMessageAsSeen(messageId) {
  let seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
  if (!seenIds.includes(messageId)) {
    seenIds.push(messageId);
    localStorage.setItem('mso_seen_messages', JSON.stringify(seenIds));
    updateNewsIndicators();
  }
}

function updateNewsIndicators() {
  const seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
  const unreadCount = activeMessages.filter(msg => !msg.confirmed && !seenIds.includes(msg.id)).length;
  
  const badge = document.getElementById('news-badge');
  if (badge) {
    badge.innerText = unreadCount;
    badge.style.display = unreadCount > 0 ? 'flex' : 'none';
  }
  
  // Dropdown list indicators ebenfalls live anpassen
  renderNewsDropdownList();
}

async function loadActiveMessages() {
  try {
    const res = await fetch('api/messages');
    if (!res.ok) throw new Error('Fehler beim Laden der Nachrichten.');
    const messages = await res.json();
    
    // Gast-Bestätigungen aus localStorage markieren
    const guestConfirmedIds = JSON.parse(localStorage.getItem('mso_confirmed_messages') || '[]');
    activeMessages = messages.map(msg => {
      return {
        ...msg,
        confirmed: msg.confirmed || guestConfirmedIds.includes(msg.id)
      };
    });
    
    // Megafon-Button Sichtbarkeit steuern
    const bellWrapper = document.getElementById('news-bell-wrapper');
    if (activeMessages.length > 0) {
      if (bellWrapper) bellWrapper.style.display = 'inline-block';
    } else {
      if (bellWrapper) bellWrapper.style.display = 'none';
    }
    
    // Indikatoren & Dropdown initialisieren (berücksichtigt ungesehen/ungelesen)
    updateNewsIndicators();
    
    // Automatisches Popup bei Seitenaufruf:
    // Wird erzwungen eingeblendet, solange es mindestens eine unbestätigte Nachricht gibt
    // (d. h. eine Nachricht, bei der "Nachricht immer anzeigen" aktiv ist).
    const totalUnconfirmedCount = activeMessages.filter(msg => !msg.confirmed).length;
    
    if (totalUnconfirmedCount > 0) {
      // Bevorzuge bei der Anzeige die erste ungelesene/ungesehene Nachricht, andernfalls die erste unbestätigte
      const seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
      const firstUnseenIdx = activeMessages.findIndex(msg => !msg.confirmed && !seenIds.includes(msg.id));
      const firstUnconfirmedIdx = activeMessages.findIndex(msg => !msg.confirmed);
      
      currentMessageIndex = firstUnseenIdx !== -1 ? firstUnseenIdx : (firstUnconfirmedIdx !== -1 ? firstUnconfirmedIdx : 0);
      
      openNewsViewModal();
    }
  } catch (err) {
    console.error('Fehler beim Laden der Nachrichten:', err);
  }
}

function renderNewsDropdownList() {
  const list = document.getElementById('news-dropdown-list');
  if (!list) return;
  list.innerHTML = '';
  
  if (activeMessages.length === 0) {
    list.innerHTML = '<li class="news-dropdown-item confirmed" style="cursor: default; justify-content: center;">Keine Mitteilungen</li>';
    return;
  }
  
  const seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
  
  activeMessages.forEach(msg => {
    const li = document.createElement('li');
    li.className = 'news-dropdown-item';
    
    // Gelesen, wenn bestätigt ODER bereits gesehen
    const isRead = msg.confirmed || seenIds.includes(msg.id);
    if (isRead) {
      li.classList.add('confirmed');
    }
    
    const indicator = isRead ? '' : '<span class="dot-indicator"></span>';
    
    li.innerHTML = `
      <span class="news-title-text"><i class="fa-solid fa-bullhorn" style="font-size:0.75rem; margin-right:6px; opacity:0.7;"></i> ${escapeHtml(msg.title)}</span>
      ${indicator}
    `;
    
    li.onclick = (event) => {
      event.stopPropagation();
      document.getElementById('news-dropdown').style.display = 'none';
      
      // Modal öffnen und auf diese Nachricht fokussieren
      const idx = activeMessages.findIndex(m => m.id === msg.id);
      currentMessageIndex = idx !== -1 ? idx : 0;
      openNewsViewModal();
    };
    
    list.appendChild(li);
  });
}

function openNewsViewModal() {
  renderModalNewsCarousel();
  openModal('news-view-modal');
}

function renderModalNewsCarousel() {
  const container = document.getElementById('modal-news-carousel-container');
  if (!container) return;
  
  if (activeMessages.length === 0) {
    closeModal('news-view-modal');
    return;
  }
  
  if (currentMessageIndex >= activeMessages.length) {
    currentMessageIndex = 0;
  }
  
  // Pfeiltasten anzeigen, wenn mehr als 1 Nachricht vorhanden ist
  const showNav = activeMessages.length > 1;
  const navPrev = showNav ? `<button class="news-nav-btn prev" onclick="prevNewsSlide()"><i class="fa-solid fa-chevron-left"></i></button>` : '';
  const navNext = showNav ? `<button class="news-nav-btn next" onclick="nextNewsSlide()"><i class="fa-solid fa-chevron-right"></i></button>` : '';
  
  // Rendern der Indikator-Punkte
  let dotsHtml = '';
  if (showNav) {
    dotsHtml = `<div class="news-dots" style="margin-top: 15px;">`;
    for (let i = 0; i < activeMessages.length; i++) {
      const activeClass = i === currentMessageIndex ? 'active' : '';
      dotsHtml += `<div class="news-dot ${activeClass}" onclick="goToNewsSlide(${i})"></div>`;
    }
    dotsHtml += `</div>`;
  }
  
  // Rendern der Slides
  let slidesHtml = `<div class="news-carousel-track" style="transform: translateX(-${currentMessageIndex * 100}%);">`;
  
  activeMessages.forEach(msg => {
    // Checkbox für Nachrichten des Typs 'until_confirmation' anzeigen (opt-out: standardmäßig angehakt, wenn unbestätigt)
    const showCheckbox = msg.type === 'until_confirmation';
    const optOutCheckbox = showCheckbox 
      ? `<label class="news-always-show-label">
           <input type="checkbox" onchange="toggleMessageConfirmation(event, ${msg.id})" ${msg.confirmed ? '' : 'checked'}>
           <span>Nachricht immer anzeigen</span>
         </label>`
      : '';
      
    slidesHtml += `
      <div class="news-slide">
        <h4 class="news-title" style="font-size: 1.3rem;">
          <i class="fa-solid fa-bullhorn"></i> ${escapeHtml(msg.title)}
        </h4>
        <div class="news-body" style="max-height: 280px; overflow-y: auto; padding: 10px 0;">
          ${msg.content}
        </div>
        <div class="news-footer" style="min-height: 40px;">
          ${optOutCheckbox}
        </div>
      </div>
    `;
  });
  
  slidesHtml += `</div>`;
  
  container.innerHTML = `
    ${navPrev}
    ${slidesHtml}
    ${navNext}
    ${dotsHtml}
  `;
  
  // Markiere die aktuell gezeigte Nachricht als gesehen
  if (activeMessages[currentMessageIndex]) {
    markMessageAsSeen(activeMessages[currentMessageIndex].id);
  }
}

function prevNewsSlide() {
  if (activeMessages.length <= 1) return;
  currentMessageIndex = (currentMessageIndex - 1 + activeMessages.length) % activeMessages.length;
  updateNewsSlidePosition();
}

function nextNewsSlide() {
  if (activeMessages.length <= 1) return;
  currentMessageIndex = (currentMessageIndex + 1) % activeMessages.length;
  updateNewsSlidePosition();
}

function goToNewsSlide(index) {
  if (index < 0 || index >= activeMessages.length) return;
  currentMessageIndex = index;
  updateNewsSlidePosition();
}

function updateNewsSlidePosition() {
  const track = document.querySelector('#modal-news-carousel-container .news-carousel-track');
  if (track) {
    track.style.transform = `translateX(-${currentMessageIndex * 100}%)`;
  }
  
  // Indikatoren aktualisieren
  const dots = document.querySelectorAll('#modal-news-carousel-container .news-dot');
  dots.forEach((dot, idx) => {
    if (idx === currentMessageIndex) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
  
  // Markiere die neu angezeigte Nachricht als gesehen
  if (activeMessages[currentMessageIndex]) {
    markMessageAsSeen(activeMessages[currentMessageIndex].id);
  }
}

async function toggleMessageConfirmation(event, messageId) {
  const isChecked = event.target.checked;
  
  try {
    // Wenn unchecked (also opt-out / "Nicht mehr anzeigen"): confirm
    // Wenn checked (also opt-in / "Nachricht immer anzeigen"): unconfirm
    const action = isChecked ? 'unconfirm' : 'confirm';
    const res = await fetch(`api/messages/${messageId}/${action}`, {
      method: 'POST'
    });
    
    const data = await res.json();
    
    if (data.success) {
      if (data.guest) {
        // Für Gäste im localStorage regeln
        const guestConfirmedIds = JSON.parse(localStorage.getItem('mso_confirmed_messages') || '[]');
        if (!isChecked) {
          // Confirm -> Hinzufügen
          if (!guestConfirmedIds.includes(messageId)) {
            guestConfirmedIds.push(messageId);
          }
        } else {
          // Unconfirm -> Entfernen
          const idx = guestConfirmedIds.indexOf(messageId);
          if (idx !== -1) {
            guestConfirmedIds.splice(idx, 1);
          }
          
          // Auch aus seen entfernen, damit wieder als ungelesen markiert
          let seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
          const sIdx = seenIds.indexOf(messageId);
          if (sIdx !== -1) {
            seenIds.splice(sIdx, 1);
            localStorage.setItem('mso_seen_messages', JSON.stringify(seenIds));
          }
        }
        localStorage.setItem('mso_confirmed_messages', JSON.stringify(guestConfirmedIds));
      } else {
        // Für angemeldete Nutzer: Wenn wieder aktiviert, auch aus seen entfernen
        if (isChecked) {
          let seenIds = JSON.parse(localStorage.getItem('mso_seen_messages') || '[]');
          const sIdx = seenIds.indexOf(messageId);
          if (sIdx !== -1) {
            seenIds.splice(sIdx, 1);
            localStorage.setItem('mso_seen_messages', JSON.stringify(seenIds));
          }
        }
      }
      
      // Quittierungsstatus im aktuellen Array lokal aktualisieren
      const msg = activeMessages.find(m => m.id === messageId);
      if (msg) msg.confirmed = !isChecked; // confirmed = true, wenn checkbox UNCHECKED (isChecked = false)
      
      // Badge und Dropdown-Menü live über zentralisierte Funktion aktualisieren
      updateNewsIndicators();
      
      // Slide weiterblättern oder Modal schließen nach einer kurzen Verzögerung, wenn uncheck (gelesen)
      if (!isChecked) {
        setTimeout(() => {
          const remainingUnconfirmed = activeMessages.filter(m => !m.confirmed);
          if (remainingUnconfirmed.length === 0) {
            closeModal('news-view-modal');
          } else {
            // Zum nächsten unbestätigten Slide wechseln
            const nextIdx = activeMessages.findIndex(m => m.id === remainingUnconfirmed[0].id);
            currentMessageIndex = nextIdx !== -1 ? nextIdx : 0;
            renderModalNewsCarousel();
          }
        }, 500); // 500ms Verzögerung für ein schönes visuelles Feedback
      }
    } else {
      throw new Error(data.error || 'Fehler beim Ändern des Bestätigungsstatus.');
    }
  } catch (err) {
    console.error('Fehler beim Ändern des Bestätigungsstatus:', err);
    alert('Fehler: ' + err.message);
    // Zustand der Checkbox zurücksetzen bei Fehler
    event.target.checked = !isChecked;
  }
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ==========================================================================
   10. Admin Nachrichten-Verwaltung (News)
   ========================================================================== */
async function loadAdminMessages() {
  try {
    const res = await fetch('api/admin/messages');
    if (!res.ok) throw new Error('Fehler beim Laden der Nachrichten.');
    const messages = await res.json();
    
    const tbody = document.getElementById('admin-messages-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (messages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary);">Keine Nachrichten vorhanden.</td></tr>';
      return;
    }
    
    messages.forEach(msg => {
      const typeLabel = msg.type === 'temporary' 
        ? '<span class="badge badge-info">Zeitgesteuert</span>' 
        : '<span class="badge badge-warning">Bis Bestätigung</span>';
        
      const timeSpan = msg.type === 'temporary'
        ? `${formatDateTime(msg.start_date)} bis ${formatDateTime(msg.end_date)}`
        : '<span style="color: var(--text-secondary); font-size: 0.85rem;">Permanente Anzeige bis Klick</span>';
        
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--accent-color);">${escapeHtml(msg.title)}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(msg.content.replace(/<[^>]*>/g, ''))}</td>
        <td>${typeLabel}</td>
        <td>${timeSpan}</td>
        <td>${formatDateTime(msg.created_at)}</td>
        <td>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary btn-sm" onclick="editMessage(${msg.id})" title="Bearbeiten">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteMessage(${msg.id})" title="Löschen">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Fehler beim Laden der Admin-Nachrichten:', err);
    showAdminAlert('Fehler: ' + err.message, 'danger');
  }
}

function openMessageForm() {
  document.getElementById('message_id').value = '';
  document.getElementById('message-form').reset();
  document.getElementById('message-modal-title').innerHTML = '<i class="fa-solid fa-bullhorn" style="color: var(--accent-color);"></i> Nachricht erstellen';
  
  // WYSIWYG Editor Zurücksetzen
  isSourceView = false;
  const wysiwyg = document.getElementById('editor-wysiwyg');
  const textarea = document.getElementById('message_content');
  const btn = document.getElementById('editor-source-btn');
  
  if (wysiwyg) {
    wysiwyg.innerHTML = '';
    wysiwyg.style.display = 'block';
  }
  if (textarea) textarea.style.display = 'none';
  if (btn) btn.classList.remove('active');
  
  // Start- und Endzeitpunkt auf jetzt + 7 Tage als Vorschlag setzen für den Typ "temporary"
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  // datetime-local verlangt YYYY-MM-DDTHH:MM
  const formatInputDate = (d) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  
  document.getElementById('message_start_date').value = formatInputDate(now);
  document.getElementById('message_end_date').value = formatInputDate(nextWeek);
  
  toggleMessageTimeFields();
  openModal('message-modal');
}

async function editMessage(id) {
  try {
    const res = await fetch('api/admin/messages');
    if (!res.ok) throw new Error('Fehler beim Laden der Nachrichtendaten.');
    const messages = await res.json();
    const msg = messages.find(m => m.id === id);
    
    if (!msg) throw new Error('Nachricht nicht gefunden.');
    
    document.getElementById('message_id').value = msg.id;
    document.getElementById('message_title').value = msg.title;
    document.getElementById('message_content').value = msg.content;
    document.getElementById('message_type').value = msg.type;
    
    // WYSIWYG Editor Befüllen
    isSourceView = false;
    const wysiwyg = document.getElementById('editor-wysiwyg');
    const textarea = document.getElementById('message_content');
    const btn = document.getElementById('editor-source-btn');
    
    if (wysiwyg) {
      wysiwyg.innerHTML = msg.content || '';
      wysiwyg.style.display = 'block';
    }
    if (textarea) textarea.style.display = 'none';
    if (btn) btn.classList.remove('active');
    
    document.getElementById('message_start_date').value = msg.start_date || '';
    document.getElementById('message_end_date').value = msg.end_date || '';
    
    document.getElementById('message-modal-title').innerHTML = '<i class="fa-solid fa-bullhorn" style="color: var(--accent-color);"></i> Nachricht bearbeiten';
    
    toggleMessageTimeFields();
    openModal('message-modal');
  } catch (err) {
    alert('Fehler beim Laden der Nachrichtendaten: ' + err.message);
  }
}

function toggleMessageTimeFields() {
  const type = document.getElementById('message_type').value;
  const timeFields = document.getElementById('message-time-fields');
  
  if (type === 'temporary') {
    timeFields.style.display = 'grid';
    document.getElementById('message_start_date').required = true;
    document.getElementById('message_end_date').required = true;
  } else {
    timeFields.style.display = 'none';
    document.getElementById('message_start_date').required = false;
    document.getElementById('message_end_date').required = false;
  }
}

async function saveMessageForm(e) {
  e.preventDefault();
  
  // WYSIWYG mit Textarea synchronisieren vor dem Speichern
  if (!isSourceView) {
    const wysiwyg = document.getElementById('editor-wysiwyg');
    if (wysiwyg) {
      document.getElementById('message_content').value = wysiwyg.innerHTML;
    }
  }
  
  const id = document.getElementById('message_id').value;
  const title = document.getElementById('message_title').value.trim();
  const content = document.getElementById('message_content').value.trim();
  const type = document.getElementById('message_type').value;
  
  const start_date = type === 'temporary' ? document.getElementById('message_start_date').value : null;
  const end_date = type === 'temporary' ? document.getElementById('message_end_date').value : null;
  
  const payload = { title, content, type, start_date, end_date };
  
  const url = id ? `api/admin/messages/${id}` : 'api/admin/messages';
  const method = id ? 'PUT' : 'POST';
  
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Speichern.');
    
    closeModal('message-modal');
    showAdminAlert(data.message, 'success');
    loadAdminMessages();
    
    // Auch Dashboard-Nachrichten sofort neu laden
    loadActiveMessages();
  } catch (err) {
    alert('Fehler beim Speichern: ' + err.message);
  }
}

async function deleteMessage(id) {
  if (!confirm('Möchtest du diese Nachricht wirklich löschen?')) return;
  
  try {
    const res = await fetch(`api/admin/messages/${id}`, {
      method: 'DELETE'
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Löschen.');
    
    showAdminAlert(data.message, 'success');
    loadAdminMessages();
    
    // Auch Dashboard-Nachrichten sofort neu laden
    loadActiveMessages();
  } catch (err) {
    alert('Fehler beim Löschen: ' + err.message);
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) {
    return isoString;
  }
}

/* WYSIWYG Editor-Hilfsfunktionen */
let isSourceView = false;

function formatEditor(command) {
  if (isSourceView) return; // Im Quellcode-Modus keine Rich-Text-Befehle
  
  const wysiwyg = document.getElementById('editor-wysiwyg');
  if (wysiwyg) wysiwyg.focus();
  
  if (command === 'createLink') {
    const url = prompt('Link-URL eingeben (z.B. https://example.com):');
    if (url) {
      document.execCommand('createLink', false, url);
    }
  } else if (command === 'code') {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const selectedText = range.toString() || 'Code hier einfügen...';
    
    // Prüfen, ob wir inline code oder block code wollen: wenn Zeilenumbrüche vorhanden sind, Block Code
    const isMultiLine = selectedText.includes('\n') || selectedText.includes('\r');
    
    if (isMultiLine) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = selectedText;
      pre.appendChild(code);
      range.deleteContents();
      range.insertNode(pre);
      
      // Leere Zeile nach dem Block einfügen, damit man im Editor danach weiterschreiben kann
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      pre.after(p);
    } else {
      const code = document.createElement('code');
      code.textContent = selectedText;
      range.deleteContents();
      range.insertNode(code);
    }
  } else {
    document.execCommand(command, false, null);
  }
}

function toggleEditorSource() {
  const wysiwyg = document.getElementById('editor-wysiwyg');
  const textarea = document.getElementById('message_content');
  const btn = document.getElementById('editor-source-btn');
  
  if (!isSourceView) {
    // Wechsel zu Quellcode-Ansicht
    textarea.value = wysiwyg.innerHTML;
    wysiwyg.style.display = 'none';
    textarea.style.display = 'block';
    if (btn) btn.classList.add('active');
    isSourceView = true;
  } else {
    // Wechsel zu WYSIWYG-Ansicht
    wysiwyg.innerHTML = textarea.value;
    textarea.style.display = 'none';
    wysiwyg.style.display = 'block';
    if (btn) btn.classList.remove('active');
    isSourceView = false;
  }
}

/* ==========================================================================
   7. Schülerportal Integration Logik
   ========================================================================== */
let facefinder_classify_region = function(r, c, s, pixels, ldim) { return -1.0; };

function initFaceFinder() {
  const cascadeurl = 'https://raw.githubusercontent.com/nenadmarkus/pico/c2e81f9d23cc11d1a612fd21e4f9de0921a5d0d9/rnt/cascades/facefinder';
  fetch(cascadeurl).then(function(response) {
     response.arrayBuffer().then(function(buffer) {
         const bytes = new Int8Array(buffer);
         facefinder_classify_region = pico.unpack_cascade(bytes);
         console.log('* pico.js facefinder cascade loaded successfully');
     });
  }).catch(err => {
     console.error('Fehler beim Laden des Pico.js Facefinders:', err);
  });
}

function switchLoginTab(tab) {
  const credentialsBtn = document.getElementById('login-tab-credentials-btn');
  const emailBtn = document.getElementById('login-tab-email-btn');
  const loginForm = document.getElementById('login-form');
  const emailForm = document.getElementById('student-email-form');

  if (tab === 'credentials') {
    credentialsBtn.classList.add('active');
    emailBtn.classList.remove('active');
    loginForm.style.display = 'block';
    emailForm.style.display = 'none';
  } else if (tab === 'email') {
    emailBtn.classList.add('active');
    credentialsBtn.classList.remove('active');
    loginForm.style.display = 'none';
    emailForm.style.display = 'block';
  }
}

async function handleStudentLinkRequest(event) {
  event.preventDefault();
  const email = document.getElementById('student-email').value.trim();
  const privacyChecked = document.getElementById('student-privacy-check').checked;
  const alertBox = document.getElementById('login-alert');

  alertBox.style.display = 'none';
  alertBox.className = 'alert alert-danger';

  if (!email) {
    alertBox.innerText = 'Bitte geben Sie Ihre E-Mail-Adresse ein.';
    alertBox.style.display = 'block';
    return;
  }

  if (!privacyChecked) {
    alertBox.innerText = 'Bitte stimmen Sie der digitalen Verarbeitung Ihrer Daten zu.';
    alertBox.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('api/auth/student-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (res.ok) {
      alertBox.className = 'alert alert-success';
      alertBox.innerText = data.message;
      alertBox.style.display = 'block';
      document.getElementById('student-email-form').reset();
    } else {
      throw new Error(data.error || 'Fehler beim Anfordern des Links.');
    }
  } catch (err) {
    alertBox.className = 'alert alert-danger';
    alertBox.innerText = err.message;
    alertBox.style.display = 'block';
  }
}

function checkStudentToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const studentToken = urlParams.get('student_token');
  if (studentToken) {
    handleStudentTokenLogin(studentToken);
  }
}

async function handleStudentTokenLogin(token) {
  // URL bereinigen
  const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
  window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

  try {
    const res = await fetch('api/auth/student-token-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();

    if (res.ok) {
      currentUser = data.user;
      renderAuthenticatedHeader();
      await loadTiles();
      await loadActiveMessages();
      openStudentView();
    } else {
      alert(data.error || 'Anmeldelink ungültig oder abgelaufen.');
    }
  } catch (err) {
    console.error('Fehler bei Token-Login:', err);
    alert('Serverfehler während des Login-Vorgangs.');
  }
}

function openStudentView() {
  const mainView = document.getElementById('main-view');
  const studentView = document.getElementById('student-view');
  const adminView = document.getElementById('admin-view');
  const cardView = document.getElementById('card-view');

  if (adminView) adminView.style.display = 'none';
  if (mainView) mainView.style.display = 'none';
  if (cardView) cardView.style.display = 'none';
  if (studentView) {
    studentView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  loadStudentProfile();
}

function closeStudentView() {
  closeAllViews();
}

function clearStudentViewDOM() {
  const fields = [
    'student-first-name',
    'student-last-name',
    'student-birth-date',
    'student-birth-place',
    'student-email-display',
    'student-mso-username',
    'student-mso-password',
    'student-mediothek-number',
    'student-sph-username-display',
    'student-sph-password-display',
    'card-full-name',
    'card-birth-date',
    'card-mediothek-number-display'
  ];

  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = '-';
  });

  const statusEl = document.getElementById('student-account-status');
  if (statusEl) {
    statusEl.innerText = '-';
    statusEl.style.color = 'var(--text-secondary)';
  }

  const consents = [
    'student-dsgvo',
    'student-wlan',
    'student-ms365',
    'student-paednetz',
    'student-videoconference',
    'student-card-processing'
  ];

  consents.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = 'Nein';
      el.style.color = 'var(--text-secondary)';
      el.style.fontWeight = 'normal';
    }
  });

  document.querySelectorAll('.consent-sub-item').forEach(el => {
    el.style.display = 'flex';
  });

  const dsgvoWrapper = document.getElementById('consent-dsgvo-wrapper');
  if (dsgvoWrapper) {
    dsgvoWrapper.style.gridColumn = 'auto';
  }

  const cardStatusEl = document.getElementById('student-card-status');
  if (cardStatusEl) {
    cardStatusEl.innerText = 'Bild ungeprüft / Kein Bild';
    cardStatusEl.style.color = 'var(--warn-color)';
  }

  const previewImg = document.getElementById('student-photo-preview');
  if (previewImg) {
    previewImg.src = 'media/user.png';
  }

  const cardPhotoImg = document.getElementById('card-photo-img');
  if (cardPhotoImg) {
    cardPhotoImg.src = 'media/user.png';
  }

  const cardStatusText = document.getElementById('card-status-text');
  if (cardStatusText) {
    cardStatusText.innerText = 'Bild ungeprüft / Kein Bild';
    cardStatusText.style.color = 'var(--warn-color)';
  }

  const cardStatusLabel = document.getElementById('card-status-label');
  if (cardStatusLabel) {
    cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-question"></i> INAKTIV';
    cardStatusLabel.style.color = 'var(--warn-color)';
  }

  const headerName = document.getElementById('header-full-name');
  if (headerName) {
    headerName.innerText = '-';
  }
  const headerAvatar = document.getElementById('header-user-avatar');
  if (headerAvatar) {
    headerAvatar.src = 'media/user.png';
  }
}

async function loadStudentProfile() {
  clearStudentViewDOM();
  try {
    const res = await fetch('api/auth/student-profile');
    if (!res.ok) {
      // Fallback für Nicht-Schüler / Admin-Accounts
      document.getElementById('header-full-name').innerText = currentUser.username;
      document.getElementById('header-user-avatar').src = 'media/user.png';
      return;
    }
    const profile = await res.json();

    // 1. Benutzerprofil Ansicht befüllen
    document.getElementById('student-first-name').innerText = profile.first_name || '-';
    document.getElementById('student-last-name').innerText = profile.last_name || '-';
    
    let formattedBirthDate = '-';
    if (profile.birth_date) {
      const date = new Date(profile.birth_date);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        formattedBirthDate = `${day}.${month}.${year}`;
        document.getElementById('student-birth-date').innerText = formattedBirthDate;
      } else {
        formattedBirthDate = profile.birth_date;
        document.getElementById('student-birth-date').innerText = formattedBirthDate;
      }
    } else {
      document.getElementById('student-birth-date').innerText = '-';
    }

    document.getElementById('student-birth-place').innerText = profile.birth_place || '-';
    document.getElementById('student-email-display').innerText = currentUser.email || '-';
    document.getElementById('student-mso-username').innerText = currentUser.username || '-';
    document.getElementById('student-mso-password').innerText = profile.start_password || '-';
    document.getElementById('student-mediothek-number').innerText = profile.mediothek_number || '-';
    document.getElementById('student-sph-username-display').innerText = profile.sph_username || '-';
    document.getElementById('student-sph-password-display').innerText = profile.sph_password || '-';

    const statusEl = document.getElementById('student-account-status');
    if (profile.account_status === 'true') {
      statusEl.innerText = 'Aktiv';
      statusEl.style.color = 'var(--success-color)';
    } else {
      statusEl.innerText = 'Noch inaktiv / In Bearbeitung';
      statusEl.style.color = 'var(--warn-color)';
    }

    document.getElementById('student-dsgvo').innerText = profile.dsgvo_consent || 'Nein';
    document.getElementById('student-wlan').innerText = profile.wlan_terms || 'Nein';
    document.getElementById('student-ms365').innerText = profile.ms365_terms || 'Nein';
    document.getElementById('student-paednetz').innerText = profile.paednetz_terms || 'Nein';
    document.getElementById('student-videoconference').innerText = profile.videoconference_consent || 'Nein';
    document.getElementById('student-card-processing').innerText = profile.card_processing_consent || 'Nein';

    ['student-dsgvo', 'student-wlan', 'student-ms365', 'student-paednetz', 'student-videoconference', 'student-card-processing'].forEach(id => {
      const el = document.getElementById(id);
      if (el.innerText === 'Ja' || el.innerText === 'Ich erkläre meine Einwilligung zu allen Punkten.') {
        el.style.color = 'var(--success-color)';
        el.style.fontWeight = '600';
      } else {
        el.style.color = 'var(--text-secondary)';
        el.style.fontWeight = 'normal';
      }
    });

    const isGlobalConsent = profile.dsgvo_consent === 'Ich erkläre meine Einwilligung zu allen Punkten.';
    document.querySelectorAll('.consent-sub-item').forEach(el => {
      el.style.display = isGlobalConsent ? 'none' : 'flex';
    });

    const dsgvoWrapper = document.getElementById('consent-dsgvo-wrapper');
    if (dsgvoWrapper) {
      if (isGlobalConsent) {
        dsgvoWrapper.style.gridColumn = 'span 2';
      } else {
        dsgvoWrapper.style.gridColumn = 'auto';
      }
    }

    const cardStatusEl = document.getElementById('student-card-status');
    cardStatusEl.innerText = profile.card_status || 'Bild ungeprüft / Kein Bild';
    
    if (profile.card_status === 'Bild genehmigt') {
      cardStatusEl.style.color = 'var(--success-color)';
    } else if (profile.card_status === 'Bild eingereicht') {
      cardStatusEl.style.color = 'var(--accent-color)';
    } else if (profile.card_status === 'Bild abgelehnt') {
      cardStatusEl.style.color = 'var(--danger-color)';
    } else {
      cardStatusEl.style.color = 'var(--warn-color)';
    }

    const previewImg = document.getElementById('student-photo-preview');
    previewImg.src = profile.card_image || 'media/user.png';



    // 2. Header Avatar & Anzeigenamen befüllen
    const fullName = ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim();
    document.getElementById('header-full-name').innerText = fullName || currentUser.username;
    document.getElementById('header-user-avatar').src = profile.card_image || 'media/user.png';

    // 3. Schülerausweis Ansicht befüllen
    const cardFullName = document.getElementById('card-full-name');
    if (cardFullName) cardFullName.innerText = fullName || '-';

    const cardBirthDate = document.getElementById('card-birth-date');
    if (cardBirthDate) cardBirthDate.innerText = formattedBirthDate;

    const cardMediothekDisplay = document.getElementById('card-mediothek-number-display');
    if (cardMediothekDisplay) cardMediothekDisplay.innerText = profile.mediothek_number || '-';

    const cardPhotoImg = document.getElementById('card-photo-img');
    if (cardPhotoImg) cardPhotoImg.src = profile.card_image || 'media/user.png';

    const cardStatusText = document.getElementById('card-status-text');
    if (cardStatusText) {
      cardStatusText.innerText = profile.card_status || 'Bild ungeprüft / Kein Bild';
      if (profile.card_status === 'Bild genehmigt') {
        cardStatusText.style.color = 'var(--success-color)';
      } else if (profile.card_status === 'Bild eingereicht') {
        cardStatusText.style.color = 'var(--accent-color)';
      } else if (profile.card_status === 'Bild abgelehnt') {
        cardStatusText.style.color = 'var(--danger-color)';
      } else {
        cardStatusText.style.color = 'var(--warn-color)';
      }
    }

    const cardStatusLabel = document.getElementById('card-status-label');
    if (cardStatusLabel) {
      if (profile.card_status === 'Bild genehmigt') {
        cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-check"></i> GÜLTIG';
        cardStatusLabel.style.color = 'var(--success-color)';
      } else if (profile.card_status === 'Bild eingereicht') {
        cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> IN PRÜFUNG';
        cardStatusLabel.style.color = 'var(--accent-color)';
      } else if (profile.card_status === 'Bild abgelehnt') {
        cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ABGELEHNT';
        cardStatusLabel.style.color = 'var(--danger-color)';
      } else {
        cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-question"></i> INAKTIV';
        cardStatusLabel.style.color = 'var(--warn-color)';
      }
    }

  } catch (err) {
    console.error('Fehler beim Laden des Schülerprofils:', err);
    // Fallback bei Verbindungsfehlern
    document.getElementById('header-full-name').innerText = currentUser.username;
    document.getElementById('header-user-avatar').src = 'media/user.png';
  }
}

function handleStudentPhotoSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const uploadBtn = document.getElementById('student-photo-upload-btn-card') || document.getElementById('student-photo-upload-btn');
  const originalBtnHtml = uploadBtn.innerHTML;
  uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verarbeite Bild...';
  uploadBtn.disabled = true;

  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = function() {
    const canvas = document.getElementById('student-photo-canvas');
    const ctx = canvas.getContext("2d");
    const breite = 250;
    const targetHeight = img.height / (img.width / breite);
    
    canvas.width = breite;
    canvas.height = targetHeight;
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, breite, targetHeight);
    
    const ratio = img.width / canvas.width;
    const rgba = ctx.getImageData(0, 0, breite, targetHeight).data;
    
    function rgba_to_grayscale(rgbaData, nrows, ncols) {
      const gray = new Uint8Array(nrows * ncols);
      for (let r = 0; r < nrows; ++r) {
        for (let c = 0; c < ncols; ++c) {
          gray[r * ncols + c] = (2 * rgbaData[r * 4 * ncols + 4 * c + 0] + 7 * rgbaData[r * 4 * ncols + 4 * c + 1] + 1 * rgbaData[r * 4 * ncols + 4 * c + 2]) / 10;
        }
      }
      return gray;
    }
    
    const image = {
      "pixels": rgba_to_grayscale(rgba, targetHeight, breite),
      "nrows": targetHeight,
      "ncols": breite,
      "ldim": breite
    };
    
    const params = {
      "shiftfactor": 0.1,
      "minsize": 20,
      "maxsize": 1000,
      "scalefactor": 1.1
    };
    
    let dets = pico.run_cascade(image, facefinder_classify_region, params);
    dets = pico.cluster_detections(dets, 0.2);
    
    const qthresh = 5.0;
    let found = false;
    
    for (let i = 0; i < dets.length; ++i) {
      if (dets[i][3] > qthresh) {
        if (!found) {
          const x = dets[i][1] * ratio;
          const y = dets[i][0] * ratio;
          const w = dets[i][2] / 2;
          const h = w * 1.333;
          
          const zoom = 0.45 / ratio;
          
          canvas.width = 147;
          canvas.height = 196;
          ctx.clearRect(0, 0, 147, 196);
          ctx.drawImage(img, x - (w / (2 * zoom)), y - (h / (2 * zoom)), w / zoom, h / zoom, 0, 0, 147, 196);
          
          const croppedBase64 = canvas.toDataURL("image/png");
          const previewImg = document.getElementById('student-photo-preview');
          if (previewImg) previewImg.src = croppedBase64;
          const cardImg = document.getElementById('card-photo-img');
          if (cardImg) cardImg.src = croppedBase64;
          const headerAvatar = document.getElementById('header-user-avatar');
          if (headerAvatar) headerAvatar.src = croppedBase64;
          
          uploadCroppedPhoto(croppedBase64, originalBtnHtml);
          found = true;
          break;
        }
      }
    }
    
    if (!found) {
      alert("Achtung: Es wurde kein Gesicht auf Ihrem Foto erkannt. Bitte laden Sie ein gut ausgeleuchtetes Porträtfoto hoch, auf dem Ihr Gesicht frontal und deutlich zu sehen ist.");
      uploadBtn.innerHTML = originalBtnHtml;
      uploadBtn.disabled = false;
    }
  };
}

async function uploadCroppedPhoto(croppedBase64, originalBtnHtml) {
  const uploadBtn = document.getElementById('student-photo-upload-btn-card') || document.getElementById('student-photo-upload-btn');
  try {
    const res = await fetch('api/auth/student-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: croppedBase64 })
    });
    const data = await res.json();
    
    if (res.ok) {
      alert("Erfolg: Ihr Passbild wurde erfolgreich hochgeladen und zur Prüfung eingereicht.");
      await loadStudentProfile();
    } else {
      alert("Fehler beim Hochladen: " + (data.error || 'Serverfehler'));
    }
  } catch (err) {
    console.error('Fehler beim Upload:', err);
    alert('Serverfehler während des Hochladens.');
  } finally {
    uploadBtn.innerHTML = originalBtnHtml;
    uploadBtn.disabled = false;
  }
}

function toggleUserDropdown(event) {
  event.stopPropagation();
  const dropdown = document.getElementById('header-user-dropdown');
  if (dropdown) {
    const isShowing = dropdown.style.display === 'block';
    dropdown.style.display = isShowing ? 'none' : 'block';
  }
}

function navigateTo(page, event) {
  if (event) event.preventDefault();
  
  // Close user dropdown
  const dropdown = document.getElementById('header-user-dropdown');
  if (dropdown) dropdown.style.display = 'none';

  if (page === 'profile') {
    openStudentView();
  } else if (page === 'card') {
    openCardView();
  }
}

function openCardView() {
  const mainView = document.getElementById('main-view');
  const studentView = document.getElementById('student-view');
  const cardView = document.getElementById('card-view');
  const adminView = document.getElementById('admin-view');

  if (adminView) adminView.style.display = 'none';
  if (mainView) mainView.style.display = 'none';
  if (studentView) studentView.style.display = 'none';
  if (cardView) {
    cardView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  loadStudentProfile();
}

function closeCardView() {
  closeAllViews();
}

function closeAllViews() {
  const mainView = document.getElementById('main-view');
  const adminView = document.getElementById('admin-view');
  const studentView = document.getElementById('student-view');
  const cardView = document.getElementById('card-view');

  if (adminView) adminView.style.display = 'none';
  if (studentView) studentView.style.display = 'none';
  if (cardView) cardView.style.display = 'none';
  if (mainView) mainView.style.display = 'block';

  loadTiles();
}


