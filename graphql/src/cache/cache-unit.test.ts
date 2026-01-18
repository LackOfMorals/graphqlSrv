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
 * Unit tests for cache that don't require a database connection
 * These test ONLY the caching mechanism, not the full GraphQL schema generation
 */

import { parse } from "graphql";
import * as fs from "fs/promises";
import { ASTCache } from "./ASTCache";
import { SchemaModelCache } from "./SchemaModelCache";
import { generateModel } from "../schema-model/generate-model";
import { serializeSchemaModel, deserializeSchemaModel } from "./serialization/schema-model-serializer";

describe("Cache Unit Tests (No Database Required)", () => {
    const cacheDir = ".test-cache-unit";

    afterEach(async () => {
        await fs.rm(cacheDir, { recursive: true, force: true });
    });

    describe("ASTCache", () => {
        let cache: ASTCache;

        beforeEach(() => {
            cache = new ASTCache({
                directory: cacheDir,
                version: "test-version",
            });
        });

        it("should cache and retrieve AST", async () => {
            const typeDefs = "type User @node { id: ID! name: String! }";
            const ast = parse(typeDefs);

            await cache.set(typeDefs, ast);
            const cached = await cache.get(typeDefs);

            expect(cached).toBeDefined();
            expect(cached?.kind).toBe("Document");
        });

        it("should invalidate on version change", async () => {
            const typeDefs = "type User @node { id: ID! }";
            const ast = parse(typeDefs);

            await cache.set(typeDefs, ast);

            const cacheV2 = new ASTCache({
                directory: cacheDir,
                version: "different-version",
            });
            const cached = await cacheV2.get(typeDefs);

            expect(cached).toBeNull();
        });

        it("should respect TTL", async () => {
            const cacheWithTTL = new ASTCache({
                directory: cacheDir,
                version: "test-version",
                ttl: 100,
            });

            const typeDefs = "type User @node { id: ID! }";
            const ast = parse(typeDefs);

            await cacheWithTTL.set(typeDefs, ast);
            await new Promise((resolve) => setTimeout(resolve, 150));

            const cached = await cacheWithTTL.get(typeDefs);
            expect(cached).toBeNull();
        });
    });

    describe("SchemaModelCache Serialization", () => {
        it("should serialize and deserialize simple schema", () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    name: String!
                }
            `;

            const document = parse(typeDefs);
            const model = generateModel(document);

            const serialized = serializeSchemaModel(model);
            const deserialized = deserializeSchemaModel(serialized);

            expect(deserialized.concreteEntities).toHaveLength(1);
            const firstEntity = deserialized.concreteEntities[0];
            expect(firstEntity).toBeDefined();
            expect(firstEntity?.name).toBe("User");
        });

        it("should serialize and deserialize relationships", () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
                }

                type Post @node {
                    id: ID!
                    title: String!
                    authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
                }
            `;

            const document = parse(typeDefs);
            const model = generateModel(document);

            const serialized = serializeSchemaModel(model);
            const deserialized = deserializeSchemaModel(serialized);

            const user = deserialized.getEntity("User");
            const post = deserialized.getEntity("Post");

            expect(user).toBeDefined();
            expect(post).toBeDefined();

            // Verify relationships are properly linked
            const userEntity = user as any;
            expect(userEntity.relationships?.size).toBe(1);
        });
    });

    describe("SchemaModelCache Storage", () => {
        let cache: SchemaModelCache;

        beforeEach(() => {
            cache = new SchemaModelCache({
                directory: cacheDir,
                version: "test-version",
            });
        });

        it("should store and retrieve model metadata", async () => {
            const typeDefs = `
                type User @node {
                    id: ID!
                    name: String!
                }
            `;

            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            const stats = await cache.getStats();
            expect(stats.entries).toBe(1);
            expect(stats.totalSize).toBeGreaterThan(0);
        });

        it("should handle version mismatch", async () => {
            const typeDefs = `type User @node { id: ID! }`;
            const document = parse(typeDefs);
            const model = generateModel(document);

            await cache.set(document, model);

            const cacheV2 = new SchemaModelCache({
                directory: cacheDir,
                version: "different-version",
            });

            const cached = await cacheV2.get(document);
            expect(cached).toBeNull();
        });
    });
});
