import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: "postgres://postgres:root@localhost:5432/tracktruck"
});

async function migrate() {
  try {
    await client.connect();
    console.log("Connected to database");

    // Add role column to users
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' NOT NULL;
    `);
    console.log("Updated users table with role column");

    // Create allowed_emails table
    await client.query(`
      CREATE TABLE IF NOT EXISTS allowed_emails (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        role TEXT DEFAULT 'admin' NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    console.log("Created allowed_emails table");

    // Pre-authorize the root super admin
    await client.query(`
      INSERT INTO allowed_emails (email, role)
      VALUES ('artakpoghosyan1@gmail.com', 'super_admin')
      ON CONFLICT (email) DO NOTHING;
    `);
    console.log("Pre-authorized root super admin");

  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
