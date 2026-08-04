// Globaler Anwendungsstatus
let currentUser = null;
let activeTheme = 'dark';
let currentMsoPassword = '';
let currentSphPassword = '';

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
  console.log('[MSO Auth] Prüfe Authentifizierungsstatus...');
  try {
    const res = await fetch('api/auth/me');
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[MSO Auth Error] HTTP ${res.status} von /api/auth/me:`, errText);
      renderAnonymousHeader();
      return;
    }
    const data = await res.json();
    console.log('[MSO Auth Data] Empfangener Status:', data);

    if (data.error) {
      console.warn('[MSO Auth Warning] Server lieferte Hinweis/Fehler:', data.error);
    }

    // 1. Plattformname & Logo auf die Oberfläche anwenden
    const platformName = data.platform_name || 'MSO Cloud';
    const platformLogo = data.platform_logo || '';
    const cardLogo = data.card_logo || '';

    // HTML Titel anpassen
    document.title = `${platformName} Portal`;

    // Favicon dynamisch setzen (Plattform-Logo aus den Einstellungen, Fallback: default favicon.ico)
    const faviconSrc = platformLogo || 'favicon.ico';
    
    // Alten Link entfernen (Zwingt den Browser zur Neuprüfung)
    const existingLinks = document.querySelectorAll("link[rel*='icon']");
    existingLinks.forEach(link => link.parentNode.removeChild(link));

    // Neuen Link erstellen (Verhindert hartnäckiges Browser-Caching)
    const faviconLink = document.createElement('link');
    faviconLink.rel = 'icon';
    if (faviconSrc && !faviconSrc.startsWith('data:')) {
      faviconLink.href = `${faviconSrc}?v=${Date.now()}`;
    } else {
      faviconLink.href = faviconSrc;
    }
    document.getElementsByTagName('head')[0].appendChild(faviconLink);

    // Willkommenstext im Header
    document.querySelectorAll('.header-welcome-title, #jumbo-title').forEach(el => {
      el.innerText = `Willkommen im ${platformName} Portal`;
    });

    // Logo Texte
    document.querySelectorAll('.logo-text').forEach(el => {
      el.innerText = platformName;
    });

    // Logo Bilder
    document.querySelectorAll('.logo-img').forEach(el => {
      el.removeAttribute('onerror');
      if (platformLogo) {
        el.src = platformLogo;
      } else {
        el.src = 'logo.png';
      }
    });

    if (data.impressum_url) {
      const footerLink = document.getElementById('footer-impressum-link');
      if (footerLink) {
        footerLink.href = data.impressum_url;
      }
    }

    if (data.logged_in) {
      console.log(`[MSO Auth] Angemeldet als: ${data.user ? data.user.username : 'unbekannt'}`);
      currentUser = data.user;
      renderAuthenticatedHeader();
    } else {
      console.log('[MSO Auth] Nicht angemeldet (Gast-Modus aktiv).');
      currentUser = null;
      clearStudentViewDOM();
      renderAnonymousHeader();
    }
  } catch (err) {
    console.error('[MSO Auth Exception] Netzwerkausnahme bei checkAuthStatus:', err);
    renderAnonymousHeader();
  }
}

function renderAuthenticatedHeader() {
  const isStudent = currentUser.isStudent === true || (currentUser.groups && currentUser.groups.some(g => {
    const match = g.match(/cn=([^,]+)/i);
    const cn = match ? match[1].trim() : g;
    const lowerCn = cn.toLowerCase();
    return lowerCn === 'schueler' || lowerCn === 'schüler' || lowerCn.includes('schueler') || lowerCn.includes('schüler');
  }));

  const headerAnon = document.getElementById('header-anonymous');
  const headerAuth = document.getElementById('header-authenticated');
  if (headerAnon) headerAnon.style.display = 'none';
  if (headerAuth) headerAuth.style.display = 'flex';

  const isAdmin = currentUser.role === 'admin';
  const isTeacher = !isStudent && !isAdmin;

  // Fallback initial
  document.getElementById('header-full-name').innerText = currentUser.display_name || currentUser.username;
  
  const headerAvatar = document.getElementById('header-user-avatar');
  if (headerAvatar) {
    if (!isAdmin && !isTeacher && currentUser.card_image) {
      headerAvatar.src = currentUser.card_image;
    } else {
      headerAvatar.src = 'media/user.png';
    }
  }

  // Render Admin Button right container if admin
  renderAdminButton();

  // Toggle student card visibility in dropdown
  const cardLink = document.getElementById('header-card-link');
  if (cardLink) {
    cardLink.style.display = (isStudent || isAdmin) ? 'block' : 'none';
    if (isAdmin && !isStudent) {
      cardLink.innerHTML = '<i class="fa-solid fa-address-card" style="margin-right: 10px; color: var(--accent-color); width: 16px;"></i> Schülerausweis (Vorschau)';
    } else {
      cardLink.innerHTML = '<i class="fa-solid fa-address-card" style="margin-right: 10px; color: var(--accent-color); width: 16px;"></i> Schülerausweis';
    }
  }

  // Toggle user profile link visibility based on student status
  const profileLink = document.getElementById('header-profile-link');
  if (profileLink) {
    profileLink.style.display = (isStudent || isAdmin) ? 'block' : 'none';
    if (isAdmin && !isStudent) {
      profileLink.innerHTML = '<i class="fa-solid fa-user-gear" style="margin-right: 10px; color: var(--accent-color); width: 16px;"></i> Benutzerprofil & Zugänge (Vorschau)';
    } else {
      profileLink.innerHTML = '<i class="fa-solid fa-user-gear" style="margin-right: 10px; color: var(--accent-color); width: 16px;"></i> Benutzerprofil & Zugänge';
    }
  }

  // Load student profile details
  if (isStudent) {
    loadStudentProfile();
  }
}

function renderAdminButton() {
  const adminLink = document.getElementById('header-admin-link');
  if (!adminLink) return;

  const isAdmin = currentUser.role === 'admin';
  adminLink.style.display = isAdmin ? 'block' : 'none';
}

function renderAnonymousHeader() {
  const headerAnon = document.getElementById('header-anonymous');
  const headerAuth = document.getElementById('header-authenticated');
  if (headerAnon) headerAnon.style.display = 'flex';
  if (headerAuth) headerAuth.style.display = 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  let user = document.getElementById('login-username').value.trim();
  
  // E-Mail-Fehlerhilfe: Alles ab dem @-Zeichen ignorieren
  if (user.includes('@')) {
    user = user.split('@')[0];
  }
  
  const pass = document.getElementById('login-password').value;
  const alertBox = document.getElementById('login-alert');

  alertBox.style.display = 'none';
  console.log(`[MSO Login] Sende Login-Anfrage für Benutzer: "${user}"...`);

  try {
    const res = await fetch('api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      const rawText = await res.text();
      console.error(`[MSO Login Error] Server antwortete nicht mit JSON (Status ${res.status}):`, rawText);
      throw new Error(`Server-Fehler (Status ${res.status}): ${rawText || 'Ungültige Antwort'}`);
    }

    console.log(`[MSO Login Response] Status ${res.status}:`, data);

    if (res.ok) {
      console.log('[MSO Login] Anmeldevorgang erfolgreich!');
      closeModal('login-modal');
      // Login-Formular leeren
      document.getElementById('login-form').reset();
      
      if (data.oauth_redirect) {
        window.location.href = 'api/oauth/authorize';
        return;
      }

      if (data.return_to) {
        window.location.href = data.return_to;
        return;
      }
      
      await checkAuthStatus();
      await loadTiles();
      await loadActiveMessages();
    } else {
      let errorMsg = data.error || `Fehler beim Anmelden (HTTP ${res.status}).`;
      let errorHtml = errorMsg;
      console.warn(`[MSO Login Fehlschlag] ${errorMsg}`);
      if (res.status === 401) {
        errorHtml = `${errorMsg}<br><br>Die Benutzernamen an unserer Schule sind in der Regel so aufgebaut:<br>
          <ul style="margin: 6px 0 0 18px; padding: 0; list-style: disc;">
            <li>Lehrperson: <strong>m.mustermann</strong></li>
            <li>Lernende: <strong>mustermann.max</strong></li>
          </ul>`;
      }
      throw { message: errorMsg, html: errorHtml };
    }
  } catch (err) {
    console.error('[MSO Login Exception]:', err);
    if (err.html) {
      alertBox.innerHTML = err.html;
    } else {
      alertBox.innerText = err.message || String(err);
    }
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
  console.log('[MSO Tiles] Starte Abruf von api/tiles...');
  tilesContainer.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">
      <i class="fa-solid fa-spinner fa-spin fa-2xl" style="color: var(--accent-color);"></i>
      <p style="margin-top: 15px;">Lade Dienste...</p>
    </div>
  `;

  try {
    const res = await fetch('api/tiles');
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[MSO Tiles Error] HTTP ${res.status} beim Kachel-Abruf:`, errText);
      tilesContainer.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--error-color);">
          <i class="fa-solid fa-triangle-exclamation fa-2xl" style="margin-bottom: 10px;"></i>
          <p style="font-size: 1.1rem; font-weight: bold;">Fehler beim Laden der Dienste (HTTP ${res.status})</p>
          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 5px;">${errText}</p>
        </div>
      `;
      return;
    }

    const tiles = await res.json();
    console.log(`[MSO Tiles] ${tiles.length} Dienste erfolgreich geladen.`);

    if (!Array.isArray(tiles) || tiles.length === 0) {
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
        if (tile.open_in_new_tab === 1) {
          tileCard.target = '_blank';
        }
        
        if (isSph) {
          tileCard.onclick = function(e) {
            handleSphClick(e, tile.id, tile.open_in_new_tab === 1);
          };
        }
      }
      
      let keyBtnHtml = '';
      if (currentUser) {
        if (isSph) {
          keyBtnHtml = `<button class="tile-key-btn" onclick="openSphCredentialsModal(event, ${tile.id}, ${tile.open_in_new_tab === 1})" title="Schulportal-Zugangsdaten verknüpfen"><i class="fa-solid fa-link"></i></button>`;
        }
      }
      
      tileCard.innerHTML = `
        <div class="tile-header">
          <div class="tile-icon-wrapper">
            ${renderIcon(tile.icon)}
          </div>
          <div style="display: flex; align-items: center; gap: 10px; z-index: 5;">
            ${keyBtnHtml}
          </div>
        </div>
        <div class="tile-body">
          <h4 class="tile-title">${tile.title}</h4>
          <div class="tile-bottom-content">
            <p class="tile-description">${tile.description || ''}</p>
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
        if (tile.disable_status_check === 1) {
          const dot = document.getElementById(`status-dot-${tile.id}`);
          if (dot) {
            dot.className = 'status-dot online';
            dot.setAttribute('title', 'Statusprüfung deaktiviert (Standardmäßig erreichbar)');
          }
        } else {
          checkTileStatus(tile.id, tile.link);
        }
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
  if (urlParams.get('login_redirect') === 'oauth' || urlParams.get('login_required') === '1') {
    if (!currentUser) {
      openModal('login-modal');
      const alertBox = document.getElementById('login-alert');
      if (alertBox && urlParams.get('login_required') === '1') {
        alertBox.innerText = 'Bitte melden Sie sich an, um auf den angeforderten Dienst zuzugreifen.';
        alertBox.className = 'alert alert-info';
        alertBox.style.display = 'block';
      }
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
  const form = document.getElementById('reset-request-form');
  const btn = form.querySelector('button[type="submit"]');

  alertBox.style.display = 'none';
  alertBox.className = 'alert';

  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Bitte warten...';
  btn.disabled = true;

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
      form.reset();
    } else {
      throw new Error(data.error || 'Fehler beim Versenden.');
    }
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
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
      validatePasswordInput('reset-new-password', 'reset-submit-btn', 'reset-req-length', 'reset-req-letter', 'reset-req-number');
      
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

// Passwort-Sichtbarkeit umschalten (Benutzerprofil & Zugänge)
function togglePasswordVisibility(type) {
  if (type === 'student-mso-password') {
    const textEl = document.getElementById('student-mso-password-display-text');
    const eyeEl = document.getElementById('student-mso-password-eye');
    const isMasked = textEl.textContent === '••••••••';
    
    if (isMasked) {
      textEl.textContent = currentMsoPassword;
      textEl.style.letterSpacing = 'normal';
      eyeEl.className = 'fa-solid fa-eye-slash';
    } else {
      textEl.textContent = '••••••••';
      textEl.style.letterSpacing = '2px';
      eyeEl.className = 'fa-solid fa-eye';
    }
  } else if (type === 'student-sph-password') {
    const textEl = document.getElementById('student-sph-password-display-text');
    const eyeEl = document.getElementById('student-sph-password-eye');
    const isMasked = textEl.textContent === '••••••••';
    
    if (isMasked) {
      textEl.textContent = currentSphPassword;
      textEl.style.letterSpacing = 'normal';
      eyeEl.className = 'fa-solid fa-eye-slash';
    } else {
      textEl.textContent = '••••••••';
      textEl.style.letterSpacing = '2px';
      eyeEl.className = 'fa-solid fa-eye';
    }
  }
}

// Echtzeit-Passwortprüfung (Richtlinien)
function validatePasswordInput(inputId, submitBtnId, reqLengthId, reqLetterId, reqNumberId) {
  const val = document.getElementById(inputId).value;
  const submitBtn = document.getElementById(submitBtnId);
  
  const isLongEnough = val.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(val);
  const hasNumber = /\d/.test(val);
  
  const reqs = [
    { id: reqLengthId, text: 'Mindestens 8 Zeichen', valid: isLongEnough },
    { id: reqLetterId, text: 'Mindestens 1 Buchstabe (a-z, A-Z)', valid: hasLetter },
    { id: reqNumberId, text: 'Mindestens 1 Zahl (0-9)', valid: hasNumber }
  ];

  reqs.forEach(r => {
    const el = document.getElementById(r.id);
    if (el) {
      if (r.valid) {
        el.style.color = '#86efac';
        el.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${r.text}`;
      } else {
        el.style.color = '#fca5a5';
        el.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${r.text}`;
      }
    }
  });

  if (submitBtn) {
    submitBtn.disabled = !(isLongEnough && hasLetter && hasNumber);
  }
}

// Modal zum Ändern des Passworts öffnen (angemeldete User)
function openChangePasswordModal(event) {
  if (event) event.preventDefault();
  
  const form = document.getElementById('change-password-form');
  if (form) form.reset();
  
  // Anforderungen zurücksetzen
  validatePasswordInput('change-new-password', 'change-submit-btn', 'change-req-length', 'change-req-letter', 'change-req-number');
  
  const alertBox = document.getElementById('change-password-alert');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.className = 'alert';
  }
  
  openModal('change-password-modal');
}

// Passwortänderung für angemeldete User ausführen
async function handleChangePassword(e) {
  e.preventDefault();
  const pass = document.getElementById('change-new-password').value;
  const passConf = document.getElementById('change-new-password-confirm').value;
  const alertBox = document.getElementById('change-password-alert');
  const btn = document.getElementById('change-submit-btn');

  alertBox.style.display = 'none';
  alertBox.className = 'alert';

  if (pass !== passConf) {
    alertBox.innerText = 'Die Passwörter stimmen nicht überein.';
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
    return;
  }

  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Speichern...';
  btn.disabled = true;

  try {
    const res = await fetch('api/auth/change-password-logged-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });

    const data = await res.json();

    if (res.ok) {
      alertBox.innerText = data.message || 'Passwort erfolgreich geändert.';
      alertBox.classList.add('alert-success');
      alertBox.style.display = 'flex';
      document.getElementById('change-password-form').reset();
      
      // Cache aktualisieren und Profil neu laden
      setTimeout(async () => {
        closeModal('change-password-modal');
        await loadStudentProfile();
      }, 2000);
    } else {
      throw new Error(data.error || 'Fehler beim Ändern des Passworts.');
    }
  } catch (err) {
    alertBox.innerText = err.message;
    alertBox.classList.add('alert-danger');
    alertBox.style.display = 'flex';
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

async function checkMainLoginLockStatus() {
  try {
    const res = await fetch('api/auth/login-status');
    if (!res.ok) return;
    const status = await res.json();
    const alertBox = document.getElementById('login-alert');
    const submitBtn = document.querySelector('#login-form button[type="submit"]');

    if (status.isLocked) {
      if (alertBox) {
        alertBox.className = 'alert alert-danger';
        alertBox.innerText = `Anmeldung gesperrt! Zu viele fehlgeschlagene Versuche. Bitte warten Sie noch ${status.remainingSeconds} Sekunden.`;
        alertBox.style.display = 'block';
      }
      if (submitBtn) submitBtn.disabled = true;
    } else {
      if (submitBtn) submitBtn.disabled = false;
      if (status.attemptsLeft < 5 && alertBox) {
        alertBox.className = 'alert alert-warn';
        alertBox.innerText = `Hinweis: Noch ${status.attemptsLeft} von 5 Anmeldeversuchen verbleibend.`;
        alertBox.style.display = 'block';
      }
    }
  } catch (e) {}
}

/* ==========================================================================
   5. Modals Helper
   ========================================================================== */
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  if (id === 'login-modal') {
    checkMainLoginLockStatus();
  }
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
function openAdminView(e) {
  if (e) {
    e.preventDefault();
    const dropdown = document.getElementById('header-user-dropdown');
    if (dropdown) dropdown.style.display = 'none';
  }
  const studentView = document.getElementById('student-view');
  const cardView = document.getElementById('card-view');

  if (mainView) mainView.style.display = 'none';
  if (studentView) studentView.style.display = 'none';
  if (cardView) cardView.style.display = 'none';
  if (adminView) {
    adminView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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

  // Sidebar schliessen bei mobiler Ansicht
  const sidebar = document.querySelector('.admin-sidebar');
  if (sidebar) {
    sidebar.classList.remove('open');
  }

  // Daten für den ausgewählten Tab laden
  loadAdminTabContent(tabId);
}

function loadAdminTabContent(tabId) {
  // Alert ausblenden
  document.getElementById('admin-alert').style.display = 'none';

  if (tabId === 'tab-tiles') {
    loadAdminTiles();
  } else if (tabId === 'tab-ldap' || tabId === 'tab-smtp' || tabId === 'tab-mysql' || tabId === 'tab-system' || tabId === 'tab-card-config') {
    loadAdminConfig();
    if (tabId === 'tab-system') {
      loadSystemInfo();
    }
  } else if (tabId === 'tab-oauth') {
    loadOauthClientConfig();
  } else if (tabId === 'tab-mapping') {
    loadAdminLdapMappings();
  } else if (tabId === 'tab-users') {
    loadAdminUsers();
  } else if (tabId === 'tab-messages') {
    loadAdminMessages();
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
      let visLabel = tile.visibility;
      if (tile.visibility === 'public') visLabel = 'Öffentlich';
      else if (tile.visibility === 'only_public') visLabel = 'Nur nicht angemeldet';
      else if (tile.visibility === 'logged_in') visLabel = 'Nur angemeldet';
      else if (tile.visibility === 'groups') visLabel = `Gruppen (${allowedGroups.join(', ')})`;
      
      const timeLockBadge = tile.time_limit_enabled === 1 
        ? ` <span class="user-badge" style="font-size:0.7rem; background:rgba(245,158,11,0.1); color:var(--warn-color); display:inline-flex; align-items:center; gap:3px;" title="Zeitsperre aktiv: ${tile.time_limit_start} - ${tile.time_limit_end} Uhr"><i class="fa-solid fa-lock"></i> ${tile.time_limit_start}-${tile.time_limit_end}</span>`
        : '';

      const newTabBadge = tile.open_in_new_tab === 1
        ? ` <span class="user-badge" style="font-size:0.7rem; background:rgba(59,130,246,0.1); color:#3b82f6; display:inline-flex; align-items:center; gap:3px;" title="Öffnet in neuem Tab"><i class="fa-solid fa-up-right-from-square"></i> Tab</span>`
        : '';

      const noCheckBadge = tile.disable_status_check === 1
        ? ` <span class="user-badge" style="font-size:0.7rem; background:rgba(107,114,128,0.1); color:#9ca3af; display:inline-flex; align-items:center; gap:3px;" title="Statusprüfung deaktiviert"><i class="fa-solid fa-eye-slash"></i> Kein Check</span>`
        : '';

      const tr = document.createElement('tr');
      tr.setAttribute('draggable', 'true');
      tr.dataset.id = tile.id;
      tr.style.transition = 'background-color 0.2s ease';
      
      const extraBadges = `${timeLockBadge}${newTabBadge}${noCheckBadge}`;
      const extraBadgesLine = extraBadges.trim() ? `<div class="acc-detail-line"><strong>Hinweise:</strong> <span>${extraBadges}</span></div>` : '';

      tr.innerHTML = `
        <!-- Mobile Accordion Cell -->
        <td class="acc-cell-main mobile-only">
          <div class="acc-header-bar" onclick="toggleAccRow(this.closest('tr'))">
            <div class="acc-header-left">
              <strong>${tile.title}</strong>
            </div>
            <div class="acc-header-right">
              <i class="fa-solid fa-chevron-down acc-chevron"></i>
            </div>
          </div>
          <div class="acc-body-content">
            <div class="acc-detail-line"><strong>Beschreibung:</strong> <span>${tile.description || '-'}</span></div>
            <div class="acc-detail-line"><strong>Icon:</strong> <span>${renderIcon(tile.icon)}</span></div>
            <div class="acc-detail-line"><strong>Sichtbarkeit:</strong> <span class="user-badge" style="font-size:0.75rem;">${visLabel}</span></div>
            <div class="acc-detail-line"><strong>SSO-Typ:</strong> <code>${tile.sso_type}</code></div>
            ${extraBadgesLine}
            <div class="acc-detail-line"><strong>Reihenfolge:</strong> <span>${tile.sort_order}</span></div>
            <div class="acc-detail-line" style="border-bottom:none;">
              <strong>Aktionen:</strong>
              <div class="actions-cell">
                <button class="btn btn-secondary btn-icon" onclick="event.stopPropagation(); openTileForm(${JSON.stringify(tile).replace(/"/g, '&quot;')})" title="Bearbeiten"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn btn-danger btn-icon" onclick="event.stopPropagation(); deleteTile(${tile.id})" title="Löschen"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
          </div>
        </td>

        <!-- Desktop Columns -->
        <td class="desktop-only" style="text-align:center; padding: 12px 6px;"><i class="fa-solid fa-grip-vertical drag-handle-grip" style="cursor: grab; color: var(--text-secondary); opacity: 0.5; font-size:1.1rem;" title="Reihenfolge per Drag & Drop verschieben"></i></td>
        <td class="desktop-only"><strong>${tile.title}</strong>${timeLockBadge}${newTabBadge}${noCheckBadge}</td>
        <td class="desktop-only" style="font-size:0.8rem; color:var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tile.description || ''}</td>
        <td class="desktop-only" style="font-size: 1.25rem;">${renderIcon(tile.icon)}</td>
        <td class="desktop-only"><span class="user-badge" style="font-size:0.75rem;">${visLabel}</span></td>
        <td class="desktop-only"><code>${tile.sso_type}</code></td>
        <td class="desktop-only">${tile.sort_order}</td>
        <td class="desktop-only actions-cell">
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
    document.getElementById('tile_open_in_new_tab').checked = tile.open_in_new_tab === 1;
    document.getElementById('tile_disable_status_check').checked = tile.disable_status_check === 1;
  } else {
    document.getElementById('tile_time_limit_enabled').checked = false;
    document.getElementById('tile_time_limit_start').value = '08:00';
    document.getElementById('tile_time_limit_end').value = '16:00';
    document.getElementById('tile_open_in_new_tab').checked = false;
    document.getElementById('tile_disable_status_check').checked = false;
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
  const helpText = document.getElementById('tile-sso-help-text');
  
  wrapper.style.display = sso !== 'none' ? 'block' : 'none';
  
  if (sso === 'jwt') {
    const host = window.location.host;
    const isSubdir = host.toLowerCase() === 'cloud.mso-hef.de';
    const base = `https://${host}${isSubdir ? '/novus' : ''}`;
    const tileId = document.getElementById('tile-id-field').value || '<KACHEL_ID>';
    
    helpText.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px; color:#3b82f6;"><i class="fa-solid fa-circle-info"></i> JWT SSO Integration</div>
      Geben Sie in der Ziel-App (z. B. Buchungssystem) folgende Einstellungen an:
      <ul style="margin: 6px 0 0 15px; padding:0; display:flex; flex-direction:column; gap:4px;">
        <li><strong>SSO Identity Provider Login-URL:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem; word-break:break-all;">${base}/api/tiles/sso/${tileId}</code></li>
        <li><strong>URL Query Parameter Name:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">sso_token</code></li>
        <li><strong>Username Claim Name:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">username</code></li>
        <li><strong>Klarname Claim Name:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">display_name</code></li>
        <li><strong>E-Mail Claim Name:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">email</code></li>
        <li><strong>Signierschlüssel (Secret):</strong> Nutzen Sie den oben angezeigten/generierten Schlüssel.</li>
      </ul>
    `;
    helpText.style.display = 'block';
  } else if (sso === 'query') {
    helpText.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px; color:#3b82f6;"><i class="fa-solid fa-circle-info"></i> Query SSO Integration</div>
      Dem Ziel-Link werden Parameter angehängt. Geben Sie in der App folgendes an:
      <ul style="margin: 6px 0 0 15px; padding:0; display:flex; flex-direction:column; gap:4px;">
        <li><strong>Übergebene Parameter:</strong> <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">username</code>, <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">email</code>, <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">timestamp</code>, <code style="background:rgba(0,0,0,0.2); padding:2px 4px; border-radius:4px; font-size:0.75rem;">hash</code></li>
        <li><strong>Signaturschlüssel:</strong> Der oben hinterlegte Schlüssel dient zur HMAC-Validierung des Hashes.</li>
      </ul>
    `;
    helpText.style.display = 'block';
  } else {
    helpText.style.display = 'none';
  }
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
    time_limit_end: document.getElementById('tile_time_limit_end').value,
    open_in_new_tab: document.getElementById('tile_open_in_new_tab').checked ? 1 : 0,
    disable_status_check: document.getElementById('tile_disable_status_check').checked ? 1 : 0
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

    // Allgemeine Felder
    const impressumInput = document.getElementById('impressum_url');
    if (impressumInput) {
      impressumInput.value = cfg.impressum_url || 'https://www.mso-hef.de/impressum';
    }
    const disableStudentCheckInput = document.getElementById('disable_student_check');
    if (disableStudentCheckInput) {
      disableStudentCheckInput.checked = cfg.disable_student_check === '1';
    }
    const platformNameInput = document.getElementById('platform_name');
    if (platformNameInput) {
      platformNameInput.value = cfg.platform_name || 'MSO Cloud';
    }
    const platformLogoInput = document.getElementById('platform_logo');
    if (platformLogoInput) {
      platformLogoInput.value = cfg.platform_logo || '';
      const preview = document.getElementById('platform_logo_preview');
      const container = document.getElementById('platform_logo_preview_container');
      if (cfg.platform_logo) {
        preview.src = cfg.platform_logo;
        container.style.display = 'flex';
      } else {
        preview.src = '';
        container.style.display = 'none';
      }
    }

    // Schülerausweis Felder befüllen
    const cardSchoolInput = document.getElementById('card_school_name');
    if (cardSchoolInput) {
      cardSchoolInput.value = cfg.card_school_name || 'Modellschule Obersberg';
    }
    const cardPrincipalInput = document.getElementById('card_principal_name');
    if (cardPrincipalInput) {
      cardPrincipalInput.value = cfg.card_principal_name || 'OStD Karsten Backhaus';
    }
    const cardPrincipalGenderInput = document.getElementById('card_principal_gender');
    if (cardPrincipalGenderInput) {
      cardPrincipalGenderInput.value = cfg.card_principal_gender || 'male';
    }
    const cardColorInput = document.getElementById('card_primary_color');
    if (cardColorInput) {
      cardColorInput.value = cfg.card_primary_color || '#3b82f6';
    }
    const cardSecColorInput = document.getElementById('card_secondary_color');
    if (cardSecColorInput) {
      cardSecColorInput.value = cfg.card_secondary_color || '#8b5cf6';
    }
    const cardGPatternInput = document.getElementById('card_guilloche_pattern');
    if (cardGPatternInput) {
      cardGPatternInput.value = cfg.card_guilloche_pattern || 'waves';
    }
    const cardGAngleInput = document.getElementById('card_guilloche_angle');
    if (cardGAngleInput) {
      cardGAngleInput.value = cfg.card_guilloche_angle || '0';
      const angleValEl = document.getElementById('card_guilloche_angle_val');
      if (angleValEl) angleValEl.innerText = (cfg.card_guilloche_angle || '0') + '°';
    }
    const cardGFinenessInput = document.getElementById('card_guilloche_fineness');
    if (cardGFinenessInput) {
      cardGFinenessInput.value = cfg.card_guilloche_fineness || '1.2';
      const fineValEl = document.getElementById('card_guilloche_fineness_val');
      if (fineValEl) fineValEl.innerText = parseFloat(cfg.card_guilloche_fineness || '1.2').toFixed(1) + ' px';
    }
    const cardGDensityInput = document.getElementById('card_guilloche_density');
    if (cardGDensityInput) {
      cardGDensityInput.value = cfg.card_guilloche_density || '10';
      const densValEl = document.getElementById('card_guilloche_density_val');
      if (densValEl) densValEl.innerText = (cfg.card_guilloche_density || '10') + ' Linien';
    }
    const cardInstrInput = document.getElementById('card_install_instructions');
    if (cardInstrInput) {
      cardInstrInput.value = cfg.card_install_instructions || '';
    }
    const cardPwaLoggingInput = document.getElementById('card_pwa_logging');
    if (cardPwaLoggingInput) {
      cardPwaLoggingInput.checked = cfg.card_pwa_logging === '1';
    }

    // Logo Vorschau befüllen
    const logoImg = document.getElementById('card-logo-preview');
    const logoPlaceholder = document.getElementById('card-logo-placeholder');
    if (logoImg && logoPlaceholder) {
      if (cfg.card_logo) {
        logoImg.src = cfg.card_logo;
        logoImg.style.display = 'block';
        logoPlaceholder.style.display = 'none';
      } else {
        logoImg.src = '';
        logoImg.style.display = 'none';
        logoPlaceholder.style.display = 'block';
      }
    }

    // PWA Icon Vorschau befüllen
    const pwaIconImg = document.getElementById('card-pwa-icon-preview');
    const pwaIconPlaceholder = document.getElementById('card-pwa-icon-placeholder');
    if (pwaIconImg && pwaIconPlaceholder) {
      if (cfg.card_pwa_icon) {
        pwaIconImg.src = cfg.card_pwa_icon;
        pwaIconImg.style.display = 'block';
        pwaIconPlaceholder.style.display = 'none';
      } else {
        pwaIconImg.src = '';
        pwaIconImg.style.display = 'none';
        pwaIconPlaceholder.style.display = 'block';
      }
    }

    // Siegel Vorschau befüllen
    const sealImg = document.getElementById('card-seal-preview');
    const sealPlaceholder = document.getElementById('card-seal-placeholder');
    if (sealImg && sealPlaceholder) {
      if (cfg.card_seal) {
        sealImg.src = cfg.card_seal;
        sealImg.style.display = 'block';
        sealPlaceholder.style.display = 'none';
      } else {
        sealImg.src = '';
        sealImg.style.display = 'none';
        sealPlaceholder.style.display = 'block';
      }
    }

    // Unterschrift Vorschau befüllen
    const sigImg = document.getElementById('card-signature-preview');
    const sigPlaceholder = document.getElementById('card-signature-placeholder');
    if (sigImg && sigPlaceholder) {
      if (cfg.card_signature) {
        sigImg.src = cfg.card_signature;
        sigImg.style.display = 'block';
        sigPlaceholder.style.display = 'none';
      } else {
        sigImg.src = '';
        sigImg.style.display = 'none';
        sigPlaceholder.style.display = 'block';
      }
    }

    // Live-Vorschau der Karte im Adminbereich initialisieren & aktualisieren
    attachAdminCardLivePreviewListeners();
    updateAdminCardLivePreview();

  } catch (err) {
    showAdminAlert('Konfiguration konnte nicht geladen werden.', 'danger');
  }
}

// Guillochen SVG Generator für Admin Live-Vorschau
function generateAdminGuillocheSvg(pattern, fineness, density) {
  const w = parseFloat(fineness) || 1.2;
  const count = Math.max(3, parseInt(density, 10) || 10);
  let paths = '';

  if (pattern === 'waves_double') {
    const step = 120 / count;
    for (let i = 0; i < count; i++) {
      const y = (i * step).toFixed(1);
      const amp = 12 + (i % 3) * 4;
      paths += `<path d='M0 ${y} C 30 ${(y - amp).toFixed(1)}, 90 ${(parseFloat(y) + amp).toFixed(1)}, 120 ${y}' fill='none' stroke='#000000' stroke-width='${w}'/>`;
      paths += `<path d='M0 ${y} C 30 ${(parseFloat(y) + amp).toFixed(1)}, 90 ${(y - amp).toFixed(1)}, 120 ${y}' fill='none' stroke='#000000' stroke-width='${w * 0.7}'/>`;
    }
  } else if (pattern === 'radial') {
    const rStep = 60 / count;
    for (let i = 1; i <= count; i++) {
      const r = (i * rStep).toFixed(1);
      const dash = i % 2 === 0 ? " stroke-dasharray='4,2'" : "";
      paths += `<circle cx='60' cy='60' r='${r}' fill='none' stroke='#000000' stroke-width='${w}'${dash}/>`;
    }
    paths += `<path d='M60 0 L60 120' fill='none' stroke='#000000' stroke-width='${w * 0.8}'/>`;
    paths += `<path d='M0 60 L120 60' fill='none' stroke='#000000' stroke-width='${w * 0.8}'/>`;
  } else if (pattern === 'crosshatch') {
    const step = 120 / count;
    for (let i = 0; i < count; i++) {
      const offset = (i * step).toFixed(1);
      paths += `<line x1='0' y1='${offset}' x2='${(120 - offset).toFixed(1)}' y2='120' stroke='#000000' stroke-width='${w}'/>`;
      paths += `<line x1='${offset}' y1='0' x2='120' y2='${(120 - offset).toFixed(1)}' stroke='#000000' stroke-width='${w}'/>`;
    }
  } else if (pattern === 'spiral') {
    const rStep = 60 / count;
    for (let i = 1; i <= count; i++) {
      const r = i * rStep;
      const rx = (r * 0.4).toFixed(1);
      paths += `<rect x='${(60 - r).toFixed(1)}' y='${(60 - r).toFixed(1)}' width='${(r * 2).toFixed(1)}' height='${(r * 2).toFixed(1)}' rx='${rx}' fill='none' stroke='#000000' stroke-width='${w}'/>`;
    }
  } else {
    // Default waves (C1-nahtlos kachelnde Wellen ohne Knicke oder Lücken)
    const step = 120 / count;
    for (let i = 0; i < count; i++) {
      const y = (i * step).toFixed(1);
      const amp = 12 + (i % 2) * 6;
      paths += `<path d='M0 ${y} C 30 ${(y - amp).toFixed(1)}, 90 ${(parseFloat(y) + amp).toFixed(1)}, 120 ${y}' fill='none' stroke='#000000' stroke-width='${w}'/>`;
    }
  }

  const svgStr = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>${paths.replace(/\s+/g, ' ').trim()}</svg>`;
  return "url(\"data:image/svg+xml," + encodeURIComponent(svgStr) + "\")";
}

function updateAdminCardLivePreview() {
  const schoolName = document.getElementById('card_school_name')?.value || 'Modellschule Obersberg';
  const principalName = document.getElementById('card_principal_name')?.value || 'OStD Karsten Backhaus';
  const principalGender = document.getElementById('card_principal_gender')?.value || 'male';
  const primaryColor = document.getElementById('card_primary_color')?.value || '#3b82f6';
  const pattern = document.getElementById('card_guilloche_pattern')?.value || 'waves';
  const angle = parseInt(document.getElementById('card_guilloche_angle')?.value || '0', 10);
  const fineness = parseFloat(document.getElementById('card_guilloche_fineness')?.value || '1.2');
  const density = parseInt(document.getElementById('card_guilloche_density')?.value || '10', 10);

  const schoolEl = document.getElementById('admin-preview-school-title');
  if (schoolEl) schoolEl.innerText = schoolName;

  const principalEl = document.getElementById('admin-preview-principal-display');
  if (principalEl) principalEl.innerText = principalName;

  const titleEl = document.getElementById('admin-preview-principal-title');
  if (titleEl) {
    titleEl.innerText = principalGender === 'female' ? 'Schulleiterin' : 'Schulleiter';
  }

  const badgeEl = document.getElementById('admin-preview-badge');
  if (badgeEl) {
    badgeEl.style.borderColor = primaryColor;
    badgeEl.style.color = primaryColor;
    badgeEl.style.background = primaryColor + '1F';
  }
  const logoFallback = document.getElementById('admin-preview-logo-fallback');
  if (logoFallback) logoFallback.style.color = primaryColor;

  const guillocheEl = document.getElementById('admin-card-preview-guilloche');
  if (guillocheEl) {
    guillocheEl.style.backgroundImage = generateAdminGuillocheSvg(pattern, fineness, density);
    guillocheEl.style.transform = `rotate(${angle}deg)`;
  }

  // Image Previews
  const logoImg = document.getElementById('card-logo-preview');
  const prevLogoImg = document.getElementById('admin-preview-logo-img');
  if (logoImg && prevLogoImg) {
    if (logoImg.style.display !== 'none' && logoImg.src && logoImg.src.startsWith('data:')) {
      prevLogoImg.src = logoImg.src;
      prevLogoImg.style.display = 'block';
      if (logoFallback) logoFallback.style.display = 'none';
    } else {
      prevLogoImg.style.display = 'none';
      if (logoFallback) logoFallback.style.display = 'block';
    }
  }

  const pwaIconImg = document.getElementById('card-pwa-icon-preview');
  const prevWatermarkImg = document.getElementById('admin-preview-watermark-img');
  const prevHoloImg = document.getElementById('admin-preview-hologram-img');
  if (pwaIconImg) {
    if (pwaIconImg.style.display !== 'none' && pwaIconImg.src && pwaIconImg.src.startsWith('data:')) {
      if (prevWatermarkImg) prevWatermarkImg.src = pwaIconImg.src;
      if (prevHoloImg) prevHoloImg.src = pwaIconImg.src;
    }
  }

  const sealImg = document.getElementById('card-seal-preview');
  const prevSealImg = document.getElementById('admin-preview-seal-img');
  if (sealImg && prevSealImg) {
    if (sealImg.style.display !== 'none' && sealImg.src && sealImg.src.startsWith('data:')) {
      prevSealImg.src = sealImg.src;
      prevSealImg.style.display = 'block';
    } else {
      prevSealImg.style.display = 'none';
    }
  }

  const sigImg = document.getElementById('card-signature-preview');
  const prevSigImg = document.getElementById('admin-preview-sig-img');
  const prevSigText = document.getElementById('admin-preview-sig-placeholder');
  if (sigImg && prevSigImg) {
    if (sigImg.style.display !== 'none' && sigImg.src && sigImg.src.startsWith('data:')) {
      prevSigImg.src = sigImg.src;
      prevSigImg.style.display = 'block';
      if (prevSigText) prevSigText.style.display = 'none';
    } else {
      prevSigImg.style.display = 'none';
      if (prevSigText) prevSigText.style.display = 'inline';
    }
  }
}

let adminCardListenersAttached = false;
function attachAdminCardLivePreviewListeners() {
  if (adminCardListenersAttached) return;
  adminCardListenersAttached = true;

  const inputIds = [
    'card_school_name', 'card_principal_name', 'card_principal_gender', 'card_primary_color', 'card_secondary_color',
    'card_guilloche_pattern', 'card_guilloche_angle', 'card_guilloche_fineness', 'card_guilloche_density'
  ];
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateAdminCardLivePreview);
      el.addEventListener('change', updateAdminCardLivePreview);
    }
  });
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

async function saveGeneralConfig(e) {
  e.preventDefault();
  const body = {
    impressum_url: document.getElementById('impressum_url').value.trim(),
    disable_student_check: document.getElementById('disable_student_check').checked ? '1' : '0',
    platform_name: document.getElementById('platform_name').value.trim(),
    platform_logo: document.getElementById('platform_logo').value
  };

  try {
    const res = await fetch('api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showAdminAlert('Allgemeine Einstellungen erfolgreich gespeichert.');
      const footerLink = document.getElementById('footer-impressum-link');
      if (footerLink) {
        footerLink.href = body.impressum_url;
      }
      // Aktualisiere den Auth-Status und die Header-Ansichten sofort im Frontend
      await checkAuthStatus();
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
let oauthClientsCache = [];

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
    document.getElementById('oidc-discovery-url').innerText = `${fullBaseUrl}/.well-known/openid-configuration`;
    document.getElementById('oidc-jwks-url').innerText = `${fullBaseUrl}/jwks`;

    // 2. Clients vom Server abfragen
    const res = await fetch('api/admin/oauth-clients');
    const clients = await res.json();
    oauthClientsCache = clients;

    const tbody = document.getElementById('oauth-clients-list');
    tbody.innerHTML = '';

    if (clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">Keine SSO-Clients registriert.</td></tr>';
      return;
    }

    clients.forEach(client => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${escapeHtml(client.client_name)}</td>
        <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(client.client_id)}</td>
        <td style="font-family:monospace; font-size:0.85rem; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(client.redirect_uri)}">
          ${escapeHtml(client.redirect_uri)}
        </td>
        <td>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary" onclick="openOauthClientForm(${client.id})" style="padding: 4px 8px; font-size:0.8rem;"><i class="fa-solid fa-pen-to-square"></i> Bearbeiten</button>
            <button class="btn btn-danger" onclick="deleteOauthClient(${client.id})" style="padding: 4px 8px; font-size:0.8rem;"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showAdminAlert('OAuth 2.0-Konfiguration konnte nicht geladen werden: ' + err.message, 'danger');
  }
}

async function openOauthClientForm(id = null) {
  document.getElementById('oauth-client-form').reset();
  document.getElementById('oauth_db_id').value = '';
  document.getElementById('oauth-client-modal-title').innerText = id ? 'SSO-Client bearbeiten' : 'Neuer SSO-Client';

  if (id) {
    const client = oauthClientsCache.find(c => c.id === id);
    if (client) {
      document.getElementById('oauth_db_id').value = client.id;
      document.getElementById('oauth_client_name').value = client.client_name || '';
      document.getElementById('oauth_client_id').value = client.client_id || '';
      document.getElementById('oauth_client_secret').value = client.client_secret || '';
      document.getElementById('oauth_redirect_uri').value = client.redirect_uri || '';
    }
  }

  openModal('oauth-client-modal');
}

async function saveOauthClientForm(e) {
  e.preventDefault();
  const id = document.getElementById('oauth_db_id').value;
  const body = {
    client_name: document.getElementById('oauth_client_name').value.trim(),
    client_id: document.getElementById('oauth_client_id').value.trim(),
    client_secret: document.getElementById('oauth_client_secret').value.trim(),
    redirect_uri: document.getElementById('oauth_redirect_uri').value.trim()
  };

  const url = id ? `api/admin/oauth-clients/${id}` : 'api/admin/oauth-clients';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('oauth-client-modal');
      showAdminAlert(data.message, 'success');
      loadOauthClientConfig();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Speichern des SSO-Clients: ' + err.message);
  }
}

async function deleteOauthClient(id) {
  const client = oauthClientsCache.find(c => c.id === id);
  const name = client ? client.client_name : 'diesen Client';
  if (!confirm(`Möchtest du "${name}" wirklich unwiderruflich löschen?`)) return;

  try {
    const res = await fetch(`api/admin/oauth-clients/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (res.ok) {
      showAdminAlert(data.message, 'success');
      loadOauthClientConfig();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Fehler beim Löschen des SSO-Clients: ' + err.message);
  }
}

function generateOauthClientId() {
  const nameInput = document.getElementById('oauth_client_name');
  const namePrefix = nameInput ? nameInput.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '') : 'client';
  const prefix = namePrefix ? namePrefix : 'client';
  document.getElementById('oauth_client_id').value = prefix + '_' + Math.random().toString(36).substring(2, 10);
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

let allLdapMappings = [];

async function loadAdminLdapMappings() {
  const tbody = document.getElementById('admin-mappings-table-body');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Lade Mappings...</td></tr>';

  try {
    const res = await fetch('api/admin/ldap-mappings');
    allLdapMappings = await res.json();

    tbody.innerHTML = '';
    allLdapMappings.forEach(map => {
      const tr = document.createElement('tr');
      const roleText = map.user_role ? `<span class="user-badge" style="font-size:0.8rem; background:rgba(255,255,255,0.1); color:var(--text-primary);">${map.user_role}</span>` : '<span style="color:var(--text-secondary); font-size:0.8rem;">-</span>';
      tr.innerHTML = `
        <td style="font-family:monospace; font-size:0.8rem;">${map.ldap_group_dn}</td>
        <td><span class="user-badge" style="font-size:0.8rem; background:var(--accent-glow); color:var(--accent-color);">${map.local_group}</span></td>
        <td>${roleText}</td>
        <td class="actions-cell">
          <button class="btn btn-warning btn-icon" onclick="editLdapMapping(${map.id})" title="Bearbeiten"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-danger btn-icon" onclick="deleteLdapMapping(${map.id})" title="Löschen"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--error-color);">Fehler beim Laden: ${err.message}</td></tr>`;
  }
}

function openMappingForm() {
  document.getElementById('mapping-form').reset();
  document.getElementById('map_id').value = '';
  document.getElementById('mapping-modal-title').innerText = 'Neues LDAP-Mapping';
  document.getElementById('mapping-submit-btn').innerText = 'Hinzufügen';
  openModal('mapping-modal');
}

function editLdapMapping(id) {
  const map = allLdapMappings.find(m => m.id === id);
  if (!map) return;

  document.getElementById('map_id').value = map.id;
  document.getElementById('map_ldap_dn').value = map.ldap_group_dn;
  document.getElementById('map_local_group').value = map.local_group;
  document.getElementById('map_user_role').value = map.user_role || '';
  
  document.getElementById('mapping-modal-title').innerText = 'LDAP-Mapping bearbeiten';
  document.getElementById('mapping-submit-btn').innerText = 'Speichern';
  openModal('mapping-modal');
}

async function saveMappingForm(e) {
  e.preventDefault();
  const id = document.getElementById('map_id').value;
  const body = {
    ldap_group_dn: document.getElementById('map_ldap_dn').value.trim(),
    local_group: document.getElementById('map_local_group').value.trim(),
    user_role: document.getElementById('map_user_role').value.trim()
  };

  const url = id ? `api/admin/ldap-mappings/${id}` : 'api/admin/ldap-mappings';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      closeModal('mapping-modal');
      showAdminAlert(id ? 'Gruppen-Mapping aktualisiert.' : 'Gruppen-Mapping hinzugefügt.');
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

      // Nur gemappte Gruppen anzeigen (für LDAP) bzw. lokale Gruppen (für lokale User)
      const groupsStr = user.is_ldap === 1 
        ? (user.mapped_groups || []).join(', ') 
        : (user.groups || []).join(', ');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${user.username}</strong></td>
        <td>${user.email || ''}</td>
        <td>${typeLabel}</td>
        <td>${roleLabel}</td>
        <td><span style="font-size:0.85rem; color:var(--text-secondary);">${groupsStr || 'keine'}</span></td>
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
    document.getElementById('user_groups').value = (user.groups || []).join('\n');
    
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
  const groups = groupsRaw ? groupsRaw.split(/[,\n]/).map(g => g.trim()).filter(g => g) : [];

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
let filteredAdminLogs = [];
let currentLogPage = 1;
let logsPerPage = 50; // Standard 50 Einträge pro Seite

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
    currentLogPage = 1;
    
    filterAdminLogs();
  } catch (err) {
    showAdminAlert(err.message, 'danger');
    tableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:30px; color:var(--error-color);">
          <i class="fa-solid fa-triangle-exclamation fa-xl" style="margin-bottom:10px; display:block;"></i>
          Fehler beim Laden der Protokolle: ${err.message}
        </td>
      </tr>
    `;
  }
}

function filterAdminLogs() {
  const levelFilter = document.getElementById('log-filter-level').value;
  const searchFilter = document.getElementById('log-search').value.toLowerCase().trim();

  filteredAdminLogs = allAdminLogs.filter(log => {
    // Level match
    const levelMatch = (levelFilter === 'all' || log.level === levelFilter);
    
    // Search match (bezieht sich auf ALLE Daten)
    const searchMatch = !searchFilter || 
      log.action.toLowerCase().includes(searchFilter) ||
      log.message.toLowerCase().includes(searchFilter) ||
      (log.ip && log.ip.toLowerCase().includes(searchFilter)) ||
      (log.details && log.details.toLowerCase().includes(searchFilter));

    return levelMatch && searchMatch;
  });

  currentLogPage = 1;
  renderAdminLogsPage();
}

function changeLogsPerPage(val) {
  logsPerPage = val === 'all' ? 'all' : parseInt(val, 10);
  currentLogPage = 1;
  renderAdminLogsPage();
}

function changeLogPage(page) {
  const totalEntries = filteredAdminLogs.length;
  const pageSize = logsPerPage === 'all' ? totalEntries : parseInt(logsPerPage, 10);
  const totalPages = Math.ceil(totalEntries / (pageSize || 1)) || 1;

  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  currentLogPage = page;
  renderAdminLogsPage();
}

function renderAdminLogsPage() {
  const totalEntries = filteredAdminLogs.length;
  const isAll = logsPerPage === 'all';
  const pageSize = isAll ? totalEntries : parseInt(logsPerPage, 10);
  const totalPages = isAll ? 1 : (Math.ceil(totalEntries / (pageSize || 1)) || 1);

  if (currentLogPage > totalPages) currentLogPage = totalPages;
  if (currentLogPage < 1) currentLogPage = 1;

  const startIndex = isAll ? 0 : (currentLogPage - 1) * pageSize;
  const endIndex = isAll ? totalEntries : Math.min(startIndex + pageSize, totalEntries);
  const pageLogs = filteredAdminLogs.slice(startIndex, endIndex);

  // 1. Tabelle rendern
  renderAdminLogs(pageLogs);

  // 2. Paginierung Oben & Unten rendern
  renderPaginationControls('logs-pagination-top', startIndex, endIndex, totalEntries, totalPages);
  renderPaginationControls('logs-pagination-bottom', startIndex, endIndex, totalEntries, totalPages);
}

function renderPaginationControls(containerId, startIndex, endIndex, totalEntries, totalPages) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (totalEntries === 0) {
    container.innerHTML = '';
    return;
  }

  const showingStart = totalEntries > 0 ? startIndex + 1 : 0;
  const showingEnd = endIndex;

  const isSmallMobile = window.innerWidth <= 480;
  const maxButtons = isSmallMobile ? 3 : 5;
  let startPage = Math.max(1, currentLogPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  let pageButtons = '';
  for (let p = startPage; p <= endPage; p++) {
    const isActive = p === currentLogPage;
    pageButtons += `
      <button class="btn ${isActive ? 'btn-primary' : 'btn-secondary'} btn-sm" 
              style="padding: ${isSmallMobile ? '2px 6px' : '4px 8px'}; font-size: ${isSmallMobile ? '0.8rem' : '0.85rem'}; height: 30px; min-width: ${isSmallMobile ? '26px' : '30px'};" 
              onclick="changeLogPage(${p})">${p}</button>
    `;
  }

  const hideFirstLast = isSmallMobile ? 'display: none !important;' : '';

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; background:rgba(0,0,0,0.12); padding:10px 12px; border-radius:8px; border:1px solid var(--panel-border); max-width:100%; box-sizing:border-box; overflow:hidden;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; max-width:100%;">
        <span style="color:var(--text-secondary); font-size:0.82rem;">Anzahl:</span>
        <select class="form-control" style="width:75px; height:30px; padding:2px 6px; font-size:0.82rem;" onchange="changeLogsPerPage(this.value)">
          <option value="10" ${logsPerPage == 10 ? 'selected' : ''}>10</option>
          <option value="20" ${logsPerPage == 20 ? 'selected' : ''}>20</option>
          <option value="50" ${logsPerPage == 50 ? 'selected' : ''}>50</option>
          <option value="100" ${logsPerPage == 100 ? 'selected' : ''}>100</option>
          <option value="200" ${logsPerPage == 200 ? 'selected' : ''}>200</option>
          <option value="all" ${logsPerPage === 'all' ? 'selected' : ''}>Alle</option>
        </select>
        <span style="color:var(--text-secondary); font-size:0.82rem;">
          Einträge ${showingStart}–${showingEnd} von ${totalEntries}
        </span>
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:3px; flex-wrap:wrap; max-width:100%;">
        <button class="btn btn-secondary btn-sm" style="padding:2px 6px; height:30px; ${hideFirstLast}" onclick="changeLogPage(1)" ${currentLogPage === 1 || totalPages <= 1 ? 'disabled' : ''} title="Erste Seite"><i class="fa-solid fa-angles-left"></i></button>
        <button class="btn btn-secondary btn-sm" style="padding:2px 6px; height:30px;" onclick="changeLogPage(${currentLogPage - 1})" ${currentLogPage === 1 || totalPages <= 1 ? 'disabled' : ''} title="Vorherige Seite"><i class="fa-solid fa-angle-left"></i></button>
        
        ${pageButtons}

        <button class="btn btn-secondary btn-sm" style="padding:2px 6px; height:30px;" onclick="changeLogPage(${currentLogPage + 1})" ${currentLogPage === totalPages || totalPages <= 1 ? 'disabled' : ''} title="Nächste Seite"><i class="fa-solid fa-angle-right"></i></button>
        <button class="btn btn-secondary btn-sm" style="padding:2px 6px; height:30px; ${hideFirstLast}" onclick="changeLogPage(${totalPages})" ${currentLogPage === totalPages || totalPages <= 1 ? 'disabled' : ''} title="Letzte Seite"><i class="fa-solid fa-angles-right"></i></button>
      </div>
    </div>
  `;
}

function toggleAccRow(tr) {
  if (window.innerWidth <= 768) {
    tr.classList.toggle('expanded');
  }
}

function getLogUsername(log) {
  if (log.details) {
    try {
      const d = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      if (d.username) return d.username;
      if (d.user) return d.user;
      if (d.email) return d.email;
    } catch(e) {}
  }
  if (log.message) {
    const match = log.message.match(/für:\s*([^\s,;]+)|Benutzer\s+([^\s,;]+)|User\s+([^\s,;]+)|E-Mail:\s*([^\s,;]+)/i);
    if (match) {
      return match[1] || match[2] || match[3] || match[4];
    }
  }
  return 'system';
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

    const username = getLogUsername(log);
    const actionFormatted = `${log.action} (${username})`;

    return `
      <tr>
        <!-- Mobile Accordion Cell -->
        <td class="acc-cell-main mobile-only">
          <div class="acc-header-bar" onclick="toggleAccRow(this.closest('tr'))">
            <div class="acc-header-left">
              <code style="color:var(--warn-color); font-weight:600; font-family:monospace; font-size:0.85rem;">${actionFormatted}</code>
            </div>
            <div class="acc-header-right">
              ${levelBadge}
              <i class="fa-solid fa-chevron-down acc-chevron"></i>
            </div>
          </div>
          <div class="acc-body-content">
            <div class="acc-detail-line"><strong>Zeitstempel:</strong> <span>${dateStr}</span></div>
            <div class="acc-detail-line"><strong>Level:</strong> <span>${levelBadge}</span></div>
            <div class="acc-detail-line"><strong>Aktion:</strong> <code style="color:var(--warn-color); font-weight:600; font-family:monospace; font-size:0.85rem;">${log.action}</code></div>
            <div class="acc-detail-line"><strong>Meldung:</strong> <span style="word-break:break-word;">${log.message}</span></div>
            <div class="acc-detail-line"><strong>IP-Adresse:</strong> <code>${log.ip || '-'}</code></div>
            <div class="acc-detail-line" style="border-bottom:none;">
              <strong>Details:</strong>
              <div>${detailBtn}</div>
            </div>
          </div>
        </td>

        <!-- Desktop Columns -->
        <td class="desktop-only" style="font-size:0.9rem; font-weight:500;">${dateStr}</td>
        <td class="desktop-only">${levelBadge}</td>
        <td class="desktop-only"><code style="color:var(--warn-color); font-weight:600; font-family:monospace; font-size:0.85rem;">${log.action}</code></td>
        <td class="desktop-only" style="font-size:0.9rem; font-weight:normal; max-width: 350px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.message}">${log.message}</td>
        <td class="desktop-only"><code style="font-family:monospace; font-size:0.85rem;">${log.ip || '-'}</code></td>
        <td class="desktop-only" style="text-align:center;">${detailBtn}</td>
      </tr>
    `;
  }).join('');
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
let activeSphTileOpenInNewTab = false;

async function openSphCredentialsModal(event, tileId, openInNewTab) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  activeSphTileId = tileId;
  activeSphTileOpenInNewTab = !!openInNewTab;
  
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
      if (activeSphTileOpenInNewTab) {
        window.open(`api/tiles/sso/${activeSphTileId}`, '_blank');
      } else {
        window.location.href = `api/tiles/sso/${activeSphTileId}`;
      }
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

async function handleSphClick(e, tileId, openInNewTab) {
  // 1. Wenn nicht eingeloggt in der MSO Cloud, ganz normale Weiterleitung erlauben
  if (!currentUser) {
    return;
  }

  e.preventDefault(); // Standard-Navigation unterbrechen
  activeSphTileId = tileId;
  activeSphTileOpenInNewTab = !!openInNewTab;
  
  try {
    // 2. Prüfen, ob Zugangsdaten hinterlegt sind
    const res = await fetch('api/auth/sph-credentials');
    const data = await res.json();

    if (data.exists) {
      // Zugangsdaten vorhanden -> Direkt weiterleiten (löst den Auto-POST aus!)
      if (activeSphTileOpenInNewTab) {
        window.open(`api/tiles/sso/${tileId}`, '_blank');
      } else {
        window.location.href = `api/tiles/sso/${tileId}`;
      }
      return;
    }

    // 3. Keine Zugangsdaten vorhanden -> Prüfen, ob der Info-Popup Opt-out aktiv ist
    const alwaysShow = localStorage.getItem('sph_always_show_info') !== 'false';
    if (!alwaysShow) {
      // Benutzer hat Opt-out gewählt -> Direkt zur normalen SPH-Loginseite weiterleiten
      if (activeSphTileOpenInNewTab) {
        window.open(`api/tiles/sso/${tileId}`, '_blank');
      } else {
        window.location.href = `api/tiles/sso/${tileId}`;
      }
      return;
    }

    // 4. Info-Modal anzeigen!
    document.getElementById('sph-info-always-show').checked = true;
    
    // Verlinkung im Modal-Text zum Öffnen des Zugangsdaten-Eingabemodals
    document.getElementById('sph-info-link-credentials').onclick = (event) => {
      closeModal('sph-info-modal');
      openSphCredentialsModal(event, tileId, openInNewTab);
    };

    openModal('sph-info-modal');

  } catch (err) {
    console.error('Fehler bei SPH-Weiterleitungsprüfung:', err);
    // Fallback: Direkt weiterleiten
    if (activeSphTileOpenInNewTab) {
      window.open(`api/tiles/sso/${tileId}`, '_blank');
    } else {
      window.location.href = `api/tiles/sso/${tileId}`;
    }
  }
}

function proceedToSchulportal() {
  // Opt-out Checkbox Zustand sichern
  const alwaysShow = document.getElementById('sph-info-always-show').checked;
  localStorage.setItem('sph_always_show_info', alwaysShow ? 'true' : 'false');
  
  closeModal('sph-info-modal');
  if (activeSphTileOpenInNewTab) {
    window.open(`api/tiles/sso/${activeSphTileId}`, '_blank');
  } else {
    window.location.href = `api/tiles/sso/${activeSphTileId}`;
  }
}

/* --- Booking Autologin (Obsolete - JWT is used now) --- */

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
  const cascadeurl = 'media/facefinder';
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
  const form = document.getElementById('student-email-form');
  const btn = form.querySelector('button[type="submit"]');

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

  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Bitte warten...';
  btn.disabled = true;

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
      form.reset();
    } else {
      throw new Error(data.error || 'Fehler beim Anfordern des Links.');
    }
  } catch (err) {
    alertBox.className = 'alert alert-danger';
    alertBox.innerText = err.message;
    alertBox.style.display = 'block';
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
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

}

async function loadStudentProfile() {
  clearStudentViewDOM();
  try {
    const res = await fetch('api/auth/student-profile');
    if (!res.ok) {
      // Fallback für Nicht-Schüler / Admin-Accounts
      document.getElementById('header-full-name').innerText = currentUser.display_name || currentUser.username;
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
    const msoPwdText = document.getElementById('student-mso-password-display-text');
    const msoPwdToggle = document.getElementById('student-mso-password-toggle');
    
    if (msoPwdText && msoPwdToggle) {
      if (!profile.start_password || profile.start_password === 'geändert' || profile.start_password === '-') {
        msoPwdText.innerHTML = '<span style="font-size:0.8rem; color:var(--text-secondary); font-family:sans-serif; font-weight:normal;">Bereits geändert</span>';
        msoPwdText.style.letterSpacing = 'normal';
        msoPwdToggle.style.display = 'none';
        currentMsoPassword = '';
      } else {
        currentMsoPassword = profile.start_password;
        msoPwdText.textContent = '••••••••';
        msoPwdText.style.letterSpacing = '2px';
        msoPwdToggle.style.display = 'inline-block';
      }
    }

    document.getElementById('student-mediothek-number').innerText = profile.mediothek_number || '-';
    document.getElementById('student-sph-username-display').innerText = profile.sph_username || '-';

    const sphPwdText = document.getElementById('student-sph-password-display-text');
    const sphPwdToggle = document.getElementById('student-sph-password-toggle');
    
    if (sphPwdText && sphPwdToggle) {
      if (!profile.sph_password || profile.sph_password === '-') {
        sphPwdText.innerHTML = '<span style="font-size:0.8rem; color:var(--text-secondary); font-family:sans-serif; font-weight:normal;">Kein Startpasswort</span>';
        sphPwdText.style.letterSpacing = 'normal';
        sphPwdToggle.style.display = 'none';
        currentSphPassword = '';
      } else {
        currentSphPassword = profile.sph_password;
        sphPwdText.textContent = '••••••••';
        sphPwdText.style.letterSpacing = '2px';
        sphPwdToggle.style.display = 'inline-block';
      }
    }

    const statusEl = document.getElementById('student-account-status');
    if (profile.is_preview) {
      statusEl.innerText = 'Aktiv (Admin-Vorschau mit Dummy-Daten)';
      statusEl.style.color = 'var(--accent-color)';
    } else if (profile.account_status === 'true') {
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
      cardStatusEl.style.fontWeight = 'normal';
    } else if (profile.card_status === 'Bild eingereicht') {
      cardStatusEl.style.color = 'var(--accent-color)';
      cardStatusEl.style.fontWeight = 'normal';
    } else if (profile.card_status === 'Bild abgelehnt') {
      cardStatusEl.style.color = 'var(--error-color)';
      cardStatusEl.style.fontWeight = 'bold';
    } else {
      cardStatusEl.style.color = 'var(--warn-color)';
      cardStatusEl.style.fontWeight = 'normal';
    }

    // Foto-Upload-Buttons steuern: gedruckt/ausgegeben (1132, 1133) -> Buttons ausblenden.
    // 1130 (kein Bild), 1131 (eingereicht / noch nicht genehmigt geprüft), 1134 (abgelehnt) -> Upload erlaubt.
    const uploadAllowed = ['1130', '1131', '1134'].includes(profile.card_status_code) || 
                          (profile.card_status !== 'Bild genehmigt' && profile.card_status !== 'Bild gedruckt' && profile.card_status !== 'Bild ausgegeben');
    
    const uploadBtnLobby = document.getElementById('student-photo-upload-btn');
    const uploadBtnCard = document.getElementById('student-photo-upload-btn-card');
    
    if (uploadBtnLobby) {
      uploadBtnLobby.style.display = uploadAllowed ? 'flex' : 'none';
    }
    if (uploadBtnCard) {
      uploadBtnCard.style.display = uploadAllowed ? 'flex' : 'none';
    }

    const previewImg = document.getElementById('student-photo-preview');
    previewImg.src = profile.card_image || 'media/user.png';



    // 2. Header Avatar & Anzeigenamen befüllen (Nur wenn es ein echter Schüler ist, nicht bei Admin-Vorschau)
    if (!profile.is_preview) {
      const fullName = ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim();
      document.getElementById('header-full-name').innerText = fullName || currentUser.username;
      if (profile.card_image) {
        document.getElementById('header-user-avatar').src = profile.card_image;
      }
    }

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
        cardStatusText.style.fontWeight = 'normal';
      } else if (profile.card_status === 'Bild eingereicht') {
        cardStatusText.style.color = 'var(--accent-color)';
        cardStatusText.style.fontWeight = 'normal';
      } else if (profile.card_status === 'Bild abgelehnt') {
        cardStatusText.style.color = 'var(--error-color)';
        cardStatusText.style.fontWeight = 'bold';
      } else {
        cardStatusText.style.color = 'var(--warn-color)';
        cardStatusText.style.fontWeight = 'normal';
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
        cardStatusLabel.style.color = 'var(--error-color)';
      } else {
        cardStatusLabel.innerHTML = '<i class="fa-solid fa-circle-question"></i> INAKTIV';
        cardStatusLabel.style.color = 'var(--warn-color)';
      }
    }

  } catch (err) {
    console.error('Fehler beim Laden des Schülerprofils:', err);
    // Fallback bei Verbindungsfehlern
    document.getElementById('header-full-name').innerText = currentUser.display_name || currentUser.username;
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
    console.log('[MSO Photo Upload Debug Log]:', data.debugLog || 'No debug log returned');
    
    if (res.ok && data.success) {
      alert("Erfolg: Ihr Passbild wurde erfolgreich hochgeladen und zur Prüfung eingereicht.");
      await loadStudentProfile();
    } else {
      alert("Fehler beim Hochladen: " + (data.error || data.message || 'Serverfehler'));
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
    window.location.href = 'student_card.html';
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

function previewImageFile(input, imgId) {
  const file = input.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = document.getElementById(imgId);
      img.src = e.target.result;
      img.style.display = 'block';
      
      const placeholderId = imgId.replace('preview', 'placeholder');
      const placeholder = document.getElementById(placeholderId);
      if (placeholder) placeholder.style.display = 'none';

      if (typeof updateAdminCardLivePreview === 'function') {
        updateAdminCardLivePreview();
      }
    }
    reader.readAsDataURL(file);
  }
}

async function saveCardConfig(e) {
  e.preventDefault();
  
  const logoImg = document.getElementById('card-logo-preview');
  const pwaIconImg = document.getElementById('card-pwa-icon-preview');
  const sealImg = document.getElementById('card-seal-preview');
  const sigImg = document.getElementById('card-signature-preview');
  
  const body = {
    card_school_name: document.getElementById('card_school_name').value.trim(),
    card_principal_name: document.getElementById('card_principal_name').value.trim(),
    card_principal_gender: document.getElementById('card_principal_gender') ? document.getElementById('card_principal_gender').value : 'male',
    card_primary_color: document.getElementById('card_primary_color').value,
    card_secondary_color: document.getElementById('card_secondary_color').value,
    card_guilloche_pattern: document.getElementById('card_guilloche_pattern') ? document.getElementById('card_guilloche_pattern').value : 'waves',
    card_guilloche_angle: document.getElementById('card_guilloche_angle') ? document.getElementById('card_guilloche_angle').value : '0',
    card_guilloche_fineness: document.getElementById('card_guilloche_fineness') ? document.getElementById('card_guilloche_fineness').value : '1.2',
    card_guilloche_density: document.getElementById('card_guilloche_density') ? document.getElementById('card_guilloche_density').value : '10',
    card_install_instructions: document.getElementById('card_install_instructions').value.trim(),
    card_logo: logoImg.src && logoImg.src.startsWith('data:') ? logoImg.src : '',
    card_pwa_icon: pwaIconImg.src && pwaIconImg.src.startsWith('data:') ? pwaIconImg.src : '',
    card_seal: sealImg.src && sealImg.src.startsWith('data:') ? sealImg.src : '',
    card_signature: sigImg.src && sigImg.src.startsWith('data:') ? sigImg.src : '',
    card_pwa_logging: document.getElementById('card_pwa_logging').checked ? '1' : '0'
  };

  try {
    const res = await fetch('api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      showAdminAlert('Schülerausweis-Einstellungen erfolgreich gespeichert.');
    } else {
      let errMsg = 'Fehler beim Speichern.';
      try {
        const err = await res.json();
        errMsg = err.error || errMsg;
      } catch (jsonErr) {
        errMsg = `Serverfehler (${res.status}): ${res.statusText || 'Interner Fehler'}`;
      }
      throw new Error(errMsg);
    }
  } catch (err) {
    showAdminAlert(err.message, 'danger');
  }
}

function convertPlatformLogoToBase64(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if (file.size > 2 * 1024 * 1024) {
      alert("Das Logo darf maximal 2 MB groß sein.");
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('platform_logo').value = e.target.result;
      const preview = document.getElementById('platform_logo_preview');
      preview.src = e.target.result;
      document.getElementById('platform_logo_preview_container').style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }
}

function removePlatformLogo() {
  document.getElementById('platform_logo_upload').value = '';
  document.getElementById('platform_logo').value = '';
  document.getElementById('platform_logo_preview').src = '';
  document.getElementById('platform_logo_preview_container').style.display = 'none';
}

function toggleAdminSidebar() {
  const sidebar = document.querySelector('.admin-sidebar');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
}


