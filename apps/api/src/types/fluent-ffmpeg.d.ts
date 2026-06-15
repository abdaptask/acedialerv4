// v0.10.150 hotfix - Ambient module declaration for fluent-ffmpeg.
//
// We DO have @types/fluent-ffmpeg in dependencies (post-hotfix), but Render
// has been intermittently flaky about installing devDependencies during
// the build phase. This .d.ts is a belt-and-suspenders fallback: if the
// @types package somehow doesn't make it into node_modules, tsc still has
// enough to resolve the import and check the call sites in
// voicemailGreeting.routes.ts.
//
// Only declares the methods we actually use. If we expand fluent-ffmpeg
// usage in the future and add new calls, this file may need extending
// (or you can rely entirely on the real @types package).

declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    audioCodec(codec: string): FfmpegCommand;
    audioBitrate(bitrate: string | number): FfmpegCommand;
    audioChannels(channels: number): FfmpegCommand;
    // v0.10.152 - added when we switched the voicemail-greeting
    // transcode output to WAV at 48 kHz. TypeScript prefers explicit
    // declare-module fallbacks over @types/fluent-ffmpeg in resolution
    // order, so any method we call on FfmpegCommand has to be listed
    // here or it surfaces as TS2339 even when @types is installed.
    audioFrequency(freq: number): FfmpegCommand;
    toFormat(format: string): FfmpegCommand;
    on(event: 'end', listener: () => void): FfmpegCommand;
    on(event: 'error', listener: (err: Error) => void): FfmpegCommand;
    on(event: string, listener: (...args: unknown[]) => void): FfmpegCommand;
    save(output: string): FfmpegCommand;
  }
  function ffmpeg(input?: string): FfmpegCommand;
  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
  }
  export = ffmpeg;
}
