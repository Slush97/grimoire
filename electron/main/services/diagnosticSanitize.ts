import os from 'os';

// Redaction rules applied to every report body and to the saved .txt file.
// Order matters: more-specific patterns (Authorization headers) run before
// generic ones (bearer tokens). All replacements use opaque placeholders so a
// reader can tell a value was redacted versus simply absent.
const SANITIZERS: Array<{ pattern: RegExp; replacement: string }> = [
    // Linux/macOS home paths: keep the path structure, drop the username.
    // The path after the home dir (a SteamLibrary mount, for example) isn't
    // PII; the username is.
    { pattern: /\/home\/[^/\s"'`]+/g, replacement: '/home/<user>' },
    { pattern: /\/Users\/[^/\s"'`]+/g, replacement: '/Users/<user>' },
    // Windows: `C:\Users\Alice\...` -> `C:\Users\<user>\...`. The `\\{1,2}` also
    // catches the doubled-backslash form `C:\\Users\\Alice\\...` that
    // util.inspect emits when electron-log serializes an object argument.
    { pattern: /([A-Za-z]:\\{1,2}Users\\{1,2})[^\\\s"'`]+/gi, replacement: '$1<user>' },

    // SteamID64 — real Steam user IDs start 7656119 and are 17 digits.
    { pattern: /\b7656119\d{10}\b/g, replacement: '<steamid64>' },
    // 32-bit account id in deadlock-api / Steam URLs.
    { pattern: /(account_id=|\/players?\/)(\d{4,12})/g, replacement: '$1<accountid>' },

    // Authorization headers / bearer tokens / JWTs / Steam OpenID secrets.
    { pattern: /(Authorization:\s*Bearer\s+)\S+/gi, replacement: '$1<token>' },
    { pattern: /(Bearer\s+)[A-Za-z0-9._-]{10,}/g, replacement: '$1<token>' },
    { pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replacement: '<jwt>' },

    // Emails (in case a user pastes one into the description).
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
];

/** Strip PII / secrets from a diagnostic-bound string. A first pass wipes any
 *  literal occurrence of the running user's home dir; the structured patterns
 *  above then cover everything else (other users' paths, tokens, emails). */
export function sanitize(text: string): string {
    let out = text;
    // Home dir first: the structured patterns stop at whitespace, so a username
    // with a space (`C:\Users\John Smith`) would otherwise be half-redacted into
    // something this pass can no longer match literally.
    const home = os.homedir();
    if (home && home.length > 3) {
        // Doubled-backslash form before the plain one: util.inspect escapes
        // backslashes when electron-log serializes an object argument.
        for (const variant of [home.replace(/\\/g, '\\\\'), home]) {
            const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp(escaped, 'gi'), '<home>');
        }
    }
    for (const { pattern, replacement } of SANITIZERS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}
