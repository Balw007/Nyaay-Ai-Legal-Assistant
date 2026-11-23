// Nyaay motion language. One vocabulary for every moving thing, so motion reads as one system.
// Springs for things that move in space (panels, indicators, sheets); tweens for fades and colour.
// Reduced motion: <MotionConfig reducedMotion="user"> in providers.tsx turns transforms off globally;
// CSS durations collapse via the prefers-reduced-motion block in globals.css.
import type { Transition } from "motion/react";

export const spring = {
  /** Indicators, toggles, small controls: arrives fast, settles without wobble. */
  snappy: { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } as Transition,
  /** Panels, sheets, the rail: confident, slight follow-through. */
  smooth: { type: "spring", stiffness: 320, damping: 34, mass: 0.9 } as Transition,
  /** Large surfaces and workspace changes: soft, unhurried. */
  gentle: { type: "spring", stiffness: 190, damping: 28, mass: 1 } as Transition,
};

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};

export const dur = { instant: 0.12, quick: 0.2, base: 0.32, slow: 0.52 };

/** Workspace entrance: rises gently into place, never slides sideways. */
export const enterWorkspace = {
  // Starts partly visible so the largest paint is not held back; no blur (a full-page filter is costly on low-end laptops).
  initial: { opacity: 0.4, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: dur.base, ease: ease.out },
};

/** Floating surfaces (L4): grow from their origin. */
export const floatIn = {
  initial: { opacity: 0, scale: 0.96, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: -4, transition: { duration: dur.quick, ease: ease.out } },
  transition: spring.smooth,
};

export const sheetIn = {
  initial: { opacity: 0, x: 28 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20, transition: { duration: dur.quick } },
  transition: spring.smooth,
};
