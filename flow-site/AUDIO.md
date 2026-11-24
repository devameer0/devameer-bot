# Office audio

All sounds in the 3D office (keyboard typing, mouse clicks, handoff chimes,
buy cheers, reject “nope” tones, room hum, AC, chair creaks, and distant
murmur) are synthesized at runtime with the Web Audio API.

No third-party samples are bundled, so no external audio license applies.

Default master volume is 0.9 (90%), with a pre-gain of 2.4 into a compressor
(threshold -18 dB, ratio 4) and a limiter (threshold -3 dB, ratio 18) so typing,
clicks, and handoff chimes stay clearly audible without clipping. Room tone is
kept quieter than those cues. The first visit shows a “Tap to enable sound”
overlay because browsers block autoplay; volume is stored under
`devameer-flow-volume-v3`.
