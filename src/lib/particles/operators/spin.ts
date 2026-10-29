// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/Spin.cs.

import { ParticleField } from '../enums';
import { GeneralSpin } from './generalSpin';

export class Spin extends GeneralSpin {

  protected get spinField(): number { return ParticleField.Roll; }
}
