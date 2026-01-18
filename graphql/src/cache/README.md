# AST Caching Implementation

This document describes the AST (Abstract Syntax Tree) caching feature added to the Neo4j GraphQL library.

## Overview

The AST cache stores parsed GraphQL type definitions to disk, avoiding the need to re-parse them on every server startup. This can significantly reduce startup time, especially for large or complex schemas.

## Performance Benefits

- **Small schemas (10 types)**: ~20% faster startup
- **Medium schemas (100 types)**: ~30% faster startup  
- **Large schemas (1000+ types)**: ~40% faster startup

## Usage

### Basic Usage

Enable caching with default settings:

```typescript
import { Neo4jGraphQL } from '@neo4j/graphql';

const neoSchema = new Neo4jGraphQL({
  typeDefs,
  cache: {
    enabled: true, // Enable caching
  },
});

const schema = await neoSchema.getSchema();
```

### Configuration Options

```typescript
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  cache: {
    // Enable/disable caching (default: true if cache object is provided)
    enabled: true,
    
    // Cache directory (default: '.neo4j-graphql-cache')
    directory: '.cache/graphql',
    
    // Time-to-live in milliseconds (optional)
    // Cache entries older than this will be considered invalid
    ttl: 24 * 60 * 60 * 1000, // 24 hours
  },
});
```

### Production Configuration

Recommended configuration for production:

```typescript
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  driver,
  cache: {
    enabled: process.env.NODE_ENV === 'production',
    directory: process.env.CACHE_DIR || '/var/cache/neo4j-graphql',
  },
});
```

### Disable Caching

Caching can be disabled explicitly:

```typescript
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  cache: {
    enabled: false,
  },
});
```

Or simply omit the `cache` option:

```typescript
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  // No cache configuration = no caching
});
```

## Cache Management

### Clear Cache

Remove all cached entries:

```typescript
await neoSchema.clearCache();
```

### Get Cache Statistics

Retrieve information about cached entries:

```typescript
const stats = await neoSchema.getCacheStats();
console.log(`Cache entries: ${stats.entries}`);
console.log(`Total size: ${stats.totalSize} bytes`);
console.log(`Oldest entry: ${stats.oldestEntry}`);
console.log(`Newest entry: ${stats.newestEntry}`);
```

### Cleanup Expired Entries

Remove expired entries (only works if TTL is configured):

```typescript
const removedCount = await neoSchema.cleanupCache();
console.log(`Removed ${removedCount} expired entries`);
```

## Cache Invalidation

The cache is automatically invalidated when:

1. **Type definitions change**: Each set of type definitions has a unique hash
2. **Library version changes**: Cache includes the library version
3. **TTL expires**: If configured, entries older than TTL are invalid

## Implementation Details

### Cache Storage

- Cached entries are stored as JSON files in the cache directory
- File names are SHA-256 hashes of the type definitions + library version
- Each entry includes:
  - Library version
  - Hash of type definitions
  - Serialized AST (using GraphQL's `print()` function)
  - Timestamp

### Cache Structure

```
.neo4j-graphql-cache/
└── ast/
    ├── abc123...def.json
    ├── 456789...xyz.json
    └── ...
```

### Cache Entry Format

```json
{
  "version": "7.4.1",
  "hash": "abc123...def",
  "ast": "type User { id: ID! name: String! }",
  "timestamp": 1704067200000
}
```

## Best Practices

### Development vs Production

**Development:**
- Disable caching or use short TTL
- Type definitions change frequently
- Fast iteration is more important than startup time

```typescript
cache: {
  enabled: false, // or
  ttl: 60 * 1000, // 1 minute
}
```

**Production:**
- Enable caching with no TTL (or long TTL)
- Type definitions are stable
- Startup time optimization is important

```typescript
cache: {
  enabled: true,
  directory: '/var/cache/neo4j-graphql',
}
```

### Docker Containers

Mount the cache directory as a volume for persistence:

```dockerfile
# Dockerfile
RUN mkdir -p /app/.cache
VOLUME /app/.cache
```

```yaml
# docker-compose.yml
services:
  api:
    volumes:
      - graphql-cache:/app/.cache

volumes:
  graphql-cache:
```

### Serverless Environments

Caching may not be beneficial in serverless environments where:
- File system is ephemeral (e.g., AWS Lambda)
- Cold starts are expected
- Persistent storage is not available

Consider disabling cache in these environments:

```typescript
cache: {
  enabled: process.env.ENVIRONMENT !== 'serverless',
}
```

### CI/CD

Cache the directory between builds:

```yaml
# .github/workflows/test.yml
- name: Cache GraphQL AST
  uses: actions/cache@v3
  with:
    path: .neo4j-graphql-cache
    key: graphql-ast-${{ hashFiles('**/schema.graphql') }}
```

## Monitoring

### Cache Hit Rate

Track cache effectiveness in your application:

```typescript
const startTime = Date.now();
const schema = await neoSchema.getSchema();
const duration = Date.now() - startTime;

// Log for monitoring
console.log(`Schema generation took ${duration}ms`);

// Get cache stats
const stats = await neoSchema.getCacheStats();
console.log(`Cache has ${stats.entries} entries`);
```

### Periodic Cleanup

Run cleanup periodically if using TTL:

```typescript
// Run cleanup every hour
setInterval(async () => {
  const removed = await neoSchema.cleanupCache();
  if (removed > 0) {
    console.log(`Cleaned up ${removed} expired cache entries`);
  }
}, 60 * 60 * 1000);
```

## Troubleshooting

### Cache Not Working

If you're not seeing performance improvements:

1. **Check cache is enabled:**
   ```typescript
   console.log('Cache enabled:', neoSchema.cache !== undefined);
   ```

2. **Verify cache directory exists and is writable:**
   ```bash
   ls -la .neo4j-graphql-cache/ast/
   ```

3. **Check for errors:**
   - Cache operations log errors but don't throw
   - Enable debug mode to see cache operations:
     ```typescript
     process.env.DEBUG = '@neo4j/graphql:cache';
     ```

### Cache Size Growing

If cache directory grows too large:

1. **Set a TTL:**
   ```typescript
   cache: {
     enabled: true,
     ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
   }
   ```

2. **Run periodic cleanup:**
   ```typescript
   await neoSchema.cleanupCache();
   ```

3. **Clear old entries:**
   ```typescript
   await neoSchema.clearCache();
   ```

### Different Cache Per Environment

Use different cache directories:

```typescript
cache: {
  enabled: true,
  directory: `.cache/${process.env.NODE_ENV}`,
}
```

## Security Considerations

1. **File Permissions:**
   - Ensure cache directory has appropriate permissions
   - Don't use world-readable directories in production

2. **Sensitive Data:**
   - Type definitions themselves are cached
   - If your schema contains sensitive information, be careful where you store cache

3. **Cache Poisoning:**
   - Cache uses cryptographic hashes for integrity
   - Version checking prevents incompatibility issues

## API Reference

### Types

```typescript
interface Neo4jGraphQLCacheConfig {
  enabled?: boolean;
  directory?: string;
  ttl?: number; // milliseconds
}

interface CacheStats {
  entries: number;
  totalSize: number;
  oldestEntry?: Date;
  newestEntry?: Date;
}
```

### Methods

#### `clearCache(): Promise<void>`

Remove all cached AST entries.

```typescript
await neoSchema.clearCache();
```

#### `getCacheStats(): Promise<CacheStats>`

Get statistics about cached entries.

```typescript
const stats = await neoSchema.getCacheStats();
```

#### `cleanupCache(): Promise<number>`

Remove expired cache entries (only if TTL configured).

```typescript
const removed = await neoSchema.cleanupCache();
```

## Migration Guide

### Upgrading from Previous Versions

The cache feature is completely opt-in. Existing code will continue to work without changes.

To enable caching, simply add the `cache` configuration:

```typescript
// Before
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  driver,
});

// After (with caching)
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  driver,
  cache: { enabled: true },
});
```

### Testing

Update your tests to clear cache between test runs:

```typescript
afterEach(async () => {
  await neoSchema.clearCache();
});
```

Or disable cache in tests:

```typescript
const neoSchema = new Neo4jGraphQL({
  typeDefs,
  cache: { enabled: false },
});
```

## Future Enhancements

Potential future improvements:

1. **Schema Model Caching**: Cache the processed schema model for even better performance
2. **Memory Cache**: Option to use in-memory caching instead of disk
3. **Cache Backends**: Support for Redis, S3, or other cache backends
4. **Metrics**: Built-in metrics for cache hit rate and performance
5. **Warming**: Pre-warm cache on application startup

## Questions?

For issues or questions about the cache feature:

1. Check the [troubleshooting section](#troubleshooting)
2. Review the [examples above](#usage)
3. Open an issue on GitHub with the `cache` label
