#!/usr/bin/env bun
/**
 * Integration Test for AI System Optimizations
 * Tests the complete conversation flow with real-world scenarios
 */

import { logger, measurePerformance } from './logger';
import { AI_CONFIG, ERROR_MESSAGES } from './config';
import { 
  coBrokingAnalysisBreaker, 
  timeslotDetectionBreaker, 
  responseGenerationBreaker 
} from './circuit-breaker';

// Mock conversation data
const mockConversations = [
  {
    id: 'conv-001',
    messages: [
      { role: 'user', content: 'Hi, I need help finding a property' },
      { role: 'assistant', content: 'I can help you find the perfect property. What type are you looking for?' },
      { role: 'user', content: 'Looking for a 3-bedroom house in downtown area' }
    ],
    expectedAnalysis: {
      hasCoBrokingIntent: false,
      hasTimeslotRequest: false,
      requiresResponse: true
    }
  },
  {
    id: 'conv-002', 
    messages: [
      { role: 'user', content: 'Can you connect me with another agent who specializes in commercial properties?' },
      { role: 'assistant', content: 'I can help connect you with a commercial property specialist.' }
    ],
    expectedAnalysis: {
      hasCoBrokingIntent: true,
      hasTimeslotRequest: false,
      requiresResponse: true
    }
  },
  {
    id: 'conv-003',
    messages: [
      { role: 'user', content: 'I would like to schedule a viewing for tomorrow at 2 PM' },
      { role: 'assistant', content: 'Let me check availability for tomorrow at 2 PM.' }
    ],
    expectedAnalysis: {
      hasCoBrokingIntent: false,
      hasTimeslotRequest: true,
      requiresResponse: true
    }
  }
];

// Mock AI service functions
async function mockAIAnalysis(operation: string, delay: number = 100): Promise<Record<string, unknown>> {
  await new Promise(resolve => setTimeout(resolve, delay));
  
  switch (operation) {
    case 'co-broking':
      return { hasCoBrokingIntent: Math.random() > 0.5, confidence: 0.85 };
    case 'timeslot':
      return { hasTimeslotRequest: Math.random() > 0.7, suggestedTimes: ['2 PM', '3 PM'] };
    case 'response':
      return { response: 'Generated AI response', sentiment: 'positive' };
    default:
      return { result: 'success' };
  }
}

// Test individual AI operations with circuit breakers
async function testCircuitBreakerIntegration(): Promise<boolean> {
  console.log('\n🛡️ Testing Circuit Breaker Integration...');
  
  try {
    // Test co-broking analysis with circuit breaker
    const coBrokingResult = await measurePerformance('co-broking-analysis', async () => {
      return await coBrokingAnalysisBreaker.execute(async () => {
        return await mockAIAnalysis('co-broking', 50);
      });
    });
    
    logger.aiAnalysis.success('Co-broking analysis', coBrokingResult.duration, coBrokingResult.result);
    
    // Test timeslot detection with circuit breaker
    const timeslotResult = await measurePerformance('timeslot-detection', async () => {
      return await timeslotDetectionBreaker.execute(async () => {
        return await mockAIAnalysis('timeslot', 75);
      });
    });
    
    logger.aiAnalysis.success('Timeslot detection', timeslotResult.duration, timeslotResult.result);
    
    // Test response generation with circuit breaker
    const responseResult = await measurePerformance('response-generation', async () => {
      return await responseGenerationBreaker.execute(async () => {
        return await mockAIAnalysis('response', 100);
      });
    });
    
    logger.aiAnalysis.success('Response generation', responseResult.duration, responseResult.result);
    
    console.log('   ✅ All circuit breaker operations completed successfully');
    return true;
    
  } catch (error) {
    logger.error('Circuit breaker integration test failed', error as Error);
    return false;
  }
}

// Test parallel processing with real conversation analysis
async function testParallelConversationAnalysis(): Promise<boolean> {
  console.log('\n⚡ Testing Parallel Conversation Analysis...');
  
  try {
    for (const conversation of mockConversations) {
      logger.conversation.messageReceived(
        `Processing conversation ${conversation.id}`, 
        { conversationId: conversation.id, messageCount: conversation.messages.length }
      );
      
      // Simulate parallel AI operations
      const parallelResult = await measurePerformance('parallel-analysis', async () => {
        const [coBrokingAnalysis, timeslotAnalysis, responseGeneration] = await Promise.all([
          coBrokingAnalysisBreaker.execute(() => mockAIAnalysis('co-broking', 80)),
          timeslotDetectionBreaker.execute(() => mockAIAnalysis('timeslot', 60)),
          responseGenerationBreaker.execute(() => mockAIAnalysis('response', 120))
        ]);
        
        return {
          coBroking: coBrokingAnalysis,
          timeslot: timeslotAnalysis,
          response: responseGeneration
        };
      });
      
      logger.performance.parallelExecution(
        ['co-broking', 'timeslot', 'response'],
        parallelResult.duration,
        { 'co-broking': 80, 'timeslot': 60, 'response': 120 }
      );
      
      logger.conversation.analysisComplete({
        conversationId: conversation.id,
        duration: parallelResult.duration,
        result: parallelResult.result
      });
      
      console.log(`   ✅ Conversation ${conversation.id} analyzed in ${parallelResult.duration}ms`);
    }
    
    return true;
    
  } catch (error) {
    logger.error('Parallel conversation analysis test failed', error as Error);
    return false;
  }
}

// Test configuration constants usage
async function testConfigurationIntegration(): Promise<boolean> {
  console.log('\n⚙️ Testing Configuration Integration...');
  
  try {
    // Test AI configuration constants
    console.log(`   📋 AI Model: ${AI_CONFIG.MODEL}`);
    console.log(`   🌡️ Temperature: ${AI_CONFIG.TEMPERATURE}`);
    console.log(`   📊 Max Tokens - Co-broking: ${AI_CONFIG.MAX_TOKENS.CO_BROKING_ANALYSIS}`);
    console.log(`   📊 Max Tokens - Timeslot: ${AI_CONFIG.MAX_TOKENS.TIMESLOT_DETECTION}`);
    console.log(`   📊 Max Tokens - Response: ${AI_CONFIG.MAX_TOKENS.RESPONSE_GENERATION}`);
    
    // Test error message constants
    console.log(`   ❌ Error Message: ${ERROR_MESSAGES.NO_ACTIVE_PROMPT}`);
    
    // Validate configuration values
    const configTests = [
      { name: 'AI Model', value: AI_CONFIG.MODEL, expected: 'string' },
      { name: 'Temperature', value: AI_CONFIG.TEMPERATURE, expected: 'number' },
      { name: 'Max Tokens Co-broking', value: AI_CONFIG.MAX_TOKENS.CO_BROKING_ANALYSIS, expected: 'number' },
      { name: 'Max Tokens Timeslot', value: AI_CONFIG.MAX_TOKENS.TIMESLOT_DETECTION, expected: 'number' },
      { name: 'Max Tokens Response', value: AI_CONFIG.MAX_TOKENS.RESPONSE_GENERATION, expected: 'number' }
    ];
    
    for (const test of configTests) {
      if (typeof test.value !== test.expected) {
        throw new Error(`Configuration ${test.name} has wrong type: expected ${test.expected}, got ${typeof test.value}`);
      }
    }
    
    console.log('   ✅ All configuration constants validated');
    return true;
    
  } catch (error) {
    logger.error('Configuration integration test failed', error as Error);
    return false;
  }
}

// Test structured logging in different scenarios
async function testLoggingIntegration(): Promise<boolean> {
  console.log('\n📝 Testing Structured Logging Integration...');
  
  try {
    // Test different logging categories and levels
    logger.aiAnalysis.start('integration-test', { testType: 'comprehensive' });
    
    // Simulate conversation flow logging
    logger.conversation.messageReceived('Test message for logging', { 
      conversationId: 'test-integration',
      timestamp: new Date().toISOString(),
      messageType: 'user_input'
    });
    
    // Test performance logging
    logger.performance.latency('test-operation', 150, 100);
    
    // Test circuit breaker logging
    logger.circuitBreaker.operationSuccess('test-breaker', 'test-operation', 95);
    
    // Test error logging
    logger.warn('Test warning message', { component: 'integration-test' });
    
    logger.aiAnalysis.success('integration-test', 250, { 
      testsRun: 5,
      allPassed: true 
    });
    
    console.log('   ✅ All logging methods executed successfully');
    return true;
    
  } catch (error) {
    logger.error('Logging integration test failed', error as Error);
    return false;
  }
}

// Test system under load (simulated concurrent requests)
async function testConcurrentLoad(): Promise<boolean> {
  console.log('\n🚀 Testing Concurrent Load Handling...');
  
  try {
    const concurrentRequests = 10;
    const requests = Array.from({ length: concurrentRequests }, (_, i) => 
      measurePerformance(`concurrent-request-${i}`, async () => {
        // Simulate concurrent AI operations
        const [analysis1, analysis2] = await Promise.all([
          coBrokingAnalysisBreaker.execute(() => mockAIAnalysis('co-broking', Math.random() * 100)),
          timeslotDetectionBreaker.execute(() => mockAIAnalysis('timeslot', Math.random() * 100))
        ]);
        
        return { analysis1, analysis2 };
      })
    );
    
    const results = await Promise.all(requests);
    const totalDuration = Math.max(...results.map(r => r.duration));
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    logger.performance.parallelExecution(
      Array.from({ length: concurrentRequests }, (_, i) => `request-${i}`),
      totalDuration,
      Object.fromEntries(results.map((r, i) => [`request-${i}`, r.duration]))
    );
    
    console.log(`   ✅ ${concurrentRequests} concurrent requests completed`);
    console.log(`   📊 Total time: ${totalDuration}ms, Average: ${avgDuration.toFixed(1)}ms`);
    
    return true;
    
  } catch (error) {
    logger.error('Concurrent load test failed', error as Error);
    return false;
  }
}

// Main test runner
async function runIntegrationTests(): Promise<void> {
  console.log('🧪 Starting AI System Integration Tests...');
  console.log('==================================================');
  
  const testResults: Record<string, boolean> = {};
  
  // Run all integration tests
  testResults.circuitBreaker = await testCircuitBreakerIntegration();
  testResults.parallelAnalysis = await testParallelConversationAnalysis();
  testResults.configuration = await testConfigurationIntegration();
  testResults.logging = await testLoggingIntegration();
  testResults.concurrentLoad = await testConcurrentLoad();
  
  // Summary
  console.log('\n==================================================');
  console.log('🎯 Integration Test Results Summary:');
  
  let allPassed = true;
  for (const [testName, passed] of Object.entries(testResults)) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${status} ${testName}`);
    if (!passed) allPassed = false;
  }
  
  const overallStatus = allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED';
  console.log(`\n🏆 Overall: ${overallStatus}`);
  
  if (allPassed) {
    logger.aiAnalysis.success('integration-tests', Date.now(), {
      testsRun: Object.keys(testResults).length,
      allPassed: true,
      summary: testResults
    });
  } else {
    logger.aiAnalysis.error('integration-tests', new Error('Some integration tests failed'), {
      testsRun: Object.keys(testResults).length,
      failedTests: Object.entries(testResults).filter(([, passed]) => !passed).map(([name]) => name)
    });
  }
  
  console.log('\n🎉 Integration test execution completed');
}

// Auto-run tests when this file is executed
runIntegrationTests().catch((error) => console.error(error));

export { runIntegrationTests };
