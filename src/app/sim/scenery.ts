import * as THREE from 'three';
import { terrainHeight } from './flight';

export const SKY_HORIZON = 0xa6c8d2;
const SKY_ZENITH = 0x4f86c0;
const SUN_DIRECTION = new THREE.Vector3(-5000, 9000, -6000).normalize();

/** Woodland mask shared by tree placement and the terrain shader (keep both formulas identical). */
export function forestDensity(x: number, z: number): number {
  return Math.sin(x / 1300 + 1.3) * Math.cos(z / 1700 - 0.6) + 0.5 * Math.sin((x - z) / 700);
}

/** Runway, apron and approach corridor stay clear of trees. */
export function inAirfieldClearZone(x: number, z: number): boolean {
  return (Math.abs(x) < 650 && Math.abs(z) < 2700) || Math.hypot(x, z) < 1500;
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE_GLSL = /* glsl */ `
float sceneryHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sceneryNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sceneryHash(i), sceneryHash(i + vec2(1.0, 0.0)), f.x),
             mix(sceneryHash(i + vec2(0.0, 1.0)), sceneryHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sceneryFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amplitude * sceneryNoise(p);
    p = p * 2.03 + 17.0;
    amplitude *= 0.5;
  }
  return value;
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
vec2 groundXZ = vSceneryWorld.xz;
float groundRange = length(groundXZ);
float viewDistance = length(vSceneryWorld - cameraPosition);
float fineDetail = 1.0 - smoothstep(700.0, 5000.0, viewDistance);
float midDetail = 1.0 - smoothstep(6000.0, 26000.0, viewDistance);
float large = sceneryFbm(groundXZ / 2600.0);
float medium = sceneryFbm(groundXZ / 260.0);
float fine = sceneryFbm(groundXZ / 28.0);
float slope = 1.0 - normalize(vSceneryNormal).y;

vec3 ground = mix(vec3(0.20, 0.27, 0.12), vec3(0.34, 0.37, 0.18), large);
ground = mix(ground, vec3(0.42, 0.40, 0.25), smoothstep(230.0, 420.0, vSceneryWorld.y) * 0.7);
ground = mix(ground, vec3(0.40, 0.38, 0.34), smoothstep(0.025, 0.07, slope));

float forest = sin(groundXZ.x / 1300.0 + 1.3) * cos(groundXZ.y / 1700.0 - 0.6) + 0.5 * sin((groundXZ.x - groundXZ.y) / 700.0);
float woods = smoothstep(0.45, 0.62, forest + (medium - 0.5) * 0.25);
float clearZone = (abs(groundXZ.x) < 650.0 && abs(groundXZ.y) < 2700.0) || groundRange < 1500.0 ? 1.0 : 0.0;
woods *= 1.0 - clearZone;

// Patchwork farmland around the airfield, with darker hedgerows between plots.
vec2 plotSize = vec2(230.0, 160.0);
vec2 plotPos = groundXZ + vec2(floor(groundXZ.y / plotSize.y) * 83.0, 0.0);
vec2 plot = floor(plotPos / plotSize);
vec2 inPlot = fract(plotPos / plotSize) * plotSize;
float plotType = sceneryHash(plot + 3.7);
vec3 crop = plotType < 0.3 ? vec3(0.30, 0.40, 0.16)
  : plotType < 0.5 ? vec3(0.62, 0.55, 0.30)
  : plotType < 0.72 ? vec3(0.40, 0.31, 0.21)
  : vec3(0.36, 0.44, 0.22);
float furrows = 0.5 + 0.5 * sin((plotType > 0.5 ? inPlot.x : inPlot.y) * 1.6);
crop *= 1.0 - (plotType >= 0.5 && plotType < 0.72 ? 0.18 : 0.06) * furrows * fineDetail;
crop *= 0.9 + 0.2 * sceneryHash(plot + 9.1);
float hedge = 1.0 - smoothstep(3.0, 7.0, min(min(inPlot.x, plotSize.x - inPlot.x), min(inPlot.y, plotSize.y - inPlot.y)));
crop = mix(crop, vec3(0.16, 0.23, 0.10), hedge * midDetail);
float farmland = (1.0 - smoothstep(3800.0, 7200.0, groundRange + (large - 0.5) * 1800.0)) * (1.0 - clearZone);
ground = mix(ground, crop, farmland * (1.0 - smoothstep(0.03, 0.06, slope)));

// Mown grass around the runway.
ground = mix(ground, vec3(0.33, 0.40, 0.20) * (0.94 + 0.12 * sin(groundXZ.x * 0.21)), clearZone * smoothstep(1700.0, 1500.0, abs(groundXZ.y)) * step(abs(groundXZ.x), 650.0));

ground = mix(ground, vec3(0.11, 0.18, 0.08) * (0.8 + 0.4 * medium), woods);

// Lakes in the lowest valleys away from the airfield, ringed by a sandy shore.
float shore = smoothstep(26.0, 14.0, vSceneryWorld.y) * step(5600.0, groundRange);
float water = smoothstep(12.0, 8.0, vSceneryWorld.y) * step(5600.0, groundRange);
ground = mix(ground, vec3(0.52, 0.48, 0.36), shore * (1.0 - woods));
ground = mix(ground, vec3(0.10, 0.20, 0.24) * (0.9 + 0.2 * medium), water);

float groundTexture = mix(1.0, 0.82 + 0.36 * medium, midDetail) * mix(1.0, 0.85 + 0.3 * fine, fineDetail * (1.0 - water));
diffuseColor.rgb = ground * groundTexture;
`;

export function createTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(80000, 80000, 256, 256);
  geometry.rotateX(-Math.PI / 2);
  const vertices = geometry.attributes['position'];
  for (let i = 0; i < vertices.count; i++) vertices.setY(i, terrainHeight(vertices.getX(i), vertices.getZ(i)) - 0.1);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSceneryWorld;\nvarying vec3 vSceneryNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSceneryWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSceneryNormal = mat3(modelMatrix) * objectNormal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSceneryWorld;\nvarying vec3 vSceneryNormal;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${TERRAIN_FRAGMENT}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, smoothstep(12.0, 8.0, vSceneryWorld.y) * step(5600.0, length(vSceneryWorld.xz)));');
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  return mesh;
}

export function treePositions(count = 5200, seed = 7): THREE.Vector3[] {
  const random = seeded(seed);
  const trees: THREE.Vector3[] = [];
  for (let attempt = 0; attempt < count * 12 && trees.length < count; attempt++) {
    const angle = random() * Math.PI * 2;
    const radius = 1500 + Math.sqrt(random()) * 15000;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    if (inAirfieldClearZone(x, z) || forestDensity(x, z) < 0.5 + random() * 0.15) continue;
    const y = terrainHeight(x, z);
    if (radius > 5600 && y < 28) continue;
    trees.push(new THREE.Vector3(x, y, z));
  }
  return trees;
}

export function createTrees(): THREE.InstancedMesh {
  const geometry = new THREE.ConeGeometry(1, 1, 6);
  geometry.translate(0, 0.5, 0);
  const positions = treePositions();
  const trees = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), positions.length);
  const random = seeded(11);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), color = new THREE.Color();
  positions.forEach((position, index) => {
    const height = 9 + random() * 10;
    scale.set(height * (0.28 + random() * 0.1), height, height * (0.28 + random() * 0.1));
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI);
    trees.setMatrixAt(index, matrix.compose(position.clone().setY(position.y - 1), rotation, scale));
    trees.setColorAt(index, color.setHSL(0.24 + random() * 0.08, 0.35 + random() * 0.2, 0.13 + random() * 0.08));
  });
  trees.name = 'trees';
  return trees;
}

export function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      zenith: { value: new THREE.Color(SKY_ZENITH) },
      sunDirection: { value: SUN_DIRECTION },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 sunDirection;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float elevation = max(direction.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(smoothstep(0.0, 1.0, elevation), 0.55));
        float sun = max(dot(direction, sunDirection), 0.0);
        color += vec3(1.0, 0.92, 0.75) * (pow(sun, 900.0) * 3.0 + pow(sun, 18.0) * 0.18);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50000, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.name = 'sky';
  return sky;
}

function cloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable for cloud textures.');
  const random = seeded(23);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (random() - 0.5) * 56, y = 64 + (random() - 0.5) * 44, r = 14 + random() * 26;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    const shade = Math.round(200 + random() * 55);
    gradient.addColorStop(0, `rgba(${shade},${shade},${shade},0.38)`);
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Cumulus clusters built from camera-facing puffs; each cluster is one draw call so clusters depth-sort. */
export function createClouds(): THREE.Group {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: null },
      lit: { value: new THREE.Color(0xfffbf2) },
      shadow: { value: new THREE.Color(0x8d9aa8) },
    }]),
    vertexShader: /* glsl */ `
      attribute vec3 center;
      attribute vec2 corner;
      attribute vec3 puff;
      varying vec2 vUv;
      varying float vShade;
      varying float vFade;
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
        float angle = puff.z * 6.2831853;
        mvPosition.xy += mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * corner * puff.x;
        vUv = corner * 0.5 + 0.5;
        vShade = puff.y;
        vFade = smoothstep(puff.x * 0.25, puff.x * 1.4, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 lit;
      uniform vec3 shadow;
      varying vec2 vUv;
      varying float vShade;
      varying float vFade;
      #include <fog_pars_fragment>
      void main() {
        vec4 texel = texture2D(map, vUv);
        float alpha = clamp(texel.a * 1.6, 0.0, 1.0) * vFade;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(mix(shadow, lit, clamp(vShade * (0.75 + 0.35 * texel.r), 0.0, 1.0)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  material.uniforms['map'].value = cloudTexture();
  const group = new THREE.Group();
  group.name = 'clouds';
  const random = seeded(31);
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let c = 0; c < 46; c++) {
    const angle = c * 2.39996 + random() * 0.4;
    const radius = 3500 + (c % 9) * 3300 + random() * 1800;
    const base = 3500 + random() * 1800;
    const width = 1100 + random() * 1700;
    const height = width * (0.35 + random() * 0.25);
    const count = 12 + Math.floor(random() * 10);
    const centers: number[] = [], cornerData: number[] = [], puffs: number[] = [], index: number[] = [];
    for (let p = 0; p < count; p++) {
      const dx = (random() - 0.5) * 2, dz = (random() - 0.5) * 2;
      const dome = Math.max(0, 1 - dx * dx * 0.8 - dz * dz * 0.5);
      const y = random() * height * dome;
      const size = (260 + random() * 260) * (0.65 + dome * 0.6);
      const shade = 0.25 + 0.75 * (y / height);
      const spin = random();
      for (let k = 0; k < 4; k++) {
        centers.push(dx * width * 0.5, y, dz * width * 0.3);
        cornerData.push(corners[k * 2], corners[k * 2 + 1]);
        puffs.push(size, shade, spin);
      }
      index.push(p * 4, p * 4 + 1, p * 4 + 2, p * 4, p * 4 + 2, p * 4 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(centers, 3));
    geometry.setAttribute('center', new THREE.Float32BufferAttribute(centers, 3));
    geometry.setAttribute('corner', new THREE.Float32BufferAttribute(cornerData, 2));
    geometry.setAttribute('puff', new THREE.Float32BufferAttribute(puffs, 3));
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), width + 800);
    const cloud = new THREE.Mesh(geometry, material);
    cloud.position.set(Math.cos(angle) * radius, base, Math.sin(angle) * radius);
    group.add(cloud);
  }
  return group;
}
