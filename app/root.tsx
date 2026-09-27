import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { parseTheme, THEME_BG } from "./lib/theme";
import "./app.css";

// No requireAuth: this also runs for /login and returns only a non-sensitive preference
export async function loader({ request }: Route.LoaderArgs) {
  return { theme: parseTheme(request.headers.get("Cookie")) };
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap",
  },
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // undefined on error renders → auto
  const theme = useRouteLoaderData<typeof loader>("root")?.theme ?? "auto";
  return (
    <html lang="en" data-theme={theme === "auto" ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {theme === "auto" ? (
          <>
            <meta name="theme-color" media="(prefers-color-scheme: light)" content={THEME_BG.light} />
            <meta name="theme-color" media="(prefers-color-scheme: dark)" content={THEME_BG.dark} />
          </>
        ) : (
          <meta name="theme-color" content={THEME_BG[theme]} />
        )}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
