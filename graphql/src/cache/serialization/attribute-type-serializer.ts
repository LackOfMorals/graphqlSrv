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

import type { AttributeType } from "../../schema-model/attribute/AttributeType";
import {
    ScalarType,
    UserScalarType,
    ObjectType,
    ListType,
    EnumType,
    UnionType,
    InterfaceType,
    InputType,
    UnknownType,
    Neo4jCartesianPointType,
    Neo4jPointType,
} from "../../schema-model/attribute/AttributeType";

export interface SerializedAttributeType {
    kind: string;
    name: string;
    isRequired: boolean;
    ofType?: SerializedAttributeType; // For ListType
}

/**
 * Serialize an AttributeType to a JSON-compatible format
 */
export function serializeAttributeType(type: AttributeType): SerializedAttributeType {
    // Handle ListType specially (has ofType)
    if (type instanceof ListType) {
        return {
            kind: "ListType",
            name: type.name,
            isRequired: type.isRequired,
            ofType: serializeAttributeType(type.ofType),
        };
    }

    // All other types have the same structure
    return {
        kind: type.constructor.name,
        name: type.name,
        isRequired: type.isRequired,
    };
}

/**
 * Deserialize an AttributeType from JSON
 */
export function deserializeAttributeType(data: SerializedAttributeType): AttributeType {
    const { kind, name, isRequired, ofType } = data;

    switch (kind) {
        case "ScalarType":
            return new ScalarType(name as any, isRequired);

        case "UserScalarType":
            return new UserScalarType(name, isRequired);

        case "ObjectType":
            return new ObjectType(name, isRequired);

        case "ListType":
            if (!ofType) {
                throw new Error("ListType must have ofType");
            }
            return new ListType(deserializeAttributeType(ofType), isRequired);

        case "EnumType":
            return new EnumType(name, isRequired);

        case "UnionType":
            return new UnionType(name, isRequired);

        case "InterfaceType":
            return new InterfaceType(name, isRequired);

        case "InputType":
            return new InputType(name, isRequired);

        case "Neo4jCartesianPointType":
            return new Neo4jCartesianPointType(isRequired);

        case "Neo4jPointType":
            return new Neo4jPointType(isRequired);

        case "UnknownType":
        default:
            return new UnknownType(name, isRequired);
    }
}
