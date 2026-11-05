import { createRequestHandler, RouterContextProvider } from "react-router";
import { createDb } from "../app/db/repo";
import { mailerFromEnv } from "../app/lib/resend";
import { isReminderHour } from "../app/lib/reminder";
import { runReminderCron } from "../app/lib/reminder-cron";
import { createLogger } from "../app/lib/logger";
import { lokiSinkFromEnv } from "../app/lib/loki";

// `./context.d.ts` augments `RouterContextProvider` with `cloudflare` and `log`; it is
// an ambient type-only file picked up via tsconfig's "include", not imported.

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.cloudflare = { env, ctx };
    // one Loki push per request, after the response is on its way
    context.log = createLogger(lokiSinkFromEnv(env), "http");
    const response = await requestHandler(request, context);
    ctx.waitUntil(context.log.flush());
    return response;
  },

  // Daily review reminder. Two crons (17:00 and 18:00 UTC) cover CEST and CET;
  // the hour guard keeps only the one that is 19:00 in Warsaw.
  async scheduled(controller, env, ctx) {
    const t = controller.scheduledTime;
    if (!isReminderHour(t)) return;
    ctx.waitUntil(
      runReminderCron(
        {
          db: createDb(env.DB),
          appUrl: env.APP_URL,
          mailerFor: (to) => mailerFromEnv(env, to),
          ownerFallback: env.REMINDER_TO,
          log: createLogger(lokiSinkFromEnv(env), "cron"),
        },
        t,
      ),
    );
  },
} satisfies ExportedHandler<Env>;
