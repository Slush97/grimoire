type ErrorWithCode = Error & { code?: string };

// Node's connect failures across several addresses surface as an AggregateError
// with an empty message and only a code, which would otherwise reach the UI blank.
export function describeNetworkError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    if (error.message) return error.message;
    const details = new Set<string>();
    const add = (value: ErrorWithCode) => {
        const detail = value.code ?? value.message;
        if (detail) details.add(detail);
    };
    add(error);
    if (error instanceof AggregateError) {
        for (const inner of error.errors) {
            if (inner instanceof Error) add(inner);
        }
    }
    return details.size > 0
        ? `Could not connect to the download server (${[...details].join(', ')})`
        : 'Could not connect to the download server';
}
