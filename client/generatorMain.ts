/**
 * Generator lab — stage 0 size, manual stage advance, preview after each stage.
 */

import {
  DEFAULT_PROCEDURAL_PARAMS,
  ELEVATION_COLOR_KEY,
  ELEVATION_GRAY_KEY,
  OROGENY_LINE_COLORS,
  PRECIPITATION_COLOR_KEY,
  TEMPERATURE_COLOR_KEY,
  cloneParams,
  createContext,
  defaultBufferForStage,
  drawVectorOverlay,
  drawCordilleraOverlay,
  listBuffers,
  listStages,
  renderBufferPreview,
  renderOrogenyPreview,
  type ProceduralContext,
  type ProceduralParams,
  type StageProgress,
} from '../shared/maps/procedural/index.js';

const stepLabel = document.getElementById('gen-step-label')!;
const setupEl = document.getElementById('gen-setup')!;
const sizeSelect = document.getElementById('gen-size') as HTMLSelectElement;
const seedInput = document.getElementById('gen-seed') as HTMLInputElement;
const seedVal = document.getElementById('gen-seed-val')!;
const paramsEl = document.getElementById('gen-params')!;
const bufferSelect = document.getElementById('gen-buffer') as HTMLSelectElement;
const statusEl = document.getElementById('gen-status')!;
const logEl = document.getElementById('gen-log')!;
const canvas = document.getElementById('gen-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('gen-overlay') as HTMLCanvasElement;
const viewport = document.getElementById('gen-viewport')!;
const canvasWrap = document.getElementById('gen-canvas-wrap')!;
const btnNext = document.getElementById('gen-next') as HTMLButtonElement;
const btnBack = document.getElementById('gen-back') as HTMLButtonElement;
const btnRest = document.getElementById('gen-rest') as HTMLButtonElement;
const btnReset = document.getElementById('gen-reset') as HTMLButtonElement;
const btnApply = document.getElementById('gen-apply') as HTMLButtonElement;
const legendEl = document.getElementById('gen-legend')!;

const ctx2d = canvas.getContext('2d', { willReadFrequently: true })!;
const overlay2d = overlay.getContext('2d')!;

let params = cloneParams(DEFAULT_PROCEDURAL_PARAMS);
{
  const initialSeed = (Math.random() * 0xffffffff) >>> 0;
  params.seed = initialSeed;
  seedInput.value = String(initialSeed);
  seedVal.textContent = String(initialSeed);
}
let proc: ProceduralContext | null = null;
/** -1 = still on size setup (etapa 0). 0..n-1 = last completed pipeline stage. */
let completedThrough = -1;
let sizeApplied = false;
let previewRgba: Uint8ClampedArray | null = null;
let busy = false;
const logLines: string[] = [];

type ParamGroup = keyof Omit<ProceduralParams, 'seed' | 'width' | 'height'>;

const SLIDERS: Record<
  ParamGroup,
  Array<{ key: string; label: string; min: number; max: number; step: number }>
> = {
  tectonics: [
    { key: 'orogenyCount', label: 'Eras orogénicas', min: 1, max: 12, step: 1 },
    { key: 'cordillerasPerEra', label: 'Cordilleras por era', min: 1, max: 6, step: 1 },
    { key: 'cordilleraLength', label: 'Longitud base (× diagonal)', min: 0.1, max: 1.0, step: 0.02 },
    { key: 'cordilleraLengthVariability', label: 'Variabilidad de largos', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraMeander', label: 'Inflexiones eventuales (prom.)', min: 0, max: 8, step: 0.5 },
    { key: 'cordilleraWidth', label: 'Ancho base (× min lado)', min: 0.008, max: 0.22, step: 0.001 },
    { key: 'cordilleraWidthVariability', label: 'Variabilidad de anchos', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraCrestVariability', label: 'Variabilidad altura (eje)', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraNodeSpacingVar', label: 'Variabilidad paso (nodos)', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraFalloffShape', label: 'Forma falloff (suave→afilado)', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraFalloffJagged', label: 'Subcordilleras (nº / fuerza)', min: 0, max: 1, step: 0.05 },
    { key: 'cordilleraJaggedVariability', label: 'Variabilidad subcordis', min: 0, max: 1, step: 0.05 },
    { key: 'continentalScale', label: 'Granularidad continental', min: 1.5, max: 10, step: 0.1 },
    { key: 'upliftStrength', label: 'Uplift', min: 0.3, max: 2, step: 0.05 },
    { key: 'erosionWear', label: 'Erosión (∝ prominencia)', min: 0, max: 0.9, step: 0.05 },
    { key: 'heightBias', label: 'Bias altura', min: -0.6, max: 0.4, step: 0.01 },
  ],
  ocean: [
    { key: 'oceanPercent', label: 'Porcentaje de océanos', min: 10, max: 95, step: 1 },
    { key: 'shelfDepthM', label: 'Prof. plataforma', min: 20, max: 400, step: 10 },
    { key: 'coastSoften', label: 'Soften costa', min: 0, max: 1, step: 0.05 },
  ],
  climate: [
    { key: 'cellSize', label: 'Tamaño celda (px)', min: 8, max: 128, step: 8 },
    { key: 'windSteps', label: 'Steps viento', min: 4, max: 80, step: 1 },
    { key: 'currentSteps', label: 'Steps corrientes', min: 4, max: 80, step: 1 },
    { key: 'coriolis', label: 'Coriolis', min: 0, max: 1.5, step: 0.05 },
    { key: 'advectionSteps', label: 'Steps advección T', min: 0, max: 60, step: 1 },
    { key: 'advectionStrength', label: 'Fuerza advección', min: 0, max: 2, step: 0.05 },
    { key: 'windStrength', label: 'Viento', min: 0.2, max: 2, step: 0.05 },
    { key: 'orographicStrength', label: 'Orográfico', min: 0, max: 2, step: 0.05 },
    { key: 'oceanCurrentStrength', label: 'Corrientes', min: 0, max: 2, step: 0.05 },
    { key: 'lapseRate', label: 'Lapse °C/km', min: 3, max: 10, step: 0.1 },
    { key: 'equatorTempC', label: 'Temp ecuador', min: 15, max: 40, step: 1 },
    { key: 'poleTempC', label: 'Temp polo', min: -50, max: 5, step: 1 },
    { key: 'moistureCapacity', label: 'Capacidad humedad', min: 0.3, max: 2, step: 0.05 },
  ],
  rivers: [
    { key: 'flowThreshold', label: 'Umbral ríos', min: 0.3, max: 0.85, step: 0.01 },
    { key: 'carveStrength', label: 'Tallado', min: 0, max: 0.6, step: 0.05 },
  ],
  biomes: [
    { key: 'snowTempC', label: 'Temp nieve °C', min: -20, max: 5, step: 1 },
  ],
};

function stages() {
  return listStages();
}

function nextPipelineIndex(): number {
  return completedThrough + 1;
}

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

function log(msg: string) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  logLines.push(line);
  if (logLines.length > 100) logLines.splice(0, logLines.length - 100);
  logEl.textContent = logLines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
  setStatus(msg);
}

function onProgress(p: StageProgress) {
  log(p.message);
}

function setBusy(v: boolean) {
  busy = v;
  syncButtons();
}

function parseSize(): { width: number; height: number } {
  const [w, h] = sizeSelect.value.split('x').map(Number);
  return { width: w || 2048, height: h || 1024 };
}

function syncStepLabel() {
  if (!sizeApplied) {
    stepLabel.textContent = 'Etapa 0 · Tamaño';
    btnNext.textContent = 'Aplicar tamaño (etapa 0)';
    return;
  }
  const next = nextPipelineIndex();
  const list = stages();
  if (next >= list.length) {
    stepLabel.textContent = `Completo · ${list.length} etapas`;
    btnNext.textContent = '—';
  } else {
    const s = list[next];
    stepLabel.textContent = `Siguiente: ${next + 1} · ${s.label.replace(/^\d+\s·\s/, '')}`;
    btnNext.textContent = `Correr etapa ${next + 1}`;
  }
}

function syncButtons() {
  const list = stages();
  const next = nextPipelineIndex();
  const done = sizeApplied && next >= list.length;
  const canGoBack = sizeApplied; // back from size-applied undoes etapa 0; else undoes last pipeline stage
  btnNext.disabled = busy || done;
  btnBack.disabled = busy || !canGoBack;
  btnRest.disabled = busy || !sizeApplied || done;
  btnReset.disabled = busy;
  btnApply.disabled = busy || !done;
  sizeSelect.disabled = busy || sizeApplied;
  seedInput.disabled = busy || sizeApplied;
  setupEl.classList.toggle('dimmed', sizeApplied);
}

function fillBufferSelect(preferred?: string) {
  const keep = preferred ?? bufferSelect.value;
  const tectonicsReady =
    sizeApplied && completedThrough >= stages().findIndex((s) => s.id === 'tectonics');
  const climateReady =
    sizeApplied && completedThrough >= stages().findIndex((s) => s.id === 'climate');
  bufferSelect.replaceChildren();

  const extras: Array<{ id: string; label: string; need?: 'tectonics' | 'climate' }> = [
    { id: 'wind', label: 'Viento (flechas)', need: 'climate' },
    { id: 'currents', label: 'Corrientes (flechas)', need: 'climate' },
  ];

  for (const b of listBuffers()) {
    if (b.previewable === false) continue;
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.label === 'Elevación' ? 'Elevación (limpia)' : b.label;
    bufferSelect.appendChild(opt);
    if (b.id === 'elevation' && tectonicsReady) {
      const o = document.createElement('option');
      o.value = 'orogeny';
      o.textContent = 'Orogenia (corteza + eras)';
      bufferSelect.appendChild(o);
    }
  }
  for (const e of extras) {
    if (e.need === 'climate' && !climateReady) continue;
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.label;
    bufferSelect.appendChild(opt);
  }

  if (keep && [...bufferSelect.options].some((o) => o.value === keep)) {
    bufferSelect.value = keep;
  } else if (bufferSelect.options.length > 0) {
    bufferSelect.selectedIndex = 0;
  }
}

function appendLegendStops(
  title: string,
  stops: Array<{ label: string; color: string }>,
) {
  const block = document.createElement('div');
  block.className = 'gen-legend-block';
  const t = document.createElement('div');
  t.className = 'gen-legend-title';
  t.textContent = title;
  block.appendChild(t);
  const grid = document.createElement('div');
  grid.className = 'gen-legend-grid';
  const cols = 4;
  const rows = Math.max(1, Math.ceil(stops.length / cols));
  grid.style.setProperty('--legend-rows', String(rows));
  for (const stop of stops) {
    const row = document.createElement('div');
    row.className = 'gen-legend-row';
    const sw = document.createElement('span');
    sw.className = 'gen-legend-swatch';
    sw.style.background = stop.color;
    const lab = document.createElement('span');
    lab.textContent = stop.label;
    row.append(sw, lab);
    grid.appendChild(row);
  }
  block.appendChild(grid);
  legendEl.appendChild(block);
}

function paramsGroupForNext(): ParamGroup | null {
  if (!sizeApplied) return null;
  const next = nextPipelineIndex();
  const list = stages();
  if (next < 0 || next >= list.length) {
    // show last stage params if done
    const last = list[list.length - 1];
    return last?.paramsKey ?? null;
  }
  return list[next].paramsKey;
}

function buildParamSliders() {
  paramsEl.replaceChildren();
  const group = paramsGroupForNext();
  if (!group) {
    const hint = document.createElement('p');
    hint.className = 'gen-status';
    hint.textContent = 'Primero aplicá el tamaño. Los knobs de cada etapa aparecen al avanzar.';
    paramsEl.appendChild(hint);
    return;
  }

  const stage = stages().find((s) => s.paramsKey === group);
  const hint = document.createElement('p');
  hint.className = 'gen-status';
  hint.textContent = stage
    ? `Params de «${stage.label}» (no se corren solos — usá el botón)`
    : '';
  paramsEl.appendChild(hint);

  if (group === 'ocean') {
    const explain = document.createElement('p');
    explain.className = 'gen-param-help';
    explain.textContent =
      'Porcentaje de océanos: elige la cota (percentil) para que esa fracción del mapa quede bajo el mar, y rebasea toda la elevación para que la costa quede en 0 m.';
    paramsEl.appendChild(explain);
  }

  for (const def of SLIDERS[group]) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const span = document.createElement('span');
    const em = document.createElement('em');
    const groupObj = params[group] as unknown as Record<string, number>;
    em.textContent = String(groupObj[def.key]);
    span.append(def.label + ' ', em);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(groupObj[def.key]);
    input.addEventListener('input', () => {
      groupObj[def.key] = Number(input.value);
      em.textContent = String(groupObj[def.key]);
      if (proc) proc.params = cloneParams(params);
    });
    wrap.append(span, input);
    paramsEl.appendChild(wrap);
  }
}

function ensureCanvasSize() {
  if (!proc) return;
  if (canvas.width !== proc.width || canvas.height !== proc.height) {
    canvas.width = proc.width;
    canvas.height = proc.height;
    overlay.width = proc.width;
    overlay.height = proc.height;
  }
  const n = proc.width * proc.height * 4;
  if (!previewRgba || previewRgba.length !== n) {
    previewRgba = new Uint8ClampedArray(n);
  }
  applyViewZoom();
}

let viewZoom = 1;
const VIEW_ZOOM_MIN = 0.15;
const VIEW_ZOOM_MAX = 12;

function applyViewZoom() {
  const w = canvas.width || 1;
  const h = canvas.height || 1;
  const cw = `${w * viewZoom}px`;
  const ch = `${h * viewZoom}px`;
  canvas.style.width = cw;
  canvas.style.height = ch;
  canvasWrap.style.width = cw;
  canvasWrap.style.height = ch;
}

function setViewZoom(next: number, clientX?: number, clientY?: number) {
  const z = Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, next));
  if (Math.abs(z - viewZoom) < 1e-4) return;

  const rect = viewport.getBoundingClientRect();
  const mx = (clientX ?? rect.left + rect.width * 0.5) - rect.left;
  const my = (clientY ?? rect.top + rect.height * 0.5) - rect.top;
  const contentX = (viewport.scrollLeft + mx) / viewZoom;
  const contentY = (viewport.scrollTop + my) / viewZoom;

  viewZoom = z;
  applyViewZoom();

  viewport.scrollLeft = contentX * viewZoom - mx;
  viewport.scrollTop = contentY * viewZoom - my;
}

function syncLegend(bufferId: string) {
  const showElev =
    (bufferId === 'elevation' || bufferId === 'crust') && completedThrough >= 0;
  const showOrogeny = bufferId === 'orogeny' && completedThrough >= 0;
  const showClimateTint =
    (bufferId === 'temp' || bufferId === 'precip') && completedThrough >= 0;
  const showFlowBase =
    (bufferId === 'wind' || bufferId === 'currents') && completedThrough >= 0;

  if (!showElev && !showOrogeny && !showClimateTint && !showFlowBase) {
    legendEl.classList.add('hidden');
    legendEl.replaceChildren();
    return;
  }
  legendEl.classList.remove('hidden');
  legendEl.replaceChildren();

  if (showOrogeny) {
    appendLegendStops(
      'Corteza (gris)',
      ELEVATION_GRAY_KEY.map((s) => ({
        label: s.label,
        color: `rgb(${s.gray}, ${s.gray}, ${s.gray})`,
      })),
    );
    const nEras = proc?.orogenyEraUplift?.length
      ?? (proc?.cordilleras
        ? new Set(proc.cordilleras.map((c) => c.era)).size
        : 0);
    if (nEras > 0) {
      appendLegendStops(
        'Eras orogénicas',
        Array.from({ length: nEras }, (_, i) => ({
          label: `Era ${i + 1}${i === 0 ? ' (vieja)' : i === nEras - 1 ? ' (nueva)' : ''}`,
          color: OROGENY_LINE_COLORS[i % OROGENY_LINE_COLORS.length],
        })),
      );
    }
    return;
  }

  if (showClimateTint) {
    appendLegendStops(
      'Altura (gris)',
      ELEVATION_GRAY_KEY.map((s) => ({
        label: s.label,
        color: `rgb(${s.gray}, ${s.gray}, ${s.gray})`,
      })),
    );
    const key = bufferId === 'temp' ? TEMPERATURE_COLOR_KEY : PRECIPITATION_COLOR_KEY;
    appendLegendStops(
      bufferId === 'temp' ? 'Temperatura (°C)' : 'Precipitación',
      key.map((s) => ({
        label: s.label,
        color: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`,
      })),
    );
    return;
  }

  appendLegendStops(
    bufferId === 'crust' ? 'Corteza (m)' : 'Elevación (m)',
    ELEVATION_COLOR_KEY.map((s) => ({
      label: s.label,
      color: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`,
    })),
  );
}

function paint() {
  if (!proc || !previewRgba) return;
  const id = bufferSelect.value || 'elevation';
  const t0 = performance.now();
  overlay2d.clearRect(0, 0, overlay.width, overlay.height);

  if (id === 'orogeny') {
    renderOrogenyPreview(proc, previewRgba);
    const copy = new Uint8ClampedArray(previewRgba.length);
    copy.set(previewRgba);
    ctx2d.putImageData(new ImageData(copy, proc.width, proc.height), 0, 0);
    drawCordilleraOverlay(proc, overlay2d);
  } else if (id === 'temp' || id === 'precip') {
    renderBufferPreview(proc, 'elevationGray', previewRgba);
    const base = new Uint8ClampedArray(previewRgba.length);
    base.set(previewRgba);
    ctx2d.putImageData(new ImageData(base, proc.width, proc.height), 0, 0);

    renderBufferPreview(proc, id, previewRgba);
    const tint = new Uint8ClampedArray(previewRgba.length);
    tint.set(previewRgba);
    overlay2d.putImageData(new ImageData(tint, proc.width, proc.height), 0, 0);
  } else {
    renderBufferPreview(proc, id, previewRgba);
    const copy = new Uint8ClampedArray(previewRgba.length);
    copy.set(previewRgba);
    ctx2d.putImageData(new ImageData(copy, proc.width, proc.height), 0, 0);

    if (id === 'wind' || id === 'currents') {
      drawVectorOverlay(proc, id, overlay2d);
    }
  }

  syncLegend(id);
  log(`Preview «${id}» · ${(performance.now() - t0).toFixed(0)} ms`);
}

function syncUi(preferredBuffer?: string) {
  syncStepLabel();
  syncButtons();
  fillBufferSelect(preferredBuffer);
  buildParamSliders();
}

async function applySize() {
  if (busy || sizeApplied) return;
  setBusy(true);
  try {
    const { width, height } = parseSize();
    params.width = width;
    params.height = height;
    params.seed = Number(seedInput.value) || 42;
    seedVal.textContent = String(params.seed);
    log(`Etapa 0 · alloc ${width}×${height} seed=${params.seed}…`);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    proc = createContext(params);
    proc.onLog = (m) => log(m);
    proc.completedThrough = -1;
    completedThrough = -1;
    sizeApplied = true;
    ensureCanvasSize();
    ctx2d.fillStyle = '#0a1812';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    overlay2d.clearRect(0, 0, overlay.width, overlay.height);
    log(`Etapa 0 lista · buffers en memoria. Corré la etapa 1 cuando quieras.`);
    syncUi();
  } catch (err) {
    log(`Error: ${String(err)}`);
  } finally {
    setBusy(false);
  }
}

async function runNextStage() {
  if (busy) return;
  if (!sizeApplied) {
    await applySize();
    return;
  }
  if (!proc) return;
  const list = stages();
  const idx = nextPipelineIndex();
  if (idx < 0 || idx >= list.length) return;

  setBusy(true);
  const stage = list[idx];
  const t0 = performance.now();
  log(`▶ Corriendo ${stage.label}…`);
  try {
    proc.params = cloneParams(params);
    proc.onLog = (m) => onProgress({ phase: 'start', message: m });
    proc.onPreview = () => {
      ensureCanvasSize();
      paint();
    };
    if (stage.id === 'tectonics') {
      bufferSelect.value = 'elevation';
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    await Promise.resolve(stage.run(proc));
    proc.onPreview = undefined;
    proc.completedThrough = idx;
    completedThrough = idx;
    const preferred = defaultBufferForStage(stage.id);
    ensureCanvasSize();
    syncUi(preferred);
    paint();
    log(`✓ ${stage.label} · ${(performance.now() - t0).toFixed(0)} ms`);
  } catch (err) {
    log(`Error: ${String(err)}`);
  } finally {
    setBusy(false);
  }
}

async function runRemaining() {
  if (busy || !sizeApplied || !proc) return;
  const list = stages();
  while (nextPipelineIndex() < list.length) {
    await runNextStage();
    if (completedThrough < 0) break;
  }
}

function resetToStage0() {
  if (busy) return;
  const newSeed = (Math.random() * 0xffffffff) >>> 0;
  params.seed = newSeed;
  seedInput.value = String(newSeed);
  seedVal.textContent = String(newSeed);
  proc = null;
  completedThrough = -1;
  sizeApplied = false;
  previewRgba = null;
  legendEl.classList.add('hidden');
  legendEl.replaceChildren();
  ctx2d.fillStyle = '#050a08';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  overlay2d.clearRect(0, 0, overlay.width, overlay.height);
  log(`Reset · etapa 0 · seed ${newSeed}`);
  syncUi();
}

function goBackStage() {
  if (busy || !sizeApplied) return;

  // Undo size apply → etapa 0
  if (completedThrough < 0) {
    resetToStage0();
    return;
  }

  const undone = stages()[completedThrough];
  completedThrough -= 1;
  if (proc) proc.completedThrough = completedThrough;

  log(`↩ Volví atrás · deshice «${undone?.label ?? '?'}». Re-corré cuando quieras.`);

  if (completedThrough >= 0) {
    const viewStage = stages()[completedThrough];
    const preferred = defaultBufferForStage(viewStage.id);
    syncUi(preferred);
    paint();
  } else {
    // Only etapa 0 applied: blank canvas, wait for etapa 1
    overlay2d.clearRect(0, 0, overlay.width, overlay.height);
    ctx2d.fillStyle = '#0a1812';
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    legendEl.classList.add('hidden');
    bufferSelect.replaceChildren();
    syncUi();
  }
}

async function applyAsWorld() {
  if (!proc || busy) return;
  const list = stages();
  if (completedThrough < list.length - 1) {
    log('Completá todas las etapas antes de publicar');
    return;
  }
  setBusy(true);
  log('Publicando mundo procedural al server…');
  try {
    const res = await fetch('/api/maps/worlds/procedural/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    log(`Mundo listo ${body.meta?.width}×${body.meta?.height}. Elegí «Procedural» en el juego.`);
  } catch (err) {
    log(`Error: ${String(err)}`);
  } finally {
    setBusy(false);
  }
}

// Pan
let dragging = false;
let dragX = 0;
let dragY = 0;
let scrollX = 0;
let scrollY = 0;
viewport.addEventListener('pointerdown', (e) => {
  dragging = true;
  viewport.classList.add('dragging');
  dragX = e.clientX;
  dragY = e.clientY;
  scrollX = viewport.scrollLeft;
  scrollY = viewport.scrollTop;
  viewport.setPointerCapture(e.pointerId);
});
viewport.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  viewport.scrollLeft = scrollX - (e.clientX - dragX);
  viewport.scrollTop = scrollY - (e.clientY - dragY);
});
viewport.addEventListener('pointerup', () => {
  dragging = false;
  viewport.classList.remove('dragging');
});

// Wheel zoom (toward cursor)
viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setViewZoom(viewZoom * factor, e.clientX, e.clientY);
  },
  { passive: false },
);

bufferSelect.addEventListener('change', () => {
  if (proc && completedThrough >= 0) paint();
});

seedInput.addEventListener('input', () => {
  seedVal.textContent = seedInput.value;
});

btnNext.addEventListener('click', () => void runNextStage());
btnBack.addEventListener('click', () => goBackStage());
btnRest.addEventListener('click', () => void runRemaining());
btnReset.addEventListener('click', () => resetToStage0());
btnApply.addEventListener('click', () => void applyAsWorld());

log('Etapa 0: elegí tamaño y seed, después «Aplicar tamaño».');
syncUi();
