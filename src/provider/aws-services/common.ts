/** How long --wait waits before giving up (AWS waiters poll until then). */
export const MAX_WAIT_SECONDS = 30 * 60;

/** { Key: Value } -> [{ Key, Value }], the shape most AWS APIs take. */
export function toTagList(tags: Record<string, string> = {}): { Key: string; Value: string }[] {
    return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}
