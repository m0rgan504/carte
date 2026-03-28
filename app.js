/* ══════════════════════════════════════════════════════
   GEOWATCH — app.js  v4
   ══════════════════════════════════════════════════════ */
'use strict';

// ── CONFIG ────────────────────────────────────────────
const CFG={
  defLat:48.8566,defLng:2.3522,defZoom:4,
  refreshWx:60_000,refreshISS:5_000,refreshEQ:300_000,
  issOrbitMin:90,          // minutes d'orbite affichées
  issOrbitSteps:200,       // points de la trajectoire
};

// ── STATE ─────────────────────────────────────────────
let map,leafWx,leafEQ,leafStorm,leafVolcano,leafFlood,leafISSTrack,leafISSOcean;
let threeRenderer,threeScene,threeCamera,threeGlobe,threeAnim;
let globeInited=false,isGlobe=false,hudOpen=true,fcOpen=true;
let zoomLv=CFG.defZoom,curStyle='dark';
let userLoc={lat:CFG.defLat,lng:CFG.defLng};
let issLat=0,issLng=0,issAlt=408,issSpd=27600;
let issMarker2D=null;
let isRefreshing=false;
let eqRaw=[],disRaw=[];
let localTimerInterval=null;
let currentTZ='auto';

// Tuiles carte
const TILES={
  dark:{url:'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',att:'© OpenStreetMap © CARTO',sub:'abcd'},
  satellite:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',att:'© Esri'},
  topo:{url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',att:'© OpenTopoMap',sub:'abc'},
  light:{url:'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',att:'© OpenStreetMap © CARTO',sub:'abcd'},
};

// ── CODES WMO ─────────────────────────────────────────
const WMO={0:{l:'Ciel dégagé',i:'☀️'},1:{l:'Peu nuageux',i:'🌤️'},2:{l:'Partiellement nuageux',i:'⛅'},3:{l:'Couvert',i:'☁️'},
  45:{l:'Brouillard',i:'🌫️'},48:{l:'Brouillard givrant',i:'🌫️'},51:{l:'Bruine légère',i:'🌦️'},53:{l:'Bruine',i:'🌦️'},55:{l:'Bruine dense',i:'🌧️'},
  61:{l:'Pluie légère',i:'🌧️'},63:{l:'Pluie',i:'🌧️'},65:{l:'Pluie forte',i:'🌧️'},71:{l:'Neige légère',i:'🌨️'},73:{l:'Neige',i:'❄️'},
  75:{l:'Neige forte',i:'❄️'},77:{l:'Grésil',i:'🌨️'},80:{l:'Averses',i:'🌦️'},81:{l:'Averses mod.',i:'🌧️'},82:{l:'Averses violentes',i:'⛈️'},
  85:{l:'Averses neige',i:'🌨️'},86:{l:'Averses neige+',i:'❄️'},95:{l:'Orage',i:'⛈️'},96:{l:'Orage+grêle',i:'⛈️'},99:{l:'Orage violent',i:'🌩️'}};
const wmo=c=>WMO[c]||{l:'Inconnu',i:'❓'};
const WDIR=['N','NE','E','SE','S','SO','O','NO'];
const wdir=d=>WDIR[Math.round(d/45)%8];
const DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONS=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const ft=d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
const deb=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}};

// ── LOADING ───────────────────────────────────────────
const setP=(p,m)=>{document.getElementById('loading-bar').style.width=p+'%';document.getElementById('loading-msg').textContent=m;};
const hideLd=()=>{const s=document.getElementById('loading-screen');s.classList.add('gone');setTimeout(()=>s.remove(),900);};

// ── HORLOGE GLOBALE ───────────────────────────────────
function startClock(){
  const tick=()=>{
    const n=new Date();
    document.getElementById('clock-time').textContent=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`;
    document.getElementById('clock-date').textContent=`${DAYS[n.getDay()]} ${String(n.getDate()).padStart(2,'0')} ${MONS[n.getMonth()]} ${n.getFullYear()}`;
  };
  tick();setInterval(tick,1000);
}

// ── HEURE LOCALE D'UN LIEU ───────────────────────────
function startLocalClock(timezone){
  if(localTimerInterval) clearInterval(localTimerInterval);
  currentTZ=timezone||'auto';
  const el=document.getElementById('h-localtime');
  const tick=()=>{
    try{
      const tz=currentTZ==='auto'?Intl.DateTimeFormat().resolvedOptions().timeZone:currentTZ;
      const str=new Date().toLocaleTimeString('fr-FR',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      el.textContent=str;
    }catch{el.textContent=ft(new Date());}
  };
  tick();
  localTimerInterval=setInterval(tick,1000);
}

// ── GÉOLOCALISATION ───────────────────────────────────
const geolocate=()=>new Promise(r=>{
  if(!navigator.geolocation)return r(null);
  navigator.geolocation.getCurrentPosition(p=>r({lat:p.coords.latitude,lng:p.coords.longitude}),()=>r(null),{timeout:5000});
});

// ── CACHE MÉTÉO ───────────────────────────────────────
const wxCache={};const WX_TTL=10*60_000;
async function getWx(lat,lng,days=1){
  const k=`${lat.toFixed(2)},${lng.toFixed(2)}`;
  if(wxCache[k]&&Date.now()-wxCache[k].ts<WX_TTL)return wxCache[k].d;
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    +`&current=temperature_2m,apparent_temperature,weather_code,windspeed_10m,winddirection_10m,uv_index`
    +`&daily=temperature_2m_max,temperature_2m_min,uv_index_max,windspeed_10m_max,winddirection_10m_dominant,weather_code`
    +`&timezone=auto&forecast_days=${days}`;
  const d=await(await fetch(url)).json();
  wxCache[k]={d,ts:Date.now()};return d;
}

// ── CACHE GÉOCODE ─────────────────────────────────────
const gcCache={};
async function revGeo(lat,lng){
  const k=`${lat.toFixed(1)},${lng.toFixed(1)}`;if(gcCache[k])return gcCache[k];
  try{
    const d=await(await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=fr`)).json();
    const a=d.address,n=a.city||a.town||a.village||a.county||a.country||`${lat.toFixed(2)}°,${lng.toFixed(2)}°`;
    return gcCache[k]={name:n,tz:d.timezone||null};
  }catch{return gcCache[k]={name:`${lat.toFixed(2)}°, ${lng.toFixed(2)}°`,tz:null};}
}

// ── HUD MÉTÉO ─────────────────────────────────────────
async function updateHUD(lat,lng){
  try{
    const data=await getWx(lat,lng,7),c=data.current,d=data.daily,info=wmo(c.weather_code);
    document.getElementById('h-temp').textContent=`${Math.round(c.temperature_2m)}°C`;
    document.getElementById('h-feels').textContent=`${Math.round(c.apparent_temperature)}°C`;
    document.getElementById('h-mm').textContent=`${Math.round(d.temperature_2m_min[0])}°/${Math.round(d.temperature_2m_max[0])}°`;
    document.getElementById('h-uv').textContent=(c.uv_index??d.uv_index_max[0]??0).toFixed(1);
    document.getElementById('h-wind').textContent=`${Math.round(c.windspeed_10m)} km/h`;
    document.getElementById('h-wdir').textContent=`${wdir(c.winddirection_10m)} ${Math.round(c.winddirection_10m)}°`;
    document.getElementById('h-wx').textContent=`${info.i} ${info.l}`;
    // Timezone depuis API météo
    const tz=data.timezone||null;
    if(tz) startLocalClock(tz);
    // Soleil avec heure locale
    const now=new Date();
    const sun=SunCalc.getTimes(now,lat,lng);
    const fmtLocal=t=>{
      if(!tz)return ft(t);
      try{return new Date(t).toLocaleTimeString('fr-FR',{timeZone:tz,hour:'2-digit',minute:'2-digit'});}
      catch{return ft(t);}
    };
    document.getElementById('h-rise').textContent=fmtLocal(sun.sunrise);
    document.getElementById('h-set').textContent=fmtLocal(sun.sunset);
    sunArc(sun.sunrise,sun.sunset);
    renderForecast(d);
    revGeo(lat,lng).then(g=>{document.getElementById('hud-loc').textContent=g.name.toUpperCase();});
  }catch(e){console.warn('HUD',e);}
}

// ── ARC SOLEIL ────────────────────────────────────────
function sunArc(rise,set){
  const now=new Date(),t=Math.max(0,Math.min(1,(now-rise)/(set-rise)));
  const bx=(1-t)**2*8+2*(1-t)*t*100+t**2*192;
  const by=(1-t)**2*72+2*(1-t)*t*4+t**2*72;
  const dot=document.getElementById('sun-dot');
  if(dot){dot.setAttribute('cx',bx.toFixed(1));dot.setAttribute('cy',by.toFixed(1));dot.setAttribute('opacity',now>rise&&now<set?'1':'.3');}
}

// ── PRÉVISIONS ────────────────────────────────────────
function renderForecast(d){
  const g=document.getElementById('fc-grid');g.innerHTML='';
  for(let i=0;i<7;i++){
    const dt=new Date(d.time[i]),info=wmo(d.weather_code[i]);
    const el=document.createElement('div');el.className='fc-day';
    el.innerHTML=`<div class="fc-dn">${DAYS[dt.getDay()]}</div><div class="fc-ico">${info.i}</div>`
      +`<div class="fc-hi">${Math.round(d.temperature_2m_max[i])}°</div>`
      +`<div class="fc-lo">${Math.round(d.temperature_2m_min[i])}°</div>`
      +`<div class="fc-w">💨${Math.round(d.windspeed_10m_max[i])}</div>`
      +`<div class="fc-uv">UV${(d.uv_index_max[i]||0).toFixed(1)}</div>`;
    g.appendChild(el);
  }
}

// ── FORECAST TOGGLE ───────────────────────────────────
document.getElementById('fc-toggle').addEventListener('click',()=>{
  fcOpen=!fcOpen;
  document.getElementById('forecast').classList.toggle('collapsed',!fcOpen);
  document.getElementById('fc-toggle').classList.toggle('up',fcOpen);
  document.getElementById('fc-toggle').textContent=fcOpen?'▼':'▲';
});

// ══════════════════════════════════════════════════════
//  CARTE 2D — LEAFLET
// ══════════════════════════════════════════════════════
let tileLayer=null;
function initMap(){
  map=L.map('map',{center:[userLoc.lat,userLoc.lng],zoom:CFG.defZoom,
    maxBounds:[[-90,-180],[90,180]],maxBoundsViscosity:1.0,minZoom:2,worldCopyJump:false,preferCanvas:true});
  tileLayer=L.tileLayer(TILES.dark.url,{attribution:TILES.dark.att,subdomains:TILES.dark.sub||'',maxZoom:19,noWrap:true}).addTo(map);
  leafWx=L.layerGroup().addTo(map);
  leafISSTrack=L.layerGroup().addTo(map);
  map.on('zoomend',()=>{zoomLv=map.getZoom();document.getElementById('zoom-ind').textContent=`ZOOM : ${zoomLv}`;refreshWxMarkers();});
  map.on('moveend',deb(refreshWxMarkers,600));
  map.on('click',e=>{popupWx(e.latlng.lat,e.latlng.lng);updateHUD(e.latlng.lat,e.latlng.lng);});
  map.on('mousemove',deb((e)=>{if(zoomLv>=5)showTip(e.latlng.lat,e.latlng.lng,e.originalEvent);},380));
  map.on('mouseout',()=>{document.getElementById('tip').style.display='none';});
}

// ── CHANGEMENT DE STYLE CARTE ─────────────────────────
document.querySelectorAll('.btn-style').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const style=btn.dataset.style;
    if(style===curStyle)return;
    curStyle=style;
    document.querySelectorAll('.btn-style').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const t=TILES[style];
    if(tileLayer)map.removeLayer(tileLayer);
    tileLayer=L.tileLayer(t.url,{attribution:t.att,subdomains:t.sub||'',maxZoom:19,noWrap:true}).addTo(map);
    tileLayer.bringToBack();
    // Filtre tuile selon le style
    const pane=document.querySelector('.leaflet-tile-pane');
    if(pane){
      if(style==='dark')pane.style.filter='brightness(.88) saturate(.72)';
      else if(style==='satellite')pane.style.filter='brightness(.95) saturate(1)';
      else if(style==='topo')pane.style.filter='brightness(.9) saturate(.9)';
      else pane.style.filter='brightness(1) saturate(.85)';
    }
    // Globe texture si ouvert
    if(isGlobe&&globeInited) updateGlobeStyle(style);
  });
});

// ── TOOLTIP ───────────────────────────────────────────
const tipCache={};
async function showTip(lat,lng,ev){
  const k=`${(lat*4|0)/4},${(lng*4|0)/4}`;
  let d=tipCache[k];
  if(!d){try{d=await(await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,windspeed_10m&timezone=auto`)).json();tipCache[k]=d;}catch{return;}}
  const c=d.current,info=wmo(c.weather_code),tip=document.getElementById('tip');
  tip.innerHTML=`<div class="tip-t">${info.i} ${lat.toFixed(2)}°, ${lng.toFixed(2)}°</div>`
    +`<div class="tip-r"><span>Temp</span><span class="tip-v">${Math.round(c.temperature_2m)}°C</span></div>`
    +`<div class="tip-r"><span>Vent</span><span class="tip-v">${Math.round(c.windspeed_10m)} km/h</span></div>`
    +`<div class="tip-r"><span>Météo</span><span class="tip-v">${info.l}</span></div>`;
  tip.style.display='block';tip.style.left=(ev.clientX+15)+'px';tip.style.top=(ev.clientY-8)+'px';
}

// ── POPUP MÉTÉO AU CLIC ───────────────────────────────
async function popupWx(lat,lng){
  try{
    const data=await getWx(lat,lng,7),c=data.current,d=data.daily,info=wmo(c.weather_code);
    const geo=await revGeo(lat,lng);
    const tz=data.timezone;
    const fmtL=t=>{if(!tz)return ft(t);try{return new Date(t).toLocaleTimeString('fr-FR',{timeZone:tz,hour:'2-digit',minute:'2-digit'});}catch{return ft(t);}};
    const sun=SunCalc.getTimes(new Date(),lat,lng);
    const localNow=tz?new Date().toLocaleTimeString('fr-FR',{timeZone:tz,hour:'2-digit',minute:'2-digit',second:'2-digit'}):ft(new Date());
    L.popup().setLatLng([lat,lng]).setContent(`
      <div class="pt">📍 ${geo.name.toUpperCase()}</div>
      <div class="pr">🕐 Heure locale: <b>${localNow}</b></div>
      <div class="pr">Météo: <b>${info.i} ${info.l}</b></div>
      <div class="pr">Temp: <b>${Math.round(c.temperature_2m)}°C</b> (ressenti ${Math.round(c.apparent_temperature)}°C)</div>
      <div class="pr">Min/Max: <b>${Math.round(d.temperature_2m_min[0])}° / ${Math.round(d.temperature_2m_max[0])}°</b></div>
      <div class="pr">Vent: <b>${Math.round(c.windspeed_10m)} km/h ${wdir(c.winddirection_10m)}</b></div>
      <div class="pr">UV: <b>${(c.uv_index??d.uv_index_max[0]??0).toFixed(1)}</b></div>
      <div class="pr">☀️ Lever: <b>${fmtL(sun.sunrise)}</b> — Coucher: <b>${fmtL(sun.sunset)}</b></div>`).openOn(map);
  }catch(e){console.warn('popup',e);}
}

// ── VILLES & POINTS D'INTÉRÊT ────────────────────────
// p=1 pays/continent p=2 grande ville p=3 ville moyenne p=4 département/district
const CITIES=[
  // Monde — p1
  {n:'Paris',lat:48.85,lng:2.35,p:1},{n:'London',lat:51.51,lng:-.13,p:1},
  {n:'New York',lat:40.71,lng:-74.01,p:1},{n:'Tokyo',lat:35.69,lng:139.69,p:1},
  {n:'Sydney',lat:-33.87,lng:151.21,p:1},{n:'Moscow',lat:55.75,lng:37.62,p:1},
  {n:'Dubai',lat:25.20,lng:55.27,p:1},{n:'São Paulo',lat:-23.55,lng:-46.63,p:1},
  {n:'Cairo',lat:30.04,lng:31.24,p:1},{n:'Beijing',lat:39.91,lng:116.39,p:1},
  {n:'Mumbai',lat:19.08,lng:72.88,p:1},{n:'Lagos',lat:6.52,lng:3.38,p:1},
  // Europe p2
  {n:'Berlin',lat:52.52,lng:13.40,p:2},{n:'Rome',lat:41.90,lng:12.50,p:2},
  {n:'Madrid',lat:40.42,lng:-3.70,p:2},{n:'Amsterdam',lat:52.37,lng:4.90,p:2},
  {n:'Istanbul',lat:41.01,lng:28.95,p:2},{n:'Vienna',lat:48.21,lng:16.37,p:2},
  {n:'Warsaw',lat:52.23,lng:21.01,p:2},{n:'Prague',lat:50.08,lng:14.44,p:2},
  {n:'Brussels',lat:50.85,lng:4.35,p:2},{n:'Stockholm',lat:59.33,lng:18.07,p:2},
  {n:'Oslo',lat:59.91,lng:10.75,p:2},{n:'Helsinki',lat:60.17,lng:24.94,p:2},
  {n:'Copenhagen',lat:55.68,lng:12.57,p:2},{n:'Lisbon',lat:38.72,lng:-9.14,p:2},
  {n:'Athens',lat:37.98,lng:23.73,p:2},{n:'Budapest',lat:47.50,lng:19.04,p:2},
  {n:'Kyiv',lat:50.45,lng:30.52,p:2},{n:'Bucharest',lat:44.43,lng:26.10,p:2},
  {n:'Munich',lat:48.14,lng:11.58,p:2},{n:'Milan',lat:45.46,lng:9.19,p:2},
  {n:'Barcelona',lat:41.39,lng:2.15,p:2},
  // Asie Amériques p2
  {n:'Seoul',lat:37.57,lng:126.98,p:2},{n:'Bangkok',lat:13.75,lng:100.52,p:2},
  {n:'Singapore',lat:1.35,lng:103.82,p:2},{n:'Jakarta',lat:-6.21,lng:106.85,p:2},
  {n:'Tehran',lat:35.69,lng:51.39,p:2},{n:'Toronto',lat:43.65,lng:-79.38,p:2},
  {n:'Chicago',lat:41.88,lng:-87.63,p:2},{n:'Los Angeles',lat:34.05,lng:-118.24,p:2},
  {n:'Mexico City',lat:19.43,lng:-99.13,p:2},{n:'Buenos Aires',lat:-34.60,lng:-58.38,p:2},
  {n:'Nairobi',lat:-1.29,lng:36.82,p:2},{n:'Johannesburg',lat:-26.20,lng:28.04,p:2},
  {n:'Lima',lat:-12.05,lng:-77.04,p:2},{n:'Osaka',lat:34.69,lng:135.50,p:2},
  {n:'Melbourne',lat:-37.81,lng:144.96,p:2},{n:'Manila',lat:14.60,lng:120.98,p:2},
  // Océans p2
  {n:'Atlantique N.',lat:35.0,lng:-40.0,p:2,ocean:true},{n:'Pacifique N.',lat:30.0,lng:-150.0,p:2,ocean:true},
  {n:'Océan Indien',lat:-15.0,lng:70.0,p:2,ocean:true},{n:'Méditerranée',lat:35.0,lng:18.0,p:2,ocean:true},
  {n:'Mer du Nord',lat:56.0,lng:3.0,p:2,ocean:true},{n:'Mer de Chine',lat:15.0,lng:115.0,p:2,ocean:true},
  {n:'Pacifique S.',lat:-20.0,lng:-130.0,p:2,ocean:true},{n:'Atlantique S.',lat:-30.0,lng:-20.0,p:2,ocean:true},
  {n:'Mer des Caraïbes',lat:15.0,lng:-75.0,p:2,ocean:true},{n:'Golfe du Mexique',lat:24.0,lng:-90.0,p:2,ocean:true},
  {n:'Mer Rouge',lat:20.0,lng:38.0,p:2,ocean:true},{n:'Mer Noire',lat:43.0,lng:34.0,p:2,ocean:true},
  // France villes p3
  {n:'Lyon',lat:45.75,lng:4.83,p:3},{n:'Marseille',lat:43.30,lng:5.37,p:3},
  {n:'Bordeaux',lat:44.84,lng:-.58,p:3},{n:'Toulouse',lat:43.60,lng:1.44,p:3},
  {n:'Nice',lat:43.70,lng:7.27,p:3},{n:'Lille',lat:50.63,lng:3.07,p:3},
  {n:'Strasbourg',lat:48.57,lng:7.75,p:3},{n:'Nantes',lat:47.22,lng:-1.55,p:3},
  {n:'Rennes',lat:48.11,lng:-1.68,p:3},{n:'Montpellier',lat:43.61,lng:3.88,p:3},
  {n:'Grenoble',lat:45.19,lng:5.72,p:3},{n:'Dijon',lat:47.32,lng:5.04,p:3},
  {n:'Reims',lat:49.26,lng:4.03,p:3},{n:'Le Havre',lat:49.49,lng:.10,p:3},
  {n:'Saint-Étienne',lat:45.44,lng:4.39,p:3},{n:'Toulon',lat:43.12,lng:5.93,p:3},
  {n:'Angers',lat:47.47,lng:-.55,p:3},{n:'Metz',lat:49.12,lng:6.18,p:3},
  {n:'Clermont-Ferrand',lat:45.78,lng:3.08,p:3},{n:'Nancy',lat:48.69,lng:6.18,p:3},
  // Autres villes monde p3
  {n:'Seattle',lat:47.61,lng:-122.33,p:3},{n:'Miami',lat:25.77,lng:-80.19,p:3},
  {n:'Montreal',lat:45.50,lng:-73.57,p:3},{n:'Santiago',lat:-33.45,lng:-70.67,p:3},
  {n:'Casablanca',lat:33.59,lng:-7.62,p:3},{n:'Auckland',lat:-36.86,lng:174.76,p:3},
  // Départements français p4 (zoom très fort)
  {n:'Pas-de-Calais',lat:50.50,lng:2.50,p:4},{n:'Seine-Maritime',lat:49.60,lng:1.00,p:4},
  {n:'Oise',lat:49.40,lng:2.40,p:4},{n:'Aisne',lat:49.56,lng:3.60,p:4},
  {n:'Moselle',lat:49.10,lng:6.60,p:4},{n:'Bas-Rhin',lat:48.40,lng:7.50,p:4},
  {n:'Haut-Rhin',lat:47.90,lng:7.30,p:4},{n:'Doubs',lat:47.20,lng:6.40,p:4},
  {n:'Rhône',lat:45.80,lng:4.70,p:4},{n:'Loire',lat:45.50,lng:4.20,p:4},
  {n:'Isère',lat:45.30,lng:5.60,p:4},{n:'Savoie',lat:45.50,lng:6.50,p:4},
  {n:'Haute-Savoie',lat:46.00,lng:6.50,p:4},{n:'Drôme',lat:44.70,lng:5.10,p:4},
  {n:'Ardèche',lat:44.80,lng:4.50,p:4},{n:'Gard',lat:43.90,lng:4.20,p:4},
  {n:'Hérault',lat:43.60,lng:3.50,p:4},{n:'Aude',lat:43.10,lng:2.40,p:4},
  {n:'Pyrénées-Orientales',lat:42.60,lng:2.70,p:4},{n:'Ariège',lat:42.90,lng:1.60,p:4},
  {n:'Haute-Garonne',lat:43.30,lng:1.30,p:4},{n:'Gers',lat:43.70,lng:.30,p:4},
  {n:'Lot-et-Garonne',lat:44.30,lng:.60,p:4},{n:'Gironde',lat:44.80,lng:-.70,p:4},
  {n:'Charente',lat:45.70,lng:.40,p:4},{n:'Vienne',lat:46.50,lng:.40,p:4},
  {n:'Maine-et-Loire',lat:47.30,lng:-.60,p:4},{n:'Sarthe',lat:48.00,lng:.10,p:4},
  {n:'Mayenne',lat:48.20,lng:-.60,p:4},{n:'Ille-et-Vilaine',lat:48.10,lng:-1.60,p:4},
  {n:'Côtes-d\'Armor',lat:48.50,lng:-2.80,p:4},{n:'Finistère',lat:48.20,lng:-4.20,p:4},
  {n:'Morbihan',lat:47.80,lng:-2.80,p:4},{n:'Loire-Atlantique',lat:47.40,lng:-1.80,p:4},
  {n:'Vendée',lat:46.70,lng:-1.40,p:4},{n:'Calvados',lat:49.10,lng:-.40,p:4},
  {n:'Manche',lat:49.10,lng:-1.40,p:4},{n:'Eure',lat:49.10,lng:1.20,p:4},
  {n:'Somme',lat:49.90,lng:2.30,p:4},{n:'Nord',lat:50.60,lng:3.20,p:4},
  {n:'Loiret',lat:47.90,lng:2.30,p:4},{n:'Loir-et-Cher',lat:47.60,lng:1.40,p:4},
  {n:'Indre-et-Loire',lat:47.30,lng:.80,p:4},{n:'Indre',lat:46.80,lng:1.60,p:4},
  {n:'Creuse',lat:45.90,lng:2.00,p:4},{n:'Corrèze',lat:45.30,lng:1.90,p:4},
  {n:'Dordogne',lat:45.10,lng:.70,p:4},{n:'Lot',lat:44.60,lng:1.60,p:4},
  {n:'Aveyron',lat:44.30,lng:2.70,p:4},{n:'Lozère',lat:44.50,lng:3.50,p:4},
  {n:'Cantal',lat:45.10,lng:2.70,p:4},{n:'Puy-de-Dôme',lat:45.70,lng:3.10,p:4},
  {n:'Allier',lat:46.30,lng:3.30,p:4},{n:'Haute-Loire',lat:45.20,lng:3.70,p:4},
  {n:'Haute-Vienne',lat:45.80,lng:1.30,p:4},{n:'Deux-Sèvres',lat:46.50,lng:-.30,p:4},
  {n:'Ain',lat:46.00,lng:5.30,p:4},{n:'Haute-Marne',lat:48.10,lng:5.20,p:4},
  {n:'Meuse',lat:49.00,lng:5.30,p:4},{n:'Vosges',lat:48.20,lng:6.50,p:4},
  {n:'Aube',lat:48.30,lng:4.10,p:4},{n:'Marne',lat:48.90,lng:4.40,p:4},
  {n:'Ardennes',lat:49.70,lng:4.70,p:4},{n:'Seine-et-Marne',lat:48.60,lng:2.90,p:4},
  {n:'Yonne',lat:47.80,lng:3.60,p:4},{n:'Côte-d\'Or',lat:47.40,lng:4.80,p:4},
  {n:'Saône-et-Loire',lat:46.60,lng:4.60,p:4},{n:'Jura',lat:46.70,lng:5.60,p:4},
  {n:'Nièvre',lat:47.00,lng:3.50,p:4},{n:'Cher',lat:47.10,lng:2.50,p:4},
];

// ── Données océans avec courants ──────────────────────
const OCEANS=[
  {n:'Atlantique Nord',lat:35,lng:-40,cur:'Courant N. Atlantique →',curSpd:'0.5-1 kn'},
  {n:'Gyre Pacifique N.',lat:30,lng:-150,cur:'Courant N. Pacifique →',curSpd:'0.3-0.8 kn'},
  {n:'Océan Indien',lat:-15,lng:70,cur:'Courant Équatorial ←',curSpd:'0.5-1.2 kn'},
  {n:'Méditerranée',lat:35,lng:18,cur:'Circulation anti-horaire',curSpd:'0.2-0.5 kn'},
  {n:'Mer du Nord',lat:56,lng:3,cur:'Courant Atlantique N. →',curSpd:'0.3-0.7 kn'},
  {n:'Mer de Chine S.',lat:15,lng:115,cur:'Courant de mousson ↕',curSpd:'0.4-1 kn'},
  {n:'Pacifique Sud',lat:-20,lng:-130,cur:'Courant S. Pacifique ←',curSpd:'0.3-0.6 kn'},
  {n:'Atlantique Sud',lat:-30,lng:-20,cur:'Courant Benguela ↑',curSpd:'0.3-0.5 kn'},
  {n:'Mer des Caraïbes',lat:15,lng:-75,cur:'Courant des Caraïbes →',curSpd:'0.5-1.5 kn'},
  {n:'Golfe du Mexique',lat:24,lng:-90,cur:'Gulf Stream ↑',curSpd:'1-3 kn'},
  {n:'Mer Rouge',lat:20,lng:38,cur:'Courant S→N en été',curSpd:'0.3-0.8 kn'},
  {n:'Mer Noire',lat:43,lng:34,cur:'Circulation cyclonique',curSpd:'0.2-0.4 kn'},
  {n:'Arctique',lat:80,lng:0,cur:'Courant Transpolaire',curSpd:'0.1-0.3 kn'},
  {n:'Antarctique',lat:-70,lng:0,cur:'Courant Circumpolaire →',curSpd:'1-2 kn'},
];

// ── MARQUEUR MÉTÉO ────────────────────────────────────
function mkHTML(city,c,daily,zoom){
  const info=wmo(c.weather_code),temp=Math.round(c.temperature_2m);
  const tmin=Math.round(daily.temperature_2m_min[0]),tmax=Math.round(daily.temperature_2m_max[0]);
  const ws=Math.round(c.windspeed_10m),wd=wdir(c.winddirection_10m);
  const uv=(c.uv_index??0).toFixed(1),feels=Math.round(c.apparent_temperature);
  const col=temp<=-5?'#66ccff':temp<=0?'#88ddff':temp>=38?'#ff0055':temp>=30?'#ff2d78':temp>=22?'#ffe600':'#00fff5';
  if(zoom<=4)return`<div class="wm wm1"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°</span><span class="wn">${city.n}</span></div>`;
  if(zoom<=6)return`<div class="wm wm2"><div class="wrt"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°C</span></div><div class="wn">${city.n}</div><div class="ws">💨${ws}km/h ${wd}</div></div>`;
  if(zoom<=8)return`<div class="wm wm3"><div class="wrt"><span class="wi">${info.i}</span><span class="wt" style="color:${col}">${temp}°C</span></div><div class="wn">${city.n}</div><div class="ws"><span>↓${tmin}° ↑${tmax}°</span><span>💨${ws}km/h</span></div></div>`;
  return`<div class="wm wm4"><div class="whead"><span class="wi">${info.i}</span><div><div class="wcn">${city.n}</div><div class="wdc">${info.l}</div></div></div><div class="wdiv"></div><div class="wg"><div class="wc"><span class="wl">TEMP</span><span class="wv" style="color:${col}">${temp}°C</span></div><div class="wc"><span class="wl">RESSENTI</span><span class="wv">${feels}°C</span></div><div class="wc"><span class="wl">MIN/MAX</span><span class="wv">${tmin}°/${tmax}°</span></div><div class="wc"><span class="wl">UV</span><span class="wv" style="color:#ff6b00">${uv}</span></div><div class="wc"><span class="wl">VENT</span><span class="wv">${ws}km/h</span></div><div class="wc"><span class="wl">DIR.</span><span class="wv">${wd} ${Math.round(c.winddirection_10m)}°</span></div></div></div>`;
}

// ── MARQUEUR OCÉAN ────────────────────────────────────
function mkOceanHTML(ocean,c,zoom){
  const temp=Math.round(c.temperature_2m); // temp air approx (marine API plus complète nécessiterait clé)
  const ws=Math.round(c.windspeed_10m);
  if(zoom<=5)return`<div class="wm-ocean" style="padding:2px 6px"><span>🌊 ${ocean.n}</span><span style="margin-left:6px;color:#ffe600;font-size:10px">${temp}°</span></div>`;
  return`<div class="wm-ocean"><div style="font-family:'Orbitron',sans-serif;font-size:9px;color:#00ccff;margin-bottom:3px">🌊 ${ocean.n}</div>`
    +`<div class="wot">Temp air: <b style="color:#ffe600">${temp}°C</b></div>`
    +`<div class="wot">Vent: <b style="color:#00fff5">${ws} km/h</b></div>`
    +`<div class="wot" style="color:#00ccff">${ocean.cur}</div>`
    +`<div class="wot" style="color:rgba(0,204,255,.6)">${ocean.curSpd}</div></div>`;
}

async function refreshWxMarkers(){
  if(isRefreshing||!map)return;
  isRefreshing=true;leafWx.clearLayers();
  const bounds=map.getBounds(),zoom=map.getZoom();
  // Villes selon zoom
  let cities=CITIES.filter(c=>{
    if(c.ocean)return false;
    if(zoom<=4)return c.p===1;
    if(zoom<=6)return c.p<=2&&bounds.contains([c.lat,c.lng]);
    if(zoom<=8)return c.p<=3&&bounds.contains([c.lat,c.lng]);
    return c.p<=4&&bounds.contains([c.lat,c.lng]);
  }).slice(0,zoom<=4?12:zoom<=6?40:zoom<=8?60:100);

  for(let i=0;i<cities.length;i+=5){
    await Promise.all(cities.slice(i,i+5).map(async city=>{
      try{
        const data=await getWx(city.lat,city.lng);
        const html=mkHTML(city,data.current,data.daily,zoom);
        const icon=L.divIcon({className:'wm-wrap',html,iconAnchor:[0,0]});
        const m=L.marker([city.lat,city.lng],{icon,zIndexOffset:100});
        m.on('click',()=>{popupWx(city.lat,city.lng);updateHUD(city.lat,city.lng);});
        leafWx.addLayer(m);
      }catch{}
    }));
  }

  // Océans — affichés à partir du zoom 3
  if(zoom>=3){
    const oceans=OCEANS.filter(o=>zoom<=5?bounds.contains([o.lat,o.lng]):bounds.contains([o.lat,o.lng]));
    for(let i=0;i<oceans.length;i+=3){
      await Promise.all(oceans.slice(i,i+3).map(async ocean=>{
        try{
          const data=await getWx(ocean.lat,ocean.lng);
          const html=mkOceanHTML(ocean,data.current,zoom);
          const icon=L.divIcon({className:'wm-wrap',html,iconAnchor:[0,0]});
          const m=L.marker([ocean.lat,ocean.lng],{icon,zIndexOffset:50});
          m.on('click',()=>{
            L.popup().setLatLng([ocean.lat,ocean.lng]).setContent(`
              <div class="pt">🌊 ${ocean.n.toUpperCase()}</div>
              <div class="pr">Courant: <b>${ocean.cur}</b></div>
              <div class="pr">Vitesse courant: <b>${ocean.curSpd}</b></div>
              <div class="pr">Vent: <b>${Math.round(data.current.windspeed_10m)} km/h ${wdir(data.current.winddirection_10m)}</b></div>
              <div class="pr">Temp air: <b>${Math.round(data.current.temperature_2m)}°C</b></div>`).openOn(map);
          });
          leafWx.addLayer(m);
        }catch{}
      }));
    }
  }
  isRefreshing=false;
}

// ══════════════════════════════════════════════════════
//  ISS — SATELLITE + TRAJECTOIRE
// ══════════════════════════════════════════════════════
const SAT_SVG=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" width="42" height="42">
<defs><filter id="sf"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<radialGradient id="bg2" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#1a4a6a"/><stop offset="100%" stop-color="#0a1e30"/></radialGradient></defs>
<rect x="1" y="21" width="16" height="10" rx="1.5" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.2"/>
<line x1="5" y1="21" x2="5" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="9" y1="21" x2="9" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="13" y1="21" x2="13" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<rect x="17" y="24.5" width="5" height="3" fill="#00fff5" opacity=".7"/>
<rect x="21" y="19" width="10" height="14" rx="2" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.6" filter="url(#sf)"/>
<rect x="30" y="24.5" width="5" height="3" fill="#00fff5" opacity=".7"/>
<rect x="35" y="21" width="16" height="10" rx="1.5" fill="url(#bg2)" stroke="#00fff5" stroke-width="1.2"/>
<line x1="39" y1="21" x2="39" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="43" y1="21" x2="43" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="47" y1="21" x2="47" y2="31" stroke="#00fff5" stroke-width=".6" opacity=".5"/>
<line x1="26" y1="19" x2="26" y2="10" stroke="#00fff5" stroke-width="1.1" opacity=".85"/>
<ellipse cx="26" cy="8.5" rx="2.5" ry="1.5" fill="none" stroke="#ffe600" stroke-width="1" opacity=".85"/>
<circle cx="26" cy="26" r="3.5" fill="#00fff5" opacity=".9" filter="url(#sf)"/>
<circle cx="26" cy="26" r="7" fill="none" stroke="#00fff5" stroke-width=".8" opacity=".3"/>
</svg>`;

function mkISS2DIcon(){return L.divIcon({className:'',iconSize:[42,42],iconAnchor:[21,21],html:`<div style="filter:drop-shadow(0 0 8px #00fff5)">${SAT_SVG}</div>`});}

// Calcul trajectoire ISS (propagateur simplifié basé sur position + vitesse orbitale)
function computeISSOrbit(lat, lng, minutesBack, minutesForward, steps){
  // Vitesse angulaire ISS : ~360°/92min = ~3.913°/min en longitude (dérive Est)
  // Inclinaison : 51.6°
  const ORBIT_MIN=92; // période orbitale ISS
  const degPerMin=360/ORBIT_MIN;
  const inc=51.6*Math.PI/180;
  const past=[], future=[];

  for(let i=-minutesBack;i<=minutesForward;i+=(minutesBack+minutesForward)/steps){
    // Approximation simplifiée : décalage linéaire en longitude
    const dLng=(i*degPerMin);
    let pLng=((lng+dLng+180)%360)-180;
    // Variation latitude sinusoïdale selon l'inclinaison
    const phase=(i/ORBIT_MIN)*2*Math.PI;
    const pLat=Math.max(-90,Math.min(90,51.6*Math.sin(phase+Math.asin(lat/51.6))));
    const pt={lat:pLat,lng:pLng};
    if(i<0)past.push(pt);else future.push(pt);
  }
  return{past,future};
}

let issTrackPolylines=[];
function drawISSTrajectory(lat, lng){
  issTrackPolylines.forEach(p=>leafISSTrack.removeLayer(p));issTrackPolylines=[];
  const {past,future}=computeISSOrbit(lat,lng,45,45,180); // 45 min passé + 45 futur
  // Tracé passé (cyan pointillé)
  if(past.length>1){
    const p=L.polyline(past.map(p=>[p.lat,p.lng]),{color:'#00fff5',weight:2,dashArray:'6,5',opacity:.5}).addTo(leafISSTrack);
    issTrackPolylines.push(p);
  }
  // Tracé futur (vert pointillé)
  if(future.length>1){
    const p=L.polyline(future.map(p=>[p.lat,p.lng]),{color:'#00ff9f',weight:2,dashArray:'4,7',opacity:.7}).addTo(leafISSTrack);
    issTrackPolylines.push(p);
  }
}

async function updateISS(){
  try{
    const res=await fetch('https://api.wheretheiss.at/v1/satellites/25544');
    const d=await res.json();
    issLat=d.latitude;issLng=d.longitude;issAlt=Math.round(d.altitude);issSpd=Math.round(d.velocity);
    // ISS HUD update
    document.getElementById('iss-lat').textContent=`${issLat.toFixed(2)}°`;
    document.getElementById('iss-lng').textContent=`${issLng.toFixed(2)}°`;
    document.getElementById('iss-alt').textContent=`${issAlt} km`;
    document.getElementById('iss-spd').textContent=`${issSpd} km/h`;
    const pop=`<div class="pt">🛸 ISS — STATION SPATIALE</div>
      <div class="pr">Latitude: <b>${issLat.toFixed(4)}°</b></div>
      <div class="pr">Longitude: <b>${issLng.toFixed(4)}°</b></div>
      <div class="pr">Altitude: <b>${issAlt} km</b></div>
      <div class="pr">Vitesse: <b>${issSpd} km/h</b></div>
      <div class="pr">Temp. extérieure: <b>−120°C à +120°C</b></div>
      <div class="pr">Période orbitale: <b>~92 min</b></div>
      <div class="pr">Inclinaison: <b>51.6°</b></div>`;
    if(!issMarker2D){issMarker2D=L.marker([issLat,issLng],{icon:mkISS2DIcon(),zIndexOffset:3000}).addTo(map);issMarker2D.bindPopup(pop);}
    else{issMarker2D.setLatLng([issLat,issLng]);issMarker2D.setPopupContent(pop);}
    drawISSTrajectory(issLat,issLng);
    if(globeInited)updateGlobeISS3D();
  }catch(e){console.warn('ISS',e);}
}

// ── SÉISMES ───────────────────────────────────────────
async function loadEQ(){
  if(leafEQ)map.removeLayer(leafEQ);leafEQ=L.layerGroup();eqRaw=[];
  try{
    const data=await(await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson')).json();
    data.features.forEach(f=>{
      const[lng,lat,depth]=f.geometry.coordinates,mag=f.properties.mag;
      const place=f.properties.place,time=new Date(f.properties.time).toLocaleString('fr-FR');
      eqRaw.push({lat,lng,mag,place,depth,time});
      let color,r;if(mag>=6){color='#ff2d78';r=18;}else if(mag>=4){color='#ff6b00';r=12;}else{color='#ffe600';r=7;}
      const c=L.circleMarker([lat,lng],{radius:r,fillColor:color,color:'rgba(255,255,255,.3)',weight:1,fillOpacity:.78});
      c.bindPopup(`<div class="pt">🔴 SÉISME — M${mag.toFixed(1)}</div><div class="pr">Lieu: <b>${place}</b></div><div class="pr">Magnitude: <b>${mag.toFixed(1)}</b></div><div class="pr">Profondeur: <b>${depth.toFixed(0)} km</b></div><div class="pr">Zone: <b>${depth>60?'🌊 Maritime':'🏔️ Terrestre'}</b></div><div class="pr">Date: <b>${time}</b></div>`);
      leafEQ.addLayer(c);
    });
  }catch(e){console.warn('EQ',e);}
  leafEQ.addTo(map);if(globeInited)updateGlobeEQ();
}

// ── CATASTROPHES ──────────────────────────────────────
function mkDisIcon(col,em,nm){return L.divIcon({className:'',iconAnchor:[0,0],html:`<div style="background:rgba(2,10,24,.92);border:1px solid ${col};box-shadow:0 0 9px ${col};padding:2px 7px;white-space:nowrap;font-family:'Share Tech Mono',monospace;font-size:10.5px;color:${col};cursor:pointer">${em} <span style="font-size:8.5px;color:rgba(200,230,240,.65)">${nm.length>22?nm.slice(0,20)+'…':nm}</span></div>`});}

async function loadDisasters(){
  [leafStorm,leafVolcano,leafFlood].forEach(l=>l&&map.removeLayer(l));
  leafStorm=L.layerGroup();leafVolcano=L.layerGroup();leafFlood=L.layerGroup();disRaw=[];
  const addV=v=>{const m=L.marker([v.lat,v.lng],{icon:mkDisIcon('#ff4400','🌋',v.name)});m.bindPopup(`<div class="pt">🌋 ${v.name.toUpperCase()}</div><div class="pr">Volcan actif</div>`);leafVolcano.addLayer(m);};
  try{
    const url='https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS?limit=50&alertlevel=Red,Orange&eventtype=TC,FL,VO';
    const w=await(await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`)).json();
    const data=JSON.parse(w.contents);
    if(data?.features)data.features.forEach(f=>{
      const p=f.properties,coord=f.geometry?.coordinates;if(!coord)return;
      const[lng,lat]=coord,type=p.eventtype,name=p.name||type;
      let em,col,layer;
      if(type==='TC'){em='🌀';col='#b266ff';layer=leafStorm;}
      else if(type==='VO'){em='🌋';col='#ff4400';layer=leafVolcano;}
      else if(type==='FL'){em='🌊';col='#0088ff';layer=leafFlood;}
      else return;
      const m=L.marker([lat,lng],{icon:mkDisIcon(col,em,name)});
      m.bindPopup(`<div class="pt">${em} ${name.toUpperCase()}</div><div class="pr">Alerte: <b style="color:${p.alertlevel==='Red'?'#ff2d78':'#ff6b00'}">${p.alertlevel}</b></div>`);
      layer.addLayer(m);
    });
  }catch{
    [{lat:19.42,lng:-155.29,name:'Kīlauea'},{lat:37.75,lng:15.00,name:'Etna'},{lat:-8.34,lng:115.51,name:'Agung'},{lat:14.38,lng:120.46,name:'Taal'},{lat:-0.68,lng:29.25,name:'Nyiragongo'},{lat:64.63,lng:-17.52,name:'Hekla'},{lat:-39.42,lng:-71.95,name:'Villarrica'}].forEach(addV);
  }
  [leafStorm,leafVolcano,leafFlood].forEach(l=>l.addTo(map));
}

// ══════════════════════════════════════════════════════
//  GLOBE 3D — THREE.JS
// ══════════════════════════════════════════════════════
const GR=200;
const l2v=(lat,lng,r)=>{const phi=(90-lat)*Math.PI/180,th=(lng+180)*Math.PI/180;return new THREE.Vector3(-r*Math.sin(phi)*Math.cos(th),r*Math.cos(phi),r*Math.sin(phi)*Math.sin(th));};

const GLOBE_TEXTURES={
  dark:'https://unpkg.com/three-globe/example/img/earth-dark.jpg',
  satellite:'https://unpkg.com/three-globe/example/img/earth-day.jpg',
  topo:'https://unpkg.com/three-globe/example/img/earth-topology.png',
  light:'https://unpkg.com/three-globe/example/img/earth-day.jpg',
};

let globePoints=[],globeLabelData=[],issGlobeMesh=null;
let orbit={isDown:false,prevX:0,prevY:0,rotX:.3,rotY:0,zoom:600};

function initGlobe(){
  const wrap=document.getElementById('globe-wrap');
  const W=wrap.offsetWidth,H=wrap.offsetHeight;
  threeRenderer=new THREE.WebGLRenderer({canvas:document.getElementById('globe-canvas'),antialias:true,alpha:true});
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  threeRenderer.setSize(W,H);threeRenderer.setClearColor(0,0);
  threeScene=new THREE.Scene();
  threeCamera=new THREE.PerspectiveCamera(45,W/H,1,5000);threeCamera.position.set(0,0,600);
  // Lumières
  threeScene.add(new THREE.AmbientLight(0x112233,3));
  const sun=new THREE.DirectionalLight(0x88ccff,2.5);sun.position.set(500,300,300);threeScene.add(sun);
  threeScene.add(Object.assign(new THREE.DirectionalLight(0x00fff5,.4),{position:new THREE.Vector3(-300,-200,-300)}));
  // Étoiles
  const sg=new THREE.BufferGeometry(),sp=[];
  for(let i=0;i<8000;i++){const r=2000,phi=Math.random()*Math.PI*2,th=Math.acos(2*Math.random()-1);sp.push(r*Math.sin(th)*Math.cos(phi),r*Math.cos(th),r*Math.sin(th)*Math.sin(phi));}
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
  threeScene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:1.2,sizeAttenuation:true})));
  // Globe
  const gGeo=new THREE.SphereGeometry(GR,64,64),loader=new THREE.TextureLoader();
  const earthTex=loader.load(GLOBE_TEXTURES[curStyle]||GLOBE_TEXTURES.dark);
  const bumpTex=loader.load('https://unpkg.com/three-globe/example/img/earth-topology.png');
  threeGlobe=new THREE.Mesh(gGeo,new THREE.MeshPhongMaterial({map:earthTex,bumpMap:bumpTex,bumpScale:4,specular:new THREE.Color(0x00fff5),shininess:12}));
  threeScene.add(threeGlobe);
  // Atmosphère shader
  const atmMat=new THREE.ShaderMaterial({
    uniforms:{c:{value:.28},p:{value:5.5},glowColor:{value:new THREE.Color(0x00fff5)},viewVector:{value:threeCamera.position}},
    vertexShader:`uniform vec3 viewVector;uniform float c,p;varying float intensity;void main(){vec3 vN=normalize(normalMatrix*normal);vec3 vV=normalize(normalMatrix*viewVector);intensity=pow(c-dot(vN,vV),p);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 glowColor;varying float intensity;void main(){gl_FragColor=vec4(glowColor*intensity,intensity*.6);}`,
    side:THREE.FrontSide,blending:THREE.AdditiveBlending,transparent:true
  });
  threeScene.add(new THREE.Mesh(new THREE.SphereGeometry(GR*1.055,64,64),atmMat));
  // Grille
  const gm=new THREE.LineBasicMaterial({color:0x00fff5,transparent:true,opacity:.06});
  for(let lng=-180;lng<=180;lng+=30){const pts=[];for(let la=-90;la<=90;la+=2)pts.push(l2v(la,lng,GR+.5));threeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gm));}
  for(let la=-75;la<=75;la+=30){const pts=[];for(let ln=-180;ln<=180;ln+=2)pts.push(l2v(la,ln,GR+.5));threeScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),gm));}
  // Orbite ISS sur le globe (anneau incliné)
  const orbitPts=[];
  for(let t=0;t<360;t+=2){
    const lng2=t,lat2=51.6*Math.sin(t*Math.PI/180);
    orbitPts.push(l2v(lat2,lng2,GR+14));
  }
  const orbitGeo=new THREE.BufferGeometry().setFromPoints(orbitPts);
  threeScene.add(new THREE.Line(orbitGeo,new THREE.LineBasicMaterial({color:0x00ff9f,transparent:true,opacity:.35})));
  // Contrôles
  setupOrbit();updateGlobeEQ();updateGlobeCities();updateGlobeISS3D();updateGlobeOceans();
  // Rendu
  const clock=new THREE.Clock();
  function animate(){threeAnim=requestAnimationFrame(animate);threeGlobe.rotation.y+=.0008;threeRenderer.render(threeScene,threeCamera);updateGlobeLabels();}
  animate();globeInited=true;
}

function setupOrbit(){
  const c=document.getElementById('globe-canvas');
  c.addEventListener('mousedown',e=>{orbit.isDown=true;orbit.prevX=e.clientX;orbit.prevY=e.clientY;});
  window.addEventListener('mouseup',()=>orbit.isDown=false);
  window.addEventListener('mousemove',e=>{if(!orbit.isDown||!isGlobe)return;const dx=e.clientX-orbit.prevX,dy=e.clientY-orbit.prevY;orbit.rotY+=dx*.005;orbit.rotX+=dy*.005;orbit.rotX=Math.max(-1.4,Math.min(1.4,orbit.rotX));orbit.prevX=e.clientX;orbit.prevY=e.clientY;threeGlobe.rotation.x=orbit.rotX;threeGlobe.rotation.y=orbit.rotY;});
  c.addEventListener('wheel',e=>{e.preventDefault();orbit.zoom=Math.max(250,Math.min(900,orbit.zoom+e.deltaY*.6));threeCamera.position.z=orbit.zoom;},{passive:false});
  let t0=null;
  c.addEventListener('touchstart',e=>{if(e.touches.length===1){orbit.isDown=true;t0=e.touches[0];orbit.prevX=t0.clientX;orbit.prevY=t0.clientY;}});
  c.addEventListener('touchend',()=>orbit.isDown=false);
  c.addEventListener('touchmove',e=>{if(!orbit.isDown||!isGlobe)return;e.preventDefault();const t=e.touches[0],dx=t.clientX-orbit.prevX,dy=t.clientY-orbit.prevY;orbit.rotY+=dx*.005;orbit.rotX+=dy*.005;orbit.rotX=Math.max(-1.4,Math.min(1.4,orbit.rotX));orbit.prevX=t.clientX;orbit.prevY=t.clientY;threeGlobe.rotation.x=orbit.rotX;threeGlobe.rotation.y=orbit.rotY;},{passive:false});
}

function addGPt(lat,lng,col,sz=4){
  const v=l2v(lat,lng,GR+1.5),geo=new THREE.SphereGeometry(sz,8,8),mat=new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.9});
  const m=new THREE.Mesh(geo,mat);m.position.copy(v);threeScene.add(m);globePoints.push(m);
  const h=new THREE.Mesh(new THREE.SphereGeometry(sz*1.9,8,8),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.22,side:THREE.BackSide}));
  h.position.copy(v);threeScene.add(h);globePoints.push(h);
}
function clearGPts(){globePoints.forEach(m=>{threeScene.remove(m);m.geometry.dispose();m.material.dispose();});globePoints=[];}

function updateGlobeEQ(){if(!globeInited)return;eqRaw.forEach(e=>{const col=e.mag>=6?0xff2d78:e.mag>=4?0xff6b00:0xffe600;addGPt(e.lat,e.lng,col,e.mag>=6?6:e.mag>=4?4:2.5);});}
function updateGlobeCities(){CITIES.filter(c=>c.p===1&&!c.ocean).forEach(c=>addGPt(c.lat,c.lng,0x00fff5,2.2));}
function updateGlobeOceans(){OCEANS.slice(0,8).forEach(o=>addGPt(o.lat,o.lng,0x0088ff,2));}
function updateGlobeStyle(style){if(!globeInited)return;const t=new THREE.TextureLoader().load(GLOBE_TEXTURES[style]||GLOBE_TEXTURES.dark);threeGlobe.material.map=t;threeGlobe.material.needsUpdate=true;}

function updateGlobeISS3D(){
  if(!globeInited)return;
  if(issGlobeMesh){threeScene.remove(issGlobeMesh);issGlobeMesh.geometry.dispose();issGlobeMesh.material.dispose();}
  const v=l2v(issLat,issLng,GR+14);
  issGlobeMesh=new THREE.Mesh(new THREE.BoxGeometry(6,2,10),new THREE.MeshBasicMaterial({color:0x00ff9f}));
  issGlobeMesh.position.copy(v);issGlobeMesh.lookAt(new THREE.Vector3(0,0,0));threeScene.add(issGlobeMesh);
}

function updateGlobeLabels(){
  if(!globeInited||!isGlobe)return;
  const container=document.getElementById('globe-labels');
  const W=threeRenderer.domElement.width/window.devicePixelRatio;
  const H=threeRenderer.domElement.height/window.devicePixelRatio;
  if(!globeLabelData.length){
    CITIES.filter(c=>c.p===1&&!c.ocean).forEach(c=>globeLabelData.push({lat:c.lat,lng:c.lng,text:c.n,cls:''}));
    OCEANS.slice(0,6).forEach(o=>globeLabelData.push({lat:o.lat,lng:o.lng,text:'🌊 '+o.n,cls:'ocean'}));
    eqRaw.filter(e=>e.mag>=6).slice(0,8).forEach(e=>globeLabelData.push({lat:e.lat,lng:e.lng,text:`M${e.mag.toFixed(1)}`,cls:'eq'}));
    globeLabelData.push({lat:issLat,lng:issLng,text:'🛸 ISS',cls:'iss',isISS:true});
  }else{const il=globeLabelData.find(l=>l.isISS);if(il){il.lat=issLat;il.lng=issLng;}}
  container.innerHTML='';
  const rot=threeGlobe.rotation,cosX=Math.cos(rot.x),sinX=Math.sin(rot.x),cosY=Math.cos(rot.y),sinY=Math.sin(rot.y);
  globeLabelData.forEach(item=>{
    const v=l2v(item.lat,item.lng,GR+3);
    const x1=v.x*cosY+v.z*sinY,y1=v.y,z1=-v.x*sinY+v.z*cosY,y2=y1*cosX-z1*sinX,z2=y1*sinX+z1*cosX;
    if(z2<0)return;
    const proj=new THREE.Vector3(x1,y2,z2).project(threeCamera);
    const px=(proj.x*.5+.5)*W,py=(-.5*proj.y+.5)*H;
    const el=document.createElement('div');el.className='glabel'+(item.cls?' '+item.cls:'');el.textContent=item.text;
    el.style.left=px+'px';el.style.top=py+'px';container.appendChild(el);
  });
}

// ── TOGGLE GLOBE/CARTE ────────────────────────────────
document.getElementById('btn-toggle-view').addEventListener('click',()=>{
  isGlobe=!isGlobe;
  const btn=document.getElementById('btn-toggle-view');
  const mapW=document.getElementById('map-wrap'),globeW=document.getElementById('globe-wrap');
  if(isGlobe){
    btn.classList.add('active');document.getElementById('mode-label').textContent='CARTE';document.getElementById('mode-icon').textContent='🗺️';
    mapW.style.display='none';globeW.classList.add('show');document.getElementById('zoom-ind').style.display='none';
    if(!globeInited)initGlobe();
    else{threeRenderer.setSize(globeW.offsetWidth,globeW.offsetHeight);threeCamera.aspect=globeW.offsetWidth/globeW.offsetHeight;threeCamera.updateProjectionMatrix();updateGlobeISS3D();}
  }else{
    btn.classList.remove('active');document.getElementById('mode-label').textContent='GLOBE';document.getElementById('mode-icon').textContent='🌐';
    globeW.classList.remove('show');mapW.style.display='block';document.getElementById('zoom-ind').style.display='block';
    if(threeAnim){cancelAnimationFrame(threeAnim);threeAnim=null;}
    setTimeout(()=>map.invalidateSize(),100);
  }
});

// ── HUD TOGGLE ────────────────────────────────────────
const hudEl=document.getElementById('hud'),hudToggle=document.getElementById('hud-toggle'),hudArrow=document.getElementById('hud-arrow');
hudToggle.addEventListener('click',()=>{hudOpen=!hudOpen;hudEl.classList.toggle('collapsed',!hudOpen);hudToggle.classList.toggle('retracted',!hudOpen);hudArrow.textContent=hudOpen?'◀':'▶';});
document.getElementById('mob-hud').addEventListener('click',()=>{hudOpen=!hudOpen;hudEl.classList.toggle('collapsed',!hudOpen);hudToggle.classList.toggle('retracted',!hudOpen);hudArrow.textContent=hudOpen?'◀':'▶';});

// ── RESIZE ────────────────────────────────────────────
window.addEventListener('resize',deb(()=>{
  if(isGlobe&&globeInited){const w=document.getElementById('globe-wrap');threeRenderer.setSize(w.offsetWidth,w.offsetHeight);threeCamera.aspect=w.offsetWidth/w.offsetHeight;threeCamera.updateProjectionMatrix();globeLabelData.length=0;}
},200));

// ══════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════
async function main(){
  startClock();startLocalClock(null);
  setP(8,'Localisation...');
  const pos=await geolocate();if(pos)userLoc=pos;
  setP(20,'Carte...');initMap();
  setP(35,'Météo...');await updateHUD(userLoc.lat,userLoc.lng);
  setP(50,'Marqueurs...');await refreshWxMarkers();
  setP(63,'ISS...');await updateISS();setInterval(updateISS,CFG.refreshISS);
  setP(74,'Séismes...');await loadEQ();setInterval(loadEQ,CFG.refreshEQ);
  setP(88,'Catastrophes...');await loadDisasters();
  setP(100,'◈ Système opérationnel');
  setInterval(()=>updateHUD(userLoc.lat,userLoc.lng),CFG.refreshWx);
  setTimeout(hideLd,700);
}
main();
