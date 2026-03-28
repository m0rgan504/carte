/* ══════════════════════════════════════════════════════════════
   GEOWATCH — app.js
   Globe 3D Three.js cyberpunk + Carte 2D bornée Leaflet
   APIs 100% gratuites, sans compte requis
   ══════════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────
const CFG = {
  defLat: 48.8566, defLng: 2.3522, defZoom: 4,
  refreshMeteо: 60_000,
  refreshISS:   5_000,
  refreshEQ:    300_000,
  maxBounds: [[-90,-180],[90,180]],
};

// ─── STATE ────────────────────────────────────────────────────
let map, leafletWeather, leafletEQ, leafletStorm, leafletVolcano, leafletFlood;
let threeRenderer, threeScene, threeCamera, threeGlobe, threeAnim;
let globeInited = false;
let isGlobe     = false;
let hudOpen     = true;
let zoomLv      = CFG.defZoom;
let userLoc     = { lat: CFG.defLat, lng: CFG.defLng };
let issLat = 0, issLng = 0;
let issMarker2D = null;
let isRefreshing = false;
let eqRaw = [];       // données séismes brutes
let disRaw = [];      // données catastrophes

// ─── WMO CODES ────────────────────────────────────────────────
const WMO = {
  0:{l:'Ciel dégagé',i:'☀️'},1:{l:'Peu nuageux',i:'🌤️'},2:{l:'Partiellement nuageux',i:'⛅'},3:{l:'Couvert',i:'☁️'},
  45:{l:'Brouillard',i:'🌫️'},48:{l:'Brouillard givrant',i:'🌫️'},
  51:{l:'Bruine légère',i:'🌦️'},53:{l:'Bruine',i:'🌦️'},55:{l:'Bruine dense',i:'🌧️'},
  61:{l:'Pluie légère',i:'🌧️'},63:{l:'Pluie',i:'🌧️'},65:{l:'Pluie forte',i:'🌧️'},
  71:{l:'Neige légère',i:'🌨️'},73:{l:'Neige',i:'❄️'},75:{l:'Neige forte',i:'❄️'},77:{l:'Grésil',i:'🌨️'},
  80:{l:'Averses',i:'🌦️'},81:{l:'Averses modérées',i:'🌧️'},82:{l:'Averses violentes',i:'⛈️'},
  85:{l:'Averses neige',i:'🌨️'},86:{l:'Averses neige fortes',i:'❄️'},
  95:{l:'Orage',i:'⛈️'},96:{l:'Orage + grêle',i:'⛈️'},99:{l:'Orage violent',i:'🌩️'},
};
const wmo = c => WMO[c] || {l:'Inconnu',i:'❓'};
const WDIR = ['N','NE','E','SE','S','SO','O','NO'];
const wdir = d => WDIR[Math.round(d/45)%8];
const DAYS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const ft   = d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
const deb  = (fn,ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

// ─── LOADING ──────────────────────────────────────────────────
const setP = (p,m) => {
  document.getElementById('loading-bar').style.width = p+'%';
  document.getElementById('loading-msg').textContent  = m;
};
const hideLd = () => {
  const s=document.getElementById('loading-screen');
  s.classList.add('gone'); setTimeout(()=>s.remove(),900);
};

// ─── HORLOGE ──────────────────────────────────────────────────
function startClock() {
  const tick = () => {
    const n=new Date();
    document.getElementById('clock-time').textContent =
      `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    document.getElementById('clock-date').textContent =
      `${DAYS[n.getDay()]} ${String(n.getDate()).padStart(2,'0')} ${MONS[n.getMonth()]} ${n.getFullYear()}`;
  };
  tick(); setInterval(tick,1000);
}

// ─── GEO ──────────────────────────────────────────────────────
const geolocate = () => new Promise(r => {
  if(!navigator.geolocation) return r(null);
  navigator.geolocation.getCurrentPosition(p=>r({lat:p.coords.latitude,lng:p.coords.longitude}),()=>r(null),{timeout:5000});
});

// ─── CACHE MÉTÉO ──────────────────────────────────────────────
const wxCache = {}; const WX_TTL = 10*60_000;
async function getWx(lat,lng,days=1) {
  const k=`${lat.toFixed(2)},${lng.toFixed(2)}`;
  if(wxCache[k] && Date.now()-wxCache[k].ts < WX_TTL) return wxCache[k].d;
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    +`&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index`
    +`&daily=temperature_2m_max,temperature_2m_min,uv_index_max,windspeed_10m_max,winddirection_10m_dominant,weather_code`
    +`&timezone=auto&forecast_days=${days}`;
  const d=(await(await fetch(url)).json());
  wxCache[k]={d,ts:Date.now()}; return d;
}

// ─── GÉOCODE INVERSE ──────────────────────────────────────────
const gcCache={};
async function revGeo(lat,lng) {
  const k=`${lat.toFixed(1)},${lng.toFixed(1)}`;
  if(gcCache[k]) return gcCache[k];
  try {
    const d=await(await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fr`)).json();
    const a=d.address, n=a.city||a.town||a.village||a.county||a.country||`${lat.toFixed(2)}°,${lng.toFixed(2)}°`;
    return gcCache[k]=n;
  } catch { return `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`; }
}

// ─── HUD ──────────────────────────────────────────────────────
async function updateHUD(lat,lng) {
  try {
    const data=await getWx(lat,lng,7), c=data.current, d=data.daily, info=wmo(c.weather_code);
    document.getElementById('h-temp').textContent  = `${Math.round(c.temperature_2m)}°C`;
    document.getElementById('h-feels').textContent = `${Math.round(c.apparent_temperature)}°C`;
    document.getElementById('h-mm').textContent    = `${Math.round(d.temperature_2m_min[0])}°/${Math.round(d.temperature_2m_max[0])}°`;
    document.getElementById('h-uv').textContent    = (c.uv_index??d.uv_index_max[0]??0).toFixed(1);
    document.getElementById('h-wind').textContent  = `${Math.round(c.windspeed_10m)} km/h`;
    document.getElementById('h-wdir').textContent  = `${wdir(c.winddirection_10m)} ${Math.round(c.winddirection_10m)}°`;
    document.getElementById('h-wx').textContent    = `${info.i} ${info.l}`;
    const sun=SunCalc.getTimes(new Date(),lat,lng);
    document.getElementById('h-rise').textContent = ft(sun.sunrise);
    document.getElementById('h-set').textContent  = ft(sun.sunset);
    sunArc(sun.sunrise,sun.sunset);
    renderForecast(d);
    revGeo(lat,lng).then(n=>document.getElementById('hud-loc').textContent=n.toUpperCase());
  } catch(e){console.warn('HUD',e);}
}

// ─── ARC SOLEIL ───────────────────────────────────────────────
function sunArc(rise,set) {
  const now=new Date(), t=Math.max(0,Math.min(1,(now-rise)/(set-rise)));
  const bx=(1-t)**2*8+2*(1-t)*t*100+t**2*192;
  const by=(1-t)**2*72+2*(1-t)*t*4+t**2*72;
  const dot=document.getElementById('sun-dot');
  if(dot){dot.setAttribute('cx',bx.toFixed(1));dot.setAttribute('cy',by.toFixed(1));dot.setAttribute('opacity',now>rise&&now<set?'1':'.3');}
}

// ─── PRÉVISIONS ───────────────────────────────────────────────
function renderForecast(d) {
  const g=document.getElementById('fc-grid'); g.innerHTML='';
  for(let i=0;i<7;i++){
    const dt=new Date(d.time[i]), info=wmo(d.weather_code[i]);
    const el=document.createElement('div'); el.className='fc-day';
    el.innerHTML=`<div class="fc-dn">${DAYS[dt.getDay()]}</div><div class="fc-ico">${info.i}</div>`+
      `<div class="fc-hi">${Math.round(d.temperature_2m_max[i])}°</div>`+
      `<div class="fc-lo">${Math.round(d.temperature_2m_min[i])}°</div>`+
      `<div class="fc-w">💨${Math.round(d.windspeed_10m_max[i])}</div>`+
      `<div class="fc-uv">UV${(d.uv_index_max[i]||0).toFixed(1)}</div>`;
    g.appendChild(el);
  }
}

// ═══════════════════════════════════════════════════════════════
//  CARTE 2D — LEAFLET
// ═══════════════════════════════════════════════════════════════
function initMap() {
  map = L.map('map',{
    center:[userLoc.lat,userLoc.lng], zoom:CFG.defZoom,
    maxBounds:CFG.maxBounds, maxBoundsViscosity:1.0,
    minZoom:2, worldCopyJump:false, preferCanvas:true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
    attribution:'© OpenStreetMap © CARTO', subdomains:'abcd', maxZoom:19, noWrap:true,
  }).addTo(map);

  leafletWeather = L.layerGroup().addTo(map);

  map.on('zoomend',()=>{ zoomLv=map.getZoom(); document.getElementById('zoom-ind').textContent=`ZOOM : ${zoomLv}`; refreshWxMarkers(); });
  map.on('moveend', deb(refreshWxMarkers,600));
  map.on('click',   e=>{ popupWx(e.latlng.lat,e.latlng.lng); updateHUD(e.latlng.lat,e.latlng.lng); });
  map.on('mousemove', deb((e)=>{ if(zoomLv>=5) showTip(e.latlng.lat,e.latlng.lng,e.originalEvent); },380));
  map.on('mouseout', ()=>{ document.getElementById('tip').style.display='none'; });
}

// ─── TOOLTIP ──────────────────────────────────────────────────
const tipCache={};
async function showTip(lat,lng,ev) {
  const k=`${(lat*4|0)/4},${(lng*4|0)/4}`;
  let d=tipCache[k];
  if(!d){try{d=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,windspeed_10m&timezone=auto`)).json();tipCache[k]=d;}catch{return;}}
  const c=d.current,info=wmo(c.weather_code), tip=document.getElementById('tip');
  tip.innerHTML=`<div class="tip-t">${info.i} ${lat.toFixed(2)}°, ${lng.toFixed(2)}°</div>`+
    `<div class="tip-r"><span>Temp</span><span class="tip-v">${Math.round(c.temperature_2m)}°C</span></div>`+
    `<div class="tip-r"><span>Vent</span><span class="tip-v">${Math.round(c.windspeed_10m)} km/h</span></div>`+
    `<div class="tip-r"><span>Météo</span><span class="tip-v">${info.l}</span></div>`;
  tip.style.display='block';
  tip.style.left=(ev.clientX+15)+'px'; tip.style.top=(ev.clientY-8)+'px';
}

// ─── POPUP MÉTÉO ──────────────────────────────────────────────
async function popupWx(lat,lng) {
  try {
    const data=await getWx(lat,lng,7),c=data.current,d=data.daily,info=wmo(c.weather_code);
    const name=await revGeo(lat,lng);
    L.popup().setLatLng([lat,lng]).setContent(`
      <div class="pt">📍 ${name.toUpperCase()}</div>
      <div class="pr">Météo: <b>${info.i} ${info.l}</b></div>
      <div class="pr">Temp: <b>${Math.round(c.temperature_2m)}°C</b> (ressenti ${Math.round(c.apparent_temperature)}°C)</div>
      <div class="pr">Min/Max: <b>${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°</b></div>
      <div class="pr">Vent: <b>${Math.round(c.windspeed_10m)} km/h ${wdir(c.winddirection_10m)}</b></div>
      <div class="pr">UV: <b>${(c.uv_index??d.uv_index_max[0]??0).toFixed(1)}</b></div>`).openOn(map);
  } catch(e){console.warn('popup',e);}
}

// ─── VILLES ───────────────────────────────────────────────────
const CITIES=[
  {n:'Paris',lat:48.85,lng:2.35,p:1},{n:'London',lat:51.51,lng:-.13,p:1},
  {n:'New York',lat:40.71,lng:-74.01,p:1},{n:'Tokyo',lat:35.69,lng:139.69,p:1},
  {n:'Sydney',lat:-33.87,lng:151.21,p:1},{n:'Moscow',lat:55.75,lng:37.62,p:1},
  {n:'Dubai',lat:25.20,lng:55.27,p:1},{n:'São Paulo',lat:-23.55,lng:-46.63,p:1},
  {n:'Cairo',lat:30.04,lng:31.24,p:1},{n:'Beijing',lat:39.91,lng:116.39,p:1},
  {n:'Mumbai',lat:19.08,lng:72.88,p:1},{n:'Lagos',lat:6.52,lng:3.38,p:1},
  {n:'Chicago',lat:41.88,lng:-87.63,p:2},{n:'Los Angeles',lat:34.05,lng:-118.24,p:2},
  {n:'Berlin',lat:52.52,lng:13.40,p:2},{n:'Rome',lat:41.90,lng:12.50,p:2},
  {n:'Madrid',lat:40.42,lng:-3.70,p:2},{n:'Amsterdam',lat:52.37,lng:4.90,p:2},
  {n:'Istanbul',lat:41.01,lng:28.95,p:2},{n:'Seoul',lat:37.57,lng:126.98,p:2},
  {n:'Bangkok',lat:13.75,lng:100.52,p:2},{n:'Singapore',lat:1.35,lng:103.82,p:2},
  {n:'Jakarta',lat:-6.21,lng:106.85,p:2},{n:'Buenos Aires',lat:-34.60,lng:-58.38,p:2},
  {n:'Toronto',lat:43.65,lng:-79.38,p:2},{n:'Mexico City',lat:19.43,lng:-99.13,p:2},
  {n:'Nairobi',lat:-1.29,lng:36.82,p:2},{n:'Tehran',lat:35.69,lng:51.39,p:2},
  {n:'Atlantique N.',lat:35.0,lng:-40.0,p:2},{n:'Pacifique N.',lat:30.0,lng:-150.0,p:2},
  {n:'Océan Indien',lat:-15.0,lng:70.0,p:2},{n:'Méditerranée',lat:35.0,lng:18.0,p:2},
  {n:'Mer du Nord',lat:56.0,lng:3.0,p:2},{n:'Mer de Chine',lat:15.0,lng:115.0,p:2},
  {n:'Lyon',lat:45.75,lng:4.83,p:3},{n:'Marseille',lat:43.30,lng:5.37,p:3},
  {n:'Bordeaux',lat:44.84,lng:-.58,p:3},{n:'Toulouse',lat:43.60,lng:1.44,p:3},
  {n:'Nice',lat:43.70,lng:7.27,p:3},{n:'Lille',lat:50.63,lng:3.07,p:3},
  {n:'Strasbourg',lat:48.57,lng:7.75,p:3},{n:'Nantes',lat:47.22,lng:-1.55,p:3},
  {n:'Barcelona',lat:41.39,lng:2.15,p:3},{n:'Milan',lat:45.46,lng:9.19,p:3},
  {n:'Munich',lat:48.14,lng:11.58,p:3},{n:'Vienna',lat:48.21,lng:16.37,p:3},
  {n:'Warsaw',lat:52.23,lng:21.01,p:3},{n:'Prague',lat:50.08,lng:14.44,p:3},
  {n:'Oslo',lat:59.91,lng:10.75,p:3},{n:'Stockholm',lat:59.33,lng:18.07,p:3},
  {n:'Helsinki',lat:60.17,lng:24.94,p:3},{n:'Copenhagen',lat:55.68,lng:12.57,p:3},
  {n:'Lisbon',lat:38.72,lng:-9.14,p:3},{n:'Athens',lat:37.98,lng:23.73,p:3},
  {n:'Kyiv',lat:50.45,lng:30.52,p:3},{n:'Budapest',lat:47.50,lng:19.04,p:3},
  {n:'Seattle',lat:47.61,lng:-122.33,p:3},{n:'Miami',lat:25.77,lng:-80.19,p:3},
  {n:'Montreal',lat:45.50,lng:-73.57,p:3},{n:'Santiago',lat:-33.45,lng:-70.67,p:3},
  {n:'Osaka',lat:34.69,lng:135.50,p:3},{n:'Melbourne',lat:-37.81,lng:144.96,p:3},
  {n:'Manila',lat:14.60,lng:120.98,p:3},{n:'Casablanca',lat:33.59,lng:-7.62,p:3},
];

function mkMarkerHTML(city, c, daily, zoom) {
  const info=wmo(c.weather_code), temp=Math.round(c.temperature_2m);
  const tmin=Math.round(daily.temperature_2m_min[0]), tmax=Math.round(daily.temperature_2m_max[0]);
  const ws=Math.round(c.windspeed_10m), wd=wdir(c.winddirection_10m);
  const uv=(c.uv_index??0).toFixed(1), feels=Math.round(c.apparent_temperature);
  const col=temp<=0?'#66ccff':temp>=35?'#ff2d78':temp>=25?'#ffe600':'#00fff5';
  if(zoom<=4) return `<div class="wm wm1"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°</span><span class="wn">${city.n}</span></div>`;
  if(zoom<=6) return `<div class="wm wm2"><div class="wrt"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°C</span></div><div class="wn">${city.n}</div><div class="ws">💨 ${ws} km/h ${wd}</div></div>`;
  if(zoom<=8) return `<div class="wm wm3"><div class="wrt"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°C</span></div><div class="wn">${city.n}</div><div class="ws"><span>↓${tmin}° ↑${tmax}°</span><span>💨${ws}km/h ${wd}</span></div></div>`;
  return `<div class="wm wm4"><div class="whead"><span class="wi">${info.i}</span><div><div class="wcn">${city.n}</div><div class="wdc">${info.l}</div></div></div><div class="wdiv"></div><div class="wg"><div class="wc"><span class="wl">TEMP</span><span class="wv" style="color:${col}">${temp}°C</span></div><div class="wc"><span class="wl">RESSENTI</span><span class="wv">${feels}°C</span></div><div class="wc"><span class="wl">MIN/MAX</span><span class="wv">${tmin}°/${tmax}°</span></div><div class="wc"><span class="wl">UV</span><span class="wv" style="color:#ff6b00">${uv}</span></div><div class="wc"><span class="wl">VENT</span><span class="wv">${ws}km/h</span></div><div class="wc"><span class="wl">DIR.</span><span class="wv">${wd} ${Math.round(c.winddirection_10m)}°</span></div></div></div>`;
}

async function refreshWxMarkers() {
  if(isRefreshing||!map) return;
  isRefreshing=true; leafletWeather.clearLayers();
  const bounds=map.getBounds(), zoom=map.getZoom();
  const cities=CITIES.filter(c=>zoom<=4?c.p===1:zoom<=6?c.p<=2&&bounds.contains([c.lat,c.lng]):bounds.contains([c.lat,c.lng])).slice(0,zoom<=4?12:zoom<=6?35:60);
  for(let i=0;i<cities.length;i+=5) {
    await Promise.all(cities.slice(i,i+5).map(async city=>{
      try {
        const data=await getWx(city.lat,city.lng);
        const html=mkMarkerHTML(city,data.current,data.daily,zoom);
        const icon=L.divIcon({className:'wm-wrap',html,iconAnchor:[0,0]});
        const m=L.marker([city.lat,city.lng],{icon,zIndexOffset:100});
        m.on('click',()=>{popupWx(city.lat,city.lng);updateHUD(city.lat,city.lng);});
        leafletWeather.addLayer(m);
      } catch{}
    }));
  }
  isRefreshing=false;
}

// ─── ISS SVG satellite ────────────────────────────────────────
const SAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" width="44" height="44">
<defs>
  <filter id="sf"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="bg2" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#1a4a6a"/><stop offset="100%" stop-color="#0a1e30"/>
  </radialGradient>
</defs>
<!-- Panneaux gauche -->
<rect x="1" y="21" width="16" height="10" rx="1.5" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.2"/>
<line x1="5"  y1="21" x2="5"  y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="9"  y1="21" x2="9"  y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="13" y1="21" x2="13" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<!-- Bras gauche -->
<rect x="17" y="24.5" width="5" height="3" fill="#00fff5" opacity=".7"/>
<!-- Corps central -->
<rect x="21" y="19" width="10" height="14" rx="2" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.6" filter="url(#sf)"/>
<!-- Bras droit -->
<rect x="30" y="24.5" width="5" height="3" fill="#00fff5" opacity=".7"/>
<!-- Panneaux droite -->
<rect x="35" y="21" width="16" height="10" rx="1.5" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.2"/>
<line x1="39" y1="21" x2="39" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="43" y1="21" x2="43" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="47" y1="21" x2="47" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<!-- Antenne -->
<line x1="26" y1="19" x2="26" y2="10" stroke="#00fff5" stroke-width="1.1" opacity=".85"/>
<ellipse cx="26" cy="8.5" rx="2.5" ry="1.5" fill="none" stroke="#ffe600" stroke-width="1" opacity=".85"/>
<!-- Cœur lumineux -->
<circle cx="26" cy="26" r="3.5" fill="#00fff5" opacity=".9" filter="url(#sf)"/>
<!-- Signal pulsant -->
<circle cx="26" cy="26" r="7" fill="none" stroke="#00fff5" stroke-width=".8" opacity=".3"/>
</svg>`;

function mkISS2DIcon() {
  return L.divIcon({
    className:'', iconSize:[44,44], iconAnchor:[22,22],
    html:`<div style="filter:drop-shadow(0 0 8px #00fff5)">${SAT_SVG}</div>`,
  });
}

async function updateISS() {
  try {
    const res=await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const d=await res.json();
    issLat=d.latitude; issLng=d.longitude;
    const alt=Math.round(d.altitude), spd=Math.round(d.velocity);
    const pop=`<div class="pt">🛸 ISS — STATION SPATIALE</div><div class="pr">Lat: <b>${issLat.toFixed(4)}°</b></div><div class="pr">Lng: <b>${issLng.toFixed(4)}°</b></div><div class="pr">Altitude: <b>${alt} km</b></div><div class="pr">Vitesse: <b>${spd} km/h</b></div>`;
    if(!issMarker2D) {
      issMarker2D=L.marker([issLat,issLng],{icon:mkISS2DIcon(),zIndexOffset:3000}).addTo(map);
      issMarker2D.bindPopup(pop);
    } else { issMarker2D.setLatLng([issLat,issLng]); issMarker2D.setPopupContent(pop); }
  } catch(e){console.warn('ISS',e);}
}

// ─── SÉISMES ──────────────────────────────────────────────────
async function loadEQ() {
  if(leafletEQ) map.removeLayer(leafletEQ);
  leafletEQ=L.layerGroup(); eqRaw=[];
  try {
    const data=await(await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson')).json();
    data.features.forEach(f=>{
      const [lng,lat,depth]=f.geometry.coordinates, mag=f.properties.mag;
      const place=f.properties.place, time=new Date(f.properties.time).toLocaleString('fr-FR');
      eqRaw.push({lat,lng,mag,place,depth,time});
      let color,r; if(mag>=6){color='#ff2d78';r=18;}else if(mag>=4){color='#ff6b00';r=12;}else{color='#ffe600';r=7;}
      const c=L.circleMarker([lat,lng],{radius:r,fillColor:color,color:'rgba(255,255,255,.3)',weight:1,fillOpacity:.78});
      c.bindPopup(`<div class="pt">🔴 SÉISME — M${mag.toFixed(1)}</div><div class="pr">Lieu: <b>${place}</b></div><div class="pr">Magnitude: <b>${mag.toFixed(1)}</b></div><div class="pr">Profondeur: <b>${depth.toFixed(0)} km</b></div><div class="pr">Zone: <b>${depth>60?'🌊 Maritime':'🏔️ Terrestre'}</b></div><div class="pr">Date: <b>${time}</b></div>`);
      leafletEQ.addLayer(c);
    });
  } catch(e){console.warn('EQ',e);}
  leafletEQ.addTo(map);
  if(globeInited) updateGlobeEQ();
}

// ─── CATASTROPHES ─────────────────────────────────────────────
function mkDisIcon(col,em,nm) {
  return L.divIcon({className:'',iconAnchor:[0,0],html:`<div style="background:rgba(2,10,24,.92);border:1px solid ${col};box-shadow:0 0 9px ${col};padding:2px 7px;white-space:nowrap;font-family:'Share Tech Mono',monospace;font-size:10.5px;color:${col};cursor:pointer">${em} <span style="font-size:8.5px;color:rgba(200,230,240,.65)">${nm.length>22?nm.slice(0,20)+'…':nm}</span></div>`});
}

async function loadDisasters() {
  [leafletStorm,leafletVolcano,leafletFlood].forEach(l=>l&&map.removeLayer(l));
  leafletStorm=L.layerGroup(); leafletVolcano=L.layerGroup(); leafletFlood=L.layerGroup(); disRaw=[];
  const addV=(v)=>{disRaw.push({lat:v.lat,lng:v.lng,type:'VO',name:v.name});const m=L.marker([v.lat,v.lng],{icon:mkDisIcon('#ff4400','🌋',v.name)});m.bindPopup(`<div class="pt">🌋 ${v.name.toUpperCase()}</div><div class="pr">Volcan actif</div>`);leafletVolcano.addLayer(m);};
  try {
    const url='https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS?limit=50&alertlevel=Red,Orange&eventtype=TC,FL,VO';
    const w=await(await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)).json();
    const data=JSON.parse(w.contents);
    if(data?.features) data.features.forEach(f=>{
      const p=f.properties, coord=f.geometry?.coordinates; if(!coord)return;
      const [lng,lat]=coord, type=p.eventtype, name=p.name||type;
      disRaw.push({lat,lng,type,name,alert:p.alertlevel});
      let em,col,layer;
      if(type==='TC'){em='🌀';col='#b266ff';layer=leafletStorm;}
      else if(type==='VO'){em='🌋';col='#ff4400';layer=leafletVolcano;}
      else if(type==='FL'){em='🌊';col='#0088ff';layer=leafletFlood;}
      else return;
      const m=L.marker([lat,lng],{icon:mkDisIcon(col,em,name)});
      m.bindPopup(`<div class="pt">${em} ${name.toUpperCase()}</div><div class="pr">Type: <b>{{({TC:'Cyclone',VO:'Éruption',FL:'Inondation'})[type]}}</b></div><div class="pr">Alerte: <b style="color:${p.alertlevel==='Red'?'#ff2d78':'#ff6b00'}">${p.alertlevel}</b></div>`);
      layer.addLayer(m);
    });
  } catch {
    [{lat:19.42,lng:-155.29,name:'Kīlauea'},{lat:37.75,lng:15.00,name:'Etna'},{lat:-8.34,lng:115.51,name:'Agung'},{lat:14.38,lng:120.46,name:'Taal'},{lat:-0.68,lng:29.25,name:'Nyiragongo'},{lat:64.63,lng:-17.52,name:'Hekla'},{lat:-39.42,lng:-71.95,name:'Villarrica'}].forEach(addV);
  }
  [leafletStorm,leafletVolcano,leafletFlood].forEach(l=>l.addTo(map));
}

// ═══════════════════════════════════════════════════════════════
//  GLOBE 3D — THREE.JS CUSTOM CYBERPUNK
// ═══════════════════════════════════════════════════════════════
const GLOBE_R = 200; // rayon sphère Three.js

function latLngToVec3(lat, lng, r) {
  const phi   = (90-lat)*Math.PI/180;
  const theta = (lng+180)*Math.PI/180;
  return new THREE.Vector3(
    -r*Math.sin(phi)*Math.cos(theta),
     r*Math.cos(phi),
     r*Math.sin(phi)*Math.sin(theta)
  );
}

function initGlobe() {
  const wrap = document.getElementById('globe-wrap');
  const W = wrap.offsetWidth, H = wrap.offsetHeight;

  // Renderer
  threeRenderer = new THREE.WebGLRenderer({ canvas: document.getElementById('globe-canvas'), antialias: true, alpha: true });
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  threeRenderer.setSize(W, H);
  threeRenderer.setClearColor(0x000000, 0);

  // Scene
  threeScene = new THREE.Scene();

  // Camera
  threeCamera = new THREE.PerspectiveCamera(45, W/H, 1, 5000);
  threeCamera.position.set(0, 0, 600);

  // Lumières
  threeScene.add(new THREE.AmbientLight(0x112233, 3));
  const sun = new THREE.DirectionalLight(0x88ccff, 2.5);
  sun.position.set(500,300,300); threeScene.add(sun);
  const rim = new THREE.DirectionalLight(0x00fff5, 0.4);
  rim.position.set(-300,-200,-300); threeScene.add(rim);

  // ── Étoiles ──
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for(let i=0;i<8000;i++){
    const r=2000, phi=Math.random()*Math.PI*2, theta=Math.acos(2*Math.random()-1);
    starPos.push(r*Math.sin(theta)*Math.cos(phi),r*Math.cos(theta),r*Math.sin(theta)*Math.sin(phi));
  }
  starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPos,3));
  threeScene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({color:0xffffff,size:1.2,sizeAttenuation:true})));

  // ── Globe sphère ──
  const gGeo = new THREE.SphereGeometry(GLOBE_R, 64, 64);
  const loader = new THREE.TextureLoader();

  // Texture terre dark
  const earthTex = loader.load('https://unpkg.com/three-globe/example/img/earth-dark.jpg');
  const bumpTex  = loader.load('https://unpkg.com/three-globe/example/img/earth-topology.png');
  const gMat = new THREE.MeshPhongMaterial({
    map: earthTex, bumpMap: bumpTex, bumpScale: 4,
    specular: new THREE.Color(0x00fff5), shininess: 12,
  });
  threeGlobe = new THREE.Mesh(gGeo, gMat);
  threeScene.add(threeGlobe);

  // ── Atmosphère (glow shader) ──
  const atmGeo = new THREE.SphereGeometry(GLOBE_R*1.055, 64, 64);
  const atmMat = new THREE.ShaderMaterial({
    uniforms:{ c:{value:.28}, p:{value:5.5}, glowColor:{value:new THREE.Color(0x00fff5)}, viewVector:{value:threeCamera.position} },
    vertexShader:`
      uniform vec3 viewVector; uniform float c; uniform float p;
      varying float intensity;
      void main(){vec3 vNormal=normalize(normalMatrix*normal);vec3 vNormel=normalize(normalMatrix*viewVector);intensity=pow(c-dot(vNormal,vNormel),p);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`
      uniform vec3 glowColor; varying float intensity;
      void main(){vec3 glow=glowColor*intensity;gl_FragColor=vec4(glow,intensity*.6);}`,
    side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true,
  });
  threeScene.add(new THREE.Mesh(atmGeo, atmMat));

  // ── Grille de longitude/latitude (wireframe style) ──
  const gridMat = new THREE.LineBasicMaterial({ color: 0x00fff5, transparent: true, opacity: 0.06 });
  for(let lng=-180;lng<=180;lng+=30) {
    const pts=[];
    for(let la=-90;la<=90;la+=2) pts.push(latLngToVec3(la,lng,GLOBE_R+0.5));
    threeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  for(let la=-75;la<=75;la+=30) {
    const pts=[];
    for(let ln=-180;ln<=180;ln+=2) pts.push(latLngToVec3(la,ln,GLOBE_R+0.5));
    threeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }

  // ── Contrôles orbitaux manuels ──
  setupOrbit();

  // ── Données ──
  updateGlobeEQ();
  updateGlobeISS3D();
  updateGlobeCities();

  // ── Rendu ──
  const clock = new THREE.Clock();
  function animate() {
    threeAnim = requestAnimationFrame(animate);
    const dt = clock.getDelta();
    threeGlobe.rotation.y += 0.0008;
    threeRenderer.render(threeScene, threeCamera);
    updateGlobeLabels();
  }
  animate();
  globeInited = true;
}

// ── Contrôles orbit simples (sans OrbitControls externe) ──────
let orbit = { isDown:false, prevX:0, prevY:0, rotX:0.3, rotY:0, zoom:600 };
function setupOrbit() {
  const c = document.getElementById('globe-canvas');
  c.addEventListener('mousedown', e=>{orbit.isDown=true;orbit.prevX=e.clientX;orbit.prevY=e.clientY;});
  window.addEventListener('mouseup', ()=>orbit.isDown=false);
  window.addEventListener('mousemove', e=>{
    if(!orbit.isDown||!isGlobe) return;
    const dx=e.clientX-orbit.prevX, dy=e.clientY-orbit.prevY;
    orbit.rotY+=dx*0.005; orbit.rotX+=dy*0.005;
    orbit.rotX=Math.max(-1.4,Math.min(1.4,orbit.rotX));
    orbit.prevX=e.clientX; orbit.prevY=e.clientY;
    threeGlobe.rotation.x=orbit.rotX; threeGlobe.rotation.y=orbit.rotY;
  });
  c.addEventListener('wheel', e=>{
    e.preventDefault();
    orbit.zoom=Math.max(250,Math.min(900,orbit.zoom+e.deltaY*0.6));
    threeCamera.position.z=orbit.zoom;
  },{passive:false});
  // Touch
  let t0=null;
  c.addEventListener('touchstart', e=>{if(e.touches.length===1){orbit.isDown=true;t0=e.touches[0];orbit.prevX=t0.clientX;orbit.prevY=t0.clientY;}});
  c.addEventListener('touchend',   ()=>orbit.isDown=false);
  c.addEventListener('touchmove',  e=>{
    if(!orbit.isDown||!isGlobe) return; e.preventDefault();
    const t=e.touches[0],dx=t.clientX-orbit.prevX,dy=t.clientY-orbit.prevY;
    orbit.rotY+=dx*0.005; orbit.rotX+=dy*0.005;
    orbit.rotX=Math.max(-1.4,Math.min(1.4,orbit.rotX));
    orbit.prevX=t.clientX; orbit.prevY=t.clientY;
    threeGlobe.rotation.x=orbit.rotX; threeGlobe.rotation.y=orbit.rotY;
  },{passive:false});
}

// ── Points 3D sur le globe ────────────────────────────────────
let globePoints=[];
function addGlobePoint(lat, lng, color, size=4) {
  const v=latLngToVec3(lat,lng,GLOBE_R+1.5);
  const geo=new THREE.SphereGeometry(size,8,8);
  const mat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.position.copy(v); threeScene.add(mesh); globePoints.push(mesh);
  // Halo pulsant
  const halo=new THREE.Mesh(new THREE.SphereGeometry(size*1.8,8,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.25,side:THREE.BackSide}));
  halo.position.copy(v); threeScene.add(halo); globePoints.push(halo);
  return mesh;
}

function clearGlobePoints() {
  globePoints.forEach(m=>{threeScene.remove(m);m.geometry.dispose();m.material.dispose();});
  globePoints=[];
  document.getElementById('globe-labels').innerHTML='';
}

// ── Séismes sur le globe ──────────────────────────────────────
function updateGlobeEQ() {
  if(!globeInited) return;
  eqRaw.forEach(e=>{
    const col=e.mag>=6?0xff2d78:e.mag>=4?0xff6b00:0xffe600;
    const sz=e.mag>=6?6:e.mag>=4?4:2.5;
    addGlobePoint(e.lat,e.lng,col,sz);
  });
}

// ── Villes sur le globe ───────────────────────────────────────
function updateGlobeCities() {
  CITIES.filter(c=>c.p===1).forEach(c=>addGlobePoint(c.lat,c.lng,0x00fff5,2.2));
}

// ── ISS sur le globe ──────────────────────────────────────────
let issGlobeMesh=null, issGlobeOrbit=null;
function updateGlobeISS3D() {
  if(!globeInited) return;
  if(issGlobeMesh){threeScene.remove(issGlobeMesh);issGlobeMesh.geometry.dispose();issGlobeMesh.material.dispose();}
  if(issGlobeOrbit){threeScene.remove(issGlobeOrbit);}
  // Satellite au-dessus de la surface (~400km → ~5% rayon en échelle)
  const v=latLngToVec3(issLat,issLng,GLOBE_R+14);
  const geo=new THREE.BoxGeometry(5,2,8);
  const mat=new THREE.MeshBasicMaterial({color:0x00ff9f});
  issGlobeMesh=new THREE.Mesh(geo,mat);
  issGlobeMesh.position.copy(v);
  issGlobeMesh.lookAt(new THREE.Vector3(0,0,0));
  threeScene.add(issGlobeMesh);
}

// ── Labels HTML projetés ──────────────────────────────────────
const globeLabelData=[];
function updateGlobeLabels() {
  if(!globeInited||!isGlobe) return;
  const container=document.getElementById('globe-labels');
  const W=threeRenderer.domElement.width/window.devicePixelRatio;
  const H=threeRenderer.domElement.height/window.devicePixelRatio;

  // Construit la liste de labels au premier appel
  if(!globeLabelData.length) {
    CITIES.filter(c=>c.p===1).forEach(c=>globeLabelData.push({lat:c.lat,lng:c.lng,text:c.n,cls:''}));
    eqRaw.filter(e=>e.mag>=6).slice(0,10).forEach(e=>globeLabelData.push({lat:e.lat,lng:e.lng,text:`M${e.mag.toFixed(1)} ${e.place?.slice(0,20)||''}`,cls:'eq'}));
    globeLabelData.push({lat:issLat,lng:issLng,text:'🛸 ISS',cls:'iss',isISS:true});
  } else {
    // Met à jour la position ISS
    const issL=globeLabelData.find(l=>l.isISS);
    if(issL){issL.lat=issLat;issL.lng=issLng;}
  }

  container.innerHTML='';
  globeLabelData.forEach(item=>{
    const v=latLngToVec3(item.lat,item.lng,GLOBE_R+3);
    // Applique la rotation du globe
    const rot=threeGlobe.rotation;
    const cosX=Math.cos(rot.x),sinX=Math.sin(rot.x),cosY=Math.cos(rot.y),sinY=Math.sin(rot.y);
    const x1=v.x*cosY+v.z*sinY;
    const y1=v.y;
    const z1=-v.x*sinY+v.z*cosY;
    const y2=y1*cosX-z1*sinX;
    const z2=y1*sinX+z1*cosX;
    if(z2<0) return; // derrière le globe
    // Projection caméra
    const proj=new THREE.Vector3(x1,y2,z2).project(threeCamera);
    const px=(proj.x*.5+.5)*W, py=(-.5*proj.y+.5)*H;
    const el=document.createElement('div');
    el.className='glabel'+(item.cls?' '+item.cls:'');
    el.textContent=item.text;
    el.style.left=px+'px'; el.style.top=py+'px';
    container.appendChild(el);
  });
}

// ─── TOGGLE VUE ───────────────────────────────────────────────
document.getElementById('btn-toggle-view').addEventListener('click',()=>{
  isGlobe=!isGlobe;
  const btn=document.getElementById('btn-toggle-view');
  const mapW=document.getElementById('map-wrap'), globeW=document.getElementById('globe-wrap');
  const zInd=document.getElementById('zoom-ind');
  if(isGlobe){
    btn.classList.add('active');
    document.getElementById('mode-label').textContent='CARTE';
    document.getElementById('mode-icon').textContent='🗺️';
    mapW.style.display='none'; globeW.classList.add('show'); zInd.style.display='none';
    if(!globeInited) initGlobe();
    else {
      threeRenderer.setSize(globeW.offsetWidth,globeW.offsetHeight);
      threeCamera.aspect=globeW.offsetWidth/globeW.offsetHeight;
      threeCamera.updateProjectionMatrix();
      updateGlobeISS3D();
    }
  } else {
    btn.classList.remove('active');
    document.getElementById('mode-label').textContent='GLOBE';
    document.getElementById('mode-icon').textContent='🌐';
    globeW.classList.remove('show'); mapW.style.display='block'; zInd.style.display='block';
    if(threeAnim) cancelAnimationFrame(threeAnim); threeAnim=null;
    setTimeout(()=>map.invalidateSize(),100);
  }
});

// ─── HUD TOGGLE ───────────────────────────────────────────────
const hudEl    = document.getElementById('hud');
const hudToggle= document.getElementById('hud-toggle');
const hudArrow = document.getElementById('hud-arrow');
const hudW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hudw')) || 248;

hudToggle.addEventListener('click',()=>{
  hudOpen=!hudOpen;
  if(hudOpen){
    hudEl.classList.remove('collapsed');
    hudToggle.classList.remove('retracted');
    hudArrow.textContent='◀';
  } else {
    hudEl.classList.add('collapsed');
    hudToggle.classList.add('retracted');
    hudArrow.textContent='▶';
  }
});

// ─── MOBILE ───────────────────────────────────────────────────
document.getElementById('mob-hud').addEventListener('click',()=>{
  hudOpen=!hudOpen;
  hudEl.classList.toggle('collapsed',!hudOpen);
  hudToggle.classList.toggle('retracted',!hudOpen);
  hudArrow.textContent=hudOpen?'◀':'▶';
});

// ─── RESIZE ───────────────────────────────────────────────────
window.addEventListener('resize', deb(()=>{
  if(isGlobe&&globeInited) {
    const w=document.getElementById('globe-wrap');
    threeRenderer.setSize(w.offsetWidth,w.offsetHeight);
    threeCamera.aspect=w.offsetWidth/w.offsetHeight;
    threeCamera.updateProjectionMatrix();
    globeLabelData.length=0; // reset labels
  }
},200));

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  startClock();
  setP(8,'Localisation...');
  const pos=await geolocate(); if(pos) userLoc=pos;

  setP(20,'Initialisation de la carte...');
  initMap();

  setP(35,'Données météo...');
  await updateHUD(userLoc.lat,userLoc.lng);

  setP(50,'Marqueurs météo...');
  await refreshWxMarkers();

  setP(63,'ISS...');
  await updateISS();
  setInterval(updateISS,CFG.refreshISS);

  setP(74,'Séismes...');
  await loadEQ();
  setInterval(loadEQ,CFG.refreshEQ);

  setP(88,'Catastrophes...');
  await loadDisasters();

  setP(100,'◈ Système opérationnel');
  setInterval(()=>updateHUD(userLoc.lat,userLoc.lng),CFG.refreshMeteо);

  setTimeout(hideLd,700);
}

main();
