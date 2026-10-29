import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import * as THREE from 'three';
import { AIRFRAMES, Airframe } from './sim/airframes';
import { makeJet } from './sim/jet-model';

@Component({
  selector: 'app-aircraft-preview',
  standalone: true,
  template: `<canvas #canvas role="img" [attr.aria-label]="airframe.label + ' aircraft preview'"></canvas>
    @if (error) { <span role="status">{{ error }}</span> }`,
  styles: `:host { display: block; position: relative; }
    canvas { width: 100%; height: 100%; display: block; }
    span { position: absolute; inset: 0; font: 9px monospace; color: #b9c9cf; }`,
})
export class AircraftPreviewComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) airframe: Airframe = AIRFRAMES[0];
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  error = '';
  private renderer?: THREE.WebGLRenderer;
  private observer?: ResizeObserver;
  private model?: THREE.Group;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-15, 15, 10, -10, 0.1, 150);
  private readonly contextLost = (event: Event): void => {
    event.preventDefault();
    this.error = 'Aircraft preview unavailable. Reopen the briefing to retry.';
  };

  ngAfterViewInit(): void {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas.nativeElement, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0, 0);
      this.scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x536270, 3));
      const sun = new THREE.DirectionalLight(0xffedce, 4);
      sun.position.set(-15, 25, -20);
      this.scene.add(sun);
      this.camera.position.set(22, 27, -32);
      this.camera.lookAt(0, 0, 0);
      this.canvas.nativeElement.addEventListener('webglcontextlost', this.contextLost);
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(this.canvas.nativeElement);
      this.updateModel();
    } catch (error: unknown) {
      console.warn('Aircraft preview initialization failed', error);
      this.error = 'Aircraft preview unavailable in this host.';
    }
  }

  ngOnChanges(): void { if (this.renderer) this.updateModel(); }

  private updateModel(): void {
    this.disposeModel();
    this.model = makeJet(false, this.airframe);
    for (const side of [-1, 1]) {
      this.model.getObjectByName(`gear${side}`)!.visible = false;
      this.model.getObjectByName(`exhaust${side}`)!.visible = false;
    }
    this.scene.add(this.model);
    this.draw();
  }

  private draw(): void {
    if (!this.renderer || this.error) return;
    const { clientWidth: width, clientHeight: height } = this.canvas.nativeElement;
    if (!width || !height) return;
    const aspect = width / height;
    const halfHeight = Math.max(10, 12 / aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
  }

  private disposeModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    const materials = new Set<THREE.Material>();
    this.model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      }
    });
    materials.forEach(material => material.dispose());
    this.model = undefined;
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.canvas.nativeElement.removeEventListener('webglcontextlost', this.contextLost);
    this.disposeModel();
    this.renderer?.dispose();
  }
}
