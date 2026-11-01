// The last notification sent to Discord that didn't get there (a deleted webhook answers 404), so
// the Notifications sheet can say so instead of failing quietly. Cleared by the next one that does.
export const discordStatus = $state<{ failed: string | null; at: number }>({ failed: null, at: 0 });

export function discordSent(error: unknown | null) {
  discordStatus.failed = error == null ? null : String(error).replace(/^Error:\s*/, "");
  discordStatus.at = Date.now();
}
