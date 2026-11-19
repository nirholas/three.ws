# vendor/ffmpeg-wasm

The single-threaded core of [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm).
`src/walk-capture.js` loads it from `/vendor/ffmpeg-wasm/` to transmux WebM
clips to MP4 in browsers that cannot record MP4 directly.

| File | Origin |
|---|---|
| `ffmpeg-core.js` | Byte-identical to `dist/esm/ffmpeg-core.js` in `@ffmpeg/core` 0.12.9 and 0.12.10 |
| `ffmpeg-core.wasm` | ffmpeg.wasm core build. It does not byte-match the `.wasm` in any published `@ffmpeg/core` release |

## License

`@ffmpeg/core` is licensed under the GNU General Public License, version 2 or
later (GPL-2.0-or-later). The full license text is in [LICENSE](LICENSE). The
core is a WebAssembly build of [FFmpeg](https://ffmpeg.org/) together with
libraries such as x264, which are under the GPL or LGPL.

Corresponding source:

- ffmpeg.wasm v0.12.10: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10
- FFmpeg: https://ffmpeg.org/download.html

These files are distributed under their own license above. The rest of this
repository is licensed as stated in the repository LICENSE.
