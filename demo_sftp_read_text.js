// Endpoint 1: Leer archivo texto desde SFTP (con contraseña, sin clave privada)
const sftp = new sftpClient();
try {
  await sftp.connect({
    host: $_APP_VARS_?.['$_VAR_SFTP_HOST'] || 'localhost',
    port: 2222,
    username: 'demo',
    password: 'demo123',
  });

  const data = await sftp.get('/incoming/test_read.txt');
  $_RETURN_DATA_ = {
    endpoint: 'read_text',
    auth_mode: 'password_only',
    file_content: data.toString('utf8'),
    length: data.length,
  };
} finally {
  await sftp.end();
}
