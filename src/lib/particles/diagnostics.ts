// Where the particle runtime reports what it could not run faithfully, in place of
// ValveResourceFormat's ILogger warnings. Nothing unsupported is ignored silently: an unported
// class, input type or upgrade step is recorded here so callers can tell a faithful simulation
// from a partial one.

export type ParticleDiagnosticKind =
  /** A function class the runtime has not ported (ValveResourceFormat may or may not run it). */
  | 'unsupported-class'
  /** A number, vector or transform input type that is not ported. */
  | 'unsupported-input'
  /** The definition needs a format upgrade step that is not ported, or its format is unknown. */
  | 'unsupported-upgrade'
  /** Anything else ValveResourceFormat would log as a warning. */
  | 'warning';

export interface ParticleDiagnostic {
  kind: ParticleDiagnosticKind;
  /** The system the diagnostic came from, when known. */
  system?: string;
  message: string;
}

export class ParticleDiagnostics {
  readonly entries: ParticleDiagnostic[] = [];
  private readonly seen = new Set<string>();

  /** Records a diagnostic once per distinct kind, system and message. */
  report(kind: ParticleDiagnosticKind, message: string, system?: string): void {
    const key = `${kind}\u0000${system ?? ''}\u0000${message}`;

    if (this.seen.has(key)) {
      return;
    }

    this.seen.add(key);
    this.entries.push({ kind, system, message });
  }

  warn(message: string, system?: string): void {
    this.report('warning', message, system);
  }

  ofKind(kind: ParticleDiagnosticKind): ParticleDiagnostic[] {
    return this.entries.filter((entry) => entry.kind === kind);
  }
}
