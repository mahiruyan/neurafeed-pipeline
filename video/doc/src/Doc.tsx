import React from 'react';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import { AbsoluteFill, Audio, Img, Easing, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig, random } from 'remotion';

type Rect = { x: number; y: number; w: number; h: number };
type Shot = { src: string; w: number; h: number; marks?: Rect[]; source?: string };
export type DocProps = {
  timing: { duration: number; sentences: { start: number; end: number }[] };
  captions: string[];
  assets: { walkout: string; dario: string; darioCredit?: string; voice: string | null; headline: Shot | null; risk: Shot | null };
};

const C = { bg: '#0b0b0a', ink: '#f3f1ea', mute: '#9b9a93', green: '#1fc394' };
const NUM: React.CSSProperties = { fontFamily: "'Archivo Variable'", fontWeight: 800, fontStretch: '72%', letterSpacing: '-0.01em', lineHeight: 0.86 };
const SANS = "'Inter Tight', sans-serif";
const out = Easing.bezier(0.16, 1, 0.3, 1);
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: out });

// Film grain: a noise layer whose offset jumps every frame.
const Grain: React.FC = () => {
  const f = useCurrentFrame();
  const x = Math.floor(random(`gx${f}`) * 200); const y = Math.floor(random(`gy${f}`) * 200);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.22 }}>
      <svg width={2200} height={1400} style={{ position: 'absolute', left: -x, top: -y }}>
        <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={f % 11} stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#g)" />
      </svg>
    </AbsoluteFill>
  );
};
const Vignette: React.FC = () => <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(0,0,0,.6) 100%)' }} />;

// Paper cutout of a real article screenshot, with a torn bottom edge.
const torn = (seed: string) => {
  const pts = ['0% 0%', '100% 0%'];
  for (let i = 0; i <= 40; i++) pts.push(`${100 - i * 2.5}% ${97 + random(`${seed}${i}`) * 3}%`);
  return `polygon(${pts.join(',')})`;
};
const Cutout: React.FC<{ shot: Shot; width: number; style?: React.CSSProperties; markProgress?: number }> = ({ shot, width, style, markProgress = 0 }) => {
  const k = width / shot.w;
  return (
    <div style={{ position: 'absolute', width, height: shot.h * k, filter: 'drop-shadow(0 30px 50px rgba(0,0,0,.6))', ...style }}>
      <div style={{ position: 'absolute', inset: 0, clipPath: torn(shot.src), background: '#fff' }}>
        <Img src={staticFile(shot.src)} style={{ width: '100%', height: '100%', display: 'block' }} />
        {(shot.marks || []).map((m, i) => {
          const p = interpolate(markProgress, [i / (shot.marks!.length), (i + 1) / shot.marks!.length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return <div key={i} style={{ position: 'absolute', left: m.x * k - 4, top: (m.y + m.h * 0.12) * k, width: (m.w * k + 8) * p, height: m.h * k * 0.82, background: 'rgba(31,195,148,.5)', mixBlendMode: 'multiply', borderRadius: 3 }} />;
        })}
      </div>
    </div>
  );
};

const Source: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: 'absolute', left: 64, bottom: 44, fontFamily: SANS, fontWeight: 500, fontSize: 21, color: C.mute, letterSpacing: '0.01em' }}>{text}</div>
);

// Captions: four words at a time, the spoken word in green.
const Captions: React.FC<DocProps & { hide: number[] }> = ({ timing, captions, hide }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig(); const t = f / fps;
  const S = timing.sentences;
  const i = S.findIndex((s, k) => t >= s.start - 0.05 && t < (k < S.length - 1 ? S[k + 1].start - 0.05 : s.end + 0.5));
  if (i < 0 || hide.includes(i)) return null;
  const words = captions[i].split(' ');
  const p = Math.min(0.999, Math.max(0, (t - S[i].start) / Math.max(0.1, S[i].end - S[i].start)));
  const w = Math.floor(p * words.length); const c0 = Math.floor(w / 4) * 4;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 104, textAlign: 'center', fontFamily: SANS, fontWeight: 700, fontSize: 50, color: C.ink, textShadow: '0 2px 14px rgba(0,0,0,.8)', letterSpacing: '-0.01em' }}>
      {words.slice(c0, c0 + 4).map((x, k) => <span key={k} style={{ color: c0 + k === w ? C.green : C.ink }}>{x}{' '}</span>)}
    </div>
  );
};

// Scene 0: the seven leave OpenAI.
const Walkout: React.FC<{ src: string; len: number }> = ({ src, len }) => {
  const f = useCurrentFrame();
  const s = interpolate(f, [0, len], [1.06, 1.16]);
  const r = ramp(f, 12, 34);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${s})`, filter: 'contrast(1.08) saturate(.82) brightness(.9)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,0) 48%)' }} />
      <div style={{ position: 'absolute', left: 92, bottom: 230 }}>
        <div style={{ width: 120 * r, height: 5, background: C.green, marginBottom: 22 }} />
        <div style={{ ...NUM, fontSize: 230, color: C.ink, clipPath: `inset(${100 - r * 100}% 0 0 0)` }}>2021</div>
      </div>
    </AbsoluteFill>
  );
};

// Scene 1: the real IPO article, then the ticker.
const Filing: React.FC<{ dario: string; shot: Shot | null; tickerAt: number }> = ({ dario, shot, tickerAt }) => {
  const f = useCurrentFrame();
  const a = ramp(f, 0, 22); const b = ramp(f, tickerAt, tickerAt + 14);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(dario)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(22px) brightness(.32) saturate(.6)', transform: 'scale(1.15)' }} />
      {shot && <Cutout shot={shot} width={1080} style={{ left: interpolate(b, [0, 1], [420, 150]), top: interpolate(a, [0, 1], [300, 200]), transform: `rotate(${interpolate(a, [0, 1], [-4, -1.4])}deg) scale(${interpolate(b, [0, 1], [1, 0.84])})`, opacity: a }} />}
      <div style={{ position: 'absolute', left: 1240, top: 340, opacity: b }}>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 30, color: C.mute, letterSpacing: '0.02em', marginBottom: 14 }}>Nasdaq ticker</div>
        <div style={{ ...NUM, fontSize: 300, color: C.green, clipPath: `inset(0 ${100 - b * 100}% 0 0)` }}>ANT</div>
      </div>
      {shot?.source && <Source text={shot.source} />}
    </AbsoluteFill>
  );
};

// Scene 2: revenue over Dario's real photo.
const Revenue: React.FC<{ dario: string; credit: string; len: number; earlierAt: number }> = ({ dario, credit, len, earlierAt }) => {
  const f = useCurrentFrame();
  const v = 16.3 * ramp(f, 4, 46); const e = ramp(f, earlierAt, earlierAt + 16);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Img src={staticFile(dario)} style={{ position: 'absolute', right: 0, height: '100%', width: '68%', objectFit: 'cover', objectPosition: '45% 30%', transform: `scale(${interpolate(f, [0, len], [1.03, 1.1])})`, filter: 'contrast(1.05) saturate(.85)' }} />
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${C.bg} 30%, rgba(11,11,10,.85) 46%, rgba(11,11,10,0) 75%)` }} />
      <div style={{ position: 'absolute', left: 92, top: 250 }}>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 34, color: C.ink, marginBottom: 18 }}>Revenue, first half of 2026</div>
        <div style={{ ...NUM, fontSize: 280, color: C.green }}>${v.toFixed(1)}B</div>
        <div style={{ marginTop: 56, opacity: e, transform: `translateY(${(1 - e) * 20}px)`, display: 'flex', alignItems: 'baseline', gap: 26 }}>
          <div style={{ ...NUM, fontSize: 120, color: C.mute }}>$1.2B</div>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 32, color: C.mute }}>a year earlier</div>
        </div>
      </div>
      <Source text={`Source: Anthropic S-1, via Yahoo Finance.${credit ? ` Photo: ${credit}` : ''}`} />
    </AbsoluteFill>
  );
};

// Scene 3: the risk sentence in the real article, highlighted while it is spoken.
const Risk: React.FC<{ shot: Shot | null; len: number; markAt: number }> = ({ shot, len, markAt }) => {
  const f = useCurrentFrame();
  const a = ramp(f, 0, 20); const m = ramp(f, markAt, markAt + 26);
  if (!shot) return <AbsoluteFill style={{ background: C.bg }} />;
  const W = 1500; const k = W / shot.w; const mk = shot.marks?.[0];
  const cx = mk ? (mk.x + mk.w / 2) * k : W / 2; const cy = mk ? (mk.y + mk.h / 2) * k : (shot.h * k) / 2;
  const z = interpolate(f, [0, len], [1, 1.18]);
  return (
    <AbsoluteFill style={{ background: '#121210' }}>
      <div style={{ position: 'absolute', left: 960 - W / 2, top: 540 - (shot.h * k) / 2, width: W, height: shot.h * k, transform: `scale(${z}) translateY(${(1 - a) * 60}px) rotate(-0.8deg)`, transformOrigin: `${cx}px ${cy}px`, opacity: a }}>
        <Cutout shot={shot} width={W} markProgress={m} />
      </div>
      {shot.source && <Source text={shot.source} />}
    </AbsoluteFill>
  );
};

// Scene 4: title.
const Title: React.FC = () => {
  const f = useCurrentFrame();
  const a = ramp(f, 0, 30); const b = ramp(f, 16, 40);
  return (
    <AbsoluteFill style={{ background: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ ...NUM, fontStretch: '100%', fontSize: 210, color: C.ink, letterSpacing: `${interpolate(a, [0, 1], [0.32, 0.04])}em`, opacity: a }}>ANTHROPIC</div>
      <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 40, color: C.mute, marginTop: 30, opacity: b }}>The lab that warns about its own product</div>
    </AbsoluteFill>
  );
};

export const Doc: React.FC<DocProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const S = props.timing.sentences; const A = props.assets;
  const at = (s: number) => Math.max(0, Math.round(s * fps));
  const cuts = [0, at(S[1].start - 0.12), at(S[3].start - 0.12), at(S[5].start - 0.12), at(S[6].start - 0.15), durationInFrames];
  const len = (k: number) => cuts[k + 1] - cuts[k];
  const push = (k: number, el: React.ReactNode) => (
    <Sequence key={k} from={cuts[k]} durationInFrames={len(k)}>{el}</Sequence>
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {push(0, <Walkout src={A.walkout} len={len(0)} />)}
      {push(1, <Filing dario={A.dario} shot={A.headline} tickerAt={at(S[2].start) - cuts[1] - 3} />)}
      {push(2, <Revenue dario={A.dario} credit={A.darioCredit || ''} len={len(2)} earlierAt={at(S[4].start) - cuts[2]} />)}
      {push(3, <Risk shot={A.risk} len={len(3)} markAt={at(S[5].start + (S[5].end - S[5].start) * 0.5) - cuts[3]} />)}
      {push(4, <Title />)}
      <Captions {...props} hide={[2, 5, 6]} />
      <Vignette />
      <Grain />
      <div style={{ position: 'absolute', top: 46, right: 60, fontFamily: SANS, fontWeight: 700, fontSize: 24, color: C.ink, opacity: 0.7, letterSpacing: '-0.01em' }}>neura<span style={{ color: C.green }}>feed</span></div>
      {A.voice && <Audio src={staticFile(A.voice)} />}
    </AbsoluteFill>
  );
};
