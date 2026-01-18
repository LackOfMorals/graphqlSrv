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

import { ConcreteEntity } from "../../schema-model/entity/ConcreteEntity";
import { InterfaceEntity } from "../../schema-model/entity/InterfaceEntity";
import { UnionEntity } from "../../schema-model/entity/UnionEntity";
import { Relationship } from "../../schema-model/relationship/Relationship";
import { RelationshipDeclaration } from "../../schema-model/relationship/RelationshipDeclaration";
import type { Entity } from "../../schema-model/entity/Entity";
import { serializeAttribute, deserializeAttribute, type SerializedAttribute } from "./attribute-serializer";
import { serializeArgument, deserializeArgument } from "./attribute-serializer";

export interface SerializedRelationship {
    name: string;
    type: string;
    sourceName: string;
    targetName: string;
    direction: "IN" | "OUT";
    isList: boolean;
    queryDirection: string;
    nestedOperations: string[];
    aggregate: boolean;
    isNullable: boolean;
    description?: string;
    annotations: any;
    propertiesTypeName?: string;
    firstDeclaredInTypeName?: string;
    originalTargetName?: string;
    args: any[];
    attributes: SerializedAttribute[];
}

export interface SerializedConcreteEntity {
    name: string;
    description?: string;
    labels: string[];
    attributes: SerializedAttribute[];
    annotations: any;
    relationships: SerializedRelationship[]; // Serialized without circular refs
}

export interface SerializedInterfaceEntity {
    name: string;
    description?: string;
    concreteEntityNames: string[];
    attributes: SerializedAttribute[];
    annotations: any;
    relationshipDeclarations: SerializedRelationshipDeclaration[];
}

export interface SerializedUnionEntity {
    name: string;
    concreteEntityNames: string[];
    annotations: any;
}

export interface SerializedRelationshipDeclaration {
    name: string;
    sourceName: string;
    targetName: string;
    isList: boolean;
    nestedOperations: string[];
    aggregate: boolean;
    isNullable: boolean;
    description?: string;
    args: any[];
    annotations: any;
    relationshipImplementationNames: Array<{ entityName: string; relationshipName: string }>;
    firstDeclaredInTypeName?: string;
}

/**
 * Serialize a ConcreteEntity without relationships (to avoid circular references)
 */
export function serializeConcreteEntityWithoutRelationships(entity: ConcreteEntity): Omit<SerializedConcreteEntity, "relationships"> {
    return {
        name: entity.name,
        description: entity.description,
        labels: Array.from(entity.labels),
        attributes: Array.from(entity.attributes.values()).map(serializeAttribute),
        annotations: entity.annotations,
    };
}

/**
 * Serialize a ConcreteEntity's relationships
 */
export function serializeRelationships(entity: ConcreteEntity): SerializedRelationship[] {
    return Array.from(entity.relationships.values()).map((rel) => ({
        name: rel.name,
        type: rel.type,
        sourceName: rel.source.name,
        targetName: rel.target.name,
        direction: rel.direction,
        isList: rel.isList,
        queryDirection: rel.queryDirection,
        nestedOperations: rel.nestedOperations,
        aggregate: rel.aggregate,
        isNullable: rel.isNullable,
        description: rel.description,
        annotations: rel.annotations,
        propertiesTypeName: rel.propertiesTypeName,
        firstDeclaredInTypeName: rel.firstDeclaredInTypeName,
        originalTargetName: rel.originalTarget?.name,
        args: rel.args.map(serializeArgument),
        attributes: Array.from(rel.attributes.values()).map(serializeAttribute),
    }));
}

/**
 * Deserialize a ConcreteEntity (without relationships initially)
 */
export function deserializeConcreteEntity(data: Omit<SerializedConcreteEntity, "relationships">): ConcreteEntity {
    return new ConcreteEntity({
        name: data.name,
        description: data.description,
        labels: data.labels,
        attributes: data.attributes.map(deserializeAttribute),
        annotations: data.annotations,
        // Relationships will be added in phase 2
    });
}

/**
 * Deserialize and add a relationship to an entity
 */
export function deserializeAndAddRelationship(
    data: SerializedRelationship,
    entityMap: Map<string, Entity>
): Relationship {
    const source = entityMap.get(data.sourceName);
    const target = entityMap.get(data.targetName);
    const originalTarget = data.originalTargetName ? entityMap.get(data.originalTargetName) : undefined;

    if (!source) {
        throw new Error(`Cannot find source entity: ${data.sourceName}`);
    }
    if (!target) {
        throw new Error(`Cannot find target entity: ${data.targetName}`);
    }

    return new Relationship({
        name: data.name,
        type: data.type,
        source,
        target,
        direction: data.direction,
        isList: data.isList,
        queryDirection: data.queryDirection as any,
        nestedOperations: data.nestedOperations as any[],
        aggregate: data.aggregate,
        isNullable: data.isNullable,
        description: data.description,
        annotations: data.annotations,
        propertiesTypeName: data.propertiesTypeName,
        firstDeclaredInTypeName: data.firstDeclaredInTypeName,
        originalTarget,
        args: data.args.map(deserializeArgument),
        attributes: data.attributes.map(deserializeAttribute),
    });
}

/**
 * Serialize an InterfaceEntity
 */
export function serializeInterfaceEntity(entity: InterfaceEntity): SerializedInterfaceEntity {
    return {
        name: entity.name,
        description: entity.description,
        concreteEntityNames: entity.concreteEntities.map((e) => e.name),
        attributes: Array.from(entity.attributes.values()).map(serializeAttribute),
        annotations: entity.annotations,
        relationshipDeclarations: Array.from(entity.relationshipDeclarations.values()).map((decl) => ({
            name: decl.name,
            sourceName: decl.source.name,
            targetName: decl.target.name,
            isList: decl.isList,
            nestedOperations: decl.nestedOperations,
            aggregate: decl.aggregate,
            isNullable: decl.isNullable,
            description: decl.description,
            args: decl.args.map(serializeArgument),
            annotations: decl.annotations,
            relationshipImplementationNames: decl.relationshipImplementations.map((impl) => ({
                entityName: impl.source.name,
                relationshipName: impl.name,
            })),
            firstDeclaredInTypeName: decl.firstDeclaredInTypeName,
        })),
    };
}

/**
 * Deserialize an InterfaceEntity (phase 1 - without relationship implementations)
 */
export function deserializeInterfaceEntity(
    data: SerializedInterfaceEntity,
    entityMap: Map<string, Entity>
): InterfaceEntity {
    const concreteEntities = data.concreteEntityNames
        .map((name) => entityMap.get(name))
        .filter((e): e is ConcreteEntity => e instanceof ConcreteEntity);

    return new InterfaceEntity({
        name: data.name,
        description: data.description,
        concreteEntities,
        attributes: data.attributes.map(deserializeAttribute),
        annotations: data.annotations,
        // Relationship declarations will be added in phase 2
    });
}

/**
 * Add relationship declarations to an InterfaceEntity (phase 2)
 */
export function addRelationshipDeclarations(
    entity: InterfaceEntity,
    declarations: SerializedRelationshipDeclaration[],
    entityMap: Map<string, Entity>
): void {
    for (const declData of declarations) {
        const target = entityMap.get(declData.targetName);
        if (!target) {
            throw new Error(`Cannot find target entity: ${declData.targetName}`);
        }

        // Find relationship implementations
        const implementations: Relationship[] = [];
        for (const implRef of declData.relationshipImplementationNames) {
            const implEntity = entityMap.get(implRef.entityName);
            if (implEntity && implEntity instanceof ConcreteEntity) {
                const relationship = implEntity.relationships.get(implRef.relationshipName);
                if (relationship) {
                    implementations.push(relationship);
                }
            }
        }

        const declaration = new RelationshipDeclaration({
            name: declData.name,
            source: entity,
            target,
            isList: declData.isList,
            nestedOperations: declData.nestedOperations as any[],
            aggregate: declData.aggregate,
            isNullable: declData.isNullable,
            description: declData.description,
            args: declData.args.map(deserializeArgument),
            annotations: declData.annotations,
            relationshipImplementations: implementations,
            firstDeclaredInTypeName: declData.firstDeclaredInTypeName,
        });

        entity.addRelationshipDeclaration(declaration);
    }
}

/**
 * Serialize a UnionEntity
 */
export function serializeUnionEntity(entity: UnionEntity): SerializedUnionEntity {
    return {
        name: entity.name,
        concreteEntityNames: entity.concreteEntities.map((e) => e.name),
        annotations: entity.annotations,
    };
}

/**
 * Deserialize a UnionEntity
 */
export function deserializeUnionEntity(data: SerializedUnionEntity, entityMap: Map<string, Entity>): UnionEntity {
    const concreteEntities = data.concreteEntityNames
        .map((name) => entityMap.get(name))
        .filter((e): e is ConcreteEntity => e instanceof ConcreteEntity);

    return new UnionEntity({
        name: data.name,
        concreteEntities,
        annotations: data.annotations,
    });
}
