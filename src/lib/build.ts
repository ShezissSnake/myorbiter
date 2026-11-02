// Which build this is: the commit and its date, set when the app is built (vite.config.ts).
declare const __ORBITER_BUILD__: { commit: string; date: string } | undefined;

export const BUILD: { commit: string; date: string } = typeof __ORBITER_BUILD__ !== "undefined" ? __ORBITER_BUILD__ : { commit: "dev", date: "" };
