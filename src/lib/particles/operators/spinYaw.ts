// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/Spin.cs.

import { ParticleField } from '../enums';
import { GeneralSpin } from './generalSpin';

export class SpinYaw extends GeneralSpin {

  protected get spinField(): number { return ParticleField.Yaw; }
}
