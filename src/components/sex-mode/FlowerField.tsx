import { useTranslation } from 'react-i18next';
import { PageLayout } from '../common/PageComponents';
import BeeEffects from './BeeEffects';

const plants = {
  daisy: {
    tone: 'lemonchiffon',
    stem: 'M36 96C43 72 44 45 33 22M41 76l-15-12m16-7 14-13',
    leaves: 'M41 76Q25 76 20 58q16 4 21 18Zm1-19q4-14 19-17-4 13-19 17Z',
    bloom: (
      <g transform="translate(33 22) rotate(-14)">
        {Array.from({ length: 9 }, (_, index) => (
          <ellipse key={index} cy="-9" rx="3" ry="7" transform={`rotate(${index * 40})`} />
        ))}
        <circle r="4.5" />
        <path d="M-1.5-1.5h.1M1.5-1h.1M0 1.5h.1" />
      </g>
    ),
  },
  cosmos: {
    tone: 'plum',
    stem: 'M36 96C22 72 32 41 48 24M30 73l-13-15m14 6 17-13m-9-10-9-7',
    leaves: 'M30 73q-12-2-16-19l8 5 1-4q8 10 7 18Zm1-9q5-14 21-16l-4 6 4 1q-10 10-21 9Zm8-23q-11 0-12-11 10 3 12 11Z',
    bloom: (
      <g transform="translate(48 24) rotate(18)">
        {Array.from({ length: 5 }, (_, index) => (
          <path
            key={index}
            d="M-3-3c-3-3-6-8-5-12q2-2 5-1 3-3 6 0 3-1 5 1c1 4-2 9-5 12Z"
            transform={`rotate(${index * 72})`}
          />
        ))}
        <circle r="4" />
        <path d="M-1.5 0h.1M0-1.5h.1M1 1.5h.1" />
      </g>
    ),
  },
  poppy: {
    tone: 'peachpuff',
    stem: 'M36 96C49 70 42 48 24 33M43 73Q49 55 58 56M42 81 25 74',
    leaves: 'M42 81q-16 2-24-12l8 1-1-5 8 5 1-3q7 5 8 14Z',
    bloom: (
      <>
        <g transform="translate(24 33) rotate(-24)">
          <path d="M0 0C-9-1-16-9-16-17q4-4 10-2 6-4 12 0 6-2 10 2C16-9 9-1 0 0Z" />
          <path fill="none" d="M0 0c-4-4-7-11-6-19M0 0c5-5 7-11 6-19m-20 8q5-2 8 0 6 3 12 0 3-2 8 0" />
        </g>
        <path d="M58 56q-5-2-4-6 1-4 6-6 3 5 2 9-1 3-4 3Z" />
      </>
    ),
  },
  lupine: {
    tone: 'lightsteelblue',
    stem: 'M36 96C39 67 38 41 31 13M38 72 23 66m15 14 13-11',
    leaves: 'M23 66q-11 2-15-4 7-2 15 4-7-5-9-12 8 1 9 12-1-6 4-10 3 5-4 10Zm28 3q-4-8 1-13 4 6-1 13 4-9 12-10-2 8-12 10 9-5 15 0-6 5-15 0Z',
    bloom: (
      <path d="M31 16q-5-6-1-10 5 3 1 10Zm1 8q-9-1-10-7 6-3 10 7Zm1 2q0-9 7-9 3 7-7 9Zm2 9q-10 0-13-7 8-3 13 7Zm0 3q1-9 9-10 3 8-9 10Zm2 9q-12 1-15-7 8-3 15 7Zm0 3q2-9 11-9 3 8-11 9Z" />
    ),
  },
};

// Each cutting floats around its center, with no shared ground line.
const flowers: readonly [kind: keyof typeof plants, x: number, y: number, size: number, tilt: number][] = [
  ['cosmos', 12, 17, 22, -26],
  ['lupine', 30, 9, 14, 53],
  ['poppy', 53, 19, 26, 35],
  ['daisy', 72, 11, 15, -41],
  ['lupine', 89, 23, 24, 22],
  ['daisy', 22, 40, 25, 39],
  ['poppy', 41, 35, 14, -54],
  ['cosmos', 67, 40, 22, -34],
  ['daisy', 95, 49, 17, 59],
  ['poppy', 8, 58, 18, -39],
  ['lupine', 39, 62, 27, 15],
  ['daisy', 56, 55, 13, -55],
  ['poppy', 79, 61, 25, 30],
  ['cosmos', 20, 79, 24, -37],
  ['poppy', 32, 90, 14, 46],
  ['daisy', 60, 83, 27, -22],
  ['lupine', 90, 84, 19, 42],
  ['cosmos', 75, 94, 13, -47],
];

const tint = (tone: string) => `color-mix(in oklab, ${tone} 68%, var(--color-text-primary))`;
const wash = 'color-mix(in oklab, currentColor 12%, var(--color-bg-primary))';

export default function FlowerField() {
  const { t } = useTranslation();

  return (
    <PageLayout variant="fill" className="relative bg-bg-primary p-0!">
      <BeeEffects />
      {flowers.map(([kind, x, y, size, tilt]) => (
        <button
          key={x}
          type="button"
          aria-label={t('settings.experimental.sexModeFlower')}
          className="pointer-events-none absolute block -translate-x-1/2 -translate-y-1/2 rounded-sm focus-visible:outline-1 focus-visible:outline-accent"
          style={{ left: `${x}%`, top: `${y}%`, height: `${size}%`, rotate: `${tilt}deg` }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 72 100"
            className="sex-flower-sway block h-full w-auto"
            style={{ animationDuration: `${5 + x % 5 * 0.7}s`, animationDelay: `-${x % 9 * 0.7}s` }}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <g style={{ color: tint('darkseagreen') }}>
              <path d={plants[kind].leaves} fill={wash} />
              <path d={plants[kind].stem} />
            </g>
            <g data-flower-bloom className="pointer-events-auto" style={{ color: tint(plants[kind].tone) }} fill={wash}>
              {plants[kind].bloom}
            </g>
          </svg>
        </button>
      ))}
    </PageLayout>
  );
}
