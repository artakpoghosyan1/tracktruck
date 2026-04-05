const http = require('http');

async function test() {
  const loginRes = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
  });
  
  if (loginRes.status === 401) {
    // try to register first
    await fetch('http://localhost:8080/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123', name: 'Test User' })
    });
  }

  const loginRes2 = await fetch('http://localhost:8080/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
  });
  const data = await loginRes2.json();
  console.log("LOGIN RESPONSE:");
  console.log(loginRes2.status, data);

  if (!data.accessToken) return;

  const meRes = await fetch('http://localhost:8080/api/auth/me', {
    headers: { 'Authorization': `Bearer ${data.accessToken}` }
  });
  const meData = await meRes.text();
  console.log("ME RESPONSE:");
  console.log(meRes.status, meData);
}

test().catch(console.error);
