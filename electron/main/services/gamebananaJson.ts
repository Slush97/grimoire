// GameBanana sometimes answers 200 with PHP warnings printed ahead of the JSON
// body (e.g. `Warning: Undefined array key "images" ...` on /Posts). Retry from
// the first JSON token, then from the first one opening a line (the warning
// itself can contain brackets, e.g. `$arr['images']`); anything else still throws.
export function parseGameBananaJson<T>(text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (err) {
        for (const start of [text.search(/[{[]/), text.search(/(?<=\n)[{[]/)]) {
            if (start <= 0) continue;
            try {
                return JSON.parse(text.slice(start)) as T;
            } catch {
                // Try the next candidate start.
            }
        }
        throw err;
    }
}
