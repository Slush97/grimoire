import { describe, expect, it } from 'vitest';

import type { KVObject } from '../kv';
import { Vector3 } from '../numerics';
import type { ParticleDefinitionParser } from '../parser';
import { ColorGradient } from './colorGradient';
import { PiecewiseCurve } from './curve';
import { curl3D, simplex3D, value3D, valueVector3, worley3D, worleyJitter, worleyOffset3D } from './noise';
import { NoiseEvaluator } from './noiseEvaluator';

// Expected values come from ValveResourceFormat's C# (Particles/Utils) called through reflection,
// printed as single-precision results.

type Triple = [number, number, number];

const v = ([x, y, z]: Triple) => new Vector3(x, y, z);
const components = (value: Vector3): Triple => [value.x, value.y, value.z];
// Expected values are written as the shortest decimal that rounds to the single-precision result
const f = Math.fround;
const fv = ([x, y, z]: Triple): Triple => [f(x), f(y), f(z)];

describe('Noise', () => {
  // point, Value3D, Simplex3D, Worley3D(point, 0.9, 132)
  const scalars: [Triple, number, number, number][] = [
    [[0, 0, 0], -0.881529, 0, -0.8768],
    [[0.5, 0.25, 0.75], -0.011220157, 0.24241829, -0.54618263],
    [[1.3, -2.7, 4.1], 0.125898, 0.027211964, -0.8114269],
    [[-0.001, -12.345, 7.89], -0.09144682, 0.2841669, -0.20367497],
    [[123.456, -789.012, 345.678], 0.09589183, 0.022257075, -0.40246195],
    [[-5000.5, 2500.25, -1250.125], -0.1486572, -0.07830871, -0.34135836],
    [[1000000, -3000000, 25000000], 0.8598306, 0, -0.88796127],
    [[3000000000, -3000000000, 1], 0.78435946, 0, -0.22085536],
    [[0.999, 1.001, -0.5], 0.3270216, 0.5009995, -0.7952949],
    [[17.17, -31.4159, 64.5], -0.024081767, 0.09085983, -0.543467],
  ];

  it.each(scalars)('samples the scalar primitives at %j', (point, value, simplex, worley) => {
    expect(value3D(v(point))).toBe(f(value));
    expect(value3D(point[0], point[1], point[2])).toBe(f(value));
    expect(simplex3D(v(point))).toBe(f(simplex));
    expect(worley3D(v(point), Math.fround(0.9), 132)).toBe(f(worley));
  });

  // point, ValueVector3, Curl3D, WorleyOffset3D(point, 0.75, -1.5)
  const vectors: [Triple, Triple, Triple, Triple][] = [
    [
      [0.5, 0.25, 0.75],
      [-0.0573529, -0.10759795, -0.0022058487],
      [-0.09213725, 0.6961079, 0.2925942],
      [-0.30882353, -0.07352941, 0.5117647],
    ],
    [
      [1.3, -2.7, 4.1],
      [0.0821961, 0.1930198, -0.3558981],
      [0.34407225, 0.122956365, -0.43600124],
      [-0.26176465, -0.13235289, -0.40294105],
    ],
    [
      [123.456, -789.012, 345.678],
      [-0.4798661, -0.025541395, -0.11998516],
      [-0.38285023, 0.5017287, 0.72207195],
      [-0.08247188, -0.47327018, 0.4278733],
    ],
    [
      [-5000.5, 2500.25, -1250.125],
      [-0.4230392, 0.4061275, -0.32892162],
      [-0.048800275, -0.9680532, 0.20448355],
      [0.61470586, 0.37647063, 0.29558825],
    ],
    [
      [3000000000, -3000000000, 1],
      [-0.6627451, -0.5921568, 0.035294175],
      [-0.69914186, -0.027405813, 0.6495605],
      [0.19117647, 0.1764706, 0.2617647],
    ],
  ];

  it.each(vectors)('samples the vector primitives at %j', (point, value, curl, worley) => {
    expect(components(valueVector3(v(point)))).toEqual(fv(value));
    expect(components(curl3D(v(point)))).toEqual(fv(curl));
    expect(components(worleyOffset3D(v(point), 0.75, -1.5))).toEqual(fv(worley));
  });

  // noise offset, WorleyJitter
  const jitters: [number, number][] = [
    [0, 0.75],
    [0.37, 0.7796844],
    [-1.2, 0.75],
    [5.5, 0.7683629],
    [-100.25, 0.75378907],
    [1000.125, 0.78695],
    [0.324163, 0.77051705],
    [-0.324163, 0.770517],
  ];

  it.each(jitters)('derives the worley jitter from offset %d', (offset, jitter) => {
    expect(worleyJitter(Math.fround(offset))).toBe(f(jitter));
  });
});

describe('NoiseEvaluator', () => {
  const inputs: [Triple, number][] = [[[0, 0, 0], 0], [[10, -20, 30], 1.5], [[-123.4, 56.7, 8.9], 12.25], [[512, 512, -512], 0.016]];

  /** Reads a plain definition the way ParticleDefinitionParser does for these keys. */
  function parser(definition: KVObject): ParticleDefinitionParser {
    const has = (key: string) => Object.prototype.hasOwnProperty.call(definition, key);
    const stub = {
      float: (key: string, fallback: number) => (has(key) ? Math.fround(definition[key] as number) : fallback),
      int32: (key: string, fallback: number) => (has(key) ? Math.trunc(definition[key] as number) : fallback),
      vector3: (key: string, fallback: Vector3) => (has(key) ? v(definition[key] as Triple) : fallback),
      enum: (key: string, table: Record<string, number>, fallback: number) =>
        has(key) ? table[definition[key] as string] : fallback,
    };
    return stub as unknown as ParticleDefinitionParser;
  }

  // definition, Evaluate at each input
  const definitions: [KVObject, number[]][] = [
    [
      {m_nNoiseType: 'PF_NOISE_TYPE_WORLEY', m_nNoiseOctaves: 3, m_nNoiseTurbulence: 'PF_NOISE_TURB_LOOPY', m_nNoiseModifier: 'PF_NOISE_MODIFIER_LINES', m_flNoiseOffset: 0.37, m_flNoiseScale: 0.5, m_vecNoiseOffsetRate: [1, 2, 3]},
      [0.018355953, 0.4309629, 0.9946034, 0.54027873],
    ],
    [
      {m_nNoiseType: 'PF_NOISE_TYPE_SIMPLEX', m_nNoiseOctaves: 2, m_nNoiseTurbulence: 'PF_NOISE_TURB_ALTERNATE', m_nNoiseModifier: 'PF_NOISE_MODIFIER_RINGS', m_flNoiseOutputMin: -2, m_flNoiseOutputMax: 5, m_flNoiseScale: 3},
      [2.542839, 0.23469734, 4.0440345, 0.3342278],
    ],
    [
      {m_nNoiseType: 'PF_NOISE_TYPE_CURL', m_nNoiseTurbulence: 'PF_NOISE_TURB_FEEDBACK', m_nNoiseModifier: 'PF_NOISE_MODIFIER_CLUMPS', m_flNoiseTurbulenceScale: 2.5, m_flNoiseTurbulenceMix: 0.3},
      [0.5725162, 0.36743546, 0, 1],
    ],
    [
      {m_nNoiseType: 'PF_NOISE_TYPE_PERLIN', m_nNoiseOctaves: 4, m_nNoiseTurbulence: 'PF_NOISE_TURB_HIGHLIGHT', m_flNoiseScale: 1.7},
      [0.50543475, 0.49077773, 0.56109023, 0.45185563],
    ],
    [
      {m_nNoiseType: 'PF_NOISE_TYPE_WORLEY', m_nNoiseTurbulence: 'PF_NOISE_TURB_CONTRAST', m_flNoiseOffset: -1.2, m_flNoiseScale: 2},
      [0.22928622, 0.24191177, 0.12082791, 0.17147562],
    ],
    [
      {},
      [0.07395631, 0.38505232, 0.22653458, 0.14887846],
    ],
  ];

  it.each(definitions)('evaluates %j', (definition, expected) => {
    const evaluator = new NoiseEvaluator(parser(definition));
    const actual = inputs.map(([input, age]) => evaluator.evaluate(v(input), Math.fround(age)));
    // MathF.Sin may differ from Math.sin in the last bit
    const usesSine =
      definition.m_nNoiseModifier === 'PF_NOISE_MODIFIER_LINES' ||
      definition.m_nNoiseModifier === 'PF_NOISE_MODIFIER_RINGS';

    actual.forEach((value, index) => {
      if (usesSine) {
        expect(value).toBeCloseTo(f(expected[index]), 6);
      } else {
        expect(value).toBe(f(expected[index]));
      }
    });
  });
});

describe('PiecewiseCurve', () => {
  // m_Curve of abilities/abrams/abrams_ambient_book_cover_trace.vpcf
  const curveInfo: KVObject = {
    m_vDomainMins: [0, 0.1],
    m_vDomainMaxs: [1, 2],
    m_spline: [
      {x: 0, y: 0.1, m_flSlopeIncoming: 18.138021, m_flSlopeOutgoing: 18.138021},
      {x: 0.104752, y: 2, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.131331, y: 0.1, m_flSlopeIncoming: -40.50824, m_flSlopeOutgoing: -40.50824},
      {x: 0.151656, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 50.635326},
      {x: 0.18918, y: 2, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.217322, y: 0.1, m_flSlopeIncoming: -67.513733, m_flSlopeOutgoing: 0},
      {x: 0.251718, y: 0.1, m_flSlopeIncoming: 35.742573, m_flSlopeOutgoing: 35.742573},
      {x: 0.27048, y: 2, m_flSlopeIncoming: 19.28964, m_flSlopeOutgoing: 19.28964},
      {x: 0.350217, y: 2, m_flSlopeIncoming: -17.871286, m_flSlopeOutgoing: -17.871286},
      {x: 0.376796, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.406502, y: 2, m_flSlopeIncoming: 17.871286, m_flSlopeOutgoing: 17.871286},
      {x: 0.483111, y: 2, m_flSlopeIncoming: -19.289646, m_flSlopeOutgoing: -19.289646},
      {x: 0.505, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.54565, y: 2, m_flSlopeIncoming: 23.828369, m_flSlopeOutgoing: 23.828369},
      {x: 0.584737, y: 2, m_flSlopeIncoming: 0, m_flSlopeOutgoing: -405.08197},
      {x: 0.589427, y: 0.1, m_flSlopeIncoming: -405.08197, m_flSlopeOutgoing: 0},
      {x: 0.62226, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 22.504585},
      {x: 0.673855, y: 2, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.719195, y: 0.1, m_flSlopeIncoming: -27.619257, m_flSlopeOutgoing: -27.619257},
      {x: 0.742647, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 173.607193},
      {x: 0.753591, y: 2, m_flSlopeIncoming: 173.607193, m_flSlopeOutgoing: 32.84454},
      {x: 0.800495, y: 2, m_flSlopeIncoming: -27.619257, m_flSlopeOutgoing: -27.619257},
      {x: 0.822384, y: 0.1, m_flSlopeIncoming: 0, m_flSlopeOutgoing: 0},
      {x: 0.833328, y: 2, m_flSlopeIncoming: 20.254124, m_flSlopeOutgoing: 20.254124},
      {x: 0.916192, y: 2, m_flSlopeIncoming: -13.968362, m_flSlopeOutgoing: -13.968362},
      {x: 0.96935, y: 0.1, m_flSlopeIncoming: -0.614194, m_flSlopeOutgoing: -0.614194},
    ],
    m_tangents: [
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_LINEAR'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_LINEAR'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_LINEAR'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_LINEAR'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_LINEAR'},
      {m_nIncomingTangent: 'CURVE_TANGENT_LINEAR', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_SPLINE', m_nOutgoingTangent: 'CURVE_TANGENT_SPLINE'},
      {m_nIncomingTangent: 'CURVE_TANGENT_FREE', m_nOutgoingTangent: 'CURVE_TANGENT_MIRROR'},
    ],
  };

  // input, Evaluate, Evaluate when looped
  const samples: [number, number, number][] = [
    [-0.1, 0.1, 2],
    [0, 0.1, 0.1],
    [0.05, 1.2331634, 1.2331634],
    [0.104752, 2, 2],
    [0.12, 0.99257904, 0.99257904],
    [0.14, 0.1, 0.1],
    [0.16, 0.5955486, 0.5955486],
    [0.2, 1.5462561, 1.5462561],
    [0.25, 0.1, 0.1],
    [0.3, 2, 2],
    [0.37, 0.38601655, 0.38601655],
    [0.45, 2, 2],
    [0.5, 0.33512446, 0.33512446],
    [0.55, 2, 2],
    [0.587, 1.0832139, 1.0832139],
    [0.6, 0.1, 0.1],
    [0.7, 1.0095651, 1.0095651],
    [0.75, 1.3765628, 1.3765628],
    [0.8, 2, 2],
    [0.83, 1.5471133, 1.5471133],
    [0.9, 2, 2],
    [0.95, 0.61421686, 0.61421686],
    [0.99, 0.1, 0.1],
    [1, 0.1, 0.1],
    [1.1, 0.1, 1.9923576],
    [1.75, 0.1, 1.3765628],
    [-0.3, 0.1, 1.0095651],
  ];

  it.each(samples)('evaluates at %d', (input, value, looped) => {
    expect(new PiecewiseCurve(curveInfo, false).evaluate(input)).toBe(f(value));
    expect(new PiecewiseCurve(curveInfo, true).evaluate(input)).toBe(f(looped));
  });

  it('reports the domain end and the last key', () => {
    expect(new PiecewiseCurve(curveInfo, false).tryGetEnd()).toEqual({ x: 1, y: Math.fround(0.1) });
    expect(new PiecewiseCurve({ m_spline: [], m_tangents: [] }, false).tryGetEnd()).toBeNull();
    expect(new PiecewiseCurve(null, false).evaluate(0.5)).toBe(0);
  });
});

describe('ColorGradient', () => {
  // A texture input m_Gradient of abilities/abrams/abrams_ambient_book_cover_trace.vpcf
  const gradient = new ColorGradient({m_Stops: [{m_flPosition: 0, m_Color: [0, 0, 0]}, {m_flPosition: 0.245478, m_Color: [255, 255, 255]}, {m_flPosition: 0.715762, m_Color: [255, 255, 255]}, {m_flPosition: 1, m_Color: [0, 0, 0]}]});

  // t, Evaluate
  const samples: [number, Triple][] = [
    [-0.5, [0, 0, 0]],
    [0, [0, 0, 0]],
    [0.1, [0.40392157, 0.40392157, 0.40392157]],
    [0.245478, [1, 1, 1]],
    [0.3, [1, 1, 1]],
    [0.5, [1, 1, 1]],
    [0.715762, [1, 1, 1]],
    [0.8, [0.7019608, 0.7019608, 0.7019608]],
    [0.99, [0.03137255, 0.03137255, 0.03137255]],
    [1, [0, 0, 0]],
    [2, [0, 0, 0]],
  ];

  it.each(samples)('evaluates at %d', (t, color) => {
    expect(components(gradient.evaluate(Math.fround(t)))).toEqual(fv(color));
  });

  it('is white without stops', () => {
    expect(components(new ColorGradient(null).evaluate(0.5))).toEqual([1, 1, 1]);
  });
});
