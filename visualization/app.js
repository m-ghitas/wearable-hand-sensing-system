import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const fingerNames = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const fingerLabels = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const state = {
  mode: 'demo', connected: false, port: null, reader: null, readLoop: false,
  raw: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  smoothed: { thumb: null, index: null, middle: null, ring: null, pinky: null },
  flex: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  demo: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  calibration: Object.fromEntries(fingerNames.map(n => [n, { open: null, closed: null }])),
  fsr: [0, 0, 0], lastPacket: 0,
  diagnostics: { active: false, finger: 'index', showAxes: false, values: {
    thumb: { BASE: 0, CMC: 0, MCP: 0, IP: 0 },
    index: { MCP: 0, PIP: 0, DIP: 0 },
    middle: { MCP: 0, PIP: 0, DIP: 0 },
    ring: { MCP: 0, PIP: 0, DIP: 0 },
    pinky: { MCP: 0, PIP: 0, DIP: 0 },
  } },
};
let toastTimer;
function toast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// V4 — model-authored finger kinematics + independent joint diagnostics
// The closed references are extracted from this GLB's own RigAction clip.
// ============================================================
const host = $('canvasHost');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0.10, 0.10, 4.0);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.075;
controls.enablePan = false; controls.minDistance = 2.0; controls.maxDistance = 8;
controls.target.set(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xfff3e8, 0x766052, 1.55));
const keyLight = new THREE.DirectionalLight(0xffe8d8, 2.7); keyLight.position.set(-3.2, 4.0, 5.0); keyLight.castShadow = true; scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffeadb, 1.15); fillLight.position.set(4.0, 1.0, 3.0); scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0xffd8c2, 1.25); rimLight.position.set(0.0, 2.0, -4.0); scene.add(rimLight);

const handRoot = new THREE.Group();
scene.add(handRoot);
const MODEL_URL = './assets/hand_model.glb';
const KINEMATICS_URL = './assets/hand_kinematics.json';
let handModel = null;
let rigMap = {};
let riggedModelReady = false;
let rigBones = [];
let allBoneRest = new Map();
let modelFitScale = 1;
let kinematicReference = null;
const identityQuaternion = new THREE.Quaternion();

const JOINT_SPEC = {
  thumb: [
    ['thumb_meta', 'CMC'], ['thumb_prox', 'MCP'], ['thumb_dist', 'IP'],
  ],
  index: [
    ['index_prox', 'MCP'], ['index_midd', 'PIP'], ['index_dist', 'DIP'],
  ],
  middle: [
    ['midd_prox', 'MCP'], ['midd_midd', 'PIP'], ['midd_dist', 'DIP'],
  ],
  ring: [
    ['ring_prox', 'MCP'], ['ring_midd', 'PIP'], ['ring_dist', 'DIP'],
  ],
  pinky: [
    ['pinky_prox', 'MCP'], ['pinky_midd', 'PIP'], ['pinky_dist', 'DIP'],
  ],
};

function makePoseEntry(bone, source, finger, name, role) {
  if (!bone || !source?.deltaQuaternion || !source?.localAxis) return null;
  const d = source.deltaQuaternion;
  return {
    bone, finger, name, role,
    rest: bone.quaternion.clone(),
    closedDelta: new THREE.Quaternion(d[0], d[1], d[2], d[3]).normalize(),
    axis: new THREE.Vector3().fromArray(source.localAxis).normalize(),
    referenceRotationDeg: Number(source.referenceRotationDeg) || 0,
    helper: null,
  };
}

function buildJointMap(model, reference) {
  rigBones = [];
  const bonesByName = new Map();
  model.traverse(object => {
    if (!object.isBone) return;
    rigBones.push(object);
    if (!bonesByName.has(object.name)) bonesByName.set(object.name, object);
  });
  allBoneRest = new Map(rigBones.map(bone => [bone, bone.quaternion.clone()]));
  const groups = {};
  for (const finger of fingerNames) {
    groups[finger] = JOINT_SPEC[finger].map(([boneName, role]) =>
      makePoseEntry(bonesByName.get(boneName), reference?.poses?.[finger]?.[boneName], finger, boneName, role)
    ).filter(Boolean);
  }
  const thumbBase = makePoseEntry(
    bonesByName.get('thumb_trapez'),
    reference?.poses?.thumb?.thumb_trapez,
    'thumb', 'thumb_trapez', 'BASE'
  );
  const mapped = Object.fromEntries(fingerNames.map(finger => [finger, groups[finger].length]));
  const enough = fingerNames.every(finger => groups[finger].length === 3) && !!thumbBase;
  console.info('V4 detected rig bones:', rigBones.map(bone => bone.name));
  console.info('V4 reference pose times:', reference?.poseTimeSeconds);
  console.info('V4 joint mapping:', Object.fromEntries(fingerNames.map(finger => [
    finger, groups[finger].map(entry => `${entry.role}:${entry.name}`)
  ])));
  return {
    ...groups,
    thumbBase,
    mapped,
    enough,
    poseTimeSeconds: reference?.poseTimeSeconds || {},
  };
}

function resetRigPose() {
  for (const [bone, rest] of allBoneRest) bone.quaternion.copy(rest);
}

function applyReferencePose(entry, amount) {
  if (!entry) return;
  const blend = new THREE.Quaternion().slerpQuaternions(
    identityQuaternion, entry.closedDelta, THREE.MathUtils.clamp(amount / 100, 0, 1)
  );
  entry.bone.quaternion.copy(entry.rest).multiply(blend);
}

function setModelPose(values) {
  if (!handModel || !riggedModelReady) return;
  resetRigPose();
  for (const finger of fingerNames) {
    const amount = THREE.MathUtils.clamp(Number(values[finger]) || 0, 0, 100);
    for (const entry of (rigMap[finger] || [])) applyReferencePose(entry, amount);
    if (finger === 'thumb') applyReferencePose(rigMap.thumbBase, amount);
  }
  handModel.updateMatrixWorld(true);
}

function setDiagnosticPose() {
  if (!handModel || !riggedModelReady) return;
  resetRigPose();
  const finger = state.diagnostics.finger;
  const values = state.diagnostics.values[finger];
  if (finger === 'thumb') applyReferencePose(rigMap.thumbBase, values.BASE);
  for (const entry of (rigMap[finger] || [])) applyReferencePose(entry, values[entry.role]);
  handModel.updateMatrixWorld(true);
}

function createJointHelpers() {
  const entries = [
    ...fingerNames.flatMap(finger => rigMap[finger] || []),
    rigMap.thumbBase,
  ].filter(Boolean);
  const axesLength = 0.17 / Math.max(modelFitScale, 0.0001);
  const pivotRadius = 0.012 / Math.max(modelFitScale, 0.0001);
  const pivotGeometry = new THREE.SphereGeometry(pivotRadius, 10, 8);
  const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xf4d36d, depthTest: false });
  for (const entry of entries) {
    const group = new THREE.Group();
    group.name = `V4_DIAGNOSTIC_${entry.name}`;
    const axes = new THREE.AxesHelper(axesLength);
    axes.renderOrder = 10;
    const pivot = new THREE.Mesh(pivotGeometry, pivotMaterial);
    pivot.renderOrder = 11;
    group.add(axes, pivot);
    entry.bone.add(group);
    entry.helper = group;
  }
  updateJointHelpers();
}

function updateJointHelpers() {
  const selected = state.diagnostics.finger;
  const visible = state.diagnostics.active && state.diagnostics.showAxes;
  for (const finger of fingerNames) {
    for (const entry of (rigMap[finger] || [])) {
      if (entry.helper) entry.helper.visible = visible && finger === selected;
    }
  }
  if (rigMap.thumbBase?.helper) {
    rigMap.thumbBase.helper.visible = visible && selected === 'thumb';
  }
}

function axisText(axis) {
  return axis.toArray().map(value => (Math.abs(value) < 0.0005 ? 0 : value).toFixed(2)).join(', ');
}

function describeRig(map) {
  const totalMapped = fingerNames.reduce((sum, name) => sum + (map[name]?.length || 0), 0);
  const rows = fingerNames.map(finger => {
    const entries = [...(map[finger] || [])];
    if (finger === 'thumb' && map.thumbBase) entries.unshift(map.thumbBase);
    const valid = (map[finger] || []).length === 3 && (finger !== 'thumb' || !!map.thumbBase);
    const labels = entries.map(entry =>
      `<span><b>${entry.role}</b> <code>${entry.name}</code><small>local axis (${axisText(entry.axis)}) · ref ${entry.referenceRotationDeg.toFixed(1)}°</small></span>`
    ).join('');
    return `<div class="${valid ? 'mapped' : 'unmapped'}"><strong>${fingerLabels[fingerNames.indexOf(finger)]} · ${(map[finger] || []).length}/3</strong><div class="mapped-bones">${labels || 'NOT MAPPED'}</div></div>`;
  }).join('');
  const detected = rigBones.map(bone => `<code>${bone.name}</code>`).join(' ');
  $('boneList').innerHTML = `<div class="rig-map-list">${rows}</div><p class="rig-map-total">${totalMapped}/15 articulated finger joints · ${map.thumbBase ? 'thumb base support mapped' : 'thumb base missing'} · ${rigBones.length} total rig bones · reference: RigAction</p><details class="bone-names"><summary>All detected bones (${rigBones.length})</summary><div>${detected}</div></details>`;
  $('rigDiagnostics').querySelector('summary').textContent = `Rig diagnostics · ${totalMapped}/15 joints mapped`;
  $('rigDiagnostics').open = true;
}

async function loadHandModel() {
  const loader = new GLTFLoader();
  $('renderMode').textContent = 'LOADING V4 HAND MODEL';
  $('stageFooterText').textContent = 'LOADING LOCAL SKINNED HAND MODEL + KINEMATICS';
  try {
    const [gltf, referenceResponse] = await Promise.all([
      new Promise((resolve, reject) => loader.load(MODEL_URL, resolve, undefined, reject)),
      fetch(KINEMATICS_URL, { cache: 'no-store' }),
    ]);
    if (!referenceResponse.ok) throw new Error(`Kinematics reference HTTP ${referenceResponse.status}`);
    kinematicReference = await referenceResponse.json();
    handRoot.clear();
    handModel = gltf.scene;
    handModel.updateMatrixWorld(true);

    // Preserve V3.3's hand orientation and fit, now using the bundled local GLB.
    let box = new THREE.Box3().setFromObject(handModel);
    const size0 = box.getSize(new THREE.Vector3());
    if (size0.x >= size0.y && size0.x >= size0.z) handModel.rotation.z = Math.PI / 2;
    else if (size0.z >= size0.x && size0.z >= size0.y) handModel.rotation.x = -Math.PI / 2;
    handModel.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(handModel);
    const dims = box.getSize(new THREE.Vector3());
    modelFitScale = 2.70 / Math.max(dims.x, dims.y, dims.z, 0.001);
    const center = box.getCenter(new THREE.Vector3());
    handModel.scale.setScalar(modelFitScale);
    handModel.position.addScaledVector(center, -modelFitScale);

    const unifiedSkinMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9aa8d, roughness: 0.68, metalness: 0.0,
      side: THREE.DoubleSide, vertexColors: false,
    });
    handModel.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.material = unifiedSkinMaterial;
      }
    });
    handRoot.add(handModel);
    handModel.updateMatrixWorld(true);

    rigMap = buildJointMap(handModel, kinematicReference);
    riggedModelReady = !!rigMap.enough;
    if (riggedModelReady) createJointHelpers();
    const totalMapped = fingerNames.reduce((sum, name) => sum + (rigMap[name]?.length || 0), 0);
    $('renderMode').textContent = riggedModelReady ? 'V4 · ANIMATION-DERIVED JOINTS' : 'V4 MODEL LOADED · RIG CHECK NEEDED';
    $('stageFooterText').textContent = riggedModelReady
      ? `V4 HAND · ${totalMapped}/15 JOINTS · MODEL-AUTHORED MOTION REFERENCES`
      : `MODEL VISIBLE · ${totalMapped}/15 JOINTS · CHECK RIG DIAGNOSTICS`;
    $('poseHint').textContent = riggedModelReady
      ? 'Independent local joint motion references loaded from the model animation.'
      : 'The model loaded, but one or more expected bones are missing.';
    describeRig(rigMap);
    buildJointTestControls();
    if (riggedModelReady) {
      setModelPose(state.flex);
      toast(`V4 ready: ${totalMapped}/15 joints + thumb base mapped.`);
    } else {
      toast('The model loaded, but the exact V4 bone map needs inspection.');
    }
    console.info('V4 source animation:', kinematicReference.sourceAnimation, kinematicReference.poseTimeSeconds);
    $('poseName').textContent = 'OPEN HAND';
  } catch (err) {
    console.error('V4 hand model load failed:', err);
    $('renderMode').textContent = 'V4 MODEL / KINEMATICS FILE MISSING';
    $('stageFooterText').textContent = 'CHECK assets/hand_model.glb + hand_kinematics.json';
    $('poseName').textContent = 'MODEL NOT LOADED';
    $('poseHint').textContent = 'Keep both bundled files inside the assets folder and start the local server again.';
    toast('V4 asset load failed: ' + (err?.message || err));
  }
}
loadHandModel();

function setHandPose(values) {
  if (state.diagnostics.active) {
    if (riggedModelReady) setDiagnosticPose();
    $('poseName').textContent = 'JOINT DIAGNOSTICS';
    return;
  }
  if (riggedModelReady) setModelPose(values);
  $('poseName').textContent = Object.values(values).every(v => v < 8) ? 'OPEN HAND' : Object.values(values).every(v => v > 85) ? 'CLOSED FIST' : 'CUSTOM POSE';
}

function resizeRenderer() {
  const w = host.clientWidth || 800, h = host.clientHeight || 500;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resizeRenderer).observe(host); resizeRenderer();
function animate() {
  requestAnimationFrame(animate);
  controls.update(); renderer.render(scene, camera);
}
animate();

// ---------- UI generation ----------
function buildCalList() {
  $('calList').innerHTML = fingerNames.map((n, i) => `<div class="cal-item"><span class="cal-name">${fingerLabels[i]}</span><div class="cal-track"><i id="cal-${n}"></i></div><span class="cal-state" id="calstate-${n}">WAITING</span></div>`).join('');
}
function buildTelemetry() {
  $('telemetryRows').innerHTML = fingerNames.map((n, i) => `<div class="telemetry-row"><span class="telemetry-name">${fingerLabels[i]}</span><div class="meter-track"><i id="meter-${n}"></i></div><span class="telemetry-percent" id="percent-${n}">0%</span></div>`).join('');
}
function buildDemoSliders() {
  $('demoSliders').innerHTML = fingerNames.map((n, i) => `<div class="demo-control"><label for="slider-${n}">${fingerLabels[i]} <output id="sliderout-${n}">0%</output></label><input id="slider-${n}" type="range" min="0" max="100" value="0" step="1" /></div>`).join('');
  fingerNames.forEach(n => $('slider-' + n).addEventListener('input', e => {
    if (state.mode !== 'demo') return;
    state.demo[n] = Number(e.target.value); state.flex[n] = state.demo[n];
    updateDisplay();
  }));
}
buildCalList(); buildTelemetry(); buildDemoSliders();

function buildJointTestControls() {
  const finger = state.diagnostics.finger;
  const entries = finger === 'thumb'
    ? [{ role: 'BASE', label: 'Thumb base' }, { role: 'CMC', label: 'CMC · opposition / sweep' }, { role: 'MCP', label: 'MCP' }, { role: 'IP', label: 'IP' }]
    : [{ role: 'MCP', label: 'MCP' }, { role: 'PIP', label: 'PIP' }, { role: 'DIP', label: 'DIP' }];
  $('jointTestSliders').innerHTML = entries.map(item => `
    <div class="joint-test-control">
      <label for="joint-${item.role}">${item.label}<output id="jointout-${item.role}">${state.diagnostics.values[finger][item.role]}%</output></label>
      <input id="joint-${item.role}" data-joint="${item.role}" type="range" min="0" max="100" step="1" value="${state.diagnostics.values[finger][item.role]}" />
    </div>`).join('');
  entries.forEach(item => {
    const slider = $(`joint-${item.role}`);
    slider.addEventListener('input', event => {
      state.diagnostics.values[finger][item.role] = Number(event.target.value);
      $(`jointout-${item.role}`).textContent = `${event.target.value}%`;
      if (state.diagnostics.active) setDiagnosticPose();
    });
  });
  $('jointTestStatus').textContent = finger === 'thumb'
    ? `Thumb reference pose sampled at ${rigMap.poseTimeSeconds?.thumb ?? '—'} s in RigAction.`
    : `${fingerLabels[fingerNames.indexOf(finger)]} reference pose sampled at ${rigMap.poseTimeSeconds?.[finger] ?? '—'} s in RigAction.`;
}

$('jointFingerSelect').addEventListener('change', event => {
  state.diagnostics.finger = event.target.value;
  buildJointTestControls();
  updateJointHelpers();
  if (state.diagnostics.active) setDiagnosticPose();
});
$('showJointAxes').addEventListener('change', event => {
  state.diagnostics.showAxes = event.target.checked;
  updateJointHelpers();
});
$('jointTestToggle').addEventListener('click', () => {
  state.diagnostics.active = !state.diagnostics.active;
  $('jointTestToggle').textContent = state.diagnostics.active ? 'Exit joint test' : 'Enter joint test';
  $('jointTestToggle').classList.toggle('active', state.diagnostics.active);
  updateJointHelpers();
  updateDisplay();
  toast(state.diagnostics.active ? 'Joint test active: selected finger only.' : 'Returned to the glove / demo pose.');
});
$('resetJointTest').addEventListener('click', () => {
  const finger = state.diagnostics.finger;
  for (const role of Object.keys(state.diagnostics.values[finger])) state.diagnostics.values[finger][role] = 0;
  buildJointTestControls();
  if (state.diagnostics.active) setDiagnosticPose();
});

function updateDisplay() {
  setHandPose(state.flex);
  fingerNames.forEach((n, i) => {
    const value = Math.round(state.flex[n]);
    $('meter-' + n).style.width = value + '%';
    $('percent-' + n).textContent = value + '%';
    const slider = $('slider-' + n);
    if (state.mode === 'demo' && document.activeElement !== slider) slider.value = value;
    $('sliderout-' + n).textContent = value + '%';
    const c = state.calibration[n];
    const ready = Number.isFinite(c.open) && Number.isFinite(c.closed) && Math.abs(c.closed - c.open) >= 15;
    const fill = ready ? 100 : (Number.isFinite(c.open) || Number.isFinite(c.closed) ? 50 : 0);
    $('cal-' + n).style.width = fill + '%';
    $('calstate-' + n).textContent = ready ? 'READY' : (Number.isFinite(c.open) ? 'OPEN SET' : Number.isFinite(c.closed) ? 'CLOSE SET' : 'WAITING');
  });
  const calibrated = fingerNames.filter(n => Number.isFinite(state.calibration[n].open) && Number.isFinite(state.calibration[n].closed) && Math.abs(state.calibration[n].closed - state.calibration[n].open) >= 15).length;
  $('calCount').textContent = `${calibrated} / 5`;
  $('captureOpen').disabled = !state.connected;
  $('captureClosed').disabled = !state.connected;
  if (state.diagnostics.active) {
    $('poseHint').textContent = `Joint test override · ${fingerLabels[fingerNames.indexOf(state.diagnostics.finger)]} only. Exit to restore the glove pose.`;
    $('renderMode').textContent = `V4 JOINT TEST · ${state.diagnostics.finger.toUpperCase()}`;
    $('dataSourceText').textContent = 'Joint test overrides demo / live input until you exit this mode.';
  } else {
    $('poseHint').textContent = state.mode === 'demo' ? 'Adjust the finger sliders below to pose the hand.' : (calibrated < 5 ? 'Capture OPEN and CLOSED poses to calibrate the glove.' : 'Hand pose is driven by live sensor readings.');
    $('renderMode').textContent = state.mode === 'demo' ? 'V4 · MODEL-AUTHORED DEMO POSE' : 'V4 · LIVE SENSOR STREAM';
    $('dataSourceText').textContent = state.mode === 'demo' ? 'Each finger uses its own joint reference pose from the model animation.' : 'Live mode uses the five calibrated flex sensor channels.';
  }
}
updateDisplay();

function setMode(mode) {
  state.mode = mode;
  const demo = mode === 'demo';
  $('demoToggle').classList.toggle('active', demo);
  $('demoToggle').innerHTML = `<span></span> ${demo ? 'DEMO MODE' : 'LIVE MODE'}`;
  $('demoToggle').title = demo ? 'Switch to the live sensor mode after connecting' : 'Return to local demo controls';
  $('globalStatus').textContent = demo ? 'DEMO MODE' : 'LIVE INPUT';
  $('globalDot').style.background = demo ? '#f1c47e' : '#42dfc2';
  $('connectionState').textContent = state.connected ? 'CONNECTED' : (demo ? 'DEMO' : 'DISCONNECTED');
  $('connectionState').className = 'connection-state ' + (state.connected ? 'connected' : 'demo');
  $('demoSliders').style.opacity = demo ? '1' : '.35';
  $('demoSliders').style.pointerEvents = demo ? 'auto' : 'none';
  updateDisplay();
}
$('demoToggle').addEventListener('click', () => {
  if (state.connected) {
    setMode(state.mode === 'demo' ? 'live' : 'demo');
  } else {
    setMode('demo'); toast('Connect the glove before switching to live mode.');
  }
});
$('openHandButton').addEventListener('click', () => {
  if (state.mode !== 'demo') { toast('Switch to Demo Mode to use the sliders.'); return; }
  fingerNames.forEach(n => { state.demo[n] = 0; state.flex[n] = 0; $('slider-' + n).value = 0; }); updateDisplay();
});
$('resetCalibration').addEventListener('click', () => {
  fingerNames.forEach(n => state.calibration[n] = { open: null, closed: null }); updateDisplay(); toast('Calibration cleared.');
});

function capturePose(which) {
  if (!state.connected) return;
  const now = Date.now();
  if (now - state.lastPacket > 1200) { toast('No recent sensor packet. Check the serial stream.'); return; }
  fingerNames.forEach(n => { state.calibration[n][which] = state.smoothed[n] ?? state.raw[n]; });
  updateDisplay();
  toast(which === 'open' ? 'OPEN reference captured for all five fingers.' : 'CLOSED reference captured for all five fingers.');
}
$('captureOpen').addEventListener('click', () => capturePose('open'));
$('captureClosed').addEventListener('click', () => capturePose('closed'));

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function processPacket(values) {
  const [thumb, index, middle, ring, pinky, fsr1 = 0, fsr2 = 0, fsr3 = 0] = values;
  const packet = { thumb, index, middle, ring, pinky };
  state.lastPacket = Date.now(); state.fsr = [fsr1, fsr2, fsr3];
  for (const n of fingerNames) {
    const val = Number(packet[n]);
    if (!Number.isFinite(val)) continue;
    state.raw[n] = val;
    state.smoothed[n] = state.smoothed[n] == null ? val : state.smoothed[n] + 0.28 * (val - state.smoothed[n]);
    const c = state.calibration[n];
    if (Number.isFinite(c.open) && Number.isFinite(c.closed) && Math.abs(c.closed - c.open) >= 15) {
      const ratio = (state.smoothed[n] - c.open) / (c.closed - c.open);
      const target = clamp(ratio * 100, 0, 100);
      state.flex[n] = state.flex[n] + 0.30 * (target - state.flex[n]);
    }
  }
  // FSR channels are reserved but physically disconnected in this version.
  // Do not display floating ADC readings as pressure values.
  $('fsr1Value').textContent = '—'; $('fsr2Value').textContent = '—'; $('fsr3Value').textContent = '—';
  $('fsr1Bar').style.width = '0%'; $('fsr2Bar').style.width = '0%'; $('fsr3Bar').style.width = '0%';
  updateDisplay();
}

function parseLine(line) {
  const trimmed = line.trim(); if (!trimmed) return;
  const parts = trimmed.split(',').map(x => x.trim());
  if (parts[0].toUpperCase() === 'DATA') parts.shift();
  if (parts.length < 5) return;
  const nums = parts.slice(0, 8).map(v => Number(v));
  if (nums.slice(0, 5).every(Number.isFinite)) processPacket(nums);
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    toast('Web Serial is unavailable. Open this app in Chrome or Edge on localhost.'); return;
  }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    state.port = port; state.connected = true; state.readLoop = true;
    fingerNames.forEach(n => { state.flex[n] = 0; state.smoothed[n] = null; });
    setMode('live');
    $('deviceDetail').textContent = 'Serial · 115200 baud';
    $('connectionNote').textContent = 'Connected. Close PuTTY / Serial Monitor while this app owns the COM port.';
    $('connectButton').disabled = true; $('disconnectButton').disabled = false;
    toast('Glove connected. Capture OPEN and CLOSED to calibrate.');
    const decoder = new TextDecoder(); let buffer = '';
    state.reader = port.readable.getReader();
    while (state.readLoop) {
      const { value, done } = await state.reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); parseLine(line);
      }
      if (buffer.length > 300) buffer = buffer.slice(-100);
    }
  } catch (err) {
    if (err?.name !== 'NotFoundError') toast('Serial error: ' + (err?.message || err));
  } finally {
    const portToClose = state.port;
    try { state.reader?.releaseLock(); } catch (_) {}
    state.reader = null;
    if (portToClose) { try { await portToClose.close(); } catch (_) {} }
    state.port = null; state.connected = false; state.readLoop = false;
    $('connectButton').disabled = false; $('disconnectButton').disabled = true;
    $('deviceDetail').textContent = 'Waiting for serial connection';
    $('connectionNote').textContent = 'Demo controls are active. Connect the board to use live readings.';
    if (state.mode === 'live') setMode('demo'); else setMode(state.mode);
  }
}
$('connectButton').addEventListener('click', connectSerial);
$('disconnectButton').addEventListener('click', async () => {
  state.readLoop = false;
  try { await state.reader?.cancel(); } catch (_) {}
  toast('Disconnecting glove…');
});

// Camera presets. The model can also be rotated with a mouse drag.
function setCamera(position) { camera.position.set(...position); controls.target.set(0, 0, 0); controls.update(); }
$('palmViewButton').addEventListener('click', () => { setCamera([0.12, 0.18, 4.25]); $('palmViewButton').classList.add('active'); $('sideViewButton').classList.remove('active'); });
$('sideViewButton').addEventListener('click', () => { setCamera([4.8, 0.25, 2.2]); $('sideViewButton').classList.add('active'); $('palmViewButton').classList.remove('active'); });
$('resetViewButton').addEventListener('click', () => { setCamera([0.12, 0.18, 4.25]); controls.reset(); });

// Keep UI states synchronized after a browser reconnect.
if ('serial' in navigator) navigator.serial.addEventListener('disconnect', () => {
  if (state.connected) { state.readLoop = false; toast('Serial device disconnected.'); }
});
