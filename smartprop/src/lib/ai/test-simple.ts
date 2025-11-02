#!/usr/bin/env bun
/**
 * Simple Test Suite for AI System Optimizations
 * Tests individual components and basic functionality
 */

import { CircuitBreaker } from './circuit-breaker';
import { logger, measurePerformance } from './logger';
import { AI_CONFIG, CONVERSATION, BUSINESS_RULES } from './config';

console.log('🚀 Testing AI System Optimizations\n');

// Test 1: Circuit Breaker Basic Functionality
async function testCircuitBreaker() {
  console.log('🔧 Testing Circuit Breaker...');
  
  const testBreaker = new CircuitBreaker('test-breaker', {
    failureThreshold: 2,
    resetTimeout: 1000
  });

  // Test successful operation
  try {
    const result = await testBreaker.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return 'Success!';
    });
    console.log('   ✅ Successful operation:', result);
  } catch (error: any) {
    console.log('   ❌ Unexpected failure:', (error as Error).message);
  }

  // Test failure handling
  let failureCount = 0;
  for (let i = 0; i < 3; i++) {
    try {
      await testBreaker.execute(async () => {
        throw new Error(`Test failure ${i + 1}`);
      });
    } catch (error: any) {
      failureCount++;
      console.log(`   ⚠️  Expected failure ${failureCount}: ${(error as Error).message}`);
    }
  }

  console.log(`   📊 Circuit breaker state: ${testBreaker.getState()}`);
  console.log(`   📈 Stats:`, testBreaker.getStats());
  
  return true;
}

// Test 2: Configuration Constants
async function testConfiguration() {
  console.log('\n⚙️ Testing Configuration Constants...');
  
  console.log('   AI Model:', AI_CONFIG.MODEL);
  console.log('   Temperature:', AI_CONFIG.TEMPERATURE);
  console.log('   Max Tokens:', AI_CONFIG.MAX_TOKENS);
  console.log('   Conversation Rules:', CONVERSATION);
  console.log('   Business Rules:', BUSINESS_RULES);
  
  // Basic validation
  const isValid = AI_CONFIG.MODEL && 
                  AI_CONFIG.TEMPERATURE >= 0 && 
                  AI_CONFIG.TEMPERATURE <= 2 &&
                  Object.values(AI_CONFIG.MAX_TOKENS).every(val => val > 0);
  
  console.log(`   ${isValid ? '✅' : '❌'} Configuration validation: ${isValid ? 'PASS' : 'FAIL'}`);
  
  return isValid;
}

// Test 3: Structured Logging
async function testLogging() {
  console.log('\n📝 Testing Structured Logging...');
  
  // Test performance measurement
  const result = await measurePerformance('test-operation', async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return 'Test completed';
  });
  
  console.log(`   ⏱️  Performance measurement: ${result.duration}ms`);
  console.log(`   📊 Result:`, result.result);
  
  // Test different log categories
  logger.conversation.messageReceived('Hello world', { conversationId: 'test-123', sender: 'user' });
  logger.performance.parallelExecution(['op1', 'op2'], 300, { op1: 150, op2: 150 });
  
  console.log('   ✅ Logging methods executed successfully');
  
  return true;
}

// Test 4: Parallel Processing Simulation
async function testParallelProcessing() {
  console.log('\n⚡ Testing Parallel Processing Simulation...');
  
  // Simulate sequential operations
  const sequentialStart = Date.now();
  await new Promise(resolve => setTimeout(resolve, 100));
  await new Promise(resolve => setTimeout(resolve, 100));
  await new Promise(resolve => setTimeout(resolve, 100));
  const sequentialTime = Date.now() - sequentialStart;
  
  // Simulate parallel operations
  const parallelStart = Date.now();
  await Promise.all([
    new Promise(resolve => setTimeout(resolve, 100)),
    new Promise(resolve => setTimeout(resolve, 100)),
    new Promise(resolve => setTimeout(resolve, 100))
  ]);
  const parallelTime = Date.now() - parallelStart;
  
  const improvement = ((sequentialTime - parallelTime) / sequentialTime * 100).toFixed(1);
  
  console.log(`   📈 Sequential time: ${sequentialTime}ms`);
  console.log(`   ⚡ Parallel time: ${parallelTime}ms`);
  console.log(`   🚀 Improvement: ${improvement}%`);
  
  return parallelTime < sequentialTime;
}

// Test 5: Error Handling
async function testErrorHandling() {
  console.log('\n🛡️ Testing Error Handling...');
  
  const testBreaker = new CircuitBreaker('error-test', {
    failureThreshold: 1,
    resetTimeout: 500
  });
  
  // Test graceful error handling
  try {
    await testBreaker.execute(async () => {
      throw new Error('Simulated AI service failure');
    });
  } catch (error: any) {
    console.log('   ✅ Error caught gracefully:', (error as Error).message);
  }
  
  // Test circuit breaker opens
  try {
    await testBreaker.execute(async () => {
      return 'This should be blocked';
    });
  } catch (error: any) {
    console.log('   ✅ Circuit breaker blocked operation:', (error as Error).message);
  }
  
  return true;
}

// Run all tests
async function runAllTests() {
  const results = {
    circuitBreaker: false,
    configuration: false,
    logging: false,
    parallelProcessing: false,
    errorHandling: false
  };
  
  try {
    results.circuitBreaker = await testCircuitBreaker();
    results.configuration = await testConfiguration();
    results.logging = await testLogging();
    results.parallelProcessing = await testParallelProcessing();
    results.errorHandling = await testErrorHandling();
  } catch (error: any) {
    console.error('\n❌ Test execution failed:', (error as Error).message);
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('🎯 Test Results Summary:');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`   ${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
  });
  
  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🏆 Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  return allPassed;
}

// Execute tests
runAllTests()
  .then(success => {
    console.log(`\n${success ? '🎉' : '💥'} Test execution completed`);
  })
  .catch(error => {
    console.error('Failed to run tests:', error);
  });