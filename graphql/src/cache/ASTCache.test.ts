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

import { parse } from "graphql";
import * as fs from "fs/promises";
import { ASTCache } from "./ASTCache";

describe("ASTCache", () => {
    const cacheDir = ".test-cache";
    const version = "test-version";
    let cache: ASTCache;

    beforeEach(() => {
        cache = new ASTCache({ directory: cacheDir, version });
    });

    afterEach(async () => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    describe("get and set", () => {
        it("should cache and retrieve AST", async () => {
            const typeDefs = "type User { id: ID! name: String! }";
            const ast = parse(typeDefs);

            await cache.set(typeDefs, ast);
            const cached = await cache.get(typeDefs);

            expect(cached).toBeDefined();
            expect(cached?.kind).toBe("Document");
        });

        it("should return null for cache miss", async () => {
            const typeDefs = "type User { id: ID! }";
            const cached = await cache.get(typeDefs);

            expect(cached).toBeNull();
        });

        it("should cache different type defs separately", async () => {
            const typeDefs1 = "type User { id: ID! }";
            const typeDefs2 = "type Post { id: ID! }";
            const ast1 = parse(typeDefs1);
            const ast2 = parse(typeDefs2);

            await cache.set(typeDefs1, ast1);
            await cache.set(typeDefs2, ast2);

            const cached1 = await cache.get(typeDefs1);
            const cached2 = await cache.get(typeDefs2);

            expect(cached1).toBeDefined();
            expect(cached2).toBeDefined();
        });
    });

    describe("version invalidation", () => {
        it("should invalidate cache on version change", async () => {
            const typeDefs = "type User { id: ID! }";
            const ast = parse(typeDefs);

            await cache.set(typeDefs, ast);

            // Create a new cache with different version
            const cacheV2 = new ASTCache({ directory: cacheDir, version: "test-version-2" });
            const cached = await cacheV2.get(typeDefs);

            expect(cached).toBeNull();
        });
    });

    describe("TTL", () => {
        it("should respect TTL", async () => {
            const cacheWithTTL = new ASTCache({
                directory: cacheDir,
                version,
                ttl: 100, // 100ms
            });

            const typeDefs = "type User { id: ID! }";
            const ast = parse(typeDefs);

            await cacheWithTTL.set(typeDefs, ast);

            // Wait for TTL to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cached = await cacheWithTTL.get(typeDefs);

            expect(cached).toBeNull();
        });

        it("should return valid entry before TTL expires", async () => {
            const cacheWithTTL = new ASTCache({
                directory: cacheDir,
                version,
                ttl: 1000, // 1 second
            });

            const typeDefs = "type User { id: ID! }";
            const ast = parse(typeDefs);

            await cacheWithTTL.set(typeDefs, ast);

            const cached = await cacheWithTTL.get(typeDefs);

            expect(cached).toBeDefined();
        });
    });

    describe("clear", () => {
        it("should clear all cache entries", async () => {
            const typeDefs1 = "type User { id: ID! }";
            const typeDefs2 = "type Post { id: ID! }";
            const ast1 = parse(typeDefs1);
            const ast2 = parse(typeDefs2);

            await cache.set(typeDefs1, ast1);
            await cache.set(typeDefs2, ast2);

            await cache.clear();

            const cached1 = await cache.get(typeDefs1);
            const cached2 = await cache.get(typeDefs2);

            expect(cached1).toBeNull();
            expect(cached2).toBeNull();
        });
    });

    describe("getStats", () => {
        it("should return stats for empty cache", async () => {
            const stats = await cache.getStats();

            expect(stats.entries).toBe(0);
            expect(stats.totalSize).toBe(0);
            expect(stats.oldestEntry).toBeUndefined();
            expect(stats.newestEntry).toBeUndefined();
        });

        it("should return stats for cache with entries", async () => {
            const typeDefs1 = "type User { id: ID! }";
            const typeDefs2 = "type Post { id: ID! }";
            const ast1 = parse(typeDefs1);
            const ast2 = parse(typeDefs2);

            await cache.set(typeDefs1, ast1);
            await cache.set(typeDefs2, ast2);

            const stats = await cache.getStats();

            expect(stats.entries).toBe(2);
            expect(stats.totalSize).toBeGreaterThan(0);
            expect(stats.oldestEntry).toBeDefined();
            expect(stats.newestEntry).toBeDefined();
        });
    });

    describe("cleanup", () => {
        it("should not cleanup if no TTL configured", async () => {
            const typeDefs = "type User { id: ID! }";
            const ast = parse(typeDefs);

            await cache.set(typeDefs, ast);

            const cleaned = await cache.cleanup();

            expect(cleaned).toBe(0);

            const cached = await cache.get(typeDefs);
            expect(cached).toBeDefined();
        });

        it("should cleanup expired entries", async () => {
            const cacheWithTTL = new ASTCache({
                directory: cacheDir,
                version,
                ttl: 100, // 100ms
            });

            const typeDefs = "type User { id: ID! }";
            const ast = parse(typeDefs);

            await cacheWithTTL.set(typeDefs, ast);

            // Wait for TTL to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cleaned = await cacheWithTTL.cleanup();

            expect(cleaned).toBe(1);

            const cached = await cacheWithTTL.get(typeDefs);
            expect(cached).toBeNull();
        });
    });
});
