/* ============================================================
   GEOWATCH — app.js
   Globe 3D (Globe.gl) + Carte 2D bornée (Leaflet)
   APIs 100% gratuites, sans compte
   ============================================================ */

// ─── CONFIG ───────────────────────────────────────────────────
const CFG = {
  refreshInterval : 60_000,
  issRefresh      : 5_000,
  eqRefresh       : 300_000,
  defaultLat      : 48.8566,
  defaultLng      : 2.3522,
  defaultZoom     : 4,
  maxBounds       : [[-90, -180], [90, 180]],  // carte bornée au monde entier
};

// ─── ÉTAT GLOBAL ──────────────────────────────────────────────
let map, globe;
let isGlobeMode = false;
let zoomLevel   = CFG.defaultZoom;
let issMarker2D = null;         // marqueur Leaflet ISS (carte)
let issLat = 0, issLng = 0;     // position ISS courante
let eqLayer, stormLayer, volcanoLayer, floodLayer;
let weatherLayerGroup = null;
let isRefreshing = false;
let userLocation = { lat: CFG.defaultLat, lng: CFG.defaultLng };

// Données partagées entre carte et globe
let eqData       = [];   // [{lat,lng,mag,place,depth,time}]
let disasterData = [];   // [{lat,lng,type,name,alert}]

// ─── CODES MÉTÉO WMO ──────────────────────────────────────────
const WMO = {
  0:{l:'Ciel dégagé',i:'☀️'},1:{l:'Peu nuageux',i:'🌤️'},2:{l:'Partiellement nuageux',i:'⛅'},3:{l:'Couvert',i:'☁️'},
  45:{l:'Brouillard',i:'🌫️'},48:{l:'Brouillard givrant',i:'🌫️'},51:{l:'Bruine légère',i:'🌦️'},53:{l:'Bruine modérée',i:'🌦️'},
  55:{l:'Bruine dense',i:'🌧️'},61:{l:'Pluie légère',i:'🌧️'},63:{l:'Pluie modérée',i:'🌧️'},65:{l:'Pluie forte',i:'🌧️'},
  71:{l:'Neige légère',i:'🌨️'},73:{l:'Neige modérée',i:'❄️'},75:{l:'Neige forte',i:'❄️'},77:{l:'Grésil',i:'🌨️'},
  80:{l:'Averses légères',i:'🌦️'},81:{l:'Averses modérées',i:'🌧️'},82:{l:'Averses violentes',i:'⛈️'},
  85:{l:'Averses de neige',i:'🌨️'},86:{l:'Averses neige fortes',i:'❄️'},
  95:{l:'Orage',i:'⛈️'},96:{l:'Orage + grêle',i:'⛈️'},99:{l:'Orage violent + grêle',i:'🌩️'},
};
const wmo = c => WMO[c] || { l:'Inconnu', i:'❓' };

const WIND_DIR = ['N','NE','E','SE','S','SO','O','NO'];
const windDir  = deg => WIND_DIR[Math.round(deg / 45) % 8];

const DAYS_FR   = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const fmtTime   = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

// ─── LOADING ──────────────────────────────────────────────────
const setProgress = (p, msg) => {
  document.getElementById('loading-bar').style.width = p + '%';
  document.getElementById('loading-msg').textContent  = msg;
};
const hideLoading = () => {
  const s = document.getElementById('loading-screen');
  s.classList.add('hidden');
  setTimeout(() => s.remove(), 900);
};

// ─── HORLOGE ──────────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const n = new Date();
    document.getElementById('clock-time').textContent =
      `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    document.getElementById('clock-date').textContent =
      `${DAYS_FR[n.getDay()]} ${String(n.getDate()).padStart(2,'0')} ${MONTHS_FR[n.getMonth()]} ${n.getFullYear()}`;
  };
  tick(); setInterval(tick, 1000);
}

// ─── GÉOLOCALISATION ──────────────────────────────────────────
const geolocate = () => new Promise(resolve => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null), { timeout: 5000 }
  );
});

// ─── CACHE MÉTÉO ──────────────────────────────────────────────
const weatherCache = {};
const CACHE_TTL    = 10 * 60_000;

async function getWeather(lat, lng, days = 1) {
  const key = `${(lat).toFixed(2)},${(lng).toFixed(2)}`;
  const now = Date.now();
  if (weatherCache[key] && now - weatherCache[key].ts < CACHE_TTL) return weatherCache[key].data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index`
    + `&daily=temperature_2m_max,temperature_2m_min,uv_index_max,windspeed_10m_max,winddirection_10m_dominant,weather_code`
    + `&timezone=auto&forecast_days=${days}`;
  const res = await fetch(url);
  const data = await res.json();
  weatherCache[key] = { data, ts: now };
  return data;
}

// ─── GÉOCODE INVERSE ──────────────────────────────────────────
const geoCache = {};
async function reversGeo(lat, lng) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  if (geoCache[key]) return geoCache[key];
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fr`);
    const d = await r.json();
    const a = d.address;
    const name = a.city || a.town || a.village || a.county || a.country || `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`;
    geoCache[key] = name;
    return name;
  } catch { return `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`; }
}

// ─── HUD MÉTÉO ────────────────────────────────────────────────
async function updateHUD(lat, lng) {
  try {
    const data = await getWeather(lat, lng, 7);
    const c = data.current, d = data.daily;
    const info = wmo(c.weather_code);

    document.getElementById('hud-temp').textContent     = `${Math.round(c.temperature_2m)}°C`;
    document.getElementById('hud-feels').textContent    = `${Math.round(c.apparent_temperature)}°C`;
    document.getElementById('hud-minmax').textContent   = `${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°`;
    document.getElementById('hud-uv').textContent       = (c.uv_index ?? d.uv_index_max[0] ?? 0).toFixed(1);
    document.getElementById('hud-wind').textContent     = `${Math.round(c.windspeed_10m)} km/h`;
    document.getElementById('hud-wind-dir').textContent = `${windDir(c.winddirection_10m)} ${Math.round(c.winddirection_10m)}°`;
    document.getElementById('hud-weather').textContent  = `${info.i} ${info.l}`;

    const sun = SunCalc.getTimes(new Date(), lat, lng);
    document.getElementById('hud-sunrise').textContent = fmtTime(sun.sunrise);
    document.getElementById('hud-sunset').textContent  = fmtTime(sun.sunset);
    updateSunArc(sun.sunrise, sun.sunset);

    renderForecast(d);

    reversGeo(lat, lng).then(name =>
      document.getElementById('hud-location').textContent = name.toUpperCase()
    );
  } catch(e) { console.warn('HUD error', e); }
}

// ─── ARC SOLEIL ───────────────────────────────────────────────
function updateSunArc(rise, set) {
  const now = new Date(), total = set - rise, elapsed = now - rise;
  const t = Math.max(0, Math.min(1, elapsed / total));
  const p0={x:10,y:80}, p1={x:100,y:5}, p2={x:190,y:80};
  const x = (1-t)**2*p0.x + 2*(1-t)*t*p1.x + t**2*p2.x;
  const y = (1-t)**2*p0.y + 2*(1-t)*t*p1.y + t**2*p2.y;
  const dot = document.getElementById('sun-dot');
  if (dot) { dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1)); dot.setAttribute('opacity', now > rise && now < set ? '1' : '0.3'); }
}

// ─── PRÉVISIONS 7 JOURS ───────────────────────────────────────
function renderForecast(d) {
  const grid = document.getElementById('forecast-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const date = new Date(d.time[i]);
    const info = wmo(d.weather_code[i]);
    const el = document.createElement('div');
    el.className = 'forecast-day';
    el.innerHTML = `
      <div class="fc-day-name">${DAYS_FR[date.getDay()]}</div>
      <div class="fc-icon">${info.i}</div>
      <div class="fc-temp-max">${Math.round(d.temperature_2m_max[i])}°</div>
      <div class="fc-temp-min">${Math.round(d.temperature_2m_min[i])}°</div>
      <div class="fc-wind">💨 ${Math.round(d.windspeed_10m_max[i])}</div>
      <div class="fc-uv">UV ${(d.uv_index_max[i]||0).toFixed(1)}</div>`;
    grid.appendChild(el);
  }
}

// ════════════════════════════════════════════════════════════
//  CARTE 2D — LEAFLET
// ════════════════════════════════════════════════════════════
function initMap() {
  map = L.map('map', {
    center: [userLocation.lat, userLocation.lng],
    zoom: CFG.defaultZoom,
    // Borne la carte : pas de répétition infinie
    maxBounds: CFG.maxBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 2,
    worldCopyJump: false,
    zoomControl: true,
    preferCanvas: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    noWrap: true,              // ← clé : désactive la répétition infinie
  }).addTo(map);

  weatherLayerGroup = L.layerGroup().addTo(map);

  map.on('zoomend', () => {
    zoomLevel = map.getZoom();
    document.getElementById('zoom-indicator').textContent = `ZOOM : ${zoomLevel}`;
    refreshWeatherMarkers();
  });
  map.on('moveend', debounce(refreshWeatherMarkers, 600));

  map.on('click', e => {
    popupWeather(e.latlng.lat, e.latlng.lng);
    updateHUD(e.latlng.lat, e.latlng.lng);
  });

  map.on('mousemove', debounce((e) => {
    if (zoomLevel >= 5) showTooltip(e.latlng.lat, e.latlng.lng, e.originalEvent);
  }, 400));
  map.on('mouseout', () => { document.getElementById('map-tooltip').style.display = 'none'; });
}

// ─── TOOLTIP SURVOL ───────────────────────────────────────────
const tooltipCache = {};
async function showTooltip(lat, lng, ev) {
  const key = `${(lat*4|0)/4},${(lng*4|0)/4}`;
  let data = tooltipCache[key];
  if (!data) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,windspeed_10m&timezone=auto`);
      data = await res.json();
      tooltipCache[key] = data;
    } catch { return; }
  }
  const c = data.current, info = wmo(c.weather_code);
  const tip = document.getElementById('map-tooltip');
  tip.innerHTML = `
    <div class="tooltip-title">${info.i} ${lat.toFixed(2)}°, ${lng.toFixed(2)}°</div>
    <div class="tooltip-row"><span>Temp</span><span class="tooltip-val">${Math.round(c.temperature_2m)}°C</span></div>
    <div class="tooltip-row"><span>Vent</span><span class="tooltip-val">${Math.round(c.windspeed_10m)} km/h</span></div>
    <div class="tooltip-row"><span>Météo</span><span class="tooltip-val">${info.l}</span></div>`;
  tip.style.display = 'block';
  tip.style.left = (ev.clientX + 16) + 'px';
  tip.style.top  = (ev.clientY - 10) + 'px';
}

// ─── POPUP MÉTÉO AU CLIC ──────────────────────────────────────
async function popupWeather(lat, lng) {
  try {
    const data = await getWeather(lat, lng, 7);
    const c = data.current, d = data.daily, info = wmo(c.weather_code);
    const name = await reversGeo(lat, lng);
    L.popup()
      .setLatLng([lat, lng])
      .setContent(`
        <div class="popup-title">📍 ${name.toUpperCase()}</div>
        <div class="popup-row">Météo: <b>${info.i} ${info.l}</b></div>
        <div class="popup-row">Temp: <b>${Math.round(c.temperature_2m)}°C</b> (ressenti ${Math.round(c.apparent_temperature)}°C)</div>
        <div class="popup-row">Min/Max: <b>${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°</b></div>
        <div class="popup-row">Vent: <b>${Math.round(c.windspeed_10m)} km/h ${windDir(c.winddirection_10m)}</b></div>
        <div class="popup-row">UV: <b>${(c.uv_index ?? d.uv_index_max[0] ?? 0).toFixed(1)}</b></div>`)
      .openOn(map);
  } catch(e) { console.warn('popup error', e); }
}

// ─── MARQUEURS MÉTÉO (carte 2D) ───────────────────────────────
const CITIES = [
  {name:'Paris',lat:48.85,lng:2.35,p:1},{name:'London',lat:51.51,lng:-.13,p:1},
  {name:'New York',lat:40.71,lng:-74.01,p:1},{name:'Tokyo',lat:35.69,lng:139.69,p:1},
  {name:'Sydney',lat:-33.87,lng:151.21,p:1},{name:'Moscow',lat:55.75,lng:37.62,p:1},
  {name:'Dubai',lat:25.20,lng:55.27,p:1},{name:'São Paulo',lat:-23.55,lng:-46.63,p:1},
  {name:'Cairo',lat:30.04,lng:31.24,p:1},{name:'Beijing',lat:39.91,lng:116.39,p:1},
  {name:'Mumbai',lat:19.08,lng:72.88,p:1},{name:'Lagos',lat:6.52,lng:3.38,p:1},
  {name:'Chicago',lat:41.88,lng:-87.63,p:2},{name:'Los Angeles',lat:34.05,lng:-118.24,p:2},
  {name:'Berlin',lat:52.52,lng:13.40,p:2},{name:'Rome',lat:41.90,lng:12.50,p:2},
  {name:'Madrid',lat:40.42,lng:-3.70,p:2},{name:'Amsterdam',lat:52.37,lng:4.90,p:2},
  {name:'Istanbul',lat:41.01,lng:28.95,p:2},{name:'Seoul',lat:37.57,lng:126.98,p:2},
  {name:'Bangkok',lat:13.75,lng:100.52,p:2},{name:'Singapore',lat:1.35,lng:103.82,p:2},
  {name:'Jakarta',lat:-6.21,lng:106.85,p:2},{name:'Buenos Aires',lat:-34.60,lng:-58.38,p:2},
  {name:'Toronto',lat:43.65,lng:-79.38,p:2},{name:'Mexico City',lat:19.43,lng:-99.13,p:2},
  {name:'Nairobi',lat:-1.29,lng:36.82,p:2},{name:'Johannesburg',lat:-26.20,lng:28.04,p:2},
  {name:'Tehran',lat:35.69,lng:51.39,p:2},{name:'Lima',lat:-12.05,lng:-77.04,p:2},
  {name:'Atlantique N.',lat:35.0,lng:-40.0,p:2},{name:'Pacifique N.',lat:30.0,lng:-150.0,p:2},
  {name:'Océan Indien',lat:-15.0,lng:70.0,p:2},{name:'Méditerranée',lat:35.0,lng:18.0,p:2},
  {name:'Mer du Nord',lat:56.0,lng:3.0,p:2},{name:'Mer de Chine',lat:15.0,lng:115.0,p:2},
  {name:'Lyon',lat:45.75,lng:4.83,p:3},{name:'Marseille',lat:43.30,lng:5.37,p:3},
  {name:'Bordeaux',lat:44.84,lng:-.58,p:3},{name:'Toulouse',lat:43.60,lng:1.44,p:3},
  {name:'Nice',lat:43.70,lng:7.27,p:3},{name:'Lille',lat:50.63,lng:3.07,p:3},
  {name:'Strasbourg',lat:48.57,lng:7.75,p:3},{name:'Nantes',lat:47.22,lng:-1.55,p:3},
  {name:'Barcelona',lat:41.39,lng:2.15,p:3},{name:'Milan',lat:45.46,lng:9.19,p:3},
  {name:'Munich',lat:48.14,lng:11.58,p:3},{name:'Vienna',lat:48.21,lng:16.37,p:3},
  {name:'Warsaw',lat:52.23,lng:21.01,p:3},{name:'Prague',lat:50.08,lng:14.44,p:3},
  {name:'Brussels',lat:50.85,lng:4.35,p:3},{name:'Oslo',lat:59.91,lng:10.75,p:3},
  {name:'Stockholm',lat:59.33,lng:18.07,p:3},{name:'Helsinki',lat:60.17,lng:24.94,p:3},
  {name:'Copenhagen',lat:55.68,lng:12.57,p:3},{name:'Lisbon',lat:38.72,lng:-9.14,p:3},
  {name:'Athens',lat:37.98,lng:23.73,p:3},{name:'Kyiv',lat:50.45,lng:30.52,p:3},
  {name:'Budapest',lat:47.50,lng:19.04,p:3},{name:'Bucharest',lat:44.43,lng:26.10,p:3},
  {name:'Seattle',lat:47.61,lng:-122.33,p:3},{name:'Miami',lat:25.77,lng:-80.19,p:3},
  {name:'Houston',lat:29.76,lng:-95.37,p:3},{name:'Montreal',lat:45.50,lng:-73.57,p:3},
  {name:'Santiago',lat:-33.45,lng:-70.67,p:3},{name:'Casablanca',lat:33.59,lng:-7.62,p:3},
  {name:'Osaka',lat:34.69,lng:135.50,p:3},{name:'Melbourne',lat:-37.81,lng:144.96,p:3},
  {name:'Auckland',lat:-36.86,lng:174.76,p:3},{name:'Manila',lat:14.60,lng:120.98,p:3},
];

function buildMarkerHTML(city, c, daily, zoom) {
  const info = wmo(c.weather_code);
  const temp  = Math.round(c.temperature_2m);
  const tmin  = Math.round(daily.temperature_2m_min[0]);
  const tmax  = Math.round(daily.temperature_2m_max[0]);
  const wspd  = Math.round(c.windspeed_10m);
  const wdir  = windDir(c.winddirection_10m);
  const uv    = (c.uv_index ?? 0).toFixed(1);
  const feels = Math.round(c.apparent_temperature);
  let col = temp <= 0 ? '#66ccff' : temp >= 35 ? '#ff2d78' : temp >= 25 ? '#ffe600' : '#00fff5';

  if (zoom <= 4) return `<div class="wm-chip wm-lvl1">
    <span class="wm-icon">${info.i}</span>
    <span class="wm-temp" style="color:${col}">${temp}°</span>
    <span class="wm-name">${city.name}</span></div>`;

  if (zoom <= 6) return `<div class="wm-chip wm-lvl2">
    <div class="wm-row-top"><span class="wm-icon">${info.i}</span><span class="wm-temp" style="color:${col}">${temp}°C</span></div>
    <div class="wm-city">${city.name}</div>
    <div class="wm-row-sub">💨 ${wspd} km/h ${wdir}</div></div>`;

  if (zoom <= 8) return `<div class="wm-chip wm-lvl3">
    <div class="wm-row-top"><span class="wm-icon">${info.i}</span><span class="wm-temp" style="color:${col}">${temp}°C</span></div>
    <div class="wm-city">${city.name}</div>
    <div class="wm-row-sub"><span>↓${tmin}° ↑${tmax}°</span></div>
    <div class="wm-row-sub"><span>💨 ${wspd} km/h ${wdir}</span><span style="color:#ff6b00">UV ${uv}</span></div></div>`;

  return `<div class="wm-chip wm-lvl4">
    <div class="wm-title-bar"><span class="wm-icon-lg">${info.i}</span>
      <div><div class="wm-city-lg">${city.name}</div><div class="wm-desc">${info.l}</div></div></div>
    <div class="wm-divider"></div>
    <div class="wm-grid4">
      <div class="wm-cell"><span class="wm-lbl">TEMP</span><span class="wm-val" style="color:${col}">${temp}°C</span></div>
      <div class="wm-cell"><span class="wm-lbl">RESSENTI</span><span class="wm-val">${feels}°C</span></div>
      <div class="wm-cell"><span class="wm-lbl">MIN/MAX</span><span class="wm-val">${tmin}°/${tmax}°</span></div>
      <div class="wm-cell"><span class="wm-lbl">UV</span><span class="wm-val" style="color:#ff6b00">${uv}</span></div>
      <div class="wm-cell"><span class="wm-lbl">VENT</span><span class="wm-val">${wspd} km/h</span></div>
      <div class="wm-cell"><span class="wm-lbl">DIR.</span><span class="wm-val">${wdir} ${Math.round(c.winddirection_10m)}°</span></div>
    </div></div>`;
}

async function refreshWeatherMarkers() {
  if (isRefreshing || !map) return;
  isRefreshing = true;
  weatherLayerGroup.clearLayers();
  const bounds = map.getBounds(), zoom = map.getZoom();
  let cities = CITIES.filter(c => {
    if (zoom <= 4) return c.p === 1;
    if (zoom <= 6) return c.p <= 2 && bounds.contains([c.lat, c.lng]);
    return bounds.contains([c.lat, c.lng]);
  }).slice(0, zoom <= 4 ? 12 : zoom <= 6 ? 35 : 60);

  for (let i = 0; i < cities.length; i += 5) {
    await Promise.all(cities.slice(i, i + 5).map(async city => {
      try {
        const data = await getWeather(city.lat, city.lng);
        const html = buildMarkerHTML(city, data.current, data.daily, zoom);
        const icon = L.divIcon({ className:'weather-marker-wrapper', html, iconAnchor:[0,0] });
        const m = L.marker([city.lat, city.lng], { icon, zIndexOffset: 100 });
        m.on('click', () => { popupWeather(city.lat, city.lng); updateHUD(city.lat, city.lng); });
        weatherLayerGroup.addLayer(m);
      } catch {}
    }));
  }
  isRefreshing = false;
}

// ─── SÉISMES (carte 2D) ───────────────────────────────────────
async function loadEarthquakes() {
  if (eqLayer) map.removeLayer(eqLayer);
  eqLayer = L.layerGroup();
  eqData  = [];
  try {
    const res  = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson');
    const data = await res.json();
    data.features.forEach(f => {
      const [lng, lat, depth] = f.geometry.coordinates;
      const mag = f.properties.mag, place = f.properties.place;
      const time = new Date(f.properties.time).toLocaleString('fr-FR');
      eqData.push({ lat, lng, mag, place, depth, time });
      let color, r;
      if (mag >= 6) { color='#ff2d78'; r=18; }
      else if (mag >= 4) { color='#ff6b00'; r=12; }
      else { color='#ffe600'; r=7; }
      const circle = L.circleMarker([lat, lng], {
        radius:r, fillColor:color, color:'rgba(255,255,255,0.3)',
        weight:1, fillOpacity:.78,
      });
      circle.bindPopup(`
        <div class="popup-title">🔴 SÉISME — M${mag.toFixed(1)}</div>
        <div class="popup-row">Lieu: <b>${place}</b></div>
        <div class="popup-row">Magnitude: <b>${mag.toFixed(1)}</b></div>
        <div class="popup-row">Profondeur: <b>${depth.toFixed(0)} km</b></div>
        <div class="popup-row">Zone: <b>${depth > 60 ? '🌊 Maritime' : '🏔️ Terrestre'}</b></div>
        <div class="popup-row">Date: <b>${time}</b></div>`);
      eqLayer.addLayer(circle);
    });
  } catch(e) { console.warn('EQ error', e); }
  eqLayer.addTo(map);
}

// ─── CATASTROPHES (carte 2D) ──────────────────────────────────
function disasterIcon(color, emoji, name) {
  return L.divIcon({ className:'', iconAnchor:[0,0], html:`<div style="
    background:rgba(2,10,24,0.92);border:1px solid ${color};box-shadow:0 0 10px ${color};
    padding:3px 7px;white-space:nowrap;font-family:'Share Tech Mono',monospace;
    font-size:11px;color:${color};cursor:pointer;">
    ${emoji} <span style="font-size:9px;color:rgba(200,230,240,.7)">${name.length>22?name.slice(0,20)+'…':name}</span></div>` });
}

async function loadDisasters() {
  [stormLayer, volcanoLayer, floodLayer].forEach(l => l && map.removeLayer(l));
  stormLayer = L.layerGroup(); volcanoLayer = L.layerGroup(); floodLayer = L.layerGroup();
  disasterData = [];

  try {
    const url = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS?limit=50&alertlevel=Red,Orange&eventtype=TC,FL,VO';
    const res  = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
    const w    = await res.json();
    const data = JSON.parse(w.contents);
    if (data?.features) {
      data.features.forEach(f => {
        const p = f.properties, coords = f.geometry?.coordinates;
        if (!coords) return;
        const [lng, lat] = coords, type = p.eventtype, name = p.name || type;
        disasterData.push({ lat, lng, type, name, alert: p.alertlevel });
        let emoji, color, layer;
        if (type === 'TC') { emoji='🌀'; color='#b266ff'; layer=stormLayer; }
        else if (type === 'VO') { emoji='🌋'; color='#ff4400'; layer=volcanoLayer; }
        else if (type === 'FL') { emoji='🌊'; color='#0088ff'; layer=floodLayer; }
        else return;
        const m = L.marker([lat, lng], { icon: disasterIcon(color, emoji, name) });
        m.bindPopup(`<div class="popup-title">${emoji} ${name.toUpperCase()}</div>
          <div class="popup-row">Type: <b>${{TC:'Cyclone',VO:'Éruption',FL:'Inondation'}[type]}</b></div>
          <div class="popup-row">Alerte: <b style="color:${p.alertlevel==='Red'?'#ff2d78':'#ff6b00'}">${p.alertlevel}</b></div>`);
        layer.addLayer(m);
      });
    }
  } catch {
    // Volcans actifs de secours
    [
      {lat:19.42,lng:-155.29,name:'Kīlauea (Hawaii)'},
      {lat:37.75,lng:15.00,name:'Etna (Sicile)'},
      {lat:-8.34,lng:115.51,name:'Agung (Bali)'},
      {lat:14.38,lng:120.46,name:'Taal (Philippines)'},
      {lat:-0.68,lng:29.25,name:'Nyiragongo (RDC)'},
      {lat:64.63,lng:-17.52,name:'Hekla (Islande)'},
      {lat:-39.42,lng:-71.95,name:'Villarrica (Chili)'},
    ].forEach(v => {
      disasterData.push({ lat:v.lat, lng:v.lng, type:'VO', name:v.name, alert:'Orange' });
      const m = L.marker([v.lat, v.lng], { icon: disasterIcon('#ff4400','🌋',v.name) });
      m.bindPopup(`<div class="popup-title">🌋 ${v.name.toUpperCase()}</div><div class="popup-row">Volcan actif</div>`);
      volcanoLayer.addLayer(m);
    });
  }
  [stormLayer, volcanoLayer, floodLayer].forEach(l => l.addTo(map));
}

// ════════════════════════════════════════════════════════════
//  ISS — satellite icon, fonctionne en carte ET en globe
// ════════════════════════════════════════════════════════════

// SVG satellite cyberpunk
const SAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="40" height="40">
  <defs>
    <filter id="sg"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- Corps central -->
  <rect x="18" y="18" width="12" height="12" rx="2" fill="#1a3a5c" stroke="#00fff5" stroke-width="1.5" filter="url(#sg)"/>
  <!-- Panneaux solaires gauche -->
  <rect x="2"  y="20" width="13" height="8" rx="1" fill="#0a2040" stroke="#00fff5" stroke-width="1"/>
  <line x1="6"  y1="20" x2="6"  y2="28" stroke="#00fff5" stroke-width=".5" opacity=".5"/>
  <line x1="10" y1="20" x2="10" y2="28" stroke="#00fff5" stroke-width=".5" opacity=".5"/>
  <!-- Panneaux solaires droite -->
  <rect x="33" y="20" width="13" height="8" rx="1" fill="#0a2040" stroke="#00fff5" stroke-width="1"/>
  <line x1="37" y1="20" x2="37" y2="28" stroke="#00fff5" stroke-width=".5" opacity=".5"/>
  <line x1="41" y1="20" x2="41" y2="28" stroke="#00fff5" stroke-width=".5" opacity=".5"/>
  <!-- Bras panneaux -->
  <line x1="15" y1="24" x2="18" y2="24" stroke="#00fff5" stroke-width="1.5"/>
  <line x1="30" y1="24" x2="33" y2="24" stroke="#00fff5" stroke-width="1.5"/>
  <!-- Antenne -->
  <line x1="24" y1="18" x2="24" y2="10" stroke="#00fff5" stroke-width="1" opacity=".8"/>
  <circle cx="24" cy="9" r="2" fill="none" stroke="#ffe600" stroke-width="1" opacity=".8"/>
  <!-- Point central lumineux -->
  <circle cx="24" cy="24" r="3" fill="#00fff5" opacity=".9" filter="url(#sg)"/>
</svg>`;

function makeSatIcon2D() {
  return L.divIcon({
    className: '',
    html: `<div style="filter:drop-shadow(0 0 6px #00fff5)">${SAT_SVG}</div>`,
    iconSize: [40, 40], iconAnchor: [20, 20],
  });
}

async function updateISS() {
  try {
    const res  = await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const data = await res.json();
    issLat = data.latitude; issLng = data.longitude;
    const alt = Math.round(data.altitude), speed = Math.round(data.velocity);
    const popupHTML = `
      <div class="popup-title">🛸 STATION ISS</div>
      <div class="popup-row">Latitude: <b>${issLat.toFixed(4)}°</b></div>
      <div class="popup-row">Longitude: <b>${issLng.toFixed(4)}°</b></div>
      <div class="popup-row">Altitude: <b>${alt} km</b></div>
      <div class="popup-row">Vitesse: <b>${speed} km/h</b></div>`;

    // Carte 2D
    if (!issMarker2D) {
      issMarker2D = L.marker([issLat, issLng], { icon: makeSatIcon2D(), zIndexOffset: 2000 }).addTo(map);
      issMarker2D.bindPopup(popupHTML);
    } else {
      issMarker2D.setLatLng([issLat, issLng]);
      issMarker2D.setPopupContent(popupHTML);
    }

    // Globe 3D — mis à jour via updateGlobeISS()
    if (isGlobeMode) updateGlobeISS();

  } catch(e) { console.warn('ISS error', e); }
}

// ════════════════════════════════════════════════════════════
//  GLOBE 3D — Globe.gl
// ════════════════════════════════════════════════════════════
function initGlobe() {
  globe = Globe()
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-dark.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#00fff5')
    .atmosphereAltitude(0.18)
    .width(document.getElementById('globeViz').offsetWidth)
    .height(document.getElementById('globeViz').offsetHeight)
    (document.getElementById('globeViz'));

  // Rotation automatique lente
  globe.controls().autoRotate = true;
  globe.controls().autoRotateSpeed = 0.4;
  globe.controls().enableZoom = true;

  // Clic → météo
  globe.onGlobeClick(({ lat, lng }) => {
    updateHUD(lat, lng);
  });

  // Points météo sur le globe
  applyGlobeWeather();
  applyGlobeDisasters();
  updateGlobeISS();
}

function applyGlobeWeather() {
  if (!globe) return;
  const pts = CITIES.filter(c => c.p <= 2).map(c => ({
    lat: c.lat, lng: c.lng, name: c.name, size: 0.4, color: '#00fff5',
    label: c.name,
  }));

  globe
    .pointsData(pts)
    .pointColor(() => '#00fff5')
    .pointAltitude(0.01)
    .pointRadius(0.35)
    .pointLabel(d => `<div style="font-family:'Share Tech Mono',monospace;background:rgba(2,10,24,.9);border:1px solid #00fff5;padding:4px 8px;color:#00fff5;font-size:11px">📍 ${d.name}</div>`)
    .onPointClick(({ lat, lng }) => updateHUD(lat, lng));
}

function applyGlobeDisasters() {
  if (!globe) return;
  const arcs = eqData.filter(e => e.mag >= 4).map(e => ({
    startLat: e.lat, startLng: e.lng,
    endLat: e.lat + 0.01, endLng: e.lng + 0.01,
    color: e.mag >= 6 ? '#ff2d78' : '#ff6b00',
    label: `M${e.mag.toFixed(1)} — ${e.place}`,
  }));

  // Séismes comme rings pulsants
  const rings = eqData.map(e => ({
    lat: e.lat, lng: e.lng,
    maxR: e.mag >= 6 ? 4 : e.mag >= 4 ? 2.5 : 1.2,
    propagationSpeed: e.mag >= 6 ? 3 : 2,
    repeatPeriod: e.mag >= 6 ? 900 : 1500,
    color: e.mag >= 6 ? '#ff2d78' : e.mag >= 4 ? '#ff6b00' : '#ffe600',
  }));

  globe
    .ringsData(rings)
    .ringColor(r => r.color)
    .ringMaxRadius(r => r.maxR)
    .ringPropagationSpeed(r => r.propagationSpeed)
    .ringRepeatPeriod(r => r.repeatPeriod);
}

function updateGlobeISS() {
  if (!globe) return;
  globe
    .labelsData([{ lat: issLat, lng: issLng, text: '🛸 ISS', size: 1.2, color: '#00ff9f' }])
    .labelText(d => d.text)
    .labelSize(d => d.size)
    .labelColor(d => d.color)
    .labelDotRadius(0.5)
    .labelAltitude(0.08);
}

// ─── TOGGLE GLOBE / CARTE ─────────────────────────────────────
document.getElementById('toggle-globe').addEventListener('click', () => {
  isGlobeMode = !isGlobeMode;
  const btn = document.getElementById('toggle-globe');
  const mapC  = document.getElementById('map-container');
  const globeC = document.getElementById('globe-container');

  if (isGlobeMode) {
    btn.classList.add('active');
    btn.querySelector('.toggle-label').textContent = 'CARTE';
    mapC.style.display   = 'none';
    globeC.style.display = 'flex';
    globeC.classList.add('visible');
    document.getElementById('zoom-indicator').style.display = 'none';
    if (!globe) initGlobe();
    else {
      globe.width(globeC.offsetWidth).height(globeC.offsetHeight);
      applyGlobeDisasters();
      updateGlobeISS();
    }
  } else {
    btn.classList.remove('active');
    btn.querySelector('.toggle-label').textContent = 'GLOBE';
    globeC.style.display = 'none';
    globeC.classList.remove('visible');
    mapC.style.display   = 'block';
    document.getElementById('zoom-indicator').style.display = 'block';
    map.invalidateSize();
  }
});

// ─── MOBILE HUD TOGGLE ────────────────────────────────────────
document.getElementById('mobile-hud-btn').addEventListener('click', () => {
  document.getElementById('hud-panel').classList.toggle('mobile-open');
});

// ─── DEBOUNCE ─────────────────────────────────────────────────
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ─── RESIZE GLOBE ─────────────────────────────────────────────
window.addEventListener('resize', debounce(() => {
  if (isGlobeMode && globe) {
    const c = document.getElementById('globe-container');
    globe.width(c.offsetWidth).height(c.offsetHeight);
  }
}, 200));

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  startClock();
  setProgress(10, 'Localisation en cours...');

  const pos = await geolocate();
  if (pos) userLocation = pos;

  setProgress(20, 'Initialisation de la carte...');
  initMap();

  setProgress(35, 'Données météo...');
  await updateHUD(userLocation.lat, userLocation.lng);

  setProgress(50, 'Marqueurs météo...');
  await refreshWeatherMarkers();

  setProgress(65, 'Localisation ISS...');
  await updateISS();
  setInterval(updateISS, CFG.issRefresh);

  setProgress(75, 'Chargement des séismes...');
  await loadEarthquakes();
  setInterval(loadEarthquakes, CFG.eqRefresh);

  setProgress(88, 'Catastrophes en cours...');
  await loadDisasters();

  setProgress(100, '◈ Système opérationnel');
  setInterval(() => updateHUD(userLocation.lat, userLocation.lng), CFG.refreshInterval);

  setTimeout(hideLoading, 700);
}

main();
