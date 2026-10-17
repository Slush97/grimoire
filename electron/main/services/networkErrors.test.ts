import { describe, expect, it } from 'vitest';

import { describeNetworkError } from './networkErrors';

function withCode(error: Error, code: string): Error {
    return Object.assign(error, { code });
}

describe('describeNetworkError', () => {
    it('keeps an existing message', () => {
        expect(describeNetworkError(new Error('read ECONNRESET'))).toBe('read ECONNRESET');
    });

    it('names the codes inside a message-less AggregateError from a failed connect', () => {
        const error = withCode(
            new AggregateError([
                withCode(new Error(''), 'ETIMEDOUT'),
                withCode(new Error(''), 'ENETUNREACH'),
                withCode(new Error(''), 'ETIMEDOUT'),
            ]),
            'ETIMEDOUT',
        );

        expect(error.message).toBe('');
        expect(describeNetworkError(error)).toBe(
            'Could not connect to the download server (ETIMEDOUT, ENETUNREACH)',
        );
    });

    it('still produces a message when there is nothing to name', () => {
        expect(describeNetworkError(new AggregateError([]))).toBe(
            'Could not connect to the download server',
        );
    });

    it('stringifies non-errors', () => {
        expect(describeNetworkError('boom')).toBe('boom');
    });
});
