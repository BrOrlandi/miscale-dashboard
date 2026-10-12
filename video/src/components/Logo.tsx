// The app icon (scripts/make_icons.py) as SVG, so it can animate: the dial's arc draws in and
// the needle swings to its place. `draw` and `needle` go from 0 to 1.

const S = 512;
const SIDE = S * 0.62, X0 = (S - SIDE) / 2;
const CX = S / 2, CY = X0 + SIDE * 0.62, R = SIDE * 0.32, W = SIDE * 0.075;
const pt = (deg: number, r: number) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];

export const Logo: React.FC<{ size: number; draw?: number; needle?: number; style?: React.CSSProperties }> = ({ size, draw = 1, needle = 1, style }) => {
  const rr = R - W / 2;
  const [ax, ay] = pt(200, rr), [bx, by] = pt(340, rr);
  const arcLen = (140 / 360) * 2 * Math.PI * rr;
  const ang = 200 + (295 - 200) * needle;
  const [nx, ny] = pt(ang, R * 0.78);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${S} ${S}`} style={style}>
      <defs>
        <linearGradient id="logoBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(31,138,99)" />
          <stop offset="1" stopColor="rgb(15,92,67)" />
        </linearGradient>
      </defs>
      <rect width={S} height={S} rx={S * 0.22} fill="url(#logoBg)" />
      <rect x={X0} y={X0} width={SIDE} height={SIDE} rx={SIDE * 0.2} fill="#fff" />
      <path d={`M ${ax} ${ay} A ${rr} ${rr} 0 0 1 ${bx} ${by}`} fill="none" stroke="rgb(31,122,90)" strokeWidth={W} strokeLinecap="round"
        strokeDasharray={arcLen} strokeDashoffset={arcLen * (1 - draw)} />
      <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="rgb(15,92,67)" strokeWidth={W * 0.7} strokeLinecap="round" />
      <circle cx={CX} cy={CY} r={W * 0.75} fill="rgb(15,92,67)" />
    </svg>
  );
};
