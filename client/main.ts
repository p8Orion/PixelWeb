import { startGame, type TileInfo } from './src/game';
import { GameClock } from './src/gameClock';
import { GameCalendar } from './src/gameCalendar';
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
const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
const playerCount = document.getElementById('player-count')!;
const gameClockEl = document.getElementById('game-clock')!;
const gameClockTime = document.getElementById('game-clock-time')!;
const gameClockDate = document.getElementById('game-clock-date')!;
const gameClockSeason = document.getElementById('game-clock-season')!;
const gameClockPhase = document.getElementById('game-clock-phase')!;
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

function renderPing(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) {
    niPing.textContent = '—';
    niPing.dataset.quality = 'offline';
    return;
  }
  niPing.textContent = `${ms} ms`;
  niPing.dataset.quality = ms < 80 ? 'good' : ms < 180 ? 'ok' : 'bad';
}

function renderClock(h = GameClock.hour) {
  gameClockTime.textContent = GameClock.format(h);
  gameClockDate.textContent = GameCalendar.format();
  gameClockSeason.textContent = GameCalendar.season();
  const phase = GameClock.phase(h);
  gameClockPhase.textContent = phase;
  gameClockEl.dataset.phase = phase;
  gameClockEl.dataset.season = GameCalendar.season();
}

GameClock.subscribe(renderClock);
GameCalendar.subscribe(() => renderClock());

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

startingAreaSelect.addEventListener('change', () => {
  localStorage.setItem('pixelweb-starting-area', startingAreaSelect.value);
});

fxCloudsInput.addEventListener('change', () => {
  localStorage.setItem('pixelweb-fx-clouds', fxCloudsInput.checked ? '1' : '0');
});
fxWavesInput.addEventListener('change', () => {
  localStorage.setItem('pixelweb-fx-waves', fxWavesInput.checked ? '1' : '0');
});

function syncSourceUi() {
  const src = sourceSelect.value;
  uploadField.classList.toggle('hidden', src !== 'upload');
  worldSelect.disabled = src !== 'layers';
}
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
  const mapSource = sourceSelect.value as 'layers' | 'procedural' | 'upload';
  const worldId = worldSelect.value || 'default';
  const startingArea: StartingAreaId = isStartingAreaId(startingAreaSelect.value)
    ? startingAreaSelect.value
    : DEFAULT_STARTING_AREA;
  const emoji: PlayerEmoji = isPlayerEmoji(emojiInput.value)
    ? emojiInput.value
    : DEFAULT_PLAYER_EMOJI;
  const file = fileInput.files?.[0] ?? null;
  const fxClouds = fxCloudsInput.checked;
  const fxWaves = fxWavesInput.checked;
  localStorage.setItem('pixelweb-starting-area', startingArea);
  localStorage.setItem('pixelweb-emoji', emoji);
  localStorage.setItem('pixelweb-fx-clouds', fxClouds ? '1' : '0');
  localStorage.setItem('pixelweb-fx-waves', fxWaves ? '1' : '0');

  playBtn.disabled = true;
  statusEl.textContent = 'Arrancando…';

  bootEl.classList.add('hidden');
  hudEl.classList.remove('hidden');

  startGame(
    'game',
    {
      name,
      width,
      height,
      palette,
      mapSource,
      worldId,
      startingArea,
      emoji,
      file,
      fxClouds,
      fxWaves,
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
      getChatSender: (fn) => {
        sendChat = fn;
      },
      getChatFocusSetter: (fn) => {
        setChatFocused = fn;
      },
    },
  );
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text && sendChat) sendChat(text);
  chatInput.value = '';
  chatInput.blur(); // back to walking
});
