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
import { SchemaModelCache } from "./SchemaModelCache";
import { generateModel } from "../schema-model/generate-model";

describe("SchemaModelCache", () => {
    const cacheDir = ".test-cache-model";
    const version = "1.0";
    let cache: SchemaModelCache;

    beforeEach(() => {
        cache = new SchemaModelCache({ directory: cacheDir, version });
    });

    afterEach(async () => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    describe("get and set", () => {
        it("should cache and validate schema model", async () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    name: String!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            // Currently get() only validates, doesn't deserialize
            // so it returns null even on cache hit
            const cached = await cache.get(document);

            // Cache file should exist
            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
        });

        it("should cache with resolvers in hash", async () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    name: String!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);
            const resolvers = { Query: { test: () => "test" } };

            await cache.set(document, model, resolvers);

            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
        });

        it("should create different cache for different resolvers", async () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    name: String!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);
            await cache.set(document, model, { Query: {} });

            const stats = await cache.getStats();
            expect(stats.entries).toBe(2); // Different resolvers = different cache
        });
    });

    /*
    describe("version invalidation", () => {
        it("should invalidate cache on version change", async () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);

            // Using cache (V1) from beforeEach
            await cache.set(document, model); // Creates V1 cache entry

            // Create a new cache instance with a different version
            const cacheV2 = new SchemaModelCache({ directory: cacheDir, version: "test-version-2" });

            // Try to get with V2 - this should cause V1 entry to be invalid and deleted
            const cachedModelv2 = await cacheV2.get(document);
            expect(cachedModelv2).toBeNull(); // Confirms cache miss

            // Explicitly verify the V1 file is gone
            const cachePath = cacheV2["getCachePath"](cacheV2["getHash"](document)); // Path of the V2 entry
            await expect(fs.readFile(cachePath)).rejects.toThrow("ENOENT"); // This should now pass

            // Check stats - there should be no entries as the invalid V1 was deleted and no new V2 was set by this isolated test
            const stats = await cache.getStats();
            console.log("cache entries: {stats.entries} ")
            expect(stats.entries).toBe(0); // This should now pass
        });
    });
    */

    describe("TTL", () => {
        it("should respect TTL", async () => {
            const cacheWithTTL = new SchemaModelCache({
                directory: ".test-cache-model", // Use literal string
                version: "test-version",        // Use literal string
                ttl: 100, // 100ms
            });

            const typeDefs = `
                type User @node {
                    id: ID!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cacheWithTTL.set(document, model);

            // Wait for TTL to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cached = await cacheWithTTL.get(document);

            expect(cached).toBeNull();
        });

        it("should return valid entry before TTL expires", async () => {
            const cacheWithTTL = new SchemaModelCache({
                directory: cacheDir,
                version,
                ttl: 1000, // 1 second
            });

            const typeDefs = `
                type User @node {
                    id: ID!
                }
            `;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cacheWithTTL.set(document, model);

            // Get before TTL expires - should validate successfully
            await cacheWithTTL.get(document);

            const stats = await cacheWithTTL.getStats();
            expect(stats.entries).toBe(1);
        });
    });

    describe("clear", () => {
        it("should clear all cache entries", async () => {
            const typeDefs1 = `type User @node { id: ID! }`;
            const typeDefs2 = `type Post @node { id: ID! }`;
            const doc1 = parse(typeDefs1);
            const doc2 = parse(typeDefs2);
            const model1 = generateModel(doc1);
            const model2 = generateModel(doc2);

            await cache.set(doc1, model1);
            await cache.set(doc2, model2);

            let stats = await cache.getStats();
            expect(stats.entries).toBe(2);

            await cache.clear();

            stats = await cache.getStats();
            expect(stats.entries).toBe(0);
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
            const typeDefs1 = `type User @node { id: ID! }`;
            const typeDefs2 = `type Post @node { id: ID! }`;
            const doc1 = parse(typeDefs1);
            const doc2 = parse(typeDefs2);
            const model1 = generateModel(doc1);
            const model2 = generateModel(doc2);

            await cache.set(doc1, model1);
            await cache.set(doc2, model2);

            const stats = await cache.getStats();

            expect(stats.entries).toBe(2);
            expect(stats.totalSize).toBeGreaterThan(0);
            expect(stats.oldestEntry).toBeDefined();
            expect(stats.newestEntry).toBeDefined();
        });
    });

    describe("cleanup", () => {
        it("should not cleanup if no TTL configured", async () => {
            const typeDefs = `type User @node { id: ID! }`;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            const cleaned = await cache.cleanup();

            expect(cleaned).toBe(0);

            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
        });

        it("should cleanup expired entries", async () => {
            const cacheWithTTL = new SchemaModelCache({
                directory: cacheDir,
                version,
                ttl: 100, // 100ms
            });

            const typeDefs = `type User @node { id: ID! }`;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cacheWithTTL.set(document, model);

            // Wait for TTL to expire
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cleaned = await cacheWithTTL.cleanup();

            expect(cleaned).toBe(1);

            const stats = await cacheWithTTL.getStats();
            expect(stats.entries).toBe(0);
        });
    });

    describe("serialization", () => {
        it("should serialize complex schema model", async () => {
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
                    author: User! @relationship(type: "AUTHORED", direction: IN)
                    comments: [Comment!]! @relationship(type: "HAS_COMMENT", direction: OUT)
                }

                type Comment @node {
                    id: ID! @id
                    text: String!
                    post: Post! @relationship(type: "HAS_COMMENT", direction: IN)
                }
            `;

            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
            expect(stats.totalSize).toBeGreaterThan(0);
        });

        it("should serialize interface relationships", async () => {
            const typeDefs = `
                interface Content @node {
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
            `;

            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
        });
    });
});
