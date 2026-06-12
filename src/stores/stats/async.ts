// Shared async-state shape for the stats domain stores. Every remote dataset
// is held as an Async<T> so tabs can render loading skeletons, surfaced
// errors with retry, and distinguish "never requested" from "loaded empty".

export type AsyncStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface Async<T> {
    data: T
    status: AsyncStatus
    error: string | null
}

export function asyncIdle<T>(data: T): Async<T> {
    return { data, status: 'idle', error: null }
}

export function asyncLoading<T>(prev: Async<T>): Async<T> {
    return { data: prev.data, status: 'loading', error: null }
}

export function asyncLoaded<T>(data: T): Async<T> {
    return { data, status: 'loaded', error: null }
}

export function asyncError<T>(prev: Async<T>, err: unknown): Async<T> {
    return { data: prev.data, status: 'error', error: toErrorMessage(err) }
}

export function toErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return typeof err === 'string' ? err : 'Request failed'
}
