import * as THREE from 'three';
import { Aircraft, clamp } from './flight';
import { Combat, MissileStrike } from './combat';
import { AIRFRAMES } from './airframes';
import { makeJet } from './jet-model';
import { SKY_HORIZON, createClouds, createSky, createTerrain, createTrees } from './scenery';
export { makeJet } from './jet-model';

export interface ScreenTarget { id: number; x: number; y: number; visible: boolean; selected: boolean; range: number; }

interface StrikeVisual {
  group: THREE.Group;
  scorch: THREE.Mesh;
  flash: THREE.Mesh;
  flame: THREE.Mesh;
  smoke: THREE.Mesh;
  materials: THREE.MeshBasicMaterial[];
}

interface ExplosionVisual {
  group: THREE.Group;
  core: THREE.Mesh;
  fireball: THREE.Mesh;
  shockwave: THREE.Mesh;
  smoke: THREE.Mesh;
  materials: THREE.MeshBasicMaterial[];
}

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
  private readonly strikeVisuals = new Map<number, StrikeVisual>();
  private readonly explosionVisuals = new Map<number, ExplosionVisual>();
  private readonly projectileGeometry = new THREE.SphereGeometry(1, 5, 4);
  private readonly explosionGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly blastGeometry = new THREE.SphereGeometry(1, 14, 10);
  private readonly shockwaveGeometry = new THREE.TorusGeometry(1, 0.08, 6, 32);
  private readonly scorchGeometry = new THREE.CircleGeometry(1, 16);
  private readonly strikeGeometry = new THREE.IcosahedronGeometry(1, 1);
  private readonly flameGeometry = new THREE.ConeGeometry(1, 1, 8);
  private readonly effectMaterials: Record<string, THREE.MeshBasicMaterial> = {
    missile: new THREE.MeshBasicMaterial({ color: 0xffdc9a }),
    hostile: new THREE.MeshBasicMaterial({ color: 0xff7254 }),
    bullet: new THREE.MeshBasicMaterial({ color: 0xfff0a3 }),
    flare: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    explosion: new THREE.MeshBasicMaterial({ color: 0xff9858, transparent: true, opacity: 0.8 }),
  };
  private readonly resizeObserver: ResizeObserver;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly sky = createSky();
  private lostHandler: (event: Event) => void;

  constructor(private canvas: HTMLCanvasElement, onContextLost: () => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 800 ? 1.25 : 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(SKY_HORIZON);
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.scene.fog = new THREE.FogExp2(SKY_HORIZON, 0.000035);
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x4c5a36, 2.4));
    const sun = new THREE.DirectionalLight(0xffe6bc, 3);
    sun.position.set(-5000, 9000, -6000);
    this.scene.add(sun);
    this.scene.add(createTerrain(), createTrees());
    this.createAirbase();
    this.scene.add(createClouds());
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

  get acquisitionRadius(): number {
    return this.canvas.clientHeight * Math.tan(9 * Math.PI / 180) / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }

  private createStrikeVisual(): StrikeVisual {
    const makeMaterial = (color: number, opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const materials = [
      makeMaterial(0x171613, 0.55),
      makeMaterial(0xfff0a0, 0.9),
      makeMaterial(0xff641c, 0.9),
      makeMaterial(0x34302b, 0.25),
    ];
    const group = new THREE.Group();
    const scorch = new THREE.Mesh(this.scorchGeometry, materials[0]);
    const flash = new THREE.Mesh(this.strikeGeometry, materials[1]);
    const flame = new THREE.Mesh(this.flameGeometry, materials[2]);
    const smoke = new THREE.Mesh(this.strikeGeometry, materials[3]);
    group.add(scorch, flash, flame, smoke);
    this.scene.add(group);
    return { group, scorch, flash, flame, smoke, materials };
  }

  private createExplosionVisual(): ExplosionVisual {
    const makeMaterial = (color: number, opacity: number): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const materials = [
      makeMaterial(0xfff3c4, 0.95),
      makeMaterial(0xff8129, 0.9),
      makeMaterial(0xffdca0, 0.75),
      makeMaterial(0x302a27, 0.4),
    ];
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.blastGeometry, materials[0]);
    const fireball = new THREE.Mesh(this.explosionGeometry, materials[1]);
    const shockwave = new THREE.Mesh(this.shockwaveGeometry, materials[2]);
    const smoke = new THREE.Mesh(this.blastGeometry, materials[3]);
    group.add(shockwave, fireball, core, smoke);
    this.scene.add(group);
    return { group, core, fireball, shockwave, smoke, materials };
  }

  private renderExplosion(visual: ExplosionVisual, effect: Combat['explosions'][number]): void {
    const age = clamp(1 - effect.life / effect.duration, 0, 1);
    const power = effect.intensity;
    visual.group.position.copy(effect.position);
    visual.core.scale.setScalar((3 + age * 19) * power);
    visual.materials[0].opacity = 0.98 * (1 - age) ** 2;
    visual.fireball.scale.setScalar((7 + age * 48) * power);
    visual.materials[1].opacity = 0.9 * (1 - age) ** 1.35;
    visual.shockwave.scale.setScalar((5 + age * 110) * power);
    visual.materials[2].opacity = 0.8 * Math.sin(Math.PI * age) ** 0.7;
    visual.smoke.scale.set(8 + age * 34, 7 + age * 28, 8 + age * 34).multiplyScalar(power);
    visual.smoke.position.y = age * 12;
    visual.materials[3].opacity = 0.48 * clamp((age - 0.12) * 2.4, 0, 1) * (1 - age) ** 0.6;
  }

  private renderMissileStrike(visual: StrikeVisual, strike: MissileStrike, position: THREE.Vector3, attitude: THREE.Quaternion): void {
    const age = clamp(1 - strike.life / strike.duration, 0, 1);
    const normal = strike.localNormal;
    visual.group.position.copy(strike.localPosition).applyQuaternion(attitude).add(position);
    visual.group.quaternion.copy(attitude);

    visual.scorch.position.copy(normal).multiplyScalar(0.12);
    visual.scorch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    visual.scorch.scale.setScalar(0.8 + age * 1.5);
    visual.materials[0].opacity = 0.55 * (1 - age);

    visual.flash.position.copy(normal).multiplyScalar(0.35);
    visual.flash.scale.setScalar(1.2 + age * 7);
    visual.materials[1].opacity = age < 0.2 ? 0.9 * (1 - age / 0.2) : 0;
    visual.flash.visible = visual.materials[1].opacity > 0.01;

    visual.flame.position.copy(normal).multiplyScalar(1.1 + age);
    visual.flame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    visual.flame.scale.set(1.1 + age, 1.8 + age * 2.8, 1.1 + age);
    visual.materials[2].opacity = 0.9 * (1 - age) ** 1.3;

    visual.smoke.position.copy(normal).multiplyScalar(2 + age * 2)
      .addScaledVector(strike.localTrail, age * 8);
    visual.smoke.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), strike.localTrail);
    visual.smoke.scale.set(0.7 + age * 1.8, 1 + age * 3.2, 0.7 + age * 1.8);
    visual.materials[3].opacity = 0.3 * Math.sin(Math.PI * age);
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
    this.sky.position.copy(this.cameraPosition);
    const active = new Set<number>();
    const burningBogeys = new Set<number>();
    for (const strike of combat.strikes) {
      if (typeof strike.target === 'number') burningBogeys.add(strike.target);
    }
    for (const bogey of combat.bogeys) {
      if (bogey.health <= 0 && !burningBogeys.has(bogey.id)) continue;
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
    const effects = combat.projectiles.map(effect => ({ effect, kind: effect.kind }));
    for (const { effect, kind } of effects) {
      active.add(effect.id);
      let mesh = this.effectMeshes.get(effect.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.projectileGeometry, this.effectMaterials[kind]);
        this.effectMeshes.set(effect.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.copy(effect.position);
      const size = kind === 'bullet' ? 1.1 : kind === 'flare' ? 2.6 : 2.0;
      mesh.scale.setScalar(size);
    }
    for (const [id, mesh] of this.effectMeshes) {
      if (!active.has(id)) { this.scene.remove(mesh); this.effectMeshes.delete(id); }
    }
    const activeStrikes = new Set<number>();
    for (const strike of combat.strikes) {
      const bogey = strike.target === 'player' ? undefined : combat.bogeys.find(item => item.id === strike.target);
      if (strike.target !== 'player' && !bogey) continue;
      const position = strike.target === 'player' ? aircraft.position : bogey!.position;
      const attitude = strike.target === 'player' ? aircraft.attitude
        : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), bogey!.forward);
      activeStrikes.add(strike.id);
      let visual = this.strikeVisuals.get(strike.id);
      if (!visual) {
        visual = this.createStrikeVisual();
        this.strikeVisuals.set(strike.id, visual);
      }
      this.renderMissileStrike(visual, strike, position, attitude);
    }
    for (const [id, visual] of this.strikeVisuals) {
      if (!activeStrikes.has(id)) {
        this.scene.remove(visual.group);
        visual.materials.forEach(effectMaterial => effectMaterial.dispose());
        this.strikeVisuals.delete(id);
      }
    }
    const activeExplosions = new Set<number>();
    for (const explosion of combat.explosions) {
      activeExplosions.add(explosion.id);
      let visual = this.explosionVisuals.get(explosion.id);
      if (!visual) {
        visual = this.createExplosionVisual();
        this.explosionVisuals.set(explosion.id, visual);
      }
      this.renderExplosion(visual, explosion);
    }
    for (const [id, visual] of this.explosionVisuals) {
      if (!activeExplosions.has(id)) {
        this.scene.remove(visual.group);
        visual.materials.forEach(effectMaterial => effectMaterial.dispose());
        this.explosionVisuals.delete(id);
      }
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
          if (mat instanceof THREE.ShaderMaterial) (mat.uniforms['map']?.value as THREE.Texture | null)?.dispose();
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
    this.blastGeometry.dispose();
    this.shockwaveGeometry.dispose();
    this.scorchGeometry.dispose();
    this.strikeGeometry.dispose();
    this.flameGeometry.dispose();
    for (const visual of this.strikeVisuals.values()) visual.materials.forEach(effectMaterial => effectMaterial.dispose());
    for (const visual of this.explosionVisuals.values()) visual.materials.forEach(effectMaterial => effectMaterial.dispose());
    Object.values(this.effectMaterials).forEach(mat => mat.dispose());
    this.renderer.dispose();
  }
}
