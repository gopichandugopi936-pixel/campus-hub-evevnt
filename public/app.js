const $ = selector => document.querySelector(selector);

const state = {
  user: null,
  events: [],
  mode: 'login',
  scanner: null,
  scannerStarting: false,
  processingScan: false
};

const dateFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric'
});

const dateLong = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric'
});

const timeFmt = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit'
});

const dateValue = value => new Date(`${value}T12:00:00`);

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || 'Something went wrong. Please try again.');
  }

  return body;
}

// LOAD QR SCANNER LIBRARY
function loadQrLibrary() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) {
      resolve();
      return;
    }

    const existing = document.querySelector(
      'script[data-qr-library="true"]'
    );

    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });

      if (window.Html5Qrcode) resolve();
      return;
    }

    const script = document.createElement('script');

    script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
    script.async = true;
    script.dataset.qrLibrary = 'true';

    script.onload = resolve;
    script.onerror = () => reject(
      new Error('Could not load QR scanner. Check your internet connection.')
    );

    document.head.appendChild(script);
  });
}

function toast(message) {
  const el = $('#toast');
  if (!el) return;

  el.textContent = message;
  el.classList.remove('hidden');

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.add('hidden');
  }, 2900);
}

function showResult(el, message, error = false) {
  if (!el) return;

  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
}

function setUser(user) {
  state.user = user;

  const label = $('#user-label');
  const account = $('#account-button');
  const organizerLink = $('.organizer-link');

  if (label) {
    label.textContent = user
      ? `Hi, ${user.name.split(' ')[0]}`
      : 'Guest';
  }

  if (account) {
    account.innerHTML = user
      ? 'Sign out <span aria-hidden="true">↗</span>'
      : 'Sign in <span aria-hidden="true">↗</span>';
  }

  if (organizerLink) {
    organizerLink.classList.toggle(
      'hidden',
      user?.role !== 'organizer'
    );
  }
}

function setPage(hash = location.hash) {
  const page = hash.replace('#', '') || 'home';

  $('#home').classList.toggle(
    'hidden',
    !['home', 'events'].includes(page)
  );

  $('#tickets').classList.toggle(
    'hidden',
    page !== 'tickets'
  );

  $('#organizer').classList.toggle(
    'hidden',
    page !== 'organizer' || state.user?.role !== 'organizer'
  );

  if (page === 'tickets') loadTickets();

  if (page === 'organizer' && state.user?.role === 'organizer') {
    loadStats();
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle(
      'active',
      link.getAttribute('href') === '#' + page ||
      (page === 'events' && link.getAttribute('href') === '#home')
    );
  });

  $('.main-nav').classList.remove('open');
}

function renderEvents() {
  const term = $('#search').value.trim().toLowerCase();
  const category = $('#category-filter').value;

  const icons = {
    'Arts & Culture': '◈',
    'Technology': '⌘',
    'Community': '✳',
    'Music': '♫',
    'Sport': '◉'
  };

  const filtered = state.events.filter(e =>
    (category === 'all' || e.category === category) &&
    `${e.title} ${e.description} ${e.venue} ${e.category}`
      .toLowerCase()
      .includes(term)
  );

  const grid = $('#event-grid');

  if (!filtered.length) {
    grid.innerHTML =
      '<div class="empty-state">Nothing here just yet. Try another search.</div>';
    return;
  }

  grid.innerHTML = filtered.map(e => {
    const remaining = Math.max(0, e.capacity - e.attendees);
    const isFull = !remaining;

    return `
      <article class="event-card">
        <div class="event-cover" style="background:${esc(e.accent)}">
          <div class="cover-pattern"></div>
          <span class="cover-emoji">${icons[e.category] || '✦'}</span>
          <span class="cover-title">
            ${esc(e.title.split(/[:–—]/)[0])}
          </span>
        </div>

        <div class="event-info">
          <div class="event-meta">
            <span class="category">${esc(e.category)}</span>
            <span class="availability">
              ${isFull ? 'FULL' : `${remaining} spots left`}
            </span>
          </div>

          <h3>${esc(e.title)}</h3>

          <div class="event-detail">
            <span>◷</span>
            ${dateFmt.format(dateValue(e.date))}
            · ${esc(timeFmt.format(new Date(`2000-01-01T${e.time}`)))}
          </div>

          <div class="event-detail">
            <span>⌖</span>
            ${esc(e.venue)}
          </div>

          <div class="card-footer">
            <span class="spots">
              <strong>${e.attendees}</strong> going
            </span>

            <button
              class="card-action"
              data-event="${e.id}"
              ${isFull || e.registered ? 'disabled' : ''}
            >
              ${e.registered
                ? 'You’re in ✓'
                : isFull
                  ? 'Wait for a spot'
                  : 'Save my spot ↗'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-event]').forEach(button => {
    button.addEventListener('click', () => {
      register(button.dataset.event);
    });
  });
}

async function loadEvents() {
  try {
    state.events = await api('/api/events');

    const categories = [
      ...new Set(state.events.map(e => e.category))
    ];

    $('#category-filter').innerHTML =
      '<option value="all">All events</option>' +
      categories.map(c =>
        `<option value="${esc(c)}">${esc(c)}</option>`
      ).join('');

    renderEvents();

  } catch (e) {
    $('#event-grid').innerHTML =
      `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

async function register(id) {
  if (!state.user) {
    openModal();
    return;
  }

  try {
    await api(`/api/events/${id}/register`, {
      method: 'POST',
      body: '{}'
    });

    toast('You’re on the list. Your ticket is ready!');

    await loadEvents();

  } catch (e) {
    toast(e.message);
  }
}

async function loadTickets() {
  const grid = $('#ticket-grid');

  grid.innerHTML =
    '<div class="empty-ticket">Loading your tickets…</div>';

  if (!state.user) {
    grid.innerHTML =
      '<div class="empty-ticket">Sign in first to see your tickets.</div>';
    return;
  }

  try {
    const tickets = await api('/api/my-tickets');

    if (!tickets.length) {
      grid.innerHTML =
        '<div class="empty-ticket">No tickets yet. Pick an event and save your spot.</div>';
      return;
    }

    grid.innerHTML = tickets.map(t => `
      <article class="ticket">
        <img
          src="${t.qr}"
          alt="QR ticket for ${esc(t.title)}"
        >

        <div>
          <h3>${esc(t.title)}</h3>

          <p>
            ${esc(dateLong.format(dateValue(t.date)))}
            · ${esc(timeFmt.format(new Date(`2000-01-01T${t.time}`)))}
          </p>

          <p>${esc(t.venue)}</p>

          <p class="${t.checked_in_at ? 'checked' : ''}">
            ${t.checked_in_at
              ? '✓ Checked in'
              : 'Show this QR at the door'}
          </p>

          <a
            class="button button-dark"
            download="gather-ticket-${t.event_id}.png"
            href="${t.qr}"
          >
            Download QR <span>↓</span>
          </a>
        </div>
      </article>
    `).join('');

  } catch (e) {
    grid.innerHTML =
      `<div class="empty-ticket">${esc(e.message)}</div>`;
  }
}

async function loadStats() {
  try {
    const s = await api('/api/stats');

    $('#stats-row').innerHTML = [
      ['Events live', s.events],
      ['Student signups', s.registrations],
      ['Checked in', s.checkedIn]
    ].map(([label, n]) => `
      <div class="stat-card">
        <span>${label}</span>
        <strong>${n}</strong>
      </div>
    `).join('');

  } catch (e) {
    toast(e.message);
  }
}

// LOGIN MODAL
function openModal() {
  $('#modal-backdrop').classList.remove('hidden');
  $('#auth-error').classList.add('hidden');
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
}

function setMode(mode) {
  state.mode = mode;

  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  $('#name-field').classList.toggle('hidden', mode !== 'signup');

  $('#auth-form [name=name]').required = mode === 'signup';

  $('#modal-title').innerHTML = mode === 'login'
    ? 'Find your people<span class="brand-dot">.</span>'
    : 'Make yourself at home<span class="brand-dot">.</span>';

  $('.auth-submit').innerHTML = mode === 'login'
    ? 'Continue <span>↗</span>'
    : 'Create account <span>↗</span>';
}

// ACCOUNT LOGIN AND LOGOUT
$('#account-button').addEventListener('click', async () => {
  if (state.user) {
    try {
      await api('/api/logout', {
        method: 'POST',
        body: '{}'
      });

      setUser(null);
      await loadEvents();
      setPage('#home');
      toast('Signed out. See you around!');

    } catch (e) {
      toast(e.message);
    }

  } else {
    openModal();
  }
});

// MODAL CONTROLS
$('#modal-close').addEventListener('click', closeModal);

$('#modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') {
    closeModal();
  }
});

document.querySelectorAll('.auth-tab').forEach(t => {
  t.addEventListener('click', () => setMode(t.dataset.mode));
});

// LOGIN AND SIGNUP
$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));

  try {
    const result = await api(
      state.mode === 'login' ? '/api/login' : '/api/signup',
      {
        method: 'POST',
        body: JSON.stringify(data)
      }
    );

    setUser(result.user);
    closeModal();

    await loadEvents();

    toast(
      `Welcome${result.user.role === 'organizer'
        ? ' to your organizer desk'
        : ''}, ${result.user.name.split(' ')[0]}!`
    );

    if (result.user.role === 'organizer') {
      location.hash = 'organizer';
    }

    form.reset();

  } catch (err) {
    $('#auth-error').textContent = err.message;
    $('#auth-error').classList.remove('hidden');
  }
});

// SEARCH AND FILTERS
$('#search').addEventListener('input', renderEvents);

$('#category-filter').addEventListener('change', renderEvents);

// MOBILE NAVIGATION
$('#menu-button').addEventListener('click', () => {
  $('.main-nav').classList.toggle('open');
});

window.addEventListener('hashchange', () => setPage());

// PUBLISH EVENT
$('#event-form').addEventListener('submit', async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));

  data.capacity = Number(data.capacity);

  const resultBox = $('#event-result');

  if (resultBox) {
    resultBox.classList.add('hidden');
  }

  try {
    const result = await api('/api/events', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    form.reset();

    showResult(
      resultBox,
      result.message || 'Event published. It’s now on the campus calendar.'
    );

    toast('Your event has been published!');

    await loadEvents();
    await loadStats();

  } catch (err) {
    showResult(resultBox, err.message, true);
    toast(err.message);
  }
});

// MANUAL CHECK-IN
async function submitCheckin(token) {
  if (!token || !token.trim()) {
    showResult(
      $('#checkin-result'),
      'Please enter a CEH ticket token.',
      true
    );
    return;
  }

  try {
    const result = await api('/api/checkin', {
      method: 'POST',
      body: JSON.stringify({
        token: token.trim()
      })
    });

    showResult(
      $('#checkin-result'),
      `✓ ${result.name} checked in for ${result.event}.`
    );

    $('#checkin-token').value = '';

    await loadStats();

    toast('Ticket checked in successfully!');

  } catch (err) {
    showResult($('#checkin-result'), err.message, true);
  }
}

$('#checkin-form').addEventListener('submit', async e => {
  e.preventDefault();

  await submitCheckin($('#checkin-token').value);
});

// =====================================
// CAMERA QR SCANNER - HTML5 QRCODE
// =====================================

async function startScan() {
  if (state.scannerStarting) return;

  if (state.scanner) {
    await stopScan();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Camera requires localhost or HTTPS. Open your website using localhost.');
    return;
  }

  state.scannerStarting = true;

  const button = $('#start-scan');
  const box = $('#scanner');

  button.disabled = true;
  button.textContent = 'Starting camera...';

  try {
    // Load QR scanner library
    await loadQrLibrary();

    if (!box) {
      throw new Error('Camera preview element #scanner was not found.');
    }

    box.innerHTML = '';

    const scanner = new Html5Qrcode('scanner');

    state.scanner = scanner;

    const config = {
      fps: 10,
      qrbox: {
        width: 230,
        height: 230
      },
      aspectRatio: 1.0
    };

    await scanner.start(
      { facingMode: 'environment' },
      config,

      async decodedText => {
        if (state.processingScan) return;

        state.processingScan = true;

        // Only accept Campus Event Hub QR tickets
        if (!decodedText.startsWith('CEH:')) {
          toast('This is not a valid Campus Event Hub ticket.');
          state.processingScan = false;
          return;
        }

        $('#checkin-token').value = decodedText;

        await stopScan();

        await submitCheckin(decodedText);

        state.processingScan = false;
      },

      () => {
        // QR not found in this frame. Continue scanning.
      }
    );

    button.textContent = 'Stop camera scan';
    toast('Camera started. Point it at a student ticket QR.');

  } catch (error) {
    console.error('Camera scanner error:', error);

    state.scanner = null;

    box.innerHTML = `
      <span class="scanner-graphic">▦</span>
      <span>Camera preview</span>
    `;

    let message = error.message || 'Could not start camera.';

    if (error.name === 'NotAllowedError') {
      message = 'Camera permission denied. Allow camera access in Chrome settings.';
    } else if (error.name === 'NotFoundError') {
      message = 'No camera found on this device.';
    } else if (error.name === 'NotReadableError') {
      message = 'Camera is being used by another application. Close other camera apps.';
    } else if (error.name === 'NotSupportedError') {
      message = 'Camera is not supported in this browser or page context.';
    }

    toast(message);

  } finally {
    state.scannerStarting = false;
    button.disabled = false;

    if (!state.scanner) {
      button.innerHTML = 'Start camera scan <span>⌖</span>';
    }
  }
}

async function stopScan() {
  if (!state.scanner) return;

  const scanner = state.scanner;

  state.scanner = null;

  try {
    await scanner.stop();
  } catch (error) {
    console.warn('Scanner stop:', error);
  }

  try {
    await scanner.clear();
  } catch (error) {
    console.warn('Scanner clear:', error);
  }

  $('#scanner').innerHTML = `
    <span class="scanner-graphic">▦</span>
    <span>Camera preview</span>
  `;

  $('#start-scan').innerHTML =
    'Start camera scan <span>⌖</span>';
}

$('#start-scan').addEventListener('click', startScan);

// Stop camera when leaving organizer page
window.addEventListener('hashchange', async () => {
  if (location.hash !== '#organizer' && state.scanner) {
    await stopScan();
  }
});

// STOP CAMERA WHEN TAB IS HIDDEN
document.addEventListener('visibilitychange', async () => {
  if (document.hidden && state.scanner) {
    await stopScan();
  }
});

// APPLICATION INITIALIZATION
(async function initializeApp() {
  try {
    const { user } = await api('/api/me');
    setUser(user);

  } catch (error) {
    setUser(null);
  }

  await loadEvents();

  setPage();

})();