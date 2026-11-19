import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const gsap = window.gsap;
gsap.registerPlugin(window.ScrollTrigger);

const COLORS = { me: 0xff7433, him: 0x8fb8de };
const CSSC = { me: "var(--me)", him: "var(--him)" };
const STATS = ["views", "subs", "top"];
const ICON = { views: "#i-eye", subs: "#i-user", top: "#i-play" };
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let data = null, hist = [], stat = "views";
const statVal = (who, s = stat) => {
  const c = data?.[who];
  if (!c) return 0;
  return s === "views" ? c.views : s === "subs" ? c.subs : c.top?.views || 0;
};
const leader = (s) => {
  const a = statVal("me", s), b = statVal("him", s);
  return a > b ? "me" : b > a ? "him" : null;
};


/* ---------- three ---------- */
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070605);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
const camBase = new THREE.Vector3(0, 10, 13);
const look = new THREE.Vector3(0, 0.6, 0);
camera.position.copy(camBase);

scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x15110d, 0.55));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
sun.position.set(-5, 10, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
sun.shadow.radius = 5;
scene.add(sun);

const arena = new THREE.Group();
scene.add(arena);

/* ---------- the globe (NASA Blue Marble day + Black Marble night, public domain) ---------- */
const R = 5;
const latLon = (lat, lon, r = R) => {
  const u = (lon + 180) / 360, v = (90 - lat) / 180;
  return new THREE.Vector3(-r * Math.cos(2 * Math.PI * u) * Math.sin(Math.PI * v), r * Math.cos(Math.PI * v), r * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * v));
};
const CITY = { me: [27.95, -82.46], him: [25.76, -80.19] }; // Tampa, Miami

const tex = new THREE.TextureLoader();
const aniso = renderer.capabilities.getMaxAnisotropy();
const loadTex = (u) => { const t = tex.load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };

const earthTilt = new THREE.Group(), earthSpin = new THREE.Group();
arena.add(earthTilt); earthTilt.add(earthSpin);
// aim Florida at the camera, a little above center
const fl = latLon(27, -81.3, 1);
const baseSpin = -Math.atan2(fl.x, fl.z);
const flz = Math.hypot(fl.x, fl.z);
const baseTilt = Math.atan2(fl.y, flz) - 0.16;
earthSpin.rotation.y = baseSpin;
earthTilt.rotation.x = baseTilt;

const sunDir = new THREE.Vector3(-0.55, 0.42, 0.6).normalize();
const earthMat = new THREE.ShaderMaterial({
  uniforms: { day: { value: loadTex("assets/earth-day.jpg") }, night: { value: loadTex("assets/earth-night.jpg") }, sun: { value: sunDir } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position,1.0);
      vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: `uniform sampler2D day; uniform sampler2D night; uniform vec3 sun;
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      vec3 N = normalize(vN), V = normalize(vV);
      vec3 d = texture2D(day, vUv).rgb, n = texture2D(night, vUv).rgb;
      float ndl = dot(N, sun);
      float lit = smoothstep(-0.1, 0.28, ndl);
      // warm band right at the terminator, like real dusk
      float dusk = smoothstep(-0.12, 0.05, ndl) * (1.0 - smoothstep(0.05, 0.3, ndl));
      vec3 col = d * (0.07 + 1.15 * max(ndl, 0.0)) * mix(0.35, 1.0, lit);
      col += d * vec3(1.0, 0.55, 0.3) * dusk * 0.35;
      // city lights only where it is dark
      float lum = dot(n, vec3(0.299, 0.587, 0.114));
      col += n * smoothstep(0.06, 0.5, lum) * (1.0 - lit) * 1.6;
      // sun glint on water (water = dark and blue-leaning in Blue Marble)
      float water = smoothstep(0.02, 0.0, d.r - d.b + 0.02) * (1.0 - smoothstep(0.12, 0.3, dot(d, vec3(0.33))));
      vec3 H = normalize(sun + V);
      col += vec3(1.0, 0.92, 0.8) * pow(max(dot(N, H), 0.0), 90.0) * 0.28 * water * smoothstep(0.05, 0.3, ndl);
      // thin sunlit atmosphere at the edge
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += vec3(0.42, 0.62, 0.9) * rim * 0.32 * smoothstep(-0.2, 0.5, ndl);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 120), earthMat);
earthSpin.add(earth);

// stars
{
  const n = 3500, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(70 + Math.random() * 20);
    p.set([v.x, v.y, v.z], i * 3);
    const w = 0.55 + Math.random() * 0.45, warm = Math.random();
    c.set([w, w * (0.92 + warm * 0.08), w * (0.85 + (1 - warm) * 0.15)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, depthWrite: false })));
}

/* ---------- city markers on the globe ---------- */
const cityMark = {};
for (const who of ["me", "him"]) {
  const pos = latLon(...CITY[who], R + 0.01);
  const g = new THREE.Group();
  g.position.copy(pos);
  g.lookAt(pos.clone().multiplyScalar(2));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.07, 32), new THREE.MeshBasicMaterial({ color: COLORS[who] }));
  g.add(dot);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 48), new THREE.MeshBasicMaterial({ color: COLORS[who], transparent: true, depthWrite: false }));
  g.add(ripple);
  earthSpin.add(g);
  cityMark[who] = { g, ripple };
}

/* ---------- tokens: pfp coins floating in front of the Earth ---------- */
function makeToken(who) {
  const g = new THREE.Group();
  g.position.set(who === "me" ? -3.1 : 3.1, 0.2, 6.2);
  const col = COLORS[who];
  const head = new THREE.Group(); g.add(head);
  const face = new THREE.Group(); head.add(face);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 72), new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.25 }));
  coin.rotation.x = Math.PI / 2; face.add(coin);
  const discMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.52, 64), discMat);
  disc.position.z = 0.072; face.add(disc);
  const disc2 = disc.clone(); disc2.rotation.y = Math.PI; disc2.position.z = -0.072; face.add(disc2);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.565, 0.045, 16, 96), new THREE.MeshStandardMaterial({ color: 0xe2b04a, metalness: 1, roughness: 0.25 }));
  rim.scale.z = 2.2; face.add(rim);
  arena.add(g);
  const lineMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { t: { value: 0 }, o: { value: 1 }, c: { value: new THREE.Color(col) } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform float t; uniform float o; uniform vec3 c; varying vec2 vUv;
      void main(){ float on = step(0.4, fract(vUv.x * 18.0 - t)); float a = on * smoothstep(0.0, 0.05, vUv.x) * o;
        if (a < 0.01) discard; gl_FragColor = vec4(c, a * 0.95); }`,
  });
  const line = new THREE.Mesh(new THREE.BufferGeometry(), lineMat);
  arena.add(line);
  return { who, g, head, face, discMat, line, lineMat, h: { v: 0.8 }, spin: { v: 0 } };
}
const P = { me: makeToken("me"), him: makeToken("him") };
function setAvatar(who, url) {
  tex.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; P[who].discMat.map = t; P[who].discMat.needsUpdate = true; });
}

// crowns: one continuous gold shell with real points, then rims, finials and gems
const gold = new THREE.MeshStandardMaterial({ color: 0xe2b04a, metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
const gems = { views: 0x1f7a4d, subs: 0x9c2b34, top: 0x24529a };
function crownShellGeo(r = 0.5, t = 0.05, hb = 0.3, hp = 0.78, points = 5, N = 300) {
  const pos = [], idx = [];
  const H = (th) => { const u = ((th / (Math.PI * 2)) * points) % 1; return hb + (hp - hb) * Math.pow(1 - Math.abs(2 * u - 1), 1.8); };
  const strip = (fa, fb) => {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const [ra, ya] = fa(th), [rb, yb] = fb(th);
      pos.push(Math.cos(th) * ra, ya, Math.sin(th) * ra, Math.cos(th) * rb, yb, Math.sin(th) * rb);
    }
    for (let i = 0; i < N; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  };
  strip((th) => [r, 0], (th) => [r, H(th)]);
  strip((th) => [r, H(th)], (th) => [r - t, H(th)]);
  strip((th) => [r - t, H(th)], (th) => [r - t, 0]);
  strip((th) => [r - t, 0], (th) => [r, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const shellGeo = crownShellGeo();
function makeCrown(s) {
  const c = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = -0.35;
  c.add(inner);
  const shell = new THREE.Mesh(shellGeo, gold);
  shell.castShadow = true;
  inner.add(shell);
  const rimLow = new THREE.Mesh(new THREE.TorusGeometry(0.515, 0.035, 12, 96), gold);
  rimLow.rotation.x = Math.PI / 2; rimLow.position.y = 0.02; inner.add(rimLow);
  const rimHigh = rimLow.clone(); rimHigh.scale.setScalar(1); rimHigh.position.y = 0.27; inner.add(rimHigh);
  const gemMat = new THREE.MeshStandardMaterial({ color: gems[s], metalness: 0.1, roughness: 0.08 });
  for (let k = 0; k < 5; k++) {
    const th = ((k + 0.5) / 5) * Math.PI * 2;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), gold);
    ball.position.set(Math.cos(th) * 0.475, 0.81, Math.sin(th) * 0.475);
    inner.add(ball);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), gemMat);
    gem.scale.set(1, 1.25, 0.55);
    gem.position.set(Math.cos(th) * 0.53, 0.145, Math.sin(th) * 0.53);
    gem.lookAt(0, 0.145, 0);
    inner.add(gem);
  }
  c.userData.stat = s;
  c.traverse((m) => (m.userData.stat = s));
  arena.add(c);
  return c;
}
const crowns = Object.fromEntries(STATS.map((s) => [s, makeCrown(s)]));
STATS.forEach((s, i) => { crowns[s].position.set(0, 9 + i, 0); crowns[s].scale.setScalar(0.001); });

// snow: soft round flakes, heavier the closer it gets to Christmas
const XMAS = (() => { const n = new Date(); return new Date(n.getMonth() === 11 && n.getDate() > 25 ? n.getFullYear() + 1 : n.getFullYear(), 11, 25); })();
const RACE_START = Date.parse("2026-11-18T00:00:00");
const xmasProgress = () => Math.min(1, Math.max(0, (Date.now() - RACE_START) / (XMAS - RACE_START)));
function flakeTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.45, "rgba(255,255,255,.85)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const snowMax = 4200;
const snowGeo = new THREE.BufferGeometry();
const sp = new Float32Array(snowMax * 3), sv = new Float32Array(snowMax), sd = new Float32Array(snowMax);
for (let i = 0; i < snowMax; i++) {
  sp[i * 3] = (Math.random() - 0.5) * 26;
  sp[i * 3 + 1] = Math.random() * 13 - 0.5;
  sp[i * 3 + 2] = (Math.random() - 0.5) * 18 - 1;
  sv[i] = 0.5 + Math.random() * 0.9;
  sd[i] = Math.random() * 6.28;
}
snowGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
const snowMat = new THREE.PointsMaterial({ color: 0xf6f2ec, size: 0.075, map: flakeTexture(), transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true });
const snow = new THREE.Points(snowGeo, snowMat);
scene.add(snow);
let snowCount = 0;
function setSnow() {
  const p = xmasProgress();
  snowCount = Math.round(700 + (snowMax - 700) * Math.pow(p, 1.4));
  snowGeo.setDrawRange(0, snowCount);

}
setSnow(); setInterval(setSnow, 60000);



/* ---------- placement ---------- */
const MAXH = 2.4, MINH = 0.4;
function heights() {
  const a = statVal("me"), b = statVal("him"), m = Math.max(a, b);
  const f = (v) => (m === 0 ? MINH : MINH + (MAXH - MINH) * (v / m));
  return { me: f(a), him: f(b) };
}
const headY = (who, h) => P[who].g.position.y + h + 0.62;
function placeCrowns(animate = true) {
  const H = heights();
  const groups = { me: [], him: [], tie: [] };
  STATS.forEach((s) => groups[leader(s) || "tie"].push(s));
  const order = (arr) => arr.sort((x, y) => (x === stat ? -1 : y === stat ? 1 : STATS.indexOf(x) - STATS.indexOf(y)));
  for (const k of ["me", "him", "tie"]) {
    const arr = order(groups[k]);
    let side = -1;
    arr.forEach((s) => {
      const active = s === stat;
      const sc = active ? 0.8 : 0.42;
      let x, y, z;
      if (k === "tie") { x = (arr.indexOf(s) - (arr.length - 1) / 2) * 0.8; y = Math.max(headY("me", H.me), headY("him", H.him)) + 0.6; z = 6.2; }
      else {
        const p = P[k].g.position, top = headY(k, H[k]);
        if (active) { x = p.x; y = top + 1.05; z = p.z; }
        else { x = p.x + side * 0.95; y = top + 0.25; z = p.z; side = -side; }
      }
      gsap.to(crowns[s].position, { x, y, z, duration: animate ? 1.1 : 0, ease: "back.out(1.5)" });
      gsap.to(crowns[s].scale, { x: sc, y: sc, z: sc, duration: animate ? 0.8 : 0, ease: "back.out(2)" });
    });
  }
}
function applyHeights(animate = true) {
  const H = heights();
  for (const who of ["me", "him"]) {
    gsap.to(P[who].h, { v: H[who], duration: animate ? 1.4 : 0, ease: "expo.out" });
    if (animate) gsap.fromTo(P[who].spin, { v: 0 }, { v: Math.PI * 2, duration: 1.6, ease: "power3.inOut" });
  }
  placeCrowns(animate);
}

let narrow = false;
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  narrow = w / h < 0.8;
  camera.fov = narrow ? 50 : 32;
  camBase.set(0, narrow ? 1.5 : 1.0, narrow ? 21 : 20);
  look.set(0, narrow ? 1.4 : 1.1, 0);
  const tx = narrow ? 1.9 : 3.1;
  P.me.g.position.x = -tx; P.him.g.position.x = tx;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// drag to spin the Earth, it eases back to Florida; tap a crown to switch stat
let drag = null, mouse = { x: 0, y: 0 };
const spinOff = { v: 0 };
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, s: spinOff.v }; canvas.setPointerCapture(e.pointerId); gsap.killTweensOf(spinOff); });
canvas.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
  if (drag) spinOff.v = drag.s + (e.clientX - drag.x) * 0.006;
});
const ray = new THREE.Raycaster();
canvas.addEventListener("pointerup", (e) => {
  const moved = drag && Math.abs(e.clientX - drag.x) > 6;
  drag = null;
  gsap.to(spinOff, { v: 0, duration: 2.6, delay: 1.2, ease: "power3.inOut" });
  if (moved) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
  const hit = ray.intersectObjects(Object.values(crowns), true)[0];
  if (hit) select(hit.object.userData.stat);
});

const tagMe = document.getElementById("tag-me"), tagHim = document.getElementById("tag-him"), gapEl = document.getElementById("gap");
const v3 = new THREE.Vector3(), wv = new THREE.Vector3(), nv = new THREE.Vector3();
function toScreen(v) {
  v3.copy(v).project(camera);
  return { x: (v3.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v3.y * 0.5 + 0.5) * canvas.clientHeight };
}

const clock = new THREE.Clock();
function frame() {
  const t = clock.getElapsedTime();
  earthSpin.rotation.y = baseSpin + spinOff.v + (reduce ? 0 : Math.sin(t * 0.12) * 0.05);
  camera.position.x += (camBase.x + mouse.x * 0.7 - camera.position.x) * 0.04;
  camera.position.y += (camBase.y - mouse.y * 0.4 - camera.position.y) * 0.04;
  camera.position.z = camBase.z;
  camera.lookAt(look);
  arena.updateMatrixWorld(true);

  for (const who of ["me", "him"]) {
    const p = P[who], h = p.h.v;
    p.head.position.y = h + 0.62 + Math.sin(t * 1.3 + (who === "me" ? 0 : 1.7)) * 0.05;
    p.face.lookAt(camera.position.x, p.head.getWorldPosition(wv).y, camera.position.z);
    p.face.rotateY(p.spin.v);
    const k = (t * 0.6 + (who === "me" ? 0 : 0.5)) % 1;
    cityMark[who].ripple.scale.setScalar(1 + k * 2.5);
    cityMark[who].ripple.material.opacity = 0.7 * (1 - k);
    // leader line: city on the globe, out along the surface normal, then up to the coin
    const city = cityMark[who].g.getWorldPosition(new THREE.Vector3());
    nv.copy(city).normalize();
    const inward = who === "me" ? 1 : -1;
    const coinSide = p.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(inward * 0.7, 0, 0));
    const curve = new THREE.CatmullRomCurve3([city, city.clone().addScaledVector(nv, 0.9), coinSide.clone().add(new THREE.Vector3(inward * 0.9, -0.2, 0)), coinSide]);
    p.line.geometry.dispose();
    p.line.geometry = new THREE.TubeGeometry(curve, 64, 0.022, 6, false);
    p.lineMat.uniforms.t.value = t * 0.8;
    // fade the line out while the city is turned away from the camera
    const facing = nv.dot(wv.copy(camera.position).sub(city).normalize());
    const o = THREE.MathUtils.smoothstep(facing, 0.12, 0.4);
    p.lineMat.uniforms.o.value = o;
    p.line.visible = o > 0.01;
  }
  for (const s of STATS) {
    const c = crowns[s];
    c.rotation.y = t * 0.5 + STATS.indexOf(s) * 2.1;
    c.rotation.x = 0.18;
  }
  const pos = snowGeo.attributes.position.array;
  const wind = Math.sin(t * 0.17) * 0.004 + 0.002;
  if (!reduce) for (let i = 0; i < snowCount; i++) {
    pos[i * 3 + 1] -= sv[i] * 0.011;
    pos[i * 3] += Math.sin(t * 0.9 + sd[i]) * 0.003 + wind;
    pos[i * 3 + 2] += Math.cos(t * 0.7 + sd[i]) * 0.002;
    if (pos[i * 3 + 1] < -6) { pos[i * 3 + 1] = 9; pos[i * 3] = (Math.random() - 0.5) * 26; }
    if (pos[i * 3] > 13) pos[i * 3] = -13;
  }
  snowGeo.attributes.position.needsUpdate = true;

  for (const who of ["me", "him"]) {
    const s = toScreen(P[who].head.getWorldPosition(wv).add(new THREE.Vector3(0, -0.7, 0)));
    (who === "me" ? tagMe : tagHim).style.transform = `translate(${s.x}px, ${s.y + 14}px) translate(-50%, 0)`;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------- DOM ---------- */
const $ = (s, r = document) => r.querySelector(s);
const counters = new WeakMap();
function countTo(el, v, d = 1.2) {
  const o = counters.get(el) || { v: 0 };
  counters.set(el, o);
  gsap.to(o, { v, duration: reduce ? 0 : d, ease: "power3.out", onUpdate: () => (el.textContent = fmt(o.v)) });
}

function select(s) {
  if (!STATS.includes(s)) return;
  stat = s;
  document.querySelectorAll(".pick button").forEach((b) => b.classList.toggle("on", b.dataset.stat === s));
  updateStage(true);
  drawChart();
}
document.querySelectorAll(".pick button").forEach((b) => b.addEventListener("click", () => select(b.dataset.stat)));

function updateStage(animate) {
  countTo($("#n-me"), statVal("me"));
  countTo($("#n-him"), statVal("him"));
  const L = leader(stat);
  const diff = Math.abs(statVal("me") - statVal("him"));
  gapEl.style.setProperty("--c", L ? CSSC[L] : "var(--ink2)");
  countTo($("#gap-n"), diff);
  gsap.to(gapEl, { opacity: diff ? 1 : 0, duration: 0.4 });
  applyHeights(animate);
}

function updateRows() {
  document.querySelectorAll(".row").forEach((row) => {
    const s = row.dataset.stat;
    const a = statVal("me", s), b = statVal("him", s);
    countTo($(".side.me .v", row), a);
    countTo($(".side.him .v", row), b);
    const tot = a + b;
    let fa = tot ? a / tot : 0.5;
    if (tot) fa = Math.min(0.96, Math.max(0.04, fa));
    const im = $("i.me", row), ih = $("i.him", row);
    gsap.to(im, { flexBasis: `${fa * 100}%`, duration: 1.4, ease: "expo.out" });
    gsap.to(ih, { flexBasis: `${(1 - fa) * 100}%`, duration: 1.4, ease: "expo.out" });
    const L = leader(s);
    const cm = $(".crownmark", row);
    gsap.to(cm, { left: L === "me" ? "0%" : L === "him" ? "100%" : "50%", opacity: L ? 1 : 0.25, duration: 1.2, ease: "back.out(1.6)" });
    const pb = document.querySelector(`.pick button[data-stat="${s}"] .cr`);
    pb.style.setProperty("--c", L ? CSSC[L] : "var(--line)");
  });
}

/* ---------- video wall: every clip from both channels, sized by views ---------- */
let wallKey = "";
function buildWall() {
  const all = [...data.me.videos.map((v) => ({ ...v, who: "me" })), ...data.him.videos.map((v) => ({ ...v, who: "him" }))];
  const key = all.map((v) => v.id + v.views).join();
  if (key === wallKey) return;
  wallKey = key;
  const inner = $("#wall-inner");
  gsap.killTweensOf(".wall .lane");
  inner.innerHTML = "";
  if (!all.length) return;
  const max = Math.max(1, ...all.map((v) => v.views));
  // shuffle-ish so both channels mix, then deal into 4 lanes
  all.sort((a, b) => (a.id < b.id ? -1 : 1));
  const lanes = [[], [], [], []];
  all.forEach((v, i) => lanes[i % 4].push(v));
  lanes.forEach((lane, li) => {
    if (!lane.length) return;
    const el = document.createElement("div");
    el.className = "lane";
    let items = lane;
    while (items.length < 14) items = items.concat(lane);
    const html = items.map((v) => {
      const h = Math.round(150 + 190 * Math.sqrt(v.views / max)), w = Math.round(h * 0.6);
      return `<a class="tile ${v.who}" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener" style="width:${w}px;height:${h}px">
        <img loading="lazy" src="https://i.ytimg.com/vi/${v.id}/oardefault.jpg" onload="if(this.naturalWidth<=120&&!this.dataset.f){this.dataset.f=1;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'}" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" alt="">
        <span><svg><use href="#i-eye"/></svg>${fmt(v.views)}</span></a>`;
    }).join("");
    el.innerHTML = html + html;
    inner.appendChild(el);
    requestAnimationFrame(() => {
      const half = el.scrollWidth / 2;
      const dirn = li % 2 ? 1 : -1;
      gsap.fromTo(el, { x: dirn < 0 ? 0 : -half }, { x: dirn < 0 ? -half : 0, duration: reduce ? 0 : 60 + li * 12, ease: "none", repeat: -1 });
    });
  });
}

function updateCards() {
  for (const who of ["me", "him"]) {
    const c = data[who], card = $(`#card-${who}`), top = c.top;
    card.classList.toggle("none", !top);
    card.classList.toggle("win", leader("top") === who);
    if (top) {
      card.href = `https://www.youtube.com/watch?v=${top.id}`;
      const img = $("img", card);
      const want = `https://i.ytimg.com/vi/${top.id}/oardefault.jpg`;
      if (img.dataset.id !== top.id) {
        img.dataset.id = top.id;
        const fb = `https://i.ytimg.com/vi/${top.id}/hqdefault.jpg`;
        img.onerror = () => { img.onerror = null; img.src = fb; };
        img.onload = () => { if (img.naturalWidth <= 120 && img.src !== fb) img.src = fb; };
        img.src = want;
      }
      img.alt = top.title;
    } else {
      card.href = `https://www.youtube.com/channel/${c.id}`;
    }
    countTo($(".meta .v", card), top?.views || 0);
    countTo($(".meta .c", card), c.videoCount || 0, 0.8);
  }
}

document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    gsap.to(card, { rotateY: x * 18, rotateX: -y * 14, duration: 0.4, ease: "power2.out" });
  });
  card.addEventListener("pointerleave", () => gsap.to(card, { rotateY: 0, rotateX: 0, duration: 0.9, ease: "elastic.out(1,0.5)" }));
});

/* ---------- race chart (start to Christmas) ---------- */
const histKey = { views: "v", subs: "s", top: "top" };
function drawChart() {
  const el = $("#chart");
  $(".race .head use").setAttribute("href", ICON[stat]);
  if (!hist.length) return;
  const W = el.clientWidth, H = el.clientHeight, padL = 6, padR = 46, padT = 20, padB = 26;
  const t0 = Date.parse(hist[0].t), t1 = XMAS.getTime();
  const k = histKey[stat];
  const max = Math.max(1, ...hist.map((p) => Math.max(p.me[k], p.him[k]))) * 1.12;
  const X = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const Y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const path = (who) => {
    const pts = hist.map((p) => [X(Date.parse(p.t)), Y(p[who][k])]);
    if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return { d, end: pts[pts.length - 1], area: `${d} L${pts[pts.length - 1][0]},${Y(0)} L${pts[0][0]},${Y(0)} Z` };
  };
  const me = path("me"), him = path("him");
  const ticks = [];
  for (let d = new Date(t0); d <= XMAS; d.setDate(d.getDate() + 7)) ticks.push(new Date(d));
  const avatar = (who, [x, y]) => `
    <clipPath id="cp-${who}"><circle cx="${x}" cy="${y}" r="13"/></clipPath>
    <circle cx="${x}" cy="${y}" r="16" fill="${CSSC[who]}"/>
    <image href="data/avatar-${who}.jpg" x="${x - 13}" y="${y - 13}" width="26" height="26" clip-path="url(#cp-${who})"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">
    <g class="grid">${[0.25, 0.5, 0.75, 1].map((f) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(max * f / 1.12)}" y2="${Y(max * f / 1.12)}"/>`).join("")}
      <line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}"/></g>
    ${ticks.map((d) => `<text class="ax" x="${X(d)}" y="${H - 6}" text-anchor="middle">${d.getMonth() + 1}.${d.getDate()}</text>`).join("")}
    <g transform="translate(${X(t1) - 2},${Y(0) - 30})" style="color:var(--gold)"><svg width="26" height="26" viewBox="0 0 24 24"><use href="#i-gift"/></svg></g>
    <path d="${him.area}" fill="var(--him)" opacity=".08"/>
    <path d="${me.area}" fill="var(--me)" opacity=".1"/>
    <path class="ln" d="${him.d}" fill="none" stroke="var(--him)" stroke-width="3.5" stroke-linecap="round"/>
    <path class="ln" d="${me.d}" fill="none" stroke="var(--me)" stroke-width="3.5" stroke-linecap="round"/>
    ${avatar("him", him.end)}${avatar("me", me.end)}
  </svg>`;
  el.querySelectorAll(".ln").forEach((p) => {
    const L = p.getTotalLength();
    gsap.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: reduce ? 0 : 1.6, ease: "power2.inOut" });
  });
}
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawChart, 150); });

/* ---------- header ---------- */
function tick() {
  let s = Math.max(0, Math.floor((XMAS - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const p = (n) => String(n).padStart(2, "0");
  const hh = p(Math.floor(s / 3600)), mm = p(Math.floor((s % 3600) / 60)), ss = p(s % 60);
  $("#cd").textContent = `${d}D ${hh}:${mm}:${ss}`;
  $("#cd-d").textContent = p(d); $("#cd-h").textContent = hh; $("#cd-m").textContent = mm; $("#cd-s").textContent = ss;
  const pr = xmasProgress() * 100;
  $("#track-fill").style.width = `${pr}%`;
  $("#flake").style.left = `${pr}%`;
  if (data) {
    const mins = Math.floor((Date.now() - Date.parse(data.updated)) / 60000);
    $("#fresh span").textContent = mins < 1 ? "now" : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
    $("#fresh").classList.toggle("stale", mins > 120);
  }
}
setInterval(tick, 1000);

/* ---------- load ---------- */
async function load(first) {
  try {
    const bust = `?t=${Date.now()}`;
    const [l, h] = await Promise.all([fetch(`data/latest.json${bust}`).then((r) => r.json()), fetch(`data/history.json${bust}`).then((r) => r.json())]);
    if (!first && data && l.updated === data.updated) return;
    data = l; hist = h;
  } catch (e) { console.warn(e); return; }
  if (first) {
    for (const who of ["me", "him"]) {
      const src = `data/avatar-${who}.jpg?v=${Date.parse(data.updated)}`;
      setAvatar(who, src);
      $(`#pfp-${who}`).src = src;
      $(`#f-${who}`).src = src;
      $(`#name-${who}`).textContent = data[who].handle || data[who].name;
      $(`#yt-${who}`).href = `https://www.youtube.com/channel/${data[who].id}`;
    }
  }
  tick();
  updateStage(true);
  updateRows();
  updateCards();
  buildWall();
  drawChart();
}

await load(true);
setInterval(() => load(false), 5 * 60 * 1000);

// scroll reveals
if (!reduce) {
  gsap.fromTo("#wall-inner", { rotateX: 32, rotateZ: -12, scale: 0.9 }, { rotateX: 8, rotateZ: -4, scale: 1.05, ease: "none", scrollTrigger: { trigger: "#wall", start: "top bottom", end: "bottom top", scrub: true } });
  gsap.utils.toArray(".row").forEach((r, i) => gsap.from(r, { y: 40, opacity: 0, duration: 0.9, delay: i * 0.08, ease: "power3.out", scrollTrigger: { trigger: r, start: "top 90%" } }));
  gsap.from(".card", { y: 80, rotateX: 25, opacity: 0, duration: 1.1, stagger: 0.12, ease: "power3.out", scrollTrigger: { trigger: ".tops", start: "top 85%" } });
  ScrollTrigger.create({ trigger: ".race", start: "top 80%", once: true, onEnter: drawChart });
}
