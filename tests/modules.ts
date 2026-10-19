// convex-test normally gets its module map from Vite's import.meta.glob; build the same map with Bun.
const dir = new URL("../convex/", import.meta.url).pathname;

export const modules: Record<string, () => Promise<unknown>> = {};
for (const file of new Bun.Glob("**/*.{ts,js}").scanSync({ cwd: dir })) {
  if (file.endsWith(".d.ts")) continue;
  modules[`../convex/${file}`] = () => import(`${dir}${file}`);
}
