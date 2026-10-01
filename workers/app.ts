import { createRequestHandler, RouterContextProvider } from "react-router";
import { createDb } from "../app/db/repo";
import { mailerFromEnv } from "../app/lib/resend";
import { isReminderHour } from "../app/lib/reminder";
import { runAllReminders } from "../app/lib/reminder-job";

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

  // Daily review reminder. Two crons (17:00 and 18:00 UTC) cover CEST and CET;
  // the hour guard keeps only the one that is 19:00 in Warsaw.
  async scheduled(controller, env, ctx) {
    const t = controller.scheduledTime;
    if (!isReminderHour(t)) return;
    const db = createDb(env.DB);
    ctx.waitUntil(
      runAllReminders(
        { db, appUrl: env.APP_URL, mailerFor: (to) => mailerFromEnv(env, to), ownerFallback: env.REMINDER_TO },
        t,
      ).then((results) => {
        for (const r of results) {
          if (r.error) console.error(`reminder: user ${r.userId} failed ${r.error}`);
          else console.log(`reminder: user ${r.userId} ${JSON.stringify(r.result)}`);
        }
      }, (err) => console.error(`reminder: run failed ${err instanceof Error ? err.message : String(err)}`)),
    );
  },
} satisfies ExportedHandler<Env>;
