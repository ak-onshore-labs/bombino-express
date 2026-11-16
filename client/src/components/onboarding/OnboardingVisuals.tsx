import type { ReactElement, ReactNode } from 'react';
import { motion } from 'framer-motion';

/**
 * Illustrations for the onboarding slides.
 *
 * Friendly, flat drawings in the brand colours: a parcel, a plane, a pin, a
 * gift. Deliberately not screenshots of the app — no order numbers, no
 * timelines, no labels — so a first-time sender who is not at ease with
 * apps reads the idea at a glance. Decorative only: the slide's heading
 * carries the meaning, so every drawing is aria-hidden.
 *
 * Each plays one short entrance as its slide arrives, then a gentle idle.
 * Onboarding wraps them in <MotionConfig reducedMotion="user">, so with
 * reduced motion on the movement drops out and only the fades remain.
 */

const NAVY = '#14567C';
const NAVY_DEEP = '#0E3A55';
const NAVY_WASH = '#EEF4F8';
const AMBER = '#F2A123';
const AMBER_LIGHT = '#F7C35C';
const AMBER_WASH = '#FFF4E0';
const BOX = '#E3A75A';
const BOX_LID = '#EDBB72';
const TAPE = '#F6D7A3';
const WHATSAPP = '#25D366';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function Canvas({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="24 14 232 222"
      className="h-full max-h-[400px] w-full max-w-[400px]"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* A cardboard parcel with its shadow. (x, y) is the top-left of the lid. */
function Parcel({ x, y, w = 92 }: { x: number; y: number; w?: number }): ReactElement {
  const h = w * 0.82;
  const lid = w * 0.2;
  const tape = w * 0.17;
  return (
    <g>
      <ellipse cx={x + w / 2} cy={y + h + 6} rx={w * 0.56} ry={7} fill={NAVY_DEEP} opacity={0.08} />
      <rect x={x + 4} y={y + lid - 4} width={w - 8} height={h - lid + 4} rx={6} fill={BOX} />
      <rect x={x} y={y} width={w} height={lid} rx={5} fill={BOX_LID} />
      <rect x={x + w / 2 - tape / 2} y={y} width={tape} height={h} fill={TAPE} opacity={0.9} />
      <rect x={x + 12} y={y + lid + 14} width={w * 0.26} height={w * 0.18} rx={3} fill="#fff" />
      <rect x={x + 16} y={y + lid + 19} width={w * 0.15} height={2.5} rx={1.25} fill={NAVY} opacity={0.5} />
      <rect x={x + 16} y={y + lid + 24} width={w * 0.1} height={2.5} rx={1.25} fill={NAVY} opacity={0.35} />
    </g>
  );
}

/* Paper plane like the one in the logo, centred on (0, 0), nose to the right. */
function PaperPlane(): ReactElement {
  return (
    <g>
      <path d="M-14 -9 L14 0 L-14 9 L-8 0 Z" fill={AMBER} />
      <path d="M-8 0 L14 0 L-6 5 Z" fill="#D98A14" />
    </g>
  );
}

/* 01 · Ship — a parcel at the door and a plane flying it to the globe. */

// Points along the flight arc (a cubic from the parcel to the globe), with
// the plane's heading at each, so it follows the dashed line.
const FLIGHT_X = [100, 108.5, 130.75, 161.6, 196];
const FLIGHT_Y = [118, 81.6, 59.5, 51.6, 58];
const FLIGHT_ROTATE = [-90, -61, -29, -1, 21];

export function ShipVisual(): ReactElement {
  return (
    <Canvas>
      <circle cx={140} cy={124} r={104} fill={NAVY_WASH} />

      {/* Globe */}
      <motion.g
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <defs>
          <clipPath id="onb-globe">
            <circle cx={192} cy={124} r={52} />
          </clipPath>
        </defs>
        <circle cx={192} cy={124} r={52} fill="#D6E7F1" />
        <g clipPath="url(#onb-globe)" fill="#A9CBE0">
          <path d="M160 100c8-12 24-14 33-7 7 6 2 14-7 16-9 2-11 11-20 9-9-2-13-10-6-18z" />
          <path d="M200 134c11-5 25 0 27 10 2 9-7 16-16 14-7-2-7-9-14-11-7-2-7-9 3-13z" />
          <path d="M168 146c7 0 10 7 7 12-3 5-11 4-12-2-1-5 1-10 5-10z" />
          <path d="M222 92c6-2 12 2 11 7-1 5-8 6-11 3-3-3-4-8 0-10z" />
        </g>
      </motion.g>

      <motion.g
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.45, ease: EASE_OUT }}
      >
        <Parcel x={48} y={124} w={92} />
      </motion.g>

      {/* Flight path */}
      <motion.path
        d="M100 118 C 100 60, 150 40, 196 58"
        fill="none"
        stroke={AMBER}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="1 8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.6 }}
      />

      <motion.g
        initial={{ x: FLIGHT_X[0], y: FLIGHT_Y[0], rotate: FLIGHT_ROTATE[0], opacity: 0 }}
        animate={{ x: FLIGHT_X, y: FLIGHT_Y, rotate: FLIGHT_ROTATE, opacity: [0, 1, 1, 1, 1] }}
        transition={{ delay: 0.35, duration: 1.1, ease: 'easeInOut' }}
      >
        <PaperPlane />
      </motion.g>
    </Canvas>
  );
}

/* 02 · Track — a pin dropping on the parcel's road, a WhatsApp message
   received, and BIA ready to help. */
export function TrackVisual(): ReactElement {
  return (
    <Canvas>
      <circle cx={140} cy={124} r={104} fill={AMBER_WASH} />

      {/* The road the parcel travels */}
      <motion.path
        d="M44 206 C 84 204, 70 170, 108 168 S 132 176, 140 160"
        fill="none"
        stroke={NAVY}
        strokeOpacity={0.35}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray="1 10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      />

      {/* Pin shadow grows as the pin lands */}
      <motion.ellipse
        cx={140}
        cy={160}
        rx={22}
        ry={5}
        fill={NAVY_DEEP}
        opacity={0.14}
        initial={{ scale: 0.3 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 14 }}
      />

      {/* The pin, with the parcel inside */}
      <motion.g
        initial={{ y: -46, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 14 }}
      >
        <path d="M140 156 C 140 156 102 116 102 88 a38 38 0 0 1 76 0 C 178 116 140 156 140 156 Z" fill={NAVY} />
        <circle cx={140} cy={88} r={22} fill="#fff" />
        <rect x={129} y={80} width={22} height={17} rx={2.5} fill={BOX} />
        <rect x={128} y={77} width={24} height={6} rx={2} fill={BOX_LID} />
        <rect x={137.5} y={77} width={5} height={20} fill={TAPE} />
      </motion.g>

      {/* WhatsApp: a message arrived (double tick) */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.65, type: 'spring', stiffness: 380, damping: 16 }}
      >
        <rect x={184} y={38} width={66} height={42} rx={16} fill={WHATSAPP} />
        <path d="M192 76 L186 90 L204 80 Z" fill={WHATSAPP} />
        <path d="M199 60 l6 6 l11 -12" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M212 64 l2 2 l13 -14" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>

      {/* BIA: someone ready to answer (typing dots) */}
      <motion.g
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.9, type: 'spring', stiffness: 380, damping: 16 }}
      >
        <rect x={30} y={66} width={64} height={38} rx={16} fill="#fff" stroke="#E2E8F0" strokeWidth={1.5} />
        <path d="M80 102 L92 112 L74 104 Z" fill="#fff" />
        {[48, 62, 76].map((cx, i) => (
          <motion.circle
            key={cx}
            cx={cx}
            cy={85}
            r={4.5}
            fill={NAVY}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ delay: 1.1 + i * 0.18, duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </motion.g>
    </Canvas>
  );
}

/* 03 · Earn — a gift box pops open and coins rise out of it. */
const COINS = [
  { x: 112, y: 70, delay: 0.55 },
  { x: 146, y: 50, delay: 0.7 },
  { x: 180, y: 74, delay: 0.85 },
] as const;

const SPARKLES = [
  { x: 66, y: 96, s: 1, delay: 1.0 },
  { x: 216, y: 118, s: 0.8, delay: 1.25 },
  { x: 204, y: 44, s: 0.65, delay: 1.45 },
] as const;

export function EarnVisual(): ReactElement {
  return (
    <Canvas>
      <circle cx={140} cy={124} r={104} fill={NAVY_WASH} />
      <ellipse cx={140} cy={208} rx={60} ry={7} fill={NAVY_DEEP} opacity={0.08} />

      {/* Box */}
      <motion.g
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
      >
        <rect x={88} y={130} width={104} height={74} rx={7} fill={AMBER} />
        <rect x={132} y={130} width={16} height={74} fill={NAVY} />
      </motion.g>

      {/* Coins rise out once the lid lifts, then bob */}
      {COINS.map((c) => (
        <motion.g
          key={c.x}
          initial={{ opacity: 0, y: 60, scale: 0.6 }}
          animate={{ opacity: 1, y: [60, -4, 0], scale: 1 }}
          transition={{ delay: c.delay, duration: 0.6, ease: EASE_OUT }}
        >
          <motion.g
            animate={{ y: [0, -4, 0] }}
            transition={{ delay: c.delay + 0.7, duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <circle cx={c.x} cy={c.y} r={16} fill={AMBER_LIGHT} stroke="#D98A14" strokeWidth={3} />
            <text
              x={c.x}
              y={c.y + 6}
              textAnchor="middle"
              fontSize={17}
              fontWeight={700}
              fill="#A8650A"
              fontFamily="Poppins, system-ui, sans-serif"
            >
              ₹
            </text>
          </motion.g>
        </motion.g>
      ))}

      {/* Lid pops up and tilts */}
      <motion.g
        initial={{ y: 0, rotate: 0 }}
        animate={{ y: [0, -22, -12], rotate: [0, -10, -7] }}
        transition={{ delay: 0.35, duration: 0.6, ease: EASE_OUT }}
      >
        <rect x={80} y={110} width={120} height={24} rx={7} fill={AMBER_LIGHT} />
        <rect x={132} y={110} width={16} height={24} fill={NAVY_DEEP} />
        <path d="M140 110 C 124 92, 108 102, 122 110 Z" fill={NAVY} />
        <path d="M140 110 C 156 92, 172 102, 158 110 Z" fill={NAVY} />
      </motion.g>

      {/* Sparkles */}
      {SPARKLES.map((sp) => (
        <motion.path
          key={sp.x}
          d={`M${sp.x} ${sp.y - 10 * sp.s} Q${sp.x + 2 * sp.s} ${sp.y - 2 * sp.s} ${sp.x + 10 * sp.s} ${sp.y} Q${sp.x + 2 * sp.s} ${sp.y + 2 * sp.s} ${sp.x} ${sp.y + 10 * sp.s} Q${sp.x - 2 * sp.s} ${sp.y + 2 * sp.s} ${sp.x - 10 * sp.s} ${sp.y} Q${sp.x - 2 * sp.s} ${sp.y - 2 * sp.s} ${sp.x} ${sp.y - 10 * sp.s} Z`}
          fill={AMBER}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0, 1.15, 0.85, 1], opacity: [0, 1, 0.7, 1] }}
          transition={{ delay: sp.delay, duration: 1.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
      ))}
    </Canvas>
  );
}
