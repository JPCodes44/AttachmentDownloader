// convex-test normally gets its module maps from Vite's import.meta.glob; build the same maps with Bun.
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

function glob(dir: string, prefix: string) {
  const map: Record<string, () => Promise<unknown>> = {};
  for (const file of new Bun.Glob("**/*.{ts,js}").scanSync({ cwd: dir })) {
    if (file.endsWith(".d.ts") || file.endsWith(".test.ts")) continue;
    map[`${prefix}${file}`] = () => import(`${dir}${file}`);
  }
  return map;
}

export const modules = glob(new URL("../convex/", import.meta.url).pathname, "../convex/");

// The rate limiter component (and the batch worker it mounts), as convex.config.ts installs them.
const pkg = (name: string) => new URL(`../node_modules/@convex-dev/${name}/src/`, import.meta.url).pathname;

export async function registerComponents(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>) {
  const rateLimiterSchema = (await import(`${pkg("rate-limiter")}component/schema.ts`)).default;
  const batchWorkerSchema = (await import(`${pkg("batch-worker")}component/schema.ts`)).default;
  t.registerComponent("rateLimiter", rateLimiterSchema, glob(`${pkg("rate-limiter")}component/`, "./component/"));
  t.registerComponent(
    "rateLimiter/batchWorker",
    batchWorkerSchema,
    glob(`${pkg("batch-worker")}component/`, "./component/"),
  );
}
