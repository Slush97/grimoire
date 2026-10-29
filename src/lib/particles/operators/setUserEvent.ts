// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Operators/SetUserEvent.cs.

import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleEventType } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionOperator } from '../functions';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';

export class SetUserEvent extends ParticleFunctionOperator {
  private readonly input: NumberProvider;
  private readonly risingEdge: NumberProvider;
  private readonly risingEventType: number;
  private readonly fallingEdge: NumberProvider;
  private readonly fallingEventType: number;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.input = parse.numberProvider('m_flInput', new LiteralNumberProvider(0));
    this.risingEdge = parse.numberProvider('m_flRisingEdge', new LiteralNumberProvider(0));
    this.risingEventType = parse.enum('m_nRisingEventType', ParticleEventType, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_USER_1);
    this.fallingEdge = parse.numberProvider('m_flFallingEdge', new LiteralNumberProvider(0));
    this.fallingEventType = parse.enum('m_nFallingEventType', ParticleEventType, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE);
  }
  private userEventBit = 1;
  private readonly risen: number[] = [];

  initialize(state: ParticleSystemState): void {
    let earlier = 0;
    for (const op of state.data?.operators ?? []) {
      if (op === this) {
        break;
      }
      if (op instanceof SetUserEvent) {
        earlier++;
      }
    }
    this.userEventBit = 1 << earlier;
  }

  get storedFields(): bigint { return fieldMask(ParticleField.UserEventStates); }

  operate(particles: ParticleCollection, _frameTime: number, state: ParticleSystemState): void {
    const rising = this.risingEventType !== 0 && state.listensFor(this.risingEventType);
    const falling = this.fallingEventType !== 0 && state.listensFor(this.fallingEventType);
    if (!rising && !falling) {
      return;
    }
    const tracksState = this.userEventBit === 1;
    this.risen.length = 0;
    const current = particles.currentSpan;
    const values = this.input.fillNew(current, state);
    const risingEdges = this.risingEdge.fillNew(current, state);
    const fallingEdges = this.fallingEdge.fillNew(current, state);
    const states = current.integers(ParticleField.UserEventStates);
    for (let i = 0; i < states.length; i++) {
      const value = values[i];
      const isSet = tracksState && (states[i] & this.userEventBit) !== 0;
      if (risingEdges[i] <= value && !isSet) {
        this.risen.push(i);
        states[i] |= this.userEventBit;
      }
      else if (value <= fallingEdges[i] && isSet) {
        if (falling) {
          particles.raiseEvent(i, this.fallingEventType);
        }
        states[i] &= ~this.userEventBit;
      }
    }
    if (!rising) {
      return;
    }
    for (const i of this.risen) {
      particles.raiseEvent(i, this.risingEventType);
    }
  }
}
