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

// ─── MARQUEURS MÉTÉO VILLES (selon zoom) ─────────────────────
const CITIES = [
  { name: 'Paris', lat: 48.85, lng: 2.35 },
  { name: 'London', lat: 51.51, lng: -0.13 },
  { name: 'New York', lat: 40.71, lng: -74.01 },
  { name: 'Tokyo', lat: 35.69, lng: 139.69 },
  { name: 'Sydney', lat: -33.87, lng: 151.21 },
  { name: 'Moscow', lat: 55.75, lng: 37.62 },
  { name: 'Dubai', lat: 25.20, lng: 55.27 },
  { name: 'São Paulo', lat: -23.55, lng: -46.63 },
  { name: 'Cairo', lat: 30.04, lng: 31.24 },
  { name: 'Mumbai', lat: 19.08, lng: 72.88 },
  { name: 'Beijing', lat: 39.91, lng: 116.39 },
  { name: 'Chicago', lat: 41.88, lng: -87.63 },
  { name: 'Los Angeles', lat: 34.05, lng: -118.24 },
  { name: 'Berlin', lat: 52.52, lng: 13.40 },
  { name: 'Rome', lat: 41.90, lng: 12.50 },
  { name: 'Madrid', lat: 40.42, lng: -3.70 },
  { name: 'Toronto', lat: 43.65, lng: -79.38 },
  { name: 'Mexico City', lat: 19.43, lng: -99.13 },
  { name: 'Buenos Aires', lat: -34.60, lng: -58.38 },
  { name: 'Lagos', lat: 6.52, lng: 3.38 },
  { name: 'Nairobi', lat: -1.29, lng: 36.82 },
  { name: 'Jakarta', lat: -6.21, lng: 106.85 },
  { name: 'Seoul', lat: 37.57, lng: 126.98 },
  { name: 'Bangkok', lat: 13.75, lng: 100.52 },
  { name: 'Istanbul', lat: 41.01, lng: 28.95 },
  { name: 'Atlantique N.', lat: 35.0, lng: -40.0 },
  { name: 'Pacifique N.', lat: 30.0, lng: -150.0 },
  { name: 'Océan Indien', lat: -15.0, lng: 70.0 },
  { name: 'Mer Méditerranée', lat: 35.0, lng: 18.0 },
  { name: 'Mer du Nord', lat: 56.0, lng: 3.0 },
  { name: 'Mer de Chine', lat: 15.0, lng: 115.0 },
];

let weatherLayerGroup = L.layerGroup();

async function loadCityWeather(city) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}&current=temperature_2m,weather_code,windspeed_10m&timezone=auto`;
    const res = await fetch(url);
    const data = await res.json();
    const c = data.current;
    const wmo = wmoInfo(c.weather_code);
    const icon = L.divIcon({
      className: '',
      html: `<div style="
        background: rgba(2,10,24,0.88);
        border: 1px solid rgba(0,255,245,0.4);
        color: #00fff5;
        font-family: 'Share Tech Mono', monospace;
        font-size: 10px;
        padding: 3px 6px;
        white-space: nowrap;
        box-shadow: 0 0 8px rgba(0,255,245,0.3);
        cursor: pointer;
        line-height: 1.4;
      ">
        <span style="font-size:12px">${wmo.icon}</span>
        <b style="color:#ffe600">${Math.round(c.temperature_2m)}°C</b>
        <span style="color:rgba(160,220,240,0.7);font-size:9px"> ${city.name}</span>
      </div>`,
      iconAnchor: [0, 0],
    });
    const marker = L.marker([city.lat, city.lng], { icon }).addTo(weatherLayerGroup);
    marker.on('click', () => fetchAndShowWeather(city.lat, city.lng, true));
    return marker;
  } catch(e) {}
}

async function refreshWeatherMarkersForZoom() {
  weatherLayerGroup.clearLayers();
  if (zoomLevel < 3) {
    // Seulement les grandes villes et océans
    const subset = CITIES.slice(0, 10);
    for (const c of subset) await loadCityWeather(c);
  } else if (zoomLevel < 6) {
    for (const c of CITIES) await loadCityWeather(c);
  } else {
    // Zoom fort : on récupère les villes de la zone visible
    const bounds = map.getBounds();
    const filtered = CITIES.filter(c =>
      c.lat >= bounds.getSouth() && c.lat <= bounds.getNorth() &&
      c.lng >= bounds.getWest() && c.lng <= bounds.getEast()
    );
    for (const c of filtered.length ? filtered : CITIES.slice(0, 6)) await loadCityWeather(c);
  }
  weatherLayerGroup.addTo(map);
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
