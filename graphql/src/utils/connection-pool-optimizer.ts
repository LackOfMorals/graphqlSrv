/*
 * Optimized Neo4j connection pool configuration and management
 */

import type { Driver, Config } from 'neo4j-driver';
import neo4j from 'neo4j-driver';
import Debug from 'debug';

const debug = Debug('@neo4j/graphql:connection-pool');

/**
 * Optimized driver configuration for high-performance scenarios
 */
export function createOptimizedDriver(
    uri: string,
    auth: { username: string; password: string },
    options: {
        // Connection pool settings
        maxConnectionPoolSize?: number;
        connectionAcquisitionTimeout?: number;
        connectionTimeout?: number;
        maxConnectionLifetime?: number;
        
        // Performance settings
        fetchSize?: number;
        disableLosslessIntegers?: boolean;
        
        // Logging
        logging?: boolean;
    } = {}
): Driver {
    const config: Config = {
        // Connection pool optimizations
        maxConnectionPoolSize: options.maxConnectionPoolSize || 50, // Increase for high load
        connectionAcquisitionTimeout: options.connectionAcquisitionTimeout || 60000, // 60s
        connectionTimeout: options.connectionTimeout || 30000, // 30s
        maxConnectionLifetime: options.maxConnectionLifetime || 3600000, // 1 hour

        // Performance optimizations
        fetchSize: options.fetchSize || 1000, // Batch size for large result sets
        disableLosslessIntegers: options.disableLosslessIntegers ?? true, // Use native JS numbers

        // Enable metrics for monitoring
        ...(options.logging && {
            logging: {
                level: 'debug',
                logger: (level: string, message: string) => {
                    debug(`[${level}] ${message}`);
                },
            },
        }),
    };

    debug('Creating optimized driver with config:', config);

    return neo4j.driver(uri, neo4j.auth.basic(auth.username, auth.password), config);
}

/**
 * Connection pool health monitor
 */
export class ConnectionPoolMonitor {
    private driver: Driver;
    private checkInterval?: NodeJS.Timeout;
    private metrics: {
        activeConnections: number[];
        idleConnections: number[];
        acquisitionFailures: number;
        slowQueries: number;
    } = {
        activeConnections: [],
        idleConnections: [],
        acquisitionFailures: 0,
        slowQueries: 0,
    };

    constructor(driver: Driver) {
        this.driver = driver;
    }

    /**
     * Start monitoring the connection pool
     */
    startMonitoring(intervalMs = 30000): void {
        if (this.checkInterval) return;

        this.checkInterval = setInterval(() => {
            this.checkHealth();
        }, intervalMs);

        debug('Connection pool monitoring started');
    }

    /**
     * Stop monitoring
     */
    stopMonitoring(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = undefined;
            debug('Connection pool monitoring stopped');
        }
    }

    /**
     * Check pool health
     */
    private async checkHealth(): Promise<void> {
        try {
            const session = this.driver.session();
            const start = Date.now();

            await session.run('RETURN 1');
            const duration = Date.now() - start;

            if (duration > 1000) {
                this.metrics.slowQueries++;
                debug(`Slow health check: ${duration}ms`);
            }

            await session.close();
        } catch (error) {
            this.metrics.acquisitionFailures++;
            debug('Health check failed:', error);
        }
    }

    /**
     * Get pool metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            avgActiveConnections:
                this.metrics.activeConnections.length > 0
                    ? this.metrics.activeConnections.reduce((a, b) => a + b, 0) /
                      this.metrics.activeConnections.length
                    : 0,
            avgIdleConnections:
                this.metrics.idleConnections.length > 0
                    ? this.metrics.idleConnections.reduce((a, b) => a + b, 0) /
                      this.metrics.idleConnections.length
                    : 0,
        };
    }

    /**
     * Reset metrics
     */
    resetMetrics(): void {
        this.metrics = {
            activeConnections: [],
            idleConnections: [],
            acquisitionFailures: 0,
            slowQueries: 0,
        };
    }
}

/**
 * Session factory with intelligent routing
 */
export class SessionFactory {
    private driver: Driver;
    private readSessionPool: any[] = [];
    private writeSessionPool: any[] = [];

    constructor(driver: Driver) {
        this.driver = driver;
    }

    /**
     * Get a read-optimized session
     */
    getReadSession(database?: string) {
        return this.driver.session({
            database,
            defaultAccessMode: neo4j.session.READ,
            // Route to read replicas
            bookmarks: undefined, // Don't wait for latest writes
        });
    }

    /**
     * Get a write-optimized session
     */
    getWriteSession(database?: string) {
        return this.driver.session({
            database,
            defaultAccessMode: neo4j.session.WRITE,
        });
    }

    /**
     * Execute a read transaction with retries
     */
    async executeRead<T>(
        work: (tx: any) => Promise<T>,
        database?: string,
        maxRetries = 3
    ): Promise<T> {
        const session = this.getReadSession(database);
        let lastError: any;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await session.executeRead(work);
            } catch (error: any) {
                lastError = error;
                
                // Retry on transient errors
                if (this.isRetryable(error) && attempt < maxRetries - 1) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                    debug(`Retrying read transaction after ${delay}ms (attempt ${attempt + 1})`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                
                throw error;
            } finally {
                await session.close();
            }
        }

        throw lastError;
    }

    /**
     * Execute a write transaction with retries
     */
    async executeWrite<T>(
        work: (tx: any) => Promise<T>,
        database?: string,
        maxRetries = 3
    ): Promise<T> {
        const session = this.getWriteSession(database);
        let lastError: any;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await session.executeWrite(work);
            } catch (error: any) {
                lastError = error;
                
                if (this.isRetryable(error) && attempt < maxRetries - 1) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                    debug(`Retrying write transaction after ${delay}ms (attempt ${attempt + 1})`);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
                
                throw error;
            } finally {
                await session.close();
            }
        }

        throw lastError;
    }

    private isRetryable(error: any): boolean {
        // Check for transient error codes
        const transientCodes = [
            'Neo.TransientError.Transaction.DeadlockDetected',
            'Neo.TransientError.Transaction.LockClientStopped',
            'Neo.TransientError.Network',
        ];

        return transientCodes.some((code) => error.code?.startsWith(code));
    }
}

/**
 * Query result streaming for large datasets
 */
export class StreamingQueryExecutor {
    private driver: Driver;

    constructor(driver: Driver) {
        this.driver = driver;
    }

    /**
     * Stream query results to avoid loading everything into memory
     */
    async *streamResults<T>(
        cypher: string,
        params: any,
        transformFn: (record: any) => T,
        database?: string
    ): AsyncGenerator<T> {
        const session = this.driver.session({ database, fetchSize: 1000 });

        try {
            const result = await session.run(cypher, params);

            // Stream records one at a time
            for await (const record of result) {
                yield transformFn(record);
            }
        } finally {
            await session.close();
        }
    }

    /**
     * Process large result sets in batches
     */
    async processBatches<T>(
        cypher: string,
        params: any,
        batchSize: number,
        processor: (batch: T[]) => Promise<void>,
        transformFn: (record: any) => T,
        database?: string
    ): Promise<void> {
        const session = this.driver.session({ database });
        let batch: T[] = [];

        try {
            const result = await session.run(cypher, params);

            for await (const record of result) {
                batch.push(transformFn(record));

                if (batch.length >= batchSize) {
                    await processor(batch);
                    batch = [];
                }
            }

            // Process remaining items
            if (batch.length > 0) {
                await processor(batch);
            }
        } finally {
            await session.close();
        }
    }
}
