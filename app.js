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

const target = document.querySelector("#sticker-target");
const reveal = document.querySelector("#sticker-reveal");
const stage = document.querySelector("#sticker-stage");
const slot = document.querySelector("#sticker-slot");
const sheet = document.querySelector("#index-sheet");

let stickerW = 351;
let stageW = stickerW + PAD * 2;
let stageH = STICKER_H + PAD * 2;
let sticker;
let teasing = true;
let teaseTimer = 0;

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

function enableFreePeelFromCircle(engine) {
  const hitR = CIRCLE_R + 1;
  const u0 = (PAD + CIRCLE_CX) / stageW;
  const cssV0 = (PAD + CIRCLE_CY) / stageH;
  const ru = hitR / stageW;
  const rv = hitR / stageH;

  engine.hitEdge = (local) => {
    const u = local.x / engine.meshWidth + 0.5;
    const v = local.y / engine.meshHeight + 0.5;
    const du = (u - u0) / ru;
    const dv = (1 - v - cssV0) / rv;
    if (du * du + dv * dv > 1) return null;

    const grab = local.clone();
    const inward = engine.grabDirection.clone();
    const mx = local.x - (u0 - 0.5) * engine.meshWidth;
    const my = local.y - (0.5 - cssV0) * engine.meshHeight;
    if (mx * mx + my * my < 1e-8) inward.set(1, 0);
    else inward.set(mx, my).normalize();
    return { local: grab, inward };
  };
}

function openSheet() {
  sheet?.classList.add("is-open");
  sheet?.setAttribute("aria-hidden", "false");
}

function hideSheet() {
  sheet?.classList.remove("is-open");
  sheet?.setAttribute("aria-hidden", "true");
}

function resetSticker() {
  if (!sticker) return;
  cancelTease();
  hideSheet();
  reveal.classList.remove("is-done");
  reveal.style.opacity = "1";
  stage.style.pointerEvents = "auto";
  sticker.reset();
}

async function start() {
  stickerW = Math.round(slot.getBoundingClientRect().width) || 351;
  stageW = stickerW + PAD * 2;
  stageH = STICKER_H + PAD * 2;
  stage.style.width = `${stageW}px`;
  stage.style.height = `${stageH}px`;

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
    peel: {
      radius: 0.48,
      stiffness: 0.7,
      grabWidth: 56,
      maxAngle: 3.35,
      detachThreshold: 0.66,
      residue: false,
      surfaceShadow: false,
      release: "snap",
    },
    back: { color: "#c9c9ce", gloss: 0.88, roughness: 0.16 },
    material: { type: "original", intensity: 0.7, scale: 1 },
    sound: { enabled: true, volume: 0.46 },
    tilt: 0,
    wind: 0,
    quality: "high",
  });

  enableFreePeelFromCircle(sticker.renderer);
  disableHintOverlays(sticker.renderer);
  sticker.setBackgroundRemovalEffect?.(false);

  target.addEventListener("pointerdown", cancelTease, { once: true });

  target.addEventListener("peelstart", () => {
    cancelTease();
    stage.classList.add("is-peeling");
  });

  target.addEventListener("peelchange", (event) => {
    reveal.style.opacity = String(0.35 + event.detail.progress * 0.65);
  });

  target.addEventListener("peelend", () => {
    stage.classList.remove("is-peeling");
  });

  target.addEventListener("detachcomplete", () => {
    reveal.classList.add("is-done");
    stage.style.pointerEvents = "none";
    openSheet();
  });

  reveal.addEventListener("click", () => {
    if (reveal.classList.contains("is-done")) resetSticker();
  });

  sheet?.addEventListener("click", () => {
    resetSticker();
  });

  playTease();
}

start().catch(console.error);
