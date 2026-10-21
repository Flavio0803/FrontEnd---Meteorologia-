const GEO_URL = 'https://api.openweathermap.org/geo/1.0/direct';
const WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const DEFAULT_PLACE = { name: 'São Paulo', admin1: 'São Paulo', country: 'Brasil', latitude: -23.5475, longitude: -46.6361 };

const $ = (id) => document.getElementById(id);
const els = {
  form: $('search'), q: $('q'), results: $('results'), status: $('status'),
  now: $('now'), place: $('place'), cond: $('cond'), temp: $('temp'), bigIcon: $('big-icon'),
  feels: $('feels'), humidity: $('humidity'), wind: $('wind'), today: $('today'),
  hourlyBlock: $('hourly-block'), hourly: $('hourly'), dailyBlock: $('daily-block'), daily: $('daily'),
  chartBlock: $('chart-block'), chartTitle: $('chart-title'), chart: $('chart'),
};

// Estado da visualização: dias da previsão, pontos das próximas 24 h e dia selecionado
const view = { days: [], hours24: [], selected: 0 };

let requestId = 0;

/* Chave da API (definida em config.js) */
const apiKey = () => String(window.OWM_API_KEY || '').trim();
const hasKey = () => apiKey() !== '' && !apiKey().startsWith('COLE');

/*
  Condições da OpenWeather (campo weather[0].id) -> tipo de céu usado nas cores e animações.
  https://openweathermap.org/weather-conditions
*/
const HEAVY_IDS = new Set([502, 503, 504, 522, 531, 602, 622]);
const LIGHT_IDS = new Set([300, 301, 310, 311, 500, 520, 600, 620]);

function describe(w) {
  const id = w.id;
  let kind = 'cloud';
  let cover = 'overcast';
  if (id < 300) kind = 'storm';
  else if (id < 600) kind = 'rain';
  else if (id < 700) kind = 'snow';
  else if (id === 771 || id === 781) kind = 'storm';
  else if (id < 800) kind = 'fog';
  else if (id === 800) { kind = 'clear'; cover = 'none'; }
  else if (id === 801) { kind = 'clear'; cover = 'few'; }
  else if (id === 802) cover = 'partial';

  const intensity = id < 300 || HEAVY_IDS.has(id) ? 1 : LIGHT_IDS.has(id) ? 0.35 : 0.65;
  const text = w.description || '';
  return {
    kind, cover, intensity,
    label: text.charAt(0).toUpperCase() + text.slice(1),
    isDay: w.icon ? w.icon.endsWith('d') : true,
  };
}

/* Ícones simples em SVG (traço, herdam a cor do texto) */
const CLOUD = 'M7 19h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 10.5 4.25 4.25 0 0 0 7 19z';
const SHAPES = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  cloud: `<path d="${CLOUD}"/>`,
  rain: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`,
  snow: `<path transform="translate(0 -3)" d="${CLOUD}"/><circle cx="8" cy="19" r=".8" fill="currentColor"/><circle cx="12" cy="21" r=".8" fill="currentColor"/><circle cx="16" cy="19" r=".8" fill="currentColor"/>`,
  storm: `<path transform="translate(0 -3)" d="${CLOUD}"/><path d="M12.5 14.5l-2.5 3.5h3.5l-2.5 3.5"/>`,
  fog: '<path d="M4 8h16M6 12h12M4 16h16M7 20h10"/>',
};
function icon(kind, isDay, label) {
  const shape = kind === 'clear' ? (isDay ? 'sun' : 'moon') : kind;
  return `<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="${label}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${SHAPES[shape]}</svg>`;
}

/* Lugar salvo no navegador */
function loadPlace() {
  try {
    const p = JSON.parse(localStorage.getItem('tempo:place'));
    if (p && typeof p.latitude === 'number' && typeof p.longitude === 'number') return p;
  } catch { /* sem armazenamento disponível */ }
  return DEFAULT_PLACE;
}
function savePlace(place) {
  try { localStorage.setItem('tempo:place', JSON.stringify(place)); } catch { /* ignora */ }
}

/* Rede */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const apiUrl = (base, params) => `${base}?${new URLSearchParams({ ...params, appid: apiKey() })}`;

function errorText(err, fallback) {
  if (err && err.status === 401) return 'A chave da API não foi aceita. Confira o config.js; chaves novas podem levar algum tempo para ativar.';
  if (err && err.status === 429) return 'Limite de consultas atingido. Aguarde um pouco e tente de novo.';
  return fallback;
}

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { /* usa o código */ }
const regionName = (code) => {
  try { return (regionNames && regionNames.of(code)) || code || ''; } catch { return code || ''; }
};

async function searchCities(name) {
  const list = await fetchJSON(apiUrl(GEO_URL, { q: name, limit: '5' }));
  return list.map((p) => ({
    name: (p.local_names && p.local_names.pt) || p.name,
    admin1: p.state || '',
    country: regionName(p.country),
    latitude: p.lat,
    longitude: p.lon,
  }));
}

/* Estado da tela */
function setStatus(text, onRetry) {
  els.status.textContent = text || '';
  els.status.hidden = !text;
  if (text && onRetry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Tentar de novo';
    btn.addEventListener('click', onRetry);
    els.status.append(btn);
  }
}

const MISSING_KEY = 'Falta a chave da API. Abra o arquivo config.js e cole sua chave da OpenWeather.';

async function loadWeather(place) {
  if (!hasKey()) { setStatus(MISSING_KEY); return; }
  const id = ++requestId;
  setStatus('Carregando…');
  const params = { lat: place.latitude, lon: place.longitude, units: 'metric', lang: 'pt_br' };
  try {
    const [current, forecast] = await Promise.all([
      fetchJSON(apiUrl(WEATHER_URL, params)),
      fetchJSON(apiUrl(FORECAST_URL, params)),
    ]);
    if (id !== requestId) return;
    render(place, current, forecast);
    savePlace(place);
    setStatus('');
  } catch (err) {
    if (id !== requestId) return;
    const retry = err && err.status === 401 ? null : () => loadWeather(place);
    setStatus(errorText(err, 'Não foi possível carregar o tempo. Verifique sua conexão.'), retry);
  }
}

/* Datas: a API devolve horários em UTC e o deslocamento do fuso da cidade (em segundos) */
const pad = (n) => String(n).padStart(2, '0');
const localDate = (unix, tz) => new Date((unix + tz) * 1000); // ler com getUTC*()
const dayKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const weekday = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
};

/* Agrupa a previsão de 3 em 3 horas em até 5 dias */
function buildDays(cur, fc, tz, curW) {
  const byDay = new Map();
  for (const e of fc.list) {
    const d = localDate(e.dt, tz);
    const key = dayKey(d);
    const day = byDay.get(key) || { key, min: Infinity, max: -Infinity, pop: 0, noon: null, noonDist: 99, slots: [] };
    day.min = Math.min(day.min, e.main.temp_min);
    day.max = Math.max(day.max, e.main.temp_max);
    day.pop = Math.max(day.pop, Math.round((e.pop || 0) * 100));
    day.slots.push({ label: `${pad(d.getUTCHours())}h`, temp: e.main.temp });
    const dist = Math.abs(d.getUTCHours() - 12);
    if (dist < day.noonDist) { day.noonDist = dist; day.noon = e; }
    byDay.set(key, day);
  }

  // Hoje: a previsão só cobre as horas que faltam, então a temperatura atual entra no intervalo
  const todayKey = dayKey(localDate(cur.dt, tz));
  const today = byDay.get(todayKey) || { key: todayKey, min: Infinity, max: -Infinity, pop: 0, noon: null, slots: [] };
  today.min = Math.min(today.min, cur.main.temp);
  today.max = Math.max(today.max, cur.main.temp);
  byDay.set(todayKey, today);

  return [...byDay.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 5)
    .map((d) => ({ ...d, w: d.key === todayKey ? curW : describe(d.noon.weather[0]) }));
}

/* Renderização */
const placeLabel = (p) => [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : ''].filter(Boolean).join(', ');
const deg = (n) => `${Math.round(n)}°`;

function render(place, cur, fc) {
  const tz = cur.timezone ?? (fc.city && fc.city.timezone) ?? 0;
  const w = describe(cur.weather[0]);
  const temp = cur.main.temp;
  const wind = cur.wind.speed * 3.6; // m/s -> km/h

  document.body.dataset.sky = `${w.kind}-${w.isDay ? 'day' : 'night'}`;
  if (typeof window.setWeatherFx === 'function') {
    window.setWeatherFx({ kind: w.kind, isDay: w.isDay, temp, wind, cover: w.cover, intensity: w.intensity });
  }

  const days = buildDays(cur, fc, tz, w);

  els.place.textContent = place.name === 'Sua localização' && cur.name
    ? `${cur.name} (sua localização)`
    : placeLabel(place);
  els.cond.textContent = w.label;
  els.temp.textContent = Math.round(temp);
  els.bigIcon.innerHTML = icon(w.kind, w.isDay, w.label);
  els.feels.textContent = deg(cur.main.feels_like);
  els.humidity.textContent = `${cur.main.humidity}%`;
  els.wind.textContent = `${Math.round(wind)} km/h`;
  els.today.textContent = `${deg(days[0].min)} a ${deg(days[0].max)}`;

  const hours = buildHours(cur, fc, tz, w);
  view.days = days;
  view.hours24 = hours;
  view.selected = 0;

  renderHourly(hours);
  renderDaily(days);
  renderChart();

  els.now.hidden = false;
  els.hourlyBlock.hidden = false;
  els.dailyBlock.hidden = false;
  els.chartBlock.hidden = false;
}

function buildHours(cur, fc, tz, curW) {
  return [{ label: 'Agora', temp: cur.main.temp, w: curW, pop: 0 }].concat(
    fc.list.slice(0, 8).map((e) => ({
      label: `${pad(localDate(e.dt, tz).getUTCHours())}h`,
      temp: e.main.temp,
      w: describe(e.weather[0]),
      pop: Math.round((e.pop || 0) * 100),
    })),
  );
}

function renderHourly(items) {
  els.hourly.innerHTML = items.map((it) => `<li>
      <span>${it.label}</span>
      ${icon(it.w.kind, it.w.isDay, it.w.label)}
      <span>${deg(it.temp)}</span>
      <span class="pop">${it.pop >= 20 ? `${it.pop}%` : ''}</span>
    </li>`).join('');
}

/* Previsão dos próximos dias em colunas pequenas; clicar em um dia troca o gráfico */
function renderDaily(days) {
  els.daily.innerHTML = days.map((d, i) => `<li>
      <button type="button" data-i="${i}" aria-pressed="${i === view.selected}">
        <span class="d-name">${i === 0 ? 'Hoje' : weekday(d.key)}</span>
        ${icon(d.w.kind, true, d.w.label)}
        <span class="d-max">${deg(d.max)}</span>
        <span class="d-min">${deg(d.min)}</span>
        <span class="d-pop">${d.pop >= 20 ? `${d.pop}%` : ''}</span>
      </button>
    </li>`).join('');
}

const weekdayLong = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
};

/* Gráfico de linha da temperatura: próximas 24 h (Hoje) ou os horários do dia escolhido */
function renderChart() {
  const i = view.selected;
  const pts = i === 0 ? view.hours24 : view.days[i].slots;
  els.chartTitle.textContent = i === 0
    ? 'Temperatura nas próximas 24 horas'
    : `Temperatura de ${weekdayLong(view.days[i].key)}`;
  els.chart.innerHTML = pts.length ? lineChart(pts) : '';
}

function lineChart(pts) {
  const W = 520, H = 220, L = 34, R = 22, T = 34, B = 32;
  const temps = pts.map((p) => p.temp);
  let lo = Math.floor(Math.min(...temps)) - 1;
  let hi = Math.ceil(Math.max(...temps)) + 1;
  if ((hi - lo) % 2) hi += 1; // escala com marcas em números inteiros
  if (hi - lo < 4) hi = lo + 4;
  const mid = (lo + hi) / 2;
  const innerW = W - L - R;
  const x = (i) => L + (pts.length === 1 ? innerW / 2 : (i * innerW) / (pts.length - 1));
  const y = (t) => T + (1 - (t - lo) / (hi - lo)) * (H - T - B);
  const c = pts.map((p, i) => [x(i), y(p.temp)]);
  const f = (n) => n.toFixed(1);

  // Linha suave passando por todos os pontos
  let line = `M${f(c[0][0])},${f(c[0][1])}`;
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[i - 1] || c[i];
    const p1 = c[i];
    const p2 = c[i + 1];
    const p3 = c[i + 2] || c[i + 1];
    line += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)}`
      + ` ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  const base = H - B;
  const area = `${line} L${f(c[c.length - 1][0])},${base} L${f(c[0][0])},${base} Z`;

  const grid = [lo, mid, hi].map((t) => `<line class="chart-grid" x1="${L}" x2="${W - R}" y1="${f(y(t))}" y2="${f(y(t))}"/>`
    + `<text class="chart-axis" x="${L - 8}" y="${f(y(t) + 4)}" text-anchor="end">${t}°</text>`).join('');
  const dots = c.map(([cx, cy], i) => `<circle class="chart-dot" cx="${f(cx)}" cy="${f(cy)}" r="3.5"/>`
    + `<text class="chart-val" x="${f(cx)}" y="${f(cy - 11)}" text-anchor="middle">${deg(pts[i].temp)}</text>`
    + `<text class="chart-axis" x="${f(cx)}" y="${H - 10}" text-anchor="middle">${pts[i].label}</text>`).join('');
  const summary = pts.map((p) => `${p.label} ${deg(p.temp)}`).join(', ');

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de temperatura: ${summary}">`
    + `${grid}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}</svg>`;
}

/* Busca de cidade */
function hideResults() {
  els.results.hidden = true;
  els.results.replaceChildren();
}

function choose(place) {
  hideResults();
  els.q.value = '';
  loadWeather(place);
}

function showResults(places) {
  els.results.replaceChildren(...places.map((p) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const name = document.createElement('strong');
    name.textContent = p.name;
    const where = document.createElement('small');
    where.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
    btn.append(name, where);
    btn.addEventListener('click', () => choose(p));
    li.append(btn);
    return li;
  }));
  els.results.hidden = false;
  setStatus('');
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = els.q.value.trim();
  if (!name) return;
  if (!hasKey()) { setStatus(MISSING_KEY); return; }
  hideResults();
  setStatus('Buscando…');
  try {
    const places = await searchCities(name);
    if (places.length === 0) {
      setStatus(`Nenhuma cidade encontrada para “${name}”. Confira o nome e tente de novo.`);
    } else if (places.length === 1) {
      choose(places[0]);
    } else {
      showResults(places);
    }
  } catch (err) {
    setStatus(errorText(err, 'Não foi possível buscar a cidade. Verifique sua conexão.'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideResults();
});

els.daily.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-i]');
  if (!btn) return;
  view.selected = Number(btn.dataset.i);
  renderDaily(view.days);
  renderChart();
});

loadWeather(loadPlace());
