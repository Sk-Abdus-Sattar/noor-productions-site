import * as THREE from 'three';

/* =========================================================
   PERFORMANCE GOVERNOR
   Central switch so any render loop we add later (per-section)
   can register/unregister itself. Nothing runs when the tab
   is hidden or the panel is off-screen — this is the pattern
   every future section's 3D/animated piece will plug into.
========================================================= */
const RenderBus = {
  loops: new Set(),
  running: false,
  add(fn){ this.loops.add(fn); this._ensure(); },
  remove(fn){ this.loops.delete(fn); },
  _ensure(){
    if (this.running) return;
    this.running = true;
    const tick = (t) => {
      if (document.hidden) { this.running = false; return; } // stop clock entirely when tab hidden
      this.loops.forEach(fn => fn(t));
      if (this.loops.size) requestAnimationFrame(tick);
      else this.running = false;
    };
    requestAnimationFrame(tick);
  }
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) RenderBus._ensure();
});

/* =========================================================
   LOADER — an actively-moving hyper-structure, not a flat
   2D reveal. Built in three layers:
     1. a core cube at the center
     2. 6 "face" cubes, one off each face of the core, that
        continuously swap through the core with the cube on
        the opposite axis (a stylized nod to a rotating 4D
        object folding its cells through the center — true
        5D/6D geometry can't be literally rendered, so this
        is an artistic approximation of that "turning inside
        out" read, not a rigorous projection)
     3. 4 corner cubes (alternating corners of the bounding
        box, i.e. a tetrahedral subset of the cube's 8
        corners) linked by thin lines to nearby face-cubes,
        to keep the whole thing visually tied together
   ...all enclosed by a real 4D tesseract (16 vertices, 32
   edges, genuinely rotated in 4D and projected into 3D so
   depth/parallax read naturally through the WebGL camera,
   rather than flattened to a 2D SVG like the old version).
   The percent counter is separate and just tracks elapsed
   time — the object doesn't need to double as a progress
   bar, it just needs to look alive while the number ticks.
========================================================= */
function tesseractVertices4D(){
  const verts = [];
  for (let i = 0; i < 16; i++){
    verts.push([
      (i & 1) ? 1 : -1,
      (i & 2) ? 1 : -1,
      (i & 4) ? 1 : -1,
      (i & 8) ? 1 : -1
    ]);
  }
  return verts;
}

function tesseractEdgeList(verts){
  const edges = [];
  for (let i = 0; i < 16; i++){
    for (let j = i + 1; j < 16; j++){
      let diff = 0;
      for (let k = 0; k < 4; k++) if (verts[i][k] !== verts[j][k]) diff++;
      if (diff === 1) edges.push([i, j]);
    }
  }
  return edges; // 32 edges
}

function project4Dto3D([x, y, z, w], rXY, rZW, rXW){
  // rotate in the XY plane, then ZW, then XW — a convincing 4D tumble
  const x1 = x * Math.cos(rXY) - y * Math.sin(rXY);
  const y1 = x * Math.sin(rXY) + y * Math.cos(rXY);
  const z1 = z * Math.cos(rZW) - w * Math.sin(rZW);
  const w1 = z * Math.sin(rZW) + w * Math.cos(rZW);
  const x2 = x1 * Math.cos(rXW) - w1 * Math.sin(rXW);
  const w2 = x1 * Math.sin(rXW) + w1 * Math.cos(rXW);

  const f1 = 1 / (2.4 - w2); // 4D -> 3D perspective collapse (stop here — three.js camera does 3D -> 2D)
  return [x2 * f1, y1 * f1, z1 * f1];
}

function easeInOutCubic(x){ return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2; }

function runLoader(onComplete){
  const canvas = document.getElementById('loader-canvas');
  const percentEl = document.getElementById('loader-percent');
  const loaderEl = document.getElementById('loader');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(300, 300, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.4, 9.2);
  camera.lookAt(0, 0, 0);

  const rig = new THREE.Group();
  scene.add(rig);

  function cubeWire(size, color, opacity = 1){
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
    const mat = new THREE.LineBasicMaterial({ color, transparent:true, opacity });
    return new THREE.LineSegments(geo, mat);
  }

  /* ---- 1. core cube ---- */
  const core = cubeWire(1.0, 0xf0cd7a, 1);
  rig.add(core);

  /* ---- 2. six face cubes, swapping through the core with their axis partner ---- */
  const AXES = [
    [1,0,0], [-1,0,0],
    [0,1,0], [0,-1,0],
    [0,0,1], [0,0,-1]
  ];
  const DOCK_DIST = 1.65;
  const faceCubes = AXES.map((axis, i) => {
    const mesh = cubeWire(0.5, 0xc9a15a, 0.95);
    mesh.userData = {
      axis: new THREE.Vector3(...axis),
      phase: (i % 3) * (Math.PI / 3) // stagger the 3 axis-pairs so they don't swap in lockstep
    };
    rig.add(mesh);
    return mesh;
  });

  /* ---- 3. four corner cubes (alternating corners = a tetrahedral subset of the 8) ---- */
  const CORNER_SIGNS = [ [1,1,1], [1,-1,-1], [-1,1,-1], [-1,-1,1] ];
  const CORNER_DIST = 2.35;
  const cornerCubes = CORNER_SIGNS.map(s => {
    const mesh = cubeWire(0.34, 0xf0cd7a, 0.8);
    const pos = new THREE.Vector3(...s).normalize().multiplyScalar(CORNER_DIST);
    mesh.position.copy(pos);
    rig.add(mesh);
    return mesh;
  });

  // thin lines tying each corner cube to its two nearest (sign-matching) face cubes — "maintain the flow"
  const flowGeo = new THREE.BufferGeometry();
  const flowPositions = new Float32Array(CORNER_SIGNS.length * 3 /*links each*/ * 2 * 3);
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPositions, 3));
  const flowMat = new THREE.LineBasicMaterial({ color: 0x6b5730, transparent:true, opacity:0.55 });
  const flowLines = new THREE.LineSegments(flowGeo, flowMat);
  rig.add(flowLines);
  const flowLinks = []; // [cornerIdx, faceIdx] pairs, same-sign axis on at least one component
  CORNER_SIGNS.forEach((s, ci) => {
    faceCubes.forEach((fc, fi) => {
      const a = fc.userData.axis;
      if ((a.x && Math.sign(a.x) === s[0]) || (a.y && Math.sign(a.y) === s[1]) || (a.z && Math.sign(a.z) === s[2])){
        flowLinks.push([ci, fi]);
      }
    });
  });

  /* ---- outer tesseract, real 4D rotation projected into 3D ---- */
  const verts4D = tesseractVertices4D();
  const edgeList = tesseractEdgeList(verts4D);
  const tessGeo = new THREE.BufferGeometry();
  const tessPositions = new Float32Array(edgeList.length * 2 * 3);
  tessGeo.setAttribute('position', new THREE.BufferAttribute(tessPositions, 3));
  const tessMat = new THREE.LineBasicMaterial({ color: 0xc9a15a, transparent:true, opacity:0.5 });
  const tesseract = new THREE.LineSegments(tessGeo, tessMat);
  rig.add(tesseract);
  const TESS_SCALE = 3.1;

  const duration = 2600; // ms — long enough for the assembly to read clearly
  const start = performance.now();
  let raf = null;

  function frame(now){
    const elapsed = now - start;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(progress);
    const t = now * 0.001;

    // assemble in: scale + fade the whole rig up from nothing as it "loads"
    const assemble = Math.min(1, eased * 1.3);
    rig.scale.setScalar(0.5 + 0.5 * assemble);
    rig.traverse(o => { if (o.material) o.material.opacity = (o.material.userData?.baseOpacity ?? o.material.opacity) * assemble; });

    // gentle continuous tumble of the whole assembly
    rig.rotation.y = t * 0.42;
    rig.rotation.x = Math.sin(t * 0.31) * 0.32;

    // face cubes: swap through the core with their opposite-axis partner, staggered per pair
    faceCubes.forEach(mesh => {
      const swing = Math.sin(t * 0.9 + mesh.userData.phase) * 0.5 + 0.5; // 0..1
      const e = easeInOutCubic(swing);
      const dist = DOCK_DIST * (1 - 2 * e); // +DOCK_DIST -> -DOCK_DIST and back, passing through the core
      mesh.position.copy(mesh.userData.axis).multiplyScalar(dist);
      const s = 0.5 + Math.sin(e * Math.PI) * 0.18; // pulses slightly larger as it passes near the core
      mesh.scale.setScalar(s);
    });

    // corner cubes drift very slightly for life, and update the tie-lines to their linked face cubes
    cornerCubes.forEach((mesh, i) => {
      const base = new THREE.Vector3(...CORNER_SIGNS[i]).normalize().multiplyScalar(CORNER_DIST);
      mesh.position.copy(base).addScalar(Math.sin(t * 0.6 + i) * 0.06);
      mesh.rotation.x = t * 0.5; mesh.rotation.y = t * 0.35;
    });
    const flowPos = flowLines.geometry.attributes.position;
    flowLinks.forEach(([ci, fi], li) => {
      const c = cornerCubes[ci].position, f = faceCubes[fi].position;
      flowPos.setXYZ(li * 2, c.x, c.y, c.z);
      flowPos.setXYZ(li * 2 + 1, f.x, f.y, f.z);
    });
    flowPos.needsUpdate = true;

    // outer tesseract: real 4D rotation, projected to 3D, scaled to enclose the whole assembly
    const rXY = now * 0.00042, rZW = now * 0.00031, rXW = now * 0.00021;
    const tessPos = tesseract.geometry.attributes.position;
    edgeList.forEach(([a, b], i) => {
      const pa = project4Dto3D(verts4D[a], rXY, rZW, rXW);
      const pb = project4Dto3D(verts4D[b], rXY, rZW, rXW);
      tessPos.setXYZ(i * 2, pa[0]*TESS_SCALE, pa[1]*TESS_SCALE, pa[2]*TESS_SCALE);
      tessPos.setXYZ(i * 2 + 1, pb[0]*TESS_SCALE, pb[1]*TESS_SCALE, pb[2]*TESS_SCALE);
    });
    tessPos.needsUpdate = true;

    renderer.render(scene, camera);
    percentEl.textContent = String(Math.floor(eased * 100)).padStart(2, '0');

    if (progress < 1){
      raf = requestAnimationFrame(frame);
    } else {
      setTimeout(() => {
        loaderEl.classList.add('done');
        onComplete();
        // free the loader's WebGL context shortly after — the hero opens two more of its own
        setTimeout(() => {
          if (raf) cancelAnimationFrame(raf);
          renderer.dispose();
        }, 900);
      }, 350);
    }
  }
  // materials don't expose a "base opacity" by default — stash it so the assemble-fade above has something to scale from
  rig.traverse(o => { if (o.material) o.material.userData.baseOpacity = o.material.opacity; });
  raf = requestAnimationFrame(frame);
}

/* =========================================================
   HERO — particle field (ambient) + reactive wireframe object
========================================================= */
function initHero(){
  const particleCanvas = document.getElementById('particle-canvas');
  const objectCanvas = document.getElementById('object-canvas');
  const hero = document.getElementById('hero');

  const isMobile = window.innerWidth < 720;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  /* ---- Renderers ---- */
  const particleRenderer = new THREE.WebGLRenderer({ canvas: particleCanvas, alpha: true, antialias: false });
  particleRenderer.setPixelRatio(dpr);
  const objectRenderer = new THREE.WebGLRenderer({ canvas: objectCanvas, alpha: true, antialias: true });
  objectRenderer.setPixelRatio(dpr);

  function sizeRenderers(){
    const w = hero.clientWidth, h = hero.clientHeight;
    particleRenderer.setSize(w, h);
    objectRenderer.setSize(w, h);
    pCamera.aspect = w/h; pCamera.updateProjectionMatrix();
    oCamera.aspect = w/h; oCamera.updateProjectionMatrix();
  }

  /* ---- Particle scene ---- */
  const pScene = new THREE.Scene();
  const pCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  pCamera.position.z = 30;

  const particleCount = isMobile ? 260 : 700;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++){
    positions[i*3]   = (Math.random() - 0.5) * 70;
    positions[i*3+1] = (Math.random() - 0.5) * 40;
    positions[i*3+2] = (Math.random() - 0.5) * 40;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xc9a15a,
    size: isMobile ? 0.18 : 0.14,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const points = new THREE.Points(pGeo, pMat);
  pScene.add(points);

  /* ---- Object scene: wireframe polyhedron with glow halo ---- */
  const oScene = new THREE.Scene();
  const oCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  oCamera.position.z = 9;

  const objGroup = new THREE.Group();
  objGroup.position.y = isMobile ? 0.4 : 0.5; // sits above the wordmark, not on top of it
  oScene.add(objGroup);

  /* ---- Particle-cloud object: morphs between three forms ---- */
  const PARTICLE_N = isMobile ? 900 : 2200;

  function sampleGlyph(str, n, targetSize = 5.4){
    // Renders any text or emoji to an offscreen canvas, samples its pixels,
    // and returns n particle positions scattered across that silhouette.
    // This one function powers every preset shape AND visitor-typed input.
    const res = 480;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = res;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, res, res);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let fontSize = res * 0.72;
    const fontStack = (px) => `bold ${px}px "Arial Black","Segoe UI Emoji","Noto Color Emoji","Segoe UI",sans-serif`;
    ctx.font = fontStack(fontSize);
    let w = ctx.measureText(str).width;
    while (w > res * 0.88 && fontSize > 24){
      fontSize -= 6;
      ctx.font = fontStack(fontSize);
      w = ctx.measureText(str).width;
    }
    ctx.fillStyle = '#fff';
    ctx.fillText(str, res / 2, res / 2 + fontSize * 0.04);

    const data = ctx.getImageData(0, 0, res, res).data;
    const pxList = [];
    for (let y = 0; y < res; y += 2){
      for (let x = 0; x < res; x += 2){
        if (data[(y * res + x) * 4 + 3] > 120) pxList.push(x, y);
      }
    }
    if (pxList.length === 0) pxList.push(res/2, res/2); // safety fallback for unrenderable input

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (let i = 0; i < pxList.length; i += 2){
      const x = pxList[i], y = pxList[i+1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
    const span = Math.max(maxX-minX, maxY-minY, 1);
    const scale = targetSize / span;
    const pointCount = pxList.length / 2;

    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){
      const k = (Math.floor(Math.random() * pointCount)) * 2;
      out[i*3]   = (pxList[k] - cx) * scale;
      out[i*3+1] = -(pxList[k+1] - cy) * scale;
      out[i*3+2] = (Math.random() - 0.5) * 0.55; // slight depth jitter so it isn't paper-flat
    }
    return out;
  }

  // Default cycle — every one of these renders through the same glyph sampler above.
  const PRESETS = ['❤️', '👨\u200d💻', 'S', 'A', 'N', '💎', '🍩', '💲', '☝️', '🌊'];
  const shapes = PRESETS.map(p => sampleGlyph(p, PARTICLE_N));

  const cloudGeo = new THREE.BufferGeometry();
  const livePositions = new Float32Array(shapes[0]);
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(livePositions, 3));

  // Subtle two-tone gold via per-particle color for depth
  const colors = new Float32Array(PARTICLE_N * 3);
  const cA = new THREE.Color(0xf7dd9a), cB = new THREE.Color(0xc9a15a);
  for (let i = 0; i < PARTICLE_N; i++){
    const c = cA.clone().lerp(cB, Math.random());
    colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
  }
  cloudGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const cloudMat = new THREE.PointsMaterial({
    size: isMobile ? 0.044 : 0.036,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  objGroup.add(cloud);

  // Soft radial-gradient sprite behind the object simulates a bloom halo cheaply (no postprocessing pass needed)
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 256;
  const gctx = glowCanvas.getContext('2d');
  const grad = gctx.createRadialGradient(128,128,0,128,128,128);
  grad.addColorStop(0, 'rgba(240,205,122,0.42)');
  grad.addColorStop(0.5, 'rgba(201,161,90,0.12)');
  grad.addColorStop(1, 'rgba(201,161,90,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0,0,256,256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent:true, blending: THREE.AdditiveBlending, depthWrite:false });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.set(2.8, 2.8, 1); // stays under the tightest silhouette's radius so it accents, never masks
  objGroup.add(glowSprite);

  const innerLight = new THREE.PointLight(0xf0cd7a, 8, 14);
  objGroup.add(innerLight);

  /* ---- Morph scheduler ----
     Simple state machine: holds on a preset shape, then eases into the next. */
  const HOLD_DUR = 3600, MORPH_DUR = 2200;
  let nextPresetIndex = 1;
  const state = { holding: true, timer: 0, from: null, to: null, holdDur: HOLD_DUR };
  function easeInOutCubic(x){ return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2; }

  function beginMorphTo(target, holdDur){
    state.from = livePositions.slice();
    state.to = target;
    state.holding = false;
    state.timer = 0;
    state.holdDur = holdDur;
  }

  function stepMorph(dtMs){
    if (state.holding){
      state.timer += dtMs;
      if (state.timer >= state.holdDur){
        beginMorphTo(shapes[nextPresetIndex], HOLD_DUR);
        nextPresetIndex = (nextPresetIndex + 1) % shapes.length;
      }
      return;
    }
    state.timer += dtMs;
    const t = Math.min(1, state.timer / MORPH_DUR);
    const e = easeInOutCubic(t);
    const a = state.from, b = state.to;
    for (let i = 0; i < livePositions.length; i++){
      livePositions[i] = a[i] + (b[i] - a[i]) * e;
    }
    cloudGeo.attributes.position.needsUpdate = true;
    if (t >= 1){ state.holding = true; state.timer = 0; state.holdDur = HOLD_DUR; }
  }

  sizeRenderers();
  window.addEventListener('resize', sizeRenderers);

  /* ---- Mouse tracking (lerped, so motion stays smooth/cheap) ---- */
  const mouse = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  let t = 0;
  let lastFrame = performance.now();
  function tick(now){
    const dt = now - lastFrame;
    lastFrame = now;
    t += 0.0045;
    mouse.x += (target.x - mouse.x) * 0.04;
    mouse.y += (target.y - mouse.y) * 0.04;

    // ambient particle drift + gentle parallax
    points.rotation.y = t * 0.12 + mouse.x * 0.08;
    points.rotation.x = mouse.y * 0.04;

    // morphing particle-cloud object: idle spin + cursor tilt + shape morph
    stepMorph(dt);
    cloud.rotation.y += 0.0032;
    cloud.rotation.x = mouse.y * 0.35;
    cloud.rotation.z = mouse.x * 0.15;
    objGroup.position.y = (isMobile ? 0.4 : 0.5) + Math.sin(t * 1.3) * 0.18;

    particleRenderer.render(pScene, pCamera);
    objectRenderer.render(oScene, oCamera);
  }
  RenderBus.add(tick);
}

/* =========================================================
   HUD readouts — live clock + faux coordinates that drift subtly
========================================================= */
function initHUD(){
  const coordsEl = document.getElementById('hud-coords');
  const timeEl = document.getElementById('hud-time');
  const baseLat = 23.2599, baseLng = 87.8615; // Bardhaman, grounding the HUD in something real

  function update(){
    const now = new Date();
    timeEl.textContent = now.toTimeString().slice(0,8);
    const jitter = Math.sin(Date.now() / 4000) * 0.002;
    coordsEl.textContent = `${(baseLat + jitter).toFixed(4)}° N`;
  }
  update();
  setInterval(update, 1000);
}

/* =========================================================
   TEXT REVEAL — glitch wordmark + typed subtitle, sequenced with GSAP
========================================================= */
function revealHeroText(){
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  tl.to('.eyebrow', { opacity: 1, duration: 0.6 })
    .fromTo('#wordmark .line', {
        opacity: 0, y: 26, filter: 'blur(6px)'
      }, {
        opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, stagger: 0.15,
        onStart: () => document.querySelectorAll('#wordmark .line').forEach(l => l.classList.add('glitching'))
      }, '-=0.2')
    .add(typeSubtitle, '-=0.1');
}

function typeSubtitle(){
  const text = 'Web Design & Digital Architecture';
  const el = document.getElementById('typed-sub');
  let i = 0;
  const speed = 28;
  function step(){
    el.textContent = text.slice(0, i);
    i++;
    if (i <= text.length) setTimeout(step, speed);
  }
  step();
}

/* =========================================================
   WHY NOOR — ARC WHEEL BRIEFING
   Real flashcard DOM elements flow along a half-ring whose
   centre is pinned to the right edge of the screen. The ring
   auto-rotates slowly and continuously; hovering ANY card (or
   expanding one, or opening the reading modal) freezes it.
   - Single click  -> expand the card in place
   - Double click  -> pop it into a large centred reading modal
   - 3D tilt + tight gold torch spotlight while hovering a card
========================================================= */
function initWhyNoor(){
  const scene = document.getElementById('arc-scene');
  if (!scene) return;
  const leftCol = document.querySelector('.arc-left');

  const modal        = document.getElementById('card-modal');
  const modalBackdrop= document.getElementById('card-modal-backdrop');
  const modalClose   = document.getElementById('card-modal-close');
  const modalIndex   = document.getElementById('modal-index');
  const modalTitle   = document.getElementById('modal-title');
  const modalBody    = document.getElementById('modal-body');

  const CARDS = [
    {
      index: '01 / FIELD',
      title: 'Digital architecture,<br>not web design',
      body:  'Most "web design" today means a template with swapped colors. We treat every build as architecture — structural calls about performance, motion, and how a brand actually feels in someone\'s hand. Fewer plugins, more intention.'
    },
    {
      index: '02 / WHY US',
      title: 'Built to convert,<br>not just to display',
      body:  'Every NOOR build is judged on one question: does it make the business more money? Fast load times, a clear path to WhatsApp or checkout, and a look premium enough that visitors trust you before they\'ve read a word.'
    },
    {
      index: '03 / STRENGTH',
      title: 'Cinematic motion,<br>real engineering',
      body:  'Particle systems, GSAP-choreographed reveals, render pipelines tuned for low-end phones — not just demo laptops. The kind of motion agencies quote five figures for, built to actually run smoothly on a budget Android.'
    },
    {
      index: '04 / NOT OTHERS',
      title: 'No templates.<br>No middlemen.',
      body:  'Most agencies resell theme kits through a project manager who\'s never touched the code. NOOR is one person, hands directly on every line — no relay of information, no bloated retainer, pricing fixed and published up front.'
    },
    {
      index: '05 / NOT AI',
      title: 'AI can generate a site.<br>Not a business.',
      body:  'AI builders are fast and forgettable — thousands of businesses running the same dozen templates. We use AI as a tool, not a replacement: the strategy and judgment about what earns a customer\'s trust are still human calls. That part doesn\'t automate.'
    }
  ];

  const N = CARDS.length;
  const STEP = 180 / N;               // even spacing across the half-ring
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEED_DEG_PER_SEC = 2.4;      // calm, slow, continuous drift

  /* ---- Geometry: pivot = right edge of .arc-scene, vertically centred ---- */
  let pivotX = 0, pivotY = 0, R = 320;
  const CARD_W = 300, CARD_H = 168;
  const CARD_W_EXP = 380, CARD_H_EXP = 260;

  function computeGeometry(){
    const rect = scene.getBoundingClientRect();
    pivotX = rect.width;                 // right edge of the scene box
    pivotY = rect.height / 2;
    R = Math.min(rect.width * 0.86, rect.height * 0.92, 420);
    R = Math.max(R, 160);
  }

  /* ---- Build card DOM ---- */
  const cardEls = CARDS.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'arc-card';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label',
      `${c.title.replace(/<br>/g, ' ')}. Click to expand, double-click to read full size.`);

    el.innerHTML = `
      <div class="arc-card-face">
        <span class="fc-corner fc-tl"></span><span class="fc-corner fc-tr"></span>
        <span class="fc-corner fc-bl"></span><span class="fc-corner fc-br"></span>
        <div class="arc-card-front">
          <span class="fc-index">${c.index}</span>
          <span class="fc-title">${c.title}</span>
          <p class="arc-card-body">${c.body}</p>
          <span class="fc-tap">CLICK TO EXPAND</span>
          <span class="arc-card-tap-close">CLICK TO COLLAPSE · DOUBLE-CLICK TO READ FULL-SIZE</span>
        </div>
      </div>
    `;
    scene.appendChild(el);
    return el;
  });

  /* ---- State ---- */
  let rotationOffset = 0;   // degrees, drifts continuously
  let hoverCount      = 0;
  let expandedCount   = 0;
  let modalOpen        = false;
  let lastTime          = performance.now();

  // Manual scroll-to-spin: user's own wheel/trackpad input
  let scrollVelocity  = 0;   // deg/sec, decays each frame
  let lastManualScroll = 0;  // timestamp of the last wheel tick

  function isPaused(){ return hoverCount > 0 || expandedCount > 0 || modalOpen; }

  /* ---- Wrap an angle into the visible half-ring range [-90, 90) ---- */
  function wrapHalfRing(a){
    let m = ((a % 180) + 180) % 180;   // 0..180
    return m - 90;                      // -90..90
  }

  /* ---- Position every card along the ring each frame ---- */
  function layout(){
    cardEls.forEach((el, i) => {
      const baseAngle = i * STEP;
      const theta = wrapHalfRing(baseAngle + rotationOffset); // -90..90
      const rad = (theta * Math.PI) / 180;

      const isExpanded = el.classList.contains('is-expanded');
      const w = isExpanded ? CARD_W_EXP : CARD_W;
      const h = isExpanded ? CARD_H_EXP : CARD_H;

      const cx = pivotX - R * Math.cos(rad);
      const cy = pivotY + R * Math.sin(rad);
      const tangent = theta * 0.22; // subtle fan-tilt following the arc

      const edge = Math.min(1, Math.abs(theta) / 88);
      let opacity = 1 - Math.pow(edge, 2.2);
      let scale   = 1 - edge * 0.16;
      let z       = Math.round((1 - edge) * 100);

      if (isExpanded){
        opacity = 1;
        scale   = 1;
        z       = 500;
      }

      el.style.transform =
        `translate(${(cx - w / 2).toFixed(1)}px, ${(cy - h / 2).toFixed(1)}px) rotate(${tangent.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      el.style.opacity = Math.max(0, opacity).toFixed(3);
      el.style.zIndex  = z;
      el.style.pointerEvents = (edge > 0.95 && !isExpanded) ? 'none' : 'auto';
    });
  }

  /* ---- Manual scroll-to-spin ----
     Wheel/trackpad over the ring nudges it directly — feels immediate,
     with a touch of momentum so it doesn't feel abrupt. Auto-drift
     pauses for a beat afterward so the two never fight each other. */
  scene.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollVelocity += e.deltaY * 0.10;
    scrollVelocity = Math.max(-40, Math.min(40, scrollVelocity)); // cap top speed
    lastManualScroll = performance.now();
  }, { passive: false });

  function tick(now){
    const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp so tab-switches don't jump
    lastTime = now;

    // Apply manual scroll momentum, decaying smoothly toward zero
    if (Math.abs(scrollVelocity) > 0.01){
      rotationOffset += scrollVelocity * dt;
      scrollVelocity *= 0.9;
    } else {
      scrollVelocity = 0;
    }

    // Auto-drift resumes ~600ms after the last manual scroll, and only
    // if nothing else (hover/expand/modal) is holding it paused
    const settledSinceScroll = (now - lastManualScroll) > 600;
    if (!isPaused() && !reduceMotion && settledSinceScroll){
      rotationOffset += SPEED_DEG_PER_SEC * dt;
    }

    layout();
    requestAnimationFrame(tick);
  }

  /* ---- Per-card interaction: hover pause, tilt + torch, single/double click ---- */
  cardEls.forEach((el, i) => {
    const face = el.querySelector('.arc-card-face');
    let flipTimer = null; // reused as the single-click debounce timer

    /* Hover: pauses the whole ring + drives 3D tilt & spotlight torch */
    el.addEventListener('pointerenter', () => {
      hoverCount++;
      el.classList.remove('tilt-resetting');
    });

    el.addEventListener('pointermove', (e) => {
      const rect = face.getBoundingClientRect();
      const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const rx = cy - 0.5, ry = cx - 0.5;

      face.style.setProperty('--tilt-x', `${(-rx * 10).toFixed(2)}deg`);
      face.style.setProperty('--tilt-y', `${(ry * 10).toFixed(2)}deg`);
      face.style.setProperty('--spot-x', `${(cx * 100).toFixed(1)}%`);
      face.style.setProperty('--spot-y', `${(cy * 100).toFixed(1)}%`);
      face.style.setProperty('--spot-opacity', '0.32');
    });

    el.addEventListener('pointerleave', () => {
      hoverCount = Math.max(0, hoverCount - 1);
      el.classList.add('tilt-resetting');
      face.style.setProperty('--tilt-x', '0deg');
      face.style.setProperty('--tilt-y', '0deg');
      face.style.setProperty('--spot-opacity', '0');
      setTimeout(() => el.classList.remove('tilt-resetting'), 480);
    });

    /* Single click: expand in place. Double click: open reading modal. */
    function toggleExpand(){
      const wasExpanded = el.classList.contains('is-expanded');
      el.classList.toggle('is-expanded', !wasExpanded);
      expandedCount += wasExpanded ? -1 : 1;
      expandedCount = Math.max(0, expandedCount);
    }

    el.addEventListener('click', () => {
      if (flipTimer){ return; } // part of an in-flight dblclick sequence — ignore
      flipTimer = setTimeout(() => {
        toggleExpand();
        flipTimer = null;
      }, 240);
    });

    el.addEventListener('dblclick', () => {
      if (flipTimer){ clearTimeout(flipTimer); flipTimer = null; }
      openModal(i);
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleExpand(); }
    });
  });

  /* ---- Reading modal ---- */
  function openModal(i){
    const c = CARDS[i];
    modalIndex.textContent = c.index;
    modalTitle.innerHTML   = c.title;
    modalBody.textContent  = c.body.replace(/<br>/g, ' ');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    modalOpen = true;
    document.body.style.overflow = 'hidden';
    modalClose.focus();
  }
  function closeModal(){
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    modalOpen = false;
    document.body.style.overflow = '';
  }
  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  /* ---- GSAP scroll reveal ---- */
  if (window.gsap && window.ScrollTrigger && !reduceMotion){
    gsap.registerPlugin(ScrollTrigger);
    gsap.set([leftCol, scene], { opacity: 0, y: 36 });
    ScrollTrigger.create({
      trigger: document.querySelector('.why-noor'),
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to([leftCol, scene], {
        opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.15
      })
    });
  }

  /* ---- Init ---- */
  computeGeometry();
  window.addEventListener('resize', computeGeometry);
  layout();
  requestAnimationFrame(tick);
}


/* =========================================================
   PRICING — TARIFF SHEET scroll reveal
========================================================= */
function initTariff(){
  const sheet = document.getElementById('tariff-sheet');
  if (!sheet) return;
  const rows = sheet.querySelectorAll('[data-reveal-row]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (window.gsap && window.ScrollTrigger && !reduceMotion){
    gsap.registerPlugin(ScrollTrigger);
    gsap.set(rows, { opacity: 0, y: 28 });
    ScrollTrigger.create({
      trigger: sheet,
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to(rows, {
        opacity: 1, y: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1
      })
    });
  }
}


/* =========================================================
   PORTFOLIO — FIELD DEPLOYMENTS
   Horizontal cinematic archive. Vertical wheel/trackpad
   input gets redirected into horizontal scroll while the
   cursor is over the track — deliberately different feel
   from the ring (auto-drift) and the tariff rows (static).
========================================================= */
function initPortfolio(){
  const track = document.getElementById('deploy-track');
  const dotsWrap = document.getElementById('deploy-dots');
  if (!track) return;

  const cards = Array.from(track.children);

  /* ---- Dot indicators, one per card ---- */
  cards.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function updateActiveDot(){
    const trackCenter = track.scrollLeft + track.clientWidth / 2;
    let closest = 0, closestDist = Infinity;
    cards.forEach((card, i) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const dist = Math.abs(cardCenter - trackCenter);
      if (dist < closestDist){ closestDist = dist; closest = i; }
    });
    dots.forEach((d, i) => d.classList.toggle('active', i === closest));
  }

  let scrollRaf = null;
  track.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { updateActiveDot(); scrollRaf = null; });
  });

  dots.forEach((dot, i) => {
    dot.style.cursor = 'pointer';
    dot.style.pointerEvents = 'auto';
    dot.addEventListener('click', () => {
      cards[i].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    });
  });

  /* Scrolling: left entirely to the browser's native behavior —
     trackpad shift-scroll, touch swipe, or dragging the scrollbar.
     No wheel redirection, no custom drag handling: nothing here
     can intercept clicks on the "View Live" links. */

  /* ---- Scroll reveal on entering view ---- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (window.gsap && window.ScrollTrigger && !reduceMotion){
    gsap.registerPlugin(ScrollTrigger);
    gsap.set(cards, { opacity: 0, y: 32 });
    ScrollTrigger.create({
      trigger: track,
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to(cards, {
        opacity: 1, y: 0, duration: 0.75, ease: 'power3.out', stagger: 0.1
      })
    });
  }
}


/* =========================================================
   HOW WE WORK — PIPELINE SEQUENCE scroll reveal
   Each step fades + slides up in order as the section
   enters the viewport, matching the tariff row rhythm.
========================================================= */
function initPipeline(){
  const track = document.getElementById('pipeline-track');
  if (!track) return;
  const steps = track.querySelectorAll('[data-pipeline-step]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (window.gsap && window.ScrollTrigger && !reduceMotion){
    gsap.registerPlugin(ScrollTrigger);
    gsap.set(steps, { opacity: 0, y: 36 });
    ScrollTrigger.create({
      trigger: track,
      start: 'top 82%',
      once: true,
      onEnter: () => gsap.to(steps, {
        opacity: 1, y: 0, duration: 0.72, ease: 'power3.out', stagger: 0.09
      })
    });
  }

  /* Rail: constrain the ::before so it ends at the vertical midpoint
     of the last card, not the bottom of the track. */
  function updateRailHeight(){
    const finalStep = track.querySelector('.pipeline-step--final');
    if (!finalStep) return;
    const trackRect = track.getBoundingClientRect();
    const finalRect = finalStep.getBoundingClientRect();
    const railEnd = (finalRect.top - trackRect.top) + finalRect.height / 2;
    track.style.setProperty('--rail-end', railEnd + 'px');
  }
  updateRailHeight();
  window.addEventListener('resize', updateRailHeight);
}


/* =========================================================
   BOOT
========================================================= */
window.addEventListener('DOMContentLoaded', () => {
  initHUD();
  initWhyNoor();
  initTariff();
  initPortfolio();
  initPipeline();
  runLoader(() => {
    initHero();
    revealHeroText();
  });
});
