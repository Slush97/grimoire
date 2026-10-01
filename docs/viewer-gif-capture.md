# Viewer GIF capture

Recording samples the viewer canvas without quantization, then opens a looping
canvas preview. A single thumbnail timeline has two trim edge handles and an independent
playhead. Click or drag inside the selected range to preview a frame; Arrow
keys, Home and End support keyboard adjustments. Shift plus Arrow moves by
one second. The handles keep a one-frame minimum and cannot cross. Save GIF encodes that
range; Retake and Cancel discard it. Closing or changing the source aborts
pending capture or encoding. Save leaves the review available for another trim.

Capture is bounded to four seconds, 48 frames, and 480 pixels on the longest
edge. The largest raw sequence is about 44 MiB. Encoding yields between frames,
uses at most 512 adaptive input colors for gifenc's reduction, and bounds the
output to 24 MiB. Weighted median cuts preserve shading without forcing every
pixel onto an eight-level RGB cube. Subtle ordered dithering reduces banding.
Each GIF palette still has at most 256 entries. Alpha below 128 uses a separately
reserved transparent entry; opaque black stays opaque. Quantization operates on
copies, preserving the raw preview and permitting repeated trimmed saves.

The fixed toolbar keeps play/pause, auto-rotate, capture, cancel and fullscreen
on one row. The review panel appears above it and has its own playback control.

## Validation

Focused tests cover palette bounds, grayscale error, transparent edges, opaque
black, trim bounds, keyboard/pointer capture, cancellation, repeated capture,
source changes, unmount and controls disabled during encoding.

```bash
pnpm exec vitest run src/lib/viewerGif.test.ts src/lib/useViewerGif.test.tsx src/components/locker/ViewerGifTimeline.test.tsx
```

Packaged acceptance should decode saved output, verify frame count/dimensions,
looping and transparency, and exercise retake, cancel and repeated trimmed saves.
See [viewer development](viewer-development.md) for isolated runtime checks.
