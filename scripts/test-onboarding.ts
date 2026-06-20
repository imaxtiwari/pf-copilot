import axios from 'axios';
import { randomUUID } from 'crypto';

async function testOnboarding() {
  const apiUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/onboarding';

  console.log('--- Test 3.1: Canonical Enum Values ---');
  try {
    const res = await axios.post(apiUrl, {
      age: 52,
      city_tier: 'metro',
      monthly_rent: 0,
      owns_home: true,
      dependents: 'kids',
      medical_conditions: false,
      goals: [
        { type: 'RETIREMENT', amount: 50000000, timeline: 8 },
        { type: 'CHILD_EDUCATION', amount: 4000000, timeline: 3 },
        { type: 'EMERGENCY_CORPUS', amount: 1500000, timeline: 1 }
      ]
    }, {
      headers: { Cookie: `dev_user_id=${randomUUID()}` }
    });
    console.log('Result 3.1:', res.status, res.data);
  } catch (error: any) {
    console.error('Failed 3.1:', error.response?.status, JSON.stringify(error.response?.data || error.message, null, 2));
  }

  console.log('\n--- Test 3.2: Invalid Enum Values ---');
  try {
    const res = await axios.post(apiUrl, {
      age: 52,
      city_tier: 'metro',
      monthly_rent: 0,
      owns_home: true,
      dependents: 'kids',
      medical_conditions: false,
      goals: [
        { type: 'EDUCATION', amount: 4000000, timeline: 3 }
      ]
    }, {
      headers: { Cookie: `dev_user_id=${randomUUID()}` }
    });
    console.log('Result 3.2:', res.status, res.data);
  } catch (error: any) {
    console.log('Result 3.2 (Expected Error):', error.response?.status, error.response?.data || error.message);
  }
}

testOnboarding().catch(console.error);
