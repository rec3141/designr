"use client";
import { motion, useMotionValue, useTransform, useDragControls, PanInfo } from "framer-motion";
import type { Pin, SwipeChoice } from "@/lib/types";

type Props = {
  pin: Pin;
  note: string;
  onNoteChange: (v: string) => void;
  onDecide: (choice: SwipeChoice) => void;
  isTop: boolean;
  zIndex: number;
  recording?: boolean;
  onToggleVoice?: () => void;
};

export default function SwipeCard({ pin, note, onNoteChange, onDecide, isTop, zIndex, recording, onToggleVoice }: Props) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-18, 0, 18]);
  const likeOpacity = useTransform(x, [40, 150], [0, 1]);
  const dislikeOpacity = useTransform(x, [-150, -40], [1, 0]);
  // Manually controlled drag so we can restrict it to the image area only —
  // otherwise framer-motion grabs pointer events on the whole card and makes
  // it impossible to text-select inside the note textarea on desktop.
  const dragControls = useDragControls();

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const threshold = 120;
    if (info.offset.x > threshold) onDecide("like");
    else if (info.offset.x < -threshold) onDecide("dislike");
  }

  return (
    <motion.div
      className="swipe-card"
      style={{
        x,
        rotate,
        zIndex,
        pointerEvents: isTop ? "auto" : "none",
      }}
      drag={isTop ? "x" : false}
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      onDragEnd={handleDragEnd}
      initial={{ scale: isTop ? 1 : 0.96, y: isTop ? 0 : 10 }}
      animate={{ scale: isTop ? 1 : 0.96, y: isTop ? 0 : 10 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pin.imageUrl}
        alt={pin.title ?? ""}
        draggable={false}
        onPointerDown={(e) => {
          if (isTop) dragControls.start(e);
        }}
        style={{ cursor: isTop ? "grab" : "default" }}
      />
      <div className="card-body">
        {pin.title && <div className="card-title">{pin.title}</div>}
        {isTop ? (
          <>
            <textarea
              placeholder="Optional note — what do you feel about this?"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
            />
            {onToggleVoice && (
              <button
                className={`record-bar${recording ? " recording" : ""}`}
                onClick={onToggleVoice}
                aria-label={recording ? "Stop recording" : "Dictate a note"}
                type="button"
              >
                {recording ? "🎙 Recording… tap to stop" : "🎙 Dictate a note"}
              </button>
            )}
          </>
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </div>
      <motion.div className="stamp like" style={{ opacity: likeOpacity }}>
        LIKE
      </motion.div>
      <motion.div className="stamp dislike" style={{ opacity: dislikeOpacity }}>
        NOPE
      </motion.div>
    </motion.div>
  );
}
