# Database Connection Timeout Fix

## Problem

The scraper worker was experiencing database connection timeouts, causing the worker to crash repeatedly (842 restarts). The errors showed:
- `Connection terminated unexpectedly`
- `Connection terminated due to connection timeout`

## Root Cause Analysis

Using Supabase MCP, we discovered:

1. **Using Supavisor Session Mode Pooler** (port 5432)
   - This is correct for pg-boss which needs persistent connections
   - However, the connection string lacked timeout and keepalive settings

2. **Connection Pool Exhaustion**
   - Pool size was set to 5 connections
   - Supavisor has limits per `user+db+mode` combination
   - Other services (PostgREST, Storage, etc.) also use the pooler
   - This could lead to connection exhaustion

3. **No Connection Timeout/Keepalive**
   - Connections could timeout without proper settings
   - No keepalive to detect and recover from dead connections
   - Network issues could cause connections to hang

## Solution

### 1. Added Connection Timeout and Keepalive

Added connection string parameters:
- `connect_timeout=30` - 30 second connection timeout
- `keepalive=1` - Enable TCP keepalive
- `keepalive_idle=60000` - Start keepalive after 60 seconds of idle
- `keepalive_interval=10000` - Send keepalive every 10 seconds

These parameters are added to the connection string when using Supavisor session mode.

### 2. Reduced Connection Pool Size

Changed from 5 to 3 connections:
- Leaves room for other Supabase services
- Reduces risk of connection exhaustion
- Still sufficient for pg-boss workload (processes jobs one at a time)

### 3. Added Better Logging

Now logs connection settings on startup:
```
[pg-boss] Connection settings: timeout=30s, keepalive=true
```

## Configuration

Environment variables (optional, with defaults):
```env
PG_CONNECT_TIMEOUT=30          # Connection timeout in seconds
PG_KEEPALIVE=true              # Enable keepalive (default: true)
PG_KEEPALIVE_IDLE=60000        # Idle time before keepalive (ms)
PG_KEEPALIVE_INTERVAL=10000    # Keepalive interval (ms)
PG_BOSS_POOL_MAX=3             # Connection pool size (default: 3)
```

## Why This Works

1. **Connection Timeout**: Prevents hanging on connection attempts
2. **Keepalive**: Detects dead connections and allows recovery
3. **Smaller Pool**: Reduces connection exhaustion risk
4. **Retry Logic**: Worker already has retry logic (added in previous fix)

## Testing

After deployment, monitor:
1. Worker stability (should have fewer restarts)
2. Connection logs (should show successful connections)
3. Job processing (queued jobs should start processing)

## Related Issues

- Previous fix: Added retry logic for connection failures
- This fix: Prevents connection timeouts from occurring

## References

- [Supabase Connection Pooling](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supavisor FAQ](https://github.com/orgs/supabase/discussions/21566)
- [PostgreSQL Connection Parameters](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS)

