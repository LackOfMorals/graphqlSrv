/*
 * Performance monitoring and profiling utilities
 */

import { performance } from 'perf_hooks';
import Debug from 'debug';

const debug = Debug('@neo4j/graphql:performance');

interface TimingEntry {
    name: string;
    duration: number;
    timestamp: number;
    metadata?: Record<string, any>;
}

interface PerformanceMetrics {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
}

/**
 * Performance profiler with percentile tracking
 */
export class PerformanceProfiler {
    private timings: Map<string, TimingEntry[]> = new Map();
    private activeTimers: Map<string, number> = new Map();
    private enabled: boolean;

    constructor(enabled = true) {
        this.enabled = enabled;
    }

    /**
     * Start timing an operation
     */
    start(operationName: string, metadata?: Record<string, any>): void {
        if (!this.enabled) return;

        const timerId = `${operationName}:${performance.now()}`;
        this.activeTimers.set(timerId, performance.now());
        
        if (metadata) {
            this.activeTimers.set(`${timerId}:metadata`, metadata as any);
        }
    }

    /**
     * End timing an operation
     */
    end(operationName: string): number | null {
        if (!this.enabled) return null;

        const timerId = Array.from(this.activeTimers.keys()).find(
            (key) => key.startsWith(`${operationName}:`)
        );

        if (!timerId) {
            debug(`Warning: No active timer found for ${operationName}`);
            return null;
        }

        const startTime = this.activeTimers.get(timerId)!;
        const duration = performance.now() - startTime;
        const metadataKey = `${timerId}:metadata`;
        const metadata = this.activeTimers.get(metadataKey) as any;

        this.activeTimers.delete(timerId);
        this.activeTimers.delete(metadataKey);

        const entry: TimingEntry = {
            name: operationName,
            duration,
            timestamp: Date.now(),
            metadata,
        };

        if (!this.timings.has(operationName)) {
            this.timings.set(operationName, []);
        }

        this.timings.get(operationName)!.push(entry);

        debug(`${operationName} completed in ${duration.toFixed(2)}ms`);

        return duration;
    }

    /**
     * Measure an async function
     */
    async measure<T>(
        operationName: string,
        fn: () => Promise<T>,
        metadata?: Record<string, any>
    ): Promise<T> {
        if (!this.enabled) return fn();

        this.start(operationName, metadata);
        try {
            return await fn();
        } finally {
            this.end(operationName);
        }
    }

    /**
     * Measure a synchronous function
     */
    measureSync<T>(
        operationName: string,
        fn: () => T,
        metadata?: Record<string, any>
    ): T {
        if (!this.enabled) return fn();

        this.start(operationName, metadata);
        try {
            return fn();
        } finally {
            this.end(operationName);
        }
    }

    /**
     * Get performance metrics for an operation
     */
    getMetrics(operationName: string): PerformanceMetrics | null {
        const entries = this.timings.get(operationName);
        if (!entries || entries.length === 0) return null;

        const durations = entries.map((e) => e.duration).sort((a, b) => a - b);
        const sum = durations.reduce((a, b) => a + b, 0);

        return {
            min: durations[0],
            max: durations[durations.length - 1],
            avg: sum / durations.length,
            p50: this.percentile(durations, 0.5),
            p95: this.percentile(durations, 0.95),
            p99: this.percentile(durations, 0.99),
            count: durations.length,
        };
    }

    /**
     * Get all metrics
     */
    getAllMetrics(): Map<string, PerformanceMetrics> {
        const metrics = new Map<string, PerformanceMetrics>();
        
        for (const [name] of this.timings) {
            const metric = this.getMetrics(name);
            if (metric) {
                metrics.set(name, metric);
            }
        }

        return metrics;
    }

    /**
     * Get slow operations (above threshold)
     */
    getSlowOperations(thresholdMs: number): TimingEntry[] {
        const slow: TimingEntry[] = [];

        for (const entries of this.timings.values()) {
            slow.push(...entries.filter((e) => e.duration > thresholdMs));
        }

        return slow.sort((a, b) => b.duration - a.duration);
    }

    /**
     * Clear all timings
     */
    clear(): void {
        this.timings.clear();
        this.activeTimers.clear();
    }

    /**
     * Export metrics as JSON
     */
    export(): string {
        const data: Record<string, any> = {};

        for (const [name, entries] of this.timings) {
            data[name] = {
                metrics: this.getMetrics(name),
                recentSamples: entries.slice(-10).map((e) => ({
                    duration: e.duration,
                    timestamp: e.timestamp,
                    metadata: e.metadata,
                })),
            };
        }

        return JSON.stringify(data, null, 2);
    }

    private percentile(sortedValues: number[], p: number): number {
        const index = Math.ceil(sortedValues.length * p) - 1;
        return sortedValues[Math.max(0, index)];
    }
}

/**
 * Query performance tracker
 */
export class QueryPerformanceTracker {
    private profiler: PerformanceProfiler;
    private queryCache: Map<string, number> = new Map();

    constructor(profiler: PerformanceProfiler) {
        this.profiler = profiler;
    }

    /**
     * Track a GraphQL query
     */
    async trackQuery<T>(
        query: string,
        variables: any,
        executor: () => Promise<T>
    ): Promise<T> {
        const queryHash = this.hashQuery(query, variables);
        const cacheHit = this.queryCache.has(queryHash);

        return this.profiler.measure(
            'graphql.query',
            executor,
            {
                queryHash,
                cacheHit,
                variableCount: Object.keys(variables || {}).length,
            }
        );
    }

    /**
     * Track Cypher query execution
     */
    async trackCypher<T>(
        cypher: string,
        params: any,
        executor: () => Promise<T>
    ): Promise<T> {
        return this.profiler.measure(
            'neo4j.cypher',
            executor,
            {
                cypherLength: cypher.length,
                paramCount: Object.keys(params || {}).length,
            }
        );
    }

    /**
     * Track resolver execution
     */
    async trackResolver<T>(
        typeName: string,
        fieldName: string,
        executor: () => Promise<T>
    ): Promise<T> {
        return this.profiler.measure(
            `resolver.${typeName}.${fieldName}`,
            executor
        );
    }

    private hashQuery(query: string, variables: any): string {
        const crypto = require('crypto');
        return crypto
            .createHash('md5')
            .update(query + JSON.stringify(variables || {}))
            .digest('hex');
    }

    /**
     * Get query statistics
     */
    getQueryStats(): {
        uniqueQueries: number;
        totalQueries: number;
        slowestQueries: any[];
    } {
        const metrics = this.profiler.getMetrics('graphql.query');
        const slowQueries = this.profiler.getSlowOperations(100); // 100ms threshold

        return {
            uniqueQueries: this.queryCache.size,
            totalQueries: metrics?.count || 0,
            slowestQueries: slowQueries.slice(0, 10),
        };
    }
}

/**
 * Performance middleware for GraphQL Yoga
 */
export function createPerformancePlugin(profiler: PerformanceProfiler) {
    return {
        onExecute() {
            const start = performance.now();
            
            return {
                onExecuteDone() {
                    const duration = performance.now() - start;
                    debug(`Query execution: ${duration.toFixed(2)}ms`);
                },
            };
        },
        onParse() {
            profiler.start('graphql.parse');
            return {
                onParseEnd() {
                    profiler.end('graphql.parse');
                },
            };
        },
        onValidate() {
            profiler.start('graphql.validate');
            return {
                onValidateEnd() {
                    profiler.end('graphql.validate');
                },
            };
        },
    };
}

/**
 * Memory profiler
 */
export class MemoryProfiler {
    private snapshots: Map<string, NodeJS.MemoryUsage> = new Map();

    snapshot(label: string): void {
        this.snapshots.set(label, process.memoryUsage());
        debug(`Memory snapshot [${label}]: ${this.formatMemory(process.memoryUsage())}`);
    }

    compare(label1: string, label2: string): {
        heapUsedDelta: number;
        externalDelta: number;
    } | null {
        const snap1 = this.snapshots.get(label1);
        const snap2 = this.snapshots.get(label2);

        if (!snap1 || !snap2) return null;

        return {
            heapUsedDelta: snap2.heapUsed - snap1.heapUsed,
            externalDelta: snap2.external - snap1.external,
        };
    }

    private formatMemory(mem: NodeJS.MemoryUsage): string {
        return `Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB, External: ${(mem.external / 1024 / 1024).toFixed(2)}MB`;
    }
}

// Export singleton instance
export const globalProfiler = new PerformanceProfiler(
    process.env.NODE_ENV !== 'production'
);

export const globalQueryTracker = new QueryPerformanceTracker(globalProfiler);
