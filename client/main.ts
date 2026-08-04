import { startGame, type PlayerStats, type TileInfo } from './src/game';
import { GameClock } from './src/gameClock';
import { GameCalendar } from './src/gameCalendar';
import {
  DEFAULT_LUNAR_QUARTER_DAYS,
  GameLunar,
  LUNAR_QUARTER_DAYS_MAX,
  LUNAR_QUARTER_DAYS_MIN,
  setLunarQuarterDays,
} from './src/gameLunar';
import {
  DEFAULT_DAY_SECONDS,
  DEFAULT_DAYS_PER_MONTH,
  DAY_SECONDS_MAX,
  DAY_SECONDS_MIN,
  DAYS_PER_MONTH_MAX,
  DAYS_PER_MONTH_MIN,
  getDaySeconds,
  getDaysPerMonth,
  setDaySeconds,
  setDaysPerMonth,
} from './src/timeScale';
import {
  DEFAULT_PLAYER_EMOJI,
  DEFAULT_STARTING_AREA,
  isPlayerEmoji,
  isStartingAreaId,
  PLAYER_EMOJIS,
  type PlayerEmoji,
  type StartingAreaId,
} from '../shared/types';

const bootEl = document.getElementById('boot')!;
const hudEl = document.getElementById('hud')!;
const statusEl = document.getElementById('boot-status')!;
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const emojiPicker = document.getElementById('emoji-picker')!;
const emojiInput = document.getElementById('player-emoji') as HTMLInputElement;
const worldSelect = document.getElementById('map-world') as HTMLSelectElement;
const startingAreaSelect = document.getElementById('starting-area') as HTMLSelectElement;
const sourceSelect = document.getElementById('map-source') as HTMLSelectElement;
const resSelect = document.getElementById('map-res') as HTMLSelectElement;
const paletteSelect = document.getElementById('map-palette') as HTMLSelectElement;
const fileInput = document.getElementById('map-file') as HTMLInputElement;
const uploadField = document.getElementById('upload-field')!;
const fxCloudsInput = document.getElementById('fx-clouds') as HTMLInputElement;
const fxWavesInput = document.getElementById('fx-waves') as HTMLInputElement;
const daysPerMonthSlider = document.getElementById('days-per-month') as HTMLInputElement;
const daysPerMonthValue = document.getElementById('days-per-month-value')!;
const daySecondsSlider = document.getElementById('day-seconds') as HTMLInputElement;
const daySecondsValue = document.getElementById('day-seconds-value')!;
const lunarQuarterSlider = document.getElementById('lunar-quarter-days') as HTMLInputElement;
const lunarQuarterValue = document.getElementById('lunar-quarter-value')!;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const playModeEl = document.getElementById('play-mode')!;
const joinCodeField = document.getElementById('join-code-field')!;
const joinCodeInput = document.getElementById('join-code') as HTMLInputElement;
const modeHint = document.getElementById('mode-hint')!;
const roomCodeEl = document.getElementById('room-code')!;
const playerCount = document.getElementById('player-count')!;
const gameClockEl = document.getElementById('game-clock')!;
const gameClockTime = document.getElementById('game-clock-time')!;
const gameClockDate = document.getElementById('game-clock-date')!;
const gameClockSeason = document.getElementById('game-clock-season')!;
const gameClockPhase = document.getElementById('game-clock-phase')!;
const gameClockScale = document.getElementById('game-clock-scale')!;
const lunarPhaseEl = document.getElementById('lunar-phase')!;
const lunarIcon = document.getElementById('lunar-icon')!;
const lunarLabel = document.getElementById('lunar-label')!;
const lunarIllum = document.getElementById('lunar-illum')!;
const chatLog = document.getElementById('chat-log')!;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const tiPos = document.getElementById('ti-pos')!;
const tiGeo = document.getElementById('ti-geo')!;
const tiElev = document.getElementById('ti-elev')!;
const tiCover = document.getElementById('ti-cover')!;
const tiMask = document.getElementById('ti-mask')!;
const miPos = document.getElementById('mi-pos')!;
const miGeo = document.getElementById('mi-geo')!;
const miElev = document.getElementById('mi-elev')!;
const miCover = document.getElementById('mi-cover')!;
const miMask = document.getElementById('mi-mask')!;
const niPing = document.getElementById('ni-ping')!;
const psSpeed = document.getElementById('ps-speed')!;
const psSlope = document.getElementById('ps-slope')!;
const psMod = document.getElementById('ps-mod')!;
const psZoom = document.getElementById('ps-zoom')!;
const psFacing = document.getElementById('ps-facing')!;
const psRiver = document.getElementById('ps-river')!;

const FACING_LABEL: Record<string, string> = {
  up: 'N',
  down: 'S',
  left: 'O',
  right: 'E',
};

function renderPing(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) {
    niPing.textContent = '—';
    niPing.dataset.quality = 'offline';
    return;
  }
  niPing.textContent = `${ms} ms`;
  niPing.dataset.quality = ms < 80 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

function renderLunar() {
  const kind = GameLunar.kind;
  const illum = GameLunar.illumination;
  const pct = Math.round(illum * 100);
  lunarPhaseEl.dataset.phase = kind;
  lunarPhaseEl.style.setProperty('--lunar-illum', String(illum));
  lunarPhaseEl.title = `Luna ${GameLunar.label} · ${pct}% iluminación · shader ${Math.round(GameLunar.shaderIntensity * 100)}%`;
  lunarIcon.textContent = GameLunar.icon;
  lunarLabel.textContent = GameLunar.label;
  lunarIllum.textContent = `${pct}%`;
}

function renderClock(h = GameClock.hour) {
  const dpm = getDaysPerMonth();
  gameClockTime.textContent = GameClock.format(h);
  gameClockDate.textContent = GameCalendar.format();
  gameClockSeason.textContent = GameCalendar.season();
  gameClockScale.textContent = `${Number.isInteger(dpm) ? dpm : dpm.toFixed(1)}d/mes · ${getDaySeconds()}s`;
  gameClockScale.title = `${dpm} día${dpm === 1 ? '' : 's'} de juego por mes · día = ${getDaySeconds()} s reales`;
  const phase = GameClock.phase(h);
  gameClockPhase.textContent = phase;
  gameClockEl.dataset.phase = phase;
  gameClockEl.dataset.season = GameCalendar.season();
  gameClockEl.dataset.daysPerMonth = String(dpm);
  renderLunar();
}

GameClock.subscribe(renderClock);
GameCalendar.subscribe(() => renderClock());
GameLunar.subscribe(renderLunar);

const savedName = localStorage.getItem('pixelweb-name');
if (savedName) nameInput.value = savedName;

const savedEmoji = localStorage.getItem('pixelweb-emoji');
const initialEmoji: PlayerEmoji =
  savedEmoji && isPlayerEmoji(savedEmoji) ? savedEmoji : DEFAULT_PLAYER_EMOJI;
emojiInput.value = initialEmoji;

function selectEmoji(emoji: PlayerEmoji) {
  emojiInput.value = emoji;
  localStorage.setItem('pixelweb-emoji', emoji);
  for (const btn of emojiPicker.querySelectorAll('button')) {
    btn.setAttribute('aria-selected', btn.dataset.emoji === emoji ? 'true' : 'false');
  }
}

for (const emoji of PLAYER_EMOJIS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.emoji = emoji;
  btn.textContent = emoji;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-label', `Emoji ${emoji}`);
  btn.setAttribute('aria-selected', emoji === initialEmoji ? 'true' : 'false');
  btn.addEventListener('click', () => selectEmoji(emoji));
  emojiPicker.appendChild(btn);
}

const savedStartingArea = localStorage.getItem('pixelweb-starting-area');
if (savedStartingArea && isStartingAreaId(savedStartingArea)) {
  startingAreaSelect.value = savedStartingArea;
}

const savedFxClouds = localStorage.getItem('pixelweb-fx-clouds');
if (savedFxClouds != null) fxCloudsInput.checked = savedFxClouds === '1';
const savedFxWaves = localStorage.getItem('pixelweb-fx-waves');
if (savedFxWaves != null) fxWavesInput.checked = savedFxWaves === '1';

const savedTimeMode = localStorage.getItem('pixelweb-time-mode');
daysPerMonthSlider.min = String(DAYS_PER_MONTH_MIN);
daysPerMonthSlider.max = String(DAYS_PER_MONTH_MAX);
daysPerMonthSlider.step = '0.1';
const savedDaysPerMonth = localStorage.getItem('pixelweb-days-per-month');
let initialDaysPerMonth =
  savedDaysPerMonth != null ? Number(savedDaysPerMonth) : DEFAULT_DAYS_PER_MONTH;
// Migrate old binary time-mode preference once.
if (savedDaysPerMonth == null && savedTimeMode === 'realtime') initialDaysPerMonth = 30;
if (savedDaysPerMonth == null && savedTimeMode === 'monthDay') initialDaysPerMonth = 1;
const clampedInitialDpm = Number.isFinite(initialDaysPerMonth)
  ? Math.min(DAYS_PER_MONTH_MAX, Math.max(DAYS_PER_MONTH_MIN, initialDaysPerMonth))
  : DEFAULT_DAYS_PER_MONTH;
daysPerMonthSlider.value = String(Math.round(clampedInitialDpm * 10) / 10);

daySecondsSlider.min = String(DAY_SECONDS_MIN);
daySecondsSlider.max = String(DAY_SECONDS_MAX);
const savedDaySeconds =
  localStorage.getItem('pixelweb-day-seconds') ??
  localStorage.getItem('pixelweb-month-day-seconds');
const initialDaySeconds = savedDaySeconds != null ? Number(savedDaySeconds) : DEFAULT_DAY_SECONDS;
daySecondsSlider.value = String(
  Number.isFinite(initialDaySeconds)
    ? Math.min(DAY_SECONDS_MAX, Math.max(DAY_SECONDS_MIN, initialDaySeconds))
    : DEFAULT_DAY_SECONDS,
);

lunarQuarterSlider.min = String(LUNAR_QUARTER_DAYS_MIN);
lunarQuarterSlider.max = String(LUNAR_QUARTER_DAYS_MAX);
lunarQuarterSlider.step = '0.25';
const savedLunarQuarter = localStorage.getItem('pixelweb-lunar-quarter-days');
const initialLunarQuarter =
  savedLunarQuarter != null ? Number(savedLunarQuarter) : DEFAULT_LUNAR_QUARTER_DAYS;
const clampedLunar = Number.isFinite(initialLunarQuarter)
  ? Math.min(LUNAR_QUARTER_DAYS_MAX, Math.max(LUNAR_QUARTER_DAYS_MIN, initialLunarQuarter))
  : DEFAULT_LUNAR_QUARTER_DAYS;
lunarQuarterSlider.value = String(Math.round(clampedLunar * 100) / 100);

function formatQuarterDays(d: number): string {
  return Number.isInteger(d) ? `${d} d` : `${d.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} d`;
}

function syncTimeSlidersUi() {
  const dpm = Number(daysPerMonthSlider.value) || DEFAULT_DAYS_PER_MONTH;
  const daySec = Number(daySecondsSlider.value) || DEFAULT_DAY_SECONDS;
  const lunarQ = Number(lunarQuarterSlider.value) || DEFAULT_LUNAR_QUARTER_DAYS;
  daysPerMonthValue.textContent = Number.isInteger(dpm) ? String(dpm) : dpm.toFixed(1);
  daySecondsValue.textContent = `${daySec} s`;
  lunarQuarterValue.textContent = formatQuarterDays(lunarQ);
  setDaysPerMonth(dpm);
  setDaySeconds(daySec);
  setLunarQuarterDays(lunarQ);
  renderClock();
}
syncTimeSlidersUi();

startingAreaSelect.addEventListener('change', () => {
  localStorage.setItem('pixelweb-starting-area', startingAreaSelect.value);
});

fxCloudsInput.addEventListener('change', () => {
  localStorage.setItem('pixelweb-fx-clouds', fxCloudsInput.checked ? '1' : '0');
});
fxWavesInput.addEventListener('change', () => {
  localStorage.setItem('pixelweb-fx-waves', fxWavesInput.checked ? '1' : '0');
});
daysPerMonthSlider.addEventListener('input', () => {
  syncTimeSlidersUi();
  localStorage.setItem('pixelweb-days-per-month', daysPerMonthSlider.value);
});
daySecondsSlider.addEventListener('input', () => {
  syncTimeSlidersUi();
  localStorage.setItem('pixelweb-day-seconds', daySecondsSlider.value);
});
lunarQuarterSlider.addEventListener('input', () => {
  syncTimeSlidersUi();
  localStorage.setItem('pixelweb-lunar-quarter-days', lunarQuarterSlider.value);
});

function syncSourceUi() {
  const src = sourceSelect.value;
  uploadField.classList.toggle('hidden', src !== 'upload');
  const mode = currentPlayMode();
  worldSelect.disabled = src !== 'layers' || mode === 'join';
}

type PlayMode = 'create' | 'join' | 'solo';

function currentPlayMode(): PlayMode {
  const pressed = playModeEl.querySelector('button[aria-pressed="true"]') as HTMLButtonElement | null;
  const mode = pressed?.dataset.mode;
  if (mode === 'join' || mode === 'solo' || mode === 'create') return mode;
  return 'create';
}

function setPlayMode(mode: PlayMode) {
  for (const btn of playModeEl.querySelectorAll('button')) {
    const m = (btn as HTMLButtonElement).dataset.mode;
    btn.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
  }
  joinCodeField.classList.toggle('hidden', mode !== 'join');
  if (mode === 'create') {
    playBtn.textContent = 'Crear sala';
    modeHint.textContent =
      'Multiplayer: el mundo se fija al crear la sala. Demo en chat: /sea N · /flood';
    if (sourceSelect.value !== 'layers') sourceSelect.value = 'layers';
  } else if (mode === 'join') {
    playBtn.textContent = 'Unirse a sala';
    modeHint.textContent = 'El mundo lo define la sala. Ingresá el código del host.';
    sourceSelect.value = 'layers';
  } else {
    playBtn.textContent = 'Jugar solo';
    modeHint.textContent = 'Sin multiplayer. Procedural/upload solo en este modo.';
  }
  // Multiplayer modes force layers
  sourceSelect.disabled = mode !== 'solo';
  syncSourceUi();
}

for (const btn of playModeEl.querySelectorAll('button')) {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLButtonElement).dataset.mode as PlayMode;
    if (mode) setPlayMode(mode);
  });
}
setPlayMode('create');

sourceSelect.addEventListener('change', syncSourceUi);
worldSelect.addEventListener('change', syncSourceUi);
syncSourceUi();

async function refreshWorldAvailability() {
  try {
    const res = await fetch('/api/maps/worlds');
    if (!res.ok) return;
    const data = (await res.json()) as {
      worlds: Array<{ id: string; ready: boolean; label: string; hint: string }>;
    };
    for (const opt of Array.from(worldSelect.options)) {
      const w = data.worlds.find((x) => x.id === opt.value);
      if (!w) continue;
      opt.textContent = w.ready ? w.label : `${w.label} (no generado)`;
      opt.disabled = !w.ready && opt.value !== 'default';
    }
  } catch {
    /* server down — leave labels */
  }
}
void refreshWorldAvailability();

let sendChat: ((text: string) => void) | null = null;
let setChatFocused: ((focused: boolean) => void) | null = null;

function fillTilePanel(
  info: TileInfo | null,
  els: { pos: HTMLElement; geo: HTMLElement; elev: HTMLElement; cover: HTMLElement; mask: HTMLElement },
) {
  if (!info) {
    els.pos.textContent = '—';
    els.geo.textContent = '—';
    els.elev.textContent = '—';
    els.cover.textContent = '—';
    els.mask.textContent = '—';
    return;
  }
  els.pos.textContent = `${info.x}, ${info.y}`;
  els.geo.textContent = `${info.lat.toFixed(2)}°, ${info.lon.toFixed(2)}°`;
  els.elev.textContent = info.elevationM == null ? 'n/d' : `${info.elevationM} m`;
  els.cover.textContent =
    info.landcover == null
      ? 'n/d'
      : `${info.landcover}${info.landcoverCode != null ? ` (${info.landcoverCode})` : ''}`;
  els.mask.textContent = info.land == null ? 'n/d' : info.land ? 'tierra' : 'agua';
}

function renderTileInfo(info: TileInfo) {
  fillTilePanel(info, {
    pos: tiPos,
    geo: tiGeo,
    elev: tiElev,
    cover: tiCover,
    mask: tiMask,
  });
}

function renderMouseTileInfo(info: TileInfo | null) {
  fillTilePanel(info, {
    pos: miPos,
    geo: miGeo,
    elev: miElev,
    cover: miCover,
    mask: miMask,
  });
}

function renderPlayerStats(stats: PlayerStats) {
  const kmh = Math.round(stats.speedKmh);
  psSpeed.textContent = `${Number.isFinite(kmh) ? Math.max(0, kmh) : 0} km/h`;
  psSpeed.dataset.moving = stats.moving ? '1' : '0';
  const slope = Math.round(stats.slopeDeg);
  psSlope.textContent = `${slope > 0 ? '+' : ''}${Number.isFinite(slope) ? slope : 0}°`;
  const mod = Math.round(stats.speedModPct);
  psMod.textContent = `${Number.isFinite(mod) ? mod : 100}%`;
  const z = stats.zoom;
  psZoom.textContent = Number.isFinite(z)
    ? z >= 10
      ? `${z.toFixed(0)}×`
      : `${z.toFixed(1)}×`
    : '—';
  psFacing.textContent = FACING_LABEL[stats.facing] ?? stats.facing;
  psRiver.classList.toggle('hidden', !stats.riverCrossing);
}

chatInput.addEventListener('focus', () => setChatFocused?.(true));
chatInput.addEventListener('blur', () => setChatFocused?.(false));
chatInput.addEventListener('keydown', (e) => {
  // Keep typing in the input; Esc leaves chat back to movement
  if (e.key === 'Escape') {
    chatInput.blur();
    e.preventDefault();
  }
});

playBtn.addEventListener('click', async () => {
  const name = (nameInput.value.trim() || 'Explorador').slice(0, 16);
  localStorage.setItem('pixelweb-name', name);
  const width = Number(resSelect.value);
  const height = width / 2;
  const palette = paletteSelect.value as 'earth' | 'retro' | 'mono';
  const mode = currentPlayMode();
  let mapSource = sourceSelect.value as 'layers' | 'procedural' | 'upload';
  let worldId = worldSelect.value || 'default';
  const startingArea: StartingAreaId = isStartingAreaId(startingAreaSelect.value)
    ? startingAreaSelect.value
    : DEFAULT_STARTING_AREA;
  const emoji: PlayerEmoji = isPlayerEmoji(emojiInput.value)
    ? emojiInput.value
    : DEFAULT_PLAYER_EMOJI;
  const file = fileInput.files?.[0] ?? null;
  const fxClouds = fxCloudsInput.checked;
  const fxWaves = fxWavesInput.checked;
  const daySeconds = Number(daySecondsSlider.value) || DEFAULT_DAY_SECONDS;
  const daysPerMonth = Number(daysPerMonthSlider.value) || DEFAULT_DAYS_PER_MONTH;
  const lunarQuarterDays = Number(lunarQuarterSlider.value) || DEFAULT_LUNAR_QUARTER_DAYS;
  localStorage.setItem('pixelweb-starting-area', startingArea);
  localStorage.setItem('pixelweb-emoji', emoji);
  localStorage.setItem('pixelweb-fx-clouds', fxClouds ? '1' : '0');
  localStorage.setItem('pixelweb-fx-waves', fxWaves ? '1' : '0');
  localStorage.setItem('pixelweb-day-seconds', String(daySeconds));
  localStorage.setItem('pixelweb-days-per-month', String(daysPerMonth));
  localStorage.setItem('pixelweb-lunar-quarter-days', String(lunarQuarterDays));

  playBtn.disabled = true;
  statusEl.textContent = 'Arrancando…';

  let roomId: string | null = null;
  let joinCode: string | null = null;

  try {
    if (mode === 'create') {
      mapSource = 'layers';
      statusEl.textContent = 'Creando sala…';
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { hint?: string; error?: string }).hint ||
            (body as { error?: string }).error ||
            `No se pudo crear la sala (${res.status})`,
        );
      }
      roomId = String((body as { roomId: string }).roomId);
      joinCode = String((body as { joinCode: string }).joinCode);
      worldId = String((body as { config: { worldId: string } }).config.worldId);
    } else if (mode === 'join') {
      mapSource = 'layers';
      const code = joinCodeInput.value.trim().toUpperCase();
      if (!code) throw new Error('Ingresá el código de sala');
      statusEl.textContent = 'Buscando sala…';
      const res = await fetch(`/api/rooms/code/${encodeURIComponent(code)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || 'Sala no encontrada');
      }
      roomId = String((body as { roomId: string }).roomId);
      joinCode = String((body as { joinCode: string }).joinCode);
      worldId = String((body as { config: { worldId: string } }).config.worldId);
    } else {
      roomId = null;
      joinCode = null;
    }
  } catch (err) {
    playBtn.disabled = false;
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    return;
  }

  bootEl.classList.add('hidden');
  hudEl.classList.remove('hidden');

  if (joinCode) {
    roomCodeEl.textContent = joinCode;
    roomCodeEl.classList.remove('hidden');
    roomCodeEl.title = `Código de sala — click para copiar`;
  } else {
    roomCodeEl.classList.add('hidden');
  }

  startGame(
    'game',
    {
      name,
      width,
      height,
      palette,
      mapSource,
      worldId,
      roomId,
      joinCode,
      startingArea,
      emoji,
      file,
      fxClouds,
      fxWaves,
      daySeconds,
      daysPerMonth,
      lunarQuarterDays,
      onStatus: (msg) => {
        statusEl.textContent = msg;
        document.title = msg ? `PixelWeb — ${msg}` : 'PixelWeb — Mapa del Mundo';
      },
    },
    {
      onPlayersChange: (n) => {
        playerCount.textContent = `${n} online`;
      },
      onPing: renderPing,
      onChat: (line) => {
        const div = document.createElement('div');
        div.textContent = line;
        chatLog.appendChild(div);
        while (chatLog.children.length > 8) chatLog.removeChild(chatLog.firstChild!);
      },
      onTileInfo: renderTileInfo,
      onMouseTileInfo: renderMouseTileInfo,
      onPlayerStats: renderPlayerStats,
      getChatSender: (fn) => {
        sendChat = fn;
      },
      getChatFocusSetter: (fn) => {
        setChatFocused = fn;
      },
    },
  );
});

roomCodeEl.addEventListener('click', async () => {
  const code = roomCodeEl.textContent?.trim();
  if (!code || code === '—') return;
  try {
    await navigator.clipboard.writeText(code);
    roomCodeEl.title = '¡Copiado!';
    setTimeout(() => {
      roomCodeEl.title = 'Código de sala — click para copiar';
    }, 1200);
  } catch {
    /* ignore */
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text && sendChat) sendChat(text);
  chatInput.value = '';
  chatInput.blur(); // back to walking
});
