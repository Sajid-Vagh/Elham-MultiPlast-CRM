const fs = require('fs');
const http = require('http');

async function main() {
  // Login
  const loginBody = JSON.stringify({ username: 'admin', password: 'admin123' });
  const loginResp = await fetch('http://localhost:8082/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: loginBody,
  });
  const loginData = await loginResp.json();
  const token = loginData.token;
  console.log('Token:', token ? token.substring(0, 20) + '...' : 'NONE');

  // Create test file
  const fileBuffer = Buffer.alloc(256);
  fileBuffer.writeUInt8(0x1A, 0);
  fileBuffer.writeUInt8(0x45, 1);
  fileBuffer.writeUInt8(0xDF, 2);
  fileBuffer.writeUInt8(0xA3, 3);

  const boundary = '----TestBoundary123';
  const parts = [];
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-voice.webm"\r\nContent-Type: audio/webm\r\n\r\n`
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="dealId"\r\n\r\n1`));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const resp = await fetch('http://localhost:8082/api/voice-notes', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });
  const data = await resp.json();
  console.log('Status:', resp.status);
  console.log('Response:', JSON.stringify(data, null, 2));

  if (data.storagePath) {
    // Check if file exists
    const fullPath = require('path').resolve(process.cwd(), 'uploads', data.storagePath);
    console.log('Expected file path:', fullPath);
    console.log('File exists:', fs.existsSync(fullPath));

    const altPath = 'D:/Elham-crm/artifacts/api-server/uploads/' + data.storagePath;
    console.log('Alt path:', altPath);
    console.log('Alt exists:', fs.existsSync(altPath));

    const rootPath = 'D:/Elham-crm/uploads/' + data.storagePath;
    console.log('Root path:', rootPath);
    console.log('Root exists:', fs.existsSync(rootPath));
  }
}

main().catch(console.error);
