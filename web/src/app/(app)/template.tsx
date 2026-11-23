"use client";
import { useRef } from "react";
import { motion } from "motion/react";
import { enterWorkspace } from "@/lib/motion";

// Each workspace rises out of depth when you arrive. During a shared-element morph the View Transition
// already animates the change, so the entrance is skipped to keep the destination snapshot crisp.
// When the entrance ends, transform and filter are cleared: either would otherwise become the containing
// block for fixed-position sheets and dialogs inside the page.
export default function Template({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const morphing = typeof document !== "undefined" && document.documentElement.dataset.vt === "1";
  return (
    <motion.div ref={ref} initial={morphing ? false : enterWorkspace.initial} animate={enterWorkspace.animate} transition={enterWorkspace.transition}
      onAnimationComplete={() => { if (ref.current) { ref.current.style.filter = ""; ref.current.style.transform = ""; ref.current.style.willChange = ""; } }}>
      {children}
    </motion.div>
  );
}
