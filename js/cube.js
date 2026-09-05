import * as THREE from "./vendor/three.module.min.js";
// gsap.min.js is a classic (UMD) script, loaded via <script> before this
// module in projects.html — same pattern index.html already uses — so it's
// picked up here from the global `window.gsap` rather than an ES import.
const gsap = window.gsap;

/* =====================================================
   THE CUBE, EXPLAINED
   A real Rubik's Cube has 6 faces. Each face is a 3x3
   grid of 9 stickers. That's 54 stickers total — and
   every single one of them is its own reserved slot for
   one piece of work: a small logo/thumbnail sits right
   on that sticker.

   Slots are numbered 1-54, grouped by face in this order:
   FRONT(1-9) RIGHT(10-18) BACK(19-27) LEFT(28-36)
   TOP(37-45) BOTTOM(46-54)
   Inside each face the 9 slots read left-to-right,
   top-to-bottom (like a keypad), so the CENTER slot of
   a face is always the 5th slot of that face's block
   (offset +4): front=5, right=14, back=23, left=32,
   top=41, bottom=50.

   ---------------------------------------------------
   HOW TO ADD A WORK
   Add an object to WORKS below with:
     slot   -> which of the 54 pieces it lives on (1-54)
     title  -> project name
     logo   -> path/URL to a square-ish logo image for the
               sticker itself (leave '' and it'll show gold
               initials instead, so it still reads as "filled")
     story  -> 2-3 sentences
     link   -> live URL, '' hides the link
     images -> array of picture URLs for that work's gallery
               slider (shown below the cube once picked).
               Any sizes/aspect ratios are fine — each slider
               box matches its own picture's proportions.
   Leaving a slot out of WORKS keeps it "reserved" — dashed,
   dark, numbered, waiting.
===================================================== */
const WORKS = [
  { slot: 5,  title: 'NOOR Productions — Agency Portal', logo: '', story: 'The mobile-first terminal that runs the studio itself. Live carousel, lightbox viewer, floating WhatsApp panel — you\'re already standing inside it.', link: '', images: [] },
  { slot: 14, title: 'MedStore Bardhaman', logo: '', story: 'A full pharmacy web app — browse medicines, check ingredients and stock, order straight to WhatsApp, with a live map built into the contact page.', link: 'https://sk-abdus-sattar.github.io/MedStore/', images: [] },
  { slot: 23, title: 'Bapi Store, Bardhaman', logo: '', story: 'A neighbourhood general store rebuilt in dark luxury. Cinematic hero, category filtering, full cart with WhatsApp checkout, live store hours and directions.', link: 'https://sk-abdus-sattar.github.io/General-Store/', images: [] },
  { slot: 32, title: 'Dream Boutique, Bardhaman', logo: '', story: 'A fashion e-commerce catalog backed by Firebase, with a fully automated ordering system — browse, cart, and checkout without a single manual step behind the scenes.', link: 'https://sk-abdus-sattar.github.io/Dream-Boutique/', images: [] },
  { slot: 41, title: 'Noor Homecare', logo: '', story: 'A home care service platform with booking and service management built in — currently in active development as the newest deployment.', link: 'https://sk-abdus-sattar.github.io/Noor-Homecare/', images: [] },
];

const COLORS = {
  charcoal: 0x0e0e12,
  gold: 0xc9a15a,
  goldBright: 0xf0cd7a,
};

const NUMBERING_FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'];
const FACE_LABELS = { front: 'FRONT', right: 'RIGHT', back: 'BACK', left: 'LEFT', top: 'TOP', bottom: 'BOTTOM' };

// Local outward normal + a local "up" reference for each face — used to
// build a rotation that squares the face to wherever the camera actually
// sits, rather than assuming the camera is on-axis. Also used to lay out
// each face's 3x3 sticker grid consistently.
const FACE_LOCAL_NORMAL = {
  front:  new THREE.Vector3(0, 0, 1),
  back:   new THREE.Vector3(0, 0, -1),
  right:  new THREE.Vector3(1, 0, 0),
  left:   new THREE.Vector3(-1, 0, 0),
  top:    new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
};
const FACE_LOCAL_UP = {
  front:  new THREE.Vector3(0, 1, 0),
  back:   new THREE.Vector3(0, 1, 0),
  right:  new THREE.Vector3(0, 1, 0),
  left:   new THREE.Vector3(0, 1, 0),
  top:    new THREE.Vector3(0, 0, -1),
  bottom: new THREE.Vector3(0, 0, 1),
};

function faceRightAxis(face){
  return new THREE.Vector3().crossVectors(FACE_LOCAL_UP[face], FACE_LOCAL_NORMAL[face]).normalize();
}

// Maps a (face, row, col) sticker position — row/col each 0,1,2, reading
// left-to-right, top-to-bottom — to the (x,y,z) cubie it lives on.
function slotCoord(face, row, col){
  const normal = FACE_LOCAL_NORMAL[face];
  const up = FACE_LOCAL_UP[face];
  const right = faceRightAxis(face);
  const colOffset = col - 1;   // -1, 0, 1
  const rowOffset = 1 - row;   //  1, 0, -1 (row 0 is the top of the face)
  const v = normal.clone()
    .add(right.clone().multiplyScalar(colOffset))
    .add(up.clone().multiplyScalar(rowOffset));
  return { x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) };
}

/* ---------------- build the 54-slot registry ---------------- */
const slotByKey = {};   // `${face}:${x},${y},${z}` -> slot number (1-54)
const slotMeta = {};    // slot number -> { face, row, col, x, y, z }
{
  let n = 1;
  NUMBERING_FACES.forEach(face => {
    for(let row = 0; row < 3; row++){
      for(let col = 0; col < 3; col++){
        const { x, y, z } = slotCoord(face, row, col);
        slotByKey[`${face}:${x},${y},${z}`] = n;
        slotMeta[n] = { face, row, col, x, y, z };
        n++;
      }
    }
  });
}
const worksBySlot = Object.fromEntries(WORKS.map(w => [w.slot, w]));

/* ---------------- adaptive quality ("downgrade") rule ----------------
   Checks the Network Information API (data-saver mode, or a detected
   slow connection) and a rough proxy for low-end hardware (few CPU
   cores). Any one of these puts the cube in LOW_POWER mode: capped
   pixel ratio, no antialiasing, cheaper tone mapping, and — further
   down — fewer background particles. Nothing here changes look on a
   normal phone/desktop; it only kicks in for genuinely constrained
   connections/devices. */
const netInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const isSlowConnection = !!(netInfo && (netInfo.saveData || ['slow-2g', '2g', '3g'].includes(netInfo.effectiveType)));
const isLowEndDevice = (navigator.hardwareConcurrency || 8) <= 4;
const LOW_POWER = isSlowConnection || isLowEndDevice;

/* ---------------- renderer / scene / camera ---------------- */
const canvas = document.getElementById('cube-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_POWER, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW_POWER ? 1 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = LOW_POWER ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);

// The camera's distance was previously a fixed (4.2,3.4,5.4) — tuned by eye
// on a wide desktop window. On a tall/narrow phone viewport, that fixed
// distance left the cube's *horizontal* extent badly overflowing the
// screen (a 38° vertical FOV becomes a much narrower horizontal FOV on a
// portrait aspect ratio). Fix: keep the same viewing angle/direction, but
// recompute how far back the camera needs to sit so the cube's full
// bounding sphere fits inside whichever of the two FOVs (horizontal or
// vertical) is tighter for the current screen shape. Runs on load and on
// every resize/orientation change.
const CAMERA_DIRECTION = new THREE.Vector3(4.2, 3.4, 5.4).normalize();
const CUBE_FIT_RADIUS = 2.85; // cube's rough bounding-sphere radius + a little breathing room

function fitCameraToViewport(){
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  camera.aspect = aspect;

  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
  const limitingFov = Math.min(fovV, fovH); // the tighter of the two is what actually clips the cube
  const distance = CUBE_FIT_RADIUS / Math.sin(limitingFov / 2);

  camera.position.copy(CAMERA_DIRECTION).multiplyScalar(distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}
fitCameraToViewport();

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const keyLight = new THREE.DirectionalLight(0xfff2d6, 1.25);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xc9a15a, 0.5);
rimLight.position.set(-5, -2, -4);
scene.add(rimLight);

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

// The cube sits left-of-center on desktop so the info panel + keypad have
// clear room on the right without ever overlapping it. Stacked (no shift)
// on narrow/mobile screens, where the layout goes single-column instead.
let cubeOffsetX = 0;
function updateCubeOffset(){
  cubeOffsetX = window.innerWidth < 900 ? 0 : -1.9;
}
updateCubeOffset();

/* ---------------- moving particle background ----------------
   Same gold-dust language as the main site's hero (additive
   points, low opacity) so the two pages read as one product,
   just drifting slowly here instead of morphing into glyphs. */
const isMobile = window.innerWidth < 720;
const particleGroup = new THREE.Group();
scene.add(particleGroup);

const PARTICLE_COUNT = LOW_POWER ? 90 : (isMobile ? 240 : 560);
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
for(let i = 0; i < PARTICLE_COUNT; i++){
  const r = 6 + Math.random() * 12;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos((Math.random() * 2) - 1);
  particlePositions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  particlePositions[i*3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
  particlePositions[i*3+2] = r * Math.cos(phi);
}
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({
  color: COLORS.gold,
  size: isMobile ? 0.05 : 0.045,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});
particleGroup.add(new THREE.Points(particleGeo, particleMat));

/* ---------------- sticker textures ---------------- */
const textureLoader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();

function makeCanvasTexture(draw){
  const size = 512; // sharp on large/retina screens; was 256
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function sharpenLoadedTexture(tex){
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const blankStickerTex = makeCanvasTexture((ctx, s) => {
  ctx.fillStyle = '#0b0b0e';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(107,87,48,0.5)';
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, s - 36, s - 36);
});

function makeReservedTexture(slotNum){
  return makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, s, s);
    ctx.setLineDash([18, 18]);
    ctx.strokeStyle = 'rgba(201,161,90,0.55)';
    ctx.lineWidth = 9;
    ctx.strokeRect(24, 24, s - 48, s - 48);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(201,161,90,0.85)';
    ctx.font = '600 40px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(slotNum).padStart(2, '0'), s / 2, s / 2);
  });
}

function initialsOf(title){
  const words = title.trim().split(/\s+/).filter(Boolean);
  if(words.length === 0) return '?';
  if(words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function makeFilledTexture(project, slotNum){
  return makeCanvasTexture((ctx, s) => {
    const grad = ctx.createRadialGradient(s/2, s/2, s*0.05, s/2, s/2, s*0.7);
    grad.addColorStop(0, '#1c1710');
    grad.addColorStop(1, '#0b0b0e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(240,205,122,0.85)';
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, s - 36, s - 36);
    ctx.fillStyle = '#f0cd7a';
    ctx.font = '700 150px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsOf(project.title), s / 2, s / 2 + 6);
    ctx.fillStyle = 'rgba(201,161,90,0.9)';
    ctx.font = '600 26px "Space Mono", monospace';
    ctx.fillText(String(slotNum).padStart(2, '0'), s / 2, s - 46);
  });
}

function bodyMaterial(){
  return new THREE.MeshStandardMaterial({ color: COLORS.charcoal, roughness: 0.6, metalness: 0.18 });
}
function blankStickerMaterial(){
  return new THREE.MeshStandardMaterial({ map: blankStickerTex, roughness: 0.55, metalness: 0.2 });
}
function stickerMaterialForSlot(slotNum){
  const project = worksBySlot[slotNum];
  if(!project){
    return new THREE.MeshStandardMaterial({ map: makeReservedTexture(slotNum), roughness: 0.5, metalness: 0.2 });
  }
  if(project.logo){
    const tex = sharpenLoadedTexture(textureLoader.load(project.logo));
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.15 });
  }
  return new THREE.MeshStandardMaterial({
    map: makeFilledTexture(project, slotNum), roughness: 0.4, metalness: 0.2,
    emissive: new THREE.Color(COLORS.gold), emissiveIntensity: 0.12
  });
}

/* ---------------- build the 3x3x3 cube ---------------- */
const GAP = 1.06;
const SIZE = 0.94;
const FACE_NAMES = ['right', 'left', 'top', 'bottom', 'front', 'back']; // BoxGeometry material order: +X,-X,+Y,-Y,+Z,-Z

const meshByPos = {}; // `${x},${y},${z}` -> cubie mesh, for highlighting any single piece
const meshToCoord = new WeakMap(); // mesh -> {x,y,z}, for mobile raycasting

for(let x = -1; x <= 1; x++){
  for(let y = -1; y <= 1; y++){
    for(let z = -1; z <= 1; z++){
      if(x === 0 && y === 0 && z === 0) continue; // hidden core
      const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
      const exposure = [x === 1, x === -1, y === 1, y === -1, z === 1, z === -1];
      const materials = exposure.map((exposed, i) => {
        if(!exposed) return bodyMaterial();
        const face = FACE_NAMES[i];
        const slotNum = slotByKey[`${face}:${x},${y},${z}`];
        return slotNum ? stickerMaterialForSlot(slotNum) : blankStickerMaterial();
      });
      const mesh = new THREE.Mesh(geo, materials);
      mesh.position.set(x * GAP, y * GAP, z * GAP);
      cubeGroup.add(mesh);
      meshByPos[`${x},${y},${z}`] = mesh;
      meshToCoord.set(mesh, { x, y, z });
    }
  }
}

/* ---------------- idle float + render loop ---------------- */
const clock = new THREE.Clock();

// Mobile free-drag state — read here, written by the mobile pointer
// handlers further down. Declared up top since animate() needs them.
let isDragging = false;
let isFaceTweening = false;
const dragVelocity = { x: 0, y: 0 };

function animate(){
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  cubeGroup.position.x = cubeOffsetX;
  cubeGroup.position.y = Math.sin(t * 0.9) * 0.12;

  // Momentum: once a mobile drag is released, keep spinning and decay.
  if(!isDragging && !isFaceTweening && (Math.abs(dragVelocity.x) > 0.0002 || Math.abs(dragVelocity.y) > 0.0002)){
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dragVelocity.x);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dragVelocity.y);
    cubeGroup.quaternion.premultiply(qy).premultiply(qx);
    dragVelocity.x *= 0.92;
    dragVelocity.y *= 0.92;
  }

  particleGroup.rotation.y = t * 0.03;
  particleGroup.rotation.x = Math.sin(t * 0.06) * 0.06;
  renderer.render(scene, camera);
}
animate();

function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  fitCameraToViewport();
  updateCubeOffset();
}
window.addEventListener('resize', onResize);
onResize();

/* ---------------- rotate-to-face ---------------- */
let activeFace = null;

function highlightCubie(meta){
  const mesh = meshByPos[`${meta.x},${meta.y},${meta.z}`];
  if(!mesh) return;
  gsap.fromTo(mesh.scale, { x: 1, y: 1, z: 1 }, { x: 1.1, y: 1.1, z: 1.1, duration: 0.35, yoyo: true, repeat: 1, ease: 'power2.out' });
}

// Builds the world rotation that brings the given face's outward normal
// to point straight at wherever the camera actually is, with roll
// minimized against world "up" — so the face squares up flat to the
// viewer instead of leaving a vertex pointing at them.
function computeFaceTargetQuaternion(face){
  const worldUp = new THREE.Vector3(0, 1, 0);
  const zAxisTarget = camera.position.clone().normalize(); // cube sits at the origin
  const xAxisTarget = new THREE.Vector3().crossVectors(worldUp, zAxisTarget).normalize();
  const yAxisTarget = new THREE.Vector3().crossVectors(zAxisTarget, xAxisTarget).normalize();

  const normalLocal = FACE_LOCAL_NORMAL[face].clone().normalize();
  const rightLocal = faceRightAxis(face);
  const upLocal = new THREE.Vector3().crossVectors(normalLocal, rightLocal).normalize();

  const mLocal = new THREE.Matrix4().makeBasis(rightLocal, upLocal, normalLocal);
  const mTarget = new THREE.Matrix4().makeBasis(xAxisTarget, yAxisTarget, zAxisTarget);
  const R = new THREE.Matrix4().multiplyMatrices(mTarget, mLocal.clone().transpose());

  return new THREE.Quaternion().setFromRotationMatrix(R);
}

let activeFaceTween = null;

function rotateToFace(face){
  const targetQ = computeFaceTargetQuaternion(face);
  const startQ = cubeGroup.quaternion.clone();
  const progress = { t: 0 };
  if(activeFaceTween) activeFaceTween.kill();
  isFaceTweening = true;
  activeFaceTween = gsap.to(progress, {
    t: 1,
    duration: 1.15,
    ease: 'power3.inOut',
    onUpdate: () => {
      cubeGroup.quaternion.copy(startQ).slerp(targetQ, progress.t);
    },
    onComplete: () => {
      isFaceTweening = false;
      activeFaceTween = null;
    }
  });
}

/* ---------------- UI wiring ---------------- */
const pickerTabs = document.getElementById('pickerTabs');
const pickerGrid = document.getElementById('pickerGrid');
const cubePicker = document.getElementById('cubePicker');
const greeting = document.getElementById('greeting');
const storyPanel = document.getElementById('storyPanel');
const storyTag = document.getElementById('storyTag');
const storyTitle = document.getElementById('storyTitle');
const storyBody = document.getElementById('storyBody');
const storyLink = document.getElementById('storyLink');
const hudCounter = document.getElementById('hudCounter');
const gallerySection = document.getElementById('gallerySection');
const galleryTag = document.getElementById('galleryTag');
const galleryTitle = document.getElementById('galleryTitle');
const galleryTrack = document.getElementById('galleryTrack');

const pad = n => String(n).padStart(2, '0');

hudCounter.textContent = pad(WORKS.length) + ' / 54';

let activeTab = 'front';

function renderGrid(){
  pickerGrid.innerHTML = '';
  const faceOffset = NUMBERING_FACES.indexOf(activeTab) * 9;
  for(let row = 0; row < 3; row++){
    for(let col = 0; col < 3; col++){
      const slotNum = faceOffset + row * 3 + col + 1;
      const project = worksBySlot[slotNum];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn' + (project ? ' has-work' : '');
      btn.textContent = pad(slotNum);
      btn.setAttribute('aria-label', project ? project.title : ('Reserved piece ' + slotNum));
      btn.addEventListener('click', () => selectSlot(slotNum, btn));
      pickerGrid.appendChild(btn);
    }
  }
}

NUMBERING_FACES.forEach(face => {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'picker-tab' + (face === activeTab ? ' is-active' : '');
  tab.textContent = FACE_LABELS[face];
  tab.addEventListener('click', () => {
    activeTab = face;
    document.querySelectorAll('.picker-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    renderGrid();
  });
  pickerTabs.appendChild(tab);
});
renderGrid();

function renderGallery(project, slotNum){
  galleryTag.textContent = 'SLOT ' + pad(slotNum);
  galleryTrack.innerHTML = '';

  if(!project){
    galleryTitle.textContent = 'Reserved piece';
    const p = document.createElement('p');
    p.className = 'gallery-empty';
    p.textContent = 'This piece is unassigned — add a work to WORKS in cube.js and it lights up here.';
    galleryTrack.appendChild(p);
    return;
  }

  galleryTitle.textContent = project.title + ' — Gallery';
  const images = project.images || [];
  if(images.length === 0){
    const p = document.createElement('p');
    p.className = 'gallery-empty';
    p.textContent = 'No gallery images added yet — drop URLs into this work\'s "images" array in cube.js.';
    galleryTrack.appendChild(p);
    return;
  }

  images.forEach((src, idx) => {
    const box = document.createElement('div');
    box.className = 'gallery-box';
    const img = document.createElement('img');
    img.src = src;
    img.alt = project.title + ' — image ' + (idx + 1);
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      box.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
    });
    box.appendChild(img);
    galleryTrack.appendChild(box);
  });
}

function selectSlot(slotNum, btn){
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');

  const meta = slotMeta[slotNum];
  const project = worksBySlot[slotNum];

  storyTag.textContent = 'SLOT ' + pad(slotNum);
  storyTitle.textContent = project ? project.title : 'Reserved';
  storyBody.textContent = project ? project.story : 'This piece is ready for a work. Drop a logo, title, story, and gallery images into cube.js — it lights right up.';
  if(project && project.link){
    storyLink.style.display = 'inline-flex';
    storyLink.href = project.link;
  } else {
    storyLink.style.display = 'none';
  }

  greeting.classList.add('is-hidden');
  storyPanel.classList.add('is-visible');
  gallerySection.classList.add('is-visible');
  renderGallery(project, slotNum);

  if(activeFace === meta.face){
    highlightCubie(meta);
    return;
  }
  activeFace = meta.face;
  rotateToFace(meta.face);
  highlightCubie(meta);
}

/* Reveal the gallery section as it scrolls into view. */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if(entry.isIntersecting) entry.target.classList.add('is-inview');
  });
}, { threshold: 0.12 });
revealObserver.observe(gallerySection);

/* =====================================================
   MOBILE — free-drag cube + tap-to-select + overlay
   Only active under 900px. Desktop keeps the face-tab
   keypad above and never touches any of this; the cube
   canvas itself only becomes pointer-interactive on
   mobile (see the media query in cube.css).

   Interaction model:
     - Drag the cube freely, like a real Rubik's Cube.
     - Tap once  -> squares whichever face you tapped to
                    the camera (step 1).
     - Tap again on that now-squared face -> selects that
                    specific piece (step 2) and opens the
                    two-layer overlay described below.
     - Double-tap a piece (overlay closed) -> jumps straight
                    to that work's live link, skipping the
                    two-step flow. Only works while no
                    overlay is open.
     - Reserved (empty) piece tapped -> small centered
                    popup, no overlay.

   The "overlay" is two separate fixed layers, exactly as
   spec'd:
       - #mobileImmovable: fully invisible, never moves,
         its only job is to sit above the canvas and block
         taps from reaching the cube while a piece is open.
       - #mobileSheet: also transparent by default (only
         the actual title/story/gallery images inside it
         are opaque) — it's independently scrollable and
         starts positioned so just a sliver of its content
         peeks up from the bottom, then scrolls upward over
         the immovable layer to reveal the rest, while the
         immovable layer underneath never shifts at all.
   The "?" button and the "✕" both sit above both layers in
   stacking order (z-index), so they stay clickable no
   matter what's open — the ✕ only while an overlay is
   showing, the "?" always.
===================================================== */
function isMobileMode(){ return window.innerWidth < 900; }

const mobileHelpBtn     = document.getElementById('mobileHelpBtn');
const mobileCloseBtn    = document.getElementById('mobileCloseBtn');
const mobileImmovable   = document.getElementById('mobileImmovable');
const mobileSheet       = document.getElementById('mobileSheet');
const mobileSheetTag    = document.getElementById('mobileSheetTag');
const mobileSheetTitle  = document.getElementById('mobileSheetTitle');
const mobileSheetBody   = document.getElementById('mobileSheetBody');
const mobileSheetGallery= document.getElementById('mobileSheetGallery');
const mobileToast       = document.getElementById('mobileToast');
const mobileHelpSheet   = document.getElementById('mobileHelpSheet');
const mobileHelpClose   = document.getElementById('mobileHelpClose');

let mobileActiveFace = null; // which face is currently squared to the camera, if any

function openMobileSheet(project, slotNum){
  mobileSheetTag.textContent = 'SLOT ' + pad(slotNum);
  mobileSheetTitle.textContent = project.title;
  mobileSheetBody.textContent = project.story;
  mobileSheetGallery.innerHTML = '';

  const images = project.images || [];
  if(images.length === 0){
    const p = document.createElement('p');
    p.className = 'gallery-empty';
    p.textContent = 'No gallery images added yet for this work.';
    mobileSheetGallery.appendChild(p);
  } else {
    images.forEach((src, idx) => {
      const box = document.createElement('div');
      box.className = 'gallery-box';
      const img = document.createElement('img');
      img.src = src;
      img.alt = project.title + ' — image ' + (idx + 1);
      img.loading = 'lazy';
      img.addEventListener('load', () => {
        box.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
      });
      box.appendChild(img);
      mobileSheetGallery.appendChild(box);
    });
  }

  mobileSheet.scrollTop = 0; // reset so it starts peeking from the bottom again
  mobileImmovable.classList.add('is-open');
  mobileSheet.classList.add('is-open');
  mobileCloseBtn.classList.add('is-visible');
}

function closeMobileSheet(){
  mobileImmovable.classList.remove('is-open');
  mobileSheet.classList.remove('is-open');
  mobileCloseBtn.classList.remove('is-visible');
}
mobileCloseBtn.addEventListener('click', closeMobileSheet);

let toastTimer = null;
function showMobileToast(){
  mobileToast.classList.add('is-visible');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => mobileToast.classList.remove('is-visible'), 1800);
}

mobileHelpBtn.addEventListener('click', () => mobileHelpSheet.classList.add('is-open'));
mobileHelpClose.addEventListener('click', () => mobileHelpSheet.classList.remove('is-open'));

/* ---------------- raycasting ---------------- */
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

function raycastSlot(clientX, clientY){
  pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObjects(cubeGroup.children, false);
  if(hits.length === 0) return null;
  const hit = hits[0];
  const coord = meshToCoord.get(hit.object);
  if(!coord || !hit.face) return null;
  const face = FACE_NAMES[hit.face.materialIndex];
  const slotNum = slotByKey[`${face}:${coord.x},${coord.y},${coord.z}`];
  if(!slotNum) return null;
  return { slotNum, meta: slotMeta[slotNum] };
}

/* ---------------- tap vs. double-tap ----------------
   Single tap runs the two-step face-then-piece flow.
   Two quick taps on the same piece skip straight to its
   live link instead — but only ever fires from taps that
   actually reach the canvas, which the overlay's z-index
   already prevents while it's open, so no separate
   "is overlay open" check is needed here. */
let pendingTapTimer = null;
let lastTapSlot = null;
let lastTapAt = 0;
const DOUBLE_TAP_MS = 320;

function handleTapOnSlot(slotNum, meta){
  const now = performance.now();
  const isDoubleTap = slotNum === lastTapSlot && (now - lastTapAt) < DOUBLE_TAP_MS;
  lastTapSlot = slotNum;
  lastTapAt = now;

  if(pendingTapTimer){ clearTimeout(pendingTapTimer); pendingTapTimer = null; }

  if(isDoubleTap){
    lastTapSlot = null;
    const project = worksBySlot[slotNum];
    if(project && project.link) window.open(project.link, '_blank', 'noopener');
    return;
  }

  pendingTapTimer = setTimeout(() => {
    pendingTapTimer = null;
    singleTapAction(slotNum, meta);
  }, DOUBLE_TAP_MS - 20);
}

function singleTapAction(slotNum, meta){
  if(mobileActiveFace !== meta.face){
    mobileActiveFace = meta.face;
    rotateToFace(meta.face);
    return; // step 1: just square this face to the camera
  }
  // step 2: this face is already squared -> select the piece
  highlightCubie(meta);
  const project = worksBySlot[slotNum];
  if(!project){
    showMobileToast();
    return;
  }
  openMobileSheet(project, slotNum);
}

/* ---------------- drag-to-rotate + tap detection ---------------- */
let dragMoved = false;
let dragStart = { x: 0, y: 0 };
let lastPointer = { x: 0, y: 0 };
const TAP_MOVE_THRESHOLD = 6; // px

function onPointerDown(e){
  if(!isMobileMode()) return;
  e.preventDefault();
  isDragging = true;
  dragMoved = false;
  dragStart.x = lastPointer.x = e.clientX;
  dragStart.y = lastPointer.y = e.clientY;
  dragVelocity.x = 0;
  dragVelocity.y = 0;
  if(activeFaceTween){ activeFaceTween.kill(); isFaceTweening = false; activeFaceTween = null; }
}

function onPointerMove(e){
  if(!isDragging) return;
  e.preventDefault();
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
  if(Math.abs(e.clientX - dragStart.x) > TAP_MOVE_THRESHOLD || Math.abs(e.clientY - dragStart.y) > TAP_MOVE_THRESHOLD){
    dragMoved = true;
  }
  if(!dragMoved) return;
  mobileActiveFace = null; // a real drag invalidates whatever face was squared

  const ROT_SPEED = 0.006;
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * ROT_SPEED);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * ROT_SPEED);
  cubeGroup.quaternion.premultiply(qy).premultiply(qx);
  dragVelocity.x = dx * ROT_SPEED;
  dragVelocity.y = dy * ROT_SPEED;
}

function onPointerUp(e){
  if(!isDragging) return;
  isDragging = false;
  if(!dragMoved){
    const hit = raycastSlot(e.clientX, e.clientY);
    if(hit) handleTapOnSlot(hit.slotNum, hit.meta);
  }
}

canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
window.addEventListener('pointermove', onPointerMove, { passive: false });
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);
