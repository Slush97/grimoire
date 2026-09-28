import { describe, expect, it } from 'vitest';
import { inspectModSource } from './modSafetyPolicy';

const reasons = (source: string, js = true) => inspectModSource('fixture', source, js).map(f => f.reason);

describe('mod source policy', () => {
    it.each([
        'const x="file:///example.txt";',
        'const x="f\\x69le:" + "///example.txt";',
        'const a="fi",b="le:"; use(a+b);',
        'const x=`file:///example.txt`;',
    ])('blocks literal, escaped and folded file addresses: %s', source => {
        expect(reasons(source)).toContain('local-file');
    });
    it.each(['$.CreatePanel("CitadelHTMLPanel", parent, "");', 'panel["Set"+"URL"]("https://example.invalid");',
        'const x="javascript:void(0)";'])('blocks browser capabilities: %s', source => {
        expect(reasons(source)).toContain('browser');
    });
    it.each(['eval(code)', 'new Function(code)', 'globalThis["eval"](code)'])('flags dynamic execution: %s', source => {
        expect(reasons(source)).toContain('dynamic-code');
    });
    it('does not exempt minified or opaque scripts from consent', () => {
        expect(reasons('!function(a){a[decode(7)](decode(9))}(this);')).toEqual(['executable']);
    });
    it('ignores JavaScript comments and preserves JS entity strings', () => {
        expect(reasons('// file:///example\nconst harmless="&quot;";')).toEqual(['executable']);
    });
    it('fails closed on unsupported syntax', () => {
        expect(reasons('function {')).toContain('uninspectable');
    });
    it('does not mistake escaped localization quotes for a UNC hostname', () => {
        expect(reasons(String.raw`"description" "<span class=\\\"highlight\\\">Damage</span>"`, false)).toEqual([]);
    });
    it('still blocks UNC addresses in source and decoded JavaScript strings', () => {
        expect(reasons(String.raw`<Image src="\\server\share\image.png"/>`, false)).toContain('local-file');
        expect(reasons(String.raw`use("\\\\server\\share\\image.png")`)).toContain('local-file');
    });
    it('inspects markup entities and inline handlers', () => {
        expect(reasons('<Panel onload="run(\'file&#58;///example\')"/>', false)).toContain('local-file');
        expect(reasons('<Panel onactivate="eval(code)"/>', false)).toContain('dynamic-code');
    });
    it('allows a packaged stylesheet include without mistaking s2r for a remote URL', () => {
        expect(reasons('<styles><include src="s2r://panorama/styles/test.vcss_c"/></styles>', false)).toEqual([]);
    });
    it('blocks remote script includes', () => {
        expect(reasons('<script src="https://example.invalid/test.js"/>', false)).toContain('remote-code');
    });
    it('reads the CDATA form produced by the compiled-layout decoder', () => {
        expect(reasons('<script><![CDATA[run(1);]]></script>', false)).toEqual(['executable']);
    });
});
