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

import { Neo4jGraphQLSchemaModel, type Operations } from "../../schema-model/Neo4jGraphQLSchemaModel";
import { ConcreteEntity } from "../../schema-model/entity/ConcreteEntity";
import { InterfaceEntity } from "../../schema-model/entity/InterfaceEntity";
import { UnionEntity } from "../../schema-model/entity/UnionEntity";
import type { Entity } from "../../schema-model/entity/Entity";
import {
    serializeConcreteEntityWithoutRelationships,
    serializeRelationships,
    deserializeConcreteEntity,
    deserializeAndAddRelationship,
    serializeInterfaceEntity,
    deserializeInterfaceEntity,
    addRelationshipDeclarations,
    serializeUnionEntity,
    deserializeUnionEntity,
    type SerializedConcreteEntity,
    type SerializedInterfaceEntity,
    type SerializedUnionEntity,
} from "./entity-serializer";
import { serializeOperation, deserializeOperation, type SerializedOperation } from "./operation-serializer";

export interface SerializedSchemaModel {
    version: string; // Serialization format version
    concreteEntities: SerializedConcreteEntity[];
    interfaceEntities: SerializedInterfaceEntity[];
    unionEntities: SerializedUnionEntity[];
    operations: Record<string, SerializedOperation | null>;
    annotations: any;
}

const SERIALIZATION_VERSION = "1.0.0";

/**
 * Serialize a Neo4jGraphQLSchemaModel to JSON
 * 
 * Uses a two-phase approach to handle circular references:
 * Phase 1: Serialize entities without relationships
 * Phase 2: Serialize relationships with entity name references
 */
export function serializeSchemaModel(model: Neo4jGraphQLSchemaModel): SerializedSchemaModel {
    // Separate composite entities into interfaces and unions
    const interfaceEntities: InterfaceEntity[] = [];
    const unionEntities: UnionEntity[] = [];

    for (const entity of model.compositeEntities) {
        if (entity instanceof InterfaceEntity) {
            interfaceEntities.push(entity);
        } else {
            unionEntities.push(entity);
        }
    }

    // Phase 1: Serialize entities
    const serializedConcreteEntities = model.concreteEntities.map((entity) => ({
        ...serializeConcreteEntityWithoutRelationships(entity),
        relationships: serializeRelationships(entity),
    }));

    return {
        version: SERIALIZATION_VERSION,
        concreteEntities: serializedConcreteEntities,
        interfaceEntities: interfaceEntities.map(serializeInterfaceEntity),
        unionEntities: unionEntities.map(serializeUnionEntity),
        operations: Object.fromEntries(
            Object.entries(model.operations).map(([name, op]) => [name, op ? serializeOperation(op) : null])
        ),
        annotations: model.annotations,
    };
}

/**
 * Deserialize a Neo4jGraphQLSchemaModel from JSON
 * 
 * Uses a two-phase approach to handle circular references:
 * Phase 1: Create all entities without relationships
 * Phase 2: Add relationships using entity map for reference resolution
 */
export function deserializeSchemaModel(data: SerializedSchemaModel): Neo4jGraphQLSchemaModel {
    // Validate serialization version
    if (data.version !== SERIALIZATION_VERSION) {
        throw new Error(
            `Incompatible serialization version: ${data.version} (expected ${SERIALIZATION_VERSION})`
        );
    }

    // Phase 1: Create all entities without relationships
    const entityMap = new Map<string, Entity>();

    // Create concrete entities
    const concreteEntities = data.concreteEntities.map((entityData) => {
        const entity = deserializeConcreteEntity(entityData);
        entityMap.set(entity.name, entity);
        return entity;
    });

    // Create interface entities (without relationship declarations)
    const interfaceEntities = data.interfaceEntities.map((entityData) => {
        const entity = deserializeInterfaceEntity(entityData, entityMap);
        entityMap.set(entity.name, entity);
        return entity;
    });

    // Create union entities
    const unionEntities = data.unionEntities.map((entityData) => {
        const entity = deserializeUnionEntity(entityData, entityMap);
        entityMap.set(entity.name, entity);
        return entity;
    });

    // Phase 2: Add relationships to concrete entities
    for (let i = 0; i < data.concreteEntities.length; i++) {
        const entityData = data.concreteEntities[i];
        const entity = concreteEntities[i];
        
        if (!entityData || !entity) {
            throw new Error(`Missing entity data at index ${i}`);
        }

        for (const relData of entityData.relationships) {
            const relationship = deserializeAndAddRelationship(relData, entityMap);
            entity.addRelationship(relationship);
        }
    }

    // Phase 2b: Add relationship declarations to interface entities
    for (let i = 0; i < data.interfaceEntities.length; i++) {
        const entityData = data.interfaceEntities[i];
        const entity = interfaceEntities[i];
        
        if (!entityData || !entity) {
            throw new Error(`Missing interface entity data at index ${i}`);
        }

        addRelationshipDeclarations(entity, entityData.relationshipDeclarations, entityMap);
    }

    // Reconstruct operations
    const operations: Operations = {};
    for (const [name, opData] of Object.entries(data.operations)) {
        operations[name as keyof Operations] = opData ? deserializeOperation(opData) : undefined;
    }

    // Create the schema model
    const schemaModel = new Neo4jGraphQLSchemaModel({
        concreteEntities,
        compositeEntities: [...interfaceEntities, ...unionEntities],
        operations,
        annotations: data.annotations,
    });

    // Phase 3: Link composite entities back to concrete entities
    for (const compositeEntity of schemaModel.compositeEntities) {
        for (const concreteEntity of compositeEntity.concreteEntities) {
            concreteEntity.addCompositeEntities(compositeEntity);
        }
    }

    return schemaModel;
}
