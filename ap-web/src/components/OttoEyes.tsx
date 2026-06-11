import { useEffect, useId, useRef, type CSSProperties } from "react";

// Eye geometry in the SVG's own viewBox coordinate system (0 0 39 41).
// Each eye is a fixed white circle with a black pupil drawn on top; the pupil
// can slide until its rim meets the inner edge of the white, i.e. up to
// (whiteRadius - pupilRadius) away from the eye center.
const VIEWBOX_W = 39;
const VIEWBOX_H = 41;
const WHITE_RADIUS = 6.0831;
const PUPIL_RADIUS = 4.7426;
// How far a pupil may travel before its edge touches the white rim. Capped a
// touch below that geometric max for a slightly subtler look.
const MAX_OFFSET = Math.min(0.8, WHITE_RADIUS - PUPIL_RADIUS);

// Eye centers (matches the white-circle / black-pupil paths below).
const EYE_CENTERS = [
  { cx: 9.8596, cy: 19.2157 },
  { cx: 28.2792, cy: 19.2157 },
];

// Smooths each pupil's slide toward its target rather than snapping.
const PUPIL_STYLE: CSSProperties = {
  transition: "transform 90ms ease-out",
  willChange: "transform",
};

/**
 * The Omnigent octopus logo with eyes that track the cursor: each black pupil
 * slides to the inner edge of its white eye on the side nearest the pointer.
 *
 * The SVG is inlined (rather than referenced via `<img>`) so the two pupil
 * groups — the black disc plus its highlight glints — can be transformed on
 * pointer move. Updates are coalesced into a single rAF callback and applied
 * straight to the DOM nodes, so tracking the cursor never re-renders React.
 * Respects `prefers-reduced-motion` by leaving the pupils centered.
 */
export function OttoEyes({ className }: { className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const leftPupilRef = useRef<SVGGElement>(null);
  const rightPupilRef = useRef<SVGGElement>(null);
  // Unique per instance so the clipPath id never collides if more than one
  // logo is mounted at once (e.g. during a route transition).
  const clipId = useId();

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const pupils = [leftPupilRef.current, rightPupilRef.current];
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;

    const apply = () => {
      frame = 0;
      if (!pointer) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      EYE_CENTERS.forEach((eye, i) => {
        const pupil = pupils[i];
        if (!pupil) return;
        // Eye center in screen space. The viewBox maps uniformly into the
        // rendered box (matching aspect ratio, default preserveAspectRatio),
        // so a single scale per axis is exact.
        const eyeX = rect.left + (eye.cx / VIEWBOX_W) * rect.width;
        const eyeY = rect.top + (eye.cy / VIEWBOX_H) * rect.height;
        const dx = pointer!.x - eyeX;
        const dy = pointer!.y - eyeY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.0001) {
          pupil.style.transform = "translate(0px, 0px)";
          return;
        }
        // Always ride the rim toward the cursor. translate() px units on an
        // SVG element resolve to user-space units, so MAX_OFFSET is correct.
        const tx = (dx / dist) * MAX_OFFSET;
        const ty = (dy / dist) * MAX_OFFSET;
        pupil.style.transform = `translate(${tx.toFixed(3)}px, ${ty.toFixed(3)}px)`;
      });
    };

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      width="39"
      height="41"
      viewBox="0 0 39 41"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Omnigent"
    >
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M35.8491 31.0962C35.4068 28.9766 35.7028 26.7413 36.8085 24.8769C37.6658 23.431 38.1387 21.5394 38.1387 19.0694C38.1387 8.53614 29.5992 0 19.0694 0C8.53954 0 0 8.53614 0 19.0694C0 21.5428 0.472907 23.431 1.33026 24.8769C2.41217 26.7005 2.72177 28.8881 2.33051 30.9737C2.27608 31.2697 2.23185 31.4976 2.20123 31.6201C1.35408 35.3455 0.904987 37.1623 1.20778 38.2782C1.46975 39.2377 2.09916 39.9725 2.98374 40.3468C3.3954 40.5203 3.83769 40.6087 4.29359 40.6087C4.9332 40.6087 5.59663 40.4352 6.22264 40.095C7.14123 39.5949 8.92059 37.1487 10.6863 34.461C10.9449 36.754 11.2919 38.7205 11.724 39.418C12.2616 40.2923 13.0985 40.8435 14.0783 40.9694C14.2144 40.9864 14.3505 40.9966 14.4866 40.9966C15.4052 40.9966 16.3238 40.6121 17.0519 39.9045C17.62 39.3533 18.3345 37.6182 19.0694 35.3966C19.8042 37.6148 20.5153 39.3533 21.0869 39.9045C21.8184 40.6087 22.7335 40.9966 23.6521 40.9966C23.7882 40.9966 23.9243 40.9898 24.0604 40.9694C25.0402 40.8469 25.8772 40.2957 26.4147 39.418C26.8468 38.7171 27.1938 36.754 27.4524 34.4576C29.2182 37.1453 30.9975 39.5915 31.9161 40.0916C32.5387 40.4318 33.2021 40.6053 33.8452 40.6053C34.3011 40.6053 34.7433 40.5203 35.155 40.3434C36.0362 39.9657 36.669 39.2309 36.931 38.2748C37.2372 37.1589 36.7234 34.9271 35.8763 31.205C35.8695 31.1744 35.8593 31.137 35.8525 31.0928L35.8491 31.0962Z"
          fill="#F43BA6"
        />
        <path
          d="M16.698 26.163C18.0283 27.6055 20.4779 27.5715 21.4407 26.1017"
          stroke="black"
          strokeWidth="1.36088"
          strokeMiterlimit="10"
          strokeLinecap="round"
        />
        <path
          d="M27.5579 28.6262C28.8131 28.6262 29.8306 28.0565 29.8306 27.3537C29.8306 26.651 28.8131 26.0813 27.5579 26.0813C26.3027 26.0813 25.2852 26.651 25.2852 27.3537C25.2852 28.0565 26.3027 28.6262 27.5579 28.6262Z"
          fill="#FF75C3"
        />
        <path
          d="M10.5809 28.6262C11.836 28.6262 12.8535 28.0565 12.8535 27.3537C12.8535 26.651 11.836 26.0813 10.5809 26.0813C9.32571 26.0813 8.3082 26.651 8.3082 27.3537C8.3082 28.0565 9.32571 28.6262 10.5809 28.6262Z"
          fill="#FF75C3"
        />
        {/* Left eye: fixed white, then the pupil group rides the rim. */}
        <path
          d="M9.8596 25.2988C13.2192 25.2988 15.9428 22.5753 15.9428 19.2157C15.9428 15.856 13.2192 13.1325 9.8596 13.1325C6.49998 13.1325 3.77646 15.856 3.77646 19.2157C3.77646 22.5753 6.49998 25.2988 9.8596 25.2988Z"
          fill="white"
        />
        <g ref={leftPupilRef} style={PUPIL_STYLE}>
          <path
            d="M9.85962 23.9583C12.4789 23.9583 14.6023 21.835 14.6023 19.2157C14.6023 16.5964 12.4789 14.473 9.85962 14.473C7.24031 14.473 5.11694 16.5964 5.11694 19.2157C5.11694 21.835 7.24031 23.9583 9.85962 23.9583Z"
            fill="black"
          />
          <path
            d="M6.05595 19.5049C6.80003 19.5049 7.40323 18.9017 7.40323 18.1576C7.40323 17.4135 6.80003 16.8103 6.05595 16.8103C5.31187 16.8103 4.70868 17.4135 4.70868 18.1576C4.70868 18.9017 5.31187 19.5049 6.05595 19.5049Z"
            fill="white"
          />
          <path
            d="M8.62119 20.91C9.13039 20.91 9.54318 20.4972 9.54318 19.988C9.54318 19.4788 9.13039 19.066 8.62119 19.066C8.11198 19.066 7.69919 19.4788 7.69919 19.988C7.69919 20.4972 8.11198 20.91 8.62119 20.91Z"
            fill="white"
          />
        </g>
        {/* Right eye: fixed white, then the pupil group rides the rim. */}
        <path
          d="M28.2792 25.2988C31.6388 25.2988 34.3623 22.5753 34.3623 19.2157C34.3623 15.856 31.6388 13.1325 28.2792 13.1325C24.9195 13.1325 22.196 15.856 22.196 19.2157C22.196 22.5753 24.9195 25.2988 28.2792 25.2988Z"
          fill="white"
        />
        <g ref={rightPupilRef} style={PUPIL_STYLE}>
          <path
            d="M28.2792 23.9583C30.8985 23.9583 33.0219 21.835 33.0219 19.2157C33.0219 16.5964 30.8985 14.473 28.2792 14.473C25.6599 14.473 23.5365 16.5964 23.5365 19.2157C23.5365 21.835 25.6599 23.9583 28.2792 23.9583Z"
            fill="black"
          />
          <path
            d="M24.4755 19.5049C25.2196 19.5049 25.8228 18.9017 25.8228 18.1576C25.8228 17.4135 25.2196 16.8103 24.4755 16.8103C23.7314 16.8103 23.1282 17.4135 23.1282 18.1576C23.1282 18.9017 23.7314 19.5049 24.4755 19.5049Z"
            fill="white"
          />
          <path
            d="M27.0374 20.91C27.5466 20.91 27.9594 20.4972 27.9594 19.988C27.9594 19.4788 27.5466 19.066 27.0374 19.066C26.5281 19.066 26.1154 19.4788 26.1154 19.988C26.1154 20.4972 26.5281 20.91 27.0374 20.91Z"
            fill="white"
          />
        </g>
      </g>
      <defs>
        <clipPath id={clipId}>
          <rect width="38.2667" height="41" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
