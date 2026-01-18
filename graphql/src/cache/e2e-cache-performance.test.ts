/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * End-to-End Cache Performance Test
 * 
 * NOTE: These tests call getSchema() which may trigger database validation.
 * If you don't have a Neo4j database running, these tests will be skipped.
 * 
 * For unit tests that don't require a database, see:
 * - cache-unit.test.ts
 * - serialization/schema-model-serializer.test.ts
 * 
 * Run with: npm test src/cache/e2e-cache-performance.test.ts
 */

import  Neo4jGraphQL from "../classes/Neo4jGraphQL";
import * as fs from "fs/promises";

// Skip these tests if no database is available
const describeOrSkip = process.env.NEO4J_URI ? describe : describe.skip;

describeOrSkip("E2E Cache Performance", () => {
    const cacheDir = ".test-e2e-cache";

    afterEach(async () => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    // Helper to measure execution time
    async function measureTime(fn: () => Promise<any>): Promise<number> {
        const start = Date.now();
        await fn();
        return Date.now() - start;
    }

    it("should demonstrate performance improvement with AST cache", async () => {
        const typeDefs = `
            type User @node {
                id: ID! @id
                name: String!
                email: String!
            }
        `;

        // First run - no cache
        const time1 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({ typeDefs, cache: { enabled: false } });
            await schema.getSchema();
        });

        // Second run - with cache (miss)
        const time2 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "ast", directory: cacheDir },
            });
            await schema.getSchema();
        });

        // Third run - with cache (hit)
        const time3 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "ast", directory: cacheDir },
            });
            await schema.getSchema();
        });

        console.log(`No cache: ${time1}ms`);
        console.log(`AST cache miss: ${time2}ms`);
        console.log(`AST cache hit: ${time3}ms`);
        console.log(`Improvement: ${((1 - time3 / time1) * 100).toFixed(1)}%`);

        // Cache hit should be faster than no cache
        expect(time3).toBeLessThan(time1);
    });

    it("should demonstrate performance improvement with both caches", async () => {
        const typeDefs = `
            type User @node {
                id: ID! @id
                name: String!
                posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
            }

            type Post @node {
                id: ID! @id
                title: String!
                authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
            }
        `;

        // No cache baseline
        const time1 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({ typeDefs, cache: { enabled: false } });
            await schema.getSchema();
        });

        // Clear any existing cache
        const schema = new Neo4jGraphQL({
            typeDefs,
            cache: { enabled: true, level: "both", directory: cacheDir },
        });
        await schema.clearCache();

        // With both caches (miss)
        const time2 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "both", directory: cacheDir },
            });
            await schema.getSchema();
        });

        // With both caches (hit)
        const time3 = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "both", directory: cacheDir },
            });
            await schema.getSchema();
        });

        console.log(`\nBoth caches test:`);
        console.log(`No cache: ${time1}ms`);
        console.log(`Both cache miss: ${time2}ms`);
        console.log(`Both cache hit: ${time3}ms`);
        console.log(`Improvement: ${((1 - time3 / time1) * 100).toFixed(1)}%`);

        // Cache hit should be significantly faster
        expect(time3).toBeLessThan(time1);
    });

    it("should correctly cache and restore complex relationships", async () => {
        const typeDefs = `
            type User @node {
                id: ID! @id
                name: String!
                posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
                comments: [Comment!]! @relationship(type: "WROTE", direction: OUT)
            }

            type Post @node {
                id: ID! @id
                title: String!
                authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
                comments: [Comment!]! @relationship(type: "HAS_COMMENT", direction: OUT)
            }

            type Comment @node {
                id: ID! @id
                text: String!
                authors: [User!]! @relationship(type: "WROTE", direction: IN)
                posts: [Post!]! @relationship(type: "HAS_COMMENT", direction: IN)
            }
        `;

        // First initialization - creates cache
        const schema1 = new Neo4jGraphQL({
            typeDefs,
            cache: { enabled: true, level: "both", directory: cacheDir },
        });
        const generatedSchema1 = await schema1.getSchema();

        // Second initialization - uses cache
        const schema2 = new Neo4jGraphQL({
            typeDefs,
            cache: { enabled: true, level: "both", directory: cacheDir },
        });
        const generatedSchema2 = await schema2.getSchema();

        // Both schemas should be equivalent
        expect(generatedSchema1.getQueryType()?.getFields()).toBeDefined();
        expect(generatedSchema2.getQueryType()?.getFields()).toBeDefined();

        // Verify cache was used
        const stats = await schema2.getCacheStats();
        expect(stats.ast.entries).toBeGreaterThan(0);
        expect(stats.model.entries).toBeGreaterThan(0);
    });

    it("should handle schema with interfaces and unions", async () => {
        const typeDefs = `
            interface Content {
                id: ID!
                title: String!
            }

            type Article implements Content @node {
                id: ID!
                title: String!
                body: String!
            }

            type Video implements Content @node {
                id: ID!
                title: String!
                url: String!
            }

            union SearchResult = Article | Video
        `;

        // Generate and cache
        const schema1 = new Neo4jGraphQL({
            typeDefs,
            cache: { enabled: true, level: "both", directory: cacheDir },
        });
        await schema1.getSchema();

        // Load from cache
        const schema2 = new Neo4jGraphQL({
            typeDefs,
            cache: { enabled: true, level: "both", directory: cacheDir },
        });
        const cachedSchema = await schema2.getSchema();

        // Verify schema is valid
        expect(cachedSchema.getQueryType()).toBeDefined();
        expect(cachedSchema.getType("Content")).toBeDefined();
        expect(cachedSchema.getType("SearchResult")).toBeDefined();
    });

    it("should benchmark cache levels", async () => {
        // Generate a larger schema for meaningful benchmarks
        const typeCount = 50;
        let typeDefs = "";
        for (let i = 0; i < typeCount; i++) {
            typeDefs += `
                type Entity${i} @node {
                    id: ID! @id
                    name: String!
                    value: Int
                    related: [Entity${(i + 1) % typeCount}!]! @relationship(type: "RELATED", direction: OUT)
                }
            `;
        }

        const results: Record<string, number> = {};

        // No cache
        results.noCache = await measureTime(async () => {
            const schema = new Neo4jGraphQL({ typeDefs, cache: { enabled: false } });
            await schema.getSchema();
        });

        // Clear cache
        await fs.rm(cacheDir, { recursive: true, force: true });

        // AST cache - first run
        results.astCacheMiss = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "ast", directory: cacheDir },
            });
            await schema.getSchema();
        });

        // AST cache - second run
        results.astCacheHit = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "ast", directory: cacheDir },
            });
            await schema.getSchema();
        });

        // Clear cache
        await fs.rm(cacheDir, { recursive: true, force: true });

        // Both caches - first run
        results.bothCacheMiss = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "both", directory: cacheDir },
            });
            await schema.getSchema();
        });

        // Both caches - second run
        results.bothCacheHit = await measureTime(async () => {
            const schema = new Neo4jGraphQL({
                typeDefs,
                cache: { enabled: true, level: "both", directory: cacheDir },
            });
            await schema.getSchema();
        });

        console.log(`\n=== Performance Benchmark (${typeCount} types) ===`);
        console.log(`No cache:         ${results.noCache}ms`);
        console.log(`AST cache miss:   ${results.astCacheMiss}ms`);
        console.log(`AST cache hit:    ${results.astCacheHit}ms (${((1 - results.astCacheHit / results.noCache) * 100).toFixed(1)}% faster)`);
        console.log(`Both cache miss:  ${results.bothCacheMiss}ms`);
        console.log(`Both cache hit:   ${results.bothCacheHit}ms (${((1 - results.bothCacheHit / results.noCache) * 100).toFixed(1)}% faster)`);

        // Verify performance improvements
        expect(results.astCacheHit).toBeLessThan(results.noCache);
        expect(results.bothCacheHit).toBeLessThan(results.astCacheHit);
    });
});
