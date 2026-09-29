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
    it('flags calls whose method name is only known at runtime', () => {
        expect(reasons('!function(a){a[decode(7)](decode(9))}(this);')).toEqual(['executable', 'dynamic-code']);
        expect(reasons('items[0](); handlers["click"](); fns[i]();')).toEqual(['executable', 'dynamic-code']);
        expect(reasons('items[0](); handlers["click"]();')).toEqual(['executable']);
    });
    it('flags string decoders that could spell out a panel type or URL', () => {
        for (const source of ['String.fromCharCode(67, 105)', 'atob("Q2l0YWRlbA==")', 'unescape("%43")', 'decodeURIComponent(x)']) {
            expect(reasons(source)).toContain('dynamic-code');
        }
    });
    it('flags panels and layouts created from values it cannot read', () => {
        expect(reasons('$.CreatePanel(kind, parent, "")')).toContain('dynamic-code');
        expect(reasons('panel.BLoadLayoutFromString(markup, false, false)')).toContain('dynamic-code');
        expect(reasons('const kind = "Label"; $.CreatePanel(kind, parent, ""); $.CreatePanel("Image", parent, "icon");')).toEqual(['executable']);
    });
    it('catches the CEF panel file read reported in development-chat', () => {
        const result = reasons('const p = $.CreatePanel("CitadelHTMLPanel", $.GetContextPanel(), ""); p.SetURL("file:///C:/Users/me/secret.txt");');
        expect(result).toEqual(expect.arrayContaining(['browser', 'local-file']));
        expect(reasons('<root><CitadelHTMLPanel url="file:///C:/Users/me/secret.txt"/></root>', false)).toEqual(expect.arrayContaining(['browser', 'local-file']));
    });
    it('requires consent for every script, even when nothing else fires', () => {
        expect(reasons('$.Schedule(0.1, () => $("#timer").text = String(Game.GetGameTime()));')).toEqual(['executable']);
        expect(reasons('!function(a){a(1)}(run);')).toEqual(['executable']);
        expect(reasons('<root><Panel onload="Refresh()"/></root>', false)).toEqual(['executable']);
    });
    it('does not count Panorama content roots as file access', () => {
        expect(reasons('panel.BLoadLayout("file://{resources}/layout/hud_timer.xml", false, false);')).toEqual(['executable']);
        expect(reasons('<root><Panel onload="Refresh()"><Image src="file://{images}/icon.png"/></Panel></root>', false)).toEqual(['executable']);
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
    it('flags UNC addresses in active markup and JavaScript, not in passive markup', () => {
        expect(reasons(String.raw`<Image src="\\server\share\image.png"/>`, false)).toEqual([]);
        expect(reasons(String.raw`<Panel onload="run()"><Image src="\\server\share\image.png"/></Panel>`, false)).toContain('local-file');
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
        expect(reasons('<script><![CDATA[eval(code);]]></script>', false).sort()).toEqual(['dynamic-code', 'executable']);
    });
    it('recognizes bare localization arguments in Panorama event handlers', () => {
        expect(reasons('<Panel onmouseover="UIShowTextTooltip( #hud_spectate_count_tooltip )" onmouseout="UIHideTextTooltip()"/>', false)).toEqual(['executable']);
        expect(reasons('<Panel onactivate="Show(#title, #description); Next()"/>', false)).toEqual(['executable']);
    });
    it('recognizes whitespace-separated Panorama event calls and inspects every call', () => {
        expect(reasons('<Panel onactivate="CitadelStartExploreMap() AsyncEvent( 0.2, CitadelNavigateBackToHome() )"/>', false)).toEqual(['executable']);
        const result = reasons('<Panel onactivate="Show(#tip) eval(code) fetch(&quot;https://example.invalid&quot;)"/>', false);
        expect(result).toEqual(expect.arrayContaining(['executable', 'dynamic-code', 'remote-code']));
        expect(result).not.toContain('uninspectable');
    });
    it('does not reinterpret control flow or unsupported expressions as event lists', () => {
        expect(reasons('<Panel onactivate="if (x) eval(code);"/>', false).sort()).toEqual(['dynamic-code', 'executable']);
        expect(reasons('<Panel onactivate="(1 + 2) run()"/>', false)).toContain('uninspectable');
        expect(reasons('First() Second()')).toContain('uninspectable');
    });
    it('keeps inspecting risky operations alongside Panorama event arguments', () => {
        const result = reasons('<Panel onactivate="UIShowTextTooltip(#tip); eval(code); fetch(&quot;https://example.invalid&quot;); use(&quot;file:///example&quot;); panel.SetURL(url)"/>', false);
        expect(result).toEqual(expect.arrayContaining(['executable', 'dynamic-code', 'remote-code', 'local-file', 'browser']));
        expect(result).not.toContain('uninspectable');
    });
    it('does not rewrite quoted hashes, regular expressions or private fields', () => {
        expect(reasons('<Panel onactivate="run(&quot;#tip&quot;, /#tip/); class X { #value; read(){return this.#value;} }"/>', false)).toEqual(['executable']);
    });
    it('still flags unsupported event syntax and does not normalize standalone JavaScript', () => {
        expect(reasons('<Panel onactivate="Show(#tip); function {"/>', false)).toContain('uninspectable');
        expect(reasons('Show(#tip)')).toContain('uninspectable');
    });
    it('decodes attribute entities after finding their boundaries', () => {
        expect(reasons('<Panel onload="use(&quot;f&quot; + &quot;ile:///example&quot;)"/>', false)).toContain('local-file');
        expect(reasons('<Panel onload="use(&quot;normal text&quot;)"/>', false)).not.toContain('uninspectable');
    });
});
