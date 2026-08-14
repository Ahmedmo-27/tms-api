/** Escape user input before embedding in a MongoDB `$regex` / RegExp. */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
