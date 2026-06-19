import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import type { FieldDefinition, Pose, Vector2 } from '@ftc-sim/field';
import { FIELD_SIZE_INCHES } from '@ftc-sim/field';
import type { PathChain } from '@ftc-sim/pedro';
import { pathChainToPoints } from '@ftc-sim/pedro';

const BASE_SCALE = 5;
const FIELD_PX = FIELD_SIZE_INCHES * BASE_SCALE;
const VISUAL_SIZE = 141.5;
const VISUAL_SCALE = VISUAL_SIZE / FIELD_SIZE_INCHES;
const VISUAL_PX = VISUAL_SIZE * BASE_SCALE;

export interface RenderArtifact {
  id: string;
  color: 'purple' | 'green';
  pose: Pose;
  held?: boolean;
}

export interface FieldRendererOptions {
  showDebug?: boolean;
  showVelocity?: boolean;
  showSensors?: boolean;
  showIntakeZone?: boolean;
  showHitboxes?: boolean;
  showShotArc?: boolean;
  shotTrajectory?: Vector2[];
  pathError?: number;
}

export class FieldRenderer {
  app: Application;
  private camera = new Container();
  private fieldLayer = new Container();
  private pathLayer = new Container();
  private artifactLayer = new Container();
  private robotLayer = new Container();
  private debugLayer = new Container();
  private trailLayer = new Container();
  private overlayLayer = new Container();
  private trails = new Map<string, Pose[]>();
  private fieldSprite: Sprite | null = null;
  private robotSprite: Sprite | null = null;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private readyPromise: Promise<void>;

  constructor(canvas: HTMLCanvasElement, width = 720, height = 720) {
    this.app = new Application();
    this.readyPromise = this.init(canvas, width, height);
  }

  private async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    await this.app.init({
      canvas,
      width,
      height,
      backgroundColor: 0x0f1419,
      antialias: true,
    });
    this.app.stage.addChild(this.camera);
    this.camera.addChild(this.fieldLayer);
    this.camera.addChild(this.pathLayer);
    this.camera.addChild(this.artifactLayer);
    this.camera.addChild(this.trailLayer);
    this.camera.addChild(this.robotLayer);
    this.camera.addChild(this.debugLayer);
    this.camera.addChild(this.overlayLayer);

    try {
      const [fieldTex, robotTex] = await Promise.all([
        Assets.load('/assets/decode.webp'),
        Assets.load('/assets/robot.png'),
      ]);
      this.fieldSprite = new Sprite(fieldTex);
      this.fieldSprite.width = VISUAL_PX;
      this.fieldSprite.height = VISUAL_PX;
      this.fieldSprite.x = 0;
      this.fieldSprite.y = 0;
      this.fieldLayer.addChild(this.fieldSprite);

      this.robotSprite = new Sprite(robotTex);
      this.robotLayer.addChild(this.robotSprite);
    } catch {
      this.drawFallbackField();
    }
    this.centerCamera();
  }

  private drawFallbackField(): void {
    const g = new Graphics();
    g.rect(0, 0, VISUAL_PX, VISUAL_PX);
    g.fill(0x1a472a);
    this.fieldLayer.addChild(g);
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  private toPx(p: { x: number; y: number }): { x: number; y: number } {
    const vx = p.x * VISUAL_SCALE;
    const vy = p.y * VISUAL_SCALE;
    return { x: vx * BASE_SCALE, y: VISUAL_PX - vy * BASE_SCALE };
  }

  private centerCamera(): void {
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    this.camera.position.set(cx + this.panX, cy + this.panY);
    this.camera.scale.set(this.zoom);
    this.camera.pivot.set(VISUAL_PX / 2, VISUAL_PX / 2);
  }

  setZoom(z: number): void {
    this.zoom = Math.max(0.4, Math.min(3, z));
    this.centerCamera();
  }

  adjustZoom(delta: number): void {
    this.setZoom(this.zoom + delta);
  }

  pan(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.centerCamera();
  }

  drawField(field: FieldDefinition, opts: FieldRendererOptions = {}): void {
    if (this.fieldSprite) return;
    this.fieldLayer.removeChildren();
    const g = new Graphics();
    for (const body of field.bodies) {
      if (body.shape === 'polygon' && body.vertices) {
        const pts = body.vertices.map((p) => this.toPx(p));
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fill({ color: 0x64748b, alpha: 0.35 });
        g.stroke({ width: 1, color: 0x94a3b8, alpha: 0.5 });
      }
    }
    if (opts.showDebug) {
      for (const zone of field.zones) {
        if (zone.polygon.length < 3) continue;
        const pts = zone.polygon.map((p) => this.toPx(p));
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.stroke({ width: 1, color: 0xfbbf24, alpha: 0.4 });
      }
    }
    this.fieldLayer.addChild(g);
  }

  drawArtifacts(artifacts: RenderArtifact[]): void {
    this.artifactLayer.removeChildren();
    for (const a of artifacts) {
      const px = this.toPx(a.pose);
      const g = new Graphics();
      const color = a.color === 'purple' ? 0xa855f7 : 0x22c55e;
      g.circle(px.x, px.y, 2.5 * BASE_SCALE);
      g.fill({ color, alpha: a.held ? 0.6 : 1 });
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.3 });
      this.artifactLayer.addChild(g);
    }
  }

  drawRobot(
    robotId: string,
    pose: Pose,
    widthIn = 18,
    lengthIn = 18,
    opts: FieldRendererOptions = {},
  ): void {
    const px = this.toPx(pose);
    if (this.robotSprite) {
      this.robotSprite.width = widthIn * BASE_SCALE;
      this.robotSprite.height = lengthIn * BASE_SCALE;
      this.robotSprite.anchor.set(0.5);
      this.robotSprite.position.set(px.x, px.y);
      this.robotSprite.rotation = -pose.heading;
    } else {
      this.robotLayer.removeChildren();
      const g = new Graphics();
      g.rect(-(widthIn * BASE_SCALE) / 2, -(lengthIn * BASE_SCALE) / 2, widthIn * BASE_SCALE, lengthIn * BASE_SCALE);
      g.fill({ color: 0xef4444, alpha: 0.85 });
      g.stroke({ width: 2, color: 0xffffff });
      g.position.set(px.x, px.y);
      g.rotation = -pose.heading;
      this.robotLayer.addChild(g);
    }

    const trail = this.trails.get(robotId) ?? [];
    trail.push({ ...pose });
    if (trail.length > 300) trail.shift();
    this.trails.set(robotId, trail);

    this.debugLayer.removeChildren();
    if (opts.showVelocity) {
      const g = new Graphics();
      g.moveTo(px.x, px.y);
      g.lineTo(px.x + Math.cos(pose.heading) * 30, px.y - Math.sin(pose.heading) * 30);
      g.stroke({ width: 2, color: 0x38bdf8 });
      this.debugLayer.addChild(g);
    }
    if (opts.showShotArc && opts.shotTrajectory?.length) {
      const g = new Graphics();
      const pts = opts.shotTrajectory.map((p) => this.toPx(p));
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.stroke({ width: 2, color: 0xf97316, alpha: 0.8 });
      this.debugLayer.addChild(g);
    }
    if (opts.pathError != null) {
      const t = new Text({ text: `err ${opts.pathError.toFixed(2)} in`, style: { fill: 0xffffff, fontSize: 11 } });
      t.position.set(px.x + 20, px.y - 20);
      this.debugLayer.addChild(t);
    }
  }

  drawPath(path: PathChain, color = 0xffc516): void {
    this.pathLayer.removeChildren();
    const points = pathChainToPoints(path, 80);
    if (points.length < 2) return;
    const g = new Graphics();
    const p0 = this.toPx(points[0]);
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = this.toPx(points[i]);
      g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 3, color, alpha: 0.9 });
    this.pathLayer.addChild(g);
  }

  drawActualPath(robotId: string, color = 0x60a5fa): void {
    const trail = this.trails.get(robotId);
    if (!trail || trail.length < 2) return;
    const g = new Graphics();
    const p0 = this.toPx(trail[0]);
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i < trail.length; i++) {
      const p = this.toPx(trail[i]);
      g.lineTo(p.x, p.y);
    }
    g.stroke({ width: 2, color, alpha: 0.6 });
    this.overlayLayer.addChild(g);
  }

  clearTrails(): void {
    this.trails.clear();
    this.trailLayer.removeChildren();
    this.overlayLayer.removeChildren();
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
