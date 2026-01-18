/*
 * Memoization utilities for expensive schema operations
 */

import { createHash } from 'crypto';

interface MemoizeOptions {
    maxSize?: number; // LRU cache size
    ttl?: number; // Time to live in milliseconds
}

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

/**
 * LRU Cache with TTL support for memoization
 */
class MemoCache<K, V> {
    private cache: Map<K, CacheEntry<V>> = new Map();
    private accessOrder: K[] = [];
    private maxSize: number;
    private ttl?: number;

    constructor(options: MemoizeOptions = {}) {
        this.maxSize = options.maxSize || 1000;
        this.ttl = options.ttl;
    }

    get(key: K): V | undefined {
        const entry = this.cache.get(key);
        
        if (!entry) return undefined;

        // Check TTL
        if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return undefined;
        }

        // Update access order (move to end)
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(key);

        return entry.value;
    }

    set(key: K, value: V): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const oldest = this.accessOrder.shift();
            if (oldest !== undefined) {
                this.cache.delete(oldest);
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
        });

        // Update access order
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
            this.accessOrder.splice(index, 1);
        }
        this.accessOrder.push(key);
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder = [];
    }

    get size(): number {
        return this.cache.size;
    }
}

/**
 * Memoize expensive function calls with argument-based caching
 */
export function memoize<T extends (...args: any[]) => any>(
    fn: T,
    options: MemoizeOptions & {
        keyGenerator?: (...args: Parameters<T>) => string;
    } = {}
): T {
    const cache = new MemoCache<string, ReturnType<T>>(options);

    const keyGenerator = options.keyGenerator || ((...args: any[]) => {
        return createHash('sha256')
            .update(JSON.stringify(args))
            .digest('hex');
    });

    const memoized = function (this: any, ...args: Parameters<T>): ReturnType<T> {
        const key = keyGenerator(...args);
        const cached = cache.get(key);

        if (cached !== undefined) {
            return cached;
        }

        const result = fn.apply(this, args);

        // Handle promises
        if (result instanceof Promise) {
            return result.then((value) => {
                cache.set(key, value);
                return value;
            }) as any;
        }

        cache.set(key, result);
        return result;
    } as T;

    // Add cache management methods
    (memoized as any).clearCache = () => cache.clear();
    (memoized as any).getCacheSize = () => cache.size;

    return memoized;
}

/**
 * Method decorator for memoization
 */
export function Memoize(options: MemoizeOptions = {}): MethodDecorator {
    return function (
        target: any,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        descriptor.value = memoize(originalMethod, options);
        return descriptor;
    };
}

/**
 * Batch multiple operations together to reduce round trips
 */
export class OperationBatcher<T, R> {
    private queue: Array<{
        operation: T;
        resolve: (value: R) => void;
        reject: (error: any) => void;
    }> = [];
    private timeout?: NodeJS.Timeout;
    private readonly batchDelay: number;
    private readonly maxBatchSize: number;
    private readonly processor: (operations: T[]) => Promise<R[]>;

    constructor(
        processor: (operations: T[]) => Promise<R[]>,
        options: {
            batchDelay?: number; // ms to wait before processing batch
            maxBatchSize?: number;
        } = {}
    ) {
        this.processor = processor;
        this.batchDelay = options.batchDelay || 10;
        this.maxBatchSize = options.maxBatchSize || 100;
    }

    add(operation: T): Promise<R> {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation, resolve, reject });

            // Auto-flush if batch is full
            if (this.queue.length >= this.maxBatchSize) {
                this.flush();
                return;
            }

            // Schedule flush if not already scheduled
            if (!this.timeout) {
                this.timeout = setTimeout(() => this.flush(), this.batchDelay);
            }
        });
    }

    private async flush(): Promise<void> {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }

        if (this.queue.length === 0) return;

        const batch = this.queue.splice(0, this.queue.length);
        const operations = batch.map((item) => item.operation);

        try {
            const results = await this.processor(operations);

            batch.forEach((item, index) => {
                item.resolve(results[index]);
            });
        } catch (error) {
            batch.forEach((item) => {
                item.reject(error);
            });
        }
    }
}

/**
 * Example usage for schema introspection
 */
export class SchemaIntrospectionOptimizer {
    // Cache for field type lookups
    @Memoize({ maxSize: 500, ttl: 60000 })
    getFieldType(typeName: string, fieldName: string): any {
        // Expensive introspection logic here
        return null;
    }

    // Cache for relationship metadata
    @Memoize({ maxSize: 200 })
    getRelationshipMetadata(fromType: string, relationshipName: string): any {
        // Expensive relationship analysis
        return null;
    }

    // Batch multiple type lookups
    private typeLookupBatcher = new OperationBatcher(
        async (typeNames: string[]) => {
            // Batch lookup logic
            return typeNames.map(() => ({}));
        },
        { batchDelay: 5, maxBatchSize: 50 }
    );

    async getType(typeName: string): Promise<any> {
        return this.typeLookupBatcher.add(typeName);
    }
}
