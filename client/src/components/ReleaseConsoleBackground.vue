<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const canvasRef = ref(null);
const mouse = ref({ x: -2000, y: -2000 });

let raf = 0;
let particles = [];
let w = 0;
let h = 0;
let ctx = null;
let ParticleClass = null;
let cleanup = () => {};

function onMove(e) {
  mouse.value = { x: e.clientX, y: e.clientY };
}

function resize(canvas) {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  if (!ctx) return;

  const gap = 55;
  const rows = 28;
  const cols = 48;
  const startZ = -400;

  ParticleClass = class Particle3D {
    constructor(x, z) {
      this.baseX = x;
      this.baseZ = z;
      this.x = x;
      this.y = 0;
      this.z = z;
      this.size = 1.6;
      this.phase = Math.random() * Math.PI * 2;
    }

    update(time) {
      const distFromCenter = Math.sqrt(
        (this.baseX - w / 2) ** 2 + (this.baseZ - 300) ** 2,
      );
      this.y =
        Math.sin(time + this.baseX * 0.002 + this.baseZ * 0.003) * 75;
      this.y += Math.cos(time * 0.6 + distFromCenter * 0.007) * 45;
      const mx = mouse.value.x - this.baseX;
      const my = mouse.value.y - (this.y + h / 1.8);
      const dist = Math.sqrt(mx * mx + my * my);
      if (dist < 270) {
        this.y += (270 - dist) * 0.35;
      }
    }

    draw() {
      const perspective = 1100;
      const zPos = this.baseZ + 550;
      const fov = perspective / (perspective + zPos);
      const screenX = (this.baseX - w / 2) * fov + w / 2;
      const screenY = (this.y + 380) * fov + h / 2;
      const scaleSize = this.size * fov * 2.8;
      const alpha = Math.max(0.05, Math.min(0.9, fov * 0.9));
      ctx.fillStyle = `rgba(34, 211, 238, ${alpha})`;
      ctx.beginPath();
      ctx.arc(screenX, screenY, scaleSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = fov > 0.7 ? 25 * fov : 4;
      ctx.shadowColor =
        fov > 0.7 ? '#06b6d4' : 'rgba(6, 182, 212, 0.4)';
    }
  };

  function init() {
    particles = [];
    const startX = (w - cols * gap) / 2;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        particles.push(
          new ParticleClass(startX + c * gap, startZ + r * gap),
        );
      }
    }
  }

  function animate() {
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      w,
    );
    grad.addColorStop(0, '#0a1428');
    grad.addColorStop(1, '#050508');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const time = Date.now() * 0.002;
    particles.forEach((p) => {
      p.update(time);
      p.draw();
    });
    raf = requestAnimationFrame(animate);
  }

  function onResize() {
    resize(canvas);
    init();
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMove);
  onResize();
  animate();

  cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', onMove);
  };
});

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="bg-root" aria-hidden="true">
    <canvas ref="canvasRef" class="bg-canvas" />
    <div
      class="spotlight"
      :style="{
        transform: `translate(${mouse.x - 350}px, ${mouse.y - 350}px)`,
      }"
    />
    <svg
      class="bg-waves"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <path
        d="M0 150 Q 300 80 600 200 T 1200 150"
        stroke="rgba(6, 182, 212, 0.1)"
        fill="transparent"
        stroke-width="1"
      />
      <path
        d="M0 300 Q 400 350 800 150 T 1400 300"
        stroke="rgba(6, 182, 212, 0.08)"
        fill="transparent"
        stroke-width="1"
      />
      <path
        d="M0 450 Q 250 400 500 550 T 1200 450"
        stroke="rgba(6, 182, 212, 0.12)"
        fill="transparent"
        stroke-width="1"
      />
    </svg>
  </div>
</template>

<style scoped>
.bg-root {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.bg-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.spotlight {
  position: absolute;
  left: 0;
  top: 0;
  width: 700px;
  height: 700px;
  border-radius: 50%;
  background: rgba(6, 182, 212, 0.1);
  filter: blur(150px);
  mix-blend-mode: overlay;
  will-change: transform;
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.bg-waves {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.2;
}
</style>
