import * as THREE from 'three';
import { Aircraft, clamp, terrainHeight } from './flight';
import { Combat } from './combat';
import { AIRFRAMES } from './airframes';
import { makeJet } from './jet-model';
export { makeJet } from './jet-model';

export interface ScreenTarget { id: number; x: number; y: number; visible: boolean; selected: boolean; range: number; }

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.20 });
}

export class FlightRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.5, 65000);
  readonly renderer: THREE.WebGLRenderer;
  player = makeJet();
  private playerAirframe = AIRFRAMES[0];
  cockpit = false;
  private readonly enemyMeshes = new Map<number, THREE.Group>();
  private readonly effectMeshes = new Map<number, THREE.Mesh>();
  private readonly projectileGeometry = new THREE.SphereGeometry(1, 5, 4);
  private readonly explosionGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly effectMaterials: Record<string, THREE.MeshBasicMaterial> = {
    missile: new THREE.MeshBasicMaterial({ color: 0xffdc9a }),
    hostile: new THREE.MeshBasicMaterial({ color: 0xff7254 }),
    bullet: new THREE.MeshBasicMaterial({ color: 0xfff0a3 }),
    flare: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    explosion: new THREE.MeshBasicMaterial({ color: 0xff9858, transparent: true, opacity: 0.8 }),
  };
  private readonly resizeObserver: ResizeObserver;
  private readonly cameraPosition = new THREE.Vector3();
  private lostHandler: (event: Event) => void;

  constructor(private canvas: HTMLCanvasElement, onContextLost: () => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.25 : 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xa6c8d2);
    this.scene.background = new THREE.Color(0xa6c8d2);
    this.scene.fog = new THREE.FogExp2(0xa6c8d2, 0.000035);
    this.scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x4c5a36, 2.4));
    const sun = new THREE.DirectionalLight(0xffe6bc, 3);
    sun.position.set(-5000, 9000, -6000);
    this.scene.add(sun);
    this.createTerrain();
    this.createAirbase();
    this.createClouds();
    this.scene.add(this.player);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.lostHandler = (event: Event): void => { event.preventDefault(); onContextLost(); };
    canvas.addEventListener('webglcontextlost', this.lostHandler);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height;
    const hudCenter = Number.parseFloat(getComputedStyle(this.canvas.parentElement!).getPropertyValue('--hud-center')) / 100;
    this.camera.setViewOffset(width, height, 0, height * (0.5 - hudCenter), width, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private createTerrain(): void {
    const geometry = new THREE.PlaneGeometry(80000, 80000, 180, 180);
    geometry.rotateX(-Math.PI / 2);
    const vertices = geometry.attributes['position'];
    const colors = new Float32Array(vertices.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i);
      const height = terrainHeight(x, z);
      vertices.setY(i, height - 0.1);
      const patch = Math.sin(x / 550) * Math.cos(z / 650);
      color.setHSL(0.20 + patch * 0.025, 0.17 + patch * 0.05, 0.27 + height / 3500 + patch * 0.035);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
    const grid = new THREE.GridHelper(6000, 60, 0x7f8b71, 0x7f8b71);
    grid.position.y = 0.15;
    grid.material.transparent = true;
    grid.material.opacity = 0.20;
    this.scene.add(grid);
  }

  private box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    return mesh;
  }

  private createAirbase(): void {
    this.box(100, 0.10, 3400, 0, 0, 0, 0x8c8f7e);
    this.box(76, 0.12, 3200, 0, 0.08, 0, 0x353e42);
    for (let z = -1500; z < 1600; z += 95) this.box(1.8, 0.1, 40, 0, 0.2, z, 0xe8e5ca);
    for (const side of [-1, 1]) {
      this.box(0.9, 0.1, 3100, side * 34, 0.20, 0, 0xe8e5ca);
      for (let i = 0; i < 6; i++) this.box(3, 0.1, 70, side * (7 + i * 4.5), 0.21, 1480, 0xf0eee0);
      for (let i = 0; i < 6; i++) this.box(3, 0.1, 70, side * (7 + i * 4.5), 0.21, -1480, 0xf0eee0);
      for (let z = -1550; z <= 1550; z += 100) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshBasicMaterial({ color: 0xa2e9ed }));
        lamp.position.set(side * 39, 1, z);
        this.scene.add(lamp);
      }
    }
    this.box(160, 0.12, 800, 180, 0.10, 450, 0x666d68);
    this.box(90, 0.12, 45, 80, 0.10, 550, 0x666d68);
    for (let i = 0; i < 5; i++) {
      this.box(60, 20, 80, 300, 10, i * 150 + 150, 0x828d89);
      this.box(64, 4, 84, 300, 22, i * 150 + 150, 0x485c5d);
    }
    this.box(15, 52, 15, 140, 26, -100, 0xaab8b6);
    this.box(32, 12, 25, 140, 56, -100, 0x354f59);
    this.box(35, 2, 28, 140, 63, -100, 0x8a9e9c);
    // Approach-light bars and PAPI-like color references, not a certified glide-slope system.
    for (let i = 0; i < 7; i++) this.box(15, 0.3, 2, 0, 0.3, 1700 + i * 50, 0xdad7b0);
    this.runwayNumber('36', 1270, 0);
    this.runwayNumber('18', -1270, Math.PI);
  }

  private runwayNumber(text: string, z: number, rotation: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable for runway markings.');
    context.fillStyle = '#e8e5ca';
    context.font = 'bold 160px monospace';
    context.textAlign = 'center';
    context.fillText(text, 128, 180);
    const geometry = new THREE.PlaneGeometry(32, 50);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    mesh.position.set(0, 0.24, z);
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
  }

  private createClouds(): void {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xe1e9e5, transparent: true, opacity: 0.45, depthWrite: false });
    for (let i = 0; i < 36; i++) {
      const angle = i * 2.39996;
      const radius = 8500 + (i % 7) * 2500;
      const cloud = new THREE.Mesh(geometry, cloudMaterial);
      cloud.position.set(Math.cos(angle) * radius, 4200 + (i % 4) * 500, Math.sin(angle) * radius);
      cloud.scale.set(1600 + (i % 3) * 600, 170, 700);
      this.scene.add(cloud);
    }
  }

  get acquisitionRadius(): number {
    return this.canvas.clientHeight * Math.tan(9 * Math.PI / 180) / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }

  draw(aircraft: Aircraft, combat: Combat): ScreenTarget[] {
    if (this.playerAirframe !== aircraft.airframe) {
      this.scene.remove(this.player);
      this.disposeObject(this.player);
      this.player = makeJet(false, aircraft.airframe);
      this.playerAirframe = aircraft.airframe;
      this.scene.add(this.player);
    }
    this.player.position.copy(aircraft.position);
    this.player.quaternion.copy(aircraft.attitude);
    this.player.visible = !this.cockpit && aircraft.phase !== 'crashed';
    const elevator = aircraft.surfaces.elevator;
    this.player.getObjectByName('leftElevator')!.rotation.x = -elevator;
    this.player.getObjectByName('rightElevator')!.rotation.x = -elevator;
    this.player.getObjectByName('leftAileron')!.rotation.x = -aircraft.surfaces.aileron;
    this.player.getObjectByName('rightAileron')!.rotation.x = aircraft.surfaces.aileron;
    this.player.getObjectByName('rudder')!.rotation.y = aircraft.surfaces.rudder;
    for (const side of [-1, 1]) {
      this.player.getObjectByName(`gear${side}`)!.visible = aircraft.gear;
      const exhaust = this.player.getObjectByName(`exhaust${side}`)!;
      exhaust.visible = aircraft.controls.throttle > 0.3 && aircraft.fuel > 0;
      exhaust.scale.y = 0.25 + aircraft.controls.throttle ** 4 * (1.3 + Math.sin(combat.time * 55) * 0.15);
    }
    this.cameraPosition.set(0, this.cockpit ? 1.2 : 5, this.cockpit ? -3 : 24)
      .applyQuaternion(aircraft.attitude).add(aircraft.position);
    this.camera.position.copy(this.cameraPosition);
    this.camera.quaternion.copy(aircraft.attitude);
    const active = new Set<number>();
    for (const bogey of combat.bogeys) {
      if (bogey.health <= 0) continue;
      active.add(bogey.id);
      let jet = this.enemyMeshes.get(bogey.id);
      if (!jet) {
        jet = makeJet(true);
        this.enemyMeshes.set(bogey.id, jet);
        this.scene.add(jet);
      }
      jet.position.copy(bogey.position);
      jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), bogey.forward);
    }
    for (const [id, jet] of this.enemyMeshes) {
      if (!active.has(id)) { this.scene.remove(jet); this.disposeObject(jet); this.enemyMeshes.delete(id); }
    }
    active.clear();
    const effects = [
      ...combat.projectiles.map(effect => ({ effect, kind: effect.kind })),
      ...combat.explosions.map(effect => ({ effect, kind: 'explosion' })),
    ];
    for (const { effect, kind } of effects) {
      active.add(effect.id);
      let mesh = this.effectMeshes.get(effect.id);
      if (!mesh) {
        mesh = new THREE.Mesh(kind === 'explosion' ? this.explosionGeometry : this.projectileGeometry, this.effectMaterials[kind]);
        this.effectMeshes.set(effect.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.copy(effect.position);
      const size = kind === 'explosion' ? Math.max(1, (1.6 - effect.life) * 35) : kind === 'bullet' ? 1.1 : kind === 'flare' ? 2.6 : 2.0;
      mesh.scale.setScalar(size);
    }
    for (const [id, mesh] of this.effectMeshes) {
      if (!active.has(id)) { this.scene.remove(mesh); this.effectMeshes.delete(id); }
    }
    this.renderer.render(this.scene, this.camera);
    return combat.alive.map(bogey => {
      const screen = bogey.position.clone().project(this.camera);
      return {
        id: bogey.id, x: (screen.x + 1) * 50, y: (1 - screen.y) * 50,
        visible: screen.z > -1 && screen.z < 1 && Math.abs(screen.x) < 0.92 && Math.abs(screen.y) < 0.85,
        selected: combat.selected === bogey.id,
        range: aircraft.position.distanceTo(bogey.position),
      };
    });
  }

  projectVelocity(aircraft: Aircraft): { x: number; y: number; visible: boolean } {
    const point = aircraft.position.clone().addScaledVector(aircraft.velocity.clone().normalize(), 2500).project(this.camera);
    return { x: clamp((point.x + 1) * 50, 5, 95), y: clamp((1 - point.y) * 50, 12, 88), visible: point.z < 1 && aircraft.airspeed > 20 };
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const mat of materials) {
          if (mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshStandardMaterial) mat.map?.dispose();
          mat.dispose();
        }
      }
    });
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.lostHandler);
    this.disposeObject(this.scene);
    this.projectileGeometry.dispose();
    this.explosionGeometry.dispose();
    Object.values(this.effectMaterials).forEach(mat => mat.dispose());
    this.renderer.dispose();
  }
}
