// Ambient declaration for 'undici' to satisfy TypeScript in editor
// Provides minimal typing for the named fetch export used in server routes.
declare module 'undici' {
  export function fetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response>;
}