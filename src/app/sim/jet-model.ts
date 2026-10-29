import * as THREE from 'three';
import { AIRFRAMES, Airframe } from './airframes';

type Point = readonly [number, number];
interface Design {
  length: number;
  width: number;
  engine: number;
  canopy: number;
  wing: readonly Point[];
  tail: readonly Point[];
  fin: readonly Point[];
}

const DESIGNS: Record<string, Design> = {
  fa27: { length: 17, width: 1.1, engine: 0.8, canopy: 2,
    wing: [[0, -2.5], [4.8, 1], [4.4, 2.8], [0, 3]],
    tail: [[0, 0], [2.4, 1], [2, 2.5], [0, 2]],
    fin: [[0, 0], [0.8, 2.7], [2.3, 2.4], [3, 0]] },
  f14: { length: 19.1, width: 1.25, engine: 1.15, canopy: 2.9,
    wing: [[0, -1.5], [5.4, 1.6], [5.8, 2.7], [0, 3.2]],
    tail: [[0, 0], [2.8, 1.4], [2.4, 3], [0, 2.5]],
    fin: [[0, 0], [1.1, 3.2], [2.7, 2.9], [3.4, 0]] },
  f15: { length: 19.4, width: 1.2, engine: 0.85, canopy: 2.7,
    wing: [[0, -2.6], [5.4, 0.7], [5.4, 3.2], [0, 3.5]],
    tail: [[0, 0], [2.9, 1.5], [2.8, 3.2], [0, 2.5]],
    fin: [[0, 0], [0.4, 3.6], [2.2, 3.2], [3.1, 0]] },
  f22: { length: 18.9, width: 1.6, engine: 0.85, canopy: 1.9,
    wing: [[0, -3.4], [5.8, 0.3], [5.3, 2.4], [0, 3.6]],
    tail: [[0, 0], [3.1, 1.4], [2.1, 3.6], [0, 2.7]],
    fin: [[0, 0], [1, 2.7], [2.4, 2.3], [3.2, 0]] },
  yf23: { length: 20.6, width: 1.35, engine: 1.5, canopy: 1.8,
    wing: [[0, -4.5], [5.9, 0], [0, 4.3]],
    tail: [[0, 0], [0, 0.1], [0.1, 0.1]],
    fin: [[0, 0], [1.8, 3.7], [4.5, 2.1], [3.8, 0]] },
};

function finish(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.3 });
}

export function makeJet(hostile = false, airframe: Airframe = AIRFRAMES[0]): THREE.Group {
  const design = DESIGNS[airframe.id] ?? DESIGNS.fa27;
  const jet = new THREE.Group();
  jet.name = airframe.id;
  const hull = finish(hostile ? 0x696b71 : airframe.color);
  const edge = finish(hostile ? 0x8c7775 : airframe.id === 'yf23' ? 0x687078 : 0x78838b);
  const dark = finish(0x1b242c);
  const metal = finish(0x45464a);
  const glass = new THREE.MeshStandardMaterial({
    color: airframe.id === 'f22' ? 0x8d7348 : 0x294959, roughness: 0.18, metalness: 0.65,
  });
  const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = jet): THREE.Mesh => {
    const part = new THREE.Mesh(geometry, mat);
    part.position.set(x, y, z);
    parent.add(part);
    return part;
  };
  const panel = (points: readonly Point[], thickness: number, mat: THREE.Material): THREE.Mesh => {
    const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -thickness / 2, 0);
    return new THREE.Mesh(geometry, mat);
  };
  const half = design.length / 2;
  // Elliptical sections give the nose, cockpit shoulders and aft body distinct taper.
  const sections = [
    [-half, 0.025, 0.025], [-half + 1.5, 0.35, 0.3], [-half + 3.8, 0.65, 0.55],
    [-half + 6.5, design.width, 0.65], [1.5, design.width, 0.6],
    [half - 2, design.width * 0.85, 0.5], [half - 0.7, design.width * 0.7, 0.38],
  ];
  const vertices: number[] = [];
  const indices: number[] = [];
  const segments = airframe.id === 'f22' || airframe.id === 'yf23' ? 8 : 16;
  for (const [z, width, height] of sections) {
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      vertices.push(Math.cos(angle) * width, Math.sin(angle) * height, z);
    }
  }
  for (let row = 0; row < sections.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * segments + i, b = row * segments + (i + 1) % segments;
      indices.push(a, b, a + segments, b, b + segments, a + segments);
    }
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  body.setIndex(indices);
  body.computeVertexNormals();
  mesh(body, hull);
  const canopy = mesh(new THREE.SphereGeometry(1, 20, 12), glass, 0, 0.62, -half + 5.2);
  canopy.scale.set(0.58, 0.65, design.canopy);
  const spine = mesh(new THREE.SphereGeometry(1, 12, 8), hull, 0, 0.45, -0.5);
  spine.scale.set(0.7, 0.55, airframe.id === 'f14' ? 3.5 : 2.7);

  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = side < 0 ? 'leftWing' : 'rightWing';
    wing.position.set(side * (airframe.id === 'f14' ? 1.5 : 0.8), 0, 0);
    wing.add(panel(design.wing.map(([x, z]) => [x * side, z]), 0.13, hull));
    jet.add(wing);
    const aileron = new THREE.Group();
    aileron.name = side < 0 ? 'leftAileron' : 'rightAileron';
    aileron.position.set(side * 3.7, 0, 2.1);
    aileron.add(panel([[0, 0], [side * 1.1, -0.15], [side * 1.1, 0.45], [0, 0.65]], 0.07, edge));
    jet.add(aileron);

    const elevator = new THREE.Group();
    elevator.name = side < 0 ? 'leftElevator' : 'rightElevator';
    elevator.position.set(side * 1, 0, half - 4.2);
    if (airframe.id !== 'yf23') elevator.add(panel(design.tail.map(([x, z]) => [x * side, z]), 0.1, hull));
    jet.add(elevator);
    const fin = panel(design.fin, 0.12, hull);
    // Panel local X becomes aft and local Z becomes vertical.
    fin.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    const tail = new THREE.Group();
    tail.position.set(side * (airframe.id === 'yf23' ? 1.6 : 1.1), 0.35, half - 4.5);
    tail.rotation.z = -side * airframe.tail;
    tail.add(fin);
    if (airframe.id === 'yf23') elevator.add(tail);
    else jet.add(tail);
    if (airframe.id === 'yf23') tail.position.z = -0.3;

    const nacelle = mesh(new THREE.CylinderGeometry(0.65, 0.78, half - 0.5, 12), hull,
      side * design.engine, -0.38, half / 2 - 0.1);
    nacelle.rotation.x = Math.PI / 2;
    if (airframe.id === 'f22' || airframe.id === 'yf23') {
      const chine = panel([[0, -4], [side * 1.3, -2.3], [side * 1.8, 3], [0, half - 1]], 0.3, hull);
      chine.position.x = side * 0.7;
      jet.add(chine);
    }
    const intake = mesh(new THREE.BoxGeometry(1.05, 0.85, 1.6), hull, side * (design.engine + 0.2), -0.3, -2.2);
    intake.rotation.y = side * (airframe.id === 'f22' ? -0.25 : -0.08);
    const mouth = mesh(new THREE.PlaneGeometry(0.85, 0.65), dark, side * (design.engine + 0.2), -0.3, -3.02);
    mouth.rotation.y = Math.PI;
    if (airframe.id === 'f22') {
      mesh(new THREE.BoxGeometry(1.35, 0.5, 1.3), metal, side * design.engine, -0.25, half - 0.5);
      mesh(new THREE.BoxGeometry(1.1, 0.26, 0.05), dark, side * design.engine, -0.25, half + 0.17);
    } else if (airframe.id === 'yf23') {
      mesh(new THREE.BoxGeometry(1.25, 0.12, 2.7), metal, side * design.engine, -0.05, half - 1.2);
      mesh(new THREE.BoxGeometry(0.95, 0.25, 0.3), dark, side * design.engine, -0.2, half - 1.3);
    } else {
      mesh(new THREE.CylinderGeometry(0.57, 0.67, 1.2, 16, 1, true), metal,
        side * design.engine, -0.38, half - 0.8).rotation.x = Math.PI / 2;
      const nozzle = mesh(new THREE.CircleGeometry(0.5, 16), dark, side * design.engine, -0.38, half - 0.18);
      nozzle.rotation.y = 0;
    }
    const flame = mesh(new THREE.ConeGeometry(0.4, 2.7, 10), new THREE.MeshBasicMaterial({ color: 0xffaa55 }),
      side * design.engine, -0.38, half + 1.2);
    flame.name = `exhaust${side}`;
    flame.rotation.x = Math.PI / 2;
    const gear = new THREE.Group();
    gear.name = `gear${side}`;
    gear.position.set(side * 1.1, -0.4, 1.3);
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.35, 8), metal, 0, -0.7, 0, gear);
    mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), dark, 0, -1.45, 0, gear).rotation.z = Math.PI / 2;
    jet.add(gear);
    const light = mesh(new THREE.SphereGeometry(0.08, 6, 4),
      new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3333 : 0x55ff88 }), side * 6, 0, 1.4);
    light.name = `navigation${side}`;
  }
  const rudder = new THREE.Group();
  rudder.name = 'rudder';
  const rudderSurface = panel([[0, 0], [0.2, 1.8], [0.8, 1.6], [0.8, 0]], 0.08, edge);
  rudderSurface.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
  rudder.position.set(1.1, 0.4, half - 2);
  rudder.rotation.z = -airframe.tail;
  rudder.add(rudderSurface);
  if (airframe.id === 'yf23') rudder.visible = false;
  jet.add(rudder);
  return jet;
}
