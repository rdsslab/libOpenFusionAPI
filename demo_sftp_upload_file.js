// Endpoint 3: Guardar archivo en SFTP (acepta archivo desde body/base64)
const sftp = new sftpClient();
try {
  await sftp.connect({
    host: $_APP_VARS_?.['$_VAR_SFTP_HOST'] || 'localhost',
    port: 2222,
    username: 'demo',
    password: 'demo123',
  });

  // Recibir archivo desde request.body.file o buffer
  const incomingBuffer = Buffer.from(request.body?.content || 'prueba de guardado');
  const fileName = (request.body?.filename || 'upload_' + Date.now() + '.txt').replace(/[^a-zA-Z0-9_\.\-]/g, '_');
  const remotePath = `/upload/${fileName}`;

  await sftp.put(incomingBuffer, remotePath);

  $_RETURN_DATA_ = {
    endpoint: 'upload_file',
    auth_mode: 'password_only',
    saved_path: remotePath,
    bytes: incomingBuffer.length,
  };
} finally {
  await sftp.end();
}
