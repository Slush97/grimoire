import { describe, expect, it } from 'vitest';

import { parseGameBananaJson } from './gamebananaJson';

describe('parseGameBananaJson', () => {
    it('parses clean JSON', () => {
        expect(parseGameBananaJson('{"a":1}')).toEqual({ a: 1 });
        expect(parseGameBananaJson('[1,2]')).toEqual([1, 2]);
    });

    it('skips PHP warnings printed before the JSON body', () => {
        const text =
            '<br />\nWarning: Undefined array key "images" in /home/publisher/live/gamebanana/classes/Library/Cache/TableRowCacher.php on line 87\n' +
            '{\n    "_aMetadata": { "_nRecordCount": 1 },\n    "_aRecords": [{ "_idRow": 13943557 }]\n}';
        expect(parseGameBananaJson(text)).toEqual({
            _aMetadata: { _nRecordCount: 1 },
            _aRecords: [{ _idRow: 13943557 }],
        });
    });

    it('skips a warning that itself contains brackets', () => {
        const text =
            "<br />\nNotice: Undefined index [file] in $arr['images'] on line 12\n" + '{"_aRecords": []}';
        expect(parseGameBananaJson(text)).toEqual({ _aRecords: [] });
    });

    it('still throws on genuinely non-JSON bodies', () => {
        expect(() => parseGameBananaJson('<html><body>502 Bad Gateway</body></html>')).toThrow(SyntaxError);
        expect(() => parseGameBananaJson('Fatal error: {oops} not json')).toThrow(SyntaxError);
        expect(() => parseGameBananaJson('{"truncated":')).toThrow(SyntaxError);
    });
});
