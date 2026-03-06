import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';
const results = {
  timestamp: new Date().toISOString(),
  tests: {},
  summary: {}
};

async function test(name, url, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    
    const start = Date.now();
    const response = await fetch(`${BASE_URL}${url}`, options);
    const duration = Date.now() - start;
    
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      return {
        status: 'ERROR',
        httpStatus: response.status,
        duration: `${duration}ms`,
        data: null,
        error: `Expected JSON but got ${contentType || 'unknown'}. Response: ${text.substring(0, 100)}`
      };
    }
    
    return {
      status: response.ok ? 'PASS' : 'FAIL',
      httpStatus: response.status,
      duration: `${duration}ms`,
      data,
      error: null
    };
  } catch (error) {
    return {
      status: 'ERROR',
      httpStatus: null,
      duration: null,
      data: null,
      error: error.message
    };
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 ArguMentor System Verification');
  console.log('='.repeat(70) + '\n');

  // Test 1: Environment Variables
  console.log('📋 Testing Environment Variables...');
  results.tests.environment = await test('Environment Variables', '/api/test/test-env');
  console.log(`   Status: ${results.tests.environment.status}`);
  if (results.tests.environment.data) {
    const missing = results.tests.environment.data.missing || [];
    if (missing.length > 0) {
      console.log(`   ⚠️  Missing: ${missing.join(', ')}`);
    } else {
      console.log(`   ✅ All required variables set`);
    }
  }
  console.log('');

  // Test 2: MongoDB Connection
  console.log('🗄️  Testing MongoDB Connection...');
  results.tests.mongodb = await test('MongoDB', '/api/test/test-mongo');
  console.log(`   Status: ${results.tests.mongodb.status}`);
  if (results.tests.mongodb.data) {
    console.log(`   Service: ${results.tests.mongodb.data.service}`);
    if (results.tests.mongodb.status === 'PASS') {
      console.log(`   ✅ Connected successfully`);
    } else {
      console.log(`   ❌ Error: ${results.tests.mongodb.data.error || 'Unknown error'}`);
    }
  }
  console.log('');

  // Test 3: Gemini API
  console.log('🤖 Testing Gemini API...');
  results.tests.gemini = await test('Gemini API', '/api/test/test-gemini');
  console.log(`   Status: ${results.tests.gemini.status}`);
  if (results.tests.gemini.data) {
    console.log(`   Service: ${results.tests.gemini.data.service}`);
    if (results.tests.gemini.status === 'PASS') {
      console.log(`   ✅ API responding: "${results.tests.gemini.data.response}"`);
      console.log(`   Model: ${results.tests.gemini.data.model || 'N/A'}`);
    } else {
      console.log(`   ❌ Error: ${results.tests.gemini.data.error || 'Unknown error'}`);
    }
  }
  console.log('');

  // Test 4: Mistral API
  console.log('🔮 Testing Mistral API...');
  results.tests.mistral = await test('Mistral API', '/api/test/test-mistral');
  console.log(`   Status: ${results.tests.mistral.status}`);
  if (results.tests.mistral.data) {
    console.log(`   Service: ${results.tests.mistral.data.service}`);
    if (results.tests.mistral.status === 'PASS') {
      console.log(`   ✅ API responding: "${results.tests.mistral.data.response}"`);
    } else if (results.tests.mistral.data.status === 'NOT_CONFIGURED') {
      console.log(`   ⚠️  Not configured (optional - system uses Gemini fallback)`);
    } else {
      console.log(`   ❌ Error: ${results.tests.mistral.data.error || 'Unknown error'}`);
    }
  }
  console.log('');

  // Test 5: Python Interpreter
  console.log('🐍 Testing Python Interpreter...');
  results.tests.python = await test('Python', '/api/test/test-python');
  console.log(`   Status: ${results.tests.python.status}`);
  if (results.tests.python.data) {
    console.log(`   Service: ${results.tests.python.data.service}`);
    if (results.tests.python.status === 'PASS') {
      console.log(`   ✅ Python available: ${results.tests.python.data.version}`);
      console.log(`   Binary: ${results.tests.python.data.pythonBin}`);
    } else {
      console.log(`   ❌ Error: ${results.tests.python.data.error || 'Unknown error'}`);
    }
  }
  console.log('');

  // Test 6: Health Endpoint
  console.log('🏥 Testing Health Endpoint...');
  results.tests.health = await test('Health', '/health');
  console.log(`   Status: ${results.tests.health.status}`);
  if (results.tests.health.data) {
    console.log(`   ✅ Server is healthy`);
    console.log(`   MongoDB: ${results.tests.health.data.mongo?.connected ? 'Connected' : 'Disconnected'}`);
    console.log(`   Gemini: ${results.tests.health.data.env?.hasGeminiKey ? 'Configured' : 'Not configured'}`);
  }
  console.log('');

  // Test 7: Comprehensive Test
  console.log('🔬 Running Comprehensive System Test...');
  results.tests.comprehensive = await test('Comprehensive', '/api/test/test-all');
  console.log(`   Status: ${results.tests.comprehensive.status}`);
  if (results.tests.comprehensive.data) {
    const summary = results.tests.comprehensive.data.summary || {};
    console.log(`   Total Tests: ${summary.totalTests || 0}`);
    console.log(`   Passed: ${summary.passed || 0}`);
    console.log(`   Failed: ${summary.failed || 0}`);
    console.log(`   Skipped: ${summary.skipped || 0}`);
  }
  console.log('');

  // Generate Summary
  const passed = Object.values(results.tests).filter(t => t.status === 'PASS').length;
  const failed = Object.values(results.tests).filter(t => t.status === 'FAIL').length;
  const errors = Object.values(results.tests).filter(t => t.status === 'ERROR').length;
  const total = Object.keys(results.tests).length;

  results.summary = {
    total,
    passed,
    failed,
    errors,
    successRate: `${Math.round((passed / total) * 100)}%`
  };

  // Print Final Report
  console.log('='.repeat(70));
  console.log('📊 VERIFICATION REPORT');
  console.log('='.repeat(70));
  console.log(`\n✅ Working Components (${passed}/${total}):`);
  Object.entries(results.tests).forEach(([name, result]) => {
    if (result.status === 'PASS') {
      console.log(`   ✓ ${name.padEnd(20)} - ${result.duration || 'N/A'}`);
    }
  });

  console.log(`\n❌ Failed Components (${failed}/${total}):`);
  const failedTests = Object.entries(results.tests).filter(([_, result]) => result.status === 'FAIL');
  if (failedTests.length === 0) {
    console.log('   (None)');
  } else {
    failedTests.forEach(([name, result]) => {
      const error = result.data?.error || result.error || 'Unknown error';
      console.log(`   ✗ ${name.padEnd(20)} - ${error.substring(0, 60)}`);
    });
  }

  console.log(`\n⚠️  Error Components (${errors}/${total}):`);
  const errorTests = Object.entries(results.tests).filter(([_, result]) => result.status === 'ERROR');
  if (errorTests.length === 0) {
    console.log('   (None)');
  } else {
    errorTests.forEach(([name, result]) => {
      console.log(`   ⚠ ${name.padEnd(20)} - ${result.error || 'Connection error'}`);
    });
  }

  console.log(`\n📈 Success Rate: ${results.summary.successRate}`);
  console.log(`\n⏰ Test completed at: ${results.timestamp}`);
  console.log('='.repeat(70) + '\n');

  return results;
}

// Run tests
runAllTests()
  .then(async (results) => {
    // Save report to file
    const fs = await import('fs');
    fs.writeFileSync(
      'verification-report.json',
      JSON.stringify(results, null, 2)
    );
    console.log('📄 Detailed report saved to: verification-report.json\n');
    process.exit(results.summary.failed + results.summary.errors > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('❌ Test runner error:', err);
    process.exit(1);
  });

