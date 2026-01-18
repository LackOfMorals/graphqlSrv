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

export {
    serializeAttributeType,
    deserializeAttributeType,
    type SerializedAttributeType,
} from "./attribute-type-serializer";

export {
    serializeArgument,
    deserializeArgument,
    serializeAttribute,
    deserializeAttribute,
    type SerializedArgument,
    type SerializedAttribute,
} from "./attribute-serializer";

export {
    serializeConcreteEntityWithoutRelationships,
    serializeRelationships,
    deserializeConcreteEntity,
    deserializeAndAddRelationship,
    serializeInterfaceEntity,
    deserializeInterfaceEntity,
    addRelationshipDeclarations,
    serializeUnionEntity,
    deserializeUnionEntity,
    type SerializedRelationship,
    type SerializedConcreteEntity,
    type SerializedInterfaceEntity,
    type SerializedUnionEntity,
    type SerializedRelationshipDeclaration,
} from "./entity-serializer";

export {
    serializeOperation,
    deserializeOperation,
    type SerializedOperation,
} from "./operation-serializer";

export {
    serializeSchemaModel,
    deserializeSchemaModel,
    type SerializedSchemaModel,
} from "./schema-model-serializer";
