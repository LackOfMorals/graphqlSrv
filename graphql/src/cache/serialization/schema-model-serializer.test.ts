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
import { generateModel } from "../../schema-model/generate-model";
import { ConcreteEntity } from "../../schema-model/entity/ConcreteEntity";
import { InterfaceEntity } from "../../schema-model/entity/InterfaceEntity";
import { serializeSchemaModel, deserializeSchemaModel } from "./schema-model-serializer";

describe("Schema Model Serialization", () => {
    it("should serialize and deserialize a simple schema model", () => {
        const typeDefs = `
            type User @node {
                id: ID!
                name: String!
            }
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        // Serialize
        const serialized = serializeSchemaModel(original);

        // Deserialize
        const deserialized = deserializeSchemaModel(serialized);

        // Validate
        expect(deserialized.concreteEntities).toHaveLength(1);
        const firstEntity = deserialized.concreteEntities[0];
        expect(firstEntity).toBeDefined();
        expect(firstEntity?.name).toBe("User");
        expect(firstEntity?.attributes.size).toBe(2);
        expect(firstEntity?.attributes.get("id")).toBeDefined();
        expect(firstEntity?.attributes.get("name")).toBeDefined();
    });

    it("should serialize and deserialize entities with relationships", () => {
        const typeDefs = `
            type User @node {
                id: ID!
                name: String!
                posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
            }

            type Post @node {
                id: ID!
                title: String!
                authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
            }
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        // Validate entities
        expect(deserialized.concreteEntities).toHaveLength(2);

        const user = deserialized.concreteEntities.find((e) => e.name === "User");
        const post = deserialized.concreteEntities.find((e) => e.name === "Post");

        expect(user).toBeDefined();
        expect(post).toBeDefined();

        // Validate relationships
        expect(user!.relationships.size).toBe(1);
        expect(post!.relationships.size).toBe(1);

        const postsRel = user!.relationships.get("posts");
        expect(postsRel).toBeDefined();
        expect(postsRel!.type).toBe("AUTHORED");
        expect(postsRel!.target.name).toBe("Post");
        expect(postsRel!.direction).toBe("OUT");

        const authorsRel = post!.relationships.get("authors");
        expect(authorsRel).toBeDefined();
        expect(authorsRel!.type).toBe("AUTHORED");
        expect(authorsRel!.target.name).toBe("User");
        expect(authorsRel!.direction).toBe("IN");
    });

    it("should serialize and deserialize interface entities", () => {
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
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        // Validate concrete entities
        expect(deserialized.concreteEntities).toHaveLength(2);

        // Validate composite entities
        expect(deserialized.compositeEntities).toHaveLength(1);
        const contentInterface = deserialized.compositeEntities[0] as InterfaceEntity;
        expect(contentInterface.name).toBe("Content");
        expect(contentInterface.concreteEntities).toHaveLength(2);
    });

    it("should serialize and deserialize union entities", () => {
        const typeDefs = `
            type Article @node {
                id: ID!
                title: String!
            }

            type Video @node {
                id: ID!
                url: String!
            }

            union SearchResult = Article | Video
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        // Validate union
        const union = deserialized.compositeEntities.find((e) => e.name === "SearchResult");
        expect(union).toBeDefined();
        expect(union!.concreteEntities).toHaveLength(2);
    });

    it("should serialize and deserialize operations", () => {
        const typeDefs = `
            type User @node {
                id: ID!
                name: String!
            }

            type Query {
                customQuery: String @cypher(statement: "RETURN 'test'", columnName: "result")
            }
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        // Validate operations
        expect(deserialized.operations.Query).toBeDefined();
    });

    it("should handle complex schema with all features", () => {
        const typeDefs = `
            interface Content {
                id: ID!
                title: String!
                authors: [User!]! @declareRelationship
            }

            type User @node {
                id: ID! @id
                name: String!
                email: String!
                posts: [Post!]! @relationship(type: "AUTHORED", direction: OUT)
                comments: [Comment!]! @relationship(type: "WROTE", direction: OUT)
            }

            type Post implements Content @node {
                id: ID! @id
                title: String!
                content: String!
                published: Boolean!
                authors: [User!]! @relationship(type: "AUTHORED", direction: IN)
                comments: [Comment!]! @relationship(type: "HAS_COMMENT", direction: OUT)
            }

            type Comment @node {
                id: ID! @id
                text: String!
                createdAt: DateTime! @timestamp(operations: [CREATE])
                authors: [User!]! @relationship(type: "WROTE", direction: IN)
                posts: [Post!]! @relationship(type: "HAS_COMMENT", direction: IN)
            }

            union SearchResult = Post | Comment
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        // Validate structure
        expect(deserialized.concreteEntities).toHaveLength(3);
        expect(deserialized.compositeEntities).toHaveLength(2); // Content interface + SearchResult union

        // Validate specific entity
        const user = deserialized.getEntity("User");
        expect(user).toBeDefined();
        expect(user!.name).toBe("User");

        // Validate relationships are connected
        if (user instanceof ConcreteEntity) {
            expect(user.relationships.size).toBe(2);
            const postsRel = user.relationships.get("posts");
            expect(postsRel?.target.name).toBe("Post");
        }
    });

    it("should preserve attribute types correctly", () => {
        const typeDefs = `
            type User @node {
                id: ID!
                name: String!
                age: Int
                score: Float
                active: Boolean!
                tags: [String!]!
                createdAt: DateTime!
            }
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        const user = deserialized.concreteEntities[0];
        expect(user).toBeDefined();
        
        // Check each attribute type is preserved
        expect(user?.attributes.get("id")?.type.name).toContain("ID");
        expect(user?.attributes.get("name")?.type.name).toBe("String");
        expect(user?.attributes.get("age")?.type.name).toBe("Int");
        expect(user?.attributes.get("score")?.type.name).toBe("Float");
        expect(user?.attributes.get("active")?.type.name).toBe("Boolean");
        expect(user?.attributes.get("tags")?.type.name).toContain("List");
        expect(user?.attributes.get("createdAt")?.type.name).toBe("DateTime");
    });

    it("should handle annotations correctly", () => {
        const typeDefs = `
            type User @node @plural(value: "People") {
                id: ID! @id
                name: String! @default(value: "Unknown")
                email: String! @unique
            }
        `;

        const document = parse(typeDefs);
        const original = generateModel(document);

        const serialized = serializeSchemaModel(original);
        const deserialized = deserializeSchemaModel(serialized);

        const user = deserialized.concreteEntities[0];
        expect(user).toBeDefined();
        expect(user?.annotations).toBeDefined();
        expect(user?.annotations.plural).toBeDefined();
        
        const idAttr = user?.attributes.get("id");
        expect(idAttr).toBeDefined();
        expect(idAttr?.annotations.id).toBeDefined();
        
        const nameAttr = user?.attributes.get("name");
        expect(nameAttr).toBeDefined();
        expect(nameAttr?.annotations.default).toBeDefined();
    });
});
