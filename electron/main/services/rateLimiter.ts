/**
 * Rate limiter for API requests (P2 fix #13)
 * Implements a simple token bucket algorithm to limit request rate
 */

interface RateLimiterConfig {
    maxRequestsPerSecond: number;
    burstSize?: number;
}

class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly maxTokens: number;
    private readonly refillRate: number; // tokens per millisecond

    constructor(config: RateLimiterConfig) {
        this.maxTokens = config.burstSize ?? config.maxRequestsPerSecond * 2;
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
        this.refillRate = config.maxRequestsPerSecond / 1000;
    }

    private refill(): void {
        const now = Date.now();
        const timePassed = now - this.lastRefill;
        const newTokens = timePassed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
        this.lastRefill = now;
    }

    /**
     * Wait until a token is available, then consume it
     */
    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Calculate wait time
        const tokensNeeded = 1 - this.tokens;
        const waitTime = Math.ceil(tokensNeeded / this.refillRate);

        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.refill();
        this.tokens -= 1;
    }

    /**
     * Try to acquire a token without waiting
     * @returns true if token was acquired, false if rate limited
     */
    tryAcquire(): boolean {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }
}

// GameBanana API rate limiter: 10 requests per second with burst of 20
export const gamebananaRateLimiter = new RateLimiter({
    maxRequestsPerSecond: 10,
    burstSize: 20,
});

// Stats API rate limiter: 5 requests per second
export const statsApiRateLimiter = new RateLimiter({
    maxRequestsPerSecond: 5,
    burstSize: 10,
});
