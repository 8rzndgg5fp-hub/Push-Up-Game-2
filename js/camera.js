/* ==================================================================
   camera.js — веб-камера + MediaPipe Tasks Vision PoseLandmarker.
   PoseLandmarker находит до 2 человек в кадре — это нужно для дуэли
   «два игрока перед одной камерой».

   Надёжность:
     • проверка HTTPS/localhost до вызова getUserMedia;
     • getUserMedia в try/catch, при OverconstrainedError — повтор с {video:true};
     • модель: GPU → при ошибке CPU; таймаут загрузки;
     • каждая ошибка переводится в понятную инструкцию (describeError).
   ================================================================== */
'use strict';

const Vision = {
  stream: null, landmarker: null, running: false, lastVideoTime: -1, onPoses: null, video: null,

  async startCamera(video) {
    this.video = video;
    if (this.stream && this.stream.active) return;
    if (!window.isSecureContext) throw U.err('InsecureContextError', 'Страница открыта не через HTTPS/localhost.');
    if (!navigator.mediaDevices?.getUserMedia) throw U.err('NotSupportedError', 'getUserMedia недоступен.');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Широкий кадр 16:9: в него помещается всё тело при стандартном положении ноутбука
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, facingMode: 'user' }, audio: false
      });
    } catch (err) {
      if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } else throw err;
    }
    // Если камера поддерживает зум — выставляем самый широкий угол
    try {
      const track = stream.getVideoTracks()[0];
      const cap = track.getCapabilities ? track.getCapabilities() : {};
      if (cap.zoom && cap.zoom.min != null) await track.applyConstraints({ advanced: [{ zoom: cap.zoom.min }] });
    } catch (e) { console.warn('zoom:', e); }

    video.srcObject = stream;
    try { await video.play(); } catch { /* muted-автоплей обычно разрешён */ }
    this.stream = stream;
  },

  stopCamera() {
    this.stopLoop();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  },

  /** Загрузка модели (один раз за сессию страницы) */
  async loadModel() {
    if (this.landmarker) return;
    const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${CONFIG.TASKS_VERSION}`;
    const timeout = new Promise((_, rej) => setTimeout(() => rej(U.err('PoseLoadError', 'Превышено время загрузки модели.')), CONFIG.MODEL_TIMEOUT));

    const load = (async () => {
      let mod;
      try { mod = await import(`${base}/vision_bundle.mjs`); }
      catch (e) { throw U.err('PoseLoadError', 'Не удалось скачать библиотеку MediaPipe: ' + e.message); }
      const { FilesetResolver, PoseLandmarker } = mod;
      const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: CONFIG.MODEL_URL, delegate },
        runningMode: 'VIDEO', numPoses: 2,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
      });
      try { return await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
      catch (e) { console.warn('GPU недоступен, переключаюсь на CPU:', e); return PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    })();

    try { this.landmarker = await Promise.race([load, timeout]); }
    catch (e) { throw e.name === 'PoseLoadError' ? e : U.err('PoseLoadError', e.message); }
  },

  /** Цикл распознавания: каждый новый кадр → позы в экранных координатах */
  startLoop(onPoses) {
    this.onPoses = onPoses;
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      const v = this.video;
      if (v && v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = v.currentTime;
        const ts = performance.now();
        try {
          const res = this.landmarker.detectForVideo(v, ts);
          const W = v.videoWidth, H = v.videoHeight;
          const poses = (res.landmarks || []).map(lm => Geo.fromRaw(lm, W, H, true));
          this.onPoses(poses, ts, { W, H, demo: false });
        } catch (e) { console.warn('detectForVideo:', e); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  stopLoop() { this.running = false; },

  /** Техническая ошибка → понятное объяснение с шагами */
  describeError(err) {
    const name = err?.name || 'UnknownError';
    const alias = { PermissionDeniedError: 'NotAllowedError', SecurityError: 'NotAllowedError', DevicesNotFoundError: 'NotFoundError', TrackStartError: 'NotReadableError', AbortError: 'NotReadableError' };
    const fileHint = location.protocol === 'file:'
      ? 'Файл открыт двойным кликом (file://) — запусти через localhost: <code>npx serve .</code>'
      : 'Нажми «Попробовать снова»';
    const catalog = {
      NotAllowedError: { icon: '⛔', title: 'Доступ к камере запрещён',
        text: 'Браузер или система заблокировали камеру для этой страницы (NotAllowedError).',
        steps: ['Нажми на значок 🔒 или 📷 слева от адресной строки',
                'В пункте «Камера» выбери «Разрешить» и обнови страницу',
                'Chrome: <code>chrome://settings/content/camera</code> — убери сайт из запрещённых',
                'Windows: Параметры → Конфиденциальность → Камера. macOS: Системные настройки → Конфиденциальность → Камера',
                fileHint] },
      InsecureContextError: { icon: '🔒', title: 'Нужен HTTPS или localhost',
        text: 'Браузеры дают камеру только защищённым страницам. Сейчас: ' + U.esc(location.origin === 'null' ? location.protocol : location.origin),
        steps: ['В папке проекта: <code>npx serve .</code> → <code>http://localhost:3000</code>',
                'Или: <code>python -m http.server 8000</code> → <code>http://localhost:8000</code>',
                'Или: VS Code → расширение Live Server → «Open with Live Server»',
                'Или задеплой на Vercel — там сразу HTTPS'] },
      NotFoundError: { icon: '🔍', title: 'Камера не найдена', text: 'Браузер не видит ни одной веб-камеры.',
        steps: ['Подключи камеру или открой шторку / включи её клавишей Fn', 'Перезапусти браузер и нажми «Попробовать снова»'] },
      NotReadableError: { icon: '📵', title: 'Камера занята другой программой', text: 'Камеру уже использует другое приложение.',
        steps: ['Закрой Zoom, Teams, Discord, OBS или другую вкладку с камерой', 'Нажми «Попробовать снова»'] },
      NotSupportedError: { icon: '🚫', title: 'Браузер не поддерживает камеру', text: 'В этом браузере нет getUserMedia.',
        steps: ['Открой игру в свежем Chrome, Edge или Firefox'] },
      PoseLoadError: { icon: '🧠', title: 'Нейросеть не загрузилась', text: 'Камера работает, но модель MediaPipe не скачалась.',
        steps: ['Проверь интернет', 'Отключи блокировщик рекламы для этой страницы', 'Нажми «Попробовать снова»'] }
    };
    const info = catalog[alias[name] || name] || { icon: '⚠️', title: 'Не удалось включить камеру', text: 'Непредвиденная ошибка.',
      steps: ['Обнови страницу и попробуй снова', 'Проверь разрешения камеры в браузере'] };
    return { ...info, code: `${name}: ${err?.message || ''}` };
  },

  /** Статус для стартового экрана — до нажатия «Начать» */
  async permissionStatus() {
    if (!window.isSecureContext) return { tone: 'bad', text: '🔒 Страница открыта не через HTTPS или localhost — камеры не будет. Запусти локальный сервер или включи симуляцию.' };
    if (!navigator.mediaDevices?.getUserMedia) return { tone: 'bad', text: '🚫 Браузер не поддерживает веб-камеру. Открой в Chrome, Edge или Firefox, либо включи симуляцию.' };
    try {
      const p = await navigator.permissions.query({ name: 'camera' });
      return {
        granted: { tone: 'ok', text: '✅ Камера разрешена — можно начинать.' },
        prompt: { tone: 'neutral', text: '📷 Браузер спросит разрешение на камеру при старте.' },
        denied: { tone: 'bad', text: '⛔ Камера заблокирована для сайта. Нажми 🔒 слева от адреса → Камера → Разрешить, или включи симуляцию.' }
      }[p.state] || { tone: 'neutral', text: '📷 Браузер спросит разрешение на камеру при старте.' };
    } catch {
      return { tone: 'neutral', text: '📷 Браузер спросит разрешение на камеру при старте.' };
    }
  }
};
