"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";

export type CapturePhase = "gathering" | "thinking" | "releasing";

type CaptureOrbitProps = {
  text: string;
  phase: CapturePhase;
};

const MAX_VISIBLE_WORDS = 44;
const PARTICLE_COUNT = 92;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
  const y = 1 - (2 * (index + 0.5)) / PARTICLE_COUNT;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * GOLDEN_ANGLE;
  return {
    x: Math.cos(angle) * radius * 82,
    y: y * 82,
    z: Math.sin(angle) * radius * 82,
    size: index % 9 === 0 ? 3.5 : index % 4 === 0 ? 2.6 : 1.8
  };
});

/**
 * A presentation-only handoff: text converges, the sphere stays alive while
 * the caller is working, and disperses when the actual result is available.
 * The caller, not this animation, owns the processing lifecycle.
 */
export function CaptureOrbit({ text, phase }: CaptureOrbitProps) {
  const words = useMemo(
    () => text.trim().split(/\s+/).filter(Boolean).slice(0, MAX_VISIBLE_WORDS),
    [text]
  );
  const totalWords = text.trim().split(/\s+/).filter(Boolean).length;
  const status =
    phase === "gathering"
      ? "Collecting your thoughts"
      : phase === "thinking"
        ? "Organizing your capture"
        : "Your next steps are ready";

  return (
    <div className={`capture-orbit phase-${phase}`} role="status" aria-live="polite">
      <div className="capture-orbit-visual" aria-hidden="true">
        <div className="capture-orbit-words">
          {words.map((word, index) => {
            const angle = index * GOLDEN_ANGLE;
            const radius = 42 + 145 * Math.sqrt((index + 0.5) / Math.max(words.length, 1));
            const style = {
              "--source-x": `${Math.cos(angle) * radius}px`,
              "--source-y": `${Math.sin(angle) * radius * 0.62}px`,
              "--word-delay": `${(index % 11) * 22}ms`
            } as CSSProperties;
            return (
              <span className="capture-orbit-word" style={style} key={`${index}-${word}`}>
                {word}
              </span>
            );
          })}
          {totalWords > MAX_VISIBLE_WORDS && (
            <span className="capture-orbit-overflow">+{totalWords - MAX_VISIBLE_WORDS} words</span>
          )}
        </div>

        <div className="capture-orbit-sphere">
          <div className="capture-orbit-halo capture-orbit-halo-one" />
          <div className="capture-orbit-halo capture-orbit-halo-two" />
          <div className="capture-orbit-particles">
            {particles.map((particle, index) => {
              const style = {
                "--particle-x": `${particle.x.toFixed(2)}px`,
                "--particle-y": `${particle.y.toFixed(2)}px`,
                "--particle-z": `${particle.z.toFixed(2)}px`,
                "--particle-size": `${particle.size}px`
              } as CSSProperties;
              return <span className="capture-orbit-particle" style={style} key={index} />;
            })}
          </div>
          <span className="capture-orbit-center" />
        </div>
      </div>
      <div className="capture-orbit-caption">
        <span className="capture-orbit-pulse" aria-hidden="true" />
        <span>{status}</span>
      </div>
    </div>
  );
}
