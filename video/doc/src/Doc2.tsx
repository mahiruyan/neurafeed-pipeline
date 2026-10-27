import React from 'react';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/anton/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { evolvePath } from '@remotion/paths';

type Rect = { x: number; y: number; w: number; h: number };
type Shot = { src: string; w: number; h: number; marks?: Rect[]; source?: string };
export type Doc2Props = {
  timing: { duration: number; sentences: { start: number; end: number }[] };
  assets: {
    voice: string | null; music?: string | null; whoosh?: string | null; hit?: string | null;
    dario: string; darioCut?: string | null; darioCredit?: string; footage?: { src: string; start?: number; credit: string } | null;
    building?: { src: string; credit: string } | null;
    headline: Shot | null; second?: Shot | null; risk: Shot | null;
    nfLogo: string; anthropicLogo: string;
  };
};

const C = { bg: '#090a09', ink: '#f2f1ec', mute: '#8e908b', acc: '#21d3a5', line: 'rgba(255,255,255,.07)' };
const ANTON = "'Anton', sans-serif"; const POP = "'Poppins', sans-serif"; const INTER = "'Inter Tight', sans-serif";
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

const useSpr = (delay = 0, cfg: Partial<{ damping: number; stiffness: number; mass: number }> = { damping: 200 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping: 200, ...cfg } });
};

// ---------- global layers ----------
const Grid: React.FC = () => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`, backgroundSize: '96px 96px', backgroundPosition: `${-f * 0.3}px ${-f * 0.15}px`, maskImage: 'radial-gradient(ellipse at 50% 50%, black 30%, transparent 85%)' }} />;
};
const Grain: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.2 }}>
      <svg width={2300} height={1500} style={{ position: 'absolute', left: -Math.floor(random(`x${f}`) * 300), top: -Math.floor(random(`y${f}`) * 300) }}>
        <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={f % 13} /></filter>
        <rect width="100%" height="100%" filter="url(#n)" />
      </svg>
    </AbsoluteFill>
  );
};
const Vignette: React.FC = () => <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.55) 100%)' }} />;
const Source: React.FC<{ text: string }> = ({ text }) => <div style={{ position: 'absolute', left: 64, bottom: 40, fontFamily: INTER, fontWeight: 500, fontSize: 19, color: C.mute }}>{text}</div>;

// Every shot enters like a camera move in After Effects: a short push with a blur that clears.
const ShotIn: React.FC<{ children: React.ReactNode; drift?: number }> = ({ children, drift = 0.03 }) => {
  const f = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const p = useSpr(0, { damping: 30, stiffness: 120 });
  const s = interpolate(p, [0, 1], [1.12, 1]) + interpolate(f, [0, durationInFrames], [0, drift]);
  const blur = interpolate(p, [0, 0.6], [14, 0], clamp);
  return <AbsoluteFill style={{ transform: `scale(${s})`, filter: blur > 0.2 ? `blur(${blur}px)` : undefined, opacity: interpolate(p, [0, 0.25], [0, 1], clamp) }}>{children}</AbsoluteFill>;
};

// Hand-drawn ellipse (marker) around a rectangle, drawn on with a stroke.
const ellipsePath = (r: Rect, seed: string) => {
  const cx = r.x + r.w / 2; const cy = r.y + r.h / 2; const rx = r.w / 2 + 22; const ry = r.h / 2 + 16;
  const pts: string[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = -0.35 + (i / 64) * (Math.PI * 2 + 0.55);
    const k = 1 + (random(`${seed}${i % 9}`) - 0.5) * 0.06;
    pts.push(`${(cx + Math.cos(t) * rx * k).toFixed(1)} ${(cy + Math.sin(t) * ry * k * (1 + i / 900)).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')}`;
};
const HandEllipse: React.FC<{ r: Rect; progress: number; color?: string; width?: number }> = ({ r, progress, color = C.acc, width = 5 }) => {
  const d = ellipsePath(r, `${r.x}${r.y}`);
  const ev = evolvePath(Math.min(1, Math.max(0, progress)), d);
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
};

// Hand-drawn underline under one line of text (used when a phrase wraps over several lines).
const HandUnderline: React.FC<{ r: Rect; progress: number }> = ({ r, progress }) => {
  const y = r.y + r.h + 4; const pts: string[] = [];
  for (let i = 0; i <= 24; i++) pts.push(`${(r.x - 6 + (r.w + 12) * (i / 24)).toFixed(1)} ${(y + Math.sin(i * 0.9 + r.x) * 2.2 + (random(`u${r.x}${i}`) - 0.5) * 2).toFixed(1)}`);
  const d = `M ${pts.join(' L ')}`; const ev = evolvePath(Math.min(1, Math.max(0, progress)), d);
  return <path d={d} fill="none" stroke={C.acc} strokeWidth={7} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
};

const Card: React.FC<{ shot: Shot; width: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ shot, width, style, children }) => {
  const k = width / shot.w;
  return (
    <div style={{ position: 'absolute', width, height: shot.h * k, boxShadow: '0 30px 80px rgba(0,0,0,.6)', borderRadius: 4, overflow: 'visible', ...style }}>
      <Img src={staticFile(shot.src)} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }} />
      <svg width={width} height={shot.h * k} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>{children}</svg>
    </div>
  );
};
const Badge: React.FC<{ n: number; p: number; style: React.CSSProperties }> = ({ n, p, style }) => (
  <div style={{ position: 'absolute', width: 54, height: 54, borderRadius: 27, background: C.acc, color: '#06231b', fontFamily: POP, fontWeight: 700, fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${p})`, ...style }}>{n}</div>
);

const LowerThird: React.FC<{ name: string; role: string; delay: number }> = ({ name, role, delay }) => {
  const a = useSpr(delay, { damping: 26, stiffness: 140 }); const b = useSpr(delay + 6, { damping: 200 });
  return (
    <div style={{ position: 'absolute', left: 90, bottom: 150 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', clipPath: `inset(0 ${100 - a * 100}% 0 0)` }}>
        <div style={{ width: 8, background: C.acc }} />
        <div style={{ background: 'rgba(8,9,8,.88)', padding: '14px 26px', fontFamily: POP, fontWeight: 600, fontSize: 40, color: C.ink }}>{name}</div>
      </div>
      <div style={{ marginTop: 8, marginLeft: 8, fontFamily: INTER, fontWeight: 500, fontSize: 24, color: C.ink, opacity: b, transform: `translateY(${(1 - b) * 10}px)` }}>{role}</div>
    </div>
  );
};

// 2.5D parallax: blurred background plate and a cut-out person moving at different speeds.
const Parallax: React.FC<{ bg: string; cut?: string | null; side?: 'left' | 'right' | 'full'; credit?: string }> = ({ bg, cut, side = 'full' }) => {
  const f = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const t = f / durationInFrames;
  const box: React.CSSProperties = side === 'full' ? { left: 0, top: 0, width: 1920, height: 1080 } : { left: side === 'left' ? 0 : 960, top: 0, width: 960, height: 1080 };
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', ...box }}>
      <Img src={staticFile(bg)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 30%', transform: `scale(${1.12 + t * 0.04}) translateX(${-t * 30}px)`, filter: cut ? 'blur(6px) brightness(.55) saturate(.8)' : 'brightness(.8) saturate(.85)' }} />
      {cut && <Img src={staticFile(cut)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 30%', transform: `scale(${1.02 + t * 0.08}) translateX(${t * 18}px)`, filter: 'contrast(1.05) saturate(.9)' }} />}
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(9,10,9,.85), rgba(9,10,9,0) 45%)' }} />
    </div>
  );
};

// ---------- scenes ----------
const Exodus: React.FC<{ A: Doc2Props['assets'] }> = ({ A }) => {
  const f = useCurrentFrame();
  const y = useSpr(4, { damping: 22, stiffness: 160 }); const n = useSpr(14, { damping: 18, stiffness: 170 }); const w = useSpr(22);
  return (
    <ShotIn drift={0.05}>
      {A.footage ? <OffthreadVideo src={staticFile(A.footage.src)} startFrom={Math.round((A.footage.start || 0) * 30)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.6) saturate(.8)' }} />
        : A.building ? <Parallax bg={A.building.src} /> : <Grid />}
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(9,10,9,.92) 0%, rgba(9,10,9,.5) 45%, rgba(9,10,9,0) 75%)' }} />
      <div style={{ position: 'absolute', left: 110, top: 300 }}>
        <div style={{ fontFamily: INTER, fontWeight: 500, fontSize: 34, color: C.mute, opacity: y, letterSpacing: '0.04em' }}>2021</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30, marginTop: 10 }}>
          <div style={{ fontFamily: ANTON, fontSize: 300, lineHeight: 0.85, color: C.acc, transform: `scale(${interpolate(n, [0, 1], [1.5, 1])})`, transformOrigin: 'left bottom', opacity: interpolate(n, [0, 0.3], [0, 1], clamp), filter: `blur(${interpolate(n, [0, 0.5], [12, 0], clamp)}px)` }}>7</div>
          <div style={{ fontFamily: POP, fontWeight: 600, fontSize: 54, lineHeight: 1.1, color: C.ink, paddingBottom: 18, clipPath: `inset(0 ${100 - w * 100}% 0 0)` }}>people left<br />OpenAI</div>
        </div>
      </div>
      {A.building && <Source text={A.building.credit} />}
      {void f}
    </ShotIn>
  );
};

const Filed: React.FC<{ A: Doc2Props['assets'] }> = ({ A }) => {
  const c1 = useSpr(6, { damping: 24, stiffness: 120 }); const c2 = useSpr(30, { damping: 24, stiffness: 120 });
  const b1 = useSpr(18, { damping: 12, stiffness: 200 }); const b2 = useSpr(42, { damping: 12, stiffness: 200 });
  const f = useCurrentFrame();
  const h = A.headline; const s2 = A.second;
  return (
    <ShotIn>
      <Grid />
      <Parallax bg={A.dario} cut={A.darioCut} side="left" />
      <LowerThird name="Dario Amodei" role="Cofounder and CEO, Anthropic" delay={10} />
      {h && <Card shot={h} width={820} style={{ left: 1030, top: s2 ? 150 : 320, transform: `translateX(${(1 - c1) * 900}px) rotate(${(1 - c1) * 4}deg)` }}>
        {h.marks?.[0] && <HandEllipse r={{ x: h.marks[0].x * (820 / h.w), y: h.marks[0].y * (820 / h.w), w: h.marks[0].w * (820 / h.w), h: h.marks[0].h * (820 / h.w) }} progress={interpolate(f, [40, 62], [0, 1], clamp)} />}
      </Card>}
      {h && <Badge n={1} p={b1} style={{ left: 1000, top: s2 ? 124 : 294 }} />}
      {s2 && <Card shot={s2} width={820} style={{ left: 1030, top: 560, transform: `translateX(${(1 - c2) * 900}px) rotate(${(1 - c2) * 4}deg)` }} />}
      {s2 && <Badge n={2} p={b2} style={{ left: 1000, top: 534 }} />}
      <Source text={[h?.source, s2?.source, A.darioCredit ? `Photo: ${A.darioCredit}` : ''].filter(Boolean).join('. ')} />
    </ShotIn>
  );
};

const Ticker: React.FC = () => {
  const L = ['A', 'N', 'T'];
  const n = useSpr(0, { damping: 200 });
  return (
    <ShotIn drift={0.02}>
      <Grid />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: POP, fontWeight: 600, fontSize: 30, letterSpacing: '0.3em', color: C.mute, opacity: n, marginBottom: 10 }}>NASDAQ</div>
        <div style={{ display: 'flex', gap: 10 }}>
          {L.map((ch, i) => <Slam key={i} delay={4 + i * 5}>{ch}</Slam>)}
        </div>
      </AbsoluteFill>
    </ShotIn>
  );
};
const Slam: React.FC<{ delay: number; children: React.ReactNode }> = ({ delay, children }) => {
  const p = useSpr(delay, { damping: 13, stiffness: 220 });
  return <div style={{ fontFamily: ANTON, fontSize: 420, lineHeight: 1, color: C.acc, transform: `scale(${interpolate(p, [0, 1], [2.2, 1])}) translateY(${(1 - p) * -40}px)`, opacity: interpolate(p, [0, 0.2], [0, 1], clamp), filter: `blur(${interpolate(p, [0, 0.6], [24, 0], clamp)}px)` }}>{children}</div>;
};

// Slot-machine digits.
const Roll: React.FC<{ text: string; delay: number; size: number; color: string }> = ({ text, delay, size, color }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'flex', fontFamily: ANTON, fontSize: size, lineHeight: 1, color, height: size, overflow: 'hidden' }}>
      {text.split('').map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i}>{ch}</span>;
        const p = spring({ frame: f - delay - i * 3, fps, config: { damping: 22, stiffness: 90 } });
        const target = Number(ch) + 20;
        return (
          <div key={i} style={{ height: size, overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${-p * target * size}px)`, filter: `blur(${(1 - p) * 6}px)` }}>
              {Array.from({ length: 30 }, (_, k) => <div key={k} style={{ height: size }}>{k % 10}</div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Revenue: React.FC<{ A: Doc2Props['assets'] }> = ({ A }) => {
  const l = useSpr(2); const d = useSpr(30);
  return (
    <ShotIn>
      <Grid />
      <div style={{ position: 'absolute', right: 0, top: 0, width: 760, height: 1080, opacity: 0.55 }}>
        <Img src={staticFile(A.darioCut || A.dario)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 25%', filter: 'grayscale(.4) brightness(.7)', maskImage: 'linear-gradient(90deg, transparent, black 45%)' }} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 280 }}>
        <div style={{ fontFamily: POP, fontWeight: 500, fontSize: 34, color: C.ink, opacity: l, transform: `translateY(${(1 - l) * 16}px)` }}>Revenue, first half of 2026</div>
        <Roll text="$16.3B" delay={6} size={280} color={C.acc} />
        <div style={{ height: 4, width: 520 * d, background: C.acc, marginTop: 20 }} />
      </div>
      <Source text="Source: Anthropic S-1, via Yahoo Finance and TechCrunch" />
    </ShotIn>
  );
};

const Growth: React.FC = () => {
  const f = useCurrentFrame();
  const W = 1300; const H = 560; const x0 = 0; const x1 = W; const y0 = H - 40; const y1 = 40;
  const d = `M ${x0} ${y0} C ${W * 0.55} ${y0 - 10}, ${W * 0.75} ${y0 - 120}, ${x1} ${y1}`;
  const p = interpolate(f, [6, 46], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) });
  const ev = evolvePath(p, d);
  const m = interpolate(f, [40, 70], [1, 13.6], clamp);
  const br = interpolate(f, [52, 72], [0, 1], clamp);
  const dot = (x: number, y: number, s: number) => <circle cx={x} cy={y} r={11 * s} fill={C.acc} />;
  const pop = (start: number) => spring({ frame: f - start, fps: 30, config: { damping: 12, stiffness: 200 } });
  return (
    <ShotIn>
      <Grid />
      <div style={{ position: 'absolute', left: 120, top: 120, fontFamily: ANTON, fontSize: 200, color: C.acc, lineHeight: 1, opacity: interpolate(f, [40, 48], [0, 1], clamp) }}>{m.toFixed(1)}×</div>
      <div style={{ position: 'absolute', left: 126, top: 330, fontFamily: INTER, fontWeight: 500, fontSize: 30, color: C.mute, opacity: interpolate(f, [50, 60], [0, 1], clamp) }}>in twelve months</div>
      <svg width={W + 200} height={H + 200} style={{ position: 'absolute', left: 420, top: 300, overflow: 'visible' }}>
        <line x1={0} y1={y0 + 40} x2={W} y2={y0 + 40} stroke="rgba(255,255,255,.25)" strokeWidth={2} />
        <path d={d} fill="none" stroke={C.acc} strokeWidth={6} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />
        {dot(x0, y0, pop(6))}{dot(x1, y1, pop(46))}
        <text x={x0} y={y0 - 34} fill={C.ink} fontFamily="Anton" fontSize={64} opacity={pop(8)}>$1.2B</text>
        <text x={x1 - 230} y={y1 - 34} fill={C.acc} fontFamily="Anton" fontSize={84} opacity={pop(46)}>$16.3B</text>
        <text x={x0} y={y0 + 90} fill={C.mute} fontFamily="Inter Tight" fontSize={28}>H1 2025</text>
        <text x={x1 - 120} y={y0 + 90} fill={C.mute} fontFamily="Inter Tight" fontSize={28}>H1 2026</text>
        <path d={`M 0 ${y0 + 120} q 0 26 26 26 L ${W / 2 - 26} ${y0 + 146} q 26 0 26 26 q 0 -26 26 -26 L ${W - 26} ${y0 + 146} q 26 0 26 -26`} fill="none" stroke={C.acc} strokeWidth={3} strokeDasharray={evolvePath(br, `M 0 ${y0 + 120} q 0 26 26 26 L ${W / 2 - 26} ${y0 + 146} q 26 0 26 26 q 0 -26 26 -26 L ${W - 26} ${y0 + 146} q 26 0 26 -26`).strokeDasharray} strokeDashoffset={evolvePath(br, `M 0 ${y0 + 120} q 0 26 26 26 L ${W / 2 - 26} ${y0 + 146} q 26 0 26 26 q 0 -26 26 -26 L ${W - 26} ${y0 + 146} q 26 0 26 -26`).strokeDashoffset} />
      </svg>
      <Source text="Source: Anthropic S-1, via Yahoo Finance" />
    </ShotIn>
  );
};

const Risk: React.FC<{ shot: Shot | null; markAt: number }> = ({ shot, markAt }) => {
  const f = useCurrentFrame(); const { durationInFrames } = useVideoConfig();
  const a = useSpr(0, { damping: 26, stiffness: 110 });
  if (!shot) return <Grid />;
  const W = 1400; const k = W / shot.w; const m = shot.marks || [];
  const box = m.length ? { x: Math.min(...m.map((r) => r.x)) * k, y: Math.min(...m.map((r) => r.y)) * k, w: (Math.max(...m.map((r) => r.x + r.w)) - Math.min(...m.map((r) => r.x))) * k, h: (Math.max(...m.map((r) => r.y + r.h)) - Math.min(...m.map((r) => r.y))) * k } : null;
  const z = interpolate(f, [markAt - 10, durationInFrames], [1, 1.22], clamp);
  const cx = m.length ? (m[0].x + m[0].w / 2) * k : W / 2; const cy = box ? box.y + box.h / 2 : 0;
  return (
    <ShotIn drift={0}>
      <Grid />
      <div style={{ position: 'absolute', left: 260, top: 540 - (shot.h * k) / 2, width: W, height: shot.h * k, transform: `translateY(${(1 - a) * 80}px) scale(${z})`, transformOrigin: `${cx}px ${cy}px` }}>
        <Card shot={shot} width={W}>
          {m.length === 1 && box && <HandEllipse r={box} progress={interpolate(f, [markAt, markAt + 22], [0, 1], clamp)} width={6} />}
          {m.length > 1 && m.map((r, i) => <HandUnderline key={i} r={{ x: r.x * k, y: r.y * k, w: r.w * k, h: r.h * k }} progress={interpolate(f, [markAt + i * 14, markAt + i * 14 + 16], [0, 1], clamp)} />)}
        </Card>
      </div>
      {shot.source && <Source text={shot.source} />}
    </ShotIn>
  );
};

const Question: React.FC<{ len: number }> = ({ len }) => {
  const words = ['So why', 'would anyone', 'build it?'];
  const f = useCurrentFrame();
  const step = Math.max(8, Math.floor(len / 3.3));
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 140 }}>
      {words.map((w, i) => {
        const p = spring({ frame: f - i * step, fps: 30, config: { damping: 18, stiffness: 180 } });
        return <div key={i} style={{ fontFamily: POP, fontWeight: 700, fontSize: 130, lineHeight: 1.08, color: i === 2 ? C.acc : C.ink, opacity: interpolate(p, [0, 0.3], [0, 1], clamp), transform: `translateY(${(1 - p) * 60}px)`, filter: `blur(${interpolate(p, [0, 0.5], [10, 0], clamp)}px)` }}>{w}</div>;
      })}
    </AbsoluteFill>
  );
};

const Title: React.FC<{ A: Doc2Props['assets'] }> = ({ A }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [0, 34], [0, 1], { ...clamp, easing: (t) => 1 - Math.pow(1 - t, 3) }); const b = interpolate(f, [18, 40], [0, 1], clamp);
  const lg = spring({ frame: f - 4, fps: 30, config: { damping: 16, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Grid />
      <Img src={staticFile(A.anthropicLogo)} style={{ width: 110, marginBottom: 34, filter: 'brightness(0) invert(1)', transform: `scale(${lg})` }} />
      <div style={{ fontFamily: "'Archivo Variable'", fontWeight: 800, fontSize: 210, color: C.ink, letterSpacing: `${interpolate(a, [0, 1], [0.32, 0.04])}em`, opacity: a }}>ANTHROPIC</div>
      <div style={{ fontFamily: INTER, fontWeight: 500, fontSize: 40, color: C.mute, marginTop: 26, opacity: b }}>The lab that warns about its own product</div>
      <div style={{ position: 'absolute', bottom: 70, display: 'flex', alignItems: 'center', gap: 16, opacity: b }}>
        <Img src={staticFile(A.nfLogo)} style={{ width: 46, height: 46 }} />
        <div style={{ fontFamily: POP, fontWeight: 600, fontSize: 26, color: C.ink }}>A NeuraFeed documentary</div>
      </div>
    </AbsoluteFill>
  );
};

export const Doc2: React.FC<Doc2Props> = ({ timing, assets: A }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const S = timing.sentences;
  const at = (s: number) => Math.max(0, Math.round(s * fps));
  const cuts = [0, at(S[1].start - 0.1), at(S[2].start - 0.08), at(S[3].start - 0.1), at(S[4].start - 0.1), at(S[5].start - 0.1), at(S[6].start - 0.08), at(S[7].start - 0.12), durationInFrames];
  const len = (k: number) => cuts[k + 1] - cuts[k];
  const scenes = [
    <Exodus A={A} />, <Filed A={A} />, <Ticker />, <Revenue A={A} />, <Growth />,
    <Risk shot={A.risk} markAt={at(S[5].start + (S[5].end - S[5].start) * 0.6) - cuts[5]} />,
    <Question len={len(6)} />, <Title A={A} />,
  ];
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {scenes.map((el, k) => <Sequence key={k} from={cuts[k]} durationInFrames={len(k)}>{el}</Sequence>)}
      {A.whoosh && cuts.slice(1, -1).map((c, k) => <Sequence key={`w${k}`} from={Math.max(0, c - 4)} durationInFrames={30}><Audio src={staticFile(A.whoosh!)} volume={0.35} /></Sequence>)}
      {A.hit && <Sequence from={cuts[2] + 4} durationInFrames={40}><Audio src={staticFile(A.hit)} volume={0.5} /></Sequence>}
      {A.music && <Audio src={staticFile(A.music)} volume={(f) => interpolate(f, [0, 20, durationInFrames - 40, durationInFrames], [0, 0.16, 0.16, 0], clamp)} />}
      {A.voice && <Audio src={staticFile(A.voice)} />}
      <Vignette />
      <Grain />
    </AbsoluteFill>
  );
};
