import Tx from './translation/Tx';
import { getAssetPath } from '../lib/assetPath';
import { getHeroRenderPath } from '../lib/lockerUtils';

const KOFI_URL = 'https://ko-fi.com/esocidae';

/**
 * Ko-fi tip-jar link for the Settings header. Mina (red umbrella and all) sits
 * muted in the background of the pill, fading behind the label, with her hero
 * icon as the leading mark. Visual treatment is in index.css under the `.kofi-*`
 * classes; image paths are resolved with getAssetPath so they work under both
 * the dev server and the packaged file:// build.
 */
export default function KofiSupportButton() {
  const minaRender = getHeroRenderPath('Mina');
  const minaIcon = getAssetPath('/heroes/icons/mina.png');
  return (
    <a
      href={KOFI_URL}
      target="_blank"
      rel="noreferrer noopener"
      title="Support Grimoire on Ko-fi"
      className="kofi-button inline-flex shrink-0 items-center gap-2 rounded-sm border px-3.5 py-2 text-sm font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-kofi/40 whitespace-nowrap"
    >
      <span
        aria-hidden="true"
        className="kofi-mina"
        style={{ backgroundImage: `url("${minaRender}")` }}
      />
      <span aria-hidden="true" className="kofi-fade" />
      <img
        src={minaIcon}
        alt=""
        aria-hidden="true"
        className="kofi-icon relative z-10 h-5 w-5 object-contain"
      />
      <span className="relative z-10">
        <Tx k="settings.support.kofi" fallback="Buy me a coffee" />
      </span>
    </a>
  );
}
