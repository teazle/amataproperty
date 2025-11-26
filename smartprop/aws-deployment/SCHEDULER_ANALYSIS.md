# Scraper Scheduler Analysis - Job Queuing Requirements

## Current Implementation Issues

### 1. **Race Condition in Concurrent Job Starts**
**Location**: `scraper-scheduler.ts:287-296`

**Problem**: When a PG schedule has multiple districts, it loops through them sequentially:
```typescript
for (const district of schedule.config.districts) {
  const result = await startScrapeJob({ ... });
}
```

**Issue**: 
- `startScrapeJob` checks for active jobs, but there's a race condition
- If two schedules trigger simultaneously, both might pass the "no active job" check before either starts
- Multiple jobs could start concurrently, causing OOM issues

### 2. **No Job Queuing System**
**Current Behavior**:
- Jobs are started immediately if no active job exists
- If a job is running, new jobs are **rejected** (not queued)
- No priority system
- No retry mechanism

**Problems**:
- Manual job starts while scheduled jobs are running → rejected
- Multiple scheduled jobs at same time → race condition
- No way to queue jobs for later execution

### 3. **Scheduler Doesn't Wait for Completion**
**Location**: `scraper-scheduler.ts:287-296`

**Problem**: The scheduler calls `startScrapeJob` but doesn't wait for the job to complete. It immediately marks the schedule as "success" after starting the job, not after completion.

**Impact**: 
- Schedule status shows "success" even if job fails later
- No way to track actual job completion from scheduler perspective

### 4. **Lock File vs Database State Mismatch**
**Problem**: 
- Lock files are checked for active jobs
- Database status might be out of sync
- Race conditions between file system and database

## Recommended Solution: Job Queue System

### Architecture

```
┌─────────────────┐
│  Scheduler      │
│  (Cron Jobs)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Job Queue      │  ← Central queue for all jobs
│  (Database)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Job Processor  │  ← Processes one job at a time
│  (Worker)       │
└─────────────────┘
```

### Implementation Plan

1. **Job Queue Table** (already exists: `scraper_jobs`)
   - Status: `queued`, `running`, `completed`, `failed`
   - Priority field for job ordering
   - Retry count for failed jobs

2. **Job Processor**
   - Single worker that processes jobs from queue
   - Processes one job at a time (prevents OOM)
   - Automatically picks next job when current completes

3. **Scheduler Changes**
   - Instead of starting jobs directly, add them to queue
   - Mark schedule as "queued" not "success"
   - Job processor handles actual execution

4. **Benefits**
   - ✅ No race conditions (single processor)
   - ✅ Jobs are queued, not rejected
   - ✅ Can handle multiple schedules gracefully
   - ✅ Priority system for urgent jobs
   - ✅ Retry mechanism for failed jobs
   - ✅ Better resource management (one job at a time)

### Priority Levels

1. **High**: Manual job starts (user-initiated)
2. **Normal**: Scheduled jobs
3. **Low**: Retry jobs

### Job States

- `queued`: Waiting in queue
- `running`: Currently executing
- `completed`: Successfully finished
- `failed`: Failed (can be retried)
- `cancelled`: Manually cancelled

## Current Workarounds

The current system has some protections:
- ✅ Lock files prevent same platform from running twice
- ✅ `isRunning` flag prevents same schedule from overlapping
- ✅ Stale lock cleanup

But it's missing:
- ❌ Proper queuing for concurrent requests
- ❌ Priority system
- ❌ Retry mechanism
- ❌ Job completion tracking from scheduler

## Recommendation

**YES, job queuing is needed** for:
1. Handling concurrent job requests
2. Better resource management (prevent OOM)
3. User experience (queue jobs instead of rejecting)
4. Reliability (retry failed jobs)

**Implementation Priority**: **HIGH** - This is causing the OOM issues when multiple jobs try to start simultaneously.

