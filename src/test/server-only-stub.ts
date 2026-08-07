// Server-only code under test needs `import "server-only"` to be a no-op —
// vitest runs in Node, not the RSC client/server split that package guards.
export {};
