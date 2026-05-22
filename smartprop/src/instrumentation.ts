/**
 * Next.js Instrumentation Hook
 * Runs once at server startup to initialize background services.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    await registerNodeInstrumentation();
    return;
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    console.log("[Instrumentation] Skipping in edge runtime");
    return;
  }

  if (process.env.NEXT_RUNTIME) {
    console.log(`[Instrumentation] Skipping in ${process.env.NEXT_RUNTIME || "unknown"} runtime`);
  }
}
