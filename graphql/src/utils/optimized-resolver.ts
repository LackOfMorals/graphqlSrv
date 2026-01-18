/*
 * Optimized resolver wrapper - combines multiple performance techniques
 */

import type { GraphQLFieldResolver } from 'graphql';
import type { Driver } from 'neo4j-driver';
import { DataLoaderFactory } from '../classes/DataLoaderFactory';
import { PerformanceProfiler, QueryPerformanceTracker } from './performance-profiler';
import { memoize } from './memoization';
import Debug from 'debug';

const debug = Debug('@neo4j/graphql:resolver');

interface OptimizedResolverContext {
    driver: Driver;
    dataLoaders?: DataLoaderFactory;
    profiler?: PerformanceProfiler;
    queryTracker?: QueryPerformanceTracker;
}

interface ResolverOptions {
    // Caching
    enableMemoization?: boolean;
    memoizationTTL?: number;
    
    // Performance tracking
    enableProfiling?: boolean;
    slowThreshold?: number; // ms
    
    // Batching
    enableDataLoader?: boolean;
    
    // Complexity
    maxDepth?: number;
    complexity?: number;
}

/**
 * Create an optimized resolver with built-in performance enhancements
 */
export function createOptimizedResolver<TSource = any, TContext = any, TArgs = any>(
    resolver: GraphQLFieldResolver<TSource, TContext, TArgs>,
    options: ResolverOptions = {}
): GraphQLFieldResolver<TSource, TContext, TArgs> {
    const {
        enableMemoization = false,
        memoizationTTL = 60000,
        enableProfiling = true,
        slowThreshold = 100,
        enableDataLoader = true,
        maxDepth = 10,
        complexity = 1,
    } = options;

    // Wrap with memoization if enabled
    let wrappedResolver = resolver;
    
    if (enableMemoization) {
        wrappedResolver = memoize(resolver, {
            ttl: memoizationTTL,
            keyGenerator: (source, args, context, info) => {
                // Generate cache key based on arguments and selection
                return `${info.parentType.name}.${info.fieldName}:${JSON.stringify(args)}`;
            },
        });
    }

    // Return optimized resolver
    return async (source, args, context: OptimizedResolverContext, info) => {
        const startTime = Date.now();
        const resolverName = `${info.parentType.name}.${info.fieldName}`;

        try {
            // Check query depth
            const depth = getQueryDepth(info);
            if (depth > maxDepth) {
                throw new Error(
                    `Query depth ${depth} exceeds maximum allowed depth of ${maxDepth}`
                );
            }

            // Execute resolver with profiling
            let result: any;
            
            if (enableProfiling && context.profiler) {
                result = await context.profiler.measure(
                    resolverName,
                    async () => wrappedResolver(source, args, context as any, info)
                );
            } else {
                result = await wrappedResolver(source, args, context as any, info);
            }

            // Log slow queries
            const duration = Date.now() - startTime;
            if (duration > slowThreshold) {
                debug(`Slow resolver [${resolverName}]: ${duration}ms`, {
                    args,
                    depth,
                    complexity,
                });
            }

            return result;
        } catch (error) {
            debug(`Resolver error [${resolverName}]:`, error);
            throw error;
        }
    };
}

/**
 * Create a batch-enabled resolver using DataLoader
 */
export function createBatchResolver<TSource = any, TContext = any, TArgs = any, TKey = string>(
    batchLoadFn: (keys: readonly TKey[], context: TContext) => Promise<any[]>,
    keyExtractor: (source: TSource, args: TArgs) => TKey,
    options: Omit<ResolverOptions, 'enableDataLoader'> = {}
): GraphQLFieldResolver<TSource, TContext, TArgs> {
    const DataLoader = require('dataloader');
    
    return createOptimizedResolver(
        async (source, args, context: any, info) => {
            // Create or get DataLoader
            if (!context.dataLoaders) {
                context.dataLoaders = new Map();
            }

            const loaderKey = `${info.parentType.name}.${info.fieldName}`;
            
            if (!context.dataLoaders.has(loaderKey)) {
                context.dataLoaders.set(
                    loaderKey,
                    new DataLoader(
                        (keys: readonly TKey[]) => batchLoadFn(keys, context),
                        { cache: true }
                    )
                );
            }

            const loader = context.dataLoaders.get(loaderKey);
            const key = keyExtractor(source, args);
            
            return loader.load(key);
        },
        { ...options, enableDataLoader: true }
    );
}

/**
 * Create a resolver with automatic connection pooling
 */
export function createPooledResolver<TSource = any, TContext = any, TArgs = any>(
    cypherQuery: string | ((source: TSource, args: TArgs) => string),
    paramExtractor: (source: TSource, args: TArgs) => Record<string, any>,
    resultTransform: (records: any[]) => any,
    options: ResolverOptions & {
        readOnly?: boolean;
    } = {}
): GraphQLFieldResolver<TSource, TContext, TArgs> {
    const { readOnly = true } = options;

    return createOptimizedResolver(
        async (source, args, context: OptimizedResolverContext, info) => {
            const driver = context.driver;
            const session = driver.session({
                defaultAccessMode: readOnly ? 'READ' : 'WRITE',
            });

            try {
                const query = typeof cypherQuery === 'function' 
                    ? cypherQuery(source, args) 
                    : cypherQuery;
                const params = paramExtractor(source, args);

                // Track query execution
                let result;
                if (context.queryTracker) {
                    result = await context.queryTracker.trackCypher(
                        query,
                        params,
                        () => session.run(query, params)
                    );
                } else {
                    result = await session.run(query, params);
                }

                return resultTransform(result.records);
            } finally {
                await session.close();
            }
        },
        options
    );
}

/**
 * Helper to calculate query depth
 */
function getQueryDepth(info: any, depth = 0): number {
    const selections = info.fieldNodes[0]?.selectionSet?.selections;
    
    if (!selections || selections.length === 0) {
        return depth;
    }

    return Math.max(
        ...selections.map((selection: any) => {
            if (selection.selectionSet) {
                return getQueryDepth(
                    { ...info, fieldNodes: [selection] },
                    depth + 1
                );
            }
            return depth + 1;
        })
    );
}

/**
 * Middleware to inject performance context
 */
export function createPerformanceContext(driver: Driver) {
    const profiler = new PerformanceProfiler(process.env.NODE_ENV !== 'production');
    const queryTracker = new QueryPerformanceTracker(profiler);
    const dataLoaders = new DataLoaderFactory({ driver });

    return {
        driver,
        profiler,
        queryTracker,
        dataLoaders,
    };
}

/**
 * Example usage patterns
 */

// Example 1: Simple optimized resolver
export const getUserResolver = createOptimizedResolver(
    async (source, args, context: OptimizedResolverContext, info) => {
        const session = context.driver.session();
        try {
            const result = await session.run(
                'MATCH (u:User {id: $id}) RETURN u',
                { id: args.id }
            );
            return result.records[0]?.get('u').properties;
        } finally {
            await session.close();
        }
    },
    {
        enableMemoization: true,
        enableProfiling: true,
        slowThreshold: 50,
    }
);

// Example 2: Batch-enabled resolver
export const userPostsResolver = createBatchResolver(
    async (userIds: readonly string[], context: OptimizedResolverContext) => {
        const session = context.driver.session();
        try {
            const result = await session.run(
                `
                UNWIND $userIds AS userId
                MATCH (u:User {id: userId})-[:AUTHORED]->(p:Post)
                RETURN userId, collect(p) AS posts
                `,
                { userIds: Array.from(userIds) }
            );

            const postMap = new Map(
                result.records.map((r) => [
                    r.get('userId'),
                    r.get('posts').map((p: any) => p.properties),
                ])
            );

            return userIds.map((id) => postMap.get(id) || []);
        } finally {
            await session.close();
        }
    },
    (source: any) => source.id, // Key extractor
    {
        enableProfiling: true,
        complexity: 10, // Higher complexity for relationship fields
    }
);

// Example 3: Pooled resolver with read-only optimization
export const searchUsersResolver = createPooledResolver(
    'MATCH (u:User) WHERE u.name CONTAINS $searchTerm RETURN u LIMIT $limit',
    (source, args) => ({
        searchTerm: args.searchTerm,
        limit: args.limit || 50,
    }),
    (records) => records.map((r) => r.get('u').properties),
    {
        readOnly: true,
        enableMemoization: true,
        memoizationTTL: 30000, // 30 seconds
        slowThreshold: 100,
    }
);

/**
 * Performance reporting middleware
 */
export function createPerformanceReporter(profiler: PerformanceProfiler) {
    return {
        onExecuteDone() {
            const metrics = profiler.getAllMetrics();
            
            // Log performance summary
            const summary = Array.from(metrics.entries())
                .filter(([, m]) => m.count > 0)
                .map(([name, m]) => ({
                    name,
                    avg: m.avg.toFixed(2),
                    p95: m.p95.toFixed(2),
                    count: m.count,
                }));

            if (summary.length > 0) {
                debug('Performance Summary:', summary);
            }

            // Alert on slow operations
            const slowOps = profiler.getSlowOperations(100);
            if (slowOps.length > 0) {
                debug('Slow Operations:', slowOps.slice(0, 5));
            }
        },
    };
}
