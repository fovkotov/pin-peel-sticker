import { createSticker } from "./vendor/sticker-forge.es.js";

const STICKER_H = 54;
const PAD = 64;
const PIN = "#A68AFF";
const CIRCLE_CX = 27;
const CIRCLE_CY = 27;
const CIRCLE_R = 21;
const MARK = 18;
const LABEL_GAP = 7;
const LABEL = "Яндекс Пин";

const INTERACTION_DEFAULTS = {
  peel: {
    radius: 0.15,
    stiffness: 0.26,
    grabWidth: 56,
    maxAngle: 3.35,
    detachThreshold: 0.54,
    residue: false,
    surfaceShadow: false,
    release: "snap",
  },
  tilt: 0,
  wind: 0,
  sound: { enabled: true, volume: 0.46 },
};

const target = document.querySelector("#sticker-target");
const reveal = document.querySelector("#sticker-reveal");
const stage = document.querySelector("#sticker-stage");
const hit = document.querySelector("#sticker-hit");
const slot = document.querySelector("#sticker-slot");
const sheet = document.querySelector("#index-sheet");
const tuner = document.querySelector("#sticker-tuner");
const tunerForm = document.querySelector("#tuner-form");

let stickerW = 351;
let stageW = stickerW + PAD * 2;
let stageH = STICKER_H + PAD * 2;
let bakedW = stickerW;
let bakedStageW = stageW;
let bakedStageH = stageH;
let sticker;
let teasing = true;
let teaseTimer = 0;
const meshOffset = { x: 0, y: 0 };
let layoutBound = false;
let layoutRaf = 0;
let layoutNeedsResize = false;

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Не загрузился ${src}`));
    img.src = src;
  });
}

async function waitForFonts() {
  await Promise.all([
    document.fonts.load('16px "YS Geo"'),
    document.fonts.load('400 16px "YS Geo"'),
  ]).catch(() => {});
  await document.fonts.ready;
}

async function makeStickerDataUrl() {
  await waitForFonts();

  const [arrow, mark] = await Promise.all([
    loadImage("./assets/arrow-right.svg"),
    loadImage("./assets/pin-mark.svg"),
  ]);

  const scale = 4;
  const canvas = document.createElement("canvas");
  canvas.width = stageW * scale;
  canvas.height = stageH * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(PAD, PAD);

  ctx.fillStyle = PIN;
  roundRect(ctx, 0, 0, stickerW, STICKER_H, STICKER_H / 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(CIRCLE_CX, CIRCLE_CY, CIRCLE_R, 0, Math.PI * 2);
  ctx.fill();

  ctx.drawImage(arrow, 17.3, 17.5, 19.5, 19);

  ctx.font = '400 16px "YS Geo", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(LABEL).width;
  const groupW = MARK + LABEL_GAP + textW;
  const groupX = (stickerW - groupW) / 2;
  ctx.drawImage(mark, groupX, (STICKER_H - MARK) / 2, MARK, MARK);
  ctx.fillText(LABEL, groupX + MARK + LABEL_GAP, STICKER_H / 2 + 0.5);

  return canvas.toDataURL("image/png");
}

function cancelTease() {
  teasing = false;
  if (teaseTimer) {
    cancelAnimationFrame(teaseTimer);
    teaseTimer = 0;
  }
}

function animatePeel(from, to, ms, motion) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (!teasing) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      sticker.setPeelProgress(from + (to - from) * eased, motion);
      if (t < 1) teaseTimer = requestAnimationFrame(tick);
      else resolve();
    };
    teaseTimer = requestAnimationFrame(tick);
  });
}

async function playTease() {
  const motion = {
    origin: { x: 0.02, y: 0.5 },
    target: { x: 0.28, y: 0.48 },
  };
  await new Promise((r) => setTimeout(r, 900));
  if (!teasing) return;
  await animatePeel(0, 0.2, 700, motion);
  if (!teasing) return;
  await new Promise((r) => setTimeout(r, 420));
  if (!teasing) return;
  await animatePeel(0.2, 0, 500, motion);
}

function disableHintOverlays(engine) {
  engine.startInteractionHint = () => {
    engine.interactionHintActive = false;
    engine.interactionHintElapsed = 0;
    if (engine.uniforms?.uInteractionHint) {
      engine.uniforms.uInteractionHint.value = 0;
    }
  };
  engine.interactionHintActive = false;
  engine.interactionHintElapsed = 0;
  if (engine.uniforms?.uInteractionHint) {
    engine.uniforms.uInteractionHint.value = 0;
  }
  engine.setBackgroundRemovalEffect?.(false);
}

function circleUV() {
  return {
    u0: (PAD + CIRCLE_CX) / bakedStageW,
    v0: (PAD + CIRCLE_CY) / bakedStageH,
    ru: (CIRCLE_R + 2) / bakedStageW,
    rv: (CIRCLE_R + 2) / bakedStageH,
  };
}

function circleLocalPoint(engine) {
  const { u0, v0 } = circleUV();
  const point = engine.grabOrigin.clone();
  point.set((u0 - 0.5) * engine.meshWidth, (0.5 - v0) * engine.meshHeight);
  return point;
}

function rightInward(engine) {
  const inward = engine.grabDirection.clone();
  inward.set(1, 0);
  return inward;
}

function hitCircleInterior(engine, local) {
  const { u0, v0, ru, rv } = circleUV();
  const u = local.x / engine.meshWidth + 0.5;
  const vCss = 0.5 - local.y / engine.meshHeight;
  const du = (u - u0) / ru;
  const dv = (vCss - v0) / rv;
  if (du * du + dv * dv > 1) return null;
  return { local: local.clone(), inward: rightInward(engine) };
}

function forceCircleGrab(engine) {
  return { local: circleLocalPoint(engine), inward: rightInward(engine) };
}

function enableFreePeelFromCircle(engine) {
  engine.hitEdge = (local) => hitCircleInterior(engine, local);
}

function measureSlot() {
  stickerW = Math.round(slot.getBoundingClientRect().width) || bakedW || 351;
  stageW = stickerW + PAD * 2;
  stageH = STICKER_H + PAD * 2;
}

function rememberBakeSize() {
  bakedW = stickerW;
  bakedStageW = stageW;
  bakedStageH = stageH;
}

function computeMeshOffset(engine) {
  const canvas = engine.renderer.domElement;
  const canvasRect = canvas.getBoundingClientRect();
  const slotRect = slot.getBoundingClientRect();
  const worldPerPxX = engine.viewWidth / Math.max(canvasRect.width, 1);
  const worldPerPxY = engine.viewHeight / Math.max(canvasRect.height, 1);
  const slotCx = slotRect.left + slotRect.width / 2;
  const slotCy = slotRect.top + slotRect.height / 2;
  const canvasCx = canvasRect.left + canvasRect.width / 2;
  const canvasCy = canvasRect.top + canvasRect.height / 2;
  meshOffset.x = (slotCx - canvasCx) * worldPerPxX;
  meshOffset.y = (canvasCy - slotCy) * worldPerPxY;
}

function applyMeshOffset(engine) {
  engine.stickerMesh.position.x = meshOffset.x;
  engine.stickerMesh.position.y = meshOffset.y;
  engine.residueMesh.position.x = meshOffset.x;
  engine.residueMesh.position.y = meshOffset.y;
}

function alignMeshToSlot(engine, force = false) {
  computeMeshOffset(engine);
  if (force || !engine.state.dragging) applyMeshOffset(engine);
}

function positionHit() {
  if (!hit) return;
  const slotRect = slot.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const sx = slotRect.width / Math.max(bakedW, 1);
  const sy = slotRect.height / STICKER_H;
  const cx = slotRect.left + CIRCLE_CX * sx;
  const cy = slotRect.top + CIRCLE_CY * sy;
  const radius = CIRCLE_R * Math.min(sx, sy);
  const size = (radius + 2) * 2;
  hit.style.width = `${size}px`;
  hit.style.height = `${size}px`;
  hit.style.left = `${cx - size / 2 - stageRect.left}px`;
  hit.style.top = `${cy - size / 2 - stageRect.top}px`;
}

function syncLayout({ resize = true } = {}) {
  if (!sticker?.renderer) return;
  if (resize) {
    measureSlot();
    sticker.setOptions({ display: { width: stageW, height: stageH } });
    sticker.resize();
  }
  alignMeshToSlot(sticker.renderer);
  positionHit();
  sticker.renderer.requestRender();
}

function scheduleLayoutSync(options) {
  if (options?.resize) layoutNeedsResize = true;
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    const resize = layoutNeedsResize;
    layoutNeedsResize = false;
    syncLayout({ resize });
  });
}

function bindLayoutWatchers() {
  if (layoutBound) return;
  layoutBound = true;

  const fullSync = () => scheduleLayoutSync({ resize: true });
  const alignOnly = () => scheduleLayoutSync({ resize: false });

  window.addEventListener("resize", fullSync);
  window.addEventListener("orientationchange", fullSync);
  window.visualViewport?.addEventListener("resize", fullSync);
  window.visualViewport?.addEventListener("scroll", alignOnly);

  const sidebar = document.querySelector(".sidebar");
  sidebar?.addEventListener("scroll", alignOnly, { passive: true });
  document.querySelector(".history")?.addEventListener("scroll", alignOnly, { passive: true });

  new ResizeObserver(fullSync).observe(slot);

  requestAnimationFrame(fullSync);
}

function bindFullscreenMesh(engine) {
  const originalScreenToLocal = engine.screenToLocal.bind(engine);
  engine.screenToLocal = (clientX, clientY) => {
    const local = originalScreenToLocal(clientX, clientY);
    local.x -= meshOffset.x;
    local.y -= meshOffset.y;
    return local;
  };

  const originalSetDetached = engine.setDetachedDragOffset.bind(engine);
  engine.setDetachedDragOffset = (x, y) => {
    originalSetDetached(x, y);
    engine.stickerMesh.position.x += meshOffset.x;
    engine.stickerMesh.position.y += meshOffset.y;
    engine.residueMesh.position.x = engine.stickerMesh.position.x;
    engine.residueMesh.position.y = engine.stickerMesh.position.y;
  };

  const originalReset = engine.reset.bind(engine);
  engine.reset = (...args) => {
    originalReset(...args);
    applyMeshOffset(engine);
  };

  const originalSetEntrance = engine.setEntranceProgress.bind(engine);
  engine.setEntranceProgress = (progress) => {
    originalSetEntrance(progress);
    applyMeshOffset(engine);
  };

  engine.startEntranceAnimation = () => {
    engine.reset();
  };
  engine.entranceActive = false;
  engine.clearEntrancePose?.();

  const originalResize = engine.resize.bind(engine);
  engine.resize = () => {
    originalResize();
    alignMeshToSlot(engine);
    positionHit();
  };

  const canvas = engine.renderer.domElement;
  canvas.style.pointerEvents = "none";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.setPointerCapture = (id) => {
    try {
      hit.setPointerCapture(id);
    } catch {
      /* the hit layer may already own the pointer */
    }
  };
  canvas.releasePointerCapture = (id) => {
    try {
      hit.releasePointerCapture(id);
    } catch {
      /* already released */
    }
  };
  canvas.hasPointerCapture = (id) => hit.hasPointerCapture(id);

  hit.addEventListener("pointerdown", (event) => {
    if (stage.classList.contains("is-detached")) return;
    event.preventDefault();
    cancelTease();
    const patched = engine.hitEdge;
    engine.hitEdge = (local) => patched.call(engine, local) || forceCircleGrab(engine);
    try {
      engine.onPointerDown(event);
    } finally {
      engine.hitEdge = patched;
    }
  });
  hit.addEventListener("pointermove", (event) => {
    engine.onPointerMove(event);
  });
  hit.addEventListener("pointerup", (event) => {
    engine.onPointerUp(event);
  });
  hit.addEventListener("pointercancel", (event) => {
    engine.onPointerUp(event);
  });
}

function openSheet() {
  sheet?.classList.add("is-open");
  sheet?.setAttribute("aria-hidden", "false");
}

function hideSheet() {
  sheet?.classList.remove("is-open");
  sheet?.setAttribute("aria-hidden", "true");
}

function hideSticker() {
  stage.classList.add("is-detached");
}

function showSticker() {
  stage.classList.remove("is-detached");
}

function resetSticker() {
  if (!sticker) return;
  cancelTease();
  hideSheet();
  reveal.classList.remove("is-done");
  reveal.style.opacity = "1";
  sticker.reset();
  showSticker();
  positionHit();
}

function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = (el.type || "text").toLowerCase();
  return (
    type === "text" ||
    type === "password" ||
    type === "search" ||
    type === "email" ||
    type === "url" ||
    type === "tel" ||
    type === "number"
  );
}

function formatTunerValue(name, value) {
  const n = Number(value);
  if (name === "peel.grabWidth") return String(Math.round(n));
  if (name === "tilt") return Number.isInteger(n) ? String(n) : n.toFixed(1);
  return n.toFixed(2);
}

function syncTunerLabels() {
  tunerForm?.querySelectorAll(".tuner__row").forEach((row) => {
    const input = row.querySelector("input[type='range']");
    const label = row.querySelector(".tuner__value");
    if (!input || !label) return;
    label.textContent = formatTunerValue(input.name, input.value);
  });
}

function readTunerOptions() {
  const data = new FormData(tunerForm);
  const checked = (name) => Boolean(tunerForm?.elements.namedItem(name)?.checked);
  return {
    peel: {
      radius: Number(data.get("peel.radius")),
      stiffness: Number(data.get("peel.stiffness")),
      grabWidth: Number(data.get("peel.grabWidth")),
      maxAngle: Number(data.get("peel.maxAngle")),
      detachThreshold: Number(data.get("peel.detachThreshold")),
      residue: checked("peel.residue"),
      surfaceShadow: checked("peel.surfaceShadow"),
      release: String(data.get("peel.release") || "snap"),
    },
    tilt: Number(data.get("tilt")),
    wind: Number(data.get("wind")),
    sound: {
      enabled: checked("sound.enabled"),
      volume: Number(data.get("sound.volume")),
    },
  };
}

function fillTuner(options) {
  if (!tunerForm) return;
  const set = (name, value) => {
    const field = tunerForm.elements.namedItem(name);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = String(value);
  };
  set("peel.radius", options.peel.radius);
  set("peel.stiffness", options.peel.stiffness);
  set("peel.grabWidth", options.peel.grabWidth);
  set("peel.maxAngle", options.peel.maxAngle);
  set("peel.detachThreshold", options.peel.detachThreshold);
  set("peel.release", options.peel.release);
  set("peel.residue", options.peel.residue);
  set("peel.surfaceShadow", options.peel.surfaceShadow);
  set("tilt", options.tilt);
  set("wind", options.wind);
  set("sound.enabled", options.sound.enabled);
  set("sound.volume", options.sound.volume);
  syncTunerLabels();
}

function applyTuner() {
  if (!sticker) return;
  sticker.setOptions(readTunerOptions());
}

function setTunerOpen(open) {
  if (!tuner) return;
  tuner.hidden = !open;
  tuner.setAttribute("aria-hidden", open ? "false" : "true");
}

function toggleTuner() {
  setTunerOpen(Boolean(tuner?.hidden));
}

function bindTuner() {
  if (!tuner || !tunerForm || tuner.dataset.bound) return;
  tuner.dataset.bound = "1";
  fillTuner(INTERACTION_DEFAULTS);
  tunerForm.addEventListener("submit", (event) => event.preventDefault());
  tunerForm.addEventListener("input", () => {
    syncTunerLabels();
    applyTuner();
  });
  tunerForm.addEventListener("change", applyTuner);
  document.querySelector("#tuner-reset")?.addEventListener("click", () => {
    fillTuner(INTERACTION_DEFAULTS);
    applyTuner();
  });
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const isG = event.code === "KeyG" || event.key === "g" || event.key === "G";
    if (!isG) return;
    if (isTypingTarget(event.target)) return;
    if (document.querySelector("#gate")) return;
    event.preventDefault();
    toggleTuner();
  });
}

async function start() {
  measureSlot();
  rememberBakeSize();

  const src = await makeStickerDataUrl();

  sticker = await createSticker(target, {
    source: {
      type: "image",
      src,
      name: "yandex-pin.png",
      padding: 0,
    },
    display: { width: stageW, height: stageH },
    outline: { width: 0, color: PIN },
    edge: { width: 1.6, strength: 0.55 },
    shadow: {
      color: "#3b2a63",
      opacity: 0,
      blur: 0,
      distance: 0,
      angle: 48,
    },
    lighting: {
      direction: { x: -0.42, y: 0.48, z: 0.76 },
      intensity: 0.92,
      ambient: 0.42,
      softness: 0.55,
    },
    peel: { ...INTERACTION_DEFAULTS.peel },
    back: { color: "#c9c9ce", gloss: 0.88, roughness: 0.16 },
    material: { type: "original", intensity: 0.7, scale: 1 },
    sound: { ...INTERACTION_DEFAULTS.sound },
    tilt: INTERACTION_DEFAULTS.tilt,
    wind: INTERACTION_DEFAULTS.wind,
    quality: "high",
  });

  enableFreePeelFromCircle(sticker.renderer);
  disableHintOverlays(sticker.renderer);
  sticker.setBackgroundRemovalEffect?.(false);
  bindFullscreenMesh(sticker.renderer);
  sticker.renderer.entranceActive = false;
  sticker.renderer.reset();
  alignMeshToSlot(sticker.renderer, true);
  positionHit();
  sticker.renderer.requestRender();
  stage.classList.add("is-ready");

  target.addEventListener("peelstart", () => {
    cancelTease();
    stage.classList.add("is-peeling");
  });

  target.addEventListener("peelchange", (event) => {
    if (stage.classList.contains("is-detached")) return;
    reveal.style.opacity = String(0.35 + event.detail.progress * 0.65);
  });

  target.addEventListener("peelend", () => {
    stage.classList.remove("is-peeling");
  });

  target.addEventListener("detachcomplete", () => {
    reveal.classList.add("is-done");
    hideSticker();
    openSheet();
  });

  reveal.addEventListener("click", () => {
    if (reveal.classList.contains("is-done")) resetSticker();
  });

  sheet?.addEventListener("click", () => {
    resetSticker();
  });

  bindLayoutWatchers();

  playTease();
}

bindTuner();
start().catch(console.error);
