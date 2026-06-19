import { useCallback, useEffect, useRef, useState } from 'react';
import type { MatchAnalytics, PedroJsonFile, TelemetryFrame } from '@ftc-sim/core';
import { FieldRenderer } from './field-renderer';

type SimCore = typeof import('@ftc-sim/core');

const EXAMPLE_PATH: PedroJsonFile = {
  version: '1.0',
  coordinateSystem: 'pedro',
  paths: [
    {
      type: 'BezierLine',
      startPoint: { x: 132, y: 10 },
      endPoint: { x: 132, y: 48 },
      headingInterpolation: { mode: 'linear', startHeading: Math.PI / 2, endHeading: Math.PI / 2, endTime: 0.6 },
    },
    {
      type: 'BezierCurve',
      startPoint: { x: 132, y: 48 },
      controlPoint1: { x: 108, y: 54 },
      controlPoint2: { x: 84, y: 54 },
      endPoint: { x: 72, y: 48 },
      headingInterpolation: { mode: 'tangent' },
    },
  ],
};

export function App() {
  const rendererRef = useRef<FieldRenderer | null>(null);
  const engineRef = useRef<InstanceType<SimCore['SimulationEngine']> | null>(null);
  const coreRef = useRef<SimCore | null>(null);
  const replayPlayerRef = useRef<InstanceType<SimCore['ReplayPlayer']> | null>(null);
  const rafRef = useRef<number>(0);
  const unbindInputRef = useRef<(() => void) | null>(null);

  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [initState, setInitState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initError, setInitError] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryFrame | null>(null);
  const [phase, setPhase] = useState('setup');
  const [phaseTime, setPhaseTime] = useState(0);
  const [score, setScore] = useState(0);
  const [mode, setMode] = useState<'auto' | 'teleop'>('auto');
  const [showDebug, setShowDebug] = useState(false);
  const [showVelocity, setShowVelocity] = useState(true);
  const [showShotArc, setShowShotArc] = useState(true);
  const [showActualPath, setShowActualPath] = useState(true);
  const [pathLoaded, setPathLoaded] = useState(false);
  const [replayMode, setReplayMode] = useState(false);
  const [replayFrame, setReplayFrame] = useState(0);
  const [analytics, setAnalytics] = useState<MatchAnalytics | null>(null);
  const [inventory, setInventory] = useState(0);
  const [events, setEvents] = useState<string[]>([]);

  const initEngine = useCallback(async (canvas: HTMLCanvasElement, signal: { cancelled: boolean }) => {
    setInitState('loading');
    setInitError(null);
    try {
      const core = coreRef.current ?? (await import('@ftc-sim/core'));
      if (signal.cancelled) return;
      coreRef.current = core;

      const renderer = new FieldRenderer(canvas);
      await renderer.ready();
      if (signal.cancelled) {
        renderer.destroy();
        return;
      }

      const engine = new core.SimulationEngine();
      const replayPlayer = new core.ReplayPlayer();
      await engine.init();
      if (signal.cancelled) {
        renderer.destroy();
        return;
      }
      engine.loadScenario({
        field: 'decode',
        robots: [{ id: 'robot1', pose: core.getDecodeField().startPoses.red_near, alliance: 'red' }],
        duration: 158,
        seed: 42,
      });
      await engine.reset(42);
      engine.loadPathFromJson('robot1', EXAMPLE_PATH);
      engine.startRecording();
      engine.startReplayRecording();
        engine.on('tick', (frame) => {
          setTelemetry(frame as TelemetryFrame);
          const st = engine.getState();
          const match = engine.getMatchState();
          setPhase(st.phase);
          setPhaseTime(match?.timeRemainingInPhase ?? 0);
          setScore(st.score);
          setMode(st.controlSource === 'human' ? 'teleop' : st.controlSource === 'autonomous' ? 'auto' : 'auto');
          setInventory(st.robots.robot1?.mechanismState?.stored?.length ?? 0);
        });
      const unbind = engine.getInputManager().bindKeyboard();

      if (signal.cancelled) {
        unbind();
        renderer.destroy();
        return;
      }

      rendererRef.current = renderer;
      engineRef.current = engine;
      replayPlayerRef.current = replayPlayer;
      unbindInputRef.current = unbind;

      renderer.drawField(engine.getField(), { showDebug });
      setInitState('ready');
      if (typeof window !== 'undefined') {
        (window as unknown as { __ftcSim?: unknown }).__ftcSim = {
          engine,
          snapshot: () => {
            const st = engine.getState();
            const pose = st.robots.robot1?.truthPose;
            const vel = st.robots.robot1?.velocity;
            return {
              phase: st.phase,
              time: st.time,
              phaseTime: engine.getMatchState()?.timeRemainingInPhase,
              pose,
              speed: vel ? Math.hypot(vel.x, vel.y) : 0,
              velocity: vel,
              controlSource: st.controlSource,
            };
          },
        };
      }
      canvas.parentElement?.focus();
    } catch (e) {
      if (signal.cancelled) return;
      setInitError(e instanceof Error ? e.message : String(e));
      setInitState('error');
    }
  }, [showDebug]);

  useEffect(() => {
    if (!canvasEl) return;

    const signal = { cancelled: false };
    void initEngine(canvasEl, signal);

    return () => {
      signal.cancelled = true;
      unbindInputRef.current?.();
      unbindInputRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
      engineRef.current = null;
      replayPlayerRef.current = null;
    };
  }, [canvasEl, retryKey, initEngine]);

  useEffect(() => {
    if (initState === 'ready' && rendererRef.current && engineRef.current) {
      rendererRef.current.drawField(engineRef.current.getField(), { showDebug });
    }
  }, [showDebug, initState]);

  useEffect(() => {
    return () => {
      unbindInputRef.current?.();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const loop = () => {
      const engine = engineRef.current;
      const renderer = rendererRef.current;
      if (engine && renderer && !replayMode) {
        engine.update();
        const state = engine.getState();
        const truth = state.robots.robot1?.truthPose;
        if (truth) {
          const artifacts = [...engine.getArtifacts().values()].map((a) => ({
            id: a.id,
            color: a.color,
            pose: a.held ? truth : engine.getPhysics().getBodyPose(a.bodyId),
            held: a.held,
          }));
          renderer.drawArtifacts(artifacts);
          const mech = state.robots.robot1?.mechanismState;
          renderer.drawRobot('robot1', truth, 18, 18, {
            showVelocity,
            showShotArc,
            shotTrajectory: mech?.lastShotTrajectory,
            pathError: telemetry?.followerError?.translational,
          });
          if (showActualPath) renderer.drawActualPath('robot1');
          const path = engine.getRobotPath('robot1');
          if (path) renderer.drawPath(path);
        }
        try {
          setAnalytics(engine.getAnalytics());
        } catch {
          /* pre-match */
        }
        const match = engine.getMatchState();
        if (match && match.events.length > events.length) {
          setEvents(match.events.slice(-8).map((e) => `[${e.t.toFixed(1)}s] ${e.message}`));
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [replayMode, showVelocity, showShotArc, showActualPath, telemetry, events.length]);

  const syncMatchUi = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const st = eng.getState();
    const match = eng.getMatchState();
    setPhase(st.phase);
    setPhaseTime(match?.timeRemainingInPhase ?? 0);
    setScore(st.score);
  };

  const handleInit = async () => {
    engineRef.current?.initMatch();
    syncMatchUi();
    setEvents((e) => [...e, 'INIT pressed']);
  };

  const handleStartMatch = () => {
    engineRef.current?.start();
    setMode('auto');
    syncMatchUi();
    setEvents((e) => [...e, 'MATCH started (AUTO)']);
  };

  const handleStartTeleop = () => {
    engineRef.current?.startTeleop();
    setMode('teleop');
    syncMatchUi();
    setEvents((e) => [...e, 'TELEOP started']);
  };

  const handlePause = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const st = eng.getState();
    if (st.paused) eng.resume();
    else eng.pause();
  };

  const handleReset = async () => {
    rendererRef.current?.clearTrails();
    await engineRef.current?.reset(42);
    setReplayMode(false);
    setEvents([]);
    syncMatchUi();
  };

  const handleExportReplay = () => {
    const json = engineRef.current?.getReplayJson();
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'match.ftcreplay.json';
    a.click();
  };

  const handlePathUpload = async (file: File) => {
    const text = await file.text();
    const json = JSON.parse(text) as PedroJsonFile;
    engineRef.current?.loadPathFromJson('robot1', json);
    setPathLoaded(true);
  };

  return (
    <div className="shell">
      {initState === 'loading' && (
        <div className="init-overlay">
          <div className="init-overlay-content">
            <p>Loading DECODE simulator…</p>
            <p className="hint">Initializing physics engine — this can take a few seconds on first load.</p>
          </div>
        </div>
      )}
      {initState === 'error' && (
        <div className="init-overlay">
          <div className="init-overlay-content">
            <p>Failed to load simulator</p>
            <p className="hint">{initError}</p>
            <button type="button" onClick={() => setRetryKey((k) => k + 1)}>
              Retry
            </button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">FTC DECODE Simulator v2</div>
        <div className="topbar-stats">
          <span>Phase: {phase}</span>
          <span>Mode: {mode}</span>
          <span>Score: {score}</span>
          <span>Clock: {phaseTime.toFixed(1)}s</span>
          <span>Sim: {telemetry?.t.toFixed(1) ?? '0.0'}s</span>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={handleInit}>INIT</button>
          <button type="button" onClick={handleStartMatch}>START AUTO</button>
          <button type="button" onClick={handleStartTeleop}>TELEOP</button>
          <button type="button" onClick={handlePause}>PAUSE</button>
          <button type="button" onClick={() => engineRef.current?.step(1)}>STEP</button>
          <button type="button" onClick={() => void handleReset()}>RESET</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="panel left">
          <h3>Robot Config</h3>
          <label>
            Mass (kg)
            <input
              type="range"
              min={8}
              max={25}
              defaultValue={10}
              onChange={(e) =>
                engineRef.current?.setRobotConfig('robot1', { mass: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Max velocity
            <input
              type="range"
              min={20}
              max={80}
              defaultValue={50}
              onChange={(e) =>
                engineRef.current?.setRobotConfig('robot1', {
                  limits: { maxVelocity: Number(e.target.value), maxAcceleration: 30, maxAngularVelocity: 4 },
                })
              }
            />
          </label>
          <h3>Mechanisms</h3>
          <p className="hint">Click field · WASD + Q/E drive · F intake · R reverse · G flywheel · Space shoot · C conveyor · B gate</p>
          <button type="button" onClick={() => engineRef.current?.humanPlayerLoad('red')}>
            HP Load Artifact
          </button>
          <h3>Path</h3>
          <input type="file" accept=".json,.pp" onChange={(e) => e.target.files?.[0] && void handlePathUpload(e.target.files[0])} />
          {pathLoaded && <span className="ok">Path loaded</span>}
          <h3>Overlays</h3>
          <label><input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} /> Zones</label>
          <label><input type="checkbox" checked={showVelocity} onChange={(e) => setShowVelocity(e.target.checked)} /> Velocity</label>
          <label><input type="checkbox" checked={showShotArc} onChange={(e) => setShowShotArc(e.target.checked)} /> Shot arc</label>
          <label><input type="checkbox" checked={showActualPath} onChange={(e) => setShowActualPath(e.target.checked)} /> Actual path</label>
        </aside>

        <main
          className="center"
          tabIndex={0}
          aria-label="Simulator field view — click here then use WASD to drive"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).focus({ preventScroll: true });
          }}
          onWheel={(e) => {
            e.preventDefault();
            rendererRef.current?.adjustZoom(e.deltaY > 0 ? -0.1 : 0.1);
          }}
        >
          <canvas ref={setCanvasEl} width={720} height={720} />
        </main>

        <aside className="panel right">
          <h3>Match Analytics</h3>
          <div className="stat-grid">
            <div>Score <strong>{score}</strong></div>
            <div>Artifacts <strong>{inventory}/3</strong></div>
            <div>Speed <strong>{telemetry ? Math.hypot(telemetry.velocity.x, telemetry.velocity.y).toFixed(1) : 0} in/s</strong></div>
            <div>Path % <strong>{((telemetry?.pathProgress.completion ?? 0) * 100).toFixed(0)}%</strong></div>
          </div>
          {analytics && (
            <>
              <h4>Strategy</h4>
              <ul className="metrics">
                <li>Cycles: {analytics.cycleCount}</li>
                <li>Intake rate: {(analytics.intakeSuccessRate * 100).toFixed(0)}%</li>
                <li>Shots: {analytics.shotsScored}/{analytics.shotsFired}</li>
                <li>Distance: {analytics.distanceTraveledInches.toFixed(0)} in</li>
                <li>Idle: {analytics.idleTimeSec.toFixed(1)}s</li>
              </ul>
            </>
          )}
          <h3>Follower Error</h3>
          <ul className="metrics">
            <li>Translational: {telemetry?.followerError.translational.toFixed(2)}</li>
            <li>Heading: {telemetry?.followerError.heading.toFixed(2)}</li>
            <li>Drive: {telemetry?.followerError.drive.toFixed(2)}</li>
          </ul>
        </aside>
      </div>

      <footer className="bottom">
        <div className="replay-controls">
          <button type="button" onClick={handleExportReplay}>Export Replay</button>
          <button
            type="button"
            onClick={() => {
              const json = engineRef.current?.getReplayJson();
              const player = replayPlayerRef.current;
              if (json && player) {
                player.load(JSON.parse(json));
                setReplayMode(true);
              }
            }}
          >
            Play Replay
          </button>
          {replayMode && (
            <>
              <button type="button" onClick={() => { replayPlayerRef.current?.step(-1); setReplayFrame(replayPlayerRef.current?.current?.tick ?? 0); }}>◀</button>
              <button type="button" onClick={() => { replayPlayerRef.current?.step(1); setReplayFrame(replayPlayerRef.current?.current?.tick ?? 0); }}>▶</button>
              <span>Frame {replayFrame}</span>
            </>
          )}
        </div>
        <div className="event-log">
          {events.map((ev, i) => (
            <div key={i} className="event-line">{ev}</div>
          ))}
        </div>
      </footer>
    </div>
  );
}
