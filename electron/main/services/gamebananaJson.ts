// GameBanana sometimes answers 200 with PHP warnings printed ahead of the JSON
// body (e.g. `Warning: Undefined array key "images" ...` on /Posts). Retry from
// the first JSON token so the payload survives; anything else still throws.
export function parseGameBananaJson<T>(text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (err) {
        const start = text.search(/[{[]/);
        if (start <= 0) throw err;
        try {
            return JSON.parse(text.slice(start)) as T;
        } catch {
            throw err;
        }
    }
}
