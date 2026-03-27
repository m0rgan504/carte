/* ============================================================
   GEOWATCH — app.js
   Carte météo mondiale cyberpunk — 100% APIs gratuites
   ============================================================ */

// ─── CONFIG ───────────────────────────────────────────────────
const CFG = {
  refreshInterval: 60000,      // 1 minute
  issRefresh: 5000,            // 5 secondes
  eqRefresh: 300000,           // 5 minutes
  defaultLat: 48.8566,
  defaultLng: 2.3522,
  defaultZoom: 4,
};

// ─── ÉTAT GLOBAL ──────────────────────────────────────────────
let map, issMarker, currentLat, currentLng;
let isGlobeMode = false;
let zoomLevel = CFG.defaultZoom;
let eqLayer, stormLayer, volcanoLayer, floodLayer;
let weatherMarkers = [];
let userLocation = { lat: CFG.defaultLat, lng: CFG.defaultLng };

// ─── CODES MÉTÉO WMO ──────────────────────────────────────────
const WMO_CODES = {
  0: { label: 'Ciel dégagé', icon: '☀️' },
  1: { label: 'Peu nuageux', icon: '🌤️' },
  2: { label: 'Partiellement nuageux', icon: '⛅' },
  3: { label: 'Couvert', icon: '☁️' },
  45: { label: 'Brouillard', icon: '🌫️' },
  48: { label: 'Brouillard givrant', icon: '🌫️' },
  51: { label: 'Bruine légère', icon: '🌦️' },
  53: { label: 'Bruine modérée', icon: '🌦️' },
  55: { label: 'Bruine dense', icon: '🌧️' },
  61: { label: 'Pluie légère', icon: '🌧️' },
  63: { label: 'Pluie modérée', icon: '🌧️' },
  65: { label: 'Pluie forte', icon: '🌧️' },
  71: { label: 'Neige légère', icon: '🌨️' },
  73: { label: 'Neige modérée', icon: '❄️' },
  75: { label: 'Neige forte', icon: '❄️' },
  77: { label: 'Grésil', icon: '🌨️' },
  80: { label: 'Averses légères', icon: '🌦️' },
  81: { label: 'Averses modérées', icon: '🌧️' },
  82: { label: 'Averses violentes', icon: '⛈️' },
  85: { label: 'Averses de neige', icon: '🌨️' },
  86: { label: 'Averses de neige fortes', icon: '❄️' },
  95: { label: 'Orage', icon: '⛈️' },
  96: { label: 'Orage avec grêle', icon: '⛈️' },
  99: { label: 'Orage violent avec grêle', icon: '🌩️' },
};

function wmoInfo(code) {
  return WMO_CODES[code] || { label: 'Inconnu', icon: '❓' };
}

function windDirLabel(deg) {
  const dirs = ['N','NE','E','SE','S','SO','O','NO'];
  return dirs[Math.round(deg / 45) % 8];
}

const DAYS_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

// ─── LOADING ──────────────────────────────────────────────────
function setProgress(pct, msg) {
  document.getElementById('loading-bar').style.width = pct + '%';
  document.getElementById('loading-msg').textContent = msg;
}
function hideLoading() {
  const s = document.getElementById('loading-screen');
  s.classList.add('hidden');
  setTimeout(() => s.remove(), 900);
}

// ─── HORLOGE ──────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    document.getElementById('clock-time').textContent = `${h}:${m}:${s}`;
    const d = DAYS_FR[now.getDay()];
    const day = String(now.getDate()).padStart(2,'0');
    const mo = MONTHS_FR[now.getMonth()];
    const yr = now.getFullYear();
    document.getElementById('clock-date').textContent = `${d} ${day} ${mo} ${yr}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── INITIALISATION CARTE ─────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [userLocation.lat, userLocation.lng],
    zoom: CFG.defaultZoom,
    zoomControl: true,
    worldCopyJump: true,
    preferCanvas: true,
  });

  // Tuile principale sombre
  const darkTile = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }
  ).addTo(map);

  // Indicateur de zoom
  const zoomDiv = document.createElement('div');
  zoomDiv.className = 'zoom-indicator';
  zoomDiv.id = 'zoom-indicator';
  zoomDiv.textContent = `ZOOM : ${CFG.defaultZoom}`;
  document.body.appendChild(zoomDiv);

  map.on('zoomend', () => {
    zoomLevel = map.getZoom();
    document.getElementById('zoom-indicator').textContent = `ZOOM : ${zoomLevel}`;
    refreshWeatherMarkersForZoom();
  });

  // Refresh aussi quand on déplace la carte
  map.on('moveend', debounce(() => {
    refreshWeatherMarkersForZoom();
  }, 600));

  // Clic sur la carte → météo du lieu
  map.on('click', (e) => {
    fetchAndShowWeather(e.latlng.lat, e.latlng.lng, true);
  });

  // Hover sur la carte
  map.on('mousemove', debounce((e) => {
    if (zoomLevel >= 5) showMapTooltip(e.latlng.lat, e.latlng.lng, e.originalEvent);
  }, 400));
  map.on('mouseout', () => {
    document.getElementById('map-tooltip').style.display = 'none';
  });
}

// ─── TOGGLE GLOBE ─────────────────────────────────────────────
document.getElementById('toggle-globe').addEventListener('click', () => {
  isGlobeMode = !isGlobeMode;
  const btn = document.getElementById('toggle-globe');

  if (isGlobeMode) {
    btn.classList.add('active');
    btn.querySelector('.toggle-label').textContent = 'CARTE';
    // Change tuile en style satellite pour le globe
    map.eachLayer(l => { if (l._url) map.removeLayer(l); });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri',
      maxZoom: 17,
    }).addTo(map);
    // Projection "globe" via CSS 3D sur le container
    document.getElementById('map').style.borderRadius = '50%';
    document.getElementById('map').style.overflow = 'hidden';
    document.getElementById('map').style.width = 'min(90vw, 90vh)';
    document.getElementById('map').style.height = 'min(90vw, 90vh)';
    document.getElementById('map').style.margin = 'auto';
    document.getElementById('map').style.top = '50%';
    document.getElementById('map').style.left = '50%';
    document.getElementById('map').style.transform = 'translate(-50%, -50%)';
    document.getElementById('map').style.boxShadow = '0 0 60px #00fff5, 0 0 120px rgba(0,255,245,0.2), inset 0 0 60px rgba(0,0,0,0.5)';
    map.invalidateSize();
  } else {
    btn.classList.remove('active');
    btn.querySelector('.toggle-label').textContent = 'GLOBE';
    map.eachLayer(l => { if (l._url) map.removeLayer(l); });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    const m = document.getElementById('map');
    m.style.borderRadius = '';
    m.style.overflow = '';
    m.style.width = '';
    m.style.height = '';
    m.style.margin = '';
    m.style.top = '';
    m.style.left = '';
    m.style.transform = '';
    m.style.boxShadow = '';
    map.invalidateSize();
  }
});

// ─── GÉOLOCALISATION ──────────────────────────────────────────
async function geolocate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 }
    );
  });
}

// ─── MÉTÉO PRINCIPALE (HUD) ───────────────────────────────────
async function fetchHUDWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,uv_index_max,windspeed_10m_max,winddirection_10m_dominant,weather_code&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const d = data.daily;

    // HUD values
    const wmo = wmoInfo(c.weather_code);
    document.getElementById('hud-temp').textContent = `${Math.round(c.temperature_2m)}°C`;
    document.getElementById('hud-minmax').textContent = `${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°`;
    document.getElementById('hud-uv').textContent = c.uv_index !== undefined ? c.uv_index.toFixed(1) : d.uv_index_max[0].toFixed(1);
    document.getElementById('hud-wind').textContent = `${Math.round(c.windspeed_10m)} km/h`;
    document.getElementById('hud-wind-dir').textContent = `${windDirLabel(c.winddirection_10m)} (${Math.round(c.winddirection_10m)}°)`;
    document.getElementById('hud-weather').textContent = `${wmo.icon} ${wmo.label}`;

    // Soleil
    const sunTimes = SunCalc.getTimes(new Date(), lat, lng);
    const fmt = t => `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    document.getElementById('hud-sunrise').textContent = fmt(sunTimes.sunrise);
    document.getElementById('hud-sunset').textContent = fmt(sunTimes.sunset);
    updateSunArc(sunTimes.sunrise, sunTimes.sunset);

    // Prévisions 7 jours
    renderForecast(d);

    // Géocode inverse pour nom du lieu
    fetchLocationName(lat, lng);

    return data;
  } catch(e) {
    console.error('Météo HUD error:', e);
  }
}

async function fetchLocationName(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fr`);
    const data = await res.json();
    const addr = data.address;
    const name = addr.city || addr.town || addr.village || addr.county || addr.country || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
    document.getElementById('hud-location').textContent = name.toUpperCase();
  } catch(e) {
    document.getElementById('hud-location').textContent = `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
  }
}

// ─── ARC SOLEIL ───────────────────────────────────────────────
function updateSunArc(sunrise, sunset) {
  const now = new Date();
  const total = sunset - sunrise;
  const elapsed = now - sunrise;
  let ratio = Math.max(0, Math.min(1, elapsed / total));

  // Point sur l'arc (courbe quadratique de Bézier)
  const t = ratio;
  const p0 = { x: 10, y: 100 };
  const p1 = { x: 100, y: 10 };
  const p2 = { x: 190, y: 100 };
  const x = (1-t)*(1-t)*p0.x + 2*(1-t)*t*p1.x + t*t*p2.x;
  const y = (1-t)*(1-t)*p0.y + 2*(1-t)*t*p1.y + t*t*p2.y;

  const dot = document.getElementById('sun-dot');
  if (dot) {
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    // Visible seulement si soleil au-dessus de l'horizon
    dot.setAttribute('opacity', (ratio >= 0 && ratio <= 1 && now >= sunrise && now <= sunset) ? '1' : '0.3');
  }
}

// ─── PRÉVISIONS 7 JOURS ───────────────────────────────────────
function renderForecast(d) {
  const grid = document.getElementById('forecast-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const date = new Date(d.time[i]);
    const dayName = DAYS_FR[date.getDay()];
    const wmo = wmoInfo(d.weather_code[i]);
    const div = document.createElement('div');
    div.className = 'forecast-day';
    div.innerHTML = `
      <div class="fc-day-name">${dayName}</div>
      <div class="fc-icon">${wmo.icon}</div>
      <div class="fc-temp-max">${Math.round(d.temperature_2m_max[i])}°</div>
      <div class="fc-temp-min">${Math.round(d.temperature_2m_min[i])}°</div>
      <div class="fc-wind">💨 ${Math.round(d.windspeed_10m_max[i])} km/h</div>
      <div class="fc-uv">UV ${d.uv_index_max[i].toFixed(1)}</div>
    `;
    grid.appendChild(div);
  }
}

// ─── TOOLTIP SURVOL CARTE ─────────────────────────────────────
const tooltipCache = {};
async function showMapTooltip(lat, lng, event) {
  const key = `${Math.round(lat * 5) / 5},${Math.round(lng * 5) / 5}`;
  let data = tooltipCache[key];

  if (!data) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,windspeed_10m&timezone=auto`;
      const res = await fetch(url);
      data = await res.json();
      tooltipCache[key] = data;
    } catch(e) { return; }
  }

  const c = data.current;
  const wmo = wmoInfo(c.weather_code);
  const tip = document.getElementById('map-tooltip');
  tip.innerHTML = `
    <div class="tooltip-title">${wmo.icon} ${lat.toFixed(2)}°, ${lng.toFixed(2)}°</div>
    <div class="tooltip-row"><span>Temp</span><span class="tooltip-val">${Math.round(c.temperature_2m)}°C</span></div>
    <div class="tooltip-row"><span>Vent</span><span class="tooltip-val">${Math.round(c.windspeed_10m)} km/h</span></div>
    <div class="tooltip-row"><span>Météo</span><span class="tooltip-val">${wmo.label}</span></div>
  `;
  tip.style.display = 'block';
  tip.style.left = (event.clientX + 16) + 'px';
  tip.style.top = (event.clientY - 10) + 'px';
}

// ─── MÉTÉO AU CLIC ────────────────────────────────────────────
async function fetchAndShowWeather(lat, lng, popup = false) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index&daily=temperature_2m_max,temperature_2m_min,uv_index_max,windspeed_10m_max,weather_code&timezone=auto&forecast_days=7`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const d = data.daily;
    const wmo = wmoInfo(c.weather_code);

    // Nom du lieu
    let locName = `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
    try {
      const nr = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fr`);
      const nd = await nr.json();
      const a = nd.address;
      locName = a.city || a.town || a.village || a.county || a.country || locName;
    } catch(e) {}

    if (popup) {
      L.popup({ className: 'geo-popup' })
        .setLatLng([lat, lng])
        .setContent(`
          <div class="popup-title">📍 ${locName.toUpperCase()}</div>
          <div class="popup-row">Météo: <b>${wmo.icon} ${wmo.label}</b></div>
          <div class="popup-row">Température: <b>${Math.round(c.temperature_2m)}°C</b> (ressenti ${Math.round(c.apparent_temperature)}°C)</div>
          <div class="popup-row">Min/Max: <b>${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°</b></div>
          <div class="popup-row">Vent: <b>${Math.round(c.windspeed_10m)} km/h ${windDirLabel(c.winddirection_10m)}</b></div>
          <div class="popup-row">UV: <b>${(c.uv_index ?? d.uv_index_max[0]).toFixed(1)}</b></div>
        `)
        .openOn(map);
    }

    // Met à jour le HUD avec le lieu cliqué
    fetchHUDWeather(lat, lng);
    renderForecast(d);

  } catch(e) { console.error('fetchAndShowWeather', e); }
}

// ─── BASE DE VILLES (3 niveaux de priorité) ───────────────────
// priorité 1 = capitales mondiales (zoom ≥ 2)
// priorité 2 = grandes villes (zoom ≥ 5)
// priorité 3 = villes moyennes / océans (zoom ≥ 7)
const CITIES = [
  // PRIORITÉ 1 — visibles dès le départ
  { name: 'Paris', lat: 48.85, lng: 2.35, p: 1 },
  { name: 'London', lat: 51.51, lng: -0.13, p: 1 },
  { name: 'New York', lat: 40.71, lng: -74.01, p: 1 },
  { name: 'Tokyo', lat: 35.69, lng: 139.69, p: 1 },
  { name: 'Sydney', lat: -33.87, lng: 151.21, p: 1 },
  { name: 'Moscow', lat: 55.75, lng: 37.62, p: 1 },
  { name: 'Dubai', lat: 25.20, lng: 55.27, p: 1 },
  { name: 'São Paulo', lat: -23.55, lng: -46.63, p: 1 },
  { name: 'Cairo', lat: 30.04, lng: 31.24, p: 1 },
  { name: 'Beijing', lat: 39.91, lng: 116.39, p: 1 },
  { name: 'Mumbai', lat: 19.08, lng: 72.88, p: 1 },
  { name: 'Lagos', lat: 6.52, lng: 3.38, p: 1 },
  // PRIORITÉ 2 — zoom ≥ 5
  { name: 'Chicago', lat: 41.88, lng: -87.63, p: 2 },
  { name: 'Los Angeles', lat: 34.05, lng: -118.24, p: 2 },
  { name: 'Berlin', lat: 52.52, lng: 13.40, p: 2 },
  { name: 'Rome', lat: 41.90, lng: 12.50, p: 2 },
  { name: 'Madrid', lat: 40.42, lng: -3.70, p: 2 },
  { name: 'Amsterdam', lat: 52.37, lng: 4.90, p: 2 },
  { name: 'Warsaw', lat: 52.23, lng: 21.01, p: 2 },
  { name: 'Vienna', lat: 48.21, lng: 16.37, p: 2 },
  { name: 'Prague', lat: 50.08, lng: 14.44, p: 2 },
  { name: 'Brussels', lat: 50.85, lng: 4.35, p: 2 },
  { name: 'Toronto', lat: 43.65, lng: -79.38, p: 2 },
  { name: 'Mexico City', lat: 19.43, lng: -99.13, p: 2 },
  { name: 'Buenos Aires', lat: -34.60, lng: -58.38, p: 2 },
  { name: 'Nairobi', lat: -1.29, lng: 36.82, p: 2 },
  { name: 'Jakarta', lat: -6.21, lng: 106.85, p: 2 },
  { name: 'Seoul', lat: 37.57, lng: 126.98, p: 2 },
  { name: 'Bangkok', lat: 13.75, lng: 100.52, p: 2 },
  { name: 'Istanbul', lat: 41.01, lng: 28.95, p: 2 },
  { name: 'Tehran', lat: 35.69, lng: 51.39, p: 2 },
  { name: 'Johannesburg', lat: -26.20, lng: 28.04, p: 2 },
  { name: 'Singapore', lat: 1.35, lng: 103.82, p: 2 },
  { name: 'Lima', lat: -12.05, lng: -77.04, p: 2 },
  { name: 'Bogotá', lat: 4.71, lng: -74.07, p: 2 },
  // PRIORITÉ 2 — mers et océans
  { name: 'Atlantique N.', lat: 35.0, lng: -40.0, p: 2 },
  { name: 'Pacifique N.', lat: 30.0, lng: -150.0, p: 2 },
  { name: 'Océan Indien', lat: -15.0, lng: 70.0, p: 2 },
  { name: 'Méditerranée', lat: 35.0, lng: 18.0, p: 2 },
  { name: 'Mer du Nord', lat: 56.0, lng: 3.0, p: 2 },
  { name: 'Mer de Chine', lat: 15.0, lng: 115.0, p: 2 },
  // PRIORITÉ 3 — zoom élevé
  { name: 'Lyon', lat: 45.75, lng: 4.83, p: 3 },
  { name: 'Marseille', lat: 43.30, lng: 5.37, p: 3 },
  { name: 'Bordeaux', lat: 44.84, lng: -0.58, p: 3 },
  { name: 'Toulouse', lat: 43.60, lng: 1.44, p: 3 },
  { name: 'Nice', lat: 43.70, lng: 7.27, p: 3 },
  { name: 'Lille', lat: 50.63, lng: 3.07, p: 3 },
  { name: 'Strasbourg', lat: 48.57, lng: 7.75, p: 3 },
  { name: 'Nantes', lat: 47.22, lng: -1.55, p: 3 },
  { name: 'Manchester', lat: 53.48, lng: -2.24, p: 3 },
  { name: 'Barcelona', lat: 41.39, lng: 2.15, p: 3 },
  { name: 'Milan', lat: 45.46, lng: 9.19, p: 3 },
  { name: 'Munich', lat: 48.14, lng: 11.58, p: 3 },
  { name: 'Hamburg', lat: 53.57, lng: 10.02, p: 3 },
  { name: 'Zürich', lat: 47.38, lng: 8.54, p: 3 },
  { name: 'Oslo', lat: 59.91, lng: 10.75, p: 3 },
  { name: 'Stockholm', lat: 59.33, lng: 18.07, p: 3 },
  { name: 'Helsinki', lat: 60.17, lng: 24.94, p: 3 },
  { name: 'Copenhagen', lat: 55.68, lng: 12.57, p: 3 },
  { name: 'Lisbon', lat: 38.72, lng: -9.14, p: 3 },
  { name: 'Athens', lat: 37.98, lng: 23.73, p: 3 },
  { name: 'Kyiv', lat: 50.45, lng: 30.52, p: 3 },
  { name: 'Budapest', lat: 47.50, lng: 19.04, p: 3 },
  { name: 'Bucharest', lat: 44.43, lng: 26.10, p: 3 },
  { name: 'Vancouver', lat: 49.25, lng: -123.12, p: 3 },
  { name: 'Seattle', lat: 47.61, lng: -122.33, p: 3 },
  { name: 'Miami', lat: 25.77, lng: -80.19, p: 3 },
  { name: 'Houston', lat: 29.76, lng: -95.37, p: 3 },
  { name: 'Montreal', lat: 45.50, lng: -73.57, p: 3 },
  { name: 'Santiago', lat: -33.45, lng: -70.67, p: 3 },
  { name: 'Casablanca', lat: 33.59, lng: -7.62, p: 3 },
  { name: 'Tunis', lat: 36.82, lng: 10.17, p: 3 },
  { name: 'Accra', lat: 5.55, lng: -0.20, p: 3 },
  { name: 'Addis Abeba', lat: 9.03, lng: 38.74, p: 3 },
  { name: 'Karachi', lat: 24.86, lng: 67.01, p: 3 },
  { name: 'Dhaka', lat: 23.72, lng: 90.41, p: 3 },
  { name: 'Hanoi', lat: 21.03, lng: 105.83, p: 3 },
  { name: 'Kuala Lumpur', lat: 3.14, lng: 101.69, p: 3 },
  { name: 'Manila', lat: 14.60, lng: 120.98, p: 3 },
  { name: 'Osaka', lat: 34.69, lng: 135.50, p: 3 },
  { name: 'Auckland', lat: -36.86, lng: 174.76, p: 3 },
  { name: 'Melbourne', lat: -37.81, lng: 144.96, p: 3 },
];

// ─── CACHE MÉTÉO ──────────────────────────────────────────────
const cityWeatherCache = {};  // { "lat,lng": { data, ts } }
const CACHE_TTL = 10 * 60 * 1000; // 10 min

async function getCityWeather(lat, lng) {
  const key = `${lat},${lng}`;
  const now = Date.now();
  if (cityWeatherCache[key] && now - cityWeatherCache[key].ts < CACHE_TTL) {
    return cityWeatherCache[key].data;
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  const data = await res.json();
  cityWeatherCache[key] = { data, ts: now };
  return data;
}

// ─── CRÉATION DU MARQUEUR SELON LE ZOOM ───────────────────────
// zoom 2-4  → juste icône + temp
// zoom 5-6  → icône + temp + vent
// zoom 7-8  → icône + temp + min/max + vent + UV
// zoom 9+   → carte complète : temp, ressenti, min/max, vent dir, UV, météo

function buildWeatherMarkerHTML(city, c, daily, zoom) {
  const wmo = wmoInfo(c.weather_code);
  const temp = Math.round(c.temperature_2m);
  const windspd = Math.round(c.windspeed_10m);
  const winddir = windDirLabel(c.winddirection_10m);
  const uv = (c.uv_index ?? 0).toFixed(1);
  const tmin = Math.round(daily.temperature_2m_min[0]);
  const tmax = Math.round(daily.temperature_2m_max[0]);
  const resenti = Math.round(c.apparent_temperature);

  // Couleur temp
  let tempColor = '#00fff5';
  if (temp <= 0) tempColor = '#66ccff';
  else if (temp >= 35) tempColor = '#ff2d78';
  else if (temp >= 25) tempColor = '#ffe600';

  if (zoom <= 4) {
    // NIVEAU 1 : ultra compact — icône + temp uniquement
    return `<div class="wm-chip wm-lvl1">
      <span class="wm-icon">${wmo.icon}</span>
      <span class="wm-temp" style="color:${tempColor}">${temp}°</span>
      <span class="wm-name">${city.name}</span>
    </div>`;
  }

  if (zoom <= 6) {
    // NIVEAU 2 : compact — icône + temp + vent
    return `<div class="wm-chip wm-lvl2">
      <div class="wm-row-top">
        <span class="wm-icon">${wmo.icon}</span>
        <span class="wm-temp" style="color:${tempColor}">${temp}°C</span>
      </div>
      <div class="wm-city">${city.name}</div>
      <div class="wm-row-sub">💨 ${windspd} km/h ${winddir}</div>
    </div>`;
  }

  if (zoom <= 8) {
    // NIVEAU 3 : moyen — temp min/max + vent + UV
    return `<div class="wm-chip wm-lvl3">
      <div class="wm-row-top">
        <span class="wm-icon">${wmo.icon}</span>
        <span class="wm-temp" style="color:${tempColor}">${temp}°C</span>
      </div>
      <div class="wm-city">${city.name}</div>
      <div class="wm-row-sub">
        <span>↓${tmin}° ↑${tmax}°</span>
      </div>
      <div class="wm-row-sub">
        <span>💨 ${windspd} km/h ${winddir}</span>
        <span style="color:#ff6b00">UV ${uv}</span>
      </div>
    </div>`;
  }

  // NIVEAU 4 : zoom 9+ — carte complète
  return `<div class="wm-chip wm-lvl4">
    <div class="wm-title-bar">
      <span class="wm-icon-lg">${wmo.icon}</span>
      <div>
        <div class="wm-city-lg">${city.name}</div>
        <div class="wm-desc">${wmo.label}</div>
      </div>
    </div>
    <div class="wm-divider"></div>
    <div class="wm-grid4">
      <div class="wm-cell"><span class="wm-lbl">TEMP</span><span class="wm-val" style="color:${tempColor}">${temp}°C</span></div>
      <div class="wm-cell"><span class="wm-lbl">RESSENTI</span><span class="wm-val">${resenti}°C</span></div>
      <div class="wm-cell"><span class="wm-lbl">MIN/MAX</span><span class="wm-val">${tmin}° / ${tmax}°</span></div>
      <div class="wm-cell"><span class="wm-lbl">UV</span><span class="wm-val" style="color:#ff6b00">${uv}</span></div>
      <div class="wm-cell"><span class="wm-lbl">VENT</span><span class="wm-val">${windspd} km/h</span></div>
      <div class="wm-cell"><span class="wm-lbl">DIR.</span><span class="wm-val">${winddir} ${Math.round(c.winddirection_10m)}°</span></div>
    </div>
  </div>`;
}

// ─── COUCHE MÉTÉO ADAPTATIVE ──────────────────────────────────
let weatherLayerGroup = L.layerGroup();
let isRefreshing = false;

async function refreshWeatherMarkersForZoom() {
  if (isRefreshing) return;
  isRefreshing = true;
  weatherLayerGroup.clearLayers();

  const bounds = map.getBounds();
  const zoom = map.getZoom();

  // Filtre selon priorité et zone visible
  let citiesToShow = CITIES.filter(city => {
    const inBounds = bounds.contains([city.lat, city.lng]);
    if (zoom <= 4) return city.p === 1;
    if (zoom <= 6) return city.p <= 2 && inBounds;
    return inBounds; // zoom 7+ : toutes les villes dans la zone
  });

  // Limite le nombre de requêtes simultanées
  const MAX = zoom <= 4 ? 12 : zoom <= 6 ? 30 : 50;
  citiesToShow = citiesToShow.slice(0, MAX);

  // Requêtes groupées par batch de 5
  const BATCH = 5;
  for (let i = 0; i < citiesToShow.length; i += BATCH) {
    const batch = citiesToShow.slice(i, i + BATCH);
    await Promise.all(batch.map(city => addWeatherMarker(city, zoom)));
  }

  weatherLayerGroup.addTo(map);
  isRefreshing = false;
}

async function addWeatherMarker(city, zoom) {
  try {
    const data = await getCityWeather(city.lat, city.lng);
    const c = data.current;
    const daily = data.daily;

    const html = buildWeatherMarkerHTML(city, c, daily, zoom);
    const icon = L.divIcon({
      className: 'weather-marker-wrapper',
      html,
      iconAnchor: [0, 0],
    });

    const marker = L.marker([city.lat, city.lng], { icon, zIndexOffset: 100 });

    // Clic → popup détaillée + mise à jour HUD
    marker.on('click', () => {
      fetchAndShowWeather(city.lat, city.lng, true);
    });

    weatherLayerGroup.addLayer(marker);
  } catch(e) {
    console.warn(`Météo ${city.name} : erreur`, e);
  }
}

// ─── ISS TRACKING ─────────────────────────────────────────────
function createISSIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="text-align:center">
      <div class="iss-marker-inner" style="font-size:24px;filter:drop-shadow(0 0 8px #00ff9f)">🛸</div>
      <div style="color:#00ff9f;font-family:'Share Tech Mono',monospace;font-size:9px;letter-spacing:1px;text-shadow:0 0 6px #00ff9f;background:rgba(0,20,40,0.8);padding:1px 4px;margin-top:2px;white-space:nowrap">ISS</div>
    </div>`,
    iconSize: [40, 44],
    iconAnchor: [20, 22],
  });
}

async function updateISS() {
  try {
    const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const data = await res.json();
    const lat = data.latitude;
    const lng = data.longitude;
    const alt = Math.round(data.altitude);
    const speed = Math.round(data.velocity);

    if (!issMarker) {
      issMarker = L.marker([lat, lng], { icon: createISSIcon(), zIndexOffset: 1000 }).addTo(map);
      issMarker.bindPopup(`
        <div class="popup-title">🛸 STATION ISS</div>
        <div class="popup-row">Latitude: <b>${lat.toFixed(4)}°</b></div>
        <div class="popup-row">Longitude: <b>${lng.toFixed(4)}°</b></div>
        <div class="popup-row">Altitude: <b>${alt} km</b></div>
        <div class="popup-row">Vitesse: <b>${speed} km/h</b></div>
      `);
    } else {
      issMarker.setLatLng([lat, lng]);
      issMarker.setPopupContent(`
        <div class="popup-title">🛸 STATION ISS</div>
        <div class="popup-row">Latitude: <b>${lat.toFixed(4)}°</b></div>
        <div class="popup-row">Longitude: <b>${lng.toFixed(4)}°</b></div>
        <div class="popup-row">Altitude: <b>${alt} km</b></div>
        <div class="popup-row">Vitesse: <b>${speed} km/h</b></div>
      `);
    }
  } catch(e) { console.warn('ISS fetch failed:', e); }
}

// ─── TREMBLEMENTS DE TERRE ────────────────────────────────────
async function loadEarthquakes() {
  if (eqLayer) map.removeLayer(eqLayer);
  eqLayer = L.layerGroup();

  try {
    // 7 derniers jours, magnitude ≥ 2
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
    const res = await fetch(url);
    const data = await res.json();

    data.features.forEach(f => {
      const coords = f.geometry.coordinates;
      const mag = f.properties.mag;
      const place = f.properties.place;
      const time = new Date(f.properties.time).toLocaleString('fr-FR');
      const depth = coords[2];
      const isOcean = depth > 60;

      let color, radius;
      if (mag >= 6) { color = '#ff2d78'; radius = 18; }
      else if (mag >= 4) { color = '#ff6b00'; radius = 12; }
      else { color = '#ffe600'; radius = 7; }

      const circle = L.circleMarker([coords[1], coords[0]], {
        radius,
        fillColor: color,
        color: 'rgba(255,255,255,0.4)',
        weight: 1,
        fillOpacity: 0.75,
        className: 'eq-marker',
      });

      circle.bindPopup(`
        <div class="popup-title">🔴 SÉISME — M${mag.toFixed(1)}</div>
        <div class="popup-row">Lieu: <b>${place}</b></div>
        <div class="popup-row">Magnitude: <b>${mag.toFixed(1)}</b></div>
        <div class="popup-row">Profondeur: <b>${depth.toFixed(0)} km</b></div>
        <div class="popup-row">Zone: <b>${isOcean ? '🌊 Maritime' : '🏔️ Terrestre'}</b></div>
        <div class="popup-row">Date: <b>${time}</b></div>
      `);

      eqLayer.addLayer(circle);
    });
  } catch(e) { console.warn('Earthquakes error:', e); }

  eqLayer.addTo(map);
}

// ─── TEMPÊTES & CATASTROPHES (GDACS) ─────────────────────────
async function loadDisasters() {
  if (stormLayer) map.removeLayer(stormLayer);
  if (volcanoLayer) map.removeLayer(volcanoLayer);
  if (floodLayer) map.removeLayer(floodLayer);

  stormLayer = L.layerGroup();
  volcanoLayer = L.layerGroup();
  floodLayer = L.layerGroup();

  try {
    // GDACS via proxy CORS (no-cors fallback to mock data)
    const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS?limit=50&alertlevel=Red,Orange&eventtype=TC,EQ,FL,VO,DR';
    const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const wrapper = await res.json();
    const data = JSON.parse(wrapper.contents);

    if (data && data.features) {
      data.features.forEach(f => {
        const props = f.properties;
        const coords = f.geometry?.coordinates;
        if (!coords) return;
        const lat = coords[1], lng = coords[0];
        const type = props.eventtype;
        const name = props.name || type;
        const alert = props.alertlevel;

        let icon, layer, emoji;
        if (type === 'TC' || type === 'DR') {
          emoji = '🌀'; layer = stormLayer;
          icon = makeDisasterIcon('#b266ff', emoji, name);
        } else if (type === 'VO') {
          emoji = '🌋'; layer = volcanoLayer;
          icon = makeDisasterIcon('#ff4400', emoji, name);
        } else if (type === 'FL') {
          emoji = '🌊'; layer = floodLayer;
          icon = makeDisasterIcon('#0088ff', emoji, name);
        } else return;

        const marker = L.marker([lat, lng], { icon });
        marker.bindPopup(`
          <div class="popup-title">${emoji} ${name.toUpperCase()}</div>
          <div class="popup-row">Type: <b>${typeLabel(type)}</b></div>
          <div class="popup-row">Alerte: <b style="color:${alert==='Red'?'#ff2d78':'#ff6b00'}">${alert}</b></div>
        `);
        layer.addLayer(marker);
      });
    }
  } catch(e) {
    console.warn('GDACS fetch failed, using fallback:', e);
    // Données de démonstration si l'API GDACS échoue
    addFallbackDisasters();
  }

  stormLayer.addTo(map);
  volcanoLayer.addTo(map);
  floodLayer.addTo(map);
}

function addFallbackDisasters() {
  // Volcans actifs connus
  const volcanoes = [
    { lat: 19.42, lng: -155.29, name: 'Kīlauea (Hawaii)' },
    { lat: 37.75, lng: 15.00, name: 'Etna (Sicile)' },
    { lat: -8.34, lng: 115.51, name: 'Agung (Bali)' },
    { lat: 14.38, lng: 120.46, name: 'Taal (Philippines)' },
    { lat: -0.68, lng: 29.25, name: 'Nyiragongo (RDC)' },
    { lat: 64.63, lng: -17.52, name: 'Hekla (Islande)' },
    { lat: -39.42, lng: -71.95, name: 'Villarrica (Chili)' },
  ];
  volcanoes.forEach(v => {
    const icon = makeDisasterIcon('#ff4400', '🌋', v.name);
    const m = L.marker([v.lat, v.lng], { icon });
    m.bindPopup(`<div class="popup-title">🌋 ${v.name.toUpperCase()}</div><div class="popup-row">Volcan actif</div>`);
    volcanoLayer.addLayer(m);
  });
}

function makeDisasterIcon(color, emoji, name) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background: rgba(2,10,24,0.9);
      border: 1px solid ${color};
      box-shadow: 0 0 10px ${color};
      padding: 3px 6px;
      white-space: nowrap;
      font-family: 'Share Tech Mono',monospace;
      font-size: 11px;
      color: ${color};
      cursor: pointer;
    ">${emoji} <span style="font-size:9px;color:rgba(200,230,240,0.7)">${name.length > 20 ? name.slice(0,18)+'…' : name}</span></div>`,
    iconAnchor: [0, 0],
  });
}

function typeLabel(t) {
  const labels = { TC: 'Cyclone tropical', EQ: 'Séisme', FL: 'Inondation', VO: 'Eruption volcanique', DR: 'Sécheresse' };
  return labels[t] || t;
}

// ─── MOBILE HUD TOGGLE ────────────────────────────────────────
function addMobileToggle() {
  const btn = document.createElement('button');
  btn.className = 'mobile-hud-btn';
  btn.textContent = '◈ MÉTÉO';
  btn.addEventListener('click', () => {
    document.getElementById('hud-panel').classList.toggle('mobile-open');
  });
  document.body.appendChild(btn);
}

// ─── DEBOUNCE ─────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── MAIN INIT ────────────────────────────────────────────────
async function main() {
  startClock();
  setProgress(10, 'Localisation en cours...');

  // Géolocalisation
  const pos = await geolocate();
  if (pos) {
    userLocation = pos;
  }

  setProgress(25, 'Initialisation de la carte...');
  initMap();
  weatherLayerGroup.addTo(map);

  setProgress(40, 'Chargement des données météo...');
  await fetchHUDWeather(userLocation.lat, userLocation.lng);

  setProgress(55, 'Chargement des marqueurs météo...');
  await refreshWeatherMarkersForZoom();

  setProgress(68, 'Localisation de la station ISS...');
  await updateISS();
  setInterval(updateISS, CFG.issRefresh);

  setProgress(78, 'Chargement des séismes...');
  await loadEarthquakes();
  setInterval(loadEarthquakes, CFG.eqRefresh);

  setProgress(90, 'Chargement des catastrophes...');
  await loadDisasters();

  setProgress(100, 'Système opérationnel ✓');

  // Rafraîchissement météo périodique
  setInterval(() => fetchHUDWeather(userLocation.lat, userLocation.lng), CFG.refreshInterval);

  addMobileToggle();

  setTimeout(hideLoading, 600);
}

// Lance tout
main();
