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

import { Argument } from "../../schema-model/argument/Argument";
import { Attribute } from "../../schema-model/attribute/Attribute";
import {
    serializeAttributeType,
    deserializeAttributeType,
    type SerializedAttributeType,
} from "./attribute-type-serializer";

export interface SerializedArgument {
    name: string;
    type: SerializedAttributeType;
    defaultValue?: string;
    description?: string;
}

export interface SerializedAttribute {
    name: string;
    type: SerializedAttributeType;
    args: SerializedArgument[];
    annotations: any;
    databaseName: string;
    description?: string;
}

/**
 * Serialize an Argument
 */
export function serializeArgument(arg: Argument): SerializedArgument {
    return {
        name: arg.name,
        type: serializeAttributeType(arg.type),
        defaultValue: arg.defaultValue,
        description: arg.description,
    };
}

/**
 * Deserialize an Argument
 */
export function deserializeArgument(data: SerializedArgument): Argument {
    // Create argument without defaultValue (can't reconstruct ValueNode)
    // The defaultValue string is stored but we can't pass it to constructor
    // since constructor expects ValueNode, not string
    const arg = new Argument({
        name: data.name,
        type: deserializeAttributeType(data.type),
        defaultValue: undefined, // Can't reconstruct ValueNode from string
        description: data.description,
    });
    
    // Manually set the defaultValue if it exists
    // This is safe because Argument stores it as string anyway
    if (data.defaultValue !== undefined) {
        (arg as any).defaultValue = data.defaultValue;
    }
    
    return arg;
}

/**
 * Serialize an Attribute
 */
export function serializeAttribute(attr: Attribute): SerializedAttribute {
    return {
        name: attr.name,
        type: serializeAttributeType(attr.type),
        args: attr.args.map(serializeArgument),
        annotations: attr.annotations,
        databaseName: attr.databaseName,
        description: attr.description,
    };
}

/**
 * Deserialize an Attribute
 */
export function deserializeAttribute(data: SerializedAttribute): Attribute {
    return new Attribute({
        name: data.name,
        type: deserializeAttributeType(data.type),
        args: data.args.map(deserializeArgument),
        annotations: data.annotations,
        databaseName: data.databaseName,
        description: data.description,
    });
}
