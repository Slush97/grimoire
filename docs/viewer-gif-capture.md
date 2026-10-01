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

Focused tests cover palette bounds, grayscale error, transparent edges, opaque
black, trim bounds, cancellation, repeat capture, source changes and unmount.
Windows packaged interaction was checked with real Dynamo assets in a separate
hidden test profile. A 44-frame capture trimmed to frames 2 through 42 produced
a 41-frame 480 by 347 GIF. Idle, recording, encoding and review toolbar rows all
measured 318 by 36 pixels, with no wrapping. Private screenshots and asset inputs
remain outside source control.

The single-timeline update adds focused keyboard, pointer-capture, cancel,
unmount and encoding-disable checks. The separate packaged timeline candidate
was rendered and inspected with the original package and profile preserved.
