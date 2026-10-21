/*
  Fundo animado conforme o tempo atual.
  Uso: setWeatherFx({ kind, isDay, temp, wind, cover, intensity })
    kind: 'clear' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog'
    temp: °C   wind: km/h
    cover: 'none' | 'few' | 'partial' | 'overcast'   intensity: 0 a 1 (chuva e neve)
*/
(() => {
  const canvas = document.getElementById('fx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  let w = 0, h = 0, pw = 0, ph = 0;
  let scene = null, opts = null, curKey = '';
  let raf = 0, last = 0, swapTimer = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function softCircle(x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Nuvens que atravessam a tela (a velocidade acompanha o vento) */
  function clouds({ count, rgb, alpha, speed, top = 0.04, bottom = 0.45 }) {
    const list = Array.from({ length: count }, () => {
      const s = rnd(0.7, 1.5);
      return {
        x: rnd(-250, w), y: rnd(h * top, h * bottom), s, v: rnd(8, 18) * s * speed,
        puffs: Array.from({ length: 6 }, (_, k) => ({
          dx: (k - 2.5) * rnd(34, 46),
          dy: rnd(-12, 10) - (2.5 - Math.abs(k - 2.5)) * 6,
          r: rnd(46, 68) - Math.abs(k - 2.5) * 6,
        })),
      };
    });
    return (dt) => {
      for (const c of list) {
        c.x += c.v * dt;
        if (c.x > w + 260 * c.s) c.x = -260 * c.s;
        for (const p of c.puffs) softCircle(c.x + p.dx * c.s, c.y + p.dy * c.s, p.r * c.s, rgb, alpha);
      }
    };
  }

  /* Sol: quanto mais quente, maior, mais intenso e mais alaranjado */
  function sun(warm, rays) {
    const col = `255,${Math.round(lerp(250, 196, warm))},${Math.round(lerp(235, 100, warm))}`;
    const R = lerp(32, 46, warm);
    return (dt, t) => {
      const cx = w * 0.78;
      const cy = Math.min(h * 0.17, 170);
      softCircle(cx, cy, lerp(220, 380, warm), col, 0.5);
      if (rays) {
        const n = warm > 0.7 ? 16 : 12;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.05);
        ctx.strokeStyle = `rgba(${col},0.4)`;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const r0 = R * 1.4;
          const r1 = R * (1.9 + warm * 0.6) + Math.sin(t * 1.5 + i) * 8;
          ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        }
        ctx.stroke();
        ctx.restore();
      }
      softCircle(cx, cy, R * 1.5, col, 0.9);
      ctx.fillStyle = 'rgba(255,252,235,0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    };
  }

  /* Noite: estrelas piscando e lua */
  function night() {
    const n = clamp(Math.round((w * h) / 9000), 40, 160);
    const stars = Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random() * 0.8, r: rnd(0.5, 1.6), ph: rnd(0, 6.28), sp: rnd(0.8, 2.2),
    }));
    return (dt, t) => {
      ctx.fillStyle = '#fff';
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const cx = w * 0.8;
      const cy = Math.min(h * 0.16, 150);
      softCircle(cx, cy, 170, '200,215,255', 0.35);
      ctx.fillStyle = 'rgba(246,249,255,0.96)';
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(205,214,236,0.55)';
      ctx.beginPath();
      ctx.arc(cx - 9, cy - 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + 10, cy + 8, 4.5, 0, Math.PI * 2);
      ctx.fill();
    };
  }

  /* Chuva (e tempestade, com relâmpagos) */
  function rain({ intensity, wind, dark, storm }) {
    const count = Math.min(700, Math.round((w * h) / 2200 * intensity) + 30);
    const slant = clamp(wind / 50, 0, 1) * 0.45 + (storm ? 0.15 : 0);
    const rgb = dark ? '35,60,95' : '210,222,242';
    const spawn = (anywhere) => ({
      x: rnd(-h * slant - 50, w + 50),
      y: anywhere ? rnd(-h, h) : rnd(-120, -10),
      len: rnd(10, 22) * (0.7 + intensity * 0.6),
      v: rnd(620, 900) * (0.7 + intensity * 0.5),
    });
    const drops = Array.from({ length: count }, () => spawn(true));
    const sky = clouds({
      count: 4,
      rgb: dark ? '90,105,125' : storm ? '40,44,66' : '30,40,60',
      alpha: dark ? 0.25 : 0.5,
      speed: 1 + wind / 40,
      top: -0.02,
      bottom: 0.25,
    });

    let flash = 0, again = false, wait = rnd(2, 5), bolt = null;
    const makeBolt = () => {
      let x = rnd(w * 0.15, w * 0.85), y = 0;
      const pts = [[x, y]];
      while (y < h * 0.55) { y += rnd(25, 55); x += rnd(-30, 30); pts.push([x, y]); }
      return pts;
    };

    return (dt) => {
      sky(dt);
      ctx.strokeStyle = `rgba(${rgb},${dark ? 0.45 : 0.5})`;
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const d of drops) {
        d.y += d.v * dt;
        d.x += d.v * slant * dt;
        if (d.y > h + 20) Object.assign(d, spawn(false));
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * slant, d.y - d.len);
      }
      ctx.stroke();

      if (!storm) return;
      wait -= dt;
      if (wait <= 0) { flash = 1; again = true; wait = rnd(3, 8); bolt = makeBolt(); }
      if (flash > 0) {
        flash -= dt * 4;
        if (flash <= 0 && again) { flash = 0.7; again = false; }
        if (flash > 0) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(flash, 1) * 0.2})`;
          ctx.fillRect(0, 0, w, h);
          if (bolt) {
            ctx.save();
            ctx.strokeStyle = `rgba(255,255,255,${Math.min(flash, 1)})`;
            ctx.lineWidth = 2.2;
            ctx.shadowColor = 'rgba(190,210,255,0.9)';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    };
  }

  /* Neve */
  function snow({ intensity, wind, day }) {
    const count = Math.min(400, Math.round((w * h) / 5000 * intensity) + 25);
    const rgb = day ? '110,140,185' : '255,255,255';
    const drift = clamp(wind / 40, 0, 1) * 40;
    const flakes = Array.from({ length: count }, () => ({
      x: rnd(0, w), y: rnd(0, h), r: rnd(1.2, 3.6), v: rnd(25, 60), ph: rnd(0, 6.28), sw: rnd(10, 30),
    }));
    return (dt, t) => {
      ctx.fillStyle = `rgba(${rgb},0.8)`;
      ctx.beginPath();
      for (const f of flakes) {
        f.y += f.v * dt * (0.6 + f.r / 4);
        f.x += drift * dt;
        if (f.y > h + 10) { f.y = -10; f.x = rnd(0, w); }
        if (f.x > w + 10) f.x = -10;
        const x = f.x + Math.sin(t * 0.8 + f.ph) * f.sw;
        ctx.moveTo(x + f.r, f.y);
        ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };
  }

  /* Neblina: faixas largas e suaves deslizando devagar */
  function fog({ day }) {
    const rgb = day ? '255,255,255' : '170,182,195';
    const alpha = day ? 0.3 : 0.18;
    const bands = Array.from({ length: 6 }, (_, i) => ({
      x: rnd(-200, w), y: h * (0.15 + i * 0.14), v: rnd(6, 16) * (i % 2 ? 1 : -1), r: rnd(0.2, 0.3),
    }));
    return (dt) => {
      for (const b of bands) {
        b.x += b.v * dt;
        if (b.x > w + 300) b.x = -300;
        if (b.x < -300) b.x = w + 300;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(3.5, 1);
        softCircle(0, 0, h * b.r, rgb, alpha);
        ctx.restore();
      }
    };
  }

  /* Escolhe a cena de acordo com o tempo atual */
  function build(o) {
    const day = o.isDay;
    const speed = 0.6 + clamp(o.wind / 40, 0, 1) * 1.4;
    const warm = clamp((o.temp - 10) / 25, 0, 1); // 0 = frio, 1 = muito quente
    const draws = [];

    switch (o.kind) {
      case 'clear':
        draws.push(day ? sun(warm, true) : night());
        if (o.cover === 'few') {
          draws.push(clouds({ count: 3, rgb: day ? '255,255,255' : '210,220,240', alpha: day ? 0.45 : 0.12, speed, top: 0.08, bottom: 0.4 }));
        }
        break;
      case 'cloud':
        if (o.cover === 'partial') draws.push(day ? sun(warm, false) : night());
        draws.push(clouds({ count: o.cover === 'overcast' ? 8 : 5, rgb: day ? '255,255,255' : '205,215,235', alpha: day ? 0.5 : 0.14, speed }));
        break;
      case 'rain':
        draws.push(rain({ intensity: o.intensity, wind: o.wind, dark: day }));
        break;
      case 'storm':
        draws.push(rain({ intensity: 1, wind: o.wind, dark: false, storm: true }));
        break;
      case 'snow':
        draws.push(snow({ intensity: o.intensity, wind: o.wind, day }));
        break;
      case 'fog':
        draws.push(fog({ day }));
        break;
    }
    return (dt, t) => draws.forEach((d) => d(dt, t));
  }

  /* Laço de animação */
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.clearRect(0, 0, w, h);
    scene(dt, now / 1000);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    raf = 0;
    ctx.clearRect(0, 0, w, h);
    if (!scene) return;
    if (reduceMotion.matches) { scene(0, 0); return; } // quadro estático
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  window.setWeatherFx = (o) => {
    const key = [o.kind, o.isDay, o.cover, o.intensity, Math.round(o.temp), Math.round(o.wind / 5)].join('|');
    if (key === curKey) return;
    curKey = key;
    opts = o;
    clearTimeout(swapTimer);
    if (!scene) { scene = build(o); start(); return; }
    canvas.style.opacity = '0';
    swapTimer = setTimeout(() => {
      scene = build(o);
      start();
      canvas.style.opacity = '1';
    }, 600);
  };

  window.addEventListener('resize', () => {
    resize();
    const changed = Math.abs(w - pw) > 50 || Math.abs(h - ph) > 150;
    if (opts && changed) { scene = build(opts); pw = w; ph = h; }
    if (changed || reduceMotion.matches) start();
  });
  reduceMotion.addEventListener('change', start);

  resize();
  pw = w;
  ph = h;
})();
