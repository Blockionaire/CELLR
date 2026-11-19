"use client";

import type { RenderModel, StoredBottle } from "../storage3d/model";
import TemplateScene from "../storage3d/template-scene";

/**
 * The builder's live picture (sprint 3): the existing storage renderer (sprint 2A, premium look of 2B.2), and only
 * that. This module is loaded on its own (next/dynamic from rack-builder.tsx), so three.js reaches the browser only
 * when the builder shows a picture. The canvas stays as the draft changes: a new model rebuilds what is drawn
 * inside it, and the camera is placed again only when the place changes size.
 */
export interface BuilderPreviewProps {
  model: RenderModel;
  bottles: readonly StoredBottle[];
  selectedId: string | null;
  onPick: (id: string | null) => void;
  reducedMotion: boolean;
  onLost: () => void;
  onReady?: (() => void) | undefined;
  debug: boolean;
}

export default function BuilderPreview({
  model,
  bottles,
  selectedId,
  onPick,
  reducedMotion,
  onLost,
  onReady,
  debug,
}: BuilderPreviewProps) {
  return (
    <TemplateScene
      model={model}
      bottles={bottles}
      selectedId={selectedId}
      onPick={onPick}
      reducedMotion={reducedMotion}
      onLost={onLost}
      onReady={onReady}
      debug={debug}
    />
  );
}
