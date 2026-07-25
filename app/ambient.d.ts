// Ambient module declarations for deps that ship without TypeScript types.
// ffprobe-static provides a { path } default export at runtime; we cast it
// where used, so an untyped module declaration is enough to satisfy tsc.
declare module "ffprobe-static";
