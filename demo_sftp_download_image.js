// Endpoint 2: Descargar imagen (with privateKey auth)
const sftp = new sftpClient();
try {
  const { readFileSync } = await import("node:fs");
  await sftp.connect({
    host: $_APP_VARS_?.['$_VAR_SFTP_HOST'] || 'localhost',
    port: 2222,
    username: 'public',
    privateKey: readFileSync('/tmp/sftp_keys/id_ed25519'),
  });

  const imgData = await sftp.get('/images/test_image.png');
  $_CUSTOM_HEADERS_.set('Content-Type', 'image/png');
  $_RETURN_DATA_ = imgData;
  $_RETURN_STATUS_ = 200;
} finally {
  await sftp.end();
}
