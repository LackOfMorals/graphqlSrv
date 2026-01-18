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
 * Integration tests for Neo4jGraphQL caching
 * 
 * NOTE: These tests call getSchema() which may trigger database validation.
 * If you don't have a Neo4j database running, these tests may fail.
 * 
 * For unit tests that don't require a database, see:
 * - cache-unit.test.ts
 * - serialization/schema-model-serializer.test.ts
 */

import * as fs from "fs/promises";
import Neo4jGraphQL from "./Neo4jGraphQL";

// Skip these tests if no database is available
const describeOrSkip = process.env.NEO4J_URI ? describe : describe.skip;

describeOrSkip("Neo4jGraphQL with caching", () => {
    const cacheDir = ".test-neo4j-cache";
    const typeDefs = `
        type User @node {
            id: ID! @id
            name: String!
            email: String!
            posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
        }

        type Post @node {
            id: ID! @id
            title: String!
            content: String!
            authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
        }
    `;

    afterEach(async () => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    describe("cache levels", () => {
        it("should support ast cache level", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "ast",
                    directory: cacheDir,
                },
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(1);
            expect(stats.model.entries).toBe(0); // Model cache not enabled
        });

        it("should support model cache level", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "model",
                    directory: cacheDir,
                },
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(0); // AST cache not enabled
            expect(stats.model.entries).toBe(1);
        });

        it("should support both cache levels", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "both",
                    directory: cacheDir,
                },
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(1);
            expect(stats.model.entries).toBe(1);
        });

        it("should default to both when level not specified", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    directory: cacheDir,
                },
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(1);
            expect(stats.model.entries).toBe(1);
        });
    });

    describe("cache on second initialization", () => {
        it("should use AST cache on second init", async () => {
            // First initialization - cache miss
            const start1 = Date.now();
            const neoSchema1 = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "ast",
                    directory: cacheDir,
                },
            });
            await neoSchema1.getSchema();
            const time1 = Date.now() - start1;

            // Second initialization - cache hit
            const start2 = Date.now();
            const neoSchema2 = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "ast",
                    directory: cacheDir,
                },
            });
            await neoSchema2.getSchema();
            const time2 = Date.now() - start2;

            // Cache should improve performance
            expect(time2).toBeLessThan(time1);

            const stats = await neoSchema2.getCacheStats();
            expect(stats.ast.entries).toBe(1);
        });

        it("should cache schema model on second init", async () => {
            const neoSchema1 = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "model",
                    directory: cacheDir,
                },
            });
            await neoSchema1.getSchema();

            const neoSchema2 = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "model",
                    directory: cacheDir,
                },
            });
            await neoSchema2.getSchema();

            const stats = await neoSchema2.getCacheStats();
            expect(stats.model.entries).toBe(1);
        });
    });

    describe("clearCache", () => {
        it("should clear all caches", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "both",
                    directory: cacheDir,
                },
            });

            await neoSchema.getSchema();

            let stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(1);
            expect(stats.model.entries).toBe(1);

            await neoSchema.clearCache();

            stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(0);
            expect(stats.model.entries).toBe(0);
        });
    });

    describe("cleanupCache", () => {
        it("should cleanup both caches", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: true,
                    level: "both",
                    directory: cacheDir,
                    ttl: 100, // 100ms
                },
            });

            await neoSchema.getSchema();

            // Wait for TTL
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cleaned = await neoSchema.cleanupCache();

            expect(cleaned.ast).toBe(1);
            expect(cleaned.model).toBe(1);
        });
    });

    describe("disabled cache", () => {
        it("should not cache when disabled", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
                cache: {
                    enabled: false,
                },
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(0);
            expect(stats.model.entries).toBe(0);
        });

        it("should not cache when cache config omitted", async () => {
            const neoSchema = new Neo4jGraphQL({
                typeDefs,
            });

            await neoSchema.getSchema();

            const stats = await neoSchema.getCacheStats();
            expect(stats.ast.entries).toBe(0);
            expect(stats.model.entries).toBe(0);
        });
    });
});
