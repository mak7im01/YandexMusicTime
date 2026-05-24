// ─── PulseSync API helpers ────────────────────────────────────────────────────

/**
 * Возвращает store настроек через новое window.pulsesyncApi.
 * Если API недоступно — возвращает заглушку, чтобы аддон не падал.
 */
function getAddonSettings(addonName) {
    return (
        window.pulsesyncApi?.getSettings(addonName) ?? {
            getCurrent: () => ({}),
            onChange: () => () => {},
        }
    );
}

/**
 * Читает значение настройки из плоского объекта настроек.
 * PulseSync может отдавать как { value, default }, так и голое значение.
 */
function unwrapSetting(entry, fallback) {
    if (entry !== null && entry !== undefined && typeof entry === 'object' && !Array.isArray(entry)) {
        if (typeof entry.value !== 'undefined') return entry.value;
        if (typeof entry.default !== 'undefined') return entry.default;
    }
    return typeof entry !== 'undefined' ? entry : fallback;
}

function readBool(settings, key, fallback) {
    return Boolean(unwrapSetting(settings[key], fallback));
}

function readNumber(settings, key, fallback) {
    return Number(unwrapSetting(settings[key], fallback));
}

function readString(settings, key, fallback) {
    return String(unwrapSetting(settings[key], fallback));
}

// ─── MusicTimer ───────────────────────────────────────────────────────────────

class MusicTimer {
    constructor() {
        this.totalTime = this.loadTime();
        this.isPlaying = false;
        this.startTime = null;
        this.timerElement = null;
        this.lastResetState = false;
    }

    loadTime() {
        const saved = localStorage.getItem('yandexMusicTotalTime');
        return saved ? parseInt(saved, 10) : 0;
    }

    saveTime() {
        localStorage.setItem('yandexMusicTotalTime', this.totalTime.toString());
    }

    resetTime() {
        this.totalTime = 0;
        this.saveTime();
    }

    start() {
        if (!this.isPlaying) {
            this.isPlaying = true;
            this.startTime = Date.now();
        }
    }

    stop() {
        if (this.isPlaying) {
            this.isPlaying = false;
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            this.totalTime += elapsed;
            this.saveTime();
        }
    }

    getCurrentTime() {
        let time = this.totalTime;
        if (this.isPlaying && this.startTime) {
            time += Math.floor((Date.now() - this.startTime) / 1000);
        }
        return time;
    }

    formatTime(seconds, showSeconds = true) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return showSeconds
            ? `${hours}ч ${minutes}м ${secs}с`
            : `${hours}ч ${minutes}м`;
    }

    getPositionCSS(positionValue) {
        const positions = {
            1: 'top: 0px; left: 50%; transform: translateX(-50%);',
            2: 'top: 0px; left: 0px;',
            3: 'bottom: 0px; left: 0px;',
        };
        return positions[positionValue] || positions[1];
    }

    buildCSS(position, color, fontSize) {
        return `
            position: fixed;
            ${position}
            color: ${color};
            padding: 10px 15px;
            font-size: ${fontSize}px;
            font-family: 'YS Text', Arial, sans-serif;
            z-index: 10000;
            pointer-events: none;
            user-select: none;
            max-height: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            box-sizing: border-box;
        `;
    }

    updateDisplay(settings) {
        const showTimer = readBool(settings, 'showTimer', true);

        if (!showTimer) {
            if (this.timerElement) {
                this.timerElement.remove();
                this.timerElement = null;
            }
            return;
        }

        if (!this.timerElement) {
            this.timerElement = document.createElement('div');
            this.timerElement.id = 'yandex-music-timer';
            document.body.appendChild(this.timerElement);
        }

        const positionValue = readNumber(settings, 'timerPosition', 1);
        const useStaticColor = readBool(settings, 'timerColor', false);
        const customColor = readString(settings, 'customColor', '#ffffff');
        const fontSize = readNumber(settings, 'fontSize', 12);
        const showSeconds = readBool(settings, 'showSeconds', true);
        const showIcon = readBool(settings, 'showIcon', false);

        const color = useStaticColor
            ? customColor
            : 'var(--ym-controls-color-primary-text-enabled_variant, #ffffff)';

        const position = this.getPositionCSS(positionValue);
        const currentTime = this.getCurrentTime();
        const formattedTime = this.formatTime(currentTime, showSeconds);
        const icon = showIcon ? '🎵 ' : '';

        this.timerElement.textContent = `${icon}${formattedTime}`;
        this.timerElement.style.cssText = this.buildCSS(position, color, fontSize);
    }
}

// ─── Инициализация ────────────────────────────────────────────────────────────

const musicTimer = new MusicTimer();

// Текущие настройки (обновляются реактивно через onChange)
let currentSettings = {};

function checkPlaybackState() {
    const pauseButton = document.querySelector('[data-test-id="PAUSE_BUTTON"]');
    const playButton = document.querySelector('[data-test-id="PLAY_BUTTON"]');

    if (pauseButton) {
        musicTimer.start();
    } else if (playButton) {
        musicTimer.stop();
    }
}

function applySettings(settings) {
    // Сброс статистики
    const resetValue = readBool(settings, 'resetButton', false);
    if (resetValue === true && !musicTimer.lastResetState) {
        musicTimer.resetTime();
        musicTimer.lastResetState = true;
    } else if (resetValue === false) {
        musicTimer.lastResetState = false;
    }

    musicTimer.updateDisplay(settings);
}

// Подключаемся к новому API настроек PulseSync
const settingsStore = getAddonSettings('YandexMusicTime');
currentSettings = settingsStore.getCurrent();

// Реактивное обновление при изменении настроек пользователем
settingsStore.onChange(nextSettings => {
    currentSettings = nextSettings;
    applySettings(currentSettings);
});

// Интервал только для обновления таймера и состояния воспроизведения
setInterval(() => {
    checkPlaybackState();
    musicTimer.updateDisplay(currentSettings);
}, 1000);

// Первичное применение настроек
applySettings(currentSettings);

// Сохранение времени при закрытии страницы
window.addEventListener('beforeunload', () => {
    musicTimer.stop();
});

console.log('Yandex Music Time загружен');
