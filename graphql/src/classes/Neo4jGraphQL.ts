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

// Removed static imports for lazy loading
import Debug from "debug";
import { GraphQLNonNull, GraphQLScalarType, print, type DocumentNode, type GraphQLSchema } from "graphql";
import type { Driver, SessionConfig } from "neo4j-driver"; // Keep static import for types
import type { IExecutableSchemaDefinition } from "@graphql-tools/schema"; // Keep static import for types
import { ASTCache, SchemaModelCache, type CacheStats } from "../cache";
import { DEBUG_ALL } from "../constants";
// Removed static import: import { makeAugmentedSchema } from "../schema";
import type { Neo4jGraphQLSchemaModel } from "../schema-model/Neo4jGraphQLSchemaModel";
import { generateModel } from "../schema-model/generate-model";
import { getDefinitionCollection } from "../schema-model/parser/definition-collection"; // Keep static, used in validateDocument
import { makeDocumentToAugment } from "../schema/make-document-to-augment"; // Keep static, used in generateExecutableSchema and generateSubgraphSchema
import type { WrapResolverArguments } from "../schema/resolvers/composition/wrap-query-and-mutation";
import { wrapQueryAndMutation } from "../schema/resolvers/composition/wrap-query-and-mutation";
import { wrapSubscription, type WrapSubscriptionArgs } from "../schema/resolvers/composition/wrap-subscription";
import { defaultFieldResolver } from "../schema/resolvers/field/defaultField";
import { idResolver } from "../schema/resolvers/field/id";
import { numericalResolver } from "../schema/resolvers/field/numerical";
import { validateDocument } from "../schema/validation"; // Keep static, used in generateExecutableSchema and generateSubgraphSchema
import { validateUserDefinition } from "../schema/validation/schema-validation"; // Keep static, used in generateExecutableSchema and generateSubgraphSchema
import type { ContextFeatures, Neo4jFeaturesSettings, Neo4jGraphQLSubscriptionsEngine } from "../types";
import { asArray } from "../utils/utils";
import { ComplexityEstimatorHelper } from "./ComplexityEstimatorHelper";
import type { ExecutorConstructorParam, Neo4jGraphQLSessionConfig } from "./Executor";
import { Executor } from "./Executor";
import type { Neo4jDatabaseInfo } from "./Neo4jDatabaseInfo";
import { getNeo4jDatabaseInfo } from "./Neo4jDatabaseInfo";
import { Neo4jGraphQLAuthorization } from "./authorization/Neo4jGraphQLAuthorization";
import { Neo4jGraphQLSubscriptionsCDCEngine } from "./subscription/Neo4jGraphQLSubscriptionsCDCEngine";
import { assertIndexesAndConstraints } from "./utils/asserts-indexes-and-constraints";
import { generateResolverComposition } from "./utils/generate-resolvers-composition";
import checkNeo4jCompat from "./utils/verify-database";

type TypeDefinitions = string | DocumentNode | TypeDefinitions[] | (() => TypeDefinitions);

export type CacheLevel = "ast" | "model" | "both";

export interface Neo4jGraphQLCacheConfig {
    enabled?: boolean;
    level?: CacheLevel; // What to cache: 'ast', 'model', or 'both' (default: 'both')
    directory?: string;
    ttl?: number; // Time to live in milliseconds
    serialization?: "v8" | "bson";
}

export interface Neo4jGraphQLConstructor {
    typeDefs: TypeDefinitions;
    resolvers?: IExecutableSchemaDefinition["resolvers"];
    features?: Neo4jFeaturesSettings;
    driver?: Driver;
    debug?: boolean;
    validate?: boolean;
    cache?: Neo4jGraphQLCacheConfig;
}

class Neo4jGraphQL {
    private typeDefs: TypeDefinitions;
    private resolvers?: IExecutableSchemaDefinition["resolvers"];

    private driver?: Driver;
    private features: ContextFeatures;

    private jwtFieldsMap?: Map<string, string>;

    private schemaModel?: Neo4jGraphQLSchemaModel;
    private complexityEstimatorHelper: ComplexityEstimatorHelper;

    private executableSchema?: Promise<GraphQLSchema>;
    private subgraphSchema?: Promise<GraphQLSchema>;

    // This promise ensures that subscription init only happens once
    private subscriptionInit?: Promise<void>;

    private dbInfo?: Neo4jDatabaseInfo; // Fixed typo

    private authorization?: Neo4jGraphQLAuthorization;

    private _astCache?: ASTCache;
    private _schemaModelCache?: SchemaModelCache;
    private cacheConfig?: Neo4jGraphQLCacheConfig;

    private debug?: boolean;
    private validate: boolean;

    constructor(input: Neo4jGraphQLConstructor) {
        const { driver, features, typeDefs, resolvers, debug, validate = true, cache } = input;

        this.driver = driver;
        this.features = this.parseNeo4jFeatures(features);

        this.typeDefs = typeDefs;
        this.resolvers = resolvers;

        this.debug = debug;
        this.validate = validate;
        this.cacheConfig = cache; // Store cache config

        this.checkEnableDebug();

        if (this.features?.authorization) {
            const authorizationSettings = this.features?.authorization;

            this.authorization = new Neo4jGraphQLAuthorization(authorizationSettings);
        }

        this.complexityEstimatorHelper = new ComplexityEstimatorHelper(!!this.features.complexityEstimators);
    }

    private get astCache(): ASTCache | undefined {
        if (this._astCache === undefined && this.cacheConfig?.enabled !== false) {
            const packageJson = require("../../package.json");
            const cacheLevel = this.cacheConfig?.level || "both";
            const cacheOptions = {
                directory: this.cacheConfig?.directory,
                ttl: this.cacheConfig?.ttl,
                version: packageJson.version,
                serialization: this.cacheConfig?.serialization,
            };

            if (cacheLevel === "ast" || cacheLevel === "both") {
                // Lazy import ASTCache
                const { ASTCache: ImportedASTCache } = require("../cache");
                this._astCache = new ImportedASTCache(cacheOptions);
            }
        }
        return this._astCache;
    }

    private get schemaModelCache(): SchemaModelCache | undefined {
        if (this._schemaModelCache === undefined && this.cacheConfig?.enabled !== false) {
            const packageJson = require("../../package.json");
            const cacheLevel = this.cacheConfig?.level || "both";
            const cacheOptions = {
                directory: this.cacheConfig?.directory,
                ttl: this.cacheConfig?.ttl,
                version: packageJson.version,
                serialization: this.cacheConfig?.serialization,
            };

            if (cacheLevel === "model" || cacheLevel === "both") {
                // Lazy import SchemaModelCache
                const { SchemaModelCache: ImportedSchemaModelCache } = require("../cache");
                this._schemaModelCache = new ImportedSchemaModelCache(cacheOptions);
            }
        }
        return this._schemaModelCache;
    }

    public async getSchema(): Promise<GraphQLSchema> {
        return this.getExecutableSchema();
    }

    public async getExecutableSchema(): Promise<GraphQLSchema> {
        if (!this.executableSchema) {
            this.executableSchema = this.generateExecutableSchema();

            await this.subscriptionMechanismSetup();
        }

        return this.executableSchema;
    }

    public async getSubgraphSchema(): Promise<GraphQLSchema> {
        if (!this.subgraphSchema) {
            this.subgraphSchema = this.generateSubgraphSchema().catch((err: Error) => {
                console.error("Error", err);
                return Promise.reject(err);
            });

            await this.subscriptionMechanismSetup();
        }

        return this.subgraphSchema;
    }

    public async checkNeo4jCompat({
        driver,
        sessionConfig,
    }: {
        driver?: Driver;
        sessionConfig?: Neo4jGraphQLSessionConfig;
    } = {}): Promise<void> {
        const neo4jDriver = driver || this.driver;

        if (!neo4jDriver) {
            const { Driver: ImportedNeo4jDriver } = await import("neo4j-driver");
            throw new Error("neo4j-driver Driver missing");
        }

        if (!this.dbInfo) {
            this.dbInfo = await this.getNeo4jDatabaseInfo(neo4jDriver, sessionConfig);
        }

        return checkNeo4jCompat({
            driver: neo4jDriver,
            sessionConfig,
            dbInfo: this.dbInfo,
        });
    }

    public async assertIndexesAndConstraints({
        driver,
        sessionConfig,
    }: {
        driver?: Driver;
        sessionConfig?: Neo4jGraphQLSessionConfig;
    } = {}): Promise<void> {
        if (!(this.executableSchema || this.subgraphSchema)) {
            throw new Error("You must await `.getSchema()` before `.assertIndexesAndConstraints()`");
        }

        await (this.executableSchema || this.subgraphSchema);

        const neo4jDriver = driver || this.driver;

        if (!neo4jDriver) {
            const { Driver: ImportedNeo4jDriver } = await import("neo4j-driver");
            throw new Error("neo4j-driver Driver missing");
        }

        if (!this.schemaModel) {
            throw new Error("Schema Model is not defined");
        }

        await assertIndexesAndConstraints({
            driver: neo4jDriver,
            sessionConfig,
            schemaModel: this.schemaModel,
        });
    }

    /**
     * Convert type definitions to a string for caching purposes
     */
    private typeDefsToString(typeDefs: TypeDefinitions): string {
        if (typeof typeDefs === "string") {
            return typeDefs;
        }
        if (typeof typeDefs === "function") {
            return this.typeDefsToString(typeDefs());
        }
        if (Array.isArray(typeDefs)) {
            return typeDefs.map((t) => this.typeDefsToString(t)).join("\n");
        }
        return print(typeDefs);
    }

    /**
     * Currently just merges all type definitions into a document. Eventual intention described below:
     *
     * Normalizes the user's type definitions using the method with the lowest risk of side effects:
     * - Type definitions of type `string` are parsed using the `parse` function from the reference GraphQL implementation.
     * - Type definitions of type `DocumentNode` are returned as they are.
     * - Type definitions in arrays are merged using `mergeTypeDefs` from `@graphql-tools/merge`.
     * - Callbacks are resolved to a type which can be parsed into a document.
     *
     * This method maps to the Type Definition Normalization stage of the Schema Generation lifecycle.
     *
     * @param {TypeDefinitions} typeDefinitions - The unnormalized type definitions.
     * @returns {Promise<DocumentNode>} The normalized type definitons as a document.
     */
    private async normalizeTypeDefinitions(typeDefinitions: TypeDefinitions): Promise<DocumentNode> {
        // Try to get from cache first
        if (this.astCache) {
            const typeDefsString = this.typeDefsToString(typeDefinitions);
            const cached = await this.astCache.get(typeDefsString);
            if (cached) {
                return cached;
            }
        }

        // Parse type definitions
        const { mergeTypeDefs } = await import("@graphql-tools/merge");
        const ast = mergeTypeDefs(typeDefinitions);

        // Cache the result
        if (this.astCache) {
            const typeDefsString = this.typeDefsToString(typeDefinitions);
            await this.astCache.set(typeDefsString, ast);
        }

        return ast;
    }

    private async addDefaultFieldResolvers(schema: GraphQLSchema): Promise<GraphQLSchema> {
        const { forEachField } = await import("@graphql-tools/utils");
        forEachField(schema, (field) => {
            if (!field.resolve) {
                // These fields are not being updated because they are not nodes. Maybe these should be updated in make-augmented-schema instead
                // TODO: Consider adding objects to the schema model to handle this case in schema generation
                if (field.type instanceof GraphQLScalarType) {
                    if (field.type.name === "Int" || field.type.name === "Float") {
                        field.resolve = numericalResolver;
                        return;
                    } else if (field.type.name === "ID") {
                        field.resolve = idResolver;
                        return;
                    }
                }

                if (field.type instanceof GraphQLNonNull) {
                    if (field.type.ofType instanceof GraphQLScalarType) {
                        if (field.type.ofType.name === "Int" || field.type.ofType.name === "Float") {
                            field.resolve = numericalResolver;
                            return;
                        } else if (field.type.ofType.name === "ID") {
                            field.resolve = idResolver;
                            return;
                        }
                    }
                }
                field.resolve = defaultFieldResolver;
            }
        });

        return schema;
    }

    private checkEnableDebug(): void {
        if (this.debug === true || this.debug === false) {
            if (this.debug) {
                Debug.enable(DEBUG_ALL);
            } else {
                Debug.disable();
            }
        }
    }

    private async getNeo4jDatabaseInfo(driver: Driver, sessionConfig?: SessionConfig): Promise<Neo4jDatabaseInfo> { // Fixed typo
        const executorConstructorParam: ExecutorConstructorParam = {
            executionContext: driver,
            sessionConfig,
        };

        return getNeo4jDatabaseInfo(new Executor(executorConstructorParam));
    }

    private async wrapResolvers(resolvers: NonNullable<IExecutableSchemaDefinition["resolvers"]>) {
        if (!this.schemaModel) {
            throw new Error("Schema Model is not defined");
        }

        const wrapResolverArgs: WrapResolverArguments = {
            driver: this.driver,
            schemaModel: this.schemaModel,
            features: this.features,
            authorization: this.authorization,
            jwtPayloadFieldsMap: this.jwtFieldsMap,
        };
        const queryAndMutationWrappers = [wrapQueryAndMutation(wrapResolverArgs)];

        const isSubscriptionEnabled = !!this.features.subscriptions;
        const wrapSubscriptionResolverArgs = {
            subscriptionsEngine: this.features.subscriptionsEngine,
            schemaModel: this.schemaModel,
            authorization: this.authorization,
            jwtPayloadFieldsMap: this.jwtFieldsMap,
        };
        const subscriptionWrappers = isSubscriptionEnabled
            ? [wrapSubscription(wrapSubscriptionResolverArgs as WrapSubscriptionArgs)]
            : [];

        const { composeResolvers } = await import("@graphql-tools/resolvers-composition");
        const resolversComposition = generateResolverComposition({
            schemaModel: this.schemaModel,
            isSubscriptionEnabled,
            queryAndMutationWrappers,
            subscriptionWrappers,
        });

        // Merge generated and custom resolvers
        // Merging must be done before composing because wrapper won't run otherwise
        const { mergeResolvers } = await import("@graphql-tools/merge");
        const mergedResolvers = mergeResolvers([...asArray(resolvers), ...asArray(this.resolvers)]);
        return composeResolvers(mergedResolvers, resolversComposition);
    }

    private async composeSchema(schema: GraphQLSchema): Promise<GraphQLSchema> {
        // TODO: Keeping this in our back pocket - if we want to add native support for middleware to the library
        // if (this.middlewares) {
        //     schema = applyMiddleware(schema, ...this.middlewares);
        // }

        // Get resolvers from schema - this will include generated _entities and _service for Federation
        const { getResolversFromSchema } = await import("@graphql-tools/utils");
        const resolvers = getResolversFromSchema(schema);

        // Wrap the resolvers using resolvers composition
        const wrappedResolvers = await this.wrapResolvers(resolvers);

        // Add the wrapped resolvers back to the schema, context will now be populated
        const { addResolversToSchema } = await import("@graphql-tools/schema");
        addResolversToSchema({ schema, resolvers: wrappedResolvers, updateResolversInPlace: true });

        return this.addDefaultFieldResolvers(schema);
    }

    private parseNeo4jFeatures(features: Neo4jFeaturesSettings | undefined): ContextFeatures {
        let subscriptionPlugin: Neo4jGraphQLSubscriptionsEngine | undefined;
        if (features?.subscriptions === true) {
            if (!this.driver) {
                throw new Error("Driver required for CDC subscriptions");
            }

            subscriptionPlugin = new Neo4jGraphQLSubscriptionsCDCEngine({
                driver: this.driver,
            });
        } else {
            subscriptionPlugin = features?.subscriptions || undefined;
        }

        return {
            ...features,
            subscriptionsEngine: subscriptionPlugin,
        };
    }

    private async generateSchemaModel(document: DocumentNode): Promise<Neo4jGraphQLSchemaModel> {
        // Check schema model cache first
        if (this.schemaModelCache) {
            const cached = await this.schemaModelCache.get(document, this.resolvers);
            if (cached) {
                this.schemaModel = cached;
                return cached;
            }
        }

        // Generate fresh model
        const model = generateModel(document, this.resolvers);

        // Cache the model
        if (this.schemaModelCache) {
            await this.schemaModelCache.set(document, model, this.resolvers);
        }

        this.schemaModel = model;
        return model;
    }

    private async generateExecutableSchema(): Promise<GraphQLSchema> {
        const initialDocument = await this.normalizeTypeDefinitions(this.typeDefs);

            if (this.validate) {
                const { getDefinitionCollection } = require("../schema-model/parser/definition-collection"); // Dynamic import
                const {
                    enumTypes: enums,
                    interfaceTypes: interfaces,
                    unionTypes: unions,
                    objectTypes: objects,
                } = getDefinitionCollection(initialDocument);

                validateDocument({
                    document: initialDocument,
                    features: this.features,
                    additionalDefinitions: {
                        enums: [...enums.values()],
                        interfaces: [...interfaces.values()], // Corrected iterator usage
                        unions: [...unions.values()],         // Corrected iterator usage
                        objects: [...objects.values()],       // Corrected iterator usage
                    },
                    userCustomResolvers: this.resolvers,
                });
            }

            const { makeDocumentToAugment } = require("../schema/make-document-to-augment"); // Dynamic import
            const { document, typesExcludedFromGeneration } = makeDocumentToAugment(initialDocument);
            const { jwt } = typesExcludedFromGeneration;
            if (jwt) {
            this.jwtFieldsMap = jwt.jwtFieldsMap;
            }

            this.schemaModel = await this.generateSchemaModel(document);

            const { makeAugmentedSchema } = await import("../schema");
            const { typeDefs, resolvers } = makeAugmentedSchema({
                document,
                features: this.features,
                schemaModel: this.schemaModel,
                complexityEstimatorHelper: this.complexityEstimatorHelper,
            });

            if (this.validate) {
                validateUserDefinition({
                    userDocument: document,
                    augmentedDocument: typeDefs,
                    jwt: jwt?.type,
                    features: this.features,
                });
            }

        const { makeExecutableSchema } = await import("@graphql-tools/schema");
        const schema = makeExecutableSchema({
            typeDefs,
            resolvers,
        });
        this.complexityEstimatorHelper.hydrateSchemaFromSDLWithASTNodeExtensions(schema);

        return this.composeSchema(schema);
    }

    private async generateSubgraphSchema(): Promise<GraphQLSchema> {
        // Import only when needed to avoid issues if GraphQL 15 being used
        const { Subgraph } = await import("./Subgraph");

        const initialDocument = await this.normalizeTypeDefinitions(this.typeDefs);
        const subgraph = new Subgraph(this.typeDefs);

        const { directives, types } = subgraph.getValidationDefinitions();

        if (this.validate) {
            const { getDefinitionCollection } = require("../schema-model/parser/definition-collection"); // Dynamic import
            const {
                enumTypes: enums,
                interfaceTypes: interfaces,
                unionTypes: unions,
                objectTypes: objects,
            } = getDefinitionCollection(initialDocument);

            validateDocument({
                document: initialDocument,
                features: this.features,
                additionalDefinitions: {
                    additionalDirectives: directives,
                    additionalTypes: types,
                    enums: [...enums.values()],
                    interfaces: [...interfaces.values()], // Corrected iterator usage
                    unions: [...unions.values()],         // Corrected iterator usage
                    objects: [...objects.values()],       // Corrected iterator usage
                },
                userCustomResolvers: this.resolvers,
            });
        }

        const { makeDocumentToAugment } = require("../schema/make-document-to-augment"); // Dynamic import
        const { document, typesExcludedFromGeneration } = makeDocumentToAugment(initialDocument);
        const { jwt } = typesExcludedFromGeneration;
        if (jwt) {
            this.jwtFieldsMap = jwt.jwtFieldsMap;
        }

        this.schemaModel = await this.generateSchemaModel(document);

        const { makeAugmentedSchema } = await import("../schema");
        const { typeDefs, resolvers } = makeAugmentedSchema({
            document,
            features: this.features,
            subgraph,
            schemaModel: this.schemaModel,
            complexityEstimatorHelper: this.complexityEstimatorHelper,
        });

        if (this.validate) {
            validateUserDefinition({
                userDocument: document,
                augmentedDocument: typeDefs,
                additionalDirectives: directives,
                additionalTypes: types,
                jwt: jwt?.type,
                features: this.features,
            });
        }

        // TODO: Move into makeAugmentedSchema, add resolvers alongside other resolvers
        const referenceResolvers = subgraph.getReferenceResolvers(this.schemaModel);

        const { mergeResolvers } = await import("@graphql-tools/merge");
        const schema = subgraph.buildSchema({
            typeDefs,
            resolvers: mergeResolvers([resolvers, referenceResolvers]),
        });

        return this.composeSchema(schema);
    }

    private subscriptionMechanismSetup(): Promise<void> {
        if (this.subscriptionInit) {
            return this.subscriptionInit;
        }

        const setup = async () => {
            const subscriptionsEngine = this.features?.subscriptionsEngine;
            const schema = await this.executableSchema;
            if (subscriptionsEngine && schema?.getSubscriptionType()) {
                subscriptionsEngine.events.setMaxListeners(0); // Removes warning regarding leak. >10 listeners are expected
                if (subscriptionsEngine.init) {
                    if (!this.schemaModel) throw new Error("SchemaModel not available on subscription mechanism");
                    await subscriptionsEngine.init({ schemaModel: this.schemaModel });
                }
            }
        };

        this.subscriptionInit = setup();

        return this.subscriptionInit;
    }

    /**
     * Clear all cached entries (both AST and Schema Model)
     */
    public async clearCache(): Promise<void> {
        if (this.astCache) {
            await this.astCache.clear();
        }
        if (this.schemaModelCache) {
            await this.schemaModelCache.clear();
        }
    }

    /**
     * Get combined cache statistics
     */
    public async getCacheStats(): Promise<{ ast: CacheStats; model: CacheStats }> {
        const astStats = this.astCache
            ? await this.astCache.getStats()
            : { entries: 0, totalSize: 0 };
        const modelStats = this.schemaModelCache
            ? await this.schemaModelCache.getStats()
            : { entries: 0, totalSize: 0 };

        return {
            ast: astStats,
            model: modelStats,
        };
    }

    /**
     * Clean up expired cache entries (both AST and Schema Model)
     */
    public async cleanupCache(): Promise<{ ast: number; model: number }> {
        const astCleaned = this.astCache ? await this.astCache.cleanup() : 0;
        const modelCleaned = this.schemaModelCache ? await this.schemaModelCache.cleanup() : 0;

        return {
            ast: astCleaned,
            model: modelCleaned,
        };
    }
}

export default Neo4jGraphQL;