const { Client } = require('pg');

async function checkPasswords() {
  const passwords = ['', 'postgres', 'root', 'admin', 'password', '123456'];
  for (const password of passwords) {
    const client = new Client({
      user: 'postgres',
      host: 'localhost',
      database: 'postgres',
      password: password,
      port: 5432,
    });
    try {
      await client.connect();
      console.log('SUCCESS with password:', password);
      await client.end();
      return password;
    } catch (e) {
      console.log('Failed with password:', password || '<empty>');
    }
  }
  console.log('All failed.');
}

checkPasswords();
