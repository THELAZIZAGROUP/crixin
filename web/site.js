/**
 * Shared marketing-site enhancements: pulsing-ember canvas, scroll-aware
 * header, and entrance-reveal IO. Drop a single <script src="/site.js" defer>
 * tag on every page that wants the unified treatment.
 *
 * Expected markup on the page:
 *   <canvas id="embers"></canvas>          (anywhere; the script positions it)
 *   <header class="site" id="site-header">…</header>
 *   <... class="reveal">…</...>            (any element you want fade-in on)
 */

(function () {
  // ----- 1. Page-wide pulsing ember field --------------------------------
  const canvas = document.getElementById("embers");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    const sparks = [];
    const orbs = [];
    const N_SPARKS = 60;
    const N_ORBS = 18;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawnSpark(s) {
      s.x = Math.random() * w;
      s.y = h + Math.random() * 80;
      s.vy = -(0.2 + Math.random() * 0.6);
      s.vx = (Math.random() - 0.5) * 0.15;
      s.r = Math.random() * 1.4 + 0.4;
      s.life = 0;
      s.maxLife = 600 + Math.random() * 1200;
      s.phase = Math.random() * Math.PI * 2;
    }
    function spawnOrb(o) {
      o.x = Math.random() * w;
      o.y = Math.random() * h;
      o.vx = (Math.random() - 0.5) * 0.06;
      o.vy = (Math.random() - 0.5) * 0.06;
      o.r = 1.6 + Math.random() * 2.6;
      o.phase = Math.random() * Math.PI * 2;
    }
    function init() {
      sparks.length = 0;
      orbs.length = 0;
      for (let i = 0; i < N_SPARKS; i++) {
        const s = {};
        spawnSpark(s);
        s.y = Math.random() * h;
        sparks.push(s);
      }
      for (let i = 0; i < N_ORBS; i++) {
        const o = {};
        spawnOrb(o);
        orbs.push(o);
      }
    }

    let lastT = performance.now();
    function tick(t) {
      const dt = Math.min(40, t - lastT);
      lastT = t;
      ctx.clearRect(0, 0, w, h);

      for (const o of orbs) {
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (o.x < -20) o.x = w + 20;
        if (o.x > w + 20) o.x = -20;
        if (o.y < -20) o.y = h + 20;
        if (o.y > h + 20) o.y = -20;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.0014 + o.phase);
        const a = 0.10 + pulse * 0.18;
        const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 8);
        grad.addColorStop(0, "rgba(245, 180, 82, " + a + ")");
        grad.addColorStop(1, "rgba(245, 180, 82, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(o.x - o.r * 8, o.y - o.r * 8, o.r * 16, o.r * 16);
        ctx.fillStyle = "rgba(250, 208, 142, " + (0.45 + pulse * 0.3) + ")";
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const s of sparks) {
        s.life += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.life > s.maxLife || s.y < -20) spawnSpark(s);
        const lifeT = s.life / s.maxLife;
        const flicker = 0.6 + 0.4 * Math.sin(t * 0.005 + s.phase);
        const a = (1 - lifeT) * 0.85 * flicker;
        ctx.fillStyle = "rgba(245, 180, 82, " + a + ")";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(tick);
    }
    window.addEventListener("resize", () => { resize(); init(); });
    resize();
    init();
    requestAnimationFrame(tick);
  }

  // ----- 2. Scroll-aware header ----------------------------------------
  const h = document.getElementById("site-header");
  if (h) {
    const onScroll = () => h.classList.toggle("scrolled", window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // ----- 3. Reveal-on-intersect ----------------------------------------
  const reveals = document.querySelectorAll(".reveal, .reveal-stagger");
  if (reveals.length && "IntersectionObserver" in window) {
    document.body.classList.add("has-reveal");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  }
})();
