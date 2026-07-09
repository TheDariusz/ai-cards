import { createRequestHandler, RouterContextProvider } from "react-router";

// `./context.d.ts` augments `RouterContextProvider` with `cloudflare`; it is
// an ambient type-only file picked up via tsconfig's "include", not imported.

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.cloudflare = { env, ctx };
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
