import { createRequestHandler, RouterContextProvider } from "react-router";
import { createDb } from "../app/db/repo";
import { OWNER_USER_ID } from "../app/db/schema";
import { mailerFromEnv } from "../app/lib/resend";
import { isReminderHour } from "../app/lib/reminder";
import { runReminder } from "../app/lib/reminder-job";

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
    const mailer = mailerFromEnv(env);
    if (!mailer) {
      console.log("reminder: RESEND_API_KEY/REMINDER_TO not configured, skipping");
      return;
    }
    // REMINDER_TO is the owner's address, so only the owner is reminded for now
    ctx.waitUntil(
      runReminder({ db: createDb(env.DB), mailer, appUrl: env.APP_URL }, OWNER_USER_ID, t).then(
        (result) => console.log(`reminder: ${JSON.stringify(result)}`),
        (err) => console.error(`reminder: send failed ${err instanceof Error ? err.message : String(err)}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
