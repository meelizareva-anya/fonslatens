/* ==== scripts/core.js ==== */
/*
 * core.js — shared runtime for every module.
 *
 * Exposes a single global namespace `FL` so feature modules stay decoupled:
 *   FL.$ / FL.$$      — query helpers
 *   FL.store          — localStorage that never throws (private mode, sandboxed previews)
 *   FL.reduceMotion   — prefers-reduced-motion at load
 *   FL.on / FL.emit   — tiny event bus ('lang', 'theme')
 *   FL.lang()         — current language ('en' | 'ru')
 *   FL.colors         — canvas colours resolved from CSS tokens, refreshed on 'theme'
 *   FL.L(en, ru)      — pick a string for the current language
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var listeners = {};

  var FL = {
    root: root,
    $: function (sel, ctx) { return (ctx || document).querySelector(sel); },
    $$: function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); },
    reduceMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,

    store: {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
    },

    on: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit: function (evt, payload) { (listeners[evt] || []).forEach(function (fn) { fn(payload); }); },

    lang: function () { return root.getAttribute('data-lang') === 'ru' ? 'ru' : 'en'; },
    L: function (en, ru) { return FL.lang() === 'ru' ? ru : en; },

    /* Canvas colours. Canvas cannot read CSS variables, so they are resolved once per theme change. */
    colors: {},
    readColors: function () {
      var cs = getComputedStyle(root), c = FL.colors;
      c.dot = cs.getPropertyValue('--dot').trim();
      c.neon = cs.getPropertyValue('--neon').trim();
      c.ink = cs.getPropertyValue('--neon-ink').trim();
      c.fg3 = cs.getPropertyValue('--fg-3').trim();
      c.line = cs.getPropertyValue('--line-2').trim();
      c.light = root.getAttribute('data-theme') === 'light';
    },

    /* Canvas backing store sized for the element at device pixel ratio (capped at 2 for performance). */
    fitCanvas: function (canvas, box) {
      var r = box.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = r.width * d;
      canvas.height = r.height * d;
      canvas.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
      return { w: r.width, h: r.height };
    },

    /*
     * One shared requestAnimationFrame loop for all canvases.
     * A task is { active: () => bool, tick: () => void }; the loop stops when no task is active
     * (e.g. both canvases scrolled out of view) and FL.kick() restarts it.
     */
    animate: function (task) { tasks.push(task); },
    kick: function () {
      if (FL.reduceMotion || raf) return;
      if (tasks.some(function (t) { return t.active(); })) raf = requestAnimationFrame(frame);
    }
  };

  var tasks = [], raf = 0;
  function frame() {
    var any = false;
    tasks.forEach(function (t) { if (t.active()) { t.tick(); any = true; } });
    raf = any ? requestAnimationFrame(frame) : 0;
  }

  window.FL = FL;
})();

/* ==== scripts/prefs.js ==== */
/*
 * prefs.js — language (EN/RU) and colour theme (dark/light), both remembered per viewer.
 * Text in both languages is always in the DOM (.en / .ru); CSS hides one by html[data-lang].
 * Emits 'lang' and 'theme' so canvases and dynamic widgets can redraw.
 */
(function (FL) {
  'use strict';

  var root = FL.root, $ = FL.$, store = FL.store;
  var KEY_LANG = 'fl-lang', KEY_THEME = 'fl-theme';

  function setLang(l) {
    root.setAttribute('data-lang', l);
    root.lang = l;
    $('#lang-ru').setAttribute('aria-pressed', String(l === 'ru'));
    $('#lang-en').setAttribute('aria-pressed', String(l === 'en'));
    store.set(KEY_LANG, l);
    FL.emit('lang', l);
  }

  function setTheme(t) {
    root.setAttribute('data-theme', t);
    store.set(KEY_THEME, t);
    paintThemeButton(t);
    $('#theme-btn').setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    FL.readColors();
    FL.emit('theme', t);
  }

  function paintThemeButton(t) {
    $('#theme-label').textContent = t === 'light' ? 'LIGHT' : 'DARK';
  }

  $('#lang-ru').addEventListener('click', function () { setLang('ru'); });
  $('#lang-en').addEventListener('click', function () { setLang('en'); });
  $('#theme-btn').addEventListener('click', function () {
    setTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  /* Restore the theme before any canvas reads colours; language is restored in boot.js after widgets exist. */
  var saved = store.get(KEY_THEME);
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
  if (root.getAttribute('data-theme') !== 'light') root.setAttribute('data-theme', 'dark');
  FL.readColors();
  paintThemeButton(root.getAttribute('data-theme'));

  FL.prefs = {
    setLang: setLang,
    restoreLang: function () { setLang(store.get(KEY_LANG) === 'ru' ? 'ru' : 'en'); }
  };
})(window.FL);

/* ==== scripts/nav.js ==== */
/*
 * nav.js — header behaviour: pages menu, reading-progress line, section scroll-spy,
 * and the --hh custom property (live header height, used by sticky elements and scroll-padding).
 */
(function (FL) {
  'use strict';

  var $ = FL.$, $$ = FL.$$, root = FL.root;

  /* Pages menu (Home, three audience pages, News) */
  var menu = $('#menu'), menuBtn = $('#menu-btn');
  function setMenu(open) {
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }
  menuBtn.addEventListener('click', function (e) { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('click', function (e) { if (!menu.hidden && !e.target.closest('#menu')) setMenu(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); }
  });

  /* Reading progress */
  var progress = $('#progress');
  function onScroll() {
    var h = root.scrollHeight - innerHeight;
    progress.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h) : 0);
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Scroll-spy for the sticky section bar; keeps the active link in view on narrow screens */
  var links = $$('nav a[data-spy]'), bar = $('.secnav-in');
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.toggle('active', a.dataset.spy === e.target.id); });
      var act = bar && bar.querySelector('a.active');
      if (!act) return;
      var l = act.offsetLeft - bar.offsetLeft, r = l + act.offsetWidth;
      if (l < bar.scrollLeft + 24 || r > bar.scrollLeft + bar.clientWidth - 24) {
        bar.scrollTo({ left: Math.max(0, l - 40), behavior: 'smooth' });
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(function (s) { spy.observe(s); });

  /* Header height → --hh (the section bar hides on sub-pages, so it changes with the route) */
  function setHeaderHeight() {
    var h = $('header');
    if (h) root.style.setProperty('--hh', h.offsetHeight + 'px');
  }
  setHeaderHeight();
  addEventListener('resize', setHeaderHeight);
  addEventListener('hashchange', function () { requestAnimationFrame(setHeaderHeight); });
})(window.FL);

/* ==== scripts/hero-strata.js ==== */
/*
 * hero-strata.js — the hero's point-cloud cross-section of rock layers.
 *
 * Seven layers × N rows of dots drift slowly; a "He signal" zone glows neon.
 * The pointer acts as a probe: dots near it are pushed out with a ripple and a
 * readout shows schematic depth / layer. Everything is illustrative, not data.
 */
(function (FL) {
  'use strict';

  var $ = FL.$, C = FL.colors, reduce = FL.reduceMotion;

  var hero = $('#hero'), cv = $('#strata'), ctx = cv.getContext('2d');
  var probe = $('#probe'), pbox = $('#probe-box'), chx = $('#chx'), chy = $('#chy'), hint = $('#hint');

  /* Tunables */
  var LAYERS = 7;
  var PROBE_RADIUS = 170;      // px of influence around the pointer
  var PROBE_PUSH = 20;         // max outward displacement, px
  var PROBE_RIPPLE = 9;        // ripple amplitude, px
  var MAX_DEPTH_M = 3000;      // schematic depth shown in the readout

  var W = 0, H = 0, t = 0;
  var mx = -999, my = -999, probeOn = false;
  var ex = -999, ey = -999, ease = 0;          // eased pointer position and strength
  var sig = { x: 0, y: 0 };                    // centre of the He signal zone (for the readout)
  var visible = true;

  function size() {
    var s = FL.fitCanvas(cv, hero);
    W = s.w; H = s.h;
    draw();
  }

  /* Cheap smooth 2-D noise from two sines — enough for a calm wobble. */
  function noise(x, z) { return Math.sin(x * 1.1 + z * 0.7) * 0.6 + Math.sin(x * 0.45 - z * 0.9 + 1.3) * 0.4; }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    if (ex < -900) { ex = mx; ey = my; }
    ex += (mx - ex) * 0.08;
    ey += (my - ey) * 0.08;
    ease += ((probeOn ? 1 : 0) - ease) * 0.07;

    var mobile = W < 700;
    var cols = Math.max(46, Math.floor(W / (mobile ? 9 : 11))), rows = mobile ? 12 : 16;
    var cx = W * (mobile ? 0.5 : 0.6), sigX = mobile ? 0.62 : 0.68, sigZ = 0.55, R = PROBE_RADIUS;

    for (var L = LAYERS - 1; L >= 0; L--) {
      var depth = L / (LAYERS - 1);
      for (var r = 0; r < rows; r++) {
        var z = r / (rows - 1), persp = 0.45 + z * 0.95;
        var y0 = H * (0.17 + depth * 0.62) + (z - 0.5) * H * 0.07 * (1 + depth);
        for (var c = 0; c <= cols; c++) {
          var u = c / cols;
          var wob = noise(u * 2.4 + L * 0.12 + t * 0.0025, z * 1.5 + L * 0.15 - t * 0.0016) * (5 + depth * 4) * persp * 0.85;
          var fault = u > 0.58 + z * 0.02 ? 8 * depth : 0;
          var x = cx + (u - 0.5) * W * 1.25 * persp, y = y0 + wob + fault;
          var a = (0.07 + z * 0.4) * (1 - depth * 0.35), rad = 0.55 + z * 1.35;

          if (ease > 0.01) {
            var dx = x - ex, dy = y - ey, d = Math.sqrt(dx * dx + dy * dy);
            if (d < R && d > 0.01) {
              var k = 1 - d / R;
              k = k * k * (3 - 2 * k) * ease;                       // smoothstep falloff
              x += dx / d * k * PROBE_PUSH;
              y += dy / d * k * PROBE_PUSH + Math.sin(d * 0.075 - t * 0.06) * k * PROBE_RIPPLE;
              a += k * 0.6;
              rad *= 1 + k * 0.7;
            }
          }
          if (x < -4 || x > W + 4 || y < 0 || y > H) continue;

          var dd = Math.hypot((u - sigX) * 1.6, z - sigZ) + Math.abs(depth - 0.55) * 0.9, s = Math.max(0, 1 - dd / 0.42);
          if (s > 0.03) { ctx.fillStyle = C.neon; ctx.globalAlpha = Math.min(1, a + s * 0.85); rad *= 1 + s; }
          else { ctx.fillStyle = 'rgb(' + C.dot + ')'; ctx.globalAlpha = C.light ? a * 1.15 : a; }
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    /* Soft glow over the signal zone */
    var gx = cx + (sigX - 0.5) * W * 1.25 * (0.45 + sigZ * 0.95);
    var gy = H * (0.17 + 0.55 * 0.62) + (sigZ - 0.5) * H * 0.07 * 1.55;
    sig.x = gx; sig.y = gy;
    var g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(90, W * 0.13));
    g.addColorStop(0, C.light ? 'rgba(242,90,12,.18)' : 'rgba(255,106,26,.26)');
    g.addColorStop(1, 'rgba(255,106,26,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - W * 0.2, gy - W * 0.2, W * 0.4, W * 0.4);
  }

  function probeText() {
    var dep = Math.max(0, Math.min(1, (my - H * 0.17) / (H * 0.62))) * MAX_DEPTH_M;
    var near = Math.hypot(mx - sig.x, my - sig.y) < 110;
    var depS = Math.round(dep / 10) * 10;
    var T = FL.lang() === 'ru'
      ? { d: 'ГЛУБИНА', l: 'СЛОЙ', s: 'СХЕМА', z: 'ЗОНА СИГНАЛА He', n: 'фон' }
      : { d: 'DEPTH', l: 'LAYER', s: 'SCHEMATIC', z: 'He SIGNAL ZONE', n: 'background' };
    var layer = Math.min(LAYERS, Math.max(1, Math.ceil(dep / MAX_DEPTH_M * LAYERS) || 1));
    pbox.innerHTML = T.d + ' <b>≈ −' + String(depS).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' m</b><br>' +
      T.l + ' <b>' + layer + ' / ' + LAYERS + '</b><br>' +
      (near ? '<span class="sig">● ' + T.z + '</span>' : T.n) + ' · ' + T.s;
  }

  function setProbe(e) {
    var r = hero.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    var inBand = my > 56 && my < H - 90;
    probeOn = inBand;
    probe.classList.toggle('on', inBand);
    chx.classList.toggle('on', inBand);
    chy.classList.toggle('on', inBand);
    if (inBand) {
      probe.style.transform = 'translate(' + mx + 'px,' + my + 'px)';
      chx.style.transform = 'translateY(' + my + 'px)';
      chy.style.transform = 'translateX(' + mx + 'px)';
      probeText();
      var bw = pbox.offsetWidth;
      pbox.style.left = (mx + bw + 30 > W) ? (-bw - 14) + 'px' : '14px';
      hint.style.opacity = 0;
    }
    if (reduce) draw();
  }

  hero.addEventListener('pointermove', setProbe);
  hero.addEventListener('pointerdown', setProbe);
  hero.addEventListener('pointerleave', function () {
    probeOn = false;
    probe.classList.remove('on'); chx.classList.remove('on'); chy.classList.remove('on');
    if (reduce) draw();
  });

  FL.on('lang', function () { if (probeOn) probeText(); });
  FL.on('theme', draw);

  FL.animate({ active: function () { return visible; }, tick: function () { t += 1; draw(); } });
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; FL.kick(); }).observe(hero);

  FL.hero = { size: size, draw: draw };
})(window.FL);

/* ==== scripts/home-widgets.js ==== */
/*
 * home-widgets.js — small interactive blocks on the home page:
 * H₂/He comparison table, source popovers, evidence ladder (tabs),
 * directions accordion, programme "well" diagram, FAQ expand-all.
 */
(function (FL) {
  'use strict';

  var $ = FL.$, $$ = FL.$$, reduce = FL.reduceMotion;

  /* --- 04 Comparison: row highlight on hover; H₂ / He switch on mobile --- */
  var cmp = $('#cmp'), cells = $$('.cell', cmp);
  cells.forEach(function (c) {
    c.addEventListener('mouseenter', function () {
      var r = c.dataset.r;
      cells.forEach(function (x) { x.classList.toggle('hl', x.dataset.r === r); });
    });
  });
  cmp.addEventListener('mouseleave', function () { cells.forEach(function (x) { x.classList.remove('hl'); }); });
  var cmpButtons = $$('.cmp-switch button');
  cmpButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      cmp.dataset.show = b.dataset.show;
      cmpButtons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    });
  });

  /* --- Source popovers and jump-to-source flash --- */
  $$('.src-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open));
      b.nextElementSibling.hidden = open;
    });
  });
  $$('[data-jump]').forEach(function (a) {
    a.addEventListener('click', function () {
      var li = $('#s' + a.dataset.jump);
      if (!li) return;
      li.classList.add('flash');
      setTimeout(function () { li.classList.remove('flash'); }, 1800);
    });
  });

  /* --- 06 Evidence ladder: ARIA tabs with arrow-key navigation --- */
  var tabs = $$('.step'), n = tabs.length;
  function selectTab(i, focus) {
    tabs.forEach(function (tb, j) {
      var on = i === j;
      tb.setAttribute('aria-selected', String(on));
      tb.tabIndex = on ? 0 : -1;
      $('#lp-' + j).hidden = !on;
    });
    var fill = $('#lp-' + i + ' .fill');
    if (fill && !reduce) {               // replay the meter fill
      var w = fill.style.width;
      fill.style.width = '0%';
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = w; }); });
    }
    if (focus) tabs[i].focus();
  }
  tabs.forEach(function (tb, i) {
    tb.addEventListener('click', function () { selectTab(i); });
    tb.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); selectTab((i + 1) % n, true); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab((i + n - 1) % n, true); }
    });
  });

  /* --- 07 Directions accordion: hover opens on desktop, tap/focus everywhere --- */
  var dirs = $$('.dir'), desktop = window.matchMedia('(min-width:861px)');
  function openDir(i) {
    dirs.forEach(function (d, j) {
      var on = i === j;
      d.classList.toggle('active', on);
      $('.head', d).setAttribute('aria-expanded', String(on));
    });
  }
  dirs.forEach(function (d, i) {
    d.addEventListener('mouseenter', function () { if (desktop.matches) openDir(i); });
    d.addEventListener('focusin', function () { openDir(i); });
    $('.head', d).addEventListener('click', function () { openDir(i); });
    d.addEventListener('click', function (e) { if (desktop.matches && !e.target.closest('a')) openDir(i); });
  });
  $$('a[data-dir]').forEach(function (a) { a.addEventListener('click', function () { openDir(+a.dataset.dir); }); });

  /* --- 05 Programme well: SVG strata + stage nodes; the active stage follows the scroll --- */
  var NODE_Y = [110, 230, 350, 450];
  var NODE_NAMES = [['01', 'DATA', 'ДАННЫЕ'], ['02', 'RESEARCH', 'ИССЛЕДОВАНИЕ'], ['03', 'EXPLORATION', 'РАЗВЕДКА'], ['04', 'CAPITAL', 'КАПИТАЛ']];

  (function buildWell() {
    var s = '';
    for (var i = 0; i < 9; i++) {
      var y = 30 + i * 50, off = (i % 2) * 8;
      s += '<path d="M0 ' + (y + off) + ' C60 ' + (y - 6 + off) + ' 90 ' + (y + 10) + ' 120 ' + (y + 4) + ' L130 ' + (y + 14) +
        ' C170 ' + (y + 8) + ' 200 ' + (y + 18) + ' 240 ' + (y + 12) + '" stroke="var(--line-2)" stroke-width="1"/>';
      for (var k = 0; k < 24; k++) {
        s += '<circle cx="' + (k * 10 + 5) + '" cy="' + (y + 22 + ((k * 7 + i * 3) % 9)) + '" r=".8" fill="var(--fg-3)" opacity=".5"/>';
      }
    }
    $('#well-strata').innerHTML = s;

    var nodes = '';
    NODE_Y.forEach(function (y, i) {
      nodes += '<g class="wn"><circle cx="120" cy="' + y + '" r="6" fill="var(--panel)" stroke="var(--line-2)"/>' +
        (i === 0 ? '<circle cx="120" cy="' + y + '" r="11" fill="none" stroke="var(--neon)" stroke-dasharray="2 3"/>' : '') +
        '<text x="140" y="' + (y - 3) + '" fill="var(--fg-3)">' + NODE_NAMES[i][0] + '</text>' +
        '<text x="140" y="' + (y + 10) + '" fill="var(--fg-2)"><tspan class="en">' + NODE_NAMES[i][1] + '</tspan><tspan class="ru">' + NODE_NAMES[i][2] + '</tspan></text>' +
        (i === 0 ? '<text x="12" y="' + (y + 4) + '" fill="var(--neon-ink)" font-size="9">◉ NOW</text>' : '') + '</g>';
    });
    $('#well-nodes').innerHTML = nodes;
  })();

  var stages = $$('.stage'), wellFill = $('#well-fill'), wellY = NODE_Y[0], wellTarget = NODE_Y[0];
  function animateWell() {
    wellY += (wellTarget - wellY) * (reduce ? 1 : 0.12);
    wellFill.setAttribute('y2', wellY.toFixed(1));
    if (Math.abs(wellTarget - wellY) > 0.5) requestAnimationFrame(animateWell);
    else wellFill.setAttribute('y2', wellTarget);
  }
  function setStage(i) {
    stages.forEach(function (s, j) { s.classList.toggle('active', i === j); });
    wellTarget = NODE_Y[i];
    animateWell();
    $$('#well-nodes .wn').forEach(function (g, j) {
      var c = g.querySelector('circle');
      c.setAttribute('fill', j <= i ? 'var(--neon)' : 'var(--panel)');
      c.setAttribute('stroke', j <= i ? 'var(--neon)' : 'var(--line-2)');
    });
  }
  setStage(0);
  var stageSpy = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) setStage(+e.target.dataset.s); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  stages.forEach(function (s) {
    stageSpy.observe(s);
    s.addEventListener('click', function () { setStage(+s.dataset.s); });
  });

  /* --- 13 FAQ: expand / collapse all --- */
  var faqBtn = $('#faq-all'), faqs = $$('#faq-list details');
  function allOpen() { return faqs.every(function (d) { return d.open; }); }
  function faqLabel() {
    faqBtn.innerHTML = allOpen()
      ? '<span class="ru">Свернуть все</span><span class="en">Collapse all</span>'
      : '<span class="ru">Раскрыть все</span><span class="en">Expand all</span>';
  }
  faqBtn.addEventListener('click', function () {
    var open = !allOpen();
    faqs.forEach(function (d) { d.open = open; });
    faqLabel();
  });
  faqs.forEach(function (d) { d.addEventListener('toggle', faqLabel); });
})(window.FL);

/* ==== scripts/globe.js ==== */
/*
 * globe.js — dotted globe in the contact block. Drag to rotate; the geography
 * buttons spin it to a marker. Fibonacci-sphere points, orthographic projection.
 */
(function (FL) {
  'use strict';

  var $ = FL.$, $$ = FL.$$, C = FL.colors, reduce = FL.reduceMotion;

  var wrap = $('#globe-wrap'), cv = $('#globe'), g = cv.getContext('2d');
  var W = 0, H = 0, yaw = 0.95, drag = null, t = 0, visible = false, focus = 0;

  var POINTS = 900;
  var PLACES = [
    { lat: 55.75, lon: 37.62, en: 'RUSSIA · FIELD BASE', ru: 'РОССИЯ · ПОЛЕВАЯ БАЗА' },
    { lat: 24.45, lon: 54.38, en: 'UAE · PLANNED', ru: 'ОАЭ · ПЛАН' }
  ];
  var FOCUS_YAW = [1.0, 0.55];   // yaw that brings each place to the front

  var pts = (function () {
    var out = [], ga = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < POINTS; i++) {
      var y = 1 - (i / (POINTS - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }
    return out;
  })();

  function size() {
    var s = FL.fitCanvas(cv, wrap);
    W = s.w; H = s.h;
    draw();
  }

  function project(p, ry, rx) {
    var x = p[0] * Math.cos(ry) - p[2] * Math.sin(ry), z = p[0] * Math.sin(ry) + p[2] * Math.cos(ry);
    var y = p[1] * Math.cos(rx) - z * Math.sin(rx), z2 = p[1] * Math.sin(rx) + z * Math.cos(rx);
    return [x, y, z2];
  }
  function fromLatLon(lat, lon) {
    var a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return [Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b)];
  }

  function draw(tick) {
    if (!W) return;
    if (tick && !drag) t += 1;
    var ry = yaw + (reduce ? 0 : Math.sin(t * 0.004) * 0.3), rx = 0.35;
    var R = Math.min(W, H) * 0.38, cx = W / 2, cy = H / 2 + 8;
    g.clearRect(0, 0, W, H);

    /* orbit rings */
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R + 14, 0, 6.283); g.stroke();
    g.setLineDash([2, 4]); g.beginPath(); g.arc(cx, cy, R + 30, 0, 6.283); g.stroke(); g.setLineDash([]);

    /* sphere dots: brighter and larger on the near side */
    for (var i = 0; i < pts.length; i++) {
      var q = project(pts[i], ry, rx), front = q[2] > 0;
      var a = front ? (0.15 + q[2] * 0.6) : 0.06, s = front ? (0.7 + q[2] * 0.9) : 0.6;
      g.fillStyle = 'rgb(' + C.dot + ')';
      g.globalAlpha = C.light ? a * 1.1 : a;
      g.fillRect(cx + q[0] * R - s / 2, cy - q[1] * R - s / 2, s, s);
    }
    g.globalAlpha = 1;

    /* markers with pulse and leader label */
    var ru = FL.lang() === 'ru';
    PLACES.forEach(function (pl, k) {
      var q = project(fromLatLon(pl.lat, pl.lon), ry, rx), sx = cx + q[0] * R, sy = cy - q[1] * R;
      var front = q[2] > 0, on = k === focus;
      g.globalAlpha = front ? 1 : 0.25;
      g.fillStyle = C.neon;
      g.beginPath(); g.arc(sx, sy, on ? 4 : 3, 0, 6.283); g.fill();
      if (front) {
        var pr = (t % 160) / 160;
        g.strokeStyle = C.neon; g.globalAlpha = (1 - pr) * (on ? 0.9 : 0.5);
        g.beginPath(); g.arc(sx, sy, 5 + pr * 16, 0, 6.283); g.stroke();
        g.strokeStyle = C.neon; g.globalAlpha = on ? 0.8 : 0.4;
        g.beginPath(); g.moveTo(sx, sy);
        var lx = sx + (k ? 28 : -28), ly = sy - (k ? -26 : 34);
        g.lineTo(lx, ly); g.lineTo(lx + (k ? 40 : -40), ly); g.stroke();
        g.globalAlpha = on ? 1 : 0.7;
        g.font = '500 9.5px JetBrains Mono, monospace';
        g.fillStyle = on ? C.ink : C.fg3;
        g.textAlign = k ? 'left' : 'right';
        g.fillText(ru ? pl.ru : pl.en, lx + (k ? 44 : -44), ly + 3);
      }
      g.globalAlpha = 1;
    });
    g.textAlign = 'left';
  }

  /* drag to rotate */
  wrap.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y0: yaw }; wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', function (e) { if (!drag) return; yaw = drag.y0 - (e.clientX - drag.x) * 0.008; draw(); });
  wrap.addEventListener('pointerup', function () { drag = null; });
  wrap.addEventListener('pointercancel', function () { drag = null; });

  /* geography buttons: ease-out spin to the selected marker */
  var geoButtons = $$('.geo button');
  geoButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      focus = +b.dataset.geo;
      geoButtons.forEach(function (x) { x.classList.toggle('on', x === b); });
      var target = FOCUS_YAW[focus], from = yaw, start = performance.now();
      (function step(now) {
        var k = Math.min(1, (now - start) / 600);
        yaw = from + (target - from) * (1 - Math.pow(1 - k, 3));
        draw();
        if (k < 1 && !reduce) requestAnimationFrame(step);
        else { yaw = target; draw(); }
      })(start);
    });
  });

  FL.on('lang', function () { draw(); });
  FL.on('theme', function () { draw(); });

  FL.animate({ active: function () { return visible; }, tick: function () { draw(true); } });
  new IntersectionObserver(function (es) { visible = es[0].isIntersecting; FL.kick(); }).observe(wrap);

  FL.globe = { size: size, draw: draw };
})(window.FL);

/* ==== scripts/contact-form.js ==== */
/*
 * contact-form.js — the contact form in section 14.
 * Topic radios change the hint; "ways to engage" rows and partner-page CTAs pre-fill
 * the topic and a first line of the message. Client-side validation only — the form
 * shows a confirmation and does not send anything (no backend yet).
 */
(function (FL) {
  'use strict';

  var $ = FL.$, $$ = FL.$$, reduce = FL.reduceMotion;

  var HINTS = {
    capital: {
      en: 'For owners of companies, data and assets, and for investors. Tell us about the company or project, its stage and the format you have in mind.',
      ru: 'Для владельцев компаний, данных и активов, а также инвесторов. Расскажите о компании или проекте, их стадии и формате, который вы рассматриваете.'
    },
    research: {
      en: 'For scientists, laboratories and data partners. Describe the question, the method and what data or access it would need.',
      ru: 'Для учёных, лабораторий и партнёров по данным. Опишите вопрос, метод и какие данные или доступ понадобятся.'
    },
    news: {
      en: 'For readers, experts and journalists. Subscribe, suggest a topic, offer commentary or data.',
      ru: 'Для читателей, экспертов и журналистов. Подпишитесь, предложите тему, комментарий или данные.'
    },
    forum: {
      en: 'For speakers, organisers and participants. We will write when the date and venue are confirmed.',
      ru: 'Для спикеров, организаторов и участников. Напишем, когда дата и место будут подтверждены.'
    }
  };
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var form = $('#contact-form'), done = $('#done'), hint = $('#thint'), msg = $('#msg'), counter = $('#count');
  var formatPrefix = '';   // the "Format: …" line inserted by a ways-to-engage row, so a second click replaces it

  function currentTopic() { var c = $('input[name="topic"]:checked'); return c ? c.value : 'capital'; }
  function renderHint() {
    var h = HINTS[currentTopic()];
    hint.innerHTML = '<span class="en">' + h.en + '</span><span class="ru">' + h.ru + '</span>';
  }
  function setTopic(topic) { var r = $('#t-' + topic); if (r) { r.checked = true; renderHint(); } }
  function updateCount() { counter.textContent = msg.value.length + ' / 1000'; }
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  $$('input[name="topic"]').forEach(function (r) { r.addEventListener('change', renderHint); });
  renderHint();
  $$('a[data-topic]').forEach(function (a) { a.addEventListener('click', function () { setTopic(a.dataset.topic); }); });
  msg.addEventListener('input', updateCount);

  /* 09 Ways to engage: preset topic + "Format: …" line, then bring the form into view */
  $$('.fmt').forEach(function (b) {
    b.addEventListener('click', function () {
      setTopic(b.dataset.topic);
      var ru = FL.lang() === 'ru';
      var label = (ru ? 'Формат: ' : 'Format: ') + (ru ? b.dataset.ru : b.dataset.en) + '\n';
      if (formatPrefix && msg.value.indexOf(formatPrefix) === 0) msg.value = msg.value.slice(formatPrefix.length);
      msg.value = label + msg.value;
      formatPrefix = label;
      updateCount();
      var card = $('#cform');
      document.getElementById('contact').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
      card.classList.remove('flash-in'); void card.offsetWidth; card.classList.add('flash-in');
      setTimeout(function () { $('#name').focus({ preventScroll: true }); }, reduce ? 0 : 600);
    });
  });

  /* Partner-page CTAs (rendered later, so delegated): preset topic + "Re: …" line */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-ptopic]');
    if (!a) return;
    var r = document.getElementById('t-' + a.dataset.ptopic);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    var ru = FL.lang() === 'ru';
    if (msg && !msg.value.trim()) {
      msg.value = (ru ? 'Тема: ' : 'Re: ') + (ru ? a.dataset.pfmtRu : a.dataset.pfmtEn) + '\n';
      msg.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = true;
    ['name', 'email', 'msg'].forEach(function (id) {
      var el = $('#' + id), field = el.closest('.f'), v = el.value.trim();
      var valid = v.length > 0 && (id !== 'email' || EMAIL_RE.test(v));
      field.classList.toggle('invalid', !valid);
      if (!valid && ok) { el.focus(); ok = false; }
    });
    if (!ok) return;
    $('#done-dl').innerHTML =
      '<dt><span class="en">Topic</span><span class="ru">Тема</span></dt><dd>' + currentTopic().toUpperCase() + '</dd>' +
      '<dt><span class="en">Name</span><span class="ru">Имя</span></dt><dd>' + escapeHtml($('#name').value) + '</dd>' +
      '<dt>Email</dt><dd>' + escapeHtml($('#email').value) + '</dd>';
    form.hidden = true;
    done.hidden = false;
    done.scrollIntoView({ block: 'nearest' });
  });
  form.addEventListener('input', function (e) { var f = e.target.closest('.f'); if (f) f.classList.remove('invalid'); });
  $('#again').addEventListener('click', function () {
    form.reset();
    formatPrefix = '';
    renderHint();
    updateCount();
    done.hidden = true;
    form.hidden = false;
  });
})(window.FL);

/* ==== scripts/partner-pages.data.js ==== */
/*
 * partner-pages.data.js — content of the three audience pages, taken from the partnership decks.
 * Every user-facing string is an [en, ru] pair. Rendered by partner-pages.js.
 *
 * Page shape:
 *   tab, eyebrow, h1, sub, lead, cta  — hero texts
 *   topic                             — contact-form topic the CTAs preselect
 *   fmt                               — label used in the "Re: …" line of the message
 *   secs[]                            — sections; each may have cards | trio | split | steps | text | callout,
 *                                       or `next: true` for the closing contact block
 */
(function (FL) {
'use strict';
const GEO=['Russia is the intended base for field competencies and contractor work. The UAE is the direction for international presence, scientific ties and events. We consider projects and partnerships both in Russia and internationally.','Россия — предполагаемая база полевых компетенций и работы с подрядчиками. ОАЭ — направление международного присутствия, научных связей и мероприятий. Рассматриваем проекты и партнёрства как в России, так и международно.'];
const INIT=['The platform is being built as an investment and research initiative. The team and scientific partners are forming in parallel with the first projects.','Платформа создаётся как инвестиционно-исследовательская инициатива. Команда и научные партнёры формируются параллельно с первыми проектами.'];
const STAGE=['Current stage: formation of the programme, the team and the first partnerships.','Текущая стадия: формирование программы, команды и первых партнёрств.'];
const GATE=['Gate to next stage','Критерий перехода'];
const PAGES={
exploration:{
  tab:['Exploration & production','Разведка и добыча'],
  eyebrow:['Fons Latens Capital · Exploration & production','Fons Latens Capital · Разведка и добыча'],
  h1:['Natural hydrogen and helium','Природный водород и гелий'],
  sub:['From geological hypothesis to validated project','От геологической гипотезы к проверенному проекту'],
  lead:['Fons Latens is exploring investment and partnership opportunities with companies working in the exploration and production of natural hydrogen and helium. We are interested in sites, data, teams and projects whose potential can be tested step by step.','Fons Latens рассматривает возможности инвестиций и партнёрства с компаниями, работающими в разведке и добыче природного водорода и гелия. Мы заинтересованы в участках, данных, командах и проектах, потенциал которых можно последовательно проверять.'],
  cta:['Discuss a partnership','Обсудить сотрудничество'], topic:'capital', fmt:['Exploration & production','Разведка и добыча'],
  stage:STAGE,
  secs:[
   {tag:['Who we are','Кто мы'],h:['An investment and research platform.','Инвестиционно-исследовательская платформа.'],lead:['Fons Latens brings together gas measurements, independent scientific interpretation and an investment approach. Our task is to assess subsurface potential step by step and invest in projects confirmed by testing.','Fons Latens объединяет газовые измерения, независимую научную интерпретацию и инвестиционный подход. Наша задача — последовательно оценивать потенциал недр и инвестировать в проекты, подтверждённые результатами проверки.'],
    label:['Three lines of work','Три направления работы'],cards:[['Data and measurements','Данные и измерения'],['Independent review and interpretation','Независимая проверка и интерпретация'],['Investment in confirmed projects','Инвестиции в подтверждённые проекты']],big:true,
    text:['Most players in natural hydrogen focus on their own exploration programmes. We are building a platform that can work with different teams, data and sites — provided the methodology and rights are transparent.','Большинство игроков в природном водороде фокусируются на собственных разведочных программах. Мы строим платформу, которая может работать с разными командами, данными и участками — при условии прозрачной методики и прав.'],
    callout:['Partners who join at this stage help define the priority directions.','Партнёры, которые присоединяются на текущей стадии, участвуют в определении приоритетных направлений.']},
   {tag:['Why now','Почему сейчас'],h:['Demand already exists. Commercial viability is still to be proven.','Спрос уже существует. Коммерческая состоятельность — ещё предстоит доказать.'],
    cards:[['Global hydrogen demand passed 100 million tonnes in 2025 (IEA). The main consumers are industry and oil refining.','Мировой спрос на водород превысил 100 млн тонн в 2025 году (IEA). Основные потребители — промышленность и нефтепереработка.'],['There are real observations of accumulations with high H₂ content (for example, Bourakébougou, Mali).','Есть реальные наблюдения скоплений с высоким содержанием H₂ (пример — Буракебугу, Мали).'],['Prospectivity maps and specialised capital are appearing. USGS released the first prospectivity map of geologic H₂ for the US in January 2025.','Появляются карты перспективности и специализированный капитал. USGS выпустила первую карту перспективности геологического H₂ для США в январе 2025 года.'],['Helium is a separate market for technological feedstock (cryogenics, MRI, semiconductors). The economics of H₂ and He are assessed separately.','Гелий — самостоятельный рынок технологического сырья (криогеника, МРТ, полупроводники). Экономика H₂ и He оценивается раздельно.']],cols:4,
    callout:['The key question for the industry: where can a marketable product be obtained reliably, in the required volume and at an acceptable full cost.','Главный вопрос отрасли: где можно стабильно получать товарный продукт в нужном объёме и по приемлемой полной стоимости.']},
   {tag:['What we look for','Предмет интереса'],h:['Sites, data, teams and projects.','Участки, данные, команды и проекты.'],
    cards:[['Sites and access to existing wells','Участки и доступ к существующим скважинам'],['High-quality gas measurements of H₂ and He with a clear methodology','Качественные газовые измерения H₂ и He с понятной методикой'],['Confirmed rights to use the data','Подтверждённые права на использование данных'],['Teams with experience in sampling, gas geochemistry and fieldwork','Команды с опытом пробоотбора, газогеохимии и полевых работ'],['Projects at the stages: hypothesis → measurements → tests','Проекты на стадиях: гипотеза → измерения → испытания'],['Companies whose competencies can be developed through partnership or acquisition','Компании, компетенции которых можно развивать через партнёрство или приобретение']],cols:3,
    callout:['We don’t buy “pretty stories”. We look for the possibility of step-by-step verification.','Мы не покупаем «красивые истории». Мы смотрим на возможность последовательной проверки.']},
   {tag:['First conversation','Первый разговор'],h:['What to bring to the first conversation.','Что полезно принести на первый разговор.'],
    cards:[{k:['Project stage','Стадия проекта'],t:['Hypothesis / measurements available / tests carried out','Гипотеза / есть измерения / проведены испытания']},{k:['Asset type','Тип актива'],t:['Site, access to wells, data, team','Участок, доступ к скважинам, данные, команда']},{k:['Rights','Права'],t:['Rights to the data or the site','Наличие прав на данные или участок']},{k:['Measurements','Измерения'],t:['Which H₂ / He measurements already exist or are planned','Какие измерения H₂ / He уже есть или планируются']},{k:['Geography','География'],t:['Location and current status of work','Расположение и текущий статус работ']}],cols:5,
    callout:['We consider pure H₂ systems, pure He systems and mixed ones. The economics of each resource are assessed separately.','Мы рассматриваем чистые системы H₂, чистые системы He и смешанные. Экономика каждого ресурса оценивается отдельно.']},
   {tag:['Formats of cooperation','Форматы сотрудничества'],h:['Capital and partnership after verification.','Капитал и партнёрство после проверки.'],
    cards:[['A joint programme of measurements and interpretation','Совместная программа измерений и интерпретации'],['Investment in projects after the technical stages','Инвестиции в проекты после прохождения технических этапов'],['Partnership or consideration of acquiring competencies','Партнёрство или рассмотрение приобретения компетенций'],['Step-by-step review with confidentiality preserved','Поэтапное рассмотрение с сохранением конфиденциальности'],['Inclusion in the wider Fons Latens programme (Capital + Research)','Включение в более широкую программу Fons Latens (Capital + Research)']],cols:5,
    text:['We are ready to come in at the stage of data formation and verification — unlike funds that wait for an already confirmed asset. At this stage we are ready to finance measurements, pilots and early partnerships. Larger decisions are made after technical review.','Мы готовы входить на стадии формирования данных и проверки — в отличие от фондов, которые ждут уже подтверждённый актив. На текущей стадии мы готовы финансировать измерения, пилоты и ранние партнёрства. Более крупные решения принимаются после технической проверки.'],
    callout:['Terms are set individually after the initial talks and data analysis.','Условия определяются индивидуально по итогам первичных переговоров и анализа данных.']},
   {tag:['Review process','Порядок рассмотрения'],h:['Four stages.','Четыре этапа.'],steps:[
     {h:['Initial contact','Первичный контакт'],t:['Talks to get to know the company and the project. Confidentiality on request.','Переговоры для ознакомления с компанией и проектом. Конфиденциальность — по запросу.'],g:['Tasks and project stage are defined','Определены задачи и стадия проекта']},
     {h:['Data analysis','Анализ данных'],t:['Measurement results: methods, timing, contractors. Rights to the data, site or technology.','Результаты измерений: методы, сроки, исполнители. Права на данные, участок или технологию.'],g:['Methodology and rights are confirmed','Подтверждены методика и права']},
     {h:['Expert review','Экспертиза'],t:['Independent technical and scientific assessment. Alternative interpretations are considered.','Независимая техническая и научная оценка. Рассмотрение альтернативных интерпретаций.'],g:['Risks and the next verification step are clear','Понятны риски и следующий шаг проверки']},
     {h:['Decision','Решение'],t:['Defining the format of cooperation or investment.','Определение формата сотрудничества или инвестиции.'],g:['Terms and scope of work are agreed','Согласованы условия и объём работ']}]},
   {next:true,tag:['Next step','Следующий шаг'],h:['Come with a site, data or a team.','Приходите с участком, данными или командой.'],sub:['We’ll discuss the project, its current stage and possible formats of cooperation.','Обсудим проект, текущую стадию и возможные форматы сотрудничества.']}
  ]},
equipment:{
  tab:['Equipment & logistics','Оборудование и логистика'],
  eyebrow:['Fons Latens Capital · Equipment & logistics','Fons Latens Capital · Оборудование и логистика'],
  h1:['Equipment, storage and logistics','Оборудование, хранение и логистика'],
  sub:['For natural hydrogen and helium','Для природного водорода и гелия'],
  lead:['Fons Latens is interested in technologies and services that make it possible to measure, extract, separate, store and deliver H₂ and He with high quality. We are looking for partners whose solutions can be built into the work programme.','Fons Latens заинтересован в технологиях и сервисах, которые позволяют качественно измерять, извлекать, разделять, хранить и доставлять H₂ и He. Мы ищем партнёров, чьи решения можно встроить в программу работ.'],
  cta:['Discuss a partnership','Обсудить сотрудничество'], topic:'capital', fmt:['Equipment, storage & logistics','Оборудование, хранение и логистика'],
  stage:STAGE,
  secs:[
   {tag:['Who we are','Кто мы'],h:['A platform that needs tools for verification.','Платформа, которой нужны инструменты проверки.'],lead:['Fons Latens brings together measurements, independent interpretation and an investment approach. Data quality and the economics of extraction, purification and logistics decide whether a hypothesis becomes a project.','Fons Latens объединяет измерения, независимую интерпретацию и инвестиционный подход. Качество данных и экономика извлечения, очистки и логистики определяют, станет ли гипотеза проектом.'],
    label:['Three lines of work','Три направления работы'],cards:[['Measurement programme','Программа измерений'],['Technology support for verification','Технологическая поддержка проверки'],['Investment in confirmed solutions','Инвестиции в подтверждённые решения']],big:true},
   {tag:['Why now','Почему сейчас'],h:['Verification needs tools.','Проверка требует инструментов.'],lead:['Natural hydrogen and helium are potentially valuable resources, but their commercial viability depends on being able to measure, extract, purify and deliver the product with high quality.','Природный водород и гелий — потенциально ценные ресурсы, но их коммерческая состоятельность зависит от возможности качественно измерить, извлечь, очистить и доставить продукт.'],
    cards:[['Reliable methods of sampling and measurement are needed.','Нужны надёжные методы пробоотбора и измерений.'],['Technologies for separating and purifying gas mixtures matter.','Важны технологии разделения и очистки газовых смесей.'],['Storage and logistics affect the full cost.','Хранение и логистика влияют на полную стоимость.'],['Helium and hydrogen are assessed separately and need different solutions.','Гелий и водород оцениваются раздельно и требуют разных решений.']],cols:4,
    callout:['We look at technologies that make step-by-step verification possible and economical.','Мы смотрим на технологии, которые делают последовательную проверку возможной и экономичной.']},
   {tag:['What we look for','Предмет интереса'],h:['Technologies and services for the verification chain.','Технологии и сервисы для цепочки проверки.'],
    cards:[['Equipment and methods for high-quality sampling and measurement of H₂ / He','Оборудование и методы качественного пробоотбора и измерений H₂ / He'],['Technologies for separating and purifying gas mixtures','Технологии разделения и очистки газовых смесей'],['Storage and transport solutions','Решения по хранению и транспортировке'],['Laboratory and service competencies','Лабораторные и сервисные компетенции'],['Pilot and scalable technologies','Пилотные и масштабируемые технологии'],['Companies we can build long-term partnerships with or consider acquiring competencies from','Компании, с которыми можно строить долгосрочные партнёрства или рассматривать приобретение компетенций']],cols:3,
    callout:['We are interested both in solutions specialised for H₂ and He and in adaptable solutions from adjacent gas industries.','Интересуют как специализированные решения для H₂ и He, так и адаптируемые решения из смежных газовых направлений.']},
   {tag:['Priorities & pilots','Приоритеты и пилоты'],h:['Current priorities.','Текущие приоритеты.'],
    cards:[['High-quality sampling and measurement of H₂ and He, including existing wells','Качественный пробоотбор и измерения H₂ и He, включая существующие скважины'],['Technologies for separating and purifying gas mixtures','Технологии разделения и очистки газовых смесей'],['Storage and logistics solutions that affect the full cost of the product','Решения по хранению и логистике, влияющие на полную стоимость продукта']],cols:3,
    label2:['Pilots and readiness','Пилоты и готовность'],trio:[{k:['Readiness level','Уровень готовности'],t:['Open to different readiness levels: from laboratory and prototype samples to field solutions.','Открыты к разным уровням готовности: от лабораторных и опытных образцов до полевых решений.']},{k:['What a pilot is','Что такое пилот'],t:['A joint test of applicability on real samples or within the measurement programme.','Совместная проверка применимости на реальных пробах или в рамках программы измерений.']},{k:['Exclusivity & IP','Эксклюзив и IP'],t:['We don’t require exclusivity by default. Intellectual property and further use are discussed individually.','По умолчанию не требуем эксклюзива. Условия интеллектуальной собственности и дальнейшего использования обсуждаем индивидуально.']}],
    callout:['We look both at specialised solutions for natural hydrogen and helium and at adaptable technologies from adjacent gas industries.','Смотрим как на специализированные решения для природного водорода и гелия, так и на адаптируемые технологии из смежных газовых направлений.']},
   {tag:['Formats of cooperation','Форматы сотрудничества'],h:['Pilots and partnerships within the programme.','Пилоты и партнёрства в рамках программы.'],
    cards:[['Early participation in a programme that is taking shape','Возможность раннего участия в формирующейся программе работ'],['Pilot deployments and joint tests','Пилотные внедрения и совместные испытания'],['Capital and partnership once the technology’s value is confirmed','Капитал и партнёрство при подтверждённой ценности технологии'],['Integration into the chain: measurement → interpretation → decision','Интеграция в цепочку: измерение → интерпретация → решение'],['Step-by-step review with confidentiality preserved','Поэтапное рассмотрение с сохранением конфиденциальности']],cols:5,
    text:['We can finance adaptation and pilots within the programme that is taking shape. We also consider long-term service and technology partnerships. Larger decisions are made after technical review.','Можем финансировать адаптацию и пилоты в рамках формирующейся программы. Также рассматриваем долгосрочные сервисные и технологические партнёрства. Более крупные решения принимаются после технической проверки.'],
    callout:['Terms are set individually.','Условия определяются индивидуально.']},
   {tag:['Review process','Порядок рассмотрения'],h:['Four stages.','Четыре этапа.'],steps:[
     {h:['Initial contact','Первичный контакт'],t:['Getting to know the technology or service.','Ознакомление с технологией или сервисом.'],g:['The area of application is clear','Понятна область применения']},
     {h:['Understanding the method','Понимание методики'],t:['Applicability, rights, current readiness stage.','Применимость, права, текущая стадия готовности.'],g:['Key parameters are confirmed','Подтверждены ключевые параметры']},
     {h:['Technical assessment','Техническая оценка'],t:['Possibility of a pilot or joint verification.','Возможность пилота или совместной проверки.'],g:['The next step is defined','Определён следующий шаг']},
     {h:['Decision','Решение'],t:['Defining the format of cooperation.','Определение формата сотрудничества.'],g:['Terms are agreed','Согласованы условия']}]},
   {next:true,tag:['Next step','Следующий шаг'],h:['Come with a technology, equipment or a service.','Приходите с технологией, оборудованием или сервисом.'],sub:['We’ll discuss applicability and possible formats of cooperation.','Обсудим применимость и возможные форматы сотрудничества.']}
  ]},
researchers:{
  tab:['Research teams','Научные команды'],
  eyebrow:['Fons Latens Research · Research teams','Fons Latens Research · Научные команды'],
  h1:['Research into natural hydrogen and helium','Исследования природного водорода и гелия'],
  sub:['From question to measurement','От вопроса к измерению'],
  lead:['Fons Latens is building a scientific programme and looking for teams ready to test hypotheses with measurements and data. We are interested in gas geochemistry, sampling, laboratory methods and independent interpretation.','Fons Latens формирует научную программу и ищет команды, которые готовы проверять гипотезы измерениями и данными. Нам интересны газогеохимия, пробоотбор, лабораторные методы и независимая интерпретация.'],
  cta:['Propose research','Предложить исследование'], topic:'research', fmt:['Joint research','Совместное исследование'],
  stage:['Current stage: formation of the research programme and the first partnerships.','Текущая стадия: формирование исследовательской программы и первых партнёрств.'],
  secs:[
   {tag:['Who we are','Кто мы'],h:['A platform for testing hypotheses.','Платформа для проверки гипотез.'],lead:['Fons Latens brings together a measurement programme, independent scientific interpretation and an investment approach.','Fons Latens объединяет программу измерений, независимую научную интерпретацию и инвестиционный подход.'],
    label:['Three lines of work','Три направления работы'],cards:[['Measurement and data programme','Программа измерений и данных'],['Independent review and interpretation','Независимая проверка и интерпретация'],['A link to further decisions (with no pressure on the result)','Связь с дальнейшими решениями (без давления на результат)']],big:true,
    callout:['Scientific independence is preserved. Commercial interests are disclosed.','Научная самостоятельность сохраняется. Коммерческие интересы раскрываются.']},
   {tag:['Scientific position','Научная позиция'],h:['A bold idea. Verifiable conclusions.','Смелая идея. Проверяемые выводы.'],lead:['Natural hydrogen forms in geological systems (water reacting with iron-rich rocks, radiolysis). Accumulations are possible under suitable conditions of generation, migration, accumulation and preservation.','Природный водород возникает в геологических системах (реакции воды с железосодержащими породами, радиолиз). Скопления возможны при подходящих условиях генерации, миграции, накопления и сохранности.'],
    label:['What remains open','Что остаётся открытым'],cards:[['Conditions of generation and preservation','Условия генерации и сохранности'],['Isotopic signatures of sources','Изотопные признаки источников'],['Co-occurrence of H₂ and He','Совместное присутствие H₂ и He'],['Economical separation of mixtures','Экономичное разделение смесей']],cols:4,
    callout:['Observing H₂ in a sample does not yet mean a commercial deposit. A systematic approach and high-quality measurements are needed.','Наблюдение H₂ в пробе ещё не означает коммерческое месторождение. Нужен систематический подход и качественные измерения.']},
   {tag:['What we look for','Предмет интереса'],h:['Teams, methods and research questions.','Команды, методики и исследовательские вопросы.'],
    cards:[['Teams with experience in gas geochemistry and laboratory measurement of H₂ / He','Команды с опытом газогеохимии и лабораторных измерений H₂ / He'],['Laboratories and methods that can be scaled','Лаборатории и методики, которые можно масштабировать'],['Research questions and hypotheses that can be tested','Исследовательские вопросы и гипотезы, которые можно проверить'],['Access to existing wells or sites (where rights exist)','Доступ к существующим скважинам или участкам (при наличии прав)'],['Readiness to work with independent review and transparent data','Готовность работать с независимой проверкой и прозрачными данными']],cols:5,
    callout:['We are interested in different mechanisms of H₂ and He generation and accumulation, and look at both new sites and existing wells where access exists. Teams can come with their own grants and co-funding — we are open to joint programmes.','Интересуют разные механизмы генерации и накопления H₂ и He. Смотрим как новые объекты, так и существующие скважины при наличии доступа. Команды могут приходить со своими грантами и софинансированием — мы открыты к совместным программам.']},
   {tag:['Formats of cooperation','Форматы сотрудничества'],h:['A joint measurement programme.','Совместная программа измерений.'],
    cards:[['A chance to join a programme that is taking shape','Возможность встроиться в формирующуюся программу'],['Jointly setting tasks and verification criteria','Совместная постановка задач и критериев проверки'],['Funding for specific work and pilots (as the budget forms)','Финансирование конкретных работ и пилотов (по мере формирования бюджета)'],['Publications and materials in Fons Latens News (with sources and ties disclosed)','Публикации и материалы в контуре Fons Latens News (с указанием источников и связей)'],['Grant mechanisms in the future (a plan, not an open call yet)','В перспективе — грантовые механизмы (пока это план, а не действующий конкурс)'],['A link to capital: interesting results can receive further support','Связь с капиталом: интересные результаты могут получить дальнейшую поддержку']],cols:3,
    callout:['At this stage we are ready to finance measurements, pilots and early partnerships. Larger decisions are made after technical review.','На текущей стадии мы готовы финансировать измерения, пилоты и ранние партнёрства. Более крупные решения принимаются после технической проверки.']},
   {tag:['Data & publications','Данные и публикации'],h:['Data rights and what is available now.','Права на данные и что доступно уже сейчас.'],
    split:{lk:['Data rights and publications','Права на данные и публикации'],lt:['Measurement results obtained within the cooperation can be published. Terms, timing and the approval procedure are agreed in advance. Commercial interests, if they arise, are disclosed. Scientific independence is preserved.','Результаты измерений, полученные в рамках сотрудничества, можно публиковать. Условия, сроки и порядок согласования определяем заранее. Коммерческие интересы, если они возникают, раскрываем. Научная самостоятельность сохраняется.'],
      rk:['Available now','Что доступно уже сейчас'],ri:[['Jointly setting research tasks and verification criteria','Совместная постановка исследовательских задач и критериев проверки'],['Funding for specific field and laboratory work (as the budget forms)','Финансирование конкретных полевых и лабораторных работ (по мере формирования бюджета)'],['A chance to influence the priorities of the programme that is taking shape','Возможность влиять на приоритеты формирующейся программы'],['Publications and materials in Fons Latens News with sources','Публикации и материалы в контуре Fons Latens News с указанием источников']],
      rn:['Grant mechanisms are planned. For now we work through direct partnerships and funding of specific tasks.','Грантовые механизмы — в планах. Сейчас работаем через прямые партнёрства и финансирование конкретных задач.']},
    callout:['We don’t replace academic grants and don’t require research to lead straight to a commercial result. Our task is to build a steady flow of high-quality measurements and independent interpretation.','Мы не заменяем академические гранты и не требуем, чтобы исследование сразу вело к коммерческому результату. Наша задача — выстроить устойчивый поток качественных измерений и независимой интерпретации.']},
   {tag:['How we work','Порядок работы'],h:['Four stages.','Четыре этапа.'],steps:[
     {h:['Initial contact','Первичный контакт'],t:['Getting to know the question, the team or the method.','Ознакомление с вопросом, командой или методикой.'],g:['The task is clear','Понятна задача']},
     {h:['Formulation','Формулировка'],t:['Jointly setting the task and the criteria for confirmation or refutation.','Совместная постановка задачи и критериев подтверждения/опровержения.'],g:['Method and expected result are agreed','Согласованы метод и ожидаемый результат']},
     {h:['Measurement & analysis','Измерения и анализ'],t:['Carrying out the work. Recording method, date, sampling medium, units and quality control.','Проведение работ. Фиксация методики, даты, среды отбора, единиц и контроля качества.'],g:['Data with a clear methodology is obtained','Получены данные с понятной методикой']},
     {h:['Interpretation','Интерпретация'],t:['Independent assessment and a decision on next steps.','Независимая оценка и решение о следующих шагах.'],g:['Conclusions match the level of evidence','Выводы соответствуют уровню доказательности']}]},
   {next:true,tag:['Next step','Следующий шаг'],h:['Come with a research question, a method or a team.','Приходите с исследовательским вопросом, методикой или командой.'],sub:['We’ll discuss the task and possible formats of cooperation.','Обсудим задачу и возможные форматы сотрудничества.']}
  ]}
};
const ORDER=['exploration','equipment','researchers'];

FL.partnerPages = { pages: PAGES, order: ORDER, GEO: GEO, INIT: INIT, STAGE: STAGE, GATE: GATE };
})(window.FL);

/* ==== scripts/partner-pages.js ==== */
/*
 * partner-pages.js — renders an audience page (#exploration, #equipment, #researchers)
 * from partner-pages.data.js into #subpage. Routing lives in router.js.
 */
(function (FL) {
  'use strict';

  var D = FL.partnerPages, PAGES = D.pages;

  /* [en, ru] → both spans (CSS shows one); plain strings pass through */
  function bi(x) { return Array.isArray(x) ? '<span class="en">' + x[0] + '</span><span class="ru">' + x[1] + '</span>' : x; }
  function pad(i) { return String(i).padStart(2, '0'); }

  function ctaLink(P) {
    return '<a class="btn btn-primary" href="#contact" data-ptopic="' + P.topic + '" data-pfmt-en="' + P.fmt[0] + '" data-pfmt-ru="' + P.fmt[1] + '">' +
      bi(P.cta) + '<span class="arr">→</span></a>';
  }

  function card(c, i) {
    if (c.k) return '<div class="pc"><span class="num">' + pad(i + 1) + '</span><b>' + bi(c.k) + '</b><p>' + bi(c.t) + '</p></div>';
    return '<div class="pc"><span class="num">' + pad(i + 1) + '</span><p>' + bi(c) + '</p></div>';
  }

  function heroHtml(key, P) {
    return '<section class="phero in">' +
      '<div class="pnav" role="tablist" aria-label="Partner pages"><a href="#top" class="back">← Fons Latens</a>' +
      D.order.map(function (k) { return '<a href="#' + k + '"' + (k === key ? ' class="on" aria-current="page"' : '') + '>' + bi(PAGES[k].tab) + '</a>'; }).join('') +
      '</div>' +
      '<div class="phero-b"><div class="pdots" aria-hidden="true"></div>' +
      '<p class="eyebrow">' + bi(P.eyebrow) + '</p>' +
      '<span class="kicker">' + bi(['Partnership proposal', 'Предложение о сотрудничестве']) + '</span>' +
      '<h1 class="display">' + bi(P.h1) + '</h1>' +
      '<p class="h1-sub"><i></i><span>' + bi(P.sub) + '</span></p>' +
      '<p class="lead">' + bi(P.lead) + '</p>' +
      '<div class="cta">' + ctaLink(P) +
      '<button type="button" class="btn" data-scroll="p-steps">' + bi(['Review process', 'Порядок рассмотрения']) + '<span class="arr">↓</span></button></div>' +
      '<p class="hstage"><i class="dotp"></i><span><b>' + bi(P.stage) + '</b></span></p>' +
      '</div></section>';
  }

  /* Closing block: CTA, founder card, geography and contacts */
  function nextHtml(s, P) {
    var photo = (document.querySelector('.portrait img') || {}).src || '';
    return '<div class="pnext corners">' +
      '<div class="pn-l"><h2 class="display">' + bi(s.h) + '</h2><p class="lead">' + bi(s.sub) + '</p>' + ctaLink(P) + '</div>' +
      '<div class="pn-m">' + (photo ? '<img src="' + photo + '" alt="Alexander Elizarev" width="120" height="120">' : '') +
      '<div><b class="nm">Alexander Elizarev</b><span class="role">Founder · Fons Latens</span></div></div>' +
      '<dl class="pn-r"><dt>' + bi(['Geography', 'География']) + '</dt><dd>' + bi(D.GEO) + '</dd>' +
      '<dt>' + bi(['Initiator', 'Инициатор']) + '</dt><dd>' + bi(D.INIT) + '</dd>' +
      '<dt>Email</dt><dd class="ph">[email]</dd><dt>' + bi(['Phone', 'Телефон']) + '</dt><dd class="ph">[phone]</dd></dl></div>' +
      '<p class="note" style="margin-top:22px">' + bi(['The initiative is at the stage of forming the programme and the first partnerships.', 'Инициатива находится на стадии формирования программы и первых партнёрств.']) + '</p>';
  }

  function sectionHtml(s, si, P) {
    var h = '<div class="hatch"></div><section class="sec in"' + (s.steps ? ' id="p-steps"' : '') + '>' +
      '<div class="sec-top"><div class="l"><b>' + pad(si + 2) + '</b>' + bi(s.tag) + '</div><i class="chk"></i></div>';
    if (s.next) return h + nextHtml(s, P) + '</section>';

    h += '<div class="sec-head"><h2 class="display">' + bi(s.h) + '</h2>' + (s.lead ? '<p class="lead">' + bi(s.lead) + '</p>' : '<span></span>') + '</div>';
    if (s.label) h += '<p class="eyebrow plabel">' + bi(s.label) + '</p>';
    if (s.cards) {
      var cols = s.big ? 3 : (s.cols || 3);
      h += '<div class="pcards corners' + (s.big ? ' big' : '') + '" style="--pc:' + cols + '">' + s.cards.map(card).join('') + '</div>';
    }
    if (s.label2) h += '<p class="eyebrow plabel" style="margin-top:36px">' + bi(s.label2) + '</p>';
    if (s.trio) {
      h += '<div class="pcards trio" style="--pc:3">' + s.trio.map(function (c) { return '<div class="pc"><b>' + bi(c.k) + '</b><p>' + bi(c.t) + '</p></div>'; }).join('') + '</div>';
    }
    if (s.split) {
      var p = s.split;
      h += '<div class="psplit corners"><div><p class="eyebrow">' + bi(p.lk) + '</p><p class="big-t">' + bi(p.lt) + '</p></div>' +
        '<div><p class="eyebrow">' + bi(p.rk) + '</p><ul>' + p.ri.map(function (x) { return '<li>' + bi(x) + '</li>'; }).join('') + '</ul>' +
        '<p class="note">' + bi(p.rn) + '</p></div></div>';
    }
    if (s.steps) {
      h += '<div class="psteps corners">' + s.steps.map(function (st, i) {
        return '<div class="ps"><span class="eyebrow">' + bi(['Stage ', 'Этап ']) + pad(i + 1) + '</span><h3>' + bi(st.h) + '</h3><p>' + bi(st.t) + '</p>' +
          '<div class="gate"><b>' + bi(D.GATE) + '</b><span>' + bi(st.g) + '</span></div></div>';
      }).join('') + '</div>';
    }
    if (s.text) h += '<p class="ptext">' + bi(s.text) + '</p>';
    if (s.callout) h += '<div class="callout">' + bi(s.callout) + '</div>';
    return h + '</section>';
  }

  FL.renderPartnerPage = function (key, el) {
    var P = PAGES[key];
    el.innerHTML = heroHtml(key, P) + P.secs.map(function (s, si) { return sectionHtml(s, si, P); }).join('');
  };
})(window.FL);

/* ==== @news-templates ==== */
window.FL.templates = { newsCss: ":host{display:block;color:var(--fg);font:400 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;text-align:left;--pad:16px}\n@media (min-width:760px){:host{--pad:32px}}\n:host([data-lang=\"ru\"]) .en{display:none!important}\n:host(:not([data-lang=\"ru\"])) .ru{display:none!important}\n*{box-sizing:border-box}\n[hidden]{display:none!important}\na{color:inherit}\nbutton,input,select,textarea{font:inherit;color:inherit}\nh1,h2,h3{margin:0;line-height:1.12;text-wrap:balance}\np{margin:0}\n:focus-visible{outline:1px solid var(--neon);outline-offset:3px}\n::selection{background:var(--neon);color:var(--on-neon)}\n\n.in{padding-left:max(var(--pad),env(safe-area-inset-left,0px));padding-right:max(var(--pad),env(safe-area-inset-right,0px))}\n.hatch{height:16px;border-block:1px solid var(--line);background:repeating-linear-gradient(-45deg,var(--hatch) 0 1px,transparent 1px 7px)}\n.eyebrow{font:500 10.5px/1.4 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--fg-3)}\n.display{font-family:var(--display);text-transform:uppercase;font-weight:500;letter-spacing:.03em}\n\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:13px 18px;text-decoration:none;font:600 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--line-2);color:var(--fg);background:transparent;cursor:pointer;transition:border-color .2s,background .2s,box-shadow .2s;white-space:nowrap}\n.btn:hover{border-color:var(--fg-2)}\n.btn-primary{background:var(--neon);color:var(--on-neon);border-color:var(--neon);box-shadow:0 0 22px var(--neon-glow)}\n.btn-primary:hover{background:var(--neon-2);border-color:var(--neon-2)}\n.btn-danger{color:var(--neon-ink);border-color:var(--neon)}\n.btn:disabled{opacity:.5;cursor:not-allowed}\n\n.xnav{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;margin-top:22px;font:500 10.5px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase}\n.xnav > span{color:var(--fg-3)}\n.xnav a{color:var(--fg-2);text-decoration:none;padding:6px 0;border-bottom:1px solid transparent;transition:color .2s,border-color .2s}\n.xnav a:hover{color:var(--neon-ink);border-color:var(--neon)}\n.view-btn{padding:9px 12px;font-size:10.5px}\n.view-btn[aria-pressed=\"true\"]{border-color:var(--neon);color:var(--neon-ink)}\n.view-btn .eye{width:14px;height:14px}\n.preview-bar{position:relative;background:var(--neon);color:#0b0b0c;font:600 10.5px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase}\n.preview-bar .in{max-width:1280px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px max(16px,env(safe-area-inset-right,0px)) 9px max(16px,env(safe-area-inset-left,0px))}\n.preview-bar button{font:inherit;letter-spacing:inherit;text-transform:inherit;background:transparent;color:inherit;border:1px solid currentColor;padding:6px 10px;cursor:pointer}\n.ex-tag{font:500 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--fg-3,var(--fg-2));border:1px dashed var(--line-2);padding:5px 8px;white-space:nowrap}\n.ex-note{font:500 11px/1.5 var(--mono);letter-spacing:.06em;color:var(--fg-2);border:1px dashed var(--line-2);padding:10px 12px;margin:16px 0 18px}\n\n/* masthead */\n.mast{padding-block:56px 40px;display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:28px 48px;align-items:end;border-bottom:1px solid var(--line)}\n.mast h1{font-size:clamp(30px,5vw,60px);font-weight:600;line-height:1.02}\n.mast h1 b{color:var(--neon-ink);font-weight:600}\n.mast .tag{margin-top:16px;font:400 clamp(14px,1.4vw,18px)/1.4 var(--display);text-transform:uppercase;letter-spacing:.04em;color:var(--fg-2)}\n.std{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}\n.std div{background:var(--panel);padding:14px 16px;font-size:13.5px;color:var(--fg-2);display:flex;gap:10px;align-items:flex-start}\n.std i{flex:none;width:7px;height:7px;border:1px solid var(--neon);margin-top:.6em}\n@media (max-width:860px){.mast{grid-template-columns:1fr;padding-block:40px 32px}}\n\n/* filters */\n.rail{position:sticky;top:calc(var(--hh,64px) + env(safe-area-inset-top,0px));z-index:30;background:var(--header);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding-block:14px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;justify-content:space-between}\n.chips{display:flex;flex-wrap:wrap;gap:6px}\n.chip{appearance:none;border:1px solid var(--line-2);background:transparent;color:var(--fg-2);padding:8px 11px;font:500 10.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;cursor:pointer;display:inline-flex;gap:8px;align-items:center;transition:.2s}\n.chip sup{font-size:9px;color:var(--fg-3);top:0}\n.chip:hover{border-color:var(--fg-2);color:var(--fg)}\n.chip[aria-pressed=\"true\"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}\n.chip[aria-pressed=\"true\"] sup{color:var(--bg)}\n.rail-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.sel,.search{height:34px;border:1px solid var(--line-2);background:var(--bg);color:var(--fg);font:500 11px/1 var(--mono);letter-spacing:.06em;padding:0 10px;border-radius:0}\n.search{width:220px;font-family:var(--sans);font-size:14px;letter-spacing:0}\n.sel:focus,.search:focus{outline:none;border-color:var(--neon)}\n@media (max-width:600px){.search{width:100%}.rail-r{width:100%}.rail-r .sel{flex:1}}\n\n/* feed */\n.feed{padding-block:32px 72px}\n.lead{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);border:1px solid var(--line);margin-bottom:24px;cursor:pointer;transition:border-color .2s;background:var(--panel)}\n.lead:hover{border-color:var(--line-2)}\n.lead .l{padding:30px 30px 32px;display:flex;flex-direction:column;gap:16px;min-width:0}\n.lead h2{font-family:var(--display);text-transform:uppercase;font-weight:500;font-size:clamp(22px,2.8vw,34px);letter-spacing:.02em;line-height:1.14}\n.lead .dek{font-size:17px;color:var(--fg-2);max-width:56ch}\n.lead .r{border-left:1px solid var(--line);background:var(--g1);padding:30px;display:flex;flex-direction:column;justify-content:space-between;gap:20px;min-width:0;position:relative;overflow:hidden}\n.lead .r canvas{position:absolute;inset:0;width:100%;height:100%;opacity:.9}\n.lead .r > *:not(canvas){position:relative}\n@media (max-width:860px){.lead{grid-template-columns:1fr}.lead .r{border-left:0;border-top:1px solid var(--line);min-height:160px}}\n.grid{display:grid;grid-template-columns:repeat(var(--cols,3),minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}\n@media (max-width:1000px){.grid{grid-template-columns:repeat(min(2,var(--cols,3)),minmax(0,1fr))}}\n@media (max-width:640px){.grid{grid-template-columns:1fr}}\n.card{appearance:none;text-align:left;border:0;background:var(--panel);padding:24px 22px;display:flex;flex-direction:column;gap:12px;min-width:0;cursor:pointer;color:inherit;transition:background .2s}\n.card:hover{background:var(--g1)}\n.card h3{font-family:var(--display);text-transform:uppercase;font-weight:500;font-size:15px;letter-spacing:.03em;line-height:1.35}\n.card .dek{font-size:14px;color:var(--fg-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}\n.meta{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font:400 10.5px/1.6 var(--mono);letter-spacing:.06em;color:var(--fg-3);text-transform:uppercase}\n.card .meta{margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}\n.top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}\n.top .cat{margin-right:auto}\n.cat{font:500 10.5px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--neon-ink)}\n.lvl{display:inline-flex;align-items:center;gap:8px;font:500 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--fg-2);border:1px solid var(--line-2);padding:5px 8px;white-space:nowrap}\n.lvl .bars{display:inline-flex;gap:2px}\n.lvl .bars i{width:3px;height:10px;background:var(--line-2)}\n.lvl .bars i.f{background:var(--neon)}\n.empty{border:1px dashed var(--line-2);padding:56px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}\n.empty h2{font-family:var(--display);text-transform:uppercase;font-weight:500;font-size:20px;letter-spacing:.04em}\n.empty p{color:var(--fg-2);max-width:52ch;font-size:15px}\n.notice{border:1px solid var(--line);border-left:2px solid var(--neon);background:var(--bg-2);padding:14px 18px;font-size:14px;color:var(--fg-2);margin-bottom:20px}\n\n/* reader sheet + editor drawer */\n.scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:70;backdrop-filter:blur(2px)}\n.sheet{position:fixed;z-index:80;top:0;bottom:0;right:0;width:min(860px,100%);background:var(--bg);border-left:1px solid var(--line);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-right:env(safe-area-inset-right,0px);animation:slide .28s cubic-bezier(.2,.7,.2,1)}\n@keyframes slide{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}\n.sheet-h{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 24px;border-bottom:1px solid var(--line);background:var(--header)}\n.sheet-b{overflow-y:auto;padding:32px 40px 64px;flex:1}\n@media (max-width:640px){.sheet-b{padding:24px 18px 56px}.sheet-h{padding:12px 16px}}\n.art h1{font-family:var(--display);text-transform:uppercase;font-weight:500;font-size:clamp(24px,3.4vw,38px);letter-spacing:.02em;line-height:1.12;margin:16px 0}\n.art .dek{font-size:19px;color:var(--fg-2);line-height:1.5}\n.art .byline{display:flex;flex-wrap:wrap;gap:6px 18px;padding-block:16px;margin-block:22px;border-block:1px solid var(--line);font:400 11px/1.6 var(--mono);letter-spacing:.06em;color:var(--fg-3);text-transform:uppercase}\n.art .byline b{color:var(--fg);font-weight:500}\n.art .body{font-size:17px;line-height:1.7;max-width:68ch;display:flex;flex-direction:column;gap:18px}\n.art .body h3{font-family:var(--display);text-transform:uppercase;font-weight:500;font-size:16px;letter-spacing:.04em;margin-top:10px}\n.box{margin-top:32px;border:1px solid var(--line)}\n.box > .eyebrow{display:block;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg-2)}\n.box ol{margin:0;padding:0;list-style:none}\n.box li{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);font-size:14.5px}\n.box li:last-child{border-bottom:0}\n.box li .n{font:500 10.5px/1.9 var(--mono);color:var(--neon-ink)}\n.box li a{color:var(--fg);word-break:break-word}\n.box li .d{font:400 10.5px/1.6 var(--mono);color:var(--fg-3)}\n.box .disc{padding:14px 16px;font-size:14.5px;color:var(--fg-2)}\n.lvl-explain{padding:14px 16px;font-size:14px;color:var(--fg-2);display:flex;gap:14px;align-items:center}\n.art-actions{display:flex;gap:8px}\n\n/* editor form */\nform{display:grid;gap:20px}\n.f{display:grid;gap:8px;min-width:0}\n.f > label,.f > .lbl{font:500 10.5px/1.4 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--fg-3);display:flex;justify-content:space-between;gap:10px}\n.f .help{font-size:12.5px;color:var(--fg-3)}\ninput[type=text],input[type=url],input[type=date],textarea,select.inp{width:100%;background:var(--panel);color:var(--fg);border:1px solid var(--line-2);padding:12px 13px;font:400 15px/1.45 var(--sans);border-radius:0;min-width:0}\ninput:focus,textarea:focus,select.inp:focus{outline:none;border-color:var(--neon);box-shadow:0 0 0 1px var(--neon)}\ntextarea{resize:vertical}\n#f-body{min-height:260px}\n.row2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}\n@media (max-width:640px){.row2{grid-template-columns:1fr}}\n.seg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}\n.seg input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}\n.seg label{background:var(--panel);padding:12px;cursor:pointer;display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--fg-2);text-transform:none;letter-spacing:0}\n.seg label b{font:500 10.5px/1.3 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--fg)}\n.seg input:checked + label{background:var(--g2);box-shadow:inset 0 2px 0 var(--neon)}\n.seg input:focus-visible + label{outline:1px solid var(--neon);outline-offset:-2px}\n@media (max-width:640px){.seg{grid-template-columns:repeat(2,minmax(0,1fr))}}\n.src-row{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,3fr) 150px 40px;gap:8px}\n.src-row button{appearance:none;border:1px solid var(--line-2);background:transparent;color:var(--fg-3);cursor:pointer}\n.src-row button:hover{color:var(--neon-ink);border-color:var(--neon)}\n@media (max-width:640px){.src-row{grid-template-columns:minmax(0,1fr) 40px}.src-row input:nth-child(2),.src-row input:nth-child(3){grid-column:1}}\n.err{color:var(--neon-ink);font-size:13px}\n.f.invalid input,.f.invalid textarea{border-color:var(--neon)}\n.form-foot{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:20px}\n.form-foot small{color:var(--fg-3);font-size:12.5px;max-width:46ch}\n\n.toast{position:fixed;z-index:90;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--fg);color:var(--bg);font:500 11px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;padding:13px 18px;display:flex;gap:10px;align-items:center}\n.toast i{width:7px;height:7px;border-radius:50%;background:var(--neon)}\n.nfoot{border-top:1px solid var(--line);padding-block:26px 34px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;font-size:13px;color:var(--fg-3)}\n@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}\n.ed-tools{display:flex;gap:8px;flex-wrap:wrap}\n.ed-tools .btn{padding:9px 12px;font-size:10.5px;height:34px}\n.mast-k{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}\n@media (max-width:640px){.ed-tools .lbl{display:none}}\n.nfoot p{max-width:72ch}\n", newsHtml: "<div class=\"preview-bar\" id=\"preview-bar\" hidden><div class=\"in\"><span><span class=\"en\">Reader view: this is how visitors see the newsroom<\/span><span class=\"ru\">Вид читателя: так ленту видят посетители<\/span><\/span><button type=\"button\" id=\"preview-exit\"><span class=\"en\">Back to editing<\/span><span class=\"ru\">Вернуться к редактуре<\/span><\/button><\/div><\/div>\n\n<div class=\"nframe\">\n  <section class=\"mast in\">\n    <div>\n      <div class=\"mast-k\"><p class=\"eyebrow\">Fons Latens · <span class=\"en\">News<\/span><span class=\"ru\">Новости<\/span><\/p><div class=\"ed-tools\" id=\"ed-tools\" hidden><button type=\"button\" class=\"btn view-btn\" id=\"view-btn\" aria-pressed=\"false\"><svg class=\"eye\" viewBox=\"0 0 16 16\" fill=\"none\" aria-hidden=\"true\"><path d=\"M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5Z\" stroke=\"currentColor\" stroke-width=\"1.2\"/><circle cx=\"8\" cy=\"8\" r=\"2\" stroke=\"currentColor\" stroke-width=\"1.2\"/><\/svg><span class=\"lbl\"><span class=\"en\">Reader view<\/span><span class=\"ru\">Вид читателя<\/span><\/span><\/button><button type=\"button\" class=\"btn btn-primary\" id=\"new-btn\" hidden><span aria-hidden=\"true\">+<\/span><span class=\"lbl\"><span class=\"en\">New article<\/span><span class=\"ru\">Новый материал<\/span><\/span><\/button><\/div><\/div>\n      <h1 class=\"display\" style=\"margin-top:14px\">Fons Latens <b>News<\/b><\/h1>\n      <p class=\"tag\"><span class=\"en\">Understanding what happens underground<\/span><span class=\"ru\">Понимать, что происходит в недрах<\/span><\/p>\n      <nav class=\"xnav\" aria-label=\"Fons Latens\"><span><span class=\"en\">On the main page<\/span><span class=\"ru\">На главной<\/span><\/span><a href=\"#what\" data-out><span class=\"en\">About<\/span><span class=\"ru\">О нас<\/span><\/a><a href=\"#capital\" data-out>Capital<\/a><a href=\"#research\" data-out>Research<\/a><a href=\"#forum\" data-out>Forum<\/a><a href=\"#contact\" data-out><span class=\"en\">Contact<\/span><span class=\"ru\">Контакты<\/span><\/a><\/nav>\n    <\/div>\n    <div class=\"std\" aria-label=\"Editorial standard\">\n      <div><i><\/i><span><span class=\"en\">Every piece has an author and a date<\/span><span class=\"ru\">У каждого материала есть автор и дата<\/span><\/span><\/div>\n      <div><i><\/i><span><span class=\"en\">Primary sources are listed<\/span><span class=\"ru\">Указаны первоисточники<\/span><\/span><\/div>\n      <div><i><\/i><span><span class=\"en\">Each claim carries its level of proof<\/span><span class=\"ru\">У каждого утверждения — уровень доказательности<\/span><\/span><\/div>\n      <div><i><\/i><span><span class=\"en\">Financial ties are disclosed<\/span><span class=\"ru\">Финансовые связи раскрываются<\/span><\/span><\/div>\n    <\/div>\n  <\/section>\n\n  <div class=\"rail in\">\n    <div class=\"chips\" id=\"chips\" role=\"group\" aria-label=\"Category\"><\/div>\n    <div class=\"rail-r\">\n      <select class=\"sel\" id=\"lvl-filter\" aria-label=\"Level of evidence\"><\/select>\n      <input class=\"search\" id=\"q\" type=\"search\" placeholder=\"Search\" aria-label=\"Search articles\">\n    <\/div>\n  <\/div>\n\n  <div class=\"feed in\" id=\"feed\">\n    <div class=\"notice\" id=\"notice\" hidden><\/div>\n    <div id=\"lead-wrap\"><\/div>\n    <div class=\"grid\" id=\"grid\"><\/div>\n    <div class=\"empty\" id=\"empty\">\n      <p class=\"eyebrow\" id=\"empty-k\"><span class=\"en\">Loading the newsroom<\/span><span class=\"ru\">Загружаем ленту<\/span><\/p>\n      <h2 id=\"empty-h\"><span class=\"en\">No articles yet<\/span><span class=\"ru\">Материалов пока нет<\/span><\/h2>\n      <p id=\"empty-p\"><span class=\"en\">New discoveries, contractor solutions and partner news will appear here as the editors publish them.<\/span><span class=\"ru\">Здесь будут появляться новые открытия, решения подрядчиков и новости партнёров по мере публикации редакцией.<\/span><\/p>\n      <button type=\"button\" class=\"btn btn-primary\" id=\"empty-new\" hidden><span class=\"en\">Write the first article<\/span><span class=\"ru\">Написать первый материал<\/span><\/button>\n    <\/div>\n  <\/div>\n\n  <div class=\"hatch\"><\/div>\n  <div class=\"nfoot in\"><p><span class=\"en\">Fons Latens News is an online science journal, not a peer-reviewed publication. Research is never turned into hidden advertising; financial ties to the companies we cover are disclosed.<\/span><span class=\"ru\">Fons Latens News — интернет-журнал о науке, а не рецензируемое издание. Исследования не превращаются в скрытую рекламу; финансовые связи с компаниями, о которых мы пишем, раскрываются.<\/span><\/p><a class=\"btn\" href=\"#contact\" data-out><span class=\"en\">Suggest a story<\/span><span class=\"ru\">Предложить тему<\/span><\/a><\/div>\n<\/div>\n\n<!-- Reader -->\n<div class=\"scrim\" id=\"scrim\" hidden><\/div>\n<aside class=\"sheet\" id=\"reader\" hidden aria-modal=\"true\" role=\"dialog\" aria-labelledby=\"r-title\">\n  <div class=\"sheet-h\">\n    <button type=\"button\" class=\"btn\" id=\"r-close\">← <span class=\"en\">Back to feed<\/span><span class=\"ru\">К ленте<\/span><\/button>\n    <div class=\"art-actions\" id=\"r-actions\" hidden>\n      <button type=\"button\" class=\"btn\" id=\"r-edit\"><span class=\"en\">Edit<\/span><span class=\"ru\">Редактировать<\/span><\/button>\n      <button type=\"button\" class=\"btn btn-danger\" id=\"r-del\"><span class=\"en\">Delete<\/span><span class=\"ru\">Удалить<\/span><\/button>\n    <\/div>\n  <\/div>\n  <div class=\"sheet-b\"><article class=\"art\" id=\"art\"><\/article><\/div>\n<\/aside>\n\n<!-- Editor -->\n<aside class=\"sheet\" id=\"editor\" hidden aria-modal=\"true\" role=\"dialog\" aria-labelledby=\"e-title\">\n  <div class=\"sheet-h\">\n    <span class=\"eyebrow\" id=\"e-title\"><span class=\"en\">New article<\/span><span class=\"ru\">Новый материал<\/span><\/span>\n    <button type=\"button\" class=\"btn\" id=\"e-close\"><span class=\"en\">Close<\/span><span class=\"ru\">Закрыть<\/span><\/button>\n  <\/div>\n  <div class=\"sheet-b\">\n    <form id=\"form\" novalidate>\n      <div class=\"row2\">\n        <div class=\"f\"><label for=\"f-cat\"><span class=\"en\">Category<\/span><span class=\"ru\">Рубрика<\/span><\/label><select class=\"inp\" id=\"f-cat\"><\/select><\/div>\n        <div class=\"f\"><label for=\"f-region\"><span class=\"en\">Region / site<\/span><span class=\"ru\">Регион / объект<\/span><\/label><input type=\"text\" id=\"f-region\" maxlength=\"80\" placeholder=\"e.g. Mali · Bourakébougou\"><\/div>\n      <\/div>\n      <div class=\"f\"><span class=\"lbl\"><span class=\"en\">Level of evidence<\/span><span class=\"ru\">Уровень доказательности<\/span><\/span>\n        <div class=\"seg\" id=\"f-level\" role=\"radiogroup\"><\/div>\n        <span class=\"help\" id=\"lvl-help\"><\/span>\n      <\/div>\n      <div class=\"f\" data-k=\"title\"><label for=\"f-title\"><span><span class=\"en\">Headline<\/span><span class=\"ru\">Заголовок<\/span><\/span><span id=\"c-title\">0 / 140<\/span><\/label><input type=\"text\" id=\"f-title\" maxlength=\"140\" required><span class=\"err\" hidden><span class=\"en\">Write a headline of at least 8 characters.<\/span><span class=\"ru\">Заголовок — минимум 8 символов.<\/span><\/span><\/div>\n      <div class=\"f\"><label for=\"f-dek\"><span class=\"en\">Standfirst<\/span><span class=\"ru\">Лид<\/span><\/label><textarea id=\"f-dek\" rows=\"2\" maxlength=\"320\"><\/textarea><span class=\"help\"><span class=\"en\">One or two sentences: what happened and why it matters.<\/span><span class=\"ru\">Одно-два предложения: что произошло и почему это важно.<\/span><\/span><\/div>\n      <div class=\"f\" data-k=\"body\"><label for=\"f-body\"><span class=\"en\">Text<\/span><span class=\"ru\">Текст<\/span><\/label><textarea id=\"f-body\" required><\/textarea><span class=\"help\"><span class=\"en\">Separate paragraphs with an empty line. Start a line with ## for a subheading.<\/span><span class=\"ru\">Абзацы разделяйте пустой строкой. Строка с ## — подзаголовок.<\/span><\/span><span class=\"err\" hidden><span class=\"en\">The article needs some text.<\/span><span class=\"ru\">Добавьте текст материала.<\/span><\/span><\/div>\n      <div class=\"f\"><label for=\"f-byline\"><span class=\"en\">Byline<\/span><span class=\"ru\">Автор<\/span><\/label><input type=\"text\" id=\"f-byline\" maxlength=\"120\"><span class=\"help\"><span class=\"en\">Leave empty to sign with your account name.<\/span><span class=\"ru\">Оставьте пустым — подпишем именем вашего аккаунта.<\/span><\/span><\/div>\n      <div class=\"f\" data-k=\"sources\"><span class=\"lbl\"><span class=\"en\">Sources<\/span><span class=\"ru\">Источники<\/span><\/span>\n        <div id=\"src-list\" style=\"display:grid;gap:8px\"><\/div>\n        <button type=\"button\" class=\"btn\" id=\"src-add\" style=\"justify-self:start\">+ <span class=\"en\">Add source<\/span><span class=\"ru\">Добавить источник<\/span><\/button>\n        <span class=\"err\" hidden id=\"src-err\"><\/span>\n      <\/div>\n      <div class=\"f\" data-k=\"disc\"><label for=\"f-disc\"><span class=\"en\">Disclosure of financial ties<\/span><span class=\"ru\">Раскрытие финансовых связей<\/span><\/label><textarea id=\"f-disc\" rows=\"2\" maxlength=\"400\"><\/textarea><span class=\"err\" hidden><span class=\"en\">State the financial ties, or that there are none.<\/span><span class=\"ru\">Укажите финансовые связи или что их нет.<\/span><\/span><\/div>\n      <div class=\"form-foot\">\n        <small><span class=\"en\">Publishing is immediate: the article appears in the feed for everyone with access.<\/span><span class=\"ru\">Публикация сразу: материал появится в ленте у всех, у кого есть доступ.<\/span><\/small>\n        <button type=\"submit\" class=\"btn btn-primary\" id=\"f-submit\"><span class=\"en\">Publish<\/span><span class=\"ru\">Опубликовать<\/span><\/button>\n      <\/div>\n    <\/form>\n  <\/div>\n<\/aside>\n\n<div class=\"toast\" id=\"toast\" hidden role=\"status\"><i><\/i><span id=\"toast-t\"><\/span><\/div>\n" };

/* ==== news/news.js ==== */
/*
 * news/news.js — Fons Latens News, the newsroom page (#news, #a-<postId>).
 *
 * Rendered inside a Shadow DOM on #newspage so its styles (news.css) never collide with the
 * main site; theme tokens still inherit from :root. Language follows the site ('lang' event).
 *
 * Data: the artifact database, collection `posts` (read: viewers, write: editors).
 *   { title, dek, body, category, level, region, byline, sources[{label,url,date}],
 *     disclosure, publishedAt, updatedAt, authorId, example? }
 * Offline (no window.claude): falls back to window.NEWS_SNAPSHOT if the build embedded one.
 *
 * Editors (user.canEdit()) get "New article", edit/delete, and a "Reader view" preview toggle.
 */
(function (FL) {
  'use strict';

  var host = document.getElementById('newspage');
  if (!host) return;

  var sr = host.attachShadow({ mode: 'open' });
  sr.innerHTML = '<style>' + FL.templates.newsCss + '</style>' + FL.templates.newsHtml;
  function $(s) { return sr.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(sr.querySelectorAll(s)); }

  var store = FL.store, L = FL.L;
  var KEY_READER = 'fln-reader';

  var CATS = [
    ['discovery', 'Discoveries', 'Открытия'],
    ['contractor', 'Contractor solutions', 'Решения подрядчиков'],
    ['partner', 'Partners', 'Партнёры'],
    ['research', 'Research', 'Исследования'],
    ['market', 'Market & capital', 'Рынок и капитал']
  ];
  /* key, EN, RU, EN explanation, RU explanation */
  var LVLS = [
    ['hypothesis', 'Hypothesis', 'Гипотеза', 'There is an explanation and a plan to test it.', 'Есть объяснение и план его проверки.'],
    ['measurement', 'Measurement', 'Измерение', 'Gas was detected in a specific sample under stated conditions.', 'Газ обнаружен в конкретной пробе при указанных условиях.'],
    ['test', 'Test', 'Испытание', 'Data on gas flow and how the site behaves.', 'Есть данные о притоке газа и поведении объекта.'],
    ['commercial', 'Commercial project', 'Коммерческий проект', 'Product, costs, rights and buyer are established.', 'Установлены продукт, затраты, права и покупатель.']
  ];

  var S = {
    posts: [], cat: 'all', lvl: 'all', q: '',
    realEdit: false,   // the viewer may edit (from user.canEdit())
    reader: false,     // editor is previewing as a reader
    canEdit: false,    // realEdit && !reader — what the UI shows
    uid: null, loaded: false, editing: null, open: null
  };
  var db = null, user = null, started = false, lastFocus = null;

  /* ---------- helpers ---------- */
  function isRu() { return FL.lang() === 'ru'; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function catName(k) { var c = CATS.find(function (c) { return c[0] === k; }); return c ? (isRu() ? c[2] : c[1]) : k; }
  function lvlIdx(k) { return Math.max(0, LVLS.findIndex(function (l) { return l[0] === k; })); }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(isRu() ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function lvlBadge(k) {
    var i = lvlIdx(k), b = el('span', 'lvl'), bars = el('span', 'bars');
    for (var j = 0; j < 4; j++) { var x = el('i'); if (j <= i) x.className = 'f'; bars.appendChild(x); }
    b.appendChild(bars);
    b.appendChild(document.createTextNode(isRu() ? LVLS[i][2] : LVLS[i][1]));
    return b;
  }
  function exTag(parent, p) { if (p && p.example) parent.appendChild(el('span', 'ex-tag', L('Example', 'Пример'))); }
  function topRow(p) {
    var t = el('div', 'top');
    t.appendChild(el('span', 'cat', catName(p.category)));
    t.appendChild(lvlBadge(p.level));
    exTag(t, p);
    return t;
  }
  async function names(ids) {
    if (!user || !ids.length) return {};
    try { return await user.profiles(ids); } catch (e) { return {}; }
  }
  function authorOf(p, ps) {
    return p.byline || (p.authorId && ps[p.authorId] && ps[p.authorId].name) || L('Fons Latens editorial', 'Редакция Fons Latens');
  }
  function isNewsHash() { var h = location.hash; return h === '#news' || h.indexOf('#a-') === 0; }

  /* ---------- language ---------- */
  function applyLang() {
    host.dataset.lang = FL.lang();
    $('#q').placeholder = L('Search', 'Поиск');
    buildFilters();
    render();
    if (S.open) openArticle(S.open, true);
    buildLevelSeg();
    buildCats(true);
  }
  FL.on('lang', function () { applyLang(); drawLeadArt(); });
  FL.on('theme', function () { drawLeadArt(); });

  /* ---------- filters ---------- */
  function buildFilters() {
    var chips = $('#chips'), counts = { all: S.posts.length };
    chips.textContent = '';
    S.posts.forEach(function (p) { counts[p.category] = (counts[p.category] || 0) + 1; });
    [['all', 'All', 'Все']].concat(CATS).forEach(function (c) {
      var k = c[0], b = el('button', 'chip');
      b.type = 'button';
      b.setAttribute('aria-pressed', S.cat === k);
      b.appendChild(document.createTextNode(L(c[1], c[2])));
      b.appendChild(el('sup', null, String(counts[k] || 0)));
      b.onclick = function () { S.cat = k; buildFilters(); render(); };
      chips.appendChild(b);
    });
    var sel = $('#lvl-filter'), v = S.lvl;
    sel.textContent = '';
    var all = el('option', null, L('All levels of evidence', 'Все уровни доказательности'));
    all.value = 'all';
    sel.appendChild(all);
    LVLS.forEach(function (l) { var o = el('option', null, L(l[1], l[2])); o.value = l[0]; sel.appendChild(o); });
    sel.value = v;
  }
  $('#lvl-filter').onchange = function (e) { S.lvl = e.target.value; render(); };
  $('#q').oninput = function (e) { S.q = e.target.value.trim().toLowerCase(); render(); };

  /* ---------- feed ---------- */
  function visiblePosts() {
    return S.posts.filter(function (p) {
      return (S.cat === 'all' || p.category === S.cat) &&
        (S.lvl === 'all' || p.level === S.lvl) &&
        (!S.q || [p.title, p.dek, p.body, p.region, p.byline].join(' ').toLowerCase().indexOf(S.q) !== -1);
    });
  }

  function renderEmpty(filtered) {
    $('#empty-k').innerHTML = '<span>' + (S.loaded
      ? (filtered ? L('Nothing matches', 'Ничего не найдено') : L('Newsroom is open', 'Редакция открыта'))
      : L('Loading the newsroom', 'Загружаем ленту')) + '</span>';
    $('#empty-h').textContent = filtered ? L('No articles match these filters', 'Нет материалов по этим фильтрам') : L('No articles yet', 'Материалов пока нет');
    $('#empty-p').textContent = filtered
      ? L('Try another category, level or search term.', 'Попробуйте другую рубрику, уровень или запрос.')
      : (S.canEdit
        ? L('Publish the first discovery, contractor solution or partner update. It appears here immediately for everyone with access.', 'Опубликуйте первое открытие, решение подрядчика или новость партнёра — материал сразу появится здесь у всех, у кого есть доступ.')
        : L('New discoveries, contractor solutions and partner news will appear here as the editors publish them.', 'Здесь будут появляться новые открытия, решения подрядчиков и новости партнёров по мере публикации редакцией.'));
    $('#empty-new').hidden = !(S.canEdit && !filtered && S.loaded);
  }

  function leadStory(p, ps) {
    var lead = el('article', 'lead');
    lead.tabIndex = 0;
    lead.setAttribute('role', 'button');
    var l = el('div', 'l');
    l.appendChild(topRow(p));
    l.appendChild(el('h2', null, p.title));
    if (p.dek) l.appendChild(el('p', 'dek', p.dek));
    var m = el('div', 'meta');
    m.appendChild(el('span', null, fmtDate(p.publishedAt)));
    m.appendChild(el('span', null, authorOf(p, ps)));
    if (p.region) m.appendChild(el('span', null, p.region));
    l.appendChild(m);
    var r = el('div', 'r');
    r.appendChild(el('canvas'));
    r.appendChild(el('span', 'eyebrow', L('Latest', 'Последнее')));
    r.appendChild(el('span', 'eyebrow', L('Sources: ', 'Источников: ') + (p.sources || []).length));
    lead.appendChild(l);
    lead.appendChild(r);
    lead.onclick = function () { openArticle(p.id); };
    lead.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArticle(p.id); } };
    return lead;
  }

  function cardStory(p, ps) {
    var c = el('button', 'card');
    c.type = 'button';
    c.appendChild(topRow(p));
    c.appendChild(el('h3', null, p.title));
    if (p.dek) c.appendChild(el('p', 'dek', p.dek));
    var m = el('div', 'meta');
    m.appendChild(el('span', null, fmtDate(p.publishedAt)));
    m.appendChild(el('span', null, authorOf(p, ps)));
    c.appendChild(m);
    c.onclick = function () { openArticle(p.id); };
    return c;
  }

  async function render() {
    var list = visiblePosts(), lw = $('#lead-wrap'), grid = $('#grid'), empty = $('#empty');
    lw.textContent = '';
    grid.textContent = '';
    var ps = await names(Array.from(new Set(list.map(function (p) { return p.authorId; }).filter(Boolean))));
    if (!list.length) {
      empty.hidden = false;
      renderEmpty(S.posts.length > 0);
      grid.hidden = true;
      return;
    }
    empty.hidden = true;
    grid.hidden = list.length < 2;
    grid.style.setProperty('--cols', Math.max(1, Math.min(3, list.length - 1)));
    lw.appendChild(leadStory(list[0], ps));
    drawLeadArt();
    list.slice(1).forEach(function (p) { grid.appendChild(cardStory(p, ps)); });
  }

  /* Decorative strata in the lead story (same motif as the site hero) */
  function drawLeadArt() {
    var cv = $('.lead canvas');
    if (!cv) return;
    var r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    if (!r.width) return;
    cv.width = r.width * d;
    cv.height = r.height * d;
    var x = cv.getContext('2d');
    x.setTransform(d, 0, 0, d, 0, 0);
    var cs = getComputedStyle(FL.root), dot = cs.getPropertyValue('--fg').trim(), neon = cs.getPropertyValue('--neon').trim(), W = r.width, H = r.height;
    for (var layer = 0; layer < 6; layer++) {
      for (var c = 0; c <= 40; c++) {
        var u = c / 40, y = H * (0.2 + layer * 0.13) + Math.sin(u * 5 + layer) * 6, X = u * W;
        var s = Math.max(0, 1 - Math.hypot((u - 0.7) * 2, (layer - 3) * 0.35));
        x.globalAlpha = 0.18 + s * 0.7;
        x.fillStyle = s > 0.2 ? neon : dot;
        var z = 1 + s * 1.6;
        x.fillRect(X - z, y - z, z * 2, z * 2);
      }
    }
    x.globalAlpha = 1;
  }
  addEventListener('resize', function () { drawLeadArt(); });

  /* ---------- reader / editor mode ---------- */
  function applyMode() {
    S.canEdit = !!S.realEdit && !S.reader;
    $('#new-btn').hidden = !S.canEdit;
    $('#ed-tools').hidden = !S.realEdit;
    $('#view-btn').setAttribute('aria-pressed', S.reader ? 'true' : 'false');
    $('#preview-bar').hidden = !(S.realEdit && S.reader);
    render();
    if (S.open) openArticle(S.open, true);
  }
  function setReader(on) {
    S.reader = on;
    store.set(KEY_READER, on ? '1' : '0');
    if (on && !$('#editor').hidden) closeEditor();
    applyMode();
  }
  $('#view-btn').onclick = function () { setReader(!S.reader); };
  $('#preview-exit').onclick = function () { setReader(false); };

  /* ---------- article sheet ---------- */
  function lock(on) { document.body.classList.toggle('lock', on); $('#scrim').hidden = !on; }

  function box(title) { var b = el('div', 'box'); b.appendChild(el('span', 'eyebrow', title)); return b; }

  async function openArticle(id, keep) {
    var p = S.posts.find(function (x) { return x.id === id; });
    if (!p) return;
    S.open = id;
    if (!keep) lastFocus = sr.activeElement;
    var a = $('#art');
    a.textContent = '';
    var ps = await names(p.authorId ? [p.authorId] : []);

    a.appendChild(topRow(p));
    if (p.example) a.appendChild(el('p', 'ex-note', L('Example article with placeholder text. It shows the layout and will be replaced by real news.', 'Пример материала с рыбатекстом. Показывает вёрстку и будет заменён реальными новостями.')));
    var h = el('h1', null, p.title);
    h.id = 'r-title';
    a.appendChild(h);
    if (p.dek) a.appendChild(el('p', 'dek', p.dek));

    var by = el('div', 'byline'), au = el('span');
    au.appendChild(document.createTextNode(L('By ', 'Автор: ')));
    au.appendChild(el('b', null, authorOf(p, ps)));
    by.appendChild(au);
    by.appendChild(el('span', null, L('Published ', 'Опубликовано ') + fmtDate(p.publishedAt)));
    if (p.updatedAt && p.updatedAt !== p.publishedAt) by.appendChild(el('span', null, L('Updated ', 'Обновлено ') + fmtDate(p.updatedAt)));
    if (p.region) by.appendChild(el('span', null, p.region));
    a.appendChild(by);

    /* body: blank-line separated paragraphs, "## " starts a subheading */
    var body = el('div', 'body');
    String(p.body || '').split(/\n\s*\n/).forEach(function (par) {
      par = par.trim();
      if (!par) return;
      body.appendChild(par.indexOf('## ') === 0 ? el('h3', null, par.slice(3)) : el('p', null, par));
    });
    a.appendChild(body);

    var lb = box(L('Level of evidence', 'Уровень доказательности')), le = el('div', 'lvl-explain'), i = lvlIdx(p.level);
    le.appendChild(lvlBadge(p.level));
    le.appendChild(el('span', null, L(LVLS[i][3], LVLS[i][4])));
    lb.appendChild(le);
    a.appendChild(lb);

    var sb = box(L('Sources', 'Источники')), ol = el('ol');
    (p.sources || []).forEach(function (s, k) {
      var li = el('li'), d = el('div');
      li.appendChild(el('span', 'n', String(k + 1)));
      if (s.url && /^https?:\/\//i.test(s.url)) {
        var an = el('a', null, s.label || s.url);
        an.href = s.url; an.target = '_blank'; an.rel = 'noopener noreferrer';
        d.appendChild(an);
      } else {
        d.appendChild(el('span', null, s.label || ''));
      }
      if (s.date) { d.appendChild(el('br')); d.appendChild(el('span', 'd', s.date)); }
      li.appendChild(d);
      ol.appendChild(li);
    });
    if (!(p.sources || []).length) {
      var li0 = el('li');
      li0.appendChild(el('span', 'n', '—'));
      li0.appendChild(el('span', 'd', L('No sources: published as a hypothesis.', 'Без источников: опубликовано как гипотеза.')));
      ol.appendChild(li0);
    }
    sb.appendChild(ol);
    a.appendChild(sb);

    var db2 = box(L('Disclosure', 'Раскрытие связей'));
    db2.appendChild(el('p', 'disc', p.disclosure || '—'));
    a.appendChild(db2);

    $('#r-actions').hidden = !S.canEdit;
    resetDelete();
    if (!keep) {
      $('#reader').hidden = false;
      lock(true);
      $('#reader .sheet-b').scrollTop = 0;
      $('#r-close').focus();
    }
    try { history.replaceState(null, '', '#a-' + id); } catch (e) { /* sandboxed */ }
  }

  function closeReader() {
    $('#reader').hidden = true;
    S.open = null;
    lock(!$('#editor').hidden);
    if (isNewsHash()) { try { history.replaceState(null, '', '#news'); } catch (e) { /* sandboxed */ } }
    if (lastFocus) lastFocus.focus();
  }
  $('#r-close').onclick = closeReader;

  /* two-step delete: first click arms for 4 s */
  var deleteArmed = null;
  function resetDelete() {
    clearTimeout(deleteArmed);
    deleteArmed = null;
    $('#r-del').innerHTML = '<span class="en">Delete</span><span class="ru">Удалить</span>';
  }
  $('#r-del').onclick = async function () {
    if (!deleteArmed) {
      $('#r-del').innerHTML = '<span class="en">Confirm delete</span><span class="ru">Подтвердить удаление</span>';
      deleteArmed = setTimeout(resetDelete, 4000);
      return;
    }
    var id = S.open;
    resetDelete();
    try { await db.doc('posts/' + id).delete(); closeReader(); toast(L('Article deleted', 'Материал удалён')); }
    catch (e) { toast(errText(e)); }
  };
  $('#r-edit').onclick = function () {
    var p = S.posts.find(function (x) { return x.id === S.open; });
    if (p) { closeReader(); openEditor(p); }
  };

  /* ---------- editor ---------- */
  function buildCats(keep) {
    var s = $('#f-cat'), v = s.value;
    s.textContent = '';
    CATS.forEach(function (c) { var o = el('option', null, L(c[1], c[2])); o.value = c[0]; s.appendChild(o); });
    if (keep && v) s.value = v;
  }
  function currentLevel() { return (sr.querySelector('input[name=lvl]:checked') || {}).value || 'hypothesis'; }
  function buildLevelSeg() {
    var w = $('#f-level'), cur = currentLevel();
    w.textContent = '';
    LVLS.forEach(function (l, i) {
      var inp = el('input');
      inp.type = 'radio'; inp.name = 'lvl'; inp.id = 'lv-' + l[0]; inp.value = l[0];
      if (l[0] === cur) inp.checked = true;
      inp.onchange = updateLevelHelp;
      var lab = el('label');
      lab.htmlFor = inp.id;
      lab.appendChild(el('b', null, (i + 1) + ' · ' + L(l[1], l[2])));
      lab.appendChild(el('span', null, L(l[3], l[4])));
      w.appendChild(inp);
      w.appendChild(lab);
    });
    updateLevelHelp();
  }
  function updateLevelHelp() {
    $('#lvl-help').textContent = currentLevel() === 'hypothesis'
      ? L('Sources are optional for a hypothesis; label it clearly in the text.', 'Для гипотезы источники необязательны; явно обозначьте это в тексте.')
      : L('At least one source with a date is required at this level.', 'На этом уровне нужен минимум один источник с датой.');
  }
  function sourceRow(s) {
    s = s || {};
    var r = el('div', 'src-row');
    var a = el('input'); a.type = 'text'; a.placeholder = L('Title / publisher', 'Название / издатель'); a.value = s.label || ''; a.maxLength = 200;
    var b = el('input'); b.type = 'url'; b.placeholder = 'https://'; b.value = s.url || ''; b.maxLength = 500;
    var c = el('input'); c.type = 'date'; c.value = s.date || ''; c.setAttribute('aria-label', L('Date', 'Дата'));
    var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', L('Remove source', 'Убрать источник'));
    x.onclick = function () { r.remove(); };
    r.append(a, b, c, x);
    return r;
  }
  $('#src-add').onclick = function () {
    $('#src-list').appendChild(sourceRow());
    $('#src-list').lastChild.querySelector('input').focus();
  };

  function openEditor(p) {
    S.editing = p ? p.id : null;
    $('#form').reset();
    $('#e-title').innerHTML = p ? '<span class="en">Edit article</span><span class="ru">Редактирование</span>' : '<span class="en">New article</span><span class="ru">Новый материал</span>';
    $('#f-submit').innerHTML = p ? '<span class="en">Save changes</span><span class="ru">Сохранить</span>' : '<span class="en">Publish</span><span class="ru">Опубликовать</span>';
    buildCats();
    buildLevelSeg();
    $('#f-cat').value = p ? p.category : (S.cat !== 'all' ? S.cat : 'discovery');
    sr.getElementById('lv-' + (p ? p.level : 'hypothesis')).checked = true;
    updateLevelHelp();
    $('#f-title').value = p ? p.title : '';
    $('#f-dek').value = p ? (p.dek || '') : '';
    $('#f-body').value = p ? (p.body || '') : '';
    $('#f-byline').value = p ? (p.byline || '') : '';
    $('#f-region').value = p ? (p.region || '') : '';
    $('#f-disc').value = p ? (p.disclosure || '') : L('Fons Latens has no financial ties to the companies mentioned.', 'У Fons Latens нет финансовых связей с упомянутыми компаниями.');
    var sl = $('#src-list');
    sl.textContent = '';
    (p && p.sources && p.sources.length ? p.sources : [{}]).forEach(function (s) { sl.appendChild(sourceRow(s)); });
    $$('.f.invalid').forEach(function (x) { x.classList.remove('invalid'); });
    $$('.f .err').forEach(function (x) { x.hidden = true; });
    $('#c-title').textContent = $('#f-title').value.length + ' / 140';
    lastFocus = sr.activeElement;
    $('#editor').hidden = false;
    lock(true);
    $('#editor .sheet-b').scrollTop = 0;
    $('#f-title').focus();
  }
  function closeEditor() {
    $('#editor').hidden = true;
    S.editing = null;
    lock(!$('#reader').hidden);
    if (lastFocus) lastFocus.focus();
  }
  $('#e-close').onclick = closeEditor;
  $('#new-btn').onclick = function () { openEditor(); };
  $('#empty-new').onclick = function () { openEditor(); };
  $('#f-title').oninput = function (e) { $('#c-title').textContent = e.target.value.length + ' / 140'; };

  /* mark a field invalid; returns `on` so checks can be chained */
  function invalid(k, on, msg) {
    var f = sr.querySelector('.f[data-k="' + k + '"]');
    f.classList.toggle('invalid', on);
    var e = f.querySelector('.err');
    if (e) { e.hidden = !on; if (msg) e.textContent = msg; }
    return on;
  }

  $('#form').onsubmit = async function (e) {
    e.preventDefault();
    if (!db) return;
    var title = $('#f-title').value.trim(), body = $('#f-body').value.trim(), disc = $('#f-disc').value.trim(), level = currentLevel();
    var sources = $$('#src-list .src-row').map(function (r) {
      var i = r.querySelectorAll('input');
      return { label: i[0].value.trim(), url: i[1].value.trim(), date: i[2].value };
    }).filter(function (s) { return s.label || s.url; });

    /* evidence standard: levels above hypothesis need a dated source; disclosure is always required */
    var err = false;
    err = invalid('title', title.length < 8) || err;
    err = invalid('body', !body) || err;
    err = invalid('disc', !disc) || err;
    var badUrl = sources.find(function (s) { return s.url && !/^https?:\/\/\S+$/i.test(s.url); });
    var needSource = level !== 'hypothesis' && (!sources.length || sources.some(function (s) { return !s.date; }));
    err = invalid('sources', !!badUrl || needSource, badUrl
      ? L('Links must start with http:// or https://', 'Ссылка должна начинаться с http:// или https://')
      : L('Add at least one source with a date for this level of evidence.', 'Для этого уровня добавьте хотя бы один источник с датой.')) || err;
    if (err) { var f = sr.querySelector('.f.invalid input, .f.invalid textarea'); if (f) f.focus(); return; }

    var now = new Date().toISOString(), btn = $('#f-submit');
    btn.disabled = true;
    var doc = {
      title: title, dek: $('#f-dek').value.trim(), body: body, category: $('#f-cat').value, level: level,
      region: $('#f-region').value.trim(), byline: $('#f-byline').value.trim(), sources: sources, disclosure: disc, updatedAt: now
    };
    try {
      if (S.editing) {
        var old = S.posts.find(function (p) { return p.id === S.editing; }) || {};
        await db.doc('posts/' + S.editing).set(Object.assign({}, doc, { publishedAt: old.publishedAt || now, authorId: old.authorId || S.uid || null }));
        toast(L('Changes saved', 'Изменения сохранены'));
      } else {
        await db.collection('posts').add(Object.assign({}, doc, { publishedAt: now, authorId: S.uid || null }));
        toast(L('Published', 'Опубликовано'));
      }
      closeEditor();
    } catch (ex) {
      toast(errText(ex));
    } finally {
      btn.disabled = false;
    }
  };

  function errText(e) {
    var c = e && e.code;
    if (c === 'invalid_argument') return L('You do not have permission to publish here', 'Нет прав на публикацию');
    if (c === 'quota_exceeded') return L('Storage is full: delete old articles first', 'Хранилище заполнено: удалите старые материалы');
    if (c === 'resource_exhausted') return L('Too many actions: try again in a moment', 'Слишком много действий, попробуйте чуть позже');
    return L('Could not save. Check the connection and try again', 'Не удалось сохранить. Проверьте соединение и повторите');
  }

  var toastTimer;
  function toast(m) {
    $('#toast-t').textContent = m;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('#toast').hidden = true; }, 2600);
  }

  document.addEventListener('keydown', function (e) {
    if (host.hidden || e.key !== 'Escape') return;
    if (!$('#editor').hidden) closeEditor();
    else if (!$('#reader').hidden) closeReader();
  });
  $('#scrim').onclick = function () { if (!$('#editor').hidden) closeEditor(); else closeReader(); };

  /* ---------- routing hooks + data ---------- */
  function syncFromHash() {
    var h = location.hash;
    if (h.indexOf('#a-') === 0) {
      var id = h.slice(3);
      if (S.posts.find(function (p) { return p.id === id; }) && S.open !== id) openArticle(id);
    } else if (S.open && !$('#reader').hidden) {
      closeReader();
    }
  }

  function showNotice(msg) { var n = $('#notice'); n.hidden = false; n.textContent = msg; }

  function useSnapshot() {
    if (!window.NEWS_SNAPSHOT) return false;
    S.posts = window.NEWS_SNAPSHOT.slice();
    S.loaded = true;
    buildFilters();
    render();
    syncFromHash();
    return true;
  }

  async function start() {
    if (!window.claude || !claude.use) {
      if (useSnapshot()) return;
      S.loaded = true;
      showNotice(L('The newsroom database is not available in this view.', 'База материалов недоступна в этом окне.'));
      render();
      return;
    }
    var caps = await Promise.all([claude.use('db'), claude.use('user')]);
    db = caps[0]; user = caps[1];
    if (user) { try { S.realEdit = await user.canEdit(); S.uid = await user.id(); } catch (e) { /* treat as reader */ } }
    S.reader = store.get(KEY_READER) === '1';
    applyMode();
    if (!db) {
      if (useSnapshot()) return;
      S.loaded = true;
      showNotice(L('Sign in to claude.ai to read the newsroom.', 'Войдите в claude.ai, чтобы читать ленту.'));
      render();
      return;
    }
    db.collection('posts').orderBy('publishedAt', 'desc').limit(500).onSnapshot(function (snap) {
      S.posts = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      S.loaded = true;
      buildFilters();
      render();
      if (S.open) {
        if (S.posts.find(function (p) { return p.id === S.open; })) openArticle(S.open, true);
        else closeReader();
      } else {
        syncFromHash();
      }
    }, function () {
      S.loaded = true;
      showNotice(L('The feed stopped updating. Reload the page to reconnect.', 'Лента перестала обновляться. Перезагрузите страницу.'));
      render();
    });
  }

  /* Called by router.js. Data loads lazily on the first visit to the newsroom. */
  FL.news = {
    show: function () {
      if (!started) { started = true; start(); }
      requestAnimationFrame(function () { drawLeadArt(); syncFromHash(); });
    },
    hide: function () {
      if (!$('#editor').hidden) closeEditor();
      if (!$('#reader').hidden) closeReader();
      lock(false);
    }
  };

  applyLang();
})(window.FL);

/* ==== scripts/router.js ==== */
/*
 * router.js — hash routing inside one document (the artifact host only allows plain #token hashes).
 *
 *   #exploration | #equipment | #researchers  → audience page rendered into #subpage
 *   #news | #a-<postId>                       → newsroom (#newspage, see news/news.js)
 *   anything else                             → home; a section id scrolls to that section
 */
(function (FL) {
  'use strict';

  var $ = FL.$;
  var home = $('main#top'), sub = $('#subpage'), newsEl = document.getElementById('newspage');
  var PAGES = FL.partnerPages.pages;
  var rendered = null;

  function markPage(k) {
    document.querySelectorAll('#menu a[data-page]').forEach(function (a) {
      var on = a.dataset.page === k;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function isNewsRoute(k) { return k === 'news' || k.indexOf('a-') === 0; }

  function showNews() {
    var wasOpen = !newsEl.hidden;
    home.hidden = true; sub.hidden = true; newsEl.hidden = false;
    document.body.classList.add('on-sub');
    markPage('news');
    document.title = FL.L('News', 'Новости') + ' · Fons Latens';
    if (!wasOpen) window.scrollTo(0, 0);
    if (FL.news) FL.news.show();
  }

  function showPartnerPage(k) {
    if (rendered !== k) { FL.renderPartnerPage(k, sub); rendered = k; }
    home.hidden = true; sub.hidden = false;
    document.body.classList.add('on-sub');
    markPage(k);
    document.title = PAGES[k].tab[FL.lang() === 'ru' ? 1 : 0] + ' · Fons Latens';
    window.scrollTo(0, 0);
  }

  function showHome(k, scroll) {
    var fromSub = !sub.hidden;
    sub.hidden = true; home.hidden = false;
    document.body.classList.remove('on-sub');
    markPage('home');
    document.title = 'Fons Latens';
    if (fromSub || scroll) {
      window.dispatchEvent(new Event('resize'));   // canvases were measured while hidden
      var target = k && document.getElementById(k);
      if (target) requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
      else if (fromSub) window.scrollTo(0, 0);
    }
  }

  function route(scroll) {
    var k = (location.hash || '').slice(1);
    if (isNewsRoute(k)) return showNews();
    if (!newsEl.hidden) { newsEl.hidden = true; if (FL.news) FL.news.hide(); }
    if (PAGES[k]) showPartnerPage(k);
    else showHome(k, scroll);
  }

  addEventListener('hashchange', function () { route(true); });

  /* In-page scroll buttons that must not touch the hash (it would trigger routing) */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-scroll]');
    if (!b) return;
    var t = document.getElementById(b.dataset.scroll);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  FL.route = route;
})(window.FL);

/* ==== scripts/boot.js ==== */
/*
 * boot.js — runs last: sizes canvases, restores language, wires resize, and resolves the initial route.
 */
(function (FL) {
  'use strict';

  FL.hero.size();
  FL.globe.size();
  FL.prefs.restoreLang();

  var resizeTimer;
  addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { FL.hero.size(); FL.globe.size(); }, 120);
  });

  /* Globe labels use JetBrains Mono — redraw once web fonts are in */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { FL.hero.draw(); FL.globe.draw(); });
  }

  FL.route(false);
})(window.FL);
