# PropertyGuru Districts Scraper Comparison: Backup Branch vs Current Code

## 📊 Overview

**Backup Branch**: `backup-20251106-120938` (888 lines)  
**Current Code**: `main` (local uncommitted) (863 lines)  
**File**: `smartprop/src/workers/pg.districts.ts`

**Line Count**: Current is 25 lines shorter than backup

## 🔍 Key Differences

### 1. Supabase Client Import

**Backup Branch (Lines 29-30)**:
```typescript
import { supabase } from './supa.js';
```

**Current Code (Lines 29-31)**:
```typescript
import { getSupabaseClient } from './supa.js';
const supabase = getSupabaseClient();
```

**Difference**: Backup uses direct import, current uses function call to get client

---

### 2. Re-Authentication Control Flag

**Backup Branch**: 
- ❌ No re-authentication control flag
- Always re-authenticates before scraping

**Current Code (Lines 32-33)**:
```typescript
// Allow disabling automatic re-authentication via environment flag
const REAUTH_ENABLED = process.env.PG_DISABLE_REAUTH !== '1';
```

**Difference**: Current version allows disabling re-authentication via `PG_DISABLE_REAUTH=1` environment variable

---

### 3. Re-Authentication Before Scraping

**Backup Branch (Lines 347-352)**:
```typescript
// Simple approach: Re-authenticate before scraping to ensure fresh auth
console.log('🔄 Re-authenticating before scraping to ensure fresh session...');
await reAuthenticate();

// Verify auth state exists after re-auth
const updatedStateExists = fs.existsSync(stateFilePath);
if (!updatedStateExists) {
  console.error('❌ Authentication state file not found after re-authentication!');
  process.exit(1);
}
```

**Current Code (Lines 348-360)**:
```typescript
// Simple approach: Re-authenticate before scraping to ensure fresh auth
if (REAUTH_ENABLED) {
  console.log('🔄 Re-authenticating before scraping to ensure fresh session...');
  await reAuthenticate();
  
  // Verify auth state exists after re-auth
  const updatedStateExists = fs.existsSync(stateFilePath);
  if (!updatedStateExists) {
    console.error('❌ Authentication state file not found after re-authentication!');
    process.exit(1);
  }
} else {
  console.log('⏭️ Skipping re-authentication (PG_DISABLE_REAUTH=1). Using existing storage state if present.');
}
```

**Difference**: 
- Backup: Always re-authenticates
- Current: Conditionally re-authenticates based on `REAUTH_ENABLED` flag

---

### 4. Re-Authentication During Scraping (When Phone Numbers Fail)

**Backup Branch (Lines 651-702)**:
```typescript
// If we've had too many consecutive failures, trigger re-authentication
if (consecutiveNoPhone >= MAX_CONSECUTIVE_NO_PHONE) {
  console.log(`\n🚨 ${consecutiveNoPhone} consecutive listings without phone numbers!`);
  console.log(`🔄 Authentication may have expired. Triggering re-login...\n`);
  
  // Update status message
  jobStatus.statusMessage = '🔄 Re-authenticating...';
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  
  await listingPage.close();
  await page.close();
  await browser.close();
  
  // Re-authenticate
  const reAuthSuccess = await reAuthenticate();
  if (!reAuthSuccess) {
    console.log('❌ Re-authentication failed. Stopping scraper.');
    // Clean up lock file
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    process.exit(1);
  }
  
  // Update status message before removing lock
  jobStatus.statusMessage = '✅ Re-authenticated! Restarting in 2s...';
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  
  console.log('✅ Re-authentication complete! Auto-restarting scraper...\n');
  console.log('🔄 Restarting with fresh authentication in 2 seconds...');
  
  // Wait a moment for UI to show the message
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Remove lock file to allow restart
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
  
  // Restart the entire scraping process with fresh authentication
  // Preserve the original environment variables from the admin page
  setTimeout(() => {
    // Re-execute the same command that was originally started by the admin page
    const cwd = process.cwd();
    const districts = process.env.PG_DISTRICTS || 'ALL';
    const maxPages = process.env.PG_MAX_PAGES || '3';
    const jobId = process.env.PG_JOB_ID || '';
    
    const restartCmd = `cd ${cwd} && PG_DISTRICTS="${districts}" PG_MAX_PAGES=${maxPages} PG_JOB_ID="${jobId}" bun src/workers/pg.districts.ts > /tmp/pg-scraper-${jobId}.log 2>&1 &`;
    
    console.log(`🔄 Restarting with command: ${restartCmd}`);
    exec(restartCmd, (error: unknown) => {
      if (error) {
        console.error('❌ Failed to restart scraper:', error);
        process.exit(1);
      }
    });
  }, 2000); // 2 second delay to ensure auth state is settled
  
  return;
}
```

**Current Code (Lines 651-727)**:
```typescript
// If we've had too many consecutive failures, trigger re-authentication
if (consecutiveNoPhone >= MAX_CONSECUTIVE_NO_PHONE) {
  console.log(`\n🚨 ${consecutiveNoPhone} consecutive listings without phone numbers!`);
  console.log(`🔄 Authentication may have expired. Triggering re-login...\n`);
  
  // Update status message
  jobStatus.statusMessage = '🔄 Re-authenticating...';
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));

  // If re-authentication is disabled, skip restarting and continue with current session
  if (!REAUTH_ENABLED) {
    console.log('⏭️ Skipping re-authentication (PG_DISABLE_REAUTH=1); continuing with current session.');
    consecutiveNoPhone = 0;
    await listingPage.close();
    continue;
  }
  
  await listingPage.close();
  await page.close();
  await browser.close();
  
  // Re-authenticate
  const reAuthSuccess = await reAuthenticate();
  if (!reAuthSuccess) {
    console.log('❌ Re-authentication failed. Stopping scraper.');
    // Clean up lock file
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
    process.exit(1);
  }
  
  // Update status message before removing lock
  jobStatus.statusMessage = '✅ Re-authenticated! Restarting in 2s...';
  fs.writeFileSync(lockFile, JSON.stringify(jobStatus, null, 2));
  
  console.log('✅ Re-authentication complete! Auto-restarting scraper...\n');
  console.log('🔄 Restarting with fresh authentication...');
  
  // Wait a moment for UI to show the message
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Remove lock file to allow restart
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
  }
  
  // Restart the entire scraping process with fresh authentication
  // Preserve the original environment variables from the admin page
  // Execute restart command immediately (command runs in background with &)
  const cwd = process.cwd();
  const districts = process.env.PG_DISTRICTS || 'ALL';
  const maxPages = process.env.PG_MAX_PAGES || '3';
  const jobId = process.env.PG_JOB_ID || '';
  
  const restartCmd = `cd ${cwd} && PG_DISTRICTS="${districts}" PG_MAX_PAGES=${maxPages} PG_JOB_ID="${jobId}" bun src/workers/pg.districts.ts > /tmp/pg-scraper-${jobId}.log 2>&1 &`;
  
  console.log(`🔄 Restarting with command: ${restartCmd}`);
  
  // Execute restart command and wait for it to spawn before exiting
  // The & at the end makes it run in background, so exec callback fires immediately
  await new Promise<void>((resolve, reject) => {
    exec(restartCmd, (error: unknown) => {
      if (error) {
        console.error('❌ Failed to restart scraper:', error);
        reject(error);
      } else {
        // Command spawned successfully, give it a moment to start
        setTimeout(() => {
          resolve();
        }, 500);
      }
    });
  });
  
  // Exit after restart command has been spawned
  process.exit(0);
}
```

**Key Differences**:

1. **Re-authentication Skip Option** (Current Only):
   - Current version checks `REAUTH_ENABLED` and can skip re-authentication
   - If disabled, resets counter and continues with current session
   - Backup always re-authenticates

2. **Restart Command Execution**:
   - **Backup**: Uses `setTimeout` with callback, then `return`
   - **Current**: Uses `Promise` with `exec`, waits for spawn, then `process.exit(0)`
   
3. **Error Handling**:
   - **Backup**: Simple error handling in callback
   - **Current**: Uses Promise reject/resolve for better error handling

4. **Exit Behavior**:
   - **Backup**: Uses `return` to exit the function
   - **Current**: Uses `process.exit(0)` after ensuring restart command spawned

---

## 📈 Summary of Changes

| Feature | Backup Branch | Current Code | Impact |
|---------|---------------|-------------|--------|
| **Supabase Import** | Direct import | Function call | Minor - different pattern |
| **Re-auth Control** | Always enabled | Configurable via env var | ⭐ Major - flexibility |
| **Pre-scrape Re-auth** | Always runs | Conditional | ⭐ Major - can skip |
| **Mid-scrape Re-auth** | Always runs | Conditional | ⭐ Major - can skip |
| **Restart Logic** | setTimeout + return | Promise + exit(0) | Medium - better error handling |
| **Error Handling** | Basic | Promise-based | Medium - more robust |

---

## ✅ Which Version is Better?

### Current Code Advantages:
1. ✅ **Flexibility**: Can disable re-authentication via `PG_DISABLE_REAUTH=1`
2. ✅ **Better Error Handling**: Promise-based restart logic with proper error handling
3. ✅ **Cleaner Exit**: Uses `process.exit(0)` instead of `return` for clearer process termination
4. ✅ **More Robust**: Waits for restart command to spawn before exiting

### Backup Branch Advantages:
1. ✅ **Simpler**: Less conditional logic, always re-authenticates
2. ✅ **More Reliable**: Always ensures fresh authentication
3. ✅ **Less Configuration**: No need to manage environment flags

---

## 🎯 Recommendation

**Use CURRENT CODE** for production, but with re-authentication enabled by default:

### Why Current Code is Better:
1. **Flexibility**: The ability to disable re-authentication is useful for:
   - Testing scenarios where you want to reuse existing auth
   - Development environments where re-auth is slow
   - Debugging authentication issues

2. **Better Restart Logic**: The Promise-based approach ensures the restart command actually spawns before the process exits

3. **More Robust**: Proper error handling prevents silent failures

### When to Use Which:
- **Production**: Use current code with `REAUTH_ENABLED=true` (default)
- **Development/Testing**: Use current code with `PG_DISABLE_REAUTH=1` to skip re-auth
- **Backup Branch**: Use if you want simpler, always-on re-authentication

---

## 🔧 Key Improvements in Current Code

### 1. Configurable Re-Authentication
```typescript
const REAUTH_ENABLED = process.env.PG_DISABLE_REAUTH !== '1';
```
Allows disabling re-authentication for testing/debugging.

### 2. Better Restart Logic
```typescript
await new Promise<void>((resolve, reject) => {
  exec(restartCmd, (error: unknown) => {
    if (error) {
      reject(error);
    } else {
      setTimeout(() => resolve(), 500);
    }
  });
});
process.exit(0);
```
Ensures restart command spawns before exiting.

### 3. Skip Re-auth Option
```typescript
if (!REAUTH_ENABLED) {
  console.log('⏭️ Skipping re-authentication...');
  consecutiveNoPhone = 0;
  continue;
}
```
Allows continuing with current session if re-auth is disabled.

---

## 📝 Migration Notes

If migrating from backup to current:
1. ✅ No breaking changes - current is backward compatible
2. ✅ Re-authentication is enabled by default (same behavior as backup)
3. ✅ Can optionally disable with `PG_DISABLE_REAUTH=1`
4. ✅ Restart logic is more robust

If migrating from current to backup:
1. ⚠️ Will lose ability to disable re-authentication
2. ⚠️ Will lose Promise-based restart error handling
3. ✅ Will have simpler, always-on re-authentication

---

**Last Updated**: January 2025  
**Comparison**: `backup-20251106-120938` vs `main` (local)

